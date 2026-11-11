// Turning raw elements and raw change-log entries into what an agent wants to
// read: compact elements, label folding, coalesced moves, and pointsAt.

import { area, bounds, contains, overlapScore } from "./geometry.mjs";

const round = Math.round;

/** Map container id -> its bound text's text, for live elements. */
export function labelsByContainer(elements) {
  const m = new Map();
  for (const e of elements) {
    if (!e.isDeleted && e.type === "text" && e.containerId) m.set(e.containerId, e.originalText ?? e.text);
  }
  return m;
}

const textFor = (e, labels) => (e.type === "text" ? e.originalText ?? e.text : labels.get(e.id)) || (e.type === "frame" ? e.name : undefined);

/** A short reference to an element: {id, type, text?}. */
export function ref(e, labels) {
  const r = { id: e.id, type: e.type };
  const t = textFor(e, labels);
  if (t) r.text = t.length > 80 ? t.slice(0, 79) + "…" : t;
  return r;
}

/** Compact view: one record per live element, bound text folded into its container. */
export function compact(elements) {
  const labels = labelsByContainer(elements);
  return elements
    .filter((e) => !e.isDeleted && !(e.type === "text" && e.containerId))
    .map((e) => {
      const r = { id: e.id, type: e.type, x: round(e.x), y: round(e.y), w: round(e.width), h: round(e.height) };
      const text = textFor(e, labels);
      if (text) r.text = text;
      if (e.name && e.type !== "frame") r.name = e.name;
      if (e.frameId) r.frame = e.frameId;
      if (e.groupIds?.length) r.groups = e.groupIds;
      if (e.link) r.link = e.link;
      if (e.customData) r.data = e.customData;
      if (e.backgroundColor && e.backgroundColor !== "transparent") r.bg = e.backgroundColor;
      if (e.startBinding || e.endBinding) r.binds = [e.startBinding?.elementId ?? null, e.endBinding?.elementId ?? null];
      return r;
    });
}

/** A plain-text outline of a page. */
export function outline(page, rev, elements) {
  const els = compact(elements);
  const frames = els.filter((e) => e.type === "frame");
  const lines = [`page ${page} · rev ${rev} · ${els.length} elements`];
  const line = (e) => {
    const parts = [`- ${e.type}`];
    if (e.text) parts.push(JSON.stringify(e.text.replace(/\s+/g, " ")));
    parts.push(`[${e.id}]`);
    if (e.data) parts.push(JSON.stringify(e.data));
    if (e.link) parts.push(`→ ${e.link}`);
    return parts.join(" ");
  };
  for (const f of [...frames, { id: null, text: "(outside frames)" }]) {
    const inside = els.filter((e) => e.type !== "frame" && (e.frame ?? null) === f.id);
    if (!inside.length && f.id === null) continue;
    lines.push("", `## ${f.text || "frame"}${f.id ? ` [${f.id}]` : ""}${f.link ? ` → ${f.link}` : ""}`);
    for (const e of inside) lines.push(line(e));
  }
  return lines.join("\n");
}

export const ANNOTATION_TYPES = new Set(["ellipse", "freedraw", "arrow", "rectangle", "stickynote", "text", "line"]);
const NEVER_TARGETS = new Set(["freedraw", "arrow", "line", "frame", "magicframe", "selection"]);
export const POINTS_AT_THRESHOLD = 0.3;
const MAX_TARGETS = 5;
// Annotations that can sit inside an area rather than point at it, and how much bigger the area must be.
const SITS_IN = new Set(["stickynote", "rectangle", "ellipse"]);
const AREA_RATIO = 10;

/**
 * Which elements does annotation `anno` cover or point to? Returns element ids,
 * best match first.
 * - arrows: their bindings (end first), or else the element under the tip,
 *   or else under the tail;
 * - everything else: overlap above the threshold.
 */
