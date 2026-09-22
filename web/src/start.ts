import { createStart, createMiddleware } from "@tanstack/react-start";

const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (error: any) {
    // Preserve HTTP redirects (301, 302, 307, 308) thrown by TanStack Router
    const code = error?.statusCode ?? error?.status;
    if (typeof code === "number" && code >= 300 && code < 400) {
      throw error;
    }
    console.error("[TanStack Start SSR Error]:", error);
    const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/><title>DRISHTI — Service Unavailable</title></head><body style="font-family:system-ui,-apple-system,sans-serif;background:#090d16;color:#f3f4f6;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;"><div style="text-align:center;padding:24px;border-radius:12px;background:#111827;border:1px solid #1f2937;max-width:400px;"><h2 style="margin:0 0 8px 0;font-size:18px;">DRISHTI Console</h2><p style="color:#9ca3af;font-size:13px;margin:0 0 16px 0;">Banking service temporarily unavailable. Please retry.</p><button onclick="window.location.reload()" style="background:#2563eb;color:#fff;border:none;padding:8px 16px;border-radius:6px;font-size:13px;cursor:pointer;font-weight:500;">Reload Console</button></div></body></html>`;
    return new Response(html, {
      status: 503,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }
});

export const startInstance = createStart(() => ({
  requestMiddleware: [errorMiddleware],
}));
