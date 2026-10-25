/**
 * Bank $B8 — falling into pits, hazards checked every frame while walking (held rope latch,
 * sticky honey walls/floors, deadly water), the underwater test and entering the swimming
 * state, and the "wind/tile" check CODE_B8B714 ($B8B516-$B8B792).
 */
import { r16, w16 } from "../../core/mem";
import { reg } from "../../core/cpu";
import { R, C, level, sprite as S, kong_control as K } from "../../core/sym";
import { pl, mi, asr, spriteConst, cur, sw, sr, registerRts, registerRtl } from "./b8b_common";
import { queue_sound_effect } from "./b8b_common";
import {
  spawn_special_sprite_index, set_player_interaction_global, set_player_interaction,
  drop_follower_kong_if_teamed_up, drop_sprite_if_holding, get_sprite_terrain_info_y_origin_0, CODE_B8D484, set_anim_handle_dixie,
  set_anim_handle_animal_and_dixie, CODE_B8D3E2,
} from "../../gen/routines";
import { check_if_animal_or_holding_sprite, CODE_B8B7A0 } from "./b8b_slope";

/** $B8B516 — remember the highest point reached since leaving the ground ($0935). */
export function record_highest_y_position() {
  const x = cur();
  reg.x = x;
  reg.a = sr(x, S.y_position);
  if (sr(x, S.terrain_interaction) & 0x0001) {
    w16(0x0935, reg.a);
    return;
  }
  reg.c = reg.a >= r16(0x0935);
  if (mi(reg.a, r16(0x0935))) w16(0x0935, reg.a);
}

/** $B8B530 — keep the sprite's animation flags $E000 set. */
export function CODE_B8B530() {
  const x = cur();
  reg.x = x;
  reg.a = sr(x, S.animation_flags) | 0xe000;
  sw(x, S.animation_flags, reg.a);
}

/** $B8B53A — kill the kong when it falls below the screen, or touches a deadly floor / water current. */
export function handle_player_pit_death() {
  const x = cur();
  reg.x = x;
  reg.a = (sr(x, S.y_position) - r16(R.screen_scroll_y_position)) & 0xffff;
  reg.c = reg.a >= 0x0120;
  if (pl(reg.a, 0x0120)) return CODE_B8B586();
  reg.a = sr(x, S.terrain_interaction) & 0x0080;
  if (reg.a) return CODE_B8B56E();
  reg.a = sr(x, S.terrain_attributes) & 0x0100;
  if (!reg.a) return CODE_B8B5A6();
  reg.a = sr(x, S.terrain_interaction) & 0x1001;
  reg.c = reg.a >= 0x0001;
  if (reg.a !== 0x0001) return CODE_B8B584();
  if (r16(0x0d54) & 0x8000) return CODE_B8B56E();
  reg.a = r16(R.water_current_y_velocity);
  if (!(reg.a & 0x8000)) return CODE_B8B56E();
  reg.c = reg.a >= 0x9000;
  if (!reg.c) return CODE_B8B5A6();
  CODE_B8B56E();
}
/** $B8B56E — instant death (unless invincible): spawn the death effect, interaction $23. */
export function CODE_B8B56E() {
  reg.a = sr(reg.x, S.interaction_flags) & 0x0080;
  if (reg.a) return CODE_B8B5A6();
  reg.y = C.special_sprite_spawn_id_0036;
  spawn_special_sprite_index();
  reg.a = C.player_interaction_23;
  set_player_interaction_global();
}
/** $B8B584 */
export function CODE_B8B584() {
  CODE_B8B5A6();
}
/** $B8B586 — fell off the bottom of the screen. */
export function CODE_B8B586() {
  const x = reg.x;
  if (x === r16(R.inactive_kong_sprite)) return CODE_B8B5B7();
  reg.a = sr(x, S.state);
  if (reg.a === 0x12) {
    reg.a = sr(x, S.general_purpose_48);
    if (reg.a & 0x0001) {
      reg.a >>= 1;
      reg.c = true;
      return CODE_B8B5A6();
    }
  }
  CODE_B8B597();
}
/** $B8B597 */
export function CODE_B8B597() {
  reg.a = r16(level.type);
  if (reg.a === C.bonus_level_type) return CODE_B8B5A7();
  reg.a = C.player_interaction_29;
  set_player_interaction_global();
  CODE_B8B5A6();
}
/** $B8B5A6 */
export function CODE_B8B5A6() {}
/** $B8B5A7 — in a bonus: leave the bonus instead of dying. */
export function CODE_B8B5A7() {
  reg.a = C.player_interaction_28;
  set_player_interaction_global();
  reg.x = cur();
  reg.a = 0x0003;
  w16(R.time_stop_flags, 0x0003);
}
/** $B8B5B7 — the follower fell: it just reappears (state $13). */
export function CODE_B8B5B7() {
  const x = reg.x;
  sw(x, S.state, 0x13);
  sw(x, S.current_graphic, 0);
  sw(x, S.last_rendered_graphic, 0);
  sw(x, S.animation_speed, 0);
}

