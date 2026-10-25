/**
 * Bank $B3 — Kaboing (the jumping Kremling on peg legs) and the invisible sound generator sprite.
 *
 * Kaboing hops in two alternating patterns: pattern A ($42 x speed, $44 jump speed, $46 gravity,
 * display_mode = number of hops) and pattern B ($48/$4A/$4C, display_mode_high = number of hops,
 * 0 = forever). Each landing (ground_distance = 0) turns him around at walls/slopes.
 * The x speed for the next hop is kept in general_purpose_50, the jump speed in max_y_speed.
 */
import { r8, r16 } from "../../core/mem";
import { reg } from "../../core/cpu";
import { L, R, C, sprite } from "../../core/sym";
import {
  check_throwable_collision_global, get_current_sprite_clipping, CODE_BEBE8B, process_current_movement,
  queue_sound_effect, CODE_BBBB44, CODE_BBBB99,
} from "../../gen/routines";
import { cur, rd, wr, inc, dec, isNeg, bit14, neg, despawnReturn, stateHandlerB3, registerRts, registerSprite } from "./b3b_common";
import { make_sprite_fall_off_screen, process_animation_handle_submerged, defeat_sprite_using_animation } from "./b3b_misc";

const KABOING_STATES = (L("kaboing_main") + 0x03) & 0xffff;
const SOUND_GENERATOR_STATES = (L("sound_generator_main") + 0x03) & 0xffff;

/** $B3BAA1 */
export function kaboing_main(): void {
  stateHandlerB3(KABOING_STATES, [CODE_B3BAAC, CODE_B3BAC2, CODE_B3BB7B, CODE_B3BB7B]);
}

/** $B3BAAC — state 0: hop in place (sub state 1 = in the air). */
export function CODE_B3BAAC(): void {
  reg.x = reg.a;
  if (reg.x === 0) return CODE_B3BABF();
  CODE_B3BAB4();
}

/** $B3BAB4 */
export function CODE_B3BAB4(): void {
  if (rd(reg.y, sprite.ground_distance) !== 0) return CODE_B3BABF();
  reg.x = reg.y;
  dec(reg.x, sprite.sub_state);
  CODE_B3BB58();
  CODE_B3BABF();
}

/** $B3BABF */
export function CODE_B3BABF(): void {
  CODE_B3BB31();
}

const KABOING_HOPS = [CODE_B3BAD2, CODE_B3BAEB, CODE_B3BAEE, CODE_B3BAFD, CODE_B3BB19, CODE_B3BB1C];

/** $B3BAC2 — state 1: alternate between the two hop patterns (DATA_B3BAC6). */
export function CODE_B3BAC2(): void {
  reg.x = reg.a;
  KABOING_HOPS[reg.x >> 1]();
}

/** $B3BAD2 — sub state 0: start pattern A. */
export function CODE_B3BAD2(): void {
  reg.x = reg.y;
  const x = reg.x;
  wr(x, sprite.general_purpose_50, rd(x, 0x42));
  wr(x, sprite.max_y_speed, rd(x, 0x44));
  wr(x, sprite.unknown_22, rd(x, 0x46));
  wr(x, 0x4e, rd(x, sprite.display_mode) & 0x00ff);
  wr(x, sprite.state, 0x0101);
  CODE_B3BAEB();
}

/** $B3BAEB — sub state 1 (in the air). */
export function CODE_B3BAEB(): void {
  CODE_B3BB31();
}

/** $B3BAEE — sub state 2: pattern A, on landing count the hops. */
export function CODE_B3BAEE(): void {
  if (rd(reg.y, sprite.ground_distance) !== 0) return CODE_B3BAEB();
  reg.x = reg.y;
  dec(reg.x, sprite.sub_state);
  CODE_B3BB58();
  if (dec(reg.x, 0x4e) !== 0) return CODE_B3BAEB();
  CODE_B3BAFD();
}

/** $B3BAFD — sub state 3: start pattern B. */
export function CODE_B3BAFD(): void {
  reg.x = reg.y;
  const x = reg.x;
  wr(x, sprite.general_purpose_50, rd(x, 0x48));
  wr(x, sprite.max_y_speed, rd(x, 0x4a));
  wr(x, sprite.unknown_22, rd(x, 0x4c));
  reg.a = r16(x + sprite.display_mode_high) & 0x00ff;
  if (reg.a === 0) reg.a = 0xffff; // 0 hops = hop forever
  CODE_B3BB12();
}

/** $B3BB12 */
export function CODE_B3BB12(): void {
  wr(reg.x, 0x4e, reg.a);
  wr(reg.x, sprite.state, 0x0401);
  CODE_B3BB19();
}

/** $B3BB19 — sub state 4 (in the air). */
export function CODE_B3BB19(): void {
  CODE_B3BB31();
}

/** $B3BB1C — sub state 5: pattern B, on landing count the hops, then back to pattern A. */
export function CODE_B3BB1C(): void {
  if (rd(reg.y, sprite.ground_distance) !== 0) return CODE_B3BB19();
  reg.x = reg.y;
  dec(reg.x, sprite.sub_state);
  CODE_B3BB58();
  if (isNeg(rd(reg.x, 0x4e))) return CODE_B3BB19();
  if (dec(reg.x, 0x4e) !== 0) return CODE_B3BB19();
  CODE_B3BAD2();
}

/**
 * $B3BB31 — collisions: a throwable with result 0, or the Kong with result 0 (flags $5428),
 * defeats him. Then animate (half speed under water) and move.
 */
export function CODE_B3BB31(): void {
  reg.a = 0x0118;
  check_throwable_collision_global();
  if (reg.c && (reg.a & 0xffff) === 0) return CODE_B3BB85();
  CODE_B3BB3C();
}

