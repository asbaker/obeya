// Keep responses thin. Agents pay for every byte the CLI prints, so a result
// carries only what the agent acts on: no echo of its arguments, no debugging
// fields, no prose that restates fields, nothing for a success with nothing to
// report. Each command's keys are an allowlist (a new key fails here until it's
// added on purpose) and its bytes on this fixture have a budget.
// Live commands (patch, shot, library insert, wait) are checked in the smoke test.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { run } from "../src/cli/main.mjs";
import { freePort, tmpDir } from "./helpers/env.mjs";
import { startCatalogue } from "./helpers/catalogue.mjs";

let cat, env;
const el = (id, type, x, y, w, h, extra = {}) => ({ id, type, x, y, width: w, height: h, angle: 0, version: 1, versionNonce: 1, isDeleted: false, groupIds: [], boundElements: null, ...extra });

before(async () => {
  cat = await startCatalogue();
  const dir = tmpDir();
  const pages = path.join(dir, "canvas");
  fs.mkdirSync(pages, { recursive: true });
  fs.writeFileSync(path.join(pages, "board.excalidraw"), JSON.stringify({
    type: "excalidraw", version: 2, appState: {}, files: {},
    elements: [
      el("f1", "frame", 0, 0, 800, 500, { name: "One" }),
      el("a", "rectangle", 40, 40, 200, 100, { frameId: "f1", backgroundColor: "#a5d8ff" }),
      el("b", "rectangle", 200, 30, 200, 100, { frameId: "f1" }),
      el("c", "rectangle", 43, 160, 200, 100, { frameId: "f1" }),
    ],
  }));
  env = { ...process.env, OBEYA_DIR: pages, OBEYA_PORT: String(await freePort()), OBEYA_CACHE: tmpDir("xl-cache-"), OBEYA_CATALOGUE_URL: cat.url };
});
after(async () => {
  await run(["stop"], { env });
  cat.close();
});

/** Run a command; check its exit code, that stdout is one line, its keys, and its size. */
async function check(argv, { code = 0, keys, budget, stderr = "" }) {
  const r = await run(argv, { env });
  assert.equal(r.code, code, `${argv.join(" ")}: ${r.stdout}`);
  assert.equal(r.stderr, stderr, `${argv.join(" ")} prints nothing on stderr`);
  if (keys === null) {
    assert.equal(r.stdout, "", `${argv.join(" ")} prints nothing`);
    return null;
  }
  assert.ok(!r.stdout.includes("\n"), "one line");
  const body = JSON.parse(r.stdout);
  const inner = code === 0 ? body.result : body.error;
  const extra = Object.keys(inner).filter((k) => !keys.includes(k));
  assert.deepEqual(extra, [], `${argv.join(" ")}: keys not on its allowlist`);
  assert.ok(r.stdout.length <= budget, `${argv.join(" ")}: ${r.stdout.length} B over its ${budget} B budget`);
  return inner;
}

test("server commands: only what the agent acts on", async () => {
  await check(["status"], { keys: ["running", "url", "portInUse"], budget: 70 });
  await check(["serve"], { keys: ["url", "browsers"], budget: 60 });
  await check(["status"], { keys: ["running", "url", "browsers", "sameDir"], budget: 80 });
  await check(["open", "--no-open"], { keys: ["url", "opened", "switched"], budget: 80 });
});

test("reading: no echo of the page, the frame or the cursor", async () => {
  const pages = await check(["pages"], { keys: ["pages", "skipped"], budget: 80 });
  assert.deepEqual(Object.keys(pages.pages[0]), ["name", "frames", "modified"]);
  assert.match(pages.pages[0].modified, /^\d{4}-\d\d-\d\dT\d\d:\d\d$/, "to the minute");
  const got = await check(["get", "board", "--frame", "f1"], { keys: ["rev", "elements"], budget: 400 });
  assert.ok(got.elements.filter((e) => e.id !== "f1").every((e) => e.frame === undefined), "the frame asked for isn't repeated");
  await check(["describe", "board"], { keys: ["rev", "outline"], budget: 300 });
  await check(["changes", "board"], { keys: ["rev", "changes"], budget: 40 });
  await check(["band", "list", "board"], { keys: ["bands"], budget: 30 });
});

test("lint: numbers as fields, the fix once per rule", async () => {
  const r = await check(["lint", "board"], { keys: ["findings", "fixes"], budget: 450 });
  for (const f of r.findings) {
    assert.equal(f.message, undefined, "no prose per finding");
    assert.ok(r.fixes[f.rule], `a fix for ${f.rule}`);
  }
  assert.deepEqual(r.findings.find((f) => f.rule === "overlap")?.by, [40, 90]);
  assert.deepEqual(r.findings.find((f) => f.rule === "near-miss")?.off, { left: 3 });
  assert.equal(Object.keys(r.fixes).length, new Set(r.findings.map((f) => f.rule)).size, "one fix per rule present");
});

test("writing: no echo of the arguments; nothing when there's nothing to report", async () => {
  await check(["band", "set", "board", "release", "--y", "400"], { keys: ["bands"], budget: 80 });
  await check(["band", "delete", "board", "release"], { keys: ["bands"], budget: 30 });
  await check(["rename", "board", "board2"], { keys: ["staleLinks"], budget: 30 });
  await check(["rename", "board2", "board"], { keys: ["staleLinks"], budget: 30 });
});

test("library: what the agent picks and inserts by", async () => {
  const s = await check(["library", "search", "architecture"], { keys: ["results", "stale"], budget: 250 });
  for (const x of s.results) assert.deepEqual(Object.keys(x), ["id", "name", "items", "named", "cached"]);
  const show = await check(["library", "show", "shapes.acme"], { keys: ["id", "authors", "source", "items", "sheets"], budget: 300 });
  for (const i of show.items) assert.ok(!i.item.includes("/"), "no library id on every item");
  await check(["library", "list"], { keys: ["libraries"], budget: 120 });
  await check(["library", "remove", "shapes.acme"], { keys: null });
});

test("errors: the usage once; the nearest page names", async () => {
  await check(["rename"], { code: 1, keys: ["code", "message", "hint", "usage"], budget: 180 });
  await check(["nope"], { code: 1, keys: ["code", "message", "hint"], budget: 130 });
  const e = await check(["get", "bord"], { code: 1, keys: ["code", "message", "hint", "pages"], budget: 200 });
  assert.deepEqual(e.pages, ["board"]);
});

test("stop: nothing on success", async () => {
  await check(["stop"], { keys: null });
  await check(["stop"], { keys: null });
});
