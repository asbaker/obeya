import { test } from "node:test";
import assert from "node:assert/strict";
import { router } from "../src/server/http.mjs";

test("router: method and path, :params, first match wins, no match is null", () => {
  const a = () => "a", b = () => "b", c = () => "c";
  const match = router([
    ["GET", "/api/pages", a],
    [["GET", "POST"], "/api/pages/:page/changes", b],
    [["PUT", "DELETE"], "/api/pages/:page/bands/:band", c],
  ]);
  const at = (m, p) => match(m, p.split("/").filter(Boolean));
  assert.equal(at("GET", "/api/pages").handler, a);
  assert.deepEqual(at("POST", "/api/pages/board/changes").params, { page: "board" });
  assert.deepEqual(at("DELETE", "/api/pages/board/bands/cut").params, { page: "board", band: "cut" });
  assert.equal(at("POST", "/api/pages"), null, "wrong method");
  assert.equal(at("GET", "/api/pages/board/bands/cut"), null);
  assert.equal(at("GET", "/api/pages/board/changes/extra"), null, "longer path");
});
