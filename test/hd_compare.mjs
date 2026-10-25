// Same frame, original sprite vs HD Diddy (dev server; deterministic stepping).
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW_PATH ?? "playwright");
const url = process.argv[2] ?? "http://localhost:5173/";
const rom = process.env.DKC2_ROM ?? "/home/claude/dkc2/Donkey Kong Country 2 - Diddy's Kong Quest (USA) (En,Fr) (Rev 1).sfc";
const shots = (process.argv[3] ?? "lvl_pirate:40:128").split(",");
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 1000 } });
page.on("pageerror", (e) => console.log("pageerror: " + e.message));
await page.goto(url);
await page.setInputFiles("#rom-file", rom);
await page.waitForFunction(() => window.__dkc2, null, { timeout: 30000 });
await page.evaluate(() => window.__dkc2.pause(true));
for (const sh of shots) {
  const [st, n, pad] = sh.split(":");
  for (const mode of ["off", "on"]) {
    await page.evaluate(async ({ st, n, pad, mode }) => {
      const d = window.__dkc2;
      d.hw.loadState(new Uint8Array(await (await fetch(`/${st}.state`)).arrayBuffer()));
      d.hd(mode === "on");
      d.step(+n, +pad);
    }, { st, n, pad, mode });
    await page.locator("#screen").screenshot({ path: `out/cmp_${st}_${n}_${mode}.png` });
  }
}
await browser.close();
