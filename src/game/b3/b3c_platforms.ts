/**
 * Bank $B3 — platform sprites: the platform registration and collision helpers
 * (CODE_B3D46C / CODE_B3D485 / CODE_B3D4AE), the rideable hot-air balloon of Red-Hot Ride
 * ($B3D57B), Krockhead ($B3D6DD) and the Krockhead switch barrel ($B3D763).
 *
 * A platform sprite registers a callback each frame (CODE_B3D46C); after all sprites ran,
 * process_platform_sprites calls the callbacks (like a JSL) to let Kongs stand on them.
 */
import { r16, w8, w16, rom16 } from "../../core/mem";
import { reg } from "../../core/cpu";
import { L, R, C, sprite, kong_control } from "../../core/sym";
import {
  process_current_movement,
  process_sprite_animation,
  get_current_sprite_clipping,
  check_for_sprite_point_collisions,
  check_for_point_collisions,
  CODE_BBBB7B,
  CODE_BEBE6D,
  check_if_sprite_offscreen_global,
  set_sprite_animation,
  delete_sprite_handle_deallocation,
  queue_sound_effect,
} from "../../gen/routines";
import {
  cur, sr, sw, sr8, sinc, sdec, neg, isNeg, sound, spriteConst, spriteStateHandler, jumpTable,
  returnHandleDespawn, spriteTail, registerSprite, registerRts, registerRtl,
} from "./b3c_common";

// =============================================================================================
// Platform helpers

/**
 * $B3D46C — queue the platform callback A (in the caller's bank) for the current sprite.
 * The original takes the bank from its own return address on the stack (`LDA $03,s`), so it
 * is not a trap target: ported callers pass their bank.
 */
export function CODE_B3D46C(callerBank: number) {
  const y = r16(R.next_platform_sprite_slot);
  reg.y = y;
  const t = R.platform_sprite_table + y;
  w16(t, reg.a);
  w8(t + 2, callerBank);
  w16(t + 3, r16(R.current_sprite));
  reg.a = (y + 5) & 0xffff;
  w16(R.next_platform_sprite_slot, reg.a);
}

/**
 * $B3D485 — move the platform's hitbox: the real position is kept in u22/u28 while the drawn
 * position is elsewhere; swap them around process_current_movement.
 */
export function CODE_B3D485() {
  const x = cur();
  reg.x = x;
  sw(x, sprite.display_mode, sr(x, sprite.x_position));
  sw(x, sprite.general_purpose_50, sr(x, sprite.y_position));
  sw(x, sprite.x_position, sr(x, sprite.unknown_22));
  sw(x, sprite.y_position, sr(x, sprite.unknown_28));
  process_current_movement();
  const x2 = cur();
  reg.x = x2;
  const nx = sr(x2, sprite.x_position);
  sw(x2, sprite.x_position, sr(x2, sprite.unknown_22));
  sw(x2, sprite.unknown_22, nx);
  const ny = sr(x2, sprite.y_position);
  reg.a = sr(x2, sprite.unknown_28);
  sw(x2, sprite.y_position, reg.a);
  sw(x2, sprite.unknown_28, ny);
  reg.y = ny;
}

/**
 * $B3D4AE — let sprites land on the platform. Returns carry set when something stands on it,
 * with A = 1 if it was a sprite with terrain flag $1000 (else 0).
 */
export function CODE_B3D4AE() {
  const x = cur();
  reg.x = x;
  sw(x, sprite.unknown_34, 0);
  get_current_sprite_clipping();
  reg.a = 0x0002;
  check_for_sprite_point_collisions();
  if (!reg.c) return CODE_B3D4CC();
  CODE_B3D4BF();
}

/** $B3D4BF — nothing landed yet: check each colliding sprite. */
export function CODE_B3D4BF() {
  for (;;) {
    CODE_B3D4EB();
    if (reg.z) return CODE_B3D4E0();
    if (!reg.n) return CODE_B3D4D2();
    check_for_point_collisions();
    if (!reg.c) return CODE_B3D4CC();
  }
}

