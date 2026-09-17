import type { Plugin } from "vite";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

const PROXY_PATH = "/__iptv-proxy";

/**
 * Dev-only same-origin proxy for arbitrary IPTV provider URLs.
 *
 * In the browser dev server, `fetch()` to a third-party Xtream/M3U/XMLTV
 * host is blocked by CORS unless that provider happens to send
 * Access-Control-Allow-Origin — which almost none do. There's no way to
 * make someone else's server send that header, so instead this plugin
 * proxies the request server-side (Node has no same-origin policy) and
 * hands the response back to the page from http://localhost:5173, which
 * *is* same-origin.
 *
 * This only exists for `vite dev`. The packaged webOS TV app doesn't run
 * through Vite's dev server at all and doesn't enforce browser CORS the
 * same way a plain desktop browser tab does, so nothing here ships to
 * users — see proxyFetch() in src/proxy-fetch.ts for the corresponding
 * no-op passthrough used at runtime outside dev.
 */
export function iptvDevProxyPlugin(): Plugin {
  return {
    name: "iptv-dev-proxy",
    configureServer(server) {
      server.middlewares.use(PROXY_PATH, (req, res) => {
        const target = new URL(req.url ?? "", "http://placeholder").searchParams.get("url");
        if (!target) {
          res.statusCode = 400;
          res.end("Missing ?url= parameter");
          return;
        }

        let targetUrl: URL;
        try {
          targetUrl = new URL(target);
        } catch {
          res.statusCode = 400;
          res.end("Invalid target URL");
          return;
        }

        const requestFn = targetUrl.protocol === "https:" ? httpsRequest : httpRequest;
        const proxyReq = requestFn(targetUrl, { method: req.method }, (proxyRes) => {
          res.statusCode = proxyRes.statusCode ?? 502;
          for (const [key, value] of Object.entries(proxyRes.headers)) {
            if (value !== undefined && !["content-encoding", "transfer-encoding"].includes(key)) {
              res.setHeader(key, value);
            }
          }
          proxyRes.pipe(res);
        });

        proxyReq.on("error", (error) => {
          res.statusCode = 502;
          res.end(`Proxy error: ${error.message}`);
        });

        req.pipe(proxyReq);
      });
    },
  };
}