/** $B8B5C3 — per-frame checks while on foot: rope grab, sticky honey, entering water. */
export function CODE_B8B5C3() {
  CODE_B8B644();
  if (reg.c) return CODE_B8B5E3();
  reg.a = r16(level.effects) & C.sticky_honey_effect;
  if (reg.a) {
    CODE_B8B671();
    if (reg.c) return CODE_B8B609();
    CODE_B8B65A();
    if (reg.c) return CODE_B8B60F();
  }
  CODE_B8B5DA();
}
/** $B8B5DA — start swimming when submerged. */
export function CODE_B8B5DA() {
  check_sprite_underwater();
  if (reg.a === 0x0002) return CODE_B8B5F2();
}
/** $B8B5E3 — grab the rope sprite that touched us. */
export function CODE_B8B5E3() {
  reg.a = C.player_interaction_0A;
  set_player_interaction();
  if (reg.c) return CODE_B8B5F1();
  reg.a = r16(R.held_rope_sprite_temp);
  w16(R.interaction_RAM_0A86, reg.a);
}
/** $B8B5F1 */
export function CODE_B8B5F1() {}
/** $B8B5F2 */
export function CODE_B8B5F2() {
  CODE_B8B615();
  if (reg.c) return CODE_B8B5F1();
  reg.a = r16(R.animal_type);
  if (reg.a !== 0 && reg.a !== C.sprite_enguarde) return CODE_B8B5F1();
  CODE_B8B600();
}
/** $B8B600 */
export function CODE_B8B600() {
  drop_follower_kong_if_teamed_up();
  drop_sprite_if_holding();
  set_swimming_state();
}
/** $B8B609 — stuck to a sticky honey wall. */
export function CODE_B8B609() {
  reg.a = C.player_interaction_08;
  set_player_interaction();
}
/** $B8B60F — stuck to a sticky honey floor. */
export function CODE_B8B60F() {
  reg.a = C.player_interaction_07;
  set_player_interaction();
}
/** $B8B615 — hazardous water (e.g. hot water / piranhas): carry set when it killed the kong. */
export function CODE_B8B615() {
  reg.a = r16(level.effects) & C.hazardous_water_effect;
  if (!reg.a) return CODE_B8B62B();
  const x = cur();
  reg.x = x;
  reg.a = sr(x, S.interaction_flags) & 0x0080;
  if (reg.a) return CODE_B8B62B();
  reg.a = r16(0x0915);
  if (reg.a === 0) return CODE_B8B62D();
  CODE_B8B62B();
}
/** $B8B62B */
export function CODE_B8B62B() {
  reg.c = false;
}
/** $B8B62D */
export function CODE_B8B62D() {
  reg.y = C.special_sprite_spawn_id_0036;
  spawn_special_sprite_index();
  reg.a = C.player_interaction_23;
  set_player_interaction_global();
  reg.a = (6 << 8) | C.sound_clapper_clap;
  queue_sound_effect();
  reg.c = true;
}

