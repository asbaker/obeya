import { test } from "node:test";
import assert from "node:assert/strict";
import { anchors, isDocName, resolveDocHref, slug } from "../src/lib/docs.mjs";

test("heading anchors follow GitHub's rule", () => {
  assert.equal(slug("3 Requirements"), "3-requirements");
  assert.equal(slug("R2 Stages: `--style sketch|clean|hifi` and a brief"), "r2-stages---style-sketchcleanhifi-and-a-brief");
  assert.equal(slug("Café & bar"), "café--bar");
  assert.deepEqual(anchors(["Notes", "Notes", "Plan"]), ["notes", "notes-1", "plan"]);
  assert.ok(isDocName("v0.3/spec.md") && !isDocName("v0.3/spec"));
});

test("links in a doc: headings, other docs, drawings, the web; nothing else runs", () => {
  const from = "v0.3/spec.md";
  assert.deepEqual(resolveDocHref("#3-requirements", from), { page: from, heading: "3-requirements" });
  assert.deepEqual(resolveDocHref("notes.md#a", from), { page: "v0.3/notes.md", heading: "a" });
  assert.deepEqual(resolveDocHref("../readme.md", from), { page: "readme.md" });
  assert.deepEqual(resolveDocHref("?page=v0.3%2Fspec&element=f-does", from), { page: "v0.3/spec", element: "f-does" });
  assert.deepEqual(resolveDocHref("?page=v0.3/other.md#x", from), { page: "v0.3/other.md", heading: "x" });
  assert.deepEqual(resolveDocHref("https://example.com", from), { external: "https://example.com" });
  for (const bad of ["javascript:alert(1)", "data:text/html,x", "file:///etc/passwd", "//evil.example", ""]) assert.equal(resolveDocHref(bad, from).blocked, true, bad);
});

test("a doc's word count leaves out code, link targets and markup", async () => {
  const { countWords } = await import("../src/lib/store.mjs");
  assert.equal(countWords("# Spec\n\nTwo words.\n"), 3);
  assert.equal(countWords("A [link](https://example.com/very/long) here.\n\n```js\nconst x = 1;\n```\n| a | b |\n"), 5);
  assert.equal(countWords("It's 2,140 words — really."), 4);
});
