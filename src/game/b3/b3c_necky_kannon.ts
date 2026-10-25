/**
 * Bank $B3 — Mini-Necky ($B3BC6B), Kannon ($B3BE52) and the cannonballs / barrels that
 * Kannons shoot (shot_canball_or_barrel_main, $B3BF57).
 */
import { r16, w16, rom16, bus16 } from "../../core/mem";
import { reg } from "../../core/cpu";
import { L, R, C, sprite } from "../../core/sym";
import {
  check_throwable_collision_global,
  get_current_sprite_clipping,
  CODE_BEBE8B,
  CODE_BEBD8E,
  process_current_movement,
  process_sprite_animation,
  process_alternate_movement,
  set_sprite_animation,
  defeat_sprite_using_animation,
  check_if_sprite_offscreen_global,
  delete_sprite_handle_deallocation,
  delete_sprite_if_offscreen,
  spawn_special_sprite_address,
  spawn_special_sprite_index,
  spawn_no_gfx_special_sprite_index,
  queue_sound_effect,
  interpolate_x_velocity_global,
  process_terrain_interaction_global,
  CODE_B39779,
} from "../../gen/routines";
import {
  cur, sr, sw, sr8, sw8, sinc, sdec, neg, isNeg, asr1, facingLeft, sound, spriteConst,
  spriteStateHandler, jumpTable, returnHandleDespawn, fallOffScreen,
  registerSprite, registerRts,
} from "./b3c_common";
import { CODE_B3C6C0 } from "./b3c_kutlass_krook";

/** The common "defeated by an attack" reaction: face the attacker (colliding_sprite). */
export function faceAttacker() {
  const attackerDir = sr(r16(R.colliding_sprite), sprite.oam_property) & 0x4000;
  const x = cur();
  reg.x = x;
  const oam = sr(x, sprite.oam_property);
  sw(x, sprite.oam_property, (((attackerDir ^ oam) & 0x4000) ^ oam) ^ 0x4000);
}

/** Knocked away from the attacker: x speed $100 away, y speed -$600, movement 4 (defeated). */
export function launchDefeated(x: number) {
  const speed = facingLeft(x) ? 0x0100 : 0xff00;
  sw(x, sprite.max_x_speed, speed);
  sw(x, sprite.x_speed, speed);
  sw(x, sprite.y_speed, 0xfa00);
  sw(x, sprite.movement_state, 0x0004);
}

// =============================================================================================
// Mini-Necky

const MINI_NECKY_TABLE = L("mini_necky_main") + 3;

/** $B3BC6B */
export function mini_necky_main() {
  spriteStateHandler(MINI_NECKY_TABLE);
}

/** $B3BC84 — state 0: fly; when the $4E timer runs out, swoop (state 2). */
export function CODE_B3BC84() {
  CODE_B3BDC7();
  if (reg.c) return CODE_B3BCA0();
  const x = reg.x;
  if (!isNeg(sdec(x, 0x4e))) return CODE_B3BC98();
  CODE_B3BDA7();
  sw(x, sprite.state, 0x0002);
  returnHandleDespawn();
}

/** $B3BC98 */
export function CODE_B3BC98() {
  process_current_movement();
  process_sprite_animation();
  CODE_B3BCA0();
}

/** $B3BCA0 */
export function CODE_B3BCA0() {
  returnHandleDespawn();
}

/** $B3BCA3 — state 6: hover until the Kong comes within range ($4C/$4E), then back to state 0. */
export function CODE_B3BCA3() {
  CODE_B3BDC7();
  if (reg.c) return CODE_B3BCBD();
  const x = cur();
  reg.x = x;
  reg.a = sr(x, sprite.terrain_attributes);
  reg.y = sr(x, sprite.terrain_interaction);
  CODE_B3C6C0();
  if (!reg.c) sw(reg.x, sprite.state, 0);
  CODE_B3BCB5();
}

/** $B3BCB5 */
export function CODE_B3BCB5() {
  process_current_movement();
  process_sprite_animation();
  CODE_B3BCBD();
}

/** $B3BCBD */
export function CODE_B3BCBD() {
  returnHandleDespawn();
}

/** $B3BCC0 — state 2: swooping. */
export function CODE_B3BCC0() {
  CODE_B3BDC7();
  if (!reg.c) {
    process_current_movement();
    process_sprite_animation();
  }
  CODE_B3BCCD();
}

/** $B3BCCD */
export function CODE_B3BCCD() {}

