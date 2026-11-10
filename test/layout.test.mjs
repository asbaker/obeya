import { test } from "node:test";
import assert from "node:assert/strict";
import { computeLayout, LayoutError, validateLayout } from "../src/lib/layout.mjs";

const box = (id, x, y, o = {}) => ({ id, type: "rectangle", x, y, width: 100, height: 60, ...o });
const card = (id, x, y, o = {}) => ({ id, type: "stickynote", x, y, width: 200, height: 150, ...o });
// Where things end up: id -> [x, y].
function placed(layout, els) {
  const { moves } = computeLayout(layout, els);
  return Object.fromEntries(els.map((e) => [e.id, [e.x + (moves.get(e.id)?.dx ?? 0), e.y + (moves.get(e.id)?.dy ?? 0)]]));
}
const code = (fn) => {
  try {
    fn();
  } catch (err) {
    assert.ok(err instanceof LayoutError, err.message);
    return err.code;
  }
  return null;
};

test("align: edges and centres of the selection, or to a reference", () => {
  const els = [box("a", 0, 0), box("b", 30, 100, { width: 50 }), box("c", 10, 200)];
  assert.deepEqual(placed([{ align: "left", ids: ["a", "b", "c"] }], els), { a: [0, 0], b: [0, 100], c: [0, 200] });
  assert.deepEqual(placed([{ align: "right", ids: ["a", "b", "c"] }], els), { a: [10, 0], b: [60, 100], c: [10, 200] });
  assert.deepEqual(placed([{ align: "centre-x", ids: ["a", "b"] }], els), { a: [0, 0], b: [25, 100], c: [10, 200] });
  assert.deepEqual(placed([{ align: "center-x", ids: ["a", "b"] }], els).b, [25, 100], "American spelling works too");
  assert.deepEqual(placed([{ align: "top", ids: ["b"], to: "c" }], els), { a: [0, 0], b: [30, 200], c: [10, 200] });
});

test("distribute: equal gaps between the ends, or a fixed gap from the first", () => {
  const els = [box("a", 0, 0), box("b", 150, 0), box("c", 400, 0)];
  assert.deepEqual(placed([{ distribute: "horizontal", ids: ["c", "a", "b"] }], els), { a: [0, 0], b: [200, 0], c: [400, 0] });
  assert.deepEqual(placed([{ distribute: "horizontal", ids: ["a", "b", "c"], gap: 10 }], els), { a: [0, 0], b: [110, 0], c: [220, 0] });
  const col = [box("a", 0, 0), box("b", 0, 70)];
  assert.deepEqual(placed([{ distribute: "vertical", ids: ["a", "b"], gap: 40 }], col), { a: [0, 0], b: [0, 100] });
});

test("grid: rows and columns sized to the largest in each, from the first's corner or `at`", () => {
  const els = [box("a", 50, 50), box("b", 0, 0, { width: 150 }), box("c", 0, 0, { height: 100 }), box("d", 0, 0)];
  assert.deepEqual(placed([{ grid: ["a", "b", "c", "d"], columns: 2, gap: 10 }], els), { a: [0, 0], b: [110, 0], c: [0, 70], d: [110, 70] });
  assert.deepEqual(placed([{ grid: ["a", "b"], columns: 1, gap: [0, 5], at: [500, 500] }], els).b, [500, 565]);
});

test("a card moves with the dots grouped on it; a frame with its children; arrows bound at both ends", () => {
  const els = [
    card("c", 0, 0, { groupIds: ["g"] }), { id: "dot", type: "ellipse", x: 10, y: 120, width: 14, height: 14, groupIds: ["g"] },
    { id: "f", type: "frame", x: 500, y: 0, width: 300, height: 300 }, box("in", 520, 20, { frameId: "f" }), box("in2", 650, 20, { frameId: "f" }),
    { id: "ar", type: "arrow", x: 620, y: 50, points: [[0, 0], [30, 0]], startBinding: { elementId: "in" }, endBinding: { elementId: "in2" } },
  ];
  const p = placed([{ align: "top", ids: ["c"], to: "in" }, { distribute: "horizontal", ids: ["c", "f"], gap: 100 }], els);
  assert.deepEqual(p.dot, [10, 140]);
  assert.deepEqual(p.f, [300, 0]);
  assert.deepEqual(p.in, [320, 20]);
  assert.deepEqual(p.ar, [420, 50]);
});

