// Component libraries on demand: the public catalogue, a per-user cache, and
// adding libraries from the catalogue, a local file, or an https URL.
// Downloads only (GET); nothing about the person's drawings is ever sent.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { catalogueEntries, isLibrary, LIB_ID, parseLibrary, searchCatalogue } from "./library.mjs";
import { slug } from "./deck.mjs";

export const DEFAULT_CATALOGUE = "https://raw.githubusercontent.com/excalidraw/excalidraw-libraries/main";
export const CATALOGUE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_BYTES = 20 * 1024 * 1024;

export class LibraryError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.code = code;
    this.extra = extra;
  }
}

/** Per-user cache dir: $OBEYA_CACHE, $XDG_CACHE_HOME, or the OS default. */
export function cacheDir(env = process.env, platform = process.platform, home = os.homedir(), name = "obeya") {
  if (env.OBEYA_CACHE) return path.resolve(env.OBEYA_CACHE);
  if (env.XDG_CACHE_HOME) return path.join(env.XDG_CACHE_HOME, name);
  if (platform === "darwin") return path.join(home, "Library", "Caches", name);
  if (platform === "win32") return path.join(env.LOCALAPPDATA || path.join(home, "AppData", "Local"), name, "Cache");
  return path.join(home, ".cache", name);
}
/**
 * Move the cache from before the project was called obeya, once: it can hold
 * libraries the person added from local files, which can't be downloaded again.
 */
export function migrateCache(env = process.env, platform = process.platform, home = os.homedir()) {
  if (env.OBEYA_CACHE) return false;
  const from = cacheDir(env, platform, home, "excalidraw-local"), to = cacheDir(env, platform, home);
  if (!fs.existsSync(from) || fs.existsSync(to)) return false;
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.renameSync(from, to);
  return true;
}
let migrated = false;
const libDir = (env) => {
  if (!migrated) migrated = true, migrateCache(env);
  return path.join(cacheDir(env), "libraries");
};
const catalogueBase = (env) => (env.OBEYA_CATALOGUE_URL || DEFAULT_CATALOGUE).replace(/\/+$/, "");

function writeAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

/** https anywhere, or http to this machine (local mirrors, tests). */
export function allowedUrl(u) {
  try {
    const url = new URL(u);
    return url.protocol === "https:" || (url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname));
  } catch {
    return false;
  }
}

async function download(url) {
  if (!allowedUrl(url)) throw new LibraryError("invalid_argument", "libraries are downloaded over https (or http from this machine)");
  let res;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(15000), redirect: "follow" });
  } catch (err) {
    throw new LibraryError("network_error", `could not download ${url}: ${err.cause?.code || err.name || err.message}`);
  }
  if (!res.ok) throw new LibraryError(res.status === 404 ? "not_found" : "network_error", `could not download ${url}: HTTP ${res.status}`);
  const len = Number(res.headers.get("content-length") || 0);
  if (len > MAX_BYTES) throw new LibraryError("too_large", `${url} is larger than ${MAX_BYTES / 1024 / 1024} MB`);
  const text = await res.text();
  if (text.length > MAX_BYTES) throw new LibraryError("too_large", `${url} is larger than ${MAX_BYTES / 1024 / 1024} MB`);
  return text;
}

function parseJSON(text, what) {
  try {
    return JSON.parse(text);
  } catch {
    throw new LibraryError("invalid_library", `${what} is not valid JSON`);
  }
}

/**
 * The catalogue, refreshed at most once a day. Offline with a stale copy: the
 * stale copy (stale: true). Offline with none: network_error.
 */
export async function catalogue(env = process.env, { refresh = false, now = Date.now() } = {}) {
  const file = path.join(libDir(env), "catalogue.json");
  const base = catalogueBase(env);
  let cached = null;
  try {
    cached = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {}
  const usable = cached && cached.base === base;
  if (usable && !refresh && now - cached.fetchedAt < CATALOGUE_TTL_MS) {
    return { entries: catalogueEntries(cached.libraries, cached.stats), fetchedAt: cached.fetchedAt, stale: false };
  }
  try {
    const libraries = parseJSON(await download(`${base}/libraries.json`), "the catalogue");
    if (!Array.isArray(libraries)) throw new LibraryError("invalid_library", "the catalogue is not a list");
    let stats = {};
    try {
      stats = parseJSON(await download(`${base}/stats.json`), "catalogue stats");
    } catch {} // download counts are optional
    const fresh = { base, fetchedAt: now, libraries, stats };
    writeAtomic(file, JSON.stringify(fresh));
    return { entries: catalogueEntries(libraries, stats), fetchedAt: now, stale: false };
  } catch (err) {
    if (usable) return { entries: catalogueEntries(cached.libraries, cached.stats), fetchedAt: cached.fetchedAt, stale: true };
    throw err;
  }
}

export async function search(env, query, limit) {
  const { entries, stale } = await catalogue(env);
  const cachedIds = new Set(listCached(env).map((l) => l.id));
  return {
    stale,
    results: searchCatalogue(entries, query, limit).map((e) => ({
      id: e.id,
      name: e.name,
      description: e.description,
      authors: e.authors.map((a) => a.name),
      items: e.itemNames.length || null,
      named: e.itemNames.length > 0,
      downloads: e.downloads,
      cached: cachedIds.has(e.id),
    })),
  };
}

// ---------------------------------------------------------------------------
// The cache: <cache>/libraries/<id>.excalidrawlib + <id>.meta.json

const metaFile = (env, id) => path.join(libDir(env), `${id}.meta.json`);
const dataFile = (env, id) => path.join(libDir(env), `${id}.excalidrawlib`);

/** Cached libraries' metadata (no items). */
export function listCached(env = process.env) {
  let files = [];
  try {
    files = fs.readdirSync(libDir(env)).filter((f) => f.endsWith(".meta.json"));
  } catch {}
  return files
    .map((f) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(libDir(env), f), "utf8"));
      } catch {
        return null;
      }
    })
    .filter((m) => m && LIB_ID.test(m.id) && fs.existsSync(dataFile(env, m.id)))
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** A cached library with items, or null. */
export function loadCached(env, id) {
  if (!LIB_ID.test(id)) return null;
  try {
    const meta = JSON.parse(fs.readFileSync(metaFile(env, id), "utf8"));
    const items = parseLibrary(JSON.parse(fs.readFileSync(dataFile(env, id), "utf8")));
    return { ...meta, items };
  } catch {
    return null;
  }
}

