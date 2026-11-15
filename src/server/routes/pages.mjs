// /api/pages: the page list, reading a page, the person's edits (sync), agent
// patches, the change log, rename, bands, and pointing the person's view.
import { ApiError, json, readJSON, requireElement, requirePage } from "../http.mjs";
import { brief, resolveChanges } from "../../lib/report.mjs";
import { involving, lint } from "../../lib/lint.mjs";
import { LayoutError, validateLayout } from "../../lib/layout.mjs";
import { normalizePageName } from "../../lib/names.mjs";
import { fileProblem } from "../../lib/images.mjs";
import { applyDefaults, defaultsProblem } from "../../lib/defaults.mjs";
import { StageError, applyStage } from "../../lib/stages.mjs";
import { pinIds, pinSkeleton, pinsProblem } from "../../lib/pins.mjs";
import { lockBackdrops } from "../../lib/backdrops.mjs";
import { resolveFonts } from "../../lib/fonts.mjs";

const PATCH_KEYS = ["skeleton", "elements", "delete", "toBack", "toFront", "layout"];

function validatePatch(body) {
  const ok = body && typeof body === "object" && !Array.isArray(body);
  const arr = (k) => body[k] === undefined || Array.isArray(body[k]);
  if (!ok || !PATCH_KEYS.every(arr)) {
    throw new ApiError(400, "invalid_patch", "a patch is {skeleton?: [], elements?: [], delete?: [], toBack?: [], toFront?: [], layout?: [], defaults?: {}}");
  }
  const extra = Object.keys(body).filter((k) => !PATCH_KEYS.includes(k) && !["files", "defaults", "style", "pins"].includes(k));
  if (extra.length) throw new ApiError(400, "invalid_patch", `unknown patch keys: ${extra.join(", ")}`);
  for (const e of [...(body.skeleton ?? []), ...(body.elements ?? [])]) {
    if (!e || typeof e !== "object") throw new ApiError(400, "invalid_patch", "patch entries must be objects");
  }
  // The same id created twice in one patch: the second would silently replace
  // the first. (Two edits of one id in `elements` are fine: they merge.)
  const seen = new Set();
  for (const e of body.skeleton ?? []) {
    if (typeof e.id !== "string") continue;
    if (seen.has(e.id)) throw new ApiError(400, "invalid_patch", `the id "${e.id}" appears twice in this patch; give each element its own id`);
    seen.add(e.id);
  }
  const pinBad = pinsProblem(body.pins);
  if (pinBad) throw new ApiError(400, "invalid_patch", pinBad);
  const bad = defaultsProblem(body.defaults);
  if (bad) throw new ApiError(400, "invalid_patch", bad);
  // Fonts by name ("Inter") become Excalidraw's numbers before anything else sees them.
  const font = resolveFonts(body);
  if (font) throw new ApiError(400, "invalid_patch", font);
  for (const e of body.elements ?? []) {
    if (typeof e.id !== "string" || !e.id) throw new ApiError(400, "invalid_patch", "every entry in `elements` needs an `id`");
  }
  // Images: files are Excalidraw's {id, mimeType, dataURL}, allowed types, 4 MB each.
  if (body.files !== undefined) {
    if (!body.files || typeof body.files !== "object" || Array.isArray(body.files)) throw new ApiError(400, "invalid_patch", "`files` is an object of {id, mimeType, dataURL} by file id");
    for (const [k, f] of Object.entries(body.files)) {
      const problem = fileProblem(k, f);
      if (problem) throw new ApiError(400, "invalid_patch", problem);
    }
  }
  for (const e of [...(body.skeleton ?? []), ...(body.elements ?? [])]) {
    if (typeof e.src === "string") throw new ApiError(400, "invalid_patch", "an image `src` is read by the CLI; send `fileId` and `files` instead");
  }
  try {
    validateLayout(body.layout ?? []);
  } catch (err) {
    if (err instanceof LayoutError) throw new ApiError(400, err.code, err.message);
    throw err;
  }
}

