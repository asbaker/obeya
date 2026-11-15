// Edit a markdown doc in the tab, with EasyMDE (MIT; CodeMirror 5 inside),
// loaded from esm.sh, pinned and bundled (one CodeMirror for it and its
// add-ons), the first time a doc goes to Edit. Loaded by ./doc.mjs.
//
// Saving: 800 ms after typing stops (and on leaving), through the server, with
// `base`: the text the tab last loaded or saved. The agent writes docs as plain
// files, so the file can change under the editor: then a three-way merge by
// line (/lib/docmerge.mjs) brings their lines in around the caret, tinted for a
// moment. Where both changed the same lines, a banner asks: Load theirs or Keep
// mine; nothing is saved until then, and closing the tab asks first.
//
// Side by side is ours, not EasyMDE's (that one is built for full screen): a
// preview pane beside the editor, rendered like Read, the two scrolling
// together by source line (/lib/docsync.mjs).
import { lineHunks, merge3 } from "/lib/docmerge.mjs";
import { lineToY, yToLine } from "/lib/docsync.mjs";
import { postJSON, getJSON } from "./server-link.mjs";
import { flashChanged, renderMarkdown } from "./doc.mjs";

const EASYMDE = "https://esm.sh/easymde@2.21.0?bundle&deps=codemirror@5.65.21,marked@4.3.0";
const EASYMDE_CSS = "https://esm.sh/easymde@2.21.0/dist/easymde.min.css";
const GUIDE = "https://www.markdownguide.org/basic-syntax/";
const SAVE_AFTER = 800;
const SPLIT_MIN_WIDTH = 900; // narrower, Edit opens with one pane
const TINT_FOR = 4000; // as long as the fade in page.css

let EasyMDE = null;
let ed = null; // the EasyMDE instance while editing
let name = null;
let base = ""; // the file's text as the tab last loaded or saved it
let timer = null;
let clash = null; // {markers: [{marker, theirs}], banner}
let queue = Promise.resolve(); // saves and merges, one at a time
let saving = null; // "saving" | "saved" | "unsaved" | "clash" | "error"

export const active = () => Boolean(ed);

