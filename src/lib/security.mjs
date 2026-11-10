// Request checks. Any web page in the person's browser can send
// requests to 127.0.0.1, so the server checks Host, Origin and Sec-Fetch-Site.
// There is no session token: other programs on the machine are trusted, like
// the CLI. Requests with side effects are never GETs, so the Origin check
// covers every write.

/**
 * @param {{method: string, pathname: string, headers: Record<string, string|undefined>}} req
 * @param {{port: number}} opts
 * @returns {null | {status: number, code: string, message: string}}
 */
export function checkRequest(req, { port }) {
  const hosts = [`127.0.0.1:${port}`, `localhost:${port}`];
  if (!hosts.includes(req.headers.host ?? "")) {
    return { status: 403, code: "forbidden_host", message: "Host header must be 127.0.0.1 or localhost on this port" };
  }
  const origin = req.headers.origin;
  if (origin !== undefined && !hosts.some((h) => origin === `http://${h}`)) {
    return { status: 403, code: "forbidden_origin", message: "requests from other origins are not allowed" };
  }
  const isApi = req.pathname.startsWith("/api/") || req.pathname === "/events";
  const site = req.headers["sec-fetch-site"];
  if (isApi && site !== undefined && site !== "same-origin" && site !== "none") {
    return { status: 403, code: "forbidden_origin", message: "cross-site requests are not allowed" };
  }
  return null;
}
