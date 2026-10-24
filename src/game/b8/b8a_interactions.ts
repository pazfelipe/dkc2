/**
 * Bank $B8 — player interactions (part 1): the interaction dispatcher, the "work on Kong"
 * helpers, and the interaction handlers for team-up, honey, ropes, bounces, goals and hits.
 *
 * Other sprites request an interaction with the player by writing its number to
 * `current_interaction` ($0A82, see `set_player_interaction`) together with parameters in
 * `interaction_RAM_0A86..0A8C`. Once per frame `process_interactions_with_player` runs the
 * handler from `player_interaction_table`. Handlers usually switch the Kong into a new state
 * and pick an animation.
 */
import { r16, w16, rom16 } from "../../core/mem";
import { reg, register, callPtr } from "../../core/cpu";
import { RET_RTS, RET_RTL } from "../../core/hybrid";
import { L, R, C, sprite, kong_control, level } from "../../core/sym";
import { spriteConst, kongStateFlags, cmpMinus, sound, queue_sound_effect, setReturnMode, transition_song } from "./b8a_common";
import {
  set_player_interaction,
  set_player_terminal_velocity,
  set_player_normal_gravity,
  set_anim_handle_dixie,
  set_anim_handle_animal_and_dixie,
  CODE_BB8C2C,
  CODE_B8D8D5,
  CODE_B8D8D7,
  CODE_B8A57C,
  set_player_terminal_velocity_global,
  set_player_normal_gravity_global,
  CODE_B9DFB2,
  CODE_B9DFCF,
  set_player_jumping_gravity,
  set_player_interaction_global,
  CODE_B3E287,
  check_sprite_underwater,
  enable_bullet_time_global,
  set_level_end_exit_state,
  spawn_special_sprite_index,
  CODE_BEC66F,
  CODE_BBBE01,
  check_if_player_has_both_kongs,
  CODE_B8A14E,
  disable_bullet_time,
  enable_bullet_time,
  apply_roll_animation,
  check_if_animal_or_holding_sprite,
  disable_enemy_damage,
  set_current_level_as_cleared,
  CODE_B8A131,
  swap_active_kong_global,
  start_player_falling,
  init_player_clipping,
} from "../../gen/routines";
import {
  drop_sprite_if_holding,
  player_interaction_19,
  play_kong_dependant_sound,
  transition_kong_dependant_song,
  CODE_B8939C,
} from "./b8a_interactions2";

const PLAYER_INTERACTION_TABLE = L("player_interaction_table");

/** sprite.oam_property bit 14: the sprite faces left (x flip). */
const FACING = 0x4000;
/** Copy the facing bit of `src` into the sprite's OAM property. */
function setFacing(x: number, src: number) {
  const p = r16(x + sprite.oam_property);
  w16(x + sprite.oam_property, ((src ^ p) & FACING) ^ p);
}

// ---------------------------------------------------------------------------------------------
// Dispatcher and Kong selection helpers
// ---------------------------------------------------------------------------------------------

/** $B8805E — run the pending player interaction (and the level-exit one after a fade-out). */
export function process_interactions_with_player() {
  if (r16(R.game_state_flags) & 0x0002) {
    // a level transition was requested: once the screen is black, leave the level
    reg.a = r16(R.screen_brightness);
    if (reg.a === 0) {
      w16(R.game_state_flags, r16(R.game_state_flags) & ~0x0002);
      reg.a = C.player_interaction_2D;
      set_player_interaction();
    }
  }
  // .get_and_process_interaction
  reg.db = 0xb8;
  const n = r16(R.current_interaction);
  reg.a = n;
  if (n === 0) return;
  w16(R.current_interaction, 0);
  const idx = ((n - 1) << 1) & 0xffff;
  reg.a = idx;
  reg.x = idx;
  callPtr(0xb8, rom16(PLAYER_INTERACTION_TABLE + idx));
}

/** $B8808E */
export function work_on_active_kong_global() {
  work_on_active_kong();
}

/** $B88092 — make the active Kong current (X = sprite, Y = control variables, A = constants). */
export function work_on_active_kong() {
  const kc = r16(R.active_kong_control_variables);
  w16(R.current_kong_control_variables, kc);
  reg.y = kc;
  const x = r16(R.active_kong_sprite);
  reg.x = x;
  w16(R.current_sprite, x);
  reg.a = r16(x + sprite.constants_address);
  w16(R.current_sprite_constants, reg.a);
}

/** $B880A2 */
export function work_on_inactive_kong_global() {
  work_on_inactive_kong();
}

/** $B880A6 — make the Kong in X current. */
export function work_on_kong_in_x() {
  if (reg.x === r16(R.active_kong_sprite)) work_on_active_kong();
  else work_on_inactive_kong();
}

/** $B880AB — make the inactive (following) Kong current. */
export function work_on_inactive_kong() {
  const kc = r16(R.inactive_kong_control_variables);
  w16(R.current_kong_control_variables, kc);
  reg.y = kc;
  const x = r16(R.inactive_kong_sprite);
  reg.x = x;
  w16(R.current_sprite, x);
  reg.a = r16(x + sprite.constants_address);
  w16(R.current_sprite_constants, reg.a);
}

/** $B880BC — a Kong inside a barrel ($11) is invisible; make both visible again. */
export function set_kongs_visible_if_not_in_barrel() {
  const x = r16(R.active_kong_sprite);
  const y = r16(R.inactive_kong_sprite);
  reg.x = x;
  reg.y = y;
  reg.a = r16(x + sprite.state);
  if (reg.a !== C.kong_state_11) return;
  reg.a = 0;
  w16(x + sprite.display_mode, 0);
  w16(y + sprite.display_mode, 0);
}

/** Puts the following Kong back into the "follow" state ($22) with the given follow parameters. */
function setFollowState(renderOrder: number | null, a: number, x: number) {
  const k = reg.x;
  w16(k + sprite.state, C.kong_state_22);
  if (renderOrder !== null) w16(k + sprite.render_order, renderOrder);
  reg.a = a;
  reg.x = x;
  reg.y = 0;
  CODE_B8D8D5();
}

