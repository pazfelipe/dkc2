/**
 * ROM-free proof: run the port on the data-only cartridge image (built from assets/, code bytes
 * zero) from every test state and record every read of an address where the original had code,
 * by the ported code (rom8/rom16/rom24/bus reads) and by the hardware (DMA sources, CPU fetches).
 * The fallback to original routines is off (there is no original code to run).
 *
 *   npx tsx test/norom_scan.ts <state-regex> [frames] [part/parts]
 *
 * Prints one JSON line per state: {st, ts: TS code reads, hw: hardware code reads, err}, and the
 * first callers of each TS hit. Input: the same walk/jump pattern as test/fallback_scan.ts.
 */
import { readFileSync, readdirSync } from "node:fs";
import { makeNoRomMachine, STATES_DIR } from "./lib/oracle.ts";
import { frame } from "../src/game/machine.ts";
import { setFallbackEnabled } from "../src/core/hybrid.ts";
import { guardHits } from "../src/core/mem.ts";
import { labelAt } from "../src/core/sym.ts";

const [re = ".", n = "300", part = "0/1"] = process.argv.slice(2);
const [pi, pn] = part.split("/").map(Number);
const { hw } = await makeNoRomMachine();
setFallbackEnabled(false);
const snes = (o: number) => ((o & 0xffff) >= 0x8000 ? 0x800000 : 0xc00000) + o;
const hex = (o: number) => "$" + snes(o).toString(16).toUpperCase();
const states = readdirSync(STATES_DIR)
  .filter((f) => f.endsWith(".state") && new RegExp(re).test(f))
  .map((f) => f.replace(".state", ""))
  .sort()
  .filter((_, i) => i % pn === pi);
const stacks = new Map<number, string>();
let total = 0;
for (const st of states) {
  hw.loadState(new Uint8Array(readFileSync(`${STATES_DIR}/${st}.state`)));
  guardHits.clear();
  hw.ex.hw_guard_reset();
  let err = "";
  try {
    for (let f = 0; f < +n; f++) frame(f % 60 < 40 ? 0x80 : f % 60 < 45 ? 0x100 : 0x82);
  } catch (e) {
    err = (e as Error).message.slice(0, 120);
  }
  const g = hw.guardReads();
  const ts = [...guardHits.keys()].map(hex);
  for (const [o, h] of guardHits) if (!stacks.has(o)) stacks.set(o, h.stack);
  total += guardHits.size + g.count;
  console.log(JSON.stringify({ st, ts, hw: g.count, hwAt: [...new Set(g.offsets)].slice(0, 8).map(hex), err }));
}
for (const [o, s] of stacks) console.log(`TS read of code byte ${hex(o)} (${labelAt(snes(o)) ?? ""}):\n${s}`);
console.log(`states ${states.length}, code-byte reads ${total}`);
