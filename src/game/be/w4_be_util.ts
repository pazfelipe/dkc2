/**
 * Bank $BE (package w4_be) — small helpers shared by the world 3+ sprite codes of the bank
 * (skull carts, haunted hall, Klank's race, Kackle, Screech, giant tire, ...).
 *
 * These sprite codes address sprite fields by raw offsets ($06 x, $0A y, $2E state, $42-$5C
 * general purpose), so the helpers below take the sprite base and the offset like `LDA $xx,x`.
 */
import { r8, r16, w16, bus16 } from "../../core/mem";
import { reg, callAddr } from "../../core/cpu";
import { R } from "../../core/sym";

/** `LDA $off,x` (16-bit). */
export const g = (x: number, off: number) => r16((x + off) & 0xffff);
/** `STA $off,x` (16-bit). */
export const s = (x: number, off: number, v: number) => w16((x + off) & 0xffff, v & 0xffff);
/** `INC $off,x` in 16-bit mode (state bytes are incremented as words: `INC $2F,x`). */
export const inc = (x: number, off: number) => s(x, off, g(x, off) + 1);
/** `DEC $off,x` in 16-bit mode. */
export const dec = (x: number, off: number) => s(x, off, g(x, off) - 1);
/** `ORA #m : STA` on a sprite word. */
export const or = (x: number, off: number, m: number) => s(x, off, g(x, off) | m);
/** `AND #m : STA` on a sprite word. */
export const and = (x: number, off: number, m: number) => s(x, off, g(x, off) & m);

/** Bit 15 set (N flag of a 16-bit value). */
export const neg = (v: number) => (v & 0x8000) !== 0;
/** Two's complement (`EOR #$FFFF : INC A`). */
export const negate = (v: number) => -v & 0xffff;
/** `CMP #$8000 : ROR A` — arithmetic shift right. */
export const asr = (v: number) => ((v & 0xffff) >> 1) | (v & 0x8000);

/** `LDA [current_sprite_constants],y`. */
export function spriteConst(y: number): number {
  const ptr = r16(R.current_sprite_constants) | (r8(R.current_sprite_constants + 2) << 16);
  return bus16((ptr + y) & 0xffffff);
}

/** `LDA [$32],y` with the long pointer in $32-$34. */
export function ptr32(y: number): number {
  const p = r16(0x32) | (r8(0x34) << 16);
  return bus16((p + y) & 0xffffff);
}

/** `JML [sprite_collision_routine_address]` (the pushed return address makes it a JSL). */
export function spriteCollisionRoutine(): void {
  callAddr(r16(R.sprite_collision_routine_address) | ((r16(R.sprite_collision_routine_addr_high) & 0xff00) << 8));
}

/** The sprite being processed (`LDX current_sprite`). */
export const cur = () => r16(R.current_sprite);

/** `SBC #imm` on a 16-bit value with the current carry; updates reg.c. */
export function sbcImm(a: number, imm: number): number {
  const r = (a & 0xffff) - (imm & 0xffff) - (reg.c ? 0 : 1);
  reg.c = r >= 0;
  return r & 0xffff;
}

/** `ADC #imm` on a 16-bit value with the current carry; updates reg.c. */
export function adcImm(a: number, imm: number): number {
  const r = (a & 0xffff) + (imm & 0xffff) + (reg.c ? 1 : 0);
  reg.c = r > 0xffff;
  return r & 0xffff;
}

/** `CMP` (16-bit): sets reg.c, returns the difference (for N/Z checks). */
export function cmp(a: number, b: number): number {
  reg.c = (a & 0xffff) >= (b & 0xffff);
  return ((a & 0xffff) - (b & 0xffff)) & 0xffff;
}
