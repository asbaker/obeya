// Layout problems on a page, from the sizes the editor saved.
// Pure: no Node built-ins, no text measurement. Rotation is ignored.
import { bounds } from "./geometry.mjs";
import { labelsByContainer, ref } from "./report.mjs";

export const RULES = ["overlap", "clipped-text", "outside-frame", "loose-arrow", "near-miss", "hidden"];

const SHAPES = new Set(["rectangle", "diamond", "ellipse", "stickynote", "text", "image", "embeddable", "iframe"]);
const BINDABLE = new Set(["rectangle", "diamond", "ellipse", "stickynote", "text", "image", "embeddable", "iframe", "frame"]);
const FILLABLE = new Set(["rectangle", "diamond", "ellipse", "stickynote", "image"]);
const FRAMES = new Set(["frame", "magicframe"]);
const TOL = 1; // px: rounding in the editor
const LABEL_TOL = 2; // px: a label's position after its shape is resized
const NEAR_MISS_PX = 4; // edges this close but not equal look like a mistake
const LOOSE_PX = 12; // an unbound arrow end this close to a shape looks attached

const w = (b) => b.x2 - b.x1;
const h = (b) => b.y2 - b.y1;
const inside = (a, b, tol = TOL) => a.x1 >= b.x1 - tol && a.y1 >= b.y1 - tol && a.x2 <= b.x2 + tol && a.y2 <= b.y2 + tol;
const overlapBox = (a, b) => ({ x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1), x2: Math.min(a.x2, b.x2), y2: Math.min(a.y2, b.y2) });
const sharesGroup = (a, b) => (a.groupIds ?? []).some((g) => (b.groupIds ?? []).includes(g));
const filled = (e) => FILLABLE.has(e.type) && (e.type === "image" || (e.backgroundColor && e.backgroundColor !== "transparent")) && (e.opacity ?? 100) > 50;
const contains = (b, [x, y], pad = 0) => x >= b.x1 - pad && x <= b.x2 + pad && y >= b.y1 - pad && y <= b.y2 + pad;

/**
 * @param {any[]} elements  a page's elements in stacking order (bottom first)
 * @param {{frame?: string, rules?: string[]}} [opts]
 * @returns {{rule: string, ids: string[], frame: string|null, message: string}[]}
 */
export function lint(elements, { frame, rules = RULES } = {}) {
  const live = elements.filter((e) => !e.isDeleted);
  const byId = new Map(live.map((e) => [e.id, e]));
  const order = new Map(live.map((e, i) => [e.id, i]));
  const labels = labelsByContainer(live);
  const name = (e) => {
    const r = ref(e, labels);
    return r.text ? `${r.type} "${r.text.split("\n")[0].slice(0, 40)}" [${r.id}]` : `${r.type} [${r.id}]`;
  };
  const box = new Map(live.map((e) => [e.id, bounds(e)]));
  const out = [];
  const add = (rule, items, message) => {
    const f = items.find((e) => e.frameId)?.frameId ?? null;
    out.push({ rule, ids: items.map((e) => e.id), frame: f, message });
  };
  const on = new Set(rules);
  // Top-level things a person sees as one object: not labels, not frames.
  const objects = live.filter((e) => !(e.type === "text" && e.containerId) && !FRAMES.has(e.type));
  const shapes = objects.filter((e) => SHAPES.has(e.type));

  if (on.has("overlap")) {
    for (let i = 0; i < shapes.length; i++) {
      for (let j = i + 1; j < shapes.length; j++) {
        const a = shapes[i], b = shapes[j];
        if ((a.frameId ?? null) !== (b.frameId ?? null) || sharesGroup(a, b)) continue;
        const A = box.get(a.id), B = box.get(b.id);
        if (inside(A, B) || inside(B, A)) continue; // on top of, not overlapping
        const o = overlapBox(A, B);
        if (w(o) > TOL * 2 && h(o) > TOL * 2) add("overlap", [a, b], `${name(a)} and ${name(b)} overlap by ${Math.round(w(o))}×${Math.round(h(o))} px`);
      }
    }
  }

  if (on.has("clipped-text")) {
    for (const t of live) {
      if (t.type !== "text") continue;
      const T = box.get(t.id);
      const c = t.containerId && byId.get(t.containerId);
      if (c && c.type !== "arrow" && c.type !== "line" && !inside(T, box.get(c.id), LABEL_TOL)) add("clipped-text", [c, t], `the label of ${name(c)} is bigger than it (${Math.round(w(T))}×${Math.round(h(T))} in ${Math.round(c.width)}×${Math.round(c.height)})`);
      const f = !t.containerId && t.frameId && byId.get(t.frameId);
      if (f && !inside(T, box.get(f.id))) add("clipped-text", [t], `${name(t)} runs past the edge of frame ${name(f)}`);
    }
  }

  if (on.has("outside-frame")) {
    for (const e of objects) {
      if (e.type === "text" || !e.frameId) continue;
      const f = byId.get(e.frameId);
      if (f && !inside(box.get(e.id), box.get(f.id))) add("outside-frame", [e], `${name(e)} sticks out of frame ${name(f)}, which clips it`);
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
          if (!byId.has(binding.elementId)) add("loose-arrow", [a], `the ${which} of ${name(a)} is bound to [${binding.elementId}], which no longer exists`);
          continue;
        }
        // The smallest shape under the end: the one it looks attached to.
        const hit = targets
          .filter((t) => t.id !== a.id && contains(box.get(t.id), p, LOOSE_PX))
          .sort((x, y) => w(box.get(x.id)) * h(box.get(x.id)) - w(box.get(y.id)) * h(box.get(y.id)))[0];
        if (hit && inside(box.get(a.id), box.get(hit.id), 0)) continue; // drawn on the shape: decoration, not a connector
        if (hit && !FRAMES.has(hit.type)) add("loose-arrow", [a, hit], `the ${which} of ${name(a)} touches ${name(hit)} but isn't bound to it, so it won't follow when that moves`);
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
        if (report.length) add("near-miss", [a, b], `${name(a)} and ${name(b)} are nearly aligned (${report.map(([k, v]) => `${k} off by ${Math.round(v * 10) / 10} px`).join(", ")}); use an align layout`);
      }
    }
  }

  if (on.has("hidden")) {
    for (const e of objects) {
      const E = box.get(e.id);
      const cover = objects.find((s) => s !== e && filled(s) && order.get(s.id) > order.get(e.id) && !sharesGroup(s, e) && inside(E, box.get(s.id), 0));
      if (cover) add("hidden", [e, cover], `${name(e)} is under ${name(cover)}, which is filled and drawn above it; bring it to the front (toFront, or a stack layout)`);
    }
  }

  return frame ? out.filter((f) => f.frame === frame || f.ids.includes(frame)) : out;
}

/** Findings that involve any of `ids` (for a patch's warnings). */
export const involving = (findings, ids) => findings.filter((f) => f.ids.some((id) => ids.has(id)));
