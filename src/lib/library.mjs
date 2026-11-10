// Component libraries (.excalidrawlib), pure parts: parsing, catalogue ids,
// search ranking, addressing items as "<lib>/<item>", placing a copy with new
// ids, and the contact-sheet layout. Downloading and caching: libcache.mjs.

import { bounds } from "./geometry.mjs";
import { slug } from "./deck.mjs";

export const LIB_ID = /^[a-z0-9][a-z0-9._-]{0,99}$/i;
export const ID_PREFIX = /^[a-z0-9][a-z0-9._-]{0,47}$/i;

/** Item ids: slug of the name, de-duplicated; unnamed items are item-<n>. */
function itemIds(items) {
  const seen = new Map();
  return items.map((it, i) => {
    const base = it.name?.trim() ? slug(it.name) : `item-${i + 1}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base}-${n}`;
  });
}

/** Is this parsed JSON an Excalidraw library? */
export const isLibrary = (json) =>
  json && typeof json === "object" && json.type === "excalidrawlib" && (Array.isArray(json.libraryItems) || Array.isArray(json.library));

/** Parse one .excalidrawlib (version 1 or 2) into items. */
export function parseLibrary(json) {
  const raw = json.libraryItems ?? (json.library ?? []).map((elements) => ({ elements }));
  const ids = itemIds(raw);
  return raw.map((it, i) => ({ id: ids[i], name: it.name?.trim() || null, elements: (it.elements ?? []).filter((e) => !e.isDeleted) }));
}

/** Item size in scene units. */
export function itemSize(item) {
  const bs = item.elements.filter((e) => !(e.type === "text" && e.containerId)).map(bounds);
  if (!bs.length) return { w: 0, h: 0 };
  return {
    w: Math.round(Math.max(...bs.map((b) => b.x2)) - Math.min(...bs.map((b) => b.x1))),
    h: Math.round(Math.max(...bs.map((b) => b.y2)) - Math.min(...bs.map((b) => b.y1))),
  };
}

// ---------------------------------------------------------------------------
// The public catalogue

const baseName = (source) => source.split("/").pop().replace(/\.excalidrawlib$/, "");
const author = (source) => source.split("/")[0];

/**
 * Catalogue entries with short, stable ids: the file name, or
 * `<file-name>.<author-dir>` when two authors use the same file name.
 * @param {any[]} libraries  libraries.json
 * @param {Record<string, {total?: number}>} stats  stats.json
 */
