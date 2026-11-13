// `export`: assemble images or a deck (lib/exporter.mjs) and write the files.
import fs from "node:fs";
import path from "node:path";
import { buildExport, ExportError } from "../lib/exporter.mjs";
import { findChrome } from "../lib/chrome.mjs";
import { ensureSidecar, sidecarDir } from "../lib/paths.mjs";
import { CliError } from "./client.mjs";
import { withRenderer } from "./render.mjs";

export async function runExport(plan, client, note, env, cwd) {
  const { flags } = plan;
  const fmt = flags.format;
  const out = path.resolve(cwd, flags.out);
  const pages = [];
  for (const name of plan.pages) pages.push({ name, elements: (await client.call("GET", `/api/pages/${encodeURIComponent(name)}`)).scene.elements });
  const render = (items, type) =>
    withRenderer(plan, client, note, env, () =>
      client.call("POST", "/api/export", {
        items: items.map((s) => ({ page: s.page, frame: s.frame ?? undefined })),
        type,
        ...imageOptions(flags),
      }),
    ).then((r) => r.items);
  let result;
  try {
    result = await buildExport(
      { format: fmt, pages, frames: Boolean(flags.frames), frame: flags.frame, order: flags.order ? flags.order.split(",") : undefined, title: flags.title },
      { render, chrome: fmt === "pdf" ? findChrome(env) : null, workDir: (ensureSidecar(plan.dir), sidecarDir(plan.dir)) },
    );
  } catch (err) {
    if (err instanceof ExportError) throw new CliError(err.code, err.message);
    throw err;
  }
  if (result.files) {
    fs.mkdirSync(out, { recursive: true });
    // File names inside --out: the agent didn't choose them. Nothing else echoes the call.
    const files = result.files.map((f) => {
      fs.writeFileSync(path.join(out, f.name), f.data);
      return { file: f.name, frame: f.frame, width: f.width, height: f.height };
    });
    return { files };
  }
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, result.file.data);
  if (result.summary) return { ...result.summary };
  return { width: result.file.width, height: result.file.height };
}

/** The image options `export` passes to the renderer. */
const imageOptions = (flags) => ({
  scale: flags.scale ? Number(flags.scale) : 1,
  embedScene: Boolean(flags["embed-scene"]),
  padding: flags.padding !== undefined ? Number(flags.padding) : 20,
  background: !flags["no-background"],
  dark: Boolean(flags.dark),
});
