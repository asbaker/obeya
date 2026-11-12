// The CLI's contract with agents: envelope, error codes, exit codes, help.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { run } from "../src/cli/main.mjs";
import { freePort, tmpDir } from "./helpers/env.mjs";

const BIN = path.resolve("bin/obeya.mjs");
const cleanup = [];
after(async () => {
  for (const f of cleanup) await f();
});

async function envFor(sub = "canvas") {
  const dir = tmpDir();
  const port = await freePort();
  const env = { ...process.env, OBEYA_DIR: path.join(dir, sub), OBEYA_PORT: String(port) };
  cleanup.push(() => run(["stop"], { env }));
  return { dir, port, env };
}

test("--help is a short overview listing every command", async () => {
  const r = await run(["--help"]);
  assert.equal(r.code, 0);
  for (const cmd of ["serve", "status", "stop", "open", "pages", "get", "describe", "lint", "patch", "changes", "shot", "show"]) {
    assert.match(r.stdout, new RegExp(`obeya ${cmd}\\b`));
  }
  assert.match(r.stdout, /--skill/);
  assert.match(r.stdout.split("\n")[0], /^obeya — a canvas you share with your AI agent$/);
  assert.equal((await run([])).stdout, r.stdout);
});

test("<command> --help prints that command's help", async () => {
  const r = await run(["patch", "--help"]);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /^Usage: obeya patch <page> --file <path\|->/);
});

test("--skill prints the core with frontmatter; --skill all carries the whole guide; no local paths", async () => {
  const r = await run(["--skill"]);
  assert.equal(r.code, 0);
  const m = /^---\nname: obeya\ndescription: "(.+)"\n---\n/.exec(r.stdout);
  assert.ok(m, "frontmatter with name and description");
  for (const topic of ["--no-open", "exit", "skeleton", "frame", "--skill patch", "obeya changes", "obeya wait", "lint", "shot", "Never write `.excalidraw` files"]) {
    assert.ok(r.stdout.includes(topic), `core mentions ${topic}`);
  }
  const all = await run(["--skill", "all"]);
  assert.equal(all.code, 0);
  assert.ok(all.stdout.startsWith(r.stdout), "all starts with the core");
  for (const topic of ["stickynote", "arrow", "--since <rev>", "pointsAt", "Present", "export", "--format pdf", "library insert", "staleLinks", "--idle-timeout", "127.0.0.1"]) {
    assert.ok(all.stdout.includes(topic), `the guide mentions ${topic}`);
  }
  assert.doesNotMatch(all.stdout, /\/Users\/|\/home\/|[A-Z]:\\\\|@[a-z0-9-]+\.[a-z]{2,}/i);
});

test("--skill <topic> prints one topic; an unknown topic is an error that lists them", async () => {
  const r = await run(["--skill", "wait"]);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /^# Asking the person/);
  const bad = await run(["--skill", "nope"]);
  assert.equal(bad.code, 1);
  const e = JSON.parse(bad.stdout).error;
  assert.equal(e.code, "unknown_topic");
  assert.ok(e.hint);
  assert.ok(e.topics.includes("patch") && e.topics.includes("export"));
});

test("errors carry a hint", async () => {
  const r = await run(["patch", "board"]);
  const e = JSON.parse(r.stdout).error;
  assert.equal(e.code, "missing_argument");
  assert.equal(typeof e.hint, "string");
});

test("a mutating command with missing arguments prints help and does nothing", async () => {
  const { env, dir } = await envFor();
  const r = await run(["patch", "board"], { env, stdin: () => assert.fail("must not read stdin") });
  assert.equal(r.code, 1);
  const out = JSON.parse(r.stdout);
  assert.equal(out.id, undefined);
  assert.equal(out.error.code, "missing_argument");
  assert.equal(out.error.usage, "obeya patch <page> --file <path|->");
  assert.equal(r.stderr, "", "the usage once, in the envelope");
  assert.ok(!fs.existsSync(path.join(dir, "canvas")), "no server started, no dir created");
});

test("envelope: {result} on success, one compact line", async () => {
  const { env } = await envFor();
  const r = await run(["status"], { env });
  assert.deepEqual(Object.keys(JSON.parse(r.stdout)), ["result"]);
  assert.equal(r.stdout.includes("\n"), false, "compact: no pretty-printing");
  assert.ok(JSON.parse(r.stdout).result);
  assert.equal(JSON.parse(r.stdout).result.running, false);
});

test("--no-open on a live command: exit 2, no_canvas_open, a plain link", async () => {
  const { env, dir } = await envFor();
  const patch = path.join(dir, "p.json");
  fs.writeFileSync(patch, JSON.stringify({ skeleton: [] }));
  const r = await run(["patch", "board", "--file", patch, "--no-open"], { env });
  assert.equal(r.code, 2);
  const { error } = JSON.parse(r.stdout);
  assert.equal(error.code, "no_canvas_open");
  assert.match(error.url, /^http:\/\/127\.0\.0\.1:\d+\/\?page=board$/);
});

test("a bad patch file fails before anything starts", async () => {
  const { env, dir } = await envFor();
  fs.writeFileSync(path.join(dir, "bad.json"), "{nope");
  const r = await run(["patch", "board", "--file", path.join(dir, "bad.json")], { env });
  assert.equal(JSON.parse(r.stdout).error.code, "invalid_patch");
  assert.equal(JSON.parse((await run(["status"], { env })).stdout).result.running, false);
});

