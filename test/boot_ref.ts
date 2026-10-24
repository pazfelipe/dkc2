// Boot the original game on the reference emulator and save PNG snapshots.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { Hardware, PAD } from "../src/platform/hw.ts";
import { savePng } from "./png.ts";

const rom = new Uint8Array(readFileSync(process.env.DKC2_ROM!));
const hw = await Hardware.create(readFileSync("public/hw.wasm"), rom);
mkdirSync("out/boot", { recursive: true });
const script: [number, number][] = [[720, 0], [4, PAD.START], [120, 0], [4, PAD.START], [120, 0], [4, PAD.START], [120, 0], [4, PAD.START], [120, 0], [4, PAD.START], [180, 0], [4, PAD.START], [240, 0]];
let f = 0;
for (const [n, pad] of script) {
  for (let i = 0; i < n; i++) {
    hw.setInput(0, pad);
    hw.emuRunFrame();
    f++;
  }
  savePng(`out/boot/f${String(f).padStart(5, "0")}.png`, hw.frameRGBA(), 256, 224);
}
writeFileSync("out/boot/pirate.state", hw.saveState());
console.log("frames", f);
