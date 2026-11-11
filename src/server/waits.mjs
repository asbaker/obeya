// An agent waiting for the person: `obeya wait` holds a request open until the
// person presses Done on that page (or the wait times out, or the server stops).
// Tabs showing the page show the ask in a banner; every tab knows which pages
// are waited on (the page picker marks them). Nothing ever switches a tab.
import { SECURITY_HEADERS } from "./http.mjs";
import { brief, resolveChanges } from "../lib/report.mjs";

// The answer is held back until the end, so keep the connection visibly alive:
// HTTP clients give up on a response that sends nothing for a few minutes.
const HEARTBEAT_MS = 30000;

/**
 * @param {object} o
 * @param {import("../lib/store.mjs").PageStore} o.store
 * @param {{broadcast: (event: string, data: any) => void}} o.tabs
 * @param {() => void} o.onEnd  a wait ended (idle time counts from then)
 */
export function createWaits({ store, tabs, onEnd = () => {} }) {
  const waits = new Map(); // id -> {id, page, frame, ask, consumer, started, res, timer, beat}
  let next = 1;

  const list = () => [...waits.values()].map(({ id, page, frame, ask, started }) => ({ id, page, frame, ask, started }));
  const announce = () => tabs.broadcast("waits", { waits: list() });

  /** Start waiting; the response is written when the wait ends. */
  function start(res, { page, frame = null, ask, consumer = "default", timeoutMs = 0 }) {
    const id = `w${next++}`;
    res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store", ...SECURITY_HEADERS });
    const w = { id, page, frame, ask, consumer, started: Date.now(), res };
    // Whitespace before the JSON: harmless to a parser, enough for the client.
    w.beat = setInterval(() => res.write(" "), HEARTBEAT_MS);
    if (timeoutMs > 0) w.timer = setTimeout(() => finish(id, "timeout"), timeoutMs);
    // The agent's command was stopped: no one is waiting any more.
    res.on("close", () => waits.get(id)?.res === res && drop(id));
    waits.set(id, w);
    announce();
    return id;
  }

  function drop(id) {
    const w = waits.get(id);
    if (!w) return null;
    clearInterval(w.beat);
    clearTimeout(w.timer);
    waits.delete(id);
    announce();
    onEnd();
    return w;
  }

  /** End a wait: answer with what the person changed since the agent's last read (that moves its cursor). */
  function finish(id, done) {
    const w = drop(id);
    if (!w) return false;
    let body;
    try {
      const r = store.changes(w.page, { since: "last", source: "user", consumer: w.consumer });
      const changes = brief(resolveChanges(r.entries, store.elements(w.page), store.bands(w.page)));
      body = { page: w.page, frame: w.frame, done, waited: Math.round((Date.now() - w.started) / 1000), rev: r.rev, since: r.since, changes };
    } catch (err) {
      // The page went away meanwhile (deleted or renamed).
      body = { error: { code: err.code === "unknown_page" ? "unknown_page" : "internal", message: String(err.message || err) } };
    }
    w.res.end(JSON.stringify(body));
    return true;
  }

  /** A renamed page keeps its waits. */
  function renamed(from, to) {
    let any = false;
    for (const w of waits.values()) if (w.page === from) (w.page = to), (any = true);
    if (any) announce();
  }

  /** A deleted page: its waits end, with the error that the page is gone. */
  function deleted(page) {
    for (const w of [...waits.values()]) if (w.page === page) finish(w.id, "deleted");
  }

  /** The server is stopping: answer every wait with what there is. */
  function stopAll() {
    for (const id of [...waits.keys()]) finish(id, "stopped");
  }

  return { start, finish, list, renamed, deleted, stopAll, get size() { return waits.size; } };
}
