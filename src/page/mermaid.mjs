// Mermaid → skeletons, for `obeya mermaid`: the converter Excalidraw's own
// Mermaid dialog uses (the version the pinned build loads), run in this tab
// because it lays out with an SVG renderer and measures text. Loaded on first
// use. The mermaid text stays on this machine; only library code comes from esm.sh.
import { answer, fail } from "./server-link.mjs";

const CONVERTER = "https://esm.sh/@excalidraw/mermaid-to-excalidraw@3.6.0";

export async function handleMermaid({ reqId, text }) {
  let converted;
  try {
    const { parseMermaidToExcalidraw } = await import(CONVERTER);
    // Elbow arrows in flowcharts, as Excalidraw's dialog draws them.
    converted = await parseMermaidToExcalidraw(text, { elbow: { flowchart: true } });
  } catch (err) {
    return fail(reqId, "invalid_mermaid", String(err?.message || err).split("\n").slice(0, 3).join(" ").slice(0, 300));
  }
  answer(reqId, { elements: converted.elements ?? [], files: converted.files ?? {} });
}
