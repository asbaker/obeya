// The page store: elements in memory, .excalidraw files on disk, a persistent
// change log per page, and read cursors per consumer.

import fs from "node:fs";
import path from "node:path";
import { mergeElements } from "./merge.mjs";
import { bandsFile, changesFile, cursorsFile, ensureSidecar, trashDir, writeAtomic } from "./paths.mjs";
import { caseClash, normalizePageName, validPageName } from "./names.mjs";

const EXT = ".excalidraw";
// Folders never looked into: hidden ones (.obeya, .git) and node_modules.
const skipFolder = (name) => name.startsWith(".") || name === "node_modules";

/**
 * Every .excalidraw file below `dir`, as [relative path with "/", name or null
 * if the path isn't a valid page name]. Symlinked folders aren't followed, so
 * nothing outside `dir` is read.
 */
function walk(dir, rel = "", out = []) {
  let entries;
  try {
    entries = fs.readdirSync(path.join(dir, rel), { withFileTypes: true });
  } catch {
    return out;
  }
  for (const d of entries) {
    const r = rel ? `${rel}/${d.name}` : d.name;
    if (d.isDirectory()) {
      if (!skipFolder(d.name)) walk(dir, r, out);
    } else if (d.isFile() && d.name.endsWith(EXT)) {
      const name = normalizePageName(r.slice(0, -EXT.length));
      out.push([r, validPageName(name) ? name : null]);
    }
  }
  return out;
}

const pageError = (code, message) => Object.assign(new Error(message), { code });
// A page is a file; a folder that happens to end in .excalidraw isn't one.
const isFile = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };

const emptyScene = () => ({
  type: "excalidraw",
  version: 2,
  source: "obeya",
  elements: [],
  appState: { viewBackgroundColor: "#ffffff" },
  files: {},
});

function readLog(file) {
  if (!fs.existsSync(file)) return [];
  const out = [];
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      // A torn last line after a crash: skip it.
    }
  }
  return out;
}

/**
 * Sort by fractional index, keeping arrival order where an index is missing.
 * Excalidraw takes the array order as stacking order, so a page must be served
 * and saved in index order or "send to back" is lost on reload.
 */
export function byIndex(elements) {
  return elements
    .map((e, i) => [e, i])
    .sort(([a, i], [b, j]) => (a.index && b.index && a.index !== b.index ? (a.index < b.index ? -1 : 1) : i - j))
    .map(([e]) => e);
}

export class PageStore {
  /**
   * @param {string} dir
   * @param {{saveDelayMs?: number, onNewPage?: (name: string) => void, now?: () => string}} [opts]
   */
  constructor(dir, opts = {}) {
    this.dir = dir;
    this.saveDelayMs = opts.saveDelayMs ?? 300;
    this.onNewPage = opts.onNewPage ?? (() => {});
    this.now = opts.now ?? (() => new Date().toISOString());
    /** @type {Map<string, {scene: any, byId: Map<string, any>, rev: number, log: any[]}>} */
    this.pages = new Map();
    this.timers = new Map();
    this.gone = new Set(); // see retired()
    fs.mkdirSync(dir, { recursive: true });
    ensureSidecar(dir);
    this.cursors = this.#readCursors();
  }

  /**
   * A page's file. The name is NFC; a file someone else wrote may be stored in
   * another form (NFD on some systems), so a listed file's own path wins.
   */
  file(name) {
    return path.join(this.dir, this.onDiskAs?.get(name) ?? `${name}${EXT}`);
  }

  list() {
    const found = walk(this.dir).filter(([, n]) => n);
    this.onDiskAs = new Map(found.map(([rel, n]) => [n, rel]));
    const names = new Set(found.map(([, n]) => n));
    // A page only in memory is listed until its first save. After that the file
    // decides, so a page deleted on disk (git, another program) drops out.
    for (const [name, p] of this.pages) if (p.byId.size && !p.onDisk) names.add(name);
    return [...names].sort();
  }

