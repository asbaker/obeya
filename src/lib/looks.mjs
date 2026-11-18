// `--style sketch|clean|hifi`: a look's medium (strokes and fonts, never
// colours) from src/styles/<look>.json, filled in under the patch's own
// defaults, on new elements only. Hifi has none.
import fs from "node:fs";
import { applyDefaults } from "./defaults.mjs";
import { resolveFonts } from "./fonts.mjs";

export const LOOKS = ["sketch", "clean", "hifi"];
const DIR = new URL("../styles/", import.meta.url);
const cache = new Map();

export class LookError extends Error {
  constructor(message) {
    super(message);
    this.code = "unknown_style";
  }
}

/** The look's medium as patch defaults (fonts as numbers), or null for hifi. */
export function lookDefaults(name) {
  if (!LOOKS.includes(name)) throw new LookError(`unknown style ${JSON.stringify(name)}; styles: ${LOOKS.join(", ")}`);
  if (name === "hifi") return null;
  if (!cache.has(name)) {
    const d = JSON.parse(fs.readFileSync(new URL(`${name}.json`, DIR), "utf8"));
    resolveFonts({ defaults: d });
    cache.set(name, d);
  }
  return structuredClone(cache.get(name));
}

/**
 * Apply a look's medium to a patch, in place, after the patch's own defaults.
 * Skeleton elements the page doesn't have get what they left unset. New raw
 * elements (library inserts) keep their colours and fills but take the font,
 * roughness and stroke width, so a library item matches the look.
 */
export function applyLook(patch, name, existing = new Set()) {
  const d = lookDefaults(name);
  if (!d) return patch;
  if (patch.skeleton) patch.skeleton = applyDefaults(patch.skeleton, d, existing);
  for (const e of patch.elements ?? []) {
    if (!e || typeof e !== "object" || existing.has(e.id)) continue;
    if (e.type === "text") {
      const font = (e.containerId ? d.label?.fontFamily : undefined) ?? d.text?.fontFamily;
      if (font !== undefined) e.fontFamily = font;
    } else {
      for (const k of ["roughness", "strokeWidth"]) {
        const v = d[e.type]?.[k] ?? d["*"]?.[k];
        if (v !== undefined) e[k] = v;
      }
    }
  }
  return patch;
}
