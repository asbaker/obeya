// The server itself and the tabs: info, shutdown, a tab's answer to a request,
// a tab reporting use, and the component libraries for the editor's sidebar.
import { json, readJSON } from "../http.mjs";
import { findChrome } from "../../lib/chrome.mjs";
import { sidebarItems } from "../../lib/library.mjs";
import { loadAllCached } from "../../lib/libcache.mjs";

/** @param {{tabs: any, dir: string, port: number, version: string, idleMinutes: number, shutdown: () => void}} ctx */
export function infoRoutes({ tabs, dir, port, version, idleMinutes, shutdown }) {
  return [
    ["GET", "/api/info", ({ res }) => json(res, 200, {
      app: "obeya", version, dir, port, pid: process.pid, browsers: tabs.count("person"), showing: tabs.showingPages(), renderers: tabs.count("renderer"), idleTimeout: idleMinutes, pdf: Boolean(findChrome()),
    })],
    ["POST", "/api/shutdown", ({ res }) => {
      res.on("finish", shutdown);
      return json(res, 200, { stopped: true });
    }],
    ["POST", "/api/answer/:req", async ({ req, res, params }) => json(res, 200, { ok: tabs.answer(params.req, await readJSON(req)) })],
    ["POST", "/api/tabs/:tab/used", async ({ req, res, params }) => {
      const body = await readJSON(req);
      tabs.used(params.tab, body.page);
      return json(res, 200, { ok: true });
    }],
    // Cached component libraries, for the editor's library sidebar (read only).
    ["GET", "/api/libraries", ({ res }) => json(res, 200, { libraryItems: sidebarItems(loadAllCached()) })],
    // The CLI changed the library cache: tabs reload their sidebar.
    ["POST", "/api/libraries/changed", ({ res }) => {
      tabs.broadcast("libraries-changed", {});
      return json(res, 200, { ok: true });
    }],
  ];
}
