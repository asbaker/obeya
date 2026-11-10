// HTTP plumbing for the server: errors, JSON bodies, static files, and a small
// route table.
import fs from "node:fs";

export class ApiError extends Error {
  constructor(status, code, message, extra) {
    super(message);
    Object.assign(this, { status, code, extra });
  }
}

const MAX_BODY = 64 * 1024 * 1024;

export function readJSON(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new ApiError(413, "too_large", "request body too large"));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => {
      const text = Buffer.concat(chunks).toString();
      if (!text) return resolve({});
      try {
        resolve(JSON.parse(text));
      } catch {
        reject(new ApiError(400, "invalid_json", "request body is not valid JSON"));
      }
    });
    req.on("error", reject);
  });
}

export const json = (res, code, body) => {
  res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
};

export const SECURITY_HEADERS = {
  "x-frame-options": "DENY",
  "content-security-policy": "frame-ancestors 'none'",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
};

export function sendFile(res, file, type) {
  res.writeHead(200, { "content-type": type, "cache-control": "no-store", ...SECURITY_HEADERS });
  res.end(fs.readFileSync(file));
}

export const requirePage = (store, name) => {
  if (!store.exists(name)) throw new ApiError(404, "unknown_page", `no page "${name}"`, { pages: store.list() });
};
export const requireElement = (store, name, id) => {
  const el = id ? store.load(name).byId.get(id) : null;
  if (id && (!el || el.isDeleted)) throw new ApiError(404, "unknown_element", `no element "${id}" on page "${name}"`);
};

/**
 * A route table: `[method or methods, "/api/pages/:page/patch", handler]`.
 * Returns `match(method, parts)`: `{handler, params}`, or null.
 */
export function router(routes) {
  const table = routes.map(([methods, pattern, handler]) => ({ methods: [].concat(methods), parts: pattern.split("/").filter(Boolean), handler }));
  return (method, parts) => {
    for (const r of table) {
      if (r.parts.length !== parts.length || !r.methods.includes(method)) continue;
      const params = {};
      const ok = r.parts.every((p, i) => (p.startsWith(":") ? ((params[p.slice(1)] = parts[i]), true) : p === parts[i]));
      if (ok) return { handler: r.handler, params };
    }
    return null;
  };
}
