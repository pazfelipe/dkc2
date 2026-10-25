/**
 * Bank $B8 — kong states $3F-$7F and their helpers ($B8AA3E-$B8B515): animal riding and
 * swimming states, bonus barrel / level exit sequences, the "Kong being drained" states, the
 * end-of-level krem coin / DK coin spawning, and the horizontal/vertical rope helpers.
 */
import { r16, w16, rom16, or16, bus16 } from "../../core/mem";
import { reg } from "../../core/cpu";
import { L, R, C, sprite as S, kong_control as K } from "../../core/sym";
import { xba } from "../../core/ops";
import {
  pl, mi, neg, spriteConst, cur, sw, sr, registerRts, registerRtl, registerSprite,
  kongStateReturn, kongStateReturnIfActive, kongStateReturnClipping, spriteReturn, spriteTail,
} from "./b8b_common";
import { play_high_priority_sound } from "./b8b_common";
import {
  face_moving_direction, set_normal_gravity_if_falling, handle_player_physics, CODE_B8D99E,
  process_sprite_animation, set_player_interaction_global, update_damaged_invincibility,
  CODE_B5E43E, CODE_B89D07, CODE_B89C70, set_player_interaction, interpolate_y_velocity,
  CODE_B8D817, apply_player_gravity, get_x_acceleration, apply_position_from_velocity,
  set_anim_handle_dixie, CODE_B8D8D5, disable_bullet_time, init_special_player_clipping,
  get_sprite_special_clipping_slot_0, check_for_sprite_collisions, interpolate_x_velocity,
  CODE_B898C2, start_enguarde_attack, CODE_B89AE0, start_rambi_attack, CODE_B89B30,
  handle_slope_sliding_velocity, handle_player_physics_skip_terrain, CODE_B89963,
  CODE_BB8C2C, CODE_B9DFCF, CODE_B89933, set_inactive_kong_anim_handle_dixie,
  check_if_sprite_offscreen_global, handle_player_damaged_invincibility, set_player_jumping_gravity,
  prevent_sprite_from_leaving_level_x, CODE_B8830E, CODE_B89928, handle_player_physics_skip_speed,
  CODE_B89CCD, CODE_BBC140, process_anim_preserve_state,
  work_on_active_kong, work_on_inactive_kong, swap_active_kong_global, CODE_BB8C19,
  process_terrain_interaction, transition_kong_dependant_song, is_current_krem_coin_collected,
  spawn_special_sprite_address, is_current_level_dk_coin_collected, CODE_B381CA,
} from "../../gen/routines";
import { process_player_action } from "./b8b_actions";
import { CODE_B8A719, CODE_B8A7E1, CODE_B8A186, set_level_end_fade } from "./b8b_kong_states_a";
import {
  CODE_B8B530, CODE_B8B5C3, CODE_B8B5DA, CODE_B8B714, check_sprite_underwater,
  record_highest_y_position, handle_player_pit_death, set_swim_gravity_and_y_speed,
} from "./b8b_pit_swim";
import { CODE_B8B7F4, CODE_B8B831, handle_player_slope_state_and_anim, start_player_falling } from "./b8b_slope";

const KONG_STATE_0B = L("kong_state_0B");
const KONG_STATE_16 = L("kong_state_16");
const DATA_FF1904 = L("DATA_FF1904");
const DATA_FF18F0 = L("DATA_FF18F0");

/** $B8AA3E */
export function kong_state_3F() {
  reg.a = 0x0a;
  process_player_action();
  face_moving_direction();
  set_normal_gravity_if_falling();
  handle_player_physics();
  kongStateReturn();
}

/** $B8AA50 — follower riding in a barrel along the path; on arrival it re-joins (interaction $05). */
export function kong_state_40() {
  w16(0x0933, r16(0x0933) | 0x0002);
  CODE_B8D99E();
  process_sprite_animation();
  reg.a = (r16(R.kong_follow_buffer_playback_index) + 2) & 0x3f;
  if (reg.a === r16(R.kong_follow_buffer_recording_index)) return CODE_B8AA6D();
  spriteReturn();
}
/** $B8AA6D */
export function CODE_B8AA6D() {
  reg.a = C.player_interaction_05;
  set_player_interaction_global();
  spriteReturn();
}

/** $B8AA77 */
export function kong_state_41() {
  reg.a = 0x18;
  process_player_action();
  if (reg.c) return CODE_B8AA89();
  CODE_B8AA8C();
  update_damaged_invincibility();
  process_sprite_animation();
  CODE_B8AA89();
}
/** $B8AA89 */
export function CODE_B8AA89() {
  kongStateReturn();
}
/** $B8AA8C */
export function CODE_B8AA8C() {
  w16(0x0af0, 0x9000);
  w16(0x0aea, 0x8000);
  w16(0x0aec, 0x8000);
  reg.a = 0x2000;
  or16(0x0ab8, 0x2000);
}

/** $B8AAA2 — running (fast flag held on). */
export function kong_state_42() {
  const ctrl = r16(R.current_kong_control_variables);
  w16(ctrl + K.fast_flag, r16(ctrl + K.fast_flag) | 0x0004);
  CODE_B8AA8C();
  reg.a = 0x0001;
  process_player_action();
  face_moving_direction();
  set_normal_gravity_if_falling();
  handle_player_physics();
  CODE_B8B714();
  CODE_B8B5C3();
  const x = cur();
  reg.x = x;
  if (sr(x, S.terrain_interaction) & 0x0001) CODE_B5E43E();
  CODE_B8AAD2();
}
/** $B8AAD2 */
export function CODE_B8AAD2() {
  kongStateReturn();
}

/** $B8AAD5 */
export function kong_state_43() {
  reg.a = 0x19;
  process_player_action();
  update_damaged_invincibility();
  process_sprite_animation();
  kongStateReturn();
}

/** $B8AAE5 — timed state: vertical speed frozen for the first frames, interaction $18 when done. */
export function kong_state_44() {
  const x = cur();
  reg.x = x;
  const t = (sr(x, S.general_purpose_42) - 1) & 0xffff;
  sw(x, S.general_purpose_42, t);
  if (t & 0x8000) return CODE_B8AB08();
  if (mi(t, 0x1e)) sw(x, S.y_speed, 0);
  CODE_B8AAF4();
}
/** $B8AAF4 */
export function CODE_B8AAF4() {
  reg.a = 0x1a;
  process_player_action();
  CODE_B89D07();
  handle_player_physics();
  w16(0xac, 0);
  CODE_B89C70();
  kongStateReturn();
}
/** $B8AB08 */
export function CODE_B8AB08() {
  reg.a = C.player_interaction_18;
  set_player_interaction();
  kongStateReturn();
}

