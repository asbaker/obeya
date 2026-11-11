import { test } from "node:test";
import assert from "node:assert/strict";
import { involving, lint } from "../src/lib/lint.mjs";

const box = (id, x, y, o = {}) => ({ id, type: "rectangle", x, y, width: 100, height: 60, backgroundColor: "transparent", ...o });
const note = (id, x, y, o = {}) => ({ id, type: "stickynote", x, y, width: 200, height: 200, backgroundColor: "#fff3bf", ...o });
const label = (id, containerId, x, y, width, height) => ({ id, type: "text", containerId, x, y, width, height, text: id });
const frame = (id, x, y, width, height) => ({ id, type: "frame", x, y, width, height, name: id });
const arrow = (id, x, y, points, o = {}) => ({ id, type: "arrow", x, y, points, width: 0, height: 0, ...o });
const rules = (els, o) => lint(els, o).map((f) => [f.rule, ...f.ids]);

test("overlap: two shapes partly over each other", () => {
  assert.deepEqual(rules([box("a", 0, 0), box("b", 50, 30)]), [["overlap", "a", "b"]]);
});

test("overlap: touching, apart, one on top of another, or grouped is fine", () => {
  assert.deepEqual(rules([box("a", 0, 0), box("b", 100, 0)]), []);
  assert.deepEqual(rules([box("a", 0, 0), box("b", 300, 0)]), []);
  assert.deepEqual(rules([box("col", 0, 0, { width: 400, height: 600 }), note("card", 20, 40)]), []);
  assert.deepEqual(rules([box("a", 0, 0, { groupIds: ["g"] }), box("b", 50, 30, { groupIds: ["g"] })]), []);
});

test("overlap: shapes in different frames don't count", () => {
  assert.deepEqual(rules([frame("f1", 0, 0, 500, 500), frame("f2", 0, 600, 500, 500), box("a", 10, 10, { frameId: "f1" }), box("b", 50, 30, { frameId: "f2" })], { rules: ["overlap"] }), []);
});

test("overlap: something in no frame over a framed shape counts (it's drawn over the frame)", () => {
  const els = [frame("f", 0, 0, 500, 500), box("a", 10, 10, { frameId: "f" }), box("b", 50, 30)];
  assert.deepEqual(rules(els, { rules: ["overlap"] }), [["overlap", "a", "b"]]);
});

test("overlap: two boxes stacked on each other, a few pixels apart", () => {
  const els = [frame("f", 0, 0, 900, 900), note("card", 100, 190, { frameId: "f" }), note("link", 100, 188)];
  assert.deepEqual(rules(els, { rules: ["overlap"] }), [["overlap", "card", "link"]]);
  assert.match(lint(els, { rules: ["overlap"] })[0].message, /stacked/);
  assert.deepEqual(rules([note("a", 0, 0), note("b", 0, 0)], { rules: ["overlap"] }), [["overlap", "a", "b"]]);
});

test("clipped-text: a label bigger than its shape", () => {
  assert.deepEqual(rules([box("a", 0, 0), label("t", "a", -10, 20, 120, 20)], { rules: ["clipped-text"] }), [["clipped-text", "a", "t"]]);
  assert.deepEqual(rules([box("a", 0, 0), label("t", "a", 10, 20, 80, 20)], { rules: ["clipped-text"] }), []);
  // A label a pixel or two off after a resize is fine.
  assert.deepEqual(rules([box("a", 0, 0), label("t", "a", 10, -1.5, 80, 20)], { rules: ["clipped-text"] }), []);
});

test("clipped-text: an arrow's label sits on the line and may be bigger than it", () => {
  assert.deepEqual(rules([arrow("x", 0, 0, [[0, 0], [100, 0]]), label("t", "x", 20, -10, 80, 40)], { rules: ["clipped-text"] }), []);
});

test("clipped-text: free text running past its frame's edge", () => {
  const els = [frame("f", 0, 0, 300, 200), { id: "t", type: "text", x: 200, y: 20, width: 150, height: 20, frameId: "f", text: "long" }];
  assert.deepEqual(rules(els), [["clipped-text", "t"]]);
});

