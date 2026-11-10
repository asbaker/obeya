// Test access (only with ?test=1), for the browser smoke test.
import { params, S } from "./state.mjs";
import { framesInOrder, presenting } from "./present.mjs";
import { linkForSelection } from "./links.mjs";
import { applyRemote, editor, flushSync } from "./sync.mjs";
import { connection } from "./server-link.mjs";
import { dialogs } from "./ui/dialogs.mjs";

// --- test access (only with ?test=1): read-only, for the browser smoke test -----
export function installTestHooks() {
  if (params.get("test") !== "1") return;
  const clone = (x) => JSON.parse(JSON.stringify(x));
  window.obeyaTest = {
    ready: () => Boolean(S.api && S.currentPage),
    page: () => S.currentPage,
    elements: () => clone(S.api.getSceneElements()),
    focusedFrame: () => S.focusedFrame,
    hidden: () => [...S.hiddenIds],
    present: () => presenting(),
    view: () => { const s = S.api.getAppState(); return { scrollX: Math.round(s.scrollX), scrollY: Math.round(s.scrollY), zoom: s.zoom.value }; },
    selected: () => Object.keys(S.api.getAppState().selectedElementIds ?? {}).sort(),
    // Scene coordinates -> client (viewport) coordinates of the canvas.
    toClient: (x, y) => {
      const s = S.api.getAppState(), z = s.zoom.value;
      return { x: (x + s.scrollX) * z + s.offsetLeft, y: (y + s.scrollY) * z + s.offsetTop };
    },
    tool: () => S.api.getAppState().activeTool.type,
    connection: () => connection.state,
    files: () => Object.keys(S.api.getFiles()),
    dialog: () => dialogs.state,
    // How many agent patches this tab applied, and how many live updates it took in.
    counts: () => ({ patchesApplied: S.patchesApplied, remoteApplied: S.remoteApplied }),
    librariesLoaded: () => S.librariesLoaded,
    linkFor: (id) => linkForSelection(id),
    framesInOrder: () => framesInOrder().map((f) => f.id),
    // Change an element the way the editor's own late layout would: no input event.
    // A live update from elsewhere; while it is still being applied, the editor
    // re-lays out an element because of it (`layout`) and a save starts.
    remoteThenFlush: async (elements, layout) => {
      const applied = applyRemote({ page: S.currentPage, elements });
      await editor.when((s) => s === "remote"); // applied, waiting for the editor to settle
      window.obeyaTest.nudge(layout.id, layout.fields);
      return Promise.all([applied, flushSync()]);
    },
    nudge: (id, fields) => S.api.updateScene({ elements: S.api.getSceneElementsIncludingDeleted().map((e) => e.id === id ? { ...e, ...fields, version: e.version + 1, versionNonce: (Math.random() * 2 ** 31) | 0 } : e) }),
  };
}
