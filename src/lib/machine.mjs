// A tiny state machine: states and transitions as plain data, so each state
// and its exits are written down and testable in Node. Pure: also served to
// the canvas page from /lib/.
//
//   const m = createMachine({ initial: "idle", states: { idle: { on: { GO: "busy" } }, busy: { on: { DONE: "idle" } } } });
//   m.send("GO"); m.state === "busy"
//
// Sending an event the current state doesn't list throws (code
// "bad_transition"): an unlisted transition is a bug, not something to ignore.
// Listeners run after every transition, self-transitions included.

export class TransitionError extends Error {
  constructor(name, state, event) {
    super(`${name}: no transition for ${event} in ${state}`);
    this.code = "bad_transition";
  }
}

/**
 * @param {{name?: string, initial: string, states: Record<string, {on?: Record<string, string>}>}} table
 */
export function createMachine(table) {
  const { name = "machine", initial, states } = table;
  if (!states[initial]) throw new Error(`${name}: unknown initial state ${initial}`);
  for (const [s, def] of Object.entries(states)) {
    for (const [ev, to] of Object.entries(def.on ?? {})) {
      if (!states[to]) throw new Error(`${name}: ${s} --${ev}--> unknown state ${to}`);
    }
  }
  let state = initial;
  const listeners = new Set();
  return {
    get state() { return state; },
    /** Whether `event` is listed for the current state. */
    can: (event) => Boolean(states[state].on?.[event]),
    /** Take the transition for `event`; returns the new state. */
    send(event) {
      const to = states[state].on?.[event];
      if (!to) throw new TransitionError(name, state, event);
      const from = state;
      state = to;
      for (const fn of [...listeners]) fn(to, from, event);
      return to;
    },
    /** Called as fn(state, from, event) after each transition; returns an unsubscribe. */
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    /** Resolves the next time the machine is in a state `test` accepts (now if it already is). */
    when(test) {
      if (test(state)) return Promise.resolve(state);
      return new Promise((resolve) => {
        const off = this.subscribe((s) => test(s) && (off(), resolve(s)));
      });
    },
  };
}