test("outside-frame: a shape sticking out of its frame", () => {
  const els = [frame("f", 0, 0, 300, 200), box("a", 250, 20, { frameId: "f" }), box("b", 20, 20, { frameId: "f" })];
  const f = lint(els, { rules: ["outside-frame"] });
  assert.deepEqual(f.map((x) => x.ids), [["a"]]);
  assert.equal(f[0].frame, "f");
});

test("loose-arrow: an unbound end on a shape, an end bound to a deleted shape", () => {
  const els = [box("a", 0, 0), box("b", 300, 0), arrow("x", 100, 30, [[0, 0], [205, 0]], { startBinding: { elementId: "a" } })];
  assert.deepEqual(rules(els), [["loose-arrow", "x", "b"]]);
  const gone = [box("a", 0, 0), arrow("x", 100, 30, [[0, 0], [100, 0]], { startBinding: { elementId: "a" }, endBinding: { elementId: "zzz" } })];
  assert.deepEqual(rules(gone), [["loose-arrow", "x"]]);
  // Bound at both ends, or ending in empty space, is fine; so is an arrow drawn inside one shape.
  assert.deepEqual(rules([box("a", 0, 0), box("b", 300, 0), arrow("x", 100, 30, [[0, 0], [200, 0]], { startBinding: { elementId: "a" }, endBinding: { elementId: "b" } })]), []);
  assert.deepEqual(rules([box("a", 0, 0), arrow("x", 500, 30, [[0, 0], [100, 0]])]), []);
  assert.deepEqual(rules([box("a", 0, 0), arrow("x", 20, 30, [[0, 0], [40, 0]])]), []);
});

test("near-miss: neighbours a few pixels off", () => {
  // A column of notes, one 3 px to the right.
  assert.deepEqual(rules([note("a", 0, 0), note("b", 3, 240)]), [["near-miss", "a", "b"]]);
  assert.match(lint([note("a", 0, 0), note("b", 3, 240)])[0].message, /left off by 3 px/);
  // Aligned, clearly apart, sub-pixel, or far away is fine.
  assert.deepEqual(rules([note("a", 0, 0), note("b", 0, 240)]), []);
  assert.deepEqual(rules([note("a", 0, 0), note("b", 40, 240)]), []);
  assert.deepEqual(rules([note("a", 0, 0), note("b", 0.4, 240)]), []);
  assert.deepEqual(rules([note("a", 0, 0), note("b", 3, 2000)]), []);
  // Different sizes, tops aligned: aligned on that axis.
  assert.deepEqual(rules([note("a", 0, 0), note("b", 240, 0, { height: 150 })]), []);
  // A big container and a small box beside it aren't peers.
  assert.deepEqual(rules([box("col", 0, 0, { width: 300, height: 1100 }), box("b", 320, 517, { height: 60 })]), []);
  // Different kinds of thing aren't compared.
  assert.deepEqual(rules([note("a", 0, 0), box("b", 3, 240)]), []);
});

test("hidden: something under a filled shape drawn above it", () => {
  const card = note("card", 20, 40);
  const col = box("col", 0, 0, { width: 400, height: 600, backgroundColor: "#e7f5ff" });
  assert.deepEqual(rules([card, col]), [["hidden", "card", "col"]]);
  assert.deepEqual(rules([col, card]), []); // card on top
  assert.deepEqual(rules([card, { ...col, backgroundColor: "transparent" }]), []); // outline only
  assert.deepEqual(rules([card, { ...col, opacity: 30 }]), []); // see-through
});

test("labels and frames are not objects of their own", () => {
  assert.deepEqual(rules([frame("f", 0, 0, 500, 500), box("a", 10, 10, { frameId: "f" }), { ...label("t", "a", 20, 20, 60, 20), frameId: "f" }]), []);
});

test("--frame keeps findings in that frame; involving() keeps a patch's", () => {
  const els = [frame("f", 0, 0, 300, 200), box("a", 250, 20, { frameId: "f" }), box("c", 1000, 0), box("d", 1050, 30)];
  assert.deepEqual(lint(els, { frame: "f" }).map((x) => x.rule), ["outside-frame"]);
  assert.deepEqual(involving(lint(els), new Set(["d"])).map((x) => x.rule), ["overlap"]);
});

