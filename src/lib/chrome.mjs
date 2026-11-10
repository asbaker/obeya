// Finding an installed Chrome or Chromium (no npm dependency).

import fs from "node:fs";
import path from "node:path";

const CANDIDATES = {
  darwin: [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  ],
  linux: ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge"],
  win32: [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  ],
};

function onPath(name, env) {
  for (const dir of (env.PATH ?? "").split(path.delimiter)) {
    const p = path.join(dir, name);
    try {
      fs.accessSync(p, fs.constants.X_OK);
      return p;
    } catch {}
  }
  return null;
}

/** Path to a Chrome-family browser, or null. CHROME_PATH wins. */
export function findChrome(env = process.env, platform = process.platform) {
  if (env.CHROME_PATH) return fs.existsSync(env.CHROME_PATH) ? env.CHROME_PATH : null;
  for (const c of CANDIDATES[platform] ?? []) {
    const p = path.isAbsolute(c) ? (fs.existsSync(c) ? c : null) : onPath(c, env);
    if (p) return p;
  }
  return null;
}
