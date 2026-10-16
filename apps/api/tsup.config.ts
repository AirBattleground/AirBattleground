import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node20",
  platform: "node",
  clean: true,
  sourcemap: true,
  // bundle the TS-source workspace package; keep real deps external
  noExternal: ["@7xen/shared"],
});