/** $B8AB11 — hanging from a rope sprite (held_rope_sprite), moving with it. */
export function kong_state_45() {
  if (r16(R.held_rope_sprite) === 0) return CODE_B8AB5D();
  or16(R.game_state_flags, 0x0008);
  reg.a = 0x13;
  process_player_action();
  CODE_B8A719();
  sw(cur(), S.ground_distance, 0);
  reg.a = 0x0b;
  interpolate_y_velocity();
  CODE_B8D817();
  CODE_B8B4CF();
  const rope = reg.x;
  if (sr(rope, S.type) === C.sprite_horsetail) return CODE_B8AB62();
  CODE_B8B4F7();
  if (!reg.c) return CODE_B8AB53();
  w16(0x5e, reg.a);
  const x = cur();
  reg.x = x;
  // only clamp to the rope ends while moving towards them
  if (((sr(x, S.y_speed) - 1) & 0x8000) === 0 && ((sr(x, S.max_y_speed) - 1) & 0x8000) === 0) {
    return CODE_B8AB5D();
  }
  CODE_B8AB4F();
}
/** $B8AB4F */
export function CODE_B8AB4F() {
  reg.a = r16(0x5e);
  sw(reg.x, S.y_position, reg.a);
  CODE_B8AB53();
}
/** $B8AB53 */
export function CODE_B8AB53() {
  update_damaged_invincibility();
  process_sprite_animation();
  CODE_B8AB5A();
}
/** $B8AB5A */
export function CODE_B8AB5A() {
  kongStateReturn();
}
/** $B8AB5D — let go of the rope. */
export function CODE_B8AB5D() {
  CODE_B8A7E1();
  CODE_B8AB5A();
}
/** $B8AB62 — horsetail rope: the hanging range follows the sprite's own height. */
export function CODE_B8AB62() {
  const rope = reg.x;
  const len = (sr(rope, S.general_purpose_4A) - sr(rope, S.y_position)) & 0xffff;
  w16(0x38, len);
  w16(0x34, len + 0x14);
  CODE_B8B4F7();
  if (!reg.c) return CODE_B8AB53();
  sw(reg.x, S.y_position, reg.a);
  CODE_B8AB53();
}

/** $B8AB78 — moving to a fixed point ($42,$44); when reached, celebrate (state $47). */
export function kong_state_46() {
  apply_player_gravity();
  get_x_acceleration();
  apply_position_from_velocity();
  reg.y = 0x0002;
  const x = cur();
  reg.x = x;
  reg.a = sr(x, S.general_purpose_42);
  if (!pl(reg.a, sr(x, S.x_position))) {
    sw(x, S.x_position, reg.a);
    reg.y--;
  }
  CODE_B8AB8F();
}
/** $B8AB8F */
export function CODE_B8AB8F() {
  const x = reg.x;
  reg.a = sr(x, S.general_purpose_44);
  if (!pl(reg.a, sr(x, S.y_position))) {
    sw(x, S.y_position, reg.a);
    reg.y = (reg.y - 1) & 0xffff;
  }
  CODE_B8AB98();
}
/** $B8AB98 */
export function CODE_B8AB98() {
  reg.a = reg.y;
  if (reg.a === 0) return CODE_B8ABA8();
  update_damaged_invincibility();
  process_sprite_animation();
  CODE_B8B530();
  kongStateReturn();
}
/** $B8ABA8 */
export function CODE_B8ABA8() {
  const x = reg.x;
  sw(x, S.x_speed, 0);
  sw(x, S.state, 0x47);
  if (r16(R.RAM_0B02) & 0x0004) {
    reg.a = 0x45;
    set_anim_handle_dixie();
    return CODE_B8ABC7();
  }
  CODE_B8ABC0();
}
/** $B8ABC0 */
export function CODE_B8ABC0() {
  reg.a = 0x46;
  set_anim_handle_dixie();
  CODE_B8ABC7();
}
/** $B8ABC7 */
export function CODE_B8ABC7() {
  reg.a = r16(R.game_state_flags) & 0x4000;
  if (reg.a) {
    const y = r16(R.inactive_kong_sprite);
    reg.x = y;
    sw(y, S.state, 0x5e);
    sw(y, S.interaction_flags, 0);
    reg.a = sr(y, S.oam_property) & 0xbfff;
    sw(y, S.oam_property, reg.a);
  }
  CODE_B8ABE0();
}
/** $B8ABE0 */
export function CODE_B8ABE0() {
  CODE_B8B530();
  kongStateReturn();
}

/** $B8ABE6 */
export function kong_state_47() {
  or16(R.game_state_flags, 0x0008);
  update_damaged_invincibility();
  process_sprite_animation();
  kongStateReturn();
}
/** $B8ABF6 */
export function kong_state_48() {
  reg.a = 0x1d;
  process_player_action();
  update_damaged_invincibility();
  process_sprite_animation();
  kongStateReturn();
}
/** $B8AC06 */
export function kong_state_49() {
  reg.a = 0x0c;
  process_player_action();
  update_damaged_invincibility();
  process_sprite_animation();
  CODE_B8B7F4();
  kongStateReturn();
}
/** $B8AC19 */
export function kong_state_4A() {
  reg.a = 0x0c;
  process_player_action();
  update_damaged_invincibility();
  CODE_B8B7F4();
  spriteReturn();
}

/** $B8AC28 — moving horizontally to $0D66, then next state. */
export function kong_state_4B() {
  reg.a = 0x0c;
  process_player_action();
  update_damaged_invincibility();
  apply_position_from_velocity();
  const x = cur();
  reg.x = x;
  if (sr(x, S.x_speed) & 0x8000) {
    reg.a = r16(0x0d66);
    if (pl(reg.a, sr(x, S.x_position))) return CODE_B8AC51();
    return CODE_B8AC4A();
  }
  CODE_B8AC43();
}
/** $B8AC43 */
export function CODE_B8AC43() {
  reg.a = r16(0x0d66);
  if (mi(reg.a, sr(reg.x, S.x_position))) return CODE_B8AC51();
  CODE_B8AC4A();
}
/** $B8AC4A */
export function CODE_B8AC4A() {
  process_sprite_animation();
  kongStateReturn();
}
/** $B8AC51 */
export function CODE_B8AC51() {
  const x = reg.x;
  sw(x, S.x_position, reg.a);
  sw(x, S.y_position, r16(0x0d6a));
  sw(x, S.state, sr(x, S.state) + 1);
  sw(x, S.terrain_interaction, 0x0001);
  reg.a = 0x4a;
  set_anim_handle_dixie();
  kongStateReturn();
}

/** $B8AC69 — waiting for the other kong to reach state $4E, then drop and resume following. */
export function kong_state_4C() {
  reg.a = 0x0c;
  process_player_action();
  const y = r16(R.inactive_kong_sprite);
  reg.x = y;
  reg.a = sr(y, S.state);
  if (reg.a === 0x4e) return CODE_B8AC80();
  process_sprite_animation();
  kongStateReturn();
}
/** $B8AC80 */
export function CODE_B8AC80() {
  const x = cur();
  sw(x, S.render_order, 0xe4);
  sw(x, S.state, 0);
  sw(x, S.x_speed, 0);
  sw(x, S.max_x_speed, 0);
  sw(x, S.ground_y_position, 0);
  sw(x, S.x_sub_position, 0x8000);
  sw(x, S.y_sub_position, 0x8000);
  sw(x, S.y_speed, 0x0600);
  reg.x = x;
  reg.a = 0x0001;
  set_anim_handle_dixie();
  const y = r16(R.inactive_kong_sprite);
  sw(y, S.render_order, 0xd8);
  sw(y, S.state, 0x22);
  reg.a = 0x1f;
  reg.x = 0x03;
  reg.y = 0;
  CODE_B8D8D5();
  disable_bullet_time();
  kongStateReturn();
}

