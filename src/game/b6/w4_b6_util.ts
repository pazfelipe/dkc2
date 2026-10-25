/**
 * Helpers shared by package W4_B6 (banks $B6/$BA: the bosses of worlds 3-7 and the Lost World,
 * the rest of the boss command interpreter, the bonus and credits screens).
 * Builds on `b6ba_common.ts` (sprite field access, registration by exit mode).
 */
import { r16, bus16, bus8 } from "../../core/mem";
import { reg } from "../../core/cpu";
import { L } from "../../core/sym";

/** `LDA abs` / `LDA abs,x` with the current data bank: WRAM below $2000, else ROM/bus. */
export function lda(a: number): number {
  a &= 0xffff;
  return a < 0x2000 ? r16(a) : bus16(((reg.db & 0xff) << 16) | a);
}
/** 8-bit `LDA abs` with the current data bank. */
export function lda8(a: number): number {
  a &= 0xffff;
  return a < 0x2000 ? r16(a) & 0xff : bus8(((reg.db & 0xff) << 16) | a);
}

/** Low 16 bits of a label (`#label` operand). */
export const lo = (name: string) => L(name) & 0xffff;
/** Bank byte of a label. */
export const bank = (name: string) => (L(name) >> 16) & 0xff;

/**
 * Values pushed in one label and pulled in another label of the same routine
 * (PHX/PHY ... PLX/PLY across label boundaries).
 */
export class Stack {
  private s: number[] = [];
  push(v: number) {
    this.s.push(v & 0xffff);
  }
  pop(): number {
    const v = this.s.pop();
    if (v === undefined) throw new Error("W4_B6 stack underflow");
    return v;
  }
}

/** Carry of `CMP m` with A = a (16-bit): A >= m. */
export const ge = (a: number, m: number) => (a & 0xffff) >= (m & 0xffff);
/** `A + m` 16-bit wrap. */
export const add = (a: number, m: number) => (a + m) & 0xffff;
/** `A - m` 16-bit wrap. */
export const sub = (a: number, m: number) => (a - m) & 0xffff;

/**
 * Thrown by boss command code that drops the interpreter's return addresses (`PLA : PLA`) to
 * leave `parse_boss_command` at once; the boss code catches it where it called the parser.
 */
export const ABORT_PARSE = Object.freeze({ abortParse: true });
