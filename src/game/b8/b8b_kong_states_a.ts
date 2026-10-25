/**
 * Bank $B8 — kong states $22-$3E and their helpers ($B8A0B9-$B8AA3D): the follower kong
 * catching up / being thrown, team-up throws, the level-end walk-off and exit states, rope
 * climbing states and the "get the second kong back" (DK barrel) sequence.
 *
 * Sprite field offsets used here: $06 x, $0A y, $20/$24 x/y speed, $26/$2A target x/y speed,
 * $1E terrain interaction, $30 interaction flags, $12 OAM property (bit 14 = facing left),
 * $42-$4A per-state scratch.
 */
import { r16, w16, w8, rom16, or16 } from "../../core/mem";
import { reg } from "../../core/cpu";
import { L, R, C, sprite as S, kong_control as K } from "../../core/sym";
import {
  pl, mi, neg, abs16, asr, spriteConst, cur, sw, sr,
  registerRts, registerRtl, registerSprite, kongStateReturn, spriteReturn,
} from "./b8b_common";
import {
  CODE_BCFB2C, CODE_B8D8D5, CODE_B8D8D7, set_anim_handle_dixie, CODE_B8D99E, CODE_B8DA84,
  CODE_B8DDB1, process_sprite_animation, handle_player_physics_skip_terrain,
  process_terrain_interaction, CODE_B89933, check_if_sprite_offscreen_global,
  start_damaged_invincibility, CODE_B8D7FE, CODE_B8D817, swap_active_kong_global, CODE_BB8C19,
  init_player_clipping, disable_bullet_time, enable_bullet_time, apply_position_from_velocity,
  update_damaged_invincibility, apply_player_gravity, CODE_B8DA65, CODE_B8DA94,
  set_anim_once_handle_dixie, interpolate_x_velocity, CODE_B8A049, init_special_player_clipping,
  CODE_B8A06B, set_player_interaction, work_on_active_kong, work_on_inactive_kong, CODE_B9DFCF,
  CODE_B89928, set_fade_global, interpolate_y_velocity, CODE_B8D362, CODE_B8D378,
  double_rope_climb_right_action, set_player_terminal_velocity, set_player_normal_gravity,
  CODE_B5E43E, CODE_B8D36D, prevent_sprite_from_leaving_level_x, face_moving_direction,
  set_normal_gravity_if_falling, handle_player_physics, get_x_acceleration,
  handle_slope_sliding_velocity, CODE_B898B5, spawn_follower_animal_icon,
  work_on_inactive_kong_global,
} from "../../gen/routines";
import { process_player_action, CODE_B8C305 } from "./b8b_actions";
import { CODE_B8B7F4, CODE_B8B831, CODE_B8B843, CODE_B8B7C9, start_player_falling } from "./b8b_slope";
import { check_sprite_underwater, CODE_B8B530, CODE_B8B714 } from "./b8b_pit_swim";

const KONG_STATE_FLAGS_TABLE = L("kong_state_flags_table");

// ---------------------------------------------------------------------------------------------
// Follower kong catching up with the active kong

/** $B8A0B9 — tail of a follower state: once the follower is close to the active kong, it resumes following. */
export function CODE_B8A0B9() {
  CODE_BCFB2C();
  CODE_B8A0D5();
  if (reg.c) return CODE_B8A0CF();
  const active = r16(R.active_kong_sprite);
  if (sr(active, S.state) === 0x5b) return CODE_B8A0CF();
  spriteReturn();
}

/** $B8A0CF */
export function CODE_B8A0CF() {
  CODE_B8A101();
  spriteReturn();
}

/** $B8A0D5 — carry set when the inactive kong is within 16px horizontally and 32px vertically of the active one. */
export function CODE_B8A0D5() {
  reg.x = r16(R.inactive_kong_sprite);
  reg.y = r16(R.active_kong_sprite);
  reg.a = abs16(sr(reg.y, S.x_position) - sr(reg.x, S.x_position));
  CODE_B8A0E7();
}
/** $B8A0E7 */
export function CODE_B8A0E7() {
  if (pl(reg.a, 0x10)) return CODE_B8A0FF();
  reg.a = abs16(sr(reg.y, S.y_position) - sr(reg.x, S.y_position));
  CODE_B8A0F8();
}
/** $B8A0F8 */
export function CODE_B8A0F8() {
  if (pl(reg.a, 0x20)) return CODE_B8A0FF();
  reg.c = true;
}
/** $B8A0FF */
export function CODE_B8A0FF() {
  reg.c = false;
}

/** $B8A101 — put the follower into state $29 (walking back in from the screen edge), clamped to the screen. */
export function CODE_B8A101() {
  const x = cur();
  sw(x, S.state, 0x29);
  const left = (r16(R.screen_scroll_x_position) - 0x10) & 0xffff;
  if (!mi(left, sr(x, S.x_position))) sw(x, S.x_position, left);
  reg.x = x;
  CODE_B8A115();
}
/** $B8A115 */
export function CODE_B8A115() {
  const x = reg.x;
  const right = (r16(R.screen_scroll_x_position) + 0x110) & 0xffff;
  if (!pl(right, sr(x, S.x_position))) sw(x, S.x_position, right);
  CODE_B8A122();
}
/** $B8A122 */
export function CODE_B8A122() {
  reg.a = 0x1f;
  reg.x = 0x1c;
  reg.y = 0;
  CODE_B8D8D5();
  CODE_B8A14E();
}

/** $B8A131 — follower state $40 (riding along in a barrel). */
export function CODE_B8A131() {
  const x = cur();
  sw(x, S.state, C.kong_state_40);
  w16(0x4a, 0xffe4);
  reg.a = 0x1f;
  reg.x = 0x1c;
  reg.y = 0;
  CODE_B8D8D7();
  CODE_B8A14E();
}

/** $B8A14E — common follower setup: no interaction bits $08/$10, drawn behind, idle animation $40. */
export function CODE_B8A14E() {
  const x = cur();
  sw(x, S.interaction_flags, sr(x, S.interaction_flags) & 0xffe7);
  sw(x, S.render_order, 0xd8);
  reg.x = x;
  reg.a = 0x40;
  set_anim_handle_dixie();
}

