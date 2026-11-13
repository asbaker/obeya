import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { catalogueEntries, findItem, instantiate, itemSize, parseLibrary, searchCatalogue, sheetFile, sheetPages, sidebarItems } from "../src/lib/library.mjs";
import { addLibrary, allowedUrl, cacheDir, catalogue, ensureLibrary, listCached, loadAllCached, removeLibrary, search } from "../src/lib/libcache.mjs";
import { run } from "../src/cli/main.mjs";
import { tmpDir } from "./helpers/env.mjs";
import { FIXTURE, startCatalogue } from "./helpers/catalogue.mjs";

const rect = (id, x, y, o = {}) => ({ id, type: "rectangle", x, y, width: 100, height: 40, version: 7, versionNonce: 9, groupIds: [], frameId: null, boundElements: null, ...o });
const read = (f) => JSON.parse(fs.readFileSync(path.join(FIXTURE, f), "utf8"));

let cat;
before(async () => (cat = await startCatalogue()));
after(() => cat.close());
const envWith = (extra = {}) => ({ OBEYA_CACHE: tmpDir("xl-cache-"), OBEYA_CATALOGUE_URL: cat.url, ...extra });

// ---------------------------------------------------------------------------
// Pure parts

test("parse v2 and v1 libraries; item ids are name slugs, de-duplicated", () => {
  const v2 = parseLibrary({ type: "excalidrawlib", version: 2, libraryItems: [
    { name: "Button", elements: [rect("a", 0, 0)] },
    { name: "Button", elements: [rect("b", 0, 0)] },
    { name: "  ", elements: [rect("c", 0, 0), rect("d", 0, 0, { isDeleted: true })] },
  ] });
  assert.deepEqual(v2.map((i) => i.id), ["button", "button-2", "item-3"]);
  assert.equal(v2[2].elements.length, 1);
  const v1 = parseLibrary(read("libraries/acme/doodles.excalidrawlib"));
  assert.deepEqual(v1.map((i) => [i.id, i.name]), [["item-1", null], ["item-2", null], ["item-3", null]]);
});

test("catalogue ids: the file name, qualified by author when two share it; downloads from stats", () => {
  const entries = catalogueEntries(read("libraries.json"), read("stats.json"));
  assert.deepEqual(entries.map((e) => e.id), ["shapes.acme", "doodles", "shapes.zeta"]);
  assert.deepEqual(entries.map((e) => e.downloads), [100, 5000, 10]);
});

test("search: every word must match; name beats description; named items beat downloads on a tie", () => {
  const entries = catalogueEntries(read("libraries.json"), read("stats.json"));
  assert.deepEqual(searchCatalogue(entries, "architecture").map((e) => e.id), ["shapes.acme", "doodles"]); // doodles has 50x the downloads, but unnamed items
  assert.deepEqual(searchCatalogue(entries, "load balancer").map((e) => e.id), ["shapes.acme"]); // item names
  assert.deepEqual(searchCatalogue(entries, "zeta").map((e) => e.id), ["shapes.zeta"]); // author
  assert.deepEqual(searchCatalogue(entries, "architecture queue"), []);
  assert.deepEqual(searchCatalogue(entries, "   "), []);
  assert.equal(searchCatalogue(entries, "a", 1).length, 1);
});

test("instantiate: new prefixed ids, placed at x,y, references remapped, frame set", () => {
  const item = { elements: [
    rect("box", 10, 20, { groupIds: ["G"], boundElements: [{ id: "label", type: "text" }, { id: "arrow", type: "arrow" }, { id: "outside", type: "arrow" }] }),
    { id: "label", type: "text", x: 20, y: 30, width: 50, height: 20, containerId: "box", groupIds: ["G"], frameId: null, text: "OK", index: "a1" },
    { id: "arrow", type: "arrow", x: 110, y: 40, width: 50, height: 0, points: [[0, 0], [50, 0]], startBinding: { elementId: "box", focus: 0, gap: 1 }, endBinding: { elementId: "gone", focus: 0, gap: 1 }, groupIds: [], frameId: null },
  ] };
  const els = instantiate(item, { at: [500, 300], prefix: "btn", frame: "f1", nonce: () => 42 });
  assert.deepEqual(els.map((e) => e.id), ["btn-1", "btn-2", "btn-3"]);
  assert.deepEqual([els[0].x, els[0].y, els[1].x, els[1].y], [500, 300, 510, 310]);
  assert.equal(els[1].containerId, "btn-1");
  assert.deepEqual(els[0].boundElements, [{ id: "btn-2", type: "text" }, { id: "btn-3", type: "arrow" }]);
  assert.deepEqual(els[0].groupIds, ["btn-g1"]);
  assert.equal(els[2].startBinding.elementId, "btn-1");
  assert.equal(els[2].endBinding, null);
  for (const e of els) {
    assert.equal(e.frameId, "f1");
    assert.equal(e.version, 1);
    assert.equal(e.versionNonce, 42);
    assert.ok(!("index" in e));
  }
  assert.equal(item.elements[0].id, "box", "the library item itself is untouched");
});

