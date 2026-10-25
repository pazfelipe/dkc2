/**
 * Bank $B3 — barrel cannons (blast barrels, auto-fire, rotating, arrow and animal barrels) and
 * the Kannon-style cannon ($B3E65C-$B3EDD3, $B3F05F, $B3F2A6-$B3F2FD).
 *
 * Barrel variables:
 *   $04/$08 origin x/y (moving barrels oscillate around it), $26 animal / launch parameter,
 *   $2A flags (bit 11 can be entered, 12 kong inside, 13 fire pressed, 14 facing, 15 path dir),
 *   $2C launch speed (low) / auto-fire delay (high), $32 hit by a thrown object (8 = cannonball),
 *   $38 timer, $3A rotation speed, $3C icon sprite, $3E entrance number (state $0E),
 *   $42 rotation limits (low = minimum, high = maximum), $44 countdown (numbered barrels),
 *   $46 behaviour flags, $48 rotation (high byte), $4A/$4C/$4E path position / length,
 *   $50 snap-to-45-degree flag, $52 path speed, $5C camera lock to apply when firing.
 */
import { r16, w16, rom16 } from "../../core/mem";
import { reg, callPtr } from "../../core/cpu";
import { L, R, C, sprite as S, kong_control as K } from "../../core/sym";
import {
  set_sprite_palette_global, spawn_special_sprite_index, queue_sound_effect, CODE_BBBB44,
  delete_sprite_handle_deallocation, spawn_barrel_parts_global, spawn_follower_animal_icon,
  CODE_B5E43E, enable_bullet_time_global, process_terrain_interaction_global,
} from "../../gen/routines";
import {
  CODE_B3EEB9, CODE_B3F111, CODE_B3F15C, CODE_B3F1F3, move_kong_to_sprite_position, CODE_B3F33E,
} from "./b3d_barrel_kong";
import { CODE_B3E634 } from "./b3d_checkpoint";
import {
  cur, sr, sw, mi, neg, abs16, asr, merge, registerRts, registerSprite, spriteReturn, exitB3D916,
} from "./b3d_common";

const STATE_TABLE = L("barrel_cannon_code_state_table");
const DATA_FF11BE = L("DATA_FF11BE");
const ANIMAL_PALETTES = L("animal_palette_numbers");
const LAUNCH_FRAMES = L("launch_barrel_rotation_frames");
const AUTO_FRAMES = L("auto_barrel_rotation_frames");
const ARROW_FRAMES = L("arrow_barrel_rotation_frames");
const ARROW_OAM = L("arrow_barrel_oam_properties");
/** `AND $2000` at $B3EDAC reads open bus; the last byte on the bus is the operand's $20. */
const OPEN_BUS_2000 = 0x2020;

const kongInside = () => sr(r16(R.active_kong_sprite), S.state) === C.kong_state_11;
const xba = (v: number) => ((v >> 8) | (v << 8)) & 0xffff;

/** $B3E65C — the cannon: blinks green while loaded, otherwise acts as a barrel cannon. */
export function cannon_sprite_code() {
  const x = cur();
  if (sr(x, 0x2a) & 0x0800 && (r16(R.active_frame_counter) & 0x0f) === 0) {
    reg.x = x;
    reg.a = r16(R.active_frame_counter) & 0x10 ? C.loaded_cannon_sprite_palette : C.cannon_sprite_palette;
    set_sprite_palette_global();
  }
  barrel_cannon_code();
}

/** $B3E768 — barrel cannon main: dispatch on the state. */
export function barrel_cannon_code() {
  callPtr(0xb3, rom16(STATE_TABLE + ((sr(cur(), S.state) << 1) & 0xffff)));
}

