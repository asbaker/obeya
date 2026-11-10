// The library commands: search, list, add, remove, show (with contact
// sheets), and helpers `library insert` shares.
import fs from "node:fs";
import path from "node:path";
import { itemSize, sheetFile, sheetPages, SHEET } from "../lib/library.mjs";
import { addLibrary, cacheDir, ensureLibrary, LibraryError, listCached, removeLibrary, search } from "../lib/libcache.mjs";
import { sameDir } from "../lib/paths.mjs";
import { CliError } from "./client.mjs";
import { withRenderer } from "./render.mjs";

/** Library errors carry their own codes; surface them as CLI errors. */
export async function lib(fn) {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof LibraryError) throw new CliError(err.code, err.message, err.extra);
    throw err;
  }
}

export const libSummary = (l) => ({
  id: l.id,
  name: l.name,
  authors: (l.authors ?? []).map((a) => a.name),
  origin: l.origin,
  source: l.source,
  license: l.license,
});

/** A labelled grid of every item, rendered like an export, split into images of SHEET.perSheet items. */
async function librarySheet(plan, client, note, env, cwd, library, out) {
  const pages = sheetPages(library.items);
  const abs = path.resolve(cwd, out);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  return withRenderer(plan, client, note, env, async () => {
    const sheets = [];
    for (const [n, pg] of pages.entries()) {
      const r = await client.call("POST", "/api/library-sheet", {
        title: `${library.name}: insert as ${library.id}/<label> (items ${pg.first}-${pg.last} of ${library.items.length})`,
        columns: pg.columns,
        cell: { w: SHEET.cellW, h: SHEET.cellH, art: SHEET.art },
        items: pg.items.map((it) => ({ label: it.id, elements: it.elements })),
      });
      const file = sheetFile(abs, n + 1, pages.length);
      fs.writeFileSync(file, Buffer.from(r.png, "base64"));
      sheets.push({ file, items: [pg.first, pg.last], width: r.width, height: r.height });
    }
    return sheets;
  });
}

/** Tell a running obeya server (never start one) that the library cache changed. */
export async function notifyLibraries(plan, client) {
  try {
    const i = await client.info();
    if (i && !i.foreign && sameDir(i.dir, plan.dir)) await client.call("POST", "/api/libraries/changed");
  } catch {} // best effort: the sidebar catches up on the next page load
}

/** library commands that need no obeya server (or start one only to render a sheet). */
export async function runLibrary(plan, client, note, env, cwd) {
  const { name: cmd, flags } = plan;
  switch (cmd) {
    case "library search": {
      const r = await lib(() => search(env, plan.words.join(" "), flags.limit ? Number(flags.limit) : 20));
      if (r.stale) note("couldn't refresh the catalogue; showing the cached copy");
      return { query: plan.words.join(" "), ...r };
    }
    case "library list":
      return { cache: cacheDir(env), libraries: listCached(env).map((m) => ({ ...libSummary(m), items: m.items, named: m.named })) };
    case "library add": {
      const l = await lib(() => addLibrary(env, plan.args.source, { as: flags.as, cwd }));
      await notifyLibraries(plan, client);
      return { ...libSummary(l), items: l.items.map((it) => ({ item: `${l.id}/${it.id}`, name: it.name, ...itemSize(it) })) };
    }
    case "library remove": {
      if (!removeLibrary(env, plan.args.lib)) throw new CliError("unknown_library", `"${plan.args.lib}" is not in your library cache`);
      await notifyLibraries(plan, client);
      return { removed: plan.args.lib };
    }
    case "library show": {
      const { lib: l, downloaded } = await lib(() => ensureLibrary(env, plan.args.lib));
      if (downloaded) {
        note(`downloaded ${l.id} into your library cache`);
        await notifyLibraries(plan, client);
      }
      const result = { ...libSummary(l), downloaded, items: l.items.map((it) => ({ item: `${l.id}/${it.id}`, name: it.name, ...itemSize(it) })) };
      if (flags.sheet) result.sheets = await librarySheet(plan, client, note, env, cwd, l, flags.sheet);
      return result;
    }
  }
  return null;
}
