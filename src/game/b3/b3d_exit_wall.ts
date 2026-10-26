/**
 * Bank $B3 — breakable exit walls / bonus exit doors ($B3DF48-$B3E3AE).
 *
 * Wall variables: $42 destination level, $44 destination entrance, $46 side the wall is
 * entered from (0 = from the right), $48 y offset of the doorway. When the active kong walks
 * (or charges, as Rambi / Enguarde) into the wall, a player interaction ($2B) is queued with a
 * callback (CODE_B3E1E2 / CODE_B3E2F4) that sets the kong walking off through the exit and
 * records the destination.
 */
import { r16, w16, rom16 } from "../../core/mem";
import { reg, callPtr } from "../../core/cpu";
import { L, R, C, sprite as S, kong_control as K, level } from "../../core/sym";
import {
  set_player_interaction_global, get_current_sprite_clipping, check_active_kong_collision,
  delete_sprite_force_deallocation, queue_sound_effect, work_on_active_kong_global,
  drop_sprite_or_follower_kong, enable_bullet_time_global, set_anim_once_handle_dixie,
  set_anim_handle_animal_and_dixie,
} from "../../gen/routines";
import {
  cur, sr, sw, mi, neg, abs16, merge, registerRts, registerRtl, registerSprite, spriteReturn, exitB3D916,
} from "./b3d_common";

const STATE_TABLE = L("DATA_B3DF51");
const KONG_STATE_FLAGS = L("kong_state_flags_table");
const RESET_START = L("RESET_start");

/** $B3DF48 — breakable exit wall main: dispatch on the state. */
export function breakable_exit_wall_sprite_code() {
  callPtr(0xb3, rom16(STATE_TABLE + ((sr(cur(), S.state) << 1) & 0xffff)));
}

/**
 * $B3DF5F — states 0 and 2: become invisible and go to the next state. Also an anti-piracy
 * check: the reset routine ($8083F7, $1E8 bytes) is folded with EOR/ROR; if it was patched the
 * wall's destination is destroyed ($FFFF, back to the map). Always passes in the port.
 */
export function CODE_B3DF5F() {
  const x = cur();
  sw(x, S.state, sr(x, S.state) + 1);
  sw(x, S.current_graphic, 0);
  sw(x, S.last_rendered_graphic, 0);
  // the fold of the genuine reset routine is $3354 ($3354 ^ $CCAB = $FFFF: passes). The port
  // runs without the original code, so the wall keeps its destination.
  CODE_B3DF88();
}
/** $B3DF88 — PLB / PLY of the check's stack frame: DB back to $B3, Y = $83F7. */
export function CODE_B3DF88() {
  reg.db = 0xb3;
  reg.y = RESET_START & 0xffff;
  exitB3D916();
}

/** $B3DF8D — state 1: wait for the kong to walk into the doorway. */
export function CODE_B3DF8D() {
  if (r16(level.type) !== C.small_level_type) return CODE_B3DF99();
  if (r16(R.animal_type) === 0) return CODE_B3DF9E();
  CODE_B3DF99();
}
/** $B3DF99 */
export function CODE_B3DF99() {
  CODE_B3E0C9();
  if (reg.c) return CODE_B3DFA1();
  CODE_B3DF9E();
}
/** $B3DF9E */
export function CODE_B3DF9E() {
  exitB3D916();
}
/** $B3DFA1 — queue the "walk through the exit" interaction with callback CODE_B3E1E2. */
export function CODE_B3DFA1() {
  reg.a = C.player_interaction_2B;
  set_player_interaction_global();
  if (reg.c) return CODE_B3DFBD();
  const cb = L("CODE_B3E1E2");
  w16(R.interaction_RAM_0A8A, cb & 0xffff);
  w16(R.interaction_RAM_0A8C, cb >> 16);
  sw(cur(), S.state, 4);
  CODE_B3DFBD();
}
/** $B3DFBD */
export function CODE_B3DFBD() {
  exitB3D916();
}