// ---------------------------------------------------------------------------------------------
// Interaction handlers
// ---------------------------------------------------------------------------------------------

/** $B880D2 — interaction $0C: caught by an upward wind. */
export function player_interaction_0C() {
  work_on_active_kong();
  drop_sprite_if_holding();
  let x = r16(R.active_kong_sprite);
  const idx = (r16(x + sprite.state) << 2) & 0xffff;
  reg.x = idx;
  reg.a = kongStateFlags(r16(x + sprite.state)) & 0x0005;
  if (reg.a) return; // CODE_B8811D
  x = r16(R.active_kong_sprite);
  reg.x = x;
  reg.a = r16(R.animal_type);
  if (reg.a) return;
  w16(x + sprite.state, C.kong_state_69);
  x = r16(R.current_sprite);
  reg.x = x;
  // falling speed is capped at $200 when the wind catches the Kong
  let ys = r16(x + sprite.y_speed);
  if (!(ys & 0x8000) && !cmpMinus(ys, 0x0200)) ys = 0x0200;
  // CODE_B88103
  w16(x + sprite.y_speed, ys);
  w16(x + sprite.max_y_speed, 0);
  w16(0x0aee, 0);
  w16(0x0af2, 0);
  set_player_terminal_velocity();
  set_player_normal_gravity();
  reg.a = 0x00a2;
  set_anim_handle_dixie();
  drop_follower_kong_if_teamed_up();
}

/** $B8811E — interaction $0B: stunned by an enemy shaking the ground (Kudgel). */
export function player_interaction_0B() {
  work_on_active_kong();
  const x = reg.x;
  const terrain = r16(x + sprite.terrain_interaction);
  reg.a = terrain >> 1;
  if (!(terrain & 1)) return; // only when standing on the ground
  // CODE_B88127
  const state = r16(x + sprite.state);
  reg.x = (state << 2) & 0xffff;
  reg.a = kongStateFlags(state) & 0x0005;
  if (reg.a) return; // CODE_B88126
  set_player_terminal_velocity();
  set_player_normal_gravity();
  const k = r16(R.current_sprite);
  reg.x = k;
  w16(k + sprite.state, C.kong_state_63);
  w16(k + sprite.y_speed, 0);
  w16(k + sprite.x_speed, 0);
  w16(k + sprite.max_x_speed, 0);
  reg.a = 0x00a0;
  set_anim_handle_dixie();
  w16(0x091f, r16(R.interaction_RAM_0A86));
  w16(R.RAM_0B02, r16(R.RAM_0B02) & ~0x0008);
  drop_follower_kong_if_teamed_up();
}

/** $B8815F — interaction $24: frozen by K. Rool's blue gas cloud. */
export function player_interaction_24() {
  work_on_active_kong();
  set_player_terminal_velocity();
  set_player_normal_gravity();
  const x = r16(R.current_sprite);
  reg.x = x;
  w16(x + sprite.state, C.kong_state_5D);
  w16(x + sprite.general_purpose_42, 0x0020);
  // frozen in the air: remember to fall afterwards
  const height = r16(x + sprite.ground_distance) & 0x7fff;
  const y = cmpMinus(height, 0x0010) ? 0x0000 : 0x0500;
  // CODE_B88184
  w16(x + sprite.general_purpose_44, y);
  w16(x + sprite.y_speed, 0);
  w16(x + sprite.x_speed, 0);
  w16(x + sprite.max_x_speed, 0);
  reg.a = 0x00a0;
  set_anim_handle_dixie();
  w16(0x091f, r16(R.interaction_RAM_0A86));
  w16(R.RAM_0B02, r16(R.RAM_0B02) & ~0x0008);
  w16(0x091b, (r16(0x091b) & 0xfcff) | 0x0100);
  CODE_BB8C2C();
  drop_follower_kong_if_teamed_up();
}

/** $B881B4 */
export function drop_sprite_or_follower_kong() {
  drop_follower_kong_if_teamed_up();
  drop_sprite_if_holding();
}

/** $B881BB — if the partner is on the active Kong's shoulders, put it down to follow again. */
export function drop_follower_kong_if_teamed_up() {
  reg.a = r16(R.current_held_sprite);
  if (reg.a !== r16(R.inactive_kong_sprite)) return;
  // .teamed_up
  w16(R.current_held_sprite, 0);
  reg.x = r16(R.inactive_kong_sprite);
  setFollowState(0x00d8, 0x001f, 0x001c);
  const x = r16(R.active_kong_sprite);
  reg.x = x;
  reg.a = 0x00e4;
  w16(x + sprite.render_order, 0x00e4);
}

/** $B881E9 — interaction $15: mounting the skull cart (Kong in $0A88). */
export function player_interaction_15() {
  drop_follower_kong_if_teamed_up();
  reg.x = r16(R.interaction_RAM_0A88);
  work_on_kong_in_x();
  drop_sprite_if_holding();
  w16(0x0aee, 0);
  w16(0x0af2, 0);
  reg.a = 0x004e;
  set_anim_handle_dixie();
  const x = r16(R.current_sprite);
  reg.x = x;
  w16(x + sprite.general_purpose_42, r16(R.interaction_RAM_0A86));
  if (x === r16(R.active_kong_sprite)) {
    // CODE_B88222
    reg.a = C.kong_state_5B;
    w16(x + sprite.state, C.kong_state_5B);
    return;
  }
  const old = r16(x + sprite.state);
  reg.y = old;
  w16(x + sprite.state, C.kong_state_5C);
  reg.a = C.kong_state_5C;
  if (old !== C.kong_state_2B) return;
  work_on_active_kong();
  CODE_B8A57C();
}

