/**
 * Bank $B3 — Kutlass ($B3C4CE), Krook ($B3C71D) and Krook's thrown hook ($B3C8DD), plus the
 * shared "is the Kong within range" test (CODE_B3C6AF / CODE_B3C6C0) used by many enemies.
 */
import { r16, w16 } from "../../core/mem";
import { reg } from "../../core/cpu";
import { L, R, C, sprite } from "../../core/sym";
import {
  check_for_sprite_crush,
  check_throwable_collision_global,
  get_current_sprite_clipping,
  get_sprite_special_clipping_slot_1,
  CODE_BEBE8B,
  process_current_movement,
  process_sprite_animation,
  process_alternate_movement,
  set_sprite_animation,
  defeat_sprite_using_animation,
  delete_sprite_handle_deallocation,
  queue_sound_effect,
} from "../../gen/routines";
import {
  cur, sr, sw, sr8, sw8, sinc, sdec, neg, isNeg, asr1, facingLeft, sound,
  spriteStateHandler, returnHandleDespawn, fallOffScreen, process_alternate_movement_B3,
  registerSprite, registerRts, registerRtl,
} from "./b3c_common";

/** Face the attacker (colliding_sprite) — the EOR/AND/EOR/EOR idiom. */
function faceAttacker() {
  const attackerDir = sr(r16(R.colliding_sprite), sprite.oam_property) & 0x4000;
  const x = cur();
  reg.x = x;
  const oam = sr(x, sprite.oam_property);
  sw(x, sprite.oam_property, (((attackerDir ^ oam) & 0x4000) ^ oam) ^ 0x4000);
}

/** Knocked away: x speed `speed`, y speed -$600, movement 4 (defeated). */
function launchDefeated(x: number, speed: number) {
  sw(x, sprite.max_x_speed, speed);
  sw(x, sprite.x_speed, speed);
  sw(x, sprite.y_speed, 0xfa00);
  sw(x, sprite.movement_state, 0x0004);
}

// =============================================================================================
// Kutlass

const KUTLASS_TABLE = L("kutlass_main") + 3;

/** $B3C4CE */
export function kutlass_main() {
  spriteStateHandler(KUTLASS_TABLE);
}

/** $B3C4E1 — state 0: patrol; when the Kong comes within range ($4C/$4E), start the chase. */
export function CODE_B3C4E1() {
  const y = reg.y;
  if (sr(y, 0x48) === 0) sw(y, 0x48, sr(y, sprite.max_x_speed)); // remember the walk speed
  CODE_B3C4EC();
}

/** $B3C4EC */
export function CODE_B3C4EC() {
  reg.a = 0x54a0;
  CODE_B3C62A();
  if (reg.c) return CODE_B3C50F();
  process_current_movement();
  process_sprite_animation();
  const x = reg.x;
  reg.a = sr(x, 0x4c);
  reg.y = sr(x, 0x4e);
  CODE_B3C6AF();
  if (reg.c) return CODE_B3C50F();
  const x2 = reg.x;
  sw8(x2, 0x4b, sr8(x2, 0x4a));
  sinc(x2, sprite.state);
  CODE_B3C50F();
}

/** $B3C50F */
export function CODE_B3C50F() {
  returnHandleDespawn();
}

/** $B3C512 — state 1: start the chase, turning first if the Kong is behind. */
export function CODE_B3C512() {
  reg.a = 0x0000;
  CODE_B3C62A();
  if (reg.c) return CODE_B3C550();
  const x = cur();
  reg.x = x;
  sinc(x, sprite.state);
  const kong = r16(R.active_kong_sprite);
  reg.y = kong;
  const kongX = sr(kong, sprite.x_position);
  sw(x, sprite.general_purpose_50, kongX);
  const dx = (kongX - sr(x, sprite.x_position)) & 0xffff;
  w16(R.temp_32, dx);
  if (((dx >> 1) ^ sr(x, sprite.oam_property)) & 0x4000) {
    reg.a = C.kutlass_chase_turn_anim_id;
    set_sprite_animation();
    return returnHandleDespawn();
  }
  CODE_B3C53D();
}