/** $B3BCD0 — state 3: start flying along a path (speeds loaded from the spawn parameters). */
export function CODE_B3BCD0() {
  const x = reg.y;
  reg.x = x;
  sinc(x, sprite.state);
  sw(x, sprite.y_speed, sr(x, sprite.ground_y_position));
  sw(x, sprite.max_y_speed, sr(x, sprite.ground_distance));
  sw(x, sprite.x_speed, sr(x, sprite.unknown_22));
  sw(x, sprite.max_x_speed, sr(x, sprite.unknown_28));
  CODE_B3BCE3();
}

/** $B3BCE3 — state 4: fly until the target y speed is reached, then despawn when offscreen. */
export function CODE_B3BCE3() {
  CODE_B3BDC7();
  if (!reg.c) {
    process_current_movement();
    process_sprite_animation();
  }
  CODE_B3BCF0();
}

/** $B3BCF0 */
export function CODE_B3BCF0() {
  const x = cur();
  reg.x = x;
  if (sr(x, sprite.max_y_speed) !== sr(x, sprite.y_speed)) return CODE_B3BCFE();
  reg.a = 0x00b4;
  CODE_B3BE28();
  CODE_B3BCFE();
}

/** $B3BCFE */
export function CODE_B3BCFE() {}

/** $B3BD01 — state 5: defeated. */
export function CODE_B3BD01() {
  process_current_movement();
  process_sprite_animation();
  fallOffScreen();
}

/** $B3BD0C — state 1: flap in place for gp50 frames, then state 7. */
export function CODE_B3BD0C() {
  CODE_B3BDC7();
  const c = reg.c;
  const x = cur();
  reg.x = x;
  if (c) return CODE_B3BD36();
  if (isNeg(sdec(x, sprite.general_purpose_50))) {
    sw(x, sprite.state, 0x0007);
    sw8(x, sprite.movement_sub_state, 0);
    return CODE_B3BD36();
  }
  CODE_B3BD24();
}

/** $B3BD24 */
export function CODE_B3BD24() {
  reg.a = 0x0002;
  process_alternate_movement();
  reg.a = 0x0006;
  process_alternate_movement();
  process_sprite_animation();
  CODE_B3BD36();
}

/** $B3BD36 */
export function CODE_B3BD36() {}

/** $B3BD39 — state 7: like state 0, but the swoop goes to state 8. */
export function CODE_B3BD39() {
  CODE_B3BDC7();
  if (reg.c) return CODE_B3BD52();
  const x = reg.x;
  if (!isNeg(sdec(x, 0x4e))) return CODE_B3BD4A();
  sinc(x, sprite.state);
  CODE_B3BDA7();
  returnHandleDespawn();
}

/** $B3BD4A */
export function CODE_B3BD4A() {
  process_current_movement();
  process_sprite_animation();
  CODE_B3BD52();
}

/** $B3BD52 */
export function CODE_B3BD52() {}

/** $B3BD55 — state 8 */
export function CODE_B3BD55() {
  CODE_B3BCC0();
}

/** $B3BD58 — state 9: like state 3, then state 10. */
export function CODE_B3BD58() {
  const x = reg.y;
  reg.x = x;
  sinc(x, sprite.state);
  sw(x, sprite.y_speed, sr(x, sprite.ground_y_position));
  sw(x, sprite.max_y_speed, sr(x, sprite.ground_distance));
  sw(x, sprite.x_speed, sr(x, sprite.unknown_22));
  sw(x, sprite.max_x_speed, sr(x, sprite.unknown_28));
  CODE_B3BD6B();
}

/** $B3BD6B — state 10: fly away, deleted once past the edge of the screen it flies towards. */
export function CODE_B3BD6B() {
  CODE_B3BDC7();
  if (!reg.c) {
    process_current_movement();
    process_sprite_animation();
  }
  CODE_B3BD78();
}

/** $B3BD78 */
export function CODE_B3BD78() {
  const x = cur();
  reg.x = x;
  if (sr(x, sprite.max_y_speed) === sr(x, sprite.y_speed)) CODE_B3BD83();
}

/** $B3BD83 */
export function CODE_B3BD83() {
  const x = reg.x;
  if (!facingLeft(x)) return CODE_B3BD95();
  if (((r16(R.screen_scroll_x_position) + 0x0120) & 0xffff) < sr(x, sprite.x_position)) CODE_B3BDA0();
}

/** $B3BD95 */
export function CODE_B3BD95() {
  const x = reg.x;
  if (((r16(R.screen_scroll_x_position) - 0x0020) & 0xffff) >= sr(x, sprite.x_position)) return CODE_B3BDA4();
  CODE_B3BDA0();
}

