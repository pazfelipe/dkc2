/**
 * Bank $B8 — player action handling ($B8B9C7-$B8C329).
 *
 * Every kong state that accepts input calls `process_player_action` with A = an "action set"
 * index (saved in $92). For each joypad direction/button (or its absence) the routine jumps
 * through a per-button table indexed by that action set: e.g. action set $0C (walking) maps
 * "down held" to crouch_action, while $13 (rope) maps it to climb_down_single_rope_action.
 * An action may set bit 0 of game_state_flags_2 to tell the state it changed the kong's state
 * (returned as carry).
 */
import { r16, w16, rom16, and16 } from "../../core/mem";
import { reg, callPtr } from "../../core/cpu";
import { L, R, C, sprite as S, kong_control as K } from "../../core/sym";
import { pl, mi, neg, spriteConst, cur, sw, sr, registerRts } from "./b8b_common";
import { get_sprite_terrain_info_define_x } from "./b8b_common";
import {
  set_player_terminal_velocity, set_player_normal_gravity, set_anim_handle_dixie,
  get_sprite_terrain_info_y_origin_0, set_player_terminal_velocity_down, set_player_jumping_gravity,
  CODE_B8D484,
} from "../../gen/routines";
import { CODE_B8B77B } from "./b8b_pit_swim";

const T = {
  up: L("up_action_table"),
  down: L("down_action_table"),
  left: L("left_action_table"),
  right: L("right_action_table"),
  a: L("a_action_table"),
  b: L("b_action_table"),
  x: L("x_action_table"),
  y: L("y_action_table"),
  l: L("l_action_table"),
  r: L("r_action_table"),
  start: L("start_action_table"),
  select: L("select_action_table"),
  noLeftRight: L("no_left_right_action_table"),
  noUpDown: L("no_up_down_action_table"),
  noB: L("no_b_action_table"),
  noY: L("no_y_action_table"),
};

/** $B8B9C7 — run the action handlers of action set A for the active kong; carry = state changed. */
export function process_player_action() {
  w16(0x92, reg.a);
  and16(R.game_state_flags_2, ~0x0001);
  reg.a = r16(R.screen_fade_speed) & 0x00ff;
  if (reg.a) {
    // screen transition in progress: no input
    reg.c = false;
    return;
  }
  reg.x = cur();
  if (reg.x !== r16(R.active_kong_sprite)) {
    reg.c = false;
    return;
  }
  // .active_kong: latch this frame's input for the actions and the kong's control variables
  reg.y = 0;
  w16(R.player_action_pressed, r16(R.player_active_pressed));
  w16(R.player_action_held, r16(R.player_active_held));
  reg.y = r16(R.current_kong_control_variables);
  w16(reg.y + K.input_held, r16(R.player_action_held));
  w16(reg.y + K.input_pressed, r16(R.player_action_pressed));
  CODE_B8BAA8();

  // the handlers may clear bits of player_action_held, so it is re-read before every test
  const held = () => r16(R.player_action_held);
  if (held() & C.input_left) handle_left_actions();
  else if (held() & C.input_right) handle_right_actions();
  else handle_no_left_right_actions();

  if (held() & C.input_up) handle_up_actions();
  else if (held() & C.input_down) handle_down_actions();
  else handle_no_up_down_actions();

  if (held() & C.input_B) handle_b_actions();
  else handle_no_b_actions();

  if (held() & C.input_Y) handle_y_actions();
  else handle_no_y_actions();

  if (held() & C.input_A) handle_a_actions();
  if (held() & C.input_X) handle_x_actions();
  if (held() & C.input_L) handle_l_actions();
  if (held() & C.input_R) handle_r_actions();
  if (held() & C.input_select) handle_select_actions();
  if (held() & C.input_start) handle_start_actions();

  reg.a = r16(R.game_state_flags_2) & 0x0001;
  if (reg.a) return CODE_B8BAA6();
  reg.c = false;
}
/** $B8BAA6 */
export function CODE_B8BAA6() {
  reg.c = true;
}

