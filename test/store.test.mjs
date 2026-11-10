import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { PageStore } from "../src/lib/store.mjs";
import { tmpDir } from "./helpers/env.mjs";

const rect = (id, o = {}) => ({ id, type: "rectangle", x: 0, y: 0, width: 10, height: 10, version: 1, versionNonce: 1, ...o });

test("the change log persists and revisions continue after a restart", () => {
  const dir = tmpDir();
  const a = new PageStore(dir, { saveDelayMs: 0 });
  a.merge("board", [rect("r1"), rect("r2")], "agent");
  a.merge("board", [rect("r1", { version: 2, x: 50 })], "user");
  a.flush();

  const b = new PageStore(dir);
  const { rev, entries } = b.changes("board");
  assert.equal(rev, 3);
  assert.deepEqual(entries.map((e) => [e.rev, e.source, e.op, e.id]), [[1, "agent", "added", "r1"], [2, "agent", "added", "r2"], [3, "user", "modified", "r1"]]);
  const [next] = b.merge("board", [rect("r2", { version: 2, y: 9 })], "user");
  assert.equal(next.rev, 4);
});

test("--since last: a cursor per consumer that survives restarts", () => {
  const dir = tmpDir();
  const a = new PageStore(dir);
  a.merge("board", [rect("r1")], "agent");
  assert.equal(a.changes("board", { since: "last" }).entries.length, 1);
  assert.equal(a.changes("board", { since: "last" }).entries.length, 0);
  assert.equal(a.changes("board", { since: "last", consumer: "other" }).entries.length, 1); // own cursor
  a.merge("board", [rect("r2")], "user");

  const b = new PageStore(dir);
  const r = b.changes("board", { since: "last" });
  assert.equal(r.since, 1);
  assert.deepEqual(r.entries.map((e) => e.id), ["r2"]);
  assert.equal(b.changes("board", { since: 0 }).entries.length, 2); // numeric since doesn't move the cursor
  assert.equal(b.changes("board", { since: "last" }).entries.length, 0);
});

test("source filter", () => {
  const s = new PageStore(tmpDir());
  s.merge("p", [rect("a")], "agent");
  s.merge("p", [rect("b")], "user");
  assert.deepEqual(s.changes("p", { source: "user" }).entries.map((e) => e.id), ["b"]);
});

test("saves are atomic, git-ignored state stays in the sidecar dir", () => {
  const dir = tmpDir();
  const s = new PageStore(dir);
  s.merge("board", [rect("r1")], "user");
  s.flush();
  const top = fs.readdirSync(dir).sort();
  assert.deepEqual(top, [".obeya", "board.excalidraw"]);
  const scene = JSON.parse(fs.readFileSync(path.join(dir, "board.excalidraw"), "utf8"));
  assert.equal(scene.type, "excalidraw");
  assert.equal(scene.elements[0].id, "r1");
  assert.equal(fs.readFileSync(path.join(dir, ".obeya", ".gitignore"), "utf8").trim().split("\n").pop(), "*");
  assert.deepEqual(fs.readdirSync(path.join(dir, ".obeya")).filter((f) => f.endsWith(".tmp")), []);
});

test("a torn last log line is skipped", () => {
  const dir = tmpDir();
  const a = new PageStore(dir);
  a.merge("board", [rect("r1")], "user");
  fs.appendFileSync(path.join(dir, ".obeya", "board.changes.jsonl"), '{"rev":2,"sou');
  assert.equal(new PageStore(dir).changes("board").entries.length, 1);
});

test("pages: files on disk plus pages only in memory", () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, "a.excalidraw"), JSON.stringify({ type: "excalidraw", elements: [] }));
  fs.writeFileSync(path.join(dir, "bad|name.excalidraw"), "{}");
  const s = new PageStore(dir);
  s.merge("b", [rect("r")], "agent");
  assert.deepEqual(s.list(), ["a", "b"]);
  assert.ok(s.exists("a") && s.exists("b") && !s.exists("c"));
});

