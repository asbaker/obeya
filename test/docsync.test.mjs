import { test } from "node:test";
import assert from "node:assert/strict";
import { lineToY, yToLine } from "../src/lib/docsync.mjs";

// A preview's blocks: the source line each starts at and its top in the pane;
// the last entry is the end (the line count, the content height).
const blocks = [
  { line: 0, y: 0 },     // # Title
  { line: 2, y: 80 },    // a paragraph
  { line: 4, y: 140 },   // ## Decisions
  { line: 6, y: 200 },   // a table, lines 6–20, 600 px tall
  { line: 22, y: 800 },  // ## Next
  { line: 30, y: 1000 }, // the end
];

test("a block's first line maps to its top, and back", () => {
  for (const b of blocks) {
    assert.equal(lineToY(blocks, b.line), b.y);
    assert.equal(yToLine(blocks, b.y), b.line);
  }
});

test("inside a block, by the fraction of its lines", () => {
  assert.equal(lineToY(blocks, 14), 200 + (8 / 16) * 600);
  assert.equal(yToLine(blocks, 500), 6 + (300 / 600) * 16);
  assert.equal(lineToY(blocks, 3), 110);
});

test("the two directions are inverses", () => {
  for (let l = 0; l <= 30; l += 0.25) assert.ok(Math.abs(yToLine(blocks, lineToY(blocks, l)) - l) < 1e-9, String(l));
});

test("monotonic, and clamped at both ends", () => {
  let last = -1;
  for (let l = 0; l <= 30; l += 0.5) {
    const y = lineToY(blocks, l);
    assert.ok(y >= last);
    last = y;
  }
  assert.equal(lineToY(blocks, -5), 0);
  assert.equal(lineToY(blocks, 99), 1000);
  assert.equal(yToLine(blocks, -5), 0);
  assert.equal(yToLine(blocks, 5000), 30);
});

test("blocks that share a line, and a doc with no blocks, don't divide by zero", () => {
  const same = [{ line: 0, y: 0 }, { line: 3, y: 50 }, { line: 3, y: 90 }, { line: 9, y: 300 }];
  assert.ok(Number.isFinite(lineToY(same, 3)));
  assert.ok(Number.isFinite(yToLine(same, 70)));
  assert.equal(lineToY([], 4), 0);
  assert.equal(yToLine([], 40), 0);
});
