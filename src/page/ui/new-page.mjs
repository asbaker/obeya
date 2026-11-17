import { validPageName, normalizePageName, joinName, NAME_RULE } from "/lib/names.mjs";
import { React, h } from "../deps.mjs";
import { makePage, openPage } from "../pages.mjs";

const KIND_KEY = "obeya.newKind";
import { closeOnBackdrop, toast } from "./common.mjs";
import { FolderField } from "./folder-field.mjs";

export function NewPageDialog({ names, folder: startIn = "", onClose }) {
  const [name, setName] = React.useState("");
  const [folder, setFolder] = React.useState(startIn);
  const [error, setError] = React.useState(null);
  const [kind, setKindNow] = React.useState(() => (localStorage.getItem(KIND_KEY) === "doc" ? "doc" : "drawing"));
  const setKind = (k) => { setKindNow(k); localStorage.setItem(KIND_KEY, k); setError(null); };
  const submit = async () => {
    let base = name.trim();
    if (!base) return setError(`Name the ${kind === "doc" ? "doc" : "page"}.`);
    if (kind === "doc" && !base.toLowerCase().endsWith(".md")) base += ".md";
    const to = normalizePageName(joinName(folder, base));
    if (!validPageName(kind === "doc" ? to.slice(0, -3) : to)) return setError(NAME_RULE);
    if (names.includes(to)) return setError(`There's already a page called ${to}.`);
    try {
      await makePage(to);
    } catch (err) {
      return setError(err.code === "page_exists" ? err.message.replace(/^(?:page|doc) "(.*)" already exists$/, "There's already a page called $1.") : err.message);
    }
    onClose();
    openPage(to, null, { edit: kind === "doc" }).catch((err) => toast(`Made ${to}, but couldn't open it: ${err.message}`));
  };
  // Esc closes from anywhere in the dialog (focus may be on a button).
  return h("div", { className: "xl-backdrop", onMouseDown: closeOnBackdrop(onClose), onKeyDown: (ev) => { if (ev.key === "Escape") { ev.stopPropagation(); onClose(); } } },
    h("div", { className: "xl-modal", role: "dialog", "aria-label": "New page", "data-testid": "new-page-dialog" },
      h("header", null, h("h2", null, "New page")),
      h("div", { className: "xl-fields" },
        h("div", { className: "xl-field" }, h("span", null, "Kind"),
          h("div", { className: "xl-seg", role: "radiogroup", "aria-label": "Kind", style: { alignSelf: "flex-start" } },
            ["drawing", "doc"].map((k) => h("button", { key: k, type: "button", role: "radio", "aria-checked": kind === k, className: kind === k ? "on" : "",
              onClick: () => setKind(k), "data-testid": `new-page-kind-${k}` }, k === "doc" ? "Doc (markdown)" : "Drawing")))),
        h("label", { className: "xl-field" }, h("span", null, kind === "doc" ? "Name (.md is added)" : "Name"),
          h("input", { autoFocus: true, value: name, placeholder: "e.g. overview", "aria-label": "Page name", "data-testid": "new-page-name",
            onChange: (ev) => { setName(ev.target.value); setError(null); },
            onKeyDown: (ev) => { ev.stopPropagation(); if (ev.key === "Enter") submit(); if (ev.key === "Escape") onClose(); } })),
        h(FolderField, { names, value: folder, onChange: (f) => { setFolder(f); setError(null); }, onEnter: submit, testid: "new-page-folder" })),
      error ? h("div", { className: "xl-hint", style: { padding: "0 20px 8px" }, "data-testid": "new-page-error" }, error) : null,
      h("footer", null, h("span", null, "Saved as a file in the pages folder right away."),
        h("span", null, h("button", { onClick: onClose }, "Cancel"), " ", h("button", { className: "primary", onClick: submit, "data-testid": "new-page-create" }, "Create")))));
}
