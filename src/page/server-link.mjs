// Talking to the server: requests, reporting which tab is in use, and the
// event stream (agent requests, live updates, reconnecting).
import { RENDERER, TAB_ID, S } from "./state.mjs";
import { toast } from "./ui/common.mjs";
import { createMachine } from "/lib/machine.mjs";
import { CONNECTION } from "/lib/page-machines.mjs";
import { applyRemote, flushSync, setOnline } from "./sync.mjs";
import { queuePatch } from "./patch.mjs";
import { handleExport, handleLibrarySheet, handleShow, loadLibraries } from "./render.mjs";
import { handleMermaid } from "./mermaid.mjs";
import { forgetPage, openPage, recentPages, rememberPage } from "./pages.mjs";
import { setTitle, setWaits } from "./ui/wait-banner.mjs";

export function notice(html) {
  document.getElementById("notice-text").innerHTML = html;
  document.getElementById("notice").classList.add("on");
}

// --- server helpers ------------------------------------------------------------
export async function request(u, init = {}) {
  const r = await fetch(u, init);
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(body.error?.message || `HTTP ${r.status}`), { code: body.error?.code });
  return body;
}
export const getJSON = (u) => request(u);
export const postJSON = (u, body, extra = {}) =>
  request(u, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), ...extra });

// --- agent requests (server-sent events) ----------------------------------------
export const answer = (reqId, body) => postJSON(`/api/answer/${reqId}`, body);
export const fail = (reqId, code, message) => answer(reqId, { error: { code, message } });

// --- which tab is "in use" ------------------------------------------------------
// Agent requests go to the tab the person used last. Tell the server whenever
// this tab is used (focus, pointer, keys) and which page it shows.
let usedTimer = null;
export function reportUsed() {
  if (RENDERER) return;
  clearTimeout(usedTimer);
  usedTimer = setTimeout(() => {
    postJSON(`/api/tabs/${TAB_ID}/used`, { page: S.currentPage }).catch(() => {});
  }, 150);
}
window.addEventListener("focus", reportUsed);
document.addEventListener("pointerdown", reportUsed, true);
document.addEventListener("keydown", reportUsed, true);
// When the person last did something that can edit (see settling, below).
for (const ev of ["pointerdown", "keydown", "paste", "drop"]) document.addEventListener(ev, () => (S.lastInputAt = performance.now()), true);
document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && reportUsed());

// Machine 1 (lib/page-machines.mjs): this tab's connection to the server.
export const connection = createMachine(CONNECTION);
let awayBecause = null; // the toast for going away: the server said bye, or the stream dropped
let catchRound = 0;

// The server names the folder it serves: if the port comes back serving
// another folder, stop here rather than save this page's edits into it.
let folder = null;
let stream = null; // this tab's event stream

// Connected only once the editor is ready, so the server never counts a tab
// that can't yet answer agent requests.
export function connectEvents() {
  openStream();
  watchConnection();
}

// A parked tab (too many tabs open; see "parked" below) connects again when the
// person comes back to it.
const resume = () => connection.state === "parked" && stream?.readyState === EventSource.CLOSED && openStream();
if (!RENDERER) {
  window.addEventListener("focus", resume);
  document.addEventListener("pointerdown", resume, true);
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && resume());
}

