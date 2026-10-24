/**
 * Small helpers shared by the b8c_* modules (bank $B8, Kong actions / physics / terrain).
 */
import { r8, r16, w8, w16, bus16 } from "../../core/mem";
import { R } from "../../core/sym";
import { reg, implAt } from "../../core/cpu";
import { runOriginal, KIND_JSL } from "../../core/hybrid";

/** 16-bit two's complement negation (`EOR #$FFFF : INC A`). */
export const neg = (v: number) => (-v) & 0xffff;

/** N flag of a 16-bit value (BMI/BPL after LDA/ADC/SBC/CMP). */
export const isNeg = (v: number) => (v & 0x8000) !== 0;

/** N flag of `CMP m` with A = a (sign of the 16-bit difference, not a signed compare). */
export const cmpNeg = (a: number, m: number) => ((a - m) & 0x8000) !== 0;

/** `LDA [current_sprite_constants],y` — a word from the current sprite's constants block. */
export function spriteConst(y: number): number {
  const ptr = r16(R.current_sprite_constants) | (r8(R.current_sprite_constants + 2) << 16);
  return bus16((ptr + y) & 0xffffff);
}

/**
 * `ADC $lo,x` / `ADC $hi,x` (8-bit store) idiom used to add a signed 16-bit velocity to a
 * 24-bit position whose low byte is the high byte of the sub-pixel field:
 * the word at `base+1` gets the velocity, the byte at `base+3` gets the sign extension + carry.
 * Returns { a, y } as left in the registers (A = high-word sum, Y = sign extension).
 */
export function addVelocity24(lowWordAddr: number, velocity: number) {
  const ext = velocity & 0x8000 ? 0xffff : 0;
  const s = r16(lowWordAddr) + velocity;
  w16(lowWordAddr, s & 0xffff);
  const hi = (ext + r16(lowWordAddr + 2) + (s > 0xffff ? 1 : 0)) & 0xffff;
  w8(lowWordAddr + 2, hi & 0xff);
  return { a: hi, y: ext };
}

/**
 * JSL to a ROM label that has no generated stub (asar `#label:` globals declared inside another
 * routine, e.g. `get_sprite_terrain_info_define_x`): runs the TS port if one is registered,
 * otherwise the original routine on the reference CPU.
 */
export function jslLabel(addr: number) {
  const impl = implAt(addr);
  if (impl) impl();
  else runOriginal(addr, KIND_JSL, reg.db, 0, 0);
}