test("place: below what's in a column, lined up with its cards, brought to the front", () => {
  const els = [
    box("col", 0, 0, { width: 400, height: 1000, backgroundColor: "#eee" }),
    { id: "title", type: "text", x: 20, y: 20, width: 80, height: 30 },
    card("c1", 45, 100), card("c2", 45, 290),
    card("new", 2000, 2000),
  ];
  const r = computeLayout([{ place: "new", in: "col", end: true }], els);
  assert.deepEqual([2000 + r.moves.get("new").dx, 2000 + r.moves.get("new").dy], [45, 460]);
  assert.deepEqual(r.front, ["new"]);
});

test("place: the first free spot in reading order; padding; inside a frame it joins the frame", () => {
  const els = [{ id: "f", type: "frame", x: 0, y: 0, width: 500, height: 400 }, box("a", 20, 20, { frameId: "f" }), box("n", 900, 900)];
  const r = computeLayout([{ place: "n", in: "f" }], els);
  assert.deepEqual([900 + r.moves.get("n").dx, 900 + r.moves.get("n").dy], [140, 20], "right of the first box, same row");
  assert.equal(r.frameOf.get("n"), "f");
  const tight = computeLayout([{ place: "n", in: "f", padding: 0, gap: 0 }], [els[0], box("n", 900, 900)]);
  assert.deepEqual([900 + tight.moves.get("n").dx, 900 + tight.moves.get("n").dy], [0, 0]);
});

test("place: things still waiting to be placed aren't in the way", () => {
  // Three new boxes parked on top of the column's top-left, placed one by one.
  const els = [box("col", 0, 0, { width: 140, height: 400 }), box("a", 10, 10), box("b", 10, 10), box("c", 10, 10)];
  assert.deepEqual(placed(["a", "b", "c"].map((id) => ({ place: id, in: "col" })), els), { col: [0, 0], a: [20, 20], b: [20, 100], c: [20, 180] });
});

test("place: no room is an error that says why", () => {
  const els = [box("area", 0, 0, { width: 120, height: 80 }), box("n", 500, 500)];
  assert.equal(code(() => computeLayout([{ place: "n", in: "area" }], els)), "no_room");
});

test("stack: above or below a reference, with the group", () => {
  const els = [box("col", 0, 0), card("c", 0, 0, { groupIds: ["g"] }), { id: "dot", type: "ellipse", x: 0, y: 0, width: 5, height: 5, groupIds: ["g"] }];
  const r = computeLayout([{ stack: "above", ids: ["c"], ref: "col" }], els);
  assert.deepEqual(r.stacks, [{ ids: ["c", "dot"], where: "above", ref: "col" }]);
  assert.deepEqual([...r.moves], []);
});

test("directives apply in order", () => {
  const els = [box("a", 0, 0), box("b", 37, 200)];
  assert.deepEqual(placed([{ align: "left", ids: ["a", "b"] }, { distribute: "vertical", ids: ["a", "b"], gap: 0 }], els), { a: [0, 0], b: [0, 60] });
});

test("errors: unknown ids, labels, and malformed directives", () => {
  const els = [box("a", 0, 0), box("b", 0, 100), { id: "t", type: "text", containerId: "a", x: 0, y: 0, width: 10, height: 10 }];
  assert.equal(code(() => computeLayout([{ align: "left", ids: ["a", "zzz"] }], els)), "unknown_element");
  assert.equal(code(() => computeLayout([{ align: "left", ids: ["a", "t"] }], els)), "invalid_patch");
  assert.equal(code(() => computeLayout([{ place: "a", in: "nope" }], els)), "unknown_element");
  for (const d of [
    {}, { align: "left", distribute: "vertical", ids: ["a", "b"] }, { align: "middle", ids: ["a", "b"] }, { align: "left", ids: ["a"] },
    { distribute: "vertical", ids: ["a", "b"] }, { distribute: "sideways", ids: ["a", "b", "c"] }, { grid: ["a"], columns: 0 },
    { grid: ["a"], columns: 1, at: [1] }, { place: "a" }, { place: "a", in: "b", end: "yes" }, { stack: "over", ids: ["a"], ref: "b" },
    { stack: "above", ids: ["a"], ref: "a" }, { align: "left", ids: ["a", "b"], extra: 1 }, { distribute: "vertical", ids: ["a", "b"], gap: -1 },
  ]) assert.equal(code(() => validateLayout([d])), "invalid_patch", JSON.stringify(d));
  assert.equal(code(() => validateLayout({})), "invalid_patch");
  assert.equal(code(() => validateLayout([])), null);
});
