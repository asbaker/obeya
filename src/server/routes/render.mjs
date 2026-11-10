// Rendering through a tab (the person's, or a headless renderer): images for
// the CLI's `shot` and `export`, the export dialog's download, and library
// contact sheets.
import path from "node:path";
import { ApiError, json, readJSON, requireElement, requirePage } from "../http.mjs";
import { buildExport, DECK_FORMATS, ExportError, IMAGE_FORMATS, MIME } from "../../lib/exporter.mjs";
import { findChrome } from "../../lib/chrome.mjs";
import { exportStem, normalizePageName, validPageName } from "../../lib/names.mjs";
import { zip } from "../../lib/zip.mjs";
import { sidecarDir } from "../../lib/paths.mjs";

/** @param {{store: any, tabs: any, dir: string}} ctx */
export function renderRoutes({ store, tabs, dir }) {
  return [
    // A labelled contact sheet of library items.
    ["POST", "/api/library-sheet", async ({ req, res }) => {
      const body = await readJSON(req);
      if (!Array.isArray(body.items) || !body.items.length) throw new ApiError(400, "invalid_argument", "a sheet needs items");
      const reply = await tabs.ask("library-sheet", body, { renderers: true, timeoutMs: 120000 });
      return json(res, 200, { png: reply.png, width: reply.width, height: reply.height });
    }],

    // body: {items: [{page, frame?}], type: "svg"|"png", scale?, embedScene?, padding?}
    ["POST", "/api/export", async ({ req, res }) => {
      const body = await readJSON(req);
      if (!Array.isArray(body.items) || !body.items.length || !["svg", "png"].includes(body.type)) {
        throw new ApiError(400, "invalid_argument", "export needs items and a type of svg or png");
      }
      for (const it of body.items) {
        if (!validPageName(it.page)) throw new ApiError(400, "bad_page_name", `bad page name "${it.page}"`);
        requirePage(store, it.page);
        requireElement(store, it.page, it.frame);
      }
      const reply = await tabs.ask("export", body, { renderers: true, timeoutMs: 60000 });
      return json(res, 200, { items: reply.items });
    }],

    // The export dialog's download: the same assembly as the CLI's `export`,
    // returned as a file instead of written to disk.
    ["POST", "/api/pages/:page/export-file", async ({ req, res, params: { page: name } }) => {
      requirePage(store, name);
      const body = await readJSON(req);
      const fmt = body.format;
      if (![...IMAGE_FORMATS, ...DECK_FORMATS].includes(fmt)) throw new ApiError(400, "invalid_argument", "format must be svg, png, pdf or html");
      const frames = body.frames === undefined || body.frames === null ? null : body.frames;
      if (frames !== null && !(Array.isArray(frames) && frames.length && frames.every((f) => typeof f === "string"))) throw new ApiError(400, "invalid_argument", "frames is a list of frame ids");
      if (DECK_FORMATS.includes(fmt) && !frames) throw new ApiError(400, "invalid_argument", "decks are made from frames");
      for (const f of frames ?? []) requireElement(store, name, f);
      const image = IMAGE_FORMATS.includes(fmt);
      const opts = image
        ? { scale: Math.min(8, Math.max(0.1, Number(body.scale) || 1)), padding: Math.min(400, Math.max(0, Number.isFinite(body.padding) ? body.padding : 20)), background: body.background !== false, dark: Boolean(body.dark), embedScene: Boolean(body.embedScene) }
        : {};
      const render = (items, type) =>
        tabs.ask("export", { items: items.map((s) => ({ page: s.page, frame: s.frame ?? undefined })), type, ...opts }, { renderers: true, timeoutMs: 60000 }).then((r) => r.items);
      let result;
      try {
        result = await buildExport(
          { format: fmt, pages: [{ name, elements: store.elements(name) }], frames: image && Boolean(frames), order: frames ?? undefined, title: image ? undefined : body.title || undefined },
          { render, chrome: fmt === "pdf" ? findChrome() : null, workDir: sidecarDir(dir) },
        );
      } catch (err) {
        if (err instanceof ExportError) throw new ApiError(err.code === "no_chrome" ? 409 : 400, err.code, err.message);
        throw err;
      }
      // Any letters (a page may be named in any language); no path characters.
      const clean = (s) => String(s ?? "").normalize("NFC").replace(/[^\p{L}\p{N}_.-]+/gu, "-").replace(/^[-.]+|[-.]+$/g, "");
      const stem = clean(body.fileName) || clean(exportStem(name)) || "page";
      let file, data, type;
      if (result.files && result.files.length > 1) {
        [file, data, type] = [`${stem}.zip`, zip(result.files), MIME.zip];
      } else {
        const one = result.files ? result.files[0] : result.file;
        [file, data, type] = [`${stem}.${fmt}`, Buffer.isBuffer(one.data) ? one.data : Buffer.from(one.data, "utf8"), MIME[fmt]];
      }
      res.writeHead(200, { "content-type": type, "content-length": data.length, "content-disposition": `attachment; filename="${file.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(file)}`, "cache-control": "no-store", "x-export-files": String(result.files ? result.files.length : 1) });
      return res.end(data);
    }],
  ];
}