/** $B3C53D — close enough: attack at once, else run. */
export function CODE_B3C53D() {
  const dx = r16(R.temp_32);
  if (dx < 0x0040 || dx >= 0xffc0) return CODE_B3C57E();
  reg.a = C.kutlass_chase_run_anim_id;
  set_sprite_animation();
  CODE_B3C550();
}

/** $B3C550 */
export function CODE_B3C550() {
  returnHandleDespawn();
}

/** $B3C553 — state 2: run towards where the Kong was; attack when there. */
export function CODE_B3C553() {
  reg.a = 0x0000;
  CODE_B3C62A();
  if (reg.c) return CODE_B3C57B();
  reg.a = 0x0022;
  process_alternate_movement_B3();
  const x = reg.x;
  if (sr(x, sprite.animation_id) === C.kutlass_chase_run_anim_id) {
    const dx = (sr(x, sprite.general_purpose_50) - sr(x, sprite.x_position)) & 0xffff;
    if (dx < 0x0040 || dx >= 0xffc0) return CODE_B3C57E();
  }
  CODE_B3C577();
}

/** $B3C577 */
export function CODE_B3C577() {
  process_sprite_animation();
  CODE_B3C57B();
}

/** $B3C57B */
export function CODE_B3C57B() {
  returnHandleDespawn();
}

/** $B3C57E — attack: lunge at half speed unless the Kong is right there (state 3). */
export function CODE_B3C57E() {
  const x = reg.x;
  const kong = r16(R.active_kong_sprite);
  const d = (sr(x, sprite.x_position) - sr(kong, sprite.x_position)) & 0xffff;
  reg.y = d;
  let a = 0;
  if (!(d < 0x0020 || d >= 0xffe0)) a = asr1(sr(x, sprite.max_x_speed));
  reg.a = a;
  CODE_B3C59B();
}

/** $B3C59B */
export function CODE_B3C59B() {
  const x = reg.x;
  sw(x, sprite.max_x_speed, reg.a);
  sw(x, sprite.x_speed, 0);
  sw8(x, sprite.display_mode_high, sr8(x, sprite.display_mode));
  sw(x, sprite.state, 0x0003);
  reg.a = C.kutlass_attack_anim_id;
  set_sprite_animation();
  returnHandleDespawn();
}

/** $B3C5B6 — states 3 and 4: attack animation. */
export function CODE_B3C5B6() {
  reg.a = 0x0000;
  CODE_B3C62A();
  if (!reg.c) {
    reg.a = 0x0022;
    process_alternate_movement_B3();
    process_sprite_animation();
  }
  CODE_B3C5C8();
}

/** $B3C5C8 */
export function CODE_B3C5C8() {
  returnHandleDespawn();
}

/** $B3C5CB — state 5: recovering (harmful to touch). */
export function CODE_B3C5CB() {
  reg.a = 0x5428;
  CODE_B3C62A();
  if (!reg.c) {
    reg.a = 0x002a;
    process_alternate_movement_B3();
    process_sprite_animation();
  }
  CODE_B3C5DD();
}

/** $B3C5DD */
export function CODE_B3C5DD() {
  returnHandleDespawn();
}

/** $B3C5E0 — state 6: back to walking; chase again if the Kong is still within range. */
export function CODE_B3C5E0() {
  const x = cur();
  reg.x = x;
  const walk = sr(x, 0x48);
  // the walk speed's sign against the facing direction
  const flip = ((((sr(x, sprite.oam_property) << 1) ^ walk) << 1) & 0x10000) !== 0;
  reg.a = flip ? neg(walk) : walk;
  CODE_B3C5F0();
}

/** $B3C5F0 */
export function CODE_B3C5F0() {
  const x = reg.x;
  sw(x, sprite.max_x_speed, reg.a);
  sw(x, sprite.x_speed, reg.a);
  if ((sr(x, sprite.movement_state) & 0xff) === 0x23) sw(x, sprite.x_speed, 0);
  CODE_B3C600();
}

