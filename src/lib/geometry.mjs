// Element geometry shared by change reports, lint, layout, decks and
// libraries. Pure: no Node built-ins (the canvas page loads it too, through
// layout.mjs).

/** Axis-aligned bounds in scene coordinates. Linear and freedraw elements use their points. Rotation is ignored. */
export function bounds(e) {
  if (Array.isArray(e.points) && e.points.length) {
    const xs = e.points.map((p) => p[0]);
    const ys = e.points.map((p) => p[1]);
    return { x1: e.x + Math.min(...xs), y1: e.y + Math.min(...ys), x2: e.x + Math.max(...xs), y2: e.y + Math.max(...ys) };
  }
  return { x1: e.x, y1: e.y, x2: e.x + (e.width ?? 0), y2: e.y + (e.height ?? 0) };
}

const MIN_THICKNESS = 10; // a straight stroke still covers something
function thicken(b) {
  const out = { ...b };
  for (const [lo, hi] of [["x1", "x2"], ["y1", "y2"]]) {
    const d = out[hi] - out[lo];
    if (d < MIN_THICKNESS) {
      out[lo] -= (MIN_THICKNESS - d) / 2;
      out[hi] += (MIN_THICKNESS - d) / 2;
    }
  }
  return out;
}
export const area = (b) => Math.max(0, b.x2 - b.x1) * Math.max(0, b.y2 - b.y1);
export const contains = (b, [x, y]) => x >= b.x1 && x <= b.x2 && y >= b.y1 && y <= b.y2;

/** Fraction of the target box that lies inside the ellipse inscribed in `eb`, by grid sampling. */
function insideEllipse(eb, tb, n = 16) {
  const cx = (eb.x1 + eb.x2) / 2, cy = (eb.y1 + eb.y2) / 2;
  const rx = (eb.x2 - eb.x1) / 2, ry = (eb.y2 - eb.y1) / 2;
  if (rx <= 0 || ry <= 0) return 0;
  let hit = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const x = tb.x1 + ((i + 0.5) / n) * (tb.x2 - tb.x1);
      const y = tb.y1 + ((j + 0.5) / n) * (tb.y2 - tb.y1);
      if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1) hit++;
    }
  }
  return hit / (n * n);
}

/**
 * How much do annotation `a` and target `t` overlap, measured against the
 * smaller of the two areas (0..1). Ellipses use their actual shape.
 */
export function overlapScore(a, t) {
  const A = thicken(bounds(a));
  const T = bounds(t);
  if (a.type === "ellipse") {
    const shared = insideEllipse(A, T) * area(T);
    const ellipseArea = (Math.PI / 4) * area(A);
    return shared / Math.max(1, Math.min(ellipseArea, area(T)));
  }
  const w = Math.min(A.x2, T.x2) - Math.max(A.x1, T.x1);
  const h = Math.min(A.y2, T.y2) - Math.max(A.y1, T.y1);
  if (w <= 0 || h <= 0) return 0;
  return (w * h) / Math.max(1, Math.min(area(A), area(T)));
}

/** The box around some elements plus `margin` on every side, or null if none of `ids` is a live element. Bound labels count with their container. */
export function boxAround(elements, ids, margin = 40) {
  const want = new Set(ids);
  const picked = elements.filter((e) => !e.isDeleted && (want.has(e.id) || want.has(e.containerId)));
  if (!picked.length) return null;
  const bs = picked.map(bounds);
  return {
    x1: Math.min(...bs.map((b) => b.x1)) - margin, y1: Math.min(...bs.map((b) => b.y1)) - margin,
    x2: Math.max(...bs.map((b) => b.x2)) + margin, y2: Math.max(...bs.map((b) => b.y2)) + margin,
  };
}

/** Does element `e` overlap box `b`? */
export const overlapsBox = (e, b) => {
  const r = bounds(e);
  return r.x1 < b.x2 && r.x2 > b.x1 && r.y1 < b.y2 && r.y2 > b.y1;
};

// What a vision model sees at most: larger images are scaled down before it reads them.
export const SHOT_CAP = { longEdge: 1568, pixels: 1150000 };

/** The largest scale ≤ `scale` at which a `width`×`height` area (in scene units) fits within `cap`. */
export function capScale(width, height, scale, cap = SHOT_CAP) {
  if (!(width > 0 && height > 0)) return scale;
  return Math.min(scale, cap.longEdge / Math.max(width, height), Math.sqrt(cap.pixels / (width * height)));
}

/**
 * A crop that would cover most of a frame isn't worth cropping: if every one of
 * `ids` is in the same frame and `box` covers at least `share` of it, return that
 * frame (a frame among `ids` counts as its own); else null.
 */
export function frameToWiden(elements, ids, box, share = 0.5) {
  const want = new Set(ids);
  const byId = new Map(elements.filter((e) => !e.isDeleted).map((e) => [e.id, e]));
  const frames = new Set([...want].map((id) => byId.get(id)).filter(Boolean).map((e) => (e.type === "frame" ? e.id : e.frameId ?? null)));
  if (frames.size !== 1) return null;
  const frame = byId.get([...frames][0]);
  if (!frame || frame.type !== "frame") return null;
  const f = bounds(frame);
  const shared = area({ x1: Math.max(f.x1, box.x1), y1: Math.max(f.y1, box.y1), x2: Math.min(f.x2, box.x2), y2: Math.min(f.y2, box.y2) });
  return shared >= share * area(f) ? frame : null;
}