/** $B3E78F .state_0 — init: path origin, rotation, flags, and the icon sprite. */
export function barrel_cannon_code_state_0() {
  let x = cur();
  sw(x, 0x04, sr(x, S.x_position));
  sw(x, 0x08, sr(x, S.y_position));
  const f = sr(x, 0x46);
  if (f & 0x0080) {
    // horizontal path: start at the far end
    let t = sr(x, 0x4c);
    if (f & 0x0200) t = neg(t);
    w16(R.temp_32, t);
    sw(x, 0x04, sr(x, 0x04) - t);
  }
  if (f & 0x0100) {
    let t = sr(x, 0x4c);
    if (f & 0x0400) t = neg(t);
    w16(R.temp_32, t);
    sw(x, 0x08, sr(x, 0x08) - t);
  }
  sw(x, 0x48, (sr(x, 0x42) << 8) & 0xff00); // current rotation = minimum rotation
  sw(x, 0x4a, 0);
  if (!(sr(x, 0x46) & 0x1010)) sw(x, 0x2c, sr(x, 0x2c) & 0x00ff);
  initCountdown(x);
  sw(x, S.state, sr(x, S.state) + 1);
  sw(x, 0x2a, (sr(x, 0x46) & 0x0020) << 9); // bit 5 -> facing bit 14
  if (sr(x, 0x00) !== C.sprite_cannon) sw(x, 0x2a, sr(x, 0x2a) | 0x0800);
  if (sr(x, 0x46) & 0x0008) sw(x, 0x1c, 0xc000); // invisible barrel
  CODE_B3F2A6();
  x = cur();
  sw(x, 0x3c, 0);
  const g = sr(x, 0x46);
  if (g & 0x0008 || !(g & 0xb013)) return spriteReturn();
  let id: number;
  if (g & 0x2000) id = 0x0046;
  else if (g & 0x8000) id = rom16(DATA_FF11BE + ((sr(x, 0x26) << 1) & 0xffff));
  else if (g & 0x0003) id = g & 0x0001 ? C.special_sprite_spawn_id_012A : C.special_sprite_spawn_id_0128;
  else id = C.special_sprite_spawn_id_0044;
  reg.y = id;
  spawn_special_sprite_index();
  if (reg.c) return spriteReturn();
  const icon = r16(R.alternate_sprite);
  x = cur();
  sw(x, 0x3c, icon);
  sw(icon, 0x42, x);
  sw(icon, 0x46, sr(x, 0x46));
  if (sr(x, 0x46) & 0x0010) {
    sw(x, 0x02, sr(x, 0x02) + 2);
    sw(icon, 0x02, sr(icon, 0x02) + 2);
  }
  let graphic: number;
  const h = sr(x, 0x46);
  w16(R.temp_32, 0);
  if (h & 0x8000) {
    graphic = sr(x, 0x26) * 4 + C.animal_icon_graphic_range_start;
  } else {
    // icon kind: 0 bonus/warp ($10), 1 auto ($1000), 2 ($2000), 3+ rotating/arrow
    let kind = 0;
    if (!(h & 0x0010)) {
      kind = 1;
      if (!(h & 0x1000)) {
        kind = 2;
        if (!(h & 0x2000)) kind = ((h & 0x0003) - 1 + 3) & 0xffff;
      }
    }
    w16(R.temp_32, kind);
    graphic = kind * 4 + C.barrel_icon_graphic_range_start;
  }
  sw(icon, 0x1a, graphic);
  sw(icon, 0x48, graphic);
  sw(icon, 0x4a, 0);
  spriteReturn();
}

/** .CODE_B3EC87 — $44 = auto-fire delay (high byte of $2C, low byte forced to $FF), or 0. */
function initCountdown(x: number) {
  let v = sr(x, 0x2c) & 0xff00;
  if (v) v |= 0x00ff;
  sw(x, 0x44, v);
}

/** $B3E8DD .state_1 — idle, waiting for the kong (or a cannonball for the cannon). */
export function barrel_cannon_code_state_1() {
  const x = cur();
  const hit = sr(x, 0x32);
  if (hit) {
    sw(x, 0x32, 0);
    if (hit === 0x0008) {
      sw(x, 0x2a, sr(x, 0x2a) | 0x0800);
      reg.a = (5 << 8) | C.sound_cannon_load;
      queue_sound_effect();
      sw(cur(), 0x02, 0x00ec);
    }
  }
  CODE_B3F33E();
  CODE_B3EEB9();
  if (reg.c) return spriteReturn();
  if (sr(r16(R.inactive_kong_sprite), S.state) === C.kong_state_2F) return spriteReturn();
  exitB3D916();
}

