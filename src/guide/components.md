# Components: the parts drawings are made of

Compose drawings from parts with names you already know from UI kits (Mantine, shadcn, Material, Ant Design) and information design. Use the vocabulary, not a default skin: each part takes the page's look (`--skill design`). Adapt, combine and invent freely.

## The vocabulary

- **Structure:** header (eyebrow, title, one line of why), section band (a tinted, titled group), divider (a hairline, optionally labelled), breadcrumb (`v0.3 › spec › R3`, the last one strong), tabs (labels with the current one underlined).
- **Things:** card (title, one line, optional inset stripe or chip), avatar (a circle with initials; a group overlaps), chip (a small rounded label: status, tag, owner), status dot (a coloured dot and a word), key-value list (muted keys, strong values in two columns), code block (mono on a dark surface).
- **Relations:** flow (steps joined by arrows), stepper (numbered circles on a line; done ones filled), timeline (an axis with dated marks), tree (a root and children), lanes (horizontal bands, one per role or system), 2×2 matrix (two axes, items placed).
- **Comparison:** table (a tinted header row, hairlines, ✓ and ✗), options A B C (side by side, the lean marked), before / after (two panels and an arrow).
- **Emphasis:** stat callout (one big number, a small label), meter (a track and a fill, "4 of 10"), alert (a tinted box, an icon and a short message: info, warning, danger), blockquote (a bar and someone's words), legend (swatches and what they mean).
- **Asking:** question slot (a numbered pin, the question, an empty dashed box to answer in), checklist (boxes, done ones filled), callout (a note with an arrow to what it's about), empty state (a dashed area, a line, an action), skeleton (grey bars where content will go).

Numbered pins for review notes are a patch directive (`--skill patch`).

## Canvas craft

- **Group a component** (`groupIds`) so it moves as one; give its parts ids with a shared prefix.
- **Labels inside shapes** (`label`), not text laid on top; bind arrows with `start`/`end`.
- **Size from the frame** (`--skill design`): a chip on a 2,400-px board is about 44 px tall with 22–26 px text.
- **A stripe on a rounded card** goes inside it as a short rounded pill (inset ~14 px); a square stripe on the edge pokes out of the corners.
- **Full-frame backgrounds** are locked by the server, so they don't get dragged.
- Line up repeated components with `layout` (`grid`, `distribute`, `align`).
