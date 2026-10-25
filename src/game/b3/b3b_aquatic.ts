/**
 * Bank $B3 — Flotsam (the stingray that patrols a path) and Shuri (the starfish that waits,
 * then spins towards the Kong). Both are defeated by throwables or by Enguarde.
 * Shuri variables: $44 home y, $48 lunge speed, $4E/$50 lunge target x/y,
 * terrain_interaction = spin timer.
 */
import { r16, w16 } from "../../core/mem";
import { reg } from "../../core/cpu";
import { L, R, C, sprite } from "../../core/sym";
import {
  delete_sprite_handle_deallocation, check_throwable_collision_global, get_current_sprite_clipping, CODE_BEBE8B,
  process_current_movement, process_sprite_animation, set_sprite_animation, defeat_aquatic_sprite_using_anim,
  CODE_B3C6C0,
} from "../../gen/routines";
import { cur, rd, wr, inc, dec, isNeg, neg, despawnReturn, stateHandlerB3, registerRts, registerSprite } from "./b3b_common";
import { force_sprite_submerged, make_sprite_fall_off_screen } from "./b3b_misc";
import { CODE_B3B753 } from "./b3b_lockjaw";

const FLOTSAM_STATES = (L("flotsam_main") + 0x03) & 0xffff;
const SHURI_STATES = (L("shuri_main") + 0x03) & 0xffff;

/**
 * Collision checks of the aquatic enemies (`LDA #$0118 : JSL check_throwable_collision_global`,
 * then the Kong check with flags $1400). Returns true when defeated (collision with result 0).
 */
function aquaticHit(): boolean {
  reg.a = 0x0118;
  check_throwable_collision_global();
  if (!reg.c) {
    get_current_sprite_clipping();
    reg.a = 0x1400;
    CODE_BEBE8B();
    if (!reg.c) return false;
  }
  return (reg.a & 0xffff) === 0;
}

// ---------------------------------------------------------------------------------------------
// Flotsam
// ---------------------------------------------------------------------------------------------

/** $B3B8F0 */
export function flotsam_main(): void {
  stateHandlerB3(FLOTSAM_STATES, [flotsamInit, flotsamSwim, flotsamDefeated]);
}

/** .init_state: a Flotsam placed above the water is deleted (unless $5C says otherwise). */
function flotsamInit(): void {
  const y = reg.y;
  if (rd(y, sprite.y_position) < r16(R.water_y_position) && rd(y, sprite.unknown_5C) === 0) {
    delete_sprite_handle_deallocation();
    return;
  }
  reg.x = y;
  inc(reg.x, sprite.state);
  flotsamSwim();
}

/** .state_1: swim along the path (with the looping swim sound). */
function flotsamSwim(): void {
  w16(R.wind_loop_sound_enabler, (r16(R.wind_loop_sound_enabler) + 1) & 0xffff);
  if (aquaticHit()) {
    inc(reg.x, sprite.state);
    reg.a = C.flotsam_death_anim_id;
    defeat_aquatic_sprite_using_anim();
    despawnReturn();
    return;
  }
  process_current_movement();
  force_sprite_submerged();
  process_sprite_animation();
  despawnReturn();
}

/** .defeated_state */
function flotsamDefeated(): void {
  process_current_movement();
  process_sprite_animation();
  make_sprite_fall_off_screen();
}

// ---------------------------------------------------------------------------------------------
// Shuri
// ---------------------------------------------------------------------------------------------

/** $B3B94F */
export function shuri_main(): void {
  stateHandlerB3(SHURI_STATES, [CODE_B3B958, CODE_B3B9A7, CODE_B3BA88]);
}

/** $B3B958 — state 0: drift along its path (stopped on the first frame). */
export function CODE_B3B958(): void {
  reg.x = reg.a;
  if (reg.x === 0) {
    reg.x = reg.y;
    wr(reg.x, sprite.x_speed, 0);
    wr(reg.x, sprite.y_speed, 0);
    inc(reg.x, sprite.sub_state);
  }
  CODE_B3B962();
}

/** $B3B962 */
export function CODE_B3B962(): void {
  if (aquaticHit()) return CODE_B3BA93();
  CODE_B3B97D();
}

/** $B3B978 — collision happened: A = 0 means defeated. */
export function CODE_B3B978(): void {
  if ((reg.a & 0xffff) === 0) return CODE_B3BA93();
  CODE_B3B97D();
}

/** $B3B97D */
export function CODE_B3B97D(): void {
  process_current_movement();
  CODE_B3B98B();
  process_sprite_animation();
  despawnReturn();
}

/** $B3B98B — bounce off the water surface (unless $5C is set). */
export function CODE_B3B98B(): void {
  reg.x = cur();
  const x = reg.x;
  if (rd(x, sprite.unknown_5C) !== 0) return;
  reg.a = r16(R.water_y_position);
  if (reg.a < rd(x, sprite.y_position)) return;
  wr(x, sprite.y_position, reg.a);
  reg.a = rd(x, sprite.max_y_speed);
  if (!isNeg(reg.a)) return;
  reg.a = neg(reg.a);
  wr(x, sprite.max_y_speed, reg.a);
  wr(x, sprite.y_speed, reg.a);
}

/** $B3B9A6 */
export function CODE_B3B9A6(): void {}

const SHURI_SUB = [CODE_B3B9B3, CODE_B3B9BE, CODE_B3BA04, CODE_B3BA48];

