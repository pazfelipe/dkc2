import { readFileSync } from "node:fs";
import { makeMachine, STATES_DIR, L } from "../../test/lib/oracle.ts";
import { parseInput } from "../../test/lib/input.ts";
import { labelAt } from "../../src/core/sym.ts";
const input = parseInput("R*60,R+Y*40,B*10,_*20,R*30,R+B*20,R*40,Y*5,R*30,D*10,R+Y*60,B*15,_*30,L*40");
const { hw } = await makeMachine();
const ex = hw.ex as any;
const [st, F0, from, to] = [process.argv[2], +process.argv[3], process.argv[4], process.argv[5]];
hw.loadState(new Uint8Array(readFileSync(`${STATES_DIR}/${st}.state`)));
for (let f = 0; f < F0; f++) { hw.setInput(0, input(f)); hw.emuRunFrame(); }
hw.setInput(0, input(F0));
ex.hw_emu_run_until(L(from), 8);
if (process.env.OC0) ex.hw_set_overclock(0);
console.log("X at start", ex.hw_cpu_live_reg(1).toString(16));
const t = () => (ex.hw_frames() * 262 + ex.hw_vpos()) * 1364 + ex.hw_hpos();
const target = L(to);
const big = new Map<string, number>();
const perPc = new Map<number, number>();
const fromA = L(from); let hits = 0;
const watch = (process.env.W ?? '').split(',').filter(Boolean).map((n) => L(n)); const wh = new Map<number, number>();
let t0 = t(), total = 0;
for (let i = 0; i < 5_000_000; i++) {
  const pc = ex.hw_cpu_live_reg(4);
  if (pc === target || (pc ^ target) === 0x800000) break;
  if (pc === fromA || (pc ^ fromA) === 0x800000) hits++;
  for (const w of watch) if (pc === w || (pc ^ w) === 0x800000) wh.set(w, (wh.get(w) ?? 0) + 1);
  const a = t();
  ex.hw_cpu_step();
  const d = t() - a;
  total += d;
  perPc.set(pc, (perPc.get(pc) ?? 0) + d);
  if (d > 200) { const k = labelAt(pc) ?? pc.toString(16); big.set(k, (big.get(k) ?? 0) + d); }
}
console.log("hits of", from, hits, [...wh.entries()].map(([a, n]) => `${labelAt(a)}:${n}`).join(" "));
console.log("total", total, "master cycles =", (total / 1364).toFixed(1), "lines");
import("node:fs").then((fs) => fs.writeFileSync("/tmp/claude-0/perpc.json", JSON.stringify([...perPc.entries()])));
console.log([...big.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15));