test("a saved page deleted on disk drops out of the list; the picker's details and unusable names", () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, "bad|name.excalidraw"), "{}");
  const s = new PageStore(dir, { saveDelayMs: 10000 });
  s.merge("a", [rect("r"), { ...rect("f"), type: "frame" }], "agent");
  assert.deepEqual(s.summary("a"), { name: "a", rev: 2, frames: 1, modified: null }); // not saved yet
  s.save("a");
  assert.match(s.summary("a").modified, /^\d{4}-\d\d-\d\dT/);
  assert.deepEqual(s.skipped().map((f) => f.file), ["bad|name.excalidraw"]);
  fs.rmSync(path.join(dir, "a.excalidraw"));
  assert.deepEqual(s.list(), []);
});

test("rename moves the page, its log, bands and cursors; revisions continue", () => {
  const dir = tmpDir();
  const s = new PageStore(dir, { saveDelayMs: 10000 }); // the edit is still pending when we rename
  s.merge("old", [rect("r1", { link: "http://127.0.0.1:4747/?page=old&element=r1" })], "user");
  s.setBand("old", { name: "release", axis: "y", from: 1, to: 1 });
  s.changes("old", { since: "last", consumer: "me" });
  s.rename("old", "new");
  assert.ok(fs.existsSync(path.join(dir, "new.excalidraw")) && !fs.existsSync(path.join(dir, "old.excalidraw")));
  assert.deepEqual(s.list(), ["new"]);
  assert.equal(s.bands("new")[0].name, "release");
  const [e] = s.merge("new", [rect("r2")], "agent");
  assert.equal(e.rev, 2);
  assert.deepEqual(s.changes("new", { since: "last", consumer: "me" }).entries.map((x) => x.id), ["r2"]);
  assert.deepEqual(s.linksTo("old").map((l) => [l.page, l.id]), [["new", "r1"]]);
  const again = new PageStore(dir);
  assert.equal(again.changes("new").rev, 2);
  assert.throws(() => s.rename("nope", "x"), (err) => err.code === "unknown_page");
  s.merge("other", [rect("o")], "user");
  assert.throws(() => s.rename("new", "other"), (err) => err.code === "page_exists");
  assert.throws(() => s.rename("new", "../x"), (err) => err.code === "bad_page_name");
});

test("pages are served and saved in stacking (fractional index) order", async () => {
  const { byIndex } = await import("../src/lib/store.mjs");
  const els = [{ id: "c", index: "a2" }, { id: "a", index: "a0" }, { id: "x" }, { id: "b", index: "a1" }, { id: "Z", index: "Zz" }];
  assert.deepEqual(byIndex(els).map((e) => e.id), ["Z", "a", "b", "c", "x"]);
  const dir = tmpDir();
  const s = new PageStore(dir);
  s.merge("p", [rect("top", { index: "a5" }), rect("bottom", { index: "a1" })], "agent");
  assert.deepEqual(s.elements("p").map((e) => e.id), ["bottom", "top"]);
  s.flush();
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, "p.excalidraw"), "utf8")).elements.map((e) => e.id), ["bottom", "top"]);
});

// --- folders ---------------------------------------------------------------

const scene = JSON.stringify({ type: "excalidraw", version: 2, elements: [], appState: {}, files: {} });
const put = (dir, rel) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), scene); };

test("folders: pages in subfolders are listed by path; hidden folders, node_modules and symlinked folders aren't looked into", () => {
  const dir = tmpDir(), outside = tmpDir();
  for (const f of ["roadmap.excalidraw", "project-a/overview.excalidraw", "project-a/api.excalidraw", "project-b/research/interviews.excalidraw",
    ".git/x.excalidraw", "node_modules/pkg/y.excalidraw", "project-a/.hidden/z.excalidraw", "project-a/notes.txt", "project-a/bad|name.excalidraw"]) put(dir, f);
  put(outside, "secret.excalidraw");
  fs.symlinkSync(outside, path.join(dir, "linked"));
  const s = new PageStore(dir);
  assert.deepEqual(s.list(), ["project-a/api", "project-a/overview", "project-b/research/interviews", "roadmap"]);
  assert.deepEqual(s.skipped().map((f) => f.file), ["project-a/bad|name.excalidraw"]);
  assert.throws(() => s.load("linked/../../x"), (err) => err.code === "bad_page_name");
});

