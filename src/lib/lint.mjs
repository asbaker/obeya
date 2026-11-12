// Layout problems on a page, from the sizes the editor saved.
// Pure: no Node built-ins, no text measurement. Rotation is ignored.
import { bounds } from "./geometry.mjs";

export const RULES = ["overlap", "clipped-text", "outside-frame", "loose-arrow", "misrouted-arrow", "near-miss", "hidden", "unframed", "stray", "empty-frame", "crowded-frame", "small-text", "contrast"];

const SHAPES = new Set(["rectangle", "diamond", "ellipse", "stickynote", "text", "image", "embeddable", "iframe"]);
const BINDABLE = new Set(["rectangle", "diamond", "ellipse", "stickynote", "text", "image", "embeddable", "iframe", "frame"]);
const FILLABLE = new Set(["rectangle", "diamond", "ellipse", "stickynote", "image"]);
const FRAMES = new Set(["frame", "magicframe"]);
const TOL = 1; // px: rounding in the editor
const LABEL_TOL = 2; // px: a label's position after its shape is resized
const NEAR_MISS_PX = 4; // edges this close but not equal look like a mistake
const LOOSE_PX = 12; // an unbound arrow end this close to a shape looks attached
const MISROUTED_PX = 40; // a bound arrow end farther than this from its shape is drawn somewhere else
const STRAY_PX = 800; // something outside frames this far from everything else looks lost
const CROWDED = 0.8; // share of a frame covered by its innermost objects
const SCREEN = [1920, 1080]; // a frame presented to fit this screen
const MIN_TEXT_PX = 9; // text smaller than this on that screen is hard to read
const MIN_CONTRAST = 3; // WCAG's minimum for large text
const SLIDE_RATIO = [1.2, 2.4]; // frames this wide for their height look like slides

const w = (b) => b.x2 - b.x1;
const h = (b) => b.y2 - b.y1;
const inside = (a, b, tol = TOL) => a.x1 >= b.x1 - tol && a.y1 >= b.y1 - tol && a.x2 <= b.x2 + tol && a.y2 <= b.y2 + tol;
// Two boxes the same size within a few pixels, one over the other: one hides the other.
const sameBox = (a, b, tol = NEAR_MISS_PX) => ["x1", "y1", "x2", "y2"].every((k) => Math.abs(a[k] - b[k]) <= tol);
const overlapBox = (a, b) => ({ x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1), x2: Math.min(a.x2, b.x2), y2: Math.min(a.y2, b.y2) });
const sharesGroup = (a, b) => (a.groupIds ?? []).some((g) => (b.groupIds ?? []).includes(g));
const filled = (e) => FILLABLE.has(e.type) && (e.type === "image" || (e.backgroundColor && e.backgroundColor !== "transparent")) && (e.opacity ?? 100) > 50;
const contains = (b, [x, y], pad = 0) => x >= b.x1 - pad && x <= b.x2 + pad && y >= b.y1 - pad && y <= b.y2 + pad;

