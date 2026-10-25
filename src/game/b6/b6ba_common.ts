/**
 * Shared helpers for package B6BA (banks $B6/$BA: the world 1-2 bosses Krow and Kleever,
 * the generic boss command interpreter they use, and the Krool's Cabin scroll barrel).
 *
 * Sprite codes here are reached from `bank_B6_sprite_main_handler_2` /
 * `bank_BA_sprite_main_handler_2` and leave through `JML [sprite_return_address]` (a plain
 * `return` in TS, registered with RET_SPRITE).
 *
 * Boss RAM used by Krow and Kleever (all WRAM, bank $7E):
 *   $0650 scratch / "reached target" flag, $0652 boss HP, $0654 boss body sprite,
 *   $0656 boss head (or second) sprite, $065A attack pattern pointer, $065C/$065E pending
 *   animations for body/head, $06A1.. misc flags, $06D1..$06DF misc.
 */
import { r8, r16, w16, bus16 } from "../../core/mem";
import { reg, register, implAt, type Routine } from "../../core/cpu";
import { runOriginal, setRetMode, KIND_JSR, KIND_JSL, RET_RTS, RET_RTL, RET_SPRITE } from "../../core/hybrid";
import { L, R, C } from "../../core/sym";

/** `LDX current_sprite` */
export const cur = () => r16(R.current_sprite);

/** 16-bit read of a sprite field (`LDA field,x`). */
export const rd = (x: number, off: number) => r16((x + off) & 0xffff);
/** 16-bit write of a sprite field (`STA field,x`). */
export const wr = (x: number, off: number, v: number) => w16((x + off) & 0xffff, v & 0xffff);
/** `INC field,x` (16-bit). Returns the new value. */
export function inc(x: number, off: number): number {
  const v = (rd(x, off) + 1) & 0xffff;
  wr(x, off, v);
  return v;
}
/** `DEC field,x` (16-bit). Returns the new value. */
export function dec(x: number, off: number): number {
  const v = (rd(x, off) - 1) & 0xffff;
  wr(x, off, v);
  return v;
}
/** `TSB addr` (16-bit): sets the bits, returns Z (no bits were set before). */
export function tsb(addr: number, m: number): boolean {
  const v = r16(addr);
  w16(addr, v | m);
  return (v & m) === 0;
}
/** `TRB addr` (16-bit): clears the bits, returns Z. */
export function trb(addr: number, m: number): boolean {
  const v = r16(addr);
  w16(addr, v & ~m);
  return (v & m) === 0;
}

/** `LDA [current_sprite_constants],y` */
export function spriteConst(y: number): number {
  const base = r16(R.current_sprite_constants) | (r8(R.current_sprite_constants_bank) << 16);
  return bus16((base + (y & 0xffff)) & 0xffffff);
}

/** `EOR #$FFFF : INC A` */
export const neg = (v: number) => -v & 0xffff;
/** Sign bit of a 16-bit value (N flag after a load). */
export const isNeg = (v: number) => (v & 0x8000) !== 0;
/** BIT #$4000 on oam_property: facing left (horizontally flipped). */
export const facingLeft = (x: number) => (r16((x + 0x12) & 0xffff) & 0x4000) !== 0;
/** N flag of `CMP b` with A = a (the BMI/BPL outcome of a 16-bit compare). */
export const cmpMi = (a: number, b: number) => ((a - b) & 0x8000) !== 0;
/** Arithmetic shift right by n of a 16-bit value. */
export const asr = (v: number, n = 1) => ((((v & 0xffff) << 16) >> (16 + n)) & 0xffff);
/** Sign-extend 16 bits. */
export const s16 = (v: number) => ((v & 0xffff) << 16) >> 16;

/** The 24-bit address `JML [sprite_return_address]` goes to. */
export const spriteReturnTarget = () =>
  ((r16(R.sprite_return_bank) << 16) | r16(R.sprite_return_address)) & 0xffffff;

/**
 * Tail-jump into code that ends with `JML [sprite_return_address]`. A ported target simply
 * runs; an original one runs until it reaches the sprite return point.
 */
export function spriteTail(addr: number) {
  addr &= 0xffffff;
  const impl = implAt(addr);
  if (impl) return impl();
  runOriginal(addr, KIND_JSR, reg.db, 0, 0, [spriteReturnTarget()]);
}

/** `JSR (ptr)` / `JSR (ptr,x)` to a routine of the current bank that ends with RTS. */
export function jsrAddr(addr: number) {
  addr &= 0xffffff;
  const impl = implAt(addr);
  if (impl) return impl();
  runOriginal(addr, KIND_JSR, reg.db, 0, 0);
}
/** `JSL` to a 24-bit address held in RAM/ROM (routine ends with RTL). */
export function jslAddr(addr: number) {
  addr &= 0xffffff;
  const impl = implAt(addr);
  if (impl) return impl();
  runOriginal(addr, KIND_JSL, reg.db, 0, 0);
}

/** `%lda_sound(channel, name)`: A = channel<<8 | sound id. */
export function snd(channel: number, name: string): number {
  const id = (C as Record<string, number>)["sound_" + name];
  if (id === undefined) throw new Error(`unknown sound ${name}`);
  return ((channel << 8) | id) & 0xffff;
}

/** Boss RAM (see the header). */
export const BOSS = {
  flag: 0x0650,
  hp: 0x0652,
  body: 0x0654,
  head: 0x0656,
  pattern: 0x065a,
  bodyAnim: 0x065c,
  headAnim: 0x065e,
} as const;

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
