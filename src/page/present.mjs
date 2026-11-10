// Present: one frame at a time, with the laser pointer.
import { createMachine } from "/lib/machine.mjs";
import { PRESENT } from "/lib/page-machines.mjs";
import { S } from "./state.mjs";
import { nextFrame } from "./sync.mjs";
import { goTo } from "./pages.mjs";
import { toast } from "./ui/common.mjs";

// Machine 3 (lib/page-machines.mjs).
export const present = createMachine(PRESENT);
export const presenting = () => present.state === "presenting";
const lastPresented = new Map(); // page -> the frame shown when the person last presented it (resumed after Esc)

// Hide every element outside the frame. Render-only: the document is unchanged.
export function focusFrame(frameId) {
  S.focusedFrame = frameId;
  S.hiddenIds = new Set();
  const order = frameId ? framesInOrder() : [];
  if (frameId && presenting()) lastPresented.set(S.currentPage, frameId);
  S.setUi((s) => ({ ...s, presentPos: frameId ? { i: order.findIndex((f) => f.id === frameId) + 1, n: order.length } : null }));
  if (!frameId) return S.api.setElementRenderOverrides(null);
  const els = S.api.getSceneElements();
  const byId = new Map(els.map((e) => [e.id, e]));
  const hidden = new Map();
  for (const e of els) {
    const inFrame = e.id === frameId || e.frameId === frameId || (e.containerId && byId.get(e.containerId)?.frameId === frameId);
    if (!inFrame) hidden.set(e.id, { opacity: 0 });
  }
  S.hiddenIds = new Set(hidden.keys());
  S.api.setElementRenderOverrides(hidden);
}

// Frames in slide order, as export orders them: numeric prefix in the name,
// then customData.order, then rows top to bottom, left to right.
export function framesInOrder() {
  const frames = S.api.getSceneElements().filter((e) => e.type === "frame");
  const prefix = (f) => { const m = /^\s*(\d+)/.exec(f.name ?? ""); return m ? Number(m[1]) : Infinity; };
  const order = (f) => (Number.isFinite(f.customData?.order) ? f.customData.order : Infinity);
  const sameRow = (a, b) => Math.abs(a.y + a.height / 2 - (b.y + b.height / 2)) < Math.min(a.height, b.height) / 2;
  return frames.sort((a, b) => prefix(a) - prefix(b) || order(a) - order(b) || (sameRow(a, b) ? a.x - b.x : a.y - b.y));
}

// The frame to start presenting on: the one the person has selected (or is
// inside); else the frame they last presented here, if it is still the frame
// nearest the middle of the screen (they stepped out to annotate it); else the
// first in slide order.
function startFrame() {
  const s = S.api.getAppState(), els = S.api.getSceneElements();
  const byId = new Map(els.map((e) => [e.id, e]));
  for (const id of Object.keys(s.selectedElementIds ?? {})) {
    const e = byId.get(id);
    const f = e?.type === "frame" ? e : byId.get(e?.frameId);
    if (f) return f;
  }
  const frames = framesInOrder();
  const last = lastPresented.get(S.currentPage);
  if (last && frames.length) {
    const z = s.zoom.value, mx = -s.scrollX + s.width / z / 2, my = -s.scrollY + s.height / z / 2;
    const dist = (f) => Math.hypot(f.x + f.width / 2 - mx, f.y + f.height / 2 - my);
    const nearest = frames.reduce((a, b) => (dist(b) < dist(a) ? b : a));
    if (nearest.id === last) return nearest;
  }
  return frames[0] ?? null;
}

// Next / previous frame in slide order (keys and the ‹ › buttons while presenting).
export function stepFrame(delta) {
  const frames = framesInOrder();
  if (!frames.length) return;
  const i = frames.findIndex((f) => f.id === S.focusedFrame);
  const next = delta === Infinity ? frames.length - 1 : delta === -Infinity ? 0 : Math.max(0, Math.min(frames.length - 1, (i < 0 ? 0 : i) + delta));
  if (frames[next] && frames[next].id !== S.focusedFrame) goTo(frames[next].id, { lock: true });
}

export function setPresent(on) {
  if (on === presenting()) return;
  if (on && !S.api.getSceneElements().some((e) => e.type === "frame")) {
    return toast("Nothing to present: this page has no frames yet. Add a frame (F), or ask your agent for slides.");
  }
  present.send(on ? "START" : "STOP");
}
export const togglePresent = () => setPresent(!presenting());

present.subscribe((to) => {
  const on = to === "presenting";
  S.setUi((s) => ({ ...s, present: on }));
  if (on) {
    const f = startFrame();
    if (f) goTo(f.id, { lock: true });
  } else {
    focusFrame(null);
    S.api.setViewport(null); // release the frame lock
  }
  // Presenting hands the person the laser pointer; stopping gives back the
  // selection tool. After the editor has switched view mode, which resets the tool.
  nextFrame().then(() => {
    if (present.state !== to) return;
    if (on) S.api.setActiveTool({ type: "laser" });
    else if (S.api.getAppState().activeTool.type === "laser") S.api.setActiveTool({ type: "selection" });
  });
});
