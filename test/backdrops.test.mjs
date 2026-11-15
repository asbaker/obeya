import { test } from "node:test";
import assert from "node:assert/strict";
import { lockBackdrops } from "../src/lib/backdrops.mjs";

test("a new shape that fills its frame is locked; others, and ones that say, are left alone", () => {
  const frames = new Map([["f", { x: 0, y: 0, width: 1000, height: 600 }]]);
  const sk = lockBackdrops([
    { type: "rectangle", id: "bg", x: 0, y: 0, width: 1000, height: 600, frameId: "f" },
    { type: "rectangle", id: "card", x: 10, y: 10, width: 100, height: 60, frameId: "f" },
    { type: "rectangle", id: "mine", x: 0, y: 0, width: 1000, height: 600, frameId: "f", locked: false },
    { type: "frame", id: "g", x: 2000, y: 0, width: 500, height: 500 },
    { type: "rectangle", id: "bg2", x: 2000, y: 0, width: 500, height: 500, frameId: "g" },
    { type: "rectangle", id: "old", x: 0, y: 0, width: 1000, height: 600, frameId: "f" },
  ], frames, new Set(["old"]));
  assert.deepEqual(sk.filter((e) => e.locked).map((e) => e.id), ["bg", "bg2"]);
});
