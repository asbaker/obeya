// Fonts by name. An .excalidraw file stores a number per text (`fontFamily`);
// agents and styles use names, and this table maps them. Excalidraw's own
// fonts keep their numbers; the fonts obeya ships (src/page/fonts, OFL-1.1)
// get numbers from 200, clear of Excalidraw's (1–10, its CJK fallback at 100,
// and its generic fallbacks at 998–1000). Names are plain words: Excalidraw
// writes them into CSS unquoted, so "Source Serif 4" would break the editor.
// Pure: also loaded by the canvas page.

/** Excalidraw's fonts that can be picked, by name. Helvetica and Cascadia are un-hidden by obeya. */
export const EXCALIDRAW_FONTS = { Excalifont: 5, Nunito: 6, "Lilita One": 7, "Comic Shanns": 8, Helvetica: 2, Cascadia: 3, Virgil: 1 };

/** Excalidraw hides these as "old"; obeya shows them in the font menu. */
export const UNHIDDEN = ["Helvetica", "Cascadia"];

/**
 * The fonts obeya ships: `file` is src/page/fonts/<file>.woff2 (Latin), `metrics`
 * from the file's head and hhea tables (`node test/helpers/woff2.mjs <file>`).
 */
export const ADDED_FONTS = [
  { name: "Inter", id: 200, file: "inter", metrics: { unitsPerEm: 2048, ascender: 1984, descender: -494, lineHeight: 1.21 } },
  { name: "Inter Bold", id: 201, file: "inter-bold", metrics: { unitsPerEm: 2048, ascender: 1984, descender: -494, lineHeight: 1.21 } },
  { name: "Source Serif", id: 202, file: "source-serif", metrics: { unitsPerEm: 1000, ascender: 1036, descender: -335, lineHeight: 1.37 } },
  { name: "Barlow Condensed", id: 203, file: "barlow-condensed", metrics: { unitsPerEm: 1000, ascender: 1000, descender: -200, lineHeight: 1.2 } },
  { name: "Caveat", id: 204, file: "caveat", metrics: { unitsPerEm: 1000, ascender: 960, descender: -300, lineHeight: 1.26 } },
];

/** Every font a patch can name, name → number. */
export const FONT_IDS = { ...EXCALIDRAW_FONTS, ...Object.fromEntries(ADDED_FONTS.map((f) => [f.name, f.id])) };
const BY_LOWER = new Map(Object.entries(FONT_IDS).map(([n, id]) => [n.toLowerCase(), id]));

/** A font's number from its name (any case) or number; undefined if unknown. */
export function fontId(v) {
  if (typeof v === "number") return v;
  if (typeof v === "string") return BY_LOWER.get(v.trim().toLowerCase());
  return undefined;
}

/**
 * Turn font names in a patch into numbers, in place: skeleton elements and
 * their labels, element edits, and defaults. Returns a problem, or null.
 */
export function resolveFonts(patch) {
  const holders = [];
  for (const e of patch.skeleton ?? []) {
    holders.push(e);
    if (e?.label && typeof e.label === "object") holders.push(e.label);
  }
  holders.push(...(patch.elements ?? []));
  if (patch.defaults && typeof patch.defaults === "object") holders.push(...Object.values(patch.defaults));
  for (const h of holders) {
    if (!h || typeof h !== "object" || h.fontFamily === undefined || typeof h.fontFamily === "number") continue;
    const id = fontId(h.fontFamily);
    if (id === undefined) return `unknown font ${JSON.stringify(h.fontFamily)}; fonts: ${Object.keys(FONT_IDS).filter((n) => n !== "Virgil").join(", ")}`;
    h.fontFamily = id;
  }
  return null;
}