/** $B3BDA0 */
export function CODE_B3BDA0() {
  delete_sprite_handle_deallocation();
  CODE_B3BDA4();
}

/** $B3BDA4 */
export function CODE_B3BDA4() {}

/** $B3BDA7 — start the swoop towards the Kong (X = sprite). */
export function CODE_B3BDA7() {
  const x = reg.x;
  sw(x, sprite.max_x_speed, 0);
  sw(x, sprite.max_y_speed, 0);
  sw(x, sprite.y_speed, 0xff80);
  CODE_B3BDB8(facingLeft(x) ? 0x0100 : 0xff00);
}

/** $B3BDB8 */
export function CODE_B3BDB8(speed = reg.a) {
  const x = reg.x;
  sw(x, sprite.x_speed, speed);
  sw(x, sprite.movement_state, 0x000f);
  reg.a = C.mini_necky_swoop_anim_id;
  set_sprite_animation();
}

/**
 * $B3BDC7 — collision check: carry set when the Mini-Necky was hit (then it is defeated) or
 * when it hurt a Kong.
 */
export function CODE_B3BDC7() {
  reg.a = 0x0118;
  check_throwable_collision_global();
  if (reg.c) return CODE_B3BDDE();
  get_current_sprite_clipping();
  reg.a = 0x5428;
  CODE_BEBE8B();
  if (reg.c) return CODE_B3BDDE();
  CODE_B3BDDD();
}

/** $B3BDDD */
export function CODE_B3BDDD() {}

/** $B3BDDE — Z clear: the Kong was hurt, nothing to do; else defeat the Mini-Necky. */
export function CODE_B3BDDE() {
  if (!reg.z) return CODE_B3BDDD();
  faceAttacker();
  const x = reg.x;
  CODE_B3BDFF(facingLeft(x) ? 0x0100 : 0xff00);
}

/** $B3BDFF */
export function CODE_B3BDFF(speed = reg.a) {
  const x = reg.x;
  sw(x, sprite.max_x_speed, speed);
  sw(x, sprite.x_speed, speed);
  sw(x, sprite.y_speed, 0xfa00);
  sw(x, sprite.movement_state, 0x0004);
  reg.a = C.mini_necky_death_anim_id;
  defeat_sprite_using_animation();
  const x2 = reg.x;
  if (r16(R.level_number) === C.level_kreepy_krow) {
    sw(x2, sprite.oam_property, sr(x2, sprite.oam_property) ^ 0x2000);
  }
  CODE_B3BE21();
}

/** $B3BE21 */
export function CODE_B3BE21() {
  sw(reg.x, sprite.state, 0x0005);
  reg.c = true;
}

/**
 * $B3BE28 — once offscreen, turn the sprite into a respawn suppressor that remembers A
 * (pushed on the stack, popped by CODE_B3BE31).
 */
export function CODE_B3BE28() {
  const saved = reg.a;
  check_if_sprite_offscreen_global();
  if (reg.c) return CODE_B3BE31(saved);
  reg.a = saved;
}

/** $B3BE31 — (A on the stack, so this takes it as a parameter; not a trap target) */
export function CODE_B3BE31(saved: number) {
  delete_sprite_handle_deallocation();
  const x = cur();
  reg.x = x;
  sw(x, sprite.type, C.sprite_respawn_suppressor);
  sw(x, sprite.state, 0x0001);
  sw(x, 0x42, saved);
  sw(x, sprite.placement_parameter, 0x0002);
  sw(x, sprite.current_graphic, 0);
  sw(x, sprite.last_rendered_graphic, 0);
  sw(x, sprite.x_position, 0);
  sw(x, sprite.y_position, 0);
  reg.a = 0x0002;
}

// =============================================================================================
// Kannon

const KANNON_TABLE = L("kannon_main") + 3;
const KANNON_SUB_STATE_TABLE = L("kannon_main_sub_state_table");

/** $B3BE52 */
export function kannon_main() {
  spriteStateHandler(KANNON_TABLE);
}

/** $B3BE59 .handle_sub_state */
export function kannon_main_handle_sub_state() {
  jumpTable(KANNON_SUB_STATE_TABLE, reg.a);
}

/** $B3BE63 .init_sub_state — remember the ground y, start the projectile pattern at 0. */
export function kannon_main_init_sub_state() {
  const x = reg.y;
  reg.x = x;
  sw(x, sprite.ground_y_position, sr(x, sprite.y_position));
  sinc(x, sprite.sub_state);
  sw(x, 0x28, 0);
  kannon_main_sub_state_1();
}

