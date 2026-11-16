// Update notices: the daily registry check, its cache, what the guide and
// `obeya status` say, the server's check at start, and an older server being
// replaced by a newer CLI. A local stand-in plays the npm registry.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { run } from "../src/cli/main.mjs";
import { checkForUpdate, guideNotice, isNewer, pendingUpdate, updateFile, UPDATE_TTL_MS } from "../src/lib/update.mjs";
import { freePort, sleep, tmpDir } from "./helpers/env.mjs";

const VERSION = JSON.parse(fs.readFileSync("package.json", "utf8")).version;
const cleanup = [];
after(async () => {
  for (const f of cleanup.reverse()) await f();
});

// The check is on in this file (the helper turns it off for every other test).
const envOn = (extra = {}) => ({ ...process.env, OBEYA_NO_UPDATE_CHECK: "", OBEYA_CACHE: tmpDir("xl-cache-"), ...extra });
const seed = (env, u) => {
  fs.mkdirSync(path.dirname(updateFile(env)), { recursive: true });
  fs.writeFileSync(updateFile(env), JSON.stringify({ checked: Date.now(), ...u }));
};
const answer = (body, ok = true) => async () => ({ ok, json: async () => body });

async function registry(body) {
  const port = await freePort();
  const hits = [];
  const server = http.createServer((req, res) => {
    hits.push(req.url);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  });
  await new Promise((r) => server.listen(port, "127.0.0.1", r));
  cleanup.push(() => new Promise((r) => server.close(r)));
  return { url: `http://127.0.0.1:${port}`, hits };
}

test("isNewer: releases by number; prereleases and junk never count", () => {
  assert.equal(isNewer("0.3.0", "0.2.1"), true);
  assert.equal(isNewer("0.10.0", "0.9.9"), true);
  assert.equal(isNewer("1.0.0", "0.99.99"), true);
  assert.equal(isNewer("0.2.1", "0.2.1"), false);
  assert.equal(isNewer("0.2.0", "0.2.1"), false);
  assert.equal(isNewer("0.3.0-beta.1", "0.2.1"), false);
  assert.equal(isNewer(undefined, "0.2.1"), false);
  assert.equal(isNewer("0.3.0", "dev"), false);
});

test("the check: one request a day, its answer cached with the release's headline", async () => {
  const env = envOn();
  let calls = 0;
  const fetchFn = async (url) => {
    calls++;
    assert.equal(url, "https://registry.npmjs.org/obeya/latest");
    return answer({ version: "0.3.0", obeya: { headline: "  Stages, pins,\n docs in the tab " } })();
  };
  const now = Date.now();
  const u = await checkForUpdate(env, { now, fetchFn });
  assert.deepEqual(u, { checked: now, latest: "0.3.0", headline: "Stages, pins, docs in the tab" });
  assert.deepEqual(JSON.parse(fs.readFileSync(updateFile(env), "utf8")), u);
  await checkForUpdate(env, { now: now + UPDATE_TTL_MS - 1, fetchFn });
  assert.equal(calls, 1, "fresh for a day");
  await checkForUpdate(env, { now: now + UPDATE_TTL_MS, fetchFn });
  assert.equal(calls, 2, "asks again after a day");
});

test("the check: offline or a bad answer keeps what it knew and waits a day; a long headline is clipped", async () => {
  const env = envOn();
  seed(env, { checked: 0, latest: "0.3.0", headline: "Old news" });
  const now = Date.now();
  const u = await checkForUpdate(env, { now, fetchFn: async () => { throw new Error("offline"); } });
  assert.deepEqual(u, { checked: now, latest: "0.3.0", headline: "Old news" });
  const bad = await checkForUpdate(envOn(), { fetchFn: answer({ version: "not a version" }) });
  assert.equal(bad.latest, undefined);
  const long = await checkForUpdate(envOn(), { fetchFn: answer({ version: "0.4.0", obeya: { headline: "x".repeat(500) } }) });
  assert.equal(long.headline.length, 120);
});

test("the check is off with OBEYA_NO_UPDATE_CHECK: nothing fetched, no news", async () => {
  const env = envOn({ OBEYA_NO_UPDATE_CHECK: "1" });
  assert.equal(await checkForUpdate(env, { fetchFn: () => assert.fail("must not fetch") }), null);
  seed(env, { latest: "99.0.0" });
  assert.equal(pendingUpdate(VERSION, env), null);
});

test("pendingUpdate: only a newer release is news", () => {
  const env = envOn();
  assert.equal(pendingUpdate(VERSION, env), null, "no cache yet");
  seed(env, { latest: VERSION, headline: "Same" });
  assert.equal(pendingUpdate(VERSION, env), null);
  seed(env, { latest: "99.0.0", headline: "Big" });
  assert.deepEqual(pendingUpdate(VERSION, env), { to: "99.0.0", headline: "Big" });
});

