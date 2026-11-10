import { React, h } from "../deps.mjs";
import { KEY_PRESENT } from "../state.mjs";
import { setPresent, stepFrame } from "../present.mjs";

// ‹ 2 / 12 › Exit, at the bottom while presenting. Fades when the mouse rests.
export function PresentControls({ pos }) {
  const [idle, setIdle] = React.useState(false);
  React.useEffect(() => {
    let t = setTimeout(() => setIdle(true), 2000);
    const wake = () => { setIdle(false); clearTimeout(t); t = setTimeout(() => setIdle(true), 2000); };
    document.addEventListener("mousemove", wake);
    return () => { clearTimeout(t); document.removeEventListener("mousemove", wake); };
  }, []);
  return h("div", { className: "xl-presenting" + (idle ? " idle" : ""), "data-testid": "present-controls" },
    h("button", { onClick: () => stepFrame(-1), "data-testid": "present-prev", title: "Previous frame (←)" }, "‹"),
    h("span", { className: "pos", "data-testid": "present-pos" }, `${pos.i} / ${pos.n}`),
    h("button", { onClick: () => stepFrame(1), "data-testid": "present-next", title: "Next frame (→)" }, "›"),
    h("button", { onClick: () => setPresent(false), "data-testid": "present-exit", title: `Stop presenting (Esc or ${KEY_PRESENT})` }, "✕ Exit"));
}
