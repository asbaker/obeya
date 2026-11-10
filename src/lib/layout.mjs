// Layout directives in a patch: align, distribute, grid, place,
// stack. Pure geometry, no Node built-ins: the canvas page imports this file
// (served at /lib/layout.mjs) and runs it on the scene with the patch's new
// elements at their real, editor-measured sizes; the tests import it directly.
//
// A directive moves whole things: an element's outermost group (a card and the
// dots grouped on it), a frame with its children, arrows bound at both ends to
// things that move. Bound labels move with their shape (the page does that).

import { bounds } from "./geometry.mjs";

export class LayoutError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export const DIRECTIVES = ["align", "distribute", "grid", "place", "stack"];
const ALIGN = ["left", "right", "top", "bottom", "centre-x", "centre-y"];
const FRAMES = new Set(["frame", "magicframe"]);
const DEFAULT_GAP = 20;

const bad = (msg) => new LayoutError("invalid_patch", `layout: ${msg}`);
const num = (v) => typeof v === "number" && Number.isFinite(v);

/** Check the shape of `layout` without a scene (the server does this before a patch goes to the browser). */
export function validateLayout(layout) {
  if (!Array.isArray(layout)) throw bad("`layout` must be a list of directives");
  layout.forEach((d, i) => {
    const at = `directive ${i + 1}`;
    if (!d || typeof d !== "object" || Array.isArray(d)) throw bad(`${at} must be an object`);
    const kinds = DIRECTIVES.filter((k) => k in d);
    if (kinds.length !== 1) throw bad(`${at} needs exactly one of ${DIRECTIVES.join(", ")}`);
    const kind = kinds[0];
    const ids = (v, min) => {
      if (!Array.isArray(v) || v.length < min || v.some((x) => typeof x !== "string" || !x)) throw bad(`${at} (${kind}) needs \`ids\`: a list of at least ${min} id(s)`);
    };
    const gap = (v) => {
      if (v !== undefined && !(num(v) && v >= 0) && !(Array.isArray(v) && v.length === 2 && v.every((x) => num(x) && x >= 0))) throw bad(`${at} (${kind}): \`gap\` must be a number ≥ 0${kind === "grid" ? " or [x, y]" : ""}`);
    };
    const allowed = { align: ["align", "ids", "to"], distribute: ["distribute", "ids", "gap"], grid: ["grid", "columns", "gap", "at"], place: ["place", "in", "gap", "padding", "end"], stack: ["stack", "ids", "ref"] }[kind];
    const extra = Object.keys(d).filter((k) => !allowed.includes(k));
    if (extra.length) throw bad(`${at} (${kind}): unknown key(s) ${extra.join(", ")}; allowed: ${allowed.join(", ")}`);
    if (kind === "align") {
      if (!ALIGN.includes(d.align === "center-x" ? "centre-x" : d.align === "center-y" ? "centre-y" : d.align)) throw bad(`${at}: align must be one of ${ALIGN.join(", ")}`);
      ids(d.ids, d.to ? 1 : 2);
      if (d.to !== undefined && typeof d.to !== "string") throw bad(`${at}: \`to\` must be an id`);
    } else if (kind === "distribute") {
      if (!["horizontal", "vertical"].includes(d.distribute)) throw bad(`${at}: distribute must be "horizontal" or "vertical"`);
      ids(d.ids, d.gap === undefined ? 3 : 2);
      gap(d.gap);
      if (Array.isArray(d.gap)) throw bad(`${at} (distribute): \`gap\` must be a number`);
    } else if (kind === "grid") {
      ids(d.grid, 1);
      if (!Number.isInteger(d.columns) || d.columns < 1) throw bad(`${at} (grid) needs \`columns\`: a whole number ≥ 1`);
      gap(d.gap);
      if (d.at !== undefined && !(Array.isArray(d.at) && d.at.length === 2 && d.at.every(num))) throw bad(`${at} (grid): \`at\` must be [x, y]`);
    } else if (kind === "place") {
      if (typeof d.place !== "string" || !d.place) throw bad(`${at}: place must be an id`);
      if (typeof d.in !== "string" || !d.in) throw bad(`${at} (place) needs \`in\`: the id of a frame or shape to place it in`);
      gap(d.gap);
      if (Array.isArray(d.gap)) throw bad(`${at} (place): \`gap\` must be a number`);
      if (d.padding !== undefined && !(num(d.padding) && d.padding >= 0)) throw bad(`${at} (place): \`padding\` must be a number ≥ 0`);
      if (d.end !== undefined && typeof d.end !== "boolean") throw bad(`${at} (place): \`end\` must be true or false`);
    } else if (kind === "stack") {
      if (!["above", "below"].includes(d.stack)) throw bad(`${at}: stack must be "above" or "below"`);
      ids(d.ids, 1);
      if (typeof d.ref !== "string" || !d.ref) throw bad(`${at} (stack) needs \`ref\`: the id to go above or below`);
      if (d.ids.includes(d.ref)) throw bad(`${at} (stack): \`ref\` can't be one of \`ids\``);
    }
  });
}

