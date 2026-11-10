// Paths: dir comparison and the sidecar layout.

import fs from "node:fs";
import path from "node:path";

/** Canonical form of a directory: its real path if it exists, else the resolved path. */
export function canonicalDir(p) {
  const abs = path.resolve(p);
  try {
    return fs.realpathSync.native(abs);
  } catch {
    // Not created yet: canonicalize the nearest existing parent so that
    // e.g. a symlinked temp root still compares equal.
    const parent = path.dirname(abs);
    if (parent === abs) return abs;
    return path.join(canonicalDir(parent), path.basename(abs));
  }
}

/** Do two paths name the same directory? Compared by real path. */
export function sameDir(a, b) {
  return canonicalDir(a) === canonicalDir(b);
}

/** Sidecar directory for state that isn't Excalidraw data. Git-ignores itself. */
export const SIDECAR = ".obeya";
export const sidecarDir = (dir) => path.join(dir, SIDECAR);
/** The sidecar's name before the project was called obeya. */
export const LEGACY_SIDECAR = ".excalidraw-local";

/**
 * Move a sidecar from before the rename (`.excalidraw-local/`) to `.obeya/`, so
 * change logs, read cursors and bands carry over. Leaves both alone if both
 * exist. Returns true if it moved one.
 */
export function migrateSidecar(dir) {
  const from = path.join(dir, LEGACY_SIDECAR), to = sidecarDir(dir);
  if (!fs.existsSync(from) || fs.existsSync(to)) return false;
  fs.renameSync(from, to);
  const ignore = path.join(to, ".gitignore");
  if (fs.existsSync(ignore)) fs.writeFileSync(ignore, IGNORE_FILE);
  return true;
}
const IGNORE_FILE = "# obeya runtime state; never commit\n*\n";
/** Where versions before 0.1 kept a session token; the server deletes it on start. */
export const legacyTokenFile = (dir, port) => path.join(sidecarDir(dir), `server-${port}.json`);
export const logFile = (dir) => path.join(sidecarDir(dir), "server.log");
export const changesFile = (dir, page) => path.join(sidecarDir(dir), `${page}.changes.jsonl`);
export const bandsFile = (dir, page) => path.join(sidecarDir(dir), `${page}.bands.json`);
export const cursorsFile = (dir) => path.join(sidecarDir(dir), "cursors.json");
export const shotsDir = (dir) => path.join(sidecarDir(dir), "shots");
/** Deleted pages, with their change logs and bands (recoverable by hand). Starts with "." so no page folder can collide. */
export const trashDir = (dir) => path.join(sidecarDir(dir), ".trash");

export function ensureSidecar(dir) {
  migrateSidecar(dir);
  fs.mkdirSync(sidecarDir(dir), { recursive: true });
  const ignore = path.join(sidecarDir(dir), ".gitignore");
  if (!fs.existsSync(ignore)) fs.writeFileSync(ignore, IGNORE_FILE);
}

/** Write a file atomically: temp file in the sidecar dir, then rename. */
export function writeAtomic(dir, file, data, mode) {
  ensureSidecar(dir);
  fs.mkdirSync(path.dirname(file), { recursive: true }); // a page in a folder
  const tmp = path.join(sidecarDir(dir), `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(tmp, data, mode ? { mode } : undefined);
  fs.renameSync(tmp, file);
}
