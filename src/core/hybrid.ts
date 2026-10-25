/**
 * Hybrid execution: every routine of the original game is reachable through a stub
 * (src/gen/routines.ts). If the routine has been ported to TypeScript (registered with
 * `register`), the port runs. Otherwise the ORIGINAL routine runs on the reference 65816
 * that lives in the hardware module, sharing the same WRAM/VRAM/registers.
 *
 * It also works in the other direction: while original code runs on the 65816, every entry
 * into a routine that has a TypeScript implementation traps back here, the port runs, and the
 * 65816 continues as if the routine had returned. So each ported routine takes effect
 * everywhere as soon as it is registered, and the game always stays playable.
 */
import { reg, implAt, onRegister, registeredAddrs } from "./cpu";
import { hw, r16 } from "./mem";
import { labelAt, R } from "./sym";

export const KIND_JSR = 0;
export const KIND_JSL = 1;
export const KIND_INT = 2;

/** How a routine leaves: RTS, RTL, back to the sprite handler (sprite mains), or unknown. */
export const RET_RTS = 0;
export const RET_RTL = 1;
export const RET_SPRITE = 2;

interface CpuEx {
  hw_cpu_call(target: number, kind: number, a: number, x: number, y: number, db: number, dp: number, flags: number, sp: number, maxOps: number): number;
  hw_cpu_resume(mode: number, a: number, x: number, y: number, flags: number, target: number, db: number, mx: number): number;
  hw_cpu_reg(which: number): number;
  hw_cpu_wai_hit(): number;
  hw_cpu_trap_addr(): number;
  hw_cpu_clear_stops(): void;
  hw_cpu_add_stop(a: number): void;
  hw_trap_set(a: number, on: number): void;
  hw_traps_enable(on: number): void;
}

/** Statistics: how often each original routine had to be executed by the fallback. */
export const fallbackStats = new Map<number, number>();
export const trapStats = new Map<number, number>();
let fallbackEnabled = true;
export function setFallbackEnabled(v: boolean) {
  fallbackEnabled = v;
}
/** Set when the frame ended (the original reached its WAI, or a port of that path ran). */
export let frameEnded = false;
export function clearFrameEnded() {
  frameEnded = false;
}
export function endFrame() {
  frameEnded = true;
}

const retModes = new Map<number, number>();
export function setRetMode(addr: number, mode: number) {
  retModes.set(addr, mode);
}

const ex = () => hw.ex as unknown as CpuEx;

let trapsOn = false;
/** Turn on traps into TypeScript for every registered routine (call after binding the machine). */
export function enableTraps(on = true) {
  const e = ex();
  if (on && trapsOn) {
    e.hw_traps_enable(1); // the oracle may have switched traps off
    return;
  }
  trapsOn = on;
  for (const a of registeredAddrs()) e.hw_trap_set(a, on ? 1 : 0);
  e.hw_traps_enable(on ? 1 : 0);
  onRegister((a) => e.hw_trap_set(a, 1));
}

function loadRegs(e: CpuEx) {
  reg.db = e.hw_cpu_reg(5);
  reg.a = e.hw_cpu_reg(0);
  reg.x = e.hw_cpu_reg(1);
  reg.y = e.hw_cpu_reg(2);
  const p = e.hw_cpu_reg(7);
  reg.c = !!(p & 1);
  reg.z = !!(p & 2);
  reg.n = !!(p & 4);
  reg.v = !!(p & 8);
}

const STACK_TOP = 0x01ff;

export function runOriginal(addr: number, kind: number, db: number, dp: number, mx: number, stops: number[] = []) {
  if (!fallbackEnabled) throw new Error(`fallback disabled: ${labelAt(addr) ?? addr.toString(16)}`);
  fallbackStats.set(addr, (fallbackStats.get(addr) ?? 0) + 1);
  const e = ex();
  e.hw_cpu_clear_stops();
  for (const s of stops) e.hw_cpu_add_stop(s);
  const flags = (mx & 1) | (mx & 2) | (reg.c ? 4 : 0) | (reg.z ? 8 : 0) | (reg.n ? 16 : 0) | (reg.v ? 32 : 0);
  // the data bank is inherited from whatever ran before, like on the real CPU
  void db;
  let code = e.hw_cpu_call(addr, kind, reg.a & 0xffff, reg.x & 0xffff, reg.y & 0xffff, reg.db & 0xff, dp, flags, STACK_TOP - 0x40, 30_000_000);
  while (code === -2) {
    // the original code is entering a routine we have ported: run it here
    const t = e.hw_cpu_trap_addr();
    trapStats.set(t, (trapStats.get(t) ?? 0) + 1);
    loadRegs(e);
    reg.mx = -1;
    implAt(t)!();
    const f = (reg.c ? 1 : 0) | (reg.z ? 2 : 0) | (reg.n ? 4 : 0) | (reg.v ? 8 : 0);
    if (frameEnded) {
      code = e.hw_cpu_resume(3, reg.a, reg.x, reg.y, f, 0, reg.db & 0xff, reg.mx);
      break;
    }
    const mode = retModes.get(t) ?? RET_RTL;
    const target = mode === RET_SPRITE ? ((r16(R.sprite_return_bank) << 16) | r16(R.sprite_return_address)) & 0xffffff : 0;
    // restore the stop list for this level (nested calls may have changed it)
    e.hw_cpu_clear_stops();
    for (const s of stops) e.hw_cpu_add_stop(s);
    code = e.hw_cpu_resume(mode, reg.a & 0xffff, reg.x & 0xffff, reg.y & 0xffff, f, target, reg.db & 0xff, reg.mx);
  }
  if (code === -1) {
    const pc = e.hw_cpu_reg(4);
    throw new Error(`original routine did not return: ${labelAt(addr) ?? addr.toString(16)} (stuck at $${pc.toString(16)}, db=${e.hw_cpu_reg(5).toString(16)})`);
  }
  loadRegs(e);
  if (e.hw_cpu_wai_hit()) frameEnded = true;
}

export interface Stub {
  (): void;
  addr: number;
}

export function stub(addr: number, kind: number, db: number, dp: number, mx: number, ret: number): Stub {
  retModes.set(addr, ret);
  const f = (() => {
    const impl = implAt(addr);
    if (impl) impl();
    else if (ret === RET_SPRITE) {
      // leaves with JML [sprite_return_address]: stop there instead of running on
      const back = ((r16(R.sprite_return_bank) << 16) | r16(R.sprite_return_address)) & 0xffffff;
      runOriginal(addr, kind, db, dp, mx, [back]);
    } else runOriginal(addr, kind, db, dp, mx);
  }) as Stub;
  f.addr = addr;
  registerStub(addr, f);
  return f;
}

import { registerStub } from "./cpu";