/** $B3D4CC */
export function CODE_B3D4CC() {}

/** $B3D4CD — something landed (A = 0 result): keep landing the other sprites. */
export function CODE_B3D4CD() {
  CODE_B3D4EB();
  if (reg.z) return CODE_B3D4E0();
  CODE_B3D4D2();
}

/** $B3D4D2 */
export function CODE_B3D4D2() {
  check_for_point_collisions();
  if (reg.c) return CODE_B3D4CD();
  reg.a = 0x0000;
  reg.c = true;
}

/** $B3D4DD — something with flag $1000 landed (A = 1 result). */
export function CODE_B3D4DD() {
  CODE_B3D4EB();
  CODE_B3D4E0();
}

/** $B3D4E0 */
export function CODE_B3D4E0() {
  for (;;) {
    check_for_point_collisions();
    if (!reg.c) break;
    CODE_B3D4EB(); // CODE_B3D4DD
  }
  reg.a = 0x0001;
  reg.c = true;
}

/**
 * $B3D4EB — land colliding_sprite on the platform if it comes down onto its top. Exit flags:
 * N set = did not land; else Z = its terrain flag $1000 is clear.
 */
export function CODE_B3D4EB() {
  const x = cur();
  const y = r16(R.colliding_sprite);
  reg.x = x;
  reg.y = y;
  let a = sr(y, sprite.y_speed);
  if (!isNeg(a)) {
    const fall = (a >> 8) & 0xff;
    // distance from the platform top to the sprite's position before this frame's fall
    a = (r16(0x00db) - (sr(y, sprite.y_position) - fall)) & 0xffff;
    a = (a + sr(x, sprite.general_purpose_50) - sr(x, sprite.y_position) + 3) & 0xffff;
    if (!isNeg(a)) return CODE_B3D51E();
  }
  CODE_B3D511(a);
}

/** $B3D511 (Rev 1) — moving up, or just below the top: still lands if it is on the ground. */
export function CODE_B3D511(a = reg.a) {
  const y = reg.y;
  if (a < 0xfd00) {
    reg.a = a;
    reg.z = false;
    reg.n = isNeg(a - 0xfd00);
    return CODE_B3D57A();
  }
  const t = sr(y, sprite.terrain_interaction) & 0x1000;
  reg.a = t;
  if (t === 0) {
    reg.z = true;
    reg.n = false;
    return CODE_B3D57A();
  }
  CODE_B3D51E();
}

/** $B3D51E — landed: snap onto the top, carry the Kong with the platform. */
export function CODE_B3D51E() {
  const x = reg.x;
  const y = reg.y;
  sw(y, sprite.ground_y_position, r16(0x00db) + sr(x, sprite.unknown_28) - sr(x, sprite.y_position));
  const dx = (sr(x, sprite.unknown_22) - sr(x, sprite.x_position)) & 0xffff;
  w16(R.temp_32, dx);
  sw(y, sprite.unknown_5C, dx);
  if (y === r16(R.active_kong_sprite)) {
    w16(R.platform_sprite_left_edge_position, r16(0x00d9) + dx);
    w16(R.platform_sprite_right_edge_position, r16(0x00dd) + dx);
    sw(x, sprite.unknown_34, y);
  }
  CODE_B3D54A();
}

/** $B3D54A */
export function CODE_B3D54A() {
  const x = reg.x;
  let a = sr(x, sprite.y_speed);
  if (isNeg(a)) a = 0;
  reg.a = a;
  CODE_B3D551();
}

/** $B3D551 */
export function CODE_B3D551() {
  const y = reg.y;
  sw(y, sprite.y_speed, reg.a + 0x0300);
  if (y !== r16(R.active_kong_sprite)) {
    sw(y, sprite.y_position, r16(0x00db));
    sw(y, sprite.y_sub_position, 0);
  }
  CODE_B3D568();
}

/** $B3D568 */
export function CODE_B3D568() {
  sw(reg.y, sprite.ground_distance, 0);
  CODE_B3D56E();
}