test("item size ignores bound text", () => {
  assert.deepEqual(itemSize({ elements: [rect("a", 0, 0), rect("b", 150, 100), { id: "t", type: "text", containerId: "a", x: 0, y: 0, width: 999, height: 999 }] }), { w: 250, h: 140 });
});

test("findItem suggests near matches", () => {
  const lib = { id: "shapes.acme", items: parseLibrary(read("libraries/acme/shapes.excalidrawlib")) };
  assert.equal(findItem(lib, "database").name, "Database");
  assert.throws(() => findItem(lib, "load"), (e) => e.code === "unknown_library_item" && e.suggestions[0] === "shapes.acme/load-balancer");
});

test("contact sheets: 48 items per image, numbered files", () => {
  const items = Array.from({ length: 100 }, (_, i) => ({ id: `item-${i + 1}` }));
  const pages = sheetPages(items);
  assert.deepEqual(pages.map((p) => [p.first, p.last, p.columns, p.rows]), [[1, 48, 6, 8], [49, 96, 6, 8], [97, 100, 4, 1]]);
  assert.equal(sheetFile("out/aws.png", 1, 1), "out/aws.png");
  assert.equal(sheetFile("out/aws.png", 2, 3), "out/aws-2.png");
  assert.equal(sheetFile("out/aws", 2, 3), "out/aws-2.png");
});

test("cache dir: env override, XDG, then the OS default", () => {
  assert.equal(cacheDir({ OBEYA_CACHE: "/c" }, "linux", "/h"), path.resolve("/c"));
  assert.equal(cacheDir({ XDG_CACHE_HOME: "/x" }, "darwin", "/h"), path.join("/x", "obeya"));
  assert.equal(cacheDir({}, "darwin", "/h"), path.join("/h", "Library", "Caches", "obeya"));
  assert.equal(cacheDir({}, "linux", "/h"), path.join("/h", ".cache", "obeya"));
  assert.equal(cacheDir({ LOCALAPPDATA: "L" }, "win32", "/h"), path.join("L", "obeya", "Cache"));
});

test("only https, or http from this machine", () => {
  assert.ok(allowedUrl("https://example.com/x.excalidrawlib"));
  assert.ok(allowedUrl("http://127.0.0.1:9/x"));
  assert.ok(allowedUrl("http://localhost/x"));
  assert.ok(!allowedUrl("http://example.com/x"));
  assert.ok(!allowedUrl("file:///etc/passwd"));
  assert.ok(!allowedUrl("not a url"));
});

// ---------------------------------------------------------------------------
// Cache and downloads, against a local stand-in for the catalogue

test("catalogue: downloaded once a day, stale copy when offline, network_error with none", async () => {
  const env = envWith();
  const first = cat.hits.length;
  const a = await catalogue(env);
  assert.equal(a.entries.length, 3);
  await catalogue(env);
  assert.equal(cat.hits.filter((h, i) => i >= first && h === "/libraries.json").length, 1, "cached for a day");
  const offline = { ...env, OBEYA_CATALOGUE_URL: cat.url }; // same base…
  const later = await catalogue(offline, { now: Date.now() + 2 * 24 * 3600 * 1000 });
  assert.equal(later.stale, false, "refreshed after a day");

  const dead = envWith({ OBEYA_CATALOGUE_URL: "http://127.0.0.1:9" });
  await assert.rejects(catalogue(dead), (e) => e.code === "network_error");
});

test("a stale catalogue is used when the refresh fails", async () => {
  const other = await startCatalogue();
  const env = envWith({ OBEYA_CATALOGUE_URL: other.url });
  await catalogue(env);
  await other.close();
  const r = await catalogue(env, { now: Date.now() + 2 * 24 * 3600 * 1000 });
  assert.equal(r.stale, true);
  assert.equal(r.entries.length, 3);
});

test("search marks cached libraries", async () => {
  const env = envWith();
  await ensureLibrary(env, "shapes.acme");
  const r = await search(env, "architecture");
  assert.deepEqual(r.results.map((x) => [x.id, x.cached, x.named, x.items]), [["shapes.acme", true, true, 2], ["doodles", false, false, null]]);
});

