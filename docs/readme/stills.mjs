// Make the README's stills (docs/readme/*.png) from the pages in this folder.
//
//   node docs/readme/stills.mjs [still …]   (needs Chrome and playwright-core, like the smoke test)
//
// Every page is drawn by obeya itself, through the CLI and a headless canvas
// tab, on a server of its own (an explicit port, so no port is remembered).
// The hero plays the real loop: the agent draws, a person circles two cards
// and asks with the mouse and keyboard, the agent reads `changes` and answers.
import { createRequire } from "node:module";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const { chromium } = createRequire(path.join(ROOT, "package.json"))("playwright-core");
const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = process.env.STILLS_PORT ?? "4798";
const env = { ...process.env, OBEYA_DIR: HERE, OBEYA_PORT: PORT, OBEYA_IDLE_TIMEOUT: "10" };
const BIN = path.join(ROOT, "bin", "obeya.mjs");

function obeya(args, input) {
  const r = spawnSync(process.execPath, [BIN, ...args], { env, input: input === undefined ? "" : JSON.stringify(input), encoding: "utf8" });
  const out = JSON.parse(r.stdout);
  if (out.error) throw new Error(`obeya ${args.join(" ")}: ${out.error.code} ${out.error.message}`);
  return out.result;
}
const patch = (page, p) => obeya(["patch", page, "--file", "-"], p);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- small drawing helpers ------------------------------------------------------------
const C = { blue: "#a5d8ff", yellow: "#ffec99", green: "#b2f2bb", pink: "#ffc9c9", violet: "#d0bfff", grey: "#e9ecef" };
const note = (id, x, y, text, bg = C.yellow, w = 200, h = 110, size = 18) => ({ type: "stickynote", id, x, y, width: w, height: h, backgroundColor: bg, label: { text, fontSize: size } });
const text = (id, x, y, t, size = 24, extra = {}) => ({ type: "text", id, x, y, text: t, fontSize: size, ...extra });
const box = (id, x, y, w, h, label, o = {}) => ({ type: "rectangle", id, x, y, width: w, height: h, backgroundColor: o.bg ?? "transparent", fillStyle: "solid", strokeColor: o.stroke ?? "#1e1e1e", roundness: o.round === false ? null : { type: 3 }, ...(o.link ? { link: o.link } : {}), ...(label ? { label: { text: label, fontSize: o.size ?? 18, ...(o.labelColor ? { strokeColor: o.labelColor } : {}) } } : {}) });
const frame = (id, x, y, w, h, name, children) => ({ type: "frame", id, x, y, width: w, height: h, name, children });
const arrow = (id, x, y, dx, dy, from, to, label, o = {}) => ({ type: "arrow", id, x, y, width: dx, height: dy, points: [[0, 0], [dx, dy]], ...(from ? { start: { id: from } } : {}), ...(to ? { end: { id: to } } : {}), strokeColor: o.stroke ?? "#495057", ...(label ? { label: { text: label, fontSize: 16 } } : {}) });
const line = (id, x, y, w, o = {}) => ({ type: "line", id, x, y, width: w, height: o.h ?? 0, points: [[0, 0], [w, o.h ?? 0]], strokeColor: o.stroke ?? "#868e96", strokeStyle: o.dash ? "dashed" : "solid", strokeWidth: o.width ?? 2 });
const withChildren = (f, els) => [frame(...f, els.map((e) => e.id)), ...els];

// --- the pages -------------------------------------------------------------------------
function signupFlow() {
  const acts = ["Find us", "Sign up", "Verify", "Get started"];
  const tasks = [["Landing page", "Pricing"], ["Email and password", "Sign in with Google"], ["Enter the code we emailed", "Confirm your phone"], ["Pick a template", "Invite your team"]];
  const els = []; // the frame's own name is the title
  acts.forEach((a, i) => {
    els.push(note(`sf-a${i}`, 40 + i * 280, 60, a, C.blue, 220, 100, 22));
    tasks[i].forEach((t, j) => els.push(note(`sf-t${i}${j}`, 40 + i * 280, 200 + j * 150, t, C.yellow, 220, 120, 18)));
  });
  return withChildren(["f-signup", 0, 0, 1600, 600, "Signup flow"], els);
}

