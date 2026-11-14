// The state machine helper (src/lib/machine.mjs) and the canvas page's machines
// as data (src/lib/page-machines.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createMachine } from "../src/lib/machine.mjs";
import { CONNECTION, DIALOGS, EDITOR, PRESENT, SAVING } from "../src/lib/page-machines.mjs";

const LIGHT = { name: "light", initial: "off", states: { off: { on: { FLIP: "on" } }, on: { on: { FLIP: "off", BUMP: "on" } } } };

test("createMachine: listed transitions move, listeners see each one, self-transitions included", () => {
  const m = createMachine(LIGHT);
  const seen = [];
  const off = m.subscribe((to, from, ev) => seen.push([from, ev, to]));
  assert.equal(m.state, "off");
  assert.equal(m.send("FLIP"), "on");
  m.send("BUMP");
  off();
  m.send("FLIP");
  assert.deepEqual(seen, [["off", "FLIP", "on"], ["on", "BUMP", "on"]]);
  assert.equal(m.state, "off");
});

test("createMachine: an unlisted transition throws bad_transition and changes nothing", () => {
  const m = createMachine(LIGHT);
  assert.equal(m.can("BUMP"), false);
  assert.throws(() => m.send("BUMP"), (err) => err.code === "bad_transition" && /light: no transition for BUMP in off/.test(err.message));
  assert.equal(m.state, "off");
});

test("createMachine: a table naming an unknown state is refused up front", () => {
  assert.throws(() => createMachine({ initial: "nope", states: { a: {} } }), /unknown initial state/);
  assert.throws(() => createMachine({ initial: "a", states: { a: { on: { GO: "b" } } } }), /a --GO--> unknown state b/);
});

test("createMachine: when() resolves now, or at the next matching state", async () => {
  const m = createMachine(LIGHT);
  assert.equal(await m.when((s) => s === "off"), "off");
  const later = m.when((s) => s === "on");
  m.send("FLIP");
  assert.equal(await later, "on");
});

// Every transition in a table, as [from, event, to].
const edges = (t) => Object.entries(t.states).flatMap(([s, d]) => Object.entries(d.on ?? {}).map(([e, to]) => [s, e, to]));

test("editor (2a): the person hands the editor to one job at a time, and gets it back", () => {
  assert.deepEqual(edges(EDITOR), [
    ["person", "PATCH", "patch"], ["person", "REMOTE", "remote"], ["person", "OPEN", "opening"],
    ["patch", "DONE", "person"], ["remote", "DONE", "person"], ["opening", "DONE", "person"],
  ]);
  const m = createMachine(EDITOR);
  m.send("PATCH");
  for (const ev of ["PATCH", "REMOTE", "OPEN"]) assert.throws(() => m.send(ev), { code: "bad_transition" }, `no ${ev} while a patch holds it`);
  m.send("DONE");
  assert.throws(() => m.send("DONE"), { code: "bad_transition" }, "the person never hands back what they hold");
});

test("saving (2b): edit, wait, save; edits during a save wait for the next; offline keeps them", () => {
  const m = createMachine(SAVING);
  const run = (...evs) => evs.map((e) => m.send(e));
  assert.deepEqual(run("EDIT", "EDIT", "QUIET", "SAVED"), ["waiting", "waiting", "saving", "idle"]);
  assert.deepEqual(run("EDIT", "QUIET", "EDIT", "SAVED", "FLUSH", "SAVED"), ["waiting", "saving", "dirty", "waiting", "saving", "idle"]);
  assert.deepEqual(run("FLUSH", "FAILED"), ["saving", "idle"], "a failed save leaves the edits pending, back to idle");
  assert.deepEqual(run("EDIT", "QUIET", "OFFLINE", "EDIT", "BACK"), ["waiting", "saving", "offline", "offline", "idle"]);
  assert.throws(() => run("SAVED"), { code: "bad_transition" }, "nothing to have saved");
  // Every state but offline can go offline; only offline comes back.
  for (const [s, d] of Object.entries(SAVING.states)) assert.equal(Boolean(d.on.OFFLINE), s !== "offline", s);
  assert.deepEqual(edges(SAVING).filter(([, e]) => e === "BACK"), [["offline", "BACK", "idle"]]);
});

test("connection (1): away and back through catching up; two dead ends", () => {
  const m = createMachine(CONNECTION);
  const run = (...evs) => evs.map((e) => m.send(e));
  assert.deepEqual(run("HELLO", "AWAY", "AWAY", "HELLO", "AWAY", "HELLO", "CAUGHT_UP"), ["connected", "away", "away", "catching", "away", "catching", "connected"]);
  assert.throws(() => m.send("CAUGHT_UP"), { code: "bad_transition" });
  assert.throws(() => m.send("OTHER_FOLDER"), { code: "bad_transition" }, "only a stream that came back can find another folder");
  run("AWAY", "OTHER_FOLDER");
  for (const ev of ["HELLO", "AWAY", "LOST"]) assert.equal(m.can(ev), false, `wrong-folder is final (${ev})`);
  assert.deepEqual(Object.keys(CONNECTION.states.lost.on ?? {}), [], "lost is final");
  // A first connection that fails before hello catches up when it comes back.
  const f = createMachine(CONNECTION);
  assert.deepEqual(["AWAY", "HELLO"].map((e) => f.send(e)), ["away", "catching"]);
});

test("connection (1): parked (too many tabs) waits offline and catches up when it connects again", () => {
  const m = createMachine(CONNECTION);
  const run = (...evs) => evs.map((e) => m.send(e));
  assert.deepEqual(run("HELLO", "PARK", "HELLO", "CAUGHT_UP"), ["connected", "parked", "catching", "connected"]);
  assert.deepEqual(run("PARK", "AWAY", "HELLO", "PARK"), ["parked", "away", "catching", "parked"]);
  assert.throws(() => m.send("PARK"), { code: "bad_transition" }, "a parked tab has no stream to be parked on");
  assert.equal(m.can("CAUGHT_UP"), false);
});

test("present (3): on and off; paused is data (the last frame per page), not a state", () => {
  assert.deepEqual(edges(PRESENT), [["off", "START", "presenting"], ["presenting", "STOP", "off"]]);
  const m = createMachine(PRESENT);
  assert.throws(() => m.send("STOP"), { code: "bad_transition" });
  m.send("START");
  assert.throws(() => m.send("START"), { code: "bad_transition" }, "already presenting");
});

test("dialogs (4): one at a time, each closes back to the canvas", () => {
  const m = createMachine(DIALOGS);
  const all = ["PICKER", "NEW", "RENAME", "EXPORT", "ABOUT"];
  for (const [open, state] of [["PICKER", "picker"], ["NEW", "new"], ["RENAME", "rename"], ["EXPORT", "export"], ["ABOUT", "about"]]) {
    assert.equal(m.send(open), state);
    for (const other of all) {
      const handOver = state === "picker" && other === "NEW";
      assert.equal(m.can(other), handOver, `${other} over ${state}`);
    }
    assert.equal(m.send("CLOSE"), "canvas");
  }
  assert.equal(m.can("CLOSE"), false);
  // The picker's + New replaces the picker with the New page dialog.
  assert.deepEqual(["PICKER", "NEW", "CLOSE"].map((e) => m.send(e)), ["picker", "new", "canvas"]);
});
