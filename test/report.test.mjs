import { test } from "node:test";
import assert from "node:assert/strict";
import { brief, coalesce, compact, foldLabels, pointsAt, resolveChanges } from "../src/lib/report.mjs";
import { bounds, overlapScore } from "../src/lib/geometry.mjs";

const note = (id, x, y, o = {}) => ({ id, type: "stickynote", x, y, width: 200, height: 200, version: 1, ...o });
const label = (id, containerId, text) => ({ id, type: "text", containerId, text, originalText: text, x: 0, y: 0, width: 50, height: 20, version: 1 });
let rev = 0;
const entry = (o) => ({ rev: ++rev, at: "t", source: "user", fields: [], ...o });

// A 3x1 row of notes, 40px apart: n1 at 0, n2 at 240, n3 at 480.
const row = [note("n1", 0, 0), note("n2", 240, 0), note("n3", 480, 0), label("t1", "n1", "Login"), label("t2", "n2", "Search"), label("t3", "n3", "Pay")];

// ---------------------------------------------------------------------------
// pointsAt geometry

test("an ellipse drawn around a note points at that note only", () => {
  const ellipse = { id: "e", type: "ellipse", x: 200, y: -40, width: 280, height: 280 };
  assert.deepEqual(pointsAt(ellipse, row), ["n2"]);
});

test("ellipses use their shape: the corners of their box don't count", () => {
  // The ellipse's bounding box covers 40% of n1, but the ellipse itself covers far less.
  const ellipse = { id: "e", type: "ellipse", x: 120, y: 0, width: 400, height: 200 };
  const b = { ...ellipse, type: "rectangle" };
  assert.ok(overlapScore(b, row[0]) > 0.3);
  assert.ok(overlapScore(ellipse, row[0]) < 0.3);
});

test("a freehand scribble across a note points at it", () => {
  const scribble = { id: "s", type: "freedraw", x: 500, y: 80, points: [[0, 0], [40, 20], [80, -10], [140, 30]] };
  assert.deepEqual(pointsAt(scribble, row), ["n3"]);
});

test("a straight horizontal stroke still covers something", () => {
  const underline = { id: "u", type: "freedraw", x: 10, y: 150, points: [[0, 0], [180, 0]] };
  assert.deepEqual(pointsAt(underline, row), ["n1"]);
});

test("freedraw bounds come from points, including negative offsets", () => {
  assert.deepEqual(bounds({ x: 100, y: 100, points: [[0, 0], [-50, 20], [30, -10]] }), { x1: 50, y1: 90, x2: 130, y2: 120 });
});

test("a sticky comment overlapping a note's corner points at it", () => {
  const comment = note("c", 600, 120); // covers 80x80 of n3: 6400/40000 = 0.16 -> not enough
  assert.deepEqual(pointsAt(comment, row), []);
  const closer = note("c", 560, 80); // 120x120: 0.36
  assert.deepEqual(pointsAt(closer, row), ["n3"]);
});

test("overlap is measured against the smaller area", () => {
  const dot = { id: "d", type: "rectangle", x: 50, y: 50, width: 20, height: 20 };
  assert.equal(overlapScore(dot, row[0]), 1);
  assert.deepEqual(pointsAt(dot, row), ["n1"]);
});

test("frames, other strokes, bound text and deleted elements are never targets", () => {
  const els = [
    { id: "f", type: "frame", x: -20, y: -20, width: 800, height: 300 },
    { id: "line", type: "line", x: 0, y: 0, points: [[0, 0], [200, 200]] },
    note("gone", 0, 0, { isDeleted: true }),
    ...row,
  ];
  const ellipse = { id: "e", type: "ellipse", x: -40, y: -40, width: 280, height: 280 };
  assert.deepEqual(pointsAt(ellipse, els), ["n1"]);
});

test("arrows use their bindings, end first", () => {
  const arrow = { id: "a", type: "arrow", x: 0, y: 0, points: [[0, 0], [1, 1]], startBinding: { elementId: "n1" }, endBinding: { elementId: "n3" } };
  assert.deepEqual(pointsAt(arrow, row), ["n3", "n1"]);
});

