/**
 * Build test states for every world-1 level/sub-level by redirecting the door of K. Rool's cabin
 * (at the start of Pirate Panic) to the wanted level: the door takes the destination from the
 * current level config in WRAM (level.destinations), so the original game loads that level.
 *   npx tsx test/make_level_states.ts [name ...]
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { makeMachine, STATES_DIR } from "./lib/oracle.ts";
import { PAD } from "../src/platform/hw.ts";
import { r16, w16 } from "../src/core/mem.ts";
import { savePng } from "./png.ts";

const LEVELS: Record<string, number> = {
  mainbrace: 0x0c, galley: 0x04, lockjaw: 0x15, topsail: 0x0b, krow: 0x09,
  cabin: 0x1b, pp_bonus1: 0x6f, pp_bonus2: 0x70, pp_warp: 0x1d,
  mm_bonus1: 0x78, mm_bonus2: 0x79, mm_bonus3: 0x7d, mm_warp: 0x20,
  gg_bonus1: 0xa8, gg_bonus2: 0x71, lj_bonus1: 0x81, lj_warp: 0x68,
  tt_bonus1: 0x7b, tt_bonus2: 0x7c, tt_warp: 0x1a,
};
const want = process.argv.slice(2);
const { hw } = await makeMachine();
mkdirSync("out/levels", { recursive: true });
const base = new Uint8Array(readFileSync(`${STATES_DIR}/pirate_walk.state`));
const run = (n: number, pad = 0) => { for (let i = 0; i < n; i++) { hw.setInput(0, pad); hw.emuRunFrame(); } };
for (const [name, lvl] of Object.entries(LEVELS)) {
  if (want.length && !want.includes(name)) continue;
  hw.loadState(base);
  for (let s = 0; s < 8; s++) w16(0x053d + s * 2, lvl); // level.destinations
  // walk left into the cabin door until the level number changes, then let the new level start
  let f = 0;
  while (r16(0xd3) === 0x03 && f < 600) { run(1, f < 120 ? PAD.LEFT : (f % 20 < 10 ? PAD.UP : 0)); f++; }
  let g = 0;
  // wait for Diddy to exist and gameplay to run
  while (g < 900 && !(r16(0x0de2) === 0xe4 && r16(0x24) === 0x8819)) { run(1); g++; }
  run(90);
  const ok = r16(0xd3) === lvl;
  writeFileSync(`${STATES_DIR}/lvl_${name}.state`, hw.saveState());
  savePng(`out/levels/${name}.png`, hw.frameRGBA(), 256, 224);
  console.log(name, ok ? "ok" : "FAILED", "level", r16(0xd3).toString(16), "frames", f + g + 90);
}
