// A local stand-in for the public library catalogue, served from test/fixtures.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { freePort } from "./env.mjs";

export const FIXTURE = path.resolve("test/fixtures/catalogue");

export async function startCatalogue(root = FIXTURE) {
  const port = await freePort();
  const hits = [];
  const server = http.createServer((req, res) => {
    hits.push(req.url);
    const file = path.join(root, decodeURIComponent(new URL(req.url, "http://x").pathname));
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      return res.end("not found");
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(fs.readFileSync(file));
  });
  await new Promise((r) => server.listen(port, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${port}`, hits, close: () => new Promise((r) => server.close(r)) };
}
