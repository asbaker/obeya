import { test } from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";
import { buildExport } from "../src/lib/exporter.mjs";
import { crc32, zip } from "../src/lib/zip.mjs";
import { tmpDir } from "./helpers/env.mjs";

const frame = (id, x, name) => ({ id, type: "frame", x, y: 0, width: 100, height: 80, name });
const page = { name: "board", elements: [frame("f1", 0, "01 Login"), frame("f2", 200, "02 Home"), { id: "r", type: "rectangle", x: 10, y: 10, width: 20, height: 20, frameId: "f1" }] };
// A stand-in for the tab's renderer: records what was asked for.
function renderer() {
  const calls = [];
  const render = async (items, type) => {
    calls.push({ type, items: items.map((i) => i.frame ?? "page") });
    return items.map((i) => (type === "svg" ? { svg: `<svg id="${i.frame ?? "page"}"/>`, width: 100, height: 80 } : { png: Buffer.from(`png:${i.frame ?? "page"}`).toString("base64"), width: 100, height: 80 }));
  };
  return { calls, render };
}

test("images: one file per frame in slide order, --order picks and orders, or the whole page", async () => {
  const r = renderer();
  const all = await buildExport({ format: "png", pages: [page], frames: true }, r);
  assert.deepEqual(all.files.map((f) => [f.name, f.data.toString()]), [["01-login.png", "png:f1"], ["02-home.png", "png:f2"]]);
  const picked = await buildExport({ format: "svg", pages: [page], frames: true, order: ["f2"] }, r);
  assert.deepEqual(picked.files.map((f) => f.data), ['<svg id="f2"/>']);
  const whole = await buildExport({ format: "svg", pages: [page] }, r);
  assert.equal(whole.file.data, '<svg id="page"/>');
  await assert.rejects(buildExport({ format: "png", pages: [{ name: "empty", elements: [] }], frames: true }, r), { code: "unknown_element" });
  await assert.rejects(buildExport({ format: "png", pages: [page], frames: true, order: ["nope"] }, r), { code: "unknown_element" });
});

test("decks: html with a title slide; pdf without Chrome is no_chrome", async () => {
  const r = renderer();
  const html = await buildExport({ format: "html", pages: [page], title: "Review" }, r);
  assert.match(html.file.data, /<!doctype html>/i);
  assert.match(html.file.data, /Review/);
  assert.deepEqual(html.summary, { slides: 3, hotspots: 0 });
  assert.deepEqual(r.calls.at(-1), { type: "svg", items: ["f1", "f2"] });
  await assert.rejects(buildExport({ format: "pdf", pages: [page] }, { ...r, chrome: null, workDir: tmpDir() }), { code: "no_chrome" });
});

test("zip: stored entries with the right names, sizes and CRCs", () => {
  const files = [{ name: "01-login.png", data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]) }, { name: "naïve.svg", data: "<svg/>" }];
  const z = zip(files, new Date(2026, 10, 8, 12, 30, 10));
  // Walk the central directory from the end record.
  const end = z.length - 22;
  assert.equal(z.readUInt32LE(end), 0x06054b50);
  assert.equal(z.readUInt16LE(end + 10), 2);
  let p = z.readUInt32LE(end + 16);
  for (const f of files) {
    const data = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data);
    assert.equal(z.readUInt32LE(p), 0x02014b50);
    const nameLen = z.readUInt16LE(p + 28), local = z.readUInt32LE(p + 42);
    assert.equal(z.toString("utf8", p + 46, p + 46 + nameLen), f.name);
    assert.equal(z.readUInt32LE(p + 16), crc32(data));
    assert.equal(z.readUInt32LE(p + 24), data.length);
    const start = local + 30 + z.readUInt16LE(local + 26);
    assert.deepEqual(z.subarray(start, start + data.length), data);
    p += 46 + nameLen;
  }
  if (zlib.crc32) assert.equal(crc32(Buffer.from("hello")), zlib.crc32("hello"));
  assert.equal(crc32(Buffer.from("123456789")), 0xcbf43926); // the standard check value
});
