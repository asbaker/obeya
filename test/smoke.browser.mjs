// Browser smoke test. Optional: needs a local Chrome or Chromium.
//
//   npm run test:smoke            (CHROME_PATH=… to pick a browser)
//
// Drives the person's side with real mouse input in headless Chrome, and the
// agent's side through the real CLI binary. A stand-in `open`/`xdg-open` is put
// first on PATH so the CLI's "open in browser" lands in headless Chrome rather
// than the developer's own browser.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { freePort, sleep, tmpDir } from "./helpers/env.mjs";
import { startCatalogue } from "./helpers/catalogue.mjs";

const BIN = path.resolve("bin/obeya.mjs");

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
  ];
  for (const name of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]) {
    try {
      candidates.push(execFileSync("which", [name], { encoding: "utf8" }).trim());
    } catch {}
  }
  return candidates.find((c) => c && fs.existsSync(c)) ?? null;
}

const CHROME = findChrome();
let chromium = null;
try {
  ({ chromium } = await import("playwright-core"));
} catch {}
const skip = !CHROME ? "no Chrome or Chromium found (set CHROME_PATH)" : !chromium ? "playwright-core not installed (npm install)" : false;

const S = {}; // shared state

/** Run the real CLI binary. */
function cli(args, { stdin } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [BIN, ...args], { env: S.env, stdio: ["pipe", "pipe", "pipe"] });
    let out = "", err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.stdin.end(stdin ?? "");
    child.on("close", (code) => {
      let json = null;
      try { json = JSON.parse(out); } catch {}
      resolve({ code, json, stdout: out, stderr: err });
    });
  });
}

async function until(fn, { timeout = 15000, every = 200, what = "condition" } = {}) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    last = await Promise.resolve().then(fn).catch(() => null); // e.g. the page is reloading
    if (last) return last;
    await sleep(every);
  }
  throw new Error(`timed out waiting for ${what}`);
}