test("an unbound arrow points at what its tip touches, else its tail", () => {
  const arrow = { id: "a", type: "arrow", x: 900, y: 100, points: [[0, 0], [-320, 0]] }; // tip at 580,100 -> n3
  assert.deepEqual(pointsAt(arrow, row), ["n3"]);
  const back = { id: "a", type: "arrow", x: 100, y: 100, points: [[0, 0], [900, 0]] }; // tip in empty space, tail in n1
  assert.deepEqual(pointsAt(back, row), ["n1"]);
  const nowhere = { id: "a", type: "arrow", x: 900, y: 900, points: [[0, 0], [10, 10]] };
  assert.deepEqual(pointsAt(nowhere, row), []);
});

// ---------------------------------------------------------------------------
// Change folding

test("a label edit becomes `relabeled` on its container", () => {
  const byId = new Map(row.map((e) => [e.id, e]));
  const out = foldLabels([entry({ op: "modified", id: "t2", type: "text", fields: ["text", "width"], containerId: "n2" })], byId);
  assert.equal(out.length, 1);
  assert.equal(out[0].id, "n2");
  assert.equal(out[0].op, "relabeled");
  assert.equal(out[0].type, "stickynote");
});

test("a label that only follows its container is dropped", () => {
  const byId = new Map(row.map((e) => [e.id, e]));
  const out = foldLabels([
    entry({ op: "modified", id: "n1", type: "stickynote", fields: ["x", "y"], moved: { from: [0, 0], to: [100, 0] } }),
    entry({ op: "modified", id: "t1", type: "text", fields: ["x", "y"], containerId: "n1", moved: { from: [5, 5], to: [105, 5] } }),
  ], byId);
  assert.deepEqual(out.map((c) => c.id), ["n1"]);
});

test("a note added with its label is one `added` entry", () => {
  const els = [note("c", 900, 0), label("tc", "c", "Needs SSO")];
  const out = resolveChanges([
    entry({ op: "added", id: "c", type: "stickynote" }),
    entry({ op: "modified", id: "c", type: "stickynote", fields: ["height"] }),
    entry({ op: "added", id: "tc", type: "text", containerId: "c" }),
    entry({ op: "modified", id: "tc", type: "text", fields: ["text"], containerId: "c" }),
  ], els);
  assert.equal(out.length, 1);
  assert.equal(out[0].op, "added");
  assert.equal(out[0].text, "Needs SSO");
});

test("a drag synced in several pieces is one move, end to end", () => {
  const out = coalesce([
    entry({ op: "modified", id: "n1", fields: ["x", "y"], moved: { from: [0, 0], to: [50, 0] } }),
    entry({ op: "modified", id: "n1", fields: ["x"], moved: { from: [50, 0], to: [150, 10] } }),
  ]);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].moved, { from: [0, 0], to: [150, 10] });
  assert.deepEqual(out[0].fields, ["x", "y"]);
});

test("a move back to the start is dropped", () => {
  const out = coalesce([
    entry({ op: "modified", id: "n1", fields: ["x"], moved: { from: [0, 0], to: [50, 0] } }),
    entry({ op: "modified", id: "n1", fields: ["x"], moved: { from: [50, 0], to: [0, 0] } }),
  ]);
  assert.deepEqual(out, []);
});

test("added then deleted by the same source is nothing", () => {
  assert.deepEqual(coalesce([entry({ op: "added", id: "x" }), entry({ op: "deleted", id: "x" })]), []);
});

test("entries from different sources are not merged", () => {
  const out = coalesce([
    entry({ op: "modified", id: "n1", source: "agent", fields: ["x"], moved: { from: [0, 0], to: [10, 0] } }),
    entry({ op: "modified", id: "n1", source: "user", fields: ["x"], moved: { from: [10, 0], to: [20, 0] } }),
  ]);
  assert.equal(out.length, 2);
});

test("frame changes join end to end", () => {
  const out = coalesce([
    entry({ op: "modified", id: "n1", fields: ["frameId"], frameChange: { from: "f1", to: null } }),
    entry({ op: "modified", id: "n1", fields: ["frameId"], frameChange: { from: null, to: "f2" } }),
  ]);
  assert.deepEqual(out[0].frameChange, { from: "f1", to: "f2" });
});

