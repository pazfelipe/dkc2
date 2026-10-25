// File select / game mode screens in HD vs original (dev server).
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW_PATH ?? "playwright");
const rom = process.env.DKC2_ROM ?? "/home/claude/dkc2/Donkey Kong Country 2 - Diddy's Kong Quest (USA) (En,Fr) (Rev 1).sfc";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 1000 } });
page.on("pageerror", (e) => console.log("pageerror: " + e.message));
page.on("console", (m) => m.type() === "error" && console.log(m.text()));
await page.goto("http://localhost:5173/");
await page.setInputFiles("#rom-file", rom);
await page.waitForFunction(() => window.__dkc2, null, { timeout: 30000 });
await page.evaluate(() => window.__dkc2.pause(true));
for (const mode of ["off", "on"]) {
  await page.evaluate(async (mode) => {
    const d = window.__dkc2;
    d.hw.loadState(new Uint8Array(await (await fetch(`/title.state`)).arrayBuffer()));
    d.hd(mode === "on");
    d.step(60); d.step(1, 8); d.step(119); d.step(1, 8); d.step(200);
  }, mode);
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.__dkc2.step(1));
  await page.locator("#screen").screenshot({ path: `out/menu_${mode}.png` });
}
await browser.close();
