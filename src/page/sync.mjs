// The person's edits going up to the server, live updates coming in, and
// telling the two apart from an agent patch's late layout.
import { wins } from "/lib/merge.mjs";
import { createMachine } from "/lib/machine.mjs";
import { EDITOR, SAVING } from "/lib/page-machines.mjs";
import { CaptureUpdateAction } from "./deps.mjs";
import { TAB_ID, S, changedSinceKnown, markKnown } from "./state.mjs";
import { postJSON } from "./server-link.mjs";
import { focusFrame } from "./present.mjs";
import { toast } from "./ui/common.mjs";

const SYNC_DEBOUNCE_MS = 300;

// Two machines (lib/page-machines.mjs): who is changing the editor (2a), and
// saving the person's edits (2b).
export const editor = createMachine(EDITOR);
const saving = createMachine(SAVING);

// Let the editor settle (two frames). A tab in the background gets no frames,
// and Chrome throttles its timers hard, so there use a message-channel tick:
// agents usually work while the person's tab is hidden.
export const tick = () => new Promise((r) => {
  const ch = new MessageChannel();
  ch.port1.onmessage = () => r();
  ch.port2.postMessage(0);
});
export const nextFrame = () =>
  document.hidden
    ? tick().then(tick)
    : new Promise((r) => {
        let done = false;
        const finish = () => !done && ((done = true), r());
        requestAnimationFrame(() => requestAnimationFrame(finish));
        document.addEventListener("visibilitychange", finish, { once: true }); // hidden mid-wait
      });

// Elements in `ids`, plus layout the editor does because of them: bound text,
// and arrows bound to them.
export const relatedTo = (ids) => (e) =>
  ids.has(e.id) || ids.has(e.containerId) || ids.has(e.startBinding?.elementId) || ids.has(e.endBinding?.elementId);

// --- 2a: jobs that change the editor, one at a time ------------------------------
// Agent patches, live updates and opening a page run here in turn, so one can
// never hand the editor back while another is still applying. A job takes the
// editor with hold.enter(PATCH | REMOTE | OPEN) right before it changes the
// scene, and gives it back with hold.leave() (or by ending). Until then the
// person holds it: a patch saves their pending edits first, as theirs.
let jobs = Promise.resolve();
export function editorJob(fn) {
  const run = async () => {
    let held = false;
    const hold = {
      enter(event) { editor.send(event); held = true; },
      leave() { if (held) editor.send("DONE"); held = false; },
    };
    try {
      return await fn(hold);
    } finally {
      hold.leave();
      if (S.api && S.currentPage && changedSinceKnown().length) onChange(); // the person's edits meanwhile
    }
  };
  const job = jobs.then(run, run);
  jobs = job.catch(() => {});
  return job;
}

// --- live updates from other tabs and from agent patches applied elsewhere -----
export const applyRemote = (msg) => editorJob((hold) => applyRemoteNow(msg, hold));
async function applyRemoteNow({ page, elements, files }, hold) {
  if (page !== S.currentPage || !S.api) return;
  if (files && Object.keys(files).length) S.api.addFiles(Object.values(files)); // images from elsewhere
  const local = new Map(S.api.getSceneElementsIncludingDeleted().map((e) => [e.id, e]));
  const won = elements.filter((e) => wins(e, local.get(e.id)));
  if (!won.length) return;
  for (const e of won) local.set(e.id, e);
  hold.enter("REMOTE");
  S.api.updateScene({ elements: [...local.values()], captureUpdate: CaptureUpdateAction.NEVER });
  markKnown(won);
  await nextFrame();
  if (S.focusedFrame) focusFrame(S.focusedFrame);
  // Layout the editor redid because of these isn't the person's edit here.
  markKnown(changedSinceKnown().filter(relatedTo(new Set(won.map((e) => e.id)))));
  hold.leave();
  S.remoteApplied++;
}