  /** A page for the page picker: its revision, how many frames it has, and when its file last changed. */
  summary(name) {
    const p = this.load(name);
    let modified = null;
    try {
      modified = fs.statSync(this.file(name)).mtime.toISOString();
    } catch {} // not saved yet
    const frames = [...p.byId.values()].filter((e) => e.type === "frame" && !e.isDeleted).length;
    return { name, rev: p.rev, frames, modified };
  }

  /** `.excalidraw` files in the pages dir whose names aren't valid page names, so they can't be opened. */
  skipped() {
    return walk(this.dir)
      .filter(([, n]) => !n)
      .map(([file]) => file)
      .sort()
      .map((file) => ({ file, reason: "the name has a character pages can't use (\\ : * ? \" < > |), or a part that starts with '.' or starts or ends with a space" }));
  }

  exists(name) {
    return (this.pages.get(name)?.byId.size ?? 0) > 0 || isFile(this.file(name));
  }

  /** Deleted, or renamed away, while this server runs: syncs from tabs to it are refused. */
  retired(name) {
    return this.gone.has(name);
  }

  /** An agent patches a retired name on purpose: it may make the page again. */
  revive(name) {
    this.gone.delete(name);
  }

  load(name) {
    if (!validPageName(name)) throw pageError("bad_page_name", `bad page name "${name}"`);
    let p = this.pages.get(name);
    if (p) return p;
    this.#refuseSymlinks(name);
    // On macOS "roadmap" would open Roadmap's file as a second page: refuse names
    // that differ from a page or folder only in capitals.
    if (!this.list().includes(name)) this.#refuseCaseClash(name);
    const onDisk = isFile(this.file(name));
    const scene = onDisk ? JSON.parse(fs.readFileSync(this.file(name), "utf8")) : emptyScene();
    scene.elements ??= [];
    const log = readLog(changesFile(this.dir, name));
    p = { scene, byId: new Map(scene.elements.map((e) => [e.id, e])), rev: log.reduce((m, e) => Math.max(m, e.rev ?? 0), 0), log, onDisk };
    this.pages.set(name, p);
    return p;
  }

  /** Elements in stacking order (Excalidraw's fractional `index`; plain string order). */
  elements(name) {
    return byIndex([...this.load(name).byId.values()]);
  }

  /** Merge elements from `source` ("user" | "agent"). Returns the new log entries. */
  merge(name, incoming, source) {
    const p = this.load(name);
    const changes = mergeElements(p.byId, Array.isArray(incoming) ? incoming : []);
    if (!changes.length) {
      // Versions may still have advanced (e.g. only boundElements changed): save, don't log.
      this.scheduleSave(name);
      return [];
    }
    const at = this.now();
    const entries = changes.map((c) => ({ rev: ++p.rev, at, source, ...c }));
    p.log.push(...entries);
    fs.mkdirSync(path.dirname(changesFile(this.dir, name)), { recursive: true });
    fs.appendFileSync(changesFile(this.dir, name), entries.map((e) => JSON.stringify(e) + "\n").join(""));
    this.scheduleSave(name);
    return entries;
  }

  addFiles(name, files) {
    if (!files || typeof files !== "object" || !Object.keys(files).length) return;
    const p = this.load(name);
    p.scene.files = { ...(p.scene.files || {}), ...files };
    this.scheduleSave(name);
  }

  /**
   * @param {{since?: number|"last", source?: string, consumer?: string}} q
   * @returns {{rev: number, since: number, entries: any[]}}
   */
  changes(name, { since = 0, source, consumer = "default" } = {}) {
    const p = this.load(name);
    const from = since === "last" ? this.cursors[name]?.[consumer] ?? 0 : Number(since) || 0;
    const entries = p.log.filter((e) => e.rev > from && (!source || e.source === source));
    if (since === "last") {
      (this.cursors[name] ??= {})[consumer] = p.rev;
      writeAtomic(this.dir, cursorsFile(this.dir), JSON.stringify(this.cursors, null, 2) + "\n");
    }
    return { rev: p.rev, since: from, entries };
  }

