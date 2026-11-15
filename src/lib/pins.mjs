// Numbered pins: review notes in one patch key. The agent says what each pin
// is on and what it says; the server numbers them, puts each circle on its
// element's top-right corner and lays the notes out beside the elements, so
// the agent writes no coordinates. Re-sending the same `id` replaces the set
// (renumbering after a pin is dropped). Pure: no Node built-ins.
//
//   {"pins": {"id": "review", "items": [{"on": "card-3", "note": "Too small"}],
//             "notes": "right", "color": "#db2777", "size": 24}}
//
// Each circle carries customData {pin: n, on: id, set: id} so readback says
// "pin 3 → card-3".

const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
const KEYS = ["id", "items", "notes", "color", "size"];
const ID = /^[A-Za-z0-9_-]{1,40}$/;

/** A problem with `pins`, or null. */
export function pinsProblem(p) {
  if (p === undefined) return null;
  if (!isObj(p)) return "`pins` is {items: [{on, note}], id?, notes?: \"right\"|\"below\", color?, size?}";
  const extra = Object.keys(p).filter((k) => !KEYS.includes(k));
  if (extra.length) return `pins: unknown key(s) ${extra.join(", ")}; allowed: ${KEYS.join(", ")}`;
  if (!Array.isArray(p.items) || !p.items.length) return "pins.items: a list of {on, note}";
  for (const [i, it] of p.items.entries()) {
    if (!isObj(it) || typeof it.on !== "string" || !it.on || typeof it.note !== "string") return `pins.items[${i}] needs \`on\` (an element id) and \`note\` (text)`;
  }
  if (p.id !== undefined && (typeof p.id !== "string" || !ID.test(p.id))) return "pins.id: letters, digits, - and _, up to 40";
  if (p.notes !== undefined && !["right", "below"].includes(p.notes)) return "pins.notes is \"right\" or \"below\"";
  if (p.color !== undefined && (typeof p.color !== "string" || !/^#[0-9a-f]{3,8}$/i.test(p.color))) return "pins.color is a #hex colour";
  if (p.size !== undefined && !(typeof p.size === "number" && p.size >= 10 && p.size <= 200)) return "pins.size is the note text size, 10–200";
  return null;
}

/** Ids of the elements a previous run of this pin set made (to delete before redrawing). */
export function pinIds(elements, set) {
  return elements.filter((e) => !e.isDeleted && !e.containerId && e.customData?.pins === set).map((e) => e.id);
}

/**
 * The skeleton for a pin set. `boxes` maps id → {x, y, width, height, frameId}
 * for the elements pinned (from the page, or this patch's skeleton). Throws
 * a message naming an unknown id.
 */
export function pinSkeleton(p, boxes) {
  const set = p.id ?? "pins";
  const color = p.color ?? "#db2777";
  const size = p.size ?? 24;
  const d = Math.round(size * 1.6);
  const out = [];
  const targets = p.items.map((it, i) => {
    const b = boxes.get(it.on);
    if (!b) throw new Error(`pins.items[${i}]: no element "${it.on}" on the page or in this patch`);
    return { ...it, n: i + 1, b };
  });
  const frameId = targets[0].b.frameId ?? null;
  const x1 = Math.min(...targets.map((t) => t.b.x)), y1 = Math.min(...targets.map((t) => t.b.y));
  const x2 = Math.max(...targets.map((t) => t.b.x + t.b.width)), y2 = Math.max(...targets.map((t) => t.b.y + t.b.height));
  // Notes that don't fit in the frame (a slide) go just outside it, unframed:
  // review notes, not part of what's presented or exported.
  const frame = frameId ? boxes.get(frameId) : null;
  const noteW = Math.max(...targets.map((t) => Math.max(...t.note.split("\n").map((l) => l.length)))) * size * 0.55;
  const common = { roughness: 0, fillStyle: "solid", frameId };
  const outside = { ...common, frameId: null };
  const circle = (id, x, y, n, extra = {}) => ({ type: "ellipse", id, x, y, width: d, height: d, strokeColor: color, backgroundColor: color, ...common, ...extra,
    label: { text: String(n), fontSize: Math.round(size * 0.85), strokeColor: "#ffffff", fontFamily: "Helvetica" } });
  for (const t of targets) {
    out.push(circle(`${set}-${t.n}`, t.b.x + t.b.width - d / 2, t.b.y - d / 2, t.n, { customData: { pins: set, pin: t.n, on: t.on } }));
  }
  // Notes: a column to the right of everything pinned (each note level with its
  // pin, pushed down so none overlap), or rows below it.
  const gap = Math.round(size * 0.8), lineH = Math.round(size * 1.35);
  const height = (s) => Math.max(d, s.split("\n").length * lineH);
  const total = targets.reduce((a, t) => a + height(t.note) + gap, 0);
  if ((p.notes ?? "right") === "right") {
    let x = x2 + gap * 3, where = common;
    if (frame && x + d + gap + noteW > frame.x + frame.width) { x = frame.x + frame.width + gap * 2; where = outside; }
    let y = -Infinity;
    for (const t of [...targets].sort((a, b) => a.b.y - b.b.y)) {
      const top = Math.max(t.b.y - d / 2, y);
      out.push(circle(`${set}-${t.n}-k`, x, top, t.n, { ...where, customData: { pins: set } }));
      out.push({ type: "text", id: `${set}-${t.n}-t`, x: x + d + gap, y: top + (d - lineH) / 2, text: t.note, fontSize: size, strokeColor: "#1e1e1e", ...where, customData: { pins: set } });
      y = top + height(t.note) + gap;
    }
  } else {
    let y = y2 + gap * 2, where = common;
    if (frame && y + total > frame.y + frame.height) { y = frame.y + frame.height + gap * 2; where = outside; }
    for (const t of targets) {
      out.push(circle(`${set}-${t.n}-k`, x1, y, t.n, { ...where, customData: { pins: set } }));
      out.push({ type: "text", id: `${set}-${t.n}-t`, x: x1 + d + gap, y: y + (d - lineH) / 2, text: t.note, fontSize: size, strokeColor: "#1e1e1e", ...where, customData: { pins: set } });
      y += height(t.note) + gap;
    }
  }
  return out;
}
