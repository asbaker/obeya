<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="src/page/logo-lockup-dark.svg">
    <img src="src/page/logo-lockup.svg" alt="obeya" height="64">
  </picture>
</p>

<p align="center"><b>Draw with your AI agent. It sees what you circle.</b></p>

<p align="center">
  <img src="https://img.shields.io/badge/license-MIT-007ec6" alt="license: MIT">
  <img src="https://img.shields.io/badge/node-%E2%89%A5%2022.20-007ec6" alt="node: ≥ 22.20">
  <img src="https://img.shields.io/badge/telemetry-none-2c974b" alt="telemetry: none">
  <img src="https://img.shields.io/badge/dependencies-0-2c974b" alt="dependencies: 0">
</p>

**Your agent draws instead of describing.** No more ASCII diagrams in your terminal. Your agent sketches its thinking on a real Excalidraw canvas in your browser: flows, architectures, roadmaps, wireframes, slides.

**You answer by drawing.** Circle the part that's wrong, drag a card, stick a note on it, the way you would at a whiteboard. Press Done, and your agent sees exactly what you did and what you pointed at, and draws its next move.

**Local only.** Pages are `.excalidraw` files, in whatever folder you keep them.

*Obeya* (大部屋, "big room") is the lean practice of a room whose walls hold the team's plans, charts and artifacts. This is that room, with an agent in it.

<table>
<tr>
<td width="33%" valign="top"><img src="docs/readme/hero-1.png" alt="Three sign-in screens the agent mocked up, and a banner: your agent is waiting for you, which sign-in should we build? Done"></td>
<td width="33%" valign="top"><img src="docs/readme/hero-2.png" alt="The person circles screen B, magic link, and adds a pink note: B, plus a Google button"></td>
<td width="33%" valign="top"><img src="docs/readme/hero-3.png" alt="The agent marks B as chosen, fades A and C, adds Continue with Google to B and replies: building B"></td>
</tr>
<tr>
<td valign="top"><b>1 · It asks on the page</b></td>
<td valign="top"><b>2 · You circle one and press Done</b></td>
<td valign="top"><b>3 · It builds what you chose</b></td>
</tr>
</table>

## Install

**What you need:** Node 22.20 or later, and a browser. Chrome or Chromium is optional: with it, your agent can take screenshots and export files while no canvas tab is open.

```bash
npm i -g obeya                    # the CLI and the canvas server
npx skills add asbaker/obeya -g   # the skill: teaches your agent when and how to use obeya
```

The skill works with Claude Code, Codex, Cursor, OpenCode and more. Or paste this to your agent, and it installs both, asking first:

```text
Set up obeya: https://github.com/asbaker/obeya/blob/main/INSTALL.md
```

### Your first drawing

In any project, try:

```text
Use obeya to draw how this project fits together. Put the page in docs/obeya.
```

Your agent starts obeya in the background and opens the canvas in your browser. Keep that tab open: it's where you both draw. Pages are saved as you go.

### Update or remove

`npm update -g obeya` and `npx skills update obeya` keep both current; [CHANGELOG.md](CHANGELOG.md) says what's new. Removing obeya leaves your pages where they are; see [INSTALL.md](INSTALL.md#updating-and-removing).

## How it works

<p align="center"><img src="docs/readme/how-it-works.png" alt="You, the canvas (Excalidraw in a browser tab), the obeya server (saves .excalidraw files) and your agent (the obeya CLI), all on your machine, 127.0.0.1 only"></p>

1. **Ask for a picture.** *"Map out how a request flows through this app."* Your agent draws it in your open tab, live, and points your view at it.
2. **React on the canvas.** Circle, drag, cross out, add sticky notes. No need to put it into words.
3. **Press Done, or say "take a look".** Your agent reads what you changed and what each mark points at, then answers on the page: it moves cards, adds options, redraws.

Every change goes through the live editor, so your open tab stays in step. Pages are plain `.excalidraw` files: commit them, or keep them out of git.

## Example use cases

Each example was drawn by an agent through obeya (Claude Code with Claude Opus 5.5). Results depend on your agent.

