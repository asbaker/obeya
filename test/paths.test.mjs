import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { canonicalDir, sameDir } from "../src/lib/paths.mjs";
import { tmpDir } from "./helpers/env.mjs";

test("same dir through a relative path and trailing slash", () => {
  const d = tmpDir();
  const rel = path.relative(process.cwd(), d);
  assert.ok(sameDir(d, rel));
  assert.ok(sameDir(d, d + path.sep));
  assert.ok(sameDir(d, path.join(d, "x", "..")));
});

test("same dir through a symlink", () => {
  const d = tmpDir();
  fs.mkdirSync(path.join(d, "real"));
  fs.symlinkSync(path.join(d, "real"), path.join(d, "link"));
  assert.ok(sameDir(path.join(d, "real"), path.join(d, "link")));
});

test("a dir that doesn't exist yet compares by its existing parent's real path", () => {
  const d = tmpDir();
  fs.mkdirSync(path.join(d, "real"));
  fs.symlinkSync(path.join(d, "real"), path.join(d, "link"));
  assert.ok(sameDir(path.join(d, "real", "new"), path.join(d, "link", "new")));
  assert.equal(canonicalDir(path.join(d, "link", "new")), path.join(d, "real", "new"));
});

test("different dirs differ", () => {
  const d = tmpDir();
  fs.mkdirSync(path.join(d, "a"));
  fs.mkdirSync(path.join(d, "b"));
  assert.ok(!sameDir(path.join(d, "a"), path.join(d, "b")));
});

test("case-insensitive file systems: different spellings of one dir are the same dir", { skip: !caseInsensitive() }, () => {
  const d = tmpDir();
  fs.mkdirSync(path.join(d, "Pages"));
  assert.ok(sameDir(path.join(d, "Pages"), path.join(d, "pages")));
});

function caseInsensitive() {
  const d = tmpDir();
  fs.writeFileSync(path.join(d, "a"), "");
  return fs.existsSync(path.join(d, "A"));
}

test("a sidecar from before the rename moves to .obeya/, once, and keeps its contents", async () => {
  const { migrateSidecar, ensureSidecar, sidecarDir } = await import("../src/lib/paths.mjs");
  const dir = tmpDir();
  fs.mkdirSync(path.join(dir, ".excalidraw-local"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".excalidraw-local", "board.changes.jsonl"), '{"rev":1}\n');
  fs.writeFileSync(path.join(dir, ".excalidraw-local", ".gitignore"), "# excalidraw-local runtime state; never commit\n*\n");
  assert.equal(migrateSidecar(dir), true);
  assert.equal(sidecarDir(dir), path.join(dir, ".obeya"));
  assert.ok(!fs.existsSync(path.join(dir, ".excalidraw-local")));
  assert.equal(fs.readFileSync(path.join(dir, ".obeya", "board.changes.jsonl"), "utf8"), '{"rev":1}\n');
  assert.match(fs.readFileSync(path.join(dir, ".obeya", ".gitignore"), "utf8"), /^# obeya .*\n\*\n$/);
  assert.equal(migrateSidecar(dir), false, "nothing left to move");
  // Both present (someone made a new one by hand): leave both alone.
  fs.mkdirSync(path.join(dir, ".excalidraw-local"));
  assert.equal(migrateSidecar(dir), false);
  assert.ok(fs.existsSync(path.join(dir, ".excalidraw-local")));
  // ensureSidecar migrates too.
  const d2 = tmpDir();
  fs.mkdirSync(path.join(d2, ".excalidraw-local"));
  fs.writeFileSync(path.join(d2, ".excalidraw-local", "cursors.json"), "{}");
  ensureSidecar(d2);
  assert.ok(fs.existsSync(path.join(d2, ".obeya", "cursors.json")));
});

test("the library cache from before the rename moves, once; $OBEYA_CACHE is never moved into", async () => {
  const { cacheDir, migrateCache } = await import("../src/lib/libcache.mjs");
  const home = tmpDir();
  const env = {};
  assert.equal(cacheDir(env, "linux", home), path.join(home, ".cache", "obeya"));
  fs.mkdirSync(path.join(home, ".cache", "excalidraw-local", "libraries"), { recursive: true });
  fs.writeFileSync(path.join(home, ".cache", "excalidraw-local", "libraries", "mine.excalidrawlib"), "{}");
  assert.equal(migrateCache(env, "linux", home), true);
  assert.ok(fs.existsSync(path.join(home, ".cache", "obeya", "libraries", "mine.excalidrawlib")));
  assert.equal(migrateCache(env, "linux", home), false);
  assert.equal(migrateCache({ OBEYA_CACHE: path.join(home, "x") }, "linux", home), false);
  assert.equal(cacheDir(env, "darwin", home), path.join(home, "Library", "Caches", "obeya"));
});
