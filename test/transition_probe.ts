// Wall time and audio level per frame across title -> file select -> world map.
import { readFileSync, writeFileSync } from "node:fs";
import { makeMachine, STATES_DIR } from "./lib/oracle.ts";
import { frame, lagFrames } from "../src/game/machine.ts";
import { r16 } from "../src/core/mem.ts";
import { labelAt } from "../src/core/sym.ts";
const [st = "title", n = "900"] = process.argv.slice(2);
const { hw } = await makeMachine();
(hw.ex as any).hw_set_overclock?.(0);
(hw.ex as any).hw_set_apu_speed?.(1);
hw.loadState(new Uint8Array(readFileSync(`${STATES_DIR}/${st}.state`)));
const START = 1 << 3, B = 1;
const pcm: number[] = [];
let lastNmi = -1;
for (let f = 0; f < +n; f++) {
  const pad = f % 120 === 60 ? START : f % 120 === 90 ? B : 0;
  const t = performance.now();
  const ran = frame(pad);
  const dt = performance.now() - t;
  const a = hw.drainAudio();
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * a[i];
  const rms = Math.sqrt(s / a.length) | 0;
  for (let i = 0; i < a.length; i++) pcm.push(a[i]);
  const nmi = r16(0x20);
  if (nmi !== lastNmi || dt > 12 || !ran) console.log(f, ran ? "" : "LAG", dt.toFixed(1) + "ms", "rms", rms, labelAt(0x800000 | nmi) ?? nmi.toString(16));
  lastNmi = nmi;
}
console.log("lag frames", lagFrames);
const buf = Buffer.alloc(44 + pcm.length * 2);
buf.write("RIFF", 0); buf.writeUInt32LE(36 + pcm.length * 2, 4); buf.write("WAVEfmt ", 8);
buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22); buf.writeUInt32LE(32040, 24);
buf.writeUInt32LE(32040 * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34); buf.write("data", 36); buf.writeUInt32LE(pcm.length * 2, 40);
pcm.forEach((v, i) => buf.writeInt16LE(v, 44 + i * 2));
writeFileSync("out/transition.wav", buf);
