# Patches

```bash
obeya patch roadmap --file patch.json
obeya patch roadmap --file - <<'JSON'
{"skeleton": [ … ], "elements": [ … ], "delete": ["id"], "toBack": ["id"], "toFront": ["id"], "layout": [ … ]}
JSON
```

- `skeleton`: create elements with Excalidraw's skeleton API; the editor does the layout (text wrapping, sticky-note sizing, arrow binding). Give every element your own `id`. Types: `rectangle`, `ellipse`, `diamond`, `text`, `arrow`, `line`, `frame`, `stickynote`, `image` (`--skill images`).
- `elements`: partial edits merged onto existing elements by `id`: `x`, `y`, `backgroundColor`, `strokeColor`, `link`, `customData`, `name`. New elements need `skeleton`. A `link` to a page or element is relative: `?page=<page>&element=<id>`, never `http://127.0.0.1:<port>/…` (the port can change).
- `delete`: ids; deleting a container deletes its label.
- `toBack` / `toFront`: new elements land on top, so send backgrounds, bands and guide lines to the back.
- The response is `{rev, created, changed, warnings, fixes}` (`createdPage: true` when it made the page); `created` and `changed` are counts (labels and the editor's layout included); `fixes` says how to fix each warning's rule. To see exactly what the editor did: `obeya changes <page> --source agent --since <rev before the patch>`.

Sticky notes in a frame, a labelled box, and an arrow bound to both:

```json
{"skeleton": [
  {"type": "frame", "id": "f-login", "x": 0, "y": 0, "width": 900, "height": 380, "name": "01 Login", "children": ["n-email", "n-sso", "box-api", "a-sso-api"]},
  {"type": "stickynote", "id": "n-email", "x": 40, "y": 60, "label": {"text": "Email + password"}},
  {"type": "stickynote", "id": "n-sso", "x": 340, "y": 60, "backgroundColor": "#a5d8ff", "label": {"text": "Sign in with SSO"}},
  {"type": "rectangle", "id": "box-api", "x": 700, "y": 80, "width": 180, "height": 80, "label": {"text": "API"}},
  {"type": "arrow", "id": "a-sso-api", "x": 590, "y": 120, "start": {"id": "n-sso"}, "end": {"id": "box-api"}}
]}
```

## Defaults: the page's base style

```json
{"defaults": {"rectangle": {"backgroundColor": "#f8f9fa", "fillStyle": "solid", "roundness": {"type": 3}},
              "label": {"fontSize": 16, "textAlign": "left"}},
 "skeleton": [{"type": "rectangle", "id": "s1", "x": 40, "y": 150, "width": 250, "height": 110, "label": {"text": "Start"}}]}
```

Keys are element types, `label` (labels) and `*` (everything). An element's own fields win, then its type's, then `*`. They apply to new elements only: re-applying a skeleton to reword a label keeps its style. Override them wherever the content asks for something different; they're a base, not a limit.

Edits and deletes: `{"elements": [{"id": "n-email", "x": 40, "y": 220}, {"id": "n-sso", "customData": {"status": "done"}}], "delete": ["a-sso-api"]}`

## Layout directives

Let the tool do the arithmetic: don't compute coordinates by hand. A guessed position becomes a fix-up patch (and an arrow given `x: 0, y: 0` is drawn in the frame's corner). Applied in order, in the same undo step; things move with their group, frames with their children.

- `{"place": "card-9", "in": "col-done", "end": true}`: the next free spot in a frame or shape (below what's there with `end`), lined up with similar elements, brought to the front. Error `no_room` if it doesn't fit.
- `{"align": "left", "ids": ["a", "b"], "to": "c"}`: `left|right|top|bottom|centre-x|centre-y`; without `to`, to their combined box.
- `{"distribute": "vertical", "ids": ["a", "b", "c"], "gap": 40}`: a fixed gap, or equal gaps between the ends without one.
- `{"grid": ["n1", "n2", "n3", "n4"], "columns": 2, "gap": 24, "at": [100, 200]}`.
- `{"stack": "above", "ids": ["card"], "ref": "column"}`: just above (or `below`) one element. Moving something onto a filled shape? Use `place` or `stack`, or it may end up hidden underneath.

## Make things move the way the person expects

- Give composite objects (a table drawn as box, header and rows; a card with a title and a value) one shared `"groupIds": ["tbl-order"]` on every part, or dragging one part leaves the rest behind.
- Bind connectors (`start: {id}`, `end: {id}`) to anything with an `id`, including sticky notes and elements from earlier patches; unbound arrows stay put when the person moves a box.
- Put text inside shapes as a `label`, not a separate text element.
- To reword a label, re-apply the shape's skeleton with the new `label` and the same `id`: that re-wraps the text. Editing the label's text element directly doesn't.

## What the editor changes

- Frames follow position, as when the person drops something: a new element that lies wholly inside a frame joins it, and an edit that moves an element into a frame (or wholly out of its frame) updates its `frameId`. Give `frameId` (or `null`) to say otherwise.
- A frame created with `children` is re-fitted around them: its `x`, `y`, `width`, `height` are not kept. A frame created without `children` keeps its box, and the elements inside it join by position: the easy way to an exact artboard.
- Arrows are re-routed between their bound shapes.
- Read positions back with `get` instead of assuming them.

## Generate big patches

More than ~10 elements, or anything repeated (rows, tables, steps): write a short script that prints the patch, and pipe it in. It's 20–70% shorter than the JSON it prints, and you can edit and re-run it.

```js
// page.mjs: node page.mjs | obeya patch <page> --file -
const S = [];
const box = (id, x, y, text) => S.push({ type: "rectangle", id, x, y, width: 250, height: 110, label: { text } });
["Start", "Build", "Ship"].forEach((t, i) => box(`s${i}`, 0, 0, t));
S.push({ type: "frame", id: "f1", x: 0, y: 0, width: 1600, height: 900, name: "01 Flow" });
console.log(JSON.stringify({
  defaults: { rectangle: { backgroundColor: "#f8f9fa", fillStyle: "solid" } },
  skeleton: S,
  layout: [{ grid: ["s0", "s1", "s2"], columns: 3, gap: 60, at: [40, 150] }],
}));
```

Keep generated ids stable (`s0`, `s1`, …) so a re-run updates what's there instead of adding copies.