/** $B3BE6C .sub_state_1 — idle / aiming; the idle animation sets sub-state 2 to fire. */
export function kannon_main_sub_state_1() {
  kannonHandleCollision();
  if (!reg.c) {
    process_current_movement();
    process_sprite_animation();
  }
  returnHandleDespawn();
}

/** $B3BE7C .sub_state_2 — fire the next projectile of the pattern. */
export function kannon_main_sub_state_2() {
  kannonFireProjectile();
  if (!reg.c) {
    const x = cur();
    reg.x = x;
    sdec(x, sprite.sub_state);
  }
  kannon_main_sub_state_1();
}

/** $B3BE87 .defeated_state */
export function kannon_main_defeated_state() {
  process_current_movement();
  process_sprite_animation();
  fallOffScreen();
}

/** $B3BE92 .handle_collision — carry set when a collision happened. */
function kannonHandleCollision() {
  reg.a = 0x0118;
  check_throwable_collision_global();
  if (!reg.c) {
    get_current_sprite_clipping();
    reg.a = 0x5428;
    CODE_BEBE8B();
  }
  if (!reg.c || !reg.z) {
    // no collision, or the attacker took the damage
    reg.c = false;
    return;
  }
  faceAttacker();
  const x = reg.x;
  launchDefeated(x);
  reg.a = C.kannon_death_anim_id;
  defeat_sprite_using_animation();
  sw(reg.x, sprite.state, 0x0001);
  reg.c = true;
}

/**
 * $B3BEE6 .fire_projectile — spawn the next projectile of the Kannon's pattern ($22 = pattern
 * address in bank $FF, $28 = index). Carry set when nothing was fired.
 */
function kannonFireProjectile() {
  const kong = r16(R.active_kong_sprite);
  reg.y = kong;
  if ((sr(kong, sprite.animation_flags) & 0xe000) === 0xe000) {
    reg.c = true;
    return;
  }
  let x = cur();
  reg.x = x;
  const pattern = sr(x, 0x22);
  w16(R.temp_32, pattern);
  w16(R.temp_34, 0x00ff);
  let y = sr(x, 0x28);
  const at = (i: number) => bus16((0xff0000 | pattern) + (i & 0xffff));
  reg.y = at(y);
  reg.a = reg.y;
  spawn_special_sprite_address();
  reg.y = y;
  if (reg.c) return;
  x = cur();
  w16(R.temp_32, sr(x, 0x22));
  w16(R.temp_34, 0x00ff);
  const shot = r16(R.alternate_sprite);
  y += 2;
  sw(shot, sprite.general_purpose_50, at(y) & 0xff); // projectile speed preset
  y++;
  sw(x, sprite.general_purpose_50, at(y) & 0xff); // firing delay
  y++;
  sw(x, 0x28, at(y) === 0 ? 0 : y); // next pattern entry (0 = loop)
  sw(shot, 0x4e, sr(x, sprite.y_position) + 0x0010);
  sw(shot, sprite.despawn_time, sr(x, 0x4e));
  reg.x = x;
  reg.y = shot;
  reg.a = sound(5, "cannon_shoot");
  queue_sound_effect();
  reg.y = spriteConst(0x0008); // smoke puff
  spawn_special_sprite_index();
  reg.c = false;
}

// =============================================================================================
// Shot cannonball / barrel

const SHOT_TABLE = L("shot_canball_or_barrel_main") + 3;
const SHOT_SUB_STATE_TABLE = L("CODE_B3BF62") + 4;
const DATA_B3C0AE = L("DATA_B3C0AE");
const FF6A98 = L("DATA_FF6A98");
const FF6B20 = L("DATA_FF6B20");

/** $B3BF57 — "this monstrosity uses a tertiary state after normal and sub states" */
export function shot_canball_or_barrel_main() {
  spriteStateHandler(SHOT_TABLE);
}

/** $B3BF62 — state 0: dropped projectile, by sub-state. */
export function CODE_B3BF62() {
  jumpTable(SHOT_SUB_STATE_TABLE, reg.a);
}

