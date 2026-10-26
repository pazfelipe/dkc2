import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

/** Packs assets/ (the extracted game data) into public/dkc2-data.pak before serving/building. */
function gameData() {
  return {
    name: "dkc2-data",
    buildStart() {
      if (!existsSync(new URL("./assets/manifest.json", import.meta.url))) {
        this.warn("assets/ is missing: extract the game data first (npm run extract -- <your ROM>)");
        return;
      }
      execFileSync(process.execPath, ["--import", "tsx", fileURLToPath(new URL("./tools/pack_assets.ts", import.meta.url))], { stdio: "inherit" });
    },
  };
}
const assertShim = fileURLToPath(new URL("./src/shims/assert.js", import.meta.url));
export default defineConfig({
  base: "./",
  plugins: [gameData()],
  resolve: { alias: { assert: assertShim } },
  // ported routines are registered under their function names (= original labels)
  esbuild: { keepNames: true },
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 4000,
    commonjsOptions: { include: [/node_modules/, /src\/shims/] },
  },
});
