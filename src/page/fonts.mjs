// The fonts obeya adds to the editor (see /lib/fonts.mjs): registered before
// Excalidraw mounts, so its font menu lists them, and loaded before any text is
// drawn, so text is measured in its own font rather than a fallback.
import { Fonts, FONT_FAMILY } from "./deps.mjs";
import { ADDED_FONTS, UNHIDDEN } from "/lib/fonts.mjs";

export function registerFonts() {
  for (const f of ADDED_FONTS) {
    FONT_FAMILY[f.name] = f.id;
    // An absolute URL: Excalidraw resolves relative ones against its CDN.
    Fonts.register(f.name, { metrics: f.metrics }, { uri: `${location.origin}/page/fonts/${f.file}.woff2` });
  }
  // Excalidraw hides these as "old"; they're the clean look's sans and the code font.
  for (const name of UNHIDDEN) {
    const font = Fonts.registered.get(FONT_FAMILY[name]);
    if (font) font.metadata = { ...font.metadata, deprecated: false };
  }
}

/** Load every face text may be drawn in; Excalidraw would load them only once used. */
export function loadFonts() {
  // Excalidraw adds a face to the document only when a scene uses it.
  for (const [, { fontFaces }] of Fonts.registered) {
    for (const { fontFace } of fontFaces) if (fontFace && !document.fonts.has(fontFace)) document.fonts.add(fontFace);
  }
  const names = [...ADDED_FONTS.map((f) => f.name), "Cascadia", "Excalifont", "Nunito", "Lilita One", "Comic Shanns"];
  // Unquoted, as Excalidraw writes them.
  return Promise.all(names.map((n) => document.fonts.load(`20px ${n}`).catch(() => [])));
}