// Icons: our own, so no icon font is downloaded. B and I in a serif, so the
// I reads as a letter; line icons for lists, link and side by side (the link
// is Feather's, MIT).
const button = (n, glyph, title, action) => ({ name: n, action, title, className: `doc-tb doc-tb-${n}`, icon: glyph });
const svg = (body) => `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const ICON = {
  bold: '<span class="doc-serif"><b>B</b></span>',
  italic: '<span class="doc-serif"><i>I</i></span>',
  heading: "H",
  quote: '<span class="doc-serif doc-quote">“</span>',
  ul: svg('<circle cx="4.5" cy="6" r="1.2" fill="currentColor"/><circle cx="4.5" cy="12" r="1.2" fill="currentColor"/><circle cx="4.5" cy="18" r="1.2" fill="currentColor"/><path d="M9 6h11M9 12h11M9 18h11"/>'),
  ol: svg('<path d="M9 6h11M9 12h11M9 18h11"/><g stroke="none" fill="currentColor" font-size="7" font-weight="700" font-family="system-ui, sans-serif"><text x="2" y="8.5">1</text><text x="2" y="14.5">2</text><text x="2" y="20.5">3</text></g>'),
  link: svg('<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>'),
  side: svg('<rect x="3" y="4.5" width="18" height="15" rx="2"/><path d="M12 4.5v15"/>'),
  guide: "?",
};

async function load() {
  if (EasyMDE) return;
  if (!document.querySelector(`link[href="${EASYMDE_CSS}"]`)) {
    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = EASYMDE_CSS;
    document.head.appendChild(css);
  }
  EasyMDE = (await import(EASYMDE)).default;
}

/** Edit doc `n` in `box`, the caret on `line`. */
export async function enter(n, box, line = 0) {
  await load();
  const { text } = await getJSON(`/api/docs/${encodeURIComponent(n)}`);
  name = n;
  base = text;
  box.textContent = "";
  const area = document.createElement("textarea");
  box.appendChild(area);
  const E = EasyMDE;
  ed = new E({
    element: area,
    initialValue: text,
    autoDownloadFontAwesome: false,
    spellChecker: false,
    nativeSpellcheck: true,
    autofocus: true,
    forceSync: false,
    minHeight: "60vh",
    unorderedListStyle: "-", // as the docs are written; EasyMDE's default is "*"
    shortcuts: { togglePreview: null, toggleFullScreen: null, toggleSideBySide: null },
    toolbar: [
      button("bold", ICON.bold, "Bold", E.toggleBold),
      button("italic", ICON.italic, "Italic", E.toggleItalic),
      button("heading", ICON.heading, "Heading", E.toggleHeadingSmaller),
      "|",
      button("quote", ICON.quote, "Quote", E.toggleBlockquote),
      button("unordered-list", ICON.ul, "Bulleted list", E.toggleUnorderedList),
      button("ordered-list", ICON.ol, "Numbered list", E.toggleOrderedList),
      "|",
      button("link", ICON.link, "Link", E.drawLink),
      "|",
      { ...button("side-by-side", ICON.side, "Side by side", () => split(!splitPane)), noDisable: true },
      { ...button("guide", ICON.guide, "Markdown guide (new tab)", () => window.open(GUIDE, "_blank", "noopener")), noDisable: true },
    ],
    status: ["lines", "words", "cursor", { className: "doc-save", defaultValue: (el) => { el.setAttribute("data-testid", "doc-save"); } }],
  });
  ed.codemirror.on("change", (_cm, change) => {
    if (splitPane) renderSoon();
    if (change.origin === "setValue" || change.origin === "+merge") return;
    setStatus(clash ? "clash" : "unsaved");
    if (!clash) schedule();
  });
  window.addEventListener("beforeunload", onUnload);
  window.addEventListener("pagehide", onPageHide);
  // The caret where you were reading, that line at the top, tinted a moment.
  const cm = ed.codemirror;
  const at = Math.min(line, cm.lastLine());
  cm.setCursor({ line: at, ch: 0 });
  tint([at], "doc-landed", 1600);
  setStatus("saved");
  // Side by side from the start, unless the window is too narrow for two panes.
  if (window.innerWidth >= SPLIT_MIN_WIDTH) {
    split(true);
    cm.scrollTo(null, Math.max(0, cm.heightAtLine(at, "local") - 24));
  } else {
    requestAnimationFrame(() => {
      const doc = document.getElementById("doc");
      doc.scrollTop += cm.charCoords({ line: at, ch: 0 }, "window").top - 140;
    });
  }
}

/** Leave Edit: save what's pending. False while a clash waits for a choice. */
export async function leave({ force = false } = {}) {
  if (!ed) return true;
  if (clash && !force) {
    clash.banner.classList.remove("doc-nudge");
    void clash.banner.offsetWidth; // restart the nudge
    clash.banner.classList.add("doc-nudge");
    return false;
  }
  clearTimeout(timer);
  if (!clash) await enqueue(save);
  dropClash();
  window.removeEventListener("beforeunload", onUnload);
  window.removeEventListener("pagehide", onPageHide);
  split(false);
  ed.toTextArea();
  ed.cleanup?.();
  ed = null;
  document.querySelector("#doc .doc-edit")?.replaceChildren();
  return true;
}

/** The file changed on disk (the watcher told the tab): merge it in. */
export function onDisk() {
  if (!ed) return;
  const n = name;
  enqueue(async () => {
    const { text } = await getJSON(`/api/docs/${encodeURIComponent(n)}`);
    if (!ed || n !== name) return;
    if (text === base) return; // our own save, echoed back
    if (text === ed.value()) { base = text; return; }
    mergeIn(text);
  });
}

const enqueue = (job) => (queue = queue.then(job).catch((err) => { console.warn("doc", err); setStatus("error", err.message); }));

function schedule() {
  clearTimeout(timer);
  timer = setTimeout(() => enqueue(save), SAVE_AFTER);
}

async function save() {
  if (!ed || clash) return;
  const text = ed.value();
  if (text === base) return setStatus("saved");
  setStatus("saving");
  try {
    await postJSON(`/api/docs/${encodeURIComponent(name)}`, { text, base });
    base = text;
    setStatus(ed && ed.value() === text ? "saved" : "unsaved");
  } catch (err) {
    if (err.code === "doc_changed") return mergeIn(err.body?.error?.text ?? (await getJSON(`/api/docs/${encodeURIComponent(name)}`)).text);
    throw err;
  }
}

// Theirs merges into the editor around the caret; base becomes theirs (what's
// on disk). No clash: save the merged text. A clash: the banner.
function mergeIn(theirs) {
  const cm = ed.codemirror;
  const mine = ed.value();
  dropClash();
  const r = merge3(base, mine, theirs);
  cm.operation(() => {
    for (const h of lineHunks(mine, r.text).reverse()) cm.replaceRange(h.text, cm.posFromIndex(h.from), cm.posFromIndex(h.to), "+merge");
  });
  base = theirs;
  tint(r.fromTheirs, "doc-merged", TINT_FOR);
  if (splitPane) flashNext = r.fromTheirs;
  if (!r.clashes.length) return save();
  // Each clash keeps mine on screen, marked; Load theirs swaps theirs in.
  const markers = r.clashes.map((c) => {
    const from = cm.posFromIndex(r.lines.slice(0, c.at).join("").length);
    const to = cm.posFromIndex(r.lines.slice(0, c.at + c.mine.length).join("").length);
    const marker = c.mine.length
      ? cm.markText(from, to, { className: "doc-clash", inclusiveLeft: true, inclusiveRight: true, clearWhenEmpty: false })
      : cm.setBookmark(from, { insertLeft: true });
    return { marker, theirs: c.theirs.join("") };
  });
  clash = { markers, banner: banner(), r };
  setStatus("clash");
}

function banner() {
  const el = document.createElement("div");
  el.className = "doc-clash-banner";
  el.setAttribute("data-testid", "doc-clash");
  el.innerHTML = `<div><b>The agent changed a line you're editing.</b><span>Yours stays on screen and unsaved until you choose.</span></div>`
    + `<button data-testid="doc-theirs">Load theirs</button><button class="primary" data-testid="doc-mine">Keep mine</button>`;
  el.querySelector("[data-testid=doc-theirs]").addEventListener("click", () => enqueue(loadTheirs));
  el.querySelector("[data-testid=doc-mine]").addEventListener("click", () => enqueue(keepMine));
  const bar = document.querySelector("#doc .doc-edit .editor-toolbar");
  bar.after(el);
  return el;
}

