// Images in patches: which files are allowed, their size, and the
// default size on the page. Pure (bytes in, facts out), shared by the CLI and
// the server.

export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml"];
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
export const MAX_DEFAULT_WIDTH = 800;

const starts = (b, sig, at = 0) => sig.every((v, i) => b[at + i] === v);
const ascii = (b, at, n) => String.fromCharCode(...b.subarray(at, at + n));

/** The image type, from the file's bytes (never its name), or null. */
export function sniff(bytes) {
  const b = bytes;
  if (starts(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (starts(b, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (ascii(b, 0, 6) === "GIF87a" || ascii(b, 0, 6) === "GIF89a") return "image/gif";
  if (ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP") return "image/webp";
  const head = new TextDecoder().decode(b.subarray(0, 1024)).replace(/^﻿/, "").trimStart();
  if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE svg[^>]*>\s*)?<svg[\s>]/i.test(head)) return "image/svg+xml";
  return null;
}

const be16 = (b, i) => (b[i] << 8) | b[i + 1];
const le16 = (b, i) => b[i] | (b[i + 1] << 8);
const le24 = (b, i) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);

/** The image's own size in pixels, or null if the header doesn't say. */
export function dimensions(bytes, type) {
  const b = bytes;
  try {
    if (type === "image/png") return { width: (be16(b, 16) << 16) | be16(b, 18), height: (be16(b, 20) << 16) | be16(b, 22) };
    if (type === "image/gif") return { width: le16(b, 6), height: le16(b, 8) };
    if (type === "image/jpeg") {
      for (let i = 2; i + 9 < b.length;) {
        if (b[i] !== 0xff) { i++; continue; }
        const m = b[i + 1];
        if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return { width: be16(b, i + 7), height: be16(b, i + 5) };
        i += 2 + be16(b, i + 2);
      }
      return null;
    }
    if (type === "image/webp") {
      const chunk = ascii(b, 12, 4);
      if (chunk === "VP8 ") return { width: le16(b, 26) & 0x3fff, height: le16(b, 28) & 0x3fff };
      if (chunk === "VP8L") return { width: 1 + (((b[22] & 0x3f) << 8) | b[21]), height: 1 + (((b[24] & 0xf) << 10) | (b[23] << 2) | ((b[22] & 0xc0) >> 6)) };
      if (chunk === "VP8X") return { width: 1 + le24(b, 24), height: 1 + le24(b, 27) };
      return null;
    }
    if (type === "image/svg+xml") {
      const svg = /<svg\b[^>]*>/i.exec(new TextDecoder().decode(b.subarray(0, 4096)))?.[0] ?? "";
      const num = (name) => { const m = new RegExp(`\\b${name}\\s*=\\s*["']\\s*([\\d.]+)(px)?\\s*["']`, "i").exec(svg); return m ? Number(m[1]) : null; };
      const [w, h] = [num("width"), num("height")];
      if (w && h) return { width: w, height: h };
      const vb = /\bviewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(svg);
      if (vb) return { width: Number(vb[1]), height: Number(vb[2]) };
      return null;
    }
  } catch {}
  return null;
}

/**
 * The size on the page: as given; one side given, the other follows the
 * image's shape; neither, its own size, at most 800 wide.
 */
export function placedSize(own, { width, height } = {}) {
  const o = own && own.width > 0 && own.height > 0 ? own : { width: 300, height: 150 };
  const ratio = o.height / o.width;
  if (width > 0 && height > 0) return { width, height };
  if (width > 0) return { width, height: width * ratio };
  if (height > 0) return { width: height / ratio, height };
  const w = Math.min(o.width, MAX_DEFAULT_WIDTH);
  return { width: w, height: w * ratio };
}

/** Bytes a base64 string decodes to. */
export const base64Bytes = (s) => Math.floor((s.length * 3) / 4) - (s.endsWith("==") ? 2 : s.endsWith("=") ? 1 : 0);

/** A problem with a patch's `files` entry, or null (server side). */
export function fileProblem(key, f) {
  if (!f || typeof f !== "object") return `files.${key} must be an object`;
  if (f.id !== key) return `files.${key}.id must be "${key}"`;
  if (!IMAGE_TYPES.includes(f.mimeType)) return `files.${key}.mimeType must be one of ${IMAGE_TYPES.join(", ")}`;
  const prefix = `data:${f.mimeType};base64,`;
  if (typeof f.dataURL !== "string" || !f.dataURL.startsWith(prefix)) return `files.${key}.dataURL must be a ${prefix}… URL`;
  if (base64Bytes(f.dataURL.slice(prefix.length)) > MAX_IMAGE_BYTES) return `files.${key} is over 4 MB`;
  return null;
}
