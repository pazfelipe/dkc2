/**
 * Frame-level differential test: the original game on the reference CPU vs the TypeScript driver
 * (port + hybrid fallback), from power-on or from a saved state, with the same inputs.
 *
 *   npx tsx test/frames.ts [--from <state>] [--frames N] [--input script] [--png dir]
 */
import { readFileSync, mkdirSync } from "node:fs";
import { makeMachine, snap, diffSnaps, fmtDiff, STATES_DIR, L } from "./lib/oracle.ts";
import { parseInput } from "./lib/input.ts";
import { boot, frame } from "../src/game/machine.ts";
import { reg } from "../src/core/cpu.ts";
import { fallbackStats } from "../src/core/hybrid.ts";
import { labelAt } from "../src/core/sym.ts";
import { savePng } from "./png.ts";

const args = process.argv.slice(2);
const opt = (n: string, d?: string) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : d;
};
const from = opt("--from");
const frames = parseInt(opt("--frames", "300")!);
const input = parseInput(opt("--input", "")!);
const png = opt("--png");
const { hw } = await makeMachine();

const start = from ? new Uint8Array(readFileSync(`${STATES_DIR}/${from}.state`)) : hw.saveState();
// reference run
hw.loadState(start);
const ref: (ReturnType<typeof snap> | null)[] = [];
// the original is "stable" at the end of a frame when its CPU idles in the WAI loop
const IDLE = new Set([L("CODE_808636_CODE_808640") + 0x12, L("CODE_808636_CODE_808640") + 0x13, L("wait_for_next_nmi_wait_for_interrupt"), L("wait_for_next_nmi_wait_for_interrupt") + 1, 0x808d1c, 0x808d1d]); // last two: Kong family screens
const refFrames: Uint8Array[] = [];
for (let f = 0; f < frames; f++) {
  hw.setInput(0, input(f));
  // one reference frame = up to the next start of vblank, the same unit the port's lag logic counts
  (hw.ex as any).hw_emu_run_vblank();
  const pc = (hw.ex as any).hw_cpu_live_reg(4);
  ref.push(IDLE.has(pc) ? snap(hw) : null);
  if (png) refFrames.push(hw.frameRGBA().slice() as unknown as Uint8Array);
}
// port run
hw.loadState(start);
reg.db = (hw.ex as any).hw_cpu_live_reg(5); // the CPU's data bank at the moment of the snapshot
if (!from) boot();
let firstBad = -1;
for (let f = 0; f < frames; f++) {
  const ran = frame(input(f));
  if (!ran && args.includes("--lag")) console.log(`port skipped frame ${f} (lag)`);
  if (!ref[f] && args.includes("--lag")) console.log(`ref unstable at frame ${f}`);
  const rf = ref[f];
  if (!rf) continue; // original was mid-logic (lag frame): not comparable
  const d = diffSnaps(rf, snap(hw));
  if (d.hard.length && firstBad < 0) {
    firstBad = f;
    console.log(`first divergence at frame ${f}:`);
    for (const x of d.hard.slice(0, parseInt(opt("--show", "20")!))) console.log("  " + fmtDiff(x));
  }
  if (png && f % 30 === 0) {
    mkdirSync(png, { recursive: true });
    savePng(`${png}/port_${String(f).padStart(5, "0")}.png`, hw.frameRGBA(), 256, 224);
    savePng(`${png}/ref_${String(f).padStart(5, "0")}.png`, refFrames[f], 256, 224);
  }
}
console.log(firstBad < 0 ? `all ${frames} frames identical` : `diverged at frame ${firstBad}`);
const top = [...fallbackStats.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
console.log("fallback calls:", top.map(([a, n]) => `${labelAt(a)}:${n}`).join(" "));