/** $B3E917 .state_2 — the kong is being pulled in. */
export function barrel_cannon_code_state_2() {
  CODE_B3F05F();
  CODE_B3F33E();
  CODE_B3F2A6();
  if (!kongInside()) return kongLeft();
  move_kong_to_sprite_position();
  const x = cur();
  const t = (sr(x, 0x38) - 1) & 0xffff;
  sw(x, 0x38, t);
  if (!(t & 0x8000)) return spriteReturn();
  const f = sr(x, 0x46);
  if (f & 0x8000) {
    // animal barrel: shake, then transform
    sw(x, 0x3a, 0x40);
    sw(x, S.state, 0x0c);
    reg.a = 0;
    CODE_B3F111();
    return spriteReturn();
  }
  if (f & 0x0804) {
    sw(x, S.state, sr(x, S.state) + 1);
    return spriteReturn();
  }
  const lim = sr(x, 0x42);
  if (xba(lim) === lim) {
    // no rotation range: aim directly
    CODE_B3ED2C();
    sw(reg.x, S.state, 8);
    return spriteReturn();
  }
  sw(x, S.state, 0x0a);
  spriteReturn();
}

/** $B3E979 .state_3 — the kong is inside, waiting for fire (or auto fire). */
export function barrel_cannon_code_state_3() {
  CODE_B3F05F();
  CODE_B3ECE7();
  if (reg.c && sr(reg.x, 0x50) !== 0) return fireNow3();
  if (!kongInside()) return kongLeft();
  CODE_B3F33E();
  CODE_B3EE67();
  if (reg.c) return fireNow3();
  CODE_B3F2A6();
  move_kong_to_sprite_position();
  spriteReturn();
}
/** .CODE_B3E9A3 */
function fireNow3() {
  CODE_B3F2A6();
  move_kong_to_sprite_position();
  CODE_B3ED2C();
  const x = reg.x;
  if (!(sr(x, 0x46) & 0x0004)) {
    sw(x, S.state, 9);
    return spriteReturn();
  }
  sw(x, 0x38, 0x12);
  sw(x, S.state, sr(x, S.state) + 1);
  spriteReturn();
}

/** $B3E9C5 .state_4 — about to fire. */
export function barrel_cannon_code_state_4() {
  CODE_B3F05F();
  CODE_B3F33E();
  if (!kongInside()) return kongLeft();
  move_kong_to_sprite_position();
  const x = cur();
  const t = (sr(x, 0x38) - 1) & 0xffff;
  sw(x, 0x38, t);
  if (!(t & 0x8000)) return spriteReturn();
  fire();
}

/** .CODE_B3E9E4 — fire the kong out (or turn it into the barrel's animal first). */
function fire() {
  const x = cur();
  sw(x, S.state, sr(x, S.state) + 1);
  sw(x, 0x38, 0x14);
  sw(x, 0x2a, sr(x, 0x2a) & 0xefff);
  if (sr(x, 0x46) & 0x8000) {
    w16(R.current_held_sprite, 0);
    const y = (sr(x, 0x26) << 1) & 0xffff;
    w16(R.animal_type, ((y << 1) + C.animal_sprite_type_range_start) & 0xffff);
    w16(R.current_player_mount, 0);
    reg.db = 0xb3;
    reg.x = r16(R.active_kong_sprite);
    reg.y = y;
    reg.a = rom16(ANIMAL_PALETTES + y);
    set_sprite_palette_global();
    if (r16(R.game_state_flags) & 0x4000) spawn_follower_animal_icon();
    CODE_B5E43E();
    reg.x = x;
  }
  const k = r16(R.active_kong_sprite);
  reg.y = k;
  if (sr(x, 0x46) & 0x2000) {
    // bonus/warp barrel: the kong flies along a scripted path
    sw(k, 0x48, 1);
    const p = sr(x, 0x26);
    sw(k, 0x4c, p & 0xff);
    sw(k, 0x4a, p >> 8);
    reg.a = 0x0003;
    reg.y = 0x0280;
    enable_bullet_time_global();
    reg.x = x;
    reg.y = k;
  } else {
    sw(k, 0x48, 0);
  }
  sw(k, 0x42, sr(x, 0x20));
  sw(k, 0x44, sr(x, 0x24));
  sw(k, 0x4e, (sr(x, 0x46) >> 14) & 1);
  // .CODE_B3EAB6 (rev 1)
  sw(k, S.interaction_flags, sr(x, 0x46) & 0x2000 ? 0x0090 : r16(R.RAM_0A3C) & 0xff7f);
  reg.a = (5 << 8) | C.sound_barrel_blast;
  queue_sound_effect();
  sw(k, 0x1c, 0);
  CODE_B3F15C();
  CODE_B3EC94();
  CODE_B3F2A6();
  CODE_B3F1F3();
  const b = cur();
  reg.a = sr(b, 0x5c);
  CODE_B3ED5C();
  if (sr(b, 0x46) & 0x8000) {
    spawn_barrel_parts_global(); // animal barrels break
    delete_sprite_handle_deallocation();
    return spriteReturn();
  }
  if (!(sr(b, S.oam_property) & 0x3000)) {
    delete_sprite_handle_deallocation(); // one-shot barrel
    return spriteReturn();
  }
  spriteReturn();
}