/** $B3C600 */
export function CODE_B3C600() {
  const x = reg.x;
  sw(x, sprite.x_sub_position, 0);
  if (sr8(x, sprite.display_mode_high) === 0) return CODE_B3C61A();
  reg.a = sr(x, 0x4c);
  reg.y = sr(x, 0x4e);
  CODE_B3C6AF();
  if (reg.c) return CODE_B3C61A();
  sw(reg.x, sprite.state, 0x0001);
  CODE_B3C512();
}

/** $B3C61A */
export function CODE_B3C61A() {
  sw(reg.x, sprite.state, 0);
  CODE_B3C4E1();
}

/** $B3C61F — state 7: defeated. */
export function CODE_B3C61F() {
  process_current_movement();
  process_sprite_animation();
  fallOffScreen();
}

/**
 * $B3C62A — Kutlass collisions (A = collision flags against the Kong). Carry set when it was
 * defeated (crushed or hit); a blocked attack makes it recoil instead.
 */
export function CODE_B3C62A() {
  w16(0x0dc6, reg.a);
  check_for_sprite_crush();
  if (!reg.c) return CODE_B3C686();
  const x = cur();
  reg.x = x;
  reg.a = 0x0118;
  check_throwable_collision_global();
  if (reg.c) return CODE_B3C65A();
  get_current_sprite_clipping();
  if (sr(reg.x, sprite.state) === 0x0004) {
    // swinging: the blade has its own hitbox
    reg.a = 0x000d;
    get_sprite_special_clipping_slot_1();
  }
  CODE_B3C64F();
}

/** $B3C64F */
export function CODE_B3C64F() {
  reg.a = r16(0x0dc6);
  CODE_BEBE8B();
  if (reg.c) return CODE_B3C65A();
  reg.c = false;
}

/** $B3C65A — Z clear: the Kong bounced off the blade, so Kutlass recoils (state 5). */
export function CODE_B3C65A() {
  if (reg.z) return CODE_B3C671();
  reg.a = sound(5, "blade_swing");
  queue_sound_effect();
  const x = cur();
  reg.x = x;
  sw8(x, 0x4b, 0);
  sw8(x, sprite.display_mode_high, 0x03);
  reg.c = false;
}

/** $B3C671 */
export function CODE_B3C671() {
  faceAttacker();
  CODE_B3C686();
}

/** $B3C686 */
export function CODE_B3C686() {
  CODE_B3C690(facingLeft(reg.x) ? 0x0100 : 0xff00);
}

/** $B3C690 — knocked away with x speed A, then the death animation (state 7). */
export function CODE_B3C690(speed = reg.a) {
  launchDefeated(reg.x, speed);
  reg.a = C.kutlass_death_anim_id;
  defeat_sprite_using_animation();
  sw(reg.x, sprite.state, 0x0007);
  reg.c = true;
}

/** $B3C6AB — JSL entry to CODE_B3C6C0. */
export function CODE_B3C6AB() {
  CODE_B3C6C0();
}

/**
 * $B3C6AF — range test against the Kong's ground y: A = x ranges (low byte: in front, high
 * byte: behind), Y = y ranges (low: Kong below, high: Kong above). Carry clear when the Kong is
 * within range; A (and Z) = 1 when it is in front... see CODE_B3C6CF.
 */
export function CODE_B3C6AF() {
  w16(R.temp_32, reg.a);
  w16(R.temp_34, reg.y);
  const x = cur();
  const kong = r16(R.active_kong_sprite);
  reg.x = x;
  reg.y = kong;
  const a = sr(kong, sprite.ground_y_position) - sr(x, sprite.y_position);
  CODE_B3C6CF(a & 0xffff, a >= 0);
}

