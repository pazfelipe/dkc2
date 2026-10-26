/**
 * Where does the ORIGINAL game read its own code as data? Runs the original (real ROM, reference
 * CPU) from every matching state and records every non-fetch read of a code byte (CPU data
 * reads, DMA/HDMA sources), using the ROM-free guard in data-only mode. Each address found is a
 * place where the port must not read the ROM (it has no code bytes) and must use a constant or
 * the known outcome instead; test/norom_scan.ts checks the port side.
 *
 *   npx tsx test/ref_code_reads.ts <state-regex> [frames] [part/parts]
 */
import { readFileSync, readdirSync } from "node:fs";
import { makeMachine, STATES_DIR } from "./lib/oracle.ts";
import { readManifest, codeMap } from "../tools/lib/assets.ts";
import { labelAt } from "../src/core/sym.ts";

const [re = ".", n = "300", part = "0/1"] = process.argv.slice(2);
const [pi, pn] = part.split("/").map(Number);
const { hw } = await makeMachine();
const ex = hw.ex as any;
const code = codeMap(readManifest());
hw.setCodeGuard(code);
ex.hw_guard_data_only(1);
hw.saveState();
hw.refreshViews();
const snes = (o: number) => ((o & 0xffff) >= 0x8000 ? 0x800000 : 0xc00000) + o;
const states = readdirSync(STATES_DIR)
  .filter((f) => f.endsWith(".state") && new RegExp(re).test(f))
  .map((f) => f.replace(".state", ""))
  .sort()
  .filter((_, i) => i % pn === pi);
const seen = new Set<number>();
for (const st of states) {
  hw.loadState(new Uint8Array(readFileSync(`${STATES_DIR}/${st}.state`)));
  const map = new Uint8Array(hw.mem, ex.hw_guard_hitmap(), 0x80000);
  map.fill(0);
  for (let f = 0; f < +n; f++) {
    hw.setInput(0, f % 60 < 40 ? 0x80 : f % 60 < 45 ? 0x100 : 0x82);
    ex.hw_emu_run_vblank();
  }
  const hits: number[] = [];
  const m = new Uint8Array(hw.mem, ex.hw_guard_hitmap(), 0x80000);
  for (let i = 0; i < m.length; i++) if (m[i]) for (let b = 0; b < 8; b++) if (m[i] & (1 << b)) hits.push(i * 8 + b);
  const fresh = hits.filter((h) => !seen.has(h));
  hits.forEach((h) => seen.add(h));
  console.log(JSON.stringify({ st, reads: hits.length, new: fresh.map((o) => "$" + snes(o).toString(16).toUpperCase()) }));
}
const all = [...seen].sort((a, b) => a - b);
console.log(`states ${states.length}, distinct code bytes read as data by the original: ${all.length}`);
console.log(all.map((o) => `$${snes(o).toString(16).toUpperCase()}${labelAt(snes(o)) ? " " + labelAt(snes(o)) : ""}`).join("\n"));
