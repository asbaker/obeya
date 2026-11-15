// Stages: `--style sketch|clean|hifi` names where the work is (sketch diverges,
// clean converges, hifi synthesizes). Each stage's medium is a set of patch
// defaults read from the package (src/styles/<stage>.json): strokes and fonts,
// never colours, which stay the agent's call. Hifi has no medium: a clean
// slate. A medium fills in under the patch's own `defaults` and the element's
// fields, and applies to new elements only. Node built-ins only.
import fs from "node:fs";
import { applyDefaults } from "./defaults.mjs";
import { resolveFonts } from "./fonts.mjs";

export const STAGES = ["sketch", "clean", "hifi"];
const DIR = new URL("../styles/", import.meta.url);
const cache = new Map();

export class StageError extends Error {
  constructor(message) {
    super(message);
    this.code = "unknown_style";
  }
}

/** The stage's medium as patch defaults (fonts as numbers), or null for hifi. */
export function stageDefaults(name) {
  if (!STAGES.includes(name)) throw new StageError(`unknown style ${JSON.stringify(name)}; styles: ${STAGES.join(", ")}`);
  if (name === "hifi") return null;
  if (!cache.has(name)) {
    const d = JSON.parse(fs.readFileSync(new URL(`${name}.json`, DIR), "utf8"));
    resolveFonts({ defaults: d });
    cache.set(name, d);
  }
  return structuredClone(cache.get(name));
}

/**
 * Apply a stage's medium to a patch, in place, after the patch's own defaults.
 * Skeleton elements the page doesn't have get what they left unset. New raw
 * elements (library inserts) keep their colours and fills but take the font,
 * roughness and stroke width, so a library item matches the stage.
 */
export function applyStage(patch, name, existing = new Set()) {
  const d = stageDefaults(name);
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
