/**
 * Bank $B3 — barrel cannons and the kongs ($B3EEB9-$B3F2A5, $B3F33E-$B3F4D7): entering a
 * barrel (collision + player interactions $10/$0F), parking the kongs inside, launching the
 * kong along the barrel's angle, the camera offsets while inside, moving barrels along their
 * paths, and the sine table helpers.
 */
import { r8, r16, w16, rom16, io8, io16, ioR16 } from "../../core/mem";
import { reg } from "../../core/cpu";
import { adc16, sbc16, flags } from "../../core/ops";
import { L, R, C, CPU, sprite as S, kong_control as K } from "../../core/sym";
import {
  get_current_sprite_clipping, set_player_interaction_global, CODE_BCFEC8, CODE_BCFEE0, CODE_B3A334,
  work_on_active_kong_global, drop_sprite_if_holding_global, spawn_special_sprite_index,
  work_on_inactive_kong_global, CODE_B8A57C, set_player_terminal_velocity_global,
  set_player_normal_gravity_global, CODE_B8D8D1, set_anim_handle_dixie, init_player_clipping,
  set_anim_handle_animal_and_dixie, set_riding_kong_anim_handle_dixie, CODE_B8B7F0, CODE_BBB2D1,
} from "../../gen/routines";
import { CODE_B3DF3C } from "./b3d_timer";
import {
  cur, sr, sw, mi, neg, asr, merge, registerRts, registerRtl, jslIndirect,
} from "./b3d_common";

const LAUNCH_FRAMES = L("launch_barrel_rotation_frames");
const SINE = L("DATA_B3F4D8");

/** $B3EEB9 — carry set when a kong enters the barrel this frame. */
export function CODE_B3EEB9() {
  const x = cur();
  reg.x = x;
  if (!(sr(x, S.max_y_speed) & 0x0800)) return CODE_B3EF81();
  CODE_B3EEC5();
}
/** $B3EEC5 */
export function CODE_B3EEC5() {
  const i = r16(R.inactive_kong_sprite);
  reg.x = i;
  if (sr(i, S.state) === C.kong_state_2F) return CODE_B3EF46();
  get_current_sprite_clipping();
  reg.a = 0x0008;
  jslIndirect(R.sprite_collision_routine_address);
  CODE_B3EEDD();
}
/** $B3EEDD — which kong may use this barrel ($46 bits 0-1: 1 = Diddy only, 2 = Dixie only, 3 = none). */
export function CODE_B3EEDD() {
  if (!reg.c) return CODE_B3EF44();
  if (!(r16(R.sprite_collision_result) & 0x0406)) return CODE_B3EF44();
  const x = cur();
  reg.x = x;
  const who = sr(x, 0x46) & 3;
  if (who === 0) return CODE_B3EF0E();
  if (who === 3) return CODE_B3EF44();
  const y = r16(R.colliding_sprite);
  reg.y = y;
  if (who & 1) return CODE_B3EF06();
  if (sr(y, S.type) !== C.sprite_dixie_kong) return CODE_B3EF0E();
  CODE_B3EF44();
}
/** $B3EF06 */
export function CODE_B3EF06() {
  if (sr(reg.y, S.type) === C.sprite_diddy_kong) return CODE_B3EF44();
  CODE_B3EF0E();
}
/** $B3EF0E */
export function CODE_B3EF0E() {
  if (r16(R.colliding_sprite) === r16(R.inactive_kong_sprite)) return CODE_B3EF6A();
  CODE_B3EF15();
}
/** $B3EF15 — the active kong enters: interaction $10 with callback CODE_B3EF84. */
export function CODE_B3EF15() {
  reg.a = C.player_interaction_10;
  set_player_interaction_global();
  if (reg.c) return CODE_B3EF44();
  const cb = L("CODE_B3EF84");
  w16(R.interaction_RAM_0A8A, cb & 0xffff);
  w16(R.interaction_RAM_0A8C, cb >> 16);
  CODE_B3EF2A();
}
/** $B3EF2A — contact flash between the kong and the barrel. */
export function CODE_B3EF2A() {
  CODE_BCFEC8();
  CODE_BCFEE0();
  CODE_B3A334();
  w16(R.interaction_RAM_0A86, r16(R.contact_flash_x_position));
  reg.a = r16(R.contact_flash_y_position);
  w16(R.interaction_RAM_0A88, reg.a);
  reg.c = true;
}
/** $B3EF44 */
export function CODE_B3EF44() {
  reg.c = false;
}
/** $B3EF46 — the inactive kong was thrown into this barrel (state $2F, $42 = barrel). */
export function CODE_B3EF46() {
  const i = r16(R.inactive_kong_sprite);
  reg.x = i;
  if (sr(i, 0x42) !== r16(R.current_sprite)) return CODE_B3EF44();
  get_current_sprite_clipping();
  reg.a = 0x0008;
  jslIndirect(R.sprite_collision_routine_address);
  CODE_B3EF5D();
}
/** $B3EF5D */
export function CODE_B3EF5D() {
  if (!reg.c) return CODE_B3EF44();
  if (!(r16(R.sprite_collision_result) & 0x0406)) return CODE_B3EF44();
  CODE_B3EF15();
}
/** $B3EF6A — the inactive kong touches it: interaction $0F with callback CODE_B3F069. */
export function CODE_B3EF6A() {
  reg.a = C.player_interaction_0F;
  set_player_interaction_global();
  if (reg.c) return CODE_B3EF44();
  const cb = L("CODE_B3F069");
  w16(R.interaction_RAM_0A8A, cb & 0xffff);
  w16(R.interaction_RAM_0A8C, cb >> 16);
  CODE_B3EF2A();
}
/** $B3EF81 */
export function CODE_B3EF81() {
  CODE_B3EF44();
}