function storyMap() {
  const acts = ["Find a shop", "Book a slot", "Drop off", "Track the repair", "Pick up and pay"];
  const rows = [
    ["Search by area", "See open slots", "Check in at the desk", "Status: waiting / fixing / done", "Pay in the shop"],
    ["Filter by bike type", "Pick a repair", "Leave a note for the mechanic", "Text when it's ready", "Pay online"],
    ["Read reviews", "Get a price up front", "Photo of the damage", "Approve extra work", "Rate the repair"],
  ];
  const els = [text("sm-title", 40, 30, "Bike repair booking · story map", 32)];
  acts.forEach((a, i) => els.push(note(`sm-a${i}`, 40 + i * 300, 100, a, C.blue, 240, 100, 22)));
  rows.forEach((r, j) => r.forEach((t, i) => els.push(note(`sm-s${j}${i}`, 40 + i * 300, 260 + j * 190, t, C.yellow, 240, 130, 18))));
  [["Release 1", 430], ["Release 2", 620]].forEach(([l, y], k) => {
    els.push(line(`sm-r${k}`, 20, y, 1500, { dash: true, stroke: "#e03131" }));
    els.push(text(`sm-rl${k}`, 1320, y - 30, l, 20, { strokeColor: "#e03131" }));
  });
  return withChildren(["f-storymap", 0, 0, 1560, 860, "Story map"], els);
}

function roadmap() {
  const els = [text("rm-title", 40, 30, "Roadmap · 2027", 32)];
  const q = ["Q1", "Q2", "Q3", "Q4"];
  q.forEach((t, i) => {
    els.push(text(`rm-q${i}`, 220 + i * 320 + 140, 100, t, 22));
    if (i) els.push(line(`rm-qd${i}`, 220 + i * 320, 140, 0, { h: 520, stroke: "#dee2e6" }));
  });
  const lanes = [["Mobile", [["Offline mode", 0, 1.4, C.blue], ["Push reminders", 1.6, 2.6, C.blue]]], ["Web", [["New checkout", 0.2, 1.8, C.green], ["Team accounts", 2, 3.8, C.green]]], ["Platform", [["Payments v2", 0, 2.2, C.violet], ["EU data region", 2.4, 3.6, C.violet]]]];
  lanes.forEach(([name, bars], j) => {
    const y = 170 + j * 160;
    els.push(text(`rm-l${j}`, 40, y + 30, name, 22));
    bars.forEach(([label, a, b, bg], k) => els.push(box(`rm-b${j}${k}`, 220 + a * 320, y, (b - a) * 320 - 10, 90, label, { bg, stroke: "#495057" })));
  });
  els.push(line("rm-today", 220 + 1.3 * 320, 130, 0, { h: 540, stroke: "#e03131", width: 3 }));
  els.push(text("rm-today-l", 220 + 1.3 * 320 + 10, 640, "today", 20, { strokeColor: "#e03131" }));
  return withChildren(["f-roadmap", 0, 0, 1540, 700, "Roadmap"], els);
}

