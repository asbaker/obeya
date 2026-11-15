import { test } from "node:test";
import assert from "node:assert/strict";
import { STAGES, StageError, applyStage, stageDefaults } from "../src/lib/stages.mjs";
import { FONT_IDS } from "../src/lib/fonts.mjs";

test("stages: sketch and clean are a medium (strokes, fonts), hifi is nothing", () => {
  assert.deepEqual(STAGES, ["sketch", "clean", "hifi"]);
  assert.equal(stageDefaults("hifi"), null);
  for (const name of ["sketch", "clean"]) {
    const d = stageDefaults(name);
    const colours = JSON.stringify(d).match(/strokeColor|backgroundColor/g);
    assert.equal(colours, null, `${name} sets no colours: colour is the agent's call`);
    assert.equal(typeof d.text.fontFamily, "number", "font names become numbers");
  }
  assert.equal(stageDefaults("sketch").text.fontFamily, FONT_IDS.Excalifont);
  assert.equal(stageDefaults("clean")["*"].roughness, 0);
  assert.throws(() => stageDefaults("tidewell"), StageError);
});

test("a stage fills in under what the element and the patch set, on new elements only", () => {
  const patch = { skeleton: [
    { type: "rectangle", id: "a", roughness: 2 },
    { type: "text", id: "b", text: "hi" },
    { type: "rectangle", id: "old" },
  ] };
  applyStage(patch, "clean", new Set(["old"]));
  const [a, b, old] = patch.skeleton;
  assert.equal(a.roughness, 2, "the element's own field wins");
  assert.equal(a.strokeWidth, 1);
  assert.equal(b.fontFamily, FONT_IDS.Helvetica);
  assert.equal(old.roughness, undefined, "elements the page has keep their style");
  const hifi = { skeleton: [{ type: "rectangle", id: "c" }] };
  applyStage(hifi, "hifi");
  assert.deepEqual(hifi.skeleton[0], { type: "rectangle", id: "c" });
});

test("library inserts keep their colours but take the stage's strokes and font", () => {
  const patch = { elements: [
    { type: "rectangle", id: "r", roughness: 2, strokeWidth: 4, strokeColor: "#e03131", backgroundColor: "#ffc9c9" },
    { type: "text", id: "t", fontFamily: 1 },
  ] };
  applyStage(patch, "clean");
  assert.equal(patch.elements[0].roughness, 0);
  assert.equal(patch.elements[0].strokeColor, "#e03131");
  assert.equal(patch.elements[1].fontFamily, FONT_IDS.Helvetica);
});