/** idx * 10 or * 11 the way the original computes it (ASL/ADC chains keep the carry). */
function mulChain(g: number, eleven: boolean): number {
  const a1 = (g << 1) & 0xffff;
  const c1 = (a1 & 0x8000) !== 0; // carry out of the second ASL
  const a2 = (a1 << 1) & 0xffff;
  let s = a2 + g + (c1 ? 1 : 0);
  let a = s & 0xffff;
  const c2 = (a & 0x8000) !== 0;
  a = (a << 1) & 0xffff;
  if (eleven) a = (a + g + (c2 ? 1 : 0)) & 0xffff;
  return a;
}

/** $B3BF70 — sub-state 0: load the drop parameters from table $FF6A98 (10 bytes each). */
export function CODE_B3BF70() {
  const y = reg.y;
  const i = mulChain(sr(y, sprite.general_purpose_50), false);
  const t = (o: number) => rom16(FF6A98 + i + o);
  sw(y, 0x46, t(8));
  sw(y, 0x44, t(6));
  sw(y, 0x42, t(4));
  sw(y, sprite.max_y_speed, t(2));
  sw(y, sprite.y_speed, t(2));
  let a = t(0);
  reg.x = y;
  if (facingLeft(y)) a = neg(a);
  CODE_B3BFA6(a);
}

/** $B3BFA6 */
export function CODE_B3BFA6(a = reg.a) {
  const x = reg.x;
  sw(x, sprite.max_x_speed, a);
  sw(x, sprite.x_speed, 0);
  sw(x, sprite.x_sub_position, 0);
  sw(x, sprite.y_sub_position, 0);
  sw(x, sprite.unknown_2C, 0);
  sw(x, sprite.terrain_interaction, 0);
  sinc(x, sprite.sub_state);
  CODE_B3BFB4();
}

/** $B3BFB4 — sub-state 1 */
export function CODE_B3BFB4() {
  CODE_B3BFDA(0);
}

/** $B3BFB9 — sub-state 2: once falling, draw in front and stop interacting if moving sideways. */
export function CODE_B3BFB9() {
  const x = reg.y;
  reg.x = x;
  if (!isNeg(sr(x, sprite.y_speed))) {
    sw(x, sprite.oam_property, sr(x, sprite.oam_property) | 0x3000);
    if (sr(x, sprite.max_x_speed) !== 0) sw(x, sprite.interaction_flags, 0);
  }
  CODE_B3BFCB();
}

/** $B3BFCB — sub-state 3 */
export function CODE_B3BFCB() {
  const x = reg.y;
  reg.x = x;
  const bounce = sr(x, 0x46);
  if (bounce !== 0 && !isNeg(sr(x, sprite.y_speed))) {
    reg.y = sr(x, sprite.max_x_speed);
    if (reg.y !== 0) sw(x, sprite.interaction_flags, 0);
  }
  CODE_B3BFDA(bounce);
}

/** $B3BFDA — fall to the floor at $4E, then bounce with the speed in A. */
export function CODE_B3BFDA(bounce = reg.a) {
  w16(R.temp_32, bounce);
  CODE_B3C1DD();
  if (reg.c) return CODE_B3C00B();
  reg.a = 0x0004;
  process_alternate_movement();
  const x = reg.x;
  const floor = sr(x, 0x4e);
  if (floor >= sr(x, sprite.y_position)) return CODE_B3C00B();
  sw(x, sprite.y_position, floor);
  reg.a = r16(R.temp_32);
  CODE_B3C051();
  if (reg.z) return CODE_B3C00B();
  sw(reg.x, 0x46, 0);
  reg.y = C.special_sprite_spawn_id_0072;
  spawn_no_gfx_special_sprite_index();
  reg.a = sound(6, "cannonball_drop");
  queue_sound_effect();
  process_sprite_animation();
  CODE_B3C00B();
}

/** $B3C00B */
export function CODE_B3C00B() {
  CODE_B3C07D();
}

/** $B3C00E — sub-state 4: roll along the floor, bounce when landing. */
export function CODE_B3C00E() {
  CODE_B3C1DD();
  if (reg.c) return CODE_B3C04E();
  const saved = sr(reg.x, sprite.max_x_speed);
  reg.a = 0x0020;
  process_alternate_movement();
  const x = reg.x;
  sw(x, sprite.max_x_speed, saved);
  if (sr(x, sprite.terrain_interaction) & 0x0001) {
    sw(x, sprite.terrain_interaction, 0);
    reg.a = sr(x, 0x44);
    CODE_B3C051();
    if (!reg.z) {
      sw(reg.x, sprite.render_order, 0x00ec);
      reg.y = C.special_sprite_spawn_id_006E;
      spawn_no_gfx_special_sprite_index();
      reg.y = C.special_sprite_spawn_id_0070;
      spawn_no_gfx_special_sprite_index();
      reg.a = sound(6, "cannonball_drop");
      queue_sound_effect();
    }
  }
  CODE_B3C04A();
}

