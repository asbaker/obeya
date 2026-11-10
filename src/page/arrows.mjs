// Arrow bindings the pinned Excalidraw's converter can't make: to
// sticky notes, to elements already on the page, and (with layout) all of
// them. Pure: no DOM, no editor, so Node tests import it too.

// With `all` (a patch with layout), every bound end is deferred: the converter
// only binds an end the arrow's own coordinates already reach, and layout moves
// shapes after the caller wrote those coordinates.
export function splitArrowBindings(skeleton, sceneById, { all = false } = {}) {
  const inSkeleton = new Map(skeleton.filter((s) => s?.id).map((s) => [s.id, s]));
  const deferred = [];
  const out = skeleton.map((s) => {
    if (s?.type !== "arrow") return s;
    const d = { id: s.id };
    for (const end of ["start", "end"]) {
      const id = s[end]?.id;
      if (!id) continue;
      const target = inSkeleton.get(id);
      if (target && target.type !== "stickynote" && !all) continue; // the converter handles these
      d[end] = id;
    }
    if (!d.start && !d.end) return s;
    if (!s.id) throw new Error("an arrow bound to a sticky note or an existing element needs an id");
    deferred.push(d);
    const copy = { ...s };
    if (d.start) delete copy.start;
    if (d.end) delete copy.end;
    return copy;
  });
  return { skeleton: out, deferred };
}

// Bind an arrow's ends to elements: a straight line between the two boxes'
// edges, aimed centre to centre, with the binding format this build uses.
export function bindArrow(els, { id, start, end }, nonce) {
  const arrow = els.get(id);
  if (!arrow) return;
  const GAP = 6;
  const s = start && els.get(start), e = end && els.get(end);
  const abs = (i) => [arrow.x + arrow.points[i][0], arrow.y + arrow.points[i][1]];
  const ctr = (el) => [el.x + el.width / 2, el.y + el.height / 2];
  let p0 = abs(0), p1 = abs(arrow.points.length - 1);
  const aimS = s ? ctr(s) : p0, aimE = e ? ctr(e) : p1;
  // Where the ray from the box centre toward `to` leaves the box, plus a gap.
  const edge = (el, to) => {
    const [cx, cy] = ctr(el);
    const dx = to[0] - cx, dy = to[1] - cy;
    const len = Math.hypot(dx, dy) || 1;
    const t = Math.min(dx ? el.width / 2 / Math.abs(dx) : Infinity, dy ? el.height / 2 / Math.abs(dy) : Infinity);
    return [cx + dx * t + (dx / len) * GAP, cy + dy * t + (dy / len) * GAP];
  };
  if (s) p0 = edge(s, aimE);
  if (e) p1 = edge(e, aimS);
  const binding = (el, p) => ({ elementId: el.id, mode: "orbit", fixedPoint: [(p[0] - el.x) / el.width, (p[1] - el.y) / el.height] });
  els.set(id, {
    ...arrow,
    x: p0[0],
    y: p0[1],
    points: [[0, 0], [p1[0] - p0[0], p1[1] - p0[1]]],
    width: Math.abs(p1[0] - p0[0]),
    height: Math.abs(p1[1] - p0[1]),
    startBinding: s ? binding(s, p0) : arrow.startBinding ?? null,
    endBinding: e ? binding(e, p1) : arrow.endBinding ?? null,
  });
  for (const t of [s, e]) {
    if (!t) continue;
    const cur = els.get(t.id);
    const bound = (cur.boundElements || []).filter((b) => b.id !== id);
    els.set(t.id, { ...cur, boundElements: [...bound, { id, type: "arrow" }], version: cur.version + 1, versionNonce: nonce() });
  }
}