/** $B3EF84 — interaction callback: the active kong goes inside the barrel (kong state $11). */
export function CODE_B3EF84() {
  work_on_active_kong_global();
  drop_sprite_if_holding_global();
  w16(r16(R.active_kong_control_variables) + K.flash_timer, 0);
  w16(R.contact_flash_x_position, r16(R.interaction_RAM_0A86));
  w16(R.contact_flash_y_position, r16(R.interaction_RAM_0A88));
  reg.y = C.special_sprite_spawn_id_0034; // contact flash
  spawn_special_sprite_index();
  w16(R.current_sprite, r16(R.current_interacting_sprite));
  move_kong_to_sprite_position();
  const k = r16(R.active_kong_sprite);
  sw(k, S.state, 0x11);
  const f = sr(k, S.interaction_flags);
  w16(R.RAM_0A3C, f);
  // (the same value is stored into the defeat flags, speeds and terrain bits)
  sw(k, S.carry_or_defeat_flags, f);
  sw(k, S.x_speed, f);
  sw(k, S.max_x_speed, f);
  sw(k, S.y_speed, f);
  sw(k, S.terrain_interaction, f);
  sw(k, S.animation_flags, 0);
  CODE_B3F0B8();
  CODE_B3DF3C();
  const x = reg.x;
  sw(x, S.state, 2);
  sw(x, S.max_y_speed, (sr(x, S.max_y_speed) & 0xdfff) | 0x1000);
  CODE_B3F01D();
  sw(cur(), S.animation_timer, 1);
  if (!(r16(R.game_state_flags) & 0x4000)) return CODE_B3F015();
  const y = r16(R.inactive_kong_sprite);
  reg.y = y;
  if (sr(y, S.state) === C.kong_state_2F) return CODE_B3F016();
  if (r16(R.animal_type) !== 0 && r16(R.current_player_mount) === 0) return CODE_B3F015();
  CODE_B3F00F();
}
/** $B3F00F — the follower kong hides too. */
export function CODE_B3F00F() {
  reg.a = C.kong_state_32;
  sw(reg.y, S.state, reg.a);
  CODE_B3F015();
}
/** $B3F015 */
export function CODE_B3F015() {}
/** $B3F016 */
export function CODE_B3F016() {
  reg.a = C.kong_state_31;
  sw(reg.y, S.state, reg.a);
}

