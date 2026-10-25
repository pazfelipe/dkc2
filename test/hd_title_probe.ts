import { readFileSync } from "node:fs";
import { makeMachine, STATES_DIR, L } from "./lib/oracle.ts";
import { frame, frameHooks } from "../src/game/machine.ts";
import { r16 } from "../src/core/mem.ts";
const { hw } = await makeMachine();
hw.loadState(new Uint8Array(readFileSync(`${STATES_DIR}/title.state`)));
const ex = hw.ex as any;
ex.hw_hd_split(1);
let last = 0, changes = 0, title = 0, sprites = 0;
for (let f = 0; f < 400; f++) {
  frame(0);
  const isT = r16(0x20) === (L("run_title_screen") & 0xffff);
  const bg = new Uint16Array(hw.mem, ex.hw_hd_bg(), 256 * 224);
  const ob = new Uint16Array(hw.mem, ex.hw_hd_obj(), 256 * 224);
  let h = 2166136261;
  for (let i = 0; i < bg.length; i++) h = Math.imul(h ^ bg[i], 16777619);
  let n = 0; for (let i = 0; i < ob.length; i++) if (ob[i] & 0xc000) n++;
  if (isT) { title++; if (h !== last) changes++; sprites += n; }
  if (f % 50 === 0) console.log(f, isT, h >>> 0, n, ex.hw_brightness());
  last = h;
}
console.log({ title, changes, avgSpritePx: sprites / title });