test("folders: a page is created in its folder, with its change log mirrored under .obeya/", () => {
  const dir = tmpDir();
  const s = new PageStore(dir, { saveDelayMs: 0 });
  s.create("project-a/overview");
  assert.ok(fs.existsSync(path.join(dir, "project-a", "overview.excalidraw")));
  s.merge("project-a/overview", [rect("r")], "user");
  assert.ok(fs.existsSync(path.join(dir, ".obeya", "project-a", "overview.changes.jsonl")));
  s.setBand("project-a/overview", { name: "line", axis: "y", from: 1, to: 1 });
  assert.ok(fs.existsSync(path.join(dir, ".obeya", "project-a", "overview.bands.json")));
  assert.equal(new PageStore(dir).changes("project-a/overview").rev, 1, "the log is found again after a restart");
});

test("folders: names that differ only in capitals are refused, for pages and folders", () => {
  const dir = tmpDir();
  const s = new PageStore(dir, { saveDelayMs: 0 });
  s.create("Roadmap");
  s.create("project-a/api");
  for (const n of ["roadmap", "Project-A/new"]) assert.throws(() => s.create(n), (err) => err.code === "page_exists" && /capitals/.test(err.message), n);
  assert.throws(() => s.rename("project-a/api", "PROJECT-A/api2"), (err) => err.code === "page_exists");
  s.create("project-a/new"); // the same folder, same capitals
});

test("folders: moving a page takes its log, bands and cursors; folders it leaves empty go away", () => {
  const dir = tmpDir();
  const s = new PageStore(dir, { saveDelayMs: 10000 });
  s.create("project-a/overview");
  s.merge("project-a/overview", [rect("r1")], "user");
  s.setBand("project-a/overview", { name: "release", axis: "y", from: 1, to: 1 });
  s.changes("project-a/overview", { since: "last", consumer: "me" });
  fs.writeFileSync(path.join(dir, "project-a", "README.md"), "kept");
  s.rename("project-a/overview", "project-b/research/overview");
  assert.ok(fs.existsSync(path.join(dir, "project-b", "research", "overview.excalidraw")));
  assert.ok(fs.existsSync(path.join(dir, "project-a")), "a folder with other files stays");
  assert.ok(!fs.existsSync(path.join(dir, ".obeya", "project-a")), "its empty sidecar folder goes");
  assert.deepEqual(s.list(), ["project-b/research/overview"]);
  assert.equal(s.bands("project-b/research/overview")[0].name, "release");
  assert.equal(s.merge("project-b/research/overview", [rect("r2")], "agent")[0].rev, 2);
  s.rename("project-b/research/overview", "top");
  assert.ok(!fs.existsSync(path.join(dir, "project-b")), "an emptied folder goes away");
});

test("delete: the page, its log and bands go to .obeya/.trash; cursors are dropped; the only page stays", () => {
  const dir = tmpDir();
  const s = new PageStore(dir, { saveDelayMs: 10000, now: () => "2026-11-09T10:00:00.000Z" });
  s.create("keep");
  s.create("project-a/gone");
  s.merge("project-a/gone", [rect("r")], "user"); // pending: saved into the trash
  s.setBand("project-a/gone", { name: "b", axis: "x", from: 0, to: 0 });
  s.changes("project-a/gone", { since: "last", consumer: "me" });
  const trash = s.delete("project-a/gone");
  assert.equal(path.relative(dir, trash), path.join(".obeya", ".trash", "2026-11-09T10-00-00-000Z"));
  assert.equal(JSON.parse(fs.readFileSync(path.join(trash, "project-a", "gone.excalidraw"), "utf8")).elements[0].id, "r");
  for (const f of ["gone.changes.jsonl", "gone.bands.json"]) assert.ok(fs.existsSync(path.join(trash, "project-a", f)), f);
  assert.ok(!fs.existsSync(path.join(dir, "project-a")), "the emptied folder goes away");
  assert.deepEqual(s.list(), ["keep"]);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, ".obeya", "cursors.json"), "utf8"))["project-a/gone"], undefined);
  assert.throws(() => s.delete("project-a/gone"), (err) => err.code === "unknown_page");
  assert.throws(() => s.delete("keep"), (err) => err.code === "last_page");
  s.create("project-a/gone"); // the name is free again
});

