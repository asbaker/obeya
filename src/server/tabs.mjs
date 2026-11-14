// The browser channel: connected tabs on server-sent events, and requests the
// server makes of a tab (an agent patch, a render) with their answers.
import { ApiError } from "./http.mjs";
import { validPageName } from "../lib/names.mjs";

const BROWSER_TIMEOUT_MS = 15000;
// A browser opens at most 6 connections to one host (HTTP/1.1), and each tab's
// event stream holds one for as long as the tab is open. With 6 tabs on this
// server, every request from every tab (saving edits, Done) waits for a free
// connection forever. So keep at most this many of the person's streams open:
// a tab that connects parks the least recently used ones, which let go of
// theirs and come back when the person returns to them.
const MAX_PERSON_STREAMS = 4;
// How soon a tab's stream reconnects after the server went away (ms; the
// browser's default is 3 s): a restarted server sees its tabs back sooner.
const RETRY_MS = 1000;

/**
 * @param {object} o
 * @param {import("../lib/store.mjs").PageStore} o.store
 * @param {string} o.dir         sent in `hello`, so a reconnecting tab notices the port serves another folder
 * @param {() => void} o.onClose  a tab went away (idle time counts from then)
 */
export function createTabs({ store, dir, onClose }) {
  // Connected tabs: id -> {res, page, lastUsed, kind, caps}. Agent requests go
  // to ONE tab, the one the person used last; the other tabs get live updates.
  // kind "renderer" is a headless Chrome the CLI starts for exports: it may
  // render, but it never counts as the person's tab.
  const tabs = new Map();
  const pending = new Map(); // reqId -> {resolve, reject, timer, tab}
  let nextReq = 1;
  let greeting = () => []; // [event, data] pairs every tab gets when it connects

  const send = (res, event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  /** Send to every tab, or only those showing `page`, minus `except`. */
  function broadcast(event, data, { page, except } = {}) {
    for (const [id, t] of tabs) {
      if (id === except || (page && t.page !== page)) continue;
      send(t.res, event, data);
    }
  }

  // The person's tab to answer: the one used last, or with `page`, the one used
  // last among tabs showing that page (so a patch lands where the person sees it,
  // and otherwise is applied out of sight without moving their view). With
  // `renderers`, a renderer if no person tab is open.
  function responder({ renderers = false, page } = {}) {
    let best = null;
    const pick = (want) => {
      for (const [id, t] of tabs) {
        if (t.kind !== "person" || (want && t.page !== want)) continue;
        if (!best || t.lastUsed > best.lastUsed) best = { id, ...t };
      }
    };
    if (page) pick(page);
    if (!best) pick(null);
    if (!best && renderers) for (const [id, t] of tabs) if (t.kind === "renderer") return { id, ...t };
    return best;
  }

  const count = (kind) => [...tabs.values()].filter((t) => t.kind === kind).length;
  /** Pages the person's tabs show now. */
  const showingPages = () => [...new Set([...tabs.values()].filter((t) => t.kind === "person" && t.page).map((t) => t.page))];

  /** Tell the other tabs on `page` about elements that just won a merge. */
  function relay(page, incoming, except) {
    const byId = store.load(page).byId;
    const won = (Array.isArray(incoming) ? incoming : []).filter((e) => e && byId.get(e.id) === e);
    if (!won.length) return;
    // Images travel with their files, so other tabs can show them at once.
    const all = store.load(page).scene.files ?? {};
    const files = Object.fromEntries(won.filter((e) => e.type === "image" && all[e.fileId]).map((e) => [e.fileId, all[e.fileId]]));
    broadcast("remote-elements", { page, elements: won, ...(Object.keys(files).length ? { files } : {}) }, { page, except });
  }

  function ask(event, data, { renderers = false, timeoutMs = BROWSER_TIMEOUT_MS, page, needs } = {}) {
    const tab = responder({ renderers, page });
    if (!tab) return Promise.reject(new ApiError(409, "no_canvas_open", "no canvas tab is connected"));
    // A tab still running page code from before an upgrade would ignore what it
    // doesn't know (a patch's `layout`) and apply the rest: refuse instead.
    if (needs && !tab.caps?.has(needs)) return Promise.reject(new ApiError(409, "canvas_outdated", `the canvas tab is running older page code that can't do ${needs}; ask the person to reload the tab, then retry`));
    const reqId = String(nextReq++);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(reqId);
        reject(new ApiError(504, "canvas_timeout", `the canvas did not answer ${event} within ${timeoutMs / 1000}s`));
      }, timeoutMs);
      pending.set(reqId, { resolve, reject, timer, tab: tab.id });
      send(tab.res, event, { reqId, ...data });
    });
  }

  function answer(reqId, payload) {
    const p = pending.get(reqId);
    if (!p) return false;
    clearTimeout(p.timer);
    pending.delete(reqId);
    if (payload?.error) {
      const e = typeof payload.error === "string" ? { code: "canvas_error", message: payload.error } : payload.error;
      p.reject(new ApiError(e.code === "canvas_error" ? 500 : 400, e.code || "canvas_error", e.message || "canvas error"));
    } else p.resolve({ ...payload, tab: p.tab });
    return true;
  }

  /** GET /events: a tab connects. The page picks its own tab id; a tab that (re)connects counts as just used. */
  function connect(req, res, url) {
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
    const id = /^[\w-]{8,64}$/.test(url.searchParams.get("tab") ?? "") ? url.searchParams.get("tab") : `t${nextReq++}`;
    const page = url.searchParams.get("page");
    const kind = url.searchParams.get("renderer") === "1" ? "renderer" : "person";
    const caps = new Set((url.searchParams.get("caps") ?? "").split(",").filter(Boolean));
    tabs.set(id, { res, page: page && validPageName(page) ? page : null, lastUsed: Date.now(), kind, caps });
    res.write(`retry: ${RETRY_MS}\n\n`);
    send(res, "hello", { tab: id, dir });
    for (const [event, data] of greeting()) send(res, event, data);
    if (kind === "person") parkExtra(id);
    req.on("close", () => {
      if (tabs.get(id)?.res === res) tabs.delete(id);
      onClose();
    });
  }

  /**
   * Park the least recently used person tabs (never `keep`) until at most
   * MAX_PERSON_STREAMS are open. Only tabs whose page code knows parking (cap
   * "park"): an older tab would reconnect at once and park another.
   */
  function parkExtra(keep) {
    const others = [...tabs].filter(([id, t]) => t.kind === "person" && t.caps?.has("park") && id !== keep).sort(([, a], [, b]) => a.lastUsed - b.lastUsed);
    for (let n = count("person"); n > MAX_PERSON_STREAMS && others.length; n--) {
      const [id, t] = others.shift();
      tabs.delete(id);
      // Requests waiting on it go to another tab next time; they fail now rather than time out.
      for (const [reqId, p] of pending) if (p.tab === id) answer(reqId, { error: { code: "canvas_error", message: "the canvas tab was parked (too many tabs open); retry" } });
      send(t.res, "parked", {});
      t.res.end();
    }
  }

  /** A tab reports use (focus, pointer, keys) and which page it shows. */
  function used(id, page) {
    const t = tabs.get(id);
    if (!t) throw new ApiError(404, "unknown_tab", "no such tab connected");
    t.lastUsed = Date.now();
    if (page === null || validPageName(page)) t.page = page;
  }

  /** The tab `id` now shows `page` (it synced an edit there). */
  function showing(id, page) {
    const t = tabs.get(id);
    if (t) t.page = page;
  }

  /** Tabs showing a deleted page no longer show anything until they open another. */
  function deleted(page) {
    for (const t of tabs.values()) if (t.page === page) t.page = null;
  }

  function renamed(from, to) {
    for (const t of tabs.values()) if (t.page === from) t.page = to;
  }

  function closeAll() {
    broadcast("bye", {});
    for (const t of tabs.values()) t.res.end();
  }

  return {
    greet: (fn) => (greeting = fn),
    broadcast, relay, ask, answer, connect, used, showing, showingPages, renamed, deleted, closeAll, count,
    get size() { return tabs.size; },
    get waiting() { return pending.size; },
  };
}
