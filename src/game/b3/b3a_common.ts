/**
 * Shared helpers for package B3a (bank $B3, the start: sprite framework, animals, barrels).
 *
 * Most routines here are sprite "main" routines or pieces of them. They leave through
 * `JML [sprite_return_address]` (back into the sprite handler); in TS they simply return and
 * are registered with RET_SPRITE so that original code entering them through a trap continues
 * at the sprite return point.
 */
import { r8, r16, w16, bus16 } from "../../core/mem";
import { reg, implAt } from "../../core/cpu";
import { runOriginal, KIND_JSL, KIND_JSR } from "../../core/hybrid";
import { L, R } from "../../core/sym";

export { registerRts, registerRtl, registerSprite, spriteTail, sw, sr, cur, pl, mi, neg } from "../b8/b8b_common";

/** `LDA [current_sprite_constants],y` — a word of the current sprite's constants block. */
export function spriteConst(y: number): number {
  const base = (r8(R.current_sprite_constants_bank) << 16) | r16(R.current_sprite_constants);
  return bus16((base + y) & 0xffffff);
}

/** `LDA sprite.constants_address,x : STA current_sprite_constants` */
export function useOwnConstants(x: number) {
  w16(R.current_sprite_constants, r16(x + 0x54));
}

/**
 * `JSL`/`JML` (with a pushed return) to a 24-bit code address held in RAM: the port when
 * there is one, otherwise the original routine until its RTL.
 */
export function jslAddr(addr: number) {
  addr &= 0xffffff;
  const impl = implAt(addr);
  if (impl) return impl();
  runOriginal(addr, KIND_JSL, reg.db, 0, 0);
}

/** `JSR label` for a label whose original ends with RTS but has no usable stub. */
export function jsrAddr(addr: number) {
  addr &= 0xffffff;
  const impl = implAt(addr);
  if (impl) return impl();
  runOriginal(addr, KIND_JSR, reg.db, 0, 0);
}

const SPRITE_COLLISION_ROUTINE = R.sprite_collision_routine_address;
/**
 * `PHK : %return(label) : JML [sprite_collision_routine_address]` with A = collision flags:
 * calls the current collision check (normally check_active_kong_collision), which RTLs back.
 * The result is in carry.
 */
export function callSpriteCollisionRoutine() {
  const addr = r16(SPRITE_COLLISION_ROUTINE) | (r8(SPRITE_COLLISION_ROUTINE + 2) << 16);
  jslAddr(addr);
}

/** BIT sprite.oam_property: V flag = facing left. */
export const facingLeft = (x: number) => (r16(x + 0x12) & 0x4000) !== 0;

/** `EOR a : AND mask : EOR a` — copy the `mask` bits of `src` into `dst`. */
export const mergeBits = (dst: number, src: number, mask: number) => ((dst & ~mask) | (src & mask)) & 0xffff;

/** `CMP #$8000 : ROR A` — arithmetic shift right by one. */
export const asr1 = (v: number) => ((v & 0xffff) >> 1) | (v & 0x8000);

export const SPRITE_SIZE = 0x5e;
export const lab = (name: string) => L(name);
