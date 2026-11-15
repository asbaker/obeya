---
name: obeya
description: "Draw on a live Excalidraw canvas that the person also has open in their browser, and read back what they drew, moved or annotated. Use when the user asks to sketch, diagram, wireframe, story-map or brainstorm visually with you, to put something on 'the canvas', 'the board', 'the wall' or 'the whiteboard', or to look at what they changed there; also for kanban and triage boards, asking them to review or answer on a page, clickable prototypes and slides, and exporting a page as SVG, PNG, PDF or an HTML deck. Local only: drawings stay on this machine as .excalidraw files. Do not use for one-off image generation that the person won't edit."
---

# obeya

You and the person share an Excalidraw canvas. They draw in a browser tab; you use the `obeya` CLI, which prints JSON. A *page* is one `.excalidraw` file in the pages folder (`--dir`); a *frame* is an area on a page (a slide when presenting). "The board", "the wall", "the whiteboard" mean a page.

- **Pages folder:** the person's choice. If they haven't said, ask; then pass the same `--dir` on every command (or set `OBEYA_DIR`). Default `./obeya`. Don't create files or folders they didn't ask for.
- **Links:** `obeya status` and `obeya open` print the URL; each pages folder has its own port. Don't guess ports.
- **Syntax:** `obeya <command> --help`. A command with missing arguments prints its help and changes nothing.
- **Never write `.excalidraw` files** or `<dir>/.obeya/` yourself: the server is their only writer; writing them overwrites the person's open edits.

## Output

One JSON line: `{"result":…}` or `{"error":{"code","message","hint",…}}`, or nothing when a success has nothing to report. Branch on `code` and do what `hint` says. Exit `0` ok, `1` error, `2` the person must act: give them `error.url`.

IDs are opaque: choose your own when you create elements, otherwise read them (`describe`, `get`, `changes`); never guess one.

## Lifecycle

The server starts itself when needed and stops after 12 idle hours; a stopped server is not an error. Only `patch`, `mermaid`, `show` and `library insert` need a canvas tab: the CLI opens one, or with `--no-open` (prefer it when the person may be away) exits `2` with the link. Patching a page they aren't looking at doesn't move their view: tell them what you changed and where.

## Read, cheapest first

```bash
obeya pages                   # pages, frame counts, last edit
obeya describe <page> --format text   # frames, elements, labels, ids: start here
obeya get <page> --frame <id>  # boxes and coordinates, to place or move things
obeya lint <page>             # overlaps, clipped text, misrouted arrows, contrast, …
```

## Patch

`obeya patch <page> --file -` with JSON on stdin: `skeleton` creates, `elements` edits by `id`, `delete`, `toBack`/`toFront`, `layout` places things for you. **Run `obeya --skill patch` before your first patch**: shapes, examples, layout, and what the editor adjusts.

- **Boards: don't compute coordinates**; `layout` places things (`place`, `align`, `grid`, `stack`). Mockups: a script.
- **Over ~10 elements, or repetitive**: generate the patch with a short script; base style once via `defaults` (`--skill patch`).
- Text goes inside shapes as a `label`; bind arrows with `start`/`end`; give a composite object one shared `groupIds`.
- Read positions back; don't assume them. Fix `warnings` in a follow-up patch.

## When to reach for what

- **Before you rearrange** anything the person can see, read `obeya changes <page>`: they may have circled or annotated it. Move their marks with it, or ask (`--skill changes`).
- **When the person says they changed something**, read `obeya changes <page>` and treat circles, arrows and notes as instructions.
- **Whenever the person should look at a page**: after you change it for them, or it asks something (questions, triage, review, ranking). Start `obeya wait <page> --frame <id> --ask "…"` in the background, every round, instead of asking in chat: their marks come back when they press Done (`--skill wait`).
- **Pictures over text**: compose components (`--skill components`); icons from `--skill library`.
- **Flowcharts, sequence, class, state, ER diagrams**: Mermaid via `obeya mermaid` (`--skill mermaid`).
- **Sketch, clean or hifi** (asked, or exploring, converging, presenting): `--skill design` + `--skill <it>`, then `--style <it>`.

## Check your work

1. Fix each patch's `warnings`.
2. After a batch, `obeya lint <page>` (and `describe --layout --frame <id>`): far cheaper than a screenshot.
3. Screenshot only **a new page or a frame you built**, once, scoped to it (`obeya shot <page> --frame <id>`, or the page), and read the PNG. After edits to an existing page, stop at step 2 and wait: they mark what's wrong.

## Topics: `obeya --skill <topic>`

- `patch`: shapes, examples, layout directives, pins, groups
- `design`: thinking before you draw
- `sketch`, `clean`, `hifi`: how far to take it
- `components`: the parts drawings are made of
- `changes`: what the person did, `pointsAt`, bands, cursors
- `wait`: asking the person for something on a page; their changes on Done
- `library`: components and icons from the Excalidraw catalogue
- `mermaid`: diagrams from Mermaid text
- `images`: local images and screenshots
- `prototype`: links between frames, pages and docs; clickable areas
- `export`: SVG, PNG, HTML deck, PDF
- `pages`: folders, renaming and moving pages
- `server`: ports, tabs, starting, stopping, `--no-open`
- `safety`: what stays on this machine

`obeya --skill all` prints this and every topic.