async function loadTheirs() {
  if (!clash) return;
  const cm = ed.codemirror;
  cm.operation(() => {
    for (const { marker, theirs } of [...clash.markers].reverse()) {
      const at = marker.find();
      if (!at) continue;
      const [from, to] = at.from ? [at.from, at.to] : [at, at];
      cm.replaceRange(theirs, from, to, "+merge");
    }
  });
  dropClash();
  await save();
}

async function keepMine() {
  dropClash();
  await save();
}

function dropClash() {
  if (!clash) return;
  for (const { marker } of clash.markers) marker.clear();
  clash.banner.remove();
  clash = null;
}

// --- side by side -------------------------------------------------------------
// The preview pane sits beside CodeMirror inside EasyMDE's container; page.css
// lays the split out as a grid the height of the window (toolbar, two panes,
// status bar), so the page itself doesn't scroll. While split, CodeMirror draws
// every line, so its line heights are measured: estimated heights of long,
// wrapped lines put the panes whole blocks apart.
//
// Scrolling: either pane's top is a fractional source line (the editor's from
// CodeMirror's line geometry, the preview's from its blocks' data-line), and
// the other pane goes to the same line. Whoever scrolls leads: wheel, scrollbar,
// keys, find, typing. Our own scrolling of the other pane is told apart by
// where it lands (the position we set), not by timing, so trackpad momentum
// can't make the panes fight.
let splitPane = null;
let renderTimer = null;
let flashNext = null; // lines merged in, to light up in the preview once it has rendered them
let echo = { cm: null, pv: null }; // where we last scrolled each pane to
let frame = 0;

function split(on) {
  if (!ed) return;
  const cm = ed.codemirror;
  const box = document.querySelector("#doc .doc-edit");
  const btn = document.querySelector("#doc .doc-tb-side-by-side");
  if (on && !splitPane) {
    splitPane = document.createElement("div");
    splitPane.className = "doc-preview markdown";
    splitPane.setAttribute("data-testid", "doc-preview");
    cm.getWrapperElement().after(splitPane);
    box.classList.add("doc-split");
    btn?.classList.add("active");
    document.getElementById("doc").scrollTop = 0;
    cm.setOption("viewportMargin", Infinity);
    cm.on("scroll", onEditorScroll);
    splitPane.addEventListener("scroll", onPreviewScroll, { passive: true });
    cm.refresh();
    cm.scrollIntoView(null, 120);
    render().then(fromEditor);
  } else if (!on && splitPane) {
    cm.off("scroll", onEditorScroll);
    splitPane.remove();
    splitPane = null;
    clearTimeout(renderTimer);
    box.classList.remove("doc-split");
    btn?.classList.remove("active");
    cm.setOption("viewportMargin", 10);
    cm.refresh();
    cm.scrollIntoView(null, 120);
  }
}

// The preview, rendered like Read; after typing, a moment later.
async function render() {
  if (!splitPane) return;
  const pane = splitPane, top = pane.scrollTop;
  await renderMarkdown(pane, ed.value(), name);
  pane.scrollTop = top;
}
function renderSoon() {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(() => render().then(() => {
    if (flashNext && splitPane) flashChanged(splitPane, flashNext);
    flashNext = null;
    fromEditor();
  }), 150);
}

