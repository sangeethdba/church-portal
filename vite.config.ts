import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import path from "node:path";

const PORT = Number(process.env.PORT ?? 5173);

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg"],
      manifest: {
        name: "Atlanta Little Flock — Stewardship Portal",
        short_name: "ALF Church",
        description: "Faithful stewardship: offerings, expenses, and giving statements for Atlanta Little Flock Church.",
        theme_color: "#1c1917",
        background_color: "#FEF7ED",
        display: "standalone",
        orientation: "any",
        start_url: "/",
        icons: [
          { src: "/favicon.svg", sizes: "64x64", type: "image/svg+xml" },
          { src: "/pwa-192.png", sizes: "192x192", type: "image/png" },
          { src: "/pwa-512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: "CacheFirst",
            options: { cacheName: "google-fonts", expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 } },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: "CacheFirst",
            options: { cacheName: "google-fonts-static", expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 } },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    host: "0.0.0.0",
    port: PORT,
    strictPort: false,
    // Freebuff requires HMR to remain disabled
    hmr: false,
  },
  preview: {
    host: "0.0.0.0",
    port: PORT,
  },
  build: {
    target: "es2022",
    sourcemap: true,
  },
});