/** $B3F01D — camera offsets while inside barrel X. */
export function CODE_B3F01D() {
  const x = reg.x;
  if (sr(x, 0x36) !== 0) return CODE_B3F033();
  if (sr(x, 0x46) & 0x0800) {
    reg.a = sr(x, 0x42);
    CODE_B3F111();
    return CODE_B3F032();
  }
  CODE_B3F02F();
}
/** $B3F02F */
export function CODE_B3F02F() {
  CODE_B3F0F4();
  CODE_B3F032();
}
/** $B3F032 */
export function CODE_B3F032() {}
/** $B3F033 — explicit camera offsets from $36 (low byte: x, high byte: y). */
export function CODE_B3F033() {
  const x = reg.x;
  w16(R.temp_32, r16(0x0af0) >> 1);
  w16(0x0af2, (sr(x, 0x36) & 0xff00) + 0x3c00 - r16(R.temp_32));
  w16(R.temp_32, r16(0x0aea) >> 1);
  reg.a = (((sr(x, 0x36) << 8) & 0xff00) + 0x4000 - r16(R.temp_32)) & 0xffff;
  w16(0x0aee, reg.a);
}

/** $B3F069 — interaction callback: the inactive kong goes into the barrel (state $2F). */
export function CODE_B3F069() {
  w16(R.contact_flash_x_position, r16(R.interaction_RAM_0A86));
  w16(R.contact_flash_y_position, r16(R.interaction_RAM_0A88));
  reg.y = C.special_sprite_spawn_id_0034;
  spawn_special_sprite_index();
  work_on_inactive_kong_global();
  const x = r16(R.inactive_kong_sprite);
  sw(x, S.state, C.kong_state_2F);
  const barrel = r16(R.current_interacting_sprite);
  sw(x, 0x42, barrel);
  sw(x, S.x_position, sr(barrel, S.x_position));
  sw(x, S.y_position, sr(barrel, S.y_position));
  for (const f of [S.interaction_flags, S.carry_or_defeat_flags, S.x_speed, S.max_x_speed, S.y_speed,
    S.terrain_interaction, S.current_graphic, S.last_rendered_graphic, S.animation_flags]) sw(x, f, 0);
  w16(R.current_sprite, barrel);
  reg.x = barrel;
  CODE_B3F01D();
  work_on_active_kong_global();
  CODE_B8A57C();
}

/** $B3F0B8 — hide the kong (and its animal / carried partner) inside the barrel. */
export function CODE_B3F0B8() {
  const x = r16(R.active_kong_sprite);
  reg.x = x;
  sw(x, S.current_graphic, rom16(LAUNCH_FRAMES));
  sw(x, S.last_rendered_graphic, 0);
  sw(x, S.display_mode, 0xc000);
  sw(x, S.interaction_flags, 0x0010);
  const mount = r16(R.current_player_mount);
  reg.a = mount;
  if (mount) {
    reg.y = mount;
    reg.a = 0;
    sw(mount, S.current_graphic, 0);
    sw(mount, S.last_rendered_graphic, 0);
    sw(mount, S.animation_speed, 0);
  }
  CODE_B3F0DE();
}
/** $B3F0DE */
export function CODE_B3F0DE() {
  reg.a = r16(R.inactive_kong_sprite);
  if (reg.a === r16(R.current_held_sprite)) {
    reg.y = reg.a;
    reg.a = 0;
    sw(reg.y, S.current_graphic, 0);
    sw(reg.y, S.last_rendered_graphic, 0);
    sw(reg.y, S.animation_speed, 0);
  }
  CODE_B3F0F3();
}
/** $B3F0F3 */
export function CODE_B3F0F3() {}

/** $B3F0F4 — default camera offsets (centred). */
export function CODE_B3F0F4() {
  w16(0x0aee, asr(0x8000 - r16(0x0aea), 1));
  reg.a = asr(0x7800 - r16(0x0af0), 1);
  w16(0x0af2, reg.a);
}

/** $B3F111 — A high byte = angle: camera offsets looking along the barrel's direction. */
export function CODE_B3F111() {
  const angle = (reg.a >> 8) & 0xff;
  reg.a = angle;
  CODE_B3F4C0();
  w16(0x0aee, asr(((neg(reg.a) << 6) + 0x8000 - r16(0x0aea)) & 0xffff, 1));
  reg.a = angle;
  CODE_B3F4CA();
  reg.a = asr(((reg.a << 6) + 0x7800 - r16(0x0af0)) & 0xffff, 1);
  w16(0x0af2, reg.a);
}