// Colour contrast (WCAG): relative luminance of a #rgb / #rrggbb colour, or null.
function luminance(c) {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})([0-9a-f]{2})?$/i.exec(c ?? "");
  if (!m) return null;
  const hex = m[1].length === 3 ? [...m[1]].map((d) => d + d).join("") : m[1];
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(fg, bg) {
  const [a, b] = [luminance(fg), luminance(bg)];
  if (a === null || b === null) return null;
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
const gap = (a, b) => Math.hypot(Math.max(0, a.x1 - b.x2, b.x1 - a.x2), Math.max(0, a.y1 - b.y2, b.y1 - a.y2));

// What to do about each rule. A response states it once per rule present
// (`fixes`), not once per finding: the numbers that differ are on the finding.
export const FIXES = {
  overlap: "move one apart with a layout (place, stack, distribute); by: the overlap in px, stacked: the same box",
  "clipped-text": "make the shape bigger (size is the label's, in the shape's) or the text shorter; a free text: keep it inside its frame",
  "outside-frame": "move it inside the frame, or make the frame bigger",
  "loose-arrow": "re-apply the arrow's skeleton with start/end bound to the shapes (gone: the id it was bound to)",
  "misrouted-arrow": "re-apply the arrow's skeleton with start/end, or move it (px: how far its end is drawn from the shape)",
  "near-miss": "an align layout (off: the edge or centre and by how many px)",
  hidden: "the first id is under the second, which is filled: toFront, or a stack layout",
  unframed: "set frameId to `into`; a label in another frame than its shape: re-apply the shape's skeleton",
  stray: "move it near the rest, or into a frame",
  "empty-frame": "fill it or delete it",
  "crowded-frame": "leave some room (covered: %), or make the frame bigger",
  "small-text": "fontSize `min` or more (px: its height when the frame is presented full screen)",
  contrast: "darker text or a lighter fill: at least 3:1",
};

/** The fix for each rule among `findings`, once. */
export function fixes(findings) {
  const out = {};
  for (const f of findings) out[f.rule] ??= FIXES[f.rule];
  return out;
}

/**
 * A finding names its rule and ids; the numbers that say how far, how big or
 * where are fields (by, off, px, …); `frame` only when it's in one.
 * @param {any[]} elements  a page's elements in stacking order (bottom first)
 * @param {{frame?: string, rules?: string[]}} [opts]
 * @returns {{rule: string, ids: string[], frame?: string}[]}
 */
export function lint(elements, { frame, rules = RULES } = {}) {
  const live = elements.filter((e) => !e.isDeleted);
  const byId = new Map(live.map((e) => [e.id, e]));
  const order = new Map(live.map((e, i) => [e.id, i]));
  const box = new Map(live.map((e) => [e.id, bounds(e)]));
  const out = [];
  const add = (rule, items, data = {}) => {
    const f = items.find((e) => e.frameId)?.frameId;
    out.push({ rule, ids: items.map((e) => e.id), ...(f ? { frame: f } : {}), ...data });
  };
  const on = new Set(rules);
  // Top-level things a person sees as one object: not labels, not frames.
  const objects = live.filter((e) => !(e.type === "text" && e.containerId) && !FRAMES.has(e.type));
  const shapes = objects.filter((e) => SHAPES.has(e.type));

  if (on.has("overlap")) {
    for (let i = 0; i < shapes.length; i++) {
      for (let j = i + 1; j < shapes.length; j++) {
        const a = shapes[i], b = shapes[j];
        // Different frames clip their contents apart; something in no frame is
        // drawn over every frame, so it can still sit on a framed element.
        if ((a.frameId && b.frameId && a.frameId !== b.frameId) || sharesGroup(a, b)) continue;
        const A = box.get(a.id), B = box.get(b.id);
        if (sameBox(A, B)) {
          add("overlap", [a, b], { stacked: true });
          continue;
        }
        if (inside(A, B) || inside(B, A)) continue; // on top of, not overlapping
        const o = overlapBox(A, B);
        if (w(o) > TOL * 2 && h(o) > TOL * 2) add("overlap", [a, b], { by: [Math.round(w(o)), Math.round(h(o))] });
      }
    }
  }

  if (on.has("clipped-text")) {
    for (const t of live) {
      if (t.type !== "text") continue;
      const T = box.get(t.id);
      const c = t.containerId && byId.get(t.containerId);
      if (c && c.type !== "arrow" && c.type !== "line" && !inside(T, box.get(c.id), LABEL_TOL)) add("clipped-text", [c, t], { size: [Math.round(w(T)), Math.round(h(T))], in: [Math.round(c.width), Math.round(c.height)] });
      const f = !t.containerId && t.frameId && byId.get(t.frameId);
      if (f && !inside(T, box.get(f.id))) add("clipped-text", [t]);
    }
  }

  if (on.has("outside-frame")) {
    for (const e of objects) {
      if (e.type === "text" || !e.frameId) continue;
      const f = byId.get(e.frameId);
      if (f && !inside(box.get(e.id), box.get(f.id))) add("outside-frame", [e]);
    }
  }

  if (on.has("loose-arrow")) {
    const targets = live.filter((e) => BINDABLE.has(e.type) && !(e.type === "text" && e.containerId));
    for (const a of live) {
      if (a.type !== "arrow" || !a.points?.length) continue;
      const ends = [["start", a.points[0], a.startBinding], ["end", a.points.at(-1), a.endBinding]];
      for (const [which, [px, py], binding] of ends) {
        const p = [a.x + px, a.y + py];
        if (binding?.elementId) {
          if (!byId.has(binding.elementId)) add("loose-arrow", [a], { end: which, gone: binding.elementId });
          continue;
        }
        // The smallest shape under the end: the one it looks attached to.
        const hit = targets
          .filter((t) => t.id !== a.id && contains(box.get(t.id), p, LOOSE_PX))
          .sort((x, y) => w(box.get(x.id)) * h(box.get(x.id)) - w(box.get(y.id)) * h(box.get(y.id)))[0];
        if (hit && inside(box.get(a.id), box.get(hit.id), 0)) continue; // drawn on the shape: decoration, not a connector
        if (hit && !FRAMES.has(hit.type)) add("loose-arrow", [a, hit], { end: which });
      }
    }
  }

  if (on.has("near-miss")) {
    const keys = [
      ["left", (b) => b.x1], ["right", (b) => b.x2], ["centre-x", (b) => (b.x1 + b.x2) / 2],
      ["top", (b) => b.y1], ["bottom", (b) => b.y2], ["centre-y", (b) => (b.y1 + b.y2) / 2],
    ];
    for (let i = 0; i < shapes.length; i++) {
      for (let j = i + 1; j < shapes.length; j++) {
        const a = shapes[i], b = shapes[j];
        if ((a.frameId ?? null) !== (b.frameId ?? null) || sharesGroup(a, b)) continue;
        const A = box.get(a.id), B = box.get(b.id);
        if (inside(A, B) || inside(B, A)) continue;
        if (a.type !== b.type) continue; // a title and a box are rarely meant to line up
        const areaA = w(A) * h(A), areaB = w(B) * h(B);
        if (Math.max(areaA, areaB) > 4 * Math.max(1, Math.min(areaA, areaB))) continue; // a column and a card: not peers
        // Only neighbours in a row or a column: their boxes share some x or y
        // range, and the gap between them is no bigger than the larger of them.
        const column = Math.min(A.x2, B.x2) > Math.max(A.x1, B.x1) && Math.max(A.y1, B.y1) - Math.min(A.y2, B.y2) <= Math.max(h(A), h(B));
        const row = Math.min(A.y2, B.y2) > Math.max(A.y1, B.y1) && Math.max(A.x1, B.x1) - Math.min(A.x2, B.x2) <= Math.max(w(A), w(B));
        const report = [];
        for (const [axis, near] of [["x", column], ["y", row]]) {
          if (!near) continue;
          const ks = keys.filter(([k]) => (axis === "x") === ["left", "right", "centre-x"].includes(k));
          const d = ks.map(([k, f]) => [k, Math.abs(f(A) - f(B))]);
          if (d.some(([, v]) => v < 1)) continue; // aligned on some edge or centre: fine
          const off = d.filter(([, v]) => v <= NEAR_MISS_PX);
          if (off.length) report.push(off.sort((p, q) => p[1] - q[1])[0]);
        }
        if (report.length) add("near-miss", [a, b], { off: Object.fromEntries(report.map(([k, v]) => [k, Math.round(v * 10) / 10])) });
      }
    }
  }

  if (on.has("hidden")) {
    for (const e of objects) {
      const E = box.get(e.id);
      const cover = objects.find((s) => s !== e && filled(s) && order.get(s.id) > order.get(e.id) && !sharesGroup(s, e) && inside(E, box.get(s.id), TOL));
      if (cover) add("hidden", [e, cover]);
    }
  }

  if (on.has("unframed")) {
    // Lying wholly inside a frame's area without belonging to it: it won't move,
    // clip or export with the frame. (The editor adds what the person drops there.)
    const fs = live.filter((e) => FRAMES.has(e.type));
    for (const e of objects) {
      const E = box.get(e.id);
      let at = null;
      for (const f of fs) if (inside(E, box.get(f.id))) at = f;
      if (at && (e.frameId ?? null) !== at.id) add("unframed", [e, at], { into: at.id });
    }
    // A label in another frame than its shape: the two come apart when the frame moves.
    for (const t of live) {
      const c = t.type === "text" && t.containerId && byId.get(t.containerId);
      if (c && (t.frameId ?? null) !== (c.frameId ?? null)) add("unframed", [c, t], { label: true });
    }
  }

  if (on.has("misrouted-arrow")) {
    for (const a of live) {
      if (a.type !== "arrow" || !a.points?.length) continue;
      for (const [which, [px, py], binding] of [["start", a.points[0], a.startBinding], ["end", a.points.at(-1), a.endBinding]]) {
        const t = binding?.elementId && byId.get(binding.elementId);
        if (!t) continue;
        const d = gap({ x1: a.x + px, y1: a.y + py, x2: a.x + px, y2: a.y + py }, box.get(t.id));
        if (d > MISROUTED_PX) add("misrouted-arrow", [a, t], { end: which, px: Math.round(d) });
      }
    }
  }

  const frames = live.filter((e) => FRAMES.has(e.type));
  if (on.has("stray")) {
    const free = objects.filter((e) => !e.frameId && e.type !== "arrow" && e.type !== "line");
    const others = [...objects, ...frames];
    if (others.length > 2) {
      for (const e of free) {
        const E = box.get(e.id);
        const near = others.some((o) => o !== e && !sharesGroup(o, e) && o.containerId !== e.id && gap(E, box.get(o.id)) <= STRAY_PX);
        if (!near) add("stray", [e]);
      }
    }
  }

  const inFrame = (f) => objects.filter((e) => e.frameId === f.id);
  if (on.has("empty-frame")) {
    for (const f of frames) if (!live.some((e) => e.frameId === f.id)) add("empty-frame", [f]);
  }

  if (on.has("crowded-frame")) {
    for (const f of frames) {
      const F = box.get(f.id), kids = inFrame(f).filter((e) => e.type !== "arrow" && e.type !== "line");
      // The innermost objects: a column holding cards counts as its cards.
      const leaves = kids.filter((e) => !kids.some((k) => k !== e && inside(box.get(k.id), box.get(e.id)) && w(box.get(k.id)) * h(box.get(k.id)) < w(box.get(e.id)) * h(box.get(e.id))));
      const covered = leaves.reduce((sum, e) => { const o = overlapBox(box.get(e.id), F); return sum + Math.max(0, w(o)) * Math.max(0, h(o)); }, 0);
      const share = covered / Math.max(1, w(F) * h(F));
      if (share > CROWDED) add("crowded-frame", [f], { covered: Math.round(share * 100) });
    }
  }

  if (on.has("small-text")) {
    for (const f of frames) {
      const F = box.get(f.id), ratio = w(F) / Math.max(1, h(F));
      if (ratio < SLIDE_RATIO[0] || ratio > SLIDE_RATIO[1]) continue; // a board, not a slide
      const scale = Math.min(SCREEN[0] / w(F), SCREEN[1] / h(F));
      for (const t of live) {
        if (t.type !== "text" || (t.frameId !== f.id && byId.get(t.containerId)?.frameId !== f.id)) continue;
        const px = (t.fontSize ?? 20) * scale;
        if (px < MIN_TEXT_PX) add("small-text", [t.containerId ? byId.get(t.containerId) : t], { px: Math.round(px * 10) / 10, min: Math.ceil(MIN_TEXT_PX / scale) });
      }
    }
  }

  if (on.has("contrast")) {
    for (const t of live) {
      if (t.type !== "text" || (t.opacity ?? 100) <= 50) continue;
      const T = box.get(t.id);
      const c = t.containerId && byId.get(t.containerId);
      // What's behind it: its container's fill, else the topmost filled shape under it, else the canvas.
      let under = c && filled(c) && c.type !== "image" ? c : null;
      if (!under && !c) under = objects.filter((s) => s !== t && filled(s) && s.type !== "image" && order.get(s.id) < order.get(t.id) && inside(T, box.get(s.id), TOL)).sort((a, b) => order.get(b.id) - order.get(a.id))[0] ?? null;
      const ratio = contrast(t.strokeColor ?? "#1e1e1e", under?.backgroundColor ?? "#ffffff");
      const subject = c || t;
      if (ratio !== null && ratio < MIN_CONTRAST) add("contrast", under ? [subject, under].filter((e, i, a) => a.indexOf(e) === i) : [subject], { ratio: Math.floor(ratio * 10) / 10 });
    }
  }

  return frame ? out.filter((f) => f.frame === frame || f.ids.includes(frame)) : out;
}

/** Findings that involve any of `ids` (for a patch's warnings). */
export const involving = (findings, ids) => findings.filter((f) => f.ids.some((id) => ids.has(id)));
