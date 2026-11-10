// obeya CLI: the agent's side of the canvas. Talks only to the local
// server, and starts it in the background when it isn't running.
//
// Every command prints one JSON envelope on stdout:
//   {"id": "cli:<command>", "result": {...}}
//   {"id": "cli:<command>", "error": {"code": "...", "message": "...", ...}}
// Exit codes: 0 ok, 1 error, 2 the person needs to act (open the link).


import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseCli, UsageError } from "../lib/args.mjs";
import { commandHelp, lookup, overviewHelp } from "../lib/commands.mjs";
import { compact, outline } from "../lib/report.mjs";
import { lint, RULES } from "../lib/lint.mjs";
import { sameDir, shotsDir } from "../lib/paths.mjs";
import { findItem, instantiate, itemSize } from "../lib/library.mjs";
import { ensureLibrary } from "../lib/libcache.mjs";
import { CliError, ensureBrowser, ensureServer, makeClient, openInBrowser, sleep } from "./client.mjs";
import { resolvePort } from "./ports.mjs";
import { resolveImages } from "./images.mjs";
import { officialRender, withRenderer } from "./render.mjs";
import { runExport } from "./export.mjs";
import { lib, libSummary, notifyLibraries, runLibrary } from "./library.mjs";

export { CliError };

const here = path.dirname(fileURLToPath(import.meta.url));
const SKILL = path.join(here, "..", "skill.md");
const VERSION = JSON.parse(fs.readFileSync(path.join(here, "..", "..", "package.json"), "utf8")).version;

/** Errors whose fix is for the person to do something. */
const PERSON_ACTS = new Set(["no_canvas_open", "canvas_not_connected"]);

/**
 * Run the CLI. Returns {stdout, stderr, code} so tests can call it in-process;
 * the bin script prints and exits.
 * @param {string[]} argv
 * @param {{env?: Record<string,string|undefined>, cwd?: string, stdin?: () => string, onStderr?: (line: string) => void}} [ctx]
 */
export async function run(argv, ctx = {}) {
  const env = ctx.env ?? process.env;
  const cwd = ctx.cwd ?? process.cwd();
  const io = { out: [], err: [] };
  // Notices stream as they happen when the caller wants them (the bin does).
  const errLine = ctx.onStderr ?? ((line) => io.err.push(line));
  const note = (msg) => errLine(`obeya: ${msg}`);
  let id = "cli";
  const done = (code) => ({ stdout: io.out.join("\n"), stderr: io.err.join("\n"), code });

  let plan;
  try {
    plan = parseCli(argv, env, cwd);
  } catch (err) {
    if (!(err instanceof UsageError)) throw err;
    id = err.command ? `cli:${err.command.replace(" ", ":")}` : "cli";
    io.out.push(JSON.stringify({ id, error: { code: err.code, message: err.message, ...(err.command ? { usage: `obeya ${lookup(err.command).usage}` } : {}) } }));
    errLine(err.command ? commandHelp(err.command) : "Run `obeya --help` for the list of commands.");
    return done(1);
  }

  if (plan.skill) {
    io.out.push(fs.readFileSync(SKILL, "utf8").trimEnd());
    return done(0);
  }
  if (plan.version) {
    io.out.push(VERSION);
    return done(0);
  }
  if (!plan.command) {
    io.out.push(overviewHelp());
    return done(0);
  }
  if (plan.groupHelp) {
    io.out.push(commandHelp(plan.command));
    return done(0);
  }
  if (plan.help) {
    io.out.push(commandHelp(plan.name));
    return done(0);
  }

  id = `cli:${plan.name.replace(" ", ":")}`;
  plan.env = env;
  try {
    const result = await execute(plan, { env, cwd, note, stdin: ctx.stdin ?? (() => fs.readFileSync(0, "utf8")), print: (s) => io.out.push(s) });
    if (result !== undefined) io.out.push(JSON.stringify({ id, result }, null, 2));
    return done(0);
  } catch (err) {
    if (!(err instanceof CliError)) {
      io.out.push(JSON.stringify({ id, error: { code: "internal", message: String(err?.message || err) } }, null, 2));
      return done(1);
    }
    io.out.push(JSON.stringify({ id, error: { code: err.code, message: err.message, ...err.extra } }, null, 2));
    if (err.extra?.url) note(`open this link in your browser: ${err.extra.url}`);
    return done(PERSON_ACTS.has(err.code) ? 2 : 1);
  }
}

