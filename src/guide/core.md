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

The server starts itself when needed and stops after 12 idle hours; a stopped server is not an error. Only `patch`, `show` and `library insert` need a canvas tab: the CLI opens one, or with `--no-open` (prefer it when the person may be away) exits `2` with the link. Patching a page they aren't looking at doesn't move their view: tell them what you changed and where.

## Read, cheapest first

```bash
obeya pages                            # pages, frame counts, last edit
obeya describe <page> --format text    # frames, elements, labels, ids: start here
obeya get <page> --frame <id>          # boxes and coordinates, to place or move things
obeya describe <page> --layout --frame <id>   # rows in reading order: check an arrangement as text
obeya lint <page>                      # overlaps, clipped text, unframed, misrouted arrows, contrast, …
```

`describe` is a third the size of `get`; use `get` only for positions.

## Patch

`obeya patch <page> --file -` with JSON on stdin: `skeleton` creates, `elements` edits by `id`, `delete`, `toBack`/`toFront`, `layout` places things for you. **Run `obeya --skill patch` before your first patch**: shapes, examples, layout, and what the editor adjusts.

- **Don't compute coordinates**: let `layout` place things (`place` in a frame, `align`, `distribute`, `grid`, `stack`).
- **Over ~10 elements, or repetitive**: generate the patch with a short script; set base style once with `defaults` (`--skill patch`).
- Text goes inside shapes as a `label`; bind arrows with `start`/`end`; give a composite object one shared `groupIds`.
- Read positions back after a patch; don't assume them. Fix the response's `warnings` in a follow-up patch.

## When to reach for what

- **Before you rearrange** anything the person can see, read `obeya changes <page>`: they may have circled or annotated it. Move their marks with it, or ask (`--skill changes`).
- **When the person says they changed something**, read `obeya changes <page>` and treat circles, arrows and notes as instructions.
- **When the page asks the person something** (questions, triage, review, ranking), also start `obeya wait <page> --frame <id> --ask "…"` in the background, so their answers on the page come back to you when they press Done. Asking in chat is fine too; say which page you're waiting on (`--skill wait`).
- **Prefer real components** (icons, cloud and UI kits) over plain rectangles (`--skill library`).

## Check your work

1. Fix each patch's `warnings`.
2. After a batch, `obeya lint <page>` (and `describe --layout --frame <id>` for a frame you arranged): far cheaper than a screenshot.
3. Screenshot only **a new page or a frame you built**, once, scoped to it (`obeya shot <page> --frame <id>`, or the page), and read the PNG. After edits to an existing page, stop at step 2: the person has it open and will mark what's wrong.

## Topics: `obeya --skill <topic>`

- `patch`: shapes and examples, layout directives, groups, how the editor adjusts geometry
- `changes`: reading what the person did, `pointsAt`, bands, cursors
- `wait`: asking the person to do something on a page, then getting their changes on Done
- `library`: finding and inserting components and icons from the Excalidraw catalogue
- `images`: putting local images and screenshots on a page
- `prototype`: links between frames and pages (always relative), clickable areas, presenting
- `export`: SVG, PNG, HTML slide deck, PDF
- `pages`: folders, renaming and moving pages
- `server`: ports, tabs, starting and stopping, `--no-open`
- `safety`: what stays on this machine

`obeya --skill all` prints this and every topic.