export function catalogueEntries(libraries, stats = {}) {
  const counts = new Map();
  for (const l of libraries) counts.set(baseName(l.source), (counts.get(baseName(l.source)) ?? 0) + 1);
  return libraries.map((l) => {
    const b = baseName(l.source);
    const statKey = l.source.replace(/\.excalidrawlib$/, "").replace(/\//g, "-");
    return {
      id: counts.get(b) > 1 ? `${b}.${author(l.source)}` : b,
      name: l.name,
      description: (l.description ?? "").replace(/\s+/g, " ").trim(),
      authors: (l.authors ?? []).map((a) => ({ name: a.name, url: a.url ?? null })),
      source: l.source,
      itemNames: l.itemNames ?? [],
      downloads: stats[statKey]?.total ?? 0,
      updated: l.updated ?? l.created ?? null,
    };
  });
}

/**
 * Rank catalogue entries for a query. Every term must match somewhere.
 * Name matches weigh most, then item names, description, author. Ties go to
 * libraries with named items (agents can address those), then downloads.
 */
export function searchCatalogue(entries, query, limit = 20) {
  const terms = String(query).toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const scored = [];
  for (const e of entries) {
    const fields = [
      [e.name.toLowerCase() + " " + e.id.toLowerCase(), 5],
      [e.itemNames.join(" ").toLowerCase(), 2],
      [e.description.toLowerCase(), 1],
      [e.authors.map((a) => a.name).join(" ").toLowerCase(), 1],
    ];
    let score = 0;
    let all = true;
    for (const t of terms) {
      const s = fields.reduce((n, [text, w]) => n + (text.includes(t) ? w : 0), 0);
      if (!s) all = false;
      score += s;
    }
    if (all) scored.push({ e, score });
  }
  const named = (e) => (e.itemNames.length ? 1 : 0);
  scored.sort((a, b) => b.score - a.score || named(b.e) - named(a.e) || b.e.downloads - a.e.downloads);
  return scored.slice(0, limit).map(({ e }) => e);
}

// ---------------------------------------------------------------------------
// Items

/** Find "<lib>/<item>" in a loaded library. Throws {code: "unknown_library_item"} with near matches. */
export function findItem(lib, itemId) {
  const item = lib.items.find((i) => i.id === itemId);
  if (item) return item;
  const near = lib.items.filter((i) => itemId && i.id.includes(itemId)).map((i) => `${lib.id}/${i.id}`);
  throw Object.assign(new Error(`no item "${itemId}" in library "${lib.id}"`), {
    code: "unknown_library_item",
    ...(near.length ? { suggestions: near.slice(0, 10) } : {}),
  });
}

/**
 * A copy of `item` placed with its top-left at `at`, ids `<prefix>-1…`,
 * groups `<prefix>-g1…`, and every internal reference (bound text, bindings,
 * groups, frames) remapped. Elements get `frame` as their frame.
 * @param {{elements: any[]}} item
 * @param {{at: [number, number], prefix: string, frame?: string|null, nonce?: () => number}} opts
 */
export function instantiate(item, { at, prefix, frame = null, nonce = () => Math.floor(Math.random() * 2 ** 31) }) {
  const els = item.elements.filter((e) => !e.isDeleted);
  const bs = els.map(bounds);
  const dx = at[0] - Math.min(...bs.map((b) => b.x1));
  const dy = at[1] - Math.min(...bs.map((b) => b.y1));
  const ids = new Map(els.map((e, i) => [e.id, `${prefix}-${i + 1}`]));
  const groups = new Map();
  for (const e of els) for (const g of e.groupIds ?? []) if (!groups.has(g)) groups.set(g, `${prefix}-g${groups.size + 1}`);
  const remapBinding = (b) => (b && ids.has(b.elementId) ? { ...b, elementId: ids.get(b.elementId) } : null);
  return els.map((e) => {
    const c = structuredClone(e);
    c.id = ids.get(e.id);
    c.x = e.x + dx;
    c.y = e.y + dy;
    c.version = 1;
    c.versionNonce = nonce();
    c.isDeleted = false;
    c.updated = Date.now();
    delete c.index; // the editor assigns a fresh fractional index
    c.groupIds = (e.groupIds ?? []).map((g) => groups.get(g));
    c.frameId = e.frameId && ids.has(e.frameId) ? ids.get(e.frameId) : frame;
    if (e.containerId !== undefined) c.containerId = e.containerId && ids.has(e.containerId) ? ids.get(e.containerId) : null;
    if (e.boundElements) c.boundElements = e.boundElements.filter((b) => ids.has(b.id)).map((b) => ({ ...b, id: ids.get(b.id) }));
    if ("startBinding" in e) c.startBinding = remapBinding(e.startBinding);
    if ("endBinding" in e) c.endBinding = remapBinding(e.endBinding);
    return c;
  });
}

/** Library items for the editor's sidebar (version 2 format). */
export function sidebarItems(libs) {
  return libs.flatMap((l) =>
    l.items.map((it) => ({ id: `${l.id}/${it.id}`, status: "published", created: 1, name: it.name ?? it.id, elements: it.elements })),
  );
}

// ---------------------------------------------------------------------------
// Contact sheet: every item in a labelled grid, for an agent to look at.

export const SHEET = { columns: 6, cellW: 220, cellH: 190, art: 160, perSheet: 48 };

/** Split items into sheets of at most `perSheet`, each with its grid size. */
export function sheetPages(items, { columns = SHEET.columns, perSheet = SHEET.perSheet } = {}) {
  const pages = [];
  for (let i = 0; i < items.length; i += perSheet) {
    const chunk = items.slice(i, i + perSheet);
    const cols = Math.min(columns, chunk.length);
    pages.push({ first: i + 1, last: i + chunk.length, items: chunk, columns: cols, rows: Math.ceil(chunk.length / cols) });
  }
  return pages;
}

/** File name for sheet `n` of `total`: out.png, or out-1.png, out-2.png… */
export function sheetFile(out, n, total) {
  if (total === 1) return out;
  const dot = out.toLowerCase().endsWith(".png") ? out.length - 4 : out.length;
  return `${out.slice(0, dot)}-${n}${out.slice(dot) || ".png"}`;
}