test("deleted elements are ignored", () => {
  assert.deepEqual(rules([box("a", 0, 0), box("b", 50, 30, { isDeleted: true })]), []);
});

test("misrouted-arrow: a bound end drawn far from its shape", () => {
  const els = [box("a", 0, 0), box("b", 400, 0),
    arrow("ok", 100, 30, [[0, 0], [300, 0]], { startBinding: { elementId: "a" }, endBinding: { elementId: "b" } }),
    arrow("bad", -500, -500, [[0, 0], [60, 0]], { startBinding: { elementId: "a" }, endBinding: { elementId: "b" } })];
  assert.deepEqual(rules(els, { rules: ["misrouted-arrow"] }), [["misrouted-arrow", "bad", "a"], ["misrouted-arrow", "bad", "b"]]);
});

test("stray: something outside frames far from everything else", () => {
  const els = [frame("f", 0, 0, 800, 600), box("a", 10, 10, { frameId: "f" }), box("near", 900, 0), box("lost", 5000, 5000)];
  assert.deepEqual(rules(els, { rules: ["stray"] }), [["stray", "lost"]]);
});

test("empty-frame and crowded-frame", () => {
  assert.deepEqual(rules([frame("f", 0, 0, 500, 500)], { rules: ["empty-frame"] }), [["empty-frame", "f"]]);
  const full = [frame("f", 0, 0, 400, 400), box("a", 0, 0, { width: 400, height: 190, frameId: "f" }), box("b", 0, 200, { width: 400, height: 190, frameId: "f" })];
  assert.deepEqual(rules(full, { rules: ["crowded-frame"] }), [["crowded-frame", "f"]]);
  // A column holding a few cards counts as its cards, not the column.
  const board = [frame("f", 0, 0, 400, 400), box("col", 0, 0, { width: 400, height: 400, frameId: "f" }), box("card", 20, 20, { frameId: "f" })];
  assert.deepEqual(rules(board, { rules: ["crowded-frame"] }), []);
});

test("small-text: too small when a slide-shaped frame is presented; boards are left alone", () => {
  const slide = [frame("s", 0, 0, 3200, 1800), { id: "t", type: "text", x: 10, y: 10, width: 50, height: 10, fontSize: 12, frameId: "s", text: "tiny" }];
  assert.deepEqual(rules(slide, { rules: ["small-text"] }), [["small-text", "t"]]);
  const board = [frame("b", 0, 0, 3000, 3000), { id: "t", type: "text", x: 10, y: 10, width: 50, height: 10, fontSize: 12, frameId: "b", text: "tiny" }];
  assert.deepEqual(rules(board, { rules: ["small-text"] }), []);
});

test("contrast: text on its container's fill, or on the filled shape under it", () => {
  const els = [box("a", 0, 0, { backgroundColor: "#fff9db" }), { ...label("t", "a", 10, 20, 80, 20), strokeColor: "#f08c00" },
    box("ok", 200, 0, { backgroundColor: "#fff9db" }), { ...label("u", "ok", 210, 20, 80, 20), strokeColor: "#1e1e1e" },
    box("col", 400, 0, { width: 300, height: 300, backgroundColor: "#f8f9fa" }), { id: "h", type: "text", x: 410, y: 10, width: 60, height: 20, text: "To do", strokeColor: "#748ffc" }];
  assert.deepEqual(rules(els, { rules: ["contrast"] }), [["contrast", "a"], ["contrast", "h", "col"]]);
});

test("unframed: wholly inside a frame without being in it; a label in another frame than its shape", () => {
  const els = [frame("f", 0, 0, 800, 600), box("in", 10, 10, { frameId: "f" }), box("lost", 200, 200), box("half", 750, 10),
    box("c", 400, 10, { frameId: "f" }), label("l", "c", 410, 20, 80, 20)];
  assert.deepEqual(rules(els, { rules: ["unframed"] }), [["unframed", "lost", "f"], ["unframed", "c", "l"]]);
});
