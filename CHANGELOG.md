# Changelog

What changed in each release of obeya. Versions follow [semver](https://semver.org); while obeya is 0.x, a minor release can change what a command prints, and says so under **Changed**.

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