/** $B3D56E */
export function CODE_B3D56E() {
  const y = reg.y;
  const t = sr(y, sprite.terrain_interaction) | 0x0010;
  sw(y, sprite.terrain_interaction, t);
  reg.a = t & 0x1000;
  reg.z = reg.a === 0;
  reg.n = false;
  CODE_B3D57A();
}

/** $B3D57A */
export function CODE_B3D57A() {}

// =============================================================================================
// Rideable balloon (Red-Hot Ride)

const BALLOON_TABLE = L("rideable_balloon_main") + 3;
const BALLOON_PLATFORM = L("rideable_balloon_main_state_1_CODE_B3D5AD");
const VENTS = L("DATA_B3D691");

/** $B3D57B */
export function rideable_balloon_main() {
  spriteStateHandler(BALLOON_TABLE);
}

/** $B3D582 .init_state */
export function rideable_balloon_main_init_state() {
  const x = reg.y;
  reg.x = x;
  sw(x, sprite.unknown_22, sr(x, sprite.x_position));
  sw(x, sprite.unknown_28, sr(x, sprite.y_position));
  sw(x, sprite.interaction_flags, 0);
  sw(x, sprite.ground_y_position, r16(0x0959) - 2); // index into the steam vent table
  sinc(x, sprite.state);
  rideable_balloon_main_state_1();
}

/** $B3D596 .state_1 */
export function rideable_balloon_main_state_1() {
  CODE_BBBB7B();
  if (reg.c) return returnHandleDespawn();
  reg.a = BALLOON_PLATFORM & 0xffff;
  CODE_B3D46C(0xb3);
  process_sprite_animation();
}

/** $B3D5AD — platform callback: steer, move, let the Kongs stand on it. */
export function rideable_balloon_main_state_1_CODE_B3D5AD() {
  const x = cur();
  reg.x = x;
  w16(R.current_sprite_constants, sr(x, sprite.constants_address));
  balloonSteer();
  CODE_B3D485();
  CODE_B3D4AE();
  const x2 = cur();
  reg.x = x2;
  reg.a = ((reg.a << 1) | (reg.c ? 1 : 0)) & 0xffff; // ROL A
  sw(x2, 0x4e, reg.a);
  const rider = sr(x2, sprite.unknown_34);
  reg.a = rider;
  if (rider === r16(R.active_kong_sprite) || rider === r16(R.inactive_kong_sprite)) {
    const left = (sr(x2, sprite.unknown_22) - 0x0008) & 0xffff;
    w16(R.platform_sprite_left_edge_position, left);
    reg.a = (left + 0x0010) & 0xffff;
    w16(R.platform_sprite_right_edge_position, reg.a);
  }
}

/**
 * .CODE_B3D5E0 — with a Kong on board, left/right steers (constants +8); otherwise drift down
 * (movement $17). Over a steam vent (DATA_B3D691: x positions, odd = low vent) the balloon gets
 * lifted.
 */
function balloonSteer() {
  let y = cur();
  reg.y = y;
  if (sr(y, 0x4e) & 1) {
    w16(R.current_sprite_constants, r16(R.current_sprite_constants) + 0x0008);
    const rider = sr(y, sprite.unknown_34);
    reg.x = rider;
    if (rider === r16(R.active_kong_sprite)) {
      const ctrl = r16(R.active_kong_control_variables);
      const held = r16(ctrl + kong_control.input_held) & 0x0300;
      y = cur();
      reg.y = y;
      if (held !== 0) {
        const right = (held & 0x0100) !== 0;
        let speed = spriteConst(0x0008);
        if (!right) speed = neg(speed);
        sw(y, sprite.max_x_speed, speed);
        sw(y, sprite.movement_state, 0x0004);
        return balloonVents(y);
      }
    }
  }
  if ((sr(y, sprite.movement_state) & 0x00ff) !== 0x0017) {
    sw(y, sprite.movement_state, 0x0017);
    sw(y, 0x46, 0x0203);
    sw(y, sprite.max_x_speed, 0x0020);
  }
  balloonVents(y);
}

