// Integration: a real server process, no browser. Covers the request checks,
// the persistent change log and `changes --since last` over HTTP.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { run } from "../src/cli/main.mjs";
import { freePort, tmpDir } from "./helpers/env.mjs";

const servers = [];
after(async () => {
  for (const env of servers) await run(["stop"], { env });
});

async function start() {
  const dir = tmpDir();
  const port = await freePort();
  const env = { ...process.env, OBEYA_DIR: path.join(dir, "canvas"), OBEYA_PORT: String(port) };
  const r = await run(["serve"], { env });
  assert.equal(r.code, 0, r.stdout);
  servers.push(env);
  return { dir, port, env };
}

/** Raw HTTP so the test controls Host and Origin. */
function raw(port, { method = "GET", path: p = "/", headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, method, path: p, headers: { host: `127.0.0.1:${port}`, ...headers } }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString();
        let json = null;
        try { json = JSON.parse(text); } catch {}
        resolve({ status: res.statusCode, headers: res.headers, text, json });
      });
    });
    req.on("error", reject);
    if (body !== undefined) req.end(typeof body === "string" ? body : JSON.stringify(body));
    else req.end();
  });
}

const H = () => ({ "content-type": "application/json" });
const rect = (id, o = {}) => ({ id, type: "rectangle", x: 0, y: 0, width: 100, height: 100, version: 1, versionNonce: 1, ...o });

test("security: Host, Origin and fetch metadata are enforced; no token", async () => {
  const { port, dir } = await start();
  assert.equal((await raw(port, { path: "/api/info" })).status, 200);
  assert.equal((await raw(port, { path: "/api/info", headers: { host: `evil.example:${port}` } })).json.error.code, "forbidden_host");
  assert.equal((await raw(port, { path: "/api/pages" })).status, 200); // like the CLI: no Origin, no token
  const xo = await raw(port, { method: "POST", path: "/api/pages/board/sync", headers: { ...H(), origin: "https://evil.example" }, body: { elements: [rect("x")] } });
  assert.equal(xo.json.error.code, "forbidden_origin");
  const sameSite = await raw(port, { path: "/api/pages", headers: { origin: "http://127.0.0.1:4747" } });
  assert.equal(sameSite.json.error.code, "forbidden_origin");
  assert.equal((await raw(port, { path: "/events", headers: { "sec-fetch-site": "cross-site" } })).status, 403);
  // The page can't be framed, and nothing about the server is kept on disk.
  const page = await raw(port, { path: "/" });
  assert.equal(page.status, 200);
  assert.equal(page.headers["x-frame-options"], "DENY");
  assert.deepEqual(fs.readdirSync(path.join(dir, "canvas", ".obeya")).filter((f) => f.startsWith("server-")), []);
});

test("user edits are logged, persisted, and read with --since last", async () => {
  const { port, env } = await start();
  const sync = (elements) => raw(port, { method: "POST", path: "/api/pages/board/sync", headers: H(), body: { elements } });
  assert.equal((await sync([rect("n1"), rect("n2", { x: 300 })])).json.rev, 2);
  await sync([rect("n1", { version: 2, x: 150 })]);
  // The person draws an ellipse around n2.
  await sync([{ id: "e1", type: "ellipse", x: 260, y: -40, width: 180, height: 180, version: 1, versionNonce: 1 }]);

  // Reading with "last" moves a cursor, so it isn't a GET (the Origin check covers every write).
  const get = await raw(port, { path: "/api/pages/board/changes?since=last" });
  assert.equal(get.status, 405);
  assert.equal(get.json.error.code, "invalid_argument");
  const first = JSON.parse((await run(["changes", "board", "--since", "last"], { env })).stdout).result;
  assert.equal(first.rev, 4);
  const byId = Object.fromEntries(first.changes.map((c) => [c.id, c]));
  assert.deepEqual(byId.n1.op, "added"); // added + moved by the same source coalesce to added
  assert.deepEqual(byId.e1.pointsAt.map((p) => p.id), ["n2"]);
  assert.equal(JSON.parse((await run(["changes", "board", "--since", "last"], { env })).stdout).result.changes.length, 0);

  // A sync claiming to be the agent is still the person's edit.
  await raw(port, { method: "POST", path: "/api/pages/board/sync", headers: H(), body: { source: "agent", elements: [rect("n2", { version: 2, x: 320 })] } });
  const moved = JSON.parse((await run(["changes", "board", "--since", "last", "--source", "user"], { env })).stdout).result.changes;
  assert.deepEqual(moved.map((c) => [c.id, c.op, c.moved]), [["n2", "modified", { from: [300, 0], to: [320, 0] }]]);

  // Restart: log and cursor survive, revisions continue.
  assert.equal((await run(["stop"], { env })).code, 0);
  assert.equal((await run(["serve"], { env })).code, 0);
  const againRaw = await run(["changes", "board", "--since", "0"], { env });
  const again = JSON.parse(againRaw.stdout).result;
  assert.ok(again, againRaw.stdout);
  assert.equal(again.rev, 5);
  assert.equal(JSON.parse((await run(["changes", "board", "--since", "last"], { env })).stdout).result.changes.length, 0);
  const page = JSON.parse((await run(["get", "board"], { env })).stdout).result;
  assert.equal(page.elements.find((e) => e.id === "n2").x, 320);
});

