# Changelog

What changed in each release of obeya. Versions follow [semver](https://semver.org); while obeya is 0.x, a minor release can change what a command prints, and says so under **Changed**.

## [Unreleased]

### Added

- More fonts in the canvas font menu: Inter, Inter Bold, Source Serif, Barlow Condensed and Caveat ship with obeya (140 KB, SIL Open Font License), and Helvetica and Cascadia are no longer hidden. Exported SVGs carry them.
- Patches name fonts: `"fontFamily": "Inter"` instead of Excalidraw's numbers. An unknown name is refused with the list of fonts.
- Stages: `obeya patch --style sketch|clean|hifi` (also on `mermaid` and `library insert`). Sketch and clean lay down a medium (hand-drawn strokes and Excalifont; crisp lines and Helvetica) under the patch's own defaults; hifi sets nothing. Colours stay the agent's. Each stage has a brief: `obeya --skill sketch|clean|hifi`, with what they share in `--skill design` (where the look comes from: the page, then your agent's memory of you, then a sample; type sized from the frame; when a slide shape applies). Tell your agent your look (your brand, fonts you like); obeya follows it.
- `obeya --skill components`: the parts drawings are made of, named as UI kits and information design name them (card, chip, stepper, table, lanes, callout, …), and the craft of drawing them on a canvas.
- Numbered pins: `{"pins": {"items": [{"on": "card-3", "note": "Too small"}]}}` in a patch. The server numbers them, puts each on its element and lays the notes out beside; send the same set again to replace it.
- Markdown docs beside drawings: `.md` files in the pages folder show in the page picker and open read-only in the tab. Link a drawing to a doc's heading (`?page=notes%2Fspec.md#3-requirements`) and a doc to a drawing (`[the plan](?page=notes%2Fplan&element=f2)`); headings use GitHub's anchors. The tab reloads a doc when its file changes.
- Edit docs in the tab: Edit, top right (or Cmd/Ctrl+E), switches a doc to EasyMDE (MIT, loaded the first time), with a toolbar, side by side and a status bar; Read switches back. The caret lands on the line you were reading, and edits save themselves after a pause. When your agent writes the same file while you type, its lines merge in around yours; if you both changed the same lines, a banner asks: Load theirs or Keep mine. Your agent keeps working with docs as plain files.
- New doc: the New page dialog has a Kind (Drawing or Doc), and typing a name ending in `.md` in the page picker offers "+ New doc".

### Changed

- A patch that creates the same id twice is refused (`invalid_patch`, naming the id) instead of the second silently replacing the first.

### Fixed

- Rewording a text through `elements` kept its old width, cutting the new words off.
- Redrawing a frame (deleting elements, then creating them again with the same ids) kept their old stacking order, which could hide text under shapes. Re-created elements now stack as new.
- After the server was killed before saving, deleted elements came back. An open tab now sends back what it had newer when it reconnects.
- Lint's contrast check read a label in a clear box, or on a see-through tint, against white. It now looks at what's behind.
- A shape that fills its frame (a background) is locked when it's drawn, so it isn't dragged by accident.
- A sideways two-finger swipe on a trackpad no longer goes Back.

## [0.2.1] - 2026-11-13

Fixes for `obeya wait`. Update both: `npm update -g obeya` and `npx skills update obeya`.

### Fixed

- Agents asked in chat instead of waiting on the page while iterating with you. The guide now tells them to wait after every round of changes.
- The wait banner covered the toolbar's More tools (⋮) menu. Excalidraw's menus now open over it.
- With six or more obeya tabs open in one browser, saves and Done stopped reaching the server and `obeya wait` never returned (browsers allow six connections to one server). Older tabs now pause and say so; click one to resume, with your edits kept. A command that starts the server waits a few seconds for your open tabs to reconnect instead of opening another one.

## [0.2.0] - 2026-11-12

Cheaper for agents. An agent now learns obeya in about 3k tokens instead of 6.5k, and every command prints only what it acts on. New: ask the person for something on a page and wait for their answer, Mermaid diagrams as editable elements, and text checks that replace most screenshots.

Update both: `npm update -g obeya` and `npx skills update obeya`.

### Added

- `obeya wait <page> --ask "…"`: ask the person for something on a page. The page shows a banner with your ask and a Done button; when they press it, you get their changes.
- `obeya mermaid <page> --file <x.mmd> --id <prefix>`: flowchart, sequence, class, state, ER, gantt, quadrant and timeline diagrams as editable elements, converted in the browser. Run it again with the same `--id` to update the diagram in place.
- Text checks in `obeya lint`: `unframed`, `misrouted-arrow`, `stray`, `empty-frame`, `crowded-frame`, `small-text` and `contrast`.
- `obeya describe <page> --layout`: a frame as rows in reading order, with sizes, gaps and what sits inside what.
- `obeya shot --around <id,…>`: a screenshot of a few elements. Screenshots are capped at 1568 px unless `--scale` is given.
- `defaults` in a patch: a page's base style per element type.
- `obeya --skill <topic>` and `obeya --skill all`. Every error carries a one-line `hint`.
- In the browser: Back and Forward move between pages, picker rows open in a new tab, and long folder names in the page pill shrink to a letter (`a / b / page`).

### Changed

If you read obeya's JSON from a script, check these.

- Output is one compact JSON line, `{"result":…}` or `{"error":{code, message, hint}}`, without the `id`. A success with nothing to report prints nothing (`stop`, `show`).
- `patch` prints `{rev, created, changed, warnings, fixes}`; `created` and `changed` are counts. `--verbose` is gone.
- `changes` reads since your last read and only the person's edits by default (`--since last --source user`). Text the person added or reworded comes in full.
- `status` prints `{running, url, browsers}`. `lint` findings and patch warnings carry numbers instead of a `message`, with `fixes` once per rule. `get --frame` drops `frame` on each element, `pages` drops `rev`, and `shot` prints `{width, height}`.
- `get --full` leaves out deleted elements, default values and editor bookkeeping (250 KB → 39 KB on a busy page).
- `obeya --skill` prints a short core; the rest is in topics. `--help` screens give usage, flags and output only.
- A new element that lies wholly inside a frame joins it, as when the person drops it there.

### Fixed

- Re-applying a skeleton to reword a label keeps the element's frame, group, colours, link and customData.
- A frame created without children keeps its box.
- `lint` finds overlaps across a frame's edge, and boxes stacked on each other.
- The guide writes links between pages as `?page=…`, so they don't break when a folder's port changes.
- `npx skills add asbaker/obeya` installs only the skill, not the source folder.

## [0.1.0] - 2026-11-09

First release.

- A shared Excalidraw canvas in your browser, served on 127.0.0.1 only. Pages are `.excalidraw` files in any folder, with subfolders.
- A CLI that prints JSON: `patch`, `changes` (with what each mark points at), `describe`, `get`, `lint`, `shot`, `export` (PNG, SVG, PDF, a one-file HTML deck), `library`, `rename`, `band`.
- Layout directives in patches: `place`, `align`, `distribute`, `grid`, `stack`.
- Components and icons from the public Excalidraw libraries; local images in patches.
- Present mode, links between frames and pages, clickable prototypes.
- New and delete pages from the browser. Files changed on disk show up without a reload. Tabs reconnect after a server restart.
- The skill (`npx skills add asbaker/obeya`), `obeya --skill`, and an `INSTALL.md` an agent can follow.

[0.2.0]: https://github.com/asbaker/obeya/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/asbaker/obeya/releases/tag/v0.1.0
