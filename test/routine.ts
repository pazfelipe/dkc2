/**
 * Routine-level differential test.
 *
 *   npx tsx test/routine.ts capture <label> [--from <state>] [--count N] [--skip K] [--frames F] [--input <script>]
 *       Runs the ORIGINAL game from a base state until the CPU enters <label>, saving
 *       (full machine state + registers) as test vectors in test/states/vectors/<label>/.
 *
 *   npx tsx test/routine.ts test <label> [--jsr|--jsl] [--stop <label>,...] [-v]
 *       For every captured vector: run the original routine on the reference CPU, run the
 *       ported routine, and diff WRAM/VRAM/CGRAM/OAM/SRAM + returned registers.
 */
import { readFileSync } from "node:fs";
import { makeMachine, saveVector, loadVectors, refCall, snap, diffSnaps, fmtDiff, cpuRegs, cpuLiveRegs, L, STATES_DIR, type Regs } from "./lib/oracle.ts";
import { reg, routineByName } from "../src/core/cpu.ts";
import { parseInput } from "./lib/input.ts";
import "../src/game/index.ts";
import { enableTraps } from "../src/core/hybrid.ts";

const [cmd, label, ...rest] = process.argv.slice(2);
const opt = (name: string, def?: string) => {
  const i = rest.indexOf(name);
  return i >= 0 ? rest[i + 1] : def;
};
const flag = (name: string) => rest.includes(name);

const { hw, ex } = await makeMachine();

if (cmd === "capture") {
  const from = opt("--from", "pirate_start");
  const count = parseInt(opt("--count", "8")!);
  const skip = parseInt(opt("--skip", "37")!);
  const maxFrames = parseInt(opt("--frames", "600")!);
  hw.loadState(new Uint8Array(readFileSync(`${STATES_DIR}/${from}.state`)));
  const input = parseInput(opt("--input", "")!);
  const target = L(label);
  let got = 0;
  let hits = 0;
  let frames = 0;
  while (got < count && frames < maxFrames) {
    hw.setInput(0, input(frames));
    const hit = ex.hw_emu_run_until(target, 1);
    if (!hit) {
      frames++;
      continue;
    }
    if (hits++ % skip === 0) {
      saveVector({ label, state: hw.saveState(), regs: cpuLiveRegs(ex) });
      got++;
    }
    // step past the entry so we do not re-hit the same instruction
    (ex as any).hw_cpu_step();
  }
  console.log(`captured ${got} vectors for ${label} (${hits} hits, ${frames} frames)`);
} else if (cmd === "test") {
  const vectors = loadVectors(label);
  if (!vectors.length) throw new Error(`no vectors for ${label}; run capture first`);
  const fn = routineByName(label);
  if (!fn) throw new Error(`routine ${label} is not ported/registered`);
  const kind = flag("--jsr") ? "jsr" : "jsl";
  const stops = (opt("--stop", "") || "").split(",").filter(Boolean).map((s) => L(s));
  let pass = 0;
  for (const [i, v] of vectors.entries()) {
    hw.loadState(v.state);
    const r = refCall(ex, L(label), v.regs, kind, stops);
    if (r.ops < 0) {
      console.log(`#${i}: reference did not return (timeout)`);
      continue;
    }
    const refSnap = snap(hw);
    const refRegs = r.regs;
    hw.loadState(v.state);
    hw.refreshViews();
    enableTraps(true); // the port may call original routines, which may call back into ports
    setRegs(v.regs);
    let err: unknown = null;
    try {
      fn();
    } catch (e) {
      err = e;
    }
    const portSnap = snap(hw);
    const d = diffSnaps(refSnap, portSnap);
    const regDiff = compareRegs(refRegs, v.regs);
    const ok = !err && d.hard.length === 0 && !regDiff;
    if (ok) pass++;
    if (!ok || flag("-v")) {
      console.log(`#${i}: ${ok ? "PASS" : "FAIL"} ops=${r.ops}${err ? " ERROR " + (err as Error).message : ""}`);
      for (const x of d.hard.slice(0, 24)) console.log("   " + fmtDiff(x));
      if (flag("-v")) for (const x of d.soft.slice(0, 16)) console.log("   (dp) " + fmtDiff(x));
      if (regDiff) console.log("   regs: " + regDiff);
    }
  }
  console.log(`${label}: ${pass}/${vectors.length} vectors match`);
  process.exitCode = pass === vectors.length ? 0 : 1;
}

function setRegs(r: Regs) {
  reg.a = r.a;
  reg.x = r.x;
  reg.y = r.y;
  reg.c = !!(r.p & 1);
  reg.z = !!(r.p & 2);
  reg.n = !!(r.p & 4);
  reg.db = r.db;
  reg.mx = -1;
}

/** Only compare registers the port claims to return: carry always, A/X/Y when --ret given. */
function compareRegs(ref: Regs, _in: Regs): string | null {
  const want = (opt("--ret", "") || "").split(",");
  const out: string[] = [];
  if (want.includes("c") && !!(ref.p & 1) !== reg.c) out.push(`C ref=${ref.p & 1} port=${+reg.c}`);
  const m8 = !!(ref.p & 0x10);
  if (want.includes("a") && (m8 ? (ref.a & 0xff) !== (reg.a & 0xff) : ref.a !== (reg.a & 0xffff))) out.push(`A ref=${ref.a.toString(16)} port=${reg.a.toString(16)}`);
  if (want.includes("x") && ref.x !== (reg.x & 0xffff)) out.push(`X ref=${ref.x.toString(16)} port=${reg.x.toString(16)}`);
  if (want.includes("y") && ref.y !== (reg.y & 0xffff)) out.push(`Y ref=${ref.y.toString(16)} port=${reg.y.toString(16)}`);
  return out.length ? out.join(" ") : null;
}
