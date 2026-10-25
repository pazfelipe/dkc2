/**
 * Build a test state for EVERY level of the game (all worlds, bonus rooms, NPC screens), entering
 * it the way the world map does (same technique as make_level_states.ts): press START on the
 * world-1 map, stop the ORIGINAL code where it stores the selected level, substitute the wanted
 * level and let the game load it. States are named all_<level constant name>.
 *   npx tsx test/make_all_states.ts [filter-substring]
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { makeMachine, STATES_DIR, L } from "./lib/oracle.ts";
import { PAD } from "../src/platform/hw.ts";
import { r16 } from "../src/core/mem.ts";
import * as C from "../src/gen/constants.ts";

const consts = (C as any).C ?? (C as any).default ?? C;
const levels: [string, number][] = Object.entries(consts as Record<string, number>)
  .filter(([k, v]) => k.startsWith("level_") && typeof v === "number" && !/^level_(layout|goal|\d)/.test(k))
  // NPC screens and world maps are not entered this way (they need their own path from the map)
  .filter(([k]) => !/(kiosk|funkys|kong_kollege|monkey_museum|swankys|crankys|wrinkly|^level_(gangplank_galleon|crocodile_cauldron|krem_quay|krazy_kremland|gloomy_gulch|krools_keep|lost_world|the_flying_krock)$)/.test(k))
  .map(([k, v]) => [k.slice(6), v]);
const filter = process.argv[2];
const { hw, ex } = await makeMachine();
const e = ex as any;
const base = new Uint8Array(readFileSync(`${STATES_DIR}/map_w1.state`));
const STORE = L("CODE_B48AEF") + 0x0e; // STA level_number
let ok = 0, bad = 0;
for (const [name, lvl] of levels) {
  if (filter && !name.includes(filter)) continue;
  if (existsSync(`${STATES_DIR}/all_${name}.state`)) continue;
  hw.loadState(base);
  let hit = false;
  for (let f = 0; f < 300 && !hit; f++) {
    hw.setInput(0, f % 20 < 4 ? PAD.START : 0);
    hit = !!e.hw_emu_run_until(STORE, 1);
  }
  if (!hit) { console.log(name, "map never entered a level"); bad++; continue; }
  e.hw_cpu_set_live_reg(0, lvl);
  // wait until the level (or screen) runs: the level number is set and a gameplay mode is active
  let g = 0;
  while (g < 1800 && !(r16(0xd3) === lvl && (r16(0x24) === 0x8819 || g > 900))) { hw.setInput(0, 0); hw.emuRunFrame(); g++; }
  for (let i = 0; i < 120; i++) { hw.setInput(0, 0); hw.emuRunFrame(); }
  const fine = r16(0xd3) === lvl;
  writeFileSync(`${STATES_DIR}/all_${name}.state`, hw.saveState());
  console.log(name.padEnd(48), lvl.toString(16).padStart(2), fine ? "ok" : "CHECK", "mode", r16(0x24).toString(16), "frames", g + 120);
  fine ? ok++ : bad++;
}
console.log({ ok, bad });
