import http from "node:http";
import { defineConfig, type Plugin } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { nitro } from "nitro/vite";

function apiProxyPlugin(): Plugin {
  const target = process.env.DRISHTI_API_URL || "http://localhost:8000";
  const parsed = new URL(target);
  return {
    name: "api-proxy",
    configureServer(server) {
      server.middlewares.use("/api", (req, res) => {
        const proxyReq = http.request(
          {
            hostname: parsed.hostname,
            port: parsed.port || 8000,
            path: req.url || "/",
            method: req.method,
            headers: {
              ...req.headers,
              host: parsed.host,
            },
          },
          (proxyRes) => {
            res.writeHead(proxyRes.statusCode || 500, proxyRes.headers);
            proxyRes.pipe(res);
          }
        );
        proxyReq.on("error", (err) => {
          res.writeHead(502, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Bad gateway", detail: err.message }));
        });
        req.pipe(proxyReq);
      });
    },
  };
}

function htmlAcceptNormalizePlugin(): Plugin {
  return {
    name: "html-accept-normalize",
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const url = req.url || "/";
        const pathname = url.split("?")[0];
        const isApi = pathname.startsWith("/api");
        const isInternal = pathname.startsWith("/@") || pathname.startsWith("/node_modules");
        const isStatic = pathname.includes(".") && !pathname.endsWith(".html");
        if (!isApi && !isInternal && !isStatic) {
          const accept = (req.headers["accept"] as string) || "";
          if (!accept.includes("text/html")) {
            const normalized = accept
              ? `text/html,${accept}`
              : "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";
            req.headers["accept"] = normalized;
            if (req.rawHeaders) {
              let found = false;
              for (let i = 0; i < req.rawHeaders.length; i += 2) {
                if (req.rawHeaders[i].toLowerCase() === "accept") {
                  req.rawHeaders[i + 1] = normalized;
                  found = true;
                  break;
                }
              }
              if (!found) {
                req.rawHeaders.push("Accept", normalized);
              }
            }
          }
        }
        next();
      });
    },
  };
}

// DRISHTI controlling-office console. Nitro emits the deployable server build;
// defaults to `node-server` (Docker on IDBI's AWS sandbox / ECS Fargate).
// Override with NITRO_PRESET (`aws-lambda`, `vercel`, …) for other hosts.
export default defineConfig({
  server: {
    host: "0.0.0.0",
    port: 8080,
    proxy: {
      // Live-API mode: forward /api/* to the FastAPI scoring service.
      "/api": {
        target: process.env.DRISHTI_API_URL || "http://localhost:8000",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ""),
      },
    },
  },
  resolve: {
    tsconfigPaths: true,
    alias: {
      tslib: "tslib/tslib.es6.mjs",
    },
  },
  plugins: [
    htmlAcceptNormalizePlugin(),
    apiProxyPlugin(),
    tailwindcss(),
    tanstackStart({ server: { entry: "server" } }),
    nitro({
      preset: process.env.NITRO_PRESET || "node-server",
      noExternals: true,
      routeRules: {
        "/api/**": {
          proxy: `${(process.env.DRISHTI_API_URL || "http://127.0.0.1:8000").replace(/\/$/, "")}/**`,
        },
        "/docs": {
          proxy: `${(process.env.DRISHTI_API_URL || "http://127.0.0.1:8000").replace(/\/$/, "")}/docs`,
        },
        "/openapi.json": {
          proxy: `${(process.env.DRISHTI_API_URL || "http://127.0.0.1:8000").replace(/\/$/, "")}/openapi.json`,
        },
      },
    }),
    viteReact(),
  ],
});