test("folders: a file stored in another Unicode form (NFD) is listed and opened by its NFC name", () => {
  const dir = tmpDir();
  put(dir, "Café/Idée.excalidraw");
  const s = new PageStore(dir);
  assert.deepEqual(s.list(), ["Café/Idée"]);
  assert.deepEqual(s.load("Café/Idée").scene.elements, []);
  assert.match(s.summary("Café/Idée").modified, /^\d{4}-/);
});

test("folders, from review: wrong capitals, symlinked folders, a folder named like a page, retired names", () => {
  const dir = tmpDir(), outside = tmpDir();
  const s = new PageStore(dir, { saveDelayMs: 0 });
  s.create("Roadmap");
  s.create("project-a/api");
  // A name in other capitals would open the same file on macOS as a second page.
  for (const n of ["roadmap", "PROJECT-A/api"]) assert.throws(() => s.load(n), (err) => err.code === "page_exists", n);
  assert.equal(s.load("Roadmap").scene.elements.length, 0, "the page itself still loads");
  // Nothing is read or written through a symlinked folder.
  put(outside, "secret.excalidraw");
  fs.symlinkSync(outside, path.join(dir, "linked"));
  for (const op of [() => s.load("linked/secret"), () => s.create("linked/x"), () => s.rename("Roadmap", "linked/r")]) {
    assert.throws(op, (err) => err.code === "bad_page_name");
  }
  assert.deepEqual(fs.readdirSync(outside), ["secret.excalidraw"]);
  // A folder that happens to end in .excalidraw isn't a page.
  fs.mkdirSync(path.join(dir, "odd.excalidraw"));
  assert.equal(s.exists("odd"), false);
  assert.deepEqual(s.load("odd").scene.elements, []);
  // Deleted or renamed-away names are retired (tabs can't sync them back); making one again revives it.
  s.rename("project-a/api", "project-a/api2");
  s.delete("project-a/api2");
  assert.ok(s.retired("project-a/api") && s.retired("project-a/api2"));
  s.create("project-a/api2");
  assert.ok(!s.retired("project-a/api2"));
  s.revive("project-a/api");
  assert.ok(!s.retired("project-a/api"));
});

test("images: file data no live image uses is dropped when the page is saved", () => {
  const dir = tmpDir();
  const s = new PageStore(dir, { saveDelayMs: 0 });
  const file = (id) => ({ id, mimeType: "image/png", dataURL: "data:image/png;base64,AA" });
  s.merge("p", [{ ...rect("i1"), type: "image", fileId: "f1" }, { ...rect("i2"), type: "image", fileId: "f2" }], "agent");
  s.addFiles("p", { f1: file("f1"), f2: file("f2"), f3: file("f3") });
  s.save("p");
  const saved = () => Object.keys(JSON.parse(fs.readFileSync(path.join(dir, "p.excalidraw"), "utf8")).files).sort();
  assert.deepEqual(saved(), ["f1", "f2"], "f3 is used by nothing");
  s.merge("p", [{ ...rect("i2"), type: "image", fileId: "f2", isDeleted: true, version: 2 }], "user");
  s.save("p");
  assert.deepEqual(saved(), ["f1"], "a deleted image's data goes too");
});
