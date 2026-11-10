// Export planning (pure): slide order, file names, prototype hotspots, and the
// self-contained HTML deck. Rendering the images happens in a browser tab.

import { bounds } from "./geometry.mjs";

const live = (els) => els.filter((e) => !e.isDeleted);

/** "01-Login screen" -> 1; no numeric prefix -> null. */
export const numericPrefix = (name) => {
  const m = /^\s*(\d+)/.exec(name ?? "");
  return m ? Number(m[1]) : null;
};

/**
 * Slide order for a page's frames: numeric prefix in the name, then
 * customData.order, then position (rows top to bottom, left to right within a
 * row). `order` (frame ids) overrides all of that and selects frames.
 */
export function orderFrames(frames, order) {
  if (order?.length) {
    const byId = new Map(frames.map((f) => [f.id, f]));
    const missing = order.filter((id) => !byId.has(id));
    if (missing.length) throw Object.assign(new Error(`--order names unknown frame(s): ${missing.join(", ")}`), { code: "unknown_element" });
    return order.map((id) => byId.get(id));
  }
  const key = (f) => [numericPrefix(f.name) ?? Infinity, Number.isFinite(f.customData?.order) ? f.customData.order : Infinity];
  // Same row: vertical centres within half the smaller height.
  const sameRow = (a, b) => Math.abs(a.y + a.height / 2 - (b.y + b.height / 2)) < Math.min(a.height, b.height) / 2;
  return [...frames].sort((a, b) => {
    const [a1, a2] = key(a), [b1, b2] = key(b);
    if (a1 !== b1) return a1 - b1;
    if (a2 !== b2) return a2 - b2;
    if (!sameRow(a, b)) return a.y - b.y;
    return a.x - b.x;
  });
}

/** Safe file-name part from a frame name. */
export const slug = (s) =>
  String(s ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/^\s*\d+\s*[-_.)]?\s*/, "") // the numeric prefix becomes the slide number
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 60) || "frame";

/**
 * Slides for one or more pages, in order. A page without frames is one slide.
 * @param {{name: string, elements: any[]}[]} pages
 * @param {{order?: string[]}} [opts]
 */
export function planSlides(pages, { order } = {}) {
  const isFrame = (e) => e.type === "frame" || e.type === "magicframe";
  const framesOf = (p) => live(p.elements).filter(isFrame);
  if (order?.length) {
    const known = new Set(pages.flatMap((p) => framesOf(p).map((f) => f.id)));
    const missing = order.filter((id) => !known.has(id));
    if (missing.length) throw Object.assign(new Error(`--order names unknown frame(s): ${missing.join(", ")}`), { code: "unknown_element" });
  }
  const slides = [];
  for (const p of pages) {
    const frames = framesOf(p);
    let chosen;
    if (!frames.length) chosen = [null];
    else if (order?.length) chosen = orderFrames(frames, order.filter((id) => frames.some((f) => f.id === id)));
    else chosen = orderFrames(frames);
    for (const f of chosen) {
      slides.push({
        page: p.name,
        frame: f ? f.id : null,
        title: f ? f.name || "Frame" : p.name,
        notes: f && typeof f.customData?.notes === "string" ? f.customData.notes : null,
      });
    }
  }
  slides.forEach((s, i) => (s.number = i + 1));
  return slides;
}

export const fileName = (slide, ext, digits = 2) =>
  `${String(slide.number).padStart(digits, "0")}-${slug(slide.title)}.${ext}`;

/** Parse a canvas element link into {page?, element?}, or null if it isn't one. */
export function parseCanvasLink(link) {
  if (!link) return null;
  let u;
  try {
    u = new URL(link, "http://127.0.0.1/");
  } catch {
    return null;
  }
  if (!["127.0.0.1", "localhost"].includes(u.hostname)) return null;
  const element = u.searchParams.get("element");
  const page = u.searchParams.get("page");
  return element || page ? { element, page } : null;
}

/**
 * Clickable areas for a slide: elements on it whose link points at another
 * slide. Positions are fractions of the exported image.
 * @param {object} slide
 * @param {any[]} elements  the slide's page, all elements
 * @param {object[]} slides  every slide (to resolve targets)
 * @param {Record<string, any[]>} elementsByPage
 * @param {{x1,y1,x2,y2}} area  scene bounds the image shows
 */
export function hotspots(slide, elements, slides, elementsByPage, area) {
  const els = live(elements);
  const byId = new Map(els.map((e) => [e.id, e]));
  const onSlide = (e) => !slide.frame || e.frameId === slide.frame || (e.containerId && byId.get(e.containerId)?.frameId === slide.frame);
  const W = area.x2 - area.x1, H = area.y2 - area.y1;
  const out = [];
  for (const e of els) {
    if (!e.link || e.id === slide.frame || !onSlide(e)) continue;
    const t = parseCanvasLink(e.link);
    if (!t) continue;
    const targetPage = t.page || slide.page;
    const pageEls = elementsByPage[targetPage] ?? [];
    // An element id, or a group id (Excalidraw's "link to object" can name a group).
    const target = t.element ? pageEls.find((x) => x.id === t.element && !x.isDeleted) ?? pageEls.find((x) => !x.isDeleted && x.groupIds?.includes(t.element)) : null;
    const frameId = target ? (target.type === "frame" ? target.id : target.frameId ?? null) : null;
    const to = slides.find((s) => s.page === targetPage && s.frame === frameId) ?? slides.find((s) => s.page === targetPage);
    if (!to || to === slide) continue;
    const b = bounds(e);
    out.push({
      id: e.id,
      to: to.number,
      x: (b.x1 - area.x1) / W,
      y: (b.y1 - area.y1) / H,
      w: (b.x2 - b.x1) / W,
      h: (b.y2 - b.y1) / H,
    });
  }
  return out;
}