/** $B3DFC0 — state 3: exit taken by riding a skull cart (states $5B/$5C) or state $47. */
export function CODE_B3DFC0() {
  const y = r16(R.active_kong_sprite);
  const st = sr(y, S.state);
  if (st === C.kong_state_5B || st === C.kong_state_5C) return CODE_B3DFDD();
  if (st === C.kong_state_47 && sr(y, 0x42) === 0) return CODE_B3DFDD();
  CODE_B3DFDA();
}
/** $B3DFDA */
export function CODE_B3DFDA() {
  exitB3D916();
}
/** $B3DFDD */
export function CODE_B3DFDD() {
  reg.a = C.player_interaction_2B;
  set_player_interaction_global();
  if (reg.c) return CODE_B3DFF9();
  const cb = L("CODE_B3E2F4");
  w16(R.interaction_RAM_0A8A, cb & 0xffff);
  w16(R.interaction_RAM_0A8C, cb >> 16);
  sw(cur(), S.state, 4);
  CODE_B3DFF9();
}
/** $B3DFF9 */
export function CODE_B3DFF9() {
  exitB3D916();
}
/** $B3DFFC — state 4: exit in progress. */
export function CODE_B3DFFC() {
  exitB3D916();
}
/** $B3DFFF — state 5 */
export function CODE_B3DFFF() {
  const x = cur();
  sw(x, S.state, sr(x, S.state) + 1);
  exitB3D916();
}

/** $B3E006 — state 6: a breakable wall, smashed by a charging Rambi or Enguarde (or a thrown object). */
export function CODE_B3E006() {
  const x = cur();
  if (sr(x, S.carry_or_defeat_flags)) return CODE_B3E063();
  get_current_sprite_clipping();
  reg.a = 0x0008;
  check_active_kong_collision();
  if (!reg.c) return CODE_B3E060();
  const animal = r16(R.animal_type);
  if (animal === C.sprite_rambi || animal === C.sprite_enguarde) return CODE_B3E025();
  CODE_B3E060();
}
/** $B3E025 — the animal must hit the wall from the right side, fast enough. */
export function CODE_B3E025() {
  const x = cur();
  const y = r16(R.colliding_sprite);
  reg.x = x;
  reg.y = y;
  let d = (sr(y, S.x_position) - sr(x, S.x_position)) & 0xffff;
  w16(R.temp_32, d);
  if (sr(x, 0x46) & 1) {
    d = neg(d);
    w16(R.temp_32, d);
  }
  CODE_B3E03E();
}
/** $B3E03E */
export function CODE_B3E03E() {
  const x = reg.x;
  const y = reg.y;
  if (r16(R.temp_32) & 0x8000) return CODE_B3E060();
  const dirMask = ((sr(x, 0x46) & 1) - 1) & 0xffff;
  if ((dirMask ^ sr(y, S.x_speed)) & 0x8000) return CODE_B3E060(); // moving away from the wall
  reg.a = abs16(sr(y, S.x_speed));
  CODE_B3E056();
}
/** $B3E056 */
export function CODE_B3E056() {
  if (mi(reg.a, 0x04ff)) return CODE_B3E060();
  CODE_B3E08C();
  if (reg.c) return CODE_B3E063();
  CODE_B3E060();
}
/** $B3E060 */
export function CODE_B3E060() {
  exitB3D916();
}
/** $B3E063 — the wall breaks and becomes an exit door. */
export function CODE_B3E063() {
  const x = cur();
  sw(x, S.interaction_flags, 0);
  sw(x, S.carry_or_defeat_flags, 0);
  reg.x = x;
  delete_sprite_force_deallocation();
  sw(x, S.type, C.sprite_exit_door);
  sw(x, S.current_graphic, 0);
  sw(x, S.last_rendered_graphic, 0);
  sw(x, S.state, 1);
  reg.a = (6 << 8) | C.sound_explosion;
  queue_sound_effect();
  reg.a = (7 << 8) | C.sound_wall_break;
  queue_sound_effect();
  spriteReturn();
}

/** True when the water surface is above the kong's head (more than 20px above). */
function kongUnderwater(y: number): boolean {
  const water = r16(R.water_y_position);
  if (water & 0x8000) return false;
  return mi(water - sr(y, S.y_position), 0xffec);
}

