// The page's arrow binding (src/page/arrows.mjs), unit-tested in Node since the
// page moved to ES modules.
import { test } from "node:test";
import assert from "node:assert/strict";
import { bindArrow, splitArrowBindings } from "../src/page/arrows.mjs";

const box = (id, x, y, o = {}) => ({ id, type: "rectangle", x, y, width: 100, height: 60, version: 1, ...o });

test("splitArrowBindings: ends on sticky notes or existing elements are deferred; others go to the converter", () => {
  const skel = [
    { type: "rectangle", id: "a" }, { type: "stickynote", id: "n" },
    { type: "arrow", id: "x", start: { id: "a" }, end: { id: "n" } },
    { type: "arrow", id: "y", start: { id: "a" }, end: { id: "old" } },
    { type: "arrow", id: "z", start: { id: "a" } },
  ];
  const { skeleton, deferred } = splitArrowBindings(skel, new Map([["old", box("old", 0, 0)]]));
  assert.deepEqual(deferred, [{ id: "x", end: "n" }, { id: "y", end: "old" }]);
  assert.deepEqual(skeleton.find((s) => s.id === "x"), { type: "arrow", id: "x", start: { id: "a" } }, "the converter keeps the end it can bind");
  assert.equal(skeleton.find((s) => s.id === "z"), skel[4], "untouched");
});

test("splitArrowBindings: with `all` (a patch with layout) every bound end is deferred", () => {
  const { skeleton, deferred } = splitArrowBindings([{ type: "rectangle", id: "a" }, { type: "rectangle", id: "b" }, { type: "arrow", id: "x", start: { id: "a" }, end: { id: "b" } }], new Map(), { all: true });
  assert.deepEqual(deferred, [{ id: "x", start: "a", end: "b" }]);
  assert.equal(skeleton[2].start, undefined);
});

test("splitArrowBindings: a bound arrow needs an id", () => {
  assert.throws(() => splitArrowBindings([{ type: "stickynote", id: "n" }, { type: "arrow", end: { id: "n" } }], new Map()), /needs an id/);
});

test("bindArrow: a straight line between the boxes' edges, bound both ways", () => {
  const els = new Map([["a", box("a", 0, 0)], ["b", box("b", 300, 0)], ["x", { id: "x", type: "arrow", x: 0, y: 0, points: [[0, 0], [100, 0]], version: 1 }]]);
  let n = 0;
  bindArrow(els, { id: "x", start: "a", end: "b" }, () => ++n);
  const x = els.get("x");
  assert.deepEqual([x.x, x.y], [106, 30], "leaves a's right edge, plus a gap");
  assert.deepEqual(x.points, [[0, 0], [188, 0]], "ends at b's left edge, minus a gap");
  assert.equal(x.startBinding.elementId, "a");
  assert.equal(x.endBinding.elementId, "b");
  assert.deepEqual(els.get("a").boundElements, [{ id: "x", type: "arrow" }]);
  assert.equal(els.get("b").version, 2, "targets get a new version");
});

test("bindArrow: one end bound, the other stays where it was", () => {
  const els = new Map([["a", box("a", 0, 0)], ["x", { id: "x", type: "arrow", x: 0, y: 200, points: [[0, 0], [50, 0]], version: 1 }]]);
  bindArrow(els, { id: "x", end: "a" }, () => 1);
  const x = els.get("x");
  assert.deepEqual([x.x, x.y], [0, 200]);
  assert.equal(x.startBinding, null);
  assert.equal(x.endBinding.elementId, "a");
});
