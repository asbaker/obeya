// The canvas page: mounts Excalidraw with our controls, and wires keys,
// pages, sync and the event stream together. No build step: the browser loads
// these modules straight from the server.
import { React, h, createRoot, Excalidraw, MainMenu, WelcomeScreen } from "./deps.mjs";
import { params, RENDERER, MAC, KEY_PAGES, KEY_PRESENT, KEY_EXPORT, S } from "./state.mjs";
import { baseName, folderOf } from "/lib/names.mjs";
import { getJSON, connectEvents } from "./server-link.mjs";
import { flushSync, onChange } from "./sync.mjs";
import { openPage } from "./pages.mjs";
import { presenting, setPresent, stepFrame, togglePresent } from "./present.mjs";
import { linkForSelection, onLinkOpen } from "./links.mjs";
import { loadLibraries } from "./render.mjs";
import { installTestHooks } from "./test-hooks.mjs";
import { PagePicker } from "./ui/page-picker.mjs";
import { RenameDialog } from "./ui/rename.mjs";
import { ExportDialog } from "./ui/export-dialog.mjs";
import { PresentControls } from "./ui/present-controls.mjs";
import { AboutDialog } from "./ui/about.mjs";
import { dialogs, openDialog, closeDialog } from "./ui/dialogs.mjs";
import { NewPageDialog } from "./ui/new-page.mjs";

// Keys: Cmd+O / Ctrl+O opens the page picker; Shift+Alt+P starts or stops
// presenting (Excalidraw uses neither); while presenting, arrows step and Esc stops.
const typing = (ev) => ev.target.closest?.("input, textarea, [contenteditable]");
const modalOpen = () => Boolean(document.querySelector(".xl-backdrop"));
document.addEventListener("keydown", (ev) => {
  if (RENDERER || modalOpen()) return;
  const mod = MAC ? ev.metaKey : ev.ctrlKey;
  if (mod && ev.shiftKey && !ev.altKey && ev.code === "KeyE") {
    ev.preventDefault();
    ev.stopPropagation();
    S.openExport();
    return;
  }
  if (mod && !ev.shiftKey && !ev.altKey && ev.code === "KeyO") {
    ev.preventDefault();
    ev.stopPropagation();
    S.openPicker();
    return;
  }
  if (ev.code === "KeyP" && ev.shiftKey && ev.altKey && !ev.ctrlKey && !ev.metaKey && !typing(ev)) {
    ev.preventDefault();
    ev.stopPropagation();
    togglePresent();
    return;
  }
  if (!presenting() || typing(ev)) return;
  if (ev.key === "Escape") {
    ev.preventDefault();
    ev.stopPropagation();
    setPresent(false);
    return;
  }
  const delta = { ArrowRight: 1, ArrowDown: 1, PageDown: 1, " ": 1, ArrowLeft: -1, ArrowUp: -1, PageUp: -1, Home: -Infinity, End: Infinity }[ev.key];
  if (delta === undefined) return;
  ev.preventDefault();
  ev.stopPropagation();
  stepFrame(delta);
}, true);

// Present is greyed out on a page without frames; its tooltip says why.
let hasFramesNow = false;
function onEditorChange(elements) {
  const has = elements.some((e) => e.type === "frame" && !e.isDeleted);
  if (has !== hasFramesNow) {
    hasFramesNow = has;
    S.setUi((s) => ({ ...s, hasFrames: has }));
  }
  onChange();
}

// On an empty page: Excalidraw's own welcome screen, filled with ours. It goes
// away once something is drawn (Excalidraw's behaviour).
const welcome = (page) =>
  h(WelcomeScreen, null,
    h(WelcomeScreen.Center, null,
      h(WelcomeScreen.Center.Logo, null,
        h("span", { className: "xl-welcome-logo", "data-testid": "welcome" },
          h("img", { src: "/page/logo.svg", alt: "", "aria-hidden": true }), "obeya")),
      h(WelcomeScreen.Center.Heading, null,
        h("span", null, h("b", null, page ?? "This page"), " is empty. Draw here, or ask your agent:"),
        h("span", { className: "xl-welcome-ask", "data-testid": "welcome-ask" }, `"sketch our signup flow on ${page ?? "this page"}"`)),
      h(WelcomeScreen.Center.Menu, null,
        h(WelcomeScreen.Center.MenuItem, { onSelect: () => S.newPage(), "data-testid": "welcome-new-page" }, "New page…"),
        h(WelcomeScreen.Center.MenuItem, { onSelect: () => S.openPicker(), shortcut: KEY_PAGES, "data-testid": "welcome-pages" }, "Open page…"))));

