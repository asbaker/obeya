import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ADDED_FONTS, EXCALIDRAW_FONTS, FONT_IDS, UNHIDDEN, fontId, resolveFonts } from "../src/lib/fonts.mjs";
import { woff2Metrics } from "./helpers/woff2.mjs";

const DIR = path.resolve("src/page/fonts");
// Each shipped file's licence (fontsource's copy of the OFL with the family's copyright).
const LICENCE = { inter: "inter", "inter-bold": "inter", "source-serif": "source-serif-4", "barlow-condensed": "barlow-condensed", caveat: "caveat" };

test("added fonts: ids clear of Excalidraw's, plain-word names, a file, its metrics and its licence", () => {
  const ids = Object.values(FONT_IDS);
  assert.equal(new Set(ids).size, ids.length, "every id once");
  for (const f of ADDED_FONTS) {
    // Excalidraw uses 1–10, 100 (Xiaolai, its CJK fallback) and 998–1000 (generic fallbacks).
    assert.ok(f.id >= 200 && f.id < 998, `${f.name}: id ${f.id}`);
    // Written into CSS unquoted: a word starting with a digit breaks the editor.
    assert.match(f.name, /^[A-Z][A-Za-z]*( [A-Z][A-Za-z]*)*$/, f.name);
    const file = path.join(DIR, `${f.file}.woff2`);
    assert.ok(fs.existsSync(file), file);
    assert.deepEqual(f.metrics, woff2Metrics(file), `${f.name}: metrics from the file`);
    const licence = fs.readFileSync(path.join(DIR, `OFL-${LICENCE[f.file]}.txt`), "utf8");
    assert.match(licence, /SIL Open Font License, Version 1\.1/, f.name);
  }
  // Nothing in the folder that isn't in the table.
  const files = fs.readdirSync(DIR).filter((n) => n.endsWith(".woff2")).map((n) => n.replace(/\.woff2$/, ""));
  assert.deepEqual(files.sort(), ADDED_FONTS.map((f) => f.file).sort());
  for (const n of UNHIDDEN) assert.ok(EXCALIDRAW_FONTS[n], n);
});

test("fontId: names in any case, numbers as they are, unknown names undefined", () => {
  assert.equal(fontId("Inter"), 200);
  assert.equal(fontId("  inter bold "), 201);
  assert.equal(fontId("Helvetica"), 2);
  assert.equal(fontId(5), 5);
  assert.equal(fontId(777), 777, "a number from a file passes through");
  assert.equal(fontId("Comic Sans"), undefined);
  assert.equal(fontId(null), undefined);
});

test("resolveFonts: names become numbers in skeleton, labels, element edits and defaults", () => {
  const patch = {
    skeleton: [
      { type: "text", id: "t", text: "x", fontFamily: "Caveat" },
      { type: "rectangle", id: "r", label: { text: "y", fontFamily: "barlow condensed" } },
      { type: "text", id: "n", text: "z", fontFamily: 6 },
    ],
    elements: [{ id: "old", fontFamily: "Cascadia" }],
    defaults: { text: { fontFamily: "Inter" }, label: { fontFamily: "Source Serif" }, "*": { roughness: 0 } },
  };
  assert.equal(resolveFonts(patch), null);
  assert.equal(patch.skeleton[0].fontFamily, 204);
  assert.equal(patch.skeleton[1].label.fontFamily, 203);
  assert.equal(patch.skeleton[2].fontFamily, 6);
  assert.equal(patch.elements[0].fontFamily, 3);
  assert.deepEqual(patch.defaults, { text: { fontFamily: 200 }, label: { fontFamily: 202 }, "*": { roughness: 0 } });
  assert.equal(resolveFonts({}), null);
  const problem = resolveFonts({ skeleton: [{ type: "text", id: "t", fontFamily: "Papyrus" }] });
  assert.match(problem, /^unknown font "Papyrus"; fonts: Excalifont, Nunito, .*Caveat$/);
  assert.doesNotMatch(problem, /Virgil/, "the old hand font isn't offered");
});