/** $B3C04A */
export function CODE_B3C04A() {
  process_sprite_animation();
  CODE_B3C04E();
}

/** $B3C04E */
export function CODE_B3C04E() {
  CODE_B3C07D();
}

/**
 * $B3C051 — bounce with speed A (0 = stop: sub-state 4; negative = sub-state 3; positive = up,
 * sub-state 2). Z set (A = 0) when there is no bounce.
 */
export function CODE_B3C051() {
  const a = reg.a & 0xffff;
  if (a === 0) return CODE_B3C074();
  if (isNeg(a)) return CODE_B3C060();
  sw(reg.x, sprite.y_speed, neg(a));
  CODE_B3C065(0x0200);
}

/** $B3C060 */
export function CODE_B3C060() {
  sw(reg.x, sprite.y_speed, reg.a);
  CODE_B3C065(0x0300);
}

/** $B3C065 */
export function CODE_B3C065(state = reg.a) {
  const x = reg.x;
  sw(x, sprite.state, state);
  sw(x, 0x4e, sr(x, sprite.y_position) + sr(x, 0x42));
  sw(x, 0x42, 0x0080);
  reg.a = 0x0080;
  reg.z = false;
}

/** $B3C074 */
export function CODE_B3C074() {
  sw(reg.x, sprite.state, 0x0400);
  reg.a = 0;
  reg.z = true;
}

/** $B3C07D — leave; a projectile with a despawn time falls off when far below the screen. */
export function CODE_B3C07D() {
  const x = cur();
  reg.x = x;
  if (sr(x, sprite.despawn_time) === 0) return CODE_B3C091();
  if (((sr(x, sprite.y_position) - 0x00e0) & 0xffff) >= r16(R.screen_scroll_y_position)) return CODE_B3C091();
}

/** $B3C091 */
export function CODE_B3C091() {
  fallOffScreen();
}

/** $B3C094 — states 1 and 2: shot horizontally, by sub-state (unless the Kong is in a barrel). */
export function CODE_B3C094() {
  const index = reg.a & 0xffff;
  reg.x = index;
  const kong = r16(R.active_kong_sprite);
  reg.y = kong;
  if ((sr(kong, sprite.animation_flags) & 0xe000) === 0xe000) {
    CODE_B3C24C();
    return;
  }
  CODE_B3C0A9();
}

/** $B3C0A9 */
export function CODE_B3C0A9() {
  reg.y = cur();
  jumpTable(DATA_B3C0AE, reg.x);
}

/** $B3C0B4 — sub-state 0: load the flight parameters from table $FF6B20 (11 bytes each). */
export function CODE_B3C0B4() {
  const y = reg.y;
  const i = mulChain(sr(y, sprite.general_purpose_50), true);
  const t = (o: number) => rom16(FF6B20 + i + o);
  sw(y, 0x48, t(9));
  sw(y, 0x46, t(8) & 0xff);
  sw(y, 0x44, t(7) & 0xff);
  sw(y, sprite.y_speed, t(5));
  sw(y, 0x42, t(4) & 0x1f);
  sw(y, sprite.max_x_speed, t(2));
  const a = t(0);
  sw(y, sprite.x_speed, a);
  reg.x = y;
  if (facingLeft(y)) {
    sw(y, sprite.x_speed, neg(a));
    sw(y, sprite.max_x_speed, neg(sr(y, sprite.max_x_speed)));
  }
  CODE_B3C10E();
}

/** $B3C10E */
export function CODE_B3C10E() {
  const x = reg.x;
  sw(x, sprite.x_sub_position, 0);
  sw(x, sprite.y_sub_position, 0);
  sw(x, sprite.unknown_2C, 0);
  sw(x, sprite.terrain_interaction, 0);
  sinc(x, sprite.sub_state);
  CODE_B3C118();
}

/** $B3C118 — sub-state 1: fly; deleted once it has left the screen. */
export function CODE_B3C118() {
  CODE_B3C1DD();
  if (!reg.c) {
    CODE_B3C16C();
    if (reg.c) sinc(cur(), sprite.sub_state);
  }
  CODE_B3C126();
}