/** ..CODE_B3D63F */
function balloonVents(y: number) {
  let x = sr(y, sprite.ground_y_position);
  const vent = (i: number) => rom16(VENTS + (i & 0xffff));
  const xp = sr(y, sprite.x_position);
  if (xp >= vent(x)) {
    while (xp >= vent(x + 2)) x += 2;
  } else {
    do x -= 2;
    while (xp < vent(x));
  }
  x &= 0xffff;
  reg.x = x;
  sw(y, sprite.ground_y_position, x);
  if (((xp - vent(x)) & 0xffff) >= 0x000e) {
    x += 2;
    reg.x = x;
    if (((xp - vent(x)) & 0xffff) < 0xfff2) return;
  }
  const height = vent(x) & 1 ? 0x0238 : 0x0278;
  if (height >= sr(y, sprite.y_position)) return;
  reg.x = y;
  reg.y = 0x0006;
  sw(y, sprite.y_speed, spriteConst(0x0006));
}

// =============================================================================================
// Krockhead

const KROCKHEAD_TABLE = L("krockhead_main") + 3;
const KROCKHEAD_SUB_TABLE = L("krockhead_main_sub_state_table");
const KROCKHEAD_PLATFORM = L("krockhead_main_CODE_B3D72B");

/** $B3D6DD */
export function krockhead_main() {
  spriteStateHandler(KROCKHEAD_TABLE);
}

/** $B3D6E4 .init — sub-state 1 Krockheads are raised by a switch barrel. */
export function krockhead_main_init() {
  const x = reg.y;
  reg.x = x;
  sw(x, sprite.unknown_22, sr(x, sprite.x_position));
  sw(x, sprite.unknown_28, sr(x, sprite.y_position));
  sw(x, sprite.interaction_flags, 0);
  sw(x, 0x4e, 0);
  sinc(x, sprite.state);
  const a = (sr8(x, sprite.sub_state) * 2) & 0xffff;
  reg.a = a;
  if (a === 0) return krockhead_main_handle_sub_state();
  krockheadSwitchTimer();
  if (!reg.z) {
    reg.a = C.krockhead_sink_anim_id;
    set_sprite_animation();
  }
  krockhead_main(); // BRA krockhead_main
}

/** $B3D709 .handle_sub_state */
export function krockhead_main_handle_sub_state() {
  jumpTable(KROCKHEAD_SUB_TABLE, reg.a);
}

/** $B3D711 .sub_state_01 — raised while the switch timer runs. */
export function krockhead_main_sub_state_01() {
  krockheadSwitchTimer();
  krockhead_main_sub_state_00();
}

/** $B3D714 .sub_state_00 */
export function krockhead_main_sub_state_00() {
  CODE_BBBB7B();
  if (reg.c) return returnHandleDespawn();
  process_sprite_animation();
  reg.a = KROCKHEAD_PLATFORM & 0xffff;
  CODE_B3D46C(0xb3);
}

/** $B3D72B — platform callback. */
export function krockhead_main_CODE_B3D72B() {
  const x = cur();
  reg.x = x;
  w16(R.current_sprite_constants, sr(x, sprite.constants_address));
  sw(x, sprite.movement_state, 0);
  CODE_B3D485();
  CODE_B3D4AE();
  const x2 = cur();
  reg.x = x2;
  reg.a = ((reg.a << 1) | (reg.c ? 1 : 0)) & 0xffff;
  sw(x2, 0x4e, reg.a);
}

/** .CODE_B3D741 — count down $42 (restarted from the active switch barrel's timer). */
function krockheadSwitchTimer() {
  const y = reg.y;
  const barrel = r16(0x0d58);
  reg.x = barrel;
  if (barrel !== 0 && sr(barrel, sprite.type) === C.sprite_krochead_switch_barrel) {
    let a = (sr(barrel, 0x44) - sr(y, 0x4a)) & 0xffff;
    if (isNeg(a)) a = 0;
    sw(y, 0x42, a);
  }
  reg.x = y;
  const t = sr(y, 0x42);
  reg.a = t;
  reg.z = t === 0;
  if (t !== 0) reg.z = sdec(y, 0x42) === 0;
}