function dataModel() {
  const t = (id, x, y, name, rows, bg) => [
    box(`${id}-h`, x, y, 280, 50, name, { bg, round: false, size: 20 }),
    box(`${id}-b`, x, y + 50, 280, rows.length * 34 + 20, null, { bg: "#ffffff", round: false }),
    text(`${id}-r`, x + 16, y + 62, rows.join("\n"), 17, { fontFamily: 3 }),
  ];
  const els = [text("dm-title", 40, 30, "Shop · data model", 32),
    ...t("dm-c", 40, 110, "customer", ["id         uuid", "name       text", "email      text"], C.blue),
    ...t("dm-o", 480, 110, "order", ["id         uuid", "customer   → customer", "placed_at  timestamp", "status     text"], C.yellow),
    ...t("dm-i", 920, 110, "order_item", ["order      → order", "product    → product", "quantity   int"], C.yellow),
    ...t("dm-p", 920, 420, "product", ["id         uuid", "name       text", "price      money"], C.green),
    arrow("dm-a1", 322, 160, 156, 0, "dm-c-h", "dm-o-h", "1 : many"),
    arrow("dm-a2", 762, 160, 156, 0, "dm-o-h", "dm-i-h", "1 : many"),
    arrow("dm-a3", 1060, 262, 0, 156, "dm-i-b", "dm-p-h", "many : 1"),
  ];
  return withChildren(["f-datamodel", 0, 0, 1260, 640, "Data model"], els);
}

// The prototype: three phone screens (frames), drawn shells plus widgets from the
// public `ecommerce-mobile-ui` library (text fields, dropdown, tabs, checkbox,
// toggle, link, back icon), relabelled. Buttons link to the next screen.
const PHONE = { w: 500, h: 940, gap: 160, y: 120 };
const phoneX = (i) => i * (PHONE.w + 40 + PHONE.gap);
function prototypeShells() {
  const grey = { strokeColor: "#868e96" };
  const screens = [
    ["pr-1", "01 Sign up", [
      text("pr-1-h", 26, 110, "Create your account", 34),
      text("pr-1-s", 26, 162, "Free for 14 days. No card needed.", 18, grey),
      ["pr-1-cta", 26, 600, "Create account", "pr-2"],
      line("pr-1-or1", 26, 700, 190, { stroke: "#ced4da" }), text("pr-1-or", 236, 688, "or", 18, grey), line("pr-1-or2", 284, 700, 190, { stroke: "#ced4da" }),
      ["pr-1-g", 26, 740, "Continue with Google", null, true],
    ]],
    ["pr-2", "02 Verify", [
      text("pr-2-nav", 64, 66, "Verify email", 22),
      text("pr-2-h", 26, 150, "Check your inbox", 34),
      text("pr-2-s", 26, 202, "We sent a 6-digit code to\nyou@example.com", 18, grey),
      ...["4", "8", "1", "", "", ""].map((d, k) => ({ ...box(`pr-2-d${k}`, 26 + k * 77.6, 300, 60, 72, d || null, { bg: k < 3 ? "#f1f3f5" : "#ffffff", stroke: k === 3 ? "#1971c2" : "#1e1e1e", size: 30 }), strokeWidth: k === 3 ? 3 : 2 })),
      text("pr-2-r", 26, 420, "Didn't get it?", 18, grey),
      ["pr-2-cta", 26, 600, "Verify", "pr-3"],
    ]],
    ["pr-3", "03 Set up", [
      text("pr-3-nav", 64, 66, "Your workspace", 22),
      text("pr-3-h", 26, 150, "Set up your workspace", 34),
      text("pr-3-pl", 26, 430, "Plan", 16),
      ["pr-3-cta", 26, 740, "Get started", null],
    ]],
  ];
  const els = [text("pr-title", 0, 0, "Signup · clickable prototype", 34)];
  screens.forEach(([id, name, parts], i) => {
    const x0 = phoneX(i) + 20, y0 = PHONE.y + 20;
    const kids = [
      { ...box(`${id}-shell`, 0, 0, PHONE.w, PHONE.h, null, { bg: "#ffffff" }), strokeWidth: 4 },
      box(`${id}-notch`, 190, 14, 120, 28, null, { bg: "#1e1e1e", stroke: "#1e1e1e" }),
      text(`${id}-time`, 30, 16, "9:41", 16),
      box(`${id}-home`, 180, PHONE.h - 22, 140, 6, null, { bg: "#1e1e1e", stroke: "#1e1e1e" }),
      ...parts.map((p) => {
        if (!Array.isArray(p)) return p;
        const [bid, bx, by, label, next, ghost] = p; // a full-width button, drawn so the editor centres its label
        return box(bid, bx, by, 448, 56, label, { bg: ghost ? "#ffffff" : "#1e1e1e", stroke: "#1e1e1e", labelColor: ghost ? "#1e1e1e" : "#ffffff", size: 20, link: next ? `http://127.0.0.1:${PORT}/?element=${next}` : undefined });
      }),
    ].map((e) => ({ ...e, x: e.x + x0, y: e.y + y0 }));
    els.push(frame(id, phoneX(i), PHONE.y, PHONE.w + 40, PHONE.h + 40, name, kids.map((e) => e.id)), ...kids);
  });
  // Frames can't be arrow ends: each arrow leaves a button and points at the next screen.
  const ax = (i) => phoneX(i) + 20 + 26 + 448;
  els.push(arrow("pr-a1", ax(0) + 4, PHONE.y + 20 + 628, phoneX(1) - ax(0) - 8, 0, "pr-1-cta", null, null, { stroke: "#e03131" }));
  els.push(arrow("pr-a2", ax(1) + 4, PHONE.y + 20 + 628, phoneX(2) - ax(1) - 8, 0, "pr-2-cta", null, null, { stroke: "#e03131" }));
  return els;
}
// Widgets: [screen, item, x, y, {old text: new text}, extra edits by old text].
const PROTO_WIDGETS = [
  [0, "textfield", 26, 220, { TextBox: "Name", Placeholder: "Sam Taylor" }],
  [0, "textfield", 26, 316, { TextBox: "Email", Placeholder: "you@example.com" }],
  [0, "textfield", 26, 412, { TextBox: "Password", Placeholder: "••••••••••" }, { Placeholder: { fontSize: 28 } }],
  [0, "checkbox-on", 26, 520, { CheckBox: "I agree to the Terms" }],
  [0, "link-button", 26, 860, { "Read More >": "Have an account? Log in >" }],
  [1, "icon-back", 26, 70, {}],
  [1, "link-button", 160, 420, { "Read More >": "Resend code >" }],
  [2, "icon-back", 26, 70, {}],
  [2, "textfield", 26, 230, { TextBox: "Workspace name", Placeholder: "Acme Design" }],
  [2, "dropdown", 26, 326, { "Dropdown Label": "Team size", "Please Pick Someting ": "2–10 people" }],
  [2, "tabs", 26, 456, { Tab1: "Free", Tab2: "Team", Tab3: "Business" }, { Tab2: { strokeColor: "#ffffff", bg: "#1e1e1e" } }],
  [2, "toggle-on", 26, 560, { "Toggle-on": "Email me tips and updates" }],
];