/** $B3C126 */
export function CODE_B3C126() {
  process_sprite_animation();
  const x = cur();
  reg.x = x;
  if (sr(x, sprite.despawn_time) === 0) return CODE_B3C14A();
  const xp = sr(x, sprite.x_position);
  reg.a = xp;
  if (isNeg(sr(x, sprite.x_speed))) return CODE_B3C142();
  if (((xp - 0x0100) & 0xffff) >= r16(R.screen_scroll_x_position)) CODE_B3C14A();
}

/** $B3C142 */
export function CODE_B3C142() {
  if ((reg.a & 0xffff) < r16(R.screen_scroll_x_position)) CODE_B3C14A();
}

/** $B3C14A */
export function CODE_B3C14A() {
  delete_sprite_if_offscreen();
}

/** $B3C151 — sub-state 2: once it starts falling it is harmless and falls off (state 3). */
export function CODE_B3C151() {
  const y = reg.y;
  if (isNeg(sr(y, sprite.y_speed))) return CODE_B3C118();
  reg.x = y;
  sw(y, sprite.oam_property, sr(y, sprite.oam_property) | 0x3000);
  sw(y, sprite.interaction_flags, 0);
  sw(y, sprite.state, 0x0003);
  sw(y, sprite.movement_state, 0x0004);
  CODE_B3C1D2();
}

/** $B3C16C — horizontal flight step; carry set when it hit the floor and bounced. */
export function CODE_B3C16C() {
  let x = cur();
  reg.x = x;
  reg.a = sr(x, 0x42);
  interpolate_x_velocity_global();
  x = reg.y;
  reg.x = x;
  if (sr(x, 0x44) !== 0) {
    sdec(x, 0x44);
    return CODE_B3C18F();
  }
  CODE_B3C17D();
}

/** $B3C17D — apply gravity ($46) up to the max fall speed in the constants. */
export function CODE_B3C17D() {
  const x = reg.x;
  let a = (sr(x, 0x46) + sr(x, sprite.y_speed)) & 0xffff;
  if (!isNeg(a)) {
    reg.y = 0x0002;
    const max = spriteConst(0x0002);
    if (a >= max) a = max;
  }
  reg.a = a;
  CODE_B3C18D();
}

/** $B3C18D */
export function CODE_B3C18D() {
  sw(reg.x, sprite.y_speed, reg.a);
  CODE_B3C18F();
}

/** $B3C18F */
export function CODE_B3C18F() {
  if (sr(reg.x, 0x48) === 0) return CODE_B3C1C9();
  process_terrain_interaction_global();
  const x = cur();
  reg.x = x;
  if (!(sr(x, sprite.terrain_interaction) & 0x0001)) return CODE_B3C1D0();
  CODE_B3C24C();
  if (reg.c) return CODE_B3C1C8();
  const x2 = reg.x;
  sw(x2, sprite.terrain_interaction, 0);
  sw(x2, sprite.y_speed, sr(x2, 0x48));
  sw(x2, 0x48, 0);
  sw(x2, sprite.render_order, 0x00ec);
  reg.y = C.special_sprite_spawn_id_006E;
  spawn_no_gfx_special_sprite_index();
  reg.y = C.special_sprite_spawn_id_0070;
  spawn_no_gfx_special_sprite_index();
  reg.a = sound(6, "cannonball_drop");
  queue_sound_effect();
  reg.c = true;
}

/** $B3C1C8 */
export function CODE_B3C1C8() {}

/** $B3C1C9 */
export function CODE_B3C1C9() {
  reg.a = 0x0001;
  process_alternate_movement();
  CODE_B3C1D0();
}

/** $B3C1D0 */
export function CODE_B3C1D0() {
  reg.c = false;
}

/** $B3C1D2 — state 3: harmless, falling off the screen. */
export function CODE_B3C1D2() {
  process_current_movement();
  process_sprite_animation();
  fallOffScreen();
}

/**
 * $B3C1DD — collisions of a flying projectile: carry set when it hit something (a barrel
 * explodes, a cannonball is knocked away) or hurt a Kong.
 */
export function CODE_B3C1DD() {
  const x = cur();
  reg.x = x;
  if (sr(x, sprite.interaction_flags) === 0) {
    reg.c = false;
    return CODE_B3C207();
  }
  reg.a = 0x0018;
  check_throwable_collision_global();
  if (reg.c) return CODE_B3C208();
  get_current_sprite_clipping();
  reg.a = 0x0400;
  reg.y = 0x0008;
  CODE_BEBD8E();
  if (reg.c) return CODE_B3C20D();
  reg.x = cur();
  reg.a = sr(reg.x, 0x4a);
  CODE_BEBE8B();
  if (reg.c) return CODE_B3C208();
  CODE_B3C207();
}