/** $B8A164 — follower walking along the recorded path. */
export function kong_state_22() {
  CODE_B8D99E();
  CODE_B8DA84();
  CODE_B8DDB1();
  process_sprite_animation();
  spriteReturn();
}

/** $B8A174 — team-up: the held kong being carried. */
export function kong_state_23() {
  reg.a = 0x11;
  process_player_action();
  CODE_B8A186();
  handle_player_physics_skip_terrain();
  CODE_B8B7F4();
  kongStateReturn();
}

/** $B8A186 — terrain interaction without moving (speeds are saved and restored). */
export function CODE_B8A186() {
  let x = cur();
  const xs = sr(x, S.x_speed);
  const ys = sr(x, S.y_speed);
  sw(x, S.x_speed, 0);
  sw(x, S.y_speed, 0);
  reg.x = x;
  process_terrain_interaction();
  x = cur();
  sw(x, S.y_speed, ys);
  sw(x, S.x_speed, xs);
  reg.x = x;
  reg.a = xs;
}

/** $B8A19E */
export function kong_state_24() {
  or16(R.game_state_flags, 0x0001);
  reg.a = 0x0c;
  process_player_action();
  CODE_B89933();
  kongStateReturn();
}

/** $B8A1B0 — thrown kong flying forward until it stops moving. */
export function kong_state_25() {
  or16(R.game_state_flags, 0x0001);
  check_if_sprite_offscreen_global();
  if (reg.c) return CODE_B8A1E8();
  const x = cur();
  sw(x, S.interaction_flags, 0);
  if ((sr(x, S.terrain_interaction) & 0x0203) === 0x0003) sw(x, S.y_speed, 0xf800);
  reg.x = x;
  CODE_B8A1CF();
}
/** $B8A1CF */
export function CODE_B8A1CF() {
  let x = reg.x;
  const speed = spriteConst(0x2c);
  sw(x, S.x_speed, speed);
  sw(x, S.max_x_speed, speed);
  CODE_B89933();
  CODE_B8A203();
  x = reg.x;
  if (pl(sr(x, S.general_purpose_42), 0x0008)) return CODE_B8A1EE();
  spriteReturn();
}
/** $B8A1E8 */
export function CODE_B8A1E8() {
  CODE_B8B831();
  spriteReturn();
}
/** $B8A1EE — stopped: switch to state $28. */
export function CODE_B8A1EE() {
  const x = reg.x;
  sw(x, S.y_speed, 0);
  sw(x, S.x_speed, 0);
  sw(x, S.max_x_speed, 0);
  sw(x, S.state, 0x28);
  reg.a = 0x2a;
  set_anim_handle_dixie();
  spriteReturn();
}

/** $B8A203 — counts frames ($42) during which the sprite moved less than 4px from $44. */
export function CODE_B8A203() {
  const x = cur();
  reg.x = x;
  reg.a = abs16(sr(x, S.general_purpose_44) - sr(x, S.x_position));
  CODE_B8A210();
}
/** $B8A210 */
export function CODE_B8A210() {
  const x = reg.x;
  if (mi(reg.a, 0x0004)) return CODE_B8A21C();
  sw(x, S.general_purpose_42, 0);
  reg.a = sr(x, S.x_position);
  sw(x, S.general_purpose_44, reg.a);
}
/** $B8A21C */
export function CODE_B8A21C() {
  const x = reg.x;
  sw(x, S.general_purpose_42, sr(x, S.general_purpose_42) + 1);
}

/** $B8A21F — wait $42 frames, then become state $27 with invincibility. */
export function kong_state_26() {
  const x = cur();
  const t = (sr(x, S.general_purpose_42) - 1) & 0xffff;
  sw(x, S.general_purpose_42, t);
  if (t & 0x8000) return CODE_B8A228();
  reg.x = x;
  spriteReturn();
}
/** $B8A228 */
export function CODE_B8A228() {
  start_damaged_invincibility();
  const x = cur();
  sw(x, S.state, 0x27);
  sw(x, S.interaction_flags, 0);
  reg.x = x;
  reg.a = 0x3d;
  set_anim_handle_dixie();
  spriteReturn();
}

/** $B8A23E — inactive kong homing on the active kong's position ($0D66/$0D6A) to swap in. */
export function kong_state_27() {
  CODE_B8B843();
  CODE_B8D7FE();
  CODE_B8D817();
  const y = r16(R.active_kong_control_variables);
  reg.y = y;
  if (r16(y + K.animation_id) === 0x29) return CODE_B8A26F();
  CODE_B8A254();
}
/** $B8A254 */
export function CODE_B8A254() {
  const x = cur();
  reg.x = x;
  reg.a = abs16(sr(x, S.y_speed));
  CODE_B8A25E();
}
/** $B8A25E */
export function CODE_B8A25E() {
  const x = reg.x;
  w16(0x32, reg.a);
  reg.a = abs16(sr(x, S.x_speed));
  CODE_B8A268();
}
/** $B8A268 — arrived once both speeds are below $20. */
export function CODE_B8A268() {
  reg.a = (reg.a | r16(0x32)) & 0xffe0;
  if (reg.a === 0) return CODE_B8A27A();
  CODE_B8A26F();
}
/** $B8A26F */
export function CODE_B8A26F() {
  process_sprite_animation();
  const x = cur();
  sw(x, S.interaction_flags, 0);
  reg.x = x;
  spriteReturn();
}
/** $B8A27A — arrived: this kong becomes the active one, and the old active kong is knocked away. */
export function CODE_B8A27A() {
  let x = cur();
  sw(x, S.interaction_flags, 0x42);
  reg.y = r16(R.current_kong_control_variables);
  sw(x, S.x_position, r16(0x0d66));
  sw(x, S.x_sub_position, 0x8000);
  sw(x, S.y_position, r16(0x0d6a));
  sw(x, S.y_sub_position, 0x8000);
  reg.x = x;
  reg.a = 0x06;
  set_anim_handle_dixie();
  w16(R.game_state_flags, r16(R.game_state_flags) & 0xbfff);
  x = cur();
  sw(x, S.state, 0x06);
  // swap render orders with the active kong
  w16(0x5e, sr(x, S.render_order));
  const active = r16(R.active_kong_sprite);
  sw(x, S.render_order, sr(active, S.render_order));
  sw(active, S.render_order, r16(0x5e));
  reg.x = x;
  swap_active_kong_global();
  CODE_BB8C19();
  init_player_clipping();
  start_damaged_invincibility();
  disable_bullet_time();
  const newActive = r16(R.active_kong_sprite);
  sw(newActive, S.x_speed, r16(0x0d60));
  sw(newActive, S.y_speed, 0xf600);
  reg.x = newActive;
  check_sprite_underwater();
  if (reg.a === 0x0002) sw(cur(), S.y_speed, 0xfe00);
  CODE_B8A2F2();
}
/** $B8A2F2 */
export function CODE_B8A2F2() {
  if (r16(R.current_game_mode) === C.gamemode_2_player_team) return CODE_B8A2FD();
  spriteReturn();
}
/** $B8A2FD — two player team mode: the other kong waits in state $6F with bullet time. */
export function CODE_B8A2FD() {
  const x = cur();
  sw(x, S.state, 0x6f);
  sw(x, S.general_purpose_4A, 0);
  reg.x = x;
  reg.a = 0x0007;
  reg.y = 0;
  enable_bullet_time();
  spriteReturn();
}

