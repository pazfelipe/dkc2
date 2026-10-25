// The split output must recompose to exactly the PPU's frame: bg + additive (clamped), or opaque obj.
//   npx tsx test/hd_split_check.ts <state> [frames]
import { readFileSync } from "node:fs";
import { makeMachine, STATES_DIR } from "./lib/oracle.ts";
import { frame } from "../src/game/machine.ts";
const [st = "map_w1", n = "30"] = process.argv.slice(2);
const { hw } = await makeMachine();
hw.loadState(new Uint8Array(readFileSync(`${STATES_DIR}/${st}.state`)));
const ex = hw.ex as any;
ex.hw_hd_split(1);
const c8 = (v: number) => (v << 3) | (v >> 2);
let bad = 0, total = 0;
for (let f = 0; f < +n; f++) {
  frame(0);
  const br = ex.hw_brightness();
  if (br === 0) continue;
  const bg = new Uint16Array(hw.mem, ex.hw_hd_bg(), 256 * 224), ob = new Uint16Array(hw.mem, ex.hw_hd_obj(), 256 * 224);
  const ad = new Uint16Array(hw.mem, ex.hw_hd_add(), 256 * 224), fr = hw.frameRGBA();
  for (let i = 0; i < bg.length; i++) {
    const v = ob[i] & 0x8000 ? ob[i] : bg[i], a = ad[i] & 0x8000 ? ad[i] : 0;
    const ch = [0, 5, 10].map((s) => Math.min(31, ((v >> s) & 31) + ((a >> s) & 31)));
    const exp = ch.map((x) => ((c8(x) * br) / 15) | 0);
    total++;
    if (exp[0] !== fr[i * 4] || exp[1] !== fr[i * 4 + 1] || exp[2] !== fr[i * 4 + 2]) bad++;
  }
}
console.log(`${st}: ${bad} of ${total} pixels differ`);