/** $B88228 — interaction $16: jumping off the skull cart. */
export function player_interaction_16() {
  work_on_active_kong();
  set_player_terminal_velocity_global();
  CODE_B9DFB2();
  set_player_jumping_gravity();
  reg.a = 0x0006;
  set_anim_handle_dixie();
  const x = r16(R.current_sprite);
  reg.x = x;
  w16(x + sprite.state, C.kong_state_67);
  reg.a = r16(R.game_state_flags) & 0x4000;
  if (!reg.a) return;
  // .both_kongs
  work_on_inactive_kong();
  setFollowState(null, 0x0001, 0x0006);
}

/** $B88262 */
export function set_player_interaction_27() {
  reg.a = C.player_interaction_27;
  set_player_interaction_global();
}

/** $B88269 — interaction $27: collecting the Kremkoin / end-of-bonus item. */
export function player_interaction_27() {
  w16(R.game_state_flags_2, r16(R.game_state_flags_2) & ~0x0010);
  set_kongs_visible_if_not_in_barrel();
  drop_sprite_or_follower_kong();
  if (r16(level.type) === C.boss_level_type) {
    CODE_B882D6();
    return;
  }
  work_on_active_kong();
  const x = reg.x;
  setFacing(x, r16(R.interaction_RAM_0A86));
  if (r16(x + sprite.terrain_interaction) & 0x0001 || r16(R.animal_type)) {
    CODE_B8830E(); // CODE_B882D2
    return;
  }
  const state = r16(x + sprite.state);
  reg.x = (state << 2) & 0xffff;
  if (kongStateFlags(state) & 0x0002) {
    // CODE_B882C3
    const k = r16(R.current_sprite);
    reg.x = k;
    w16(k + sprite.state, C.kong_state_70);
    reg.a = 0x0001;
    transition_song();
    return;
  }
  set_player_terminal_velocity_global();
  set_player_normal_gravity_global();
  CODE_B9DFCF();
  reg.a = 0x003f;
  set_anim_handle_dixie();
  const k = r16(R.current_sprite);
  reg.x = k;
  reg.a = C.kong_state_64;
  w16(k + sprite.state, C.kong_state_64);
  w16(k + sprite.max_x_speed, 0);
}

/** CODE_B882D6 — boss levels: the boss's Kremkoin leaves the level. */
function CODE_B882D6() {
  w16(R.interaction_RAM_0A86, 0xffff);
  player_interaction_19();
  work_on_active_kong();
  const x = reg.x;
  w16(x + sprite.state, C.kong_state_7B);
  w16(x + sprite.interaction_flags, 0x001e);
  reg.a = r16(R.game_state_flags) & 0x4000;
  if (!reg.a) return;
  work_on_inactive_kong();
  setFollowState(0x00d8, 0x001f, 0x001c);
}

/** $B8830E — Kong state $65 (exit celebration) with the matching animation. */
export function CODE_B8830E() {
  CODE_B3E287();
  work_on_active_kong();
  const x = r16(R.current_sprite);
  reg.x = x;
  w16(x + sprite.state, C.kong_state_65);
  if (r16(R.animal_type)) {
    // .exit_as_animal
    reg.a = 0x009a;
    set_anim_handle_animal_and_dixie();
    return;
  }
  check_sprite_underwater();
  reg.a = (reg.a & 0xffff) === 0x0002 ? 0x00a3 : 0x00a1;
  set_anim_handle_dixie();
}

/** $B88340 — interaction $28: losing a bonus. */
export function player_interaction_28() {
  const x = r16(R.active_kong_sprite);
  const y = r16(R.inactive_kong_sprite);
  reg.x = x;
  reg.y = y;
  w16(x + sprite.display_mode, 0);
  w16(y + sprite.display_mode, 0);
  work_on_active_kong();
  const k = reg.x;
  w16(k + sprite.render_order, 0x00f4);
  if (r16(k + sprite.state) === C.kong_state_11) {
    reg.a = 0x0047;
    set_anim_handle_dixie();
  }
  // CODE_B88364
  reg.a = 0x001f;
  reg.y = 0x0100;
  enable_bullet_time_global();
  reg.a = 0x0002;
  transition_song();
  set_level_end_exit_state();
}

/** $B88379 — interaction $29: falling into a pit. */
export function player_interaction_29() {
  set_kongs_visible_if_not_in_barrel();
  work_on_active_kong();
  if (r16(R.current_song) === C.music_lava) {
    reg.a = sound(7, "lava_bubble_4");
    queue_sound_effect();
  }
  // CODE_B8838D
  if (r16(R.current_song) === C.music_swamp) {
    reg.y = C.special_sprite_spawn_id_0018;
    spawn_special_sprite_index();
    const y = r16(R.alternate_sprite);
    reg.y = y;
    w16(y + sprite.y_position, 0x02c0);
    reg.a = sound(7, "splash_1_copy");
    queue_sound_effect();
  }
  // CODE_B883AA
  const mount = r16(R.current_player_mount);
  if (mount) {
    reg.x = mount;
    w16(mount + sprite.current_graphic, 0);
    w16(mount + sprite.last_rendered_graphic, 0);
    w16(R.current_player_mount, 0);
    w16(R.animal_type, 0);
  }
  // CODE_B883B8
  const x = r16(R.current_sprite);
  reg.x = x;
  w16(x + sprite.current_graphic, 0);
  w16(x + sprite.last_rendered_graphic, 0);
  w16(x + sprite.state, C.kong_state_3B);
  w16(x + sprite.general_purpose_42, 0x00a0);
  w16(x + sprite.interaction_flags, 0);
  reg.a = 0x0003;
  w16(R.time_stop_flags, 0x0003);
  CODE_B883D5();
}

/** $B883D5 — death music (not in the K. Rool fights or when $2000 of game_state_flags is set). */
export function CODE_B883D5() {
  reg.a = r16(R.game_state_flags) & 0x2000;
  if (reg.a) return;
  CODE_BEC66F();
  reg.a = r16(R.current_song);
  if (reg.a === C.music_krool) return;
  // CODE_B88414
  reg.a = 0x0001;
  transition_song();
}

/** $B8841C — interaction $2D: leave the level to the current destination. */
export function player_interaction_2D() {
  CODE_BBBE01();
}

