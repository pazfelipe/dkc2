// Screenshot the HD Diddy overlay on vs off from a few saved states (dev server only).
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW_PATH ?? "playwright");
const url = process.argv[2] ?? "http://localhost:5173/";
const rom = process.env.DKC2_ROM ?? "/home/claude/dkc2/Donkey Kong Country 2 - Diddy's Kong Quest (USA) (En,Fr) (Rev 1).sfc";
const states = (process.argv[3] ?? "lvl_pirate").split(",");
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 1000 } });
const logs = [];
page.on("console", (m) => logs.push(m.type() + ": " + m.text()));
page.on("pageerror", (e) => logs.push("pageerror: " + e.message));
await page.goto(url);
await page.setInputFiles("#rom-file", rom);
await page.waitForFunction(() => window.__dkc2, null, { timeout: 30000 });
for (const st of states) {
  await page.evaluate(async (st) => {
    const b = new Uint8Array(await (await fetch(`/${st}.state`)).arrayBuffer());
    window.__dkc2.hw.loadState(b);
  }, st);
  await page.keyboard.down("ArrowRight"); await page.waitForTimeout(700); await page.keyboard.up("ArrowRight");
  await page.keyboard.press("p"); await page.waitForTimeout(100);
  await page.locator("#screen").screenshot({ path: `out/hd_${st}_on.png` });
  await page.evaluate(() => window.__dkc2.ghost(true));
  await page.keyboard.press("p"); await page.waitForTimeout(50); await page.keyboard.press("p"); await page.waitForTimeout(100);
  await page.locator("#screen").screenshot({ path: `out/hd_${st}_ghost.png` });
  await page.evaluate(() => window.__dkc2.ghost(false));
  await page.keyboard.press("p");
}
console.log(logs.slice(-10).join("\n"));
await browser.close();
