import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
const assertShim = fileURLToPath(new URL("./src/shims/assert.js", import.meta.url));
export default defineConfig({
  base: "./",
  resolve: { alias: { assert: assertShim } },
  // ported routines are registered under their function names (= original labels)
  esbuild: { keepNames: true },
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 4000,
    commonjsOptions: { include: [/node_modules/, /src\/shims/] },
  },
});
