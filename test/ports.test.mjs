// Each pages folder gets its own port, remembered in the per-user cache (src/cli/ports.mjs).
// Bases come from the OS's free ports, never 4747.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { resolvePort, portsFile } from "../src/cli/ports.mjs";
import { freePort, tmpDir } from "./helpers/env.mjs";

const listen = (port, handler = (req, res) => res.end("not obeya")) =>
  new Promise((resolve) => { const s = http.createServer(handler); s.listen(port, "127.0.0.1", () => resolve(s)); });
const close = (s) => new Promise((r) => s.close(r));

test("ports: a folder takes the first free port, keeps it, and another folder gets another", async () => {
  const env = { OBEYA_CACHE: tmpDir() };
  const base = await freePort();
  const a = tmpDir(), b = tmpDir();
  const pa = await resolvePort({ dir: a }, env, { base });
  assert.equal(pa, base);
  assert.equal(JSON.parse(fs.readFileSync(portsFile(env), "utf8"))[a], base, "remembered in the per-user cache");
  assert.equal(await resolvePort({ dir: a }, env, { base }), base, "the same folder gets the same port");
  const pb = await resolvePort({ dir: b }, env, { base });
  assert.notEqual(pb, base, "a's port is kept for a even while its server is stopped");
  assert.equal(await resolvePort({ dir: b }, env, { base }), pb);
  // Nothing is written into the folders themselves.
  assert.deepEqual([fs.readdirSync(a), fs.readdirSync(b)], [[], []]);
});

test("ports: something else on the remembered port moves the folder; explicit ports win; status only looks", async () => {
  const env = { OBEYA_CACHE: tmpDir() };
  const base = await freePort();
  const a = tmpDir();
  assert.equal(await resolvePort({ dir: a }, env, { base }), base);
  const other = await listen(base); // another program takes it
  try {
    const moved = await resolvePort({ dir: a }, env, { base });
    assert.notEqual(moved, base);
    assert.equal(JSON.parse(fs.readFileSync(portsFile(env), "utf8"))[a], moved);
  } finally {
    await close(other);
  }
  assert.equal(await resolvePort({ dir: a, port: 1234, portExplicit: true }, env, { base }), 1234);
  const c = tmpDir();
  await resolvePort({ dir: c }, env, { base, remember: false });
  assert.equal(JSON.parse(fs.readFileSync(portsFile(env), "utf8"))[c], undefined, "status and stop don't remember");
});

test("ports: an obeya server already serving the folder is found on its port; folders that are gone are forgotten", async () => {
  const env = { OBEYA_CACHE: tmpDir() };
  const base = await freePort();
  const a = tmpDir();
  // An obeya server for this folder already on the base port, not yet remembered.
  const srv = await listen(base, (req, res) => res.end(JSON.stringify({ app: "obeya", dir: a })));
  try {
    assert.equal(await resolvePort({ dir: a }, env, { base }), base);
  } finally {
    await close(srv);
  }
  const gone = path.join(tmpDir(), "gone");
  fs.writeFileSync(portsFile(env), JSON.stringify({ [gone]: base + 1, [a]: base }));
  await resolvePort({ dir: a }, env, { base });
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(portsFile(env), "utf8"))), [a]);
});
