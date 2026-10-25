/**
 * Bank $B8 — Kong sprite code, the Kong state machine and the shared player physics.
 *
 * Diddy and Dixie are sprites in slots 1 and 2. Their main routines (bank $B3) jump here; the
 * Kong's `state` field selects one of 128 state routines in `kong_state_table`. Every state
 * routine leaves through `kong_state_return`, which ends with `JML [sprite_return_address]`
 * (back to the sprite handler); in TypeScript those routines simply return.
 */
import { r16, w16, rom16 } from "../../core/mem";
import { reg, register, callPtr } from "../../core/cpu";
import { L, R, C, sprite, sprite_table, kong_control, level } from "../../core/sym";
import { spriteConst, cmpMinus, sound, jumpToSpriteCode, markSpriteReturn, queue_sound_effect } from "./b8a_common";
import {
  process_player_action,
  apply_player_gravity,
  interpolate_x_velocity,
  interpolate_y_velocity,
  check_sprite_underwater,
  set_player_terminal_velocity,
  set_player_normal_gravity,
  CODE_B5E43E,
  CODE_B9DFCF,
  CODE_B8B615,
  process_terrain_interaction,
  prevent_sprite_from_leaving_level_x,
  update_damaged_invincibility,
  update_invincibility,
  process_sprite_animation,
  apply_position_from_velocity,
  process_anim_preserve_state,
  handle_slope_sliding_velocity,
  record_highest_y_position,
  handle_player_pit_death,
  get_active_kong_clipping,
  handle_player_slope_state_and_anim,
  CODE_B8B5C3,
  face_moving_direction,
  set_normal_gravity_if_falling,
  CODE_B8B714,
  CODE_B8B8AB,
  init_special_player_clipping,
  CODE_B8B5DA,
  start_rambi_attack,
  CODE_B8B65A,
  set_player_interaction,
  start_player_falling,
  CODE_B8A186,
  spawn_special_sprite_index,
  set_player_interaction_global,
  CODE_B3F0B8,
  set_swimming_state,
  set_level_end_exit_state,
  CODE_B8B7F4,
  CODE_B381CA,
  set_anim_once_handle_dixie,
  set_anim_handle_dixie,
  CODE_BCFB2C,
  CODE_B8A101,
} from "../../gen/routines";

const KONG_STATE_TABLE = L("kong_state_table");
const KONG_STATE_1D_TABLE = L("DATA_B89F12");
const ANIMAL_HEIGHT_LIMITS = L("CODE_B89B49_DATA_B89B81");
const KONG_STATE_44 = L("kong_state_44");
const CODE_B8A0B9_ADDR = L("CODE_B8A0B9");

/** X = current sprite (LDX current_sprite), mirrored into reg.x for the original callees. */
function ldxCurrentSprite(): number {
  reg.x = r16(R.current_sprite);
  return reg.x;
}

// ---------------------------------------------------------------------------------------------
// Kong sprite code entry points
// ---------------------------------------------------------------------------------------------

/** $B89670 — Dixie's sprite code: she is the "current" Kong, Diddy the other one. */
export function dixie_kong_sprite_code() {
  w16(R.current_kong_control_variables, R.dixie_control_variables);
  w16(R.unknown_kong_control_variables, R.diddy_control_variables);
  reg.a = R.diddy_control_variables;
  general_kong_sprite_code();
}

/** $B8967D — Diddy's sprite code. */
export function diddy_kong_sprite_code() {
  w16(R.current_kong_control_variables, R.diddy_control_variables);
  w16(R.unknown_kong_control_variables, R.dixie_control_variables);
  reg.a = R.dixie_control_variables;
  general_kong_sprite_code();
}

/** $B89688 — common Kong sprite code. Riding the skull cart overrides the state machine for one frame. */
export function general_kong_sprite_code() {
  const x = ldxCurrentSprite();
  if (x === r16(R.active_kong_sprite)) {
    const flags = r16(R.RAM_0B02);
    w16(R.RAM_0B02, flags & ~0x0002);
    if (flags & 0x0002) {
      // player riding the skull cart
      reg.a = 0x0020;
      process_player_action();
      kong_state_return();
      return;
    }
  }
  kong_state_handler();
}

/** $B896A0 — dispatch the Kong's current state through `kong_state_table` (X = Kong sprite). */
export function kong_state_handler() {
  const x = reg.x;
  w16(x + sprite.interaction_flags, r16(x + sprite.interaction_flags) & 0xf7ff);
  w16(R.current_sprite_constants, r16(x + sprite.constants_address));
  reg.db = 0xb8;
  const idx = (r16(x + sprite.state) << 2) & 0xffff;
  reg.a = idx;
  reg.x = idx;
  jumpToSpriteCode(0xb80000 | rom16(KONG_STATE_TABLE + idx));
}

// ---------------------------------------------------------------------------------------------
// Shared physics helpers
// ---------------------------------------------------------------------------------------------

/** $B898B5 — water physics step: gravity, slow x interpolation, then the shared water handling. */
export function CODE_B898B5() {
  apply_player_gravity();
  reg.a = 0x0003;
  interpolate_x_velocity();
  const x = ldxCurrentSprite();
  w16(x + sprite.unknown_2C, 0);
  CODE_B898C2();
}

/**
 * $B898C2 — underwater handling: water currents push the Kong; touching ground while swimming
 * ends the swim (or turns into Enguarde's ground state).
 */
