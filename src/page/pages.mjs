// Opening a page, and pointing the view at an element or frame.
import { normalizePageName } from "/lib/names.mjs";
import { setTitle } from "./ui/wait-banner.mjs";
import { CaptureUpdateAction } from "./deps.mjs";
import { RENDERER, S } from "./state.mjs";
import { getJSON, postJSON, reportUsed } from "./server-link.mjs";
import { editorJob, flushSync, nextFrame } from "./sync.mjs";
import { focusFrame } from "./present.mjs";

// Pages this browser opened lately, newest first (for the page picker).
const RECENT_KEY = "obeya-recent";
export const recentPages = () => { try { return JSON.parse(localStorage.getItem(RECENT_KEY)) || []; } catch { return []; } };
export function forgetPage(name) {
  localStorage.setItem(RECENT_KEY, JSON.stringify(recentPages().filter((n) => n !== name)));
}
export function rememberPage(name) {
  localStorage.setItem(RECENT_KEY, JSON.stringify([name, ...recentPages().filter((n) => n !== name)].slice(0, 8)));
}

// --- pages ---------------------------------------------------------------------
// A new page is saved when it's created, then opened.
export const makePage = (name) => postJSON(`/api/pages/${encodeURIComponent(name)}`, {});
export async function createPage(name) {
  await makePage(name);
  await openPage(name);
}
export async function openPage(name, frameId) {
  name = normalizePageName(name); // from a URL or a link: the NFC form the server uses
  if (name !== S.currentPage) await editorJob((hold) => loadPage(name, hold));
  goTo(frameId);
}
async function loadPage(name, hold) {
  if (name === S.currentPage) return; // opened while this waited its turn
  await flushSync();
  // A page that doesn't exist yet opens empty; the agent is about to create it.
  const { scene } = await getJSON(`/api/pages/${encodeURIComponent(name)}?ifMissing=empty`);
  hold.enter("OPEN");
  const files = Object.values(scene.files || {});
  if (files.length) S.api.addFiles(files);
  S.api.updateScene({
    elements: scene.elements,
    appState: { viewBackgroundColor: scene.appState?.viewBackgroundColor || "#ffffff" },
    captureUpdate: CaptureUpdateAction.NEVER,
  });
  S.api.history.clear();
  if (S.focusedFrame) focusFrame(null);
  S.known = new Map(scene.elements.map((e) => [e.id, e.version]));
  S.currentPage = name;
  await nextFrame();
  hold.leave();
  const u = new URL(location.href);
  u.searchParams.set("page", name);
  u.searchParams.delete("element");
  history.replaceState(null, "", u.pathname + u.search);
  reportUsed();
  if (!RENDERER) rememberPage(name);
  setTitle(); // "obeya - <page>": obeya first, so narrow tabs still show it
  S.setUi((s) => ({ ...s, page: name }));
}

// Fit an element into the part of the canvas the toolbar doesn't cover, with a margin.
const TOOLBAR_PX = 72, MARGIN_PX = 32, MAX_ZOOM = 2;
function fitBelowToolbar(target) {
  const s = S.api.getAppState();
  const w = Math.max(1, s.width - 2 * MARGIN_PX), h = Math.max(1, s.height - TOOLBAR_PX - 2 * MARGIN_PX);
  const zoom = Math.max(0.1, Math.min(MAX_ZOOM, w / Math.max(1, target.width), h / Math.max(1, target.height)));
  const cx = target.x + target.width / 2, cy = target.y + target.height / 2;
  S.api.updateScene({
    appState: {
      zoom: { value: zoom },
      scrollX: s.width / 2 / zoom - cx,
      scrollY: (TOOLBAR_PX + MARGIN_PX + h / 2) / zoom - cy,
    },
    captureUpdate: CaptureUpdateAction.NEVER,
  });
}

// An element, or a group (Excalidraw's "link to object" can name a group):
// the group's members' bounding box.
function findTarget(els, id) {
  const el = els.find((e) => e.id === id);
  if (el) return el;
  const members = els.filter((e) => e.groupIds?.includes(id));
  if (!members.length) return null;
  const x1 = Math.min(...members.map((e) => e.x)), y1 = Math.min(...members.map((e) => e.y));
  const x2 = Math.max(...members.map((e) => e.x + e.width)), y2 = Math.max(...members.map((e) => e.y + e.height));
  return { id, type: "group", x: x1, y: y1, width: x2 - x1, height: y2 - y1, members };
}

export function goTo(targetId, { lock = false } = {}) {
  const els = S.api.getSceneElements();
  const target = targetId ? findTarget(els, targetId) : null;
  if (targetId && !target) return false;
  if (!target && !els.length) return true;
  if (target && !lock) {
    fitBelowToolbar(target);
    return true;
  }
  S.api.setViewport({
    target: target?.members || target || els,
    fit: target ? "contain" : "scale-down",
    lock: lock && target ? { scroll: true, zoom: true, overscroll: false } : undefined,
    animation: !lock,
  });
  if (lock && target?.type === "frame") focusFrame(target.id);
  return true;
}
