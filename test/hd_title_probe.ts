// How often the background changes (and how many sprite pixels there are) on a given screen.
//   npx tsx test/hd_title_probe.ts <state> <nmi label> [frames]
import { readFileSync } from "node:fs";
import { makeMachine, STATES_DIR, L } from "./lib/oracle.ts";
import { frame } from "../src/game/machine.ts";
import { r16 } from "../src/core/mem.ts";
const [st = "title", label = "run_title_screen", n = "700"] = process.argv.slice(2);
const { hw } = await makeMachine();
hw.loadState(new Uint8Array(readFileSync(`${STATES_DIR}/${st}.state`)));
const ex = hw.ex as any;
ex.hw_hd_split(1);
let last = 0, changes = 0, on = 0, sprites = 0, add = 0;
const hashes = new Set<number>();
for (let f = 0; f < +n; f++) {
  frame(f === 60 || f === 180 ? 1 << 3 : f > 300 && f % 40 === 20 ? 1 << 5 : 0);
  if (r16(0x20) !== (L(label) & 0xffff)) continue;
  const bg = new Uint16Array(hw.mem, ex.hw_hd_bg(), 256 * 224);
  const ob = new Uint16Array(hw.mem, ex.hw_hd_obj(), 256 * 224);
  let h = 2166136261;
  for (let i = 0; i < bg.length; i++) h = Math.imul(h ^ bg[i], 16777619);
  for (let i = 0; i < ob.length; i++) { if (ob[i] & 0x8000) sprites++; if (ob[i] & 0x4000) add++; }
  on++;
  if (h !== last) changes++;
  hashes.add(h);
  last = h;
}
console.log({ frames: on, changes, distinct: hashes.size, opaqueSpritePx: sprites / on, additivePx: add / on });
