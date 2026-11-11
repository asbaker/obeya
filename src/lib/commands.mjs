// The command table. It drives argument validation and every help screen, so
// the help text can't drift from what the parser accepts.
import { normalizePageName, validPageName } from "./names.mjs";

export const DEFAULT_PORT = 4747;
export const DEFAULT_DIR = "obeya";
export const DEFAULT_IDLE_MINUTES = 720; // 12 hours

/** Global options accepted by every command. */
export const GLOBAL_FLAGS = ["dir", "port", "no-open", "idle-timeout", "help"];

/**
 * @typedef {object} Command
 * @property {string} usage
 * @property {string} summary
 * @property {boolean} [page]      first positional is a required page name
 * @property {number} [maxPositionals]
 * @property {string[]} [flags]    command-specific flags
 * @property {string[]} [required] flags that must be given
 * @property {boolean} [live]      needs a connected canvas tab
 * @property {boolean} [mutating]  changes a drawing
 * @property {string[]} [details]
 */

/** @type {Record<string, Command>} */
export const COMMANDS = {
  serve: {
    usage: "serve",
    summary: "Start the server in the background if it isn't running",
    details: [
      "Prints {url, dir, pid, browsers}. Other commands start the server on their own, so this is rarely needed.",
      "The server stops itself after --idle-timeout minutes (default 720, 12 hours) with no tab connected and no CLI calls, saving first. 0 = never.",
    ],
  },
  status: {
    usage: "status",
    summary: "Report whether the server is running and how many tabs are connected",
    details: ["Never starts the server."],
  },
  stop: {
    usage: "stop",
    summary: "Save pending edits, then shut the server down",
  },
  open: {
    usage: "open [<page>] [--frame <id>]",
    summary: "Open the canvas in a browser tab, or switch an open tab to <page>",
    maxPositionals: 1,
    flags: ["frame"],
    details: [
      "With --no-open, prints the link instead of opening a tab. Links are plain local addresses; bookmarks keep working.",
      "If a tab is already connected, it is switched to <page> and --frame.",
    ],
  },
  pages: {
    usage: "pages",
    summary: "List the pages (one .excalidraw file each)",
  },
  get: {
    usage: "get <page> [--frame <id>] [--full]",
    summary: "Print a page's elements: id, type, box, text, frame, link, data",
    page: true,
    flags: ["frame", "full"],
    details: [
      "Compact: bound text folded into its container as `text`, coordinates rounded. Start with `describe` to find",
      "your way around; use `get --frame <id>` when you need coordinates.",
      "--full: Excalidraw's stored fields, for tools: live elements only, without default values or bookkeeping",
      "(seed, version, …), coordinates to 0.1.",
    ],
  },
  describe: {
    usage: "describe <page> [--format json|text]",
    summary: "A plain-text outline: frames, then their elements with labels, IDs, links and customData",
    page: true,
    flags: ["format"],
    details: ["--format text prints the outline without the JSON envelope."],
    validate(plan, bad) {
      if (plan.flags.format !== undefined && !["json", "text"].includes(plan.flags.format)) throw bad('--format must be "json" or "text"');
    },
  },
  lint: {
    usage: "lint <page> [--frame <id>] [--rule <name,name,…>]",
    summary: "Layout problems: overlaps, clipped text, things outside their frame, loose arrows, near-misses, hidden elements",
    page: true,
    flags: ["frame", "rule"],
    details: [
      "Prints {page, rev, findings: [{rule, ids, frame, message}]}. Findings are hints; nothing is changed.",
      "Rules: overlap, clipped-text, outside-frame, loose-arrow, near-miss, hidden. --rule keeps only those.",
      "patch reports the same findings for the elements it touched, as `warnings`.",
    ],
    validate(plan, bad) {
      const known = ["overlap", "clipped-text", "outside-frame", "loose-arrow", "near-miss", "hidden"];
      const unknown = (plan.flags.rule ?? "").split(",").filter((r) => r && !known.includes(r));
      if (unknown.length) throw bad(`unknown rule(s): ${unknown.join(", ")}; rules are ${known.join(", ")}`);
    },
  },
  patch: {
    usage: "patch <page> --file <path|->",
    summary: "Apply {skeleton?, elements?, delete?, toBack?, toFront?, layout?} through the live editor",
    page: true,
    flags: ["file"],
    required: ["file"],
    live: true,
    mutating: true,
    details: [
      "--file - reads the patch from stdin. --file is required; the command never waits on stdin by default.",
      "Creates the page if it doesn't exist. The patch is one undoable step for the person.",
      "Prints {page, rev, createdPage, created, changed, warnings}: created and changed are counts (labels and the",
      "editor's layout included). To see what the editor changed: `changes <page> --source agent --since <rev before>`.",
      "layout: align, distribute, grid, place (the next free spot in a frame or shape) and stack directives, applied in the same undo step.",
      "The response's warnings are lint findings (see `lint --help`) that involve what the patch touched.",
    ],
  },
  changes: {
    usage: "changes <page> [--since last|<rev>] [--source user|agent|all] [--consumer <name>]",
    summary: "What the person changed since your last read, with labels folded and annotations resolved (pointsAt)",
    page: true,
    flags: ["since", "source", "consumer"],
    details: [
      "Defaults: --since last --source user. --since last returns entries after this consumer's",
      "previous `--since last` read, then moves its cursor; --since <rev> reads from a revision and moves nothing.",
      "--source agent: your own edits (and other agents'); --source all: both, each entry with its `source`.",
      "--consumer defaults to $OBEYA_CONSUMER or \"default\".",
    ],
  },
  shot: {
    usage: "shot <page> [--frame <id> | --around <id,id,…>] [--out <png>] [--scale <n>]",
    summary: "Save a PNG of a page, a frame, or the area around some elements",
    page: true,
    flags: ["frame", "around", "out", "scale"],
    validate(plan, bad) {
      const { frame, around } = plan.flags;
      if (around === undefined) return;
      if (frame !== undefined) throw bad("use --frame or --around, not both");
      plan.around = around.split(",").map((s) => s.trim()).filter(Boolean);
      if (!plan.around.length) throw bad("--around needs element ids, comma-separated");
    },
    details: [
      "--around crops to those elements plus a margin, with whatever else is in that area:",
      "the cheapest way to check what you just changed. If they're all in one frame and the area",
      "would cover most of it, you get the frame instead (`widenedTo` in the result).",
      "--frame shows one frame.",
      "Shots are capped at the size a vision model reads (1568 px long edge, 1.15 megapixels)",
      "unless you pass --scale. Default --out is <dir>/.obeya/shots/<page>[-<frame>|-around].png.",
      "Needs no open tab and never opens one if it can avoid it: the person's tab renders if one is",
      "connected, else a headless Chrome, else the official `excalidraw render` (@excalidraw/cli) if",
      "installed (never installed for you), else a tab is opened (exit 2 with --no-open).",
      "`renderer` in the result says which: tab, headless, excalidraw-cli.",
    ],
  },
  show: {
    usage: "show <page> [--frame <id>]",
    summary: "Point the person's view at a page or frame",
    page: true,
    flags: ["frame"],
    live: true,
  },
  wait: {
    usage: "wait <page> --ask <text> [--frame <id>] [--timeout <minutes>] [--consumer <name>]",
    summary: "Ask the person for something on a page; return their changes when they press Done",
    page: true,
    flags: ["ask", "frame", "timeout", "consumer"],
    required: ["ask"],
    details: [
      "Tabs showing the page show --ask in a banner with a Done button (and outline --frame). Other tabs stay quiet: the page",
      "pill counts pages waited on and the picker marks them. No tab is opened or switched; if none shows the page, the link is printed.",
      "Returns {page, frame, done, waited, rev, since, changes} when the person presses Done (done: \"button\"), on --timeout",
      "(\"timeout\"), or when the server stops (\"stopped\"). `changes` is what `changes <page>` would print, and moves the same cursor.",
      "No timeout by default: run it in the background if your shell limits how long a command may run; stopping the command",
      "takes the banner down.",
    ],
    validate(plan, bad) {
      const { ask, timeout } = plan.flags;
      if (!ask.trim() || ask.length > 500) throw bad("--ask is the text to show the person (1-500 characters)");
      if (timeout !== undefined && !(/^\d+(\.\d+)?$/.test(timeout) && Number(timeout) > 0)) throw bad("--timeout is a number of minutes");
    },
  },
  export: {
    usage: "export <page>... --format svg|png|pdf|html --out <path> [--frame <id> | --frames] [--order <id,id,…>] [--title <text>] [--scale <n>] [--padding <n>] [--no-background] [--dark] [--embed-scene]",
    summary: "Files to share: an image, one image per frame, a PDF, or a self-contained HTML slideshow",
    pages: true,
    flags: ["format", "out", "frame", "frames", "order", "title", "embed-scene", "scale", "padding", "no-background", "dark"],
    required: ["format", "out"],
    mutating: true,
    details: [
      "svg|png: one page; the whole page, --frame <id>, or --frames (one file per frame into the --out directory,",
      "  named 01-<frame-name>.svg in slide order). SVGs embed their fonts. --embed-scene makes the file reopenable in Excalidraw.",
      "  --padding <n> pixels around the image (default 20), --no-background for a transparent one, --dark for the dark theme.",
      "html: one self-contained file, no network requests: arrow keys or click to advance, `n` for speaker notes",
      "  (frame customData.notes), prototype links become clickable hotspots, prints one slide per page.",
      "pdf: the HTML deck printed by headless Chrome or Chromium (CHROME_PATH to choose); vector output.",
      "Slide order: numeric prefix in the frame name, then customData.order, then position (rows, top to bottom,",
      "  left to right). --order id,id,… picks and orders frames. Several pages are joined in the order given.",
      "--title adds a title slide (html, pdf). A page without frames is one slide.",
      "Needs no open tab: renders in the person's tab if one is connected, otherwise in a headless Chrome it starts.",
    ],
    validate(plan, bad) {
      const f = plan.flags;
      const fmt = f.format;
      if (!["svg", "png", "pdf", "html"].includes(fmt)) throw bad("--format must be svg, png, pdf or html");
      const image = fmt === "svg" || fmt === "png";
      if (image && plan.pages.length > 1) throw bad(`--format ${fmt} takes one page; use html or pdf for several`);
      if (f.frame && f.frames) throw bad("give --frame or --frames, not both");
      if (!image && (f.frame || f.frames)) throw bad("--frame/--frames are for svg and png; decks always use frames");
      if (!image && (f["embed-scene"] || f.scale || f.padding !== undefined || f["no-background"] || f.dark)) throw bad("--scale, --padding, --no-background, --dark and --embed-scene are for svg and png");
      if (f.padding !== undefined && !(/^\d+$/.test(f.padding) && Number(f.padding) <= 400)) throw bad("--padding is a whole number of pixels, 0 to 400");
      if (image && f.title) throw bad("--title is for html and pdf");
      if (f.order && image && !f.frames) throw bad("--order needs --frames (or html/pdf)");
      if (f.order !== undefined && !/^[^,\s]+(,[^,\s]+)*$/.test(f.order)) throw bad("--order is a comma-separated list of frame ids");
    },
  },
  library: {
    usage: "library <subcommand>",
    summary: "Component libraries on demand: search the public catalogue, look at items, insert copies",
    details: [
      "Libraries come from the public Excalidraw catalogue (github.com/excalidraw/excalidraw-libraries),",
      "a local .excalidrawlib file, or an https URL, and are cached per user. Only downloads happen;",
      "nothing about your drawings is sent. Items are addressed as <lib>/<item>; read them from `library show`.",
      "Many popular libraries have unnamed items (item-1, item-2, …): use `library show <lib> --sheet <png>`",
      "and look at the picture to choose. The person sees cached libraries in the editor's library sidebar.",
    ],
    subcommands: {
      search: {
        usage: "library search <words>... [--limit <n>]",
        summary: "Search the catalogue by name, item names, description and author",
        words: true,
        flags: ["limit"],
        details: [
          "Results: {id, name, description, authors, items, named, downloads, cached}. `named: false` means items",
          "have no names; prefer named libraries when they fit. The catalogue is refreshed at most once a day.",
        ],
        validate(plan, bad) {
          if (plan.flags.limit !== undefined && !/^[1-9]\d{0,2}$/.test(plan.flags.limit)) throw bad("--limit is 1-999");
        },
      },
      list: {
        usage: "library list",
        summary: "The libraries in your cache (no network)",
      },
      show: {
        usage: "library show <lib> [--sheet <png>]",
        summary: "A library's items with sizes, downloading it on first use; --sheet renders a labelled contact sheet",
        args: ["lib"],
        flags: ["sheet"],
        details: [
          "--sheet writes a PNG grid of every item labelled with its <lib>/<item> id (48 per image; more items",
          "make <name>-1.png, <name>-2.png, …). Needs no open tab: it renders like `export`.",
        ],
      },
      add: {
        usage: "library add <catalogue-id | file.excalidrawlib | https-url> [--as <id>]",
        summary: "Add a library to your cache",
        args: ["source"],
        flags: ["as"],
        mutating: true,
        details: ["--as names a file or URL library (default: its file name). Only the file name of a local file is recorded."],
      },
      remove: {
        usage: "library remove <lib>",
        summary: "Remove a library from your cache",
        args: ["lib"],
        mutating: true,
      },
      insert: {
        usage: "library insert <lib>/<item> <page> --at <x,y> [--frame <id>] [--id <prefix>]",
        summary: "Insert a copy of an item with its top-left at x,y; ids are <prefix>-1, <prefix>-2, …",
        page: true,
        args: ["item"],
        argsFirst: true,
        flags: ["at", "frame", "id"],
        required: ["at"],
        live: true,
        mutating: true,
        details: [
          "Downloads the library on first use. --id defaults to the item id plus a short random suffix;",
          "the response lists every id created. --frame puts the copy in that frame.",
          "For negative coordinates write --at=-40,120.",
        ],
        validate(plan, bad) {
          if (!/^[a-z0-9][a-z0-9._-]*\/[a-z0-9._-]+$/i.test(plan.args.item)) throw bad("the item is <lib>/<item>, as printed by `library show`");
          if (!/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/.test(plan.flags.at)) throw bad("--at is x,y in scene units, e.g. --at 120,80");
          if (plan.flags.id !== undefined && !/^[a-z0-9][a-z0-9._-]{0,47}$/i.test(plan.flags.id)) throw bad("--id is 1-48 letters, digits, . _ -");
        },
      },
    },
  },
  rename: {
    usage: "rename <page> <new-name>",
    summary: "Rename or move a page (a/b moves it into folder a); its change log, bands and cursors move with it, and open tabs follow",
    page: true,
    args: ["to"],
    mutating: true,
    details: [
      "Needs no open tab. `staleLinks` in the result lists element links that still name the old page",
      "(?page=<old>&element=…); update them with a patch.",
    ],
    validate(plan, bad) {
      plan.args.to = normalizePageName(plan.args.to);
      if (!validPageName(plan.args.to)) throw bad(`bad page name "${plan.args.to}" (parts joined by /; no \\ : * ? " < > |, no part starting with .)`);
    },
  },
  band: {
    usage: "band <subcommand>",
    summary: "Named horizontal or vertical bands (e.g. a release line); `changes` reports moves across them",
    details: [
      "A band is a line (--y 600) or a strip (--y 600 --to 800) across the page. `changes` adds",
      "crossed: [{band, from, to}] to a move whose element centre changed side, where a side is",
      "\"before\" (above / left), \"inside\" or \"after\" (below / right). Bands are runtime state",
      "kept by the tool (git-ignored); callers register them, e.g. on startup.",
    ],
    subcommands: {
      list: {
        usage: "band list <page>",
        summary: "List a page's bands",
        page: true,
      },
      set: {
        usage: "band set <page> <name> (--y <n> | --x <n>) [--to <n>]",
        summary: "Create or replace a band: --y for a horizontal one, --x for a vertical one",
        page: true,
        args: ["name"],
        flags: ["x", "y", "to"],
        mutating: true,
        validate(plan, bad) {
          const { x, y, to } = plan.flags;
          if ((x === undefined) === (y === undefined)) throw bad("give exactly one of --x or --y");
          const num = (v) => /^-?\d+(\.\d+)?$/.test(v);
          if (!num(x ?? y) || (to !== undefined && !num(to))) throw bad("--x, --y and --to take numbers");
          if (to !== undefined && Number(to) < Number(x ?? y)) throw bad("--to must not be less than the start");
          if (!/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(plan.args.name)) throw bad("band names are 1-64 letters, digits, . _ -");
        },
      },
      delete: {
        usage: "band delete <page> <name>",
        summary: "Remove a band",
        page: true,
        args: ["name"],
        mutating: true,
      },
    },
  },
};