/** $B8ACC1 — falling to $0D6C, then next state. */
export function kong_state_4D() {
  reg.a = 0x0c;
  process_player_action();
  const x = cur();
  reg.x = x;
  let a = (0x50 + sr(x, S.y_speed)) & 0xffff;
  if (!(a & 0x8000) && a >= 0x0800) a = 0x0800;
  reg.a = a;
  CODE_B8ACD9();
}
/** $B8ACD9 */
export function CODE_B8ACD9() {
  sw(reg.x, S.y_speed, reg.a);
  apply_position_from_velocity();
  const x = reg.x;
  reg.a = r16(0x0d6c);
  if (mi(reg.a, sr(x, S.y_position))) {
    // .CODE_B8ACEF: landed
    sw(x, S.y_position, reg.a);
    sw(x, S.x_position, r16(0x0d68));
    sw(x, S.state, sr(x, S.state) + 1);
    reg.a = 0x4a;
    set_anim_handle_dixie();
    return spriteReturn();
  }
  update_damaged_invincibility();
  process_sprite_animation();
  spriteReturn();
}

/** $B8AD02 */
export function kong_state_4E() {
  reg.a = 0x0c;
  process_player_action();
  process_sprite_animation();
  kongStateReturn();
}

/** $B8AD0F — moving at the constant speed in $42. */
export function kong_state_4F() {
  reg.a = 0x25;
  process_player_action();
  const x = cur();
  reg.x = x;
  sw(x, S.x_speed, sr(x, S.general_purpose_42));
  sw(x, S.max_x_speed, sr(x, S.general_purpose_42));
  handle_player_physics();
  reg.a = 0x0008;
  init_special_player_clipping();
  kongStateReturn();
}

/** $B8AD2A — Enguarde swimming (also state $54). */
export function kong_state_50() {
  const ctrl = r16(R.current_kong_control_variables);
  reg.y = ctrl;
  if (r16(ctrl + K.animation_id) !== 0x8f) {
    reg.a = 0x0007;
    get_sprite_special_clipping_slot_0();
    reg.a = 0x0020;
    check_for_sprite_collisions();
    if (reg.c) return CODE_B8AD88();
  }
  CODE_B8AD44();
}
/** $B8AD44 */
export function CODE_B8AD44() {
  const x = cur();
  reg.x = x;
  if (sr(x, S.state) !== 0x54) return CODE_B8AD5B();
  reg.a = 0x0c;
  process_player_action();
  if (reg.c) return CODE_B8AD85();
  reg.x = cur();
  sw(reg.x, S.max_y_speed, 0);
  CODE_B8AD63();
}
/** $B8AD5B */
export function CODE_B8AD5B() {
  reg.a = 0x1e;
  process_player_action();
  if (reg.c) return CODE_B8AD85();
  CODE_B8AD63();
}
/** $B8AD63 — at the water surface Enguarde is pushed down (or by the water current). */
export function CODE_B8AD63() {
  check_sprite_underwater();
  if (reg.a === 0x0001) {
    reg.a = 0x0400;
    reg.y = r16(R.water_current_y_velocity);
    if (reg.y !== 0) reg.a = reg.y;
    return CODE_B8AD74();
  }
  CODE_B8AD76();
}
/** $B8AD74 */
export function CODE_B8AD74() {
  sw(reg.x, S.max_y_speed, reg.a);
  CODE_B8AD76();
}
/** $B8AD76 */
export function CODE_B8AD76() {
  reg.a = 0x0003;
  interpolate_x_velocity();
  reg.a = 0x0003;
  interpolate_y_velocity();
  CODE_B898C2();
  CODE_B8AD85();
}
/** $B8AD85 */
export function CODE_B8AD85() {
  kongStateReturn();
}
/** $B8AD88 */
export function CODE_B8AD88() {
  reg.x = cur();
  sw(reg.x, S.x_speed, 0);
  start_enguarde_attack();
  kongStateReturn();
}

/** $B8AD92 — Enguarde attacking. */
export function kong_state_51() {
  reg.a = 0x1e;
  process_player_action();
  if (reg.c) return CODE_B8ADAC();
  reg.a = 0x0003;
  interpolate_x_velocity();
  reg.a = 0x0003;
  interpolate_y_velocity();
  CODE_B898C2();
  CODE_B8ADE8();
  CODE_B8ADAC();
}
/** $B8ADAC */
export function CODE_B8ADAC() {
  kongStateReturn();
}

/** $B8ADAF — Enguarde super attack (dash at speed $42). */
export function kong_state_52() {
  reg.a = 0x26;
  process_player_action();
  if (reg.c) return CODE_B8ADDD();
  let x = cur();
  sw(x, S.x_speed, sr(x, S.general_purpose_42));
  sw(x, S.max_x_speed, sr(x, S.general_purpose_42));
  reg.a = 0x0003;
  interpolate_x_velocity();
  reg.a = 0x0003;
  interpolate_y_velocity();
  CODE_B898C2();
  CODE_B8ADE8();
  x = cur();
  reg.x = x;
  reg.a = sr(x, S.terrain_interaction) & 0x0202;
  if (reg.a === 0x0202) return CODE_B8ADE0();
  CODE_B8ADDD();
}
/** $B8ADDD */
export function CODE_B8ADDD() {
  kongStateReturn();
}
/** $B8ADE0 — hit a wall: back to normal swimming. */
export function CODE_B8ADE0() {
  reg.a = 0x50;
  sw(reg.x, S.state, 0x50);
  kongStateReturn();
}
/** $B8ADE8 */
export function CODE_B8ADE8() {
  reg.a = 0x0006;
  init_special_player_clipping();
}

/** $B8ADF0 — Rambi. */
export function kong_state_53() {
  reg.a = 0x0c;
  process_player_action();
  const x = cur();
  reg.x = x;
  if (sr(x, S.carry_or_defeat_flags) === 0x0002) return CODE_B8AE0B();
  handle_player_slope_state_and_anim();
  handle_player_physics();
  CODE_B89AE0();
  kongStateReturn();
}
/** $B8AE0B */
export function CODE_B8AE0B() {
  start_rambi_attack();
  kongStateReturn();
}

/** $B8AE11 */
export function kong_state_55() {
  process_sprite_animation();
  kongStateReturn();
}

/** $B8AE18 — running in the air (fast flag), until touching ground or a wall. */
export function kong_state_56() {
  const x = cur();
  reg.x = x;
  if (sr(x, S.terrain_interaction) & 0x0303) return CODE_B8AE4A();
  reg.a = 0x0009;
  init_special_player_clipping();
  reg.a = 0x0001;
  process_player_action();
  face_moving_direction();
  set_normal_gravity_if_falling();
  const ctrl = r16(R.active_kong_control_variables);
  reg.x = ctrl;
  reg.a = r16(ctrl + K.fast_flag) | 0x0004;
  w16(ctrl + K.fast_flag, reg.a);
  handle_player_physics();
  CODE_B8B714();
  CODE_B8B5C3();
  kongStateReturn();
}
/** $B8AE4A */
export function CODE_B8AE4A() {
  CODE_B9DFCF();
  kongStateReturn();
}