/** $B3F14C — put the active kong at the current sprite's position. */
export function move_kong_to_sprite_position() {
  const x = cur();
  const y = r16(R.active_kong_sprite);
  reg.x = x;
  reg.y = y;
  sw(y, S.x_position, sr(x, S.x_position));
  reg.a = sr(x, S.y_position);
  sw(y, S.y_position, reg.a);
}

/**
 * $B3F15C — launch velocity: speed ($2C low byte) times sin/cos of the barrel rotation ($48),
 * rounded to 8 or 16 directions ($46 bit 4 of the high byte).
 */
export function CODE_B3F15C() {
  const x = cur();
  const y = r16(R.active_kong_sprite);
  reg.y = y;
  w16(R.temp_26, sr(x, 0x48));
  w16(R.temp_5E, (sr(x, S.unknown_2C) << 8) & 0xff00);
  const mask = (((((sr(x, 0x46) >> 8) | (sr(x, 0x46) << 8)) << 2) ^ 0xffff) & 0x1000) ^ 0xf000;
  w16(R.temp_60, mask);
  const rot = ((((mask ^ 0xffff) >> 1) + sr(x, 0x48)) & mask) & 0xffff;
  sw(x, 0x48, rot);
  w16(R.temp_60, ((rot >> 8) | (rot << 8)) & 0xffff);
  reg.a = r16(R.temp_60);
  CODE_B3F4B8();
  CODE_B3F1C9();
  sw(y, S.x_speed, reg.a);
  sw(y, S.max_x_speed, reg.a);
  reg.x = cur();
  let a = r16(R.temp_26);
  if (a !== 0 && a !== 0x7fff) a ^= 0xffff;
  reg.a = a;
  CODE_B3F1A8();
}
/** $B3F1A8 — facing from the rotation, then the vertical speed. */
export function CODE_B3F1A8() {
  const y = reg.y;
  sw(y, S.oam_property, merge(sr(y, S.oam_property), reg.a >> 1, 0x4000));
  reg.a = r16(R.temp_60);
  CODE_B3F4BC();
  CODE_B3F1C9();
  reg.a = neg(reg.a);
  sw(y, S.y_speed, reg.a);
  sw(y, S.max_y_speed, reg.a);
}
/** $B3F1C9 — A = signed sine: (|A| * speed) / 4 with the sign kept, using the hardware multiplier. */
export function CODE_B3F1C9() {
  if (!(reg.a & 0x8000)) return CODE_B3F1E1();
  io16(CPU.multiply_A, (neg(reg.a) | r16(R.temp_5E)) & 0xffff);
  reg.a = neg(ioR16(CPU.multiply_result) >> 2);
}
/** $B3F1E1 */
export function CODE_B3F1E1() {
  io16(CPU.multiply_A, (reg.a | r16(R.temp_5E)) & 0xffff);
  reg.a = ioR16(CPU.multiply_result) >> 2;
}