/** $B3C6C0 — the same range test against the Kong's y position. */
export function CODE_B3C6C0() {
  w16(R.temp_32, reg.a);
  w16(R.temp_34, reg.y);
  const x = cur();
  const kong = r16(R.active_kong_sprite);
  reg.x = x;
  reg.y = kong;
  const a = sr(kong, sprite.y_position) - sr(x, sprite.y_position);
  CODE_B3C6CF(a & 0xffff, a >= 0);
}

/** $B3C6CF — A = Kong y - sprite y, `below` = the carry of that subtraction. */
export function CODE_B3C6CF(dy = reg.a, below = reg.c) {
  w16(R.temp_36, dy);
  let range = r16(R.temp_34);
  if (!below) range = ((range >> 8) | (range << 8)) & 0xffff; // XBA
  reg.a = range;
  CODE_B3C6D6(dy);
}

/** $B3C6D6 */
export function CODE_B3C6D6(dy = r16(R.temp_36)) {
  const yRange = reg.a & 0x00ff;
  w16(R.temp_34, yRange);
  let ady = dy & 0xffff;
  if (isNeg(ady)) ady = neg(ady);
  reg.a = ady;
  CODE_B3C6E3();
}

/** $B3C6E3 */
export function CODE_B3C6E3() {
  const ady = reg.a & 0xffff;
  const yRange = r16(R.temp_34);
  if (ady >= yRange) {
    reg.a = (ady - yRange) & 0xffff;
    return CODE_B3C71C();
  }
  const x = reg.x;
  const y = reg.y;
  const dx = (sr(y, sprite.x_position) - sr(x, sprite.x_position)) & 0xffff;
  if (dx === 0) {
    reg.a = 0;
    reg.c = true; // SBC result 0: no borrow
    return CODE_B3C717();
  }
  w16(R.temp_36, dx);
  // carry = (the Kong is to the left) XOR (the sprite faces left): the Kong is behind
  const behind = ((((dx >> 1) ^ sr(x, sprite.oam_property)) << 2) & 0x10000) !== 0;
  let xr = r16(R.temp_32);
  w16(R.temp_38, 0);
  if (!behind) {
    w16(R.temp_38, 1);
    xr = ((xr >> 8) | (xr << 8)) & 0xffff;
  }
  reg.a = xr;
  CODE_B3C700();
}

/** $B3C700 */
export function CODE_B3C700() {
  w16(R.temp_32, reg.a & 0x00ff);
  let adx = r16(R.temp_36);
  if (isNeg(adx)) {
    adx = neg(adx);
    w16(R.temp_36, adx);
  }
  reg.a = adx;
  CODE_B3C70F();
}

/** $B3C70F */
export function CODE_B3C70F() {
  const adx = reg.a & 0xffff;
  const xRange = r16(R.temp_32);
  if (adx >= xRange) {
    reg.a = (adx - xRange) & 0xffff;
    return CODE_B3C71C();
  }
  reg.a = r16(R.temp_38);
  reg.z = reg.a === 0;
  reg.n = false;
  reg.c = false;
}

/** $B3C717 — directly above/below: A = 1 (the ADC #0 adds the carry), carry clear. */
export function CODE_B3C717() {
  const a = (reg.a + (reg.c ? 1 : 0)) & 0xffff;
  reg.a = a;
  w16(R.temp_38, a);
  reg.c = a > 0xffff;
  reg.z = a === 0;
  reg.n = isNeg(a);
}

/** $B3C71C — out of range: carry set. */
export function CODE_B3C71C() {
  reg.c = true;
  reg.z = (reg.a & 0xffff) === 0;
  reg.n = isNeg(reg.a);
}

// =============================================================================================
// Krook

const KROOK_TABLE = L("krook_main") + 3;

/** $B3C71D */
export function krook_main() {
  spriteStateHandler(KROOK_TABLE);
}

/** $B3C734 — state 0: walk/idle; throw the hook when the Kong comes within range. */
export function CODE_B3C734() {
  CODE_B3C878();
  if (reg.c) return CODE_B3C74A();
  const x = reg.x;
  reg.a = sr(x, 0x4c);
  reg.y = sr(x, 0x4e);
  CODE_B3C6C0();
  if (!reg.c) return CODE_B3C74D();
  process_current_movement();
  process_sprite_animation();
  CODE_B3C74A();
}