const union = (bs) => ({ x1: Math.min(...bs.map((b) => b.x1)), y1: Math.min(...bs.map((b) => b.y1)), x2: Math.max(...bs.map((b) => b.x2)), y2: Math.max(...bs.map((b) => b.y2)) });
const hits = (a, b) => a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2;
const within = (a, b) => a.x1 >= b.x1 && a.y1 >= b.y1 && a.x2 <= b.x2 && a.y2 <= b.y2;

/**
 * @param {object[]} layout     validated directives, applied in order
 * @param {object[]} elements   the scene as the patch leaves it, in stacking order (new elements at their real sizes)
 * @returns {{moves: Map<string, {dx: number, dy: number}>, front: string[], stacks: {ids: string[], where: "above"|"below", ref: string}[], frameOf: Map<string, string>}}
 */
export function computeLayout(layout, elements) {
  validateLayout(layout);
  const live = elements.filter((e) => !e.isDeleted);
  const byId = new Map(live.map((e) => [e.id, e]));
  const isLabel = (e) => e.type === "text" && e.containerId;
  const delta = new Map(); // id -> {dx, dy}
  const need = (id) => {
    const e = byId.get(id);
    if (!e) throw new LayoutError("unknown_element", `layout: no element "${id}"`);
    if (isLabel(e)) throw new LayoutError("invalid_patch", `layout: "${id}" is a label; lay out its shape [${e.containerId}] instead`);
    return e;
  };
  const box = (e) => {
    const b = bounds(e), d = delta.get(e.id);
    return d ? { x1: b.x1 + d.dx, y1: b.y1 + d.dy, x2: b.x2 + d.dx, y2: b.y2 + d.dy } : b;
  };
  // What moves together with `id`.
  const unitOf = (id) => {
    const e = need(id);
    const group = e.groupIds?.length ? e.groupIds.at(-1) : null;
    const members = new Set(group ? live.filter((x) => x.groupIds?.includes(group) && !isLabel(x)).map((x) => x.id) : [id]);
    for (const m of [...members]) {
      if (FRAMES.has(byId.get(m).type)) for (const c of live) if (c.frameId === m && !isLabel(c)) members.add(c.id);
    }
    for (const a of live) {
      const s = a.startBinding?.elementId, t = a.endBinding?.elementId;
      if (a.type === "arrow" && s && t && members.has(s) && members.has(t)) members.add(a.id);
    }
    return [...members];
  };
  const unitBox = (ids) => union(ids.map((m) => box(byId.get(m))));
  const shift = (ids, dx, dy) => {
    if (!dx && !dy) return;
    for (const m of ids) {
      const d = delta.get(m) ?? { dx: 0, dy: 0 };
      delta.set(m, { dx: d.dx + dx, dy: d.dy + dy });
    }
  };
  const front = [], stacks = [], frameOf = new Map();
  // Elements a later `place` will move aren't in anyone's way yet: they're
  // usually new, parked wherever the caller created them.
  const toPlace = layout.filter((d) => "place" in d).map((d) => d.place);

  for (const d of layout) {
    if ("align" in d) {
      const how = d.align === "center-x" ? "centre-x" : d.align === "center-y" ? "centre-y" : d.align;
      const units = d.ids.map(unitOf);
      const ref = d.to ? unitBox(unitOf(d.to)) : union(units.map(unitBox));
      for (const u of units) {
        const b = unitBox(u);
        const dx = how === "left" ? ref.x1 - b.x1 : how === "right" ? ref.x2 - b.x2 : how === "centre-x" ? (ref.x1 + ref.x2) / 2 - (b.x1 + b.x2) / 2 : 0;
        const dy = how === "top" ? ref.y1 - b.y1 : how === "bottom" ? ref.y2 - b.y2 : how === "centre-y" ? (ref.y1 + ref.y2) / 2 - (b.y1 + b.y2) / 2 : 0;
        shift(u, dx, dy);
      }
    } else if ("distribute" in d) {
      const h = d.distribute === "horizontal";
      const lo = h ? "x1" : "y1", hi = h ? "x2" : "y2";
      const units = d.ids.map(unitOf).map((u) => ({ u, b: unitBox(u) })).sort((p, q) => p.b[lo] - q.b[lo]);
      const size = (b) => b[hi] - b[lo];
      const gap = d.gap ?? (units.at(-1).b[hi] - units[0].b[lo] - units.reduce((n, x) => n + size(x.b), 0)) / (units.length - 1);
      let next = units[0].b[hi] + gap;
      for (const x of units.slice(1)) {
        const move = next - x.b[lo];
        shift(x.u, h ? move : 0, h ? 0 : move);
        next += size(x.b) + gap;
      }
    } else if ("grid" in d) {
      const [gx, gy] = Array.isArray(d.gap) ? d.gap : [d.gap ?? DEFAULT_GAP, d.gap ?? DEFAULT_GAP];
      const units = d.grid.map(unitOf).map((u) => ({ u, b: unitBox(u) }));
      const cols = d.columns, rows = Math.ceil(units.length / cols);
      const colW = Array.from({ length: cols }, (_, c) => Math.max(0, ...units.filter((_, i) => i % cols === c).map((x) => x.b.x2 - x.b.x1)));
      const rowH = Array.from({ length: rows }, (_, r) => Math.max(0, ...units.filter((_, i) => Math.floor(i / cols) === r).map((x) => x.b.y2 - x.b.y1)));
      const [ox, oy] = d.at ?? [Math.min(...units.map((x) => x.b.x1)), Math.min(...units.map((x) => x.b.y1))];
      units.forEach((x, i) => {
        const c = i % cols, r = Math.floor(i / cols);
        const left = ox + colW.slice(0, c).reduce((n, v) => n + v + gx, 0);
        const top = oy + rowH.slice(0, r).reduce((n, v) => n + v + gy, 0);
        shift(x.u, left - x.b.x1, top - x.b.y1);
      });
    } else if ("place" in d) {
      toPlace.splice(toPlace.indexOf(d.place), 1);
      const waiting = new Set(toPlace.filter((id) => byId.has(id)).flatMap(unitOf));
      const u = unitOf(d.place);
      const areaEl = need(d.in);
      if (u.includes(areaEl.id)) throw new LayoutError("invalid_patch", `layout: can't place "${d.place}" in itself`);
      const area = box(areaEl);
      const gap = d.gap ?? DEFAULT_GAP, pad = d.padding ?? gap;
      const b = unitBox(u), w = b.x2 - b.x1, h = b.y2 - b.y1;
      const mine = new Set(u);
      // In the way: what lies in the area, apart from the area itself and
      // things that hold the area (a frame or board it sits on).
      const obstacles = live
        .filter((e) => !mine.has(e.id) && !waiting.has(e.id) && e.id !== areaEl.id && !isLabel(e) && !(e.containerId && mine.has(e.containerId)))
        .map((e) => ({ e, b: box(e) }))
        .filter(({ b: o }) => hits(o, area) && !within(area, o));
      const inner = { x1: area.x1 + pad, y1: area.y1 + pad, x2: area.x2 - pad, y2: area.y2 - pad };
      // Line up with things of the same kind already there (a column of cards).
      const kin = obstacles.filter(({ e }) => e.type === byId.get(d.place).type);
      const xs = [...new Set([...kin.map((o) => o.b.x1), inner.x1, ...obstacles.map((o) => o.b.x2 + gap)])];
      const xRank = (x) => (kin.some((o) => o.b.x1 === x) ? 0 : 1);
      const ys = d.end
        ? [Math.max(inner.y1, ...obstacles.map((o) => o.b.y2 + gap))]
        : [...new Set([inner.y1, ...obstacles.map((o) => o.b.y2 + gap)])].sort((p, q) => p - q);
      let spot = null;
      for (const y of ys) {
        const fits = xs
          .filter((x) => x >= inner.x1 - 0.01 && x + w <= inner.x2 + 0.01 && y + h <= inner.y2 + 0.01)
          .filter((x) => !obstacles.some((o) => hits({ x1: x - gap + 0.01, y1: y - gap + 0.01, x2: x + w + gap - 0.01, y2: y + h + gap - 0.01 }, o.b)))
          .sort((p, q) => xRank(p) - xRank(q) || p - q);
        if (fits.length) {
          spot = [fits[0], y];
          break;
        }
      }
      if (!spot) throw new LayoutError("no_room", `layout: no free ${Math.round(w)}×${Math.round(h)} spot in "${d.in}" for "${d.place}"${d.end ? " below what's there" : ""}; make the area bigger, or move something out`);
      shift(u, spot[0] - b.x1, spot[1] - b.y1);
      front.push(...u);
      if (FRAMES.has(areaEl.type)) for (const m of u) if (!byId.get(m).frameId) frameOf.set(m, areaEl.id);
    } else if ("stack" in d) {
      need(d.ref);
      const ids = [...new Set(d.ids.flatMap(unitOf))];
      if (ids.includes(d.ref)) throw new LayoutError("invalid_patch", `layout: "${d.ref}" moves with ${d.ids.join(", ")} (same group); stack relative to something else`);
      stacks.push({ ids, where: d.stack, ref: d.ref });
    }
  }
  const moves = new Map([...delta].filter(([, v]) => Math.abs(v.dx) > 1e-9 || Math.abs(v.dy) > 1e-9));
  return { moves, front, stacks, frameOf };
}
