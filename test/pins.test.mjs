import { test } from "node:test";
import assert from "node:assert/strict";
import { pinIds, pinSkeleton, pinsProblem } from "../src/lib/pins.mjs";

const boxes = new Map([
  ["a", { x: 0, y: 0, width: 100, height: 50, frameId: "f" }],
  ["b", { x: 0, y: 40, width: 100, height: 50, frameId: "f" }],
]);

test("pins: numbered in order, notes level with their pins and never overlapping", () => {
  const sk = pinSkeleton({ items: [{ on: "a", note: "one" }, { on: "b", note: "two" }] }, boxes);
  const n1 = sk.find((e) => e.id === "pins-1-t"), n2 = sk.find((e) => e.id === "pins-2-t");
  assert.ok(n2.y >= n1.y + 24, "the second note is pushed below the first");
  assert.ok(sk.every((e) => e.frameId === "f"), "pins live in the pinned element's frame");
  assert.deepEqual(sk.filter((e) => e.customData?.pin).map((e) => e.customData.pin), [1, 2]);
});

test("pins: notes below, unknown ids named, the shape checked", () => {
  const sk = pinSkeleton({ id: "r", notes: "below", items: [{ on: "a", note: "x" }] }, boxes);
  assert.ok(sk.find((e) => e.id === "r-1-t").y > 90);
  assert.throws(() => pinSkeleton({ items: [{ on: "zz", note: "x" }] }, boxes), /no element "zz"/);
  assert.match(pinsProblem({ items: [] }), /items/);
  assert.match(pinsProblem({ items: [{ on: "a", note: "x" }], notes: "left" }), /right/);
  assert.equal(pinsProblem({ items: [{ on: "a", note: "x" }] }), null);
});

test("pinIds finds a set's elements to replace", () => {
  const els = [{ id: "r-1", customData: { pins: "r" } }, { id: "r-1-t", customData: { pins: "r" } }, { id: "other", customData: { pins: "s" } }, { id: "lbl", containerId: "r-1", customData: { pins: "r" } }];
  assert.deepEqual(pinIds(els, "r"), ["r-1", "r-1-t"]);
});

test("pins on a slide: notes that don't fit go just outside the frame, unframed", () => {
  const slide = new Map([["s", { x: 0, y: 0, width: 1280, height: 720, type: "frame" }], ["num", { x: 900, y: 200, width: 300, height: 120, frameId: "s" }]]);
  const sk = pinSkeleton({ items: [{ on: "num", note: "Source for the 23%?" }] }, slide);
  const note = sk.find((e) => e.id === "pins-1-t");
  assert.ok(note.x > 1280, "beside the slide");
  assert.equal(note.frameId, null);
  assert.equal(sk.find((e) => e.id === "pins-1").frameId, "s", "the pin itself stays on its element");
});
