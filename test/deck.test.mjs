import { test } from "node:test";
import assert from "node:assert/strict";
import { escapeHtml, fileName, hotspots, numericPrefix, orderFrames, pageArea, parseCanvasLink, planSlides, renderDeck, slug } from "../src/lib/deck.mjs";

const frame = (id, name, x, y, o = {}) => ({ id, type: "frame", name, x, y, width: 400, height: 300, ...o });

test("numeric prefixes", () => {
  assert.equal(numericPrefix("01 Login"), 1);
  assert.equal(numericPrefix("12-Checkout"), 12);
  assert.equal(numericPrefix("Login"), null);
  assert.equal(numericPrefix(undefined), null);
});

test("frame order: numeric prefix, then customData.order, then rows top to bottom, left to right", () => {
  const fs = [
    frame("c", "Gamma", 500, 10), // same row as a (centres within half a height), right of it
    frame("a", "Alpha", 0, 0),
    frame("d", "Delta", 0, 400), // next row
    frame("o", "Ordered", 900, 900, { customData: { order: 1 } }),
    frame("p2", "02 Second", 900, 0),
    frame("p1", "01 First", 900, 500),
  ];
  assert.deepEqual(orderFrames(fs).map((f) => f.id), ["p1", "p2", "o", "a", "c", "d"]);
});

test("--order picks and orders frames; unknown ids are an error", () => {
  const fs = [frame("a", "A", 0, 0), frame("b", "B", 500, 0)];
  assert.deepEqual(orderFrames(fs, ["b"]).map((f) => f.id), ["b"]);
  assert.throws(() => orderFrames(fs, ["zzz"]), (e) => e.code === "unknown_element");
});

test("slugs and file names", () => {
  assert.equal(slug("01 Login screen!"), "login-screen");
  assert.equal(slug("Café / Ünïcode"), "cafe-unicode");
  assert.equal(slug(""), "frame");
  assert.equal(slug("../../etc"), "etc");
  assert.equal(fileName({ number: 3, title: "03 - Pay now" }, "svg"), "03-pay-now.svg");
  assert.equal(fileName({ number: 3, title: "Pay" }, "png", 3), "003-pay.png");
});

test("planSlides: pages in the given order, frames ordered, a frameless page is one slide, notes", () => {
  const pages = [
    { name: "flow", elements: [frame("b", "02 B", 500, 0), frame("a", "01 A", 0, 0, { customData: { notes: "say hi" } }), frame("gone", "00", 0, 0, { isDeleted: true })] },
    { name: "notes", elements: [{ id: "r", type: "rectangle", x: 0, y: 0, width: 10, height: 10 }] },
  ];
  const s = planSlides(pages);
  assert.deepEqual(s.map((x) => [x.number, x.page, x.frame, x.title]), [[1, "flow", "a", "01 A"], [2, "flow", "b", "02 B"], [3, "notes", null, "notes"]]);
  assert.equal(s[0].notes, "say hi");
  assert.deepEqual(planSlides(pages, { order: ["b"] }).map((x) => x.frame), ["b", null]);
  assert.throws(() => planSlides(pages, { order: ["nope"] }), (e) => e.code === "unknown_element");
});

test("canvas links", () => {
  assert.deepEqual(parseCanvasLink("http://127.0.0.1:4747/?element=f2"), { element: "f2", page: null });
  assert.deepEqual(parseCanvasLink("http://localhost:4800/?page=other&element=x"), { element: "x", page: "other" });
  assert.deepEqual(parseCanvasLink("?element=f2"), { element: "f2", page: null });
  assert.deepEqual(parseCanvasLink("?page=v0.2%2Fdeck&element=f2"), { element: "f2", page: "v0.2/deck" });
  assert.equal(parseCanvasLink("https://example.com/?element=f2"), null);
  assert.equal(parseCanvasLink("http://127.0.0.1:4747/"), null);
  assert.equal(parseCanvasLink(null), null);
});

