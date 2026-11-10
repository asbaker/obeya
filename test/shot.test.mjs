// `shot` with no tab open and no Chrome: the official Excalidraw CLI fallback,
// simulated with stand-in programs on PATH (no browser needed).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { run } from "../src/cli/main.mjs";
import { freePort, tmpDir } from "./helpers/env.mjs";

const PNG_1x1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const stops = [];
after(async () => {
  for (const env of stops) await run(["stop"], { env });
});

async function setup({ official = "real" } = {}) {
  const dir = tmpDir();
  const bin = path.join(dir, "bin");
  fs.mkdirSync(bin);
  const calls = path.join(dir, "calls.jsonl");
  if (official === "real") {
    // Behaves like `excalidraw render` from @excalidraw/cli: help text, stdin scene, --out file.
    fs.writeFileSync(path.join(bin, "excalidraw"), `#!/usr/bin/env node
const fs = require("fs");
const args = process.argv.slice(2);
if (args.includes("--help")) { console.log("Excalidraw CLI  render"); process.exit(0); }
let input = ""; process.stdin.on("data", (d) => (input += d)).on("end", () => {
  fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify({ args, elements: JSON.parse(input).elements.length }) + "\\n");
  fs.writeFileSync(args[args.indexOf("--out") + 1], Buffer.from(${JSON.stringify(PNG_1x1)}, "base64"));
});
`, { mode: 0o755 });
  } else if (official === "impostor") {
    fs.writeFileSync(path.join(bin, "excalidraw"), "#!/bin/sh\necho 'some other tool'\nexit 0\n", { mode: 0o755 });
  }
  const pages = path.join(dir, "canvas");
  fs.mkdirSync(pages);
  fs.writeFileSync(path.join(pages, "board.excalidraw"), JSON.stringify({
    type: "excalidraw", version: 2, source: "test", appState: {}, files: {},
    elements: [
      { id: "f1", type: "frame", name: "One", x: 0, y: 0, width: 300, height: 200, version: 1, versionNonce: 1, isDeleted: false },
      { id: "r1", type: "rectangle", x: 20, y: 20, width: 100, height: 60, frameId: "f1", version: 1, versionNonce: 1, isDeleted: false },
    ],
  }));
  const env = {
    ...process.env,
    PATH: `${bin}${path.delimiter}${process.env.PATH}`,
    CHROME_PATH: path.join(dir, "no-chrome-here"), // simulate a machine without Chrome
    OBEYA_DIR: pages,
    OBEYA_PORT: String(await freePort()),
  };
  stops.push(env);
  return { dir, env, calls };
}

test("no tab, no Chrome: shot uses the official CLI with --fonts-url none and the scene on stdin", async () => {
  const { dir, env, calls } = await setup();
  const out = path.join(dir, "f1.png");
  const r = await run(["shot", "board", "--frame", "f1", "--scale", "2", "--out", out, "--no-open"], { env });
  assert.equal(r.code, 0, r.stdout);
  const res = JSON.parse(r.stdout).result;
  assert.equal(res.renderer, "excalidraw-cli");
  assert.deepEqual([res.width, res.height], [1, 1]);
  assert.equal(fs.readFileSync(out).subarray(1, 4).toString(), "PNG");
  const [call] = fs.readFileSync(calls, "utf8").trim().split("\n").map(JSON.parse);
  assert.equal(call.args[0], "render");
  assert.equal(call.args[1], "-");
  for (const [flag, value] of [["--fonts-url", "none"], ["--frame-id", "f1"], ["--scale", "2"], ["--format", "png"]]) {
    assert.equal(call.args[call.args.indexOf(flag) + 1], value, flag);
  }
  assert.equal(call.elements, 2);
  assert.equal(JSON.parse((await run(["shot", "board", "--frame", "nope", "--no-open"], { env })).stdout).error.code, "unknown_element");
});

test("no tab, no Chrome, no official CLI: --no-open exits 2 with the link", async () => {
  for (const official of ["none", "impostor"]) {
    const { env } = await setup({ official });
    const r = await run(["shot", "board", "--no-open"], { env });
    assert.equal(r.code, 2, `${official}: ${r.stdout}`);
    assert.equal(JSON.parse(r.stdout).error.code, "no_canvas_open");
  }
});