/** $B8A312 — knocked-away kong flying off screen. */
export function kong_state_28() {
  reg.x = cur();
  check_if_sprite_offscreen_global();
  if (reg.c) return CODE_B8A327();
  apply_position_from_velocity();
  update_damaged_invincibility();
  process_sprite_animation();
}
/** $B8A327 */
export function CODE_B8A327() {
  CODE_B8B831();
}

/** $B8A32D — follower walking back from the screen edge until it catches up with the path. */
export function kong_state_29() {
  w16(0x0933, r16(0x0933) | 0x0002);
  CODE_B8D99E();
  process_sprite_animation();
  const next = (r16(R.kong_follow_buffer_playback_index) + 2) & 0x3f;
  reg.a = next;
  if (next === r16(R.kong_follow_buffer_recording_index)) return CODE_B8A34A();
  spriteReturn();
}
/** $B8A34A */
export function CODE_B8A34A() {
  reg.a = 0x22;
  sw(reg.x, S.state, 0x22);
  spriteReturn();
}

/** $B8A352 — follower jumping to catch up with the path. */
export function kong_state_2A() {
  const ctrl = r16(R.current_kong_control_variables);
  w16(ctrl + K.gravity_force, spriteConst(0x00));
  w16(ctrl + K.max_fall_speed, spriteConst(0x02));
  apply_player_gravity();
  CODE_B8B7C9();
  if ((r16(0x34) >> 3) === 0) CODE_B8DA65();
  CODE_B8A376();
}
/** $B8A376 */
export function CODE_B8A376() {
  CODE_B8DA94();
  process_terrain_interaction();
  process_sprite_animation();
  if (r16(0x0d6e) !== r16(R.kong_follow_buffer_recording_index)) return CODE_B8A394();
  const x = cur();
  reg.x = x;
  reg.a = (r16(0x0d66) - sr(x, S.x_position)) & 0xffff;
  if (reg.a === 0) return CODE_B8A3AA();
  CODE_B8A3A7();
}
/** $B8A394 */
export function CODE_B8A394() {
  sw(cur(), S.state, 0x22);
  reg.a = 0x1f;
  reg.x = 0x03;
  reg.y = 0;
  CODE_B8D8D5();
  CODE_B8A3A7();
}
/** $B8A3A7 */
export function CODE_B8A3A7() {
  spriteReturn();
}
/** $B8A3AA */
export function CODE_B8A3AA() {
  reg.a = 0x0001;
  set_anim_once_handle_dixie();
  CODE_B8A3A7();
}

// ---------------------------------------------------------------------------------------------
// Thrown follower kong (team-up throw)

/** $B8A3B3 — thrown kong in the air: steerable with left/right, lands on the active kong to team up again. */
export function kong_state_2B() {
  const ctrl = r16(R.current_kong_control_variables);
  w16(ctrl + K.gravity_force, spriteConst(0x44));
  w16(ctrl + K.max_fall_speed, spriteConst(0x02));
  apply_player_gravity();
  const x = cur();
  reg.x = x;
  const held = r16(r16(R.active_kong_control_variables) + K.input_held);
  w16(R.player_action_held, held);
  if ((held & (C.input_left | C.input_right)) === 0) return CODE_B8A3F0();
  reg.y = 0x46;
  if (held & C.input_left) {
    reg.a = neg(spriteConst(0x46));
    return CODE_B8A3EC();
  }
  CODE_B8A3EA();
}
/** $B8A3EA */
export function CODE_B8A3EA() {
  reg.a = spriteConst(reg.y);
  CODE_B8A3EC();
}
/** $B8A3EC */
export function CODE_B8A3EC() {
  sw(reg.x, S.max_x_speed, reg.a);
  CODE_B8A3F4();
}
/** $B8A3F0 */
export function CODE_B8A3F0() {
  reg.x = cur();
  sw(reg.x, S.max_x_speed, 0);
  CODE_B8A3F4();
}
/** $B8A3F4 */
export function CODE_B8A3F4() {
  reg.y = 0x48;
  reg.a = spriteConst(0x48);
  interpolate_x_velocity();
  CODE_B8A049();
  const parent = r16(R.parent_level_number);
  if (parent === 0x0002 || parent === 0x0011) return CODE_B8A413();
  if (r16(R.level_number) === C.level_stronghold_showdown) return CODE_B8A413();
  CODE_B8A424();
}
/** $B8A413 — boss levels: a kong thrown upward cannot go above y=$108. */
export function CODE_B8A413() {
  const x = cur();
  reg.x = x;
  if (!(sr(x, S.y_speed) & 0x8000)) return CODE_B8A424();
  if (mi(0x0108, sr(x, S.y_position))) return CODE_B8A424();
  sw(x, S.y_position, 0x0108);
  sw(x, S.y_speed, 0);
  CODE_B8A424();
}
/** $B8A424 */
export function CODE_B8A424() {
  process_terrain_interaction();
  process_sprite_animation();
  reg.a = 0x000a;
  init_special_player_clipping();
  CODE_BCFB2C();
  let x = cur();
  reg.x = x;
  if (sr(x, S.y_speed) & 0x8000) return CODE_B8A469();
  CODE_B8A4B1();
  if (reg.c) return CODE_B8A46C();
  x = cur();
  reg.x = x;
  if ((sr(x, S.terrain_interaction) & 0x0101) === 0x0101) return CODE_B8A475();
  CODE_B8A06B();
  if (!reg.c) return CODE_B8A469();
  const active = r16(R.active_kong_sprite);
  reg.y = active;
  if (sr(active, S.state) === 0x2c) sw(active, S.state, 0x0001);
  CODE_B8A463();
}
/** $B8A463 */
export function CODE_B8A463() {
  CODE_B8A101();
  spriteReturn();
}
/** $B8A469 */
export function CODE_B8A469() {
  spriteReturn();
}
/** $B8A46C — caught by the active kong. */
export function CODE_B8A46C() {
  reg.a = C.player_interaction_03;
  set_player_interaction();
  spriteReturn();
}
/** $B8A475 — landed on the ground: walk back to the active kong. */
export function CODE_B8A475() {
  let x = reg.x;
  sw(x, S.x_speed, 0);
  sw(x, S.max_x_speed, 0);
  sw(x, S.interaction_flags, sr(x, S.interaction_flags) & 0xfff7);
  sw(x, S.state, 0x2d);
  reg.a = 0x0001;
  set_anim_handle_dixie();
  reg.a = 0x1f;
  reg.x = 0x1c;
  reg.y = 0;
  CODE_B8D8D5();
  work_on_active_kong();
  x = cur();
  sw(x, S.state, 0x2e);
  sw(x, S.interaction_flags, 0);
  reg.x = x;
  reg.a = 0x1c;
  set_anim_handle_dixie();
  work_on_inactive_kong();
  spriteReturn();
}

