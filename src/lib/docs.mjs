// Markdown docs beside the drawings: heading anchors and links. Pure, no Node
// built-ins: the canvas page loads this file (served at /lib/docs.mjs).
//
// Anchors follow GitHub's rule, so a link to "spec.md#3-requirements" works on
// GitHub too. Links in a doc are written like links between drawings:
// "?page=<page>&element=<frame>" for a drawing, "other.md#heading" (relative to
// the doc's folder) or "#heading" for docs.

export const isDocName = (name) => typeof name === "string" && name.endsWith(".md");

/** GitHub's heading anchor: lower case, punctuation dropped, spaces to hyphens. */
export function slug(text) {
  return String(text).trim().toLowerCase()
    .replace(/<[^>]*>/g, "")
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");
}

/** Anchors for a doc's headings in order, with GitHub's -1, -2 for repeats. */
export function anchors(headings) {
  const seen = new Map();
  return headings.map((t) => {
    const base = slug(t);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return n ? `${base}-${n}` : base;
  });
}

/**
 * Where a link in doc `from` goes: {page, element?, heading?} inside obeya, or
 * {external: href} for the web (http, https, mailto). Anything else (javascript:,
 * data:, file:) is {blocked: true}.
 */
export function resolveDocHref(href, from) {
  const h = String(href ?? "").trim();
  if (!h) return { blocked: true };
  if (h.startsWith("#")) return { page: from, heading: decodeURIComponent(h.slice(1)) };
  if (h.startsWith("?")) {
    const q = new URLSearchParams(h.slice(1).split("#")[0]);
    const page = q.get("page") ?? from, hash = h.includes("#") ? decodeURIComponent(h.slice(h.indexOf("#") + 1)) : undefined;
    return { page, ...(q.get("element") ? { element: q.get("element") } : {}), ...(hash ? { heading: hash } : {}) };
  }
  if (/^(https?:|mailto:)/i.test(h)) return { external: h };
  if (/^[a-z][a-z0-9+.-]*:/i.test(h) || h.startsWith("//")) return { blocked: true };
  // A relative path: "other.md#x", "../notes/a.md", "sub/b.md".
  const [p, hash] = h.split("#");
  const parts = from.split("/").slice(0, -1);
  for (const seg of decodeURIComponent(p).split("/")) {
    if (seg === "..") parts.pop();
    else if (seg && seg !== ".") parts.push(seg);
  }
  const page = parts.join("/");
  if (!page) return { blocked: true };
  return { page, ...(hash ? { heading: decodeURIComponent(hash) } : {}) };
}
