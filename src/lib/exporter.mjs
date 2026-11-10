// Export assembly shared by the CLI (`export`, writes files) and the server
// (the export dialog's download). Rendering itself happens in a browser tab;
// the caller passes `render(items, type)`, which returns one {svg} or {png
// (base64), width, height} per item, in order.
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileName, hotspots, pageArea, planSlides, renderDeck } from "./deck.mjs";

export class ExportError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export const IMAGE_FORMATS = ["svg", "png"];
export const DECK_FORMATS = ["html", "pdf"];
export const MIME = { svg: "image/svg+xml", png: "image/png", html: "text/html; charset=utf-8", pdf: "application/pdf", zip: "application/zip" };

/**
 * @param {object} req
 * @param {"svg"|"png"|"html"|"pdf"} req.format
 * @param {{name: string, elements: any[]}[]} req.pages  pages in order (images take one)
 * @param {boolean} [req.frames]  images: one file per frame
 * @param {string} [req.frame]    images: one frame
 * @param {string[]} [req.order]  frame ids to pick and order
 * @param {string} [req.title]    decks: a title slide
 * @param {object} io
 * @param {(items: {page: string, frame?: string}[], type: "svg"|"png") => Promise<any[]>} io.render
 * @param {string|null} [io.chrome]  a Chrome binary, for pdf
 * @param {string} [io.workDir]      for pdf's temporary files (the sidecar dir)
 * @returns {Promise<{files: {name: string, data: Buffer|string, frame?: string, title?: string, width?: number, height?: number}[]} | {file: {data: Buffer|string, width?: number, height?: number}, summary?: object}>}
 */
export async function buildExport(req, { render, chrome = null, workDir }) {
  const fmt = req.format;
  let slides;
  try {
    slides = planSlides(req.pages, { order: req.order });
  } catch (err) {
    throw new ExportError(err.code || "invalid_argument", err.message);
  }
  const data = (r) => (fmt === "svg" ? r.svg : Buffer.from(r.png, "base64"));

  if (IMAGE_FORMATS.includes(fmt)) {
    const page = req.pages[0].name;
    if (req.frames) {
      const framed = slides.filter((s) => s.frame);
      if (!framed.length) throw new ExportError("unknown_element", `page "${page}" has no frames`);
      const rendered = await render(framed, fmt);
      const digits = String(framed.length).length > 2 ? 3 : 2;
      return {
        files: framed.map((s, i) => ({ name: fileName(s, fmt, digits), data: data(rendered[i]), frame: s.frame, title: s.title, width: rendered[i].width, height: rendered[i].height })),
      };
    }
    const [r] = await render([{ page, frame: req.frame }], fmt);
    return { file: { data: data(r), width: r.width, height: r.height } };
  }

  // html and pdf: a deck.
  const byPage = Object.fromEntries(req.pages.map((p) => [p.name, p.elements]));
  const rendered = await render(slides, "svg");
  const deckSlides = slides.map((s, i) => {
    const els = byPage[s.page];
    const frame = s.frame ? els.find((e) => e.id === s.frame) : null;
    const area = frame ? { x1: frame.x, y1: frame.y, x2: frame.x + frame.width, y2: frame.y + frame.height } : pageArea(els, 20);
    return { ...s, svg: rendered[i].svg, width: rendered[i].width, height: rendered[i].height, hotspots: hotspots(s, els, slides, byPage, area) };
  });
  const html = renderDeck({ title: req.title ?? null, slides: deckSlides });
  const summary = { slides: deckSlides.length + (req.title ? 1 : 0), hotspots: deckSlides.reduce((n, s) => n + s.hotspots.length, 0) };
  if (fmt === "html") return { file: { data: html }, summary };
  if (!chrome) throw new ExportError("no_chrome", "PDF export needs Chrome or Chromium (set CHROME_PATH); or use --format html and print it from the browser");
  fs.mkdirSync(workDir, { recursive: true });
  const stem = path.join(workDir, `.deck-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  fs.writeFileSync(stem + ".html", html);
  try {
    await printPdf(chrome, stem + ".html", stem + ".pdf", path.join(workDir, "pdf-profile"));
    return { file: { data: fs.readFileSync(stem + ".pdf") }, summary };
  } finally {
    fs.rmSync(stem + ".html", { force: true });
    fs.rmSync(stem + ".pdf", { force: true });
  }
}

/** Print an HTML file to PDF with headless Chrome (its own profile, so it never hands off to the person's Chrome). */
export async function printPdf(chrome, htmlFile, out, profile) {
  await new Promise((resolve, reject) => {
    const child = spawn(chrome, [
      "--headless=new", `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "--disable-extensions",
      "--no-pdf-header-footer", `--print-to-pdf=${out}`, "file://" + htmlFile,
    ], { stdio: "ignore" });
    const timer = setTimeout(() => child.kill(), 120000);
    child.on("error", reject);
    child.on("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
  if (!fs.existsSync(out) || fs.statSync(out).size === 0) throw new ExportError("pdf_failed", "Chrome did not produce a PDF; try --format html and print it from the browser");
}