/** $B3E08C — carry set when the kong is lined up with the doorway (looser vertically underwater). */
export function CODE_B3E08C() {
  const y = r16(R.active_kong_sprite);
  reg.y = y;
  if (kongUnderwater(y)) return CODE_B3E0B3();
  CODE_B3E09D();
}
/** $B3E09D */
export function CODE_B3E09D() {
  CODE_B3E14B();
  if (!reg.c) return CODE_B3E0C7();
  CODE_B3E15A();
  if (!reg.c) return CODE_B3E0C7();
  CODE_B3E172();
  if (!reg.c) return CODE_B3E0C7();
  CODE_B3E191();
  if (!reg.c) return CODE_B3E0C7();
  CODE_B3E0B1();
}
/** $B3E0B1 */
export function CODE_B3E0B1() {
  reg.c = true;
}
/** $B3E0B3 */
export function CODE_B3E0B3() {
  CODE_B3E14B();
  if (!reg.c) return CODE_B3E0C7();
  CODE_B3E15A();
  if (!reg.c) return CODE_B3E0C7();
  CODE_B3E16D();
  if (!reg.c) return CODE_B3E0C7();
  CODE_B3E191();
  if (reg.c) return CODE_B3E0B1();
  CODE_B3E0C7();
}
/** $B3E0C7 */
export function CODE_B3E0C7() {
  reg.c = false;
}

/** $B3E0C9 — carry set when the kong is walking into the exit doorway. */
export function CODE_B3E0C9() {
  const k = r16(R.active_kong_sprite);
  const flags = rom16(KONG_STATE_FLAGS + ((sr(k, S.state) << 2) & 0xffff));
  if (flags & 0x0004) return CODE_B3E134();
  reg.y = k;
  if (kongUnderwater(k)) return CODE_B3E136();
  CODE_B3E0ED();
}
/** $B3E0ED */
export function CODE_B3E0ED() {
  CODE_B3E14B();
  if (!reg.c) return CODE_B3E134();
  CODE_B3E15A();
  if (!reg.c) return CODE_B3E134();
  CODE_B3E172();
  if (!reg.c) return CODE_B3E134();
  CODE_B3E191();
  if (!reg.c) return CODE_B3E134();
  const y = r16(R.active_kong_sprite);
  reg.y = y;
  const st = sr(y, S.state);
  if (st === C.kong_state_5B || st === C.kong_state_5C) return CODE_B3E113();
  CODE_B3E128();
}
/** $B3E113 — in a skull cart: it must be moving towards the doorway's side. */
export function CODE_B3E113() {
  const y = r16(R.ridden_skull_cart_sprite);
  reg.y = y;
  if (y === 0) return CODE_B3E128();
  const x = cur();
  reg.x = x;
  const speed = sr(y, S.x_speed);
  if (speed === 0) return CODE_B3E134();
  // ROL, ROL (carry in = 1 from the CMP), EOR $46, LSR: bit 15 of the speed vs bit 0 of $46
  if ((((speed >> 15) ^ sr(x, 0x46)) & 1) === 0) return CODE_B3E134();
  CODE_B3E132();
}
/** $B3E128 — on foot: standing on the ground and holding towards the doorway. */
export function CODE_B3E128() {
  CODE_B3E1A9();
  if (!reg.c) return CODE_B3E134();
  CODE_B3E1B8();
  if (!reg.c) return CODE_B3E134();
  CODE_B3E132();
}
/** $B3E132 */
export function CODE_B3E132() {
  reg.c = true;
}
/** $B3E134 */
export function CODE_B3E134() {
  reg.c = false;
}
/** $B3E136 */
export function CODE_B3E136() {
  CODE_B3E14B();
  if (!reg.c) return CODE_B3E134();
  CODE_B3E15A();
  if (!reg.c) return CODE_B3E134();
  CODE_B3E16D();
  if (!reg.c) return CODE_B3E134();
  CODE_B3E191();
  if (!reg.c) return CODE_B3E134();
}

