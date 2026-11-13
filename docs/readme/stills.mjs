// Make the README's stills (docs/readme/*.png) from the pages in this folder.
//
//   node docs/readme/stills.mjs [still …]   (needs Chrome and playwright-core, like the smoke test)
//
// Every page is drawn by obeya itself, through the CLI and a headless canvas
// tab, on a server of its own (an explicit port, so no port is remembered).
// The hero plays the real loop with `wait`: the agent draws three options and asks,
// a person circles one and adds a note with the mouse and keyboard, presses Done,
// and the agent acts on what the circle points at.
import { createRequire } from "node:module";
import { execFileSync, spawn, spawnSync } from "node:child_process";
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
  if (!r.stdout.trim()) { if (r.status) throw new Error(`obeya ${args.join(" ")}: exit ${r.status}`); return {}; } // a success with nothing to report
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
// The hero: the agent asks which signup to build, with three sign-in screens on the page,
// mocked up from a UI kit. Each option's ids start with s<k>- (sa-, sb-, sc-).
const SIGNUP = [
  ["a", "A · Email and password", "Create your account", null],
  ["b", "B · Magic link", "Sign in with email", "We'll email you a link. No password."],
  ["c", "C · Google only", "Welcome", "One tap. Nothing to remember."],
];
const HERO = { x: (i) => 40 + i * 600, labelY: 190, y: 245, w: 500, h: 700 };
// Kit widgets per option: [option, item, x, y in the phone, {old text: new text}, extra edits by old text].
const HERO_WIDGETS = [
  ["a", "textfield", 26, 190, { TextBox: "Email", Placeholder: "you@example.com" }],
  ["a", "textfield", 26, 286, { TextBox: "Password", Placeholder: "••••••••••" }, { Placeholder: { fontSize: 28 } }],
  ["a", "link-button", 26, 480, { "Read More >": "Have an account? Log in >" }],
  ["b", "textfield", 26, 220, { TextBox: "Email", Placeholder: "you@example.com" }],
];
const heroButton = (id, x, y, label, ghost) => box(id, x, y, 448, 56, label, { bg: ghost ? "#ffffff" : "#1e1e1e", stroke: "#1e1e1e", labelColor: ghost ? "#1e1e1e" : "#ffffff", size: 20 });
function phone(id, x0, y0, w, h, parts) {
  return [
    { ...box(`${id}-shell`, 0, 0, w, h, null, { bg: "#ffffff" }), strokeWidth: 4 },
    box(`${id}-notch`, w / 2 - 60, 14, 120, 28, null, { bg: "#1e1e1e", stroke: "#1e1e1e" }),
    text(`${id}-time`, 30, 16, "9:41", 16),
    box(`${id}-home`, w / 2 - 70, h - 22, 140, 6, null, { bg: "#1e1e1e", stroke: "#1e1e1e" }),
    ...parts,
  ].map((e) => ({ ...e, x: e.x + x0, y: e.y + y0 }));
}
function signupFlow() {
  const grey = { strokeColor: "#868e96" };
  const els = [text("sf-title", 40, 100, "How should people sign up?", 40)];
  SIGNUP.forEach(([k, name, heading, sub], i) => {
    const s = `s${k}`;
    els.push(text(`${s}-label`, HERO.x(i), HERO.labelY, name, 28));
    const parts = [text(`${s}-h`, 26, 100, heading, 34)];
    if (sub) parts.push(text(`${s}-sub`, 26, 152, sub, 18, grey));
    if (k === "a") parts.push(heroButton(`${s}-cta`, 26, 400, "Create account"));
    if (k === "b") parts.push(heroButton(`${s}-cta`, 26, 340, "Email me a link"));
    if (k === "c") parts.push(heroButton(`${s}-cta`, 26, 230, "Continue with Google", true));
    els.push(...phone(s, HERO.x(i), HERO.y, HERO.w, HERO.h, parts));
  });
  return [frame("f-signup", 0, 0, 1780, 990, "Signup options", []), ...els]; // a fixed box: room above the title for the banner
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

function refactorPlan() {
  // Before and after: three big files (bars sized by lines) split into folders of small ones.
  const NOW = [["api.js", 2300], ["app.js", 1900], ["worker.js", 1200]];
  const AFTER = [
    ["api/", [["routes.js", 400], ["auth.js", 350], ["orders.js", 600], ["payments.js", 550], ["errors.js", 400]]],
    ["app/", [["views.js", 600], ["state.js", 450], ["forms.js", 450], ["client.js", 400]]],
    ["worker/", [["queue.js", 400], ["jobs.js", 500], ["email.js", 300]]],
  ];
  const rowY = (i) => 180 + i * 170, nowW = (n) => n * 0.2, modW = (n) => n * 0.3;
  const els = [
    text("rp-title", 40, 30, "Refactor plan: split the three big files", 36),
    text("rp-now", 40, 120, "Now · 3 files, 5,400 lines", 24, { strokeColor: "#495057" }),
    text("rp-after", 720, 120, "After · the same code in 12 files", 24, { strokeColor: "#495057" }),
  ];
  NOW.forEach(([f, n], i) => els.push(box(`rp-n${i}`, 40, rowY(i) + 10, nowW(n), 110, `${f}\n${n.toLocaleString("en")} lines`, { bg: C.pink, stroke: "#495057", size: 20 })));
  AFTER.forEach(([dir, mods], i) => {
    const w = mods.reduce((t, [, n]) => t + modW(n) + 10, 30);
    els.push(box(`rp-d${i}`, 720, rowY(i), w, 130, null, { bg: "#f8f9fa", stroke: "#adb5bd" }));
    els.push(text(`rp-d${i}-t`, 735, rowY(i) + 8, dir, 20, { strokeColor: "#495057" }));
    let x = 735;
    mods.forEach(([f, n], j) => { els.push(box(`rp-m${i}${j}`, x, rowY(i) + 44, modW(n), 72, `${f}\n${n}`, { bg: C.green, stroke: "#495057", size: 16 })); x += modW(n) + 10; });
    els.push({ ...arrow(`rp-a${i}`, 40 + nowW(NOW[i][1]) + 8, rowY(i) + 65, 720 - 16 - (40 + nowW(NOW[i][1])), 0, `rp-n${i}`, `rp-d${i}`), strokeWidth: 2 });
  });
  els.push(note("rp-note", 1290, 640, "Keep orders and payments together for now", C.yellow, 260, 110, 18));
  return [frame("f-refactor", 0, 0, 1600, 800, "Refactor plan", []), ...els];
}

// Mermaid text in, editable shapes out.
const MERMAID = `flowchart TD
  A[Cart] --> B{Signed in?}
  B -- yes --> C[Saved address]
  B -- no --> D[Guest details]
  C --> E[Pay]
  D --> E
  E --> F([Order confirmed])
  E -. declined .-> G[Try another card]
  G --> E`;

// Architecture from real icons (library items), labelled and connected.
const ARCH = [
  ["cloudfront", "CDN", 0, 0], ["apigateway", "API", 1, 0], ["lambda", "Orders", 2, 0], ["dynamodb", "Orders table", 3, 0],
  ["eventbridge", "Events", 2, 1], ["sqs", "Email queue", 3, 1], ["ses", "Receipts", 4, 1],
];
const ARCH_X = (c) => 60 + c * 300, ARCH_Y = (r) => 160 + r * 300;

// --- the run ---------------------------------------------------------------------------
// `node docs/readme/stills.mjs` makes everything; name some to make only those:
// hero, how-it-works, kanban, story-map, roadmap, data-model, prototype, deck, mermaid, architecture, refactor-plan.
const ALL = ["hero", "how-it-works", "kanban", "story-map", "roadmap", "data-model", "prototype", "deck", "mermaid", "architecture", "refactor-plan"];
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
  // Insert UI-kit widgets ([item, x, y, frame, id prefix, {old text: new text}, extra edits by old text]), then relabel them.
  async function insertWidgets(page, list) {
    const inserted = list.map(([item, x, y, frame, id, texts, extra = {}]) => {
      const r = obeya(["library", "insert", `ecommerce-mobile-ui/${item}`, page, "--at", `${x},${y}`, "--frame", frame, "--id", id]);
      return [r.ids ?? r.created, texts, extra];
    });
    await sleep(800);
    const els = full(page);
    const edits = [];
    for (const [ids, texts, extra] of inserted) {
      for (const id of ids) {
        const e = els.get(id);
        if (e?.type !== "text" || !(e.text in texts)) continue;
        const { bg, ...style } = extra[e.text] ?? {};
        edits.push(await relabel(els, e, texts[e.text], style));
        if (bg && e.containerId) edits.push({ id: e.containerId, backgroundColor: bg });
      }
    }
    patch(page, { elements: edits });
    await sleep(800);
  }
  const exportPng = (name, scale = 2) => obeya(["export", name, "--format", "png", "--scale", String(scale), "--padding", "40", "--out", out(`${name}.png`)]);

  if (wanted.includes("hero")) {
    // Hero: the loop with wait. The agent asks on the page; the person circles an option,
    // adds a note and presses Done; the agent reads what they pointed at and acts on it.
    await open("signup-flow");
    patch("signup-flow", { skeleton: signupFlow() });
    await insertWidgets("signup-flow", HERO_WIDGETS.map(([k, item, x, y, texts, extra], n) => {
      const i = SIGNUP.findIndex(([o]) => o === k);
      return [item, HERO.x(i) + x, HERO.y + y, "f-signup", `s${k}-w${n}`, texts, extra];
    }));
    obeya(["show", "signup-flow", "--frame", "f-signup"]);
    let answer = "";
    const w = spawn(process.execPath, [BIN, "wait", "signup-flow", "--frame", "f-signup", "--ask", "Which sign-in should we build? Circle one, add a note, then press Done."], { env, stdio: ["ignore", "pipe", "ignore"] });
    w.stdout.on("data", (d) => { answer += d; });
    const waited = new Promise((r) => w.on("exit", r));
    await tab.waitForSelector('[data-testid="wait-banner"]', { timeout: 15000 });
    await sleep(7000); // past the "your agent changed …" toast
    await tab.mouse.move(5, 5);
    await tab.screenshot({ path: out("hero-1.png") });
    // The person circles option B's screen.
    const c = async (x, y) => P("toClient", x, y);
    const b = SIGNUP.findIndex(([k]) => k === "b"), bx = HERO.x(b);
    await tab.click("[data-testid=toolbar-ellipse]");
    const e0 = await c(bx - 40, HERO.labelY - 10), e1 = await c(bx + HERO.w + 40, HERO.y + HERO.h + 20);
    await tab.mouse.move(e0.x, e0.y); await tab.mouse.down();
    for (let i = 1; i <= 12; i++) await tab.mouse.move(e0.x + ((e1.x - e0.x) * i) / 12, e0.y + ((e1.y - e0.y) * i) / 12);
    await tab.mouse.up();
    await tab.keyboard.press("Escape");
    // …and adds a note on the screen's empty lower half.
    await tab.click("[data-testid=toolbar-stickynote]");
    const n0 = await c(bx + 240, HERO.y + 480), n1 = await c(bx + 470, HERO.y + 620);
    await tab.mouse.move(n0.x, n0.y); await tab.mouse.down();
    for (let i = 1; i <= 10; i++) await tab.mouse.move(n0.x + ((n1.x - n0.x) * i) / 10, n0.y + ((n1.y - n0.y) * i) / 10);
    await tab.mouse.up();
    await tab.waitForSelector("textarea", { timeout: 5000 });
    await tab.keyboard.type("B, plus a Google button");
    await tab.keyboard.press("Escape");
    await tab.keyboard.press("Escape");
    await sleep(800);
    // Pink, as a person would pick in the panel. A note drawn by drag comes out larger than the drag; settle its size.
    const comment = (await P("elements")).find((e) => e.type === "stickynote");
    patch("signup-flow", { skeleton: [note(comment.id, bx + 250, HERO.y + 535, "B, plus a Google button", C.pink, 240, 150, 20)] });
    await sleep(7000);
    await tab.hover('[data-testid="wait-done"]');
    await sleep(400);
    await tab.screenshot({ path: out("hero-2.png") });
    // Done: the agent gets the person's changes, with what the circle points at.
    await tab.click('[data-testid="wait-done"]');
    await waited;
    const res = JSON.parse(answer).result;
    fs.mkdirSync(path.join(HERE, ".obeya"), { recursive: true });
    fs.writeFileSync(path.join(HERE, ".obeya", "hero-wait.json"), JSON.stringify(res)); // the README's CLI example
    const pointed = res.changes.flatMap((x) => x.pointsAt ?? []).map((p) => p.text ?? "").join(" ");
    if (!/Email me a link|Sign in with email/.test(pointed)) throw new Error(`the circle didn't point at option B: ${JSON.stringify(res)}`);
    // The agent acts on it: B chosen, the others set aside, Google added to B as a second button.
    const all = [...full("signup-flow").values()];
    const faded = all.filter((e) => /^s[ac]-/.test(e.id)).map((e) => ({ id: e.id, opacity: 25 }));
    const grey = { strokeColor: "#868e96" };
    patch("signup-flow", {
      elements: [...faded, { id: "sb-shell", strokeColor: "#2f9e44", strokeWidth: 6 }],
      skeleton: [
        { ...text("sb-label", bx, HERO.labelY, "B · Magic link · chosen", 28), strokeColor: "#2f9e44" },
        ...phone("sb", bx, HERO.y, HERO.w, HERO.h, [
          line("sb-or1", 26, 432, 190, { stroke: "#ced4da" }), text("sb-or", 236, 420, "or", 18, grey), line("sb-or2", 284, 432, 190, { stroke: "#ced4da" }),
          heroButton("sb-g", 26, 470, "Continue with Google", true),
        ]).slice(4),
        note("sf-reply", HERO.x(2) + 120, HERO.y + 400, "Building B, with Google as a second button. Starting with the email screen.", C.green, 300, 150, 18),
      ],
    });
    await sleep(7000);
    await tab.addStyleTag({ content: ".HintViewer { display: none !important; }" }); // Excalidraw's "to move canvas…" tip
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

  const simple = { kanban, "story-map": storyMap, roadmap, "data-model": dataModel, "refactor-plan": refactorPlan };
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
    await insertWidgets("prototype", PROTO_WIDGETS.map(([sc, item, x, y, texts, extra], k) => [item, phoneX(sc) + 20 + x, PHONE.y + 20 + y, `pr-${sc + 1}`, `pr-w${k}`, texts, extra]));
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
  if (wanted.includes("mermaid")) {
    await open("mermaid");
    const r = spawnSync(process.execPath, [BIN, "mermaid", "mermaid", "--file", "-", "--id", "mm"], { env, input: MERMAID, encoding: "utf8" });
    const res = JSON.parse(r.stdout);
    if (res.error) throw new Error(`obeya mermaid: ${res.error.code} ${res.error.message}`);
    // The source beside the diagram, so the still says where it came from.
    const els = full("mermaid");
    const mm = [...els.values()].filter((e) => e.id.startsWith("mm-"));
    const top = Math.min(...mm.map((e) => e.y)), left = Math.min(...mm.map((e) => e.x));
    patch("mermaid", { skeleton: [
      { ...box("mm-src", left - 620, top, 540, 300, MERMAID, { bg: "#f8f9fa", stroke: "#ced4da", size: 18 }), label: { text: MERMAID, fontSize: 20, fontFamily: 3, textAlign: "left", verticalAlign: "top", strokeColor: "#1e1e1e" } },
      text("mm-src-l", left - 620, top - 44, "checkout.mmd", 22, { strokeColor: "#868e96" }),
    ] });
    await sleep(800);
    exportPng("mermaid");
    await fitTo(out("mermaid.png"), GALLERY_RATIO);
  }

  if (wanted.includes("architecture")) {
    await open("architecture");
    patch("architecture", { skeleton: [frame("f-arch", 0, 0, 1560, 640, "Checkout architecture", []), text("ar-title", 40, 40, "Checkout · how an order flows", 36)] });
    ARCH.forEach(([item, , c, r], k) => obeya(["library", "insert", `aws-serverless-icons-v2/${item}`, "architecture", "--at", `${ARCH_X(c)},${ARCH_Y(r)}`, "--frame", "f-arch", "--id", `ar-i${k}`]));
    await sleep(800);
    const els = [...full("architecture").values()];
    const boxOf = (k) => { const p = els.filter((e) => e.id.startsWith(`ar-i${k}-`)); const x0 = Math.min(...p.map((e) => e.x)), y0 = Math.min(...p.map((e) => e.y)); return { x0, y0, x1: Math.max(...p.map((e) => e.x + e.width)), y1: Math.max(...p.map((e) => e.y + e.height)) }; };
    const B = ARCH.map((_, k) => boxOf(k));
    const link = (id, a, b, label) => { const s = B[a], e = B[b]; const sx = s.x1 + 12, sy = (s.y0 + s.y1) / 2, ex = e.x0 - 12, ey = (e.y0 + e.y1) / 2;
      return { ...arrow(id, sx, sy, ex - sx, ey - sy, null, null, label), strokeWidth: 2 }; };
    const down = (id, a, b, label) => { const s = B[a], e = B[b]; const sx = (s.x0 + s.x1) / 2, sy = s.y1 + 16, ey = e.y0 - 12;
      return { ...arrow(id, sx, sy, 0, ey - sy, null, null, label), strokeWidth: 2 }; };
    patch("architecture", { skeleton: [link("ar-a0", 0, 1, "HTTPS"), link("ar-a1", 1, 2), link("ar-a2", 2, 3, "write"), down("ar-a3", 2, 4, "OrderPlaced"), link("ar-a4", 4, 5), link("ar-a5", 5, 6, "send")] });
    await sleep(800);
    exportPng("architecture");
    await fitTo(out("architecture.png"), GALLERY_RATIO);
  }

  console.log(JSON.stringify({ made: wanted }));
} finally {
  await browser.close();
  try { execFileSync(process.execPath, [BIN, "stop"], { env }); } catch {}
}
