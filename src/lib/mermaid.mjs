// Mermaid → canvas: turning the converter's output (Excalidraw skeletons, made
// in the tab by @excalidraw/mermaid-to-excalidraw) into a patch. Pure.
//
// A diagram is everything whose id starts with "<prefix>-": node and edge ids
// come from the mermaid (A → <prefix>-A, A --> B → <prefix>-A_B), the rest are
// numbered (<prefix>-m1, …). Running it again replaces the diagram: the .mmd is
// the source of truth. It stays where it was unless told otherwise.

export const MERMAID_PREFIX = /^[a-z0-9][a-z0-9._-]{0,47}$/i;

/** The live elements of an earlier run with this prefix (labels come with their shapes). */
export const diagramElements = (elements, prefix) =>
  elements.filter((e) => !e.isDeleted && e.id.startsWith(`${prefix}-`));

/** Top-left and bottom-right of elements, counting arrow and line points. */
export function extent(elements) {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const e of elements) {
    const pts = Array.isArray(e.points) && e.points.length ? e.points : [[0, 0], [e.width ?? 0, e.height ?? 0]];
    for (const [px, py] of pts) {
      x1 = Math.min(x1, e.x + px); y1 = Math.min(y1, e.y + py);
      x2 = Math.max(x2, e.x + px); y2 = Math.max(y2, e.y + py);
    }
  }
  return Number.isFinite(x1) ? { x1, y1, x2, y2 } : null;
}

/**
 * Where a diagram goes when --at doesn't say: where the earlier run was, else
 * inside --frame, else below everything on the page, else the origin.
 * @param {any[]} pageElements  the page's elements
 * @param {{prefix: string, frame?: string|null}} opts
 * @returns {{at: [number, number], frame: string|null}}
 */
export function placement(pageElements, { prefix, frame = null }) {
  const live = pageElements.filter((e) => !e.isDeleted);
  const before = diagramElements(live, prefix);
  if (before.length) {
    const b = extent(before);
    return { at: [b.x1, b.y1], frame: frame ?? before.find((e) => e.frameId)?.frameId ?? null };
  }
  if (frame) {
    const f = live.find((e) => e.id === frame);
    return { at: [f.x + 40, f.y + 80], frame };
  }
  const all = extent(live.filter((e) => !(e.type === "text" && e.containerId)));
  return { at: all ? [Math.round(all.x1), Math.round(all.y2 + 100)] : [0, 0], frame: null };
}

/**
 * The converter's skeleton as a patch: ids prefixed (and every reference to
 * them), unnamed elements numbered, one group for the whole diagram (the
 * converter's own groups inside it), moved so its top-left is at `at`, and in
 * `frame` when given.
 * @param {{elements: any[], files?: Record<string, any>}} converted
 * @param {{prefix: string, at: [number, number], frame?: string|null}} opts
 * @returns {{skeleton: any[], files: Record<string, any>, image: boolean}}
 */
export function mermaidPatch(converted, { prefix, at, frame = null }) {
  const els = converted.elements ?? [];
  let n = 0;
  const ids = new Map(els.filter((e) => e.id).map((e) => [e.id, `${prefix}-${e.id}`]));
  const ref = (id) => ids.get(id) ?? `${prefix}-${id}`;
  const box = extent(els) ?? { x1: 0, y1: 0 };
  const dx = at[0] - box.x1, dy = at[1] - box.y1;
  const skeleton = els.map((e) => {
    const groupIds = [...(e.groupIds ?? []).map((g) => `${prefix}-${g}`), prefix];
    const out = { ...e, id: e.id ? ref(e.id) : `${prefix}-m${++n}`, x: round(e.x + dx), y: round(e.y + dy), groupIds };
    if (e.start?.id) out.start = { ...e.start, id: ref(e.start.id) };
    if (e.end?.id) out.end = { ...e.end, id: ref(e.end.id) };
    if (e.label) out.label = { ...e.label, groupIds };
    if (frame) out.frameId = frame;
    return out;
  });
  return { skeleton, files: converted.files ?? {}, image: els.length === 1 && els[0].type === "image" };
}

const round = (v) => Math.round(v * 100) / 100;