/** $B3E14B — carry clear when the kong is already exiting (state $33). */
export function CODE_B3E14B() {
  const y = r16(R.active_kong_sprite);
  reg.y = y;
  if (sr(y, S.state) === C.kong_state_33) return CODE_B3E158();
  reg.c = true;
}
/** $B3E158 */
export function CODE_B3E158() {
  reg.c = false;
}
/** $B3E15A — carry set when the wall is vertically on screen. */
export function CODE_B3E15A() {
  const x = cur();
  reg.x = x;
  const d = (sr(x, S.y_position) - r16(0x17c2)) & 0xffff;
  if (d & 0x8000 || !mi(d, 0x00e0)) return CODE_B3E16B();
  reg.c = true;
}
/** $B3E16B */
export function CODE_B3E16B() {
  reg.c = false;
}
/** $B3E16D — vertical tolerance $1B (underwater). */
export function CODE_B3E16D() {
  reg.a = 0x001b;
  CODE_B3E175();
}
/** $B3E172 — vertical tolerance 5. */
export function CODE_B3E172() {
  reg.a = 0x0005;
  CODE_B3E175();
}
/** $B3E175 — carry set when |doorway y - kong y| < A. */
export function CODE_B3E175() {
  w16(R.temp_32, reg.a);
  const y = r16(R.active_kong_sprite);
  reg.y = y;
  const x = reg.x;
  reg.a = abs16(sr(x, S.y_position) + sr(x, 0x48) - sr(y, S.y_position));
  CODE_B3E189();
}
/** $B3E189 */
export function CODE_B3E189() {
  if (!mi(reg.a, r16(R.temp_32))) return CODE_B3E18F();
  reg.c = true;
}
/** $B3E18F */
export function CODE_B3E18F() {
  reg.c = false;
}
/** $B3E191 — carry set when the kong is within $16 px horizontally. */
export function CODE_B3E191() {
  const y = r16(R.active_kong_sprite);
  reg.y = y;
  reg.a = abs16(sr(reg.x, S.x_position) - sr(y, S.x_position));
  CODE_B3E1A0();
}
/** $B3E1A0 */
export function CODE_B3E1A0() {
  if (!mi(reg.a, 0x0016)) return CODE_B3E1A7();
  reg.c = true;
}
/** $B3E1A7 */
export function CODE_B3E1A7() {
  reg.c = false;
}
/** $B3E1A9 — carry set when sprite Y is on the ground (terrain bits $0101). */
export function CODE_B3E1A9() {
  if ((r16(reg.y + S.terrain_interaction) & 0x0101) !== 0x0101) return CODE_B3E1B6();
  reg.c = true;
}
/** $B3E1B6 */
export function CODE_B3E1B6() {
  reg.c = false;
}
/** $B3E1B8 — carry set for breakable walls, state $4F, or when holding towards the doorway. */
export function CODE_B3E1B8() {
  const x = reg.x;
  if (sr(x, S.type) === C.sprite_breakable_wall) return CODE_B3E1E0();
  const y = r16(R.active_kong_sprite);
  reg.y = y;
  if (sr(y, S.state) === C.kong_state_4F) return CODE_B3E1E0();
  if (sr(x, 0x46) === 0) return CODE_B3E1D5();
  reg.a = 0x0100; // right
  CODE_B3E1D8();
}
/** $B3E1D3 */
export function CODE_B3E1D3() {
  reg.c = false;
}
/** $B3E1D5 */
export function CODE_B3E1D5() {
  reg.a = 0x0200; // left
  CODE_B3E1D8();
}
/** $B3E1D8 */
export function CODE_B3E1D8() {
  const y = r16(R.active_kong_control_variables);
  reg.y = y;
  reg.a &= r16(y + K.input_held);
  if (reg.a === 0) return CODE_B3E1D3();
  CODE_B3E1E0();
}
/** $B3E1E0 */
export function CODE_B3E1E0() {
  reg.c = true;
}

