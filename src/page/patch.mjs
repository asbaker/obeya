// Agent patches: validated, laid out, converted and applied in one
// undo step, in the visible editor for the page on screen or an invisible
// second editor for any other page.
import { computeLayout } from "/lib/layout.mjs";
import { frameAt, outsideOf } from "/lib/geometry.mjs";
import { h, createRoot, Excalidraw, convertToExcalidrawElements, restoreElements, CaptureUpdateAction } from "./deps.mjs";
import { S, changedSinceKnown } from "./state.mjs";
import { answer, fail, getJSON } from "./server-link.mjs";
import { editorJob, flushSync, nextFrame, onChange, relatedTo, settle } from "./sync.mjs";
import { focusFrame } from "./present.mjs";
import { bindArrow, splitArrowBindings } from "./arrows.mjs";
import { toast } from "./ui/common.mjs";

// --- where a patch is applied ------------------------------------------------------
// The visible editor, for the page on screen; an invisible second editor for any
// other page. Both expose the same small interface to the patch code.
const changedSince = (ed) => ed.api.getSceneElementsIncludingDeleted().filter((e) => ed.known.get(e.id) !== e.version);
const visibleEditor = (hold) => ({
  offscreen: false,
  get api() { return S.api; },
  get known() { return S.known; },
  // Sync the person's pending edits first, so they are never attributed to the
  // agent. Edits made while a sync was in flight need another round. From the
  // scene snapshot to updateScene the patch code is synchronous, so no input
  // can slip in between.
  async flushPending() { await flushSync(); },
  setApplying(on) { on ? hold.enter("PATCH") : hold.leave(); },
  afterApply() { if (S.focusedFrame) focusFrame(S.focusedFrame); }, // new elements outside the frame stay hidden
  afterAnswer(touched) {
    settle(touched);
    if (changedSinceKnown().length) onChange(); // edits made while we were applying
  },
});
// The invisible editor: mounted once, off screen, with no onChange, so nothing
// it does is ever sent up as the person's edit. Each patch loads its page fresh.
let offscreenApi = null;
async function offscreenEditor(page) {
  if (!offscreenApi) {
    const host = document.createElement("div");
    host.setAttribute("aria-hidden", "true");
    host.style.cssText = "position:fixed;left:-20000px;top:0;width:1200px;height:800px;visibility:hidden;pointer-events:none";
    document.body.append(host);
    offscreenApi = await new Promise((resolve) => createRoot(host).render(h(Excalidraw, { onInitialize: resolve, validateEmbeddable: false })));
  }
  const { scene } = await getJSON(`/api/pages/${encodeURIComponent(page)}?ifMissing=empty`);
  const files = Object.values(scene.files || {});
  if (files.length) offscreenApi.addFiles(files);
  offscreenApi.updateScene({ elements: scene.elements, captureUpdate: CaptureUpdateAction.NEVER });
  offscreenApi.history.clear();
  await nextFrame();
  return {
    offscreen: true,
    api: offscreenApi,
    known: new Map(offscreenApi.getSceneElementsIncludingDeleted().map((e) => [e.id, e.version])),
    async flushPending() {},
    setApplying() {},
    afterApply() {},
    afterAnswer() {},
  };
}

// One editor job at a time (sync.mjs): patches, live updates and page loads
// never overlap, and the invisible editor holds one page at a time.
export const queuePatch = (msg) => editorJob((hold) => handleAgentPatch(msg, hold));

// Fields a re-applied skeleton keeps from the element when it doesn't give them.
const KEPT_ON_RESKELETON = ["groupIds", "link", "customData", "locked", "angle", "backgroundColor", "strokeColor", "fillStyle", "strokeWidth", "strokeStyle", "roughness", "opacity", "roundness"];

