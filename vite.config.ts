import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { VitePWA } from "vite-plugin-pwa";

// Make Vite's injected main stylesheet non-render-blocking in production.
// The pre-hydration LCP shell in index.html uses only inline styles, so the
// app CSS can load async without a flash.
const asyncCssPlugin = () => ({
  name: "async-main-css",
  apply: "build" as const,
  transformIndexHtml(html: string) {
    return html.replace(
      /<link rel="stylesheet"([^>]*?)href="([^"]+\.css)"([^>]*)>/g,
      (_m, pre, href, post) =>
        `<link rel="preload" as="style"${pre}href="${href}"${post} onload="this.onload=null;this.rel='stylesheet'"><noscript><link rel="stylesheet"${pre}href="${href}"${post}></noscript>`,
    );
  },
});

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const apiHost = (() => {
    try {
      return new URL(env.VITE_API_URL ?? "").hostname;
    } catch {
      return "";
    }
  })();
  return {
  server: {
    host: "::",
    port: 8080,
  },
  plugins: [
    react(),
    asyncCssPlugin(),
    VitePWA({
      // The manifest is hand-maintained in public/manifest.webmanifest.
      manifest: false,
      injectRegister: null,
      registerType: "autoUpdate",
      devOptions: { enabled: false },
      filename: "sw.js",
      workbox: {
        // Precache only the shell; lazy route chunks are cached at runtime
        // (CacheFirst on /assets/) so a huge admin chunk can't bloat install.
        globPatterns: ["index.html", "assets/*.css"],
        // Never let the SW hijack OAuth or the dedicated POS/push workers.
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/~oauth/, /^\/sw-/, /^\/functions\//],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        runtimeCaching: [
          {
            // HTML navigations (dashboard, settings, every route) — always
            // try the network first so deploys are picked up immediately.
            urlPattern: ({ request }) => request.mode === "navigate",
            handler: "NetworkFirst",
            options: {
              cacheName: "html-navigations",
              networkTimeoutSeconds: 3,
              expiration: { maxEntries: 32, maxAgeSeconds: 60 * 60 * 24 },
            },
          },
          {
            // Hashed build assets are immutable — safe to serve from cache.
            urlPattern: ({ url, request, sameOrigin }) =>
              sameOrigin &&
              url.pathname.startsWith("/assets/") &&
              (request.destination === "script" ||
                request.destination === "style" ||
                request.destination === "font"),
            handler: "CacheFirst",
            options: {
              cacheName: "static-assets",
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
          {
            urlPattern: ({ request, sameOrigin }) => sameOrigin && request.destination === "image",
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "images",
              expiration: { maxEntries: 120, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
          {
            // Read-only dashboard/settings data: serve last good response when
            // the network is unavailable. Writes are never cached.
            urlPattern: ({ url, request }) =>
              request.method === "GET" &&
              url.hostname === apiHost &&
              url.pathname.startsWith("/rest/v1/"),
            handler: "NetworkFirst",
            options: {
              cacheName: "api-read",
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 6 },
              cacheableResponse: { statuses: [200] },
            },
          },
        ],
      },
    }),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@matbex/client": path.resolve(__dirname, "./packages/client/src/index.ts"),
    },
  },
  build: {
    // Conservative manual chunking: only isolate libraries that are
    // self-contained and don't share circular init with each other.
    // The API client + React Query are intentionally LEFT in the default
    // chunk — grouping them caused a TDZ crash in production.
    rollupOptions: {
      output: {
        // Distinct name for the startup entry, so the size budget (.size-limit.json) measures
        // it alone and not lazily loaded chunks that also end up named "index-*".
        entryFileNames: "assets/entry-[hash].js",
        manualChunks(id: string) {
          if (!id.includes("node_modules")) return;
          if (id.includes("framer-motion") || id.includes("motion-dom") || id.includes("motion-utils")) {
            return "motion-vendor";
          }
          if (id.includes("recharts") || id.includes("/d3-")) {
            return "charts-vendor";
          }
          if (id.includes("i18next") || id.includes("react-i18next")) {
            return "i18n-vendor";
          }
        },
      },
    },
  },
};
});
