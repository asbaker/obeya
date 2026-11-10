// What the page's modules share: the URL it was opened with, who this tab is,
// keyboard names, and one mutable state object.
// No session token: the server only answers this origin. Links from
// versions before 0.1 carry #token=…; drop it, and the token they stored.
export const params = new URLSearchParams(location.search);
if (location.hash) history.replaceState(null, "", location.pathname + location.search);
// Excalidraw looks up ?element= in its empty first scene and toasts "Linked
// object wasn't found"; we jump to it ourselves once the page loads (openPage).
if (params.has("element")) {
  const u = new URL(location.href);
  u.searchParams.delete("element");
  history.replaceState(null, "", u.pathname + u.search);
}
localStorage.removeItem("excalidraw-local-token");

// A headless Chrome the CLI starts only to render exports. It never counts as
// the person's tab.
export const RENDERER = params.get("renderer") === "1";
// Agent requests go to the tab the person used last; this tab's id for that.
export const TAB_ID = crypto.randomUUID();

export const MAC = /Mac|iPhone|iPad/.test(navigator.platform);
// Written the way Excalidraw writes its own shortcuts.
export const KEY_PAGES = MAC ? "Cmd+O" : "Ctrl+O";
export const KEY_PRESENT = MAC ? "Shift+Option+P" : "Shift+Alt+P";
export const KEY_EXPORT = MAC ? "Cmd+Shift+E" : "Ctrl+Shift+E";

export const S = {
  api: null, // the visible editor
  currentPage: null,
  known: new Map(), // id -> version we last sent to / received from the server
  connected: false, // the event stream is open to the server serving this tab's folder
  lastInputAt: 0, // when the person last did something that can edit (see sync.mjs, settling)
  // Present
  focusedFrame: null,
  hiddenIds: new Set(),
  // The React UI fills these in when it mounts.
  setUi: () => {},
  openPicker: () => {},
  openExport: () => {},
  openAbout: () => {},
  newPage: () => {},
  // Counters for the smoke test.
  patchesApplied: 0,
  remoteApplied: 0,
  librariesLoaded: 0,
};

export function changedSinceKnown() {
  return S.api.getSceneElementsIncludingDeleted().filter((e) => S.known.get(e.id) !== e.version);
}
export function markKnown(els) {
  for (const e of els) S.known.set(e.id, e.version);
}
