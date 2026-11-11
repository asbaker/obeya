---
name: obeya
description: "Draw on a live Excalidraw canvas that the person also has open in their browser, and read back what they drew, moved or annotated. Use when the user asks to sketch, diagram, wireframe, story-map or brainstorm visually with you, to put something on 'the canvas', 'the board', 'the wall' or 'the whiteboard', or to look at what they changed there. Local only: drawings stay on this machine as .excalidraw files. Do not use for one-off image generation that the person won't edit."
---

# obeya

`obeya` gives you and the person **the same Excalidraw canvas**. The person draws in a normal browser tab. You create and change elements, read back their changes, and take screenshots, all through a CLI that prints JSON. Each page is a plain `.excalidraw` file in a pages directory (default `./obeya`), so it can live in git.

This is not an official Excalidraw project.

**Words.** A *page* is one drawing (one `.excalidraw` file). Pages can sit in *folders*. The *pages folder* is the top folder obeya serves (`--dir`). The *canvas* is the browser tab where the person sees and edits a page. A *frame* is an area on a page (a slide when presenting). When the person says "the board", "the wall" or "the whiteboard", they mean a page.

**Where pages live** is the person's choice: any folder, in or out of their project. If they haven't said, ask, then pass `--dir <folder>` on every command (or set `OBEYA_DIR`). Without it, obeya uses `./obeya` in the current directory. Never create folders or files in their project they didn't ask for.

**Ports** are picked for you: each pages folder gets its own port (4747 for the first, then the next free one) and keeps it. `obeya status` and `obeya open` print the link; don't guess ports. `--port` overrides.

## Learn the installed CLI

The installed binary is the authority for syntax:

```bash
obeya --help          # overview of every command
obeya <command> --help
```

Running a command with missing arguments prints its help and an error (`missing_argument`); it never runs with defaults. `patch` in particular needs `--file <path>` or `--file -` (stdin) and won't wait on stdin otherwise.

## Output, errors and IDs

Every command prints one JSON envelope on stdout:

```json
{"id": "cli:patch", "result": { … }}
{"id": "cli:patch", "error": {"code": "no_canvas_open", "message": "…", "url": "…"}}
```

Branch on `error.code`, not on the message. Exit codes: `0` ok, `1` error, `2` **the person needs to act** (open the link in `error.url`).