test("guide: two lines under the core's title when there's news; topics and quiet days unchanged", async () => {
  const env = envOn();
  const plain = (await run(["--skill"], { env })).stdout;
  seed(env, { latest: "99.0.0", headline: "Stages, pins, docs in the tab." });
  const r = await run(["--skill"], { env });
  const notice = guideNotice(VERSION, { to: "99.0.0", headline: "Stages, pins, docs in the tab." });
  assert.equal(notice, `> obeya 99.0.0 is out (you have ${VERSION}): Stages, pins, docs in the tab.\n> Tell the person; to update: npm update -g obeya && npx skills update obeya`);
  assert.equal(r.stdout, plain.replace("# obeya\n", `# obeya\n\n${notice}\n`));
  assert.ok(Buffer.byteLength(r.stdout) - Buffer.byteLength(plain) < 200, "about 150 bytes, news days only");
  assert.equal((await run(["--skill", "patch"], { env })).stdout.includes("is out"), false);
  assert.equal((await run(["--skill", "all"], { env })).stdout.split("is out").length, 2, "once in all");
});

test("status: an update field in result when there's news, and not otherwise", async () => {
  const env = envOn({ OBEYA_DIR: path.join(tmpDir(), "c"), OBEYA_PORT: String(await freePort()) });
  assert.deepEqual(Object.keys(JSON.parse((await run(["status"], { env })).stdout).result), ["running", "url"]);
  seed(env, { latest: "99.0.0", headline: "Big" });
  const r = JSON.parse((await run(["status"], { env })).stdout).result;
  assert.deepEqual(r.update, { to: "99.0.0", headline: "Big" });
  assert.equal((await run(["--version"], { env })).stdout, VERSION, "--version is unchanged");
});

test("server: checks the registry at start; a connecting tab hears the news", async () => {
  const reg = await registry({ version: "99.0.0", obeya: { headline: "From the stand-in" } });
  const env = envOn({ OBEYA_REGISTRY_URL: reg.url, OBEYA_DIR: path.join(tmpDir(), "c"), OBEYA_PORT: String(await freePort()) });
  cleanup.push(() => run(["stop"], { env }));
  assert.equal((await run(["serve"], { env })).code, 0);
  for (let t = 0; t < 50 && !fs.existsSync(updateFile(env)); t++) await sleep(100);
  assert.deepEqual(reg.hits, ["/obeya/latest"]);
  assert.deepEqual(pendingUpdate(VERSION, env), { to: "99.0.0", headline: "From the stand-in" });
  // The event stream greets a new tab with it.
  const text = await new Promise((resolve, reject) => {
    const req = http.get(`http://127.0.0.1:${env.OBEYA_PORT}/events?tab=test-tab-1234`, (res) => {
      let buf = "";
      res.on("data", (d) => {
        buf += d;
        if (buf.includes("event: update")) { req.destroy(); resolve(buf); }
      });
    });
    req.on("error", reject);
    setTimeout(() => { req.destroy(); resolve(""); }, 3000);
  });
  assert.match(text, /event: hello\ndata: \{[^\n]*"version":"/);
  assert.match(text, /event: update\ndata: \{"update":\{"to":"99.0.0","headline":"From the stand-in"\}\}/);
});

test("an older server on the folder's port is stopped and replaced by this version", async () => {
  const dir = path.join(tmpDir(), "c");
  fs.mkdirSync(dir, { recursive: true });
  const port = await freePort();
  const env = { ...process.env, OBEYA_DIR: dir, OBEYA_PORT: String(port) };
  cleanup.push(() => run(["stop"], { env }));
  // Plays a running obeya 0.0.1 for this folder; it leaves when asked to.
  let stopped = false;
  const old = http.createServer((req, res) => {
    if (req.url === "/api/info") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ app: "obeya", version: "0.0.1", dir: fs.realpathSync(dir), port, browsers: 0 }));
    }
    if (req.url === "/api/shutdown" && req.method === "POST") {
      stopped = true;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ stopped: true }));
      old.close();
      return old.closeAllConnections();
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise((r) => old.listen(port, "127.0.0.1", r));
  const r = await run(["serve"], { env });
  assert.equal(r.code, 0, r.stdout);
  assert.equal(stopped, true, "asked the old server to stop");
  const info = await (await fetch(`http://127.0.0.1:${port}/api/info`)).json();
  assert.equal(info.version, VERSION);
});

test("a server the same version or newer is left running", async () => {
  const env = { ...process.env, OBEYA_DIR: path.join(tmpDir(), "c"), OBEYA_PORT: String(await freePort()) };
  cleanup.push(() => run(["stop"], { env }));
  await run(["serve"], { env });
  const pid = (await (await fetch(`http://127.0.0.1:${env.OBEYA_PORT}/api/info`)).json()).pid;
  await run(["serve"], { env });
  assert.equal((await (await fetch(`http://127.0.0.1:${env.OBEYA_PORT}/api/info`)).json()).pid, pid);
});