export function pointsAt(anno, elements) {
  const candidates = elements.filter(
    (e) => !e.isDeleted && e.id !== anno.id && !NEVER_TARGETS.has(e.type) && !(e.type === "text" && e.containerId),
  );
  // A note or shape dropped inside an area that holds other notes (a column, a
  // lane) sits there; it doesn't point at it. A dot on a card still points at the card.
  const A = bounds(anno);
  const inside = (B, a) => B.x1 <= a.x1 && B.y1 <= a.y1 && B.x2 >= a.x2 && B.y2 >= a.y2;
  const notes = candidates.filter((e) => e.type === "stickynote").map((e) => [e.id, bounds(e)]);
  const sitsIn = (e) => {
    if (!SITS_IN.has(anno.type)) return false;
    const B = bounds(e);
    return inside(B, A) && area(B) >= AREA_RATIO * area(A) && notes.some(([id, n]) => id !== e.id && inside(B, n));
  };
  if (anno.type === "arrow" || anno.type === "line") {
    const bound = [anno.endBinding?.elementId, anno.startBinding?.elementId].filter(Boolean);
    if (bound.length) return [...new Set(bound)];
    const pts = anno.points ?? [];
    if (pts.length < 2) return [];
    for (const p of [pts[pts.length - 1], pts[0]]) {
      const at = [anno.x + p[0], anno.y + p[1]];
      const under = candidates.filter((e) => contains(bounds(e), at)).sort((a, b) => area(bounds(a)) - area(bounds(b)));
      if (under.length) return [under[0].id];
    }
    return [];
  }
  return candidates
    .filter((e) => !sitsIn(e))
    .map((e) => [e.id, overlapScore(anno, e)])
    .filter(([, s]) => s > POINTS_AT_THRESHOLD)
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_TARGETS)
    .map(([id]) => id);
}

// ---------------------------------------------------------------------------
// Change folding

/**
 * Edits to bound text become `relabeled` on the container. Label moves that
 * only follow the container are dropped.
 */
export function foldLabels(entries, byId) {
  const out = [];
  for (const c of entries) {
    const containerId = c.containerId ?? byId.get(c.id)?.containerId;
    if (!containerId || byId.get(c.id)?.type === "frame") { out.push(c); continue; }
    const relabel = c.op === "added" || c.op === "deleted" || c.op === "restored" || c.fields?.includes("text");
    if (!relabel) continue;
    const owner = byId.get(containerId);
    const { containerId: _drop, moved: _m, frameChange: _f, ...rest } = c;
    out.push({ ...rest, id: containerId, type: owner?.type ?? "unknown", op: "relabeled", fields: ["text"] });
  }
  return out;
}

/**
 * Merge consecutive entries for the same element from the same source:
 * - added + later edits = added; added + deleted = nothing;
 * - edits + edits = one entry (fields joined, moves joined end to end; a move
 *   that ends where it started is dropped).
 * The merged entry keeps the latest rev and time.
 */
export function coalesce(entries) {
  const out = [];
  const lastIdx = new Map(); // id -> index in out of the latest entry for it
  const gone = new Set(); // "source:id" added and deleted again in this window
  const EDITS = new Set(["modified", "relabeled"]);
  for (const c of entries) {
    const i = lastIdx.get(c.id);
    const prev = i === undefined ? null : out[i];
    // A note added and deleted again is gone; its label's deletion is part of that.
    if (!prev && gone.has(`${c.source}:${c.id}`) && c.op === "relabeled") continue;
    if (prev && prev.source === c.source) {
      // A label deleted or restored with its container is part of that.
      if ((prev.op === "deleted" || prev.op === "restored") && c.op === "relabeled") continue;
      if (prev.op === "relabeled" && (c.op === "deleted" || c.op === "restored")) {
        out[i] = { ...c };
        continue;
      }
      if (prev.op === "added" && (EDITS.has(c.op))) {
        out[i] = { ...prev, rev: c.rev, at: c.at };
        continue;
      }
      if (prev.op === "added" && c.op === "deleted") {
        out[i] = null;
        lastIdx.delete(c.id);
        gone.add(`${c.source}:${c.id}`);
        continue;
      }
      if (EDITS.has(prev.op) && EDITS.has(c.op)) {
        const m = { ...prev, rev: c.rev, at: c.at, fields: [...new Set([...prev.fields, ...c.fields])] };
        if (prev.op === "relabeled" || c.op === "relabeled") m.op = prev.op === "relabeled" && c.op === "relabeled" ? "relabeled" : "modified";
        if (c.moved) m.moved = { from: prev.moved?.from ?? c.moved.from, to: c.moved.to };
        if (c.frameChange) m.frameChange = { from: prev.frameChange ? prev.frameChange.from : c.frameChange.from, to: c.frameChange.to };
        out[i] = m;
        continue;
      }
    }
    lastIdx.set(c.id, out.length);
    out.push({ ...c });
  }
  return out
    .filter(Boolean)
    .map((c) => {
      if (c.moved && c.moved.from[0] === c.moved.to[0] && c.moved.from[1] === c.moved.to[1]) {
        const { moved, ...rest } = c;
        rest.fields = rest.fields.filter((f) => f !== "x" && f !== "y");
        c = rest;
      }
      if (c.frameChange && c.frameChange.from === c.frameChange.to) {
        const { frameChange, ...rest } = c;
        rest.fields = rest.fields.filter((f) => f !== "frameId");
        c = rest;
      }
      return c;
    })
    .filter((c) => c.op !== "modified" || c.fields.length);
}

