import { exportStem } from "/lib/names.mjs";
import { React, h } from "../deps.mjs";
import { getJSON } from "../server-link.mjs";
import { flushSync } from "../sync.mjs";
import { framesInOrder } from "../present.mjs";
import { closeOnBackdrop, toast } from "./common.mjs";

// The export dialog: this page only. PNG and SVG export ticked
// frames or the whole page; PDF and HTML deck are made from frames. Downloads
// come from the server, which runs the same code as the CLI's `export`.
const FORMATS = [
  { key: "png", name: "PNG", sub: "Pictures" },
  { key: "svg", name: "SVG", sub: "Scalable" },
  { key: "pdf", name: "PDF", sub: "Slides, print", deck: true },
  { key: "html", name: "HTML deck", sub: "Clickable, offline", deck: true },
];
const shellQuote = (s) => (/^[\w./:@-]+$/.test(s) ? s : `'${String(s).replace(/'/g, `'\\''`)}'`);

export function ExportDialog({ page, onClose }) {
  const frames0 = React.useMemo(() => framesInOrder().map((f) => ({ id: f.id, name: f.name || f.id, on: true })), []);
  const [fmt, setFmt] = React.useState("png");
  const [what, setWhat] = React.useState(frames0.length ? "frames" : "page");
  const [frames, setFrames] = React.useState(frames0);
  const [o, setO] = React.useState({ scale: 2, background: true, dark: false, padding: 20, embed: false, titleOn: true, title: page });
  const [stem, setStem] = React.useState(exportStem(page)); // project-a/overview -> project-a-overview
  const [info, setInfo] = React.useState(null);
  const [busy, setBusy] = React.useState(null);
  const [error, setError] = React.useState(null);
  const [dragging, setDragging] = React.useState(null);
  React.useEffect(() => { getJSON("/api/info").then(setInfo).catch(() => {}); }, []);
  const opt = (k) => (v) => setO((s) => ({ ...s, [k]: v }));
  const f = FORMATS.find((x) => x.key === fmt);
  const deck = Boolean(f.deck), image = !deck;
  const usesFrames = deck || what === "frames";
  const picked = frames.filter((x) => x.on);
  const many = image && usesFrames && picked.length > 1;
  const ext = many ? "zip" : fmt;
  const noChrome = fmt === "pdf" && info && !info.pdf;
  const blocked = noChrome ? "PDF is made by Chrome, which isn't installed here. Use HTML deck and print it, or install Chrome."
    : usesFrames && !picked.length ? (frames.length ? "Tick at least one frame." : "This page has no frames. Add a frame (F), or export the whole page as a picture.") : null;

  const request = () => ({
    format: fmt, fileName: stem,
    ...(usesFrames ? { frames: picked.map((x) => x.id) } : {}),
    ...(image ? { scale: fmt === "png" ? o.scale : 1, padding: o.padding, background: o.background, dark: o.dark, embedScene: o.embed } : {}),
    ...(deck && o.titleOn && o.title.trim() ? { title: o.title.trim() } : {}),
  });
  // The same export as a command, so an agent can repeat it.
  const cli = () => {
    const all = frames.length === picked.length && picked.every((x, i) => x.id === frames[i].id);
    const a = ["obeya", "export", shellQuote(page), "--format", fmt];
    if (image && usesFrames) a.push(...(picked.length === 1 ? ["--frame", picked[0].id] : ["--frames", ...(all ? [] : ["--order", picked.map((x) => x.id).join(",")])]));
    if (deck && !all) a.push("--order", picked.map((x) => x.id).join(","));
    if (deck && o.titleOn && o.title.trim()) a.push("--title", shellQuote(o.title.trim()));
    if (fmt === "png" && o.scale !== 1) a.push("--scale", String(o.scale));
    if (image && o.padding !== 20) a.push("--padding", String(o.padding));
    if (image && !o.background) a.push("--no-background");
    if (image && o.dark) a.push("--dark");
    if (image && o.embed) a.push("--embed-scene");
    a.push("--out", shellQuote(many ? `${stem}/` : `${stem}.${fmt}`));
    if (info) a.push("--dir", shellQuote(info.dir), "--port", String(info.port));
    return a.join(" ");
  };
  const copyCli = () => navigator.clipboard.writeText(cli()).then(() => toast("Copied the export as a CLI command."), () => toast(cli(), { duration: 10000 }));

  const download = async () => {
    if (blocked || busy) return;
    const ctrl = new AbortController();
    setBusy(ctrl);
    setError(null);
    try {
      await flushSync();
      const r = await fetch(`/api/pages/${encodeURIComponent(page)}/export-file`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(request()), signal: ctrl.signal });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error?.message || `HTTP ${r.status}`);
      const blob = await r.blob();
      const cd = r.headers.get("content-disposition") ?? "";
      const utf8 = /filename\*=UTF-8''([^;]+)/.exec(cd)?.[1];
      const name = (utf8 ? decodeURIComponent(utf8) : /filename="([^"]+)"/.exec(cd)?.[1]) ?? `${stem}.${ext}`;
      const n = Number(r.headers.get("x-export-files") || 1);
      const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: name });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 30000);
      onClose();
      toast(`Downloaded ${name}${n > 1 ? ` · ${n} files` : ""}`);
    } catch (err) {
      if (err.name !== "AbortError") setError(err.message);
    } finally {
      setBusy(null);
    }
  };
  const close = () => { busy?.abort(); onClose(); };
  const onKey = (ev) => {
    if (ev.key === "Escape") { ev.stopPropagation(); close(); }
  };
  const move = (from, to) => setFrames((list) => { const l = [...list]; const [x] = l.splice(from, 1); l.splice(to, 0, x); return l; });

  const sw = (k, label, hint) => h("div", { className: "xl-opt" },
    h("span", null, label, hint ? h("div", { className: "muted" }, hint) : null),
    h("label", { className: "xl-switch", "data-testid": `export-${k}` }, h("input", { type: "checkbox", checked: o[k], onChange: (e) => opt(k)(e.target.checked), "aria-label": label }), h("span")));
  const options = image
    ? [
        fmt === "png" ? h("div", { key: "scale", className: "xl-opt" }, h("span", null, "Scale"),
          h("div", { className: "xl-seg" }, [1, 2, 3].map((n) => h("button", { key: n, className: o.scale === n ? "on" : "", onClick: () => opt("scale")(n) }, `${n}x`)))) : null,
        h(React.Fragment, { key: "bg" }, sw("background", "Background")),
        h(React.Fragment, { key: "dark" }, sw("dark", "Dark mode")),
        fmt === "svg" ? h(React.Fragment, { key: "embed" }, sw("embed", "Reopenable", "Embeds the drawing so Excalidraw can open it again")) : null,
        h("div", { key: "pad", className: "xl-opt" }, h("span", null, "Padding"),
          h("span", null, h("input", { type: "number", min: 0, max: 400, value: o.padding, onChange: (e) => opt("padding")(Math.max(0, Math.min(400, Math.round(Number(e.target.value) || 0)))), "data-testid": "export-padding" }), " px")),
      ]
    : [
        h("div", { key: "title", className: "xl-opt" },
          h("label", null, h("input", { type: "checkbox", checked: o.titleOn, onChange: (e) => opt("titleOn")(e.target.checked) }), " Title slide"),
          h("input", { type: "text", value: o.title, disabled: !o.titleOn, onChange: (e) => opt("title")(e.target.value), onKeyDown: (e) => e.stopPropagation() })),
        h("p", { key: "notes", className: "muted" }, "Speaker notes (a frame's notes) and links between frames are always included."),
        h("p", { key: "about", className: "muted" }, fmt === "pdf" ? "16:9 vector slides, one per page. Made by Chrome." : "One self-contained file; works offline. Arrow keys or click to advance; N shows notes."),
      ];
  const slides = [...(deck && o.titleOn && o.title.trim() ? [{ title: true, name: o.title.trim() }] : []), ...(usesFrames ? picked : [{ name: "Whole page" }])];

  const body = busy
    ? h("div", { className: "xl-progress", "data-testid": "export-progress" },
        h("div", null, `Exporting ${usesFrames ? `${picked.length} frame${picked.length === 1 ? "" : "s"}` : "the page"} as ${f.name}…`),
        h("div", { className: "xl-bar" }),
        h("div", { className: "muted" }, "Big pages take a few seconds."))
    : h("div", { className: "body" },
        h("div", { className: "col" },
          usesFrames
            ? h(React.Fragment, null,
                h("div", { className: "xl-section", style: { margin: "0 0 8px" } }, deck ? "Slides, in order" : "Frames, in order"),
                frames.length
                  ? h(React.Fragment, null,
                      h("label", { className: "xl-framerow", style: { border: 0 } },
                        h("input", { type: "checkbox", checked: picked.length === frames.length, onChange: (e) => setFrames((l) => l.map((x) => ({ ...x, on: e.target.checked }))), "data-testid": "export-all" }), " Select all"),
                      frames.map((x, i) => h("div", {
                        key: x.id, className: "xl-framerow" + (dragging === i ? " drag" : ""), draggable: true, "data-testid": "export-frame",
                        onDragStart: (e) => { setDragging(i); e.dataTransfer.effectAllowed = "move"; },
                        onDragOver: (e) => { e.preventDefault(); if (dragging !== null && dragging !== i) { move(dragging, i); setDragging(i); } },
                        onDragEnd: () => setDragging(null),
                      },
                        h("label", { title: x.name }, h("input", { type: "checkbox", checked: x.on, onChange: (e) => setFrames((l) => l.map((y) => (y.id === x.id ? { ...y, on: e.target.checked } : y))) }), x.name),
                        h("span", { className: "grip", title: "Drag to reorder" }, "⋮⋮"))),
                      h("p", { className: "muted" }, "Drag ⋮⋮ to reorder for this export. The page's frames don't change."))
                  : h("p", { className: "muted" }, "This page has no frames."))
            : h(React.Fragment, null,
                h("div", { className: "xl-section", style: { margin: "0 0 8px" } }, "The whole page"),
                h("p", { className: "muted" }, "Everything on the page, frames included, as one picture with a margin."))),
        h("div", { className: "col" },
          h("div", { className: "xl-section", style: { margin: "0 0 8px" } }, "Format"),
          h("div", { className: "xl-tiles" }, FORMATS.map((x) => {
            const needsFrames = x.deck && !frames.length;
            const off = x.key === "pdf" && info && !info.pdf;
            return h("button", { key: x.key, className: "xl-tile" + (x.key === fmt ? " on" : "") + (off ? " off" : ""), disabled: needsFrames, onClick: () => setFmt(x.key), "data-testid": `export-format-${x.key}` },
              h("b", null, x.name), h("span", null, needsFrames ? "needs frames" : off ? "needs Chrome" : x.sub));
          })),
          h("div", { className: "xl-section", style: { margin: "16px 0 4px" } }, "Options"),
          ...options),
        h("div", { className: "col" },
          h("div", { className: "xl-section", style: { margin: "0 0 8px" } }, "Preview"),
          slides.slice(0, 4).map((s, i) => h("div", { key: i, className: "xl-slide" + (s.title ? " title" : "") }, s.title ? `Title: ${s.name}` : s.name)),
          slides.length > 4 ? h("div", { className: "muted" }, `+ ${slides.length - 4} more`) : null,
          h("div", { className: "muted", style: { marginTop: 8 } }, deck ? `${slides.length} slide${slides.length === 1 ? "" : "s"}` : many ? `${picked.length} files in one .zip` : "1 file")));

  return h("div", { className: "xl-backdrop", onMouseDown: closeOnBackdrop(close), onKeyDown: onKey },
    h("div", { className: "xl-modal xl-export", role: "dialog", "aria-label": "Export", "data-testid": "export-dialog", tabIndex: -1, ref: (el) => el && !el.contains(document.activeElement) && el.focus() },
      h("header", null,
        h("h2", null, "Export ", h("span", { className: "xl-muted", style: { fontSize: 14, fontWeight: 400 } }, `${page} · ${usesFrames ? `${picked.length} of ${frames.length} frames` : "whole page"}`)),
        h("button", { className: "xl-link", onClick: close, "aria-label": "Close", style: { color: "#868e96", fontSize: 18 } }, "✕")),
      image && !busy
        ? h("div", { className: "what" },
            h("div", { className: "xl-seg" },
              h("button", { className: what === "frames" ? "on" : "", disabled: !frames.length, onClick: () => setWhat("frames"), "data-testid": "export-what-frames" }, "Frames"),
              h("button", { className: what === "page" ? "on" : "", onClick: () => setWhat("page"), "data-testid": "export-what-page" }, "Whole page")),
            h("span", { className: "muted" }, what === "page" ? "Everything on the page as one picture" : "Each ticked frame becomes its own picture"))
        : !busy ? h("div", { className: "what muted" }, "One slide per ticked frame, in slide order. Decks are always made from frames.") : null,
      error ? h("div", { className: "xl-error", "data-testid": "export-error" }, error) : null,
      !busy && blocked ? h("div", { className: "xl-error" }, blocked) : null,
      body,
      h("footer", null,
        busy ? h("span") : h("span", { className: "xl-filename" }, "File name ",
          h("input", { type: "text", value: stem, onChange: (e) => setStem(e.target.value), onKeyDown: (e) => { e.stopPropagation(); if (e.key === "Enter") download(); }, "data-testid": "export-filename" }), `.${ext}`,
          h("button", { className: "xl-link", style: { marginLeft: 14 }, onClick: copyCli, "data-testid": "export-copy-cli" }, "⧉ Copy as CLI command")),
        h("span", null,
          h("button", { onClick: close }, "Cancel"), " ",
          busy ? null : h("button", { className: "primary", disabled: Boolean(blocked), onClick: download, "data-testid": "export-download" }, `Download .${ext}`)))));
}