/** $B3C74A */
export function CODE_B3C74A() {
  returnHandleDespawn();
}

/** $B3C74D — Kong in range: turn-and-throw ($01F0) if it is behind and turning is allowed. */
export function CODE_B3C74D() {
  if (!reg.z) return CODE_B3C75B();
  if ((sr(reg.x, 0x4c) & 0x00ff) === 0) return CODE_B3C75B();
  reg.a = 0x01f0;
  CODE_B3C75E();
}

/** $B3C75B */
export function CODE_B3C75B() {
  reg.a = C.krook_throw_anim_id;
  CODE_B3C75E();
}

/** $B3C75E */
export function CODE_B3C75E() {
  set_sprite_animation();
  const x = cur();
  reg.x = x;
  sinc(x, sprite.state);
  returnHandleDespawn();
}

/** $B3C769 — state 1: throwing (the hook is thrown by the animation). */
export function CODE_B3C769() {
  if (!isNeg(r16(0x0d54))) process_current_movement();
  CODE_B3C772();
}

/** $B3C772 */
export function CODE_B3C772() {
  CODE_B3C878();
  if (!reg.c) process_sprite_animation();
  CODE_B3C77B();
}

/** $B3C77B */
export function CODE_B3C77B() {}

/** $B3C77E — state 2: wait for the hook: $4A = wait time (copied into both bytes). */
export function CODE_B3C77E() {
  const x = reg.y;
  reg.x = x;
  const w = sr(x, 0x4a);
  const v = (((w >> 8) | (w << 8)) & 0xffff) | w;
  sw(x, 0x4a, v);
  if (v === 0) return CODE_B3C7A1();
  sinc(x, sprite.state);
  reg.a = C.krook_idle_anim_id;
  set_sprite_animation();
}

/** $B3C794 — state 3: count down, then back to state 0. */
export function CODE_B3C794() {
  const x = reg.y;
  reg.x = x;
  if ((sr(x, 0x4a) & 0x00ff) === 0) return CODE_B3C7A1();
  sdec(x, 0x4a);
  CODE_B3C769();
}

/** $B3C7A1 — back to state 0 with the idle or walk animation. */
export function CODE_B3C7A1() {
  const y = reg.y;
  sw(y, sprite.state, 0);
  reg.a = C.krook_idle_anim_id;
  reg.x = sr(y, sprite.movement_state);
  if (reg.x !== 0) {
    reg.x = sr(y, sprite.max_x_speed);
    if (reg.x !== 0) reg.a = C.krook_walk_anim_id;
  }
  CODE_B3C7B5();
}

/** $B3C7B5 */
export function CODE_B3C7B5() {
  set_sprite_animation();
  CODE_B3C734();
}

/** $B3C7BC — state 4: defeated. */
export function CODE_B3C7BC() {
  process_current_movement();
  process_sprite_animation();
  fallOffScreen();
}

/** $B3C7C7 — state 5: init the throw timer (unknown_5C) from $4E. */
export function CODE_B3C7C7() {
  const x = reg.y;
  reg.x = x;
  sinc(x, sprite.state);
  sw(x, sprite.unknown_5C, sr(x, 0x4e) & 0x7fff);
  CODE_B3C7D1();
}

/** $B3C7D1 — state 6: throw periodically while the screen is above $4C. */
export function CODE_B3C7D1() {
  CODE_B3C878();
  if (reg.c) return CODE_B3C80E();
  const x = reg.x;
  if (r16(R.screen_scroll_y_position) < sr(x, 0x4c)) return CODE_B3C7E6();
  sw(x, sprite.unknown_5C, sr(x, 0x4e) & 0x7fff);
  CODE_B3C806();
}