function kanban() {
  // A team board: columns as shapes, cards as sticky notes coloured by kind.
  const cols = [
    ["To do", [["Pricing page copy", C.blue], ["Cookie banner", C.yellow], ["Footer links broken on mobile", C.pink], ["Hero image options", C.yellow]]],
    ["Doing · 2/3", [["New navigation", C.yellow], ["Search results page", C.yellow]]],
    ["Review", [["Signup form validation", C.pink], ["Blog post template", C.yellow]]],
    ["Done", [["Design tokens", C.blue], ["404 page", C.yellow], ["Analytics events", C.blue]]],
  ];
  const els = [text("kb-title", 40, 30, "Website relaunch · team board", 34)];
  cols.forEach(([name, cards], i) => {
    const x = 40 + i * 370;
    els.push({ ...box(`kb-c${i}`, x, 110, 340, 760, null, { bg: "#f1f3f5", stroke: "#dee2e6" }) });
    els.push(text(`kb-h${i}`, x + 20, 128, name, 24));
    cards.forEach(([t, bg], j) => els.push(note(`kb-n${i}${j}`, x + 20, 180 + j * 165, t, bg, 300, 140, 20)));
  });
  [["Feature", C.yellow], ["Bug", C.pink], ["Content", C.blue]].forEach(([l, bg], k) => {
    els.push(box(`kb-k${k}`, 40 + k * 170, 900, 28, 28, null, { bg, stroke: "#868e96" }));
    els.push(text(`kb-kl${k}`, 80 + k * 170, 900, l, 20, { strokeColor: "#495057" }));
  });
  return withChildren(["f-kanban", 0, 0, 1530, 960, "Team board"], els);
}