/** $B3EACE .state_5 — fired, cooling down. */
export function barrel_cannon_code_state_5() {
  CODE_B3F33E();
  const x = cur();
  const t = (sr(x, 0x38) - 1) & 0xffff;
  sw(x, 0x38, t);
  if (!(t & 0x8000)) return exitB3D916();
  if (sr(x, 0x46) & 0x0010) {
    CODE_BBBB44(); // bonus / warp barrel: done
    return spriteReturn();
  }
  sw(x, S.state, sr(x, S.state) + 1);
  initCountdown(x);
  sw(x, 0x38, 3);
  spriteReturn();
}

/** $B3EAF5 .state_6 — rotate back to the start position quickly. */
export function barrel_cannon_code_state_6() {
  CODE_B3F33E();
  let x = cur();
  const saved = sr(x, 0x3a);
  sw(x, 0x3a, 0x0c00);
  CODE_B3EE60();
  const done = reg.c;
  x = cur();
  sw(x, 0x3a, saved);
  CODE_B3F2A6();
  if (!done) return spriteReturn();
  x = cur();
  sw(x, S.state, 1);
  sw(x, 0x2a, merge(sr(x, 0x2a), (xba(sr(x, 0x46)) << 1) & 0xffff, 0x4000));
  spriteReturn();
}

/** $B3EB2E .state_7 */
export function barrel_cannon_code_state_7() {
  CODE_B3F05F();
  spriteReturn();
}

/** $B3EB34 .state_8 — rotating freely (the player picks the moment). */
export function barrel_cannon_code_state_8() {
  CODE_B3F05F();
  CODE_B3ECE7();
  if (reg.c) return snapAndFire();
  CODE_B3ED3B();
  if (reg.c) return snapAndFire();
  if (!kongInside()) return kongLeft();
  CODE_B3F33E();
  const x = cur();
  const t = (sr(x, 0x38) - 1) & 0xffff;
  sw(x, 0x38, t);
  if (t & 0x8000) {
    sw(x, 0x38, t + 1);
    CODE_B3ED6E();
  }
  CODE_B3F2A6();
  move_kong_to_sprite_position();
  spriteReturn();
}
/** .CODE_B3EB62 — snap the rotation to the nearest 45 degrees and fire. */
function snapAndFire() {
  const x = cur();
  sw(x, 0x48, (sr(x, 0x48) + 0x1000) & 0xe000);
  prepareFire();
}
/** .CODE_B3EB6F */
function prepareFire() {
  CODE_B3F2A6();
  move_kong_to_sprite_position();
  const x = cur();
  sw(x, S.state, 4);
  sw(x, 0x38, 1);
  spriteReturn();
}

/** $B3EB84 .state_9 — aimed, waiting for fire; bonus barrels move the kong with the barrel. */
export function barrel_cannon_code_state_9() {
  CODE_B3F05F();
  CODE_B3ECE7();
  if (reg.c) return prepareFire();
  CODE_B3ED3B();
  if (reg.c) return prepareFire();
  if (!kongInside()) return kongLeft();
  CODE_B3F33E();
  CODE_B3F2A6();
  CODE_B3EDD4();
  move_kong_to_sprite_position();
  spriteReturn();
}

/** .CODE_B3EBAA — the kong is no longer inside (hurt, or left): reset the barrel. */
function kongLeft() {
  const x = cur();
  if (sr(x, 0x46) & 0x1010) sw(x, S.state, 0x0d);
  else {
    sw(x, 0x44, sr(x, 0x44) | 0x00ff);
    sw(x, S.state, 5);
  }
  sw(x, 0x38, 0x20);
  sw(x, 0x2a, sr(x, 0x2a) & 0xefff);
  spriteReturn();
}

