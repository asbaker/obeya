// Who renders a shot or export: the person's tab, else a headless Chrome
// started for the purpose, else the official Excalidraw CLI if installed,
// else a tab opened as usual.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { findChrome } from "../lib/chrome.mjs";
import { sidecarDir } from "../lib/paths.mjs";
import { CliError, ensureBrowser, ensureServer, sleep } from "./client.mjs";

/**
 * Run `fn` with something that can render: the person's tab if one is
 * connected, else a headless Chrome started for the purpose (no visible
 * window), else (no Chrome found) the person's tab, opened as usual.
 */
export async function withRenderer(plan, client, note, env, fn, { offline, used = {} } = {}) {
  const i = await ensureServer(plan, client, note);
  if (i.browsers > 0 || i.renderers > 0) {
    used.renderer = i.browsers > 0 ? "tab" : "headless";
    return fn();
  }
  const chrome = findChrome(env);
  if (!chrome && offline) {
    const r = await offline();
    if (r !== null) {
      used.renderer = "excalidraw-cli";
      return r;
    }
  }
  used.renderer = chrome ? "headless" : "tab";
  if (!chrome) {
    note("no Chrome or Chromium found for headless rendering; using a browser tab instead");
    await ensureBrowser(plan, client, note, plan.page);
    return fn();
  }
  const profile = path.join(sidecarDir(plan.dir), "renderer-profile"); // keeps the library cache warm
  const url = client.canvasUrl(plan.page, null, { renderer: "1" });
  const child = spawn(chrome, ["--headless=new", `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "--disable-extensions", url], { stdio: "ignore" });
  let exited = false;
  child.on("exit", () => (exited = true));
  child.on("error", () => (exited = true));
  note("rendering in headless Chrome…");
  try {
    let ready = false;
    for (let t = 0; t < 240 && !ready && !exited; t++) {
      await sleep(250);
      ready = (await client.info())?.renderers > 0;
    }
    if (!ready) throw new CliError("renderer_failed", "headless Chrome didn't start rendering within 60s; open the canvas (obeya open) and retry");
    return await fn();
  } finally {
    // Wait until it has really gone: a dying renderer still connected to the
    // server would be handed the next export and never answer.
    if (!exited) {
      const gone = new Promise((r) => child.once("exit", r));
      child.kill();
      await Promise.race([gone, sleep(5000)]);
    }
    for (let t = 0; t < 40 && (await client.info())?.renderers > 0; t++) await sleep(50);
  }
}

/** Path of an executable on PATH, or null. */
function onPath(name, env) {
  const exts = process.platform === "win32" ? ["", ".cmd", ".exe"] : [""];
  for (const dir of (env.PATH ?? "").split(path.delimiter)) {
    for (const ext of exts) {
      const p = path.join(dir, name + ext);
      try {
        fs.accessSync(p, fs.constants.X_OK);
        if (fs.statSync(p).isFile()) return p;
      } catch {}
    }
  }
  return null;
}

const run_ = (bin, args, { input, timeoutMs = 60000, env } = {}) =>
  new Promise((resolve) => {
    const child = spawn(bin, args, { stdio: ["pipe", "pipe", "pipe"], env });
    let out = "", err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.on("error", () => resolve({ code: -1, out, err }));
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, out, err });
    });
    // A program that exits without reading stdin (e.g. an unrelated
    // `excalidraw`) closes the pipe: that's not our error; its exit code tells.
    child.stdin.on("error", () => {});
    child.stdin.end(input ?? "");
  });

const pngSize = (buf) => (buf.length > 24 && buf.toString("latin1", 1, 4) === "PNG" ? { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) } : { width: null, height: null });

/**
 * Render a page with the official Excalidraw CLI (`excalidraw render`), if it
 * is installed. Never installs it. Fonts: --fonts-url none, so it fetches no
 * fonts. Returns null when it isn't available.
 */
export async function officialRender(client, env, page, frame, scale) {
  const bin = onPath("excalidraw", env);
  if (!bin) return null;
  const help = await run_(bin, ["render", "--help"], { env, timeoutMs: 15000 });
  if (!/Excalidraw CLI/.test(help.out + help.err)) return null; // some other program named excalidraw
  const { scene } = await client.call("GET", `/api/pages/${encodeURIComponent(page)}`); // the server's latest, saved or not
  if (frame && !scene.elements.some((e) => e.id === frame && !e.isDeleted)) throw new CliError("unknown_element", `no element "${frame}" on page "${page}"`);
  const tmp = path.join(os.tmpdir(), `obeya-shot-${process.pid}-${Date.now()}.png`);
  const args = ["render", "-", "--out", tmp, "--format", "png", "--fonts-url", "none", "--scale", String(scale)];
  if (frame) args.push("--frame-id", frame);
  const r = await run_(bin, args, { input: JSON.stringify(scene), env });
  try {
    if (r.code !== 0 || !fs.existsSync(tmp)) throw new CliError("renderer_failed", `excalidraw render failed: ${(r.err || r.out).trim().split("\n").pop() || `exit ${r.code}`}`);
    const bytes = fs.readFileSync(tmp);
    return { bytes, ...pngSize(bytes) };
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}
