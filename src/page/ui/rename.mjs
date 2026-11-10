// Rename, move or delete the page on screen (☰ → Rename or move this page…).
// Moving is renaming into another folder; delete asks first.
import { validPageName, normalizePageName, joinName, folderOf, baseName, NAME_RULE } from "/lib/names.mjs";
import { React, h } from "../deps.mjs";
import { getJSON, postJSON, request } from "../server-link.mjs";
import { flushSync } from "../sync.mjs";
import { closeOnBackdrop, toast } from "./common.mjs";
import { FolderField } from "./folder-field.mjs";

const plural = (n, one) => `${n} ${one}${n === 1 ? "" : "s"}`;

export function RenameDialog({ current, names, onClose }) {
  const [name, setName] = React.useState(current ? baseName(current) : "");
  const [folder, setFolder] = React.useState(current ? folderOf(current) : "");
  const [error, setError] = React.useState(null);
  const [confirming, setConfirming] = React.useState(null); // {links} while asking to delete
  const submit = async () => {
    const to = normalizePageName(joinName(folder, name.trim()));
    if (!current || to === current) return onClose();
    if (!name.trim()) return setError("Name the page.");
    if (!validPageName(to)) return setError(NAME_RULE);
    try {
      await flushSync();
      const r = await postJSON(`/api/pages/${encodeURIComponent(current)}/rename`, { to });
      onClose();
      const verb = folderOf(to) === folderOf(current) ? "Renamed" : "Moved";
      const stale = r.staleLinks?.length ?? 0;
      toast(stale ? `${verb} to ${to}. ${plural(stale, "link")} still point at ${current}: ask your agent to update them.` : `${verb} to ${to}.`, { duration: stale ? 8000 : 3000 });
    } catch (err) {
      setError(err.code === "page_exists" ? (/capitals/.test(err.message) ? err.message : `There's already a page called ${to}.`) : err.message);
    }
  };
  const askDelete = async () => {
    if (names.filter((n) => n !== current).length === 0) return setError("This is the only page; make another before deleting it.");
    // How many links on other pages point here, so the person knows what breaks.
    const links = await getJSON(`/api/pages/${encodeURIComponent(current)}/links`).then((r) => r.links.length).catch(() => null);
    setConfirming({ links });
  };
  const doDelete = async () => {
    try {
      await flushSync();
      await request(`/api/pages/${encodeURIComponent(current)}`, { method: "DELETE" });
      onClose(); // the page-deleted event takes this tab to another page
    } catch (err) {
      setConfirming(null);
      setError(err.message);
    }
  };
  const onKey = (ev) => { if (ev.key === "Escape") { ev.stopPropagation(); confirming ? setConfirming(null) : onClose(); } };
  return h("div", { className: "xl-backdrop", onMouseDown: closeOnBackdrop(onClose), onKeyDown: onKey },
    h("div", { className: "xl-modal", role: "dialog", "aria-label": "Rename or move", "data-testid": "rename-dialog" },
      h("header", null, h("h2", null, confirming ? `Delete ${current}?` : "Rename or move")),
      confirming
        ? h("div", { className: "xl-fields", "data-testid": "delete-confirm" },
          h("p", null, "The page, its change log and bands move to ", h("code", null, ".obeya/.trash/"), " in the pages folder; nothing is erased."),
          confirming.links ? h("p", null, `${plural(confirming.links, "link")} on other pages point at it and will stop working.`) : null)
        : h("div", { className: "xl-fields" },
          h("label", { className: "xl-field" }, h("span", null, "Name"),
            h("input", { autoFocus: true, value: name, "aria-label": "Name", "data-testid": "rename-name", onFocus: (ev) => ev.target.select(),
              onChange: (ev) => { setName(ev.target.value); setError(null); },
              onKeyDown: (ev) => { ev.stopPropagation(); if (ev.key === "Enter") submit(); if (ev.key === "Escape") onClose(); } })),
          h(FolderField, { names, value: folder, onChange: (f) => { setFolder(f); setError(null); }, onEnter: submit, testid: "rename-folder" })),
      error ? h("div", { className: "xl-hint", style: { padding: "0 20px 8px" }, "data-testid": "rename-error" }, error) : null,
      confirming
        ? h("footer", null, h("span"),
          h("span", null, h("button", { onClick: () => setConfirming(null), autoFocus: true }, "Keep it"), " ",
            h("button", { className: "danger", onClick: doDelete, "data-testid": "delete-confirm-button" }, "Delete page")))
        : h("footer", null,
          h("button", { className: "xl-delete", onClick: askDelete, "data-testid": "delete-page" }, "Delete page…"),
          h("span", null, h("button", { onClick: onClose }, "Cancel"), " ",
            h("button", { className: "primary", onClick: submit, "data-testid": "rename-submit" },
              folderOf(normalizePageName(joinName(folder, name.trim()))) !== folderOf(current ?? "") ? "Move" : "Rename")))));
}