before(async () => {
  if (skip) return;
  S.tmp = tmpDir("xl-smoke-");
  S.port = await freePort();
  S.cdpPort = await freePort();
  S.opened = path.join(S.tmp, "opened.txt");

  // Stand-in browser openers: record the URL instead of opening the real browser.
  const bin = path.join(S.tmp, "bin");
  fs.mkdirSync(bin);
  for (const name of ["open", "xdg-open"]) {
    fs.writeFileSync(path.join(bin, name), `#!/bin/sh\nprintf '%s\\n' "$1" >> "${S.opened}"\n`, { mode: 0o755 });
  }
  S.catalogue = await startCatalogue(); // a local stand-in for the public library catalogue
  S.env = {
    ...process.env,
    OBEYA_CATALOGUE_URL: S.catalogue.url,
    OBEYA_CACHE: path.join(S.tmp, "cache"),
    PATH: `${bin}${path.delimiter}${process.env.PATH}`,
    OBEYA_DIR: path.join(S.tmp, "canvas"),
    OBEYA_PORT: String(S.port),
    OBEYA_CONSUMER: "smoke",
  };

  S.chrome = spawn(CHROME, [
    "--headless=new",
    `--remote-debugging-port=${S.cdpPort}`,
    `--user-data-dir=${path.join(S.tmp, "profile")}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--window-size=1600,1000",
    "about:blank",
  ], { stdio: "ignore" });
  S.browser = await until(() => chromium.connectOverCDP(`http://127.0.0.1:${S.cdpPort}`).catch(() => null), { what: "Chrome DevTools" });
  S.context = S.browser.contexts()[0];
  S.requests = [];
  S.context.on("request", (r) => S.requests.push({ url: r.url(), method: r.method(), hasBody: Boolean(r.postDataBuffer()?.length) }));
  S.errors = [];
  S.context.on("response", (r) => r.status() >= 400 && S.errors.push(`${r.status()} ${r.request().method()} ${r.url()}`));
  S.page = S.context.pages()[0] ?? (await S.context.newPage());
  await S.page.setViewportSize({ width: 1600, height: 1000 });
  S.page.on("pageerror", (e) => console.error("page error:", e.message));
});

after(async () => {
  if (skip) return;
  await cli(["stop"]).catch(() => {});
  await S.browser?.close().catch(() => {});
  S.chrome?.kill();
  await S.catalogue?.close();
});

// --- helpers on the person's side ---------------------------------------------------
const T = (fn, ...args) => S.page.evaluate(([f, a]) => window.obeyaTest[f](...a), [fn, args]);
const el = async (id) => (await T("elements")).find((e) => e.id === id);
const client = (x, y) => T("toClient", x, y);
const center = (e) => [e.x + e.width / 2, e.y + e.height / 2];

async function drag([x1, y1], [x2, y2], steps = 12) {
  const a = await client(x1, y1), b = await client(x2, y2);
  await S.page.mouse.move(a.x, a.y);
  await S.page.mouse.down();
  for (let i = 1; i <= steps; i++) await S.page.mouse.move(a.x + ((b.x - a.x) * i) / steps, a.y + ((b.y - a.y) * i) / steps);
  await S.page.mouse.up();
}
async function stroke(points) {
  const pts = [];
  for (const [x, y] of points) pts.push(await client(x, y));
  await S.page.mouse.move(pts[0].x, pts[0].y);
  await S.page.mouse.down();
  for (const p of pts.slice(1)) await S.page.mouse.move(p.x, p.y, { steps: 6 });
  await S.page.mouse.up();
}
const tool = (name) => S.page.click(`[data-testid=toolbar-${name}]`);

// The agent's first patch: two frames of sticky notes, a bound arrow, a prototype link.
const seed = () => ({
  skeleton: [
    { type: "frame", id: "f1", x: 0, y: 0, width: 1200, height: 700, name: "01 Board", children: ["n1", "n2", "n3", "n4", "a1", "go"] },
    { type: "stickynote", id: "n1", x: 40, y: 60, width: 200, height: 200, label: { text: "Login" } },
    { type: "stickynote", id: "n2", x: 320, y: 60, width: 200, height: 200, label: { text: "Search" } },
    { type: "stickynote", id: "n3", x: 600, y: 60, width: 200, height: 200, label: { text: "Checkout" } },
    { type: "stickynote", id: "n4", x: 880, y: 60, width: 200, height: 200, label: { text: "Receipt" } },
    { type: "arrow", id: "a1", x: 240, y: 160, start: { id: "n1" }, end: { id: "n2" } },
    { type: "rectangle", id: "go", x: 960, y: 560, width: 180, height: 80, link: `http://127.0.0.1:${S.port}/?element=f2`, label: { text: "Next" } },
    { type: "frame", id: "f2", x: 1400, y: 0, width: 600, height: 400, name: "02 Next", children: ["n5"] },
    { type: "stickynote", id: "n5", x: 1440, y: 60, width: 200, height: 200, label: { text: "Done" } },
  ],
});

test("full loop: agent patch, the person's edits, changes, shot, present, stop", { skip }, async (t) => {
  // 1. No tab yet: the CLI starts the server, "opens" a tab (the stand-in records
  //    the link), and waits. We load the link in headless Chrome.
  const patching = cli(["patch", "board", "--file", "-"], { stdin: JSON.stringify(seed()) });
  const link = await until(() => fs.existsSync(S.opened) && fs.readFileSync(S.opened, "utf8").trim().split("\n")[0], { what: "the CLI to open a link" });
  assert.match(link, new RegExp(`^http://127\\.0\\.0\\.1:${S.port}/\\?page=board$`)); // a plain link: no token
  const u = new URL(link);
  u.searchParams.set("test", "1");
  await S.page.goto(u.href);
  const patched = await patching;
  assert.equal(patched.code, 0, patched.stdout + patched.stderr);
  assert.equal(patched.json.id, undefined, "no id in the envelope");
  // A short response: counts, not an echo of what was sent.
  assert.ok(patched.json.result.created >= 9 && Number.isInteger(patched.json.result.changed), JSON.stringify(patched.json.result));
  const made = new Set((await cli(["get", "board"])).json.result.elements.map((e) => e.id));
  for (const id of ["f1", "n1", "n2", "n3", "n4", "a1", "go", "f2", "n5"]) assert.ok(made.has(id), `created ${id}`);
  assert.equal(patched.json.result.createdPage, true);

  // Moving a labelled note with an edit moves its label too.
  const before = (await T("elements")).find((e) => e.containerId === "n5");
  assert.equal((await cli(["patch", "board", "--file", "-"], { stdin: JSON.stringify({ elements: [{ id: "n5", x: 1440 + 100, y: 60 + 50 }] }) })).code, 0);
  const after = (await T("elements")).find((e) => e.containerId === "n5");
  assert.ok(Math.abs(after.x - before.x - 100) < 1 && Math.abs(after.y - before.y - 50) < 1, `label followed: ${before.x},${before.y} -> ${after.x},${after.y}`);
  const n5 = (await T("elements")).find((e) => e.id === "n5");
  assert.ok(n5.boundElements?.some((b) => b.id === after.id), "the note still owns its label after an edit");
  // Relabeling through an edit of the label keeps it attached to its note.
  assert.equal((await cli(["patch", "board", "--file", "-"], { stdin: JSON.stringify({ elements: [{ id: after.id, text: "Done!", originalText: "Done!" }] }) })).code, 0);
  const relabeled = (await T("elements")).find((e) => e.id === after.id);
  assert.equal(relabeled.containerId, "n5", "label still attached after a text edit");
  assert.equal((await cli(["get", "board"])).json.result.elements.find((e) => e.id === "n5").text, "Done!");
  assert.equal((await cli(["patch", "board", "--file", "-"], { stdin: JSON.stringify({ elements: [{ id: "n5", x: 1440, y: 60 }] }) })).code, 0);

  // The same id twice in one patch is one edit, not a copy.
  const twice = await cli(["patch", "board", "--file", "-"], { stdin: JSON.stringify({ elements: [{ id: "n5", x: 1460 }, { id: "n5", customData: { twice: true } }] }) });
  assert.equal(twice.code, 0, twice.stdout);
  const fives = (await T("elements")).filter((e) => e.type === "stickynote" && !e.isDeleted && (e.id === "n5" || e.customData?.twice));
  assert.deepEqual(fives.map((e) => [e.id, e.x, e.customData?.twice]), [["n5", 1460, true]]);
  assert.equal((await cli(["patch", "board", "--file", "-"], { stdin: JSON.stringify({ elements: [{ id: "n5", x: 1440 }] }) })).code, 0);

  // Re-applying a skeleton to a labelled note replaces its label; no orphan is left behind.
  const again = await cli(["patch", "board", "--file", "-"], { stdin: JSON.stringify({ skeleton: [seed().skeleton.find((e) => e.id === "n4")].map((e) => ({ ...e, label: { text: "Receipt v2" } })) }) });
  assert.equal(again.code, 0, again.stdout);
  const labels = (await T("elements")).filter((e) => e.type === "text" && e.containerId === "n4");
  assert.deepEqual(labels.map((e) => e.text), ["Receipt v2"]);
  const n4 = (await cli(["get", "board"])).json.result.elements.find((e) => e.id === "n4");
  assert.equal(n4.text, "Receipt v2");

  const arrow = await el("a1");
  assert.equal(arrow.startBinding?.elementId, "n1");
  assert.equal(arrow.endBinding?.elementId, "n2");

  // 2. Point the view at the board, then edit like a person would.
  assert.equal((await cli(["show", "board", "--frame", "f1"])).code, 0);
  await sleep(300);
  // `show` fits the frame below the toolbar: its top edge must be clickable.
  const f1 = await el("f1");
  const top = await client(f1.x + f1.width / 2, f1.y);
  const hit = await S.page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.tagName, [top.x, top.y + 2]);
  assert.equal(hit, "CANVAS", "frame top not covered by the toolbar");
  const n1 = await el("n1");

  await t.test("move a note", async () => {
    await drag(center(n1), [center(n1)[0], center(n1)[1] + 300]);
    await S.page.keyboard.press("Escape");
  });
  await t.test("the bound arrow follows the moved note", async () => {
    const a = await until(async () => { const a = await el("a1"); return a.y > arrow.y + 50 ? a : null; }, { what: "arrow re-route", timeout: 3000 });
    assert.equal(a.startBinding?.elementId, "n1");
  });
  await t.test("draw an ellipse around a note", async () => {
    await tool("ellipse");
    await drag([290, 30], [550, 290]);
    await S.page.keyboard.press("Escape");
  });
  await t.test("add a sticky note comment with text, overlapping a note", async () => {
    await tool("stickynote");
    const p = await client(760, 290); // a 250x250 sticky centred here covers ~40% of n3
    await S.page.mouse.click(p.x, p.y);
    await S.page.waitForSelector("textarea", { timeout: 5000 });
    await S.page.keyboard.type("Needs SSO");
    await S.page.keyboard.press("Escape");
  });
  await t.test("scribble across a note with the pen", async () => {
    await tool("freedraw");
    await stroke([[900, 100], [960, 180], [1000, 90], [1050, 200], [1070, 120]]);
    await tool("selection");
  });

  // 3. `changes --source user` reports exactly those four, with the right pointsAt.
  const changes = async () => (await cli(["changes", "board", "--since", "0"])).json.result.changes; // the person's, by default
  try {
    await until(async () => (await changes()).length >= 4, { what: "four user changes" });
  } catch (err) {
    await S.page.screenshot({ path: path.join(S.tmp, "failure.png") });
    throw new Error(`${err.message}; got ${JSON.stringify(await changes(), null, 1)}; screenshot in the temp dir`);
  }
  await sleep(1000); // nothing else trickles in
  const all = await changes();
  assert.equal(all.length, 4, JSON.stringify(all, null, 2));
  const [move, ellipse, sticky, pen] = [
    all.find((c) => c.id === "n1"),
    all.find((c) => c.type === "ellipse"),
    all.find((c) => c.type === "stickynote" && c.id !== "n1"),
    all.find((c) => c.type === "freedraw"),
  ];
  assert.ok(move && ellipse && sticky && pen, JSON.stringify(all, null, 2));
  assert.equal(move.op, "modified");
  assert.ok(Math.abs(move.moved.from[1] - n1.y) <= 2 && Math.abs(move.moved.to[1] - (n1.y + 300)) <= 3, JSON.stringify(move.moved));
  assert.ok(Math.abs(move.moved.to[0] - move.moved.from[0]) <= 3);
  assert.equal(move.text, "Login");
  assert.equal(ellipse.op, "added");
  assert.deepEqual(ellipse.pointsAt?.map((p) => p.id), ["n2"]);
  assert.equal(ellipse.pointsAt[0].text, "Search");
  assert.equal(sticky.op, "added");
  assert.equal(sticky.text, "Needs SSO");
  assert.deepEqual(sticky.pointsAt?.map((p) => p.id), ["n3"]);
  assert.equal(pen.op, "added");
  assert.deepEqual(pen.pointsAt?.map((p) => p.id), ["n4"]);
  for (const c of all) assert.equal(c.source, undefined, "brief: no source when only the person's are asked for");

  // --since last: everything once, then nothing.
  assert.equal((await cli(["changes", "board", "--since", "last", "--source", "user"])).json.result.changes.length, 4);
  assert.equal((await cli(["changes", "board", "--since", "last"])).json.result.changes.length, 0);

  // 4. shot produces a PNG.
  const png = path.join(S.tmp, "shots", "f1.png");
  const shot = await cli(["shot", "board", "--frame", "f1", "--out", png]);
  assert.equal(shot.code, 0, shot.stdout);
  assert.deepEqual([...fs.readFileSync(png).subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.ok(shot.json.result.width > 200 && shot.json.result.height > 100);
  assert.equal(shot.json.result.renderer, "tab");
  // --around crops to some elements plus a margin: much smaller than their frame.
  const near = await cli(["shot", "board", "--around", "n1,n2", "--out", path.join(S.tmp, "shots", "near.png")]);
  assert.equal(near.code, 0, near.stdout);
  assert.deepEqual(near.json.result.around, ["n1", "n2"]);
  assert.ok(near.json.result.width > 400 && near.json.result.width < shot.json.result.width, `around: ${near.json.result.width} vs frame ${shot.json.result.width}`);
  assert.ok(near.json.result.height > 200 && near.json.result.height < shot.json.result.height);
  // Ids spread across most of a frame: the frame itself, and the result says so.
  const wide = await cli(["shot", "board", "--around", "n1,n3,go", "--out", path.join(S.tmp, "shots", "wide.png")]);
  assert.equal(wide.json.result.widenedTo, "f1", wide.stdout);
  assert.equal(wide.json.result.frame, "f1");
  assert.equal(near.json.result.widenedTo, undefined, "n1,n2 stays a crop");
  // Uncapped with an explicit --scale; capped otherwise.
  const big = await cli(["shot", "board", "--scale", "3", "--out", path.join(S.tmp, "shots", "big.png")]);
  const capped = await cli(["shot", "board", "--out", path.join(S.tmp, "shots", "capped.png")]);
  assert.ok(capped.json.result.width <= 1568 && capped.json.result.width * capped.json.result.height <= 1.16e6, JSON.stringify(capped.json.result));
  assert.ok(big.json.result.width > capped.json.result.width);

  // 5. Present starts at the first frame in slide order, even when the view is on another one.
  await S.page.keyboard.press("Escape"); // nothing selected
  assert.equal((await cli(["show", "board", "--frame", "f2"])).code, 0);
  await sleep(300);
  assert.deepEqual(await T("framesInOrder"), ["f1", "f2"]);
  await S.page.click("[data-testid=present-toggle]");
  await until(() => T("focusedFrame").then((f) => f === "f1"), { what: "presenting starts on f1" });
  await until(() => T("tool").then((t) => t === "laser"), { what: "presenting hands over the laser pointer" });
  // Next / previous in slide order: keys and buttons.
  assert.equal(await S.page.textContent("[data-testid=present-pos]"), "1 / 2");
  await S.page.keyboard.press("ArrowRight");
  await until(() => T("focusedFrame").then((f) => f === "f2"), { what: "→ goes to the next frame", timeout: 5000 });
  assert.equal(await S.page.textContent("[data-testid=present-pos]"), "2 / 2");
  await S.page.click("[data-testid=present-prev]");
  await until(() => T("focusedFrame").then((f) => f === "f1"), { what: "‹ goes back", timeout: 5000 });
  // Esc stops presenting, and the page's own UI comes back.
  await S.page.click("[data-testid=present-next]");
  await until(() => T("focusedFrame").then((f) => f === "f2"), { what: "› goes on", timeout: 5000 });
  await S.page.keyboard.press("Escape");
  await until(() => T("present").then((p) => p === false), { what: "Esc stops presenting" });
  await until(() => T("tool").then((t) => t === "selection"), { what: "stopping gives back the selection tool" });
  assert.equal(await T("focusedFrame"), null);
  assert.ok(await S.page.isVisible("[data-testid=present-toggle]"));
  // Stepping out to annotate and back in resumes on the same frame, not the first.
  await S.page.keyboard.press("Shift+Alt+KeyP");
  await until(() => T("focusedFrame").then((f) => f === "f2"), { what: "Shift+Alt+P resumes on f2", timeout: 5000 });
  await S.page.click("[data-testid=present-exit]");
  await until(() => T("present").then((p) => p === false), { what: "Exit stops presenting" });

  // A hotspot made of an unfilled, transparent rectangle with text on top: clicking the text follows the link.
  const hot = await cli(["patch", "board", "--file", "-"], { stdin: JSON.stringify({ skeleton: [
    { type: "rectangle", id: "hot", x: 640, y: 560, width: 240, height: 70, strokeColor: "transparent", backgroundColor: "transparent", link: `http://127.0.0.1:${S.port}/?page=board&element=f2` },
    { type: "text", id: "hot-text", x: 680, y: 580, text: "Go to next", fontSize: 20 },
  ] }) });
  assert.equal(hot.code, 0, hot.stdout);
  assert.equal((await cli(["patch", "board", "--file", "-"], { stdin: JSON.stringify({ elements: [{ id: "hot", frameId: "f1" }, { id: "hot-text", frameId: "f1" }] }) })).code, 0);
  assert.equal((await cli(["show", "board", "--frame", "f1"])).code, 0);
  await sleep(300);
  await S.page.click("[data-testid=present-toggle]");
  await until(() => T("focusedFrame").then((f) => f === "f1"), { what: "presenting on f1" });
  const ht = await el("hot-text");
  const hp = await client(ht.x + ht.width / 2, ht.y + ht.height / 2);
  await S.page.mouse.click(hp.x, hp.y);
  await until(() => T("focusedFrame").then((f) => f === "f2"), { what: "click on text over a hotspot follows its link", timeout: 5000 });
  await S.page.click("[data-testid=present-exit]");
  assert.equal((await cli(["patch", "board", "--file", "-"], { stdin: JSON.stringify({ delete: ["hot", "hot-text"] }) })).code, 0);

  // Frame isolation, then a link click moves to the next frame.
  assert.equal((await cli(["show", "board", "--frame", "f1"])).code, 0);
  await sleep(300);
  await S.page.click("[data-testid=present-toggle]");
  await until(() => T("focusedFrame").then((f) => f === "f1"), { what: "presenting on f1" });
  const hidden = new Set(await T("hidden"));
  assert.ok(hidden.has("f2") && hidden.has("n5"), "other frame hidden");
  assert.ok(!hidden.has("n1") && !hidden.has("go"), "own frame shown");
  const go = await el("go");
  const gp = await client(...center(go));
  await S.page.mouse.click(gp.x, gp.y);
  await until(() => T("focusedFrame").then((f) => f === "f2"), { what: "link to f2", timeout: 5000 });
  assert.ok(new Set(await T("hidden")).has("n1"));
  await S.page.click("[data-testid=present-exit]");
  assert.equal(await T("focusedFrame"), null);

  // Element links: Excalidraw's "copy link to object" gives a clean canvas link,
  // and a link made while the server ran on another port still navigates.
  assert.equal(await T("linkFor", "n1"), `http://127.0.0.1:${S.port}/?page=board&element=n1`);
  const relink = (link) => cli(["patch", "board", "--file", "-"], { stdin: JSON.stringify({ elements: [{ id: "go", link }] }) });
  assert.equal((await relink("http://localhost:9/?page=board&element=f2")).code, 0);
  assert.equal((await cli(["show", "board", "--frame", "f1"])).code, 0);
  await sleep(300);
  await S.page.click("[data-testid=present-toggle]");
  await until(() => T("focusedFrame").then((f) => f === "f1"), { what: "presenting on f1 again" });
  const gp2 = await client(...center(await el("go")));
  await S.page.mouse.click(gp2.x, gp2.y);
  await until(() => T("focusedFrame").then((f) => f === "f2"), { what: "other-port link to f2", timeout: 5000 });
  await S.page.click("[data-testid=present-exit]");
  assert.equal((await relink(`http://127.0.0.1:${S.port}/?element=f2`)).code, 0);
  // Presenting is view-only: the person changed nothing (only the agent's relinks are logged).
  assert.equal((await cli(["changes", "board", "--since", "last", "--source", "user"])).json.result.changes.length, 0);

  // 6. stop saves everything; the log survives a restart.
  assert.equal((await cli(["stop"])).json.result.stopped, true);
  const saved = JSON.parse(fs.readFileSync(path.join(S.tmp, "canvas", "board.excalidraw"), "utf8"));
  const live = saved.elements.filter((e) => !e.isDeleted);
  assert.ok(Math.abs(live.find((e) => e.id === "n1").y - (n1.y + 300)) <= 3);
  assert.ok(live.some((e) => e.type === "ellipse") && live.some((e) => e.type === "freedraw"));
  assert.ok(live.some((e) => e.type === "text" && e.text === "Needs SSO"));
  const restarted = await cli(["changes", "board", "--since", "0"]); // starts the server again
  assert.equal(restarted.json.result.changes.length, 4);
  assert.equal(fs.readdirSync(path.join(S.tmp, "canvas")).filter((f) => !f.startsWith(".")).join(","), "board.excalidraw");
  // The open tab survives the restart: it reconnects by itself, no new link.
  await until(async () => (await cli(["status"])).json.result.browsers === 1, { what: "the tab reconnects after a restart", timeout: 20000 });
  await until(async () => (await T("connection")) === "connected", { what: "connected again after catching up" });
  // An edit made while the server is down is kept in the tab and saved once it's back.
  const rev = restarted.json.result.rev;
  // Patches no longer refit the view, so point it at n2's frame before dragging.
  assert.equal((await cli(["show", "board", "--frame", "f1"])).code, 0);
  await sleep(300);
  assert.equal((await cli(["stop"])).json.result.stopped, true);
  await until(async () => (await T("connection")) === "away", { what: "the tab knows the server is away" });
  const n2 = await el("n2");
  await drag(center(n2), [n2.x + n2.width / 2, n2.y + n2.height / 2 + 150]);
  assert.equal((await cli(["pages"])).code, 0); // starts the server again
  await until(async () => {
    const r = await cli(["changes", "board", "--since", String(rev), "--source", "user"]);
    return r.json.result.changes.some((c) => c.id === "n2" && c.moved);
  }, { what: "the offline edit is saved after reconnecting", timeout: 20000 });
  // Closing the tab: the next tests open their own.
  await S.page.goto("about:blank");
  await until(async () => (await cli(["status"])).json.result.browsers === 0, { what: "no tab" });

  // 7. Network: nothing with a body goes anywhere but the local server.
  const local = `127.0.0.1:${S.port}`;
  const offending = S.requests.filter((r) => {
    const { host, protocol } = new URL(r.url);
    if (protocol === "data:" || protocol === "blob:") return false;
    return host !== local && (r.hasBody || !["GET", "HEAD", "OPTIONS"].includes(r.method));
  });
  assert.deepEqual(offending, []);
  assert.deepEqual(S.errors.filter((e) => e.includes(local)), [], "no failed requests to the local server");
  const web = S.requests.filter((r) => /^https?:$/.test(new URL(r.url).protocol));
  const hosts = [...new Set(web.map((r) => new URL(r.url).host).filter((h) => h !== local))];
  t.diagnostic(`${web.length} http requests; non-local hosts (GET only): ${hosts.join(", ") || "none"}; failed: ${S.errors.length ? S.errors.join(" | ") : "none"}`);
});

test("concurrency: the person drags while agent patches land; nothing is misattributed", { skip }, async () => {
  // The first test stopped the server; `open` starts it and "opens" a fresh tab.
  const before = fs.readFileSync(S.opened, "utf8").trim().split("\n").length;
  const opening = cli(["open", "board"]);
  const link = await until(() => {
    const lines = fs.readFileSync(S.opened, "utf8").trim().split("\n");
    return lines.length > before && lines.at(-1);
  }, { what: "a new link" });
  assert.equal((await opening).code, 0);
  const u = new URL(link);
  u.searchParams.set("test", "1");
  await S.page.goto(u.href);
  await until(() => S.page.evaluate(() => window.obeyaTest?.ready()), { what: "page ready", timeout: 60000 });
  assert.equal((await cli(["show", "board", "--frame", "f1"])).code, 0);
  await sleep(800);

  const start = (await cli(["changes", "board"])).json.result.rev;
  const agentIds = new Set(["n5"]);
  const colors = ["#ffc9c9", "#b2f2bb", "#a5d8ff", "#ffec99", "#d0bfff", "#99e9f2"];

  const person = (async () => {
    for (let i = 0; i < 7; i++) { // odd, so there is a net move
      const n2 = await el("n2");
      await drag(center(n2), [center(n2)[0] + (i % 2 ? -120 : 120), center(n2)[1]], 10);
      await sleep(120 + (i % 3) * 150); // pauses around the 300 ms sync debounce
    }
  })();
  const agent = (async () => {
    for (let i = 0; i < 6; i++) {
      const id = `s${i}`;
      agentIds.add(id);
      const r = await cli(["patch", "board", "--file", "-"], {
        stdin: JSON.stringify({
          skeleton: [{ type: "stickynote", id, x: 1400 + i * 60, y: 600, width: 120, height: 120, label: { text: `agent ${i}` } }],
          elements: [{ id: "n5", backgroundColor: colors[i] }],
        }),
      });
      assert.equal(r.code, 0, r.stdout);
    }
  })();
  await Promise.all([person, agent]);

  // Let the last sync land, then compare.
  await sleep(1200);
  const all = (await cli(["changes", "board", "--since", String(start), "--source", "all"])).json.result.changes;
  const user = all.filter((c) => c.source === "user");
  const byAgent = all.filter((c) => c.source === "agent");
  assert.ok(user.length >= 1, "the person's drags were recorded");
  assert.deepEqual([...new Set(user.map((c) => c.id))], ["n2"], JSON.stringify(user, null, 1));
  for (const c of byAgent) assert.ok(agentIds.has(c.id), `agent entry for ${c.id}`);
  assert.equal(byAgent.filter((c) => c.op === "added").length, 6);

  // The server and the tab agree on where the note ended up.
  const inTab = await el("n2");
  const onServer = (await cli(["get", "board"])).json.result.elements.find((e) => e.id === "n2");
  assert.equal(onServer.x, Math.round(inTab.x));
  assert.equal(onServer.y, Math.round(inTab.y));
});

test("two tabs: agent requests go to the tab used last; the other updates live", { skip }, async () => {
  const A = S.page; // connected by the previous test
  const link = (await cli(["open", "board", "--no-open"])).json.result.url;
  const u = new URL(link);
  u.searchParams.set("test", "1");
  const B = await S.context.newPage();
  await B.setViewportSize({ width: 1600, height: 1000 });
  await B.goto(u.href);
  await until(() => B.evaluate(() => window.obeyaTest?.ready()), { what: "tab B ready", timeout: 60000 });
  await until(async () => (await cli(["status"])).json.result.browsers === 2, { what: "two tabs connected" });

  const on = (page) => ({
    T: (fn, ...args) => page.evaluate(([f, a]) => window.obeyaTest[f](...a), [fn, args]),
    async el(id) { return (await this.T("elements")).find((e) => e.id === id); },
    async use() {
      await page.bringToFront();
      const p = await this.T("toClient", 600, 650); // empty space inside frame f1
      await page.mouse.click(p.x, p.y);
      await sleep(400); // the "used" report is debounced
    },
  });
  const a = on(A), b = on(B);
  const start = (await cli(["changes", "board"])).json.result.rev;
  const patch = (id, x) => cli(["patch", "board", "--file", "-"], {
    stdin: JSON.stringify({ skeleton: [{ type: "stickynote", id, x, y: 900, width: 150, height: 150, label: { text: id } }] }),
  });

  // Use tab A: only A applies the patch; B shows the result live.
  await a.use();
  const [ca0, cb0] = [await a.T("counts"), await b.T("counts")];
  assert.equal((await patch("m1", 0)).code, 0);
  assert.equal((await a.T("counts")).patchesApplied, ca0.patchesApplied + 1);
  assert.equal((await b.T("counts")).patchesApplied, cb0.patchesApplied);
  await until(() => b.el("m1"), { what: "m1 live in tab B", timeout: 5000 });

  // Use tab B: now B applies; A updates live.
  await b.use();
  assert.equal((await patch("m2", 300)).code, 0);
  assert.equal((await b.T("counts")).patchesApplied, cb0.patchesApplied + 1);
  assert.equal((await a.T("counts")).patchesApplied, ca0.patchesApplied + 1);
  await until(() => a.el("m2"), { what: "m2 live in tab A", timeout: 5000 });

  // The person moves m2 in tab B; tab A follows.
  const m2 = await b.el("m2");
  const from = await b.T("toClient", m2.x + 75, m2.y + 75);
  const to = await b.T("toClient", m2.x + 75, m2.y - 125); // up, staying on screen
  await B.mouse.move(from.x, from.y);
  await B.mouse.down();
  await B.mouse.move(to.x, to.y, { steps: 10 });
  await B.mouse.up();
  const moved = await until(async () => { const e = await b.el("m2"); return e.y < m2.y - 50 ? e : null; }, { what: "the drag in tab B" });
  await until(async () => {
    const e = await a.el("m2");
    return Math.abs(e.x - moved.x) < 0.5 && Math.abs(e.y - moved.y) < 0.5;
  }, { what: "tab A sees the move", timeout: 5000 });

  // No phantom edits: the only user change is that move.
  await sleep(800);
  const user = (await cli(["changes", "board", "--since", String(start), "--source", "user"])).json.result.changes;
  assert.deepEqual(user.map((c) => [c.id, c.op]), [["m2", "modified"]], JSON.stringify(user, null, 1));

  // Closing the last-used tab hands requests back to the other one.
  await B.close();
  await until(async () => (await cli(["status"])).json.result.browsers === 1, { what: "one tab left" });
  const before = (await a.T("counts")).patchesApplied;
  assert.equal((await patch("m3", 600)).code, 0);
  assert.equal((await a.T("counts")).patchesApplied, before + 1);
});

test("export: svg, png per frame, a self-contained html deck, pdf; with and without a tab", { skip }, async () => {
  const out = path.join(S.tmp, "export");
  const full = (await cli(["get", "board", "--full"])).json.result.elements;
  const f1 = full.find((e) => e.id === "f1");

  // SVG of one frame, rendered by the person's open tab: fonts embedded, no external refs.
  const svg = await cli(["export", "board", "--format", "svg", "--frame", "f1", "--out", path.join(out, "f1.svg")]);
  assert.equal(svg.code, 0, svg.stdout);
  assert.deepEqual([svg.json.result.width, svg.json.result.height], [f1.width, f1.height]);
  const svgText = fs.readFileSync(path.join(out, "f1.svg"), "utf8");
  assert.ok(svgText.startsWith("<svg"), "an svg");
  assert.ok(/src: ?url\(data:font\/woff2;base64,/.test(svgText), "fonts embedded");
  assert.deepEqual([...new Set(svgText.match(/https?:\/\/[^"' )]+/g))], ["http://www.w3.org/2000/svg"]);

  const embedded = await cli(["export", "board", "--format", "svg", "--embed-scene", "--out", path.join(out, "board.svg")]);
  assert.equal(embedded.code, 0, embedded.stdout);
  const boardSvg = fs.readFileSync(path.join(out, "board.svg"), "utf8");
  assert.ok(boardSvg.includes("payload-type:application/vnd.excalidraw+json"), "scene embedded");
  assert.ok(boardSvg.includes(`127.0.0.1:${S.port}/?element=f2`), "canvas links kept when the scene is embedded");

  // One PNG per frame, numbered in slide order.
  const pngs = await cli(["export", "board", "--format", "png", "--frames", "--out", path.join(out, "frames")]);
  assert.equal(pngs.code, 0, pngs.stdout);
  assert.deepEqual(fs.readdirSync(path.join(out, "frames")).sort(), ["01-board.png", "02-next.png"]);
  for (const f of pngs.json.result.files) assert.equal(fs.readFileSync(f.file).subarray(1, 4).toString(), "PNG");

  // HTML deck: works offline, makes no requests, hotspots and keys navigate.
  const deckFile = path.join(out, "deck.html");
  const deck = await cli(["export", "board", "--format", "html", "--title", "Board review", "--out", deckFile]);
  assert.equal(deck.code, 0, deck.stdout);
  assert.deepEqual([deck.json.result.slides, deck.json.result.hotspots], [3, 1]);
  const viewer = await S.context.newPage();
  const requests = [];
  viewer.on("request", (r) => requests.push(r.url()));
  await viewer.goto("file://" + deckFile + "#2");
  await viewer.waitForSelector(".slide.current img");
  assert.deepEqual(requests.filter((u) => !u.startsWith("file:") && !u.startsWith("data:")), [], "deck makes no requests");
  const current = () => viewer.evaluate(() => document.querySelector(".slide.current").dataset.n);
  assert.equal(await current(), "2");
  assert.ok(await viewer.evaluate(() => document.querySelector(".slide.current img").naturalWidth > 0), "slide image decodes");
  await viewer.click(".slide.current .hot"); // the "Next" button links to frame f2
  assert.equal(await current(), "3");
  await viewer.keyboard.press("ArrowLeft");
  assert.equal(await current(), "2");
  await viewer.close();

  // PDF: one page per slide.
  const pdfFile = path.join(out, "deck.pdf");
  const pdf = await cli(["export", "board", "--format", "pdf", "--title", "Board review", "--out", pdfFile]);
  assert.equal(pdf.code, 0, pdf.stdout);
  const pdfBytes = fs.readFileSync(pdfFile);
  assert.equal(pdfBytes.subarray(0, 5).toString(), "%PDF-");
  assert.equal((pdfBytes.toString("latin1").match(/\/Type\s*\/Page\b/g) || []).length, 3);

  // No tab open: the CLI renders in its own headless Chrome, then cleans up.
  for (const p of S.context.pages()) await p.close();
  await until(async () => (await cli(["status"])).json.result.browsers === 0, { what: "no tabs" });
  const headless = await cli(["export", "board", "--format", "svg", "--frame", "f2", "--out", path.join(out, "f2.svg")]);
  assert.equal(headless.code, 0, headless.stdout + headless.stderr);
  assert.match(headless.stderr, /headless Chrome/);
  assert.ok(fs.readFileSync(path.join(out, "f2.svg"), "utf8").startsWith("<svg"));
  const after = (await cli(["status"])).json.result;
  assert.equal(after.browsers, 0);

  // shot with no tab: rendered headless, and the person's browser is never opened.
  const links = fs.readFileSync(S.opened, "utf8").trim().split("\n").length;
  const quiet = await cli(["shot", "board", "--frame", "f2", "--out", path.join(out, "shot-f2.png")]);
  assert.equal(quiet.code, 0, quiet.stdout + quiet.stderr);
  assert.equal(quiet.json.result.renderer, "headless");
  assert.equal(fs.readFileSync(S.opened, "utf8").trim().split("\n").length, links, "no browser tab opened");
  assert.equal(fs.readFileSync(S.opened, "utf8").trim().split("\n").length >= 1, true);
});

test("library: insert downloads on demand and opens a tab; predictable ids; frames; contact sheet; sidebar", { skip }, async () => {
  // No tab is open after the export test: the CLI downloads the library, then "opens" a tab.
  const before = fs.readFileSync(S.opened, "utf8").trim().split("\n").length;
  const inserting = cli(["library", "insert", "shapes.acme/database", "board", "--at", "100,800", "--id", "db"]);
  const link = await until(() => {
    const lines = fs.readFileSync(S.opened, "utf8").trim().split("\n");
    return lines.length > before && lines.at(-1);
  }, { what: "a new link" });
  const u = new URL(link);
  u.searchParams.set("test", "1");
  const page = await S.context.newPage();
  await page.goto(u.href);
  const r = await inserting;
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.match(r.stderr, /downloaded shapes\.acme/);
  const { ids, created, item, library } = r.json.result;
  assert.equal(item, "shapes.acme/database");
  assert.deepEqual(library.authors, ["Acme Example"]);
  assert.deepEqual(ids, ["db-1", "db-2"]);
  for (const id of ids) assert.ok(created.includes(id));

  const els = (await cli(["get", "board"])).json.result.elements.filter((e) => e.id.startsWith("db-"));
  assert.deepEqual(els.map((e) => [e.id, e.x, e.y, e.text]), [["db-1", 100, 800, "DB"]], "label folded into its box, placed at --at");

  const inFrame = await cli(["library", "insert", "doodles/item-3", "board", "--at", "1460,300", "--frame", "f2", "--id", "dd"]);
  assert.equal(inFrame.code, 0, inFrame.stdout);
  const full = (await cli(["get", "board", "--full"])).json.result.elements.filter((e) => e.id.startsWith("dd-"));
  assert.ok(full.length === 2 && full.every((e) => e.frameId === "f2"), JSON.stringify(full.map((e) => [e.id, e.frameId])));
  assert.equal((await cli(["library", "insert", "doodles/item-1", "board", "--at", "0,0", "--frame", "nope"])).json.error.code, "unknown_element");

  // Contact sheet, rendered by the open tab.
  const sheet = await cli(["library", "show", "doodles", "--sheet", path.join(S.tmp, "sheets", "doodles.png")]);
  assert.equal(sheet.code, 0, sheet.stdout);
  const [s1] = sheet.json.result.sheets;
  assert.deepEqual(s1.items, [1, 3]);
  assert.equal(fs.readFileSync(s1.file).subarray(1, 4).toString(), "PNG");
  assert.ok(s1.width > 600 && s1.height > 200);

  // The person's sidebar has the cached libraries (2 + 3 items).
  await until(() => page.evaluate(() => window.obeyaTest.librariesLoaded() >= 5), { what: "libraries in the sidebar" });
  await page.close();
});

test("undo of an agent patch, and an image dropped by the person: synced, saved, exported", { skip }, async () => {
  const before = fs.readFileSync(S.opened, "utf8").trim().split("\n").length;
  const opening = cli(["open", "board"]);
  const link = await until(() => {
    const lines = fs.readFileSync(S.opened, "utf8").trim().split("\n");
    return lines.length > before && lines.at(-1);
  }, { what: "a new link" });
  await opening;
  const u = new URL(link);
  u.searchParams.set("test", "1");
  const page = await S.context.newPage();
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(u.href);
  await until(() => page.evaluate(() => window.obeyaTest?.ready()), { what: "tab ready", timeout: 60000 });
  const P = (fn, ...args) => page.evaluate(([f, a]) => window.obeyaTest[f](...a), [fn, args]);
  assert.equal((await cli(["show", "board", "--frame", "f1"])).code, 0);
  await sleep(300);
  const start = (await cli(["changes", "board"])).json.result.rev;

  // The agent adds a note; the person undoes it with Ctrl/Cmd+Z.
  const patch = await cli(["patch", "board", "--file", "-"], { stdin: JSON.stringify({ skeleton: [{ type: "stickynote", id: "undo-me", x: 700, y: 450, width: 150, height: 150, label: { text: "oops" } }] }) });
  assert.equal(patch.code, 0, patch.stdout);
  assert.ok((await P("elements")).some((e) => e.id === "undo-me"));
  const empty = await P("toClient", 600, 650);
  await page.mouse.click(empty.x, empty.y); // focus the canvas
  await page.keyboard.press("ControlOrMeta+z");
  await until(async () => !(await P("elements")).some((e) => e.id === "undo-me"), { what: "undo removes the agent's note", timeout: 5000 });
  await sleep(800);
  const user = (await cli(["changes", "board", "--since", String(start), "--source", "user"])).json.result.changes;
  assert.deepEqual(user.map((c) => [c.id, c.op]), [["undo-me", "deleted"]], "the undo is the person's change");

  // A hidden tab (no animation frames) still applies agent patches.
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    window.__raf = window.requestAnimationFrame;
    window.requestAnimationFrame = () => 0;
  });
  const hiddenPatch = await cli(["patch", "board", "--file", "-"], { stdin: JSON.stringify({ skeleton: [{ type: "rectangle", id: "while-hidden", x: 700, y: 900, width: 80, height: 40 }] }) });
  assert.equal(hiddenPatch.code, 0, hiddenPatch.stdout);
  assert.ok((await P("elements")).some((e) => e.id === "while-hidden"));
  assert.equal((await cli(["patch", "board", "--file", "-"], { stdin: JSON.stringify({ delete: ["while-hidden"] }) })).code, 0);
  await page.evaluate(() => {
    delete document.hidden;
    delete document.visibilityState;
    window.requestAnimationFrame = window.__raf;
  });

  // Stacking order: a new element lands on top; toBack sends it behind everything, and that survives a reload.
  assert.equal((await cli(["patch", "board", "--file", "-"], { stdin: JSON.stringify({ skeleton: [{ type: "rectangle", id: "backdrop", x: 650, y: 40, width: 500, height: 300, backgroundColor: "#e9ecef", fillStyle: "solid" }] }) })).code, 0);
  assert.equal((await P("elements")).at(-1).id, "backdrop");
  const back = await cli(["patch", "board", "--file", "-"], { stdin: JSON.stringify({ toBack: ["backdrop"] }) });
  assert.equal(back.code, 0, back.stdout);
  assert.equal((await P("elements"))[0].id, "backdrop");
  assert.equal((await cli(["patch", "board", "--file", "-"], { stdin: JSON.stringify({ toFront: ["nope"] }) })).json.error.code, "unknown_element");
  await sleep(500);
  await page.reload();
  await until(() => page.evaluate(() => window.obeyaTest?.ready()), { what: "reloaded", timeout: 60000 });
  assert.equal((await P("elements"))[0].id, "backdrop", "stacking order survives a reload");
  const quiet = (await cli(["changes", "board", "--since", String(start), "--source", "user"])).json.result.changes;
  assert.ok(!quiet.some((c) => c.id === "backdrop"), "the reorder is the agent's, not the person's");
  assert.equal((await cli(["patch", "board", "--file", "-"], { stdin: JSON.stringify({ delete: ["backdrop"] }) })).code, 0);

  // Renaming the page: the open tab follows it.
  assert.equal((await cli(["rename", "board", "board-renamed"])).code, 0);
  await until(() => P("page").then((p) => p === "board-renamed"), { what: "tab follows the rename" });
  assert.equal((await cli(["rename", "board-renamed", "board"])).code, 0);
  await until(() => P("page").then((p) => p === "board"), { what: "and back" });

  // The person drops a PNG onto the canvas.
  const png = fs.readFileSync(path.join(S.tmp, "shots", "f1.png")).toString("base64"); // made by the first test
  const drop = await P("toClient", 300, 450);
  await page.evaluate(async ({ b64, x, y }) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], "pasted.png", { type: "image/png" }));
    const target = document.elementFromPoint(x, y);
    for (const type of ["dragenter", "dragover", "drop"]) {
      target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: dt }));
    }
  }, { b64: png, x: drop.x, y: drop.y });
  const img = await until(async () => (await P("elements")).find((e) => e.type === "image" && e.fileId), { what: "an image element", timeout: 10000 });
  await until(async () => {
    const r = await cli(["get", "board", "--full"]);
    return r.json.result.elements.some((e) => e.id === img.id);
  }, { what: "image synced" });

  // Exported with the image; saved in the file with its data; back after a restart.
  const svgOut = path.join(S.tmp, "export", "with-image.svg");
  assert.equal((await cli(["export", "board", "--format", "svg", "--out", svgOut])).code, 0);
  assert.ok(fs.readFileSync(svgOut, "utf8").includes("data:image/png;base64,"), "image embedded in the export");
  await page.close();
  assert.equal((await cli(["stop"])).json.result.stopped, true);
  const saved = JSON.parse(fs.readFileSync(path.join(S.tmp, "canvas", "board.excalidraw"), "utf8"));
  const savedImg = saved.elements.find((e) => e.id === img.id);
  assert.ok(savedImg && !savedImg.isDeleted);
  assert.match(saved.files?.[savedImg.fileId]?.dataURL ?? "", /^data:image\/png;base64,/);
  const again = await cli(["export", "board", "--format", "svg", "--out", path.join(S.tmp, "export", "after-restart.svg")]);
  assert.equal(again.code, 0, again.stdout);
  assert.ok(fs.readFileSync(path.join(S.tmp, "export", "after-restart.svg"), "utf8").includes("data:image/png;base64,"));
});

