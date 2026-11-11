// An agent waiting for the person (`obeya wait`): its ask in a banner under the
// toolbar, a Done button (Cmd/Ctrl+Enter), and the frame it's about outlined.
// Shown only in tabs on the page being waited on. Elsewhere it stays quiet so
// the person keeps their focus: the page pill counts the pages waited on, the
// picker marks them, and the waited page's tab title gets a "●".
import { React, h } from "../deps.mjs";
import { MAC, RENDERER, S } from "../state.mjs";
import { postJSON } from "../server-link.mjs";
import { flushSync } from "../sync.mjs";
import { toast } from "./common.mjs";

export const KEY_DONE = MAC ? "⌘↵" : "Ctrl+Enter";

/** The waits on `page`. */
export const waitsOn = (page) => (S.waits ?? []).filter((w) => w.page === page);

/** "● obeya - kanban" while an agent waits on this page: easy to find among browser tabs. */
export function setTitle() {
  if (!S.currentPage) return;
  document.title = `${waitsOn(S.currentPage).length ? "● " : ""}obeya - ${S.currentPage}`;
}

/** New list from the server. */
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

// The frame's box on screen, kept in step with scrolling and zooming.
function useFrameBox(frameId) {
  const [box, setBox] = React.useState(null);
  React.useEffect(() => {
    if (!frameId || !S.api) return setBox(null);
    let raf = 0;
    const measure = () => {
      raf = 0;
      const f = S.api.getSceneElements().find((e) => e.id === frameId);
      if (!f) return setBox(null);
      const { scrollX, scrollY, zoom, offsetLeft, offsetTop } = S.api.getAppState();
      const z = zoom.value;
      const next = { left: (f.x + scrollX) * z + offsetLeft, top: (f.y + scrollY) * z + offsetTop, width: f.width * z, height: f.height * z };
      setBox((b) => (b && ["left", "top", "width", "height"].every((k) => Math.abs(b[k] - next[k]) < 0.5) ? b : next));
    };
    const schedule = () => { if (!raf) raf = requestAnimationFrame(measure); };
    measure();
    // Scrolling and zooming change the app state, which the editor reports as a change.
    const off = typeof S.api.onChange === "function" ? S.api.onChange(schedule) : (() => { const t = setInterval(schedule, 200); return () => clearInterval(t); })();
    window.addEventListener("resize", schedule);
    return () => { off?.(); cancelAnimationFrame(raf); window.removeEventListener("resize", schedule); };
  }, [frameId]);
  return box;
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
  const box = useFrameBox(waits.find((w) => w.frame)?.frame ?? null);
  useMinuteTick();
  return h(React.Fragment, null,
    box ? h("div", { className: "xl-wait-frame", "data-testid": "wait-frame", style: { left: box.left - 6, top: box.top - 6, width: box.width + 12, height: box.height + 12 } }) : null,
    h("div", { className: "xl-waits" },
      waits.map((w, i) => h("div", { key: w.id, className: "xl-wait", role: "status", "data-testid": "wait-banner" },
        h("span", { className: "xl-wait-icon", "aria-hidden": true }, h("img", { src: "/page/logo.svg", alt: "" })),
        h("div", { className: "xl-wait-text" },
          h("div", { className: "xl-wait-from" }, `Your agent is waiting for you · ${since(w.started)}`),
          h("div", { className: "xl-wait-ask", "data-testid": "wait-ask" }, w.ask)),
        h("button", { className: "xl-wait-done", onClick: () => done(w.id), "data-testid": "wait-done", title: i === 0 ? `Done (${KEY_DONE})` : "Done" },
          "Done", i === 0 ? h("kbd", null, KEY_DONE) : null)))));
}