<table>
<tr>
<td width="33%" valign="top"><img src="docs/readme/kanban.png" alt="A team board: To do, Doing, Review and Done columns of sticky notes, coloured by kind"><br><b>Kanban board</b><br>Drag a card: your agent sees it move</td>
<td width="33%" valign="top"><img src="docs/readme/story-map.png" alt="A story map with release lines"><br><b>Story map</b><br>Release lines your agent can watch</td>
<td width="33%" valign="top"><img src="docs/readme/roadmap.png" alt="A roadmap with a today line"><br><b>Roadmap</b><br>Lanes and a today line</td>
</tr>
<tr>
<td valign="top"><img src="docs/readme/data-model.png" alt="A data model"><br><b>Data model</b><br>Tables and how they relate</td>
<td valign="top"><img src="docs/readme/prototype.png" alt="Three phone screens built from wireframe components, linked into a clickable prototype"><br><b>Clickable prototype</b><br>Click through it in Present mode</td>
<td valign="top"><img src="docs/readme/deck.png" alt="Four slides: a title, bullets, a diagram and a chart"><br><b>Slides</b><br>Exported as one offline HTML file</td>
</tr>
<tr>
<td valign="top"><img src="docs/readme/refactor-plan.png" alt="A refactor plan: three big files on the left, split into folders of smaller files on the right, with a note"><br><b>Refactor plan</b><br>Before and after, before any code moves</td>
<td valign="top"><img src="docs/readme/mermaid.png" alt="Mermaid text beside the flowchart it became, drawn as editable shapes"><br><b>Mermaid diagrams</b><br>Editable shapes; change the text and run it again to redraw</td>
<td valign="top"><img src="docs/readme/architecture.png" alt="A checkout architecture drawn with AWS service icons: CloudFront, API Gateway, Lambda, DynamoDB, EventBridge, SQS and SES"><br><b>Architecture</b><br>Real service icons from public libraries</td>
</tr>
</table>

