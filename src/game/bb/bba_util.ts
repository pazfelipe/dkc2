/**
 * Small helpers shared by the bank $BB (part a) port.
 */
import { reg, implAt } from "../../core/cpu";
import { runOriginal, KIND_JSL, KIND_JSR } from "../../core/hybrid";
import { L } from "../../core/sym";

/** The 65816 "EOR old / AND mask / EOR old" idiom: replace the `mask` bits of `old` by those of `value`. */
export function mergeBits(old: number, value: number, mask: number): number {
  return (((value ^ old) & mask) ^ old) & 0xffff;
}

/**
 * Call a routine by label even when the generator made no stub for it (labels declared with
 * `#name:` in the disassembly, e.g. `play_song`): runs the port if registered, else the original.
 */
export function jslLabel(name: string) {
  const addr = L(name);
  const impl = implAt(addr);
  if (impl) return impl();
  runOriginal(addr, KIND_JSL, reg.db, 0, 0);
}
export function jsrLabel(name: string) {
  const addr = L(name);
  const impl = implAt(addr);
  if (impl) return impl();
  runOriginal(addr, KIND_JSR, reg.db, 0, 0);
}

import { bus8 } from "../../core/mem";
/** 16-bit read at a 24-bit address where the second byte is at address+1 across banks
 * (long indexed / absolute indexed addressing; `bus16` wraps inside the bank instead). */
export function read16x(addr: number): number {
  return bus8(addr & 0xffffff) | (bus8((addr + 1) & 0xffffff) << 8);
}
