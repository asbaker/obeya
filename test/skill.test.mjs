// The installable skill (skills/obeya/SKILL.md, for `npx skills add asbaker/obeya`)
// is a stub that points at `obeya --skill`, the full guide for the installed
// version (src/skill.md). The two must agree on what triggers them.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const front = (text) => Object.fromEntries(
  /^---\n([\s\S]*?)\n---\n/.exec(text)[1].split("\n").map((l) => /^([a-z-]+): (.*)$/.exec(l)).filter(Boolean).map((m) => [m[1], m[2]]));

test("the skill stub: same name and description as the full guide, and it points at obeya --skill", () => {
  const stub = fs.readFileSync("skills/obeya/SKILL.md", "utf8");
  const full = fs.readFileSync("src/skill.md", "utf8");
  const [s, f] = [front(stub), front(full)];
  assert.equal(s.name, "obeya");
  assert.equal(s.name, f.name);
  assert.equal(s.description, f.description, "one description: the words that make agents pick the skill up");
  assert.match(stub, /obeya --skill/);
  assert.ok(stub.split("\n").length < 60, "a stub: the guide comes from the CLI");
  for (const text of [stub, full]) assert.doesNotMatch(text, /\/Users\/|\/home\/[a-z]|C:\\\\Users/, "no local paths");
});
