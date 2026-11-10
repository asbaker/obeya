// Images in a patch: the CLI reads each `src` (a local file),
// checks it, and swaps it for a `fileId` plus the file in `files`. The path
// itself goes no further.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { MAX_IMAGE_BYTES, dimensions, placedSize, sniff } from "../lib/images.mjs";
import { CliError } from "./client.mjs";

const IMAGE_ENTRY = (e) => e && typeof e === "object" && typeof e.src === "string";

/** Read one image file; throws CliError invalid_image / image_too_large. */
export function readImage(src, cwd) {
  const file = path.resolve(cwd, src);
  let st;
  try {
    st = fs.statSync(file);
  } catch {
    throw new CliError("invalid_image", `can't read image "${src}": no such file`);
  }
  if (!st.isFile()) throw new CliError("invalid_image", `can't read image "${src}": not a file`);
  if (st.size > MAX_IMAGE_BYTES) throw new CliError("image_too_large", `image "${src}" is ${(st.size / 1048576).toFixed(1)} MB; the limit is 4 MB`);
  const bytes = new Uint8Array(fs.readFileSync(file));
  const mimeType = sniff(bytes);
  if (!mimeType) throw new CliError("invalid_image", `"${src}" isn't a PNG, JPEG, GIF, WebP or SVG image`);
  const id = createHash("sha256").update(bytes).digest("hex").slice(0, 40);
  return { id, mimeType, dataURL: `data:${mimeType};base64,${Buffer.from(bytes).toString("base64")}`, own: dimensions(bytes, mimeType) };
}

/**
 * Swap every `src` in the patch's skeleton and elements for a fileId (and a
 * size), adding the files to `patch.files`. Returns the patch.
 */
export function resolveImages(patch, cwd) {
  const entries = [...(Array.isArray(patch.skeleton) ? patch.skeleton : []), ...(Array.isArray(patch.elements) ? patch.elements : [])].filter(IMAGE_ENTRY);
  if (!entries.length) return patch;
  const files = { ...(patch.files ?? {}) };
  for (const e of entries) {
    const img = readImage(e.src, cwd);
    files[img.id] = { id: img.id, mimeType: img.mimeType, dataURL: img.dataURL, created: Date.now() };
    Object.assign(e, { type: e.type ?? "image", fileId: img.id }, placedSize(img.own, e));
    delete e.src;
  }
  patch.files = files;
  return patch;
}