/** $B8AE51 */
export function kong_state_57() {
  CODE_B89B30();
  reg.a = 0x0007;
  process_player_action();
  handle_player_slope_state_and_anim();
  handle_player_physics();
  kongStateReturn();
}

/** $B8AE63 */
export function kong_state_58() {
  reg.a = 0x0c;
  process_player_action();
  apply_player_gravity();
  get_x_acceleration();
  reg.a = spriteConst(reg.y);
  interpolate_x_velocity();
  handle_slope_sliding_velocity();
  apply_position_from_velocity();
  record_highest_y_position();
  handle_player_physics_skip_terrain();
  kongStateReturn();
}

/** $B8AE83 — moving without terrain collision. */
export function kong_state_59() {
  reg.a = 0x20;
  process_player_action();
  apply_player_gravity();
  get_x_acceleration();
  reg.a = spriteConst(reg.y);
  interpolate_x_velocity();
  handle_slope_sliding_velocity();
  apply_position_from_velocity();
  reg.x = cur();
  sw(reg.x, S.terrain_interaction, 0);
  CODE_B89963();
  kongStateReturn();
}

/** $B8AEA4 */
export function kong_state_5A() {
  reg.a = 0x0c;
  process_player_action();
  handle_player_physics();
  kongStateReturn();
}

/** $B8AEB0 */
export function kong_state_5B_5C() {
  reg.a = 0x20;
  process_player_action();
  CODE_B8AEB6();
}
/** $B8AEB6 */
export function CODE_B8AEB6() {
  update_damaged_invincibility();
  process_sprite_animation();
  kongStateReturn();
}

/** $B8AEC0 — walking off screen at speed $4E (end of a bonus), then fade out. */
export function kong_state_70() {
  const x = cur();
  reg.x = x;
  sw(x, S.max_x_speed, sr(x, S.general_purpose_4E));
  reg.a = (sr(x, S.x_position) - r16(R.screen_scroll_x_position)) & 0xffff;
  if (reg.a & 0x8000 || pl(reg.a, 0x0100)) return CODE_B8AED5();
  CODE_B8AEB6();
}
/** $B8AED5 */
export function CODE_B8AED5() {
  const x = reg.x;
  const speed = sr(x, S.general_purpose_4E);
  sw(x, S.max_x_speed, speed);
  sw(x, S.x_speed, speed);
  sw(x, S.state, 0x66);
  sw(x, S.y_speed, 0);
  set_level_end_fade();
  kongStateReturn();
}

/** $B8AEE9 — bounced and stunned (squashed?), with a shrinking bounce and the $091F mash counter. */
export function kong_state_5D() {
  reg.a = 0x1f;
  process_player_action();
  const x = cur();
  reg.x = x;
  if (!(sr(x, S.general_purpose_42) & 0x8000)) return CODE_B8AF13();
  apply_player_gravity();
  reg.x = cur();
  reg.a = sr(reg.x, S.y_speed);
  process_terrain_interaction();
  const x2 = reg.x;
  if (sr(x2, S.terrain_interaction) & 0x0001) {
    // bounce off the ground with half the previous bounce speed
    sw(x2, S.y_speed, neg(sr(x2, S.general_purpose_44)));
    sw(x2, S.general_purpose_44, sr(x2, S.general_purpose_44) >> 1);
  }
  CODE_B8AF11();
}
/** $B8AF11 */
export function CODE_B8AF11() {
  CODE_B8AF15();
}
/** $B8AF13 */
export function CODE_B8AF13() {
  const x = reg.x;
  sw(x, S.general_purpose_42, sr(x, S.general_purpose_42) - 1);
  CODE_B8AF15();
}
/** $B8AF15 */
export function CODE_B8AF15() {
  update_damaged_invincibility();
  const x = cur();
  reg.x = x;
  reg.a = sr(x, S.general_purpose_50);
  if (reg.a === 0) return CODE_B8AF30();
  reg.a = xba(reg.a);
  reg.y = reg.a;
  if (reg.a & 0x8000) return CODE_B8AF2E();
  reg.a = xba(neg(reg.a) & 0xff00);
  sw(x, S.general_purpose_50, reg.a);
  CODE_B8AF30();
}
/** $B8AF2E */
export function CODE_B8AF2E() {
  sw(reg.x, S.general_purpose_50, 0);
  CODE_B8AF30();
}
/** $B8AF30 */
export function CODE_B8AF30() {
  CODE_B8AF85();
  if (reg.c) {
    const x = cur();
    reg.x = x;
    CODE_B8AF63();
    sw(x, S.general_purpose_50, reg.a);
    reg.a = 0x8001;
    sw(x, S.display_mode, 0x8001);
  }
  CODE_B8AF41();
}
/** $B8AF41 */
export function CODE_B8AF41() {
  reg.a = r16(0x091f);
  if (reg.a & 0x8000) return CODE_B8AF49();
  kongStateReturn();
}
/** $B8AF49 — mashed free. */
export function CODE_B8AF49() {
  const x = cur();
  reg.x = x;
  sw(x, S.display_mode, 0);
  sw(x, S.general_purpose_50, 0);
  w16(0x091b, r16(0x091b) & 0xfcff);
  CODE_BB8C2C();
  CODE_B9DFCF();
  kongStateReturn();
}
/** $B8AF63 — shake strength from the remaining mash count. */
export function CODE_B8AF63() {
  const a = r16(0x091f);
  if (mi(a, 0x08)) return CODE_B8AF81();
  if (mi(a, 0x10)) return CODE_B8AF7D();
  if (mi(a, 0x18)) return CODE_B8AF79();
  reg.a = 0x0001;
}
/** $B8AF79 */
export function CODE_B8AF79() {
  reg.a = 0x0002;
}
/** $B8AF7D */
export function CODE_B8AF7D() {
  reg.a = 0x0003;
}
/** $B8AF81 */
export function CODE_B8AF81() {
  reg.a = 0x0004;
}
/** $B8AF85 — button mashing: every 4th frame a recorded press counts down $091F (carry set). */
export function CODE_B8AF85() {
  const ctrl = r16(R.active_kong_control_variables);
  reg.x = ctrl;
  reg.a = r16(ctrl + K.input_pressed) & C.input_ABXY;
  if (reg.a) {
    reg.a = 0x0008;
    or16(R.RAM_0B02, 0x0008);
  }
  CODE_B8AF95();
}
/** $B8AF95 */
export function CODE_B8AF95() {
  reg.a = r16(R.active_frame_counter) & 0x0003;
  if (reg.a) return CODE_B8AFA9();
  reg.a = 0x0008;
  const old = r16(R.RAM_0B02);
  w16(R.RAM_0B02, old & ~0x0008);
  if ((old & 0x0008) === 0) return CODE_B8AFA9();
  w16(0x091f, r16(0x091f) - 1);
  reg.c = true;
}
/** $B8AFA9 */
export function CODE_B8AFA9() {
  reg.c = false;
}