test("errors: unknown page, bad JSON, bad patch, no canvas", async () => {
  const { port, env } = await start();
  const r = await run(["get", "nope"], { env });
  assert.equal(r.code, 1);
  assert.equal(JSON.parse(r.stdout).error.code, "unknown_page");
  assert.equal((await raw(port, { method: "POST", path: "/api/pages/b/sync", headers: H(), body: "{not json" })).json.error.code, "invalid_json");
  assert.equal((await raw(port, { method: "POST", path: "/api/pages/b/patch", headers: H(), body: { skeleton: {} } })).json.error.code, "invalid_patch");
  assert.equal((await raw(port, { method: "POST", path: "/api/pages/b/patch", headers: H(), body: { elements: [] } })).json.error.code, "no_canvas_open");
  assert.equal((await raw(port, { path: "/api/pages/..%2Fx", headers: H() })).json.error.code, "bad_page_name");
});

test("export-file: checks its request; renders through a tab; info says whether PDF works", async () => {
  const { port } = await start();
  const info = (await raw(port, { path: "/api/info" })).json;
  assert.equal(typeof info.pdf, "boolean");
  const post = (page, body) => raw(port, { method: "POST", path: `/api/pages/${page}/export-file`, headers: H(), body });
  assert.equal((await post("nope", { format: "png" })).json.error.code, "unknown_page");
  await raw(port, { method: "POST", path: "/api/pages/b/sync", headers: H(), body: { elements: [rect("r1"), { ...rect("f1"), type: "frame" }] } });
  assert.equal((await post("b", { format: "gif" })).json.error.code, "invalid_argument");
  assert.equal((await post("b", { format: "html" })).json.error.code, "invalid_argument"); // decks need frames
  assert.equal((await post("b", { format: "png", frames: ["zz"] })).json.error.code, "unknown_element");
  const r = await post("b", { format: "png", frames: ["f1"] });
  assert.equal(r.status, 409);
  assert.equal(r.json.error.code, "no_canvas_open"); // rendering needs a tab
});

test("idle timeout: the server saves and stops itself with no tab and no calls", async () => {
  const dir = tmpDir();
  const port = await freePort();
  const env = { ...process.env, OBEYA_DIR: path.join(dir, "c"), OBEYA_PORT: String(port), OBEYA_IDLE_TIMEOUT: "0.01" }; // 0.6 s
  const r = await run(["serve"], { env });
  assert.equal(JSON.parse(r.stdout).result.idleTimeout, 0.01);
  await raw(port, { method: "POST", path: "/api/pages/b/sync", headers: H(), body: { elements: [rect("r1")] } });
  // Any request (status included) counts as activity, so stay quiet and wait.
  await new Promise((res) => setTimeout(res, 1500));
  assert.equal(JSON.parse((await run(["status"], { env: { ...env } })).stdout).result.running, false);
  assert.ok(fs.existsSync(path.join(dir, "c", "b.excalidraw")), "saved before stopping");
});

test("idle timeout 0 never stops", async () => {
  const dir = tmpDir();
  const port = await freePort();
  const env = { ...process.env, OBEYA_DIR: path.join(dir, "c"), OBEYA_PORT: String(port) };
  servers.push(env);
  const r = await run(["serve", "--idle-timeout", "0"], { env });
  assert.equal(JSON.parse(r.stdout).result.idleTimeout, 0);
});