const GEOMETRY = new Set(["x", "y", "width", "height", "points"]);

/**
 * Drop arrow and line updates that only follow a bound element the same
 * source moved in this window (the editor re-routes bound arrows).
 */
export function dropFollowers(entries, byId, movedIn = entries) {
  // `movedIn` is the window before coalescing: a note dragged away and back has
  // no net move left, but its arrow's re-route still only followed it.
  const moved = new Set(movedIn.filter((c) => c.moved).map((c) => `${c.source}:${c.id}`));
  return entries.filter((c) => {
    const el = byId.get(c.id);
    if (c.op !== "modified" || !el || (el.type !== "arrow" && el.type !== "line")) return true;
    if (!c.fields.every((f) => GEOMETRY.has(f))) return true;
    const ends = [el.startBinding?.elementId, el.endBinding?.elementId].filter(Boolean);
    return !ends.some((id) => moved.has(`${c.source}:${id}`));
  });
}

/** Which side of a band a coordinate is on. */
export function side(band, v) {
  return v < band.from ? "before" : v > band.to ? "after" : "inside";
}

/** Bands a move crossed, judged by the element's centre: [{band, from, to}]. */
export function crossings(moved, el, bands) {
  if (!moved || !el || !bands?.length) return [];
  const half = { x: (el.width ?? 0) / 2, y: (el.height ?? 0) / 2 };
  const out = [];
  for (const b of bands) {
    const i = b.axis === "x" ? 0 : 1;
    const from = side(b, moved.from[i] + half[b.axis]);
    const to = side(b, moved.to[i] + half[b.axis]);
    if (from !== to) out.push({ band: b.name, from, to });
  }
  return out;
}

/**
 * Resolve raw log entries against the current elements (including deleted
 * ones, so deleted labels can still be folded).
 */
export function resolveChanges(entries, elements, bands = []) {
  const byId = new Map(elements.map((e) => [e.id, e]));
  const live = elements.filter((e) => !e.isDeleted);
  const labels = labelsByContainer(elements);
  const folded = foldLabels(entries, byId);
  return dropFollowers(coalesce(folded), byId, folded).map((c) => {
    const el = byId.get(c.id);
    const r = { ...c };
    delete r.containerId;
    if (el) {
      const t = textFor(el, labels);
      if (t) r.text = t;
      if (el.frameId) r.frame = el.frameId;
      if (el.isDeleted && c.op !== "deleted") r.deletedSince = true;
      const crossed = crossings(c.moved, el, bands);
      if (crossed.length) r.crossed = crossed;
    }
    if (el && !el.isDeleted && c.op === "added" && ANNOTATION_TYPES.has(el.type)) {
      const ids = pointsAt(el, live);
      if (ids.length) r.pointsAt = ids.map((id) => ref(byId.get(id), labels));
    }
    return r;
  });
}

const TEXT_MAX = 80;

/**
 * What an agent reads: no timestamps or revisions per entry, `source` only when
 * both are asked for, `fields` only for what `moved`, `frameChange` and `text`
 * don't already say, and text cut to 80 characters.
 */
export function brief(changes, { withSource = false } = {}) {
  return changes.map((c) => {
    const r = { op: c.op, id: c.id, type: c.type };
    if (withSource) r.source = c.source;
    if (c.text) r.text = c.text.length > TEXT_MAX ? c.text.slice(0, TEXT_MAX - 1) + "…" : c.text;
    if (c.op === "modified") {
      const said = new Set([...(c.moved ? ["x", "y"] : []), ...(c.frameChange ? ["frameId"] : [])]);
      const fields = (c.fields ?? []).filter((f) => !said.has(f));
      if (fields.length) r.fields = fields;
    }
    for (const k of ["frame", "moved", "frameChange", "crossed", "pointsAt", "deletedSince"]) if (c[k] !== undefined) r[k] = c[k];
    return r;
  });
}