export function CODE_B898C2() {
  check_sprite_underwater();
  const under = reg.a & 0xffff;
  if (under !== 0 && under !== 0x0002) {
    const x = reg.x;
    if (r16(x + sprite.terrain_interaction) & 0x0101) {
      set_player_terminal_velocity();
      set_player_normal_gravity();
      CODE_B5E43E();
      if (r16(R.animal_type) === C.sprite_enguarde) {
        // CODE_B898E9
        const k = ldxCurrentSprite();
        reg.a = C.kong_state_6C;
        w16(k + sprite.state, C.kong_state_6C);
        w16(k + sprite.max_x_speed, 0);
        return;
      }
      CODE_B9DFCF();
      return;
    }
    // CODE_B898F3: no upward speed from before, then the water current's vertical push
    if (r16(x + sprite.y_speed) & 0x8000) w16(x + sprite.y_speed, 0);
    const current = (r16(R.water_current_y_velocity) - 1) & 0xffff;
    if (!(current & 0x8000)) w16(x + sprite.y_speed, current);
  } else {
    // CODE_B89903
    CODE_B8B615();
    if (reg.c) return;
  }
  // CODE_B89908: terrain collision; landing keeps the pre-collision speed in A only
  const x = ldxCurrentSprite();
  const ySpeed = r16(x + sprite.y_speed);
  process_terrain_interaction();
  reg.x = x;
  reg.y = ySpeed;
  reg.a = r16(x + sprite.terrain_interaction) & 0x0001;
  if (reg.a) {
    reg.a = ySpeed;
    w16(x + sprite.y_speed, 0);
  }
  prevent_sprite_from_leaving_level_x();
  update_damaged_invincibility();
  process_sprite_animation();
}

/** $B89928 — move by velocity only, keep the animation state. */
export function CODE_B89928() {
  apply_position_from_velocity();
  update_damaged_invincibility();
  process_anim_preserve_state();
}

/** $B89933 — physics without level-edge clamp and pit death. */
export function CODE_B89933() {
  apply_player_gravity();
  get_x_acceleration();
  reg.a = spriteConst(reg.y);
  interpolate_x_velocity();
  handle_slope_sliding_velocity();
  process_terrain_interaction();
  update_damaged_invincibility();
  process_sprite_animation();
}

/** $B8994C — the standard per-frame player physics. */
export function handle_player_physics() {
  apply_player_gravity();
  handle_player_physics_skip_gravity();
}

/** $B8994F — x acceleration from the constants block selected by `get_x_acceleration`. */
export function handle_player_physics_skip_gravity() {
  get_x_acceleration();
  reg.a = spriteConst(reg.y);
  interpolate_x_velocity();
  handle_player_physics_skip_speed();
}

/** $B89957 */
export function handle_player_physics_skip_speed() {
  handle_slope_sliding_velocity();
  process_terrain_interaction();
  record_highest_y_position();
  handle_player_physics_skip_terrain();
}

/** $B89960 */
export function handle_player_physics_skip_terrain() {
  prevent_sprite_from_leaving_level_x();
  CODE_B89963();
}

/** $B89963 */
export function CODE_B89963() {
  handle_player_pit_death();
  handle_player_damaged_invincibility();
}

/** $B89966 */
export function handle_player_damaged_invincibility() {
  update_damaged_invincibility();
  process_sprite_animation();
}

/** $B8996E — common end of every Kong state: refresh the active Kong's clipping, back to the sprite handler. */
export function kong_state_return() {
  w16(R.held_rope_sprite_temp, 0);
  const x = ldxCurrentSprite();
  w16(x + sprite.carry_or_defeat_flags, 0);
  CODE_B89975();
}

/** $B89975 */
export function CODE_B89975() {
  get_active_kong_clipping();
  CODE_B89979();
}

/** $B89979 — PHK/PLB then `JML [sprite_return_address]`. */
export function CODE_B89979() {
  reg.db = 0xb8;
}

/** $B8997E — only the active Kong refreshes the player clipping. */
export function CODE_B8997E() {
  const x = ldxCurrentSprite();
  if (x === r16(R.active_kong_sprite)) kong_state_return();
  else CODE_B89979();
}

/**
 * $B89987 — choose the x-acceleration constant for the current situation.
 * Returns Y = offset into the sprite constants (read with `LDA [current_sprite_constants],y`).
 */
export function get_x_acceleration() {
  const animal = r16(R.animal_type);
  const slippery = r16(level.effects) & 0x3000;
  let y: number;
  if (animal === 0) {
    if (!slippery) {
      reg.a = 0;
      reg.y = 0x0010;
      return;
    }
    return slipperyLevel(slippery);
  }
  if (animal === C.sprite_squawks) {
    // .squawks: being carried by Squawks (no mount) uses its own constant
    y = r16(R.current_player_mount);
    reg.y = y;
    if (y === 0) {
      reg.a = animal;
      reg.y = 0x0086;
      return;
    }
    return ridingAnimal(animal);
  }
  reg.y = animal;
  if (slippery) return slipperyLevel(slippery);
  ridingAnimal(animal);
}

/** .riding_animal: one constant per animal type ((type - $FFD0) >> 1). */
function ridingAnimal(animal: number) {
  const a = ((animal + 0x30) & 0xffff) >> 1;
  reg.a = a;
  reg.y = a;
}

/** .slippery_level: ice ($1000) or water-surface ($2000) levels when on the ground. */
function slipperyLevel(effects: number) {
  const x = ldxCurrentSprite();
  const terrain = r16(x + sprite.terrain_interaction) & 0x1001;
  if (!terrain) {
    reg.a = terrain;
    reg.y = 0x0010;
    return;
  }
  let y: number;
  if (!(effects & 0x2000)) {
    reg.a = 0;
    y = 0x0012;
  } else {
    y = 0x0016;
    let a = (r16(x + sprite.y_position) - r16(R.water_y_position)) & 0xffff;
    if (a === 0) {
      a = r16(x + sprite.max_x_speed);
      if (a === 0) y = 0x001a;
    }
    reg.a = a;
  }
  // .CODE_B899DC: the fast flag (holding Y) uses the next constant
  const kc = r16(R.current_kong_control_variables);
  reg.x = kc;
  const fast = r16(kc + kong_control.fast_flag) & 0x0004;
  if (fast) y = (y + 2) & 0xffff;
  reg.a = fast ? y : 0;
  reg.y = y;
}