/** Scene bounds of a page export with `padding` around the elements. */
export function pageArea(elements, padding) {
  const els = live(elements).filter((e) => !(e.type === "text" && e.containerId));
  if (!els.length) return { x1: 0, y1: 0, x2: 1, y2: 1 };
  const bs = els.map(bounds);
  return {
    x1: Math.min(...bs.map((b) => b.x1)) - padding,
    y1: Math.min(...bs.map((b) => b.y1)) - padding,
    x2: Math.max(...bs.map((b) => b.x2)) + padding,
    y2: Math.max(...bs.map((b) => b.y2)) + padding,
  };
}

export const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const pct = (v) => `${(v * 100).toFixed(3)}%`;

/**
 * A single self-contained HTML file: each slide's SVG as a data: image (so
 * fonts and ids of different slides can't clash), hotspots for prototype
 * links, keyboard and click navigation, speaker notes, and a print stylesheet.
 * It makes no network requests.
 * @param {{title?: string|null, slides: {number, title, notes, svg, width, height, hotspots}[]}} deck
 */
export function renderDeck({ title, slides }) {
  const total = slides.length + (title ? 1 : 0);
  const offset = title ? 1 : 0;
  const sections = [];
  if (title) {
    sections.push(`<section class="slide title-slide" data-n="1"><div class="frame"><h1>${escapeHtml(title)}</h1></div><footer><span></span><span class="num">1 / ${total}</span></footer></section>`);
  }
  for (const s of slides) {
    const n = s.number + offset;
    const src = `data:image/svg+xml;base64,${Buffer.from(s.svg).toString("base64")}`;
    const hots = s.hotspots
      .map((h) => `<a class="hot" href="#${h.to + offset}" data-to="${h.to + offset}" style="left:${pct(h.x)};top:${pct(h.y)};width:${pct(h.w)};height:${pct(h.h)}" aria-label="Go to slide ${h.to + offset}"></a>`)
      .join("");
    sections.push(
      `<section class="slide" data-n="${n}"><div class="frame"><div class="art" style="aspect-ratio:${s.width} / ${s.height}">` +
        `<img src="${src}" alt="${escapeHtml(s.title)}" width="${s.width}" height="${s.height}">${hots}</div></div>` +
        `<footer><span class="name">${escapeHtml(s.title)}</span><span class="num">${n} / ${total}</span></footer>` +
        (s.notes ? `<aside class="notes">${escapeHtml(s.notes).replace(/\n/g, "<br>")}</aside>` : "") +
        `</section>`,
    );
  }
  const docTitle = escapeHtml(title || slides[0]?.title || "Slides");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="obeya">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<title>${docTitle}</title>
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; background: #f4f4f4; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; color: #1e1e1e; }
  .slide { display: none; position: fixed; inset: 0; flex-direction: column; }
  .slide.current { display: flex; }
  .frame { flex: 1; min-height: 0; display: flex; align-items: center; justify-content: center; padding: 24px; }
  .art { position: relative; max-width: 100%; max-height: 100%; height: 100%; background: #fff; box-shadow: 0 2px 16px rgba(0,0,0,.12); }
  .art img { display: block; width: 100%; height: 100%; }
  .hot { position: absolute; display: block; border-radius: 4px; cursor: pointer; }
  .hot:hover, .hot:focus { outline: 2px solid #e8590c; outline-offset: 2px; }
  footer { display: flex; justify-content: space-between; padding: 8px 20px; font-size: 13px; color: #666; }
  .title-slide h1 { font-size: 48px; font-weight: 600; margin: 0; }
  .notes { display: none; max-height: 30vh; overflow: auto; padding: 12px 20px; background: #fffbe6; border-top: 1px solid #e5d48a; font-size: 15px; }
  body.show-notes .notes { display: block; }
  @page { size: 1280px 720px; margin: 0; }
  @media print {
    html, body { height: auto; background: #fff; }
    .slide { display: flex !important; position: relative; width: 1280px; height: 720px; page-break-after: always; break-after: page; }
    .art { box-shadow: none; }
    .hot, .notes { display: none !important; }
  }
</style>
</head>
<body>
${sections.join("\n")}
<script>
(() => {
  const slides = [...document.querySelectorAll(".slide")];
  let i = 0;
  function go(n) {
    i = Math.max(0, Math.min(slides.length - 1, n));
    slides.forEach((s, k) => s.classList.toggle("current", k === i));
    if (location.hash !== "#" + (i + 1)) history.replaceState(null, "", "#" + (i + 1));
  }
  addEventListener("keydown", (e) => {
    if (["ArrowRight", "ArrowDown", "PageDown", " ", "Enter"].includes(e.key)) go(i + 1);
    else if (["ArrowLeft", "ArrowUp", "PageUp", "Backspace"].includes(e.key)) go(i - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(slides.length - 1);
    else if (e.key === "n") document.body.classList.toggle("show-notes");
    else return;
    e.preventDefault();
  });
  addEventListener("click", (e) => {
    const hot = e.target.closest(".hot");
    if (hot) { e.preventDefault(); return go(Number(hot.dataset.to) - 1); }
    if (e.target.closest(".notes")) return;
    go(e.clientX < innerWidth / 4 ? i - 1 : i + 1);
  });
  addEventListener("hashchange", () => go(Number(location.hash.slice(1)) - 1 || 0));
  go(Number(location.hash.slice(1)) - 1 || 0);
})();
</script>
</body>
</html>
`;
}
