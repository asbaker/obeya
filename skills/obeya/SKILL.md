---
name: obeya
description: "Draw on a live Excalidraw canvas that the person also has open in their browser, and read back what they drew, moved or annotated. Use when the user asks to sketch, diagram, wireframe, story-map or brainstorm visually with you, to put something on 'the canvas', 'the board', 'the wall' or 'the whiteboard', or to look at what they changed there. Local only: drawings stay on this machine as .excalidraw files. Do not use for one-off image generation that the person won't edit."
allowed-tools: Bash(obeya:*), Bash(npx obeya:*)
---

# obeya

A canvas you share with the person: they draw in a browser tab, you work through the `obeya` CLI, which prints JSON. Pages are plain `.excalidraw` files on this machine.

Install the CLI if `obeya --version` fails: `npm i -g obeya` (Node 22.20 or later). Ask the person before installing anything globally.

## Start here

This file is a pointer, not the guide. Before your first `obeya` command, run:

```bash
obeya --skill
```

and follow what it prints. It comes from the installed CLI, so it always matches that version; this file can't change between releases.

## Before you start

- **Where pages live** is the person's choice. If they haven't said, ask, then pass `--dir <folder>` (default `./obeya` in the current directory). Don't create folders or files they didn't ask for.
- **Ports** are picked per pages folder; `obeya status` and `obeya open` print the link. Don't guess ports.
- "The board", "the wall" and "the whiteboard" mean a page.