/** $B3BB3C */
export function CODE_B3BB3C(): void {
  get_current_sprite_clipping();
  reg.a = 0x5428;
  CODE_BEBE8B();
  if (!reg.c) return CODE_B3BB4E();
  CODE_B3BB49();
}

/** $B3BB49 */
export function CODE_B3BB49(): void {
  if ((reg.a & 0xffff) !== 0) return CODE_B3BB4E();
  CODE_B3BB85();
}

/** $B3BB4E */
export function CODE_B3BB4E(): void {
  process_animation_handle_submerged();
  process_current_movement();
  despawnReturn();
}

/**
 * $B3BB58 — landed: stop, and set the x speed of the next hop: reversed after a hop with a
 * different speed, or when standing on a slope (terrain type 6/7) facing uphill.
 */
export function CODE_B3BB58(): void {
  const x = reg.x;
  reg.a = rd(x, sprite.general_purpose_50);
  const differs = reg.a !== rd(x, sprite.max_x_speed);
  wr(x, sprite.max_x_speed, 0);
  wr(x, sprite.x_speed, 0);
  if (differs) return CODE_B3BB74();
  reg.a = rd(x, sprite.terrain_attributes) & 0x0007;
  if (reg.a < 0x0006) return CODE_B3BB7A();
  reg.a = rd(x, sprite.terrain_attributes) ^ rd(x, sprite.general_purpose_50);
  if (isNeg(reg.a)) return CODE_B3BB7A();
  reg.a = rd(x, sprite.general_purpose_50);
  CODE_B3BB74();
}

/** $B3BB74 */
export function CODE_B3BB74(): void {
  reg.a = neg(reg.a);
  wr(reg.x, sprite.general_purpose_50, reg.a);
  CODE_B3BB7A();
}

/** $B3BB7A */
export function CODE_B3BB7A(): void {}

/** $B3BB7B — states 2/3: defeated. */
export function CODE_B3BB7B(): void {
  process_current_movement();
  process_animation_handle_submerged();
  make_sprite_fall_off_screen();
}

/** $B3BB85 — defeated: knocked away from the colliding sprite. */
export function CODE_B3BB85(): void {
  reg.x = r16(R.colliding_sprite);
  reg.a = bit14(rd(reg.x, sprite.oam_property)) ? 0x0100 : 0xff00;
  CODE_B3BB91();
}

/** $B3BB91 */
export function CODE_B3BB91(): void {
  reg.x = cur();
  const x = reg.x;
  wr(x, sprite.max_x_speed, reg.a);
  wr(x, sprite.x_speed, reg.a);
  wr(x, sprite.y_speed, 0xfc00);
  wr(x, sprite.movement_state, 0x0004);
  reg.a = C.kaboing_death_anim_id;
  defeat_sprite_using_animation();
  wr(reg.x, sprite.state, 0x0003);
  despawnReturn();
}

// ---------------------------------------------------------------------------------------------
// Sound generator: plays sound $42 once (state 0), every $44 frames (state 1), or keeps a
// looping sound going while on screen (state 2).
// ---------------------------------------------------------------------------------------------

/** $B3BBAF */
export function sound_generator_main(): void {
  stateHandlerB3(SOUND_GENERATOR_STATES, [soundOnce, soundRepeat, soundLoop]);
}

/** .state_00: play once and delete the sprite. */
function soundOnce(): void {
  reg.a = r16(reg.y + 0x42);
  queue_sound_effect();
  CODE_BBBB44();
}

/** .state_01: repeat every $44 frames. */
function soundRepeat(): void {
  reg.x = reg.y;
  const x = reg.x;
  // (the state byte is never 0 here, so this first-frame setup does not run)
  if ((rd(x, sprite.state) & 0x00ff) === 0) {
    inc(x, sprite.sub_state);
    wr(x, 0x46, 0);
  }
  if (isNeg(dec(x, 0x46))) {
    wr(x, 0x46, rd(x, 0x44));
    reg.a = rd(x, 0x42);
    queue_sound_effect();
  }
  despawnReturn();
}

/** .state_02: while on screen keep the sound queued; once despawned, stop its channel. */
function soundLoop(): void {
  CODE_BBBB99();
  reg.y = cur();
  if (reg.c) {
    reg.a = r16(reg.y + 0x42) & 0xff00;
    queue_sound_effect();
    return;
  }
  reg.a = r16(reg.y + 0x42);
  CODE_B3BC01();
}

/** $B3BC01 — queue sound A (lo = sound, hi = channel) unless that channel already plays it. */
export function CODE_B3BC01(): void {
  // SEP #$30 ... REP #$30 clears the high bytes of X and Y
  reg.x = (reg.a >> 8) & 0xff;
  reg.y &= 0xff;
  if ((reg.a & 0xff) === r8(R.sound_effect_buffer + reg.x)) return;
  queue_sound_effect();
}

registerSprite({
  kaboing_main, CODE_B3BAAC, CODE_B3BAB4, CODE_B3BABF, CODE_B3BAC2, CODE_B3BAD2, CODE_B3BAEB, CODE_B3BAEE,
  CODE_B3BAFD, CODE_B3BB12, CODE_B3BB19, CODE_B3BB1C, CODE_B3BB31, CODE_B3BB3C, CODE_B3BB49, CODE_B3BB4E,
  CODE_B3BB7B, CODE_B3BB85, CODE_B3BB91, sound_generator_main,
});
registerRts({ CODE_B3BB58, CODE_B3BB74, CODE_B3BB7A, CODE_B3BC01 });