/**
 * $B88421 — interaction $2C: leave the level straight to the map.
 * The original tail-jumps (JML) to CODE_BBBE01, which returns with RTL although this handler
 * was entered through a JSR; here it is an ordinary call.
 */
export function player_interaction_2C() {
  reg.a = 0xffff;
  w16(R.level_destination_number, 0xffff);
  CODE_BBBE01();
}

/** $B8842B — interaction $04: initiating a team-up (A button): the partner jumps onto the shoulders. */
export function player_interaction_04() {
  check_if_player_has_both_kongs();
  if (reg.c) return;
  reg.x = 0x0540;
  reg.y = 0x0540;
  play_kong_dependant_sound();
  w16(R.current_held_sprite, r16(R.inactive_kong_sprite));
  w16(R.held_sprite_x_offset, 0);
  w16(R.held_sprite_y_offset, 0);
  w16(0x0d80, 0x0001);
  reg.a = 0x0007;
  reg.y = 0x0100;
  enable_bullet_time_global();
  work_on_active_kong();
  w16(reg.x + sprite.state, C.kong_state_13);
  w16(reg.y + kong_control.fast_flag, r16(reg.y + kong_control.fast_flag) & 0xfffb);
  reg.a = 0x001f;
  set_anim_handle_dixie();
  work_on_inactive_kong();
  const x = r16(R.current_sprite);
  w16(x + sprite.state, C.kong_state_40);
  w16(0x004a, 0xffe4);
  reg.a = 0x001f;
  reg.x = 0x001c;
  reg.y = 0x0000;
  CODE_B8D8D7();
  CODE_B8A14E();
}

/** $B8848E — interaction $05: teamed up. */
export function player_interaction_05() {
  get_kong_state_flag_0020();
  if (reg.a) return;
  set_kongs_visible_if_not_in_barrel();
  if (r16(R.current_player_mount)) {
    // .player_is_mounted: the partner just follows
    work_on_inactive_kong();
    setFollowState(null, 0x0004, 0x0003);
    return;
  }
  w16(R.current_held_sprite, r16(R.inactive_kong_sprite));
  w16(R.held_sprite_x_offset, 0);
  w16(R.held_sprite_y_offset, 0);
  w16(0x0d80, 0x0001);
  disable_bullet_time();
  work_on_active_kong();
  w16(reg.x + sprite.state, C.kong_state_17);
  w16(reg.y + kong_control.fast_flag, r16(reg.y + kong_control.fast_flag) & 0xfffb);
  reg.a = 0x001f;
  set_anim_handle_dixie();
  work_on_inactive_kong();
  w16(reg.x + sprite.state, C.kong_state_18);
  reg.a = 0x0020;
  set_anim_handle_dixie();
}

/** $B884EC — interaction $06: cancelling the team-up (the partner hops off). */
export function player_interaction_06() {
  get_kong_state_flag_0020();
  if (reg.a) return;
  reg.a = 0x0002;
  if (r16(R.game_state_flags_2) & 0x0002) return;
  w16(R.current_held_sprite, 0);
  work_on_active_kong();
  w16(reg.x + sprite.state, C.kong_state_7E);
  work_on_inactive_kong();
  w16(reg.x + sprite.state, C.kong_state_76);
  reg.a = 0x0040;
  set_anim_handle_dixie();
  w16(reg.x + sprite.x_speed, 0);
  reg.a = 0xfa00;
  w16(reg.x + sprite.y_speed, 0xfa00);
}

/** $B8851B — A = flag $0020 of the active Kong's state ("can't team up / swap now"). */
export function get_kong_state_flag_0020() {
  const state = r16(r16(R.active_kong_sprite) + sprite.state);
  reg.x = (state << 2) & 0xffff;
  reg.a = kongStateFlags(state) & 0x0020;
  reg.z = reg.a === 0;
}

/** $B8852B — interaction $03: rejoining the team-up after throwing the partner upwards. */
export function player_interaction_03() {
  set_kongs_visible_if_not_in_barrel();
  const x = r16(R.active_kong_sprite);
  reg.x = x;
  if (r16(x + sprite.state) !== C.kong_state_2C) {
    get_kong_state_flag_0020();
    if (reg.a) return;
  }
  // .CODE_B8853D
  w16(R.current_held_sprite, r16(R.inactive_kong_sprite));
  w16(R.held_sprite_x_offset, 0);
  w16(R.held_sprite_y_offset, 0);
  w16(0x0d80, 0x0001);
  work_on_active_kong();
  w16(reg.x + sprite.state, C.kong_state_1A);
  w16(reg.y + kong_control.fast_flag, r16(reg.y + kong_control.fast_flag) & 0xfffb);
  reg.a = 0x0023;
  set_anim_handle_dixie();
  work_on_inactive_kong();
  const k = reg.x;
  w16(k + sprite.state, C.kong_state_18);
  w16(k + sprite.interaction_flags, r16(k + sprite.interaction_flags) & 0xfff7);
  reg.a = 0x0020;
  set_anim_handle_dixie();
}

/** $B8857E — interaction $1C: defeating an enemy by rolling (holding Y keeps the roll going faster). */
export function player_interaction_1C() {
  reg.a = 0x0080;
  reg.y = 0x0002;
  enable_bullet_time();
  work_on_active_kong();
  const x = reg.x;
  const kc = r16(R.current_kong_control_variables);
  reg.y = kc;
  reg.a = r16(kc + kong_control.input_held) & 0x4000;
  if (!reg.a) return;
  let speed = (r16(kc + kong_control.roll_speed) + 0x0100) & 0xffff;
  if (!cmpMinus(speed, 0x0800)) speed = 0x0800;
  w16(kc + kong_control.roll_speed, speed);
  reg.y = 0x0032;
  reg.a = spriteConst(0x0032);
  w16(x + sprite.y_speed, reg.a);
  apply_roll_animation();
  const k = r16(R.current_sprite);
  reg.x = k;
  reg.a = C.kong_state_19;
  w16(k + sprite.state, C.kong_state_19);
}

