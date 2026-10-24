// Drive the web build in headless Chromium: load ROM, press keys, take screenshots.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW_PATH ?? "playwright");
const url = process.argv[2] ?? "http://localhost:5173/";
const rom = process.env.DKC2_ROM ?? "/home/claude/dkc2/Donkey Kong Country 2 - Diddy's Kong Quest (USA) (En,Fr) (Rev 1).sfc";
const out = process.argv[3] ?? "out/browser";
const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage({ viewport: { width: 1024, height: 800 } });
const logs = [];
page.on("console", (m) => logs.push(m.type() + ": " + m.text()));
page.on("pageerror", (e) => logs.push("pageerror: " + e.message));
await page.goto(url);
await page.setInputFiles("#rom-file", rom);
await page.waitForTimeout(15000);
await page.screenshot({ path: `${out}_1.png` });
const press = async (k, ms = 120) => { await page.keyboard.down(k); await page.waitForTimeout(ms); await page.keyboard.up(k); };
for (let i = 0; i < 4; i++) { await press("Enter"); await page.waitForTimeout(3500); }
await page.screenshot({ path: `${out}_2.png` });
for (let i = 0; i < 3; i++) { await press("Enter"); await page.waitForTimeout(4000); }
await page.keyboard.press("Backquote");
await page.keyboard.down("ArrowRight"); await page.waitForTimeout(2500); await page.keyboard.up("ArrowRight");
await page.screenshot({ path: `${out}_3.png` });
console.log(logs.slice(-15).join("\n"));
await browser.close();