test("pages: the picker, files added outside the server, rename from the menu", { skip }, async () => {
  const before = fs.readFileSync(S.opened, "utf8").trim().split("\n").length;
  const opening = cli(["open", "board"]);
  const link = await until(() => {
    const lines = fs.readFileSync(S.opened, "utf8").trim().split("\n");
    return lines.length > before && lines.at(-1);
  }, { what: "a new link" });
  await opening;
  const u = new URL(link);
  u.searchParams.set("test", "1");
  const page = await S.context.newPage();
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(u.href);
  await until(() => page.evaluate(() => window.obeyaTest?.ready()), { what: "tab ready", timeout: 60000 });
  const P = (fn, ...args) => page.evaluate(([f, a]) => window.obeyaTest[f](...a), [fn, args]);
  const dir = path.join(S.tmp, "canvas");
  const pillCount = async () => Number(/(\d+) pages?/.exec(await page.textContent("[data-testid=page-pill]"))?.[1]);
  await until(async () => (await pillCount()) === 1, { what: "the pill counts one page" });
  assert.equal(await page.title(), "obeya - board");

  // Files added by another program show up without a reload; unusable names are listed apart.
  const empty = JSON.stringify({ type: "excalidraw", version: 2, elements: [], appState: {}, files: {} });
  fs.writeFileSync(path.join(dir, "notes.excalidraw"), empty);
  fs.writeFileSync(path.join(dir, "My|Diagram.excalidraw"), empty);
  await until(async () => (await pillCount()) === 2, { what: "a file added on disk appears", timeout: 5000 });
  await page.keyboard.press("ControlOrMeta+KeyO");
  await page.waitForSelector("[data-testid=page-picker]");
  assert.deepEqual(await page.$$eval("[data-testid=picker-row]", (rows) => rows.map((r) => r.firstChild.firstChild.textContent)), ["board", "notes"]);
  assert.deepEqual(await page.$$eval("[data-testid=picker-skipped]", (rows) => rows.map((r) => r.firstChild.textContent)), ["My|Diagram.excalidraw"]);
  // Search, then Enter opens the match.
  await page.keyboard.type("not");
  await page.keyboard.press("Enter");
  await until(async () => (await P("page")) === "notes", { what: "Enter opens the match" });
  assert.equal(await page.isVisible("[data-testid=page-picker]"), false);
  // A name no page has offers a new, empty page.
  await page.click("[data-testid=page-pill]");
  await page.keyboard.type("fresh-idea");
  assert.match(await page.textContent("[data-testid=picker-create]"), /New page fresh-idea/);
  await page.keyboard.press("Escape");
  assert.equal(await page.isVisible("[data-testid=page-picker]"), false);

  // Rename from the menu; the file moves and the tab follows.
  await page.click(".main-menu-trigger");
  await page.click("[data-testid=menu-rename]");
  await page.fill("[data-testid=rename-dialog] input", "notes-2");
  await page.keyboard.press("Enter");
  await until(async () => (await P("page")) === "notes-2", { what: "the tab follows the rename" });
  assert.ok(fs.existsSync(path.join(dir, "notes-2.excalidraw")) && !fs.existsSync(path.join(dir, "notes.excalidraw")));

  // A page deleted on disk drops out of the list.
  fs.rmSync(path.join(dir, "notes-2.excalidraw"));
  fs.rmSync(path.join(dir, "My|Diagram.excalidraw"));
  await until(async () => (await pillCount()) === 1, { what: "a file deleted on disk disappears", timeout: 5000 });

  // New page from ☰: saved on disk before anything is drawn, and opened.
  const onDisk = (name) => fs.existsSync(path.join(dir, `${name}.excalidraw`));
  await page.click(".main-menu-trigger");
  await page.click("[data-testid=menu-new-page]");
  await page.fill("[data-testid=new-page-name]", "plans");
  await page.keyboard.press("Enter");
  await until(async () => (await P("page")) === "plans", { what: "the new page opens" });
  assert.ok(onDisk("plans"), "saved when created");
  assert.equal(await P("dialog"), "canvas");
  // A name that's taken is refused in the dialog.
  await page.click(".main-menu-trigger");
  await page.click("[data-testid=menu-new-page]");
  await page.fill("[data-testid=new-page-name]", "board");
  await page.click("[data-testid=new-page-create]");
  assert.match(await page.textContent("[data-testid=new-page-error]"), /already a page called board/);
  await page.fill("[data-testid=new-page-name]", "has:colon");
  await page.click("[data-testid=new-page-create]");
  assert.match(await page.textContent("[data-testid=new-page-error]"), /Not allowed/);
  await page.keyboard.press("Escape");
  assert.equal(await P("dialog"), "canvas");
  // The picker's + New hands over to the same dialog.
  await page.keyboard.press("ControlOrMeta+KeyO");
  await page.click("[data-testid=picker-new]");
  await page.waitForSelector("[data-testid=new-page-dialog]");
  assert.equal(await page.isVisible("[data-testid=page-picker]"), false);
  await page.fill("[data-testid=new-page-name]", "ideas");
  await page.click("[data-testid=new-page-create]");
  await until(async () => (await P("page")) === "ideas" && onDisk("ideas"), { what: "+ New makes and opens ideas" });
  // Typing a new name in the picker makes the page too, saved now.
  await page.keyboard.press("ControlOrMeta+KeyO");
  await page.keyboard.type("quick-note");
  await page.keyboard.press("Enter");
  await until(async () => (await P("page")) === "quick-note" && onDisk("quick-note"), { what: "the picker's + New page row saves it" });
  await until(async () => (await pillCount()) === 4, { what: "the new pages are listed" });
  for (const n of ["plans", "ideas", "quick-note"]) fs.rmSync(path.join(dir, `${n}.excalidraw`));
  await until(async () => (await pillCount()) === 1, { what: "back to one page", timeout: 5000 });
  await page.close();
});