/** $B8BAA8 — record the frame of every Y press / release (used for roll and throw timing). */
export function CODE_B8BAA8() {
  reg.x = r16(R.current_kong_control_variables);
  reg.a = (r16(reg.x + K.input_held_y_event) ^ r16(reg.x + K.input_held)) & 0x4000;
  if (reg.a) CODE_B8BAB4();
}
/** $B8BAB4 */
export function CODE_B8BAB4() {
  const x = reg.x;
  reg.a = r16(x + K.input_held);
  w16(x + K.input_held_y_event, reg.a);
  reg.a &= 0x4000;
  if (!reg.a) return CODE_B8BAC6();
  w16(x + K.y_old_press_time, r16(x + K.y_press_time));
  reg.a = r16(R.active_frame_counter);
  w16(x + K.y_press_time, reg.a);
}
/** $B8BAC6 */
export function CODE_B8BAC6() {
  const x = reg.x;
  w16(x + K.y_old_release_time, r16(x + K.y_release_time));
  reg.a = r16(R.active_frame_counter);
  w16(x + K.y_release_time, reg.a);
}

/** `LDA $92 : ASL A : TAX : JMP (table,x)` */
function dispatch(table: number) {
  reg.a = (r16(0x92) << 1) & 0xffff;
  reg.x = reg.a;
  callPtr(0xb8, rom16(table + reg.x));
}
/** $B8BACF */
export function handle_up_actions() {
  dispatch(T.up);
}
/** $B8BAD6 */
export function handle_down_actions() {
  dispatch(T.down);
}
/** $B8BADD */
export function handle_left_actions() {
  dispatch(T.left);
}
/** $B8BAE4 */
export function handle_right_actions() {
  dispatch(T.right);
}
/** $B8BAEB */
export function handle_a_actions() {
  dispatch(T.a);
}
/** $B8BAF2 */
export function handle_b_actions() {
  dispatch(T.b);
}
/** $B8BAF9 */
export function handle_x_actions() {
  dispatch(T.x);
}
/** $B8BB00 */
export function handle_y_actions() {
  dispatch(T.y);
}
/** $B8BB07 */
export function handle_l_actions() {
  dispatch(T.l);
}
/** $B8BB0E */
export function handle_r_actions() {
  dispatch(T.r);
}
/** $B8BB15 */
export function handle_start_actions() {
  dispatch(T.start);
}
/** $B8BB1C */
export function handle_select_actions() {
  dispatch(T.select);
}
/** $B8BB23 */
export function handle_no_left_right_actions() {
  dispatch(T.noLeftRight);
}
/** $B8BB2A */
export function handle_no_up_down_actions() {
  dispatch(T.noUpDown);
}
/** $B8BB31 */
export function handle_no_b_actions() {
  dispatch(T.noB);
}
/** $B8BB38 */
export function handle_no_y_actions() {
  dispatch(T.noY);
}

// ---------------------------------------------------------------------------------------------
// Up / down actions

/** $B8C01F */
export function no_action() {}
/** $B8C020 */
export function return_sprite_up_action() {
  reg.x = cur();
}
/** $B8C023 — debug free flight. */
export function debug_fly_up_action() {
  reg.x = cur();
  get_debug_fly_velocity();
  reg.a = neg(reg.a);
  sw(reg.x, S.y_speed, reg.a);
}
/** $B8C02F — debug flight speed: Y = fast, A = faster, neither = slow. */
export function get_debug_fly_velocity() {
  reg.a = r16(R.player_action_held) & (C.input_Y | C.input_A);
  if (reg.a === 0) reg.a = 0x0100;
  else if (reg.a & C.input_Y) reg.a = 0x0400;
  else reg.a = 0x0800;
}
/** $B8C048 */
export function no_up_action() {}
/** $B8C049 — Squawks: holding up flies at normal fall speed / gravity. */
export function squawks_hold_up_action() {
  reg.x = cur();
  set_player_terminal_velocity();
  set_player_normal_gravity();
}
/** $B8C052 */
export function move_barrel_cannon_up_action() {
  reg.x = cur();
  reg.y = 0x4e;
  reg.a = neg(spriteConst(0x4e));
  sw(reg.x, S.max_y_speed, reg.a);
}
/** $B8C060 */
export function climb_up_single_rope_action() {
  reg.x = cur();
  reg.y = r16(R.current_kong_control_variables);
  reg.y = r16(reg.y + K.fast_flag) & 0x0004 ? 0x58 : 0x54;
  reg.a = neg(spriteConst(reg.y));
  sw(reg.x, S.max_y_speed, reg.a);
}
/** $B8C07F */
export function climb_up_double_rope_action() {
  reg.x = cur();
  reg.y = r16(R.current_kong_control_variables);
  reg.y = r16(reg.y + K.fast_flag) & 0x0004 ? 0x60 : 0x5c;
  reg.a = neg(spriteConst(reg.y));
  sw(reg.x, S.max_y_speed, reg.a);
}
/** $B8C09E */
export function horizontal_rope_up_action() {}
/** $B8C09F — Quawks: slow glide. */
export function quawks_slow_descent_action() {
  reg.x = cur();
  sw(reg.x, S.animation_speed, 0x020c);
  set_player_normal_gravity();
  reg.a = 0x0080;
  reg.y = r16(R.current_kong_control_variables);
  w16(reg.y + K.max_fall_speed, 0x0080);
}
/** $B8C0B2 */
export function unknown_up_1C_action() {
  climb_up_single_rope_action();
}
/** $B8C0B5 */
export function move_enguarde_up_action() {
  reg.x = cur();
  reg.a = 0xfd00;
  sw(reg.x, S.max_y_speed, 0xfd00);
}
/** $B8C0BD */
export function wind_float_up_fast_action() {
  reg.x = cur();
  reg.y = 0x68;
  reg.a = spriteConst(0x68);
  sw(reg.x, S.max_y_speed, reg.a);
}

