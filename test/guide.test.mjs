// The guide `obeya --skill` prints (src/guide/): a small core and topics.
// The core's index and the topic files must agree, the core must stay small
// (every session pays for it), and every error code the code can throw must
// have a hint (src/lib/hints.mjs), since the guide no longer lists them.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { GUIDE_DIR, guide, topics } from "../src/cli/guide.mjs";
import { HINTS } from "../src/lib/hints.mjs";

test("the core's topic index and the topic files agree", () => {
  const files = fs.readdirSync(GUIDE_DIR).filter((f) => f.endsWith(".md")).map((f) => f.slice(0, -3)).filter((f) => f !== "core");
  assert.deepEqual([...topics()].sort(), files.sort());
  assert.ok(!topics().includes("all"), "`all` is reserved");
  for (const t of topics()) assert.ok(guide(t).startsWith("# "), `${t} starts with a heading`);
  assert.equal(guide("nope"), null);
});

test("the core stays small: every session pays for it", () => {
  const bytes = Buffer.byteLength(guide());
  assert.ok(bytes <= 5600, `core is ${bytes} bytes; move the how into a topic`);
});

test("every topic the core points at with `--skill <topic>` exists", () => {
  for (const m of guide().matchAll(/--skill ([a-z-]+)/g)) assert.ok(topics().includes(m[1]) || m[1] === "all", `--skill ${m[1]}`);
});

test("every error code thrown in src/ has a hint", () => {
  const RE = /(?:(?:Error|pageError|fail|bad)\(\s*(?:reqId,\s*|\d+,\s*)?|code:\s*)"([a-z][a-z_]+)"/g;
  const codes = new Set();
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (p.endsWith(".mjs")) for (const m of fs.readFileSync(p, "utf8").matchAll(RE)) codes.add(m[1]);
    }
  };
  walk("src");
  assert.ok(codes.size > 30, "the scan finds the codes");
  const missing = [...codes].filter((c) => !HINTS[c]);
  assert.deepEqual(missing, [], "add a hint in src/lib/hints.mjs");
});