/** $B8AFBC — knocked back with constant speed until landing, then next state. */
export function kong_state_5E() {
  let x = cur();
  const speed = spriteConst(0x2c);
  sw(x, S.x_speed, speed);
  sw(x, S.max_x_speed, speed);
  CODE_B89933();
  x = cur();
  reg.x = x;
  if (sr(x, S.terrain_interaction) & 0x0001) return CODE_B8AFD4();
  spriteReturn();
}
/** $B8AFD4 */
export function CODE_B8AFD4() {
  const x = reg.x;
  sw(x, S.state, sr(x, S.state) + 1);
  sw(x, S.y_speed, 0);
  reg.a = 0x3d;
  set_inactive_kong_anim_handle_dixie();
  spriteReturn();
}

/** $B8AFE2 — running off screen. */
export function kong_state_5F() {
  check_if_sprite_offscreen_global();
  if (reg.c) return CODE_B8B002();
  const x = cur();
  sw(x, S.interaction_flags, 0);
  const speed = spriteConst(0x2c);
  sw(x, S.x_speed, speed);
  sw(x, S.max_x_speed, speed);
  reg.x = x;
  apply_position_from_velocity();
  update_damaged_invincibility();
  process_sprite_animation();
  spriteReturn();
}
/** $B8B002 */
export function CODE_B8B002() {
  CODE_B8B831();
  spriteReturn();
}

/** $B8B008 — wait $42 frames, then continue as state $0B. */
export function kong_state_60() {
  const x = cur();
  reg.x = x;
  const t = (sr(x, S.general_purpose_42) - 1) & 0xffff;
  sw(x, S.general_purpose_42, t);
  if (t === 0) return CODE_B8B01A();
  reg.a = 0x0008;
  process_player_action();
  handle_player_damaged_invincibility();
  kongStateReturn();
}
/** $B8B01A */
export function CODE_B8B01A() {
  reg.a = 0x000b;
  sw(reg.x, S.state, 0x000b);
  spriteTail(KONG_STATE_0B);
}

/** $B8B022 */
export function kong_state_61() {
  reg.a = 0x0007;
  process_player_action();
  handle_player_physics();
  CODE_B8B5DA();
  kongStateReturn();
}

/** $B8B031 */
export function kong_state_62() {
  reg.a = 0x0008;
  process_player_action();
  set_player_jumping_gravity();
  const ctrl = r16(R.current_kong_control_variables);
  w16(ctrl + K.fast_flag, r16(ctrl + K.fast_flag) | 0x0004);
  face_moving_direction();
  set_normal_gravity_if_falling();
  handle_player_physics();
  kongStateReturn();
}

/** $B8B051 — stuck and shaking until the mash counter $091F runs out. */
export function kong_state_63() {
  reg.a = 0x1f;
  process_player_action();
  update_damaged_invincibility();
  CODE_B8AF85();
  if ((r16(R.active_frame_counter) & 0x0003) === 0) {
    const x = cur();
    reg.x = x;
    sw(x, S.display_mode, 0x8001);
    reg.a = sr(x, S.general_purpose_50) ^ 0x0400;
    sw(x, S.general_purpose_50, reg.a);
  }
  CODE_B8B072();
}
/** $B8B072 */
export function CODE_B8B072() {
  reg.a = r16(R.active_frame_counter) & 0x0003;
  if (reg.a === 0) w16(0x091f, r16(0x091f) - 1);
  CODE_B8B07C();
}
/** $B8B07C */
export function CODE_B8B07C() {
  reg.a = r16(0x091f);
  if (reg.a & 0x8000) return CODE_B8B084();
  kongStateReturn();
}
/** $B8B084 */
export function CODE_B8B084() {
  reg.x = cur();
  sw(reg.x, S.general_purpose_50, 0);
  CODE_B9DFCF();
  kongStateReturn();
}

/** $B8B08F — falling into the level from above. */
export function kong_state_64() {
  const x = cur();
  reg.x = x;
  if (sr(x, S.terrain_interaction) & 0x0001) return CODE_B8B0AC();
  reg.a = (sr(x, S.y_position) - r16(R.screen_scroll_y_position)) & 0xffff;
  if (pl(reg.a, 0x0120)) return CODE_B8B0AC();
  CODE_B8B0A3();
}
/** $B8B0A3 */
export function CODE_B8B0A3() {
  CODE_B89933();
  prevent_sprite_from_leaving_level_x();
  kongStateReturn();
}
/** $B8B0AC */
export function CODE_B8B0AC() {
  CODE_B8830E();
  CODE_B8B0A3();
}

/** $B8B0B1 — walking out of the level at speed $4E until off screen or blocked by a wall. */
export function kong_state_65() {
  const x = cur();
  reg.x = x;
  sw(x, S.max_x_speed, sr(x, S.general_purpose_4E));
  reg.a = (sr(x, S.x_position) - r16(R.screen_scroll_x_position)) & 0xffff;
  if (reg.a & 0x8000 || pl(reg.a, 0x0100)) return CODE_B8B0D6();
  CODE_B89933();
  reg.x = cur();
  reg.a = sr(reg.x, S.terrain_interaction) & 0x0002;
  if (reg.a === 0x0002) return CODE_B8B0D6();
  kongStateReturn();
}
/** $B8B0D6 */
export function CODE_B8B0D6() {
  const x = reg.x;
  const speed = sr(x, S.general_purpose_4E);
  sw(x, S.max_x_speed, speed);
  sw(x, S.x_speed, speed);
  sw(x, S.state, sr(x, S.state) + 1);
  sw(x, S.y_speed, 0);
  set_level_end_fade();
  kongStateReturn();
}

/** $B8B0E6 */
export function kong_state_66() {
  CODE_B89928();
  kongStateReturn();
}

/** $B8B0EC — standing on a moving platform sprite ($42). */
export function kong_state_67() {
  reg.a = 0x0001;
  process_player_action();
  set_normal_gravity_if_falling();
  handle_player_physics();
  CODE_B8B5C3();
  CODE_B8B107();
  kongStateReturn();
}
/** $B8B101 */
export function kong_state_68() {
  CODE_B8B107();
  spriteTail(KONG_STATE_16);
}
/** $B8B107 — ride along with the platform in $42, unless it has left the valid range. */
export function CODE_B8B107() {
  const x = cur();
  reg.x = x;
  const y = sr(x, S.general_purpose_42);
  reg.y = y;
  if (y === 0) return CODE_B8B136();
  if (sr(y, S.ground_distance) & 0x8000) return CODE_B8B12E();
  const px = sr(y, S.x_position);
  reg.a = px;
  if (px >= 0x3340 && px < 0x3370) return CODE_B8B12E();
  CODE_B8B11F();
}
/** $B8B11F */
export function CODE_B8B11F() {
  const x = reg.x;
  const y = reg.y;
  sw(x, S.x_position, sr(y, S.general_purpose_4A));
  reg.a = (sr(x, S.x_position) - sr(y, S.x_position)) & 0xffff;
  reg.x = r16(R.active_kong_control_variables);
  w16(reg.x + K.roll_speed, reg.a);
}
/** $B8B12E — stop following the platform. */
export function CODE_B8B12E() {
  reg.a = 0;
  sw(reg.y, S.general_purpose_42, 0);
  sw(reg.x, S.general_purpose_42, 0);
  CODE_B8B136();
}
/** $B8B136 */
export function CODE_B8B136() {}