function readPatch(file, cwd, stdin) {
  let text;
  try {
    text = file === "-" ? stdin() : fs.readFileSync(path.resolve(cwd, file), "utf8");
  } catch (err) {
    throw new CliError("invalid_argument", `cannot read --file ${file}: ${err.code || err.message}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new CliError("invalid_patch", "the patch is not valid JSON");
  }
}

async function execute(plan, { env, cwd, note, stdin, print }) {
  const { name: cmd, page, flags } = plan;
  // The folder's own port, unless --port / OBEYA_PORT says. status and stop
  // only look; library commands other than insert need no server.
  const needsNoServer = cmd.startsWith("library ") && cmd !== "library insert";
  try {
    plan.port = await resolvePort(plan, env, { remember: !["status", "stop"].includes(cmd) && !needsNoServer });
  } catch (err) {
    if (err.code === "no_free_port") throw new CliError(err.code, err.message);
    throw err;
  }
  const client = makeClient(plan);
  const spec = lookup(cmd);

  // Read inputs before any side effect, so a bad patch never starts a server or opens a tab.
  // Images: each `src` (a local file) becomes a fileId plus the file.
  const patch = cmd === "patch" ? resolveImages(readPatch(flags.file, cwd, stdin), cwd) : null;
  if (cmd.startsWith("library ") && cmd !== "library insert") return runLibrary(plan, client, note, env, cwd);
  // Download the library before opening anything, so a bad id fails fast.
  let libraryItem = null;
  if (cmd === "library insert") {
    const [libId, itemId] = plan.args.item.split("/");
    const { lib: l, downloaded } = await lib(() => ensureLibrary(env, libId));
    if (downloaded) {
      note(`downloaded ${l.id} into your library cache`);
      await notifyLibraries(plan, client);
    }
    try {
      libraryItem = { lib: l, item: findItem(l, itemId) };
    } catch (err) {
      const { code, message, ...extra } = err;
      throw new CliError(code, err.message, extra);
    }
  }

  if (spec.live) await ensureBrowser(plan, client, note, page, flags.frame);
  else if (!["serve", "status", "stop", "open"].includes(cmd)) await ensureServer(plan, client, note);

  switch (cmd) {
    case "serve": {
      const i = await ensureServer(plan, client, note);
      return { url: client.base, dir: i.dir, pid: i.pid, browsers: i.browsers, idleTimeout: i.idleTimeout };
    }
    case "status": {
      const i = await client.info();
      if (i?.foreign) return { running: false, url: client.base, portInUse: true };
      if (!i) return { running: false, url: client.base };
      return { running: true, url: client.base, dir: i.dir, sameDir: sameDir(i.dir, plan.dir), pid: i.pid, browsers: i.browsers, version: i.version, idleTimeout: i.idleTimeout };
    }
    case "stop": {
      const i = await client.info();
      if (!i || i.foreign) return { running: false, stopped: false };
      if (!sameDir(i.dir, plan.dir)) throw new CliError("port_in_use_other_dir", `port ${plan.port} is serving a canvas for a different directory; not stopping it`, { serving: i.dir });
      await client.call("POST", "/api/shutdown");
      // Return once the port is free, so a following command can start a new server.
      for (let t = 0; t < 50 && (await client.info()); t++) await sleep(100);
      return { running: false, stopped: true };
    }
    case "open": {
      const i = await ensureServer(plan, client, note);
      const url = client.canvasUrl(page, flags.frame);
      if (i.browsers > 0) {
        if (page) await client.call("POST", `/api/pages/${encodeURIComponent(page)}/show`, { frame: flags.frame });
        return { url, opened: false, switched: Boolean(page), note: "a canvas tab is already connected" };
      }
      if (plan.noOpen) return { url, opened: false, note: "open this link in your browser" };
      openInBrowser(url);
      return { url, opened: true };
    }
    case "pages":
      return await client.call("GET", "/api/pages");
    case "get": {
      const { rev, scene } = await client.call("GET", `/api/pages/${encodeURIComponent(page)}`);
      let els = flags.full ? scene.elements : compact(scene.elements);
      if (flags.frame) els = els.filter((e) => e.id === flags.frame || e.frame === flags.frame || e.frameId === flags.frame);
      return { page, rev, elements: els };
    }
    case "describe": {
      const { rev, scene } = await client.call("GET", `/api/pages/${encodeURIComponent(page)}`);
      const text = outline(page, rev, scene.elements);
      if (flags.format === "text") {
        print(text);
        return undefined;
      }
      return { page, rev, outline: text };
    }
    case "lint": {
      const { rev, scene } = await client.call("GET", `/api/pages/${encodeURIComponent(page)}`);
      if (flags.frame && !scene.elements.some((e) => e.id === flags.frame && !e.isDeleted)) throw new CliError("unknown_element", `no element "${flags.frame}" on page "${page}"`);
      const rules = flags.rule ? flags.rule.split(",").filter(Boolean) : RULES;
      return { page, rev, findings: lint(scene.elements, { frame: flags.frame, rules }) };
    }
    case "patch":
      return await client.call("POST", `/api/pages/${encodeURIComponent(page)}/patch`, patch);
    case "changes": {
      // POST: reading with "last" moves the consumer's read cursor.
      return await client.call("POST", `/api/pages/${encodeURIComponent(page)}/changes`, { since: flags.since ?? "0", consumer: plan.consumer, ...(flags.source ? { source: flags.source } : {}) });
    }
    case "shot": {
      // The person's tab renders if one is open; otherwise a headless Chrome;
      // without Chrome, the official Excalidraw CLI if installed; else a tab.
      const scale = flags.scale ? Number(flags.scale) : 1;
      const used = {};
      const r = await withRenderer(plan, client, note, env,
        () => client.call("POST", "/api/export", { items: [{ page, frame: flags.frame }], type: "png", scale, padding: 20 }).then((x) => x.items[0]),
        { used, offline: () => officialRender(client, env, page, flags.frame, scale) });
      const out = flags.out ? path.resolve(cwd, flags.out) : path.join(shotsDir(plan.dir), `${page}${flags.frame ? "-" + flags.frame : ""}.png`);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, r.bytes ?? Buffer.from(r.png, "base64"));
      return { page, frame: flags.frame ?? null, out, width: r.width, height: r.height, renderer: used.renderer };
    }
    case "library insert": {
      const { lib, item } = libraryItem;
      if (flags.frame) {
        const scene = await client.call("GET", `/api/pages/${encodeURIComponent(page)}?ifMissing=empty`);
        if (!scene.scene.elements.some((e) => e.id === flags.frame && e.type === "frame" && !e.isDeleted)) {
          throw new CliError("unknown_element", `no frame "${flags.frame}" on page "${page}"`);
        }
      }
      const prefix = flags.id ?? `${item.id.slice(0, 40)}-${Math.random().toString(36).slice(2, 6)}`;
      const [x, y] = flags.at.split(",").map(Number);
      const elements = instantiate(item, { at: [x, y], prefix, frame: flags.frame ?? null });
      const r = await client.call("POST", `/api/pages/${encodeURIComponent(page)}/patch`, { elements });
      return { ...r, item: `${lib.id}/${item.id}`, library: libSummary(lib), ids: elements.map((e) => e.id), at: [x, y], size: itemSize(item) };
    }
    case "export":
      return await runExport(plan, client, note, env, cwd);
    case "rename":
      return await client.call("POST", `/api/pages/${encodeURIComponent(page)}/rename`, { to: plan.args.to });
    case "band list":
      return await client.call("GET", `/api/pages/${encodeURIComponent(page)}/bands`);
    case "band set": {
      const axis = flags.x !== undefined ? "x" : "y";
      const from = Number(flags.x ?? flags.y);
      return await client.call("PUT", `/api/pages/${encodeURIComponent(page)}/bands/${plan.args.name}`, { axis, from, to: flags.to !== undefined ? Number(flags.to) : from });
    }
    case "band delete":
      return await client.call("DELETE", `/api/pages/${encodeURIComponent(page)}/bands/${plan.args.name}`);
    case "show":
      return await client.call("POST", `/api/pages/${encodeURIComponent(page)}/show`, { frame: flags.frame });
  }
  throw new CliError("unknown_command", `unknown command "${cmd}"`);
}
