// The page list for the page picker, and watching the folder for pages added,
// removed or renamed outside the server (git pull, another program).
import fs from "node:fs";

/**
 * @param {object} o
 * @param {string} o.dir
 * @param {import("../lib/store.mjs").PageStore} o.store
 * @param {(event: string, data: any) => void} o.broadcast
 */
export function watchPages({ dir, store, broadcast }) {
  // Pages with their frame counts and file times, and files that can't be
  // opened because of their names.
  const info = () => ({ pages: store.list().map((name) => store.summary(name)), skipped: store.skipped() });
  const key = () => JSON.stringify([store.list(), store.skipped().map((s) => s.file)]);
  let last = key();
  function announce() {
    last = key();
    broadcast("pages", info());
  }
  // Only a change to the list is announced; the picker fetches details when it
  // opens. Some file systems can't be watched: then the list updates on reload.
  let timer = null;
  // Folders too (recursive: native on macOS and Windows, Node 20+ on Linux).
  // Edits append to change logs in .obeya/ all the time; those never change the list.
  try {
    fs.watch(dir, { recursive: true }, (_event, file) => {
      if (file && String(file).split(/[\\/]/).some((p) => p.startsWith(".") || p === "node_modules")) return;
      clearTimeout(timer);
      timer = setTimeout(() => key() !== last && announce(), 250);
    }).on("error", () => {});
  } catch {}
  return { info, announce };
}
