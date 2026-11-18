import { React, h, EXCALIDRAW_VERSION } from "../deps.mjs";
import { getJSON } from "../server-link.mjs";
import { closeOnBackdrop } from "./common.mjs";

const UPDATE_COMMAND = "npm update -g obeya && npx skills update obeya";
const RELEASES = "https://github.com/asbaker/obeya/releases/tag/v";

function News({ update }) {
  const [copied, setCopied] = React.useState(false);
  const copy = () => navigator.clipboard?.writeText(UPDATE_COMMAND).then(() => {
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }).catch(() => {});
  return h("section", { className: "xl-news", "data-testid": "about-news" },
    h("div", { className: "xl-news-top" },
      h("span", { className: "xl-news-eyebrow" }, "Update available"),
      h("a", { className: "xl-news-link", href: RELEASES + update.to, target: "_blank", rel: "noopener" }, "What's new →")),
    h("h3", null, `obeya ${update.to} is out`),
    update.headline ? h("p", { className: "xl-news-head", "data-testid": "about-news-head" }, update.headline) : null,
    h("p", { className: "xl-news-how" }, "Ask your agent to update, or run it yourself:"),
    h("div", { className: "xl-news-cmd" },
      h("code", null, UPDATE_COMMAND),
      h("button", { onClick: copy, "data-testid": "about-news-copy" }, copied ? "Copied" : "Copy")));
}

export function AboutDialog({ update, onClose }) {
  const [info, setInfo] = React.useState(null);
  React.useEffect(() => { getJSON("/api/info").then(setInfo).catch(() => {}); }, []);
  const row = (label, value, testid) => h(React.Fragment, null, h("dt", null, label), h("dd", { "data-testid": testid }, value));
  return h("div", { className: "xl-backdrop", onMouseDown: closeOnBackdrop(onClose), onKeyDown: (ev) => { if (ev.key === "Escape") { ev.stopPropagation(); onClose(); } } },
    h("div", { className: "xl-modal xl-about", role: "dialog", "aria-label": "About obeya", "data-testid": "about-dialog", tabIndex: -1, ref: (el) => el && !el.contains(document.activeElement) && el.focus() },
      h("img", { className: "xl-lockup", src: "/page/logo-lockup.svg", alt: "obeya" }),
      h("p", { className: "xl-tagline" }, "A canvas you share with your AI agent."),
      update?.to ? h(News, { update }) : null,
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
