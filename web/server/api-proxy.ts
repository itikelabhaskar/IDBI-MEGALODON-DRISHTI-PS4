// Forwards /api/* to the FastAPI scoring service with the /api prefix removed,
// as the `/api/**` proxy route rule used to. It is a handler rather than a route
// rule so the JSON can be gzipped on the way out: h3's proxy drops the
// upstream's own encoding, and /api/portfolio alone is ~2.9 MB uncompressed.
import { defineHandler, proxyRequest } from "h3";
import { gzipIfAccepted } from "./gzip";

const API = (process.env.DRISHTI_API_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
const NO_BODY = new Set([101, 204, 205, 304]);

export default defineHandler(async (event) => {
  const path = event.url.pathname.replace(/^\/api/, "") || "/";
  const upstream = await proxyRequest(event, API + path + event.url.search);
  const status = upstream.status ?? 200;
  const response = new Response(NO_BODY.has(status) ? null : upstream.body, {
    status,
    statusText: upstream.statusText,
    headers: upstream.headers,
  });
  return gzipIfAccepted(event.req, response, /json|^text\//);
});