The prototype uses components from [ecommerce mobile ui](https://github.com/excalidraw/excalidraw-libraries/blob/main/libraries/webkul/ecommerce-mobile-ui.excalidrawlib) by Webkul Software (MIT), and the architecture uses [AWS Serverless Icons v2](https://github.com/excalidraw/excalidraw-libraries/blob/main/libraries/stojanovic/aws-serverless-icons-v2.excalidrawlib) by slobodan, both from the public Excalidraw libraries catalogue.

## What you get

<table>
<tr>
<td width="33%" valign="top"><b>It draws instead of describing</b><br>Diagrams, flows, wireframes and slides on a real canvas, not ASCII in a terminal.</td>
<td width="33%" valign="top"><b>You answer by drawing</b><br>Circle, arrow, sticky note, drag. It reads what you did and what each mark points at.</td>
<td width="33%" valign="top"><b>It checks its own work</b><br>It checks the page for overlaps, clipped text and hard-to-read colours, fixes them, and takes one screenshot of what it built.</td>
</tr>
<tr>
<td valign="top"><b>It shows you where to look</b><br>It moves your view to the right frame while you talk.</td>
<td valign="top"><b>Real components</b><br>Wireframe kits, cloud icons, C4 and more, from about 230 public libraries.</td>
<td valign="top"><b>Share the result</b><br>Present frame by frame with a laser pointer, or export PNG, SVG, PDF or a one-file slideshow.</td>
</tr>
</table>

## The CLI

Your agent drives obeya through a CLI that prints JSON. When it asks which sign-in to build and you circle one, add a note and press Done, this is what it gets back:

```bash
$ obeya wait signup-flow --frame f-signup --ask "Which sign-in should we build? Circle one, add a note, then press Done."
{"result":{"done":"button","rev":366,"changes":[{"op":"added","id":"e1","type":"ellipse","frame":"f-signup","pointsAt":[{"id":"sb-h","type":"text","text":"Sign in with email"},{"id":"sb-sub","type":"text","text":"We'll email you a link. No password."},{"id":"sb-cta","type":"rectangle","text":"Email me a link"}]},{"op":"added","id":"n1","type":"stickynote","text":"B, plus a Google button","frame":"f-signup","pointsAt":[{"id":"sb-shell","type":"rectangle"},{"id":"e1","type":"ellipse"}]}]}}
```

| Command | What it does |
|---|---|
| `obeya patch <page>` | Add, change or delete elements through the live editor |
| `obeya changes <page>` | What the person changed since the agent last looked, and what each annotation points at |
| `obeya wait <page> --ask "…"` | Ask you for something on the page; returns your changes when you press Done |
| `obeya describe <page>` | A plain-text outline of the page |
| `obeya lint <page>` | Overlaps, clipped text, stray elements, low contrast: checks instead of a screenshot |
| `obeya shot <page>` | A PNG of a page, a frame or a few elements, so the agent can look |
| `obeya export <page>` | PNG, SVG, PDF or an HTML slideshow |
| `obeya mermaid <page>` | Draw a Mermaid diagram as editable elements; run it again to update it |
| `obeya library` | Search, view and insert components from public libraries |

- `obeya --skill` prints the guide for the installed version (a short core; `obeya --skill <topic>` for one topic, `obeya --skill all` for everything); the installed skill points at it.
- Every command prints one compact JSON line, `{result}` or `{error: {code, message, hint}}`, holding only what an agent acts on; a success with nothing to report prints nothing.
- `obeya --help` lists the rest.

## Privacy and security

- 🔒 Listens on `127.0.0.1` only.
- 🛡️ Other websites open in your browser can't reach it (it checks `Host`, `Origin` and `Sec-Fetch-Site`).
- ⚠️ No login or token: other programs and users on the same machine can reach it, as with most local dev servers.
- 🚫 No telemetry. Pages, screenshots and exports never leave your machine.
- ⬇️ Downloads only: the pinned Excalidraw editor, its Mermaid converter and fonts (from `esm.sh`), and component libraries you ask for. Your Mermaid text is converted in your browser.

## FAQ

**What does it change about working with an agent?**

obeya was planned and designed in obeya. What changed:

- **Decisions come faster.** The agent lays out the options side by side, as mockups or numbered questions. You circle one, dot-vote, or write "yes" next to it, with no long back-and-forth in chat.
- **You see it before it's built.** The page picker, the export dialog and folders were mocked up and clicked through in Present mode before any code changed.
- **Feedback lands where it belongs.** A sticky note on the draft ("skip the gif, 3 stills is fine") says exactly what you mean and where.
- **Big plans become readable.** A refactor became before/after diagrams and state machines, not a wall of text in the terminal.
- **The page is the record.** Decisions, the roadmap and a done log stay on the canvas, so the next session, or the next agent, picks up where you left off.

**What does it cost my agent?**

Little. Learning obeya costs an agent about 3k tokens, every command prints one compact line with only what the agent acts on, and it checks its work as text before taking a screenshot.

**Is this an official Excalidraw project?**

No. It uses the open-source Excalidraw editor (MIT) at a pinned version.

**Where do my pages go?**

Wherever you say: any folder, in or out of a project (`--dir`, or `OBEYA_DIR`; `./obeya` if you don't say). obeya adds only a hidden `.obeya/` inside it (change logs, logs, screenshots), which git ignores.

**Which agents work?**

Any agent that can run shell commands, such as Claude Code, Codex, Cursor or OpenCode. The skill installs into most of them.

## Development

With [mise](https://mise.jdx.dev) (pins Node; `mise tasks` lists the rest):

```bash
mise install && mise run setup   # Node, then playwright-core (used only by the smoke test)
mise run test                    # unit and integration tests (node --test)
mise run smoke                   # browser smoke test: needs Chrome or Chromium (CHROME_PATH=…)
mise run check                   # both
```

Without mise, on Node 22.20 or later: `npm install`, `npm test`, `npm run test:smoke`. From a checkout, run `node bin/obeya.mjs …` or `npm link`.

Made with obeya itself: the logo (`mise run brand` opens `docs/brand/logo.excalidraw`, `mise run logo` exports it) and every image here (`mise run stills` redraws the pages in `docs/readme/` and exports them; `node docs/readme/stills.mjs kanban` redraws one).

## License

MIT. See [LICENSE](LICENSE). Not affiliated with Excalidraw.