/** Resolve "band set" (or "patch") to its spec. */
export function lookup(name) {
  const [cmd, sub] = name.split(" ");
  const spec = COMMANDS[cmd];
  return sub ? spec?.subcommands?.[sub] : spec;
}

export function groupHelp(name) {
  const g = COMMANDS[name];
  const rows = Object.values(g.subcommands).map((c) => `  obeya ${c.usage}\n      ${c.summary}`);
  return [`obeya ${name} commands:`, ...rows, "", ...(g.details ?? []), "", `Run \`obeya ${name} <subcommand> --help\` for details.`].join("\n");
}

/** Option types for node:util parseArgs. */
export const OPTION_TYPES = {
  dir: { type: "string" },
  port: { type: "string" },
  "no-open": { type: "boolean" },
  "idle-timeout": { type: "string" },
  help: { type: "boolean", short: "h" },
  skill: { type: "boolean" },
  version: { type: "boolean", short: "V" },
  frame: { type: "string" },
  around: { type: "string" },
  ask: { type: "string" },
  timeout: { type: "string" },
  rule: { type: "string" },
  full: { type: "boolean" },
  format: { type: "string" },
  file: { type: "string" },
  since: { type: "string" },
  source: { type: "string" },
  consumer: { type: "string" },
  out: { type: "string" },
  scale: { type: "string" },
  x: { type: "string" },
  y: { type: "string" },
  to: { type: "string" },
  frames: { type: "boolean" },
  at: { type: "string" },
  limit: { type: "string" },
  sheet: { type: "string" },
  as: { type: "string" },
  id: { type: "string" },
  order: { type: "string" },
  title: { type: "string" },
  "embed-scene": { type: "boolean" },
  padding: { type: "string" },
  "no-background": { type: "boolean" },
  dark: { type: "boolean" },
};

