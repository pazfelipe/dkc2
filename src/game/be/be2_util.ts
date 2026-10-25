/**
 * Small helpers shared by the be2_* modules (bank $BE, sprite movement system).
 */
import { r8, r16, bus16 } from "../../core/mem";
import { reg } from "../../core/cpu";
import { R } from "../../core/sym";

/** 16-bit two's complement negation (`EOR #$FFFF : INC A`). */
export const neg = (v: number) => -v & 0xffff;

/** Bit 15 set (N flag of a 16-bit value). */
export const isNeg = (v: number) => (v & 0x8000) !== 0;

/** `CMP #$8000 : ROR A` — arithmetic shift right of a signed 16-bit value (halve, keep sign). */
export const asr = (v: number) => ((v & 0xffff) >> 1) | (v & 0x8000);

/** `LDA [current_sprite_constants],y` — a word from the current sprite's constants block. */
export function spriteConst(y: number): number {
  const ptr = r16(R.current_sprite_constants) | (r8(R.current_sprite_constants + 2) << 16);
  return bus16((ptr + y) & 0xffffff);
}

/** Set N/Z like a 16-bit load of `v` (e.g. the final `LDX current_sprite`). */
export function setNZ(v: number) {
  reg.n = (v & 0x8000) !== 0;
  reg.z = (v & 0xffff) === 0;
}

/** Sprite base of the sprite being processed (`LDX current_sprite`). */
export const cur = () => r16(R.current_sprite);
