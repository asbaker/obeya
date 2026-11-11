# Clickable prototypes and presenting

Frames act as artboards. Set an element's `link` to jump between them:

- `http://127.0.0.1:<port>/?element=<frame-id>`: a frame on the same page;
- `http://127.0.0.1:<port>/?page=<page>&element=<frame-id>`: a frame on another page (encode a `/` in the name as `%2F`).

The port is the one `obeya status` shows. For a clickable area over text or a group (a table row, a card), add a transparent rectangle with the `link`: while presenting, a click anywhere inside a linked element's box follows it.

The person clicks **Present** (top right, or Shift+Alt+P) to show frames one at a time with a laser pointer: ← → or the ‹ › controls step through them in slide order, Esc stops. Slide order: a numeric prefix in the frame name (`01 Login`, `02 Home`), then `customData.order`, then position. Name frames with numeric prefixes when you build a flow. `obeya show <page> --frame <id>` points the person's view at a frame.

To share it as a file: `--skill export` (the HTML deck keeps the links as hotspots).