/** $B8B137 — blown upward by a wind sprite ($19C4). */
export function kong_state_69() {
  reg.a = 0x21;
  process_player_action();
  face_moving_direction();
  or16(0x0ab8, 0x2000);
  const x = cur();
  reg.x = x;
  sw(x, S.y_speed, sr(x, S.y_speed) - 0x7c);
  apply_player_gravity();
  reg.y = 0x6e;
  reg.a = spriteConst(0x6e);
  interpolate_x_velocity();
  handle_player_physics_skip_speed();
  const xr = reg.x;
  const wind = r16(0x19c4);
  reg.y = wind;
  const limit = (sr(wind, S.general_purpose_4A) + sr(xr, S.max_y_speed)) & 0xffff;
  w16(0x32, limit);
  reg.a = sr(xr, S.y_speed);
  if (reg.a & 0x8000 && !pl(reg.a, limit)) {
    reg.a = limit;
    sw(xr, S.y_speed, limit);
  }
  CODE_B8B175();
}
/** $B8B175 */
export function CODE_B8B175() {
  kongStateReturn();
}

/** $B8B178 */
export function kong_state_6A() {
  reg.a = 0x0c;
  process_player_action();
  apply_player_gravity();
  CODE_B89928();
  spriteReturn();
}
/** $B8B187 */
export function kong_state_6B() {
  reg.a = 0x0c;
  process_player_action();
  apply_player_gravity();
  CODE_B89928();
  handle_player_pit_death();
  spriteReturn();
}

/** $B8B199 — Enguarde on land / Rambi-like charge with collision attack. */
export function kong_state_6C() {
  const ctrl = r16(R.current_kong_control_variables);
  reg.y = ctrl;
  if (r16(ctrl + K.animation_id) !== 0x8f) {
    reg.a = 0x0007;
    get_sprite_special_clipping_slot_0();
    reg.a = 0x0020;
    check_for_sprite_collisions();
    if (reg.c) return CODE_B8B1C4();
  }
  CODE_B8B1B3();
}
/** $B8B1B3 */
export function CODE_B8B1B3() {
  reg.a = 0x22;
  process_player_action();
  if (reg.c) return CODE_B8B1C1();
  handle_player_physics();
  CODE_B8B5DA();
  CODE_B8B1C1();
}
/** $B8B1C1 */
export function CODE_B8B1C1() {
  kongStateReturn();
}
/** $B8B1C4 */
export function CODE_B8B1C4() {
  reg.x = cur();
  sw(reg.x, S.x_speed, 0);
  start_enguarde_attack();
  kongStateReturn();
}

/** $B8B1CE — timed state $42, then back to state 1. */
export function kong_state_6D() {
  const x = cur();
  reg.x = x;
  const t = (sr(x, S.general_purpose_42) - 1) & 0xffff;
  sw(x, S.general_purpose_42, t);
  if (t & 0x8000) {
    reg.a = 0x0001;
    sw(x, S.state, 0x0001);
  }
  CODE_B8B1D9();
}
/** $B8B1D9 */
export function CODE_B8B1D9() {
  face_moving_direction();
  set_normal_gravity_if_falling();
  handle_player_physics();
  kongStateReturn();
}

/** $B8B1E5 — rising; becomes state 6 once the vertical speed passes $80. */
export function kong_state_6E() {
  const x = cur();
  reg.x = x;
  reg.a = (sr(x, S.y_speed) - 0x80) & 0xffff;
  if (!(reg.a & 0x8000)) {
    reg.a = 0x0006;
    sw(x, S.state, 0x0006);
  }
  CODE_B8B1F4();
}
/** $B8B1F4 */
export function CODE_B8B1F4() {
  reg.a = 0x0001;
  process_player_action();
  face_moving_direction();
  set_normal_gravity_if_falling();
  handle_player_physics();
  CODE_B89CCD();
  if (reg.c) return CODE_B8B20E();
  CODE_B8B714();
  CODE_B8B5C3();
  CODE_B8B20E();
}
/** $B8B20E */
export function CODE_B8B20E() {
  kongStateReturn();
}

/** $B8B211 — paused (two player team: waiting kong blinking), frame counter held. */
export function kong_state_6F() {
  reg.a = 0x23;
  process_player_action();
  if (reg.c) return CODE_B8B252();
  CODE_B8B219();
}
/** $B8B219 */
export function CODE_B8B219() {
  or16(R.game_state_flags, 0x0100);
  w16(R.active_frame_counter, r16(R.active_frame_counter) - 1);
  const x = cur();
  reg.x = x;
  const old = sr(x, S.general_purpose_4A);
  w16(0x32, old);
  reg.a = (old + 1) & 0x0fff;
  sw(x, S.general_purpose_4A, reg.a);
  reg.a = (reg.a ^ old) & 0x0010;
  if (reg.a === 0) return CODE_B8B234();
  CODE_B8B237();
}
/** $B8B234 — `JML [sprite_return_address]` */
export function CODE_B8B234() {}
/** $B8B237 — blink every 16 frames. */
export function CODE_B8B237() {
  reg.a = r16(0x32) & 0x0010;
  if (reg.a) return CODE_B8B245();
  reg.a = 0xc000;
  sw(reg.x, S.display_mode, 0xc000);
  CODE_B8B234();
}
/** $B8B245 */
export function CODE_B8B245() {
  reg.a = (7 << 8) | C.sound_pause;
  play_high_priority_sound();
  CODE_B8B24C();
}
/** $B8B24C */
export function CODE_B8B24C() {
  reg.x = cur();
  sw(reg.x, S.display_mode, 0);
  CODE_B8B234();
}
/** $B8B252 */
export function CODE_B8B252() {
  reg.a = (7 << 8) | C.sound_nothing;
  play_high_priority_sound();
  CODE_B8B24C();
}

/** $B8B25B */
export function kong_state_71() {
  process_sprite_animation();
  spriteReturn();
}
/** $B8B262 */
export function kong_state_72() {
  reg.a = 0x20;
  process_player_action();
  apply_player_gravity();
  reg.a = 0x0007;
  interpolate_x_velocity();
  apply_position_from_velocity();
  process_sprite_animation();
  spriteReturn();
}

/** $B8B27B — cutscene-controlled kong. */
export function kong_state_73() {
  CODE_BBC140();
  kongStateReturnIfActive();
}
/** $B8B282 */
export function kong_state_74() {
  process_anim_preserve_state();
  CODE_BBC140();
  kongStateReturnIfActive();
}
/** $B8B28D */
export function kong_state_75() {
  reg.a = 0x000b;
  interpolate_x_velocity();
  apply_position_from_velocity();
  process_anim_preserve_state();
  CODE_BBC140();
  kongStateReturnIfActive();
}