/** $B8A4B1 — carry set when the current sprite is within 32px of the active kong on both axes. */
export function CODE_B8A4B1() {
  reg.x = cur();
  reg.y = r16(R.active_kong_sprite);
  reg.a = abs16(sr(reg.y, S.x_position) - sr(reg.x, S.x_position));
  CODE_B8A4C2();
}
/** $B8A4C2 */
export function CODE_B8A4C2() {
  if (pl(reg.a, 0x20)) return CODE_B8A4DA();
  reg.a = abs16(sr(reg.y, S.y_position) - sr(reg.x, S.y_position));
  CODE_B8A4D3();
}
/** $B8A4D3 */
export function CODE_B8A4D3() {
  if (pl(reg.a, 0x20)) return CODE_B8A4DA();
  reg.c = true;
}
/** $B8A4DA */
export function CODE_B8A4DA() {
  reg.c = false;
}

/** $B8A4DC — team-up: the active kong holding the other one. */
export function kong_state_2C() {
  or16(R.game_state_flags, 0x0001);
  reg.a = 0x0c;
  process_player_action();
  // Rev 1 order (the original release ran CODE_B8A186 first)
  handle_player_physics_skip_terrain();
  CODE_B8A186();
  kongStateReturn();
}

/** $B8A4F1 */
export function kong_state_2D() {
  spriteReturn();
}

/** $B8A4F4 — follower rewinding along the recorded path back to the active kong. */
export function kong_state_2E() {
  process_sprite_animation();
  or16(R.game_state_flags, 0x0001);
  const idx = (r16(R.kong_follow_buffer_recording_index) - 2) & 0x3f;
  if (idx === r16(R.kong_follow_buffer_playback_index)) return CODE_B8A522();
  w16(R.kong_follow_buffer_recording_index, idx);
  const y = cur();
  sw(y, S.x_position, r16(R.kong_follow_x_position_buffer + idx));
  reg.a = r16(R.kong_follow_y_position_buffer + idx);
  sw(y, S.y_position, reg.a);
  reg.x = idx;
  reg.y = y;
  kongStateReturn();
}
/** $B8A522 — rewind finished: this kong becomes idle and the other resumes following. */
export function CODE_B8A522() {
  const x = cur();
  sw(x, S.state, 0);
  sw(x, S.x_speed, 0);
  sw(x, S.max_x_speed, 0);
  sw(x, S.interaction_flags, 0x1e);
  const y = r16(R.inactive_kong_sprite);
  sw(y, S.render_order, 0xd8);
  sw(x, S.x_position, sr(y, S.x_position));
  sw(x, S.y_position, sr(y, S.y_position));
  sw(y, S.state, 0x22);
  reg.a = 0x1f;
  reg.x = 0x03;
  reg.y = 0;
  CODE_B8D8D5();
  CODE_B9DFCF();
  kongStateReturn();
}

/** $B8A55B — stick to the sprite in $42. */
export function kong_state_2F() {
  const x = cur();
  const y = sr(x, S.general_purpose_42);
  sw(x, S.x_position, sr(y, S.x_position));
  reg.a = sr(y, S.y_position);
  sw(x, S.y_position, reg.a);
  reg.x = x;
  reg.y = y;
  spriteReturn();
}

/** $B8A56C — accelerating towards the other kong (DK barrel rescue). */
export function kong_state_30() {
  or16(R.game_state_flags, 0x0001);
  CODE_B8A592();
  process_sprite_animation();
  kongStateReturn();
}

/** $B8A57C — enter state $30. */
export function CODE_B8A57C() {
  const x = cur();
  sw(x, S.x_speed, 0x0100);
  sw(x, S.y_speed, 0x0100);
  sw(x, S.state, 0x30);
  reg.x = x;
  reg.a = 0x40;
  set_anim_handle_dixie();
}