// ---------------------------------------------------------------------------------------------
// Kong states $00-$21
// ---------------------------------------------------------------------------------------------

/** $B899ED — standing / idle. */
export function kong_state_00() {
  reg.a = 0x0000;
  process_player_action();
  handle_player_slope_state_and_anim();
  handle_player_physics();
  CODE_B8B5C3();
  kong_state_return();
}

/** $B899FF — jumping. */
export function kong_state_01() {
  reg.a = 0x0001;
  process_player_action();
  face_moving_direction();
  set_normal_gravity_if_falling();
  handle_player_physics();
  CODE_B8B714();
  CODE_B8B5C3();
  kong_state_return();
}

/** $B89A17 — rolling / cartwheeling: no gravity until the roll's gravity delay has elapsed. */
export function kong_state_02() {
  reg.a = 0x0003;
  process_player_action();
  face_moving_direction();
  const kc = r16(R.current_kong_control_variables);
  reg.x = kc;
  const elapsed = (r16(R.active_frame_counter) - r16(kc + kong_control.roll_event_time)) & 0xffff;
  reg.a = elapsed;
  if (elapsed >= r16(kc + kong_control.roll_gravity_delay)) {
    CODE_B8B8AB();
    handle_player_physics();
  } else {
    // .CODE_B89A3A: still in the flat part of the roll
    const x = ldxCurrentSprite();
    w16(x + sprite.y_speed, 0);
    handle_player_physics_skip_gravity();
  }
  CODE_B89A4A();
  CODE_B8B5C3();
  kong_state_return();
}

/** $B89A4A — rolling onto terrain type 6 while on the ground gives a small downward push. */
export function CODE_B89A4A() {
  const x = ldxCurrentSprite();
  const t = r16(x + sprite.terrain_attributes) & 0x0007;
  reg.a = t;
  if (t !== 0x0006) return;
  const terrain = r16(x + sprite.terrain_interaction);
  reg.a = terrain >> 1;
  if (!(terrain & 1)) return;
  reg.a = 0x0100;
  w16(x + sprite.y_speed, 0x0100);
}

/** $B89A62 */
export function kong_state_03() {
  kong_state_02();
}

/** $B89A64 */
export function kong_state_04() {
  reg.a = 0x0002;
  process_player_action();
  handle_player_physics();
  CODE_B8B5C3();
  kong_state_return();
}

/** $B89A73 */
export function kong_state_05() {
  reg.a = 0x0004;
  process_player_action();
  const x = ldxCurrentSprite();
  w16(x + sprite.unknown_2C, 0);
  handle_player_physics();
  kong_state_return();
}

/** $B89A83 */
export function kong_state_06() {
  kong_state_01();
}

/** $B89A86 */
export function kong_state_07() {
  reg.a = 0x0005;
  process_player_action();
  handle_player_physics();
  kong_state_return();
}

/** $B89A92 */
export function kong_state_08() {
  reg.a = 0x0006;
  process_player_action();
  process_terrain_interaction();
  process_sprite_animation();
  kong_state_return();
}

/** $B89AA2 — on an animal buddy, on the ground. */
export function kong_state_09() {
  if (r16(R.animal_type) === C.sprite_rattly) {
    // .has_rattly: Rattly's auto-stomp range
    reg.a = 0x0007;
    process_player_action();
    reg.a = 0x000c;
    init_special_player_clipping();
    handle_player_physics();
    CODE_B8B5DA();
    kong_state_return();
    return;
  }
  const x = ldxCurrentSprite();
  if (r16(x + sprite.carry_or_defeat_flags) === 0x0002) {
    reg.a = 0x0002;
    start_rambi_attack();
    kong_state_return();
    return;
  }
  reg.a = 0x0007;
  process_player_action();
  handle_player_slope_state_and_anim();
  handle_player_physics();
  CODE_B89AE0();
  kong_state_return();
}

/** $B89AE0 — Rambi's charge hitbox (except during animation $8E). */
export function CODE_B89AE0() {
  reg.a = r16(R.animal_type);
  if (reg.a !== C.sprite_rambi) return;
  const kc = r16(R.current_kong_control_variables);
  reg.y = kc;
  reg.a = r16(kc + kong_control.animation_id);
  if (reg.a === 0x008e) return;
  reg.a = 0x0008;
  init_special_player_clipping();
  const x = ldxCurrentSprite();
  reg.a = r16(x + sprite.interaction_flags) | 0x0800;
  w16(x + sprite.interaction_flags, reg.a);
}

/** $B89B02 — on an animal buddy, airborne. */
export function kong_state_0A() {
  ldxCurrentSprite();
  reg.a = 0x0008;
  process_player_action();
  face_moving_direction();
  set_normal_gravity_if_falling();
  handle_player_physics();
  CODE_B8B5DA();
  reg.a = r16(R.animal_type);
  if (reg.a === C.sprite_rambi) {
    reg.a = 0x0008;
    init_special_player_clipping();
  }
  kong_state_return();
}

/** $B89B27 — animal airborne with ceiling limits for some levels. */
export function kong_state_0B() {
  CODE_B89B49();
  CODE_B89B30();
  kong_state_0A();
}

