/**
 * Bank $B8 — carrying helpers, homing velocity helpers, the slope-steepness check that makes a
 * kong slide or fall, and the generic "start falling" state selection ($B8B793-$B8B9BB).
 */
import { r16, w16 } from "../../core/mem";
import { reg } from "../../core/cpu";
import { R, C, sprite as S, kong_control as K } from "../../core/sym";
import { xba } from "../../core/ops";
import { pl, mi, neg, spriteConst, cur, sw, sr, registerRts, registerRtl } from "./b8b_common";
import { get_sprite_terrain_info_define_y } from "./b8b_common";
import { set_anim_handle_dixie, set_anim_handle_animal_and_dixie } from "../../gen/routines";

/** $B8B793 — carry set when riding an animal or holding something. */
export function check_if_animal_or_holding_sprite() {
  reg.a = r16(R.animal_type);
  if (reg.a) {
    reg.c = true;
    return;
  }
  reg.a = r16(R.current_held_sprite);
  reg.c = reg.a !== 0;
}

/** $B8B7A0 — scan up to $28 pixels down from y-$28 while the tile has attribute $1000; $5E = last y, $52 = last attributes. */
export function CODE_B8B7A0() {
  w16(0x52, 0);
  w16(0x60, 0x28);
  const x = cur();
  reg.x = x;
  w16(0x5e, sr(x, S.y_position) - 0x28);
  CODE_B8B7B1();
}
/** $B8B7B1 */
export function CODE_B8B7B1() {
  for (;;) {
    w16(0x5e, r16(0x5e) + 1);
    reg.a = r16(0x5e);
    get_sprite_terrain_info_define_y();
    reg.a = r16(0xae) & 0x1000;
    if (!reg.a) return CODE_B8B7C8();
    reg.a = r16(0xae);
    w16(0x52, reg.a);
    const n = (r16(0x60) - 1) & 0xffff;
    w16(0x60, n);
    if (n === 0) return CODE_B8B7C8();
  }
}
/** $B8B7C8 */
export function CODE_B8B7C8() {}

/** $B8B7C9 — x speed towards $0D66: 16x the distance ($34 = |distance|, $32 = signed distance). */
export function CODE_B8B7C9() {
  const x = cur();
  reg.x = x;
  reg.a = (r16(0x0d66) - sr(x, S.x_position)) & 0xffff;
  w16(0x32, reg.a);
  if (reg.a === 0) return CODE_B8B7ED();
  if (!(reg.a & 0x8000)) return CODE_B8B7E7();
  reg.a = neg(reg.a);
  w16(0x34, reg.a);
  reg.a = neg((reg.a << 4) & 0xffff);
  CODE_B8B7ED();
}
/** $B8B7E7 */
export function CODE_B8B7E7() {
  w16(0x34, reg.a);
  reg.a = (reg.a << 4) & 0xffff;
  CODE_B8B7ED();
}
/** $B8B7ED */
export function CODE_B8B7ED() {
  sw(reg.x, S.x_speed, reg.a);
}

/** $B8B7F0 */
export function CODE_B8B7F0() {
  CODE_B8B7F4();
}
/** $B8B7F4 — when holding something, place the inactive kong at the hold offset in front of the active kong. */
export function CODE_B8B7F4() {
  reg.a = r16(R.current_held_sprite);
  if (reg.a === 0) return CODE_B8B830();
  reg.y = r16(R.inactive_kong_sprite);
  reg.x = r16(R.active_kong_sprite);
  reg.a = r16(R.held_sprite_x_offset);
  if (sr(reg.x, S.oam_property) & 0x4000) reg.a = neg(reg.a);
  CODE_B8B80A();
}
/** $B8B80A */
export function CODE_B8B80A() {
  const x = reg.x;
  const y = reg.y;
  sw(y, S.x_position, reg.a + sr(x, S.x_position));
  sw(y, S.y_position, sr(x, S.y_position) + r16(R.held_sprite_y_offset));
  const order = sr(x, S.render_order) + r16(0x0d80);
  sw(y, S.render_order, order);
  reg.c = order > 0xffff;
  const prop = sr(y, S.oam_property);
  reg.a = ((sr(x, S.oam_property) ^ prop) & 0x4000) ^ prop;
  sw(y, S.oam_property, reg.a);
  CODE_B8B830();
}
/** $B8B830 */
export function CODE_B8B830() {}