/** $B3EBD8 .state_A — rotating towards one end of the range. */
export function barrel_cannon_code_state_A() {
  CODE_B3F05F();
  CODE_B3ECE7();
  if (reg.c) return prepareFire();
  CODE_B3F33E();
  let x = cur();
  const t = (sr(x, 0x38) - 1) & 0xffff;
  sw(x, 0x38, t);
  if (t & 0x8000) {
    sw(x, 0x38, t + 1);
    CODE_B3EE67();
    if (reg.c) {
      // reached the end: swap the limits and pause
      CODE_B3F2A6();
      move_kong_to_sprite_position();
      CODE_B3ED2C();
      x = cur();
      sw(x, 0x42, xba(sr(x, 0x42)));
      sw(x, S.state, sr(x, S.state) + 1);
      sw(x, 0x38, sr(x, 0x50) || 4);
      return spriteReturn();
    }
  }
  CODE_B3F2A6();
  move_kong_to_sprite_position();
  spriteReturn();
}

/** $B3EC1A .state_B — pause at the end of the rotation range. */
export function barrel_cannon_code_state_B() {
  CODE_B3F05F();
  CODE_B3ECE7();
  if (reg.c) return prepareFire();
  CODE_B3F33E();
  CODE_B3F2A6();
  move_kong_to_sprite_position();
  const x = cur();
  const t = (sr(x, 0x38) - 1) & 0xffff;
  sw(x, 0x38, t);
  if (t & 0x8000) sw(x, S.state, 0x0a);
  spriteReturn();
}

/** $B3EC3C .state_C — animal barrel shaking before the transformation. */
export function barrel_cannon_code_state_C() {
  CODE_B3F05F();
  const x = cur();
  if (!(r16(R.active_frame_counter) & 1)) {
    const t = (sr(x, 0x3a) - 1) & 0xffff;
    sw(x, 0x3a, t);
    if (t & 0x8000) {
      sw(x, 0x2c, 0);
      reg.a = (5 << 8) | C.sound_morph_to_animal;
      queue_sound_effect();
      return fire();
    }
  }
  reg.x = x;
  reg.a = sr(x, 0x3a);
  CODE_B3E634();
  move_kong_to_sprite_position();
  spriteReturn();
}

/** $B3EC61 .state_D — wait, then back to idle. */
export function barrel_cannon_code_state_D() {
  const x = cur();
  const t = (sr(x, 0x38) - 1) & 0xffff;
  sw(x, 0x38, t);
  if (t & 0x8000) sw(x, S.state, 1);
  spriteReturn();
}

/** $B3EC72 .state_E — only exists when entering through the matching entrance (bonus exits). */
export function barrel_cannon_code_state_E() {
  const x = cur();
  if (sr(x, 0x3e) !== r16(R.level_entrance_number)) {
    delete_sprite_handle_deallocation();
    return spriteReturn();
  }
  sw(x, S.state, 0);
  barrel_cannon_code_state_0();
}

/** $B3EC94 — smoke puff when firing (for barrels: drifting with the kong at 1/8 speed). */
export function CODE_B3EC94() {
  reg.y = C.special_sprite_spawn_id_0048;
  spawn_special_sprite_index();
  if (reg.c) return;
  const smoke = r16(R.alternate_sprite);
  reg.x = smoke;
  if (sr(cur(), S.type) === C.sprite_cannon) {
    sw(smoke, S.y_speed, 0xffc0);
    sw(smoke, S.y_position, sr(smoke, S.y_position) - 0x1c);
    sw(smoke, S.x_position, sr(smoke, S.x_position) - 2);
    return;
  }
  const k = r16(R.active_kong_sprite);
  reg.y = k;
  sw(smoke, S.x_speed, asr(sr(k, S.x_speed), 3));
  reg.a = asr(sr(k, S.y_speed), 3);
  sw(smoke, S.y_speed, reg.a);
}

