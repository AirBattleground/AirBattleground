import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: {
    port: 5174,
    strictPort: true,
    // same-origin API in dev so the httpOnly session cookie just works
    proxy: { "/api": { target: process.env.API_URL ?? "http://localhost:4000", changeOrigin: true } },
  },
});
