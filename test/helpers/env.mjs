// Test helpers: temp dirs and free ports (never 4747, which a developer's own canvas may use).
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

export const tmpDir = (prefix = "xl-test-") => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));

const taken = new Set();
/**
 * A free port chosen by the OS (port 0). Test files run in parallel processes;
 * picking from a fixed range let two of them race for the same port. OS-chosen
 * ports come from the ephemeral range, far from 4747. `start` (optional) asks
 * for the first free port at or above it instead.
 */
export async function freePort(start) {
  if (start === undefined) {
    for (let i = 0; i < 20; i++) {
      const port = await new Promise((resolve, reject) => {
        const s = net.createServer();
        s.once("error", reject);
        s.listen(0, "127.0.0.1", () => {
          const { port } = s.address();
          s.close(() => resolve(port));
        });
      });
      if (!taken.has(port)) {
        taken.add(port);
        return port;
      }
    }
    throw new Error("no free port");
  }
  for (let p = start; p < 65000; p++) {
    if (taken.has(p)) continue;
    const ok = await new Promise((resolve) => {
      const s = net.createServer();
      s.once("error", () => resolve(false));
      s.listen(p, "127.0.0.1", () => s.close(() => resolve(true)));
    });
    if (ok) {
      taken.add(p);
      return p;
    }
  }
  throw new Error("no free port");
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