async function handleAgentPatch({ reqId, page, elements = [], skeleton = [], delete: del = [], toBack = [], toFront = [], layout = [], files = {} }, hold) {
  let stacks = [];
  try {
    // The same id twice in `elements` is one edit (later fields win).
    // restoreElements would give the second a new id and leave a copy behind.
    elements = [...elements.reduce((m, p) => m.set(p?.id, { ...m.get(p?.id), ...p }), new Map()).values()];
    // Patches never move the person's view: the page on screen gets
    // it in front of the person; any other page is patched out of sight.
    const ed = page === S.currentPage ? visibleEditor(hold) : await offscreenEditor(page);
    await ed.flushPending();
    // Images: their files first, so the editor can draw them.
    if (Object.keys(files).length) ed.api.addFiles(Object.values(files));
    const scene = ed.api.getSceneElementsIncludingDeleted();
    const byId = new Map(scene.map((e) => [e.id, e]));
    const live = (id) => byId.get(id) && !byId.get(id).isDeleted;

    // Validate before touching the scene, so a bad patch changes nothing.
    const createdHere = new Set([...skeleton.map((s) => s?.id), ...elements.map((e) => e.id)]);
    const unknownOrder = [...toBack, ...toFront].filter((id) => !live(id) && !createdHere.has(id));
    if (unknownOrder.length) return fail(reqId, "unknown_element", `cannot reorder unknown element(s): ${unknownOrder.join(", ")}`);
    const missing = del.filter((id) => !live(id));
    if (missing.length) return fail(reqId, "unknown_element", `cannot delete unknown element(s): ${missing.join(", ")}`);
    const untyped = elements.filter((p) => !byId.has(p.id) && !p.type).map((p) => p.id);
    if (untyped.length) return fail(reqId, "invalid_patch", `new element(s) need a type: ${untyped.join(", ")}`);

    const out = new Map(scene.map((e) => [e.id, e]));
    const created = [];
    const nonce = () => (Math.random() * 2 ** 31) | 0;

    // Arrow bindings the converter can't make in this build: to sticky notes
    // (it throws) and to elements already on the page (it silently drops them).
    // Strip those ends here and bind them after conversion.
    let split;
    try {
      split = splitArrowBindings(skeleton, byId, { all: layout.length > 0 });
    } catch (err) {
      return fail(reqId, "invalid_patch", err.message);
    }
    const { deferred } = split;
    // Re-labelling an element that exists: the new label keeps the old one's
    // type size, font and colour unless given (before conversion, so it wraps right).
    const skel = split.skeleton.map((sk) => {
      // The converter throws on a frame without `children`: an empty frame is fine.
      if (sk?.type === "frame" && !Array.isArray(sk.children)) sk = { ...sk, children: [] };
      if (!sk?.label || !byId.has(sk.id)) return sk;
      const old = scene.find((e) => e.type === "text" && e.containerId === sk.id && !e.isDeleted);
      if (!old) return sk;
      const label = { ...sk.label };
      for (const k of ["fontSize", "fontFamily", "strokeColor", "textAlign", "verticalAlign"]) if (!(k in label) && old[k] !== undefined) label[k] = old[k];
      return { ...sk, label };
    });
    const known = (id) => skel.some((s) => s.id === id) || live(id);
    const dangling = deferred.flatMap((d) => [d.start, d.end]).filter((id) => id && !known(id));
    if (dangling.length) return fail(reqId, "unknown_element", `arrow ends refer to unknown element(s): ${[...new Set(dangling)].join(", ")}`);

    // 0. layout directives. Worked out on the scene as the patch
    // leaves it, with new elements at their real sizes (a trial conversion), then
    // applied as positions: skeletons are shifted before the real conversion, so
    // arrows bound to them still meet them; existing elements get x/y edits.
    if (layout.length) {
      let trial = [];
      if (skel.length) {
        try {
          trial = convertToExcalidrawElements(structuredClone(skel), { regenerateIds: false });
        } catch (err) {
          return fail(reqId, "invalid_patch", `skeleton: ${err?.message || err}`);
        }
      }
      const view = new Map(scene.filter((e) => !e.isDeleted).map((e) => [e.id, e]));
      for (const p of elements) view.set(p.id, { ...view.get(p.id), ...p });
      for (const e of trial) view.set(e.id, e);
      for (const id of del) for (const [k, e] of view) if (k === id || e.containerId === id) view.delete(k);
      let plan;
      try {
        plan = computeLayout(layout, [...view.values()]);
      } catch (err) {
        return fail(reqId, err.code || "invalid_patch", err.message);
      }
      const bySkel = new Map(skel.map((s) => [s.id, s]));
      const edit = (id) => {
        let p = elements.find((q) => q.id === id);
        if (!p) elements.push((p = { id }));
        return p;
      };
      for (const [id, { dx, dy }] of plan.moves) {
        const s = bySkel.get(id);
        if (s) {
          s.x = (s.x ?? 0) + dx;
          s.y = (s.y ?? 0) + dy;
          continue;
        }
        if (!view.has(id) || view.get(id).containerId) continue; // a converter-made label: follows its shape
        const base = view.get(id), p = edit(id);
        p.x = base.x + dx;
        p.y = base.y + dy;
      }
      for (const [id, f] of plan.frameOf) if (!bySkel.has(id)) edit(id).frameId = f;
      toFront = [...toFront, ...plan.front];
      stacks = plan.stacks;
    }

    // 1. skeletons: the high-level API (labels, sticky notes, frames, bound arrows)
    if (skel.length) {
      let converted;
      try {
        converted = convertToExcalidrawElements(skel, { regenerateIds: false });
      } catch (err) {
        return fail(reqId, "invalid_patch", `skeleton: ${err?.message || err}`);
      }
      // Re-applying a skeleton to an element that exists (the way to reword a
      // label) builds it afresh: what the skeleton leaves out keeps its current
      // value instead of a default, so the element stays in its frame, group and
      // style, with its link and data. A frame in this patch listing it as a
      // child still moves it.
      const skelOf = new Map(skel.map((s) => [s.id, s]));
      const claimed = new Set(skel.filter((s) => s.type === "frame").flatMap((s) => s.children ?? []));
      const frameAlive = (id) => id && (out.get(id) ?? byId.get(id))?.type === "frame" && !(out.get(id) ?? byId.get(id)).isDeleted;
      for (let el of converted) {
        const cur = byId.get(el.id), given = skelOf.get(el.id);
        if (!cur) created.push(el.id);
        else if (given && !cur.isDeleted) {
          const kept = {};
          for (const k of KEPT_ON_RESKELETON) if (!(k in given) && k in cur) kept[k] = cur[k];
          if (!("frameId" in given) && !claimed.has(el.id) && frameAlive(cur.frameId)) kept.frameId = cur.frameId;
          el = { ...el, ...kept };
        }
        out.set(el.id, { ...el, version: (cur?.version ?? 0) + el.version });
      }
      // A new label belongs to its container's frame.
      for (const el of converted) {
        const box = el.type === "text" && el.containerId && out.get(el.containerId);
        if (box && el.frameId !== (box.frameId ?? null)) out.set(el.id, { ...out.get(el.id), frameId: box.frameId ?? null });
      }
      // Re-applying a skeleton to an existing labelled shape makes a new label
      // (with a new generated id): delete the old one, or it lingers as an
      // orphan under the new label.
      const newIds = new Set(converted.map((e) => e.id));
      const replaced = new Set(converted.filter((e) => byId.has(e.id)).map((e) => e.id));
      for (const e of scene) {
        if (e.type === "text" && e.containerId && replaced.has(e.containerId) && !newIds.has(e.id) && !e.isDeleted) {
          out.set(e.id, { ...e, isDeleted: true, version: e.version + 1, versionNonce: nonce() });
        }
      }
      if (!layout.length) for (const d of deferred) bindArrow(out, d, nonce);
    }
    // 2. raw partial elements: merge onto the existing element, or restore defaults for new ones
    const raw = elements.map((p) => {
      const cur = byId.get(p.id);
      if (!cur) created.push(p.id);
      return cur ? { ...cur, ...p, version: cur.version + 1, versionNonce: nonce() } : p;
    });
    if (raw.length) {
      // restoreElements drops a frameId whose frame isn't in `raw` itself; put
      // back what the patch asked for when that frame is on the page.
      const wantFrame = new Map(raw.filter((p) => "frameId" in p).map((p) => [p.id, p.frameId]));
      const isFrame = (id) => id && out.get(id)?.type === "frame" && !out.get(id).isDeleted;
      // restoreElements' repairBindings only sees the elements in this patch, so
      // an edited shape loses its boundElements (its label, bound arrows). Keep
      // the ones that still exist unless the patch sets boundElements itself.
      const setsBound = new Set(elements.filter((p) => "boundElements" in p).map((p) => p.id));
      // repairBindings is off: it only sees this patch's elements, so it would
      // detach labels from shapes (and shapes from labels) that aren't in it.
      for (let el of restoreElements(raw, scene, { refreshDimensions: true, repairBindings: false })) {
        const f = wantFrame.get(el.id);
        if (f !== undefined && el.frameId !== f && (f === null || isFrame(f))) el = { ...el, frameId: f };
        const cur = byId.get(el.id);
        if (cur?.boundElements?.length && !setsBound.has(el.id)) {
          const have = new Set((el.boundElements ?? []).map((b) => b.id));
          const keep = cur.boundElements.filter((b) => !have.has(b.id) && out.get(b.id) && !out.get(b.id).isDeleted);
          if (keep.length) el = { ...el, boundElements: [...(el.boundElements ?? []), ...keep] };
        }
        out.set(el.id, el);
      }
      // Moving or resizing a labelled shape with an edit doesn't move its label
      // in this build: keep the label where it was relative to the shape's centre.
      for (const p of elements) {
        const before = byId.get(p.id), after = out.get(p.id);
        if (!before || !after || !["x", "y", "width", "height"].some((k) => k in p)) continue;
        const dx = after.x + after.width / 2 - (before.x + before.width / 2);
        const dy = after.y + after.height / 2 - (before.y + before.height / 2);
        if (!dx && !dy) continue;
        for (const t of out.values()) {
          if (t.type === "text" && t.containerId === p.id && !t.isDeleted && !elements.some((q) => q.id === t.id)) {
            out.set(t.id, { ...t, x: t.x + dx, y: t.y + dy, version: t.version + 1, versionNonce: nonce() });
          }
        }
      }
    }
    // With layout, bind after the edits: they may have moved an arrow's targets.
    if (layout.length) for (const d of deferred) bindArrow(out, d, nonce);
    // 3. deletes (and their bound text)
    for (const id of del) {
      for (const e of out.values()) {
        if (e.id === id || e.containerId === id) out.set(e.id, { ...e, isDeleted: true, version: e.version + 1, versionNonce: nonce() });
      }
    }

    // Frames by position, as when the person drops something: a new element
    // (or one an edit moved) that lies wholly inside a frame joins it, and a
    // moved one that ends up wholly outside its frame leaves it. A patch that
    // says where (frameId, or a frame's children) is left alone.
    const said = new Set([
      ...skel.filter((s) => s && "frameId" in s).map((s) => s.id),
      ...skel.filter((s) => s?.type === "frame").flatMap((s) => s.children ?? []),
      ...elements.filter((p) => "frameId" in p).map((p) => p.id),
    ]);
    const movedByEdit = elements.filter((p) => byId.has(p.id) && ["x", "y", "width", "height"].some((k) => k in p)).map((p) => p.id);
    const frames = [...out.values()].filter((e) => e.type === "frame" && !e.isDeleted);
    if (frames.length) {
      for (const id of new Set([...created, ...movedByEdit])) {
        const el = out.get(id);
        if (!el || el.isDeleted || el.type === "frame" || el.containerId || said.has(id)) continue;
        const at = frameAt(el, frames);
        const cur = el.frameId ? frames.find((f) => f.id === el.frameId) : null;
        let next = el.frameId ?? null;
        if (at && at !== next) next = at;
        else if (!at && cur && byId.has(id) && outsideOf(el, cur)) next = null;
        if (next === (el.frameId ?? null)) continue;
        out.set(id, { ...el, frameId: next });
        for (const t of out.values()) if (t.containerId === id && !t.isDeleted) out.set(t.id, { ...t, frameId: next });
      }
    }

    ed.setApplying(true);
    // Stacking order: toBack ids go behind everything, toFront above everything
    // (with their bound labels). New elements otherwise land on top, and a
    // re-created id keeps its old place.
    let ordered = [...out.values()];
    if (toBack.length || toFront.length) {
      const pick = (ids) => {
        const set = new Set(ids);
        return ordered.filter((e) => set.has(e.id) || set.has(e.containerId));
      };
      const back = pick(toBack), front = pick(toFront);
      const moved = new Set([...back, ...front].map((e) => e.id));
      ordered = [...back, ...ordered.filter((e) => !moved.has(e.id)), ...front].map((e) =>
        moved.has(e.id) ? { ...e, index: null, version: e.version + 1, versionNonce: nonce() } : e);
      for (const e of ordered) if (moved.has(e.id)) out.set(e.id, e); // part of this patch, not the person's edit
    }
    // Layout `stack`: just above or below a reference element (and its label).
    for (const st of stacks) {
      const set = new Set(st.ids);
      const moving = ordered.filter((e) => set.has(e.id) || set.has(e.containerId));
      const rest = ordered.filter((e) => !moving.includes(e));
      let at = rest.findIndex((e) => e.id === st.ref);
      if (st.where === "above") {
        while (at + 1 < rest.length && rest[at + 1].containerId === st.ref) at++;
        at++;
      }
      const bumped = moving.map((e) => ({ ...e, index: null, version: e.version + 1, versionNonce: nonce() }));
      ordered = [...rest.slice(0, at), ...bumped, ...rest.slice(at)];
      for (const e of bumped) out.set(e.id, e);
    }
    ed.api.updateScene({ elements: ordered, captureUpdate: CaptureUpdateAction.IMMEDIATELY });
    await nextFrame();
    ed.afterApply();
    // Report only what the patch touched, plus layout the editor did because of
    // it (bound text, sticky sizing, re-routed arrows). Anything else that
    // changed meanwhile is the person's and is synced as theirs.
    const touched = new Set([...out.values()].filter((e) => e !== byId.get(e.id)).map((e) => e.id));
    const changed = changedSince(ed).filter(relatedTo(touched));
    S.patchesApplied++;
    for (const e of changed) ed.known.set(e.id, e.version);
    ed.setApplying(false);
    await answer(reqId, { elements: changed, created, offscreen: ed.offscreen });
    ed.afterAnswer(touched);
    if (changed.length && !ed.offscreen) toast(`Your agent changed ${changed.length} element${changed.length === 1 ? "" : "s"} on ${page}`, { duration: 2500 });
  } catch (err) {
    hold.leave();
    fail(reqId, "canvas_error", String(err?.stack || err));
  }
}