  /** Named bands: [{name, axis: "x"|"y", from, to}]. */
  bands(page) {
    try {
      return JSON.parse(fs.readFileSync(bandsFile(this.dir, page), "utf8"));
    } catch {
      return [];
    }
  }

  setBand(page, band) {
    const bands = this.bands(page).filter((b) => b.name !== band.name);
    bands.push(band);
    bands.sort((a, b) => a.name.localeCompare(b.name));
    writeAtomic(this.dir, bandsFile(this.dir, page), JSON.stringify(bands, null, 2) + "\n");
    return bands;
  }

  deleteBand(page, name) {
    const bands = this.bands(page);
    if (!bands.some((b) => b.name === name)) return null;
    const rest = bands.filter((b) => b.name !== name);
    writeAtomic(this.dir, bandsFile(this.dir, page), JSON.stringify(rest, null, 2) + "\n");
    return rest;
  }

  scheduleSave(name) {
    clearTimeout(this.timers.get(name));
    this.timers.set(name, setTimeout(() => this.save(name), this.saveDelayMs));
  }

  save(name) {
    clearTimeout(this.timers.get(name));
    this.timers.delete(name);
    const p = this.pages.get(name);
    if (!p) return;
    const isNew = !fs.existsSync(this.file(name));
    p.scene.elements = byIndex([...p.byId.values()]);
    // Image data no live image uses goes: deleted images don't keep weighing on the file.
    if (p.scene.files) {
      const used = new Set(p.scene.elements.filter((e) => e.type === "image" && !e.isDeleted && e.fileId).map((e) => e.fileId));
      for (const id of Object.keys(p.scene.files)) if (!used.has(id)) delete p.scene.files[id];
    }
    writeAtomic(this.dir, this.file(name), JSON.stringify(p.scene, null, 2) + "\n");
    p.onDisk = true;
    if (isNew) this.onNewPage(name);
  }

  /**
   * Create an empty page and write it now, so it exists before anything is
   * drawn on it. Throws {code} page_exists / bad_page_name.
   */
  create(name) {
    if (!validPageName(name)) throw pageError("bad_page_name", `bad page name "${name}"`);
    this.#refuseSymlinks(name);
    this.#refuseCaseClash(name); // first: on macOS the file system already "has" Roadmap when roadmap exists
    if (this.exists(name) || fs.existsSync(changesFile(this.dir, name))) throw pageError("page_exists", `page "${name}" already exists`);
    this.pages.delete(name); // an empty page some tab opened and nobody drew on
    this.gone.delete(name);
    this.load(name);
    this.save(name);
  }

  /**
   * Rename a page: its file, change log, bands and read cursors move with it.
   * Throws {code} unknown_page / page_exists / bad_page_name.
   */
  rename(from, to) {
    if (!validPageName(to)) throw pageError("bad_page_name", `bad page name "${to}"`);
    if (!this.exists(from)) throw pageError("unknown_page", `no page "${from}"`);
    this.#refuseSymlinks(to);
    this.#refuseCaseClash(to, from);
    const sameFile = to.toLowerCase() === from.toLowerCase(); // only the capitals change
    if (!sameFile && (this.exists(to) || fs.existsSync(changesFile(this.dir, to)))) throw pageError("page_exists", `page "${to}" already exists`);
    this.load(from);
    this.save(from); // write pending edits under the old name first
    // Moving to another folder makes it (and its sidecar folder) as needed,
    // and removes folders the move leaves empty.
    const move = (a, b) => {
      if (!fs.existsSync(a)) return;
      fs.mkdirSync(path.dirname(b), { recursive: true });
      fs.renameSync(a, b);
    };
    const oldFile = this.file(from);
    move(oldFile, path.join(this.dir, `${to}${EXT}`));
    move(changesFile(this.dir, from), changesFile(this.dir, to));
    move(bandsFile(this.dir, from), bandsFile(this.dir, to));
    this.onDiskAs?.delete(from);
    this.gone.add(from);
    this.gone.delete(to);
    this.#pruneFolders(from);
    if (this.cursors[from]) {
      this.cursors[to] = this.cursors[from];
      delete this.cursors[from];
      writeAtomic(this.dir, cursorsFile(this.dir), JSON.stringify(this.cursors, null, 2) + "\n");
    }
    this.pages.set(to, this.pages.get(from));
    this.pages.delete(from);
  }

