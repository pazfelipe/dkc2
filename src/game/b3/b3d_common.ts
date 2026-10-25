/**
 * Shared helpers for package B3d (the end of bank $B3: timer, exit walls, checkpoint barrels,
 * barrel cannons and their icons).
 *
 * The sprite codes here are reached through `bank_B3_sprite_main_handler` (PHK/PLB, so DB=$B3)
 * and leave with `JML [sprite_return_address]`. In TS such a routine simply returns; when the
 * original enters a ported sprite code through a trap, the hybrid layer jumps to the sprite
 * return address, so those routines are registered with RET_SPRITE.
 */
import { r16, w16 } from "../../core/mem";
import { reg, register, implAt, type Routine } from "../../core/cpu";
import { runOriginal, KIND_JSR, setRetMode, RET_RTS, RET_RTL, RET_SPRITE } from "../../core/hybrid";
import { L, R } from "../../core/sym";

/** N flag clear after `CMP b` with A = a (the "BPL" outcome of a 16-bit compare). */
export const pl = (a: number, b: number) => ((a - b) & 0x8000) === 0;
/** N flag set after `CMP b` (the "BMI" outcome). */
export const mi = (a: number, b: number) => ((a - b) & 0x8000) !== 0;
/** `EOR #$FFFF : INC A` */
export const neg = (v: number) => -v & 0xffff;
/** The BPL / EOR #$FFFF / INC idiom: 16-bit absolute value. */
export const abs16 = (v: number) => (v & 0x8000 ? -v & 0xffff : v & 0xffff);
/** `CMP #$8000 : ROR A` repeated n times (arithmetic shift right). */
export const asr = (v: number, n: number) => (((v & 0xffff) << 16) >> (16 + n)) & 0xffff;
/** The `EOR old / AND mask / EOR old` idiom: the `mask` bits of `value` merged into `old`. */
export const merge = (old: number, value: number, mask: number) => (((value ^ old) & mask) ^ old) & 0xffff;

/** `LDX current_sprite` */
export const cur = () => r16(R.current_sprite);
/** Read a 16-bit sprite field. */
export const sr = (x: number, off: number) => r16(x + off);
/** Write a 16-bit sprite field. */
export const sw = (x: number, off: number, v: number) => w16(x + off, v & 0xffff);

function regWith(mode: number, fns: Record<string, Routine>) {
  register(fns);
  for (const k of Object.keys(fns)) setRetMode(L(k), mode);
}
/** Register routines that end with RTS. */
export const registerRts = (fns: Record<string, Routine>) => regWith(RET_RTS, fns);
/** Register routines that end with RTL. */
export const registerRtl = (fns: Record<string, Routine>) => regWith(RET_RTL, fns);
/** Register routines that end with `JML [sprite_return_address]`. */
export const registerSprite = (fns: Record<string, Routine>) => regWith(RET_SPRITE, fns);

/** `JML [sprite_return_address]` from bank $B3 code (DB is $B3 there). */
export function spriteReturn() {
  reg.db = 0xb3;
}

/**
 * Tail-jump into another package's routine that ends with `JML [sprite_return_address]`.
 * Uses the TS port when there is one; otherwise runs the original only up to the sprite
 * return address (its generated stub may have the wrong return mode).
 */
export function spriteTail(addr: number) {
  const impl = implAt(addr);
  if (impl) return impl();
  const ret = ((r16(R.sprite_return_bank) << 16) | r16(R.sprite_return_address)) & 0xffffff;
  runOriginal(addr, KIND_JSR, reg.db, 0, 0, [ret]);
}

const CODE_B3D916_ADDR = L("CODE_B3D916");
/** `JMP CODE_B3D916` ($B3D916: JSL CODE_BBBB99, JML [sprite_return_address]) — the usual
 * sprite exit of these codes, which also handles despawning off-screen sprites. */
export const exitB3D916 = () => spriteTail(CODE_B3D916_ADDR);
