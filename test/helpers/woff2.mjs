// A font's vertical metrics from a .woff2 (head and hhea tables), for the
// table in src/lib/fonts.mjs. Dev only. Adding a font:
//   node test/helpers/woff2.mjs src/page/fonts/<file>.woff2
import fs from "node:fs";
import { brotliDecompressSync } from "node:zlib";
import { fileURLToPath } from "node:url";

// WOFF2's known-table index (flag bits 0–5).
const KNOWN = ["cmap", "head", "hhea", "hmtx", "maxp", "name", "OS/2", "post", "cvt ", "fpgm", "glyf", "loca", "prep", "CFF ", "VORG", "EBDT", "EBLC", "gasp", "hdmx", "kern", "LTSH", "PCLT", "VDMX", "vhea", "vmtx", "BASE", "GDEF", "GPOS", "GSUB", "EBSC", "JSTF", "MATH", "CBDT", "CBLC", "COLR", "CPAL", "SVG ", "sbix", "acnt", "avar", "bdat", "bloc", "bsln", "cvar", "fdsc", "feat", "fmtx", "fvar", "gvar", "hsty", "just", "lcar", "mort", "morx", "opbd", "prop", "trak", "Zapf", "Silf", "Glat", "Gloc", "Feat", "Sill"];

/** {unitsPerEm, ascender, descender, lineHeight}; lineHeight = (ascender - descender) / unitsPerEm, 2 decimals. */
export function woff2Metrics(file) {
  const b = fs.readFileSync(file);
  if (b.toString("latin1", 0, 4) !== "wOF2") throw new Error(`${file} is not a woff2`);
  let p = 48;
  const base128 = () => {
    let v = 0;
    for (let i = 0; i < 5; i++) {
      const c = b[p++];
      v = v * 128 + (c & 0x7f);
      if (!(c & 0x80)) return v;
    }
    throw new Error("bad UIntBase128");
  };
  const tables = [];
  for (let i = 0, n = b.readUInt16BE(12); i < n; i++) {
    const flags = b[p++];
    const tag = (flags & 0x3f) === 63 ? b.toString("latin1", p, (p += 4)) : KNOWN[flags & 0x3f];
    const length = base128();
    const version = flags >> 6;
    const transformed = tag === "glyf" || tag === "loca" ? version === 0 : version !== 0;
    tables.push({ tag, length: transformed ? base128() : length });
  }
  const data = brotliDecompressSync(b.subarray(p, p + b.readUInt32BE(20)));
  const t = {};
  let off = 0;
  for (const { tag, length } of tables) (t[tag] = data.subarray(off, off + length)), (off += length);
  const unitsPerEm = t.head.readUInt16BE(18), ascender = t.hhea.readInt16BE(4), descender = t.hhea.readInt16BE(6);
  return { unitsPerEm, ascender, descender, lineHeight: Math.round(((ascender - descender) / unitsPerEm) * 100) / 100 };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const f of process.argv.slice(2)) console.log(f, JSON.stringify(woff2Metrics(f)));
}
