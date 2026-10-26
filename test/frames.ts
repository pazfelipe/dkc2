/**
 * Frame-level differential test: the original game on the reference CPU vs the TypeScript driver
 * (port + hybrid fallback), from power-on or from a saved state, with the same inputs.
 *
 *   npx tsx test/frames.ts [--from <state>] [--frames N] [--input script] [--png dir] [--norom]
 *
 * --norom: the port runs on its own machine whose cartridge is the data-only image built from
 * assets/ (no code bytes), with the original-code fallback off and the ROM-free guard on; the
 * reference still runs the real ROM. Reports every read of a code byte.
 *
 * One known difference is masked in both modes: the anti-piracy accumulator word $0AB2 while its
 * checksum window runs (see CODE_B5ED70 in src/game/b5/b5c_camera.ts: the port, which runs
 * without the original code, does not add it up; it stores the genuine total when the window ends).
 */
import { readFileSync, mkdirSync } from "node:fs";
import { makeMachine, makeNoRomMachine, bindNoRom, snap, diffSnaps, fmtDiff, STATES_DIR, L } from "./lib/oracle.ts";
import { parseInput } from "./lib/input.ts";
import { boot, frame } from "../src/game/machine.ts";
import { reg } from "../src/core/cpu.ts";
import { fallbackStats, setFallbackEnabled } from "../src/core/hybrid.ts";
import { guardHits } from "../src/core/mem.ts";
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
const norom = args.includes("--norom");
const { hw } = await makeMachine();
const portM = norom ? await makeNoRomMachine(false) : null;

const start = from ? new Uint8Array(readFileSync(`${STATES_DIR}/${from}.state`)) : hw.saveState();
// reference run
hw.loadState(start);
const ref: (ReturnType<typeof snap> | null)[] = [];
// the original is "stable" at the end of a frame when its CPU idles in the WAI loop
const IDLE = new Set([L("CODE_808636_CODE_808640") + 0x12, L("CODE_808636_CODE_808640") + 0x13, L("wait_for_next_nmi_wait_for_interrupt"), L("wait_for_next_nmi_wait_for_interrupt") + 1, 0x808d1c, 0x808d1d, 0xb5d447, 0xb5d448]); // + Kong family screens, world map
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
const phw = portM ? portM.hw : hw;
if (portM) {
  bindNoRom(portM.hw, portM.image, portM.code);
  setFallbackEnabled(false);
}
phw.loadState(start);
if (portM) phw.ex.hw_guard_reset();
reg.db = (phw.ex as any).hw_cpu_live_reg(5); // the CPU's data bank at the moment of the snapshot
if (!from) boot();
let firstBad = -1;
let masked = 0;
for (let f = 0; f < frames; f++) {
  const ran = frame(input(f));
  if (!ran && args.includes("--lag")) console.log(`port skipped frame ${f} (lag)`);
  if (!ref[f] && args.includes("--lag")) console.log(`ref unstable at frame ${f}`);
  const rf = ref[f];
  if (!rf) continue; // original was mid-logic (lag frame): not comparable
  const ps = snap(phw);
  if (!(ps.wram[0x0a91] & 0x80) && (ps.wram[0x0ab2] !== rf.wram[0x0ab2] || ps.wram[0x0ab3] !== rf.wram[0x0ab3])) {
    // anti-piracy checksum window: the port does not add up the original code (counted, reported)
    masked++;
    ps.wram[0x0ab2] = rf.wram[0x0ab2];
    ps.wram[0x0ab3] = rf.wram[0x0ab3];
  }
  const d = diffSnaps(rf, ps);
  if (d.hard.length && firstBad < 0) {
    firstBad = f;
    console.log(`first divergence at frame ${f}:`);
    for (const x of d.hard.slice(0, parseInt(opt("--show", "20")!))) console.log("  " + fmtDiff(x));
  }
  if (png && f % 30 === 0) {
    mkdirSync(png, { recursive: true });
    savePng(`${png}/port_${String(f).padStart(5, "0")}.png`, phw.frameRGBA(), 256, 224);
    savePng(`${png}/ref_${String(f).padStart(5, "0")}.png`, refFrames[f], 256, 224);
  }
}
console.log(firstBad < 0 ? `all ${frames} frames identical` : `diverged at frame ${firstBad}`);
const top = [...fallbackStats.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
console.log("fallback calls:", top.map(([a, n]) => `${labelAt(a)}:${n}`).join(" "));
console.log(`frames with the anti-piracy accumulator $0AB2 masked: ${masked}`);
if (portM) {
  const g = phw.guardReads();
  const ts = [...guardHits.keys()].map((o) => "$" + o.toString(16));
  console.log(`no-ROM: code-byte reads by the port ${guardHits.size}${ts.length ? " " + ts.slice(0, 10).join(" ") : ""}, by the hardware ${g.count}`);
}
