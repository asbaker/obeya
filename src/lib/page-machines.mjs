// The canvas page's state machines, as data. Pure:
// served to the page from /lib/ and unit-tested in Node.

// 2a · Who is changing the editor. One at a time: the page runs these as jobs
// in one queue. Only changes made while the person holds it are theirs.
export const EDITOR = {
  name: "editor",
  initial: "person",
  states: {
    person: { on: { PATCH: "patch", REMOTE: "remote", OPEN: "opening" } },
    patch: { on: { DONE: "person" } }, // an agent patch: changes are the agent's
    remote: { on: { DONE: "person" } }, // another tab's edit, or the server's on catching up
    opening: { on: { DONE: "person" } }, // loading a page is nobody's edit
  },
};

// 2b · Saving the person's edits. Runs alongside the editor machine; a save
// only reads the editor while the person holds it.
export const SAVING = {
  name: "saving",
  initial: "idle",
  states: {
    idle: { on: { EDIT: "waiting", FLUSH: "saving", OFFLINE: "offline" } },
    waiting: { on: { EDIT: "waiting", QUIET: "saving", FLUSH: "saving", OFFLINE: "offline" } }, // 300 ms after the last edit
    saving: { on: { EDIT: "dirty", SAVED: "idle", FAILED: "idle", OFFLINE: "offline" } }, // sent as the person's
    dirty: { on: { EDIT: "dirty", SAVED: "waiting", FAILED: "idle", OFFLINE: "offline" } }, // edited during the save: wait, then send the rest
    offline: { on: { EDIT: "offline", BACK: "idle" } }, // edits wait in this tab; reconnecting catches up, then flushes
  },
};

// 1 · The page's connection to the server (its event stream). Edits wait in
// the tab while away and are sent after catching up. Two dead ends need a
// reload: the port now serves another folder, or something else holds it.
export const CONNECTION = {
  name: "connection",
  initial: "connecting",
  states: {
    connecting: { on: { HELLO: "connected", AWAY: "away", LOST: "lost" } },
    connected: { on: { AWAY: "away", LOST: "lost" } }, // edits sync live
    away: { on: { AWAY: "away", HELLO: "catching", OTHER_FOLDER: "wrong-folder", LOST: "lost" } }, // edits wait here; the stream retries
    catching: { on: { CAUGHT_UP: "connected", AWAY: "away", LOST: "lost" } }, // take the server's changes, then send the waiting edits
    "wrong-folder": {}, // reload needed; edits made while away were not saved
    lost: {}, // the stream gave up: something else answers on the port
  },
};

// 3 · Present: one frame at a time with the laser pointer. "Paused" (the
// person pressed Esc to annotate) is data, not a state: the frame each page
// last presented, resumed if it is still the frame in the middle of the view.
export const PRESENT = {
  name: "present",
  initial: "off",
  states: {
    off: { on: { START: "presenting" } },
    presenting: { on: { STOP: "off" } }, // view locked to a frame; laser pointer
  },
};

// 4 · What the UI shows over the canvas: one dialog at a time. Asking for a
// dialog while another is open does nothing (the page checks can() first).
// Present is machine 3.
export const DIALOGS = {
  name: "dialogs",
  initial: "canvas",
  states: {
    canvas: { on: { PICKER: "picker", NEW: "new", RENAME: "rename", EXPORT: "export", ABOUT: "about" } },
    picker: { on: { CLOSE: "canvas", NEW: "new" } }, // Cmd/Ctrl+O, the pill, ☰ Open page…; its + New hands over to New page
    new: { on: { CLOSE: "canvas" } }, // ☰ New page…, the picker's + New
    rename: { on: { CLOSE: "canvas" } }, // ☰ Rename this page…
    export: { on: { CLOSE: "canvas" } }, // Cmd/Ctrl+Shift+E, ☰ Export…
    about: { on: { CLOSE: "canvas" } }, // ☰ About obeya
  },
};