/** $B89B30 — Rambi Rumble bonus 2: the Kong can't go above y=$110. */
export function CODE_B89B30() {
  reg.a = r16(R.level_number);
  if (reg.a !== C.level_rambi_rumble_bonus_2) return;
  const x = ldxCurrentSprite();
  reg.a = 0x0110;
  if (cmpMinus(0x0110, r16(x + sprite.y_position))) return;
  w16(x + sprite.y_position, 0x0110);
  reg.a = r16(x + sprite.y_speed);
  if (!(reg.a & 0x8000)) return;
  w16(x + sprite.y_speed, 0);
}

/** $B89B49 — stop an animal's upward motion at a per-animal level height (or the screen top). */
export function CODE_B89B49() {
  const lvl = r16(R.level_number);
  if (lvl === C.level_web_woods_squitter_room || lvl === C.level_toxic_tower) {
    // .CODE_B89B8B: limited by the top of the screen
    const x = ldxCurrentSprite();
    reg.a = r16(x + sprite.y_speed);
    if (!(reg.a & 0x8000)) return;
    reg.a = (r16(x + sprite.y_position) - r16(R.screen_scroll_y_position)) & 0xffff;
    if (!(reg.a & 0x8000)) return;
    w16(x + sprite.y_speed, 0);
    return;
  }
  let x = ldxCurrentSprite();
  reg.a = r16(x + sprite.y_speed);
  if (!(reg.a & 0x8000)) return;
  const idx = ((r16(R.animal_type) - C.animal_sprite_type_range_start) & 0xffff) >> 1;
  reg.x = idx;
  let limit = rom16((ANIMAL_HEIGHT_LIMITS + idx) & 0xffffff);
  if (r16(R.level_number) === C.level_animal_antics_squitter_area) limit = 0x00f8;
  w16(R.temp_32, limit);
  x = ldxCurrentSprite();
  reg.a = r16(x + sprite.y_position);
  if (!cmpMinus(reg.a, limit)) return;
  w16(x + sprite.y_speed, 0);
}

/** $B89B9C — carrying something, on the ground. */
export function kong_state_0C() {
  reg.a = 0x0009;
  process_player_action();
  handle_player_slope_state_and_anim();
  handle_player_physics();
  const x = ldxCurrentSprite();
  reg.a = r16(x + sprite.state);
  if (reg.a !== C.kong_state_0C) {
    kong_state_return();
    return;
  }
  CODE_B89BB4();
}

/**
 * CODE_B89BB4 (shared tail of states $0C/$0D): dropped the held sprite -> fall; otherwise
 * check for sticking to honey, then the held-sprite handling.
 */
function CODE_B89BB4() {
  reg.a = r16(R.current_held_sprite);
  if (reg.a === 0) {
    // CODE_B89BCD
    start_player_falling();
    kong_state_return();
    return;
  }
  CODE_B8B65A();
  if (reg.c) {
    reg.a = C.player_interaction_07;
    set_player_interaction();
    kong_state_return();
    return;
  }
  // CODE_B89BC7
  CODE_B8B5DA();
  kong_state_return();
}

/** $B89BD3 — carrying something, airborne. */
export function kong_state_0D() {
  reg.a = 0x000a;
  process_player_action();
  face_moving_direction();
  set_normal_gravity_if_falling();
  handle_player_physics();
  CODE_B89BB4();
}

/** $B89BE4 */
export function kong_state_0E() {
  kong_state_0D();
}

/** $B89BE7 */
export function kong_state_0F() {
  reg.a = 0x0012;
  process_player_action();
  CODE_B8A186();
  handle_player_physics_skip_terrain();
  kong_state_return();
}

/** $B89BF6 — flying with Squawks. */
export function kong_state_10() {
  const mount = r16(R.current_player_mount);
  reg.x = mount;
  if (mount !== 0) {
    reg.a = r16(mount + sprite.general_purpose_4A) & 0x0001;
    if (reg.a) {
      // .CODE_B89C10: Squawks carrying the Kong towards a target height
      reg.y = mount;
      const x = ldxCurrentSprite();
      reg.a = r16(mount + sprite.general_purpose_4C);
      if (cmpMinus(reg.a, r16(x + sprite.y_position))) {
        // .CODE_B89C26: reached it -> spit state
        const k = ldxCurrentSprite();
        w16(k + sprite.state, C.kong_state_44);
        w16(k + sprite.general_purpose_42, 0x005a);
        reg.a = sound(5, "squawks_spit");
        queue_sound_effect();
        jumpToSpriteCode(KONG_STATE_44);
        return;
      }
      reg.a = 0x001a;
      process_player_action();
      CODE_B89C3C();
      kong_state_return();
      return;
    }
  }
  // .CODE_B89C01
  reg.a = 0x000b;
  process_player_action();
  CODE_B89C3C();
  CODE_B8B5DA();
  kong_state_return();
}

/** $B89C3C — Squawks flight physics. */
export function CODE_B89C3C() {
  CODE_B89CED();
  slowdown_squawks_on_level_y_limit();
  CODE_B89C4C();
  CODE_B89C70();
  handle_player_physics_skip_terrain();
}

/** $B89C4C — handle_player_physics without the level-edge/pit part. */
export function CODE_B89C4C() {
  apply_player_gravity();
  get_x_acceleration();
  reg.a = spriteConst(reg.y);
  interpolate_x_velocity();
  handle_slope_sliding_velocity();
  process_terrain_interaction();
  record_highest_y_position();
}

/** $B89C61 — above y=$120 Squawks is pushed down slowly. */
export function slowdown_squawks_on_level_y_limit() {
  const x = ldxCurrentSprite();
  reg.a = r16(x + sprite.y_position);
  if (!cmpMinus(reg.a, 0x0120)) return;
  reg.a = 0x0010;
  w16(x + sprite.y_speed, 0x0010);
}