test("export dialog: Cmd/Ctrl+Shift+E, frames as a zip, an HTML deck; CLI image options", { skip }, async () => {
  const link = (await cli(["open", "board", "--no-open"])).json.error?.url ?? (await cli(["open", "board", "--no-open"])).json.result.url;
  const u = new URL(link);
  u.searchParams.set("test", "1");
  const page = await S.context.newPage();
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(u.href);
  await until(() => page.evaluate(() => window.obeyaTest?.ready()), { what: "tab ready", timeout: 60000 });
  const frames = (await cli(["get", "board"])).json.result.elements.filter((e) => e.type === "frame").length;
  assert.ok(frames >= 2, "the board has frames");
  // Excalidraw's own "Export image…" is gone: one Export.
  await page.click(".main-menu-trigger");
  assert.equal(await page.isVisible("text=Export image"), false);
  assert.ok(await page.isVisible("[data-testid=menu-export]"));
  await page.keyboard.press("Escape");
  const download = async () => {
    const [res] = await Promise.all([page.waitForResponse((r) => r.url().includes("/export-file"), { timeout: 60000 }), page.click("[data-testid=export-download]")]);
    // Chrome hands an attachment to its download manager, so read the bytes with the same request from the page.
    const req = JSON.parse(res.request().postData());
    const head = await page.evaluate(async (body) => {
      const r = await fetch("/api/pages/board/export-file", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      return new TextDecoder("latin1").decode(new Uint8Array(await r.arrayBuffer()).slice(0, 200));
    }, req);
    return { status: res.status(), type: res.headers()["content-type"], files: res.headers()["x-export-files"], head };
  };
  // PNG, every frame: one zip.
  await page.keyboard.press("ControlOrMeta+Shift+KeyE");
  await page.waitForSelector("[data-testid=export-dialog]");
  const z = await download();
  assert.equal(z.status, 200);
  assert.equal(z.type, "application/zip");
  assert.equal(Number(z.files), frames);
  assert.equal(z.head.slice(0, 2), "PK");
  await until(async () => !(await page.isVisible("[data-testid=export-dialog]")), { what: "the dialog closes after a download" });
  // An HTML deck of the ticked frames.
  await page.keyboard.press("ControlOrMeta+Shift+KeyE");
  await page.click("[data-testid=export-format-html]");
  const d = await download();
  assert.equal(d.status, 200);
  assert.match(d.type, /text\/html/);
  assert.match(d.head, /<!doctype html>/i);
  await page.close();
  // The CLI's image options.
  const out = path.join(S.tmp, "export");
  assert.equal((await cli(["export", "board", "--format", "svg", "--dark", "--out", path.join(out, "dark.svg")])).code, 0);
  assert.match(fs.readFileSync(path.join(out, "dark.svg"), "utf8"), /fill="#121212"/, "dark background");
  assert.equal((await cli(["export", "board", "--format", "svg", "--no-background", "--padding", "0", "--out", path.join(out, "clear.svg")])).code, 0);
  const clear = fs.readFileSync(path.join(out, "clear.svg"), "utf8");
  assert.doesNotMatch(clear, /<rect x="0" y="0" width="[\d.]+" height="[\d.]+" fill=/, "no background rectangle");
});

test("patches don't move the person: another page is patched out of sight", { skip }, async () => {
  const opened = await cli(["open", "board", "--no-open"]);
  const u = new URL(opened.json.error?.url ?? opened.json.result.url);
  u.searchParams.set("test", "1");
  const A = await S.context.newPage();
  await A.setViewportSize({ width: 1600, height: 1000 });
  await A.goto(u.href);
  await until(() => A.evaluate(() => window.obeyaTest?.ready()), { what: "tab ready", timeout: 60000 });
  const TA = (fn, ...args) => A.evaluate(([f, a]) => window.obeyaTest[f](...a), [fn, args]);
  await until(async () => (await cli(["status"])).json.result.browsers === 1, { what: "one tab" });
  // Let the opening fit-to-page animation finish before noting where the person looks.
  let last = null;
  await until(async () => { const v = JSON.stringify(await TA("view")); const same = v === last; last = v; return same; }, { what: "the view settles", every: 400 });
  // The person is on "board", looking somewhere, with a note selected.
  const n1 = (await TA("elements")).find((e) => e.id === "n1");
  const p = await TA("toClient", n1.x + 20, n1.y + 20);
  await A.mouse.click(p.x, p.y);
  const before = { page: await TA("page"), view: await TA("view"), selected: await TA("selected") };
  assert.equal(before.selected.length, 1, "something is selected");
  // The agent draws on another page.
  const elsewhere = await cli(["patch", "elsewhere", "--file", "-"], { stdin: JSON.stringify({ skeleton: [
    { type: "stickynote", id: "e1", x: 0, y: 0, width: 220, height: 150, label: { text: "A long label that has to wrap over several lines inside the note" } },
    { type: "rectangle", id: "e2", x: 400, y: 0, width: 160, height: 70, label: { text: "Box" } },
    { type: "arrow", id: "e3", x: 230, y: 40, start: { id: "e1" }, end: { id: "e2" } },
  ] }) });
  assert.equal(elsewhere.code, 0, elsewhere.stdout);
  assert.equal(elsewhere.json.result.createdPage, true);
  assert.deepEqual({ page: await TA("page"), view: await TA("view"), selected: await TA("selected") }, before, "the person's page, view and selection didn't move");
  assert.ok(!(await TA("elements")).some((e) => e.id === "e1"), "nothing landed on the page on screen");
  // It was laid out like any patch: the label wraps inside the note, the arrow is bound at both ends.
  const got = (await cli(["get", "elsewhere", "--full"])).json.result.elements.filter((e) => !e.isDeleted);
  const label = got.find((e) => e.containerId === "e1");
  assert.ok(label && label.text.includes("\n") && label.width <= 220, "the note's label wraps inside it");
  const arrow = got.find((e) => e.id === "e3");
  assert.deepEqual([arrow.startBinding?.elementId, arrow.endBinding?.elementId], ["e1", "e2"]);
  assert.equal((await cli(["changes", "elsewhere", "--source", "user"])).json.result.changes.length, 0, "nothing on that page counts as the person's edit");
  // A second tab showing that page gets the next patch, in front of whoever looks at it.
  const v = new URL(u.href);
  v.searchParams.set("page", "elsewhere");
  const B = await S.context.newPage();
  await B.setViewportSize({ width: 1600, height: 1000 });
  await B.goto(v.href);
  await until(() => B.evaluate(() => window.obeyaTest?.ready()), { what: "tab B ready", timeout: 60000 });
  await A.bringToFront();
  await A.mouse.click(p.x, p.y); // A is the tab used last
  assert.equal((await cli(["patch", "elsewhere", "--file", "-"], { stdin: JSON.stringify({ elements: [{ id: "e2", x: 450 }] }) })).code, 0);
  await until(() => B.evaluate(() => window.obeyaTest.elements().find((e) => e.id === "e2")?.x === 450), { what: "tab B shows the patch" });
  assert.equal(await TA("page"), "board", "tab A stayed on its page");
  await B.close();
  // A patch to the page on screen still lands in front of the person.
  assert.equal((await cli(["patch", "board", "--file", "-"], { stdin: JSON.stringify({ skeleton: [{ type: "rectangle", id: "here", x: 0, y: 900, width: 80, height: 40 }] }) })).code, 0);
  assert.ok((await TA("elements")).some((e) => e.id === "here"));
  assert.equal((await cli(["patch", "board", "--file", "-"], { stdin: JSON.stringify({ delete: ["here"] }) })).code, 0);
  await A.close();
});

test("an element link opens the page at that element, without Excalidraw's \"not found\" toast", { skip }, async () => {
  const opened = await cli(["open", "board", "--no-open"]);
  const u = new URL(opened.json.error?.url ?? opened.json.result.url);
  u.searchParams.set("test", "1");
  u.searchParams.set("element", "f2");
  const A = await S.context.newPage();
  await A.setViewportSize({ width: 1600, height: 1000 });
  await A.goto(u.href);
  await until(() => A.evaluate(() => window.obeyaTest?.ready()), { what: "tab ready", timeout: 60000 });
  await sleep(1000); // a toast would show by now
  const text = await A.evaluate(() => document.body.innerText);
  assert.ok(!/wasn.t found/i.test(text), "no \"Linked object wasn't found\" toast");
  const T = (fn, ...args) => A.evaluate(([f, a]) => window.obeyaTest[f](...a), [fn, args]);
  const f2 = (await T("elements")).find((e) => e.id === "f2");
  const c = await T("toClient", f2.x + f2.width / 2, f2.y + f2.height / 2);
  assert.ok(Math.abs(c.x - 800) < 120 && Math.abs(c.y - 536) < 120, `the view is centred on f2 (${c.x}, ${c.y})`);
  assert.ok(!new URL(A.url()).searchParams.has("element"));
  await A.close();
});

test("late layout: the editor's change to a patched element right after the patch is the agent's, not the person's", { skip }, async () => {
  const opened = await cli(["open", "board", "--no-open"]);
  const u = new URL(opened.json.error?.url ?? opened.json.result.url);
  u.searchParams.set("test", "1");
  const A = await S.context.newPage();
  await A.setViewportSize({ width: 1600, height: 1000 });
  await A.goto(u.href);
  await until(() => A.evaluate(() => window.obeyaTest?.ready()), { what: "tab ready", timeout: 60000 });
  const T = (fn, ...args) => A.evaluate(([f, a]) => window.obeyaTest[f](...a), [fn, args]);
  // The full log (revisions, sources), not the brief one agents read.
  const last = async (id) => (await (await fetch(`http://127.0.0.1:${S.port}/api/pages/board/changes?since=0`)).json()).changes.filter((c) => c.id === id).at(-1);
  const points = [[0, 0], [7, 6], [14, -1], [0, 0]];
  const r = await cli(["patch", "board", "--file", "-"], { stdin: JSON.stringify({ elements: [{ id: "tick", type: "line", x: 40, y: 940, points }] }) });
  assert.equal(r.code, 0, r.stdout);
  const rev = r.json.result.rev;
  // Excalidraw redoing the line a moment later, with no input from the person.
  await T("nudge", "tick", { points: [[0, 0], [7, 6], [14, -1], [0.5, 0.5]] });
  await until(async () => (await last("tick"))?.rev > rev, { what: "the late layout is saved" });
  assert.equal((await last("tick")).source, "agent", "late layout is the agent's");
  // After the person clicks, the same kind of change is theirs.
  await A.bringToFront();
  const p = await T("toClient", 600, 650); // empty space inside frame f1
  await A.mouse.click(p.x, p.y);
  const rev2 = (await last("tick")).rev;
  await T("nudge", "tick", { points });
  await until(async () => (await last("tick"))?.rev > rev2, { what: "the person's change is saved" });
  assert.equal((await last("tick")).source, "user", "a change after input is the person's");
  // A sync can't claim an element no recent patch returned.
  const n1 = (await T("elements")).find((e) => e.id === "n1");
  const status = await A.evaluate(async (el) => (await fetch(`/api/pages/board/sync`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ elements: [], layout: [{ ...el, x: el.x + 1, version: el.version + 50 }] }) })).status, n1);
  assert.equal(status, 200);
  assert.equal((await last("n1")).source, "user", "claimed layout outside a patch is recorded as the person's");
  assert.equal((await cli(["patch", "board", "--file", "-"], { stdin: JSON.stringify({ delete: ["tick"] }) })).code, 0);
  await A.close();
});