/** $B885B8 — interaction $08: stuck to honey on a wall. */
export function player_interaction_08() {
  work_on_active_kong();
  drop_sprite_if_holding();
  const x = r16(R.current_sprite);
  reg.x = x;
  w16(x + sprite.state, C.kong_state_41);
  w16(x + sprite.ground_distance, 0);
  w16(x + sprite.max_x_speed, 0);
  w16(x + sprite.x_speed, 0);
  w16(x + sprite.y_speed, 0);
  reg.a = 0x002b;
  set_anim_handle_dixie();
}

/** $B885D5 — interaction $1F: stunned by K. Rool before being hit by his gun. */
export function player_interaction_1F() {
  work_on_active_kong();
  const x = reg.x;
  w16(x + sprite.state, C.kong_state_5A);
  w16(x + sprite.x_speed, 0);
  w16(x + sprite.max_x_speed, 0);
  setFacing(x, r16(R.interaction_RAM_0A86));
  reg.a = 0x009f;
  set_anim_handle_dixie();
}

/** $B885F5 — interaction $25: slowed (red gas) / reversed (purple gas) by K. Rool. */
export function player_interaction_25() {
  work_on_active_kong();
  set_player_terminal_velocity();
  set_player_normal_gravity();
  const x = reg.x;
  w16(x + sprite.state, C.kong_state_5A);
  setFacing(x, r16(R.interaction_RAM_0A86));
  w16(x + sprite.y_speed, 0xfc00);
  w16(x + sprite.x_speed, 0);
  w16(x + sprite.max_x_speed, 0);
  reg.a = 0x0048;
  set_anim_handle_dixie();
  drop_follower_kong_if_teamed_up();
}

/** $B88623 — interaction $07: stuck to honey on the ground. */
export function player_interaction_07() {
  work_on_active_kong();
  const x = r16(R.current_sprite);
  reg.x = x;
  reg.y = r16(R.current_held_sprite);
  const state = reg.y ? C.kong_state_7A : C.kong_state_43;
  w16(x + sprite.state, state);
  w16(x + sprite.max_x_speed, 0);
  w16(x + sprite.x_speed, 0);
  w16(x + sprite.y_speed, 0);
  set_stuck_on_honey_floor_animation();
  reg.a = sound(6, "stick_honey");
  queue_sound_effect();
}

/** $B88646 */
export function set_stuck_on_honey_floor_animation() {
  reg.a = r16(R.current_held_sprite) ? 0x002e : 0x002d;
  set_anim_handle_dixie();
}

/** $B8865B — interaction $0A: grabbing a horsetail or ghost rope (sprite in $0A86). */
export function player_interaction_0A() {
  const rope = r16(R.interaction_RAM_0A86);
  reg.x = rope;
  if (rope !== r16(R.held_rope_sprite_temp)) return;
  // .CODE_B88664
  const type = r16(rope + sprite.type);
  reg.a = type;
  if (type !== C.sprite_horsetail && type !== C.sprite_ghost_rope) return;
  // .CODE_B88670
  work_on_active_kong();
  drop_sprite_if_holding();
  w16(R.held_rope_sprite, r16(R.held_rope_sprite_temp));
  w16(R.held_rope_sprite_temp, 0);
  const x = r16(R.current_sprite);
  reg.x = x;
  w16(x + sprite.state, C.kong_state_45);
  w16(x + sprite.max_x_speed, 0);
  w16(x + sprite.x_speed, 0);
  w16(x + sprite.y_speed, 0);
  w16(x + sprite.max_y_speed, 0);
  const y = r16(R.held_rope_sprite);
  reg.y = y;
  w16(x + sprite.x_position, r16(y + sprite.x_position));
  reg.a = 0x002f;
  set_anim_handle_dixie();
}

/** $B8869E — interaction $12: grabbing a vertical rope. */
export function player_interaction_12() {
  work_on_active_kong();
  check_if_animal_or_holding_sprite();
  if (reg.c) return;
  CODE_B886E0();
  const x = reg.x;
  w16(x + sprite.state, C.kong_state_35);
  const ropeY = r16(R.interaction_RAM_0A86);
  if (ropeY) w16(x + sprite.y_position, ropeY);
  // .CODE_B886B5: snap x to the rope's column
  CODE_B886CD();
  const k = reg.x;
  w16(k + sprite.x_position, (r16(k + sprite.x_position) & 0xfff0) | r16(R.temp_32));
  w16(k + sprite.y_speed, 0);
  w16(k + sprite.max_y_speed, 0);
  reg.a = 0x002f;
  set_anim_handle_dixie();
}

/** $B886CD — $32 = x offset within the 16px column (3 or $1F depending on the rope side). */
export function CODE_B886CD() {
  reg.x = r16(R.current_sprite);
  reg.a = r16(R.interaction_RAM_0A88) & 0x8000 ? 0x001f : 0x0003;
  w16(R.temp_32, reg.a);
}

/** $B886E0 — reset the camera offsets ($0AEA/$0AEC/$0AEE/$0AF2). */
export function CODE_B886E0() {
  reg.a = 0x8000;
  w16(0x0aea, 0x8000);
  w16(0x0aec, 0x8000);
  w16(0x0aee, 0);
  w16(0x0af2, 0);
}

/** $B886F3 — interaction $11: grabbing a horizontal rope (rope height in $0A86). */
export function player_interaction_11() {
  work_on_active_kong();
  check_if_animal_or_holding_sprite();
  if (reg.c) return;
  const x = reg.x;
  w16(x + sprite.state, C.kong_state_38);
  w16(x + sprite.y_position, (r16(R.interaction_RAM_0A86) + 0x0028) & 0xffff);
  w16(x + sprite.y_speed, 0);
  w16(x + sprite.max_y_speed, 0);
  reg.a = 0x0039;
  set_anim_handle_dixie();
  w16(0x0aee, 0);
  w16(0x0af2, 0);
}

