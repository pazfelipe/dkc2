import { readFileSync, readdirSync } from "node:fs";
import { makeMachine, STATES_DIR } from "./lib/oracle.ts";
import { frame } from "../src/game/machine.ts";
import { fallbackStats } from "../src/core/hybrid.ts";
import { labelAt } from "../src/core/sym.ts";
import { portedNames } from "../src/core/cpu.ts";
const { hw } = await makeMachine();
const all = new Map<string, Set<string>>();
const failed: string[] = [];
const states = readdirSync(STATES_DIR).filter((f) => /^(lvl_|map_|world_map|title|file_select|player_select|b8)/.test(f)).map((f) => f.replace(".state", ""));
for (const st of states) {
  hw.loadState(new Uint8Array(readFileSync(`${STATES_DIR}/${st}.state`)));
  fallbackStats.clear();
  try {
    for (let f = 0; f < 240; f++) frame(f % 60 < 40 ? 0x80 : f % 60 < 45 ? 0x100 : 0x80 | 0x2);
  } catch (e) { failed.push(`${st}: ${(e as Error).message}`); }
  for (const a of fallbackStats.keys()) {
    const n = labelAt(a) ?? a.toString(16);
    if (!all.has(n)) all.set(n, new Set());
    all.get(n)!.add(st);
  }
}
console.log("states", states.length, "ported", portedNames().length, "distinct original routines still called:", all.size);
console.log("failed:", failed);
const top = [...all.entries()].sort((a, b) => b[1].size - a[1].size);
for (const [n, s] of top) console.log(s.size.toString().padStart(3), n);
