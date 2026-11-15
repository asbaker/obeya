// Markdown docs, in the same tab as the drawings: ?page=<name>.md. A doc
// covers the canvas (the drawing underneath stays loaded); Back, a link or the
// picker leaves it. It opens to read (rendered with marked, pinned on esm.sh
// and loaded only when a doc opens); Edit, top right, or Cmd/Ctrl+E switches to
// EasyMDE (./doc-edit.mjs, loaded on the first Edit). Raw HTML in a doc is
// shown as text and only web, mail and obeya links are followed: a doc is
// read, never run.
import { anchors, isDocName, resolveDocHref } from "/lib/docs.mjs";
import { merge3 } from "/lib/docmerge.mjs";
import { MAC, RENDERER, S } from "./state.mjs";
import { getJSON } from "./server-link.mjs";
import { setTitle } from "./ui/wait-banner.mjs";

const MARKED = "https://esm.sh/marked@14.1.4";
let marked = null;
let shown = null; // the doc on screen, or null
let edit = null; // ./doc-edit.mjs once loaded
let shownText = null; // the text on screen in Read, to see what a change on disk changed

export const docShown = () => shown;
export { isDocName };
const editing = () => Boolean(edit?.active());

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

function view() {
  let el = document.getElementById("doc");
  if (!el) {
    el = document.createElement("div");
    el.id = "doc";
    el.setAttribute("data-testid", "doc");
    // No chrome of its own but the Read / Edit button: the page pill (top
    // left, above this) stays as it is on a drawing, and opens the picker; Back returns.
    el.innerHTML = `<div class="doc-top"></div><button class="doc-mode" data-testid="doc-mode" title="Edit (${MAC ? "Cmd" : "Ctrl"}+E)">Edit</button>`
      + `<article class="doc-body markdown"></article><div class="doc-edit" data-testid="doc-edit"></div>`;
    el.addEventListener("click", onClick);
    el.querySelector(".doc-mode").addEventListener("click", () => toggleEdit());
    // Keys while reading scroll the doc; the editor's own shortcuts (tool
    // letters, space, arrows) stay out of it. Cmd/Ctrl shortcuts still reach obeya.
    el.tabIndex = -1;
    el.addEventListener("keydown", (ev) => { if (!ev.metaKey && !ev.ctrlKey) ev.stopPropagation(); });
    document.body.appendChild(el);
  }
  return el;
}

// Cmd/Ctrl+E switches Read and Edit while a doc is on screen.
document.addEventListener("keydown", (ev) => {
  if (!shown || ev.key.toLowerCase() !== "e" || ev.shiftKey || ev.altKey || !(MAC ? ev.metaKey : ev.ctrlKey)) return;
  ev.preventDefault();
  ev.stopPropagation();
  toggleEdit();
}, true);

async function loadMarked() {
  if (!marked) {
    const m = await import(MARKED);
    marked = new m.Marked({ gfm: true });
    marked.use({ renderer: { html: ({ text }) => esc(text) } });
  }
  return marked;
}

/**
 * Markdown into `el`, as Read shows it (and Edit's side-by-side preview):
 * heading anchors, links resolved from doc `name`, only web images. Each
 * top-level block carries data-line and data-end, the source lines it spans (so
 * Edit can start where you were reading, and side by side can line up); list
 * items and table rows carry theirs too, so a change can light up just them.
 */
export async function renderMarkdown(el, text, name) {
  const md = await loadMarked();
  const tokens = md.lexer(text);
  el.textContent = "";
  const lines = (s) => (s.match(/\n/g) ?? []).length;
  const span = (e, from, n) => { e?.setAttribute("data-line", String(from)); e?.setAttribute("data-end", String(from + Math.max(1, n))); };
  let line = 0;
  for (const tok of tokens) {
    const start = line;
    line += lines(tok.raw);
    if (tok.type === "space" || tok.type === "def") continue;
    const one = [tok];
    one.links = tokens.links;
    const t = document.createElement("template");
    t.innerHTML = md.parser(one);
    const block = t.content.firstElementChild;
    span(block, start, lines(tok.raw.replace(/\n+$/, "")) + 1);
    if (tok.type === "list" && block) {
      let at = start;
      tok.items.forEach((item, i) => { span(block.children[i], at, lines(item.raw.replace(/\n+$/, "")) + 1); at += lines(item.raw); });
    }
    if (tok.type === "table" && block) {
      [...block.querySelectorAll(":scope > thead > tr, :scope > tbody > tr")].forEach((tr, i) => span(tr, start + (i === 0 ? 0 : i + 1), 1));
    }
    el.append(t.content);
  }
  const hs = [...el.querySelectorAll("h1, h2, h3, h4, h5, h6")];
  anchors(hs.map((x) => x.textContent)).forEach((id, i) => { hs[i].id = id; });
  for (const a of el.querySelectorAll("a[href]")) {
    const to = resolveDocHref(a.getAttribute("href"), name);
    if (to.blocked) a.removeAttribute("href");
    else if (to.external) { a.target = "_blank"; a.rel = "noopener noreferrer"; }
  }
  for (const img of el.querySelectorAll("img[src]")) {
    if (!/^https?:/i.test(img.getAttribute("src"))) img.removeAttribute("src");
  }
}

async function render(name) {
  const { text } = await getJSON(`/api/docs/${encodeURIComponent(name)}`);
  await renderMarkdown(view().querySelector(".doc-body"), text, name);
  const was = shownText;
  shownText = text;
  return { was, text };
}