/** $B8B831 — the kong respawns / reappears (state $13). */
export function CODE_B8B831() {
  reg.x = cur();
  CODE_B8B833();
}
/** $B8B833 */
export function CODE_B8B833() {
  const x = reg.x;
  sw(x, S.state, 0x13);
  sw(x, S.current_graphic, 0);
  sw(x, S.last_rendered_graphic, 0);
  sw(x, S.interaction_flags, 0);
  reg.a = 0x13;
}
/** $B8B83F */
export function CODE_B8B83F() {
  CODE_B8B833();
}

/** $B8B843 — speeds towards the point ($0D66, $0D6A). */
export function CODE_B8B843() {
  const x = cur();
  reg.x = x;
  reg.y = r16(R.current_kong_control_variables);
  reg.a = (r16(0x0d66) - sr(x, S.x_position)) & 0xffff;
  CODE_B8B863();
  sw(x, S.x_speed, reg.a);
  reg.a = (r16(0x0d6a) - sr(x, S.y_position)) & 0xffff;
  CODE_B8B863();
  sw(x, S.y_speed, reg.a);
}
/** $B8B85E */
export function CODE_B8B85E() {
  reg.a = 0x4000;
  CODE_B8B881();
}
/**
 * $B8B863 — speed for a signed distance A: 16x the distance, at least $300; distances under 4
 * give distance*256 (XBA); 128 or more give the maximum $4000.
 */
export function CODE_B8B863() {
  if (reg.a === 0) return CODE_B8B8AA();
  if (!(reg.a & 0x8000)) return CODE_B8B893();
  reg.a = neg(reg.a);
  if (pl(reg.a, 0x0080)) return CODE_B8B85E();
  if (mi(reg.a, 0x0004)) return CODE_B8B886();
  reg.a = (reg.a << 4) & 0xffff;
  if (!pl(reg.a, 0x0300)) reg.a = 0x0300;
  CODE_B8B881();
}
/** $B8B881 */
export function CODE_B8B881() {
  reg.a = neg(reg.a);
}
/** $B8B886 */
export function CODE_B8B886() {
  reg.a = neg(xba(reg.a));
}
/** $B8B88C */
export function CODE_B8B88C() {
  reg.a = xba(reg.a);
}
/** $B8B88E */
export function CODE_B8B88E() {
  reg.a = 0x4000;
  CODE_B8B8A9();
}
/** $B8B893 */
export function CODE_B8B893() {
  if (pl(reg.a, 0x0080)) return CODE_B8B88E();
  if (mi(reg.a, 0x0004)) return CODE_B8B88C();
  reg.a = (reg.a << 4) & 0xffff;
  if (!pl(reg.a, 0x0300)) reg.a = 0x0300;
  CODE_B8B8A9();
}
/** $B8B8A9 */
export function CODE_B8B8A9() {}
/** $B8B8AA */
export function CODE_B8B8AA() {}

/** $B8B8AB — reset the roll gravity delay when in the air or on a steep (type 6) slope. */
export function CODE_B8B8AB() {
  const x = cur();
  reg.x = x;
  reg.a = sr(x, S.terrain_attributes) & 0x0007;
  reg.c = reg.a >= 0x0006;
  if (reg.a !== 0x0006) {
    reg.a = sr(x, S.ground_y_position);
    if (!(reg.a & 0x8000)) {
      reg.a = (reg.a - sr(x, S.y_position)) & 0xffff;
      reg.c = reg.a >= 0x0004;
      if (mi(reg.a, 0x0004)) return;
    }
    // .CODE_B8B8C4
    reg.a = sr(x, S.terrain_interaction) & 0x0101;
    reg.c = reg.a >= 0x0100;
    if (reg.a !== 0x0100) return;
  }
  // .CODE_B8B8CF
  reg.y = 0x32;
  reg.a = spriteConst(0x32);
  reg.y = r16(R.current_kong_control_variables);
  w16(reg.y + K.roll_gravity_delay, reg.a);
}

