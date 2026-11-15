// A three-way merge by line, for a doc edited in the tab while the agent wrote
// the same file: base (what the tab last loaded or saved), mine (the editor)
// and theirs (the file now). Pure; loaded by the canvas page from /lib/.
//
// Lines keep their own endings (\n or \r\n), so joining them gives the bytes
// back. Where only one side changed a stretch, that side wins; where both
// changed it differently it's a clash, and the merged text keeps mine there
// until the person chooses.

/** A text as lines, each with its line ending. */
export const splitLines = (text) => text.match(/[^\n]*\n|[^\n]+$/g) ?? [];

/**
 * @returns {{text: string, lines: string[], fromTheirs: number[], clashes: {at: number, mine: string[], theirs: string[]}[]}}
 *   `fromTheirs`: indexes in `lines` that came from theirs; `clashes[i].at`:
 *   where mine's lines for that clash start in `lines`.
 */
export function merge3(base, mine, theirs) {
  const o = splitLines(base), a = splitLines(mine), b = splitLines(theirs);
  const ma = matches(o, a), mb = matches(o, b);
  const lines = [], fromTheirs = [], clashes = [];
  let io = 0, ia = 0, ib = 0;
  for (;;) {
    // A stable run: the same line in all three.
    let k = 0;
    while (io + k < o.length && ma[io + k] === ia + k && mb[io + k] === ib + k) k++;
    lines.push(...a.slice(ia, ia + k));
    io += k; ia += k; ib += k;
    // The next base line both sides kept ends the unstable stretch.
    let x = io;
    while (x < o.length && (ma[x] < 0 || mb[x] < 0)) x++;
    const [oe, ae, be] = x < o.length ? [x, ma[x], mb[x]] : [o.length, a.length, b.length];
    if (io === oe && ia === ae && ib === be) {
      if (x >= o.length) break;
      continue;
    }
    const oc = o.slice(io, oe), ac = a.slice(ia, ae), bc = b.slice(ib, be);
    if (same(ac, oc)) {
      for (const l of bc) fromTheirs.push(lines.push(l) - 1);
    } else if (same(bc, oc) || same(ac, bc)) {
      lines.push(...ac);
    } else {
      clashes.push({ at: lines.length, mine: ac, theirs: bc });
      lines.push(...ac);
    }
    io = oe; ia = ae; ib = be;
  }
  return { text: lines.join(""), lines, fromTheirs, clashes };
}

/** The merged text with theirs in place of mine at every clash ("Load theirs"). */
export function takeTheirs({ lines, clashes }) {
  const out = [...lines];
  for (const c of [...clashes].reverse()) out.splice(c.at, c.mine.length, ...c.theirs);
  return out.join("");
}

/**
 * The edits that turn text `a` into `b`, line by line, as character ranges of
 * `a`: [{from, to, text}], in order. Applied from the last to the first, they
 * leave everything between them (the caret, a selection) where it was.
 */
export function lineHunks(a, b) {
  const x = splitLines(a), y = splitLines(b);
  const at = [0];
  for (const l of x) at.push(at[at.length - 1] + l.length);
  const hunks = [];
  let i = 0, j = 0;
  for (const [pi, pj] of [...lcs(x, y), [x.length, y.length]]) {
    if (pi > i || pj > j) hunks.push({ from: at[i], to: at[pi], text: y.slice(j, pj).join("") });
    i = pi + 1; j = pj + 1;
  }
  return hunks;
}

const same = (x, y) => x.length === y.length && x.every((l, i) => l === y[i]);

// For each line of `o`, the line of `x` it matches in a longest common
// subsequence, or -1.
function matches(o, x) {
  const m = new Int32Array(o.length).fill(-1);
  for (const [i, j] of lcs(o, x)) m[i] = j;
  return m;
}

// Matched index pairs, in order: the common start and end, then Myers' diff on
// the middle. A middle too different to diff cheaply matches nothing, which
// is safe: the merge then calls it a clash if both sides changed it.
function lcs(a, b) {
  let s = 0;
  while (s < a.length && s < b.length && a[s] === b[s]) s++;
  let e = 0;
  while (e < a.length - s && e < b.length - s && a[a.length - 1 - e] === b[b.length - 1 - e]) e++;
  const pairs = [];
  for (let i = 0; i < s; i++) pairs.push([i, i]);
  for (const [i, j] of myers(a.slice(s, a.length - e), b.slice(s, b.length - e))) pairs.push([i + s, j + s]);
  for (let i = e; i > 0; i--) pairs.push([a.length - i, b.length - i]);
  return pairs;
}

const MAX_EDITS = 2000;

function myers(a, b) {
  const n = a.length, m = b.length;
  if (!n || !m) return [];
  const max = Math.min(n + m, MAX_EDITS), off = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace = [];
  for (let d = 0; d <= max; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[off + k - 1] < v[off + k + 1]) ? v[off + k + 1] : v[off + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) { x++; y++; }
      v[off + k] = x;
      if (x >= n && y >= m) return backtrack(trace, n, m, off);
    }
  }
  return [];
}

function backtrack(trace, n, m, off) {
  const pairs = [];
  let x = n, y = m;
  for (let d = trace.length - 1; d > 0; d--) {
    const v = trace[d], k = x - y;
    const pk = k === -d || (k !== d && v[off + k - 1] < v[off + k + 1]) ? k + 1 : k - 1;
    const px = v[off + pk], py = px - pk;
    while (x > px && y > py) pairs.push([--x, --y]);
    x = px; y = py;
  }
  while (x > 0 && y > 0) pairs.push([--x, --y]);
  return pairs.reverse();
}
