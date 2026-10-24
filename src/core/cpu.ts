/**
 * Register context and routine registry for the ported game code.
 *
 * Calling convention (mirrors the original 65816 code so routines ported independently fit
 * together exactly): a ported routine takes no parameters and receives/returns values in the
 * same CPU registers the original used, through the global `reg` object:
 *
 *     reg.x = spriteAddr;                 // LDX ...
 *     apply_position_from_velocity();     // JSR apply_position_from_velocity
 *     if (reg.c) { ... }                  // BCS ...
 *
 * Inside a routine, use ordinary local variables and structured control flow.
 * Only values that cross a call boundary need to go through `reg` (or through the WRAM
 * direct-page temporaries, exactly where the original passed them).
 *
 * Routines are called through the stubs in src/gen/routines.ts; implementations are attached
 * with `register({ label: fn })`.
 */
import { L, labelAt } from "./sym";

export const reg = {
  /** Accumulator (16-bit value; mask with & 0xFF when the original ran with 8-bit A). */
  a: 0,
  x: 0,
  y: 0,
  /** Carry flag (used by many routines as a boolean result). */
  c: false,
  /** Zero flag, when a caller branches on it right after a call. */
  z: false,
  /** Negative flag, when a caller branches on it right after a call. */
  n: false,
  /** Overflow flag (rare). */
  v: false,
  /**
   * Data bank register. Only matters where original code runs (hybrid fallback): a ported
   * routine whose original changes DB and leaves it changed on exit must set this
   * (e.g. sprite mains, which jump back to the sprite handler without restoring DB).
   */
  db: 0x80,
  /**
   * M/X width flags on exit (bit0 = 8-bit A, bit1 = 8-bit X/Y), or -1 = unchanged from entry.
   * Set it when the original routine returns in a different width than it was entered with.
   */
  mx: -1,
};

export type Routine = () => void;

const byAddr = new Map<number, Routine>();
const byName = new Map<string, Routine>();
const fallbackByAddr = new Map<number, Routine>();

let registerHook: ((addr: number) => void) | null = null;
/** Called by the hybrid layer so newly registered routines trap the reference CPU. */
export function onRegister(fn: (addr: number) => void) {
  registerHook = fn;
}
export function registeredAddrs(): number[] {
  return [...byAddr.keys()];
}

/** Attach TypeScript implementations to routine labels. */
export function register(routines: Record<string, Routine>) {
  for (const [name, fn] of Object.entries(routines)) {
    byName.set(name, fn);
    const a = L(name);
    byAddr.set(a, fn);
    registerHook?.(a);
  }
}

/** Used by the stubs: the TS implementation for an address, if ported. */
export function implAt(addr: number): Routine | undefined {
  return byAddr.get(addr);
}

/** Stubs register themselves so that dispatch by address can fall back to the original. */
export function registerStub(addr: number, fn: Routine) {
  fallbackByAddr.set(addr, fn);
}

export class UnportedRoutine extends Error {
  constructor(public addr: number) {
    super(`no routine at ${labelAt(addr) ?? "?"} ($${addr.toString(16).toUpperCase()})`);
  }
}

/** Call a routine by full 24-bit address (JSL/JML through a pointer or table). */
export function callAddr(addr: number) {
  addr &= 0xffffff;
  const fn = byAddr.get(addr) ?? fallbackByAddr.get(addr);
  if (!fn) throw new UnportedRoutine(addr);
  fn();
}

/** Call a routine through a 16-bit pointer in a given bank (JSR/JMP (table,x)). */
export function callPtr(bank: number, ptr16: number) {
  callAddr((bank << 16) | (ptr16 & 0xffff));
}

export function routineByName(name: string): Routine | undefined {
  return byName.get(name);
}
export function isPorted(addr: number): boolean {
  return byAddr.has(addr & 0xffffff);
}
export function portedNames(): string[] {
  return [...byName.keys()];
}
