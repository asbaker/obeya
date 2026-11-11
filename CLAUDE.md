# obeya

A local-only shared Excalidraw canvas for a person and an AI agent.

## Layout

- `bin/obeya.mjs`: thin entry; the CLI is `src/cli/`: `main.mjs` (`run(argv, ctx)` returns `{stdout, stderr, code}` so tests call it in-process; command dispatch), `client.mjs` (HTTP client, starting the server, opening a tab), `render.mjs` (who renders: tab, headless Chrome, official CLI), `export.mjs`, `library.mjs`, `ports.mjs` (each pages folder's own port, remembered in the user cache), `images.mjs` (an image `src` in a patch → `fileId` + `files`), `guide.mjs` (what `--skill [topic|all]` prints).
- `src/server/`: the HTTP server, started by the CLI in the background (`main.mjs`: startup, request loop, idle shutdown). Only writer of `.excalidraw` files. `http.mjs` (route table, helpers), `tabs.mjs` (event stream, requests to a tab), `watch.mjs` (folder watching), `routes/` (`pages`, `render`, `info`).
- `src/page/`: the canvas page. `index.html` is a shell; the code is ES modules the browser loads straight from the server (no build step): `main.mjs` (keys, App, mount), `state.mjs` (the one shared state object `S`, URL, constants), `deps.mjs` (React, and Excalidraw from esm.sh pinned at `0.18.0-3c916c5`, the only build with native sticky notes), `server-link.mjs`, `sync.mjs` (editor jobs, saving), `patch.mjs`, `arrows.mjs` (pure; unit-tested), `pages.mjs`, `present.mjs`, `links.mjs`, `render.mjs`, `test-hooks.mjs`, `ui/` (dialogs, the folder field, toast), and `page.css`. The server serves `/page/<name>.mjs` and `/page/ui/<name>.mjs` by a fixed name shape.
- `src/lib/`: pure modules: `args` + `commands` (parsing and every help screen), `merge`, `names` (page names: the rule, folders, case clashes), `geometry` (bounds, overlap), `report` (folding, coalescing, pointsAt, bands), `lint`, `layout` (patch layout directives), `store` (pages, change log, cursors, bands), `deck` (slide order, hotspots, HTML deck), `images` (image types and sizes from bytes; checks on patch files), `exporter` (export assembly shared by the CLI and the export dialog), `zip`, `library` (parsing, catalogue ids, search ranking, placing copies, contact-sheet layout), `libcache` (downloads and the per-user library cache), `chrome` (finding Chrome), `paths`, `security`, `hints` (error code → hint), `defaults` (a patch's base style, applied by the server), `machine` (a tiny state machine helper) + `page-machines` (the canvas page's machines as data). `layout`, `geometry`, `merge`, `names`, `machine` and `page-machines` are also loaded by the canvas page (served from `/lib/`, an allowlist in `server/main.mjs`), so they and anything they import must stay free of Node built-ins.
- `docs/readme/`: the README's stills and their sources (pages drawn by obeya); `mise run stills` (`node docs/readme/stills.mjs`) redraws and exports them. Only original diagrams.
- `docs/brand/logo.excalidraw`: the logo's source, a page (frames `logo-small`, `logo-lockup`); `mise run logo` exports `src/page/logo.svg` and `logo-lockup.svg`. Don't hand-edit the SVGs.
- `src/guide/`: the guide. `core.md` is what `obeya --skill` prints, every session that uses obeya pays for it, so it holds *when* to do things and what never to do (a byte budget is tested); the *how* goes in a topic file (`obeya --skill <topic>`), listed in the core's last section (a test checks the index and the files agree). Keep it in sync with the CLI.
- `skills/obeya/SKILL.md`: the stub `npx skills add asbaker/obeya` installs; it points at `obeya --skill`. A discovery stub, agent-browser style; same `description` as `src/guide/core.md` (a test checks). `INSTALL.md`: the setup guide an agent follows; keep its steps working.
- `test/*.test.mjs`: `npm test` (or `mise run test`). `test/smoke.browser.mjs`: `npm run test:smoke` / `mise run smoke` (needs Chrome). `mise.toml` pins Node and lists the dev tasks.

## Rules

- No runtime dependencies. Node built-ins only; `playwright-core` is a dev dependency for the smoke test.
- Privacy: never put local absolute paths, usernames, email addresses or other personal info in any repo file, including tests, docs and the skill text. Tests use temp dirs.
- Port 4747 is the default and may be in use by a developer's own canvas: never stop it. Tests let the OS pick free ports (ephemeral range), so parallel test files can't race for one.
- Every CLI command prints one compact JSON envelope (`{result}` or `{error: {code, message}}`), never pretty-printed: agents pay for every byte. New errors get a stable `code` and a one-line `hint` in `src/lib/hints.mjs` (a test checks); the guide doesn't list errors. `--help` screens give usage, flags and output shape; advice lives in the guide.
- Mutating commands never run with defaults because arguments are missing.
- Tests never touch the internet: library tests use the local stand-in catalogue in `test/fixtures/catalogue` (`OBEYA_CATALOGUE_URL`) and a temp `OBEYA_CACHE`.
- Moving the Excalidraw pin requires the smoke test to pass. Re-check the arrow-binding workaround in `src/page/arrows.mjs` when it moves.
- Don't commit, push or publish without asking.
