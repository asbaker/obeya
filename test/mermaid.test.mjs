// Mermaid → patch (src/lib/mermaid.mjs): ids, groups, placement. The converter
// itself runs in a tab; the smoke test covers it end to end.
import { test } from "node:test";
import assert from "node:assert/strict";
import { diagramElements, extent, mermaidPatch, placement } from "../src/lib/mermaid.mjs";

// What the converter returns for "A[Christmas] -->|Get money| B(Go shopping)", trimmed.
const converted = {
  elements: [
    { id: "A_B", type: "arrow", x: 214, y: 62, points: [[0, 0], [0, 103]], label: { text: "Get money", groupIds: [] }, start: { id: "A" }, end: { id: "B" }, groupIds: [] },
    { id: "A", type: "rectangle", x: 151, y: 8, width: 126, height: 54, label: { text: "Christmas", groupIds: [] }, groupIds: [] },
    { id: "B", type: "rectangle", x: 139, y: 165, width: 149, height: 54, label: { text: "Go shopping", groupIds: [] }, groupIds: ["g1"] },
    { type: "line", x: 20, y: 300, points: [[0, 0], [0, -40]] },
  ],
  files: {},
};

test("ids: prefixed, references follow, unnamed ones numbered; one group for the diagram", () => {
  const { skeleton, image } = mermaidPatch(converted, { prefix: "xmas", at: [0, 0] });
  assert.deepEqual(skeleton.map((e) => e.id), ["xmas-A_B", "xmas-A", "xmas-B", "xmas-m1"]);
  assert.deepEqual([skeleton[0].start.id, skeleton[0].end.id], ["xmas-A", "xmas-B"]);
  assert.deepEqual(skeleton[2].groupIds, ["xmas-g1", "xmas"], "the converter's groups inside the diagram's");
  assert.deepEqual(skeleton[1].label.groupIds, ["xmas"], "labels move with their group");
  assert.equal(image, false);
});

test("placement: the top-left at --at, counting arrow points; into a frame when given", () => {
  const { skeleton } = mermaidPatch(converted, { prefix: "x", at: [1000, 500], frame: "f1" });
  const b = extent(skeleton);
  assert.deepEqual([b.x1, b.y1], [1000, 500]);
  assert.ok(skeleton.every((e) => e.frameId === "f1"));
});

test("default place: where the earlier run was, else inside the frame, else below the page", () => {
  const page = [
    { id: "f1", type: "frame", x: 2000, y: 0, width: 800, height: 600 },
    { id: "note", type: "rectangle", x: 0, y: 0, width: 200, height: 100 },
    { id: "xmas-A", type: "rectangle", x: 300, y: 400, width: 100, height: 50, frameId: "f1" },
    { id: "xmas-gone", type: "rectangle", x: 0, y: 0, width: 10, height: 10, isDeleted: true },
  ];
  assert.deepEqual(diagramElements(page, "xmas").map((e) => e.id), ["xmas-A"]);
  assert.deepEqual(placement(page, { prefix: "xmas" }), { at: [300, 400], frame: "f1" });
  assert.deepEqual(placement(page, { prefix: "new", frame: "f1" }), { at: [2040, 80], frame: "f1" });
  assert.deepEqual(placement(page, { prefix: "new" }), { at: [0, 700], frame: null });
  assert.deepEqual(placement([], { prefix: "new" }), { at: [0, 0], frame: null });
});

test("an unsupported type: one image, flagged", () => {
  const r = mermaidPatch({ elements: [{ type: "image", x: 0, y: 0, width: 300, height: 200, fileId: "f", status: "saved" }], files: { f: { id: "f", mimeType: "image/svg+xml", dataURL: "data:" } } }, { prefix: "pie", at: [0, 0] });
  assert.equal(r.image, true);
  assert.deepEqual(r.skeleton.map((e) => e.id), ["pie-m1"]);
  assert.ok(r.files.f);
});
