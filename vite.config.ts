import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const api = "http://localhost:3000";

export default defineConfig({
  root: "web",
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(__dirname, "web/src") } },
  build: { outDir: "../dist", emptyOutDir: true },
  server: {
    host: true,
    proxy: {
      "/api": api,
      "/ws": { target: api, ws: true },
    },
  },
});