/** @param {{store: any, tabs: any, pages: any}} ctx */
export function pageRoutes({ store, tabs, pages, waits }) {
  // Recent agent patches per page: a sync may report the editor's late layout
  // for them as the agent's (`layout`), but only for these elements and briefly.
  const LAYOUT_WINDOW_MS = 5000;
  const recentPatches = new Map(); // page -> [{ids: Set, at}]
  function notePatch(page, elements) {
    const now = Date.now();
    const list = (recentPatches.get(page) ?? []).filter((p) => now - p.at < LAYOUT_WINDOW_MS);
    list.push({ ids: new Set(elements.map((e) => e.id)), at: now });
    recentPatches.set(page, list);
  }
  function isPatchLayout(page, e) {
    const now = Date.now();
    return (recentPatches.get(page) ?? []).some((p) => now - p.at < LAYOUT_WINDOW_MS &&
      [e?.id, e?.containerId, e?.startBinding?.elementId, e?.endBinding?.elementId].some((id) => id && p.ids.has(id)));
  }

  return [
    ["GET", "/api/pages", ({ res }) => json(res, 200, { ...pages.info(), browsers: tabs.count("person") })],

    // A markdown doc's text, for the tab to render read-only.
    ["GET", "/api/docs/:doc", ({ res, params: { doc } }) => {
      const text = store.doc(doc);
      if (text === null) throw new ApiError(404, "unknown_page", `no doc "${doc}"`);
      return json(res, 200, { text });
    }],

    // Save a doc edited in the tab: {text, base}, base being the text the tab
    // started from. The file changed meanwhile: 409 doc_changed with its text,
    // and the tab merges.
    ["POST", "/api/docs/:doc", async ({ req, res, params: { doc } }) => {
      const { text, base } = await readJSON(req);
      if (typeof text !== "string" || typeof base !== "string") throw new ApiError(400, "invalid_json", "send {text, base}: both strings");
      if (Buffer.byteLength(text) > 2 * 1024 * 1024) throw new ApiError(413, "too_large", "a doc is at most 2 MB");
      try {
        store.writeDoc(doc, text, base);
      } catch (err) {
        if (err.code === "doc_changed") throw new ApiError(409, err.code, err.message, { text: err.text });
        throw err;
      }
      return json(res, 200, {});
    }],

    ["GET", "/api/pages/:page", ({ res, url, params: { page: name } }) => {
      // The page asks with ifMissing=empty when it opens a page the agent is about to create.
      if (url.searchParams.get("ifMissing") === "empty" && !store.exists(name)) {
        return json(res, 200, { rev: 0, exists: false, scene: { type: "excalidraw", version: 2, elements: [], appState: {}, files: {} } });
      }
      requirePage(store, name);
      const p = store.load(name);
      return json(res, 200, { rev: p.rev, scene: { ...p.scene, elements: store.elements(name) } });
    }],

    // Browser -> server: the person's edits, attributed to "user", and the
    // editor's late layout for an agent patch (`layout`), attributed to "agent".
    ["POST", "/api/pages/:page/sync", async ({ req, res, params: { page: name } }) => {
      const body = await readJSON(req);
      const claimed = Array.isArray(body.layout) ? body.layout : [];
      const layout = claimed.filter((e) => isPatchLayout(name, e));
      // A tab that hadn't heard yet would bring a deleted or renamed-away page back.
      if (store.retired(name)) throw new ApiError(409, "page_gone", `page "${name}" was deleted or renamed; open another page`);
      const own = [...(Array.isArray(body.elements) ? body.elements : []), ...claimed.filter((e) => !layout.includes(e))];
      const entries = [...store.merge(name, layout, "agent"), ...store.merge(name, own, "user")];
      store.addFiles(name, body.files);
      tabs.showing(body.tab, name);
      tabs.relay(name, [...layout, ...own], body.tab);
      return json(res, 200, { rev: store.load(name).rev, changed: entries.length });
    }],

    // Agent -> browser -> server.
    ["POST", "/api/pages/:page/patch", async ({ req, res, params: { page: name } }) => {
      const body = await readJSON(req);
      validatePatch(body);
      const createdPage = !store.exists(name);
      store.load(name);
      store.revive(name);
      // The page's base style for new skeleton elements; the editor never sees `defaults`.
      // Live elements only: an id reused after a delete is a new element and gets the defaults.
      const live = store.elements(name).filter((e) => !e.isDeleted);
      const existing = new Set(live.map((e) => e.id));
      // Pins become skeleton: the server numbers and places them; a set sent
      // again replaces the old one.
      if (body.pins) {
        const boxes = new Map(live.map((e) => [e.id, e]));
        for (const e of body.skeleton ?? []) if (e.id && typeof e.x === "number") boxes.set(e.id, { width: 0, height: 0, ...e, frameId: e.frameId ?? null });
        let made;
        try {
          made = pinSkeleton(body.pins, boxes);
        } catch (err) {
          throw new ApiError(400, "invalid_patch", err.message);
        }
        const old = pinIds(live, body.pins.id ?? "pins");
        body.delete = [...(body.delete ?? []), ...old.filter((id) => !made.some((m) => m.id === id))];
        for (const id of old) existing.delete(id);
        resolveFonts({ skeleton: made });
        body.skeleton = [...(body.skeleton ?? []), ...made];
        delete body.pins;
      }
      if (body.defaults) {
        body.skeleton = applyDefaults(body.skeleton, body.defaults, existing);
        delete body.defaults;
      }
      if (body.skeleton) lockBackdrops(body.skeleton, new Map(live.filter((e) => e.type === "frame").map((f) => [f.id, f])), existing);
      // Under those, the stage's medium (--style sketch|clean|hifi): strokes and fonts, never colours.
      if (body.style !== undefined) {
        try {
          applyStage(body, body.style, existing);
        } catch (err) {
          if (err instanceof StageError) throw new ApiError(400, err.code, err.message);
          throw err;
        }
        delete body.style;
      }
      // Every image needs its file: in this patch, or already on the page.
      const have = { ...(store.load(name).scene.files ?? {}), ...(body.files ?? {}) };
      const missing = [...(body.skeleton ?? []), ...(body.elements ?? [])].filter((e) => e.fileId && !have[e.fileId]).map((e) => e.id ?? e.fileId);
      if (missing.length) throw new ApiError(400, "invalid_patch", `image(s) without a file: ${missing.join(", ")}`);
      const reply = await tabs.ask("agent-patch", { page: name, ...body }, { page: name, needs: body.layout?.length ? "layout" : undefined });
      const entries = store.merge(name, reply.elements, "agent");
      store.addFiles(name, body.files); // before the relay, which sends files with their images
      notePatch(name, reply.elements ?? []);
      // Applied out of sight: the answering tab's visible editor may show this
      // page by now, so it gets the result like every other tab.
      tabs.relay(name, reply.elements, reply.offscreen ? undefined : reply.tab);
      // Layout problems among what the patch touched: hints, not errors.
      const warnings = involving(lint(store.elements(name)), new Set((reply.elements ?? []).map((e) => e.id)));
      return json(res, 200, { page: name, rev: store.load(name).rev, createdPage, created: reply.created || [], changed: entries, warnings });
    }],

    // GET reads from a revision; POST {since: "last"} also moves the consumer's
    // read cursor. Side effects never ride on a GET.
    [["GET", "POST"], "/api/pages/:page/changes", async ({ req, res, url, params: { page: name } }) => {
      requirePage(store, name);
      const q = req.method === "POST" ? await readJSON(req) : Object.fromEntries(url.searchParams);
      const sinceRaw = String(q.since ?? "0");
      const since = sinceRaw === "last" ? "last" : Number(sinceRaw);
      if (since === "last" && req.method === "GET") throw new ApiError(405, "invalid_argument", "since=last moves a read cursor: use POST");
      if (since !== "last" && !(Number.isInteger(since) && since >= 0)) throw new ApiError(400, "invalid_argument", "since must be a revision or \"last\"");
      const r = store.changes(name, { since, source: q.source || undefined, consumer: q.consumer || "default" });
      const changes = resolveChanges(r.entries, store.elements(name), store.bands(name));
      // brief: what an agent reads (the CLI asks for it); the full entries otherwise.
      return json(res, 200, { page: name, rev: r.rev, since: r.since, changes: q.brief ? brief(changes, { withSource: !q.source }) : changes });
    }],

    // Create an empty page now (the New page dialog): saved before anything is drawn.
    ["POST", "/api/pages/:page", ({ res, params: { page: name } }) => {
      // A doc (the New page dialog's Kind: Doc): an empty markdown file.
      if (name.endsWith(".md")) {
        store.createDoc(name);
        pages.announce();
        return json(res, 201, { page: name });
      }
      try {
        store.create(name);
      } catch (err) {
        const status = { page_exists: 409, bad_page_name: 400 }[err.code];
        if (status) throw new ApiError(status, err.code, err.message);
        throw err;
      }
      return json(res, 201, { page: name, rev: store.load(name).rev });
    }],

    // Rename a page; open tabs follow. Links that still name the old page are
    // listed for the caller to update (with a normal patch).
    ["POST", "/api/pages/:page/rename", async ({ req, res, params: { page: name } }) => {
      let to = normalizePageName((await readJSON(req)).to);
      // A markdown doc: the file moves; links that name it are listed the same way.
      if (name.endsWith(".md")) {
        try {
          to = store.renameDoc(name, to);
        } catch (err) {
          const status = { unknown_page: 404, page_exists: 409, bad_page_name: 400 }[err.code];
          if (status) throw new ApiError(status, err.code, err.message);
          throw err;
        }
        tabs.broadcast("page-renamed", { from: name, to });
        pages.announce();
        return json(res, 200, { from: name, to, staleLinks: store.linksTo(name) });
      }
      try {
        store.rename(name, to);
      } catch (err) {
        const status = { unknown_page: 404, page_exists: 409, bad_page_name: 400 }[err.code];
        if (status) throw new ApiError(status, err.code, err.message);
        throw err;
      }
      tabs.renamed(name, to);
      waits.renamed(name, to);
      tabs.broadcast("page-renamed", { from: name, to });
      pages.announce();
      return json(res, 200, { from: name, to, staleLinks: store.linksTo(name) });
    }],

    // Links on other pages that name this one (asked before deleting it).
    ["GET", "/api/pages/:page/links", ({ res, params: { page: name } }) => {
      if (name.endsWith(".md")) {
        if (!store.docExists(name)) throw new ApiError(404, "unknown_page", `no doc "${name}"`);
      } else requirePage(store, name);
      return json(res, 200, { page: name, links: store.linksTo(name).filter((l) => l.page !== name) });
    }],

    // Delete a page (the canvas page's Rename or move dialog; no CLI command):
    // its files go to .obeya/.trash/, and tabs showing it open another page.
    ["DELETE", "/api/pages/:page", ({ res, params: { page: name } }) => {
      if (name.endsWith(".md")) {
        const staleLinks = store.linksTo(name);
        try {
          store.deleteDoc(name);
        } catch (err) {
          if (err.code === "unknown_page") throw new ApiError(404, err.code, err.message);
          throw err;
        }
        tabs.broadcast("page-deleted", { page: name });
        pages.announce();
        return json(res, 200, { page: name, staleLinks });
      }
      const staleLinks = store.linksTo(name).filter((l) => l.page !== name);
      try {
        store.delete(name);
      } catch (err) {
        const status = { unknown_page: 404, last_page: 409 }[err.code];
        if (status) throw new ApiError(status, err.code, err.message);
        throw err;
      }
      tabs.deleted(name);
      waits.deleted(name);
      tabs.broadcast("page-deleted", { page: name });
      pages.announce();
      return json(res, 200, { page: name, staleLinks });
    }],

    ["GET", "/api/pages/:page/bands", ({ res, params: { page: name } }) => json(res, 200, { page: name, bands: store.bands(name) })],
    [["PUT", "DELETE"], "/api/pages/:page/bands/:band", async ({ req, res, params }) => {
      const name = params.page, band = params.band; // already decoded by the server
      if (!/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(band)) throw new ApiError(400, "invalid_argument", "bad band name");
      if (req.method === "PUT") {
        const b = await readJSON(req);
        const ok = ["x", "y"].includes(b.axis) && Number.isFinite(b.from) && Number.isFinite(b.to) && b.to >= b.from;
        if (!ok) throw new ApiError(400, "invalid_argument", "a band is {axis: \"x\"|\"y\", from, to} with to >= from");
        const bands = store.setBand(name, { name: band, axis: b.axis, from: b.from, to: b.to });
        return json(res, 200, { page: name, band: bands.find((x) => x.name === band), bands });
      }
      const bands = store.deleteBand(name, band);
      if (!bands) throw new ApiError(404, "unknown_band", `no band "${band}" on page "${name}"`);
      return json(res, 200, { page: name, deleted: band, bands });
    }],

    ["POST", "/api/pages/:page/show", async ({ req, res, params: { page: name } }) => {
      const body = await readJSON(req);
      requirePage(store, name);
      requireElement(store, name, body.frame);
      await tabs.ask("show", { page: name, frame: body.frame });
      return json(res, 200, { page: name, frame: body.frame ?? null, shown: true });
    }],

    // The agent waits for the person: answered when they press Done on this
    // page, on timeout, or when the server stops. No tab is moved.
    // body: {ask, frame?, consumer?, timeoutMs?}
    ["POST", "/api/pages/:page/wait", async ({ req, res, params: { page: name } }) => {
      const body = await readJSON(req);
      requirePage(store, name);
      requireElement(store, name, body.frame);
      if (typeof body.ask !== "string" || !body.ask.trim() || body.ask.length > 500) throw new ApiError(400, "invalid_argument", "ask is the text to show the person (1-500 characters)");
      const timeoutMs = body.timeoutMs ?? 0;
      if (!(Number.isFinite(timeoutMs) && timeoutMs >= 0)) throw new ApiError(400, "invalid_argument", "timeoutMs must be a number of milliseconds, 0 for none");
      if (body.consumer !== undefined && !/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(body.consumer)) throw new ApiError(400, "invalid_argument", "bad consumer name");
      waits.start(res, { page: name, frame: body.frame ?? null, ask: body.ask.trim(), consumer: body.consumer, timeoutMs });
    }],
    ["GET", "/api/waits", ({ res }) => json(res, 200, { waits: waits.list() })],
    // A tab: the person pressed Done.
    ["POST", "/api/waits/:id/done", ({ res, params: { id } }) => {
      if (!waits.finish(id, "button")) throw new ApiError(404, "unknown_wait", "no one is waiting on that any more");
      return json(res, 200, { ok: true });
    }],
  ];
}