function howItWorks() {
  // You ↔ canvas ↔ server ↔ agent, inside "your machine".
  const parts = [["You", "draw, circle, comment", C.yellow], ["Canvas", "Excalidraw in a browser tab", C.blue], ["obeya server", "saves .excalidraw files", C.green], ["Your agent", "the obeya CLI, JSON out", C.violet]];
  const els = [
    { ...box("hw-machine", 0, 0, 1700, 290, null, { stroke: "#868e96" }), strokeStyle: "dashed" },
    text("hw-machine-l", 24, 18, "Your machine · 127.0.0.1 only", 20, { strokeColor: "#868e96" }),
  ];
  parts.forEach(([t, sub, bg], i) => {
    const x = 50 + i * 420;
    els.push(box(`hw-${i}`, x, 80, 300, 120, t, { bg, stroke: "#495057", size: 30 }));
    els.push(text(`hw-${i}-s`, x, 222, sub, 20, { strokeColor: "#495057" })); // centred under the box once measured
  });
  for (let i = 0; i < 3; i++) {
    els.push({ ...arrow(`hw-a${i}`, 50 + i * 420 + 306, 140, 108, 0, `hw-${i}`, `hw-${i + 1}`, null), startArrowhead: "arrow", endArrowhead: "arrow", strokeWidth: 2 });
  }
  return els;
}

function deck() {
  // Four 16:9 slides (1280×720) in a 2×2 grid, each a white card, so one image reads as a deck.
  const pos = [[0, 0], [1400, 0], [0, 840], [1400, 840]];
  const slide = (n, name, els) => {
    const [x0, y0] = pos[n - 1];
    const card = { ...box(`dk-${n}-bg`, 0, 0, 1280, 720, null, { bg: "#ffffff", stroke: "#ced4da", round: false }), strokeWidth: 2 };
    const kids = [card, ...els].map((e) => ({ ...e, x: e.x + x0, y: e.y + y0 }));
    return [frame(`dk-${n}`, x0, y0, 1280, 720, name, kids.map((e) => e.id)), ...kids];
  };
  const s1 = [
    box("dk-band", 0, 0, 1280, 24, null, { bg: "#237032", stroke: "#237032", round: false }),
    text("dk-t1", 100, 250, "Checkout · Q3 review", 84),
    text("dk-t2", 100, 380, "Where the time goes, and what we do next", 36, { strokeColor: "#868e96" }),
    text("dk-t3", 100, 600, "Payments team · October", 26, { strokeColor: "#868e96" }),
  ];
  const s2 = [
    text("dk-b-h", 80, 60, "What we learned", 56),
    text("dk-b", 100, 200, ["•  Checkout takes 1.4 s at p95; payments is 70% of it", "", "•  Most retries come from expired card tokens", "", "•  Guest checkout converts 12% better than sign-in", "", "•  Mobile users abandon at the payment step twice as often"].join("\n"), 34),
  ];
  const svc = (id, x, y, t, bg) => box(id, x, y, 230, 110, t, { bg, stroke: "#495057", size: 24 });
  const s3 = [
    text("dk-d-h", 80, 60, "How checkout works", 56),
    svc("dk-w", 80, 300, "Web checkout", C.blue), svc("dk-api", 420, 300, "Orders API", C.green),
    svc("dk-pay", 780, 190, "Payments", C.violet), svc("dk-inv", 780, 420, "Inventory", C.yellow),
    arrow("dk-a1", 312, 355, 106, 0, "dk-w", "dk-api", "HTTPS"),
    arrow("dk-a2", 652, 330, 126, -80, "dk-api", "dk-pay", "charge"),
    arrow("dk-a3", 652, 380, 126, 80, "dk-api", "dk-inv", "reserve"),
    note("dk-n", 1040, 200, "70% of the time is here", C.pink, 200, 160, 24),
  ];
  const bars = [["Web", 120], ["Orders API", 160], ["Payments", 620], ["Inventory", 90]];
  const s4 = [text("dk-c-h", 80, 60, "Time per step, p95 (ms)", 56), ...bars.flatMap(([l, v], i) => [
    text(`dk-bl${i}`, 80, 215 + i * 120, l, 30),
    box(`dk-bar${i}`, 330, 200 + i * 120, v * 1.4, 80, String(v), { bg: i === 2 ? C.pink : C.blue, stroke: "#495057", size: 24 }),
  ])];
  return [
    ...slide(1, "01 Title", s1),
    ...slide(2, "02 What we learned", s2),
    ...slide(3, "03 How checkout works", s3),
    ...slide(4, "04 Time per step", s4),
  ];
}