// The preview's blocks, by source line and top, ending at the doc's end.
function blocks() {
  const pane = splitPane, top = pane.getBoundingClientRect().top - pane.scrollTop;
  const bs = [...pane.querySelectorAll(":scope > [data-line]")].map((b) => ({ line: Number(b.dataset.line), y: b.getBoundingClientRect().top - top }));
  bs.push({ line: ed.codemirror.lineCount(), y: pane.scrollHeight });
  return bs;
}

// The editor's top as a fractional line, and the scroll position for one.
function editorLine(cm) {
  const top = cm.getScrollInfo().top;
  const l = cm.lineAtHeight(top, "local");
  const y0 = cm.heightAtLine(l, "local"), y1 = l + 1 < cm.lineCount() ? cm.heightAtLine(l + 1, "local") : cm.getScrollInfo().height;
  return l + (y1 > y0 ? Math.min(1, Math.max(0, (top - y0) / (y1 - y0))) : 0);
}
function editorY(cm, line) {
  const l = Math.min(Math.floor(line), cm.lineCount() - 1), f = line - l;
  const y0 = cm.heightAtLine(l, "local"), y1 = l + 1 < cm.lineCount() ? cm.heightAtLine(l + 1, "local") : cm.getScrollInfo().height;
  return y0 + Math.min(1, Math.max(0, f)) * (y1 - y0);
}

// A pane's scroll that lands where we put it is our own; anything else leads.
const ours = (who, at) => {
  const was = echo[who];
  echo[who] = null;
  return was !== null && Math.abs(at - was) <= 1;
};
function onEditorScroll(cm) {
  if (ours("cm", cm.getScrollInfo().top)) return;
  follow(fromEditor);
}
function onPreviewScroll() {
  if (ours("pv", splitPane.scrollTop)) return;
  follow(fromPreview);
}
function follow(fn) {
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(fn);
}
function fromEditor() {
  if (!splitPane || !ed) return;
  const cm = ed.codemirror, pane = splitPane, info = cm.getScrollInfo();
  const y = info.top + info.clientHeight >= info.height - 1 ? pane.scrollHeight : lineToY(blocks(), editorLine(cm));
  const before = pane.scrollTop;
  pane.scrollTop = y;
  if (Math.abs(pane.scrollTop - before) > 0.5) echo.pv = pane.scrollTop; // no move, no scroll event to expect
}
function fromPreview() {
  if (!splitPane || !ed) return;
  const cm = ed.codemirror, pane = splitPane;
  const end = pane.scrollTop + pane.clientHeight >= pane.scrollHeight - 1;
  const info = cm.getScrollInfo(), before = info.top;
  const to = Math.min(Math.max(0, end ? info.height : editorY(cm, yToLine(blocks(), pane.scrollTop))), info.height - info.clientHeight);
  // CodeMirror may report the scroll while scrollTo runs, or after: expect it either way.
  echo.cm = Math.abs(to - before) > 0.5 ? to : null;
  cm.scrollTo(null, to);
  const now = cm.getScrollInfo().top;
  if (Math.abs(now - before) > 0.5) echo.cm = now;
}

// Tint editor lines for a moment (lines merged in, the line Edit landed on).
function tint(lines, cls, ms) {
  if (!ed || !lines.length) return;
  const cm = ed.codemirror;
  const handles = lines.filter((l) => l <= cm.lastLine()).map((l) => cm.addLineClass(l, "background", cls));
  setTimeout(() => handles.forEach((h) => cm.removeLineClass(h, "background", cls)), ms);
}

function setStatus(s, detail) {
  saving = s;
  const el = document.querySelector("#doc .editor-statusbar .doc-save");
  if (!el) return;
  const text = { saving: "saving…", saved: "saved ✓", unsaved: "", clash: "● not saved: waiting for you", error: `● not saved: ${detail ?? "error"}` }[s];
  el.textContent = text;
  el.className = `doc-save doc-save-${s}`;
}

// Closing the tab: a clash asks first (the browser's "Leave site?"); unsaved
// typing is sent as the page goes.
function onUnload(ev) {
  if (clash) {
    ev.preventDefault();
    ev.returnValue = "";
  }
}

function onPageHide() {
  if (!ed || clash || ed.value() === base) return;
  fetch(`/api/docs/${encodeURIComponent(name)}`, {
    method: "POST", keepalive: true, headers: { "content-type": "application/json" }, body: JSON.stringify({ text: ed.value(), base }),
  }).catch(() => {});
}

// For the smoke test.
export const state = () => ({ name, base, saving, clash: Boolean(clash), value: ed?.value() ?? null });
