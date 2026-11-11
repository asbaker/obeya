# Export: files for people who don't have the tool

```bash
obeya export roadmap --format svg --frame f-login --out out/login.svg
obeya export roadmap --format png --frames --out out/frames/          # 01-login.png, 02-…
obeya export roadmap flows --format html --title "Checkout review" --out out/deck.html
obeya export roadmap --format pdf --out out/deck.pdf
```

- `--out` is required. No open tab needed: the person's tab renders if one is connected, otherwise a headless Chrome, without disturbing anyone.
- Slides are frames, in slide order (numeric name prefix, then `customData.order`, then position); `--order id,id` picks and orders them. Several pages are joined in the order given.
- The HTML deck is one self-contained file with no network requests: arrow keys or click to advance, `n` shows speaker notes from a frame's `customData.notes`, prototype links become hotspots, prints one slide per page. The PDF is that deck printed by headless Chrome, as vectors.
- svg and png: SVGs embed their fonts; `--embed-scene` (reopenable in Excalidraw), `--scale n`, `--padding n` (default 20), `--no-background`, `--dark`.
- Links into the canvas are removed from exported images (they'd point at this machine); ordinary web links stay.
- The person can export too: ☰ → Export… (Cmd/Ctrl+Shift+E), with "Copy as CLI command" for the same export.