/** $B8871B — interaction $09: bouncing on a brown Krochead. */
export function player_interaction_09() {
  work_on_active_kong();
  w16(reg.x + sprite.state, C.kong_state_55);
  if (r16(R.animal_type)) {
    // CODE_B8873C
    reg.a = 0x005e;
    set_anim_handle_animal_and_dixie();
    const x = r16(R.current_sprite);
    reg.x = x;
    w16(0x003e, 0);
    reg.a = C.kong_state_55;
    w16(x + sprite.state, C.kong_state_55);
    return;
  }
  reg.a = r16(R.current_held_sprite) ? 0x004d : 0x004c; // CODE_B88734
  set_anim_handle_dixie();
}

/** $B8874D — interaction $1A: only makes the Kongs visible again. */
export function player_interaction_1A() {
  set_kongs_visible_if_not_in_barrel();
}

/** $B88755 — interaction $0E: bouncing off a tire (or a fixed bounce from $0A86/$0A88). */
export function player_interaction_0E() {
  set_kongs_visible_if_not_in_barrel();
  work_on_active_kong();
  let x = r16(R.current_sprite);
  reg.x = x;
  const bounce = r16(R.interaction_RAM_0A86);
  if (bounce) {
    // CODE_B88787: explicit y/x speed
    w16(x + sprite.y_speed, bounce);
    w16(x + sprite.x_speed, r16(R.interaction_RAM_0A88));
    set_player_terminal_velocity_global();
    set_player_normal_gravity_global();
    x = reg.x;
  } else {
    // the tire sprite in $0A88 provides speeds and gravity
    const tire = r16(R.interaction_RAM_0A88);
    reg.y = tire;
    let xs = r16(tire + sprite.general_purpose_48);
    if (r16(x + sprite.oam_property) & 0x4000) xs = -xs & 0xffff;
    // CODE_B88770
    w16(x + sprite.x_speed, xs);
    w16(x + sprite.y_speed, r16(tire + sprite.general_purpose_4A));
    const kc = r16(R.current_kong_control_variables);
    w16(kc + kong_control.gravity_force, r16(tire + sprite.general_purpose_4C));
    w16(kc + kong_control.max_fall_speed, r16(tire + sprite.general_purpose_4E));
    reg.a = r16(tire + sprite.general_purpose_4E);
    reg.x = x;
  }
  // CODE_B88796
  w16(x + sprite.terrain_interaction, 0);
  if (r16(R.current_held_sprite) === r16(R.inactive_kong_sprite)) {
    CODE_B887BC();
    return;
  }
  const k = r16(R.current_sprite);
  reg.x = k;
  w16(k + sprite.state, C.kong_state_56);
  CODE_B88823();
}

/** CODE_B887AA — bounce while teamed up. */
function CODE_B887AA() {
  reg.a = 0x0004;
  disable_enemy_damage();
  reg.a = 0x0080;
  reg.y = 0x0003;
  enable_bullet_time();
  set_player_jumping_gravity();
  CODE_B887BC();
}

/** CODE_B887BC — teamed-up bounce: state $1C with the bounce speed from the constants. */
function CODE_B887BC() {
  const x = r16(R.current_sprite);
  reg.x = x;
  reg.y = 0x0008;
  w16(x + sprite.y_speed, spriteConst(0x0008));
  w16(x + sprite.state, C.kong_state_1C);
  reg.a = 0x0025;
  set_anim_handle_dixie();
}

/** $B887D2 — interaction $1B: defeating an enemy by stomping on it. */
export function player_interaction_1B() {
  work_on_active_kong();
  reg.a = r16(reg.x + sprite.state);
  if (reg.a === C.kong_state_11) return;
  // CODE_B887DD
  set_player_terminal_velocity_global();
  w16(0x0aee, 0);
  w16(0x0af2, 0);
  if (r16(R.current_held_sprite) === r16(R.inactive_kong_sprite)) {
    CODE_B887AA();
    return;
  }
  CODE_B9DFB2();
  reg.a = 0x0004;
  disable_enemy_damage();
  reg.a = 0x0080;
  reg.y = 0x0002;
  enable_bullet_time();
  drop_sprite_if_holding();
  set_player_jumping_gravity();
  const x = r16(R.current_sprite);
  reg.x = x;
  const old = r16(x + sprite.state);
  reg.y = old;
  if (old !== C.kong_state_4F) {
    // skull cart jump states $67/$68 keep their own bounce state
    const state = old >= C.kong_state_67 && old < C.kong_state_69 ? C.kong_state_68 : C.kong_state_16;
    w16(x + sprite.state, state); // CODE_B88821
  }
  CODE_B88823();
}

/** $B88823 — bounce animation (animal, carrying, or normal; a captured partner is released). */
export function CODE_B88823() {
  if (r16(R.animal_type)) {
    // CODE_B88854
    reg.a = 0x0072;
    set_anim_handle_animal_and_dixie();
    return;
  }
  if (r16(R.current_held_sprite)) {
    // CODE_B8885C
    reg.a = 0x0016;
    set_anim_handle_dixie();
    return;
  }
  reg.a = 0x001c;
  set_anim_handle_dixie();
  work_on_inactive_kong();
  reg.a = r16(reg.x + sprite.state);
  if (reg.a !== C.kong_state_2F) return;
  setFollowState(0x00d8, 0x001f, 0x001c);
}

