#!/usr/bin/env node
// obeya server: a local-only bridge between the Excalidraw page (the
// person) and the CLI (the agent). No dependencies. Binds to 127.0.0.1 only.
//
//   node src/server/main.mjs --dir <pages dir> --port <n> [--idle-timeout <minutes>]
//
// Usually started by the CLI, not by hand. The server is the only writer of
// .excalidraw files, and it writes inside --dir only.

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { PageStore } from "../lib/store.mjs";
import { canonicalDir, legacyTokenFile, migrateSidecar } from "../lib/paths.mjs";
import { checkRequest } from "../lib/security.mjs";
import { normalizePageName, validPageName } from "../lib/names.mjs";
import { DEFAULT_IDLE_MINUTES } from "../lib/commands.mjs";
import { ApiError, json, router, sendFile } from "./http.mjs";
import { createTabs } from "./tabs.mjs";
import { watchPages } from "./watch.mjs";
import { pageRoutes } from "./routes/pages.mjs";
import { renderRoutes } from "./routes/render.mjs";
import { infoRoutes } from "./routes/info.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(here, "..");
const { version: VERSION } = JSON.parse(fs.readFileSync(path.join(SRC, "..", "package.json"), "utf8"));
const { values: opts } = parseArgs({ options: { dir: { type: "string" }, port: { type: "string" }, "idle-timeout": { type: "string" } } });
if (!opts.dir || !opts.port) {
  console.error("usage: node src/server/main.mjs --dir <pages dir> --port <n>");
  process.exit(1);
}
fs.mkdirSync(opts.dir, { recursive: true });
const DIR = canonicalDir(opts.dir);
const PORT = Number(opts.port);
const HOST = "127.0.0.1";
// Minutes with no connected tab and no requests before the server stops itself. 0 = never.
const IDLE_MINUTES = Number(opts["idle-timeout"] ?? DEFAULT_IDLE_MINUTES);
const EXIT_PORT_IN_USE = 3; // the CLI maps this to error code port_in_use
// Pure modules the page shares with the CLI and server, served from /lib/ (an allowlist, never a path).
const PAGE_MODULES = new Set(["layout", "geometry", "merge", "names", "machine", "page-machines"]);

// Change logs, cursors and bands from before the rename carry over.
if (migrateSidecar(DIR)) console.log(`${new Date().toISOString()} moved .excalidraw-local/ to .obeya/`);

let lastActivity = Date.now();
const store = new PageStore(DIR, { onNewPage: () => pages.announce() });
const tabs = createTabs({ store, dir: DIR, onClose: () => (lastActivity = Date.now()) });
const pages = watchPages({ dir: DIR, store, broadcast: tabs.broadcast });

const route = router([
  ...infoRoutes({ tabs, dir: DIR, port: PORT, version: VERSION, idleMinutes: IDLE_MINUTES, shutdown: () => shutdown() }),
  ...pageRoutes({ store, tabs, pages }),
  ...renderRoutes({ store, tabs, dir: DIR }),
]);

const server = http.createServer(async (req, res) => {
  lastActivity = Date.now();
  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  const parts = url.pathname.split("/").filter(Boolean);
  try {
    const denied = checkRequest({ method: req.method, pathname: url.pathname, headers: req.headers }, { port: PORT });
    if (denied) return json(res, denied.status, { error: { code: denied.code, message: denied.message } });

    if (req.method === "GET") {
      if (url.pathname === "/" || url.pathname === "/index.html") return sendFile(res, path.join(SRC, "page", "index.html"), "text/html; charset=utf-8");
      const shared = /^\/lib\/([a-z][a-z-]*)\.mjs$/.exec(url.pathname)?.[1];
      if (shared && PAGE_MODULES.has(shared)) return sendFile(res, path.join(SRC, "lib", `${shared}.mjs`), "text/javascript; charset=utf-8");
      // The page's own modules, stylesheet and logo (src/page): a fixed shape of name, never a free path.
      const own = /^\/page\/((?:ui\/)?[a-z][a-z-]*)\.(mjs|css|svg|png)$/.exec(url.pathname);
      if (own && fs.existsSync(path.join(SRC, "page", `${own[1]}.${own[2]}`))) {
        const type = { mjs: "text/javascript; charset=utf-8", css: "text/css; charset=utf-8", svg: "image/svg+xml", png: "image/png" }[own[2]];
        return sendFile(res, path.join(SRC, "page", `${own[1]}.${own[2]}`), type);
      }
      // Browsers ask for /favicon.ico on their own (and remember the answer): the logo.
      if (url.pathname === "/favicon.ico") return sendFile(res, path.join(SRC, "page", "favicon.png"), "image/png");
      if (url.pathname === "/events") return tabs.connect(req, res, url);
    }
    if (parts[0] !== "api") throw new ApiError(404, "not_found", "not found");
    // Path parts arrive percent-encoded: a page in a folder is one part,
    // project-a%2Foverview. Decode each once, then check the page name.
    const api = parts.map((p) => {
      try {
        return normalizePageName(decodeURIComponent(p));
      } catch {
        throw new ApiError(400, "bad_page_name", `bad percent-encoding in "${p}"`);
      }
    });
    if (api[1] === "pages" && api[2] && !validPageName(api[2])) throw new ApiError(400, "bad_page_name", `bad page name "${api[2]}"`);
    const hit = route(req.method, api);
    if (!hit) throw new ApiError(404, "not_found", parts[1] === "pages" && parts[2] ? "unknown action" : "not found");
    return await hit.handler({ req, res, url, params: hit.params });
  } catch (err) {
    if (err instanceof ApiError) return json(res, err.status, { error: { code: err.code, message: err.message, ...(err.extra || {}) } });
    // Page errors from the store (a bad name, a name that differs only in capitals).
    const status = { bad_page_name: 400, page_exists: 409, unknown_page: 404 }[err?.code];
    if (status) return json(res, status, { error: { code: err.code, message: err.message } });
    console.error(err);
    return json(res, 500, { error: { code: "internal", message: String(err?.message || err) } });
  }
});

// Save pending edits before exiting so no edit is lost.
let stopping = false;
function shutdown() {
  if (stopping) return;
  stopping = true;
  try {
    store.flush();
  } finally {
    tabs.closeAll();
    server.close(() => process.exit(0));
    // Keep-alive sockets would otherwise keep answering while we exit.
    server.closeAllConnections();
    setTimeout(() => process.exit(0), 500).unref();
  }
}
if (IDLE_MINUTES > 0) {
  const idleMs = IDLE_MINUTES * 60000;
  setInterval(() => {
    if (!tabs.size && !tabs.waiting && Date.now() - lastActivity >= idleMs) {
      console.log(`${new Date().toISOString()} idle for ${IDLE_MINUTES} min; stopping`);
      shutdown();
    }
  }, Math.min(30000, Math.max(50, idleMs / 4))).unref();
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

server.on("error", (err) => {
  console.error(err.code === "EADDRINUSE" ? `port ${PORT} is already in use` : err.message);
  process.exit(err.code === "EADDRINUSE" ? EXIT_PORT_IN_USE : 1);
});
server.listen(PORT, HOST, () => {
  // Versions before 0.1 kept a session token here; don't leave one behind.
  fs.rmSync(legacyTokenFile(DIR, PORT), { force: true });
  console.log(`${new Date().toISOString()} obeya ${VERSION}: http://${HOST}:${PORT} (pages in ${DIR})`);
});
