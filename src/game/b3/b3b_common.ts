/**
 * Shared helpers for package B3b (bank $B3 sprite mains: level goal, generic enemies,
 * Click-Clack, Klobber, Kruncha, Snapjaw, Lockjaw, Flotsam, Shuri, Kaboing, sound generator).
 *
 * Most sprite mains in this bank start with `JSR sprite_state_handler_B3` followed directly by
 * a table of state routines: the handler pops its own return address to find the table, so it
 * cannot be called like a normal routine. `stateHandlerB3` does the same dispatch for a ported
 * main. On entry to a state routine the registers are those the original leaves:
 *   Y = current sprite, X = address of the table entry, A = sub state * 2, DB = $B3.
 * State routines leave through `JML [sprite_return_address]` (a plain `return` in TS).
 */
import { r8, r16, w16, bus16, hw } from "../../core/mem";
import { reg, register, implAt, type Routine } from "../../core/cpu";
import { runOriginal, setRetMode, KIND_JSR, RET_RTS, RET_RTL, RET_SPRITE } from "../../core/hybrid";
import { L, R, sprite } from "../../core/sym";
import { CODE_BBBB99 } from "../../gen/routines";

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

/** `LDA [current_sprite_constants],y` */
export function spriteConst(y: number): number {
  const base = r16(R.current_sprite_constants) | (r8(R.current_sprite_constants_bank) << 16);
  return bus16((base + (y & 0xffff)) & 0xffffff);
}

/** `EOR #$FFFF : INC A` */
export const neg = (v: number) => -v & 0xffff;
/** Sign bit of a 16-bit value (N flag after a load). */
export const isNeg = (v: number) => (v & 0x8000) !== 0;
/** `BIT field` V flag: bit 14 (e.g. the horizontal flip bit of oam_property). */
export const bit14 = (v: number) => (v & 0x4000) !== 0;
/** N flag of `CMP b` with A = a (the BMI/BPL outcome of a 16-bit compare). */
export const cmpMi = (a: number, b: number) => ((a - b) & 0x8000) !== 0;
/** `CMP #$8000 : ROR A` — arithmetic shift right by one. */
export const asr1 = (v: number) => ((v & 0xffff) >> 1) | (v & 0x8000);

/** The 24-bit address `JML [sprite_return_address]` goes to. */
export const spriteReturnTarget = () =>
  ((r16(R.sprite_return_bank) << 16) | r16(R.sprite_return_address)) & 0xffffff;

/**
 * Tail-jump into code that ends with `JML [sprite_return_address]` (other sprite mains,
 * sprite_return_handle_despawn, ...). A ported target simply runs; an original one runs until
 * it reaches the sprite return point, so it does not continue into the sprite handler.
 */
export function spriteTail(addr: number) {
  addr &= 0xffffff;
  const impl = implAt(addr);
  if (impl) return impl();
  runOriginal(addr, KIND_JSR, reg.db, 0, 0, [spriteReturnTarget()]);
}

/**
 * `JMP sprite_return_handle_despawn` ($B38000): `JSL CODE_BBBB99` (despawn the sprite once it
 * has been off screen long enough), then back to the sprite handler.
 */
export function despawnReturn(): void {
  const impl = implAt(SPRITE_RETURN_HANDLE_DESPAWN);
  if (impl) return impl();
  CODE_BBBB99();
}
const SPRITE_RETURN_HANDLE_DESPAWN = L("sprite_return_handle_despawn");

const CODE_B3D249_ADDR = L("CODE_B3D249");
const STATE_HANDLER_ADDR = L("sprite_state_handler_B3");

/**
 * `JSR sprite_state_handler_B3` + state table ($B3A369). `states[i]` is the routine for state i
 * (the entries of the table that follows the JSR at `table`).
 */
export function stateHandlerB3(table: number, states: Routine[]) {
  for (;;) {
    reg.db = 0xb3; // PHK : PLB
    const y = cur();
    w16(R.current_sprite_constants, r16(y + sprite.constants_address));
    const word = r16(y + sprite.state - 1); // high byte = state
    if (word & 0x8000) {
      // A sprite carried/thrown by an enemy (state bit 7): CODE_B3D249 moves it, and either
      // returns to the sprite handler or clears bit 7 and re-enters the state handler.
      reg.y = y;
      reg.a = word;
      runOriginal(CODE_B3D249_ADDR, KIND_JSR, reg.db, 0, 0, [spriteReturnTarget(), STATE_HANDLER_ADDR]);
      const pc = (hw.ex as unknown as { hw_cpu_reg(i: number): number }).hw_cpu_reg(4);
      if ((pc & 0xffff) === (STATE_HANDLER_ADDR & 0xffff)) continue;
      return;
    }
    const state = (word >> 8) & 0x7f;
    reg.y = y;
    reg.x = (table + state * 2) & 0xffff;
    reg.a = (r8(y + sprite.sub_state) * 2) & 0xffff;
    const fn = states[state];
    if (fn) return fn();
    // out-of-range state: jump wherever the ROM table points, like the original
    runOriginal(0xb30000 | (bus16(0xb30000 | reg.x)), KIND_JSR, reg.db, 0, 0, [spriteReturnTarget()]);
    return;
  }
}

/** `JMP (.sub_state_table,x)` with X = A = sub state * 2 (out-of-range entries not expected). */
export function subState(table: Routine[]) {
  reg.x = reg.a & 0xffff;
  const fn = table[reg.x >> 1];
  if (!fn) throw new Error(`B3b: unexpected sub state ${reg.x >> 1}`);
  fn();
}

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
