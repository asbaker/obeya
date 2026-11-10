// Which port a pages folder's server uses: --port / OBEYA_PORT if
// given; else the port this folder had before; else the first free one from
// 4747 that no other folder has. Remembered per folder in the per-user cache
// (ports.json), never in the project, so links and open tabs keep working.
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { cacheDir } from "../lib/libcache.mjs";
import { DEFAULT_PORT } from "../lib/commands.mjs";
import { canonicalDir, sameDir } from "../lib/paths.mjs";

const SPAN = 200; // ports tried from the base

export const portsFile = (env) => path.join(cacheDir(env), "ports.json");

function readPorts(env) {
  try {
    const all = JSON.parse(fs.readFileSync(portsFile(env), "utf8"));
    return all && typeof all === "object" ? all : {};
  } catch {
    return {};
  }
}

function writePorts(env, ports) {
  const file = portsFile(env);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(ports, null, 2) + "\n");
  fs.renameSync(tmp, file);
}

/** Can a server listen on 127.0.0.1:port right now? */
function canListen(port) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once("error", () => resolve(false));
    s.listen(port, "127.0.0.1", () => s.close(() => resolve(true)));
  });
}

/** What answers on the port: an obeya server's info, {foreign: true}, or null (nothing). */
async function whoIs(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/info`, { signal: AbortSignal.timeout(1000) });
    const body = await res.json().catch(() => null);
    return res.ok && body?.app === "obeya" ? body : { foreign: true };
  } catch {
    return (await canListen(port)) ? null : { foreign: true }; // something that isn't HTTP
  }
}

/**
 * The port for plan.dir. `remember`: write the choice down (commands that
 * start a server); status and stop only look. Throws {code: "no_free_port"}.
 * @returns {Promise<number>}
 */
export async function resolvePort(plan, env, { remember = true, base = DEFAULT_PORT } = {}) {
  if (plan.portExplicit) return plan.port;
  const dir = canonicalDir(plan.dir);
  const ports = readPorts(env);
  // Forget folders that are gone.
  let pruned = false;
  for (const d of Object.keys(ports)) if (d !== dir && !fs.existsSync(d)) (delete ports[d], (pruned = true));
  const usable = async (port) => {
    const who = await whoIs(port);
    return who === null || (!who.foreign && sameDir(who.dir, dir));
  };
  let port = ports[dir];
  if (!(Number.isInteger(port) && (await usable(port)))) {
    port = null;
    const taken = new Set(Object.entries(ports).filter(([d]) => d !== dir).map(([, p]) => p));
    for (let p = base; p < base + SPAN && p <= 65535; p++) {
      if (!taken.has(p) && (await usable(p))) {
        port = p;
        break;
      }
    }
    if (port === null) throw Object.assign(new Error(`no free port from ${base} to ${base + SPAN - 1}; pass --port`), { code: "no_free_port" });
  }
  if (remember && (ports[dir] !== port || pruned)) {
    ports[dir] = port;
    writePorts(env, ports);
  }
  return port;
}