/** $B3C7E6 — count down; near the end, turn to throw if the Kong is behind. */
export function CODE_B3C7E6() {
  const x = reg.x;
  if (isNeg(sdec(x, sprite.unknown_5C))) return CODE_B3C811();
  if (isNeg(sr(x, 0x4e))) return CODE_B3C806();
  if (sr(x, sprite.unknown_5C) >= 0x000c) return CODE_B3C806();
  const kong = r16(R.active_kong_sprite);
  reg.y = kong;
  const kongLeft = sr(x, sprite.x_position) >= sr(kong, sprite.x_position);
  if (((kongLeft ? 0x4000 : 0) ^ sr(x, sprite.oam_property)) & 0x4000) return CODE_B3C81F();
  CODE_B3C806();
}

/** $B3C806 */
export function CODE_B3C806() {
  process_current_movement();
  process_sprite_animation();
  CODE_B3C80E();
}

/** $B3C80E */
export function CODE_B3C80E() {
  returnHandleDespawn();
}

/** $B3C811 */
export function CODE_B3C811() {
  reg.a = C.krook_throw_anim_id;
  set_sprite_animation();
  const x = cur();
  reg.x = x;
  sinc(x, sprite.state);
  returnHandleDespawn();
}

/** $B3C81F */
export function CODE_B3C81F() {
  reg.a = C.krook_turn_throw_anim_id;
  set_sprite_animation();
  const x = cur();
  reg.x = x;
  sinc(x, sprite.state);
  returnHandleDespawn();
}

/** $B3C82D — state 7: throwing (moves only while within $C0 of the $0D54 height). */
export function CODE_B3C82D() {
  const y = cur();
  reg.y = y;
  const top = (r16(0x0d54) + 0x00c0) & 0xffff;
  if (top < sr(y, sprite.y_position)) process_current_movement();
  CODE_B3C840();
}

/** $B3C840 */
export function CODE_B3C840() {
  CODE_B3C878();
  if (!reg.c) process_sprite_animation();
  CODE_B3C849();
}

/** $B3C849 */
export function CODE_B3C849() {}

/** $B3C84C — state 8: like state 2, for the timed thrower. */
export function CODE_B3C84C() {
  const x = reg.y;
  reg.x = x;
  const w = sr(x, 0x4a);
  const v = (((w >> 8) | (w << 8)) & 0xffff) | w;
  sw(x, 0x4a, v);
  if (v === 0) return CODE_B3C86F();
  sinc(x, sprite.state);
  reg.a = C.krook_idle_anim_id;
  set_sprite_animation();
}

/** $B3C862 — state 9 */
export function CODE_B3C862() {
  const x = reg.y;
  reg.x = x;
  if ((sr(x, 0x4a) & 0x00ff) === 0) return CODE_B3C86F();
  sdec(x, 0x4a);
  CODE_B3C82D();
}

/** $B3C86F */
export function CODE_B3C86F() {
  sw(reg.y, sprite.state, 0x0006);
  CODE_B3C7E6();
}

/** $B3C878 — Krook collisions: carry set when defeated (crushed or hit). */
export function CODE_B3C878() {
  check_for_sprite_crush();
  if (!reg.c) return CODE_B3C8AE();
  reg.x = cur();
  reg.a = 0x0118;
  check_throwable_collision_global();
  if (reg.c) return CODE_B3C897();
  get_current_sprite_clipping();
  reg.a = 0x5428;
  CODE_BEBE8B();
  if (reg.c) return CODE_B3C897();
  CODE_B3C895();
}

/** $B3C895 */
export function CODE_B3C895() {
  reg.c = false;
}

/** $B3C897 */
export function CODE_B3C897() {
  if (!reg.z) return CODE_B3C895();
  faceAttacker();
  CODE_B3C8AE();
}

/** $B3C8AE — defeated: knocked away; its hook loses its owner. */
export function CODE_B3C8AE() {
  CODE_B3C8B8(facingLeft(reg.x) ? 0x0100 : 0xff00);
}

