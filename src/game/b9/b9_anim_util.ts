/**
 * Bank $B9 — shared helpers for the sprite animation interpreter and its callbacks.
 *
 * The animation code juggles the data bank register a lot: the script interpreter runs with
 * DB = $F9 (the bank of the animation scripts, read with `LDA $0000,y`), the callbacks invoked
 * through commands 81/84/8F/90 run with DB = $B9 (PHK/PLB), and command 83 callbacks keep
 * DB = $F9. Each PHB ... PLB pair of the original is modelled with a small stack so that the
 * DB seen by original (non-ported) routines called from here is exactly the original one.
 */
import { r8, r16, bus8, bus16, busW8 } from "../../core/mem";
import { reg, implAt } from "../../core/cpu";
import { runOriginal, KIND_JSL } from "../../core/hybrid";
import { L, R } from "../../core/sym";

const dbStack: number[] = [];

/** PHB followed by loading a new data bank (PHK/PLB, `%pea_shift_dbr` + PLB PLB). */
export function pushDb(newDb: number) {
  dbStack.push(reg.db);
  reg.db = newDb;
}

/** PLB pairing a previous `pushDb`. */
export function popDb() {
  const v = dbStack.pop();
  if (v !== undefined) reg.db = v;
}

/**
 * `LDA $xxxx` / `LDA $xxxx,y` through the current data bank (ROM in bank $F9, WRAM in $B9).
 * `addr` is base + index without masking: like the 65816, an indexed address that passes $FFFF
 * (or a word straddling it) continues into the next bank.
 */
export function dbRead16(addr: number): number {
  const full = ((reg.db & 0xff) << 16) + addr;
  return bus8(full & 0xffffff) | (bus8((full + 1) & 0xffffff) << 8);
}

/** `STA $xxxx` through the current data bank (same addressing as dbRead16). */
export function dbWrite16(addr: number, v: number) {
  const full = ((reg.db & 0xff) << 16) + addr;
  busW8(full & 0xffffff, v & 0xff);
  busW8((full + 1) & 0xffffff, (v >> 8) & 0xff);
}

/** `LDA [current_sprite_constants],y` — a word from the current sprite's constants block. */
export function spriteConstant(y: number): number {
  const ptr = r16(R.current_sprite_constants) | (r8(R.current_sprite_constants + 2) << 16);
  return bus16((ptr + y) & 0xffffff);
}

/** 16-bit two's complement negation (`EOR #$FFFF : INC A`). */
export const negate = (v: number) => (-v) & 0xffff;

/** Absolute value of a signed 16-bit word (`BPL + : EOR #$FFFF : INC A`). */
export const abs16 = (v: number) => (v & 0x8000 ? (-v) & 0xffff : v & 0xffff);

/** N flag of a 16-bit CMP (`CMP b : BMI/BPL`): sign of a - b. */
export const cmpN = (a: number, b: number) => ((a - b) & 0x8000) !== 0;

/** True when bit 15 is set (BMI after a 16-bit load). */
export const isNeg = (v: number) => (v & 0x8000) !== 0;

/** `BIT oam_property,x` V flag: the sprite is horizontally flipped (facing left). */
export const facesLeft = (oam: number) => (oam & 0x4000) !== 0;

/** `JSL label` for a global label that has no generated stub (e.g. `#queue_sound_effect`). */
export function jslLabel(addr: number) {
  const impl = implAt(addr);
  if (impl) return impl();
  runOriginal(addr, KIND_JSL, reg.db, 0, 0);
}

const QUEUE_SOUND_EFFECT = L("queue_sound_effect");
const TRANSITION_SONG = L("transition_song");
/** `JSL queue_sound_effect` (A = channel << 8 | sound id). */
export function queue_sound_effect() {
  jslLabel(QUEUE_SOUND_EFFECT);
}
/** `JSL transition_song` (A = transition id). */
export function transition_song() {
  jslLabel(TRANSITION_SONG);
}