test("port_in_use_other_dir: refuses a port serving another dir", async () => {
  const a = await envFor("a");
  const served = await run(["serve"], { env: a.env });
  assert.equal(served.code, 0, served.stdout + served.stderr);
  const other = { ...a.env, OBEYA_DIR: path.join(a.dir, "b") };
  const r = await run(["pages"], { env: other });
  assert.equal(r.code, 1);
  assert.equal(JSON.parse(r.stdout).error.code, "port_in_use_other_dir");
  assert.equal(JSON.parse((await run(["stop"], { env: other })).stdout).error.code, "port_in_use_other_dir");
});

test("the same dir through a symlink is the same canvas", async () => {
  const a = await envFor("real");
  fs.mkdirSync(path.join(a.dir, "real"), { recursive: true });
  fs.symlinkSync(path.join(a.dir, "real"), path.join(a.dir, "link"));
  const served = await run(["serve"], { env: a.env });
  assert.equal(served.code, 0, served.stdout + served.stderr);
  const r = await run(["pages"], { env: { ...a.env, OBEYA_DIR: path.join(a.dir, "link") } });
  assert.equal(r.code, 0, r.stdout);
});

test("port_in_use: something else owns the port", async () => {
  const { env, port } = await envFor();
  const foreign = http.createServer((_, res) => res.end("hello")).listen(port, "127.0.0.1");
  cleanup.push(() => new Promise((r) => foreign.close(r)));
  await new Promise((r) => foreign.once("listening", r));
  const res = await run(["pages"], { env });
  assert.equal(JSON.parse(res.stdout).error.code, "port_in_use");
});

test("the bin prints the envelope on stdout and sets the exit code", async () => {
  let status = 0, stdout = "";
  try {
    execFileSync(process.execPath, [BIN, "draw"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    status = e.status;
    stdout = e.stdout;
  }
  assert.equal(status, 1);
  assert.equal(JSON.parse(stdout).error.code, "unknown_command");
});

test("a command group without a subcommand prints the group's help and does nothing", async () => {
  const { env, dir } = await envFor();
  const r = await run(["band"], { env });
  assert.equal(r.code, 0);
  assert.match(r.stdout, /^obeya band commands:/);
  assert.match(r.stdout, /band set <page> <name>/);
  assert.ok(!fs.existsSync(path.join(dir, "canvas")));
});

test("rename: needs no tab; errors; reports links that still name the old page", async () => {
  const { env, dir } = await envFor();
  fs.mkdirSync(path.join(dir, "canvas"), { recursive: true });
  const page = (els) => JSON.stringify({ type: "excalidraw", version: 2, elements: els, appState: {}, files: {} });
  fs.writeFileSync(path.join(dir, "canvas", "a.excalidraw"), page([{ id: "go", type: "rectangle", x: 0, y: 0, width: 1, height: 1, version: 1, link: "http://127.0.0.1:4747/?page=a&element=f" }]));
  fs.writeFileSync(path.join(dir, "canvas", "b.excalidraw"), page([]));
  const j = async (...a) => JSON.parse((await run(a, { env })).stdout);
  const r = await j("rename", "a", "c", "--no-open");
  assert.ok(r.result);
  assert.deepEqual(r.result.staleLinks.map((l) => [l.page, l.id]), [["c", "go"]]);
  assert.deepEqual((await j("pages")).result.pages.map((p) => p.name), ["b", "c"]);
  assert.equal((await j("rename", "c", "b")).error.code, "page_exists");
  assert.equal((await j("rename", "zzz", "y")).error.code, "unknown_page");
  assert.equal((await j("rename", "c", "a|b")).error.code, "invalid_argument");
});

test("lint: needs no tab; findings for a page or a frame; --rule; errors", async () => {
  const { env, dir } = await envFor();
  fs.mkdirSync(path.join(dir, "canvas"), { recursive: true });
  const el = (o) => ({ type: "rectangle", width: 100, height: 60, version: 1, backgroundColor: "transparent", ...o });
  fs.writeFileSync(path.join(dir, "canvas", "a.excalidraw"), JSON.stringify({ type: "excalidraw", version: 2, appState: {}, files: {}, elements: [
    { id: "f", type: "frame", x: 0, y: 0, width: 300, height: 200, version: 1, name: "F" },
    el({ id: "out", x: 250, y: 20, frameId: "f" }),
    el({ id: "a", x: 1000, y: 0 }), el({ id: "b", x: 1050, y: 30 }),
  ] }));
  const j = async (...a) => JSON.parse((await run(a, { env })).stdout);
  const all = await j("lint", "a", "--no-open");
  assert.deepEqual(all.result.findings.map((f) => f.rule).sort(), ["outside-frame", "overlap"]);
  assert.deepEqual((await j("lint", "a", "--frame", "f")).result.findings.map((f) => f.ids), [["out"]]);
  assert.deepEqual((await j("lint", "a", "--rule", "overlap")).result.findings.map((f) => f.ids), [["a", "b"]]);
  assert.equal((await j("lint", "a", "--rule", "bogus")).error.code, "invalid_argument");
  assert.equal((await j("lint", "a", "--frame", "nope")).error.code, "unknown_element");
  assert.equal((await j("lint", "zzz")).error.code, "unknown_page");
});
