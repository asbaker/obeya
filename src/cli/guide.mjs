import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const GUIDE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "guide");
const read = (name) => fs.readFileSync(path.join(GUIDE_DIR, `${name}.md`), "utf8").trimEnd();

/** Topic names, in the order the core's index lists them (lines "- `name`: …" or "- `a`, `b`: …" under "## Topics"). */
export function topics() {
  const index = read("core").split(/^## Topics.*$/m)[1] ?? "";
  // A line may name several: "- `sketch`, `clean`, `hifi`: …".
  return [...index.matchAll(/^- ((?:`[a-z-]+`(?:, )?)+):/gm)].flatMap((m) => [...m[1].matchAll(/`([a-z-]+)`/g)].map((n) => n[1]));
}

/** The core, one topic, or all of it; null for an unknown topic. */
export function guide(topic = null) {
  if (!topic) return read("core");
  const names = topics();
  if (topic === "all") return [read("core"), ...names.map(read)].join("\n\n");
  return names.includes(topic) ? read(topic) : null;
}
guide.topics = topics;