/** $B3C207 */
export function CODE_B3C207() {}

/** $B3C208 */
export function CODE_B3C208() {
  if (!reg.z) return CODE_B3C207();
  if ((reg.y & 0xffff) === 0) return CODE_B3C217();
  CODE_B3C20D();
}

/** $B3C20D — hit by sprite Y: take its direction and speed. */
export function CODE_B3C20D() {
  const y = reg.y;
  w16(R.temp_32, sr(y, sprite.oam_property));
  CODE_B3C224(sr(y, sprite.x_speed));
}

/** $B3C217 — hit by a Kong: knocked away from it. */
export function CODE_B3C217() {
  const a = sr(reg.x, sprite.unknown_34);
  w16(R.temp_5E, a);
  CODE_B3C224(isNeg(a) ? 0xff00 : 0x0100);
}

/** $B3C224 */
export function CODE_B3C224(push = reg.a) {
  w16(R.temp_60, push);
  CODE_B3C24C();
  if (reg.c) return CODE_B3C207();
  const x = cur();
  reg.x = x;
  sw(x, sprite.x_speed, asr1((sr(x, sprite.x_speed) + r16(R.temp_60)) & 0xffff));
  sw(x, sprite.y_speed, 0);
  sw(x, sprite.state, 0x0003);
  sw(x, sprite.movement_state, 0x0004);
  reg.a = C.cannon_ball_anim_id;
  defeat_sprite_using_animation();
  reg.c = true;
}

/** $B3C24C — a shot barrel (state 2) explodes on contact; carry set when it did. */
export function CODE_B3C24C() {
  const x = cur();
  reg.x = x;
  if ((sr(x, sprite.state) & 0x00ff) === 0x0002) return CODE_B3C25A();
  reg.c = false;
}

/** $B3C25A */
export function CODE_B3C25A() {
  reg.a = sound(5, "barrel_blast");
  queue_sound_effect();
  reg.y = C.special_sprite_spawn_id_0074;
  spawn_special_sprite_index();
  CODE_B39779();
  delete_sprite_handle_deallocation();
  reg.c = true;
}

void sr8;

registerSprite({
  mini_necky_main, CODE_B3BC84, CODE_B3BC98, CODE_B3BCA0, CODE_B3BCA3, CODE_B3BCB5, CODE_B3BCBD,
  CODE_B3BCC0, CODE_B3BCCD, CODE_B3BCD0, CODE_B3BCE3, CODE_B3BCF0, CODE_B3BCFE, CODE_B3BD01,
  CODE_B3BD0C, CODE_B3BD24, CODE_B3BD36, CODE_B3BD39, CODE_B3BD4A, CODE_B3BD52, CODE_B3BD55,
  CODE_B3BD58, CODE_B3BD6B, CODE_B3BD78, CODE_B3BD83, CODE_B3BD95, CODE_B3BDA0, CODE_B3BDA4,
  kannon_main, kannon_main_handle_sub_state, kannon_main_init_sub_state, kannon_main_sub_state_1,
  kannon_main_sub_state_2, kannon_main_defeated_state,
  shot_canball_or_barrel_main, CODE_B3BF62, CODE_B3BF70, CODE_B3BFA6, CODE_B3BFB4, CODE_B3BFB9,
  CODE_B3BFCB, CODE_B3BFDA, CODE_B3C00B, CODE_B3C00E, CODE_B3C04A, CODE_B3C04E, CODE_B3C07D,
  CODE_B3C091, CODE_B3C094, CODE_B3C0A9, CODE_B3C0B4, CODE_B3C10E, CODE_B3C118, CODE_B3C126,
  CODE_B3C142, CODE_B3C14A, CODE_B3C151, CODE_B3C1D2,
});
registerRts({
  CODE_B3BDA7, CODE_B3BDB8, CODE_B3BDC7, CODE_B3BDDD, CODE_B3BDDE, CODE_B3BDFF, CODE_B3BE21,
  CODE_B3BE28, CODE_B3C051, CODE_B3C060, CODE_B3C065, CODE_B3C074, CODE_B3C16C, CODE_B3C17D,
  CODE_B3C18D, CODE_B3C18F, CODE_B3C1C8, CODE_B3C1C9, CODE_B3C1D0, CODE_B3C1DD, CODE_B3C207,
  CODE_B3C208, CODE_B3C20D, CODE_B3C217, CODE_B3C224, CODE_B3C24C, CODE_B3C25A,
});