/** $B8C0C7 — down on the ground: crouch, or drop down to a rope hanging below. */
export function crouch_action() {
  reg.x = cur();
  reg.a = sr(reg.x, S.terrain_interaction) & 0x1001;
  if (!reg.a) return;
  // .touching_ground
  check_for_rope_hanging_from_floor();
  if (reg.c) return jump_down_to_rope();
  const x = reg.x;
  sw(x, S.state, 0x07);
  sw(x, S.max_x_speed, 0);
  reg.a = 0x0c;
  set_anim_handle_dixie();
  // only B (jump) still counts this frame
  reg.a = r16(R.player_action_held) & C.input_B;
  w16(R.player_action_held, reg.a);
}
/** $B8C0EE — hop down onto the rope below, centred on its tile column ($5E). */
export function jump_down_to_rope() {
  const x = reg.x;
  sw(x, S.x_position, (r16(0x5e) & 0xfff0) | 0x0003);
  sw(x, S.y_speed, 0xfd00);
  sw(x, S.x_speed, 0);
  sw(x, S.max_x_speed, 0);
  sw(x, S.state, 0x3a);
  reg.a = 0x0006;
  set_anim_handle_dixie();
}
/** $B8C10E — carry set when a rope tile ($1000) is under the kong (probing 4px either side on alternate frames). */
export function check_for_rope_hanging_from_floor() {
  const x = cur();
  reg.x = x;
  w16(0x5e, sr(x, S.x_position));
  reg.a = sr(x, S.terrain_attributes) & 0x1000;
  if (reg.a) {
    reg.c = true;
    return;
  }
  reg.y = 0x0004;
  if (!(r16(R.active_frame_counter) & 0x0001)) reg.y = neg(0x0004);
  reg.a = (reg.y + r16(0x5e)) & 0xffff;
  w16(0x5e, reg.a);
  get_sprite_terrain_info_y_origin_0();
  reg.a = r16(0xae) & 0x1000;
  reg.c = reg.a !== 0;
}
/** $B8C13E */
export function crouch_check_for_rope_below_action() {
  check_for_rope_hanging_from_floor();
  if (reg.c) jump_down_to_rope();
}
/** $B8C144 */
export function debug_fly_down_action() {
  reg.x = cur();
  get_debug_fly_velocity();
  sw(reg.x, S.y_speed, reg.a);
}
/** $B8C14C */
export function squawks_holding_down_action() {
  set_player_terminal_velocity_down();
  set_player_jumping_gravity();
}
/** $B8C153 */
export function move_barrel_cannon_down_action() {
  reg.x = cur();
  reg.y = 0x4e;
  reg.a = spriteConst(0x4e);
  sw(reg.x, S.max_y_speed, reg.a);
}
/** $B8C15D */
export function climb_down_single_rope_action() {
  reg.x = cur();
  reg.y = r16(R.current_kong_control_variables);
  reg.y = r16(reg.y + K.fast_flag) & 0x0004 ? 0x5a : 0x56;
  reg.a = spriteConst(reg.y);
  sw(reg.x, S.max_y_speed, reg.a);
}
/** $B8C178 */
export function climb_down_double_rope_action() {
  reg.x = cur();
  reg.y = r16(R.current_kong_control_variables);
  reg.y = r16(reg.y + K.fast_flag) & 0x0004 ? 0x62 : 0x5e;
  reg.a = spriteConst(reg.y);
  sw(reg.x, S.max_y_speed, reg.a);
}
/** $B8C193 */
export function horizontal_rope_down_action() {}
/** $B8C194 */
export function swim_sink_fast_action() {
  reg.a = spriteConst(0x7a);
  reg.y = r16(R.current_kong_control_variables);
  w16(reg.y + K.max_fall_speed, reg.a);
}
/** $B8C19F — Quawks: fast descent. */
export function quawks_fast_descent_action() {
  reg.x = cur();
  sw(reg.x, S.animation_speed, 0x0074);
  set_player_normal_gravity();
  reg.a = 0x0200;
  reg.y = r16(R.current_kong_control_variables);
  w16(reg.y + K.max_fall_speed, 0x0200);
}
/** $B8C1B2 */
export function unknown_down_1C_action() {
  climb_down_single_rope_action();
}
/** $B8C1B5 */
export function move_enguarde_down_action() {
  reg.x = cur();
  reg.a = 0x0300;
  sw(reg.x, S.max_y_speed, 0x0300);
}
/** $B8C1BD */
export function wind_float_up_slow_action() {
  reg.x = cur();
  reg.y = 0x6a;
  reg.a = spriteConst(0x6a);
  sw(reg.x, S.max_y_speed, reg.a);
}

