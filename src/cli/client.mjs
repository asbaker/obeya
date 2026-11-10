// The CLI's link to the server: the HTTP client, starting the server in the
// background, and opening the person's tab when a command needs one.
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ensureSidecar, logFile, sameDir } from "../lib/paths.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(here, "..", "server", "main.mjs");
const BROWSER_WAIT_MS = 30000;
const SERVER_START_MS = 15000; // generous: a busy or slow machine may take a while to start node

export class CliError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.code = code;
    this.extra = extra;
  }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function makeClient(plan) {
  const base = `http://127.0.0.1:${plan.port}`;

  async function info() {
    try {
      const res = await fetch(`${base}/api/info`, { signal: AbortSignal.timeout(1000) });
      if (!res.ok) return { foreign: true };
      const body = await res.json().catch(() => null);
      return body?.app === "obeya" ? body : { foreign: true };
    } catch {
      // Nothing answered (refused, reset while shutting down, timeout). If
      // something non-HTTP holds the port, starting the server reports it.
      return null;
    }
  }

  async function call(method, urlPath, body) {
    let res;
    try {
      res = await fetch(base + urlPath, {
        method,
        headers: body ? { "content-type": "application/json" } : {},
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new CliError("server_unreachable", `obeya server not reachable at ${base}`);
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) {
      const e = data.error ?? {};
      const { code = "http_error", message = `HTTP ${res.status}`, ...extra } = e;
      throw new CliError(code, message, extra);
    }
    return data;
  }

  const canvasUrl = (page, frame, extra = {}) => {
    const q = new URLSearchParams(extra);
    if (page) q.set("page", page);
    if (frame) q.set("element", frame);
    const qs = q.toString();
    return `${base}/${qs ? "?" + qs : ""}`;
  };

  return { base, info, call, canvasUrl };
}

/** Start the server in the background if it isn't running; refuse if the port belongs to another dir or app. */
export async function ensureServer(plan, client, note) {
  let i = await client.info();
  if (i?.foreign) throw new CliError("port_in_use", `port ${plan.port} is in use by something other than obeya; pass --port`);
  if (i) {
    if (!sameDir(i.dir, plan.dir)) {
      throw new CliError("port_in_use_other_dir", `port ${plan.port} is serving a canvas for a different directory; pass --port to use another`, { serving: i.dir });
    }
    return i;
  }
  fs.mkdirSync(plan.dir, { recursive: true });
  ensureSidecar(plan.dir);
  const log = fs.openSync(logFile(plan.dir), "a");
  const child = spawn(process.execPath, [SERVER, "--dir", plan.dir, "--port", String(plan.port), "--idle-timeout", String(plan.idleTimeout)], {
    env: plan.env ?? process.env, // e.g. the library cache location
    detached: true,
    stdio: ["ignore", log, log],
  });
  let exited = null;
  child.on("exit", (code) => (exited = code));
  child.unref();
  fs.closeSync(log);
  for (let t = 0; t < SERVER_START_MS / 100 && !i; t++) {
    await sleep(100);
    if (exited !== null) break;
    i = await client.info();
  }
  if (exited === 3) throw new CliError("port_in_use", `port ${plan.port} is already in use; pass --port`);
  if (!i || i.foreign) {
    let tail = "";
    try {
      tail = fs.readFileSync(logFile(plan.dir), "utf8").trim().split("\n").slice(-3).join(" | ");
    } catch {}
    throw new CliError("server_start_failed", `server did not start within ${SERVER_START_MS / 1000}s${exited !== null ? ` (exit ${exited})` : ""}; see .obeya/server.log in the pages dir`, tail ? { log: tail } : {});
  }
  note(`started obeya server at ${client.base}`);
  return i;
}

export function openInBrowser(url) {
  const [bin, ...a] =
    process.platform === "darwin" ? ["open", url]
    : process.platform === "win32" ? ["cmd", "/c", "start", "", url.replace(/&/g, "^&")]
    : ["xdg-open", url];
  const child = spawn(bin, a, { stdio: "ignore", detached: true });
  child.on("error", () => {});
  child.unref();
}

/** Live commands need a connected tab: open one (or fail with exit 2 under --no-open) and wait for it. */
export async function ensureBrowser(plan, client, note, page, frame) {
  const i = await ensureServer(plan, client, note);
  if (i.browsers > 0) return;
  const url = client.canvasUrl(page, frame);
  if (plan.noOpen) throw new CliError("no_canvas_open", "no canvas tab is connected; open the link, then retry", { url });
  openInBrowser(url);
  note("opened the canvas in your browser; waiting for it to connect…");
  for (let t = 0; t < BROWSER_WAIT_MS / 250; t++) {
    await sleep(250);
    if ((await client.info())?.browsers > 0) return;
  }
  throw new CliError("canvas_not_connected", `the canvas didn't connect within ${BROWSER_WAIT_MS / 1000}s; open the link, then retry`, { url });
}