test("layout directives in a patch: place, align, grid with bound arrows, stack; lint warnings come back", { skip }, async () => {
  const opened = await cli(["open", "lay", "--no-open"]);
  const u = new URL(opened.json.error?.url ?? opened.json.result.url);
  u.searchParams.set("test", "1");
  const A = await S.context.newPage();
  await A.setViewportSize({ width: 1600, height: 1000 });
  await A.goto(u.href);
  await until(() => A.evaluate(() => window.obeyaTest?.ready()), { what: "tab ready", timeout: 60000 });
  const patch = (p) => cli(["patch", "lay", "--file", "-"], { stdin: JSON.stringify(p) });
  const els = async () => (await cli(["get", "lay", "--full"])).json.result.elements.filter((e) => !e.isDeleted);
  const get = async (id) => (await els()).find((e) => e.id === id);
  const labelOf = async (id) => (await els()).find((e) => e.containerId === id);

  // A filled column with one card; a new card placed at the end of it.
  let r = await patch({ skeleton: [
    { type: "rectangle", id: "col", x: 0, y: 0, width: 400, height: 900, backgroundColor: "#e7f5ff", fillStyle: "solid" },
    { type: "stickynote", id: "c1", x: 45, y: 100, width: 200, height: 150, label: { text: "first" } },
  ] });
  assert.equal(r.code, 0, r.stdout);
  r = await patch({ skeleton: [{ type: "stickynote", id: "c2", x: 3000, y: 3000, width: 200, height: 150, label: { text: "placed" } }], layout: [{ place: "c2", in: "col", end: true }] });
  assert.equal(r.code, 0, r.stdout);
  const c1 = await get("c1"), c2 = await get("c2");
  assert.equal(c2.x, 45, "lined up with the card already there");
  assert.equal(c2.y, c1.y + c1.height + 20, "below it, one gap down");
  const l2 = await labelOf("c2");
  assert.ok(l2.x >= c2.x && l2.y >= c2.y && l2.x + l2.width <= c2.x + c2.width, "its label came along");
  const order = (await els()).map((e) => e.id);
  assert.ok(order.indexOf("c2") > order.indexOf("col"), "placed in front of the column");
  assert.deepEqual(r.json.result.warnings, []);

  // Align an existing card that's 3 px off; lint saw it first.
  r = await patch({ skeleton: [{ type: "stickynote", id: "c3", x: 48, y: c2.y + 170, width: 200, height: 150, label: { text: "nudged" } }] });
  assert.ok(r.json.result.warnings.some((w) => w.rule === "near-miss" && w.ids.includes("c3")), JSON.stringify(r.json.result.warnings));
  const before = await labelOf("c3");
  r = await patch({ layout: [{ align: "left", ids: ["c3"], to: "c1" }] });
  assert.equal(r.code, 0, r.stdout);
  assert.equal((await get("c3")).x, 45);
  assert.equal((await labelOf("c3")).x, before.x - 3, "the label moved with it");
  assert.deepEqual(r.json.result.warnings, []);

  // A grid of new boxes with an arrow between two of them: the arrow still binds and meets them.
  r = await patch({
    skeleton: [
      { type: "rectangle", id: "g1", x: 0, y: 0, width: 120, height: 60 },
      { type: "rectangle", id: "g2", x: 0, y: 0, width: 120, height: 60 },
      { type: "arrow", id: "ga", x: 0, y: 0, start: { id: "g1" }, end: { id: "g2" } },
    ],
    layout: [{ grid: ["g1", "g2"], columns: 2, gap: 100, at: [600, 100] }],
  });
  assert.equal(r.code, 0, r.stdout);
  const [g1, g2, ga] = [await get("g1"), await get("g2"), await get("ga")];
  assert.deepEqual([g1.x, g1.y, g2.x, g2.y], [600, 100, 820, 100]);
  assert.deepEqual([ga.startBinding?.elementId, ga.endBinding?.elementId], ["g1", "g2"]);
  const [sx, ex] = [ga.x + ga.points[0][0], ga.x + ga.points.at(-1)[0]];
  assert.ok(sx >= 700 && sx <= 740 && ex >= 800 && ex <= 840, `the arrow runs between them (${sx} → ${ex})`);

  // Send a card behind the column: lint warns it's hidden. A stack layout fixes it.
  r = await patch({ toBack: ["c1"] });
  assert.ok(r.json.result.warnings.some((w) => w.rule === "hidden" && w.ids[0] === "c1"), JSON.stringify(r.json.result.warnings));
  r = await patch({ layout: [{ stack: "above", ids: ["c1"], ref: "col" }] });
  assert.equal(r.code, 0, r.stdout);
  const o2 = (await els()).map((e) => e.id);
  assert.equal(o2.indexOf("c1"), o2.indexOf("col") + 1, "just above the column");
  assert.ok(!r.json.result.warnings.some((w) => w.rule === "hidden"));

  // Errors change nothing.
  const rev = (await cli(["changes", "lay"])).json.result.rev;
  assert.equal((await patch({ skeleton: [{ type: "rectangle", id: "huge", x: 0, y: 0, width: 900, height: 900 }], layout: [{ place: "huge", in: "col" }] })).json.error.code, "no_room");
  assert.equal((await patch({ layout: [{ align: "left", ids: ["c1", "ghost"] }] })).json.error.code, "unknown_element");
  assert.equal((await patch({ layout: [{ align: "sideways", ids: ["c1", "c2"] }] })).json.error.code, "invalid_patch");
  assert.equal((await cli(["changes", "lay"])).json.result.rev, rev);
  assert.equal((await cli(["changes", "lay", "--source", "user"])).json.result.changes.length, 0, "none of it is the person's");
  await A.close();
});