// ---------------------------------------------------------------------------------------------
// Left actions

/** $B8C1C7 */
export function walk_left_action() {
  reg.x = cur();
  get_player_x_move_speed();
  slow_rattly_if_on_ground();
  reg.a = neg(reg.a);
  sw(reg.x, S.max_x_speed, reg.a);
}
/** $B8C1D6 — Rattly hops: on the ground its walking speed is 1. */
export function slow_rattly_if_on_ground() {
  reg.x = cur();
  reg.y = r16(R.animal_type);
  if (reg.y !== C.sprite_rattly) return;
  // .rattly
  w16(0x32, reg.a);
  reg.a = sr(reg.x, S.terrain_interaction) & 0x1001;
  reg.a = reg.a === 0 ? r16(0x32) : 0x0001;
}
/** $B8C1F0 — walking or running speed, from the kong's or the animal's constants. */
export function get_player_x_move_speed() {
  reg.y = r16(R.current_kong_control_variables);
  const running = (r16(reg.y + K.fast_flag) & 0x0004) !== 0;
  reg.a = r16(R.animal_type);
  if (reg.a === 0) reg.y = running ? 0x0e : 0x0c;
  else reg.y = ((reg.a - (running ? 0xffe4 : 0xfff8)) & 0xffff) >> 1;
  reg.a = spriteConst(reg.y);
}
/** $B8C220 */
export function CODE_B8C220() {}

/** $B8C221 — turn left while rolling (not on a steep slope while on the ground). */
export function roll_left_action() {
  const x = cur();
  reg.x = x;
  reg.a = sr(x, S.terrain_attributes) & 0x0007;
  if (mi(reg.a, r16(0x88))) return CODE_B8C234();
  reg.a = sr(x, S.terrain_interaction) & 0x0001;
  if (reg.a === 0) return CODE_B8C234();
}
/** $B8C234 */
export function CODE_B8C234() {
  const x = reg.x;
  sw(x, S.oam_property, sr(x, S.oam_property) | 0x4000);
  reg.a = sr(x, S.max_x_speed);
  if (reg.a & 0x8000) return;
  reg.a = neg(reg.a);
  sw(x, S.max_x_speed, reg.a);
}
/** $B8C246 */
export function debug_fly_left_action() {
  reg.x = cur();
  get_debug_fly_velocity();
  sw(reg.x, S.x_speed, neg(reg.a));
  reg.a = sr(reg.x, S.oam_property) | 0x4000;
  sw(reg.x, S.oam_property, reg.a);
}
/** $B8C259 */
export function shot_from_cannon_move_left_action() {
  reg.x = cur();
  get_player_x_move_speed();
  reg.a = (neg(reg.a) + sr(reg.x, S.max_x_speed)) & 0xffff;
  sw(reg.x, S.max_x_speed, reg.a);
}
/** $B8C268 */
export function move_barrel_cannon_left_action() {
  reg.x = cur();
  sw(reg.x, S.max_x_speed, neg(spriteConst(0x4e)));
  reg.y = 0x52;
  reg.a = neg(spriteConst(0x52));
  sw(reg.x, S.unknown_28, reg.a);
}