// --- 2b: the person's edits -> server -----------------------------------------------
let quietTimer = null;
let current = Promise.resolve(); // the save in flight
let nextExtra; // fetch options for the next save (keepalive when the tab closes)
saving.subscribe((to, from) => {
  clearTimeout(quietTimer);
  if (to === "waiting") quietTimer = setTimeout(() => saving.state === "waiting" && saving.send("QUIET"), SYNC_DEBOUNCE_MS);
  if (to === "saving" && from !== "saving") {
    const extra = nextExtra;
    nextExtra = undefined;
    current = save(extra);
    current.catch(() => {}); // reported by save(); flushSync's callers see it too
  }
});

export function onChange() {
  // Changes while an agent patch, a live update or a page load holds the
  // editor aren't the person's; the job checks for theirs when it ends.
  if (editor.state !== "person" || !S.currentPage) return;
  saving.send("EDIT");
}

// The connection (machine 1 will own this): offline, edits wait in this tab.
export function setOnline(on) {
  S.connected = on;
  if (!on && saving.can("OFFLINE")) saving.send("OFFLINE");
  if (on && saving.state === "offline") saving.send("BACK");
}

// Resolves once the person's edits so far are saved; rejects if a save fails.
// Waits for a save already in flight, which keeps the person's edits ahead of
// any agent patch. While offline, edits stay in this tab.
export async function flushSync(extra) {
  for (let round = 0; round < 5; round++) { // the person may keep editing; don't chase them forever
    const st = saving.state;
    if (st === "offline") return;
    if (st === "saving" || st === "dirty") {
      await current.catch(() => {});
      continue;
    }
    if (st === "idle" && !(S.api && S.currentPage && changedSinceKnown().length)) return;
    nextExtra = extra;
    saving.send("FLUSH");
    await current;
  }
}

async function save(extra) {
  try {
    if (!S.connected) return setOnline(false);
    await doSync(extra);
    if (saving.can("SAVED")) saving.send("SAVED"); // not if the connection dropped meanwhile
  } catch (err) {
    if (err.offline) return setOnline(false);
    if (saving.can("FAILED")) saving.send("FAILED");
    toast(`Couldn't save your last change: ${err.message}`, { duration: 6000 });
    throw err;
  }
}

// Excalidraw sometimes redoes layout for a patch's elements (line points, label
// positions) a moment after the patch has answered. For a short while after a
// patch, changes to what it touched are its layout, not the person's edit,
// unless the person clicked, typed, pasted or dropped since.
const SETTLE_MS = 2000;
let settling = []; // {ids, at}
export function settle(ids) {
  const now = performance.now();
  settling = [...settling.filter((s) => now - s.at < SETTLE_MS), { ids, at: now }];
}
function isLayout(e) {
  const now = performance.now();
  settling = settling.filter((s) => now - s.at < SETTLE_MS);
  return settling.some((s) => s.at > S.lastInputAt && relatedTo(s.ids)(e));
}
async function doSync(extra) {
  // Only what the person changed: wait while a job holds the editor. From here
  // to markKnown nothing awaits, so no job can start in between.
  while (editor.state !== "person") await editor.when((s) => s === "person");
  if (!S.currentPage || !S.api) return;
  const all = changedSinceKnown();
  if (!all.length) return;
  const layout = all.filter(isLayout);
  const changed = all.filter((e) => !layout.includes(e));
  const before = new Map(all.map((e) => [e.id, S.known.get(e.id)]));
  markKnown(all);
  const files = S.api.getFiles();
  const usedFiles = Object.fromEntries(
    all.filter((e) => e.fileId && files[e.fileId]).map((e) => [e.fileId, files[e.fileId]]),
  );
  try {
    await postJSON(`/api/pages/${encodeURIComponent(S.currentPage)}/sync`, { elements: changed, layout, files: usedFiles, tab: TAB_ID }, extra);
  } catch (err) {
    // Not saved: keep these edits pending so the next sync sends them again.
    for (const [id, v] of before) v === undefined ? S.known.delete(id) : S.known.set(id, v);
    if (err instanceof TypeError) err.offline = true; // no answer at all: the server is away
    throw err;
  }
}