/** $B89C70 — Squawks: hovering over ground and bouncing off the floor (with the B button). */
export function CODE_B89C70() {
  const x = ldxCurrentSprite();
  if (cmpMinus(r16(x + sprite.y_position), 0x0120)) w16(x + sprite.y_speed, 0x0010);
  reg.a = r16(x + sprite.y_speed);
  if (!(reg.a & 0x8000)) {
    reg.a = r16(0xac) & 0x1800;
    if (reg.a) return;
    reg.y = r16(R.current_player_mount);
    const minHeight = reg.y !== 0 ? 0x0028 : 0x0008;
    w16(R.temp_32, minHeight);
    reg.a = r16(x + sprite.ground_distance);
    if (reg.a & 0x8000) return;
    if (!cmpMinus(reg.a, minHeight)) return;
    CODE_B89CCD();
    if (reg.c) return;
    reg.a = 0xff00;
    w16(x + sprite.y_speed, 0xff00);
    return;
  }
  // .CODE_B89CA8
  reg.a = r16(x + sprite.ground_distance);
  if (!(reg.a & 0x8000)) return;
  CODE_B89CCD();
  if (reg.c) return;
  reg.a = r16(0xac) & 0x4000;
  if (!reg.a) return;
  let v = ((-r16(x + sprite.y_speed) & 0xffff) + 0x0020) & 0xffff;
  if (!cmpMinus(v, 0x0800)) v = 0x0800;
  reg.a = v;
  w16(x + sprite.y_speed, v);
}

/** $B89CCD — touching a hurting floor (terrain flag $0100 in $AE) while vulnerable: hurt. Carry = hurt. */
export function CODE_B89CCD() {
  if (!(r16(0xae) & 0x0100) || r16(reg.x + sprite.interaction_flags) & 0x0080) {
    reg.c = false;
    return;
  }
  reg.y = C.special_sprite_spawn_id_0036;
  spawn_special_sprite_index();
  reg.a = C.player_interaction_23;
  set_player_interaction_global();
  reg.c = true;
}

/** $B89CED — animation speeds up (down to $140) while flapping. */
export function CODE_B89CED() {
  const x = ldxCurrentSprite();
  reg.a = r16(x + sprite.animation_flags) & 0x0008;
  if (reg.a) return;
  let v = (r16(x + sprite.animation_speed) - 0x000c) & 0xffff;
  if (cmpMinus(v, 0x0140)) v = 0x0140;
  reg.a = v;
  w16(x + sprite.animation_speed, v);
}

/** $B89D07 — animation slows down (up to $500). */
export function CODE_B89D07() {
  const x = ldxCurrentSprite();
  let v = (r16(x + sprite.animation_speed) + 0x0019) & 0xffff;
  if (!cmpMinus(v, 0x0500)) v = 0x0500;
  reg.a = v;
  w16(x + sprite.animation_speed, v);
}

/** $B89D1A — inside a barrel/cannon (invisible, steered by the barrel). */
export function kong_state_11() {
  w16(0x0933, r16(0x0933) | 0x0001);
  w16(R.game_state_flags, r16(R.game_state_flags) | 0x0001);
  CODE_B3F0B8();
  const x = ldxCurrentSprite();
  w16(x + sprite.terrain_interaction, 0);
  w16(x + sprite.ground_distance, 0x0001);
  w16(x + sprite.unknown_2C, 0);
  reg.a = 0x000e;
  process_player_action();
  reg.y = 0x0050;
  const accel = spriteConst(0x0050);
  reg.a = accel;
  interpolate_x_velocity();
  reg.a = accel;
  interpolate_y_velocity();
  // .CODE_B89D54: don't let the Kong rise within 16px of $17C2
  const k = ldxCurrentSprite();
  reg.a = (r16(k + sprite.y_position) - r16(0x17c2)) & 0xffff;
  if (cmpMinus(reg.a, 0x0010)) {
    reg.a = r16(k + sprite.y_speed);
    if (reg.a & 0x8000) w16(k + sprite.y_speed, 0);
  }
  update_invincibility();
  kong_state_return();
}