/** $B88864 — interaction $2A: hitting the goal target (Kong flies towards $0A86, level cleared). */
export function player_interaction_2A() {
  set_kongs_visible_if_not_in_barrel();
  CODE_B8939C();
  drop_follower_kong_if_teamed_up();
  drop_sprite_if_holding();
  CODE_B3E287();
  set_current_level_as_cleared();
  if (r16(level.song) !== C.music_krool) {
    if (r16(R.RAM_0B02) & 0x0004) {
      reg.x = 0x0002;
      reg.y = 0x0003;
      transition_kong_dependant_song();
    } else {
      // CODE_B88893
      reg.a = 0x0004;
      transition_song();
    }
  }
  // CODE_B8889A
  w16(0x0af0, 0xa000);
  w16(0x0aea, 0x8000);
  w16(0x0aec, 0x8000);
  w16(0x0ab8, 0xc000 | r16(0x0ab8));
  work_on_active_kong();
  w16(reg.x + sprite.interaction_flags, 0x009e | r16(reg.x + sprite.interaction_flags));
  w16(reg.y + kong_control.fast_flag, r16(reg.y + kong_control.fast_flag) & 0xfffb);
  set_player_normal_gravity();
  set_player_terminal_velocity();
  const x = r16(R.current_sprite);
  reg.x = x;
  w16(x + sprite.general_purpose_42, r16(R.interaction_RAM_0A86));
  w16(x + sprite.general_purpose_44, r16(R.interaction_RAM_0A88));
  w16(x + sprite.oam_property, r16(x + sprite.oam_property) & 0xbfff);
  w16(x + sprite.state, C.kong_state_46);
  w16(x + sprite.y_speed, 0xfa00);
  // x speed = distance to the target / 32 (8.8 fixed point), via the $32/$34 scratch pair
  const dist = (r16(x + sprite.general_purpose_42) - r16(x + sprite.x_position)) & 0xffff;
  const wide = (dist * 0x10000) >>> 5;
  w16(0x0032, wide & 0xffff);
  w16(0x0034, (wide >>> 16) & 0xffff);
  w16(x + sprite.x_speed, r16(0x0033));
  reg.a = 0x0006;
  set_anim_handle_dixie();
}

/** $B88911 — interaction $1D: defeating an enemy by team throw. */
export function player_interaction_1D() {
  set_kongs_visible_if_not_in_barrel();
  work_on_inactive_kong();
  reg.a = r16(reg.x + sprite.state);
  if (reg.a === C.kong_state_21) {
    player_interaction_20();
    return;
  }
  // CODE_B88921
  set_player_terminal_velocity_global();
  CODE_B8A131();
}

/** $B88929 — interaction $1E: knocked back by an enemy. */
export function player_interaction_1E() {
  let x = r16(R.active_kong_sprite);
  reg.x = x;
  reg.a = r16(x + sprite.state);
  if (reg.a === C.kong_state_23) drop_follower_kong_if_teamed_up();
  // CODE_B88936
  set_kongs_visible_if_not_in_barrel();
  work_on_active_kong();
  set_player_terminal_velocity();
  set_player_normal_gravity();
  w16(0x0aee, 0);
  w16(0x0af2, 0);
  x = r16(R.current_sprite);
  reg.x = x;
  const ys = r16(R.animal_type) === C.sprite_squawks ? 0xfd00 : 0xf900;
  // CODE_B88959
  w16(x + sprite.y_speed, ys);
  w16(x + sprite.x_speed, r16(R.interaction_RAM_0A86));
  w16(x + sprite.max_x_speed, 0);
  reg.a = 0x0080;
  reg.y = 0x0002;
  enable_bullet_time();
  reg.a = 0x0008;
  disable_enemy_damage();
  x = r16(R.current_sprite);
  reg.x = x;
  w16(x + sprite.state, C.kong_state_15);
  if (r16(R.animal_type)) {
    // CODE_B8898C
    reg.a = 0x0072;
    set_anim_handle_animal_and_dixie();
    return;
  }
  reg.a = r16(R.current_held_sprite) === r16(R.inactive_kong_sprite) ? 0x0023 : 0x001b; // CODE_B88994
  set_anim_handle_dixie();
}

/** $B8899C — interaction $26: hit by Klubba or K. Rool's gun (bounced away). */
export function player_interaction_26() {
  if (r16(R.game_state_flags) & 0x8000) {
    CODE_B88A00();
    return;
  }
  w16(0x0919, r16(0x0919) & ~0x0003);
  work_on_active_kong();
  w16(reg.x + sprite.interaction_flags, 0x0080);
  w16(reg.x + sprite.state, C.kong_state_59);
  reg.a = 0x00a0;
  set_anim_handle_dixie();
  let x = reg.x;
  const xs = r16(R.interaction_RAM_0A86);
  w16(x + sprite.x_speed, xs);
  w16(x + sprite.max_x_speed, xs);
  // face against the direction of the push
  const p = r16(x + sprite.oam_property);
  w16(x + sprite.oam_property, ((((xs >> 1) ^ p) ^ 0xffff) & 0x4000) ^ p);
  w16(x + sprite.y_speed, r16(R.interaction_RAM_0A88));
  set_death_bounce_gravity_and_speed();
  x = reg.x;
  w16(0x0d66, r16(x + sprite.x_position));
  w16(0x0d6a, r16(x + sprite.y_position));
  reg.a = r16(R.game_state_flags) & 0x4000;
  if (!reg.a) return;
  // CODE_B889EA
  work_on_inactive_kong();
  w16(reg.x + sprite.state, C.kong_state_26);
  w16(reg.x + sprite.general_purpose_42, 0);
  w16(reg.x + sprite.interaction_flags, 0);
  reg.a = 0x0007;
  reg.y = 0x0100;
  enable_bullet_time();
}

/** CODE_B88A00 — the Klubba variant: both Kongs are thrown back. */
function CODE_B88A00() {
  work_on_active_kong();
  reg.x = r16(R.active_kong_sprite);
  reg.a = 0xf800;
  reg.y = 0xfa00;
  set_hurt_by_klubba_state();
  reg.a = r16(R.game_state_flags) & 0x4000;
  if (!reg.a) return;
  work_on_inactive_kong();
  reg.x = r16(R.inactive_kong_sprite);
  reg.a = 0xfa00;
  reg.y = 0xfb00;
  set_hurt_by_klubba_state();
}

/** $B88A27 — X = Kong, A = y speed, Y = x speed (max speed = x speed / 4). */
export function set_hurt_by_klubba_state() {
  const x = reg.x;
  w16(R.current_sprite, x);
  w16(x + sprite.y_speed, reg.a & 0xffff);
  const xs = reg.y & 0xffff;
  w16(x + sprite.x_speed, xs);
  // two arithmetic shifts right (CMP #$8000 / ROR)
  const quarter = (((xs << 16) >> 16) >> 2) & 0xffff;
  w16(x + sprite.max_x_speed, quarter);
  w16(x + sprite.state, C.kong_state_72);
  reg.y = C.special_sprite_spawn_id_0036;
  spawn_special_sprite_index();
  reg.a = 0x00a0;
  set_anim_handle_dixie();
}