// =============================================================================================
// Krockhead switch barrel

const SWITCH_TABLE = L("krochead_switch_barrel_main_state_table");

/** $B3D763 */
export function krochead_switch_barrel_main() {
  const y = cur();
  reg.y = y;
  const index = (sr(y, sprite.state) << 1) & 0xffff;
  reg.x = index;
  spriteTail(0xb30000 | rom16(SWITCH_TABLE + index));
}

/** $B3D777 .state_0 — just hit: wait $46 frames before it can be hit again. */
export function krochead_switch_barrel_main_state_0() {
  process_sprite_animation();
  const x = cur();
  reg.x = x;
  if (sdec(x, 0x46) !== 0) return krochead_switch_barrel_main_state_2();
  sinc(x, sprite.state);
  krochead_switch_barrel_main_state_1();
}

/** $B3D783 .state_1 — hit it to raise the Krockheads for $42 frames. */
export function krochead_switch_barrel_main_state_1() {
  process_sprite_animation();
  get_current_sprite_clipping();
  CODE_BEBE6D();
  if (reg.c) {
    const x = reg.x;
    sw(x, 0x44, sr(x, 0x42));
    sw(x, 0x46, 0x001e);
    w16(0x0d58, x);
    sdec(x, sprite.state);
    reg.a = sound(6, "klampon_lockjaw_bite");
    queue_sound_effect();
  }
  krochead_switch_barrel_main_state_2();
}

/** $B3D7A6 .state_2 */
export function krochead_switch_barrel_main_state_2() {
  let x = cur();
  reg.x = x;
  if (sr(x, 0x44) !== 0 && sdec(x, 0x44) === 0) w16(0x0d58, 0);
  check_if_sprite_offscreen_global();
  x = cur();
  reg.x = x;
  if (reg.c) return switchOffscreen(x);
  if (sr(x, sprite.state) !== 0x0002) return;
  // back on screen after being parked: restart its animation
  sdec(x, sprite.state);
  reg.a = sr(x, sprite.animation_id);
  set_sprite_animation();
  process_sprite_animation();
}

/** ..CODE_B3D7D1 — offscreen: kill a linked sprite; the active switch stays parked (state 2). */
function switchOffscreen(x: number) {
  const linked = sr(x, 0x48);
  reg.y = linked;
  if (linked !== 0) {
    sw(x, 0x48, 0);
    sw(linked, sprite.state, 0x0004);
  }
  if (x !== r16(0x0d58)) return returnHandleDespawn();
  if (sr(x, sprite.state) === 0x0002) return;
  sw(x, sprite.state, 0x0002);
}

/** $B3D7F1 .state_4 */
export function krochead_switch_barrel_main_state_4() {
  delete_sprite_handle_deallocation();
}

/** $B3D7F5 .state_3 */
export function krochead_switch_barrel_main_state_3() {}

registerSprite({
  rideable_balloon_main, rideable_balloon_main_init_state, rideable_balloon_main_state_1,
  krockhead_main, krockhead_main_init, krockhead_main_handle_sub_state,
  krockhead_main_sub_state_01, krockhead_main_sub_state_00,
  krochead_switch_barrel_main, krochead_switch_barrel_main_state_0,
  krochead_switch_barrel_main_state_1, krochead_switch_barrel_main_state_2,
  krochead_switch_barrel_main_state_3, krochead_switch_barrel_main_state_4,
});
registerRtl({
  CODE_B3D485, CODE_B3D4AE, CODE_B3D4BF, CODE_B3D4CC, CODE_B3D4CD, CODE_B3D4D2, CODE_B3D4DD,
  CODE_B3D4E0, rideable_balloon_main_state_1_CODE_B3D5AD, krockhead_main_CODE_B3D72B,
});
registerRts({
  CODE_B3D4EB, CODE_B3D511, CODE_B3D51E, CODE_B3D54A, CODE_B3D551, CODE_B3D568, CODE_B3D56E,
  CODE_B3D57A,
});
