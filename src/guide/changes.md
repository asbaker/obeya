# Reading what the person did

```bash
obeya changes roadmap       # the person's edits since your last read, then moves your cursor
```

The cursor survives restarts, so calling it twice in a row returns nothing the second time. Your own edits are left out. Flags:

- `--since <rev>`: read from a revision instead; moves no cursor.
- `--source agent`: your own edits (and other agents'); `--source all`: both, each entry with its `source`.
- `--consumer <name>`: a separate cursor, if several tools read the same page.

Each entry has `op` (`added`, `modified`, `relabeled`, `deleted`, `restored`), `id`, `type`, `text` (in full when added or reworded; otherwise the first 80 characters), and where relevant:

- `fields`: what else a `modified` changed (`backgroundColor`, `customData`, …);
- `moved: {from: [x, y], to: [x, y]}`;
- `frameChange: {from, to}` when an element entered or left a frame (`frame` is the current one);
- `pointsAt: [{id, type, text}]` for an annotation the person added (ellipse, freehand, arrow, rectangle, sticky note, text, line): what it covers or points to, best match first. Arrows use their bindings or what their tip touches. A note dropped inside an area that holds other notes (a column, a lane) doesn't point at the area.

Edits to a label are reported once, as `relabeled` on the container; consecutive edits to the same element merge into one entry.

Treat annotations as instructions: a circled sticky with a comment next to it means "this one", so read `pointsAt` and the comment's `text` together. Before you move something they marked, move their marks with it or ask, or their circle ends up pointing at nothing.

## Bands

Hear about moves across lines that matter (a release line, swimlanes). Register once per session; `set` is idempotent:

```bash
obeya band set roadmap release-1 --y 600            # a horizontal line
obeya band set roadmap lane-backend --y 700 --to 900 # a horizontal strip (--x for vertical)
obeya band list roadmap
```

A move whose element centre changes side gets `crossed: [{band, from, to}]`, with sides `before` (above / left), `inside`, `after` (below / right). For a negative coordinate write `--y=-50`.
