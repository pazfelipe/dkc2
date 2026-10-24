/**
 * Differential testing against the ORIGINAL game code running on the reference 65816
 * (LakeSnes CPU compiled into the same wasm module as the hardware layer).
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Hardware } from "../../src/platform/hw.ts";
import { bindMachine } from "../../src/core/mem.ts";
import { L, labelAt } from "../../src/core/sym.ts";

export const ROM_PATH = process.env.DKC2_ROM ?? "/home/claude/dkc2/Donkey Kong Country 2 - Diddy's Kong Quest (USA) (En,Fr) (Rev 1).sfc";
export const STATES_DIR = new URL("../states/", import.meta.url).pathname;

export interface Regs {
  a: number;
  x: number;
  y: number;
  db: number;
  dp: number;
  sp: number;
  pc: number;
  /** bit0 C, bit1 Z, bit2 N, bit3 V, bit4 M(8-bit A), bit5 X(8-bit index) */
  p: number;
}

export interface Ex {
  hw_cpu_call(target: number, kind: number, a: number, x: number, y: number, db: number, dp: number, flags: number, sp: number, maxOps: number): number;
  hw_cpu_reg(which: number): number;
  hw_cpu_clear_stops(): void;
  hw_cpu_add_stop(a: number): void;
  hw_emu_run_until(target: number, maxFrames: number): number;
}

export async function makeMachine(): Promise<{ hw: Hardware; rom: Uint8Array; ex: Ex }> {
  const rom = new Uint8Array(readFileSync(ROM_PATH));
  const wasm = readFileSync(new URL("../../public/hw.wasm", import.meta.url));
  const hw = await Hardware.create(wasm, rom);
  // the reference CPU runs 8x faster than a real SNES so the original never has lag frames
  // (the port does all logic instantly, so lag frames would make frames misalign)
  (hw.ex as any).hw_set_overclock(parseInt(process.env.DKC2_OVERCLOCK ?? "6"));
  // and the sound CPU answers handshakes almost instantly, so sample uploads cause no lag windows
  (hw.ex as any).hw_set_apu_speed(parseFloat(process.env.DKC2_APU_SPEED ?? "64"));
  hw.saveState(); // pre-allocate state buffer so wasm memory does not grow later
  hw.refreshViews();
  bindMachine(hw, rom);
  return { hw, rom, ex: hw.ex as unknown as Ex };
}

/** Live CPU registers (e.g. right after hw_emu_run_until stopped at a routine entry). */
export function cpuLiveRegs(ex: Ex): Regs {
  const r = (i: number) => (ex as any).hw_cpu_live_reg(i);
  return { a: r(0), x: r(1), y: r(2), sp: r(3), pc: r(4), db: r(5), dp: r(6), p: r(7) };
}
/** Registers at the end of the last hw_cpu_call. */
export function cpuRegs(ex: Ex): Regs {
  return { a: ex.hw_cpu_reg(0), x: ex.hw_cpu_reg(1), y: ex.hw_cpu_reg(2), sp: ex.hw_cpu_reg(3), pc: ex.hw_cpu_reg(4), db: ex.hw_cpu_reg(5), dp: ex.hw_cpu_reg(6), p: ex.hw_cpu_reg(7) };
}

/** A captured call: full machine state at routine entry + CPU registers at that moment. */
export interface Vector {
  label: string;
  state: Uint8Array;
  regs: Regs;
}

export function saveVector(v: Vector, dir = STATES_DIR) {
  const d = join(dir, "vectors", v.label);
  mkdirSync(d, { recursive: true });
  const n = readdirSync(d).filter((f) => f.endsWith(".state")).length;
  writeFileSync(join(d, `${n}.state`), v.state);
  writeFileSync(join(d, `${n}.json`), JSON.stringify(v.regs));
}

export function loadVectors(label: string, dir = STATES_DIR): Vector[] {
  const d = join(dir, "vectors", label);
  if (!existsSync(d)) return [];
  return readdirSync(d)
    .filter((f) => f.endsWith(".state"))
    .sort((a, b) => parseInt(a) - parseInt(b))
    .map((f) => ({ label, state: new Uint8Array(readFileSync(join(d, f))), regs: JSON.parse(readFileSync(join(d, f.replace(".state", ".json")), "utf8")) }));
}

/** Execute the original routine at `addr` from the current machine state with the given registers. */
export function refCall(ex: Ex, addr: number, regs: Regs, kind: "jsr" | "jsl", stops: number[] = [], maxOps = 2_000_000): { ops: number; regs: Regs } {
  ex.hw_cpu_clear_stops();
  for (const s of stops) ex.hw_cpu_add_stop(s);
  const flags = ((regs.p >> 4) & 1) | (((regs.p >> 5) & 1) << 1) | ((regs.p & 1) << 2);
  // leave room below the real stack pointer so the caller's frame is not clobbered
  (ex as any).hw_traps_enable(0); // the reference must run purely original code
  const ops = ex.hw_cpu_call(addr, kind === "jsl" ? 1 : 0, regs.a, regs.x, regs.y, regs.db, regs.dp, flags, regs.sp, maxOps);
  return { ops, regs: cpuRegs(ex) };
}

export interface Snap {
  wram: Uint8Array;
  vram: Uint16Array;
  cgram: Uint16Array;
  oam: Uint16Array;
  sram: Uint8Array;
}
export function snap(hw: Hardware): Snap {
  return { wram: hw.wram.slice(), vram: hw.vram().slice(), cgram: hw.cgram().slice(), oam: hw.oam().slice(), sram: hw.sram().slice() };
}

const IGNORE_WRAM: [number, number][] = [
  [0x0100, 0x0200], // stack
];
/** Direct-page scratch: reported but not counted as failures. */
export function isScratch(a: number): boolean {
  return a < 0x100;
}

export interface Diff {
  where: string;
  addr: number;
  ref: number;
  port: number;
}
export function diffSnaps(ref: Snap, port: Snap, limit = 64): { hard: Diff[]; soft: Diff[] } {
  const hard: Diff[] = [];
  const soft: Diff[] = [];
  for (let i = 0; i < ref.wram.length; i++) {
    if (ref.wram[i] === port.wram[i]) continue;
    if (IGNORE_WRAM.some(([s, e]) => i >= s && i < e)) continue;
    const d = { where: "wram", addr: i, ref: ref.wram[i], port: port.wram[i] };
    (isScratch(i) ? soft : hard).push(d);
  }
  const cmp = (name: string, a: ArrayLike<number>, b: ArrayLike<number>) => {
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) hard.push({ where: name, addr: i, ref: a[i], port: b[i] });
  };
  cmp("vram", ref.vram, port.vram);
  cmp("cgram", ref.cgram, port.cgram);
  cmp("oam", ref.oam, port.oam);
  cmp("sram", ref.sram, port.sram);
  return { hard: hard.slice(0, limit), soft: soft.slice(0, limit) };
}

export function fmtDiff(d: Diff): string {
  const w = d.where === "wram" ? 2 : 4;
  return `${d.where}[$${d.addr.toString(16).toUpperCase().padStart(4, "0")}] ref=${d.ref.toString(16).padStart(w, "0")} port=${d.port.toString(16).padStart(w, "0")}`;
}

export { L, labelAt };
