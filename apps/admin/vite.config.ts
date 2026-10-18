import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  // served under /admin-ui on the same origin as the team & manager portal
  base: "/admin-ui/",
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: {
    // this machine only — open it through the web dev server: http://<host>:5173/admin-ui
    host: "localhost",
    port: 5174,
    strictPort: true,
    // same-origin API in dev so the httpOnly session cookie just works
    proxy: { "/api": { target: process.env.API_URL ?? "http://localhost:4000", changeOrigin: true } },
  },
});
