/**
 * Shared helpers for the B8a package (player interactions, Kong sprite code, Kong states).
 */
import { r8, r16, bus16, rom16 } from "../../core/mem";
import { reg, implAt } from "../../core/cpu";
import { runOriginal, setRetMode, KIND_JSR, KIND_JSL, RET_SPRITE } from "../../core/hybrid";
import { L, R, C } from "../../core/sym";

const KONG_STATE_FLAGS_TABLE = L("kong_state_flags_table");

/** `LDA [current_sprite_constants],y` — a word from the current sprite's constants block. */
export function spriteConst(y: number): number {
  const base = r16(R.current_sprite_constants) | (r8(R.current_sprite_constants_bank) << 16);
  return bus16((base + (y & 0xffff)) & 0xffffff);
}

/** `LDA.l kong_state_flags_table,x` with X = state*4: the behaviour flags of a Kong state. */
export function kongStateFlags(state: number): number {
  return rom16(KONG_STATE_FLAGS_TABLE + ((state << 2) & 0xffff));
}

/** CMP + BMI: the N flag of the 16-bit subtraction a - b (not a true signed compare). */
export const cmpMinus = (a: number, b: number) => (((a - b) & 0x8000) !== 0);

/** `%lda_sound(channel, name)` */
export const sound = (channel: number, name: string) =>
  ((channel << 8) | (C as Record<string, number>)["sound_" + name]) & 0xffff;

/**
 * Jump to code that leaves through `JML [sprite_return_address]` (Kong states, sprite mains).
 * A ported target just returns; an original one runs until it reaches the sprite return point.
 */
export function jumpToSpriteCode(addr: number) {
  addr &= 0xffffff;
  const impl = implAt(addr);
  if (impl) return impl();
  const ret = ((r16(R.sprite_return_bank) << 16) | r16(R.sprite_return_address)) & 0xffffff;
  runOriginal(addr, KIND_JSR, reg.db, 0, 0, [ret]);
}

/** Labels whose original code ends with `JML [sprite_return_address]` (for traps from original code). */
export function markSpriteReturn(names: string[]) {
  for (const n of names) setRetMode(L(n), RET_SPRITE);
}

/** `JSL label` for a global label that has no generated stub (e.g. `#queue_sound_effect` jump-table entries). */
export function jslLabel(addr: number) {
  const impl = implAt(addr);
  if (impl) return impl();
  runOriginal(addr, KIND_JSL, reg.db, 0, 0);
}

const QUEUE_SOUND_EFFECT = L("queue_sound_effect");
/** `JSL queue_sound_effect` (A = channel<<8 | sound id). */
export function queue_sound_effect() {
  jslLabel(QUEUE_SOUND_EFFECT);
}

const TRANSITION_SONG = L("transition_song");
/** `JSL transition_song` (A = song transition id). */
export function transition_song() {
  jslLabel(TRANSITION_SONG);
}

const GET_SPRITE_TERRAIN_INFO_DEFINE_Y = L("get_sprite_terrain_info_define_y");
/** `JSL get_sprite_terrain_info_define_y` (A = y position, X = sprite). */
export function get_sprite_terrain_info_define_y() {
  jslLabel(GET_SPRITE_TERRAIN_INFO_DEFINE_Y);
}

/** Override the generated return mode of routines (used when original code traps into them). */
export function setReturnMode(mode: number, names: string[]) {
  for (const n of names) setRetMode(L(n), mode);
}