/** $B89D69 — blasted out of a barrel cannon. */
export function kong_state_12() {
  reg.x = sprite_table.slot_1;
  w16(R.current_sprite_constants, r16(sprite_table.slot_1 + sprite.constants_address));
  w16(0x0ab8, r16(0x0ab8) | 0xc000);
  reg.a = r16(R.animal_type);
  if (reg.a === C.sprite_rambi) {
    reg.a = 0x0008;
    init_special_player_clipping();
  }
  // CODE_B89D87
  let x = ldxCurrentSprite();
  const kc = r16(R.current_kong_control_variables);
  reg.y = kc;
  w16(kc + kong_control.fast_flag, r16(kc + kong_control.fast_flag) | 0x0004);
  w16(x + sprite.max_x_speed, r16(x + sprite.general_purpose_46));
  // $44: frames before the player regains control
  let t = (r16(x + sprite.general_purpose_44) - 1) & 0xffff;
  w16(x + sprite.general_purpose_44, t);
  if (t & 0x8000) {
    w16(x + sprite.general_purpose_44, (t + 1) & 0xffff);
    reg.a = 0x000d;
    process_player_action();
  }
  // CODE_B89DA4: $42 = frames of straight flight left
  x = ldxCurrentSprite();
  t = (r16(x + sprite.general_purpose_42) - 1) & 0xffff;
  w16(x + sprite.general_purpose_42, t);
  if (!(t & 0x8000)) {
    // CODE_B89DEB
    CODE_B89E44();
    interpolate_x_velocity();
    CODE_B89E57();
    CODE_B89E38();
    return CODE_B89DF7();
  }
  w16(x + sprite.general_purpose_42, (t + 1) & 0xffff);
  if (r16(x + sprite.general_purpose_48) !== 0) {
    // CODE_B89E28: blast leads to another level
    w16(R.level_destination_number, r16(x + sprite.general_purpose_4A));
    w16(R.destination_level_entrance_number, r16(x + sprite.general_purpose_4C));
    set_level_end_exit_state();
    kong_state_return();
    return;
  }
  w16(x + sprite.general_purpose_46, 0);
  reg.y = 0x004a;
  const gravity = spriteConst(0x004a);
  reg.y = r16(R.current_kong_control_variables);
  w16(reg.y + kong_control.gravity_force, gravity);
  reg.a = gravity;
  apply_player_gravity();
  x = ldxCurrentSprite();
  if (r16(x + sprite.general_purpose_44) === 0) {
    // CODE_B89DCA
    const animal = r16(R.animal_type);
    if (animal === C.sprite_squawks) {
      // CODE_B89E01
      start_player_falling();
      const k = ldxCurrentSprite();
      w16(k + sprite.state, 0x0010);
      return CODE_B89E16();
    }
    if (animal === C.sprite_enguarde) {
      // CODE_B89E0D
      set_swimming_state();
      return CODE_B89E16();
    }
    if (r16(x + sprite.max_x_speed) !== 0) CODE_B89E44();
    else reg.a = 0x0002; // CODE_B89DC5
  } else {
    reg.a = 0x0002; // CODE_B89DC5
  }
  // CODE_B89DDD
  interpolate_x_velocity();
  CODE_B89E57();
  CODE_B89E38();
  CODE_B8B714();
  CODE_B89DF7();
}

/** CODE_B89DF7: touching any terrain ends the blast (X is whatever the last callee left). */
function CODE_B89DF7() {
  reg.a = r16(reg.x + sprite.terrain_interaction) & 0x0303;
  if (!reg.a) {
    kong_state_return();
    return;
  }
  // CODE_B89E12
  CODE_B9DFCF();
  CODE_B89E16();
}

/** CODE_B89E16 */
function CODE_B89E16() {
  w16(0x0aee, 0);
  w16(0x0af2, 0);
  reg.a = 0x3fff & r16(0x0ab8);
  w16(0x0ab8, reg.a);
  kong_state_return();
}

/** $B89E38 — keep the teamed-up partner on the shoulders. */
export function CODE_B89E38() {
  reg.a = r16(R.current_held_sprite);
  if (reg.a !== r16(R.inactive_kong_sprite)) return;
  CODE_B8B7F4();
}

/** $B89E44 — x interpolation rate for barrel blasts (A). */
export function CODE_B89E44() {
  const x = ldxCurrentSprite();
  if (r16(x + sprite.general_purpose_4E) & 0x0001) {
    reg.a = 0x000d;
    return;
  }
  reg.y = 0x004c;
  reg.a = spriteConst(0x004c);
}

/** $B89E57 */
export function CODE_B89E57() {
  handle_slope_sliding_velocity();
  process_terrain_interaction();
  record_highest_y_position();
  handle_player_physics_skip_terrain();
}

/** $B89E64 — team-up initiation (the partner is being picked up). */
export function kong_state_13() {
  CODE_B381CA();
  CODE_B89975();
}

/** $B89E6B */
export function kong_state_14() {
  reg.a = 0x0001;
  process_player_action();
  set_normal_gravity_if_falling();
  handle_player_physics();
  kong_state_return();
}

/** $B89E7A — knocked back. */
export function kong_state_15() {
  reg.a = 0x000c;
  process_player_action();
  apply_player_gravity();
  get_x_acceleration();
  reg.a = 0x0003;
  interpolate_x_velocity();
  handle_player_physics_skip_speed();
  CODE_B8B714();
  CODE_B8B5C3();
  kong_state_return();
}

/** $B89E98 — bouncing off an enemy. */
export function kong_state_16() {
  const x = ldxCurrentSprite();
  reg.a = r16(R.animal_type);
  if (reg.a !== 0) {
    kong_state_0A(); // CODE_B89EB6
    return;
  }
  reg.a = r16(x + sprite.terrain_interaction) & 0x0303;
  if (reg.a) {
    // CODE_B89EAF
    CODE_B9DFCF();
    kong_state_return();
    return;
  }
  reg.a = 0x0009;
  init_special_player_clipping();
  kong_state_01();
}

/** $B89EB9 — teamed up, on the ground. */
export function kong_state_17() {
  reg.a = 0x000f;
  process_player_action();
  handle_player_slope_state_and_anim();
  handle_player_physics();
  CODE_B8B7F4();
  CODE_B8B5DA();
  kong_state_return();
}

/** $B89ECE — the carried partner while teamed up. */
export function kong_state_18() {
  process_sprite_animation();
  CODE_B8B7F4();
  CODE_B89979();
}

/** $B89ED8 */
export function kong_state_19() {
  kong_state_02();
}

/** $B89EDB — teamed up, airborne. */
export function kong_state_1A() {
  reg.a = 0x0010;
  process_player_action();
  face_moving_direction();
  set_normal_gravity_if_falling();
  handle_player_physics();
  CODE_B8B7F4();
  CODE_B8B5DA();
  kong_state_return();
}

/** $B89EF3 */
export function kong_state_1B() {
  kong_state_1A();
}

/** $B89EF6 */
export function kong_state_1C() {
  const x = ldxCurrentSprite();
  reg.a = r16(x + sprite.terrain_interaction) & 0x0303;
  if (!reg.a) {
    kong_state_1A();
    return;
  }
  // CODE_B89F02
  CODE_B9DFCF();
  kong_state_return();
}

