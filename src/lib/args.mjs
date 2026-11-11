// Argument parsing for the CLI. Pure: takes argv and env, returns a plan or
// throws a UsageError with a machine-readable code.

import path from "node:path";
import { parseArgs } from "node:util";
import { normalizePageName, validPageName } from "./names.mjs";
// Short form of the page-name rule for error messages.
export const NAME_HINT = "parts joined by /; no \\ : * ? \" < > |, no part starting with .";
import { COMMANDS, GLOBAL_FLAGS, OPTION_TYPES, DEFAULT_DIR, DEFAULT_PORT, DEFAULT_IDLE_MINUTES } from "./commands.mjs";

export class UsageError extends Error {
  /** @param {"unknown_command"|"unknown_option"|"missing_argument"|"invalid_argument"} code */
  constructor(code, message, command) {
    super(message);
    this.code = code;
    this.command = command;
  }
}


/**
 * @param {string[]} argv  arguments after the script name
 * @param {Record<string,string|undefined>} env
 * @param {string} cwd
 */
export function parseCli(argv, env = {}, cwd = process.cwd()) {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: OPTION_TYPES, allowPositionals: true, strict: true });
  } catch (err) {
    const m = /'(-{1,2}[^']+)'/.exec(err.message);
    if (err.code === "ERR_PARSE_ARGS_UNKNOWN_OPTION") throw new UsageError("unknown_option", `unknown option ${m?.[1] ?? ""}`.trim());
    // e.g. a string option given without a value
    const first = err.message.split("\n")[0];
    if (/ambiguous/.test(first) && m) throw new UsageError("invalid_argument", `${first.replace(/\.$/, "")}; for a negative number write ${m[1]}=-<n>`);
    throw new UsageError("invalid_argument", first);
  }
  const flags = parsed.values;
  const [command, ...rest] = parsed.positionals;

  const portRaw = flags.port ?? env.OBEYA_PORT ?? String(DEFAULT_PORT);
  const port = Number(portRaw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new UsageError("invalid_argument", `--port must be an integer from 1 to 65535, got "${portRaw}"`, command);

  const idleRaw = flags["idle-timeout"] ?? env.OBEYA_IDLE_TIMEOUT ?? String(DEFAULT_IDLE_MINUTES);
  const idleTimeout = Number(idleRaw);
  if (!/^\d+(\.\d+)?$/.test(idleRaw) || !Number.isFinite(idleTimeout)) {
    throw new UsageError("invalid_argument", `--idle-timeout must be a number of minutes (0 = never), got "${idleRaw}"`, command);
  }

  const plan = {
    command: command ?? null,
    positionals: rest,
    page: null,
    flags,
    dir: path.resolve(cwd, flags.dir ?? env.OBEYA_DIR ?? DEFAULT_DIR),
    port,
    // Without --port / OBEYA_PORT the CLI picks the folder's own port (cli/ports.mjs).
    portExplicit: flags.port !== undefined || env.OBEYA_PORT !== undefined,
    idleTimeout,
    noOpen: Boolean(flags["no-open"]),
    help: Boolean(flags.help),
    skill: Boolean(flags.skill),
    version: Boolean(flags.version),
  };
  if (plan.skill) {
    // `--skill [topic]`: the guide's core, or one topic of it.
    if (rest.length) throw new UsageError("invalid_argument", "--skill takes one topic: obeya --skill [<topic>|all]");
    plan.topic = command ?? null;
    return plan;
  }
  if (plan.version || !command) return plan;

  let name = command;
  let spec = COMMANDS[command];
  if (!spec) throw new UsageError("unknown_command", `unknown command "${command}"`);
  if (spec.subcommands) {
    // A group run without a subcommand prints the group's help.
    const sub = rest.shift();
    if (!sub) {
      plan.groupHelp = true;
      return plan;
    }
    if (!spec.subcommands[sub]) throw new UsageError("unknown_command", `unknown ${command} subcommand "${sub}"`, command);
    name = `${command} ${sub}`;
    spec = spec.subcommands[sub];
  }
  plan.name = name;
  if (plan.help) return plan;

  const allowed = new Set([...GLOBAL_FLAGS, ...(spec.flags ?? [])]);
  for (const flag of Object.keys(flags)) {
    if (!allowed.has(flag)) throw new UsageError("unknown_option", `${name} does not take --${flag}`, name);
  }

  const argNames = spec.args ?? [];
  if (spec.words) {
    if (!rest.length) throw new UsageError("missing_argument", `${name} needs search words`, name);
    plan.words = rest;
  }
  if (spec.pages) {
    if (!rest.length) throw new UsageError("missing_argument", `${name} needs at least one <page>`, name);
    const pages = rest.map(normalizePageName);
    const badName = pages.find((p) => !validPageName(p));
    if (badName) throw new UsageError("invalid_argument", `bad page name "${badName}" (${NAME_HINT})`, name);
    plan.pages = pages;
    plan.page = rest[0];
  }
  const maxPos = spec.pages || spec.words ? Infinity : spec.page ? 1 + argNames.length : spec.maxPositionals ?? argNames.length;
  if (rest.length > maxPos) throw new UsageError("invalid_argument", `unexpected argument "${rest[maxPos]}"`, name);
  // Positions: the page comes first, unless `argsFirst` (e.g. `library insert <item> <page>`).
  const pageAt = spec.argsFirst ? argNames.length : 0;
  const argAt = (i) => (spec.argsFirst || !spec.page ? i : 1 + i);
  if (!spec.pages && !spec.words && (spec.page || (maxPos && !argNames.length))) {
    plan.page = normalizePageName(rest[pageAt] ?? null);
    if (spec.argsFirst && rest.length < argNames.length) throw new UsageError("missing_argument", `${name} needs a <${argNames[rest.length]}>`, name);
    if (spec.page && !plan.page) throw new UsageError("missing_argument", `${name} needs a <page>`, name);
    if (plan.page && !validPageName(plan.page)) throw new UsageError("invalid_argument", `bad page name "${plan.page}" (${NAME_HINT})`, name);
  }
  plan.args = {};
  argNames.forEach((arg, i) => {
    const v = rest[argAt(i)];
    if (v === undefined) throw new UsageError("missing_argument", `${name} needs a <${arg}>`, name);
    plan.args[arg] = v;
  });
  for (const flag of spec.required ?? []) {
    if (flags[flag] === undefined) throw new UsageError("missing_argument", `${name} needs --${flag}`, name);
  }
  if (spec.validate) spec.validate(plan, (msg) => new UsageError("invalid_argument", msg, name));
  if (flags.since !== undefined && flags.since !== "last" && !/^\d+$/.test(flags.since)) {
    throw new UsageError("invalid_argument", `--since must be a revision number or "last"`, name);
  }
  if (flags.source !== undefined && !["user", "agent", "all"].includes(flags.source)) {
    throw new UsageError("invalid_argument", `--source must be "user", "agent" or "all"`, name);
  }
  if (flags.scale !== undefined && !(Number(flags.scale) > 0 && Number(flags.scale) <= 8)) {
    throw new UsageError("invalid_argument", `--scale must be a number in (0, 8]`, name);
  }
  plan.consumer = flags.consumer ?? env.OBEYA_CONSUMER ?? "default";
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(plan.consumer)) {
    throw new UsageError("invalid_argument", `--consumer must be 1-64 letters, digits, . _ -`, name);
  }
  return plan;
}
