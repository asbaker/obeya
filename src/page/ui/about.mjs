// About obeya (☰ → About obeya): the logo, the version, where the pages are,
// and the one command an agent needs.
import { React, h, EXCALIDRAW_VERSION } from "../deps.mjs";
import { getJSON } from "../server-link.mjs";
import { closeOnBackdrop } from "./common.mjs";

export function AboutDialog({ onClose }) {
  const [info, setInfo] = React.useState(null);
  React.useEffect(() => { getJSON("/api/info").then(setInfo).catch(() => {}); }, []);
  const row = (label, value, testid) => h(React.Fragment, null, h("dt", null, label), h("dd", { "data-testid": testid }, value));
  return h("div", { className: "xl-backdrop", onMouseDown: closeOnBackdrop(onClose), onKeyDown: (ev) => { if (ev.key === "Escape") { ev.stopPropagation(); onClose(); } } },
    h("div", { className: "xl-modal xl-about", role: "dialog", "aria-label": "About obeya", "data-testid": "about-dialog", tabIndex: -1, ref: (el) => el && !el.contains(document.activeElement) && el.focus() },
      h("img", { className: "xl-lockup", src: "/page/logo-lockup.svg", alt: "obeya" }),
      h("p", { className: "xl-tagline" }, "A canvas you share with your AI agent."),
      h("dl", null,
        row("Version", info ? info.version : "…", "about-version"),
        row("Pages", h("code", null, info?.dir ?? "…")),
        row("Server", info ? `127.0.0.1:${info.port}` : "…"),
        row("For agents", h("code", null, "obeya --skill")),
        row("Editor", `Excalidraw ${EXCALIDRAW_VERSION} (MIT)`)),
      h("footer", null,
        h("span", null, "MIT licence · Not an official Excalidraw project."),
        h("button", { className: "primary", onClick: onClose }, "Close"))));
}