/** $B3B9A7 — state 1: wait for the Kong, spin towards him, then glide on. */
export function CODE_B3B9A7(): void {
  reg.x = reg.a;
  SHURI_SUB[reg.x >> 1]();
}

/** $B3B9B3 — sub state 0: stop and remember the home height. */
export function CODE_B3B9B3(): void {
  reg.x = reg.y;
  const x = reg.x;
  wr(x, sprite.x_speed, 0);
  wr(x, sprite.y_speed, 0);
  wr(x, 0x44, rd(x, sprite.y_position));
  inc(x, sprite.sub_state);
  CODE_B3B9BE();
}

/** $B3B9BE — sub state 1: wait until the Kong is in range (ranges in ground_y_position/distance). */
export function CODE_B3B9BE(): void {
  if (aquaticHit()) return CODE_B3BA93();
  CODE_B3B9D9();
}

/** $B3B9D4 */
export function CODE_B3B9D4(): void {
  if ((reg.a & 0xffff) === 0) return CODE_B3BA93();
  CODE_B3B9D9();
}

/** $B3B9D9 */
export function CODE_B3B9D9(): void {
  reg.x = reg.y;
  const x = reg.x;
  reg.a = rd(x, sprite.ground_y_position);
  reg.y = rd(x, sprite.ground_distance);
  CODE_B3C6C0();
  if (!reg.c) {
    inc(reg.x, sprite.sub_state);
    CODE_B3BA6E();
    reg.a = C.shuri_spin_anim_id;
    set_sprite_animation();
    reg.x = cur();
    wr(reg.x, sprite.animation_speed, 0x0200);
  }
  CODE_B3B9F6();
}

/** $B3B9F6 */
export function CODE_B3B9F6(): void {
  process_current_movement();
  force_sprite_submerged();
  process_sprite_animation();
  despawnReturn();
}

/** $B3BA04 — sub state 2: spin in place, re-aiming at the Kong; then launch towards him. */
export function CODE_B3BA04(): void {
  if (aquaticHit()) return CODE_B3BA93();
  CODE_B3BA1C();
}

/** $B3BA1A */
export function CODE_B3BA1A(): void {
  if ((reg.a & 0xffff) === 0) return CODE_B3BA93();
  CODE_B3BA1C();
}

/** $B3BA1C */
export function CODE_B3BA1C(): void {
  process_current_movement();
  if (rd(reg.x, sprite.terrain_interaction) === 0x000f) CODE_B3BA6E();
  CODE_B3BA2A();
}

/** $B3BA2A */
export function CODE_B3BA2A(): void {
  const x = reg.x;
  if (isNeg(dec(x, sprite.terrain_interaction))) {
    inc(x, sprite.sub_state);
    wr(x, sprite.movement_state, 0x000f);
    wr(x, 0x48, rd(x, sprite.unknown_22));
    reg.a = rd(x, sprite.unknown_28);
    CODE_B3B753();
  }
  CODE_B3BA3E();
}

/** $B3BA3E */
export function CODE_B3BA3E(): void {
  force_sprite_submerged();
  process_sprite_animation();
  despawnReturn();
}

/** $B3BA48 — sub state 3: glide. */
export function CODE_B3BA48(): void {
  if (aquaticHit()) return CODE_B3BA93();
  CODE_B3BA60();
}

/** $B3BA5E */
export function CODE_B3BA5E(): void {
  if ((reg.a & 0xffff) === 0) return CODE_B3BA93();
  CODE_B3BA60();
}

/** $B3BA60 */
export function CODE_B3BA60(): void {
  process_current_movement();
  force_sprite_submerged();
  process_sprite_animation();
  despawnReturn();
}

/** $B3BA6E — target = the Kong's position (but at least 24 px under the surface). */
export function CODE_B3BA6E(): void {
  const x = reg.x;
  reg.y = r16(R.active_kong_sprite);
  wr(x, 0x4e, rd(reg.y, sprite.x_position));
  reg.a = (r16(R.water_y_position) + 0x0018) & 0xffff;
  if (reg.a < rd(reg.y, sprite.y_position)) reg.a = rd(reg.y, sprite.y_position);
  CODE_B3BA85();
}

/** $B3BA85 */
export function CODE_B3BA85(): void {
  wr(reg.x, sprite.general_purpose_50, reg.a);
}

/** $B3BA88 — state 2: defeated. */
export function CODE_B3BA88(): void {
  process_current_movement();
  process_sprite_animation();
  make_sprite_fall_off_screen();
}

/** $B3BA93 — defeated (X = the sprite as left by the collision check). */
export function CODE_B3BA93(): void {
  wr(reg.x, sprite.state, 0x0002);
  reg.a = C.shuri_death_anim_id;
  defeat_aquatic_sprite_using_anim();
  despawnReturn();
}

registerSprite({
  flotsam_main, shuri_main, CODE_B3B958, CODE_B3B962, CODE_B3B978, CODE_B3B97D, CODE_B3B9A7, CODE_B3B9B3,
  CODE_B3B9BE, CODE_B3B9D4, CODE_B3B9D9, CODE_B3B9F6, CODE_B3BA04, CODE_B3BA1A, CODE_B3BA1C, CODE_B3BA2A,
  CODE_B3BA3E, CODE_B3BA48, CODE_B3BA5E, CODE_B3BA60, CODE_B3BA88, CODE_B3BA93,
});
registerRts({ CODE_B3B98B, CODE_B3B9A6, CODE_B3BA6E, CODE_B3BA85 });