/** $B8B644 — carry set when a new rope sprite was touched this frame (held_rope_sprite_temp). */
export function CODE_B8B644() {
  reg.a = r16(R.held_rope_sprite_temp);
  if (reg.a !== 0) return CODE_B8B64E();
  w16(R.held_rope_sprite, 0);
  CODE_B8B64C();
}
/** $B8B64C */
export function CODE_B8B64C() {
  reg.c = false;
}
/** $B8B64E */
export function CODE_B8B64E() {
  reg.a ^= r16(R.held_rope_sprite);
  if (reg.a !== 0) return CODE_B8B658();
  w16(R.held_rope_sprite_temp, 0);
  CODE_B8B64C();
}
/** $B8B658 */
export function CODE_B8B658() {
  reg.c = true;
}

/** $B8B65A — carry set when standing on a sticky honey floor. */
export function CODE_B8B65A() {
  const x = cur();
  reg.x = x;
  reg.a = sr(x, S.terrain_interaction) & 0x0101;
  if (reg.a === 0x0101) return CODE_B8B668();
  CODE_B8B666();
}
/** $B8B666 */
export function CODE_B8B666() {
  reg.c = false;
}
/** $B8B668 */
export function CODE_B8B668() {
  reg.a = sr(reg.x, S.terrain_attributes) & 0x0200;
  if (reg.a === 0) return CODE_B8B666();
  reg.c = true;
}

/** $B8B671 — carry set when touching a sticky honey wall in front of the kong. */
export function CODE_B8B671() {
  const x = cur();
  reg.x = x;
  reg.a = sr(x, S.terrain_interaction) & 0x0002;
  if (!reg.a) return CODE_B8B6A1();
  reg.a = sr(x, S.oam_property) & 0x4000;
  if (reg.a) {
    reg.a = 0xffff;
    return CODE_B8B689();
  }
  CODE_B8B686();
}
/** $B8B686 */
export function CODE_B8B686() {
  reg.a = 0x0001;
  CODE_B8B689();
}
/** $B8B689 */
export function CODE_B8B689() {
  reg.a = (reg.a + sr(reg.x, S.x_position)) & 0xffff;
  get_sprite_terrain_info_y_origin_0();
  CODE_B8D484();
  reg.a = (reg.a - sr(reg.x, S.y_position)) & 0xffff;
  if (!(reg.a & 0x8000)) return CODE_B8B6A1();
  reg.a = r16(0xac) & 0x0200;
  if (reg.a === 0) return CODE_B8B6A1();
  reg.c = true;
}
/** $B8B6A1 */
export function CODE_B8B6A1() {
  reg.c = false;
}

/** $B8B6A3 */
export function check_sprite_underwater_global() {
  check_sprite_underwater();
}
/** $B8B6A7 — A = 0 (no water / above it), 1 (at the surface), 2 (underwater). */
export function check_sprite_underwater() {
  const x = cur();
  reg.x = x;
  const water = r16(R.water_y_position);
  if (water & 0x8000) {
    reg.a = 0;
    return;
  }
  const d = (water - sr(x, S.y_position)) & 0xffff;
  if (mi(d, 0xffec)) reg.a = 2;
  else if (pl(d, 0xfff8)) reg.a = 1;
  else reg.a = 0;
}

/** $B8B6C7 */
export function set_swim_gravity_and_y_speed() {
  const ctrl = r16(R.current_kong_control_variables);
  w16(ctrl + K.gravity_force, spriteConst(0x76));
  reg.a = spriteConst(0x78);
  w16(ctrl + K.max_fall_speed, reg.a);
  reg.y = ctrl;
}
/** $B8B6DC */
export function set_swimming_state_global() {
  set_swimming_state();
}
/** $B8B6E0 */
export function set_swimming_state() {
  set_swim_gravity_and_y_speed();
  const x = cur();
  reg.x = x;
  if (r16(R.animal_type) === C.sprite_enguarde) {
    // .is_enguarde: dive in at a quarter of the speed
    sw(x, S.y_speed, asr(sr(x, S.y_speed), 2));
    sw(x, S.max_y_speed, 0);
    sw(x, S.state, C.kong_state_50);
    reg.a = 0x5e;
    set_anim_handle_animal_and_dixie();
    return;
  }
  sw(x, S.state, C.kong_state_3D);
  reg.a = 0x43;
  set_anim_handle_dixie();
}