/** $B89F09 — scripted walk/jump to a target x ($44) driven by a sub-state in $42. */
export function kong_state_1D() {
  const x = ldxCurrentSprite();
  const idx = (r16(x + sprite.general_purpose_42) << 1) & 0xffff;
  reg.a = idx;
  reg.x = idx;
  callPtr(0xb8, rom16(KONG_STATE_1D_TABLE + idx));
}

/** $B89F1E — sub-state 0: just move. */
export function CODE_B89F1E() {
  CODE_B89FB9();
}

/** $B89F21 — sub-state 1: start walking towards the target. */
export function CODE_B89F21() {
  CODE_B89F30();
  const x = reg.x;
  w16(x + sprite.general_purpose_42, (r16(x + sprite.general_purpose_42) + 1) & 0xffff);
  reg.a = 0x0003;
  set_anim_once_handle_dixie();
  CODE_B89FB9();
}

/** $B89F30 — max x speed = ±$46 towards target x $44. */
export function CODE_B89F30() {
  const x = ldxCurrentSprite();
  w16(x + sprite.y_speed, 0);
  let y = r16(x + sprite.general_purpose_46);
  const d = (r16(x + sprite.general_purpose_44) - r16(x + sprite.x_position)) & 0xffff;
  reg.a = d;
  if (d & 0x8000) {
    y = -y & 0xffff;
    reg.a = y;
  }
  reg.y = y;
  w16(x + sprite.max_x_speed, y);
}

/** $B89F46 — sub-state 2: walk until the target is passed, then back to sub-state 0. */
export function CODE_B89F46() {
  CODE_B89F4F();
  if (reg.c) w16(reg.x + sprite.general_purpose_42, 0);
  CODE_B89FB9();
}

/** $B89F4F — target x passed? stops the Kong. Carry = arrived. */
export function CODE_B89F4F() {
  const x = ldxCurrentSprite();
  reg.a = ((r16(x + sprite.general_purpose_44) - r16(x + sprite.x_position)) ^ r16(x + sprite.max_x_speed)) & 0xffff;
  if (reg.a & 0x8000) {
    w16(x + sprite.max_x_speed, 0);
    w16(x + sprite.x_speed, 0);
    reg.c = true;
    return;
  }
  reg.c = false;
}

/** $B89F62 — sub-state 3: jump towards the target. */
export function CODE_B89F62() {
  CODE_B89F30();
  const x = ldxCurrentSprite();
  // face the direction of travel (bit 14 of the OAM property = x flip)
  const oam = r16(x + sprite.oam_property);
  const dir = r16(x + sprite.max_x_speed) >> 1;
  w16(x + sprite.oam_property, ((dir ^ oam) & 0x4000) ^ oam);
  w16(x + sprite.y_speed, r16(x + sprite.general_purpose_48));
  w16(x + sprite.terrain_interaction, 0);
  w16(x + sprite.ground_distance, 0x80f0);
  w16(x + sprite.ground_y_position, 0x7f00);
  w16(x + sprite.general_purpose_42, (r16(x + sprite.general_purpose_42) + 1) & 0xffff);
  reg.a = 0x0006;
  set_anim_handle_dixie();
  CODE_B89FB9();
}

/** $B89F8E — sub-state 4: airborne until falling below y $4A, then sub-state 5. */
export function CODE_B89F8E() {
  CODE_B89F4F();
  const x = ldxCurrentSprite();
  reg.a = r16(x + sprite.y_speed);
  if (!(reg.a & 0x8000)) {
    reg.a = (r16(x + sprite.y_position) - r16(x + sprite.general_purpose_4A)) & 0xffff;
    if (!(reg.a & 0x8000)) {
      reg.a = 0x0005;
      w16(x + sprite.general_purpose_42, 0x0005);
      CODE_B8997E(); // CODE_B89FC6
      return;
    }
  }
  // CODE_B89FA5: gravity, capped at $800
  const k = ldxCurrentSprite();
  let v = (0x0070 + r16(k + sprite.y_speed)) & 0xffff;
  if (!(v & 0x8000) && v >= 0x0800) v = 0x0800;
  reg.a = v;
  w16(k + sprite.y_speed, v);
  CODE_B89FB9();
}

/** CODE_B89FB9 (shared tail): accelerate, move, animate, return. */
function CODE_B89FB9() {
  reg.a = 0x000b;
  interpolate_x_velocity();
  apply_position_from_velocity();
  process_sprite_animation();
  CODE_B8997E(); // CODE_B89FC6: JML CODE_B8997E
}

/** $B89FCA — sub-state 5: done, hide the Kong. */
export function CODE_B89FCA() {
  const x = ldxCurrentSprite();
  w16(x + sprite.current_graphic, 0);
  w16(x + sprite.last_rendered_graphic, 0);
  w16(x + sprite.interaction_flags, 0);
  CODE_B8997E();
}

/** $B89FD4 */
export function kong_state_1E() {
  kong_state_1D();
}