/** $B3E1E2 — interaction callback: the kong walks off through the exit doorway. */
export function CODE_B3E1E2() {
  work_on_active_kong_global();
  drop_sprite_or_follower_kong();
  CODE_B3E28B();
  if (r16(R.animal_type) !== C.sprite_enguarde) {
    const x = r16(R.active_kong_sprite);
    const y = r16(R.current_interacting_sprite);
    reg.x = x;
    reg.y = y;
    sw(x, S.y_position, sr(y, S.y_position) + sr(y, 0x48));
  }
  CODE_B3E203();
}
/** $B3E203 */
export function CODE_B3E203() {
  CODE_B3E2C4();
  const x = r16(R.active_kong_sprite);
  const kc = r16(R.active_kong_control_variables);
  w16(kc + K.invincible_timer, 0);
  w16(kc + K.flash_timer, 0);
  w16(kc + K.fast_flag, r16(kc + K.fast_flag) & 0xfffb);
  sw(x, S.interaction_flags, 0);
  w16(R.temp_32, 0x0180);
  const door = r16(R.current_interacting_sprite);
  reg.x = x;
  if (sr(door, 0x46) !== 0) return CODE_B3E240();
  reg.y = neg(sr(door, 0x4a));
  reg.a = neg(0x0180);
  CODE_B3E246();
}
/** $B3E240 */
export function CODE_B3E240() {
  reg.y = sr(r16(R.current_interacting_sprite), 0x4a);
  reg.a = r16(R.temp_32);
  CODE_B3E246();
}
/** $B3E246 — A = walk speed, Y = exit trigger offset from the door. */
export function CODE_B3E246() {
  const x = reg.x;
  sw(x, S.x_speed, reg.a);
  sw(x, S.max_x_speed, reg.a);
  sw(x, S.oam_property, merge(sr(x, S.oam_property), reg.a >> 1, 0x4000));
  sw(x, S.y_speed, 0);
  if (r16(R.current_player_mount)) sw(x, S.y_speed, 0x40);
  CODE_B3E25F();
}
/** $B3E25F */
export function CODE_B3E25F() {
  const door = r16(R.current_interacting_sprite);
  w16(R.level_exit_trigger_x_position, reg.y + sr(door, S.x_position));
  reg.x = r16(R.active_kong_sprite);
  w16(R.level_destination_number, sr(door, 0x42));
  w16(R.destination_level_entrance_number, sr(door, 0x44));
  reg.a = 0x0003;
  reg.y = 0x0280;
  enable_bullet_time_global();
}

/** $B3E287 — JSL entry of CODE_B3E28B. */
export function CODE_B3E287() {
  CODE_B3E28B();
}
/** $B3E28B — levels with door occlusion: draw the kongs (and animal) behind the door frame. */
export function CODE_B3E28B() {
  if (!(r16(level.effects) & C.door_occlusion_effect)) return CODE_B3E2A6();
  reg.x = r16(R.active_kong_sprite);
  CODE_B3E2A7();
  reg.x = r16(R.inactive_kong_sprite);
  CODE_B3E2A7();
  reg.x = r16(R.current_player_mount);
  if (reg.x) CODE_B3E2A7();
  CODE_B3E2A6();
}
/** $B3E2A6 */
export function CODE_B3E2A6() {}
/** $B3E2A7 — OAM priority bits of sprite X to 2. */
export function CODE_B3E2A7() {
  const x = reg.x;
  reg.a = merge(sr(x, S.oam_property), 0x2000, 0x3000);
  sw(x, S.oam_property, reg.a);
}
/** $B3E2C4 — exit walking animation and kong state $33. */
export function CODE_B3E2C4() {
  CODE_B3E2D0();
  reg.x = r16(R.active_kong_sprite);
  sw(reg.x, S.state, C.kong_state_33);
  CODE_B3E2CF();
}
/** $B3E2CF */
export function CODE_B3E2CF() {}
/** $B3E2D0 */
export function CODE_B3E2D0() {
  const y = r16(R.active_kong_control_variables);
  reg.y = y;
  const anim = r16(y + K.animation_id);
  if (anim === 0x00a3 || anim === 0x009e) return CODE_B3E2CF();
  if (r16(R.animal_type)) return CODE_B3E2EC();
  reg.a = 0x003c;
  set_anim_once_handle_dixie();
}
/** $B3E2EC */
export function CODE_B3E2EC() {
  reg.a = 0x009a;
  set_anim_handle_animal_and_dixie();
}