/** $B3F1EF — JSL entry of CODE_B3F1F3. */
export function CODE_B3F1EF() {
  CODE_B3F1F3();
}
/** $B3F1F3 — CODE_B3F207 for the active kong, keeping the barrel's constants pointer. */
export function CODE_B3F1F3() {
  const x = cur();
  const saved46 = sr(x, 0x46);
  const savedConst = sr(x, S.constants_address);
  CODE_B3F207();
  sw(x, S.constants_address, savedConst);
  reg.a = saved46;
  reg.x = x;
  w16(R.current_sprite, x);
}
/** $B3F207 — set the kong flying out of the barrel (state $12), the follower trailing behind. */
export function CODE_B3F207() {
  const x = r16(R.active_kong_sprite);
  w16(R.current_sprite, x);
  const kc = r16(R.active_kong_control_variables);
  w16(R.current_kong_control_variables, kc);
  sw(x, S.max_x_speed, sr(x, S.x_speed));
  sw(x, 0x46, sr(x, S.x_speed));
  w16(R.current_sprite_constants, sr(x, S.constants_address));
  reg.x = x;
  reg.y = kc;
  set_player_terminal_velocity_global();
  set_player_normal_gravity_global();
  sw(reg.x, S.state, C.kong_state_12);
  if (r16(R.current_held_sprite) === r16(R.inactive_kong_sprite)) return CODE_B3F289();
  if (!(r16(R.game_state_flags) & 0x4000)) return CODE_B3F25F();
  if (r16(R.animal_type) !== 0 && r16(R.current_player_mount) === 0) return CODE_B3F25F();
  CODE_B3F240();
}
/** $B3F240 — the follower kong follows along (state $22). */
export function CODE_B3F240() {
  work_on_inactive_kong_global();
  sw(reg.x, S.state, C.kong_state_22);
  reg.a = 0x0001;
  reg.x = 0x001c;
  reg.y = 0x0000;
  CODE_B8D8D1();
  reg.x = cur();
  reg.a = 0x001c;
  set_anim_handle_dixie();
  CODE_B3F25F();
}
/** $B3F25F */
export function CODE_B3F25F() {
  work_on_active_kong_global();
  reg.a = r16(R.animal_type);
  CODE_B3F265();
}
/** $B3F265 — A = animal type: the flying animation. */
export function CODE_B3F265() {
  if (reg.a !== 0) return CODE_B3F273();
  reg.a = 0x0019;
  set_anim_handle_dixie();
  CODE_B3F26E();
}
/** $B3F26E */
export function CODE_B3F26E() {
  init_player_clipping();
}
/** $B3F273 */
export function CODE_B3F273() {
  reg.a = 0x0090;
  set_anim_handle_animal_and_dixie();
  const mount = r16(R.current_player_mount);
  if (mount) {
    w16(R.current_sprite, mount);
    reg.a = 0x004f;
    set_riding_kong_anim_handle_dixie();
  }
  CODE_B3F287();
}
/** $B3F287 */
export function CODE_B3F287() {
  CODE_B3F26E();
}
/** $B3F289 — the partner was being carried: it flies out too (state $18). */
export function CODE_B3F289() {
  reg.a = 0x0025;
  set_anim_handle_dixie();
  work_on_inactive_kong_global();
  sw(reg.x, S.state, C.kong_state_18);
  reg.a = 0x0020;
  set_anim_handle_dixie();
  CODE_B8B7F0();
  CODE_B3F26E();
}

// ---------------------------------------------------------------------------------------------
// Moving barrels: back and forth along a path ($4A/$4C position, $4E length, $52 speed)

/** $B3F33E — barrels with a path ($2A bit 14) move along it. */
export function CODE_B3F33E() {
  const x = cur();
  reg.x = x;
  if (sr(x, S.max_y_speed) & 0x4000) CODE_B3F348();
}
/** $B3F348 */
export function CODE_B3F348() {
  CODE_B3F396();
  const x = cur();
  reg.x = x;
  const f = sr(x, 0x46);
  if (f & 0x0080) {
    reg.a = sr(x, 0x4c);
    if (f & 0x0200) return CODE_B3F35F();
    CODE_B3F365();
  }
  CODE_B3F36A();
}
/** $B3F35F */
export function CODE_B3F35F() {
  reg.a = neg(sr(reg.x, 0x4c));
  CODE_B3F365();
  CODE_B3F36A();
}
/** $B3F365 */
export function CODE_B3F365() {
  reg.a = (reg.a + sr(reg.x, S.x_sub_position)) & 0xffff;
  sw(reg.x, S.x_position, reg.a);
}
/** $B3F36A */
export function CODE_B3F36A() {
  const x = reg.x;
  const f = sr(x, 0x46);
  if (!(f & 0x0100)) return CODE_B3F387();
  if (f & 0x0400) return CODE_B3F37C();
  reg.a = sr(x, 0x4c);
  CODE_B3F382();
}
/** $B3F37C */
export function CODE_B3F37C() {
  reg.a = neg(sr(reg.x, 0x4c));
  CODE_B3F382();
}
/** $B3F382 */
export function CODE_B3F382() {
  reg.a = (reg.a + sr(reg.x, S.y_sub_position)) & 0xffff;
  sw(reg.x, S.y_position, reg.a);
  CODE_B3F387();
}
/** $B3F387 */
export function CODE_B3F387() {}