/** $B89FEA — thrown partner flying (team throw). */
export function kong_state_1F() {
  reg.y = 0;
  const gravity = spriteConst(0x0000);
  const kc = r16(R.current_kong_control_variables);
  w16(kc + kong_control.gravity_force, gravity);
  const maxFall = spriteConst(0x0002);
  w16(kc + kong_control.max_fall_speed, maxFall);
  reg.y = kc;
  reg.a = maxFall;
  apply_player_gravity();
  reg.a = 0x0007;
  interpolate_x_velocity();
  process_terrain_interaction();
  process_sprite_animation();
  reg.a = 0x000a;
  init_special_player_clipping();
  CODE_BCFB2C();
  const x = ldxCurrentSprite();
  reg.a = r16(x + sprite.terrain_interaction) & 0x0101;
  if (reg.a) {
    // CODE_B8A033: landed
    w16(x + sprite.x_speed, 0);
    reg.a = 0x0021;
    w16(x + sprite.state, 0x0021);
    w16(x + sprite.general_purpose_42, 0x0040);
    reg.a = 0x0028;
    set_anim_handle_dixie();
    CODE_B89979();
    return;
  }
  CODE_B8A049();
  CODE_B8A06B();
  if (reg.c) CODE_B8A101(); // CODE_B8A02D
  CODE_B89979();
}

/** $B8A049 — keep the thrown Kong horizontally on screen (16px margins). */
export function CODE_B8A049() {
  const x = ldxCurrentSprite();
  const xpos = r16(x + sprite.x_position);
  let a = (xpos - r16(R.screen_scroll_x_position) - 0x0010) & 0xffff;
  if (!(a & 0x8000)) {
    // SBC with carry set from the previous (non-borrowing) subtraction
    a = (a - 0x00e0) & 0xffff;
    if (a & 0x8000) {
      reg.a = a;
      return;
    }
  }
  // CODE_B8A05D: push back by the overshoot
  const v = ((-a & 0xffff) + xpos) & 0xffff;
  reg.a = v;
  w16(x + sprite.x_position, v);
  w16(x + sprite.x_speed, 0);
  w16(x + sprite.max_x_speed, 0);
}

/** $B8A06B — carry = the Kong is 256px or more below the screen top. */
export function CODE_B8A06B() {
  const x = ldxCurrentSprite();
  reg.a = (r16(x + sprite.y_position) - r16(R.screen_scroll_y_position)) & 0xffff;
  reg.c = !cmpMinus(reg.a, 0x0100);
}

/** $B8A07C */
export function kong_state_20() {
  CODE_B8A186();
  handle_player_physics_skip_terrain();
  kong_state_return();
}

/** $B8A085 — thrown partner landed, waiting to be picked up. */
export function kong_state_21() {
  apply_player_gravity();
  reg.a = 0x0007;
  interpolate_x_velocity();
  process_terrain_interaction();
  process_sprite_animation();
  const x = ldxCurrentSprite();
  // landed on a hurting floor: treat as hurt during team throw
  if (
    !(r16(x + sprite.terrain_interaction) & 0x0080) &&
    r16(x + sprite.terrain_attributes) & 0x0100 &&
    (r16(x + sprite.terrain_interaction) & 0x1001) === 0x0001
  ) {
    reg.a = C.player_interaction_20;
    set_player_interaction_global();
    CODE_B89979();
    return;
  }
  jumpToSpriteCode(CODE_B8A0B9_ADDR); // falls into CODE_B8A0B9, which ends at the sprite return
}

const routines = {
  dixie_kong_sprite_code,
  diddy_kong_sprite_code,
  general_kong_sprite_code,
  kong_state_handler,
  CODE_B898B5,
  CODE_B898C2,
  CODE_B89928,
  CODE_B89933,
  handle_player_physics,
  handle_player_physics_skip_gravity,
  handle_player_physics_skip_speed,
  handle_player_physics_skip_terrain,
  CODE_B89963,
  handle_player_damaged_invincibility,
  kong_state_return,
  CODE_B89975,
  CODE_B89979,
  CODE_B8997E,
  get_x_acceleration,
  kong_state_00,
  kong_state_01,
  kong_state_02,
  CODE_B89A4A,
  kong_state_03,
  kong_state_04,
  kong_state_05,
  kong_state_06,
  kong_state_07,
  kong_state_08,
  kong_state_09,
  CODE_B89AE0,
  kong_state_0A,
  kong_state_0B,
  CODE_B89B30,
  CODE_B89B49,
  kong_state_0C,
  kong_state_0D,
  kong_state_0E,
  kong_state_0F,
  kong_state_10,
  CODE_B89C3C,
  CODE_B89C4C,
  slowdown_squawks_on_level_y_limit,
  CODE_B89C70,
  CODE_B89CCD,
  CODE_B89CED,
  CODE_B89D07,
  kong_state_11,
  kong_state_12,
  CODE_B89E38,
  CODE_B89E44,
  CODE_B89E57,
  kong_state_13,
  kong_state_14,
  kong_state_15,
  kong_state_16,
  kong_state_17,
  kong_state_18,
  kong_state_19,
  kong_state_1A,
  kong_state_1B,
  kong_state_1C,
  kong_state_1D,
  CODE_B89F1E,
  CODE_B89F21,
  CODE_B89F30,
  CODE_B89F46,
  CODE_B89F4F,
  CODE_B89F62,
  CODE_B89F8E,
  CODE_B89FCA,
  kong_state_1E,
  kong_state_1F,
  CODE_B8A049,
  CODE_B8A06B,
  kong_state_20,
  kong_state_21,
};
register(routines);

// Everything that leaves through `JML [sprite_return_address]` must resume there when entered
// from original code.
markSpriteReturn([
  "dixie_kong_sprite_code",
  "diddy_kong_sprite_code",
  "general_kong_sprite_code",
  "kong_state_handler",
  "kong_state_return",
  "CODE_B89975",
  "CODE_B89979",
  "CODE_B8997E",
  "CODE_B89F1E",
  "CODE_B89F21",
  "CODE_B89F46",
  "CODE_B89F62",
  "CODE_B89F8E",
  "CODE_B89FCA",
  ...Object.keys(routines).filter((n) => n.startsWith("kong_state_") && n !== "kong_state_handler"),
]);
