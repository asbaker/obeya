// The page picker: search, recent pages, every page A–Z, and files that can't
// be opened. Cmd+O / Ctrl+O, the pill, or ☰ → Open page….
import { validPageName, normalizePageName, joinName, folderOf, baseName, foldersOf, NAME_RULE } from "/lib/names.mjs";
import { React, h } from "../deps.mjs";
import { KEY_PAGES } from "../state.mjs";
import { getJSON } from "../server-link.mjs";
import { createPage, openPage, recentPages } from "../pages.mjs";
import { closeOnBackdrop, toast } from "./common.mjs";

function edited(iso) {
  if (!iso) return "not saved yet";
  const min = (Date.now() - Date.parse(iso)) / 60000;
  if (min < 1) return "edited just now";
  if (min < 60) return `edited ${Math.round(min)} min ago`;
  if (min < 24 * 60) return `edited ${Math.round(min / 60)} h ago`;
  const days = Math.round(min / 1440);
  if (days < 7) return `edited ${days} day${days === 1 ? "" : "s"} ago`;
  return `edited ${new Date(iso).toLocaleDateString()}`;
}

export function PagePicker({ pages, skipped, current, waiting = new Set(), onClose, onNew }) {
  const [query, setQuery] = React.useState("");
  const [hl, setHl] = React.useState(0);
  const [fresh, setFresh] = React.useState(null);
  // Details (frame counts, times) when it opens, and again when the list changes.
  React.useEffect(() => { getJSON("/api/pages").then(setFresh).catch(() => {}); }, [pages, skipped]);
  React.useEffect(() => { document.querySelector(".xl-row.hl")?.scrollIntoView({ block: "nearest" }); });
  const list = fresh?.pages ?? pages, skip = fresh?.skipped ?? skipped;
  const names = list.map((p) => p.name);
  const byName = new Map(list.map((p) => [p.name, p]));
  const here = folderOf(current ?? "");
  const typed = normalizePageName(query.trim()), q = typed.toLowerCase();

  // Rows: with a search, matches across every folder (each shows its folder);
  // without, top-level pages, then one heading per folder with its pages.
  let blocks;
  if (q) {
    const starts = (n) => (baseName(n).toLowerCase().startsWith(q) || n.toLowerCase().startsWith(q) ? 0 : 1);
    blocks = names.filter((n) => n.toLowerCase().includes(q)).sort((a, b) => starts(a) - starts(b) || a.localeCompare(b)).map((n) => ({ name: n, showFolder: true }));
  } else {
    const inFolder = (f) => names.filter((n) => folderOf(n) === f).sort((a, b) => baseName(a).localeCompare(baseName(b)));
    blocks = inFolder("").map((n) => ({ name: n }));
    for (const f of foldersOf(names)) {
      const own = inFolder(f);
      if (!own.length) continue; // a folder that only holds folders: their headings show the path
      blocks.push({ heading: f }, ...own.map((n) => ({ name: n, indent: true })));
    }
  }
  // "+ New page <typed>": in the folder on screen, unless the typed name has its own.
  const newName = typed && (typed.includes("/") ? typed : joinName(here, typed));
  const canCreate = newName && !names.includes(newName) && validPageName(newName);
  if (canCreate) blocks.push({ name: newName, create: true });
  const items = blocks.filter((b) => !b.heading);
  const at = Math.min(hl, Math.max(0, items.length - 1));
  const recent = q ? [] : recentPages().filter((n) => n !== current && names.includes(n)).slice(0, 5);
  const go = (name, create = false) => {
    onClose();
    if (create) createPage(name).catch((err) => toast(`Couldn't make ${name}: ${err.message}`));
    else if (name !== current) openPage(name).catch((err) => toast(`Couldn't open ${name}: ${err.message}`));
  };
  const onKey = (ev) => {
    ev.stopPropagation();
    if (ev.key === "Escape") onClose();
    else if (ev.key === "ArrowDown") setHl(Math.min(items.length - 1, at + 1));
    else if (ev.key === "ArrowUp") setHl(Math.max(0, at - 1));
    else if (ev.key === "Enter" && items[at]) go(items[at].name, items[at].create);
    else return;
    ev.preventDefault();
  };
  const meta = (p) => `${p.frames} frame${p.frames === 1 ? "" : "s"} · ${edited(p.modified)}`;
  let i = -1;
  const row = (b) => {
    if (b.heading) {
      return h("div", { key: "#" + b.heading, className: "xl-section xl-folder", "data-testid": "picker-folder" },
        h("span", null, b.heading.split("/").join(" / ")),
        h("button", { className: "xl-link xl-here", onClick: () => onNew(b.heading), "data-testid": "picker-new-here", title: `New page in ${b.heading}` }, "+ page here"));
    }
    const idx = ++i, p = byName.get(b.name);
    return h("div", {
      key: (b.create ? "+" : "") + b.name, className: "xl-row" + (idx === at ? " hl" : "") + (b.indent ? " indent" : ""), "data-testid": b.create ? "picker-create" : "picker-row",
      "data-name": b.name, onMouseMove: () => idx !== at && setHl(idx), onClick: () => go(b.name, b.create),
    },
      b.create
        ? h("span", null, "+ New page ", h("b", null, baseName(b.name)))
        : h("span", null, h("span", { className: "xl-base" }, baseName(b.name)), b.name === current ? h("span", { className: "here" }, "open now") : null,
          waiting.has(b.name) ? h("span", { className: "xl-waiting", "data-testid": "picker-waiting", title: "Your agent is waiting for you on this page" }, "● waiting for you") : null,
          b.showFolder && folderOf(b.name) ? h("span", { className: "xl-in" }, folderOf(b.name).split("/").join(" / ")) : null),
      h("span", { className: "meta" }, b.create ? (folderOf(b.name) ? `saved now, in ${folderOf(b.name)}` : "saved now, empty") : meta(p)));
  };
  return h("div", { className: "xl-backdrop", onMouseDown: closeOnBackdrop(onClose) },
    h("div", { className: "xl-modal", role: "dialog", "aria-label": "Pages", "data-testid": "page-picker" },
      h("header", null, h("h2", null, "Pages"),
        h("span", null,
          h("span", { className: "xl-muted" }, `${list.length} page${list.length === 1 ? "" : "s"}`), " ",
          h("button", { className: "xl-new", onClick: () => onNew(here), "data-testid": "picker-new", title: "New page" }, "+ New"))),
      h("input", { autoFocus: true, value: query, placeholder: "Search pages, or type a new page name…", "aria-label": "Search pages", "data-testid": "picker-search",
        onChange: (ev) => { setQuery(ev.target.value); setHl(0); }, onKeyDown: onKey }),
      h("div", { className: "xl-list" },
        recent.length ? h(React.Fragment, null,
          h("div", { className: "xl-section" }, "Recent"),
          h("div", { className: "xl-recent" }, recent.map((n) => h("button", { key: n, onClick: () => go(n) }, n)))) : null,
        h("div", { className: "xl-section" }, q ? "Matches" : "All pages · A–Z"),
        blocks.map(row),
        typed && !items.length ? h("div", { className: "xl-hint" }, `No page matches. ${NAME_RULE}`) : null,
        skip.length && !q ? h(React.Fragment, null,
          h("div", { className: "xl-section" }, "Can't open (rename the file to use it)"),
          skip.map((f) => h("div", { key: f.file, className: "xl-row skipped", title: f.reason, "data-testid": "picker-skipped" },
            h("span", null, f.file), h("span", { className: "meta" }, "name not supported")))) : null),
      h("footer", null, h("span", null, "↑ ↓ to move · Enter to open · Esc to close"), h("span", null, `${KEY_PAGES} opens this`))));
}
