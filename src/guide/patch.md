# Patches

```bash
obeya patch roadmap --file patch.json
obeya patch roadmap --file - <<'JSON'
{"skeleton": [ … ], "elements": [ … ], "delete": ["id"], "toBack": ["id"], "toFront": ["id"], "layout": [ … ]}
JSON
```

- `skeleton`: create elements with Excalidraw's skeleton API; the editor does the layout (text wrapping, sticky-note sizing, arrow binding). Give every element your own `id`. Types: `rectangle`, `ellipse`, `diamond`, `text`, `arrow`, `line`, `frame`, `stickynote`, `image` (`--skill images`).
- `elements`: partial edits merged onto existing elements by `id`: `x`, `y`, `backgroundColor`, `strokeColor`, `link`, `customData`, `name`. New elements need `skeleton`.
- `delete`: ids; deleting a container deletes its label.
- `toBack` / `toFront`: new elements land on top, so send backgrounds, bands and guide lines to the back.
- The response is `{page, rev, createdPage, created, changed, warnings}`; `created` and `changed` are counts (labels and the editor's layout included). To see exactly what the editor did: `obeya changes <page> --source agent --since <rev before the patch>`.

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

Edits and deletes: `{"elements": [{"id": "n-email", "x": 40, "y": 220}, {"id": "n-sso", "customData": {"status": "done"}}], "delete": ["a-sso-api"]}`

## Layout directives

Let the tool do the arithmetic. Applied in order, in the same undo step; things move with their group, frames with their children.

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

- A frame created with `children` is re-fitted around them: its `x`, `y`, `width`, `height` are not kept. For an exact artboard, follow up with an `elements` edit that sets them.
- Arrows are re-routed between their bound shapes.
- Read positions back with `get` instead of assuming them.

For big pages, write a small script that generates the patch JSON and pipe it in: it's shorter than the JSON and easy to re-run.