/** $B3ECE7 — carry set when the barrel fires now (fire pressed, snapped to 45 degrees if $50). */
export function CODE_B3ECE7() {
  const x = cur();
  reg.x = x;
  if (!(sr(x, 0x2a) & 0x2000)) {
    const kc = r16(R.active_kong_control_variables);
    reg.y = kc;
    if (!(r16(kc + K.input_pressed) & 0x8000)) return CODE_B3ED2A();
    sw(x, 0x2a, sr(x, 0x2a) | 0x2000);
  }
  CODE_B3ED02();
}
/** $B3ED02 */
export function CODE_B3ED02() {
  const x = reg.x;
  if (sr(x, 0x50) === 0) return CODE_B3ED28();
  const snapped = ((((sr(x, 0x48) + 0x4000) & 0xc000) - 0x2000) & 0xffff);
  w16(R.temp_5E, snapped);
  reg.a = abs16(snapped - sr(x, 0x48));
  CODE_B3ED1F();
}
/** $B3ED1F */
export function CODE_B3ED1F() {
  if (!mi(reg.a, 0x1000)) return CODE_B3ED2A();
  sw(reg.x, 0x48, r16(R.temp_5E));
  CODE_B3ED28();
}
/** $B3ED28 */
export function CODE_B3ED28() {
  reg.c = true;
}
/** $B3ED2A */
export function CODE_B3ED2A() {
  reg.c = false;
}

/** $B3ED2C — facing bit 14 of $2A from bit 6 of $46. */
export function CODE_B3ED2C() {
  const x = cur();
  reg.x = x;
  reg.a = merge(sr(x, 0x2a), xba(sr(x, 0x46)), 0x4000);
  sw(x, 0x2a, reg.a);
}

/** $B3ED3B — numbered barrels: count down $44 by 3; carry set when it runs out (auto fire). */
export function CODE_B3ED3B() {
  const x = cur();
  reg.x = x;
  const v = (sr(x, 0x44) - 3) & 0xffff;
  if (v & 0x8000) return CODE_B3ED4C();
  if (mi(v, 0x00f0)) return CODE_B3ED4E();
  sw(x, 0x44, v);
  CODE_B3ED4C();
}
/** $B3ED4C */
export function CODE_B3ED4C() {
  reg.c = false;
}
/** $B3ED4E */
export function CODE_B3ED4E() {
  sw(reg.x, 0x44, 0);
  reg.c = true;
}

/** $B3ED5C — A = camera lock number (0 = none): set its "triggered" bit in $7E9128. */
export function CODE_B3ED5C() {
  const n = reg.a & 0xffff;
  if (n !== 0) {
    const i = (n << 1) & 0xffff;
    reg.x = i;
    reg.a = r16(0x7e9128 + i) | 0x0080;
    w16(0x7e9128 + i, reg.a);
  }
  reg.x = cur();
}

/** $B3ED6E — rotate by the rotation speed ($3A); restart the animation timer every 90 degrees. */
export function CODE_B3ED6E() {
  const x = cur();
  reg.x = x;
  if (sr(x, 0x46) & 0x1000) return CODE_B3ED94();
  const old = sr(x, 0x48);
  w16(R.temp_60, old);
  const v = (old + sr(x, S.animation_speed)) & 0xffff;
  sw(x, 0x48, v);
  const d = (v ^ old) & 0xe000;
  if (d && (d & 0x6000) === 0x2000) sw(x, S.animation_timer, sr(x, S.general_purpose_50));
  CODE_B3ED93();
}
/** $B3ED93 */
export function CODE_B3ED93() {}
/** $B3ED94 — player-steered barrel: left/right rotates it ($28 of the kong = steering input). */
export function CODE_B3ED94() {
  const x = reg.x;
  const kc = r16(R.active_kong_control_variables);
  reg.y = kc;
  if (r16(kc + K.input_held) & 0x0300) return CODE_B3EDC8();
  const k = r16(R.active_kong_sprite);
  reg.y = k;
  const v = (sr(x, 0x48) + sr(k, S.unknown_28)) & 0xffff;
  w16(R.temp_32, v);
  if ((v ^ sr(x, 0x48)) & OPEN_BUS_2000) {
    sw(k, S.unknown_28, 0);
    sw(x, 0x48, (r16(R.temp_32) + 0x1000) & 0xe000);
    return;
  }
  CODE_B3EDC3();
}
/** $B3EDC3 */
export function CODE_B3EDC3() {
  sw(reg.x, 0x48, r16(R.temp_32));
}
/** $B3EDC8 */
export function CODE_B3EDC8() {
  const k = r16(R.active_kong_sprite);
  reg.y = k;
  sw(reg.x, 0x48, sr(k, S.unknown_28) + sr(reg.x, 0x48));
}

