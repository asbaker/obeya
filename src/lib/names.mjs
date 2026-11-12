// Page names, shared by the CLI, the server and the canvas page.
// Pure: no Node built-ins.
//
// A page's name is its path below the pages folder, without ".excalidraw":
// parts joined by "/" (folders, then the page). Names are kept in Unicode NFC.

export const NAME_RULE =
  "Page names can use letters, digits, spaces and most punctuation; / separates folders. " +
  "Not allowed: \\ : * ? \" < > |, a part starting with '.', or a part starting or ending with a space or ending with '.'.";

const MAX_PART = 120, MAX_NAME = 400;
// Windows-reserved punctuation (pages are shared through git), the backslash,
// and control characters.
const BAD_CHAR = /[\\:*?"<>|\u0000-\u001f\u007f]/;

/** One folder or page name: the text between slashes. */
export function validNamePart(part) {
  return typeof part === "string" && part.length > 0 && part.length <= MAX_PART &&
    !BAD_CHAR.test(part) && !part.includes("/") &&
    !part.startsWith(".") && !part.startsWith(" ") && !part.endsWith(" ") && !part.endsWith(".");
}

/** A whole page name, already in NFC (see normalizePageName). */
export function validPageName(name) {
  return typeof name === "string" && name.length > 0 && name.length <= MAX_NAME &&
    name === name.normalize("NFC") && name.split("/").every(validNamePart);
}

/** The form names are compared and stored in: NFC, so "é" typed or from disk match. */
export const normalizePageName = (name) => (typeof name === "string" ? name.normalize("NFC") : name);

/** "project-a/overview" -> "project-a"; a top-level page -> "". */
export const folderOf = (name) => (name.includes("/") ? name.slice(0, name.lastIndexOf("/")) : "");
/** "project-a/overview" -> "overview". */
export const baseName = (name) => name.slice(name.lastIndexOf("/") + 1);
/** Join a folder ("" for the top level) and a name. */
export const joinName = (folder, name) => (folder ? `${folder}/${name}` : name);

/** Every folder that holds a page, with its parents: ["project-a", "project-b", "project-b/research"]. */
export function foldersOf(names) {
  const out = new Set();
  for (const n of names) {
    const parts = n.split("/").slice(0, -1);
    for (let i = 1; i <= parts.length; i++) out.add(parts.slice(0, i).join("/"));
  }
  return [...out].sort((a, b) => a.localeCompare(b));
}

/**
 * Would `name` clash with an existing page or folder that differs only in
 * capitals? macOS and Windows can't keep those apart. Returns the clashing
 * name, or null. `except` is a page being renamed (it may change its own case).
 */
export function caseClash(name, names, except = null) {
  const others = names.filter((n) => n !== except);
  const lower = name.toLowerCase();
  const page = others.find((n) => n !== name && n.toLowerCase() === lower);
  if (page) return page;
  // Folders count even when the page being renamed is their only page: on disk
  // the folder keeps its old capitals.
  const mine = foldersOf([name]), theirs = foldersOf(names);
  for (const f of mine) {
    const clash = theirs.find((t) => t !== f && t.toLowerCase() === f.toLowerCase());
    if (clash) return clash;
  }
  return null;
}

/** A file name for an export of a page: folders flattened with "-". */
export const exportStem = (name) => name.replaceAll("/", "-");

/** Edit distance between two strings (Levenshtein). */
function distance(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

/**
 * The `n` page names nearest to `name`, for an unknown_page error: names that
 * contain it (or its last part) first, then by edit distance, case-insensitive.
 */
export function nearestNames(name, names, n = 5) {
  const q = String(name).toLowerCase(), base = baseName(q);
  const score = (s) => {
    const l = s.toLowerCase();
    return (l.includes(q) || l.includes(base) ? 0 : 1000) + Math.min(distance(q, l), distance(base, baseName(l)));
  };
  return names.map((s) => [s, score(s)]).sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0])).slice(0, n).map(([s]) => s);
}