/** $B8C281 — on a single rope, pressing left: swing round, or reach over to a second rope. */
export function single_rope_climb_left_action() {
  reg.x = cur();
  if (sr(reg.x, S.oam_property) & 0x4000) return ropeFacingLeft();
  // probe 32px to the left at y-8 for another rope
  w16(0x34, sr(reg.x, S.y_position) - 0x0008);
  reg.a = (sr(reg.x, S.x_position) - 0x0020) & 0xffff;
  get_sprite_terrain_info_define_x();
  CODE_B8D484();
  w16(0x5e, reg.a);
  if (r16(0xae) & 0x1000) {
    reg.a = (r16(0x5e) + 0x27) & 0xffff;
    if (mi(reg.a, sr(reg.x, S.y_position))) {
      // .transition_to_double_rope
      reg.y = r16(R.current_kong_control_variables);
      reg.a = r16(reg.y + K.animation_id);
      if (reg.a === 0x32) return;
      sw(reg.x, S.state, C.kong_state_36);
      reg.a = 0x34;
      return set_anim_handle_dixie();
    }
  }
  // .CODE_B8C2B2: a wall-grab tile ($0800) just left of the hands?
  w16(0x34, sr(reg.x, S.y_position) - 0x0028);
  reg.a = (sr(reg.x, S.x_position) - 0x0004) & 0xffff;
  get_sprite_terrain_info_define_x();
  CODE_B8D484();
  w16(0x5e, reg.a);
  reg.a = r16(0xae) & 0x0800;
  if (reg.a) return CODE_B8C2ED();
  ropeFacingLeft();
}
/** single_rope_climb_left_action .facing_left */
function ropeFacingLeft() {
  reg.a = 0xfd00;
  sw(reg.x, S.max_x_speed, 0xfd00);
}
/** $B8C2ED */
export function CODE_B8C2ED() {
  const x = cur();
  reg.x = x;
  sw(x, S.x_position, sr(x, S.x_position) - 0x0004);
  sw(x, S.x_speed, 0xff00);
  sw(x, S.max_x_speed, 0xff00);
  reg.a = 0xff00;
  CODE_B8B77B();
}
/** $B8C301 */
export function double_rope_climb_left_action() {
  CODE_B8C305();
}
/** $B8C305 — hang from the double rope facing left (state $36). */
export function CODE_B8C305() {
  const x = cur();
  reg.x = x;
  sw(x, S.state, 0x36);
  if (!(sr(x, S.oam_property) & 0x4000)) {
    sw(x, S.oam_property, sr(x, S.oam_property) ^ 0x4000);
    reg.a = (sr(x, S.x_position) - 0x0020) & 0xffff;
    sw(x, S.x_position, reg.a);
  }
  // CODE_B8C322 (belongs to the next package's label range; inlined)
  reg.a = 0x35;
  set_anim_handle_dixie();
}

registerRts({
  process_player_action, CODE_B8BAA6, CODE_B8BAA8, CODE_B8BAB4, CODE_B8BAC6, handle_up_actions,
  handle_down_actions, handle_left_actions, handle_right_actions, handle_a_actions,
  handle_b_actions, handle_x_actions, handle_y_actions, handle_l_actions, handle_r_actions,
  handle_start_actions, handle_select_actions, handle_no_left_right_actions,
  handle_no_up_down_actions, handle_no_b_actions, handle_no_y_actions, no_action,
  return_sprite_up_action, debug_fly_up_action, get_debug_fly_velocity, no_up_action,
  squawks_hold_up_action, move_barrel_cannon_up_action, climb_up_single_rope_action,
  climb_up_double_rope_action, horizontal_rope_up_action, quawks_slow_descent_action,
  unknown_up_1C_action, move_enguarde_up_action, wind_float_up_fast_action, crouch_action,
  jump_down_to_rope, check_for_rope_hanging_from_floor, crouch_check_for_rope_below_action,
  debug_fly_down_action, squawks_holding_down_action, move_barrel_cannon_down_action,
  climb_down_single_rope_action, climb_down_double_rope_action, horizontal_rope_down_action,
  swim_sink_fast_action, quawks_fast_descent_action, unknown_down_1C_action,
  move_enguarde_down_action, wind_float_up_slow_action, walk_left_action,
  slow_rattly_if_on_ground, get_player_x_move_speed, CODE_B8C220, roll_left_action, CODE_B8C234,
  debug_fly_left_action, shot_from_cannon_move_left_action, move_barrel_cannon_left_action,
  single_rope_climb_left_action, CODE_B8C2ED, double_rope_climb_left_action, CODE_B8C305,
});