/** $B3EDD4 — bonus/warp barrels ($46 bit 4): move with terrain physics, carrying the kong. */
export function CODE_B3EDD4() {
  const x = cur();
  reg.x = x;
  if (sr(x, 0x46) & 0x0010) CODE_B3EDDE();
}
/** $B3EDDE */
export function CODE_B3EDDE() {
  const x = cur();
  const savedConst = sr(x, S.constants_address);
  const kc = r16(R.active_kong_control_variables);
  w16(R.current_kong_control_variables, kc);
  const k = r16(R.active_kong_sprite);
  w16(R.current_sprite, k);
  reg.x = k;
  reg.y = kc;
  CODE_B3EE05();
  w16(R.current_sprite, x);
  sw(x, S.constants_address, savedConst);
  const y = r16(R.active_kong_sprite);
  reg.x = x;
  reg.y = y;
  sw(x, S.x_position, sr(y, S.x_position));
  reg.a = sr(y, S.y_position);
  sw(x, S.y_position, reg.a);
}
/** $B3EE05 — terrain interaction for sprite X without changing its speeds; keep it on screen. */
export function CODE_B3EE05() {
  const x = reg.x;
  const xs = sr(x, S.x_speed);
  const mxs = sr(x, S.max_x_speed);
  const ys = sr(x, S.y_speed);
  const mys = sr(x, S.max_y_speed);
  process_terrain_interaction_global();
  const s = reg.x;
  if (!mi(0x0120, sr(s, S.y_position))) sw(s, S.y_position, 0x0120);
  CODE_B3EE1E();
  const c = cur();
  sw(c, S.max_y_speed, mys);
  sw(c, S.y_speed, ys);
  sw(c, S.max_x_speed, mxs);
  sw(c, S.x_speed, xs);
  reg.x = c;
  reg.a = xs;
}
/** $B3EE1E — (rev 1) clamp to the screen. */
export function CODE_B3EE1E() {
  CODE_B3EE30();
}
/** $B3EE30 — clamp the current sprite to the bottom of the screen and $10-$F0 horizontally. */
export function CODE_B3EE30() {
  const x = cur();
  reg.x = x;
  const d = (r16(R.screen_scroll_y_position) + 0x00e0 - sr(x, S.y_position)) & 0xffff;
  if (d & 0x8000) sw(x, S.y_position, d + sr(x, S.y_position));
  CODE_B3EE43();
}
/** $B3EE43 */
export function CODE_B3EE43() {
  const x = reg.x;
  reg.a = (sr(x, S.x_position) - 0x10 - r16(R.screen_scroll_x_position)) & 0xffff;
  if (reg.a & 0x8000) return CODE_B3EE4F();
  CODE_B3EE59();
}
/** $B3EE4F */
export function CODE_B3EE4F() {
  reg.a = (neg(reg.a) + sr(reg.x, S.x_position)) & 0xffff;
  sw(reg.x, S.x_position, reg.a);
}
/** $B3EE59 */
export function CODE_B3EE59() {
  reg.a = (reg.a - 0x00e0) & 0xffff;
  if (!(reg.a & 0x8000)) CODE_B3EE4F();
}

/** $B3EE60 — rotate towards the maximum rotation (high byte of $42); carry set when reached. */
export function CODE_B3EE60() {
  const x = cur();
  reg.x = x;
  reg.a = xba(sr(x, 0x42));
  CODE_B3EE6B();
}
/** $B3EE67 — rotate towards the minimum rotation (low byte of $42); carry set when reached. */
export function CODE_B3EE67() {
  const x = cur();
  reg.x = x;
  reg.a = sr(x, 0x42);
  CODE_B3EE6B();
}
/** $B3EE6B */
export function CODE_B3EE6B() {
  const x = reg.x;
  let target = reg.a & 0xff00;
  w16(R.temp_5E, target);
  const old = sr(x, 0x48);
  w16(R.temp_60, old);
  if (!((old - target) & 0x8000)) return CODE_B3EEA1();
  target = (target - 1) & 0xffff;
  w16(R.temp_5E, target);
  reg.a = (sr(x, S.animation_speed) + old) & 0xffff;
  sw(x, 0x48, reg.a);
  if (mi(reg.a, target)) return CODE_B3EE8C();
  sw(x, 0x48, target);
  CODE_B3EE8A();
}
/** $B3EE8A */
export function CODE_B3EE8A() {
  reg.c = true;
}
/** $B3EE8C — A = new rotation: restart the animation timer when crossing 90 degrees. */
export function CODE_B3EE8C() {
  const d = (reg.a ^ r16(R.temp_60)) & 0xe000;
  if (d && (d & 0x6000) === 0x2000) sw(reg.x, S.animation_timer, sr(reg.x, S.general_purpose_50));
  CODE_B3EE9F();
}
/** $B3EE9F */
export function CODE_B3EE9F() {
  reg.c = false;
}
/** $B3EEA1 */
export function CODE_B3EEA1() {
  const x = reg.x;
  const target = (r16(R.temp_5E) + 1) & 0xffff;
  w16(R.temp_5E, target);
  reg.a = (neg(sr(x, S.animation_speed)) + sr(x, 0x48)) & 0xffff;
  sw(x, 0x48, reg.a);
  if (!mi(reg.a, target)) return CODE_B3EE8C();
  sw(x, 0x48, target - 1);
  CODE_B3EE8A();
}