/** Every cached library with items (for the editor's sidebar). */
export const loadAllCached = (env = process.env) => listCached(env).map((m) => loadCached(env, m.id)).filter(Boolean);

function store(env, meta, text) {
  const json = parseJSON(text, meta.source);
  if (!isLibrary(json)) throw new LibraryError("invalid_library", `${meta.source} is not an Excalidraw library (.excalidrawlib)`);
  const items = parseLibrary(json);
  if (!items.length) throw new LibraryError("invalid_library", `${meta.source} has no items`);
  const existing = listCached(env).find((m) => m.id === meta.id);
  if (existing && (existing.origin !== meta.origin || existing.source !== meta.source)) {
    throw new LibraryError("library_exists", `a different library is already cached as "${meta.id}"; pass --as <id>`, { existing: { origin: existing.origin, source: existing.source } });
  }
  const full = { ...meta, items: items.length, named: items.some((i) => i.name), addedAt: new Date().toISOString() };
  writeAtomic(dataFile(env, meta.id), text);
  writeAtomic(metaFile(env, meta.id), JSON.stringify(full, null, 2) + "\n");
  return { ...full, items };
}

async function fromCatalogue(env, id) {
  const { entries } = await catalogue(env);
  const e = entries.find((x) => x.id === id);
  if (!e) {
    const near = searchCatalogue(entries, id.replace(/[-._]+/g, " "), 5).map((x) => x.id);
    throw new LibraryError("unknown_library", `no library "${id}" in the catalogue; try \`obeya library search <words>\``, near.length ? { suggestions: near } : {});
  }
  const text = await download(`${catalogueBase(env)}/libraries/${e.source}`);
  return store(env, {
    id: e.id,
    name: e.name,
    description: e.description,
    authors: e.authors,
    origin: "catalogue",
    source: `https://github.com/excalidraw/excalidraw-libraries/blob/main/libraries/${e.source}`,
    license: "MIT (Excalidraw libraries catalogue)",
  }, text);
}

/**
 * Add a library to the cache from a catalogue id, a local .excalidrawlib file,
 * or an https URL. `as` names it (required on an id clash).
 */
export async function addLibrary(env, ref, { as, cwd = process.cwd() } = {}) {
  if (as !== undefined && !LIB_ID.test(as)) throw new LibraryError("invalid_argument", "--as is letters, digits, . _ -");
  if (/^https?:\/\//i.test(ref)) {
    const name = decodeURIComponent(new URL(ref).pathname.split("/").pop() || "library").replace(/\.excalidrawlib$/i, "");
    const id = as ?? (slug(name) === "frame" ? "library" : slug(name));
    const text = await download(ref);
    return store(env, { id, name, description: "", authors: [], origin: "url", source: ref, license: null }, text);
  }
  const file = path.resolve(cwd, ref);
  if (fs.existsSync(file) && fs.statSync(file).isFile()) {
    const name = path.basename(file).replace(/\.excalidrawlib$/i, "");
    const id = as ?? (slug(name) === "frame" ? "library" : slug(name));
    // Only the file name is recorded, not where it lives on this machine.
    return store(env, { id, name, description: "", authors: [], origin: "file", source: path.basename(file), license: null }, fs.readFileSync(file, "utf8"));
  }
  if (ref.endsWith(".excalidrawlib")) throw new LibraryError("invalid_argument", `no file ${ref}`);
  if (!LIB_ID.test(ref)) throw new LibraryError("invalid_argument", "give a catalogue id, a .excalidrawlib file, or an https URL");
  if (as !== undefined && as !== ref) throw new LibraryError("invalid_argument", "--as is for files and URLs; catalogue libraries keep their id");
  return fromCatalogue(env, ref);
}

/** A cached library, downloading it from the catalogue on first use. */
export async function ensureLibrary(env, id) {
  const lib = loadCached(env, id);
  if (lib) return { lib, downloaded: false };
  if (!LIB_ID.test(id)) throw new LibraryError("invalid_argument", `bad library id "${id}"`);
  return { lib: await fromCatalogue(env, id), downloaded: true };
}

export function removeLibrary(env, id) {
  if (!LIB_ID.test(id) || !fs.existsSync(metaFile(env, id))) return false;
  fs.rmSync(metaFile(env, id), { force: true });
  fs.rmSync(dataFile(env, id), { force: true });
  return true;
}