/** $B8B2A1 — follower dropping down to the active kong's height. */
export function kong_state_76() {
  const x = cur();
  reg.x = x;
  reg.y = r16(R.current_kong_control_variables);
  let a = (0x60 + sr(x, S.y_speed)) & 0xffff;
  if (!(a & 0x8000) && a >= 0x0600) a = 0x0600;
  sw(x, S.y_speed, a);
  apply_position_from_velocity();
  const x2 = cur();
  reg.x = x2;
  reg.a = sr(x2, S.y_speed);
  if (!(reg.a & 0x8000)) {
    const active = r16(R.active_kong_sprite);
    reg.y = active;
    reg.a = sr(x2, S.y_position);
    if (pl(reg.a, sr(active, S.y_position))) {
      // .CODE_B8B2D4: reached the active kong
      sw(x2, S.state, 0x22);
      sw(x2, S.render_order, 0xd8);
      reg.a = 0x1f;
      reg.x = 0x03;
      reg.y = 0;
      CODE_B8D8D5();
      sw(r16(R.active_kong_sprite), S.render_order, 0xe4);
      work_on_active_kong();
      start_player_falling();
      work_on_inactive_kong();
      return spriteReturn();
    }
  }
  update_damaged_invincibility();
  process_anim_preserve_state();
  spriteReturn();
}

/** $B8B2FE */
export function kong_state_77() {
  apply_position_from_velocity();
  CODE_B8B310();
  kongStateReturn();
}
/** $B8B307 */
export function kong_state_78() {
  apply_position_from_velocity();
  CODE_B8B310();
  spriteReturn();
}
/** $B8B310 — after the timer $0D64 runs out, Dixie hands over to Diddy (swap, underwater setup). */
export function CODE_B8B310() {
  const x0 = cur();
  reg.x = x0;
  reg.a = sr(x0, S.type);
  if (reg.a !== C.sprite_dixie_kong) return CODE_B8B377();
  const t = (r16(0x0d64) - 1) & 0xffff;
  w16(0x0d64, t);
  if (t !== 0) return CODE_B8B377();
  // Rev 1: keep the invincibility timer across the swap and clear the flashing
  let ctrl = r16(R.active_kong_control_variables);
  w16(ctrl + K.flash_timer, 0);
  const inv = r16(ctrl + K.invincible_timer);
  reg.y = ctrl;
  swap_active_kong_global();
  ctrl = r16(R.active_kong_control_variables);
  w16(ctrl + K.invincible_timer, inv);
  w16(ctrl + K.flash_timer, 0);
  reg.y = ctrl;
  reg.a = 0;
  work_on_active_kong();
  let x = reg.x;
  sw(x, S.state, 0x3d);
  sw(x, S.display_mode, 0);
  sw(x, S.x_sub_position, r16(0x0d66));
  sw(x, S.y_position, r16(0x0d6c));
  sw(x, S.render_order, 0xe4);
  set_swim_gravity_and_y_speed();
  work_on_inactive_kong();
  x = reg.x;
  sw(x, S.state, 0x22);
  sw(x, S.display_mode, 0);
  sw(x, S.render_order, 0xd8);
  reg.a = 0x1f;
  reg.x = 0x43;
  reg.y = 0;
  CODE_B8D8D5();
  CODE_BB8C19();
  CODE_B8B377();
}
/** $B8B377 */
export function CODE_B8B377() {}

/** $B8B378 */
export function kong_state_79() {
  reg.a = 0x19;
  process_player_action();
  update_damaged_invincibility();
  process_sprite_animation();
  kongStateReturn();
}
/** $B8B388 */
export function kong_state_7A() {
  reg.a = 0x24;
  process_player_action();
  update_damaged_invincibility();
  process_sprite_animation();
  kongStateReturn();
}

/** $B8B398 — falling into the boss arena; on landing the boss music starts and coins may spawn. */
export function kong_state_7B() {
  reg.a = 0x20;
  process_player_action();
  apply_player_gravity();
  get_x_acceleration();
  reg.a = spriteConst(reg.y);
  interpolate_x_velocity();
  handle_slope_sliding_velocity();
  process_terrain_interaction();
  record_highest_y_position();
  prevent_sprite_from_leaving_level_x();
  handle_player_pit_death();
  update_damaged_invincibility();
  process_anim_preserve_state();
  const x = cur();
  reg.x = x;
  reg.a = sr(x, S.terrain_interaction) & 0x0001;
  if (reg.a) return CODE_B8B3CB();
  CODE_B8B3C8();
}
/** $B8B3C8 */
export function CODE_B8B3C8() {
  kongStateReturnIfActive();
}
/** $B8B3CB */
export function CODE_B8B3CB() {
  if (reg.x === r16(R.inactive_kong_sprite)) return CODE_B8B3C8();
  work_on_active_kong();
  sw(reg.x, S.state, 0x47);
  reg.a = 0x45;
  set_anim_handle_dixie();
  reg.a = r16(R.game_state_flags) & 0x4000;
  CODE_B8B3E7();
}
/** $B8B3E7 */
export function CODE_B8B3E7() {
  CODE_B8B3F0();
  CODE_B8B3C8();
}
/** $B8B3EC */
export function CODE_B8B3EC() {
  CODE_B8B3F0();
}
/** $B8B3F0 — boss victory: play the kong victory song and drop the krem coin (or DK coin in Krocodile Kore). */
export function CODE_B8B3F0() {
  const lvl = r16(R.level_number);
  reg.a = lvl;
  if (lvl === C.level_krool_duel || lvl === C.level_stronghold_showdown) return CODE_B8B40A();
  if (lvl === C.level_krocodile_kore) return CODE_B8B435();
  reg.x = 0x0002;
  reg.y = 0x0003;
  transition_kong_dependant_song();
  CODE_B8B40A();
}
/** $B8B40A */
export function CODE_B8B40A() {
  is_current_krem_coin_collected();
  if (reg.c) return CODE_B8B434();
  reg.a = rom16(DATA_FF1904);
  reg.y = reg.a;
  spawn_special_sprite_address();
  if (reg.c) return CODE_B8B434();
  const x = r16(R.alternate_sprite);
  reg.x = x;
  sw(x, S.general_purpose_42, 0x1b);
  sw(x, S.x_speed, 0);
  sw(x, S.y_speed, 0);
  const active = r16(R.active_kong_sprite);
  reg.y = active;
  sw(x, S.x_position, sr(active, S.x_position));
  reg.a = r16(R.screen_scroll_y_position);
  sw(x, S.y_position, reg.a);
  reg.c = false;
}
/** $B8B434 */
export function CODE_B8B434() {}
/** $B8B435 */
export function CODE_B8B435() {
  is_current_level_dk_coin_collected();
  if (reg.c) return CODE_B8B434();
  reg.a = rom16(DATA_FF18F0);
  reg.y = reg.a;
  spawn_special_sprite_address();
  if (reg.c) return CODE_B8B434();
  const x = r16(R.alternate_sprite);
  reg.x = x;
  sw(x, S.oam_property, sr(x, S.oam_property) | 0x3000);
  sw(x, S.general_purpose_42, 0x11);
  sw(x, S.x_speed, 0);
  sw(x, S.y_speed, 0);
  const active = r16(R.active_kong_sprite);
  reg.y = active;
  sw(x, S.x_position, sr(active, S.x_position));
  reg.a = r16(R.screen_scroll_y_position);
  sw(x, S.y_position, reg.a);
  reg.c = false;
}