/** $B3F05F — keep the camera from moving the kong off ($0AB8 bits 14-15). */
export function CODE_B3F05F() {
  w16(0x0ab8, 0xc000 | r16(0x0ab8));
}

/** $B3F2A6 — set the barrel's graphic for its rotation (launch / auto / arrow barrels). */
export function CODE_B3F2A6() {
  const y = cur();
  reg.y = y;
  if (sr(y, S.type) === C.sprite_cannon) return CODE_B3F2E5();
  const i = (((sr(y, 0x48) + 0x0800) >> 12) & 0x0f) << 1; // 16 directions
  reg.x = i;
  const m = sr(y, 0x46) & 0xa007;
  if (m === 0 || (m & 0xa003) !== 0) return CODE_B3F2CC();
  CODE_B3F2D4();
}
/** $B3F2CC */
export function CODE_B3F2CC() {
  reg.a = rom16(LAUNCH_FRAMES + reg.x);
  sw(reg.y, S.current_graphic, reg.a);
}
/** $B3F2D4 */
export function CODE_B3F2D4() {
  const y = reg.y;
  const lim = sr(y, 0x42);
  if (xba(lim) === lim) return CODE_B3F2E6();
  reg.a = rom16(AUTO_FRAMES + reg.x);
  sw(y, S.current_graphic, reg.a);
}
/** $B3F2E5 */
export function CODE_B3F2E5() {}
/** $B3F2E6 — arrow barrels: graphic and flip bits per direction. */
export function CODE_B3F2E6() {
  const y = reg.y;
  sw(y, S.oam_property, merge(sr(y, S.oam_property), rom16(ARROW_OAM + reg.x), 0xc000));
  reg.a = rom16(ARROW_FRAMES + reg.x);
  sw(y, S.current_graphic, reg.a);
}

registerSprite({
  cannon_sprite_code, barrel_cannon_code, barrel_cannon_code_state_0, barrel_cannon_code_state_1,
  barrel_cannon_code_state_2, barrel_cannon_code_state_3, barrel_cannon_code_state_4,
  barrel_cannon_code_state_5, barrel_cannon_code_state_6, barrel_cannon_code_state_7,
  barrel_cannon_code_state_8, barrel_cannon_code_state_9, barrel_cannon_code_state_A,
  barrel_cannon_code_state_B, barrel_cannon_code_state_C, barrel_cannon_code_state_D,
  barrel_cannon_code_state_E,
});
registerRts({
  CODE_B3EC94, CODE_B3ECE7, CODE_B3ED02, CODE_B3ED1F, CODE_B3ED28, CODE_B3ED2A, CODE_B3ED2C,
  CODE_B3ED3B, CODE_B3ED4C, CODE_B3ED4E, CODE_B3ED5C, CODE_B3ED6E, CODE_B3ED93, CODE_B3ED94,
  CODE_B3EDC3, CODE_B3EDC8, CODE_B3EDD4, CODE_B3EDDE, CODE_B3EE05, CODE_B3EE1E, CODE_B3EE30,
  CODE_B3EE43, CODE_B3EE4F, CODE_B3EE59, CODE_B3EE60, CODE_B3EE67, CODE_B3EE6B, CODE_B3EE8A,
  CODE_B3EE8C, CODE_B3EE9F, CODE_B3EEA1, CODE_B3F05F, CODE_B3F2A6, CODE_B3F2CC, CODE_B3F2D4,
  CODE_B3F2E5, CODE_B3F2E6,
});
