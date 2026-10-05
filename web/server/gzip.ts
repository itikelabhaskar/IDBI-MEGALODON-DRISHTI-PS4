// Gzip for responses that travel the Bank's SSM port-forwarding path, which
// moves roughly 50–100 KB/s. Used by the SSR entry (src/server.ts) for HTML and
// by the API proxy (api-proxy.ts) for JSON. Static JS/CSS are pre-compressed at
// build time instead (`compressPublicAssets` in vite.config.ts).
export function gzipIfAccepted(request: Request, response: Response, types: RegExp): Response {
  const type = response.headers.get("content-type") || "";
  if (
    !response.body ||
    !types.test(type) ||
    response.headers.has("content-encoding") ||
    !/\bgzip\b/.test(request.headers.get("accept-encoding") || "")
  ) {
    return response;
  }
  const headers = new Headers(response.headers);
  headers.set("content-encoding", "gzip");
  headers.delete("content-length");
  headers.append("vary", "Accept-Encoding");
  return new Response(response.body.pipeThrough(new CompressionStream("gzip")), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
