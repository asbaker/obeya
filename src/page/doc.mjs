// Markdown docs, read-only, in the same tab as the drawings: ?page=<name>.md.
// A doc covers the canvas (the drawing underneath stays loaded); Back, a link
// or the picker leaves it. Rendered with marked, pinned on esm.sh and loaded
// only when a doc opens. Raw HTML in a doc is shown as text and only web,
// mail and obeya links are followed: a doc is read, never run.
import { anchors, isDocName, resolveDocHref } from "/lib/docs.mjs";
import { RENDERER, S } from "./state.mjs";
import { getJSON } from "./server-link.mjs";
import { setTitle } from "./ui/wait-banner.mjs";

const MARKED = "https://esm.sh/marked@14.1.4";
let marked = null;
let shown = null; // the doc on screen, or null

export const docShown = () => shown;
export { isDocName };

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

function view() {
  let el = document.getElementById("doc");
  if (!el) {
    el = document.createElement("div");
    el.id = "doc";
    el.setAttribute("data-testid", "doc");
    // No chrome of its own: the page pill (top left, above this) stays as it is
    // on a drawing, and opens the picker; Back returns.
    el.innerHTML = `<div class="doc-top"></div><article class="doc-body markdown"></article>`;
    el.addEventListener("click", onClick);
    // Keys while reading scroll the doc; the editor's own shortcuts (tool
    // letters, space, arrows) stay out of it. Cmd/Ctrl shortcuts still reach obeya.
    el.tabIndex = -1;
    el.addEventListener("keydown", (ev) => { if (!ev.metaKey && !ev.ctrlKey) ev.stopPropagation(); });
    document.body.appendChild(el);
  }
  return el;
}

async function render(name) {
  if (!marked) {
    const m = await import(MARKED);
    marked = new m.Marked({ gfm: true });
    marked.use({ renderer: { html: ({ text }) => esc(text) } });
  }
  const { text } = await getJSON(`/api/docs/${encodeURIComponent(name)}`);
  const el = view();
  const body = el.querySelector(".doc-body");
  body.innerHTML = marked.parse(text);
  const hs = [...body.querySelectorAll("h1, h2, h3, h4, h5, h6")];
  anchors(hs.map((x) => x.textContent)).forEach((id, i) => { hs[i].id = id; });
  for (const a of body.querySelectorAll("a[href]")) {
    const to = resolveDocHref(a.getAttribute("href"), name);
    if (to.blocked) a.removeAttribute("href");
    else if (to.external) { a.target = "_blank"; a.rel = "noopener noreferrer"; }
  }
  for (const img of body.querySelectorAll("img[src]")) {
    if (!/^https?:/i.test(img.getAttribute("src"))) img.removeAttribute("src");
  }
}

function scrollToHeading(heading) {
  const body = document.querySelector("#doc .doc-body");
  if (!body) return;
  const target = heading ? document.getElementById(heading) : null;
  if (target) target.scrollIntoView({ block: "start" });
  else body.parentElement.scrollTop = 0;
}

/** Show a doc over the canvas; `how` as for openPage. */
export async function showDoc(name, heading, { history: how = "push" } = {}) {
  await render(name);
  shown = name;
  document.body.classList.add("doc-open");
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
}

export function hideDoc() {
  if (!shown) return;
  shown = null;
  document.body.classList.remove("doc-open");
  setTitle();
  if (S.currentPage) S.setUi((s) => ({ ...s, page: S.currentPage }));
}

/** The doc on screen changed on disk: show the new text, keeping the scroll. */
export async function reloadDoc(name) {
  if (shown !== name) return;
  const box = document.getElementById("doc");
  const top = box?.scrollTop ?? 0;
  await render(name).catch(() => {});
  if (box) box.scrollTop = top;
}

// Links inside a doc: headings in place, other docs and drawings through openPage.
function onClick(ev) {
  const a = ev.target.closest?.("a[href]");
  if (!a || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.button !== 0) return;
  const to = resolveDocHref(a.getAttribute("href"), shown);
  if (to.external || to.blocked) return;
  ev.preventDefault();
  import("./pages.mjs").then(({ openPage }) => openPage(to.page, to.element, { heading: to.heading }));
}