/** $B8A592 — move towards the inactive kong on both axes (16.16 fixed point, speeds capped at $A00). */
export function CODE_B8A592() {
  const x = cur();
  reg.x = x;
  reg.a = sr(x, S.x_speed);
  CODE_B8A5F0();
  sw(x, S.x_speed, reg.a);
  reg.a = sr(x, S.y_speed);
  CODE_B8A5F0();
  sw(x, S.y_speed, reg.a);
  const y = r16(R.inactive_kong_sprite);
  reg.y = y;
  // horizontal: target in $32/$34, position in $36/$38, step in $3A/$3C
  w16(0x32, sr(y, S.x_sub_position));
  w16(0x34, sr(y, S.x_position));
  w16(0x36, sr(x, S.x_sub_position));
  w16(0x38, sr(x, S.x_position));
  w16(0x3a, 0);
  w16(0x3c, 0);
  w16(0x3b, sr(x, S.x_speed));
  CODE_B8A5FE();
  sw(x, S.x_sub_position, r16(0x36));
  sw(x, S.x_position, r16(0x38));
  // vertical
  w16(0x32, sr(y, S.y_sub_position));
  w16(0x34, sr(y, S.y_position));
  w16(0x36, sr(x, S.y_sub_position));
  w16(0x38, sr(x, S.y_position));
  w16(0x3a, 0);
  w16(0x3c, 0);
  w16(0x3b, sr(x, S.y_speed));
  CODE_B8A5FE();
  sw(x, S.y_sub_position, r16(0x36));
  reg.a = r16(0x38);
  sw(x, S.y_position, reg.a);
  reg.x = x;
  reg.y = y;
}
/** $B8A5F0 — accelerate by $60, capped at $A00. */
export function CODE_B8A5F0() {
  reg.a = (reg.a + 0x60) & 0xffff;
  if (pl(reg.a, 0x0a00)) CODE_B8A5FA();
}
/** $B8A5FA */
export function CODE_B8A5FA() {
  reg.a = 0x0a00;
}
/** $B8A5FE — step the 32-bit position $36/$38 towards $34 by $3A/$3C without overshooting. */
export function CODE_B8A5FE() {
  if (r16(0x38) < r16(0x34)) return CODE_B8A616();
  const lo = r16(0x36) - r16(0x3a);
  w16(0x36, lo);
  const hi = (r16(0x38) - r16(0x3c) - (lo < 0 ? 1 : 0)) & 0xffff;
  w16(0x38, hi);
  reg.a = hi;
  if (hi < r16(0x34)) CODE_B8A628();
}
/** $B8A616 */
export function CODE_B8A616() {
  const lo = r16(0x36) + r16(0x3a);
  w16(0x36, lo);
  const hi = (r16(0x38) + r16(0x3c) + (lo > 0xffff ? 1 : 0)) & 0xffff;
  w16(0x38, hi);
  reg.a = hi;
  if (hi >= r16(0x34)) CODE_B8A628();
}
/** $B8A628 */
export function CODE_B8A628() {
  reg.a = r16(0x34);
  w16(0x38, reg.a);
}

/** $B8A62D — stick to the active kong. */
export function kong_state_31() {
  const x = cur();
  const y = r16(R.active_kong_sprite);
  sw(x, S.x_position, sr(y, S.x_position));
  reg.a = sr(y, S.y_position);
  sw(x, S.y_position, reg.a);
  reg.x = x;
  reg.y = y;
  spriteReturn();
}

/** $B8A63F — follower walking the path; hides on the active kong when it enters state $11. */
export function kong_state_32() {
  CODE_B8D99E();
  CODE_B8DA84();
  process_sprite_animation();
  const next = (r16(R.kong_follow_buffer_playback_index) + 2) & 0x3f;
  reg.a = next;
  if (next === r16(R.kong_follow_buffer_recording_index)) {
    const active = r16(R.active_kong_sprite);
    reg.x = active;
    reg.a = sr(active, S.state);
    if (reg.a === 0x11) {
      const x = cur();
      reg.x = x;
      sw(x, S.current_graphic, 0);
      sw(x, S.last_rendered_graphic, 0);
      reg.a = 0x31;
      sw(x, S.state, 0x31);
    }
  }
  CODE_B8A66B();
}
/** $B8A66B */
export function CODE_B8A66B() {
  spriteReturn();
}

// ---------------------------------------------------------------------------------------------
// Level end

/** $B8A66E — walking off towards the level exit. */
export function kong_state_33() {
  CODE_B89928();
  const x = cur();
  reg.x = x;
  reg.a = sr(x, S.x_position);
  if (sr(x, S.oam_property) & 0x4000) {
    // facing left: reached the exit once x < exit
    if (mi(reg.a, r16(R.level_exit_trigger_x_position))) return CODE_B8A68B();
    return CODE_B8A685();
  }
  CODE_B8A680();
}
/** $B8A680 */
export function CODE_B8A680() {
  if (pl(reg.a, r16(R.level_exit_trigger_x_position))) return CODE_B8A68B();
  CODE_B8A685();
}
/** $B8A685 */
export function CODE_B8A685() {
  CODE_B8B530();
  kongStateReturn();
}
/** $B8A68B */
export function CODE_B8A68B() {
  set_level_end_exit_state();
  kongStateReturn();
}

/** $B8A691 */
export function set_level_end_exit_state_global() {
  set_level_end_exit_state();
}
/** $B8A695 */
export function set_level_end_fade_global() {
  set_level_end_fade();
}
/** $B8A699 — both kongs enter their exit states and the screen fades out. */
export function set_level_end_exit_state() {
  sw(r16(R.inactive_kong_sprite), S.state, C.kong_state_13);
  const active = r16(R.active_kong_sprite);
  sw(active, S.state, C.kong_state_34);
  reg.x = active;
  set_level_end_fade();
}
/** $B8A6A9 */
export function set_level_end_fade() {
  reg.a = 0x830f;
  set_fade_global();
  reg.a = 0x0002;
  or16(R.game_state_flags, 0x0002);
}

/** $B8A6B7 — exiting (waiting for the fade). */
export function kong_state_34() {
  CODE_B8B530();
  kongStateReturn();
}

// ---------------------------------------------------------------------------------------------
// Rope climbing

/** $B8A6BD — climbing a single vertical rope. */
export function kong_state_35() {
  or16(R.game_state_flags, 0x0008);
  reg.a = 0x13;
  process_player_action();
  CODE_B8A719();
  let x = cur();
  sw(x, S.ground_distance, 0);
  reg.a = 0x0b;
  interpolate_y_velocity();
  x = cur();
  w16(0x0d6a, sr(x, S.y_sub_position));
  w16(0x0d6c, sr(x, S.y_position));
  CODE_B8D817();
  CODE_B8D362();
  if (reg.c) return CODE_B8A701();
  x = cur();
  reg.x = x;
  if (!(sr(x, S.y_speed) & 0x8000)) return CODE_B8A710();
  if (sr(x, S.terrain_attributes) & 0x0400) return CODE_B8A70B();
  CODE_B8A6F7();
}
/** $B8A6F7 — undo the vertical move (top of the rope). */
export function CODE_B8A6F7() {
  const x = reg.x;
  sw(x, S.y_sub_position, r16(0x0d6a));
  sw(x, S.y_position, r16(0x0d6c));
  CODE_B8A701();
}
/** $B8A701 */
export function CODE_B8A701() {
  update_damaged_invincibility();
  process_sprite_animation();
  CODE_B8A708();
}
/** $B8A708 */
export function CODE_B8A708() {
  kongStateReturn();
}
/** $B8A70B */
export function CODE_B8A70B() {
  CODE_B8A7C3();
  CODE_B8A708();
}
/** $B8A710 */
export function CODE_B8A710() {
  if (sr(reg.x, S.max_y_speed) === 0) return CODE_B8A6F7();
  CODE_B8A7E1();
  CODE_B8A708();
}