/**
 * Tint what source `lines` render to, then let it fade (page.css): for each
 * line, the smallest element that spans it (a bullet, a table row, else its
 * block). For changes on disk: Read, and the side-by-side preview.
 */
export function flashChanged(el, lines) {
  const spans = [...el.querySelectorAll("[data-line][data-end]")].map((e) => ({ e, from: Number(e.dataset.line), to: Number(e.dataset.end) }));
  const hit = new Set();
  for (const l of lines) {
    let best = null;
    for (const s of spans) if (s.from <= l && l < s.to && (!best || s.to - s.from <= best.to - best.from)) best = s;
    if (best) hit.add(best.e);
  }
  for (const e of hit) {
    e.classList.remove("doc-changed");
    void e.offsetWidth; // restart the fade
    e.classList.add("doc-changed");
    setTimeout(() => e.classList.remove("doc-changed"), 4000);
  }
}

function scrollToHeading(heading) {
  const body = document.querySelector("#doc .doc-body");
  if (!body) return;
  const target = heading ? document.getElementById(heading) : null;
  if (target) target.scrollIntoView({ block: "start" });
  else body.parentElement.scrollTop = 0;
}

/** Show a doc over the canvas; `how` as for openPage. `edit: true` opens it in Edit (a new doc). */
export async function showDoc(name, heading, { history: how = "push", edit: startEditing = false } = {}) {
  if (editing()) await edit.leave({ force: true });
  await render(name);
  shown = name;
  document.body.classList.add("doc-open");
  setMode(false);
  const u = new URL(location.href);
  u.searchParams.set("page", name);
  u.searchParams.delete("element");
  u.hash = heading ? `#${heading}` : "";
  if (how === "push" && !RENDERER && u.href !== location.href) history.pushState(null, "", u.pathname + u.search + u.hash);
  else history.replaceState(null, "", u.pathname + u.search + u.hash);
  document.title = `obeya - ${name}`;
  S.setUi((s) => ({ ...s, page: name })); // the pill names the doc
  document.getElementById("doc").focus({ preventScroll: true });
  requestAnimationFrame(() => scrollToHeading(heading));
  if (startEditing) await toggleEdit();
}

export async function hideDoc() {
  if (!shown) return;
  // Leaving the doc (a link, the picker, Back) during a clash leaves theirs on disk.
  if (editing()) await edit.leave({ force: true });
  setMode(false);
  shown = null;
  document.body.classList.remove("doc-open");
  setTitle();
  if (S.currentPage) S.setUi((s) => ({ ...s, page: S.currentPage }));
}

/** The doc on screen changed on disk: show the new text, keeping the scroll; in Edit, merge it. */
export async function reloadDoc(name) {
  if (shown !== name) return;
  if (editing()) return edit.onDisk();
  const box = document.getElementById("doc");
  const top = box?.scrollTop ?? 0;
  const r = await render(name).catch(() => null);
  if (box) box.scrollTop = top;
  // What changed lights up, then fades: lines that are new or different now.
  if (r?.was != null && r.was !== r.text) flashChanged(view().querySelector(".doc-body"), merge3(r.was, r.was, r.text).fromTheirs);
}

function setMode(on) {
  const el = view();
  document.body.classList.toggle("doc-editing", on);
  const b = el.querySelector(".doc-mode");
  b.textContent = on ? "Read" : "Edit";
  b.title = `${on ? "Read" : "Edit"} (${MAC ? "Cmd" : "Ctrl"}+E)`;
}

// The line of the block at the top of the view: where Edit puts the caret.
function readingLine() {
  const top = 72; // under the pill's strip
  for (const b of document.querySelectorAll("#doc .doc-body > [data-line]")) {
    if (b.getBoundingClientRect().bottom > top) return Number(b.dataset.line);
  }
  return 0;
}

async function toggleEdit() {
  if (!shown) return;
  if (editing()) {
    if (!(await edit.leave())) return; // a clash waits for Load theirs or Keep mine
    setMode(false);
    await render(shown).catch(() => {});
    return;
  }
  const line = readingLine();
  try {
    edit ??= await import("./doc-edit.mjs");
  } catch (err) {
    problem(`Couldn't load the editor: ${err.message}. Reload the tab and try again.`);
    console.error(err);
    return;
  }
  setMode(true);
  try {
    await edit.enter(shown, view().querySelector(".doc-edit"), line);
  } catch (err) {
    setMode(false);
    problem(`Couldn't start the editor: ${err.message}. Reload the tab and try again.`);
    console.error(err);
  }
}

// A short message under the Read / Edit button (the canvas's toasts are hidden under a doc).
function problem(message) {
  const el = view();
  let box = el.querySelector(".doc-problem");
  if (!box) {
    box = document.createElement("div");
    box.className = "doc-problem";
    box.setAttribute("data-testid", "doc-problem");
    el.appendChild(box);
  }
  box.textContent = message;
  clearTimeout(problem.timer);
  problem.timer = setTimeout(() => box.remove(), 8000);
}

// Links inside a doc: headings in place, other docs and drawings through openPage.
function onClick(ev) {
  const a = ev.target.closest?.("a[href]");
  if (!a || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.button !== 0) return;
  if (a.closest(".editor-toolbar")) return; // EasyMDE's own buttons
  const to = resolveDocHref(a.getAttribute("href"), shown);
  if (to.external || to.blocked) return;
  ev.preventDefault();
  import("./pages.mjs").then(({ openPage }) => openPage(to.page, to.element, { heading: to.heading }));
}
