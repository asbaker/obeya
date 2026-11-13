// A patch's `defaults` (src/lib/defaults.mjs): the page's base style.
import { test } from "node:test";
import assert from "node:assert/strict";
import { applyDefaults, defaultsProblem } from "../src/lib/defaults.mjs";

test("defaults fill what an element leaves out: its own fields, then its type's, then *", () => {
  const d = { "*": { strokeColor: "#1e1e1e", roughness: 1 }, rectangle: { fillStyle: "solid", strokeColor: "#495057" }, label: { fontSize: 16, textAlign: "left" } };
  const [a, b, c] = applyDefaults([
    { type: "rectangle", id: "a", label: { text: "A" } },
    { type: "rectangle", id: "b", strokeColor: "#e03131", label: { text: "B", fontSize: 24 } },
    { type: "text", id: "c", text: "C" },
  ], d);
  assert.deepEqual(a, { type: "rectangle", id: "a", strokeColor: "#495057", roughness: 1, fillStyle: "solid", label: { fontSize: 16, textAlign: "left", text: "A" } });
  assert.equal(b.strokeColor, "#e03131", "the element's own field wins");
  assert.equal(b.label.fontSize, 24);
  assert.deepEqual(c, { type: "text", id: "c", text: "C", strokeColor: "#1e1e1e", roughness: 1 }, "no label added to an element without one");
});

test("defaults skip elements the page already has (re-applying a skeleton keeps their style)", () => {
  const [a] = applyDefaults([{ type: "rectangle", id: "old", label: { text: "New words" } }], { rectangle: { backgroundColor: "#ffc9c9" } }, new Set(["old"]));
  assert.equal(a.backgroundColor, undefined);
});

test("defaultsProblem: an object of objects, without ids, types or bindings", () => {
  assert.equal(defaultsProblem(undefined), null);
  assert.equal(defaultsProblem({ rectangle: { fillStyle: "solid" } }), null);
  assert.match(defaultsProblem([]), /object/);
  assert.match(defaultsProblem({ rectangle: "solid" }), /defaults.rectangle/);
  assert.match(defaultsProblem({ "*": { id: "x" } }), /can't set `id`/);
});