/** $B8A719 — mirror the facing direction into $0AB8 bit 14 (from the sign of the target x speed). */
export function CODE_B8A719() {
  or16(0x0ab8, 0x8000);
  const x = cur();
  reg.x = x;
  reg.a = sr(x, S.max_x_speed);
  if (reg.a === 0) return CODE_B8A732();
  const m = r16(0x0ab8);
  reg.a = (((reg.a >> 1) ^ m) & 0x4000) ^ m;
  w16(0x0ab8, reg.a);
  CODE_B8A732();
}
/** $B8A732 */
export function CODE_B8A732() {}

/** $B8A733 — hanging on a double rope, facing a fixed direction. */
export function kong_state_36() {
  or16(R.game_state_flags, 0x0008);
  CODE_B8A719();
  update_damaged_invincibility();
  process_sprite_animation();
  kongStateReturn();
}

/** $B8A746 — climbing between two ropes. */
export function kong_state_37() {
  reg.a = 0x14;
  process_player_action();
  CODE_B8A719();
  let x = cur();
  sw(x, S.ground_distance, 0);
  reg.a = 0x0b;
  interpolate_y_velocity();
  x = cur();
  w16(0x0d6a, sr(x, S.y_sub_position));
  w16(0x0d6c, sr(x, S.y_position));
  CODE_B8D817();
  CODE_B8D378();
  if (reg.a >= 0x0003) return CODE_B8A78C();
  reg.a &= 0x0003;
  if (reg.a) return CODE_B8A7AA();
  x = cur();
  reg.x = x;
  if (!(sr(x, S.y_speed) & 0x8000)) return CODE_B8A79E();
  if (sr(x, S.terrain_attributes) & 0x0400) return CODE_B8A796();
  CODE_B8A782();
}
/** $B8A782 */
export function CODE_B8A782() {
  const x = reg.x;
  sw(x, S.y_sub_position, r16(0x0d6a));
  sw(x, S.y_position, r16(0x0d6c));
  CODE_B8A78C();
}
/** $B8A78C */
export function CODE_B8A78C() {
  update_damaged_invincibility();
  process_sprite_animation();
  CODE_B8A793();
}
/** $B8A793 */
export function CODE_B8A793() {
  kongStateReturn();
}
/** $B8A796 */
export function CODE_B8A796() {
  CODE_B8A7F4();
  CODE_B8A7C3();
  CODE_B8A793();
}
/** $B8A79E */
export function CODE_B8A79E() {
  if (sr(reg.x, S.max_y_speed) === 0) return CODE_B8A782();
  CODE_B8A7F4();
  CODE_B8A7E1();
  CODE_B8A793();
}
/** $B8A7AA — only one rope left (A = 1: rope on the right, 2: on the left, relative to facing). */
export function CODE_B8A7AA() {
  const x = cur();
  reg.x = x;
  if (sr(x, S.oam_property) & 0x4000) reg.a ^= 0x0003;
  CODE_B8A7B3();
}
/** $B8A7B3 */
export function CODE_B8A7B3() {
  if (reg.a === 0x0001) return CODE_B8A7BD();
  CODE_B8C305();
  CODE_B8A7C0();
}
/** $B8A7BD */
export function CODE_B8A7BD() {
  double_rope_climb_right_action();
  CODE_B8A7C0();
}
/** $B8A7C0 */
export function CODE_B8A7C0() {
  kongStateReturn();
}

/** $B8A7C3 — jump off the top of a rope. */
export function CODE_B8A7C3() {
  const x = reg.x;
  sw(x, S.y_speed, 0xf900);
  sw(x, S.x_speed, 0);
  sw(x, S.state, 0x39);
  reg.a = 0x0006;
  set_anim_handle_dixie();
  set_player_terminal_velocity();
  set_player_normal_gravity();
  CODE_B5E43E();
}
/** $B8A7E1 — drop off the bottom of a rope. */
export function CODE_B8A7E1() {
  reg.x = cur();
  sw(reg.x, S.x_speed, 0);
  set_player_terminal_velocity();
  set_player_normal_gravity();
  CODE_B5E43E();
  CODE_B9DFCF();
}
/** $B8A7F4 — shift 16px towards the facing direction. */
export function CODE_B8A7F4() {
  const x = reg.x;
  reg.a = sr(x, S.x_position);
  if (sr(x, S.oam_property) & 0x4000) return CODE_B8A800();
  reg.a = (reg.a - 0x10) & 0xffff;
  CODE_B8A804();
}
/** $B8A800 */
export function CODE_B8A800() {
  reg.a = (reg.a + 0x10) & 0xffff;
  CODE_B8A804();
}
/** $B8A804 */
export function CODE_B8A804() {
  sw(reg.x, S.x_position, reg.a);
}

