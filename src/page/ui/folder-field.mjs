// "In folder": a list of the folders that have pages (and Top level), so nobody
// has to remember folder names. "+ New folder…" swaps the list for a name
// field; Esc there goes back to the list.
import { foldersOf } from "/lib/names.mjs";
import { React, h } from "../deps.mjs";

const NEW = "\u0000new"; // the "+ New folder…" option; can't be a folder name

export function FolderField({ names, value, onChange, onEnter, testid = "folder" }) {
  const folders = foldersOf(names);
  // A folder chosen here but with no pages yet (typed as new) stays in the list.
  const known = value && !folders.includes(value) ? [...folders, value].sort((a, b) => a.localeCompare(b)) : folders;
  const [typing, setTyping] = React.useState(false);
  const [draft, setDraft] = React.useState("");
  const [back, setBack] = React.useState(false); // came back from the new-folder field: focus the list
  const [before, setBefore] = React.useState(value ?? ""); // the folder chosen before "+ New folder…"
  if (typing) {
    return h("label", { className: "xl-field" },
      h("span", null, "New folder ", h("span", { className: "xl-muted" }, "(use / for one inside another)")),
      h("input", {
        autoFocus: true, value: draft, placeholder: "e.g. project-c", "aria-label": "New folder", "data-testid": `${testid}-new`,
        onChange: (ev) => { setDraft(ev.target.value); onChange(ev.target.value.trim().replace(/^\/+|\/+$/g, "")); },
        onKeyDown: (ev) => {
          if (ev.key === "Escape") { ev.stopPropagation(); setTyping(false); setBack(true); onChange(before); }
          else if (ev.key === "Enter") { ev.stopPropagation(); onEnter?.(); }
        },
      }));
  }
  return h("label", { className: "xl-field" },
    h("span", null, "In folder"),
    h("select", {
      value: value ?? "", "aria-label": "In folder", "data-testid": testid, autoFocus: back,
      onChange: (ev) => {
        if (ev.target.value === NEW) { setBefore(value ?? ""); setDraft(""); setTyping(true); onChange(""); }
        else onChange(ev.target.value);
      },
    },
      h("option", { value: "" }, "Top level"),
      known.map((f) => h("option", { key: f, value: f }, f.split("/").join(" / "))),
      h("option", { value: NEW }, "+ New folder…")));
}