| code | meaning | what to do |
|---|---|---|
| `no_canvas_open` | a live tab is needed and `--no-open` was given (exit 2) | give the person `error.url`, ask them to open it, retry |
| `canvas_not_connected` | a tab was opened but didn't connect in 30 s (exit 2) | same as above |
| `unknown_page` | no such page (`error.pages` lists them) | check `obeya pages` |
| `unknown_element` | an id in `--frame` or `delete` doesn't exist | re-read with `get` |
| `invalid_patch` | the patch is malformed; nothing was changed | fix the patch |
| `invalid_image` | an image `src` is missing, unreadable, or not PNG, JPEG, GIF, WebP or SVG | check the path and the file |
| `image_too_large` | an image `src` is over 4 MB | shrink it, then retry |
| `canvas_outdated` | the person's tab runs older page code (from before an upgrade); nothing was changed | ask them to reload the tab, then retry |
| `no_room` | a `place` layout found no free spot in its area; nothing was changed | make the area bigger, or move something out |
| `port_in_use_other_dir` | the `--port` you gave serves another pages folder | drop `--port` (obeya picks the folder's own) or pass another |
| `port_in_use` | something else owns the `--port` you gave | drop `--port`, or pass another |
| `no_free_port` | no free port in 4747–4946 | pass `--port <n>` |
| `canvas_timeout` | the tab didn't answer in time | retry; ask the person to check the tab |
| `missing_argument`, `unknown_option`, `invalid_argument`, `unknown_command` | usage error | see the command's `--help` |

**IDs are opaque.** Choose your own stable `id`s when you create elements, and otherwise read IDs from responses (`created`, `changed`, `get`, `changes`). Never derive an ID from an example or guess one. Bound label text gets a generated ID; address the container instead.

## Lifecycle

- The server starts by itself on the first command that needs it, bound to `127.0.0.1` on the pages folder's own port (see Ports above; `--port` or `OBEYA_PORT` override). `obeya status` never starts it; `obeya stop` saves and stops it. It also stops itself after 12 idle hours (no tab, no calls; `--idle-timeout <minutes>`, `0` = never) and restarts on the next command, so don't treat a stopped server as an error.
- Read-only commands (`pages`, `get`, `describe`, `changes`) need no browser tab.
- Live commands (`patch`, `show`, `library insert`) need a connected tab (`wait` doesn't: it never opens one). `shot` and `export` don't. If none is connected, the CLI opens one in the person's default browser and waits up to 30 s.
- With `--no-open` the CLI never opens a browser: it exits `2` with `error.code: "no_canvas_open"` and the link in `error.url`. Prefer `--no-open` when the person might not be at the screen, and hand them the link.
- `obeya open [<page>] [--frame <id>]` brings the canvas up for the person, or switches the open tab.
- Always pass the same `--dir` (or set `OBEYA_DIR`) for a project.
- Patching a page the person isn't looking at doesn't move their view: it's applied out of sight and saved. Tell them in your reply what you changed and where (`show` points them at it if they want to look).
- If the person has several canvas tabs open, a patch goes to a tab showing its page, other requests to the tab they used last; the other tabs update live. `status` reports `browsers` (connected tabs).

## Pages

`obeya pages` lists each page with its frame count and when it was last edited. Pages can sit in folders: a page's name is its path, like `project-a/overview` (the file `project-a/overview.excalidraw`); quote names with spaces in the shell (`obeya get "Café Ideen"`). Any command that takes a `<page>` takes such a name, and patching a new name makes its folder. Files listed under `skipped` have names the tool can't use (one with `\ : * ? " < > |`, or a part starting with `.`); tell the person rather than renaming them. The person switches pages with the page picker (top left of the canvas, or Cmd/Ctrl+O), makes new ones with ☰ → New page…, and renames, moves or deletes the page on screen with ☰ → Rename or move this page…. You can't delete pages.

`obeya rename <page> <new-name>` renames a page, or moves it to another folder (`obeya rename overview project-a/overview`); its history and the person's open tab come along. Then update the links listed in `staleLinks` with a patch, e.g. `{"elements": [{"id": "go", "link": "http://127.0.0.1:<port>/?page=<new-name>&element=f2"}]}` (the port `obeya status` shows; encode a `/` in the name as `%2F`). Never rename `.excalidraw` files yourself.

## Reading the canvas

```bash
obeya pages
obeya describe roadmap --format text   # outline: frames, then elements with labels and IDs
obeya get roadmap                      # compact JSON: id, type, x, y, w, h, text, frame, link, data
obeya get roadmap --frame f-login --full
obeya lint roadmap                     # layout problems: overlap, clipped-text, outside-frame, loose-arrow, near-miss, hidden
```

`lint` findings are `{rule, ids, frame, message}`; `--frame` and `--rule overlap,hidden` narrow them. Run it after a batch of patches and before showing the person a page: it costs a few dozen tokens, a screenshot costs a thousand or more.

## Changing the canvas: patches

```bash
obeya patch roadmap --file patch.json
obeya patch roadmap --file - <<'JSON'
{ "skeleton": [ … ], "elements": [ … ], "delete": [ "id" ] }
JSON
```

- `skeleton`: create elements with Excalidraw's skeleton API. The editor does the layout (text wrapping, sticky-note sizing, arrow binding). Give every element your own `id`.
- `elements`: partial edits merged onto existing elements by `id`: move (`x`, `y`), recolor (`backgroundColor`, `strokeColor`), `link`, `customData`, `name`. The editor bumps `version` itself.
- `delete`: IDs to delete. Deleting a container also deletes its label.
- `toBack` / `toFront`: IDs to move behind or above everything (stacking order). New elements land on top, so send backgrounds, bands and guide lines to the back.
- `layout`: let the tool do the arithmetic instead of computing coordinates (applied in order, in the same undo step; things move with their group, frames with their children):
  - `{"place": "card-9", "in": "col-done", "end": true}`: the next free spot in a frame or shape (below what's there with `end`), lined up with similar elements, brought to the front. Error `no_room` if it doesn't fit.
  - `{"align": "left", "ids": ["a", "b"], "to": "c"}`: `left|right|top|bottom|centre-x|centre-y`; without `to`, to their combined box.
  - `{"distribute": "vertical", "ids": ["a", "b", "c"], "gap": 40}`: a fixed gap, or equal gaps between the ends without one.
  - `{"grid": ["n1", "n2", "n3", "n4"], "columns": 2, "gap": 24, "at": [100, 200]}`.
  - `{"stack": "above", "ids": ["card"], "ref": "column"}`: just above (or `below`) one element. Moving something onto a filled shape? Use `place` or `stack`, or it may end up hidden underneath.
- The response's `warnings` are layout problems among what you touched (same rules as `lint`): overlaps, clipped labels, things sticking out of frames, loose arrow ends, near-misses, hidden elements. Fix them in a follow-up patch, often with a `layout` directive.

**Make things move the way the person expects:**
- Give composite objects (a table drawn as a box, header and rows; a card with a title and a value; a timeline marker with its label) one shared `groupIds` value, e.g. `"groupIds": ["tbl-order"]` on every part. Otherwise dragging one part leaves the rest behind.
- Bind connectors (`start: {id}`, `end: {id}`) so they follow their shapes; an unbound arrow stays put when the person moves a box.
- Put text inside shapes as a `label`, not as a separate text element, so it moves with the shape.
- To change a label's wording, re-apply the shape's skeleton with the new `label` (same `id`): that wraps the text to the shape. Editing the label's text element directly doesn't re-wrap it.
- The page is created if it doesn't exist. The whole patch is one undo step for the person (Ctrl+Z).
- The response lists `created` IDs and `changed` entries, including layout the editor did.
- The editor may adjust geometry: a frame created with `children` is re-fitted around them (its `x`, `y`, `width`, `height` are not kept), and arrows are re-routed between their bound shapes. Read positions back with `get` instead of assuming them. For exact artboards, follow up with an `elements` edit that sets the frame's `x`, `y`, `width` and `height`.
- Arrows can bind to anything with an `id`, including sticky notes and elements from earlier patches. Bound arrows follow when the person moves a shape.

Sticky notes in a frame:

```json
{
  "skeleton": [
    { "type": "frame", "id": "f-login", "x": 0, "y": 0, "width": 900, "height": 380, "name": "01 Login", "children": ["n-email", "n-sso"] },
    { "type": "stickynote", "id": "n-email", "x": 40, "y": 60, "label": { "text": "Email + password" } },
    { "type": "stickynote", "id": "n-sso", "x": 340, "y": 60, "backgroundColor": "#a5d8ff", "label": { "text": "Sign in with SSO" } }
  ]
}
```

A labelled box and an arrow bound to two shapes:

```json
{
  "skeleton": [
    { "type": "rectangle", "id": "box-api", "x": 700, "y": 80, "width": 180, "height": 80, "label": { "text": "API" } },
    { "type": "arrow", "id": "a-sso-api", "x": 590, "y": 120, "start": { "id": "n-sso" }, "end": { "id": "box-api" } }
  ]
}
```

Edits and deletes:

```json
{
  "elements": [
    { "id": "n-email", "x": 40, "y": 220 },
    { "id": "n-sso", "customData": { "status": "done" } }
  ],
  "delete": ["a-sso-api"]
}
```

Never write `.excalidraw` files yourself, even though they are plain JSON. The server is their only writer; writing them directly skips Excalidraw's layout and overwrites edits the person has open.

## Images

Put a screenshot, logo or photo on a page with an image skeleton and a local file path:

```json
{"skeleton": [{"type": "image", "id": "login-shot", "src": "./screens/login.png", "x": 900, "y": 120, "width": 480}]}
```

- `src` is a local file (PNG, JPEG, GIF, WebP or SVG, at most 4 MB), relative to where you run `obeya`. obeya downloads nothing: for an image on the web, download it to a temporary file yourself and pass that path.
- Give `width` (the height follows the image's shape), both, or neither (its own size, at most 800 wide).
- The image is stored inside the page's `.excalidraw` file; obeya writes no image files and doesn't keep the path. Deleting the image removes its data from the page.
- A screenshot of another page: `obeya shot other-page --out /tmp/other.png`, then `"src": "/tmp/other.png"`.

## Components from libraries

Prefer real components over plain rectangles. Any library in the public Excalidraw catalogue (~230) can be found and used on demand; downloads are cached per user, and nothing about the drawing is sent.

```bash
obeya library search aws icons                 # catalogue search; prefer results with "named": true
obeya library show architecture-diagram-components            # items as <lib>/<item>, with sizes
obeya library show software-architecture --sheet shots/lib.png # look at a labelled picture of every item
obeya library insert architecture-diagram-components/slack roadmap --at 120,560 --frame f-sys --id slack
```

- Many popular libraries have **unnamed items** (`item-1`, `item-2`, …). Render `--sheet`, read the PNG with your image tool, and pick the id under the right picture. Never guess item ids.
- Insert ids are `<prefix>-1`, `<prefix>-2`, … (listed in `ids`); use them to relabel or move the copy with a patch. `--at` is the item's top-left.
- `library add ./team-kit.excalidrawlib` or `library add https://…/kit.excalidrawlib` adds the person's own libraries; `library list` shows what's cached. The person sees cached libraries in the editor's library sidebar.
- Good starting points (catalogue ids): architecture: `architecture-diagram-components`, `c4-architecture`, `software-architecture` (unnamed), `system-design` (unnamed); cloud: `aws-architecture-icons.childishgirl`, `google-icons`, `microsoft-azure-cloud-icons`, `kubernetes-icons-set`, `network-topology-icons`; UI: `basic-ux-wireframing-elements`, `universal-ui-kit`, `lo-fi-wireframing-kit` (unnamed); process: `bpmn`, `uml-library-activity-diagram`, `domain-driven-design`, `event-storming`; people: `stick-figures`. Sticky notes need no library (`type: "stickynote"`).
- Credit: catalogue libraries are MIT-licensed; `library show` gives each library's authors and source.

## Reading back what the person did

```bash
obeya changes roadmap            # what the person did since your last read
```

By default `changes` returns **the person's** edits since **your** previous read, then moves your cursor (it survives restarts), so calling it twice in a row returns nothing the second time. Your own edits are left out: you made them. Flags for the rare cases:

- `--since <rev>`: read from a revision instead; moves no cursor.
- `--source agent`: your own edits (and any other agent's); `--source all`: both, each entry with its `source`.
- `--consumer <name>`: a separate cursor, if several tools read the same page.

Each entry has `op` (`added`, `modified`, `relabeled`, `deleted`, `restored`), `id`, `type`, `text` (in full for what was added or reworded; otherwise the first 80 characters), and, where relevant:

- `fields`: what else a `modified` changed (`backgroundColor`, `customData`, …);
- `moved: {from: [x, y], to: [x, y]}`;
- `frameChange: {from, to}` when an element entered or left a frame (`frame` is the current frame);
- `pointsAt: [{id, type, text}]` for an annotation the person added (ellipse, freehand, arrow, rectangle, sticky note, text, line): the elements it covers or points to, best match first. Arrows use their bindings or what their tip touches. A note dropped inside an area that holds other notes (a column, a lane) doesn't point at the area.

Edits to a label are reported once, as `relabeled` on the container. Consecutive edits to the same element are merged into one entry.

**Bands** let you hear about moves across lines that matter to your workflow (a release line, swimlanes). Register them once per session; `set` is idempotent:

```bash
obeya band set roadmap release-1 --y 600            # a horizontal line
obeya band set roadmap lane-backend --y 700 --to 900 # a horizontal strip
obeya band list roadmap
```

A move whose element centre changes side gets `crossed: [{band, from, to}]`, with sides `before` (above / left), `inside`, `after` (below / right). For a negative coordinate write `--y=-50`.

**Before you rearrange anything the person can see, read `changes` first.** They may have just circled or commented on it; if you move the thing, move their marks with it (or ask), or their circle ends up pointing at nothing.

Treat the person's annotations as instructions: a circled sticky with a comment next to it means "this one", so read `pointsAt` and the comment's `text` together.

## Asking the person for something: wait

When you need the person to do something on a page (answer questions, triage, review a draft, place or rank cards, mark what's wrong), ask on the page instead of in the chat, and wait for them:

```bash
obeya wait roadmap --frame f-questions --ask "Answer the questions in this frame on stickies, then press Done"
```

Tabs showing that page show your `--ask` in a banner with a **Done** button (Cmd/Ctrl+Enter), with `--frame` outlined. Everywhere else it stays quiet so the person keeps their focus: the page pill says "(1 waiting)" and the page picker marks the page. No tab is ever opened or switched. If no tab shows the page, `wait` prints its link: **tell the person in the chat which page you're waiting on**, with the link.

When they press Done it returns `{page, frame, done, waited, rev, since, changes}`: `changes` is exactly what `obeya changes <page>` would print, and it moves the same cursor. `done` is `"button"`, `"timeout"` (with `--timeout <minutes>`) or `"stopped"` (the server stopped). There is no timeout by default.

- **Run it in the background** if your shell limits how long a command may run (Claude Code: `run_in_background`); you are told when it exits. Stopping the command takes the banner down.
- Keep the ask short and concrete: one sentence that names where and what. Their reply is what they draw: sticky notes, circles, moves.
- Don't repeat the ask in the chat; say which page you're waiting on.

## Checking your work

Check with text, and look once per round:

1. After each patch, read its `warnings` and fix them. They are the same checks as `lint`, for what you touched.
2. After a batch of patches, run `obeya lint <page>` (or `--frame <id>`). It checks the whole page for a few dozen tokens; a screenshot costs a thousand or more.
3. Take **one** screenshot for the round, before you tell the person it's done. Pick its scope by what you changed:

| What you changed this round | The one screenshot |
|---|---|
| A few elements on an existing page | `--around` their ids, plus anything connected to them (an arrow's other end) |
| A frame you built or rearranged | `--frame <id>` |
| A new page, or a restructure across frames | the whole page |

Never take a second, wider shot of the same change. The person has the whole page open and will mark what's wrong (you read it with `changes`), and `lint` and `describe` cover the rest of the page as text.

```bash
obeya shot roadmap --around card-7,card-8 --out shots/check.png   # what you changed, plus a margin
obeya shot roadmap --frame f-login --out shots/login.png           # one frame
```

Prints `{out, width, height, renderer}`; read the PNG with your image tool. `--around` takes the ids from the patch response. If they're all in one frame and the area would cover most of it, you get the frame instead, and `widenedTo` says so. Shots are capped at the size a vision model reads; pass `--scale` only when you need fine detail. `shot` needs no open tab and doesn't open one when it can avoid it (it renders in a headless browser). `obeya show roadmap --frame f-login` points the person's view at a frame.

## Links between frames (clickable prototypes)

Frames act as artboards. Set an element's `link` to jump between them:

- `http://127.0.0.1:<port>/?element=<frame-id>`: a frame on the same page;
- `http://127.0.0.1:<port>/?page=<page>&element=<frame-id>`: a frame on another page.

The person clicks **Present** (top right of the canvas, or Shift+Alt+P) to show frames one at a time, with a laser pointer: ← → or the ‹ › controls step through them in slide order, starting at the first frame in slide order (name frames `01 …`, `02 …`), and Esc stops. For a clickable area over text or a group (a table row, a card), add a transparent rectangle with the `link`: while presenting, a click anywhere inside a linked element's box follows it.

## Export: files for people who don't have the tool

```bash
obeya export roadmap --format svg --frame f-login --out out/login.svg
obeya export roadmap --format png --frames --out out/frames/          # 01-login.png, 02-…
obeya export roadmap flows --format html --title "Checkout review" --out out/deck.html
obeya export roadmap --format pdf --out out/deck.pdf
```

- `--out` is required. Exports need no open tab: the person's tab renders if one is connected, otherwise the CLI uses a headless Chrome without disturbing anyone.
- Slides are frames, ordered by a numeric prefix in the frame name (`01 Login`, `02 Home`), then `customData.order`, then position. `--order id,id` picks and orders frames. Name frames with numeric prefixes when you create a flow.
- The HTML deck is one self-contained file (no network requests): arrow keys or click to advance, `n` shows speaker notes from a frame's `customData.notes`, and prototype links between frames become clickable hotspots. It prints one slide per page. The PDF is that deck printed by headless Chrome, as vectors.
- SVGs embed their fonts. Image options (svg, png): `--embed-scene` lets the file be reopened in Excalidraw, `--scale n`, `--padding n` (default 20), `--no-background` (transparent), `--dark`.
- The person can export too: ☰ → Export… (or Cmd/Ctrl+Shift+E) downloads PNG, SVG, PDF or an HTML deck of the current page, and "Copy as CLI command" gives you the same export as a command.
- Links into the canvas are removed from exported images (they would point at the person's machine); ordinary web links stay.

## Safety

- Everything is local. The server listens on `127.0.0.1` only and refuses requests from other websites; drawings, annotations and screenshots never leave the machine. Only Excalidraw's library code and fonts load from a pinned CDN.
- Don't send drawing content, screenshots or canvas links to any external service unless the person asks you to.
- The canvas link (`url`) is a plain local address (`http://127.0.0.1:<port>/?page=…`); the person can bookmark it.
- Don't edit files under `<dir>/.obeya/`; that is the tool's own state.
