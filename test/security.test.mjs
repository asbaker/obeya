import { test } from "node:test";
import assert from "node:assert/strict";
import { checkRequest } from "../src/lib/security.mjs";

const port = 4800;
const check = (pathname, headers = {}, method = "GET") =>
  checkRequest({ method, pathname, headers: { host: `127.0.0.1:${port}`, ...headers } }, { port });

test("Host must be 127.0.0.1 or localhost on our port (DNS rebinding)", () => {
  assert.equal(check("/", { host: "127.0.0.1:4800" }), null);
  assert.equal(check("/", { host: "localhost:4800" }), null);
  for (const host of ["evil.example:4800", "127.0.0.1:4747", "127.0.0.1", "", "0.0.0.0:4800"]) {
    assert.equal(check("/", { host })?.code, "forbidden_host", host);
  }
});

test("Origin other than our own is refused, so no other website can write", () => {
  assert.equal(check("/api/pages", { origin: "http://127.0.0.1:4800" }), null);
  assert.equal(check("/api/pages", { origin: "http://localhost:4800" }), null);
  for (const origin of ["https://evil.example", "http://127.0.0.1:4747", "null", "https://127.0.0.1:4800"]) {
    assert.equal(check("/api/pages", { origin })?.code, "forbidden_origin", origin);
    assert.equal(check("/api/pages/board/sync", { origin }, "POST")?.code, "forbidden_origin", origin);
    assert.equal(check("/api/info", { origin })?.code, "forbidden_origin", origin);
  }
});

test("cross-site fetch metadata is refused on the API and the event stream", () => {
  for (const p of ["/api/pages", "/events"]) {
    assert.equal(check(p, { "sec-fetch-site": "cross-site" })?.code, "forbidden_origin", p);
    assert.equal(check(p, { "sec-fetch-site": "same-site" })?.code, "forbidden_origin", p); // another port on localhost
    assert.equal(check(p, { "sec-fetch-site": "same-origin" }), null, p);
  }
  // Navigating to the page from elsewhere is fine: the page alone reveals nothing.
  assert.equal(check("/", { "sec-fetch-site": "cross-site" }), null);
});

test("no token: the page, the API and the event stream are open to this machine", () => {
  assert.equal(check("/"), null);
  assert.equal(check("/api/pages"), null); // the CLI sends no Origin or fetch metadata
  assert.equal(check("/events", { "sec-fetch-site": "same-origin" }), null);
  assert.equal(check("/api/info"), null);
});