/** $B3F396 — advance along the path, accelerating/decelerating around the middle and ends. */
export function CODE_B3F396() {
  const x = cur();
  reg.x = x;
  if (r16(x + 0x4e) >> 1 >= sr(x, 0x4c)) return CODE_B3F3B4();
  // second half: distance to the far end
  w16(R.temp_5E, 0x8000);
  const lo = sbc16(0xffff, sr(x, 0x4a), true);
  w16(R.temp_32, lo);
  w16(R.temp_34, sbc16(sr(x, 0x4e), sr(x, 0x4c), flags.c));
  CODE_B3F3BE();
}
/** $B3F3B4 */
export function CODE_B3F3B4() {
  const x = reg.x;
  w16(R.temp_5E, 0);
  w16(R.temp_32, sr(x, 0x4a));
  w16(R.temp_34, sr(x, 0x4c));
  CODE_B3F3BE();
}
/** $B3F3BE */
export function CODE_B3F3BE() {
  const x = reg.x;
  const speed = sr(x, 0x52);
  if (speed < r16(R.temp_34)) return CODE_B3F3FA();
  reg.y = speed;
  reg.a = r16(R.temp_33);
  reg.x = sr(x, 0x28);
  CODE_B3F431();
  CODE_B3F3CE();
}
/** $B3F3CE — temp_38/3A = step (16.16), at least $22. */
export function CODE_B3F3CE() {
  const x = cur();
  reg.x = x;
  if (mi(r16(R.temp_39), sr(x, 0x22))) w16(R.temp_39, sr(x, 0x22));
  CODE_B3F3DA();
}
/** $B3F3DA */
export function CODE_B3F3DA() {
  const x = cur();
  reg.x = x;
  if (sr(x, S.max_y_speed) & 0x8000) return CODE_B3F404();
  sw(x, 0x4a, adc16(r16(R.temp_38), sr(x, 0x4a), false));
  sw(x, 0x4c, adc16(r16(R.temp_3A), sr(x, 0x4c), flags.c));
  sbc16(0xffff, sr(x, 0x4a), true);
  reg.a = sbc16(sr(x, 0x4e), sr(x, 0x4c), flags.c);
  if (reg.a & 0x8000) return CODE_B3F422();
}
/** $B3F3FA — near the ends: step = $28 (minimum speed). */
export function CODE_B3F3FA() {
  const x = reg.x;
  w16(R.temp_38, 0);
  w16(R.temp_3A, 0);
  w16(R.temp_39, sr(x, 0x28));
  CODE_B3F3CE();
}
/** $B3F404 — moving back towards the start. */
export function CODE_B3F404() {
  const x = cur();
  reg.x = x;
  sw(x, 0x4a, sbc16(sr(x, 0x4a), r16(R.temp_38), true));
  reg.a = sbc16(sr(x, 0x4c), r16(R.temp_3A), flags.c);
  if (reg.a & 0x8000) return CODE_B3F416();
  sw(x, 0x4c, reg.a);
}
/** $B3F416 — reached the start: turn around. */
export function CODE_B3F416() {
  sw(reg.x, 0x4a, 0);
  sw(reg.x, 0x4c, 0);
  CODE_B3F41A();
}
/** $B3F41A */
export function CODE_B3F41A() {
  reg.a = sr(reg.x, S.max_y_speed) ^ 0x8000;
  sw(reg.x, S.max_y_speed, reg.a);
}
/** $B3F422 — reached the end: turn around. */
export function CODE_B3F422() {
  sw(reg.x, 0x4a, 0xffff);
  sw(reg.x, 0x4c, sr(reg.x, 0x4e));
  CODE_B3F41A();
}