/** $B3E2F4 — interaction callback for exits taken in a skull cart / state $47. */
export function CODE_B3E2F4() {
  work_on_active_kong_global();
  const k = r16(R.active_kong_sprite);
  const flags = rom16(KONG_STATE_FLAGS + ((sr(k, S.state) << 2) & 0xffff));
  if (!(flags & 0x0002)) return CODE_B3E310();
  sw(cur(), S.state, 0x70);
  CODE_B3E392();
}
/** $B3E310 */
export function CODE_B3E310() {
  const x = r16(R.active_kong_sprite);
  const door = r16(R.current_interacting_sprite);
  sw(x, S.y_position, sr(door, S.y_position) + sr(door, 0x48));
  sw(x, S.state, 0x33);
  const kc = r16(R.active_kong_control_variables);
  w16(kc + K.invincible_timer, 0);
  w16(kc + K.flash_timer, 0);
  w16(kc + K.fast_flag, r16(kc + K.fast_flag) & 0xfffb);
  sw(x, S.interaction_flags, 0);
  reg.y = 0x0300;
  reg.x = 0x0040;
  if (!(r16(R.RAM_0B02) & 0x0004)) {
    reg.y = 0x0300;
    reg.x = 0x0028;
  }
  CODE_B3E355();
}
/** $B3E355 — Y = speed, X = exit trigger offset; negated when leaving to the left. */
export function CODE_B3E355() {
  w16(R.temp_32, reg.y);
  w16(R.temp_34, reg.x);
  const door = r16(R.current_interacting_sprite);
  reg.y = door;
  reg.x = r16(R.active_kong_sprite);
  if (sr(door, 0x46) === 0) {
    w16(R.temp_34, neg(r16(R.temp_34)));
    w16(R.temp_32, neg(r16(R.temp_32)));
  }
  CODE_B3E374();
}
/** $B3E374 */
export function CODE_B3E374() {
  const x = reg.x;
  const speed = r16(R.temp_32);
  sw(x, S.x_speed, speed);
  sw(x, S.max_x_speed, speed);
  sw(x, S.oam_property, merge(sr(x, S.oam_property), speed >> 1, 0x4000));
  sw(x, S.y_speed, 0);
  const door = r16(R.current_interacting_sprite);
  w16(R.level_exit_trigger_x_position, r16(R.temp_34) + sr(door, S.x_position));
  CODE_B3E392();
}
/** $B3E392 — record the destination and freeze briefly. */
export function CODE_B3E392() {
  const door = r16(R.current_interacting_sprite);
  reg.x = r16(R.active_kong_sprite);
  w16(R.level_destination_number, sr(door, 0x42));
  w16(R.destination_level_entrance_number, sr(door, 0x44));
  reg.a = 0x0003;
  reg.y = 0x0280;
  enable_bullet_time_global();
}

registerSprite({
  breakable_exit_wall_sprite_code, CODE_B3DF5F, CODE_B3DF88, CODE_B3DF8D, CODE_B3DF99, CODE_B3DF9E,
  CODE_B3DFA1, CODE_B3DFBD, CODE_B3DFC0, CODE_B3DFDA, CODE_B3DFDD, CODE_B3DFF9, CODE_B3DFFC,
  CODE_B3DFFF, CODE_B3E006, CODE_B3E025, CODE_B3E03E, CODE_B3E056, CODE_B3E060, CODE_B3E063,
});
registerRts({
  CODE_B3E08C, CODE_B3E09D, CODE_B3E0B1, CODE_B3E0B3, CODE_B3E0C7, CODE_B3E0C9, CODE_B3E0ED,
  CODE_B3E113, CODE_B3E128, CODE_B3E132, CODE_B3E134, CODE_B3E136, CODE_B3E14B, CODE_B3E158,
  CODE_B3E15A, CODE_B3E16B, CODE_B3E16D, CODE_B3E172, CODE_B3E175, CODE_B3E189, CODE_B3E18F,
  CODE_B3E191, CODE_B3E1A0, CODE_B3E1A7, CODE_B3E1A9, CODE_B3E1B6, CODE_B3E1B8, CODE_B3E1D3,
  CODE_B3E1D5, CODE_B3E1D8, CODE_B3E1E0, CODE_B3E28B, CODE_B3E2A6, CODE_B3E2A7, CODE_B3E2C4,
  CODE_B3E2CF, CODE_B3E2D0, CODE_B3E2EC,
});
registerRtl({
  CODE_B3E1E2, CODE_B3E203, CODE_B3E240, CODE_B3E246, CODE_B3E25F, CODE_B3E287, CODE_B3E2F4,
  CODE_B3E310, CODE_B3E355, CODE_B3E374, CODE_B3E392,
});