/** $B3C8B8 — knocked away with x speed A, then the death animation (state 4). */
export function CODE_B3C8B8(speed = reg.a) {
  launchDefeated(reg.x, speed);
  reg.a = C.krook_death_anim_id;
  defeat_sprite_using_animation();
  const x = reg.x;
  sw(x, sprite.state, 0x0004);
  const hook = sr(x, sprite.general_purpose_50);
  reg.y = hook;
  if (hook !== 0) sw(hook, sprite.general_purpose_50, 0);
  reg.c = true;
}

// =============================================================================================
// Krook's hook (thrown like a boomerang; gp50 = the Krook)

const HOOK_TABLE = L("krooks_hook_main") + 3;

/** $B3C8DD */
export function krooks_hook_main() {
  spriteStateHandler(HOOK_TABLE);
}

/** $B3C8E6 — state 0: set up the flight from the thrower's parameters. */
export function CODE_B3C8E6() {
  const y = reg.y;
  const krook = sr(y, sprite.general_purpose_50);
  reg.x = krook;
  const left = facingLeft(krook);
  let speed = sr(krook, sprite.unknown_22);
  if (left) speed = neg(speed);
  sw(y, sprite.x_speed, speed);
  let reach = sr(krook, sprite.unknown_28);
  if (left) reach = neg(reach);
  sw(y, 0x42, reach + sr(y, sprite.x_position)); // turn-around x
  sw(y, 0x44, sr(y, sprite.x_position)); // return x
  sw(y, 0x46, sr(krook, sprite.display_mode)); // deceleration
  sw(y, sprite.state, 0x0001);
  reg.x = y;
  sw(y, 0x48, 0);
  CODE_B3C918();
}

/** $B3C918 — state 1: fly out and back at the thrower's height. */
export function CODE_B3C918() {
  const y = reg.y;
  const krook = sr(y, sprite.general_purpose_50);
  reg.x = krook;
  if (krook === 0) return CODE_B3C968();
  sw(y, sprite.y_position, sr(krook, sprite.y_position));
  CODE_B3C98C();
  reg.a = 0x0002;
  process_alternate_movement();
  const x = reg.x;
  const xp = sr(x, sprite.x_position);
  reg.a = xp;
  const pastTurn = xp >= sr(x, 0x42);
  if (!facingLeft(x)) return CODE_B3C943(pastTurn);
  if (!pastTurn) return CODE_B3C93B();
  if (xp < sr(x, 0x44)) return CODE_B3C952();
  CODE_B3C959();
}

/** $B3C93B — (thrown left) before the turn point: accelerate back. */
export function CODE_B3C93B() {
  const x = reg.x;
  sw(x, sprite.x_speed, sr(x, sprite.x_speed) + sr(x, 0x46));
  CODE_B3C952();
}

/** $B3C943 — (thrown right) */
export function CODE_B3C943(pastTurn = reg.c) {
  if (pastTurn) return CODE_B3C94C();
  const x = reg.x;
  if (((reg.a - 1) & 0xffff) >= sr(x, 0x44)) return CODE_B3C952();
  CODE_B3C959();
}

/** $B3C94C */
export function CODE_B3C94C() {
  const x = reg.x;
  sw(x, sprite.x_speed, sr(x, sprite.x_speed) - sr(x, 0x46));
  CODE_B3C952();
}

/** $B3C952 */
export function CODE_B3C952() {
  process_sprite_animation();
}

/** $B3C959 — back at the thrower: the hook is caught. */
export function CODE_B3C959() {
  const krook = sr(reg.x, sprite.general_purpose_50);
  reg.y = krook;
  sw(krook, sprite.general_purpose_50, 0);
  delete_sprite_handle_deallocation();
}

/** $B3C968 — the thrower is gone: fly away fast (state 2). */
export function CODE_B3C968() {
  const x = reg.y;
  reg.x = x;
  sw(x, sprite.max_x_speed, isNeg(sr(x, sprite.x_speed)) ? 0xf800 : 0x0800);
  sw(x, sprite.max_y_speed, 0);
  sw(x, sprite.y_speed, 0);
  sinc(x, sprite.state);
  CODE_B3C97B();
}