/** $B8A807 — hanging from a horizontal rope. */
export function kong_state_38() {
  reg.a = 0x15;
  process_player_action();
  if (reg.c) return CODE_B8A837();
  let x = cur();
  sw(x, S.ground_distance, 0);
  reg.a = 0x0b;
  interpolate_x_velocity();
  x = cur();
  w16(0x0d66, sr(x, S.x_sub_position));
  w16(0x0d68, sr(x, S.x_position));
  CODE_B8D7FE();
  CODE_B8D36D();
  if (!reg.c) return CODE_B8A83A();
  CODE_B8A82D();
}
/** $B8A82D */
export function CODE_B8A82D() {
  prevent_sprite_from_leaving_level_x();
  update_damaged_invincibility();
  process_sprite_animation();
  CODE_B8A837();
}
/** $B8A837 */
export function CODE_B8A837() {
  kongStateReturn();
}
/** $B8A83A — off the end of the rope: stop, or fall if there is no rope tile at all. */
export function CODE_B8A83A() {
  if (r16(0xae) & 0x6000) return CODE_B8A84F();
  const x = cur();
  reg.x = x;
  sw(x, S.x_sub_position, r16(0x0d66));
  sw(x, S.x_position, r16(0x0d68));
  CODE_B8A82D();
}
/** $B8A84F */
export function CODE_B8A84F() {
  set_player_terminal_velocity();
  set_player_normal_gravity();
  start_player_falling();
  const x = cur();
  reg.x = x;
  sw(x, S.y_speed, 0);
  sw(x, S.x_speed, 0);
  CODE_B8A837();
}

/** $B8A860 — jumping off a rope. */
export function kong_state_39() {
  face_moving_direction();
  set_normal_gravity_if_falling();
  handle_player_physics();
  kongStateReturn();
}

/** $B8A86C — jumping down to a rope below (crouch + rope). */
export function kong_state_3A() {
  face_moving_direction();
  set_normal_gravity_if_falling();
  apply_player_gravity();
  get_x_acceleration();
  reg.a = spriteConst(reg.y);
  interpolate_x_velocity();
  handle_slope_sliding_velocity();
  apply_position_from_velocity();
  handle_player_physics_skip_terrain();
  CODE_B8B714();
  kongStateReturn();
}

/** $B8A88C — shaking in place for $42 frames, then exit the level. */
export function kong_state_3B() {
  const x = cur();
  reg.x = x;
  const t = (sr(x, S.general_purpose_42) - 1) & 0xffff;
  sw(x, S.general_purpose_42, t);
  if (t === 0) return CODE_B8A89C();
  reg.a = sr(x, S.x_position) ^ 0x0001;
  sw(x, S.x_position, reg.a);
  kongStateReturn();
}
/** $B8A89C */
export function CODE_B8A89C() {
  set_level_end_exit_state();
  w16(R.level_destination_number, 0xffff);
  kongStateReturn();
}

/** $B8A8A8 — climbing a wall-like rope (facing right, $0AB8 locked). */
export function kong_state_3C() {
  const x = cur();
  sw(x, S.oam_property, sr(x, S.oam_property) & 0xbfff);
  w16(0x0ab8, r16(0x0ab8) | 0xe000);
  reg.x = x;
  reg.a = 0x16;
  process_player_action();
  if (reg.c) return CODE_B8A8C9();
  update_damaged_invincibility();
  process_sprite_animation();
  CODE_B8A8C9();
}
/** $B8A8C9 */
export function CODE_B8A8C9() {
  kongStateReturn();
}

/** $B8A8CC — swimming. */
export function kong_state_3D() {
  reg.a = 0x17;
  process_player_action();
  if (reg.c) return CODE_B8A8D7();
  CODE_B898B5();
  CODE_B8A8D7();
}
/** $B8A8D7 */
export function CODE_B8A8D7() {
  kongStateReturn();
}

// ---------------------------------------------------------------------------------------------
// The second kong flying in from its DK barrel

/** $B8A8DA — fly in on an arc towards the active kong for $42 frames. */
export function kong_state_3E() {
  const x = cur();
  reg.x = x;
  const t = (sr(x, S.general_purpose_42) - 1) & 0xffff;
  sw(x, S.general_purpose_42, t);
  if (!(t & 0x8000)) return CODE_B8A8E3();
  CODE_B8A939();
}
/** $B8A8E3 */
export function CODE_B8A8E3() {
  const x = reg.x;
  reg.y = r16(R.current_kong_control_variables);
  // relative offset accumulates in $20/$24 (11.5 fixed point), added to the start point $0D66/$0D6A
  sw(x, S.x_speed, sr(x, S.x_speed) + sr(x, S.max_x_speed));
  reg.a = sr(x, S.x_speed);
  CODE_B8A96F();
  sw(x, S.x_position, reg.a + r16(0x0d66));
  sw(x, S.y_speed, sr(x, S.y_speed) + sr(x, S.max_y_speed));
  reg.a = sr(x, S.y_speed);
  CODE_B8A96F();
  sw(x, S.y_position, reg.a + r16(0x0d6a));
  // extra vertical arc: $46 accelerates by $60 up to $600 and accumulates in $44
  let a = (0x60 + sr(x, S.general_purpose_46)) & 0xffff;
  if (!(a & 0x8000) && a >= 0x0600) a = 0x0600;
  reg.a = a;
  CODE_B8A915();
}
/** $B8A915 */
export function CODE_B8A915() {
  const x = reg.x;
  sw(x, S.general_purpose_46, reg.a);
  const v = (reg.a + sr(x, S.general_purpose_44)) & 0xffff;
  sw(x, S.general_purpose_44, v);
  reg.y = v & 0x8000 ? 0xffff : 0;
  reg.a = v;
  CODE_B8A924();
}
/** $B8A924 — add $44 (sign-extended to 24 bits) to the y position at $09-$0B. */
export function CODE_B8A924() {
  const x = reg.x;
  const lo = reg.a + r16(x + 0x09);
  w16(x + 0x09, lo);
  const hi = reg.y + r16(x + 0x0b) + (lo > 0xffff ? 1 : 0);
  w8(x + 0x0b, hi);
  process_sprite_animation();
  kongStateReturn();
}
/** $B8A939 — arrived: land on the target and start following. */
export function CODE_B8A939() {
  reg.y = r16(R.current_kong_control_variables);
  const x = cur();
  sw(x, S.x_position, sr(x, S.general_purpose_48));
  sw(x, S.y_position, sr(x, S.general_purpose_4A));
  sw(x, S.interaction_flags, 0);
  reg.x = x;
  CODE_B8A984();
  reg.a = 0x1f;
  reg.x = 0x03;
  reg.y = 0;
  CODE_B8D8D5();
  disable_bullet_time();
  const x2 = cur();
  sw(x2, S.y_speed, 0);
  sw(x2, S.state, 0x22);
  reg.x = x2;
  reg.a = 0x0006;
  set_anim_handle_dixie();
  kongStateReturn();
}
/** $B8A96F — arithmetic shift right by 5. */
export function CODE_B8A96F() {
  reg.c = ((reg.a >> 4) & 1) !== 0;
  reg.a = asr(reg.a, 5);
}
/** $B8A984 */
export function CODE_B8A984() {
  reg.a = 0x0002;
  sw(reg.x, S.state, 0x0002);
}

