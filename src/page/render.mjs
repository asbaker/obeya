// Work a tab does for the CLI: rendering images and library contact sheets,
// pointing the view (show), and the component libraries for the sidebar.
import { exportScene, restoreElements } from "./deps.mjs";
import { RENDERER, S } from "./state.mjs";
import { answer, fail, getJSON } from "./server-link.mjs";
import { flushSync } from "./sync.mjs";
import { openPage } from "./pages.mjs";
import { isCanvasLink } from "./links.mjs";
import { bounds, boxAround, capScale, frameToWiden, overlapsBox } from "/lib/geometry.mjs";

const AROUND_MARGIN = 40; // scene units of context around the elements a shot crops to
const AREA_ID = "__obeya_shot_area";

// A frame that isn't on the page, around `box`. Excalidraw's frame export clips
// to it and draws only its children, so the elements overlapping the box are
// handed over as (copied) children.
function cropTo(elements, box) {
  const frame = {
    id: AREA_ID, type: "frame", name: null, x: box.x1, y: box.y1, width: box.x2 - box.x1, height: box.y2 - box.y1,
    angle: 0, isDeleted: false, groupIds: [], frameId: null, boundElements: null, locked: false, link: null,
    strokeColor: "transparent", backgroundColor: "transparent", fillStyle: "solid", strokeWidth: 1, strokeStyle: "solid",
    roughness: 0, opacity: 100, roundness: null, seed: 1, version: 1, versionNonce: 1, updated: 0,
  };
  const inside = elements.filter((e) => e.type !== "frame" && overlapsBox(e, box)).map((e) => ({ ...e, frameId: AREA_ID }));
  return { frame, elements: [frame, ...inside] };
}

// Render images of saved pages without touching what the person is looking at.
export async function handleExport({ reqId, items, type, scale = 1, embedScene = false, padding = 20, background = true, dark = false, cap = false }) {
  try {
    await flushSync(); // include the person's latest edits
    const scenes = new Map();
    const out = [];
    for (const it of items) {
      if (!scenes.has(it.page)) scenes.set(it.page, (await getJSON(`/api/pages/${encodeURIComponent(it.page)}`)).scene);
      const scene = scenes.get(it.page);
      // Links into this canvas mean nothing in a shared file (they'd point at a
      // port on the recipient's machine); keep them only when the scene is
      // embedded to be reopened here. Ordinary web links stay.
      let elements = scene.elements
        .filter((e) => !e.isDeleted)
        .map((e) => (!embedScene && isCanvasLink(e.link) ? { ...e, link: null } : e));
      let exportingFrame = it.frame ? elements.find((e) => e.id === it.frame) : null;
      if (it.frame && !exportingFrame) return fail(reqId, "unknown_element", `no element ${it.frame} on page ${it.page}`);
      let widened = null;
      if (it.around) {
        const box = boxAround(elements, it.around, AROUND_MARGIN);
        if (!box) return fail(reqId, "unknown_element", `none of ${it.around.join(", ")} is on page ${it.page}`);
        // Most of a frame anyway? Then the frame itself: same cost, nothing cut off.
        widened = frameToWiden(elements, it.around, box)?.id ?? null;
        if (widened) exportingFrame = elements.find((e) => e.id === widened);
        else ({ frame: exportingFrame, elements } = cropTo(elements, box));
      }
      // Shots for an agent: no bigger than what a vision model reads (it would scale the rest down anyway).
      let s = scale;
      if (cap) {
        const b = exportingFrame ? bounds(exportingFrame) : elements.map(bounds).reduce((a, c) => ({ x1: Math.min(a.x1, c.x1), y1: Math.min(a.y1, c.y1), x2: Math.max(a.x2, c.x2), y2: Math.max(a.y2, c.y2) }), { x1: Infinity, y1: Infinity, x2: -Infinity, y2: -Infinity });
        const pad = exportingFrame ? 0 : padding * 2;
        s = capScale(b.x2 - b.x1 + pad, b.y2 - b.y1 + pad, scale);
      }
      const r = await exportScene({
        type,
        data: {
          elements,
          appState: { viewBackgroundColor: scene.appState?.viewBackgroundColor || "#ffffff" },
          files: scene.files || {},
        },
        // In this build rendering options go in config; appState only gives the default background.
        config: { exportingFrame, scale: s, padding, embedScene, theme: dark ? "dark" : "light", ...(background ? {} : { canvasBackgroundColor: false }) },
      });
      if (type === "svg") {
        out.push({ svg: r.outerHTML, width: Number(r.getAttribute("width")), height: Number(r.getAttribute("height")), ...(widened ? { widenedTo: widened } : {}) });
      } else {
        const bmp = await createImageBitmap(r);
        const png = await new Promise((res) => {
          const fr = new FileReader();
          fr.onload = () => res(String(fr.result).split(",")[1]);
          fr.readAsDataURL(r);
        });
        out.push({ png, width: bmp.width, height: bmp.height, ...(widened ? { widenedTo: widened } : {}) });
      }
    }
    answer(reqId, { items: out });
  } catch (err) {
    fail(reqId, "canvas_error", String(err?.stack || err));
  }
}

