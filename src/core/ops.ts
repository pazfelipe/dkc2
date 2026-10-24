/**
 * Helpers for 65816 arithmetic semantics that ported code needs often.
 * Plain JS math is fine when wrap-around and flags don't matter; use these when they do.
 */
import { hw } from "./mem";

/** Carry/overflow produced by the last adc/sbc helper call. */
export const flags = { c: false, v: false };

/** ADC (16-bit): a + b + carry, sets flags.c / flags.v. */
export function adc16(a: number, b: number, carry: boolean): number {
  a &= 0xffff;
  b &= 0xffff;
  const r = a + b + (carry ? 1 : 0);
  flags.c = r > 0xffff;
  flags.v = (~(a ^ b) & (a ^ r) & 0x8000) !== 0;
  return r & 0xffff;
}
/** SBC (16-bit): a - b - !carry, sets flags.c (no borrow) / flags.v. */
export function sbc16(a: number, b: number, carry: boolean): number {
  a &= 0xffff;
  b &= 0xffff;
  const r = a - b - (carry ? 0 : 1);
  flags.c = r >= 0;
  flags.v = ((a ^ b) & (a ^ r) & 0x8000) !== 0;
  return r & 0xffff;
}
export function adc8(a: number, b: number, carry: boolean): number {
  a &= 0xff;
  b &= 0xff;
  const r = a + b + (carry ? 1 : 0);
  flags.c = r > 0xff;
  flags.v = (~(a ^ b) & (a ^ r) & 0x80) !== 0;
  return r & 0xff;
}
export function sbc8(a: number, b: number, carry: boolean): number {
  a &= 0xff;
  b &= 0xff;
  const r = a - b - (carry ? 0 : 1);
  flags.c = r >= 0;
  flags.v = ((a ^ b) & (a ^ r) & 0x80) !== 0;
  return r & 0xff;
}
/** CMP semantics: carry = (a >= b) unsigned. */
export const cmpC = (a: number, b: number) => (a & 0xffff) >= (b & 0xffff);
/** Signed 16-bit "negative" test (BMI/BPL after a 16-bit op). */
export const neg16 = (v: number) => (v & 0x8000) !== 0;
export const neg8 = (v: number) => (v & 0x80) !== 0;
/** 65816 XBA on a 16-bit value. */
export const xba = (v: number) => ((v >> 8) & 0xff) | ((v & 0xff) << 8);
/** ROL/ROR through carry (16-bit). */
export function rol16(v: number, carry: boolean): number {
  const r = ((v << 1) | (carry ? 1 : 0)) & 0xffff;
  flags.c = (v & 0x8000) !== 0;
  return r;
}
export function ror16(v: number, carry: boolean): number {
  const r = ((v & 0xffff) >> 1) | (carry ? 0x8000 : 0);
  flags.c = (v & 1) !== 0;
  return r;
}

/**
 * Busy-wait on hardware state, letting emulated time pass like the original loop did
 * (e.g. waiting for VBlank via $4212, or for the sound CPU to echo a value on $2140).
 */
export function waitUntil(cond: () => boolean, cyclesPerPoll = 24, maxPolls = 5_000_000) {
  for (let i = 0; i < maxPolls; i++) {
    if (cond()) return;
    hw.idle(cyclesPerPoll);
  }
  throw new Error("waitUntil: hardware condition never became true");
}