/** $B8B467 — cutscene walking with gravity. */
export function kong_state_7C() {
  const x = cur();
  reg.x = x;
  sw(x, S.unknown_2C, 0);
  apply_player_gravity();
  reg.a = 0x000b;
  interpolate_x_velocity();
  process_terrain_interaction();
  prevent_sprite_from_leaving_level_x();
  update_damaged_invincibility();
  process_anim_preserve_state();
  CODE_BBC140();
  kongStateReturnIfActive();
}

/** $B8B488 — paused variant (resumes as state $5B). */
export function kong_state_7D() {
  reg.a = 0x23;
  process_player_action();
  const x = cur();
  reg.x = x;
  reg.a = sr(x, S.state);
  if (reg.a === 0x7d) return CODE_B8B219();
  CODE_B8B49A();
}
/** $B8B49A */
export function CODE_B8B49A() {
  sw(reg.x, S.state, 0x5b);
  sw(reg.x, S.display_mode, 0);
  kongStateReturn();
}

/** $B8B4A4 */
export function kong_state_7E() {
  CODE_B381CA();
  CODE_B8A186();
  kongStateReturnClipping();
}

/** $B8B4AE — paused variant (resumes falling as state $67). */
export function kong_state_7F() {
  reg.a = 0x23;
  process_player_action();
  const x = cur();
  reg.x = x;
  reg.a = sr(x, S.state);
  if (reg.a === 0x7f) return CODE_B8B219();
  CODE_B8B4C0();
}
/** $B8B4C0 */
export function CODE_B8B4C0() {
  start_player_falling();
  const x = cur();
  reg.x = x;
  sw(x, S.state, 0x67);
  sw(x, S.display_mode, 0);
  kongStateReturn();
}

/** $B8B4CF — load the held rope's hanging range (4 words from its constants) into $32-$38. */
export function CODE_B8B4CF() {
  const rope = r16(R.held_rope_sprite);
  reg.x = rope;
  w16(0x5e, sr(rope, S.constants_address));
  w16(0x60, r16(R.current_sprite_constants_bank));
  const base = ((r16(0x60) & 0xff) << 16) | r16(0x5e);
  for (let i = 0; i < 4; i++) w16(0x32 + i * 2, bus16((base + i * 2) & 0xffffff));
  reg.y = 0x0006;
  reg.a = r16(0x38);
}

/**
 * $B8B4F7 — X = rope sprite: carry set when the active kong is outside the rope's range
 * [y+$36, y+$38]; A = the y to clamp to.
 */
export function CODE_B8B4F7() {
  const rope = reg.x;
  reg.y = rope;
  const k = r16(R.active_kong_sprite);
  reg.x = k;
  reg.a = (sr(rope, S.y_position) + r16(0x36)) & 0xffff;
  if (pl(reg.a, sr(k, S.y_position))) return CODE_B8B511();
  reg.a = (sr(rope, S.y_position) + r16(0x38)) & 0xffff;
  if (mi(reg.a, sr(k, S.y_position))) return CODE_B8B514();
  reg.c = false;
}
/** $B8B511 */
export function CODE_B8B511() {
  reg.a = (reg.a + 1) & 0xffff;
  reg.c = true;
}
/** $B8B514 */
export function CODE_B8B514() {
  reg.c = true;
}

registerSprite({
  kong_state_3F, kong_state_40, CODE_B8AA6D, kong_state_41, CODE_B8AA89, kong_state_42,
  CODE_B8AAD2, kong_state_43, kong_state_44, CODE_B8AAF4, CODE_B8AB08, kong_state_45, CODE_B8AB4F,
  CODE_B8AB53, CODE_B8AB5A, CODE_B8AB5D, CODE_B8AB62, kong_state_46, CODE_B8AB8F, CODE_B8AB98,
  CODE_B8ABA8, CODE_B8ABC0, CODE_B8ABC7, CODE_B8ABE0, kong_state_47, kong_state_48, kong_state_49,
  kong_state_4A, kong_state_4B, CODE_B8AC43, CODE_B8AC4A, CODE_B8AC51, kong_state_4C, CODE_B8AC80,
  kong_state_4D, CODE_B8ACD9, kong_state_4E, kong_state_4F, kong_state_50, CODE_B8AD44,
  CODE_B8AD5B, CODE_B8AD63, CODE_B8AD74, CODE_B8AD76, CODE_B8AD85, CODE_B8AD88, kong_state_51,
  CODE_B8ADAC, kong_state_52, CODE_B8ADDD, CODE_B8ADE0, kong_state_53, CODE_B8AE0B, kong_state_55,
  kong_state_56, CODE_B8AE4A, kong_state_57, kong_state_58, kong_state_59, kong_state_5A,
  kong_state_5B_5C, CODE_B8AEB6, kong_state_70, CODE_B8AED5, kong_state_5D, CODE_B8AF11,
  CODE_B8AF13, CODE_B8AF15, CODE_B8AF2E, CODE_B8AF30, CODE_B8AF41, CODE_B8AF49, kong_state_5E,
  CODE_B8AFD4, kong_state_5F, CODE_B8B002, kong_state_60, CODE_B8B01A, kong_state_61, kong_state_62,
  kong_state_63, CODE_B8B072, CODE_B8B07C, CODE_B8B084, kong_state_64, CODE_B8B0A3, CODE_B8B0AC,
  kong_state_65, CODE_B8B0D6, kong_state_66, kong_state_67, kong_state_68, kong_state_69,
  CODE_B8B175, kong_state_6A, kong_state_6B, kong_state_6C, CODE_B8B1B3, CODE_B8B1C1, CODE_B8B1C4,
  kong_state_6D, CODE_B8B1D9, kong_state_6E, CODE_B8B1F4, CODE_B8B20E, kong_state_6F, CODE_B8B219,
  CODE_B8B234, CODE_B8B237, CODE_B8B245, CODE_B8B24C, CODE_B8B252, kong_state_71, kong_state_72,
  kong_state_73, kong_state_74, kong_state_75, kong_state_76, kong_state_77, kong_state_78,
  kong_state_79, kong_state_7A, kong_state_7B, CODE_B8B3C8, CODE_B8B3CB, CODE_B8B3E7, kong_state_7C,
  kong_state_7D, CODE_B8B49A, kong_state_7E, kong_state_7F, CODE_B8B4C0,
});
registerRts({
  CODE_B8AA8C, CODE_B8ADE8, CODE_B8AF63, CODE_B8AF79, CODE_B8AF7D, CODE_B8AF81, CODE_B8AF85,
  CODE_B8AF95, CODE_B8AFA9, CODE_B8B107, CODE_B8B11F, CODE_B8B12E, CODE_B8B136, CODE_B8B310,
  CODE_B8B377, CODE_B8B3F0, CODE_B8B40A, CODE_B8B434, CODE_B8B435, CODE_B8B4CF, CODE_B8B4F7,
  CODE_B8B511, CODE_B8B514,
});
registerRtl({ CODE_B8B3EC });