test("ensureLibrary downloads on first use, then reads the cache", async () => {
  const env = envWith();
  const before = cat.hits.length;
  const a = await ensureLibrary(env, "doodles");
  assert.equal(a.downloaded, true);
  assert.equal(a.lib.origin, "catalogue");
  assert.match(a.lib.license, /MIT/);
  assert.deepEqual(a.lib.items.map((i) => i.id), ["item-1", "item-2", "item-3"]);
  const b = await ensureLibrary(env, "doodles");
  assert.equal(b.downloaded, false);
  assert.equal(cat.hits.slice(before).filter((h) => h.endsWith("doodles.excalidrawlib")).length, 1);
  await assert.rejects(ensureLibrary(env, "shapes"), (e) => e.code === "unknown_library" && e.extra.suggestions.includes("shapes.acme"));
});

test("add from a local file records only its name; from a URL; clashes need --as", async () => {
  const env = envWith();
  const dir = tmpDir();
  const file = path.join(dir, "Team Kit.excalidrawlib");
  fs.copyFileSync(path.join(FIXTURE, "libraries/zeta/shapes.excalidrawlib"), file);
  const f = await addLibrary(env, file);
  assert.equal(f.id, "team-kit");
  assert.equal(f.origin, "file");
  assert.equal(f.source, "Team Kit.excalidrawlib");
  assert.ok(!JSON.stringify(listCached(env)).includes(dir), "no local path in the cache metadata");

  const u = await addLibrary(env, `${cat.url}/libraries/acme/shapes.excalidrawlib`);
  assert.equal(u.id, "shapes");
  assert.equal(u.origin, "url");
  await assert.rejects(addLibrary(env, `${cat.url}/libraries/zeta/shapes.excalidrawlib`), (e) => e.code === "library_exists");
  assert.equal((await addLibrary(env, `${cat.url}/libraries/zeta/shapes.excalidrawlib`, { as: "zeta-shapes" })).id, "zeta-shapes");

  fs.writeFileSync(path.join(dir, "bad.excalidrawlib"), JSON.stringify({ type: "excalidraw", elements: [] }));
  await assert.rejects(addLibrary(env, path.join(dir, "bad.excalidrawlib")), (e) => e.code === "invalid_library");
  await assert.rejects(addLibrary(env, "http://example.com/x.excalidrawlib"), (e) => e.code === "invalid_argument");
  await assert.rejects(addLibrary(env, `${cat.url}/nope.excalidrawlib`), (e) => e.code === "not_found");

  assert.deepEqual(listCached(env).map((m) => m.id), ["shapes", "team-kit", "zeta-shapes"]);
  assert.equal(sidebarItems(loadAllCached(env)).length, 4);
  assert.ok(removeLibrary(env, "team-kit"));
  assert.ok(!removeLibrary(env, "team-kit"));
  assert.deepEqual(listCached(env).map((m) => m.id), ["shapes", "zeta-shapes"]);
});

// ---------------------------------------------------------------------------
// The CLI surface (no browser): envelopes and error codes

test("cli: search, show (downloads), list, add, remove; nothing starts a server", async () => {
  const env = { ...process.env, ...envWith(), OBEYA_DIR: path.join(tmpDir(), "canvas"), OBEYA_PORT: "1" };
  const j = async (...a) => JSON.parse((await run(a, { env })).stdout);
  const s = await j("library", "search", "architecture");
  assert.ok(s.result, "an envelope with result");
  assert.deepEqual(s.result.results.map((r) => r.id), ["shapes.acme", "doodles"]);
  const show = await j("library", "show", "shapes.acme");
  assert.deepEqual(show.result.items.map((i) => i.item), ["database", "load-balancer"], "item ids, inserted as <lib>/<item>");
  assert.ok(show.result.items.every((i) => i.name === undefined && i.w > 0 && i.h > 0), "a name only when the id doesn't say it");
  assert.deepEqual((await j("library", "list")).result.libraries.map((l) => l.id), ["shapes.acme"]);
  assert.equal((await j("library", "show", "nope")).error.code, "unknown_library");
  assert.equal((await j("library", "remove", "nope")).error.code, "unknown_library");
  const removed = await run(["library", "remove", "shapes.acme"], { env });
  assert.deepEqual([removed.code, removed.stdout], [0, ""], "nothing to report");
  assert.equal((await j("library", "insert", "shapes.acme/nothing", "board", "--at", "0,0", "--no-open")).error.code, "unknown_library_item");
  assert.ok(!fs.existsSync(env.OBEYA_DIR), "no server or pages dir");
});