/** $B3F42D — JSL entry of CODE_B3F437. */
export function CODE_B3F42D() {
  CODE_B3F437();
}
/** $B3F431 — step = distance ($32-$34) / CODE_BBB2D1's divisor, as 16.16 in temp_38/temp_3A. */
export function CODE_B3F431() {
  CODE_BBB2D1();
  w16(R.temp_36, reg.y);
  CODE_B3F437();
}
/**
 * $B3F437 — 24-bit by 8-bit long division with the hardware divider:
 * ($34:$33:$32) / byte $36 -> temp_3A (integer part, 16-bit) . temp_38 (16-bit fraction).
 */
export function CODE_B3F437() {
  w16(R.temp_37, 0);
  w16(R.temp_39, 0);
  w16(R.temp_3B, 0);
  const divide = (dividend: number) => {
    io16(CPU.dividen, dividend & 0xffff);
    io8(CPU.divisor, r8(R.temp_36));
    return ioR16(CPU.divide_result);
  };
  w16(R.temp_3A, divide(r16(R.temp_34)));
  let q = divide(merge(r16(R.temp_33), ioR16(CPU.divide_remainder) << 8, 0xff00));
  w16(R.temp_39, adc16(q, r16(R.temp_39), false));
  w16(R.temp_3B, adc16(0, r16(R.temp_3B), flags.c));
  q = divide(merge(r16(R.temp_32), ioR16(CPU.divide_remainder) << 8, 0xff00));
  w16(R.temp_38, adc16(q, r16(R.temp_38), false));
  reg.a = adc16(0, r16(R.temp_3A), flags.c);
  w16(R.temp_3A, reg.a);
}

/** $B3F4B8 — JSL entry of CODE_B3F4C0. */
export function CODE_B3F4B8() {
  CODE_B3F4C0();
}
/** $B3F4BC — JSL entry of CODE_B3F4CA. */
export function CODE_B3F4BC() {
  CODE_B3F4CA();
}
/** $B3F4C0 — A = angle (0-255): sine, -$FF..$FF. */
export function CODE_B3F4C0() {
  reg.x = (reg.a & 0xff) << 1;
  reg.a = rom16(SINE + reg.x);
  reg.n = (reg.a & 0x8000) !== 0;
  reg.z = reg.a === 0;
}
/** $B3F4CA — A = angle: cosine (sine of angle + 64). */
export function CODE_B3F4CA() {
  reg.x = ((reg.a + 0x40) & 0xff) << 1;
  reg.a = rom16(SINE + reg.x);
  reg.n = (reg.a & 0x8000) !== 0;
  reg.z = reg.a === 0;
}

registerRts({
  CODE_B3EEB9, CODE_B3EEC5, CODE_B3EEDD, CODE_B3EF06, CODE_B3EF0E, CODE_B3EF15, CODE_B3EF2A,
  CODE_B3EF44, CODE_B3EF46, CODE_B3EF5D, CODE_B3EF6A, CODE_B3EF81, CODE_B3F01D, CODE_B3F02F,
  CODE_B3F032, CODE_B3F033, CODE_B3F0F4, CODE_B3F111, move_kong_to_sprite_position, CODE_B3F15C,
  CODE_B3F1A8, CODE_B3F1C9, CODE_B3F1E1, CODE_B3F1F3, CODE_B3F207, CODE_B3F240, CODE_B3F25F,
  CODE_B3F265, CODE_B3F26E, CODE_B3F273, CODE_B3F287, CODE_B3F289, CODE_B3F33E, CODE_B3F348,
  CODE_B3F35F, CODE_B3F365, CODE_B3F36A, CODE_B3F37C, CODE_B3F382, CODE_B3F387, CODE_B3F396,
  CODE_B3F3B4, CODE_B3F3BE, CODE_B3F3CE, CODE_B3F3DA, CODE_B3F3FA, CODE_B3F404, CODE_B3F416,
  CODE_B3F41A, CODE_B3F422, CODE_B3F431, CODE_B3F437, CODE_B3F4C0, CODE_B3F4CA,
});
registerRtl({
  CODE_B3EF84, CODE_B3F00F, CODE_B3F015, CODE_B3F016, CODE_B3F069, CODE_B3F0B8, CODE_B3F0DE,
  CODE_B3F0F3, CODE_B3F1EF, CODE_B3F42D, CODE_B3F4B8, CODE_B3F4BC,
});