// --- the run ---------------------------------------------------------------------------
// `node docs/readme/stills.mjs` makes everything; name some to make only those:
// hero, how-it-works, kanban, story-map, roadmap, data-model, prototype, deck.
const ALL = ["hero", "how-it-works", "kanban", "story-map", "roadmap", "data-model", "prototype", "deck"];
const wanted = process.argv.slice(2).length ? process.argv.slice(2) : ALL;
for (const w of wanted) if (!ALL.includes(w)) throw new Error(`unknown still "${w}"; one of ${ALL.join(", ")}`);
const pageOf = (w) => (w === "hero" ? "signup-flow" : w);
const GALLERY_RATIO = 16 / 10; // every gallery image the same shape, so the README's table lines up

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const out = (n) => path.join(HERE, n);
try {
  // Fresh pages each run: stop a server left from before, then clear the pages being redrawn.
  try { obeya(["stop"]); } catch {}
  for (const w of wanted) fs.rmSync(path.join(HERE, `${pageOf(w)}.excalidraw`), { force: true });
  obeya(["serve"]);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
  const tab = await ctx.newPage();
  const scratch = await ctx.newPage(); // a blank page (no content policy) for padding images
  const P = (fn, ...a) => tab.evaluate(([f, x]) => window.obeyaTest[f](...x), [fn, a]);
  const open = async (page) => {
    await tab.goto(`http://127.0.0.1:${PORT}/?page=${encodeURIComponent(page)}&test=1`);
    await tab.waitForFunction(() => window.obeyaTest?.ready(), null, { timeout: 60000 });
    await sleep(500);
  };
  // Text size as the editor draws it (measured in the canvas tab, where its fonts are loaded).
  const FONTS = { 1: "Virgil", 2: "Helvetica", 3: "Cascadia", 5: "Excalifont", 6: "Nunito", 7: "Lilita One", 8: "Comic Shanns" };
  const measure = (t, size, family = 5) => tab.evaluate(async ([t, size, f]) => {
    const font = `${size}px ${f}`;
    await document.fonts.load(font, t);
    const g = document.createElement("canvas").getContext("2d");
    g.font = font;
    return Math.max(...t.split("\n").map((l) => g.measureText(l).width));
  }, [t, size, FONTS[family] ?? "Excalifont"]);
  const full = (page) => new Map(obeya(["get", page, "--full"]).elements.map((e) => [e.id, e]));
  // New wording for a text element, re-centred in its container if it has one.
  // Placeholders sit at the left of their field; other labels are centred.
  const LEFT = new Set(["Placeholder", "Please Pick Someting "]);
  async function relabel(els, e, t, extra = {}) {
    if (extra.fontSize) e = { ...e, fontSize: extra.fontSize };
    const w = await measure(t, e.fontSize, e.fontFamily);
    const h = t.split("\n").length * e.fontSize * (e.lineHeight ?? 1.25);
    const edit = { id: e.id, text: t, originalText: t, width: w, height: h, ...extra };
    const c = e.containerId && els.get(e.containerId);
    if (c) Object.assign(edit, { x: LEFT.has(e.text) ? c.x + 14 : c.x + (c.width - w) / 2, y: c.y + (c.height - h) / 2 });
    return edit;
  }
  // Pad an exported PNG to the gallery's shape, centred on white.
  async function fitTo(file, ratio) {
    const b64 = await scratch.evaluate(async ([src, ratio]) => {
      const img = new Image();
      img.src = `data:image/png;base64,${src}`;
      await img.decode();
      const w = Math.max(img.width, Math.round(img.height * ratio)), h = Math.max(img.height, Math.round(img.width / ratio));
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      const g = c.getContext("2d");
      g.fillStyle = "#ffffff"; g.fillRect(0, 0, w, h);
      g.drawImage(img, Math.round((w - img.width) / 2), Math.round((h - img.height) / 2));
      return c.toDataURL("image/png").split(",")[1];
    }, [fs.readFileSync(file).toString("base64"), ratio]);
    fs.writeFileSync(file, Buffer.from(b64, "base64"));
  }
  const exportPng = (name, scale = 2) => obeya(["export", name, "--format", "png", "--scale", String(scale), "--padding", "40", "--out", out(`${name}.png`)]);

  if (wanted.includes("hero")) {
    // Hero: the loop.
    await open("signup-flow");
    patch("signup-flow", { skeleton: signupFlow() });
    obeya(["show", "signup-flow", "--frame", "f-signup"]);
    await sleep(800);
    await tab.mouse.move(5, 5);
    await tab.screenshot({ path: out("hero-1.png") });
    const start = obeya(["changes", "signup-flow"]).rev;
    // The person circles the two verify cards and asks.
    const c = async (x, y) => P("toClient", x, y);
    await tab.click("[data-testid=toolbar-ellipse]");
    const a = await c(575, 182), b = await c(855, 488);
    await tab.mouse.move(a.x, a.y); await tab.mouse.down();
    for (let i = 1; i <= 12; i++) await tab.mouse.move(a.x + ((b.x - a.x) * i) / 12, a.y + ((b.y - a.y) * i) / 12);
    await tab.mouse.up();
    await tab.keyboard.press("Escape");
    await tab.click("[data-testid=toolbar-stickynote]");
    // Dragged out at its size, on the circle's lower-right edge where it hides little.
    const n0 = await c(770, 430), n1 = await c(960, 560);
    await tab.mouse.move(n0.x, n0.y); await tab.mouse.down();
    for (let i = 1; i <= 10; i++) await tab.mouse.move(n0.x + ((n1.x - n0.x) * i) / 10, n0.y + ((n1.y - n0.y) * i) / 10);
    await tab.mouse.up();
    await tab.waitForSelector("textarea", { timeout: 5000 });
    await tab.keyboard.type("why two steps here?");
    await tab.keyboard.press("Escape");
    await tab.keyboard.press("Escape");
    await sleep(800);
    // Pink, as a person would pick in the panel (recolouring only; a patch that resizes a note leaves its text at the old width).
    const comment = (await P("elements")).find((e) => e.type === "stickynote" && !e.id.startsWith("sf-"));
    console.error(`comment ${Math.round(comment.width)}x${Math.round(comment.height)} at ${Math.round(comment.x)},${Math.round(comment.y)}`);
    patch("signup-flow", { elements: [{ id: comment.id, backgroundColor: C.pink }] });
    await sleep(1200);
    await tab.mouse.move(5, 5);
    await tab.screenshot({ path: out("hero-2.png") });
    // The agent reads what the person pointed at, and answers on the page.
    const changes = obeya(["changes", "signup-flow", "--since", String(start), "--source", "user"]).changes;
    const pointed = changes.flatMap((x) => x.pointsAt ?? []).map((p) => p.text).filter(Boolean);
    if (!pointed.length) throw new Error(`the circle pointed at nothing: ${JSON.stringify(changes)}`);
    patch("signup-flow", { skeleton: [
      note("sf-reply", 1180, 470, "Both check it's really you. One screen instead: a code by email or SMS?", C.green, 300, 150, 18),
      note("sf-merged", 600, 640, "Enter one code (email or SMS)", C.green, 220, 120, 18),
      arrow("sf-ra", 1178, 545, -340, 150, "sf-reply", "sf-merged"),
    ], elements: [{ id: "f-signup", height: 800 }] });
    obeya(["show", "signup-flow", "--frame", "f-signup"]); // refit: the frame grew
    await sleep(1500);
    await tab.mouse.move(5, 5);
    await tab.screenshot({ path: out("hero-3.png") });
  }

  if (wanted.includes("how-it-works")) {
    // The README's diagram: not part of the gallery, so not padded.
    await open("how-it-works");
    patch("how-it-works", { skeleton: howItWorks() });
    await sleep(800);
    const els = full("how-it-works");
    const edits = [];
    for (let i = 0; i < 4; i++) {
      const s = els.get(`hw-${i}-s`), b = els.get(`hw-${i}`);
      edits.push({ id: s.id, x: b.x + (b.width - (await measure(s.text, s.fontSize, s.fontFamily))) / 2 });
    }
    patch("how-it-works", { elements: edits });
    await sleep(800);
    exportPng("how-it-works");
  }

  const simple = { kanban, "story-map": storyMap, roadmap, "data-model": dataModel };
  for (const name of Object.keys(simple).filter((n) => wanted.includes(n))) {
    await open(name);
    patch(name, { skeleton: simple[name]() });
    await sleep(800);
    exportPng(name);
    await fitTo(out(`${name}.png`), GALLERY_RATIO);
  }

  if (wanted.includes("prototype")) {
    await open("prototype");
    patch("prototype", { skeleton: prototypeShells() });
    await sleep(800);
    // Widgets from the library, inserted into their screen, then relabelled.
    const inserted = [];
    PROTO_WIDGETS.forEach(([s, item, x, y, texts, extra = {}], k) => {
      const at = [phoneX(s) + 20 + x, PHONE.y + 20 + y];
      const r = obeya(["library", "insert", `ecommerce-mobile-ui/${item}`, "prototype", "--at", at.join(","), "--frame", `pr-${s + 1}`, "--id", `pr-w${k}`]);
      inserted.push([r.ids ?? r.created, texts, extra]);
    });
    await sleep(800);
    const els = full("prototype");
    const edits = [];
    for (const [ids, texts, extra] of inserted) {
      for (const id of ids) {
        const e = els.get(id);
        if (e?.type !== "text" || !(e.text in texts)) continue;
        const x = extra[e.text] ?? {};
        const { bg, ...style } = x;
        edits.push(await relabel(els, e, texts[e.text], style));
        if (bg && e.containerId) edits.push({ id: e.containerId, backgroundColor: bg });
      }
    }
    patch("prototype", { elements: edits });
    await sleep(800);
    exportPng("prototype");
    await fitTo(out("prototype.png"), GALLERY_RATIO);
  }

  if (wanted.includes("deck")) {
    // The deck: a generated slideshow, as one HTML file, shown in a browser.
    await open("deck");
    patch("deck", { skeleton: deck() });
    await sleep(800);
    // One image of all four slides, and the deck itself as one offline HTML file.
    exportPng("deck", 1.5);
    await fitTo(out("deck.png"), GALLERY_RATIO);
    obeya(["export", "deck", "--format", "html", "--title", "Checkout · Q3 review", "--out", path.join(HERE, ".obeya", "deck.html")]);
  }
  console.log(JSON.stringify({ made: wanted }));
} finally {
  await browser.close();
  try { execFileSync(process.execPath, [BIN, "stop"], { env }); } catch {}
}