/** $B3C97B — state 2 */
export function CODE_B3C97B() {
  CODE_B3C98C();
  reg.a = 0x000f;
  process_alternate_movement();
  process_sprite_animation();
  returnHandleDespawn();
}

/** $B3C98C — hook collisions; once hit ($48) it blinks and stops hurting. */
export function CODE_B3C98C() {
  const x = cur();
  reg.x = x;
  if (sr(x, 0x48) === 0) return CODE_B3C9A1();
  const a = r16(R.active_frame_counter) & 0x0004 ? 0xc000 : 0;
  reg.a = a;
  CODE_B3C99C();
}

/** $B3C99C */
export function CODE_B3C99C() {
  const x = reg.x;
  sw(x, sprite.display_mode, reg.a);
  sw(x, sprite.carry_or_defeat_flags, 0);
}

/** $B3C9A1 */
export function CODE_B3C9A1() {
  reg.a = 0x0018;
  check_throwable_collision_global();
  if (!reg.c) {
    get_current_sprite_clipping();
    reg.a = 0x0000;
    CODE_BEBE8B();
    if (!reg.c) return CODE_B3C9CA();
  }
  CODE_B3C9B7();
}

/** $B3C9B7 — hit: stop interacting and bounce back if it was flying forward. */
export function CODE_B3C9B7() {
  const x = reg.x;
  sinc(x, 0x48);
  sw(x, sprite.interaction_flags, 0);
  if (!isNeg(((sr(x, sprite.oam_property) << 1) ^ sr(x, sprite.x_speed)) & 0xffff)) {
    sw(x, sprite.x_speed, neg(sr(x, sprite.x_speed)));
  }
  CODE_B3C9CA();
}

/** $B3C9CA */
export function CODE_B3C9CA() {}

registerSprite({
  kutlass_main, CODE_B3C4E1, CODE_B3C4EC, CODE_B3C50F, CODE_B3C512, CODE_B3C53D, CODE_B3C550,
  CODE_B3C553, CODE_B3C577, CODE_B3C57B, CODE_B3C57E, CODE_B3C59B, CODE_B3C5B6, CODE_B3C5C8,
  CODE_B3C5CB, CODE_B3C5DD, CODE_B3C5E0, CODE_B3C5F0, CODE_B3C600, CODE_B3C61A, CODE_B3C61F,
  krook_main, CODE_B3C734, CODE_B3C74A, CODE_B3C74D, CODE_B3C75B, CODE_B3C75E, CODE_B3C769,
  CODE_B3C772, CODE_B3C77B, CODE_B3C77E, CODE_B3C794, CODE_B3C7A1, CODE_B3C7B5, CODE_B3C7BC,
  CODE_B3C7C7, CODE_B3C7D1, CODE_B3C7E6, CODE_B3C806, CODE_B3C80E, CODE_B3C811, CODE_B3C81F,
  CODE_B3C82D, CODE_B3C840, CODE_B3C849, CODE_B3C84C, CODE_B3C862, CODE_B3C86F,
  krooks_hook_main, CODE_B3C8E6, CODE_B3C918, CODE_B3C93B, CODE_B3C943, CODE_B3C94C,
  CODE_B3C952, CODE_B3C959, CODE_B3C968, CODE_B3C97B,
});
registerRts({
  CODE_B3C62A, CODE_B3C64F, CODE_B3C65A, CODE_B3C671, CODE_B3C686, CODE_B3C690, CODE_B3C6AF, CODE_B3C6C0,
  CODE_B3C6CF, CODE_B3C6D6, CODE_B3C6E3, CODE_B3C700, CODE_B3C70F, CODE_B3C717, CODE_B3C71C,
  CODE_B3C878, CODE_B3C895, CODE_B3C897, CODE_B3C8AE, CODE_B3C8B8, CODE_B3C98C, CODE_B3C99C, CODE_B3C9A1,
  CODE_B3C9B7, CODE_B3C9CA,
});
registerRtl({ CODE_B3C6AB });
void asr1;
void process_alternate_movement;
