/**
 * Which ORIGINAL routines still run? Loads each state, plays N frames through the port and collects
 * the fallback statistics.   npx tsx test/fallback_scan.ts <state-regex> [frames] [part/parts]
 */
import { readFileSync, readdirSync } from "node:fs";
import { makeMachine, STATES_DIR } from "./lib/oracle.ts";
import { frame } from "../src/game/machine.ts";
import { fallbackStats } from "../src/core/hybrid.ts";
import { labelAt } from "../src/core/sym.ts";
const [re = ".", n = "300", part = "0/1"] = process.argv.slice(2);
const [pi, pn] = part.split("/").map(Number);
const { hw } = await makeMachine();
const states = readdirSync(STATES_DIR).filter((f) => f.endsWith(".state") && new RegExp(re).test(f)).map((f) => f.replace(".state", "")).filter((_, i) => i % pn === pi);
for (const st of states) {
  hw.loadState(new Uint8Array(readFileSync(`${STATES_DIR}/${st}.state`)));
  fallbackStats.clear();
  let err = "";
  try {
    for (let f = 0; f < +n; f++) frame(f % 60 < 40 ? 0x80 : f % 60 < 45 ? 0x100 : 0x82);
  } catch (e) { err = (e as Error).message.slice(0, 120); }
  const names = [...fallbackStats.keys()].map((a) => labelAt(a) ?? a.toString(16));
  console.log(JSON.stringify({ st, names, err }));
}
