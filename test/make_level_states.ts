/**
 * Build test states for every world-1 level/sub-level, entering them the way the world map does:
 * press START on the map, stop the ORIGINAL code right where it stores the selected node's level
 * (CODE_B48AEF: `STA level_number`), substitute the wanted level, and let the game load it.
 *   npx tsx test/make_level_states.ts [name ...]
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { makeMachine, STATES_DIR, L } from "./lib/oracle.ts";
import { PAD } from "../src/platform/hw.ts";
import { r16 } from "../src/core/mem.ts";
import { savePng } from "./png.ts";

export const LEVELS: Record<string, number> = {
  pirate: 0x03, mainbrace: 0x0c, galley: 0x04, lockjaw: 0x15, topsail: 0x0b, krow: 0x09,
  cabin: 0x1b, pp_bonus1: 0x6f, pp_bonus2: 0x70, pp_warp: 0x1d,
  mm_bonus1: 0x78, mm_bonus2: 0x79, mm_bonus3: 0x7d, mm_warp: 0x20,
  gg_bonus1: 0xa8, gg_bonus2: 0x71, lj_bonus1: 0x81, lj_warp: 0x68,
  tt_bonus1: 0x7b, tt_bonus2: 0x7c, tt_warp: 0x1a,
  // world 2: Crocodile Cauldron
  hothead: 0x07, kannon: 0x25, lavalagoon: 0x14, redhot: 0x08, squawks: 0x24, kleever: 0x21,
  hh_bonus1: 0x75, hh_bonus2: 0x1c, hh_bonus3: 0x74, hh_warp: 0x8e,
  kk_bonus1: 0xab, kk_bonus2: 0xad, kk_bonus3: 0xaa, kk_warp: 0x27,
  ll_bonus1: 0x83, ll_warp: 0x69, rh_bonus1: 0x76, rh_bonus2: 0x77,
  ss_bonus1: 0xac, ss_bonus2: 0xba, ss_bonus3: 0xa9, ss_warp: 0x6a,
};
const want = process.argv.slice(2);
const { hw, ex } = await makeMachine();
const e = ex as any;
mkdirSync("out/levels", { recursive: true });
const base = new Uint8Array(readFileSync(`${STATES_DIR}/map_w1.state`));
const run = (n: number, pad = 0) => { for (let i = 0; i < n; i++) { hw.setInput(0, pad); hw.emuRunFrame(); } };
const STORE = L("CODE_B48AEF") + 0x0e; // STA level_number
for (const [name, lvl] of Object.entries(LEVELS)) {
  if (want.length && !want.includes(name)) continue;
  hw.loadState(base);
  let hit = false;
  for (let f = 0; f < 300 && !hit; f++) {
    hw.setInput(0, f % 20 < 4 ? PAD.START : 0);
    hit = !!e.hw_emu_run_until(STORE, 1);
  }
  if (!hit) { console.log(name, "map never entered a level"); continue; }
  e.hw_cpu_set_live_reg(0, lvl);
  let g = 0;
  while (g < 1500 && !(r16(0x0de2) === 0xe4 && r16(0x24) === 0x8819 && r16(0xd3) === lvl)) { run(1); g++; }
  run(120);
  const ok = r16(0xd3) === lvl && r16(0x24) === 0x8819;
  writeFileSync(`${STATES_DIR}/lvl_${name}.state`, hw.saveState());
  savePng(`out/levels/${name}.png`, hw.frameRGBA(), 256, 224);
  console.log(name, ok ? "ok" : "CHECK", "level", r16(0xd3).toString(16), "mode", r16(0x24).toString(16), "frames", g + 120);
}