/** $B8A98A */
export function CODE_B8A98A() {
  CODE_B8A98E();
}

/** $B8A98E — give the player back the second kong (DK barrel broken), unless the current state forbids it. */
export function CODE_B8A98E() {
  reg.a = r16(R.game_state_flags) & 0x4000;
  if (reg.a) return; // already has the second kong
  const active = r16(R.active_kong_sprite);
  reg.x = (sr(active, S.state) << 2) & 0xffff;
  reg.a = rom16(KONG_STATE_FLAGS_TABLE + reg.x) & 0x0001;
  if (reg.a) return; // state does not allow it
  if (r16(R.animal_type) !== 0 && r16(R.current_player_mount) === 0) {
    // the animal is separate from the kong: just show the follower icon
    reg.a = 0x4000;
    or16(R.game_state_flags, 0x4000);
    spawn_follower_animal_icon();
    return;
  }
  // .no_animal: the inactive kong starts at the barrel and flies in (state $3E)
  const x = cur();
  const y = r16(R.inactive_kong_sprite);
  sw(y, S.x_position, sr(x, S.x_position));
  sw(y, S.y_position, sr(x, S.y_position));
  sw(y, S.interaction_flags, 0);
  sw(y, S.state, 0x3e);
  sw(y, S.terrain_interaction, 0);
  or16(R.game_state_flags, 0x4000);
  const saved = r16(R.current_sprite);
  reg.x = x;
  reg.y = y;
  work_on_inactive_kong_global();
  reg.a = 0x0006;
  set_anim_handle_dixie();
  CODE_B8AA00();
  w16(R.current_sprite, saved);
  reg.a = 0x000f;
  reg.y = 0x00f0;
  enable_bullet_time();
}

/** $B8AA00 — set up the inactive kong's flight from its position to the active kong. */
export function CODE_B8AA00() {
  const x = r16(R.inactive_kong_sprite);
  w16(0x0d66, sr(x, S.x_position));
  w16(0x0d6a, sr(x, S.y_position));
  sw(x, S.x_speed, 0);
  sw(x, S.y_speed, 0);
  sw(x, S.general_purpose_42, 0x20);
  const y = r16(R.active_kong_sprite);
  sw(x, S.max_x_speed, sr(y, S.x_position) - sr(x, S.x_position));
  sw(x, S.max_y_speed, sr(y, S.y_position) - sr(x, S.y_position));
  sw(x, S.general_purpose_46, 0xfa00);
  sw(x, S.general_purpose_44, 0xfa00);
  sw(x, S.general_purpose_48, sr(y, S.x_position));
  reg.a = sr(y, S.y_position);
  sw(x, S.general_purpose_4A, reg.a);
  reg.x = x;
  reg.y = y;
}

registerSprite({
  CODE_B8A0B9, CODE_B8A0CF, kong_state_22, kong_state_23, kong_state_24, kong_state_25,
  CODE_B8A1CF, CODE_B8A1E8, CODE_B8A1EE, kong_state_26, CODE_B8A228, kong_state_27, CODE_B8A254,
  CODE_B8A25E, CODE_B8A268, CODE_B8A26F, CODE_B8A27A, CODE_B8A2F2, CODE_B8A2FD, kong_state_28,
  CODE_B8A327, kong_state_29, CODE_B8A34A, kong_state_2A, CODE_B8A376, CODE_B8A394, CODE_B8A3A7,
  CODE_B8A3AA, kong_state_2B, CODE_B8A3EA, CODE_B8A3EC, CODE_B8A3F0, CODE_B8A3F4, CODE_B8A413,
  CODE_B8A424, CODE_B8A463, CODE_B8A469, CODE_B8A46C, CODE_B8A475, kong_state_2C, kong_state_2D,
  kong_state_2E, CODE_B8A522, kong_state_2F, kong_state_30, kong_state_31, kong_state_32,
  CODE_B8A66B, kong_state_33, CODE_B8A680, CODE_B8A685, CODE_B8A68B, kong_state_34,
  kong_state_35, CODE_B8A6F7, CODE_B8A701, CODE_B8A708, CODE_B8A70B, CODE_B8A710, kong_state_36,
  kong_state_37, CODE_B8A782, CODE_B8A78C, CODE_B8A793, CODE_B8A796, CODE_B8A79E, CODE_B8A7AA,
  CODE_B8A7B3, CODE_B8A7BD, CODE_B8A7C0, kong_state_38, CODE_B8A82D, CODE_B8A837, CODE_B8A83A,
  CODE_B8A84F, kong_state_39, kong_state_3A, kong_state_3B, CODE_B8A89C, kong_state_3C,
  CODE_B8A8C9, kong_state_3D, CODE_B8A8D7, kong_state_3E, CODE_B8A8E3, CODE_B8A915, CODE_B8A924,
  CODE_B8A939,
});
registerRts({
  CODE_B8A0D5, CODE_B8A0E7, CODE_B8A0F8, CODE_B8A0FF, CODE_B8A101, CODE_B8A115, CODE_B8A122,
  CODE_B8A131, CODE_B8A14E, CODE_B8A186, CODE_B8A203, CODE_B8A210, CODE_B8A21C, CODE_B8A4B1,
  CODE_B8A4C2, CODE_B8A4D3, CODE_B8A4DA, CODE_B8A592, CODE_B8A5F0, CODE_B8A5FA, CODE_B8A5FE,
  CODE_B8A616, CODE_B8A628, set_level_end_exit_state, set_level_end_fade, CODE_B8A719,
  CODE_B8A732, CODE_B8A7C3, CODE_B8A7E1, CODE_B8A7F4, CODE_B8A800, CODE_B8A804, CODE_B8A96F,
  CODE_B8A984, CODE_B8A98E, CODE_B8AA00,
});
registerRtl({ CODE_B8A57C, set_level_end_exit_state_global, set_level_end_fade_global, CODE_B8A98A });
