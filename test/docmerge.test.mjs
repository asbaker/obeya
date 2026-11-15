import { test } from "node:test";
import assert from "node:assert/strict";
import { lineHunks, merge3, splitLines, takeTheirs } from "../src/lib/docmerge.mjs";

const doc = (...ls) => ls.map((l) => l + "\n").join("");
const base = doc("# Plan", "", "one", "two", "three", "", "## Notes");

test("splitLines keeps each line's ending, so joining gives the bytes back", () => {
  for (const t of ["", "a", "a\n", "a\r\nb", "\n\n", "a\nb\r\n"]) assert.equal(splitLines(t).join(""), t);
});

test("no change, or only one side changed: that side, no clashes", () => {
  assert.deepEqual(merge3(base, base, base).clashes, []);
  assert.equal(merge3(base, base, base).text, base);
  const mine = base.replace("two", "TWO");
  assert.equal(merge3(base, mine, base).text, mine);
  const theirs = base.replace("three", "three\nfour");
  const r = merge3(base, base, theirs);
  assert.equal(r.text, theirs);
  assert.deepEqual(r.fromTheirs.map((i) => r.lines[i]), ["four\n"]);
});

test("both changed different lines: both kept, theirs marked", () => {
  const mine = base.replace("one", "one, edited");
  const theirs = base.replace("## Notes", "## Notes\n- agent: fonts done");
  const r = merge3(base, mine, theirs);
  assert.deepEqual(r.clashes, []);
  assert.equal(r.text, mine.replace("## Notes", "## Notes\n- agent: fonts done"));
  assert.deepEqual(r.fromTheirs.map((i) => r.lines[i]), ["- agent: fonts done\n"]);
});

test("both made the same change: no clash", () => {
  const both = base.replace("two", "2");
  assert.deepEqual(merge3(base, both, both), { text: both, lines: splitLines(both), fromTheirs: [], clashes: [] });
});

test("both changed the same line: a clash; the text keeps mine until Load theirs", () => {
  const mine = base.replace("two", "two (mine)");
  const theirs = base.replace("two", "two (theirs)");
  const r = merge3(base, mine, theirs);
  assert.equal(r.text, mine);
  assert.deepEqual(r.clashes, [{ at: 3, mine: ["two (mine)\n"], theirs: ["two (theirs)\n"] }]);
  assert.equal(takeTheirs(r), theirs);
});

test("both added at the end: a clash, not a silent pick", () => {
  const r = merge3(base, base + "mine\n", base + "theirs\n");
  assert.equal(r.clashes.length, 1);
  assert.equal(takeTheirs(r), base + "theirs\n");
});

test("an empty base: whatever both wrote", () => {
  assert.equal(merge3("", "", "# New\n").text, "# New\n");
  assert.equal(merge3("", "a\n", "a\n").text, "a\n");
  assert.equal(merge3("", "a\n", "b\n").clashes.length, 1);
});

test("CRLF lines stay as they are", () => {
  const b = "a\r\nb\r\nc\r\n", mine = "a\r\nB\r\nc\r\n", theirs = "a\r\nb\r\nc\r\nd\r\n";
  assert.equal(merge3(b, mine, theirs).text, "a\r\nB\r\nc\r\nd\r\n");
});

test("a long doc with scattered edits merges cleanly and fast", () => {
  const big = Array.from({ length: 5000 }, (_, i) => `line ${i}\n`).join("");
  const mine = big.replace("line 100\n", "line 100 (mine)\n").replace("line 4000\n", "");
  const theirs = big.replace("line 2500\n", "line 2500 (theirs)\n") + "end\n";
  const t = Date.now();
  const r = merge3(big, mine, theirs);
  assert.ok(Date.now() - t < 500, `${Date.now() - t} ms`);
  assert.deepEqual(r.clashes, []);
  assert.ok(r.text.includes("line 100 (mine)\n") && r.text.includes("line 2500 (theirs)\n") && r.text.endsWith("end\n") && !r.text.includes("line 4000\n"));
});

test("lineHunks: applied last to first, they turn a into b and touch only what changed", () => {
  const apply = (a, hs) => [...hs].reverse().reduce((t, h) => t.slice(0, h.from) + h.text + t.slice(h.to), a);
  const a = doc("one", "two", "three", "four", "five");
  for (const b of [a, doc("one", "TWO", "three", "four", "five", "six"), doc("zero", "one", "three", "four"), "", doc("x"), "no newline"]) {
    assert.equal(apply(a, lineHunks(a, b)), b, JSON.stringify(b));
  }
  assert.deepEqual(lineHunks(a, a), []);
  const hs = lineHunks(a, doc("one", "TWO", "three", "four", "FIVE"));
  assert.equal(hs.length, 2, "two separate hunks, not one around the middle");
  assert.equal(apply("", lineHunks("", "a\n")), "a\n");
});
