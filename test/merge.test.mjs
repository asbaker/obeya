import { test } from "node:test";
import assert from "node:assert/strict";
import { describeChange, mergeElements, wins } from "../src/lib/merge.mjs";

const el = (o) => ({ id: "a", type: "rectangle", x: 0, y: 0, width: 10, height: 10, version: 1, versionNonce: 100, ...o });

test("higher version wins", () => {
  assert.equal(wins(el({ version: 2 }), el({ version: 1 })), true);
  assert.equal(wins(el({ version: 1 }), el({ version: 2 })), false);
  assert.equal(wins(el({}), undefined), true);
});

test("equal versions: lower versionNonce wins (Excalidraw's reconcile rule)", () => {
  assert.equal(wins(el({ versionNonce: 5 }), el({ versionNonce: 9 })), true);
  assert.equal(wins(el({ versionNonce: 9 }), el({ versionNonce: 5 })), false);
  assert.equal(wins(el({}), el({})), false); // identical: no-op
});

test("merge applies winners and ignores stale copies", () => {
  const byId = new Map([["a", el({ version: 3, x: 5 })]]);
  const changes = mergeElements(byId, [el({ version: 2, x: 99 })]);
  assert.deepEqual(changes, []);
  assert.equal(byId.get("a").x, 5);
});

test("merge reports adds, moves, deletes and restores", () => {
  const byId = new Map();
  assert.deepEqual(mergeElements(byId, [el({})]), [{ op: "added", id: "a", type: "rectangle", fields: [] }]);
  const [moved] = mergeElements(byId, [el({ version: 2, x: 40.4, y: -3.6 })]);
  assert.equal(moved.op, "modified");
  assert.deepEqual(moved.fields, ["x", "y"]);
  assert.deepEqual(moved.moved, { from: [0, 0], to: [40, -4] });
  assert.equal(mergeElements(byId, [el({ version: 3, x: 40.4, y: -3.6, isDeleted: true })])[0].op, "deleted");
  assert.equal(mergeElements(byId, [el({ version: 4, x: 40.4, y: -3.6 })])[0].op, "restored");
});

test("unwatched fields bump the stored element but aren't reported", () => {
  const byId = new Map([["a", el({})]]);
  assert.deepEqual(mergeElements(byId, [el({ version: 2, seed: 7, updated: 123 })]), []);
  assert.equal(byId.get("a").version, 2);
});

test("frame membership changes are reported", () => {
  const byId = new Map([["a", el({})]]);
  const [c] = mergeElements(byId, [el({ version: 2, frameId: "f1" })]);
  assert.deepEqual(c.frameChange, { from: null, to: "f1" });
});

test("bound text records its container", () => {
  const byId = new Map();
  const [c] = mergeElements(byId, [{ id: "t", type: "text", containerId: "n1", text: "hi", version: 1 }]);
  assert.equal(c.containerId, "n1");
});

test("invalid entries are skipped", () => {
  const byId = new Map();
  assert.deepEqual(mergeElements(byId, [null, {}, { id: "" }, 5]), []);
  assert.equal(byId.size, 0);
});

test("describeChange: deleted-to-deleted and added-deleted are noops", () => {
  assert.equal(describeChange(undefined, el({ isDeleted: true })).op, "noop");
  assert.equal(describeChange(el({ isDeleted: true }), el({ isDeleted: true, x: 3 })).op, "noop");
});