test("changes defaults: the person's edits since your last read, brief entries; --source all adds `source` (agent edits: smoke test)", async () => {
  const { port, env } = await start();
  const j = (r) => JSON.parse(r.stdout);
  const sync = (elements) => raw(port, { method: "POST", path: "/api/pages/board/sync", headers: H(), body: { elements } });
  await sync([rect("n1")]);
  const first = j(await run(["changes", "board"], { env })).result;
  assert.deepEqual(first.changes, [{ op: "added", id: "n1", type: "rectangle" }], "no rev, at, fields or source");
  assert.deepEqual(j(await run(["changes", "board"], { env })).result.changes, [], "the cursor moved");
  const all = j(await run(["changes", "board", "--since", "0", "--source", "all"], { env })).result.changes;
  assert.deepEqual(all.map((c) => c.source), ["user"]);
  assert.deepEqual(j(await run(["changes", "board", "--since", "0", "--source", "agent"], { env })).result.changes, []);
  assert.equal(j(await run(["changes", "board", "--source", "everyone"], { env })).error.code, "invalid_argument");
});

test("bands: set, list, delete, and moves across them in `changes`", async () => {
  const { port, env } = await start();
  const j = (r) => JSON.parse(r.stdout);
  const set = j(await run(["band", "set", "board", "release", "--y", "400"], { env }));
  assert.equal(set.id, "cli:band:set");
  assert.deepEqual(set.result.band, { name: "release", axis: "y", from: 400, to: 400 });
  await run(["band", "set", "board", "lane", "--x", "500", "--to", "900"], { env });
  assert.deepEqual(j(await run(["band", "list", "board"], { env })).result.bands.map((b) => b.name), ["lane", "release"]);

  const sync = (elements) => raw(port, { method: "POST", path: "/api/pages/board/sync", headers: H(), body: { elements } });
  await sync([rect("n1")]);
  const start0 = j(await run(["changes", "board"], { env })).result.rev;
  await sync([rect("n1", { version: 2, y: 500 })]);
  const [moved] = j(await run(["changes", "board", "--since", String(start0)], { env })).result.changes;
  assert.deepEqual(moved.crossed, [{ band: "release", from: "before", to: "after" }]);

  assert.equal(j(await run(["band", "delete", "board", "release"], { env })).result.deleted, "release");
  assert.equal(j(await run(["band", "delete", "board", "release"], { env })).error.code, "unknown_band");
  assert.ok(fs.existsSync(path.join(env.OBEYA_DIR, ".obeya", "board.bands.json")));
});

/** A stand-in tab on the event stream that answers agent patches with `reply`. */
function fakeTab(port, { caps, reply = () => ({ elements: [], created: [] }) } = {}) {
  const q = new URLSearchParams({ tab: `fake-${Math.random().toString(36).slice(2, 10)}`, page: "b" });
  if (caps) q.set("caps", caps);
  const seen = [];
  const req = http.request({ host: "127.0.0.1", port, path: `/events?${q}`, headers: { host: `127.0.0.1:${port}` } }, (res) => {
    let buf = "";
    res.on("data", async (c) => {
      buf += c;
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const block = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const event = /^event: (.*)$/m.exec(block)?.[1];
        const data = /^data: (.*)$/m.exec(block)?.[1];
        if (event !== "agent-patch") continue;
        const msg = JSON.parse(data);
        seen.push(msg);
        await raw(port, { method: "POST", path: `/api/answer/${msg.reqId}`, headers: H(), body: reply(msg) });
      }
    });
  });
  req.end();
  return { seen, close: () => req.destroy() };
}

test("a tab on page code from before an upgrade can't take a layout patch: canvas_outdated, nothing sent", async () => {
  const { port } = await start();
  const patch = (body) => raw(port, { method: "POST", path: "/api/pages/b/patch", headers: H(), body });
  const old = fakeTab(port);
  for (let i = 0; i < 50 && !(await raw(port, { path: "/api/info" })).json.browsers; i++) await new Promise((r) => setTimeout(r, 20));
  const r = await patch({ layout: [{ align: "left", ids: ["a", "b"] }] });
  assert.equal(r.json.error.code, "canvas_outdated");
  assert.equal(old.seen.length, 0, "the tab never saw it");
  assert.equal((await patch({ elements: [] })).status, 200, "a patch without layout still works");
  assert.equal(old.seen.length, 1);
  old.close();
  const fresh = fakeTab(port, { caps: "layout" });
  for (let i = 0; i < 50 && (await raw(port, { path: "/api/info" })).json.browsers !== 1; i++) await new Promise((r) => setTimeout(r, 20));
  const ok = await patch({ layout: [{ align: "left", ids: ["a", "b"] }] });
  assert.equal(ok.status, 200, ok.text);
  assert.deepEqual(fresh.seen[0].layout, [{ align: "left", ids: ["a", "b"] }]);
  assert.equal((await patch({ layout: [{ align: "sideways", ids: ["a", "b"] }] })).json.error.code, "invalid_patch", "checked before any tab");
  fresh.close();
});

