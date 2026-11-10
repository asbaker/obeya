// Merge rules. Elements merge by id. The higher `version` wins; on a tie the
// lower `versionNonce` wins, which is the rule Excalidraw's own reconcile uses,
// so every replica settles on the same element.

/** Fields whose changes are worth reporting. Everything else (seed, updated, boundElements…) is noise. */
export const WATCHED = [
  "x", "y", "width", "height", "angle", "text", "frameId", "containerId",
  "backgroundColor", "strokeColor", "link", "groupIds", "points", "customData", "name",
];

/** Does `incoming` replace `current`? */
export function wins(incoming, current) {
  if (!current) return true;
  const vi = incoming.version ?? 0;
  const vc = current.version ?? 0;
  if (vi !== vc) return vi > vc;
  return (incoming.versionNonce ?? 0) < (current.versionNonce ?? 0);
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Classify the change from `before` (maybe undefined) to `after`. */
export function describeChange(before, after) {
  if (!before) return { op: after.isDeleted ? "noop" : "added", fields: [] };
  if (!before.isDeleted && after.isDeleted) return { op: "deleted", fields: [] };
  if (before.isDeleted && !after.isDeleted) return { op: "restored", fields: [] };
  if (before.isDeleted && after.isDeleted) return { op: "noop", fields: [] };
  const fields = WATCHED.filter((k) => !same(before[k], after[k]));
  return { op: fields.length ? "modified" : "noop", fields };
}

const r = Math.round;

/**
 * Merge `incoming` into `byId` (mutated). Returns one change record per
 * element that won and changed something reportable, without rev/at/source.
 * @param {Map<string, any>} byId
 * @param {any[]} incoming
 */
export function mergeElements(byId, incoming) {
  const changes = [];
  for (const el of incoming) {
    if (!el || typeof el.id !== "string" || !el.id) continue;
    const cur = byId.get(el.id);
    if (!wins(el, cur)) continue;
    byId.set(el.id, el);
    const { op, fields } = describeChange(cur, el);
    if (op === "noop") continue;
    const c = { op, id: el.id, type: el.type, fields };
    if (el.containerId) c.containerId = el.containerId;
    if (op === "modified" && (fields.includes("x") || fields.includes("y"))) {
      c.moved = { from: [r(cur.x), r(cur.y)], to: [r(el.x), r(el.y)] };
    }
    if (op === "modified" && fields.includes("frameId")) {
      c.frameChange = { from: cur.frameId ?? null, to: el.frameId ?? null };
    }
    changes.push(c);
  }
  return changes;
}
