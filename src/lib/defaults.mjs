// A patch's `defaults`: the page's base style, written once instead of on every
// skeleton element. Keys are element types ("rectangle", "text", "arrow", …),
// "label" for labels, and "*" for every element. An element's own fields win,
// then its type's, then "*". Applied by the server before the patch reaches the
// editor, and only to elements the page doesn't have yet: re-applying a skeleton
// to reword a label keeps the element's style. Pure: no Node built-ins.

const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);

/** A problem with `defaults`, or null. */
export function defaultsProblem(defaults) {
  if (defaults === undefined) return null;
  if (!isObj(defaults)) return "`defaults` is an object of base styles by element type, e.g. {\"rectangle\": {\"fillStyle\": \"solid\"}, \"label\": {\"fontSize\": 16}}";
  for (const [k, v] of Object.entries(defaults)) {
    if (!isObj(v)) return `defaults.${k} must be an object of element fields`;
    for (const f of ["id", "type", "children", "start", "end", "src", "fileId"]) if (f in v) return `defaults.${k} can't set \`${f}\``;
  }
  return null;
}

/** The skeleton with defaults filled in, for elements not in `existing` (a Set of ids). */
export function applyDefaults(skeleton = [], defaults, existing = new Set()) {
  if (!defaults) return skeleton;
  const all = defaults["*"] ?? {}, label = defaults.label;
  return skeleton.map((sk) => {
    if (!isObj(sk) || existing.has(sk.id)) return sk;
    const out = { ...all, ...(defaults[sk.type] ?? {}), ...sk };
    if (label && isObj(sk.label)) out.label = { ...label, ...sk.label };
    return out;
  });
}