test("hotspots: frame-relative fractions, targets on this page and another", () => {
  const flow = [
    frame("fa", "01 A", 100, 100),
    frame("fb", "02 B", 600, 100),
    { id: "go", type: "rectangle", x: 140, y: 160, width: 100, height: 30, frameId: "fa", link: "http://127.0.0.1:4747/?element=fb" },
    { id: "out", type: "rectangle", x: 150, y: 300, width: 40, height: 30, frameId: "fa", link: "http://127.0.0.1:4747/?page=more&element=n1" },
    { id: "web", type: "rectangle", x: 150, y: 350, width: 40, height: 30, frameId: "fa", link: "https://example.com" },
    { id: "elsewhere", type: "rectangle", x: 650, y: 150, width: 40, height: 30, frameId: "fb", link: "http://127.0.0.1:4747/?element=fa" },
  ];
  const more = [frame("fm", "01 M", 0, 0), { id: "n1", type: "rectangle", x: 10, y: 10, width: 10, height: 10, frameId: "fm" }];
  const slides = planSlides([{ name: "flow", elements: flow }, { name: "more", elements: more }]);
  const area = { x1: 100, y1: 100, x2: 500, y2: 400 };
  const hs = hotspots(slides[0], flow, slides, { flow, more }, area);
  assert.deepEqual(hs.map((h) => [h.id, h.to]), [["go", 2], ["out", 3]]);
  assert.deepEqual([hs[0].x, hs[0].y, hs[0].w, hs[0].h], [0.1, 0.2, 0.25, 0.1]);

  // A link to a group (Excalidraw's "link to object" on a group) targets the group's frame.
  const grouped = [...flow, { id: "g1m", type: "rectangle", x: 700, y: 200, width: 10, height: 10, frameId: "fb", groupIds: ["grp"] },
    { id: "toGroup", type: "rectangle", x: 400, y: 120, width: 40, height: 30, frameId: "fa", link: "http://localhost:9999/?page=flow&element=grp" }];
  const gs = hotspots(slides[0], grouped, slides, { flow: grouped, more }, area).find((h) => h.id === "toGroup");
  assert.equal(gs.to, 2);
});

test("pageArea pads the elements' bounds", () => {
  assert.deepEqual(pageArea([{ id: "r", type: "rectangle", x: 10, y: 20, width: 100, height: 50 }], 20), { x1: -10, y1: 0, x2: 130, y2: 90 });
});

test("the HTML deck is self-contained, escaped, numbered, and has notes and hotspots", () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><style>@font-face{font-family:X;src:url(data:font/woff2;base64,AAAA)}</style></svg>';
  const html = renderDeck({
    title: "Review <1>",
    slides: [
      { number: 1, title: "01 A & B", notes: "line1\nline2 <b>", svg, width: 400, height: 300, hotspots: [{ id: "go", to: 2, x: 0.1, y: 0.2, w: 0.25, h: 0.1 }] },
      { number: 2, title: "02 C", notes: null, svg, width: 400, height: 300, hotspots: [] },
    ],
  });
  // No external references at all: images are data: URLs and the CSP forbids fetching.
  assert.deepEqual(html.match(/(?:src|href)="(?!data:|#)[^"]*"/g), null);
  assert.doesNotMatch(html, /https?:\/\//);
  assert.match(html, /default-src 'none'/);
  assert.match(html, /<h1>Review &lt;1&gt;<\/h1>/);
  assert.match(html, /01 A &amp; B/);
  assert.match(html, /line1<br>line2 &lt;b&gt;/);
  assert.match(html, /<span class="num">2 \/ 3<\/span>/); // title slide shifts numbering
  assert.match(html, /data-to="3" style="left:10\.000%;top:20\.000%;width:25\.000%;height:10\.000%"/);
  assert.equal((html.match(/<section class="slide/g) || []).length, 3);
  assert.match(html, /@media print/);
  assert.equal(escapeHtml(`<a href="x">'&`), "&lt;a href=&quot;x&quot;&gt;&#39;&amp;");
});
