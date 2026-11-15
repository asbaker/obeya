// A new shape that fills its frame is the frame's background: lock it, so the
// person doesn't drag it by accident when they grab something on top. Only for
// new skeleton shapes that don't say `locked` themselves. Pure.
const SHAPES = new Set(["rectangle", "ellipse", "diamond"]);
const TOL = 2;

/** Set `locked: true` on new skeleton shapes covering their frame. `frames` maps id → {x, y, width, height}. */
export function lockBackdrops(skeleton = [], frames, existing = new Set()) {
  const own = new Map(skeleton.filter((e) => e?.type === "frame" && e.id).map((f) => [f.id, f]));
  for (const e of skeleton) {
    if (!e || !SHAPES.has(e.type) || "locked" in e || existing.has(e.id) || !e.frameId) continue;
    const f = own.get(e.frameId) ?? frames.get(e.frameId);
    if (!f || ![e.x, e.y, e.width, e.height, f.x, f.y, f.width, f.height].every((v) => typeof v === "number")) continue;
    if (e.x <= f.x + TOL && e.y <= f.y + TOL && e.x + e.width >= f.x + f.width - TOL && e.y + e.height >= f.y + f.height - TOL) e.locked = true;
  }
  return skeleton;
}
