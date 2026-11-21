// Shown only in tabs on the page being waited on; elsewhere it stays quiet so
// the person keeps their focus.
import { React, h } from "../deps.mjs";
import { MAC, RENDERER, S } from "../state.mjs";
import { postJSON } from "../server-link.mjs";
import { flushSync } from "../sync.mjs";
import { toast } from "./common.mjs";

export const KEY_DONE = MAC ? "⌘↵" : "Ctrl+Enter";

export const waitsOn = (page) => (S.waits ?? []).filter((w) => w.page === page);

/** "● obeya - kanban" while an agent waits on this page: easy to find among browser tabs. */
export function setTitle() {
  if (!S.currentPage) return;
  document.title = `${waitsOn(S.currentPage).length ? "● " : ""}obeya - ${S.currentPage}`;
}

export function setWaits(waits) {
  S.waits = waits;
  setTitle();
  S.setUi((s) => ({ ...s, waits }));
}

/** The person is done: save their last edits first, so the agent reads them. */
export async function done(id) {
  try {
    await flushSync();
    await postJSON(`/api/waits/${encodeURIComponent(id)}/done`, {});
  } catch (err) {
    // Gone already: the agent stopped waiting, or another tab pressed Done.
    if (err.code !== "unknown_wait") toast(`Couldn't tell your agent: ${err.message}`, { duration: 5000 });
  }
}

const typing = (ev) => ev.target.closest?.("input, textarea, [contenteditable]");
if (!RENDERER) {
  document.addEventListener("keydown", (ev) => {
    const mod = MAC ? ev.metaKey : ev.ctrlKey;
    if (!mod || ev.key !== "Enter" || ev.shiftKey || ev.altKey || typing(ev)) return;
    const [w] = waitsOn(S.currentPage);
    if (!w) return;
    ev.preventDefault();
    ev.stopPropagation();
    done(w.id);
  }, true);
}

// The frames' boxes on screen, kept in step with scrolling and zooming.
const sameBox = (a, b) => ["left", "top", "width", "height"].every((k) => Math.abs(a[k] - b[k]) < 0.5);
function useFrameBoxes(frameIds) {
  const [boxes, setBoxes] = React.useState([]);
  const key = frameIds.join(",");
  React.useEffect(() => {
    if (!frameIds.length || !S.api) return setBoxes([]);
    const measure = () => {
      const byId = new Map(S.api.getSceneElements().map((e) => [e.id, e]));
      const { scrollX, scrollY, zoom, offsetLeft, offsetTop } = S.api.getAppState();
      const z = zoom.value;
      const next = frameIds.map((id) => byId.get(id)).filter(Boolean)
        .map((f) => ({ id: f.id, left: (f.x + scrollX) * z + offsetLeft, top: (f.y + scrollY) * z + offsetTop, width: f.width * z, height: f.height * z }));
      setBoxes((b) => (b.length === next.length && b.every((x, i) => x.id === next[i].id && sameBox(x, next[i])) ? b : next));
    };
    measure();
    // Scrolling and zooming change the app state, which the editor reports as a change.
    // Measure right then, not on the next animation frame: a frame later, the
    // outlines trail the drawing by one step on every pan.
    const off = typeof S.api.onChange === "function" ? S.api.onChange(measure) : (() => { const t = setInterval(measure, 200); return () => clearInterval(t); })();
    window.addEventListener("resize", measure);
    return () => { off?.(); window.removeEventListener("resize", measure); };
  }, [key]);
  return boxes;
}

// "2 min": how long the agent has waited, kept fresh.
function since(started) {
  const min = Math.floor((Date.now() - started) / 60000);
  return min < 1 ? "just now" : min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${min % 60} min`;
}
function useMinuteTick() {
  const [, set] = React.useState(0);
  React.useEffect(() => { const t = setInterval(() => set((n) => n + 1), 30000); return () => clearInterval(t); }, []);
}

export function WaitBanner({ waits }) {
  // Every frame any wait on this page asks about is outlined.
  const boxes = useFrameBoxes([...new Set(waits.flatMap((w) => w.frames ?? []))]);
  useMinuteTick();
  return h(React.Fragment, null,
    boxes.map((box) => h("div", { key: box.id, className: "xl-wait-frame", "data-testid": "wait-frame", "data-frame": box.id, style: { left: box.left - 6, top: box.top - 6, width: box.width + 12, height: box.height + 12 } })),
    h("div", { className: "xl-waits" },
      waits.map((w, i) => h("div", { key: w.id, className: "xl-wait", role: "status", "data-testid": "wait-banner" },
        h("span", { className: "xl-wait-icon", "aria-hidden": true }, h("img", { src: "/page/logo.svg", alt: "" })),
        h("div", { className: "xl-wait-text" },
          h("div", { className: "xl-wait-from" }, `Your agent is waiting for you · ${since(w.started)}`),
          h("div", { className: "xl-wait-ask", "data-testid": "wait-ask" }, w.ask)),
        h("button", { className: "xl-wait-done", onClick: () => done(w.id), "data-testid": "wait-done", title: i === 0 ? `Done (${KEY_DONE})` : "Done" },
          "Done", i === 0 ? h("kbd", null, KEY_DONE) : null)))));
}