function App() {
  const [ui, set] = React.useState({ pages: [], skipped: [], page: null, present: false, presentPos: null, hasFrames: false });
  const [dialog, setDialog] = React.useState(dialogs.state);
  React.useEffect(() => dialogs.subscribe(setDialog), []);
  S.setUi = set;
  S.openPicker = () => openDialog("PICKER");
  S.openExport = () => S.currentPage && openDialog("EXPORT");
  S.openAbout = () => openDialog("ABOUT");
  // New page, starting in `folder` (the picker's + page here), else the page's own folder.
  const newPage = (S.newPage = (folder) => { set((s) => ({ ...s, newIn: folder ?? null })); openDialog("NEW"); });

  React.useEffect(() => {
    getJSON("/api/pages").then(({ pages, skipped }) => set((s) => ({ ...s, pages, skipped }))).catch(() => {});
  }, []);

  const n = ui.pages.length;
  const pill = (isMobile) => ui.present || RENDERER ? null :
    h("button", { className: "xl-pill", onClick: S.openPicker, "data-testid": "page-pill", title: `Open page (${KEY_PAGES})` },
      h("img", { className: "xl-mark", src: "/page/logo.svg", alt: "", "aria-hidden": true, "data-testid": "pill-mark" }),
      // A page in a folder: "project-a / overview", the folder muted.
      ui.page && folderOf(ui.page) ? h("span", { className: "xl-muted", "data-testid": "pill-folder" }, `${folderOf(ui.page).split("/").join(" / ")} / `) : null,
      h("b", null, ui.page ? baseName(ui.page) : "…"),
      isMobile ? null : h("span", { className: "xl-muted" }, `· ${n} page${n === 1 ? "" : "s"}`),
      h("span", { className: "xl-muted", "aria-hidden": true }, "▾"));
  const present = () => ui.present || RENDERER ? null :
    h("span", { className: "xl-tipwrap" },
      h("button", { className: "xl-present" + (ui.hasFrames ? "" : " off"), onClick: togglePresent, "data-testid": "present-toggle", "aria-describedby": "xl-present-tip" }, "▶ Present"),
      h("div", { className: "xl-tip", role: "tooltip", id: "xl-present-tip" },
        h("b", null, "Present", h("kbd", null, KEY_PRESENT)),
        ui.hasFrames
          ? "Show one frame at a time, starting from the selected frame, with a laser pointer. ← → step through frames; click a linked shape to jump to its frame. Esc stops. Nothing on the page changes."
          : "This page has no frames yet. Present shows frames one at a time: add a frame (F), or ask your agent for slides."));

  return h(React.Fragment, null,
    h("div", { id: "canvas" },
      h(Excalidraw, {
        onInitialize: async (a) => {
          S.api = a;
          try {
            const { pages } = await getJSON("/api/pages");
            const start = params.get("page") || pages[0]?.name;
            if (start) await openPage(start, params.get("element"));
            connectEvents();
            loadLibraries();
          } catch (err) {
            console.error(err);
          }
        },
        onChange: onEditorChange,
        onLinkOpen,
        generateLinkForSelection: (id) => linkForSelection(id),
        viewModeEnabled: ui.present,
        validateEmbeddable: false,
        renderTopLeftUI: pill,
        renderTopRightUI: present,
        UIOptions: { canvasActions: { loadScene: false, saveToActiveFile: false, export: false, saveAsImage: false } },
      },
        h(MainMenu, null,
          // File-menu order: new, open, rename; then what to do with this page.
          h(MainMenu.Group, { title: "obeya" },
            h(MainMenu.Item, { onSelect: () => newPage(), "data-testid": "menu-new-page" }, "New page…"),
            h(MainMenu.Item, { onSelect: S.openPicker, shortcut: KEY_PAGES, "data-testid": "menu-pages" }, "Open page…"),
            h(MainMenu.Item, { onSelect: () => openDialog("RENAME"), "data-testid": "menu-rename" }, "Rename or move this page…"),
            h(MainMenu.Separator),
            h(MainMenu.Item, { onSelect: S.openExport, shortcut: KEY_EXPORT, "data-testid": "menu-export" }, "Export…"),
            h(MainMenu.Item, { onSelect: togglePresent, shortcut: KEY_PRESENT, "data-testid": "menu-present" }, "Present")),
          h(MainMenu.Separator),
          h(MainMenu.DefaultItems.SearchMenu),
          h(MainMenu.DefaultItems.CommandPalette),
          h(MainMenu.DefaultItems.Help),
          h(MainMenu.Item, { onSelect: S.openAbout, icon: h("img", { className: "xl-menu-mark", src: "/page/logo.svg", alt: "" }), "data-testid": "menu-about" }, "About obeya"),
          h(MainMenu.DefaultItems.ClearCanvas),
          h(MainMenu.Separator),
          h(MainMenu.DefaultItems.ToggleTheme, { allowSystemTheme: false }),
          h(MainMenu.DefaultItems.ChangeCanvasBackground)),
        RENDERER ? null : welcome(ui.page))),
    ui.present && ui.presentPos ? h(PresentControls, { pos: ui.presentPos }) : null,
    dialog === "picker" ? h(PagePicker, { pages: ui.pages, skipped: ui.skipped, current: ui.page, onClose: closeDialog, onNew: (folder) => newPage(folder) }) : null,
    dialog === "new" ? h(NewPageDialog, { names: ui.pages.map((p) => p.name), folder: ui.newIn ?? folderOf(ui.page ?? ""), onClose: closeDialog }) : null,
    dialog === "rename" ? h(RenameDialog, { current: ui.page, names: ui.pages.map((p) => p.name), onClose: closeDialog }) : null,
    dialog === "export" ? h(ExportDialog, { page: ui.page, onClose: closeDialog }) : null,
    dialog === "about" ? h(AboutDialog, { onClose: closeDialog }) : null);
}

createRoot(document.getElementById("root")).render(h(App));
window.addEventListener("pagehide", () => flushSync({ keepalive: true }));
installTestHooks();