test("resolveChanges adds pointsAt for the person's annotations, with labels", () => {
  const ellipse = { id: "e", type: "ellipse", x: 200, y: -40, width: 280, height: 280, version: 1 };
  const out = resolveChanges([entry({ op: "added", id: "e", type: "ellipse" })], [...row, ellipse]);
  assert.deepEqual(out[0].pointsAt, [{ id: "n2", type: "stickynote", text: "Search" }]);
});

test("compact folds bound text into its container", () => {
  const c = compact([...row, { id: "f", type: "frame", name: "Board", x: 0, y: 0, width: 10, height: 10 }]);
  assert.equal(c.length, 4);
  assert.equal(c.find((e) => e.id === "n1").text, "Login");
  assert.equal(c.find((e) => e.id === "f").text, "Board");
});

test("an arrow re-routed because its bound note moved is not reported", () => {
  const arrow = { id: "a", type: "arrow", x: 0, y: 0, points: [[0, 0], [1, 1]], startBinding: { elementId: "n1" }, endBinding: { elementId: "n2" } };
  const els = [...row, arrow];
  const out = resolveChanges([
    entry({ op: "modified", id: "n1", fields: ["x", "y"], moved: { from: [0, 0], to: [0, 300] } }),
    entry({ op: "modified", id: "a", type: "arrow", fields: ["x", "y", "points", "height"], moved: { from: [0, 0], to: [0, 10] } }),
  ], els);
  assert.deepEqual(out.map((c) => c.id), ["n1"]);
  // ...but restyling the arrow, or moving it on its own, still is.
  const restyled = resolveChanges([
    entry({ op: "modified", id: "n1", fields: ["x"], moved: { from: [0, 0], to: [9, 0] } }),
    entry({ op: "modified", id: "a", type: "arrow", fields: ["strokeColor"] }),
  ], els);
  assert.deepEqual(restyled.map((c) => c.id), ["n1", "a"]);
  assert.deepEqual(resolveChanges([entry({ op: "modified", id: "a", type: "arrow", fields: ["points"] })], els).map((c) => c.id), ["a"]);
});

test("bands: a move across a line or into a strip is reported by the element's centre", async () => {
  const { crossings, side } = await import("../src/lib/report.mjs");
  const release = { name: "release", axis: "y", from: 400, to: 400 };
  const lane = { name: "lane-b", axis: "x", from: 300, to: 600 };
  assert.equal(side(release, 399), "before");
  assert.equal(side(release, 400), "inside");
  assert.equal(side(release, 401), "after");
  const note200 = { width: 200, height: 200 };
  // top-left y 100 -> 350: centre 200 -> 450, crosses the release line downwards
  assert.deepEqual(crossings({ from: [0, 100], to: [0, 350] }, note200, [release, lane]), [{ band: "release", from: "before", to: "after" }]);
  // top-left x 0 -> 300: centre 100 -> 400, into the lane
  assert.deepEqual(crossings({ from: [0, 0], to: [300, 0] }, note200, [lane]), [{ band: "lane-b", from: "before", to: "inside" }]);
  // within one side: nothing
  assert.deepEqual(crossings({ from: [0, 0], to: [0, 50] }, note200, [release]), []);
  // resolveChanges wires it in
  const out = resolveChanges([entry({ op: "modified", id: "n1", fields: ["y"], moved: { from: [0, 0], to: [0, 400] } })], row, [release]);
  assert.deepEqual(out[0].crossed, [{ band: "release", from: "before", to: "after" }]);
});

test("an arrow re-route is dropped even when its note ended where it started", () => {
  const arrow = { id: "a", type: "arrow", x: 0, y: 0, points: [[0, 0], [1, 1]], startBinding: { elementId: "n1" } };
  const out = resolveChanges([
    entry({ op: "modified", id: "n1", fields: ["x"], moved: { from: [0, 0], to: [120, 0] } }),
    entry({ op: "modified", id: "a", type: "arrow", fields: ["points", "width"] }),
    entry({ op: "modified", id: "n1", fields: ["x"], moved: { from: [120, 0], to: [0, 0] } }),
  ], [...row, arrow]);
  assert.deepEqual(out, []);
});