/** $B8B8DA — fall when the ground is too far below; slide when standing on a slope as steep as $88. */
export function handle_player_slope_state_and_anim() {
  const x = cur();
  reg.x = x;
  reg.a = sr(x, S.animation_flags) & 0x0001;
  if (reg.a) return;
  reg.a = sr(x, S.ground_y_position);
  if (reg.a & 0x8000) return start_player_faster_falling();
  reg.a = (reg.a - sr(x, S.y_position)) & 0xffff;
  if (pl(reg.a, 0x0004)) return start_player_faster_falling();
  reg.a = sr(x, S.terrain_interaction) & 0x0011;
  if (reg.a !== 0x0001) return;
  // .on_ground: is the slope too steep?
  reg.a = sr(x, S.terrain_attributes) & 0x0007;
  if (reg.a !== r16(0x88)) return;
  // .too_steep: face down the slope and slide
  const prop = sr(x, S.oam_property);
  sw(x, S.oam_property, ((((~sr(x, S.terrain_attributes)) & 0xffff) >> 1 ^ prop) & 0x4000) ^ prop);
  sw(x, S.y_speed, 0x0800);
  reg.a = r16(R.current_held_sprite);
  if (reg.a) {
    if (reg.a === r16(R.inactive_kong_sprite)) {
      sw(x, S.state, 0x1a);
      reg.a = 0x23;
    } else {
      sw(x, S.state, 0x0d);
      reg.a = 0x17;
    }
    return set_anim_handle_dixie();
  }
  reg.a = r16(R.animal_type);
  if (reg.a) {
    sw(x, S.state, 0x0a);
    reg.a = 0x77;
    return set_anim_handle_animal_and_dixie();
  }
  sw(x, S.state, 0x14);
  reg.a = 0x1a;
  set_anim_handle_dixie();
}

/** $B8B95B — X = kong: start falling with an initial downward speed. */
export function start_player_faster_falling() {
  sw(reg.x, S.y_speed, 0x0100);
  start_player_falling();
}
/** $B8B960 — X = kong: pick the falling state for its situation (normal, animal, carrying, team-up). */
export function start_player_falling() {
  const x = reg.x;
  reg.a = r16(R.current_held_sprite);
  if (reg.a) {
    if (reg.a === r16(R.inactive_kong_sprite)) {
      sw(x, S.state, 0x1a);
      reg.a = 0x23;
    } else {
      sw(x, S.state, 0x0d);
      reg.a = 0x17;
    }
    return set_anim_handle_dixie();
  }
  reg.a = r16(R.animal_type);
  if (reg.a) {
    sw(x, S.state, reg.a === C.sprite_squawks ? 0x10 : 0x0a);
    reg.a = 0x77;
    return set_anim_handle_animal_and_dixie();
  }
  sw(x, S.state, 0x01);
  reg.a = 0x07;
  set_anim_handle_dixie();
}
/** $B8B9B4 */
export function start_player_faster_falling_global() {
  start_player_faster_falling();
}
/** $B8B9B8 */
export function start_player_falling_global() {
  start_player_falling();
}

registerRts({
  check_if_animal_or_holding_sprite, CODE_B8B7A0, CODE_B8B7B1, CODE_B8B7C8, CODE_B8B7C9,
  CODE_B8B7E7, CODE_B8B7ED, CODE_B8B7F4, CODE_B8B80A, CODE_B8B830, CODE_B8B831, CODE_B8B833,
  CODE_B8B843, CODE_B8B85E, CODE_B8B863, CODE_B8B881, CODE_B8B886, CODE_B8B88C, CODE_B8B88E,
  CODE_B8B893, CODE_B8B8A9, CODE_B8B8AA, CODE_B8B8AB, handle_player_slope_state_and_anim,
  start_player_faster_falling, start_player_falling,
});
registerRtl({ CODE_B8B7F0, CODE_B8B83F, start_player_faster_falling_global, start_player_falling_global });