test("branding: the tab title and favicon, the mark in the pill, About obeya", { skip }, async () => {
  const opened = await cli(["open", "board", "--no-open"]);
  const u = new URL(opened.json.error?.url ?? opened.json.result.url);
  u.searchParams.set("test", "1");
  const A = await S.context.newPage();
  await A.setViewportSize({ width: 1600, height: 1000 });
  await A.goto(u.href);
  await until(() => A.evaluate(() => window.obeyaTest?.ready()), { what: "tab ready", timeout: 60000 });
  assert.equal(await A.title(), "obeya - board", "obeya first, then the page");
  const icon = await A.evaluate(() => document.querySelector('link[rel="icon"]')?.href);
  assert.ok(icon?.endsWith("/page/logo.svg"));
  const fav = await A.evaluate(async (href) => { const r = await fetch(href); return { ok: r.ok, type: r.headers.get("content-type") }; }, icon);
  assert.deepEqual(fav, { ok: true, type: "image/svg+xml" });
  // The mark sits in the pill, loaded.
  await until(() => A.evaluate(() => document.querySelector('[data-testid="pill-mark"]')?.naturalWidth > 0), { what: "the pill's mark loads" });
  // ☰ → About obeya: the lockup, the version, the agents' command.
  await A.click(".main-menu-trigger");
  // Our items in File-menu order; About sits with Excalidraw's Help, below them.
  assert.deepEqual(await A.$$eval('[data-testid^="menu-"]', (els) => els.map((e) => e.dataset.testid)),
    ["menu-new-page", "menu-pages", "menu-rename", "menu-export", "menu-present", "menu-about"]);
  await A.click('[data-testid="menu-about"]');
  await A.waitForSelector('[data-testid="about-dialog"]');
  await until(() => A.evaluate(() => document.querySelector('[data-testid="about-version"]')?.textContent === "0.1.0"), { what: "About shows the version" });
  assert.ok(await A.evaluate(() => document.querySelector(".xl-lockup")?.naturalWidth > 0), "the lockup loads");
  assert.match(await A.textContent('[data-testid="about-dialog"]'), /obeya --skill/);
  // One dialog at a time: the page picker's and export's shortcuts do nothing while About is open.
  await A.keyboard.press("ControlOrMeta+KeyO");
  await A.keyboard.press("ControlOrMeta+Shift+KeyE");
  await sleep(200);
  assert.equal(await A.evaluate(() => window.obeyaTest.dialog()), "about");
  assert.equal(await A.$$eval(".xl-backdrop", (els) => els.length), 1, "one dialog");
  await A.keyboard.press("Escape");
  await until(() => A.evaluate(() => !document.querySelector('[data-testid="about-dialog"]')), { what: "Esc closes About" });
  assert.equal(await A.evaluate(() => window.obeyaTest.dialog()), "canvas");
  // Present looks like the editor's other buttons, readable in both themes.
  const present = () => A.evaluate(() => {
    const cs = getComputedStyle(document.querySelector('[data-testid="present-toggle"]'));
    const lum = (s) => { const [r, g, b] = s.match(/\d+(\.\d+)?/g).slice(0, 3).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    const [a, c] = [lum(cs.color), lum(cs.backgroundColor)].sort((x, y) => y - x);
    const island = getComputedStyle(document.querySelector('[data-testid="page-pill"]')).backgroundColor;
    return { ratio: (a + 0.05) / (c + 0.05), sameAsPill: cs.backgroundColor === island };
  });
  let pr = await present();
  assert.ok(pr.ratio >= 4.5 && pr.sameAsPill, `light: ${JSON.stringify(pr)}`);
  await A.click(".main-menu-trigger");
  await A.getByText("Dark mode").click();
  await until(() => A.evaluate(() => document.querySelector(".excalidraw").classList.contains("theme--dark")), { what: "dark theme" });
  pr = await present();
  assert.ok(pr.ratio >= 4.5 && pr.sameAsPill, `dark: ${JSON.stringify(pr)}`);
  // Back to light for the other tests (choosing a theme may leave the menu open).
  if (!(await A.getByText("Light mode").isVisible())) await A.click(".main-menu-trigger");
  await A.getByText("Light mode").click();
  await until(() => A.evaluate(() => !document.querySelector(".excalidraw").classList.contains("theme--dark")), { what: "light theme again" });
  await A.close();
});

test("a save while a live update is being applied doesn't claim the update's layout as the person's", { skip }, async () => {
  const opened = await cli(["open", "race", "--no-open"]);
  const u = new URL(opened.json.error?.url ?? opened.json.result.url);
  u.searchParams.set("test", "1");
  const A = await S.context.newPage();
  await A.setViewportSize({ width: 1600, height: 1000 });
  await A.goto(u.href);
  await until(() => A.evaluate(() => window.obeyaTest?.ready()), { what: "tab ready", timeout: 60000 });
  const T = (fn, ...args) => A.evaluate(([f, a]) => window.obeyaTest[f](...a), [fn, args]);
  const r = await cli(["patch", "race", "--file", "-"], { stdin: JSON.stringify({ skeleton: [
    { type: "rectangle", id: "box", x: 100, y: 100, width: 200, height: 100 },
    { type: "rectangle", id: "far", x: 600, y: 100, width: 200, height: 100 },
    { type: "arrow", id: "link", x: 300, y: 150, width: 300, height: 0, start: { id: "box" }, end: { id: "far" } },
  ] }) });
  assert.equal(r.code, 0, r.stdout);
  await sleep(2500); // past the patch's settling window
  const start = (await cli(["changes", "race"])).json.result.rev;
  // Another tab moved the box. While that is being applied here, the editor
  // re-routes the arrow bound to it, and a save of the person's edits starts.
  const els = await T("elements");
  const box = els.find((e) => e.id === "box"), link = els.find((e) => e.id === "link");
  await T("remoteThenFlush", [{ ...box, y: 300, version: box.version + 5, versionNonce: 7 }],
    { id: "link", fields: { points: [[0, 0], [link.points.at(-1)[0], -200]], y: link.y + 200 } });
  await sleep(800);
  const user = (await cli(["changes", "race", "--since", String(start), "--source", "user"])).json.result.changes;
  assert.deepEqual(user.map((c) => c.id), [], JSON.stringify(user, null, 1));
  await A.close();
});

test("the port comes back serving another folder: the tab stops and asks for a reload", { skip }, async () => {
  const opened = await cli(["open", "board", "--no-open"]);
  const u = new URL(opened.json.error?.url ?? opened.json.result.url);
  u.searchParams.set("test", "1");
  const A = await S.context.newPage();
  await A.setViewportSize({ width: 1600, height: 1000 });
  await A.goto(u.href);
  await until(() => A.evaluate(() => window.obeyaTest?.ready()), { what: "tab ready", timeout: 60000 });
  const state = () => A.evaluate(() => window.obeyaTest.connection());
  await until(async () => (await state()) === "connected", { what: "connected" });
  assert.equal((await cli(["stop"])).json.result.stopped, true);
  await until(async () => (await state()) === "away", { what: "away" });
  const other = path.join(S.tmp, "other-canvas");
  const env = S.env;
  S.env = { ...env, OBEYA_DIR: other };
  try {
    assert.equal((await cli(["pages"])).code, 0); // a server for another folder, same port
    await until(async () => (await state()) === "wrong-folder", { what: "the tab sees another folder", timeout: 20000 });
    assert.match(await A.textContent("#notice-text"), /different folder/);
    assert.equal((await cli(["stop"])).json.result.stopped, true);
  } finally {
    S.env = env;
  }
  assert.deepEqual(fs.existsSync(other) ? fs.readdirSync(other).filter((f) => !f.startsWith(".")) : [], [], "nothing saved into the other folder");
  await A.close();
});

test("an empty page shows the welcome screen until something is drawn", { skip }, async () => {
  const opened = await cli(["open", "blank-slate", "--no-open"]);
  const u = new URL(opened.json.error?.url ?? opened.json.result.url);
  u.searchParams.set("test", "1");
  const A = await S.context.newPage();
  await A.setViewportSize({ width: 1600, height: 1000 });
  await A.goto(u.href);
  await until(() => A.evaluate(() => window.obeyaTest?.ready()), { what: "tab ready", timeout: 60000 });
  await A.waitForSelector("[data-testid=welcome]");
  assert.match(await A.textContent("[data-testid=welcome-ask]"), /on blank-slate/);
  assert.ok(await A.evaluate(() => document.querySelector("[data-testid=welcome] img")?.naturalWidth > 0), "the logo loads");
  // Its menu reaches New page… and the picker.
  await A.click("[data-testid=welcome-new-page]");
  await A.waitForSelector("[data-testid=new-page-dialog]");
  await A.keyboard.press("Escape");
  await A.click("[data-testid=welcome-pages]");
  await A.waitForSelector("[data-testid=page-picker]");
  await A.keyboard.press("Escape");
  // The first thing drawn (here by the agent) puts it away.
  const r = await cli(["patch", "blank-slate", "--file", "-"], { stdin: JSON.stringify({ skeleton: [{ type: "rectangle", id: "first", x: 0, y: 0, width: 100, height: 60 }] }) });
  assert.equal(r.code, 0, r.stdout);
  await until(() => A.evaluate(() => !document.querySelector("[data-testid=welcome]")), { what: "the welcome screen goes away" });
  await A.close();
});

test("folders: the picker by folder, New page into a folder, moving, a link into a folder, delete", { skip }, async () => {
  const dir = path.join(S.tmp, "canvas");
  const empty = JSON.stringify({ type: "excalidraw", version: 2, elements: [], appState: {}, files: {} });
  for (const n of ["project-a/overview", "project-b/research/interviews"]) {
    fs.mkdirSync(path.dirname(path.join(dir, n)), { recursive: true });
    fs.writeFileSync(path.join(dir, `${n}.excalidraw`), empty);
  }
  const opened = await cli(["open", "board", "--no-open"]);
  const u = new URL(opened.json.error?.url ?? opened.json.result.url);
  u.searchParams.set("test", "1");
  const A = await S.context.newPage();
  await A.setViewportSize({ width: 1600, height: 1000 });
  await A.goto(u.href);
  await until(() => A.evaluate(() => window.obeyaTest?.ready()), { what: "tab ready", timeout: 60000 });
  const T = (fn, ...args) => A.evaluate(([f, a]) => window.obeyaTest[f](...a), [fn, args]);
  const onDisk = (rel) => fs.existsSync(path.join(dir, rel));
  const menu = async (id) => { await A.click(".main-menu-trigger"); await A.click(`[data-testid=${id}]`); };

  // The picker: top-level pages, then a heading per folder.
  await A.keyboard.press("ControlOrMeta+KeyO");
  await until(async () => (await A.$$eval("[data-testid=picker-folder]", (els) => els.map((e) => e.firstChild.textContent))).join() === "project-a,project-b / research",
    { what: "folder headings", timeout: 5000 });
  // Search reaches into folders and shows where a match lives.
  await A.keyboard.type("interv");
  assert.equal(await A.getAttribute("[data-testid=picker-row]", "data-name"), "project-b/research/interviews");
  assert.match(await A.textContent("[data-testid=picker-row]"), /project-b \/ research/);
  await A.fill("[data-testid=picker-search]", "");
  // + page here: New page in that folder.
  await A.hover("[data-testid=picker-folder] >> nth=0");
  await A.click("[data-testid=picker-new-here] >> nth=0");
  await A.waitForSelector("[data-testid=new-page-dialog]");
  assert.equal(await A.inputValue("[data-testid=new-page-folder]"), "project-a");
  await A.fill("[data-testid=new-page-name]", "api");
  await A.click("[data-testid=new-page-create]");
  await until(async () => (await T("page")) === "project-a/api", { what: "project-a/api opens" });
  assert.ok(onDisk("project-a/api.excalidraw"));
  assert.equal(await A.textContent("[data-testid=pill-folder]"), "project-a / ");
  assert.equal(await A.title(), "obeya - project-a/api");

  // New page into a new folder.
  await menu("menu-new-page");
  assert.equal(await A.inputValue("[data-testid=new-page-folder]"), "project-a", "starts in the folder on screen");
  await A.fill("[data-testid=new-page-name]", "kickoff");
  await A.selectOption("[data-testid=new-page-folder]", { label: "+ New folder…" });
  await A.fill("[data-testid=new-page-folder-new]", "project-c");
  await A.click("[data-testid=new-page-create]");
  await until(async () => (await T("page")) === "project-c/kickoff" && onDisk("project-c/kickoff.excalidraw"), { what: "a page in a new folder" });

  // Move it: Rename or move, another folder. Its change log goes with it; the emptied folder goes away.
  assert.equal((await cli(["patch", "project-c/kickoff", "--file", "-"], { stdin: JSON.stringify({ skeleton: [{ type: "rectangle", id: "k1", x: 0, y: 0, width: 80, height: 40 }] }) })).code, 0);
  await menu("menu-rename");
  await A.selectOption("[data-testid=rename-folder]", "project-b");
  assert.equal(await A.textContent("[data-testid=rename-submit]"), "Move");
  await A.click("[data-testid=rename-submit]");
  await until(async () => (await T("page")) === "project-b/kickoff", { what: "the tab follows the move" });
  assert.ok(onDisk("project-b/kickoff.excalidraw") && !onDisk("project-c"), "moved; the empty folder is gone");
  assert.ok(onDisk(".obeya/project-b/kickoff.changes.jsonl"), "the change log moved too");
  assert.equal((await cli(["changes", "project-b/kickoff", "--since", "0", "--source", "all"])).json.result.changes[0].id, "k1");

  // A link into a folder opens that page.
  const link = new URL(u.href);
  link.searchParams.set("page", "project-a/overview");
  await A.goto(link.href);
  await until(async () => (await A.evaluate(() => window.obeyaTest?.page())) === "project-a/overview", { what: "a link into a folder", timeout: 60000 });

  // Delete: confirm, then the page goes to the trash and the tab opens another.
  await menu("menu-rename");
  await A.click("[data-testid=delete-page]");
  await A.waitForSelector("[data-testid=delete-confirm]");
  await A.click("[data-testid=delete-confirm-button]");
  await until(async () => (await T("page")) && (await T("page")) !== "project-a/overview", { what: "another page opens" });
  assert.ok(!onDisk("project-a/overview.excalidraw"));
  const trash = fs.readdirSync(path.join(dir, ".obeya", ".trash"));
  assert.ok(trash.some((t) => fs.existsSync(path.join(dir, ".obeya", ".trash", t, "project-a", "overview.excalidraw"))), "in the trash");
  assert.ok(!(await cli(["pages"])).json.result.pages.some((p) => p.name === "project-a/overview"), "and stays deleted");

  for (const f of ["project-a", "project-b"]) fs.rmSync(path.join(dir, f), { recursive: true, force: true });
  await A.close();
});

test("images: an agent patches an image in by path; it is drawn, saved inside the page, exported, and shown live in another tab", { skip }, async () => {
  const opened = await cli(["open", "pictures", "--no-open"]);
  const u = new URL(opened.json.error?.url ?? opened.json.result.url);
  u.searchParams.set("test", "1");
  const tabs = [];
  for (let i = 0; i < 2; i++) {
    const t = await S.context.newPage();
    await t.setViewportSize({ width: 1600, height: 1000 });
    await t.goto(u.href);
    await until(() => t.evaluate(() => window.obeyaTest?.ready()), { what: "tab ready", timeout: 60000 });
    tabs.push(t);
  }
  const [A, B] = tabs;
  const T = (tab, fn, ...a) => tab.evaluate(([f, x]) => window.obeyaTest[f](...x), [fn, a]);
  // A real PNG on disk (1×1 red, stretched by the patch), named by its path.
  const pic = path.join(S.tmp, "red.png");
  fs.writeFileSync(pic, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==", "base64"));
  await A.bringToFront();
  await A.mouse.click(800, 500); // A is the tab in use: it applies the patch
  await sleep(400);
  const r = await cli(["patch", "pictures", "--file", "-"], { stdin: JSON.stringify({ skeleton: [{ type: "image", id: "pic", src: pic, x: 100, y: 100, width: 200, height: 120 }] }) });
  assert.equal(r.code, 0, r.stdout);
  assert.equal(r.json.result.created, 1);
  const el = (await T(A, "elements")).find((e) => e.id === "pic");
  assert.equal(el.type, "image");
  assert.ok((await T(A, "files")).includes(el.fileId), "tab A has the file");
  await until(async () => (await T(B, "files")).includes(el.fileId), { what: "tab B gets the file with the live update", timeout: 5000 });
  // Saved inside the page, with no path anywhere.
  await until(() => fs.existsSync(path.join(S.tmp, "canvas", "pictures.excalidraw")), { what: "saved" });
  await sleep(600);
  const saved = fs.readFileSync(path.join(S.tmp, "canvas", "pictures.excalidraw"), "utf8");
  assert.match(JSON.parse(saved).files[el.fileId].dataURL, /^data:image\/png;base64,/);
  assert.ok(!saved.includes(S.tmp), "the src path isn't saved");
  // Exported with the image.
  const svg = path.join(S.tmp, "export", "pictures.svg");
  assert.equal((await cli(["export", "pictures", "--format", "svg", "--out", svg])).code, 0);
  assert.ok(fs.readFileSync(svg, "utf8").includes("data:image/png;base64,"));
  for (const t of tabs) await t.close();
});

test("wait: the ask shows on that page's tab only (other tabs count it in the pill), the frame outlined; Done returns the person's changes", { skip }, async () => {
  const opened = await cli(["open", "board", "--no-open"]);
  const u = new URL(opened.json.error?.url ?? opened.json.result.url);
  u.searchParams.set("test", "1");
  const open = async (page) => {
    const v = new URL(u.href);
    v.searchParams.set("page", page);
    const t = await S.context.newPage();
    await t.setViewportSize({ width: 1600, height: 1000 });
    await t.goto(v.href);
    await until(() => t.evaluate(() => window.obeyaTest?.ready()), { what: `tab on ${page} ready`, timeout: 60000 });
    return t;
  };
  const A = await open("board");
  await A.mouse.click(1500, 900);
  assert.equal((await cli(["patch", "wait-other", "--file", "-"], { stdin: JSON.stringify({ skeleton: [{ type: "rectangle", id: "o1", x: 0, y: 0, width: 80, height: 40 }] }) })).code, 0);
  const B = await open("wait-other");
  await cli(["changes", "board"]); // the agent is up to date
  await A.bringToFront();

  const waiting = cli(["wait", "board", "--ask", "Move the first note, then press Done", "--frame", "f1"]);
  await A.waitForSelector('[data-testid="wait-banner"]', { timeout: 10000 });
  assert.equal(await A.textContent('[data-testid="wait-ask"]'), "Move the first note, then press Done");
  assert.ok(await A.isVisible('[data-testid="wait-frame"]'), "the frame is outlined");
  assert.match(await A.title(), /^● obeya - board$/);
  // It follows the editor's theme: Excalidraw's own toggle (Shift+Alt+D), and back.
  const bannerBg = () => A.evaluate(() => getComputedStyle(document.querySelector(".xl-wait")).backgroundColor);
  const light = await bannerBg();
  await A.keyboard.press("Alt+Shift+KeyD");
  await until(async () => (await bannerBg()) !== light, { what: "the banner turns dark" });
  assert.equal(await bannerBg(), "rgb(35, 35, 41)");
  await A.keyboard.press("Alt+Shift+KeyD");
  await until(async () => (await bannerBg()) === light, { what: "and light again" });
  await until(async () => /^obeya - wait-other$/.test(await B.title()), { what: "the other tab's title is unmarked" });
  assert.equal(await B.$('[data-testid="wait-banner"]'), null, "no banner on another page");
  assert.equal(await B.textContent('[data-testid="pill-waiting"]'), "(1 waiting)", "the other tab's page pill counts it");
  assert.equal(await B.evaluate(() => window.obeyaTest.page()), "wait-other", "nothing switched the other tab");

  // The person drags something, then presses Done.
  const TA = (fn, ...args) => A.evaluate(([f, a]) => window.obeyaTest[f](...a), [fn, args]);
  const n1 = (await TA("elements")).find((e) => e.id === "n1");
  const p = await TA("toClient", n1.x + 30, n1.y + 30);
  await A.mouse.move(p.x, p.y);
  await A.mouse.down();
  for (let i = 1; i <= 10; i++) await A.mouse.move(p.x + i * 6, p.y + i * 3);
  await A.mouse.up();
  await A.click('[data-testid="wait-done"]');
  const r = await waiting;
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.equal(r.json.result.done, "button");
  // Whatever is on top there (an earlier test drops an image over the note) moved: the person's change comes back.
  assert.ok(r.json.result.changes.some((c) => c.moved), JSON.stringify(r.json.result.changes));
  assert.doesNotMatch(r.stderr, /no tab shows/, "a tab showed the page: no link needed");
  await until(async () => !(await A.$('[data-testid="wait-banner"]')), { what: "the banner goes" });
  await until(async () => !(await B.$('[data-testid="pill-waiting"]')), { what: "the pill count goes" });
  assert.match(await A.title(), /^obeya - board$/);
  await A.close();
  await B.close();
});

test("re-applying a skeleton to reword a label keeps the element's frame, group, style, link, data and label font", { skip }, async () => {
  const opened = await cli(["open", "reskel", "--no-open"]);
  const u = new URL(opened.json.error?.url ?? opened.json.result.url);
  u.searchParams.set("test", "1");
  u.searchParams.set("page", "board");
  const A = await S.context.newPage();
  await A.setViewportSize({ width: 1600, height: 1000 });
  await A.goto(u.href);
  await until(() => A.evaluate(() => window.obeyaTest?.ready()), { what: "tab ready", timeout: 60000 });
  const patch = (p) => cli(["patch", "reskel", "--file", "-"], { stdin: JSON.stringify(p) });
  let r = await patch({ skeleton: [
    { type: "frame", id: "rf", x: 0, y: 0, width: 800, height: 500, name: "Column", children: ["card"] },
    { type: "stickynote", id: "card", x: 40, y: 60, width: 260, backgroundColor: "#a5d8ff", link: "https://example.com/card", customData: { kind: "roadmap-card", rank: 3 }, groupIds: ["g-card"], label: { text: "Old wording", fontSize: 16 } },
  ] });
  assert.equal(r.code, 0, r.stdout);
  // The guide's way to reword a label: the same skeleton id, a new label, nothing else.
  r = await patch({ skeleton: [{ type: "stickynote", id: "card", x: 40, y: 60, width: 260, label: { text: "New wording that is a good deal longer than the old one" } }] });
  assert.equal(r.code, 0, r.stdout);
  assert.deepEqual(r.json.result.warnings, [], "nothing sticks out of the frame");
  const els = (await cli(["get", "reskel", "--full"])).json.result.elements;
  const card = els.find((e) => e.id === "card"), label = els.find((e) => e.containerId === "card");
  assert.equal(card.frameId, "rf", "still in its frame");
  assert.deepEqual([card.backgroundColor, card.link, card.customData, card.groupIds], ["#a5d8ff", "https://example.com/card", { kind: "roadmap-card", rank: 3 }, ["g-card"]]);
  assert.equal(label.text.replace(/\n/g, " "), "New wording that is a good deal longer than the old one");
  assert.equal(label.fontSize, 16, "the label keeps its size");
  assert.equal(label.frameId, "rf", "the new label is in the frame too");
  assert.equal(els.filter((e) => e.containerId === "card").length, 1, "one label, no orphan");
  // A skeleton that says otherwise still wins.
  r = await patch({ skeleton: [{ type: "stickynote", id: "card", x: 40, y: 60, width: 260, backgroundColor: "#ffc9c9", label: { text: "Red now", fontSize: 20 } }] });
  const after = (await cli(["get", "reskel", "--full"])).json.result.elements;
  assert.equal(after.find((e) => e.id === "card").backgroundColor, "#ffc9c9");
  assert.equal(after.find((e) => e.containerId === "card").fontSize, 20);
  await A.close();
});

test("frames by position: a new element inside a frame joins it, an edit moves it in or out; a patch that says where wins", { skip }, async () => {
  const opened = await cli(["open", "framepos", "--no-open"]);
  const u = new URL(opened.json.error?.url ?? opened.json.result.url);
  u.searchParams.set("test", "1");
  u.searchParams.set("page", "board");
  const A = await S.context.newPage();
  await A.setViewportSize({ width: 1600, height: 1000 });
  await A.goto(u.href);
  await until(() => A.evaluate(() => window.obeyaTest?.ready()), { what: "tab ready", timeout: 60000 });
  const patch = (p) => cli(["patch", "framepos", "--file", "-"], { stdin: JSON.stringify(p) });
  const frameOf = async () => Object.fromEntries((await cli(["get", "framepos", "--full"])).json.result.elements.map((e) => [e.id, e.frameId ?? null]));
  let r = await patch({ skeleton: [
    { type: "frame", id: "fa", x: 0, y: 0, width: 800, height: 600, name: "A" },
    { type: "frame", id: "fb", x: 1000, y: 0, width: 800, height: 600, name: "B" },
  ] });
  assert.equal(r.code, 0, r.stdout);
  // Later patches, no frameId and no children: the way agents usually add things.
  r = await patch({ skeleton: [
    { type: "rectangle", id: "box", x: 40, y: 60, width: 200, height: 100, label: { text: "In A" } },
    { type: "rectangle", id: "half", x: 700, y: 60, width: 200, height: 100 },
    { type: "rectangle", id: "free", x: 40, y: 800, width: 200, height: 100 },
    { type: "rectangle", id: "mine", x: 300, y: 60, width: 200, height: 100, frameId: null },
  ] });
  assert.equal(r.code, 0, r.stdout);
  let f = await frameOf();
  const label = (await cli(["get", "framepos", "--full"])).json.result.elements.find((e) => e.containerId === "box");
  assert.deepEqual([f.box, label.frameId, f.half, f.free, f.mine], ["fa", "fa", null, null, null], "inside joins, sticking out or outside doesn't, frameId: null is respected");
  // A deleted element brought back by a new skeleton with the same id is new again: it joins too.
  await patch({ delete: ["half"] });
  r = await patch({ skeleton: [{ type: "rectangle", id: "half", x: 300, y: 300, width: 200, height: 100 }] });
  assert.equal(r.code, 0, r.stdout);
  assert.equal((await frameOf()).half, "fa", "a re-created element joins by position");
  // An edit moves it into B, then out of every frame.
  await patch({ elements: [{ id: "box", x: 1040, y: 60 }] });
  f = await frameOf();
  assert.equal(f.box, "fb");
  await patch({ elements: [{ id: "box", x: 400, y: 800 }] });
  f = await frameOf();
  assert.equal(f.box, null);
  // An edit that says its frame wins over position, and the label goes with its shape.
  await patch({ skeleton: [{ type: "rectangle", id: "free", x: 40, y: 800, width: 200, height: 100, label: { text: "Free" } }] });
  await patch({ elements: [{ id: "free", frameId: "fb" }] });
  f = await frameOf();
  assert.equal(f.free, "fb");
  const freeLabel = (await cli(["get", "framepos", "--full"])).json.result.elements.find((e) => e.containerId === "free");
  assert.equal(freeLabel.frameId, "fb", "the label follows its shape into the frame");
  assert.equal((await cli(["lint", "framepos", "--rule", "outside-frame,overlap"])).json.result.findings.filter((x) => x.ids.includes("box")).length, 0);
  await A.close();
});

test("an empty frame keeps the box it was given; defaults give new elements the page's base style", { skip }, async () => {
  const opened = await cli(["open", "defaults", "--no-open"]);
  const u = new URL(opened.json.error?.url ?? opened.json.result.url);
  u.searchParams.set("test", "1");
  u.searchParams.set("page", "board");
  const A = await S.context.newPage();
  await A.setViewportSize({ width: 1600, height: 1000 });
  await A.goto(u.href);
  await until(() => A.evaluate(() => window.obeyaTest?.ready()), { what: "tab ready", timeout: 60000 });
  const patch = (p) => cli(["patch", "defaults", "--file", "-"], { stdin: JSON.stringify(p) });
  let r = await patch({
    defaults: { rectangle: { backgroundColor: "#d3f9d8", fillStyle: "hachure" }, label: { fontSize: 14 } },
    skeleton: [
      { type: "frame", id: "art", x: 0, y: 0, width: 1600, height: 900, name: "01 Artboard" },
      { type: "rectangle", id: "a", x: 40, y: 40, width: 200, height: 100, label: { text: "Base style" } },
      { type: "rectangle", id: "b", x: 300, y: 40, width: 200, height: 100, backgroundColor: "#ffc9c9", label: { text: "Its own fill", fontSize: 20 } },
    ],
  });
  assert.equal(r.code, 0, r.stdout);
  let els = (await cli(["get", "defaults", "--full"])).json.result.elements;
  const art = els.find((e) => e.id === "art");
  assert.deepEqual([art.x, art.y, art.width, art.height], [0, 0, 1600, 900], "the frame's box as given");
  const byId = (id) => els.find((e) => e.id === id), labelOf = (id) => els.find((e) => e.containerId === id);
  assert.deepEqual([byId("a").backgroundColor, byId("a").fillStyle, labelOf("a").fontSize], ["#d3f9d8", "hachure", 14]);
  assert.deepEqual([byId("b").backgroundColor, labelOf("b").fontSize], ["#ffc9c9", 20], "an element's own fields win");
  assert.equal(byId("a").frameId, "art", "joined the frame by position");
  // Re-applying a skeleton with defaults doesn't restyle what's there.
  r = await patch({ defaults: { rectangle: { backgroundColor: "#a5d8ff" } }, skeleton: [{ type: "rectangle", id: "a", x: 40, y: 40, width: 200, height: 100, label: { text: "Reworded" } }] });
  assert.equal(r.code, 0, r.stdout);
  els = (await cli(["get", "defaults", "--full"])).json.result.elements;
  assert.equal(byId("a").backgroundColor, "#d3f9d8");
  // Bad defaults are refused before anything changes.
  r = await patch({ defaults: { rectangle: "solid" }, skeleton: [] });
  assert.equal(r.json.error.code, "invalid_patch");
  await A.close();
});
