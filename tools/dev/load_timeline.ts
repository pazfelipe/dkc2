// Where does a ported load run faster than the original? First-entry times of ported routines (port vs ref).
import { readFileSync } from "node:fs";
import { makeMachine, STATES_DIR, L } from "../../test/lib/oracle.ts";
import { parseInput } from "../../test/lib/input.ts";
import { frame } from "../../src/game/machine.ts";
import { reg, portedNames, routineByName, register } from "../../src/core/cpu.ts";
const input = parseInput("R*60,R+Y*40,B*10,_*20,R*30,R+B*20,R*40,Y*5,R*30,D*10,R+Y*60,B*15,_*30,L*40");
const { hw } = await makeMachine();
const ex = hw.ex as any;
const [st, F0] = [process.argv[2], +process.argv[3]];
const start = new Uint8Array(readFileSync(`${STATES_DIR}/${st}.state`));
const now = () => ex.hw_frames() * 262 + ex.hw_vpos();
let on = false, base = 0;
const seq: [string, number][] = [];
const seen = new Set<string>();
for (const n of portedNames()) {
  const fn = routineByName(n)!;
  register({ [n]: () => { if (on && seq.length < 150 && !seen.has(n)) { seen.add(n); seq.push([n, now() - base]); } fn(); } });
}
hw.loadState(start); reg.db = ex.hw_cpu_live_reg(5);
for (let f = 0; f < F0; f++) frame(input(f));
base = now(); on = true;
for (let f = F0; f < F0 + 8; f++) frame(input(f));
on = false;
hw.loadState(start);
for (let f = 0; f < F0; f++) { hw.setInput(0, input(f)); hw.emuRunFrame(); }
hw.setInput(0, input(F0));
const rbase = now();
let lastGap = 0;
for (const [n, pt] of seq) {
  const save = hw.saveState();
  const hit = ex.hw_emu_run_until(L(n), 8);
  const rt = hit ? now() - rbase : -1;
  const gap = hit ? rt - pt : NaN;
  if (process.env.ALL || !hit || Math.abs(gap - lastGap) >= 2) console.log(n.padEnd(40), "port", String(pt).padStart(5), "ref", String(rt).padStart(5), "gap", gap);
  if (hit) lastGap = gap;
  hw.loadState(save);
}
console.log("final gap", lastGap);