test("the page's modules and shared lib modules are served (fixed shapes, an allowlist); lib modules import only each other", async () => {
  const { port } = await start();
  const served = ["layout", "geometry", "merge", "names", "machine", "page-machines"];
  for (const m of served) {
    const r = await raw(port, { path: `/lib/${m}.mjs` });
    assert.equal(r.status, 200, m);
    assert.match(r.headers["content-type"], /javascript/);
    // Every import is a sibling that is served too; nothing from Node.
    for (const [, spec] of r.text.matchAll(/^import .* from "([^"]+)";$/gm)) {
      const name = /^\.\/([a-z][a-z-]*)\.mjs$/.exec(spec)?.[1];
      assert.ok(name && served.includes(name), `${m}.mjs imports ${spec}, which the page can't load`);
    }
  }
  for (const p of ["/page/main.mjs", "/page/ui/export-dialog.mjs", "/page/page.css"]) assert.equal((await raw(port, { path: p })).status, 200, p);
  // The logo, exported from docs/brand/logo.excalidraw by Excalidraw itself.
  for (const p of ["/page/logo.svg", "/page/logo-lockup.svg"]) {
    const r = await raw(port, { path: p });
    assert.equal(r.status, 200, p);
    assert.equal(r.headers["content-type"], "image/svg+xml");
    assert.match(r.text, /svg-source:excalidraw/, `${p} is an Excalidraw export`);
  }
  // A PNG favicon for browsers that don't show SVG ones, also at /favicon.ico.
  for (const p of ["/page/favicon.png", "/favicon.ico"]) {
    const r = await raw(port, { path: p });
    assert.equal(r.status, 200, p);
    assert.equal(r.headers["content-type"], "image/png", p);
  }
  // About names the editor's version: the constant must match what the page imports.
  const deps = (await raw(port, { path: "/page/deps.mjs" })).text;
  const pinned = /@excalidraw\/excalidraw@([^?"]+)\?/.exec(deps)[1];
  assert.match(deps, new RegExp(`EXCALIDRAW_VERSION = "${pinned.replace(/[.]/g, "\\.")}"`));
  for (const p of ["/lib/args.mjs", "/lib/store.mjs", "/lib/..%2Fserver.mjs", "/lib/Layout.mjs", "/src/lib/layout.mjs",
    "/page/index.html", "/page/nope.mjs", "/page/..%2Fserver%2Fmain.mjs", "/page/Main.mjs", "/page/ui/x/y.mjs"]) {
    assert.equal((await raw(port, { path: p })).status, 404, p);
  }
});

test("a pages folder from before the rename keeps its change log: the server moves .excalidraw-local/ to .obeya/", async () => {
  const dir = tmpDir();
  const pages = path.join(dir, "canvas");
  fs.mkdirSync(path.join(pages, ".excalidraw-local"), { recursive: true });
  fs.writeFileSync(path.join(pages, "b.excalidraw"), JSON.stringify({ type: "excalidraw", version: 2, elements: [rect("r1")], appState: {}, files: {} }));
  fs.writeFileSync(path.join(pages, ".excalidraw-local", "b.changes.jsonl"), JSON.stringify({ rev: 7, at: "2026-11-01T00:00:00.000Z", source: "user", op: "added", id: "r1", type: "rectangle", fields: [] }) + "\n");
  const port = await freePort();
  const env = { ...process.env, OBEYA_DIR: pages, OBEYA_PORT: String(port) };
  servers.push(env);
  const r = JSON.parse((await run(["changes", "b", "--no-open"], { env })).stdout);
  assert.equal(r.result.rev, 7, "the old log was read");
  assert.equal(r.result.changes[0].id, "r1");
  assert.ok(fs.existsSync(path.join(pages, ".obeya", "b.changes.jsonl")));
  assert.ok(!fs.existsSync(path.join(pages, ".excalidraw-local")));
});

test("create a page: written now, before anything is drawn; an existing page or a bad name is refused", async () => {
  const { port, env } = await start();
  const r = await raw(port, { method: "POST", path: "/api/pages/plans", headers: H() });
  assert.equal(r.status, 201, r.text);
  assert.deepEqual(r.json, { page: "plans", rev: 0 });
  const file = path.join(env.OBEYA_DIR, "plans.excalidraw");
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")).elements, []);
  assert.ok(JSON.parse((await run(["pages"], { env })).stdout).result.pages.some((p) => p.name === "plans"));
  const again = await raw(port, { method: "POST", path: "/api/pages/plans", headers: H() });
  assert.equal(again.status, 409);
  assert.equal(again.json.error.code, "page_exists");
  assert.equal((await raw(port, { method: "POST", path: "/api/pages/.hidden", headers: H() })).json.error.code, "bad_page_name");
  // A page a tab opened empty (and nobody drew on) can still be created.
  assert.equal((await raw(port, { path: "/api/pages/later?ifMissing=empty", headers: H() })).status, 200);
  assert.equal((await raw(port, { method: "POST", path: "/api/pages/later", headers: H() })).status, 201);
});

test("folders: pages in folders through URLs and the CLI; delete; names that try to leave the folder are refused", async () => {
  const { port, env } = await start();
  const P = (name) => `/api/pages/${encodeURIComponent(name)}`;
  assert.equal((await raw(port, { method: "POST", path: P("project-a/overview"), headers: H() })).status, 201);
  assert.ok(fs.existsSync(path.join(env.OBEYA_DIR, "project-a", "overview.excalidraw")));
  assert.equal((await raw(port, { method: "POST", path: P("Café Ideen"), headers: H() })).status, 201, "spaces and accents");
  const cli = async (...a) => JSON.parse((await run(a, { env })).stdout);
  assert.deepEqual((await cli("pages")).result.pages.map((p) => p.name), ["Café Ideen", "project-a/overview"]);
  assert.equal((await cli("get", "project-a/overview")).result.page, "project-a/overview");
  // The CLI's rename moves a page between folders.
  const moved = await cli("rename", "project-a/overview", "project-b/overview");
  assert.equal(moved.result.to, "project-b/overview");
  assert.ok(fs.existsSync(path.join(env.OBEYA_DIR, "project-b", "overview.excalidraw")) && !fs.existsSync(path.join(env.OBEYA_DIR, "project-a")));
  // Names that try to leave the pages folder, or break the rule.
  for (const bad of ["..%2Fx", "a%2F..%2F..%2Fx", "%2Fetc", "a%5Cb", "a%3Ab", ".obeya%2Fcursors", "%E0%A4%A"]) {
    assert.equal((await raw(port, { method: "POST", path: `/api/pages/${bad}`, headers: H() })).json?.error?.code, "bad_page_name", bad);
  }
  // Delete: to the trash; the last page stays.
  const del = await raw(port, { method: "DELETE", path: P("project-b/overview"), headers: H() });
  assert.equal(del.status, 200, del.text);
  assert.ok(!fs.existsSync(path.join(env.OBEYA_DIR, "project-b")));
  assert.equal(fs.readdirSync(path.join(env.OBEYA_DIR, ".obeya", ".trash")).length, 1);
  assert.equal((await raw(port, { method: "DELETE", path: P("project-b/overview"), headers: H() })).json.error.code, "unknown_page");
  const last = await raw(port, { method: "DELETE", path: P("Café Ideen"), headers: H() });
  assert.deepEqual([last.status, last.json.error.code], [409, "last_page"]);
  // A tab that missed the delete can't sync the page back into existence.
  const late = await raw(port, { method: "POST", path: `${P("project-b/overview")}/sync`, headers: H(), body: { elements: [rect("r")], tab: "t" } });
  assert.deepEqual([late.status, late.json.error.code], [409, "page_gone"]);
  assert.ok(!fs.existsSync(path.join(env.OBEYA_DIR, "project-b")));
  // Other capitals than an existing page: refused, not a second copy of the file.
  assert.equal((await raw(port, { path: P("café ideen"), headers: H() })).json.error.code, "page_exists");
  // Band names are decoded once.
  assert.equal((await raw(port, { method: "PUT", path: `${P("Café Ideen")}/bands/50%25`, headers: H(), body: { axis: "y", from: 0, to: 0 } })).json.error.code, "invalid_argument");
});

test("images: the server checks files and fileIds before asking a tab; the CLI checks src before starting anything", async () => {
  const { port, env, dir } = await start();
  const P = (b) => raw(port, { method: "POST", path: "/api/pages/p/patch", headers: H(), body: b });
  const bad = await P({ skeleton: [{ type: "image", id: "i", fileId: "f" }], files: { f: { id: "f", mimeType: "text/html", dataURL: "data:text/html;base64,AA" } } });
  assert.deepEqual([bad.status, bad.json.error.code], [400, "invalid_patch"]);
  assert.match(bad.json.error.message, /mimeType/);
  assert.equal((await P({ skeleton: [{ type: "image", id: "i", src: "/x.png" }] })).json.error.code, "invalid_patch", "src is the CLI's job");
  const orphan = await P({ skeleton: [{ type: "image", id: "i", fileId: "nope" }] });
  assert.match(orphan.json.error.message, /without a file: i/);
  // The CLI refuses a bad src before starting a server or opening a tab.
  const other = { ...env, OBEYA_PORT: String(port + 1) };
  fs.writeFileSync(path.join(dir, "patch.json"), JSON.stringify({ skeleton: [{ type: "image", id: "i", src: "missing.png" }] }));
  const r = await run(["patch", "p", "--file", path.join(dir, "patch.json"), "--no-open"], { env: other, cwd: dir });
  assert.equal(JSON.parse(r.stdout).error.code, "invalid_image");
  assert.equal(JSON.parse((await run(["status"], { env: other })).stdout).result.running, false, "no server was started");
});

test("wait: the ask is listed for tabs; Done answers with the person's changes; timeouts and a stopped command end it", async () => {
  const { port, env } = await start();
  const j = (r) => JSON.parse(r.stdout);
  const sync = (elements) => raw(port, { method: "POST", path: "/api/pages/board/sync", headers: H(), body: { elements } });
  await sync([rect("n1"), { id: "f1", type: "frame", x: -50, y: -50, width: 400, height: 300, version: 1, versionNonce: 1 }]);
  await run(["changes", "board"], { env }); // the agent has read everything so far
  const waits = async () => (await raw(port, { path: "/api/waits" })).json.waits;
  const until = async (ok) => { for (let i = 0; i < 100 && !(await ok()); i++) await new Promise((r) => setTimeout(r, 20)); };

  // No tab shows the page: with --no-open it says where, and waits anyway.
  const waiting = run(["wait", "board", "--ask", "Circle what's wrong", "--frame", "f1", "--no-open"], { env });
  await until(async () => (await waits()).length === 1);
  const [w] = await waits();
  assert.deepEqual([w.page, w.frame, w.ask], ["board", "f1", "Circle what's wrong"]);
  await sync([rect("n1", { version: 2, x: 40 })]);
  assert.equal((await raw(port, { method: "POST", path: `/api/waits/${w.id}/done`, headers: H(), body: {} })).status, 200);
  const r = await waiting;
  assert.equal(r.code, 0, r.stdout);
  assert.match(r.stderr, /board/);
  const res = j(r).result;
  assert.equal(res.done, "button");
  assert.deepEqual(res.changes.map((c) => [c.id, c.op]), [["n1", "modified"]]);
  assert.deepEqual(await waits(), []);
  assert.deepEqual(j(await run(["changes", "board"], { env })).result.changes, [], "the wait moved the agent's cursor");
  assert.equal((await raw(port, { method: "POST", path: `/api/waits/${w.id}/done`, headers: H(), body: {} })).json.error.code, "unknown_wait");

  // A timeout answers with what there is.
  const timed = j(await run(["wait", "board", "--ask", "Anything?", "--timeout", "0.005", "--no-open"], { env })).result;
  assert.deepEqual([timed.done, timed.changes], ["timeout", []]);

  // The agent's command stopped (the connection closed): the banner goes.
  const req = http.request({ host: "127.0.0.1", port, method: "POST", path: "/api/pages/board/wait", headers: { host: `127.0.0.1:${port}`, ...H() } });
  req.on("error", () => {});
  req.end(JSON.stringify({ ask: "Going away" }));
  await until(async () => (await waits()).length === 1);
  req.destroy();
  await until(async () => (await waits()).length === 0);
  assert.deepEqual(await waits(), []);

  // Usage and request errors.
  assert.equal(j(await run(["wait", "board"], { env })).error.code, "missing_argument");
  assert.equal(j(await run(["wait", "board", "--ask", "x", "--timeout", "soon"], { env })).error.code, "invalid_argument");
  assert.equal(j(await run(["wait", "board", "--ask", "x", "--frame", "nope", "--no-open"], { env })).error.code, "unknown_element");
});