  /**
   * Delete a page: its file, change log and bands move to .obeya/.trash/<time>/
   * (nothing is erased); its read cursors are dropped. The only page can't be
   * deleted. Throws {code} unknown_page / last_page. Returns the trash folder.
   */
  delete(name) {
    if (!this.exists(name)) throw pageError("unknown_page", `no page "${name}"`);
    if (this.list().filter((n) => n !== name).length === 0) throw pageError("last_page", `"${name}" is the only page; make another before deleting it`);
    this.save(name); // pending edits go to the trash too
    const to = path.join(trashDir(this.dir), this.now().replace(/[:.]/g, "-"));
    const move = (a, rel) => {
      if (!fs.existsSync(a)) return;
      const b = path.join(to, rel);
      fs.mkdirSync(path.dirname(b), { recursive: true });
      fs.renameSync(a, b);
    };
    move(this.file(name), `${name}${EXT}`);
    move(changesFile(this.dir, name), `${name}.changes.jsonl`);
    move(bandsFile(this.dir, name), `${name}.bands.json`);
    clearTimeout(this.timers.get(name));
    this.timers.delete(name);
    this.pages.delete(name);
    this.onDiskAs?.delete(name);
    this.gone.add(name);
    if (this.cursors[name]) {
      delete this.cursors[name];
      writeAtomic(this.dir, cursorsFile(this.dir), JSON.stringify(this.cursors, null, 2) + "\n");
    }
    this.#pruneFolders(name);
    return to;
  }

  // A folder on the way that is a symlink could lead outside the pages folder:
  // listing never follows one, and nothing is read or written through one.
  #refuseSymlinks(name) {
    const parts = name.split("/").slice(0, -1);
    for (let i = 1; i <= parts.length; i++) {
      let st;
      try {
        st = fs.lstatSync(path.join(this.dir, ...parts.slice(0, i)));
      } catch {
        return; // doesn't exist yet: nothing below it can either
      }
      if (st.isSymbolicLink() || !st.isDirectory()) throw pageError("bad_page_name", `"${parts.slice(0, i).join("/")}" isn't a folder in the pages folder`);
    }
  }

  // macOS and Windows can't keep pages or folders apart that differ only in capitals.
  #refuseCaseClash(name, except = null) {
    const clash = caseClash(name, this.list(), except);
    if (clash) throw pageError("page_exists", `"${name}" differs from "${clash}" only in capitals`);
  }

  // Remove the folders a page left behind if they're now empty (pages and sidecar).
  #pruneFolders(name) {
    const parts = name.split("/").slice(0, -1);
    for (const root of [this.dir, path.join(this.dir, ".obeya")]) {
      for (let i = parts.length; i > 0; i--) {
        try {
          fs.rmdirSync(path.join(root, ...parts.slice(0, i))); // only if empty
        } catch {
          break;
        }
      }
    }
  }

  /** Elements on any page whose link names `page` (e.g. ?page=<page>&element=…). */
  linksTo(page) {
    const out = [];
    for (const name of this.list()) {
      for (const e of this.load(name).byId.values()) {
        if (e.isDeleted || !e.link) continue;
        try {
          if (new URL(e.link, "http://127.0.0.1/").searchParams.get("page") === page) out.push({ page: name, id: e.id, link: e.link });
        } catch {}
      }
    }
    return out;
  }

  /** Save every page with a pending save. */
  flush() {
    for (const name of [...this.timers.keys()]) this.save(name);
  }

  #readCursors() {
    try {
      return JSON.parse(fs.readFileSync(cursorsFile(this.dir), "utf8"));
    } catch {
      return {};
    }
  }
}
