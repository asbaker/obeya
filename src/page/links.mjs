import { S } from "./state.mjs";
import { goTo, openPage } from "./pages.mjs";
import { presenting } from "./present.mjs";

export function isCanvasLink(link) {
  if (!link) return false;
  try {
    const u = new URL(link, location.href);
    return ["127.0.0.1", "localhost"].includes(u.hostname) && (u.searchParams.has("element") || u.searchParams.has("page"));
  } catch {
    return false;
  }
}

// Canvas links: ?element=<id> (this page) or ?page=<p>&element=<id>, absolute,
// relative, or made while the server ran on another port. Any other URL is a
// web link, left to Excalidraw.
const isCanvasHost = (url) => url.origin === location.origin || ((url.hostname === "127.0.0.1" || url.hostname === "localhost") && url.protocol === "http:");
export function linkForSelection(id) {
  const u = new URL(location.origin + "/");
  if (S.currentPage) u.searchParams.set("page", S.currentPage);
  u.searchParams.set("element", id);
  return u.toString();
}

let lastLinkOpen = 0;
export function onLinkOpen(element, event) {
  let url;
  try { url = new URL(element.link, location.href); } catch { return; }
  if (!isCanvasHost(url)) return;
  lastLinkOpen = Date.now();
  const target = url.searchParams.get("element");
  const page = url.searchParams.get("page");
  if (!target && !page) return;
  event.preventDefault();
  // Hidden elements still receive clicks; only links inside the shown frame count.
  if (presenting() && S.focusedFrame && element.frameId !== S.focusedFrame && element.id !== S.focusedFrame) return;
  if (page && page.endsWith(".md")) openPage(page, null, { heading: url.hash ? decodeURIComponent(url.hash.slice(1)) : undefined });
  else if (page && page !== S.currentPage) openPage(page).then(() => goTo(target, { lock: presenting() }));
  else goTo(target, { lock: presenting() });
}

// While presenting, clicks follow links by area, not just by what's drawn: Excalidraw
// only hits an unfilled shape on its outline, and text on top of a hotspot has
// no link of its own. So a click anywhere inside a linked element's box (the
// smallest one under the pointer, in the frame on screen) follows its link.
function linkUnder(clientX, clientY) {
  const s = S.api.getAppState(), z = s.zoom.value;
  const x = (clientX - s.offsetLeft) / z - s.scrollX, y = (clientY - s.offsetTop) / z - s.scrollY;
  const els = S.api.getSceneElements();
  const byId = new Map(els.map((e) => [e.id, e]));
  const inFrame = (e) => !S.focusedFrame || e.frameId === S.focusedFrame || byId.get(e.containerId)?.frameId === S.focusedFrame;
  const hits = els.filter((e) => e.link && e.type !== "frame" && inFrame(e) && x >= e.x && x <= e.x + e.width && y >= e.y && y <= e.y + e.height);
  return hits.sort((a, b) => a.width * a.height - b.width * b.height)[0] ?? null;
}
document.addEventListener("click", (ev) => {
  if (!presenting() || !S.api || Date.now() - lastLinkOpen < 400) return; // Excalidraw already handled it
  if (!ev.target.closest?.(".excalidraw canvas, .excalidraw__canvas")) return;
  const el = linkUnder(ev.clientX, ev.clientY);
  if (el) onLinkOpen(el, { preventDefault() {} });
}, true);
