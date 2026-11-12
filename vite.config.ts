import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "mascot-idle.svg"],
      manifest: {
        name: "Fair Price",
        short_name: "Fair Price",
        description: "Check whether a stall, pump, or fare price is fair for your area.",
        theme_color: "#1F4E79",
        background_color: "#F6E7C1",
        display: "standalone",
        start_url: "/",
        lang: "en-NG",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" },
        ],
      },
    }),
  ],
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:3001",
    },
  },
  build: { outDir: "dist/public", emptyOutDir: true },
  preview: {
    host: "127.0.0.1",
    port: 4173,
  },
});
