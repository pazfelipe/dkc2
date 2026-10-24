/**
 * Shared helpers for package B8b (the middle of the Kong code in bank $B8).
 *
 * Kong states are entered with `JMP (kong_state_table,x)` from `kong_state_handler` and leave
 * through `kong_state_return` / `CODE_B89979`, which end with `JML [sprite_return_address]`
 * (back into the sprite handler). In TS such a routine simply returns; when the original
 * kong_state_handler enters a ported state through a trap, the hybrid layer must then jump to
 * the sprite return address, so those routines are registered with RET_SPRITE.
 */
import { r8, r16, w16, bus16 } from "../../core/mem";
import { reg, register, implAt, type Routine } from "../../core/cpu";
import { runOriginal, stub, KIND_JSR, setRetMode, RET_RTS, RET_RTL, RET_SPRITE } from "../../core/hybrid";
import { L, R } from "../../core/sym";

/** N flag clear after `CMP b` with A = a (the "BPL" outcome of a 16-bit compare). */
export const pl = (a: number, b: number) => ((a - b) & 0x8000) === 0;
/** N flag set after `CMP b` (the "BMI" outcome). */
export const mi = (a: number, b: number) => ((a - b) & 0x8000) !== 0;
/** `EOR #$FFFF : INC A` */
export const neg = (v: number) => -v & 0xffff;
/** Two's complement absolute value of a 16-bit value (the BPL / EOR / INC idiom). */
export const abs16 = (v: number) => (v & 0x8000 ? -v & 0xffff : v & 0xffff);
/** Arithmetic shift right of a 16-bit value (`CMP #$8000 : ROR A`, n times). */
export const asr = (v: number, n: number) => (((v & 0xffff) << 16) >> (16 + n)) & 0xffff;

/** `LDA [current_sprite_constants],y` */
export function spriteConst(y: number): number {
  const base = (r8(R.current_sprite_constants_bank) << 16) | r16(R.current_sprite_constants);
  return bus16((base + y) & 0xffffff);
}

/** `LDX current_sprite` */
export const cur = () => r16(R.current_sprite);

function regWith(mode: number, fns: Record<string, Routine>) {
  register(fns);
  for (const k of Object.keys(fns)) setRetMode(L(k), mode);
}
/** Register routines that end with RTS. */
export const registerRts = (fns: Record<string, Routine>) => regWith(RET_RTS, fns);
/** Register routines that end with RTL. */
export const registerRtl = (fns: Record<string, Routine>) => regWith(RET_RTL, fns);
/** Register routines that end with `JML [sprite_return_address]` (kong states and their tails). */
export const registerSprite = (fns: Record<string, Routine>) => regWith(RET_SPRITE, fns);

/**
 * Tail-jump into another package's routine that ends with `JML [sprite_return_address]`
 * (kong_state_return, kong_state_0B, ...). Uses the TS port when there is one; otherwise runs
 * the original until it reaches the sprite return address, so it does not run on into the
 * sprite handler.
 */
export function spriteTail(addr: number) {
  const impl = implAt(addr);
  if (impl) return impl();
  const ret = ((r16(R.sprite_return_bank) << 16) | r16(R.sprite_return_address)) & 0xffffff;
  runOriginal(addr, KIND_JSR, reg.db, 0, 0, [ret]);
}

const KONG_STATE_RETURN = L("kong_state_return");
const CODE_B89975_ADDR = L("CODE_B89975");
const CODE_B8997E_ADDR = L("CODE_B8997E");

/** `JMP kong_state_return` ($B8996E): clear the rope latch, refresh the clipping, leave the state. */
export const kongStateReturn = () => spriteTail(KONG_STATE_RETURN);
/** `JMP CODE_B89975`: refresh the active kong clipping, leave the state. */
export const kongStateReturnClipping = () => spriteTail(CODE_B89975_ADDR);
/** `JMP CODE_B8997E`: kong_state_return for the active kong only. */
export const kongStateReturnIfActive = () => spriteTail(CODE_B8997E_ADDR);
/** `JMP CODE_B89979` ($B89979: PHK, PLB, JML [sprite_return_address]). */
export function spriteReturn() {
  reg.db = 0xb8;
}

/** Write a 16-bit sprite field. */
export const sw = (x: number, off: number, v: number) => w16(x + off, v & 0xffff);
/** Read a 16-bit sprite field. */
export const sr = (x: number, off: number) => r16(x + off);

// Labels written as `#label` in the disassembly have no generated stub in src/gen/routines.ts;
// these local stubs behave exactly like generated ones (port if registered, else the original).
/** $B5C3E7 (JSL, RTL): terrain info at x = A, y = $34. */
export const get_sprite_terrain_info_define_x = stub(L("get_sprite_terrain_info_define_x"), 1, 0xb8, 0, 0, 1);
/** $B5C3E3 (JSL, RTL): terrain info at the sprite's x, y = A. */
export const get_sprite_terrain_info_define_y = stub(L("get_sprite_terrain_info_define_y"), 1, 0xb8, 0, 0, 1);
/** (JSL, RTL) */
export const queue_sound_effect = stub(L("queue_sound_effect"), 1, 0xb8, 0, 0, 1);
/** (JSL, RTL) */
export const play_high_priority_sound = stub(L("play_high_priority_sound"), 1, 0xb8, 0, 0, 1);