/** $B88A4C — interaction $20: the thrown partner is hurt (team throw failed). */
export function player_interaction_20() {
  set_kongs_visible_if_not_in_barrel();
  work_on_active_kong();
  reg.a = r16(reg.x + sprite.state);
  if (reg.a === C.kong_state_2C) w16(reg.x + sprite.state, 0);
  // .CODE_B88A5B
  work_on_inactive_kong();
  w16(R.game_state_flags, r16(R.game_state_flags) & 0xbfff);
  let x = reg.x;
  w16(x + sprite.state, C.kong_state_24);
  w16(x + sprite.x_speed, 0);
  w16(x + sprite.max_x_speed, 0);
  w16(x + sprite.interaction_flags, 0);
  w16(x + sprite.general_purpose_42, 0);
  set_player_normal_gravity();
  set_player_terminal_velocity();
  x = reg.x;
  reg.y = 0x002a;
  w16(x + sprite.y_speed, spriteConst(0x002a));
  w16(x + sprite.oam_property, r16(x + sprite.oam_property) & 0xbfff);
  w16(x + sprite.interaction_flags, 0);
  reg.a = 0x0029;
  set_anim_handle_dixie();
}

/** $B88A92 — interaction $21: crashed into a Target Terror door. */
export function player_interaction_21() {
  work_on_active_kong();
  w16(reg.x + sprite.interaction_flags, 0x0080);
  reg.a = 0x001b;
  set_anim_handle_dixie();
  const flags = r16(R.game_state_flags);
  w16(R.game_state_flags, flags & ~0x4000);
  if (!(flags & 0x4000)) {
    const x = r16(R.current_sprite);
    reg.x = x;
    w16(x + sprite.state, C.kong_state_6B);
    w16(x + sprite.x_speed, 0);
    reg.a = 0xfb00;
    w16(x + sprite.y_speed, 0xfb00);
    return;
  }
  // CODE_B88AB8: the hurt Kong drops out, the partner takes over
  let x = r16(R.current_sprite);
  reg.x = x;
  w16(x + sprite.state, C.kong_state_6A);
  swap_active_kong_global();
  work_on_active_kong();
  x = reg.x;
  let state: number;
  if (r16(x + sprite.state) === C.kong_state_5C) {
    // CODE_B88AEC
    if (r16(R.current_game_mode) === C.gamemode_2_player_team) {
      state = 0x007d;
      reg.y = 0x0000;
    } else {
      state = C.kong_state_5B; // CODE_B88AFC
      reg.y = 0x000a;
    }
  } else if (r16(R.current_game_mode) === C.gamemode_2_player_team) {
    // CODE_B88AE4
    state = 0x007f;
    reg.y = 0x0000;
  } else {
    start_player_falling();
    const k = r16(R.current_sprite);
    reg.x = k;
    w16(k + sprite.state, C.kong_state_67);
    init_player_clipping();
    return;
  }
  // CODE_B88B02
  w16(x + sprite.state, state);
  reg.a = 0x0007;
  enable_bullet_time();
  work_on_inactive_kong();
  w16(reg.x + sprite.x_speed, 0);
  reg.a = 0xfb00;
  w16(reg.x + sprite.y_speed, 0xfb00);
}

/** $B88DF7 — gravity and upward speed of the death/hurt bounce from the Kong's constants. */
export function set_death_bounce_gravity_and_speed() {
  reg.y = 0x0024;
  const g = spriteConst(0x0024);
  reg.y = r16(R.current_kong_control_variables);
  w16(reg.y + kong_control.gravity_force, g);
  reg.y = 0x0026;
  reg.a = spriteConst(0x0026);
  reg.x = r16(R.current_sprite);
  w16(reg.x + sprite.y_speed, reg.a);
}

register({
  process_interactions_with_player,
  work_on_active_kong_global,
  work_on_active_kong,
  work_on_inactive_kong_global,
  work_on_kong_in_x,
  work_on_inactive_kong,
  set_kongs_visible_if_not_in_barrel,
  player_interaction_0C,
  player_interaction_0B,
  player_interaction_24,
  drop_sprite_or_follower_kong,
  drop_follower_kong_if_teamed_up,
  player_interaction_15,
  player_interaction_16,
  set_player_interaction_27,
  player_interaction_27,
  CODE_B8830E,
  player_interaction_28,
  player_interaction_29,
  CODE_B883D5,
  player_interaction_2D,
  player_interaction_2C,
  player_interaction_04,
  player_interaction_05,
  player_interaction_06,
  get_kong_state_flag_0020,
  player_interaction_03,
  player_interaction_1C,
  player_interaction_08,
  player_interaction_1F,
  player_interaction_25,
  player_interaction_07,
  set_stuck_on_honey_floor_animation,
  player_interaction_0A,
  player_interaction_12,
  CODE_B886CD,
  CODE_B886E0,
  player_interaction_11,
  player_interaction_09,
  player_interaction_1A,
  player_interaction_0E,
  player_interaction_1B,
  CODE_B88823,
  player_interaction_2A,
  player_interaction_1D,
  player_interaction_1E,
  player_interaction_26,
  set_hurt_by_klubba_state,
  player_interaction_20,
  player_interaction_21,
  set_death_bounce_gravity_and_speed,
});

// The generated stubs guess some return modes wrong; these matter when original code enters.
setReturnMode(RET_RTL, ["process_interactions_with_player"]);
setReturnMode(RET_RTS, [
  "player_interaction_0B",
  "player_interaction_0C",
  "player_interaction_0E",
  "player_interaction_15",
  "player_interaction_1D",
  "player_interaction_1E",
  "player_interaction_24",
  "player_interaction_28",
  "player_interaction_29",
  "player_interaction_2A",
  "player_interaction_2C",
]);
