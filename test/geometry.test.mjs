// Shot areas: the box around some elements, and the cap on a shot's size.
import { test } from "node:test";
import assert from "node:assert/strict";
import { boxAround, capScale, frameAt, frameToWiden, outsideOf, overlapsBox, SHOT_CAP } from "../src/lib/geometry.mjs";

const els = [
  { id: "a", type: "rectangle", x: 0, y: 0, width: 100, height: 50 },
  { id: "a-label", type: "text", containerId: "a", x: 10, y: 10, width: 80, height: 20 },
  { id: "b", type: "rectangle", x: 300, y: 200, width: 50, height: 50 },
  { id: "arrow", type: "arrow", x: 100, y: 25, width: 200, height: 175, points: [[0, 0], [200, 175]] },
  { id: "gone", type: "rectangle", x: -500, y: -500, width: 10, height: 10, isDeleted: true },
];

test("boxAround: the elements' bounds plus a margin; labels count with their container; deleted ones don't", () => {
  assert.deepEqual(boxAround(els, ["a"], 10), { x1: -10, y1: -10, x2: 110, y2: 60 });
  assert.deepEqual(boxAround(els, ["a", "b"], 0), { x1: 0, y1: 0, x2: 350, y2: 250 });
  assert.deepEqual(boxAround(els, ["arrow"], 0), { x1: 100, y1: 25, x2: 300, y2: 200 }, "arrows use their points");
  assert.equal(boxAround(els, ["gone"]), null);
  assert.equal(boxAround(els, ["nope"]), null);
});

test("overlapsBox: anything that reaches into the box", () => {
  const box = { x1: 90, y1: 0, x2: 200, y2: 100 };
  assert.deepEqual(els.filter((e) => overlapsBox(e, box)).map((e) => e.id), ["a", "arrow"]);
});

test("capScale: never more than a vision model reads; small areas keep their scale", () => {
  assert.equal(capScale(400, 300, 1), 1);
  assert.equal(capScale(400, 300, 2), 2, "small enough even at 2×");
  const s = capScale(3000, 2000, 1);
  assert.ok(3000 * s <= SHOT_CAP.longEdge + 1e-9 && 3000 * 2000 * s * s <= SHOT_CAP.pixels + 1e-6);
  assert.equal(capScale(4000, 100, 1), SHOT_CAP.longEdge / 4000, "a long strip is held to the long edge");
  assert.equal(capScale(0, 0, 1), 1, "an empty page is left alone");
});

test("frameToWiden: a crop covering most of one frame becomes that frame; otherwise stays a crop", () => {
  const page = [
    { id: "f", type: "frame", x: 0, y: 0, width: 1000, height: 600 },
    { id: "c1", type: "rectangle", x: 20, y: 20, width: 100, height: 60, frameId: "f" },
    { id: "c2", type: "rectangle", x: 860, y: 500, width: 100, height: 60, frameId: "f" },
    { id: "g", type: "frame", x: 1200, y: 0, width: 400, height: 300 },
    { id: "d1", type: "rectangle", x: 1220, y: 20, width: 100, height: 60, frameId: "g" },
    { id: "loose", type: "rectangle", x: 0, y: 800, width: 100, height: 60 },
  ];
  const w = (ids) => frameToWiden(page, ids, boxAround(page, ids, 40))?.id ?? null;
  assert.equal(w(["c1", "c2"]), "f", "spans the frame");
  assert.equal(w(["c1"]), null, "a corner of it");
  assert.equal(w(["c1", "d1"]), null, "two frames: stay a crop");
  assert.equal(w(["loose"]), null, "not in a frame");
  assert.equal(w(["g"]), "g", "a frame among the ids counts as its own");
});

test("frameAt: the topmost frame holding all of an element; none when it sticks out", () => {
  const frames = [{ id: "f1", type: "frame", x: 0, y: 0, width: 500, height: 500 }, { id: "f2", type: "frame", x: 400, y: 0, width: 500, height: 500 }];
  assert.equal(frameAt({ x: 10, y: 10, width: 100, height: 60 }, frames), "f1");
  assert.equal(frameAt({ x: 420, y: 10, width: 60, height: 60 }, frames), "f2", "both hold it: the one on top");
  assert.equal(frameAt({ x: 450, y: 10, width: 100, height: 60 }, frames.slice(0, 1)), null, "sticks out");
  assert.equal(frameAt({ x: 0, y: 0, width: 500.5, height: 500 }, frames.slice(0, 1)), "f1", "a pixel of rounding is fine");
  assert.equal(frameAt({ type: "arrow", x: 10, y: 10, points: [[0, 0], [200, 100]] }, frames.slice(0, 1)), "f1", "arrows by their points");
});

test("outsideOf: only when the boxes don't meet at all", () => {
  const f = { id: "f", type: "frame", x: 0, y: 0, width: 500, height: 500 };
  assert.equal(outsideOf({ x: 600, y: 0, width: 50, height: 50 }, f), true);
  assert.equal(outsideOf({ x: 480, y: 0, width: 50, height: 50 }, f), false);
});