test("deleting (or restoring) a note with its label is one entry", () => {
  const els = [note("c", 900, 0, { isDeleted: true }), label("tc", "c", "oops")];
  const del = resolveChanges([
    entry({ op: "deleted", id: "c", type: "stickynote" }),
    entry({ op: "deleted", id: "tc", type: "text", containerId: "c" }),
  ], els);
  assert.deepEqual(del.map((c) => [c.id, c.op]), [["c", "deleted"]]);
  const labelFirst = resolveChanges([
    entry({ op: "deleted", id: "tc", type: "text", containerId: "c" }),
    entry({ op: "deleted", id: "c", type: "stickynote" }),
  ], els);
  assert.deepEqual(labelFirst.map((c) => [c.id, c.op]), [["c", "deleted"]]);
  // A label edited on its own is still reported.
  assert.deepEqual(resolveChanges([entry({ op: "modified", id: "tc", type: "text", fields: ["text"], containerId: "c" })], els).map((c) => c.op), ["relabeled"]);
});

test("a note added, relabeled and deleted again leaves nothing, label folding included", () => {
  const els = [note("c", 900, 0, { isDeleted: true }), label("tc", "c", "draft", { isDeleted: true })];
  const out = resolveChanges([
    entry({ op: "added", id: "c", type: "stickynote" }),
    entry({ op: "added", id: "tc", type: "text", containerId: "c" }),
    entry({ op: "modified", id: "tc", type: "text", fields: ["text"], containerId: "c" }),
    entry({ op: "deleted", id: "c", type: "stickynote" }),
    entry({ op: "deleted", id: "tc", type: "text", containerId: "c" }),
  ], els);
  assert.deepEqual(out, []);
});

test("a note dropped in a column doesn't point at the column; a dot on a card still points at the card", () => {
  const column = { id: "col", type: "rectangle", x: -40, y: -40, width: 800, height: 2000 };
  const els = [column, ...row];
  const dropped = note("new", 100, 600); // inside the column, clear of the notes
  assert.deepEqual(pointsAt(dropped, els), []);
  const dot = { id: "d", type: "ellipse", x: 20, y: 160, width: 14, height: 14 };
  assert.deepEqual(pointsAt(dot, els), ["n1"]);
  // An empty frame-like box: nothing else in it, so a note inside it still points at it.
  assert.deepEqual(pointsAt(note("x", 2100, 100), [{ id: "box", type: "rectangle", x: 2000, y: 0, width: 1000, height: 1000 }]), ["box"]);
});

test("brief: no times or per-entry revisions, source only for both, fields only when not implied, new text in full", () => {
  const long = "x".repeat(100);
  const out = brief([
    { rev: 3, at: "t", source: "user", op: "modified", id: "n1", type: "stickynote", fields: ["x", "y", "backgroundColor"], moved: { from: [0, 0], to: [5, 5] }, text: long, frame: "f1" },
    { rev: 4, at: "t", source: "user", op: "added", id: "e", type: "ellipse", fields: [], pointsAt: [{ id: "n1", type: "stickynote" }] },
    { rev: 5, at: "t", source: "user", op: "relabeled", id: "n2", type: "stickynote", fields: ["text"], text: "Hi" },
    { rev: 6, at: "t", source: "user", op: "added", id: "n3", type: "stickynote", fields: [], text: long },
  ]);
  assert.deepEqual(out, [
    { op: "modified", id: "n1", type: "stickynote", text: "x".repeat(79) + "…", fields: ["backgroundColor"], frame: "f1", moved: { from: [0, 0], to: [5, 5] } },
    { op: "added", id: "e", type: "ellipse", pointsAt: [{ id: "n1", type: "stickynote" }] },
    { op: "relabeled", id: "n2", type: "stickynote", text: "Hi" },
    { op: "added", id: "n3", type: "stickynote", text: long }, // what the person wrote, in full
  ]);
  assert.equal(brief([{ op: "added", id: "a", type: "text", source: "agent", fields: [] }], { withSource: true })[0].source, "agent");
});
