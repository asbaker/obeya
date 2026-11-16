// Update notices: is a newer obeya out? The server asks the npm registry once a
// day and keeps the answer in the per-user cache (update.json); the guide,
// `obeya status` and the canvas tab read that file. The registry request sends
// nothing about the person. OBEYA_NO_UPDATE_CHECK=1 turns the check off;
// OBEYA_REGISTRY_URL points it elsewhere (tests use a local stand-in).
import fs from "node:fs";
import path from "node:path";
import { cacheDir } from "./libcache.mjs";

export const UPDATE_TTL_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_REGISTRY = "https://registry.npmjs.org";
const TIMEOUT_MS = 5000;
const NEWS_MAX = 120;
/** How to update both halves: the CLI and the skill. */
export const UPDATE_COMMAND = "npm update -g obeya && npx skills update obeya";

export const updateFile = (env = process.env) => path.join(cacheDir(env), "update.json");
const checkOff = (env) => Boolean(env.OBEYA_NO_UPDATE_CHECK && env.OBEYA_NO_UPDATE_CHECK !== "0");

/** A release version (1.2.3) as numbers; null for anything else, prereleases included. */
function release(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(v ?? ""));
  return m ? m.slice(1).map(Number) : null;
}

/** Is `a` a newer release than `b`? Prereleases never count as news. */
export function isNewer(a, b) {
  const x = release(a), y = release(b);
  if (!x || !y) return false;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}

/** The cached answer: {checked, latest, headline}, or null. */
export function readUpdate(env = process.env) {
  try {
    const u = JSON.parse(fs.readFileSync(updateFile(env), "utf8"));
    return u && typeof u === "object" ? u : null;
  } catch {
    return null;
  }
}

function writeUpdate(env, u) {
  const file = updateFile(env);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(u) + "\n");
  fs.renameSync(tmp, file);
}

/** The news for a person running `current`: {to, headline?}, or null when there's none (or the check is off). */
export function pendingUpdate(current, env = process.env) {
  if (checkOff(env)) return null;
  const u = readUpdate(env);
  if (!u || !isNewer(u.latest, current)) return null;
  return { to: u.latest, ...(u.headline ? { headline: u.headline } : {}) };
}

/** The release's headline: package.json's "obeya": {"headline": "…"}, one short line of plain text. */
function headlineOf(manifest) {
  const n = manifest?.obeya?.headline;
  if (typeof n !== "string") return undefined;
  const line = n.replace(/\s+/g, " ").trim();
  return line ? line.slice(0, NEWS_MAX) : undefined;
}

/**
 * Ask the registry for the latest release, at most once a day. Never throws:
 * offline, blocked or a bad answer just waits for tomorrow. Returns the
 * cached answer after the check.
 */
export async function checkForUpdate(env = process.env, { now = Date.now(), fetchFn = fetch } = {}) {
  if (checkOff(env)) return null;
  const prev = readUpdate(env);
  if (prev && now - (prev.checked ?? 0) < UPDATE_TTL_MS) return prev;
  const base = (env.OBEYA_REGISTRY_URL || DEFAULT_REGISTRY).replace(/\/+$/, "");
  let next = { ...(prev ?? {}), checked: now };
  try {
    const res = await fetchFn(`${base}/obeya/latest`, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { accept: "application/json" } });
    if (res.ok) {
      const m = await res.json();
      if (release(m?.version)) next = { checked: now, latest: m.version, ...(headlineOf(m) ? { headline: headlineOf(m) } : {}) };
    }
  } catch {}
  try {
    writeUpdate(env, next);
  } catch {}
  return next;
}

/** The two lines the guide starts with when there's news (markdown quote). */
export function guideNotice(current, u) {
  return `> obeya ${u.to} is out (you have ${current})${u.headline ? `: ${u.headline.replace(/[.!]+$/, "")}` : ""}.\n> Tell the person; to update: ${UPDATE_COMMAND}`;
}