// A labelled grid of library items, so an agent can see what each item id is.
export async function handleLibrarySheet({ reqId, title, columns, cell, items }) {
  try {
    const PAD = 16, HEADER = 40, LABEL = 22;
    const rows = Math.ceil(items.length / columns);
    const canvas = document.createElement("canvas");
    canvas.width = PAD * 2 + columns * cell.w;
    canvas.height = HEADER + PAD + rows * cell.h;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#1e1e1e";
    ctx.font = "600 16px system-ui, sans-serif";
    ctx.fillText(title, PAD, 26);
    const fit = (text, max) => {
      if (ctx.measureText(text).width <= max) return text;
      while (text.length > 1 && ctx.measureText(text + "…").width > max) text = text.slice(0, -1);
      return text + "…";
    };
    for (const [i, it] of items.entries()) {
      const x = PAD + (i % columns) * cell.w, y = HEADER + Math.floor(i / columns) * cell.h;
      ctx.strokeStyle = "#e3e3e3";
      ctx.strokeRect(x + 4.5, y + 4.5, cell.w - 9, cell.h - 9);
      try {
        const elements = restoreElements(it.elements, null, { refreshDimensions: false }).filter((e) => !e.isDeleted);
        const svg = await exportScene({ type: "svg", data: { elements, appState: { viewBackgroundColor: "#ffffff", exportBackground: false }, files: {} }, config: { padding: 6 } });
        const img = new Image();
        img.src = "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svg.outerHTML)));
        await img.decode();
        const boxW = cell.w - 24, boxH = cell.art;
        const s = Math.min(boxW / img.width, boxH / img.height, 2);
        const w = img.width * s, h = img.height * s;
        ctx.drawImage(img, x + (cell.w - w) / 2, y + 10 + (boxH - h) / 2, w, h);
      } catch {
        ctx.fillStyle = "#c92a2a";
        ctx.font = "12px system-ui, sans-serif";
        ctx.fillText("(could not render)", x + 12, y + 40);
      }
      ctx.fillStyle = "#1e1e1e";
      // Shrink long ids before truncating them: the id is what the agent types.
      for (const px of [12, 11, 10, 9]) {
        ctx.font = `${px}px ui-monospace, Menlo, monospace`;
        if (ctx.measureText(it.label).width <= cell.w - 20) break;
      }
      ctx.fillText(fit(it.label, cell.w - 20), x + 10, y + cell.h - LABEL / 2 - 2);
    }
    const blob = await new Promise((r) => canvas.toBlob(r, "image/png"));
    const png = await new Promise((r) => {
      const fr = new FileReader();
      fr.onload = () => r(String(fr.result).split(",")[1]);
      fr.readAsDataURL(blob);
    });
    answer(reqId, { png, width: canvas.width, height: canvas.height });
  } catch (err) {
    fail(reqId, "canvas_error", String(err?.stack || err));
  }
}

export async function handleShow({ reqId, page, frame }) {
  try {
    await openPage(page, frame);
    answer(reqId, { ok: true });
  } catch (err) {
    fail(reqId, "canvas_error", String(err));
  }
}

// --- bundled component libraries in the library sidebar ---------------------------
export async function loadLibraries() {
  if (RENDERER || !S.api.updateLibrary) return;
  try {
    const { libraryItems } = await getJSON("/api/libraries");
    await S.api.updateLibrary({ libraryItems, merge: false, openLibraryMenu: false }); // mirror the cache exactly
    S.librariesLoaded = libraryItems.length;
  } catch (err) {
    console.warn("could not load the bundled libraries", err);
  }
}