function openStream() {
  const q = new URLSearchParams({ tab: TAB_ID });
  if (S.currentPage) q.set("page", S.currentPage);
  if (RENDERER) q.set("renderer", "1");
  q.set("caps", "layout,mermaid,park"); // what this page's code can do; a tab opened before an upgrade lacks it
  const events = (stream = new EventSource(`/events?${q}`));
  events.addEventListener("remote-elements", (e) => applyRemote(JSON.parse(e.data)));
  events.addEventListener("agent-patch", (e) => queuePatch(JSON.parse(e.data)));
  events.addEventListener("show", (e) => handleShow(JSON.parse(e.data)));
  events.addEventListener("export", (e) => handleExport(JSON.parse(e.data)));
  events.addEventListener("library-sheet", (e) => handleLibrarySheet(JSON.parse(e.data)));
  events.addEventListener("mermaid", (e) => handleMermaid(JSON.parse(e.data)));
  events.addEventListener("libraries-changed", () => loadLibraries());
  events.addEventListener("waits", (e) => setWaits(JSON.parse(e.data).waits));
  events.addEventListener("pages", (e) => {
    const { pages, skipped } = JSON.parse(e.data);
    S.setUi((s) => ({ ...s, pages, skipped }));
  });
  events.addEventListener("page-renamed", (e) => {
    const { from, to } = JSON.parse(e.data);
    if (S.currentPage !== from) return;
    S.currentPage = to;
    const u = new URL(location.href);
    u.searchParams.set("page", to);
    history.replaceState(null, "", u.pathname + u.search);
    setTitle();
    rememberPage(to);
    S.setUi((s) => ({ ...s, page: to }));
  });
  // A page was deleted (Rename or move → Delete page…, in any tab): a tab
  // showing it opens the most recent other page, else the first.
  events.addEventListener("page-deleted", async (e) => {
    const { page } = JSON.parse(e.data);
    forgetPage(page);
    if (S.currentPage !== page) return;
    const { pages } = await getJSON("/api/pages").catch(() => ({ pages: [] }));
    const names = pages.map((p) => p.name);
    // The most recent other page first, then the rest.
    const order = [...new Set([...recentPages().filter((n) => names.includes(n)), ...names])];
    // Leave it first: opening a page saves pending edits to the one on screen,
    // which would bring the deleted page back.
    S.currentPage = null;
    for (const next of order) {
      try {
        await openPage(next);
        return toast(`Deleted ${page}. It's in .obeya/.trash/ if you need it back.`, { duration: 5000 });
      } catch {}
    }
    notice(`${page} was deleted and no other page would open. Reload this tab.`);
  });
  // Tabs survive restarts: EventSource reconnects by itself, and
  // the tab then catches up with the server and sends what it couldn't save.
  events.addEventListener("hello", (e) => {
    const { dir } = JSON.parse(e.data);
    if (folder && dir !== folder) {
      events.close();
      return connection.send("OTHER_FOLDER");
    }
    folder = dir;
    connection.send("HELLO");
  });
  // A browser has only a few connections per host and each tab's stream holds
  // one: with too many tabs open, saving and Done in every tab would wait
  // forever. The server parks the tab used least lately; it lets go of its
  // stream (else it would reconnect) until the person comes back to it.
  events.addEventListener("parked", () => {
    events.close();
    if (connection.can("PARK")) connection.send("PARK");
  });
  events.addEventListener("bye", () => {
    awayBecause = "The obeya server stopped. Your edits are kept in this tab and saved when it's back (any obeya command starts it).";
    connection.send("AWAY");
  });
  events.onerror = () => {
    // EventSource gives up for good only on a non-200 answer: something else holds the port.
    if (events.readyState === EventSource.CLOSED) return connection.can("LOST") && connection.send("LOST");
    awayBecause ??= "Lost the connection to the obeya server. Your edits are kept in this tab; retrying…";
    if (connection.can("AWAY")) connection.send("AWAY");
  };
}

function watchConnection() {
  connection.subscribe((to, from) => {
    setOnline(to === "connected" || to === "catching");
    if (to === "away" && from !== "away") toast(awayBecause, { duration: Infinity });
    if (to !== "away") awayBecause = null;
    if (to === "connected" && from === "connecting") flushSync().catch(() => {}); // edits made before the stream opened
    if (to === "catching") {
      const round = ++catchRound;
      catchUp().then(() => {
        if (round !== catchRound || connection.state !== "catching") return; // dropped again meanwhile
        connection.send("CAUGHT_UP");
        toast("Reconnected to the obeya server.");
      });
    }
    if (to === "parked") toast("This tab is paused: too many obeya tabs are open in this browser. Click here to resume; your edits are kept.", { duration: Infinity });
    if (to === "wrong-folder") {
      notice("The obeya server on this port now serves a different folder. Reload this tab to open it; edits made here since it went away were not saved.");
    }
    if (to === "lost") notice("Lost the connection to the obeya server. Run <code>obeya open</code>, then reload this tab.");
  });
}

// After reconnecting: take what changed on the server meanwhile (same merge
// rule as live updates), send the person's unsaved edits, refresh the page list.
async function catchUp() {
  try {
    if (S.currentPage) {
      const { scene } = await getJSON(`/api/pages/${encodeURIComponent(S.currentPage)}?ifMissing=empty`);
      await applyRemote({ page: S.currentPage, elements: scene.elements, files: scene.files });
    }
    await flushSync();
    reportUsed();
    const { pages, skipped } = await getJSON("/api/pages");
    S.setUi((s) => ({ ...s, pages, skipped }));
  } catch (err) {
    toast(`Reconnected, but couldn't catch up: ${err.message}`, { duration: 6000 });
  }
}