const pad = (s, n) => s + " ".repeat(Math.max(1, n - s.length));

export function overviewHelp() {
  const rows = Object.values(COMMANDS).map((c) => `  obeya ${c.usage}\n      ${c.summary}`);
  return [
    "obeya — a canvas you share with your AI agent",
    "A local Excalidraw canvas: you draw in your browser, your agent works through this CLI.",
    "",
    "Usage: obeya <command> [<page>] [options]",
    "",
    "Commands:",
    ...rows,
    "",
    "Global options:",
    `  ${pad("--dir <path>", 20)}Pages directory (default ./${DEFAULT_DIR}, env OBEYA_DIR)`,
    `  ${pad("--port <n>", 20)}Server port (default: the pages folder's own, from ${DEFAULT_PORT}; env OBEYA_PORT)`,
    `  ${pad("--no-open", 20)}Never open a browser tab; print the link and exit 2 instead`,
    `  ${pad("--idle-timeout <m>", 20)}A server started by this command stops after <m> idle minutes (default ${DEFAULT_IDLE_MINUTES}, 0 = never, env OBEYA_IDLE_TIMEOUT)`,
    `  ${pad("--skill", 20)}Print the agent skill file (SKILL.md) and exit`,
    `  ${pad("--version, -V", 20)}Print version and exit`,
    `  ${pad("--help, -h", 20)}Show this help, or a command's help after the command`,
    "",
    "Output: one JSON envelope on stdout: {\"id\":\"cli:<command>\",\"result\":…} or {\"id\":…,\"error\":{\"code\",\"message\"}}.",
    "Exit codes: 0 ok, 1 error, 2 the person needs to act (open the printed link).",
    "",
    "Are you an AI agent? Run `obeya --skill` for the full usage guide.",
  ].join("\n");
}

export function commandHelp(name) {
  if (COMMANDS[name]?.subcommands) return groupHelp(name);
  const c = lookup(name);
  const lines = [`Usage: obeya ${c.usage}`, "", c.summary + "."];
  if (c.details?.length) lines.push("", ...c.details);
  const notes = [];
  if (c.live) notes.push("Needs a connected canvas tab: opens one if none is connected (exit 2 with --no-open).");
  if (c.mutating) notes.push(c.pages ? "Writes files; --out is required." : c.page && !c.args ? "Changes the drawing." : "Changes stored state.");
  if (notes.length) lines.push("", ...notes);
  lines.push("", "Global options: --dir <path>, --port <n>, --no-open, --idle-timeout <minutes>. See `obeya --help`.");
  return lines.join("\n");
}