/** $B8B714 — levels with effect $C0: tile checks on a delay ($09A1) for ledge/rope grabbing. */
export function CODE_B8B714() {
  reg.a = r16(level.effects) & 0x00c0;
  if (!reg.a) return CODE_B8B729();
  check_if_animal_or_holding_sprite();
  if (reg.c) return CODE_B8B729();
  reg.a = r16(0x09a1);
  if (reg.a === 0) return CODE_B8B72A();
  w16(0x09a1, reg.a - 1);
  CODE_B8B729();
}
/** $B8B729 */
export function CODE_B8B729() {}
/** $B8B72A */
export function CODE_B8B72A() {
  const x = cur();
  reg.x = x;
  w16(0x76, sr(x, S.terrain_attributes));
  CODE_B8D3E2();
  if (!reg.c) return CODE_B8B750();
  if (!reg.z) return CODE_B8B77B();
  reg.a = C.player_interaction_12;
  set_player_interaction_global();
  if (reg.c) return CODE_B8B729();
  w16(R.interaction_RAM_0A86, 0);
  reg.a = r16(0xae);
  w16(R.interaction_RAM_0A88, reg.a);
}
/** $B8B749 */
export function CODE_B8B749() {
  reg.x = cur();
  reg.a = r16(0x76);
  sw(reg.x, S.terrain_attributes, reg.a);
}
/** $B8B750 — entered with Z from CODE_B8D3E2. */
export function CODE_B8B750() {
  if (reg.z) return CODE_B8B749();
  reg.a = sr(reg.x, S.y_speed);
  if (!(reg.a & 0x8000)) return CODE_B8B749();
  CODE_B8B7A0();
  const x = cur();
  reg.x = x;
  reg.a = (sr(x, S.y_position) - r16(0x5e)) & 0xffff;
  if (reg.a & 0x8000) return CODE_B8B729();
  if (pl(reg.a, 0x0014)) return CODE_B8B729();
  reg.a = C.player_interaction_12;
  set_player_interaction_global();
  if (reg.c) return CODE_B8B729();
  w16(R.interaction_RAM_0A86, r16(0x5e));
  reg.a = r16(0x52);
  w16(R.interaction_RAM_0A88, reg.a);
}
/** $B8B77B */
export function CODE_B8B77B() {
  const x = cur();
  reg.x = x;
  reg.a = sr(x, S.state);
  if (reg.a === 0x6e) return CODE_B8B792();
  reg.a = C.player_interaction_11;
  set_player_interaction_global();
  if (reg.c) return CODE_B8B792();
  reg.a = r16(0x5e);
  w16(R.interaction_RAM_0A86, reg.a);
}
/** $B8B792 */
export function CODE_B8B792() {}

registerRts({
  record_highest_y_position, CODE_B8B530, handle_player_pit_death, CODE_B8B56E, CODE_B8B584,
  CODE_B8B586, CODE_B8B597, CODE_B8B5A6, CODE_B8B5A7, CODE_B8B5B7, CODE_B8B5C3, CODE_B8B5DA,
  CODE_B8B5E3, CODE_B8B5F1, CODE_B8B5F2, CODE_B8B600, CODE_B8B609, CODE_B8B60F, CODE_B8B615,
  CODE_B8B62B, CODE_B8B62D, CODE_B8B644, CODE_B8B64C, CODE_B8B64E, CODE_B8B658, CODE_B8B65A,
  CODE_B8B666, CODE_B8B668, CODE_B8B671, CODE_B8B686, CODE_B8B689, CODE_B8B6A1,
  check_sprite_underwater, set_swim_gravity_and_y_speed, set_swimming_state, CODE_B8B714,
  CODE_B8B729, CODE_B8B72A, CODE_B8B749, CODE_B8B750, CODE_B8B77B, CODE_B8B792,
});
registerRtl({ check_sprite_underwater_global, set_swimming_state_global });
