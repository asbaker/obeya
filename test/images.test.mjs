// Images in patches: types and sizes from bytes, the default size,
// and the CLI turning a local `src` into a fileId and a file.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { dimensions, fileProblem, placedSize, sniff, MAX_IMAGE_BYTES } from "../src/lib/images.mjs";
import { resolveImages } from "../src/cli/images.mjs";
import { tmpDir } from "./helpers/env.mjs";

// The smallest real PNG: 1×1, red.
const PNG_1x1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==", "base64");
const png = (w, h) => { const b = Buffer.from(PNG_1x1); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20); return b; };
const gif = Buffer.concat([Buffer.from("GIF89a"), Buffer.from([0x40, 0x01, 0xf0, 0x00]), Buffer.alloc(8)]); // 320×240
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0xe0, 0x02, 0x80, 0x03, 0, 0, 0, 0]); // 640×480
const webp = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBPVP8X"), Buffer.alloc(8), Buffer.from([0x1f, 0x03, 0x00, 0x57, 0x02, 0x00])]); // 800×600
const svg = Buffer.from('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 60"><rect width="120" height="60"/></svg>');

test("images: the type comes from the bytes, and the size from the header", () => {
  assert.deepEqual([png(1, 1), jpeg, gif, webp, svg].map((b) => sniff(new Uint8Array(b))), ["image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml"]);
  assert.equal(sniff(new Uint8Array(Buffer.from("not an image"))), null);
  assert.equal(sniff(new Uint8Array(Buffer.from("<html><svg></svg></html>"))), null, "an HTML page with an svg in it isn't an svg");
  assert.deepEqual(dimensions(new Uint8Array(png(1600, 900)), "image/png"), { width: 1600, height: 900 });
  assert.deepEqual(dimensions(new Uint8Array(jpeg), "image/jpeg"), { width: 640, height: 480 });
  assert.deepEqual(dimensions(new Uint8Array(gif), "image/gif"), { width: 320, height: 240 });
  assert.deepEqual(dimensions(new Uint8Array(webp), "image/webp"), { width: 800, height: 600 });
  assert.deepEqual(dimensions(new Uint8Array(svg), "image/svg+xml"), { width: 120, height: 60 });
});

test("images: placed size: as given; one side keeps the shape; neither, its own, at most 800 wide", () => {
  const own = { width: 1600, height: 900 };
  assert.deepEqual(placedSize(own, { width: 200, height: 50 }), { width: 200, height: 50 });
  assert.deepEqual(placedSize(own, { width: 480 }), { width: 480, height: 270 });
  assert.deepEqual(placedSize(own, { height: 90 }), { width: 160, height: 90 });
  assert.deepEqual(placedSize(own, {}), { width: 800, height: 450 });
  assert.deepEqual(placedSize({ width: 120, height: 60 }, {}), { width: 120, height: 60 }, "small images keep their size");
});

test("images: the CLI swaps src for a fileId and the file; the path goes no further; one file per image", () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, "shot.png"), png(1600, 900));
  const patch = resolveImages({ skeleton: [
    { type: "image", id: "a", src: "shot.png", x: 10, y: 20, width: 480 },
    { type: "image", id: "b", src: path.join(dir, "shot.png"), x: 600, y: 20 },
  ] }, dir);
  const [a, b] = patch.skeleton;
  assert.equal(a.fileId, b.fileId, "the same bytes are one file");
  assert.deepEqual([a.width, a.height, b.width, b.height], [480, 270, 800, 450]);
  assert.ok(!("src" in a) && !("src" in b));
  const f = patch.files[a.fileId];
  assert.deepEqual([f.id, f.mimeType], [a.fileId, "image/png"]);
  assert.ok(f.dataURL.startsWith("data:image/png;base64,"));
  assert.ok(!JSON.stringify(patch).includes(dir), "no local path in what is sent");
  assert.equal(fileProblem(a.fileId, f), null, "the server accepts what the CLI makes");
});

test("images: missing, not an image, too big: clear errors, before anything is sent", () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, "notes.txt"), "hello");
  fs.writeFileSync(path.join(dir, "huge.png"), Buffer.concat([png(10, 10), Buffer.alloc(MAX_IMAGE_BYTES)]));
  const code = (src) => { try { resolveImages({ skeleton: [{ type: "image", id: "x", src }] }, dir); return "ok"; } catch (e) { return e.code; } };
  assert.equal(code("nope.png"), "invalid_image");
  assert.equal(code("notes.txt"), "invalid_image");
  assert.equal(code("huge.png"), "image_too_large");
  assert.equal(code("."), "invalid_image", "a folder isn't an image");
  // The server's own checks on files it is sent.
  assert.match(fileProblem("k", { id: "k", mimeType: "text/html", dataURL: "data:text/html;base64,AA" }), /mimeType/);
  assert.match(fileProblem("k", { id: "k", mimeType: "image/png", dataURL: "https://example.com/x.png" }), /data:image\/png/);
  assert.match(fileProblem("k", { id: "other", mimeType: "image/png", dataURL: "data:image/png;base64,AA" }), /id/);
});
