/**
 * Bank $B6 — Kudgel (Kudgel's Kontest, world 5 boss) and his club. Kudgel jumps around the
 * arena (boss commands $3A-$44), lands with a quake that stuns grounded Kongs, swings his club;
 * TNT barrels thrown at him hurt him (HP 6), he smashes TNT barrels held by the Kongs.
 *
 * Kudgel RAM: $0652 HP, $0654 Kudgel, $0656 club, $073D collision delay, $0747/$0749 jump
 * delay/gravity, $074B, $074D quake timer, $074F TNT barrel he tracks, $0751/$0753 death
 * particle timer/data pointer. Kudgel's $2E: bit 0 dangerous club, 8 can be hurt, 9 bonk,
 * 13 airborne attack, 14 back on the ground after being hurt.
 */
import { r16, w16, r8, rom16 } from "../../core/mem";
import { reg } from "../../core/cpu";
import { R, C, sprite } from "../../core/sym";
import {
  CODE_B4AEAF, spawn_big_special_sprite_index, parse_boss_command, get_current_sprite_clipping,
  check_complex_player_collision_B6, CODE_B3A600, process_sprite_animation, set_player_interaction_global,
  check_for_sprite_collisions, set_sprite_animation, set_alt_sprite_animation,
  CODE_BBBB99, CODE_BCFED8, CODE_BCFEC0, CODE_B3A334, spawn_special_sprite_index, CODE_BEBD8E,
  delete_sprite_handle_deallocation, spawn_no_gfx_special_sprite_index, spawn_barrel_parts_and_smoke_global,
  queue_sound_effect, interpolate_y_velocity_global, apply_position_from_velocity_global,
  set_current_level_as_cleared, interpolate_x_velocity_global, process_terrain_interaction_global,
  set_sprite_palette_global,
} from "../../gen/routines";
import { cur, rd, wr, dec, snd, jsrAddr, jslAddr, registerSprite, registerRts, registerRtl } from "./b6ba_common";
import { lda, lo, ge, add, ABORT_PARSE } from "./w4_b6_util";

const B6 = 0xb60000;
const KUDGEL_SCRIPT = lo("DATA_B684D4");
const STUN_TIMERS = lo("kudgel_sprite_code_kudgel_land_stun_timers");
const RET_B6BAD8 = lo("CODE_B6BAD8");
const RET_B6BC3E = lo("CODE_B6BC3E");
const RET_B6BA3F = lo("CODE_B6BA3F");
const RET_B6BCCF = lo("CODE_B6BCCF");
const PHASE_SCRIPTS = lo("kudgel_boss_command_sequence");
const CLIP6 = 0x09a3 + 6 * 8;
const CLIP8 = 0x09a3 + 8 * 8;

let kudgelDB = 0;
let clubDB = 0;

/** `JSR parse_boss_command`, ending early when a command leaves the parse (`PLA : PLA`). */
export function parseB6(): void {
  try {
    parse_boss_command();
  } catch (e) {
    if (e !== ABORT_PARSE) throw e;
  }
}

/** Kudgel's and the club's animations. */
function anims(kudgel: number, club: number) {
  reg.a = kudgel;
  set_sprite_animation();
  w16(R.alternate_sprite, r16(0x0656));
  reg.a = club;
  set_alt_sprite_animation();
}

/** $B68000 — despawn check, then back to the sprite handler. */
export function sprite_return_handle_despawn_B6(): void {
  CODE_BBBB99();
}

/** $B6800D — knock the Kong off his animal buddy / drop what he carries, with a puff. */
export function CODE_B6800D(): void {
  CODE_BCFED8();
  if (!reg.c) {
    CODE_BCFEC0();
    CODE_B3A334();
    reg.y = C.special_sprite_spawn_id_0034;
    spawn_special_sprite_index();
  }
  CODE_B68022();
}

/** $B68022 */
export function CODE_B68022(): void {
  reg.x = cur();
}

/** $B68053 — Kudgel. */
export function kudgel_sprite_code(): void {
  kudgelDB = reg.db;
  reg.db = 0xb6;
  let x = cur();
  reg.x = x;
  if (rd(x, 0x42) === 0) {
    CODE_B4AEAF();
    x = reg.x;
    w16(0x073d, 0);
    wr(x, sprite.carry_or_defeat_flags, 0);
    w16(0x06a1, 0);
    w16(0x06a3, 0);
    w16(0x06a5, 0);
    w16(0x065a, KUDGEL_SCRIPT);
    w16(0x0652, 0x0006);
    reg.y = C.special_sprite_spawn_id_015E;
    spawn_big_special_sprite_index();
    const club = r16(R.alternate_sprite);
    reg.y = club;
    x = cur();
    reg.x = x;
    w16(0x0654, x);
    w16(0x0656, club);
    wr(x, 0x42, club);
    wr(x, 0x44, 0);
    parseB6();
  }
  x = cur();
  reg.x = x;
  reg.a = rd(x, 0x2e);
  if (!(reg.a & 0x0001)) {
    reg.a = r16(R.time_stop_flags);
    if (reg.a & 0x0004) {
      reg.db = kudgelDB;
      return;
    }
  }
  // keep the camera centred between Kudgel and the Kong
  w16(0x0ab8, (r16(0x0ab8) & 0xbfff) | 0x8000);
  x = cur();
  reg.x = x;
  reg.y = r16(R.active_kong_sprite);
  reg.a = rd(reg.y, 0x06);
  reg.a = ge(reg.a, rd(x, 0x06)) ? 0xc800 : 0x3800;
  w16(0x0aec, reg.a);
  for (;;) {
    reg.a = r16(0x0652);
    if (reg.a === 0) return kudgel_defeated();
    x = cur();
    reg.x = x;
    reg.a = rd(x, 0x2e);
    if (reg.a & 0x0100 && rd(x, 0x32) & 0x0008) {
      damage_kudgel();
      reg.a = r16(0x0652);
      if (reg.a === 0) continue;
    }
    break;
  }
  reg.a = r16(0x073d);
  if (reg.a !== 0) {
    dec(0, 0x073d);
  } else {
    x = cur();
    reg.x = x;
    reg.a = rd(x, 0x2e);
    if (reg.a & 0x0200) {
      get_current_sprite_clipping();
      reg.a = 0x0c7b;
      check_complex_player_collision_B6();
      if (reg.c) {
        reg.a = 0x001e;
        reg.y = 0xfe00;
        CODE_B3A600();
        x = r16(0x0654);
        reg.x = x;
        wr(x, 0x2e, rd(x, 0x2e) | 0x0200);
        reg.a = 0x0014;
        w16(0x073d, 0x0014);
      }
    } else {
      get_current_sprite_clipping();
      reg.a = 0x0000;
      check_complex_player_collision_B6();
      if (reg.c) {
        reg.x = cur();
        reg.a = 0x0014;
        w16(0x073d, 0x0014);
        reg.x = r16(R.current_held_sprite);
      }
    }
  }
  x = cur();
  reg.x = x;
  reg.a = rd(x, 0x44);
  if (reg.a !== 0) {
    jsrAddr(B6 | reg.a);
    x = cur();
    reg.x = x;
    reg.a = rd(x, 0x44);
    if (reg.a === 0) parseB6();
  } else {
    parseB6();
  }
  ensureTrackedTnt();
  handleStun();
  process_sprite_animation();
  destroyHeldTnt();
  process_kudgel_positioning();
}

/** $B6816B — keep Kudgel inside the arena (x $0120-$0260), the club follows; sprite return. */
export function process_kudgel_positioning(): void {
  const x = cur();
  reg.x = x;
  reg.a = 0x0120;
  if (!(0x0120 < rd(x, 0x06))) wr(x, 0x06, 0x0120);
  reg.a = 0x0260;
  if (!ge(0x0260, rd(x, 0x06))) wr(x, 0x06, 0x0260);
  move_child_to_controller_spr();
  reg.db = kudgelDB;
}

/** `.ensure_kudgel_indexed_tnt_sprite`: forget the tracked barrel if it became something else. */
function ensureTrackedTnt() {
  const y = r16(0x074f);
  reg.y = y;
  if (y === 0) return;
  reg.a = rd(y, sprite.type);
  if (reg.a === C.sprite_tnt_barrel || reg.a === C.sprite_kleever_falling_canball) return;
  w16(0x074f, 0);
}

/**
 * `.handle_kudgel_stun`: while the landing quake lasts, stun the Kong if he stands on the
 * ground. Contains an anti-piracy check (an instruction byte at $808438): on a modified ROM
 * Kudgel loses his club and idles forever.
 */
function handleStun() {
  reg.a = r16(0x074d);
  if (reg.a === 0) return;
  reg.x = 0x8400;
  reg.y = 0x00af; // the word at $808438 on a genuine cartridge (LDA.l opcode + operand); no code to read
  if (reg.y !== 0x00af) {
    w16(0x0656, 0);
    reg.x = r16(0x0654);
    wr(reg.x, 0x44, rd(reg.x, 0x44) - 2);
  }
  dec(0, 0x074d);
  const y = r16(R.active_kong_sprite);
  reg.y = y;
  reg.a = rd(y, sprite.state);
  if (reg.a === C.kong_state_63) return;
  reg.a = rd(y, sprite.interaction_flags);
  if (reg.a & 0x0080) return;
  reg.a = rd(y, sprite.terrain_interaction);
  if (!(reg.a & 0x0001)) return;
  w16(0x074d, 0);
  reg.a = C.player_interaction_0B;
  set_player_interaction_global();
  if (reg.c) return;
  reg.y = (r16(0x0652) << 1) & 0xffff;
  reg.a = lda(STUN_TIMERS + reg.y);
  w16(R.interaction_RAM_0A86, reg.a);
}

/** `.handle_kudgel_destroying_tnt`: Kudgel smashes a TNT barrel the Kong holds or throws. */
function destroyHeldTnt() {
  const x = cur();
  reg.x = x;
  reg.a = rd(x, 0x2e);
  if (reg.a & 0x2000) return;
  if (reg.a & 0x0100) {
    reg.a = rd(x, 0x44);
    if (reg.a !== RET_B6BAD8) return;
    // grounded
    injectHitbox();
    reg.a = 0x0200;
    check_for_sprite_collisions();
    if (!reg.c) return;
    const y = r16(R.colliding_sprite);
    reg.y = y;
    reg.a = rd(y, sprite.type);
    if (reg.a !== C.sprite_tnt_barrel) return;
    reg.a = rd(y, sprite.x_speed);
    if (reg.a !== 0) return;
    reg.a = r16(R.colliding_sprite);
    if (reg.a !== r16(R.current_held_sprite)) return;
  } else {
    injectHitbox();
    reg.a = 0x0200;
    reg.y = 0x0000;
    check_for_sprite_collisions();
    if (!reg.c) return;
    const y = r16(R.colliding_sprite);
    reg.y = y;
    reg.a = rd(y, sprite.type);
    if (reg.a !== C.sprite_tnt_barrel) return;
    reg.a = rd(y, sprite.x_speed);
    if (reg.a === 0) {
      reg.a = r16(R.colliding_sprite);
      if (reg.a !== r16(R.current_held_sprite)) return;
    }
  }
  anims(C.kudgel_fall_attack_anim_id, C.kudgel_club_fall_attack_anim_id);
  reg.x = cur();
  reg.a = rd(reg.x, 0x2e) | 0x2000;
  wr(reg.x, 0x2e, reg.a);
}

/** `.inject_special_hitbox`: Kudgel's club reach (84 px in front of him) in clipping slots 6/8. */
function injectHitbox() {
  const x = reg.x;
  let a: number;
  if (rd(x, 0x12) & 0x4000) {
    a = add(0xffff, rd(x, 0x06));
    w16(CLIP6 + 4, a);
    w16(CLIP8 + 4, a);
    w16(0x0650, a);
    a = add(0xffac, r16(0x0650));
    w16(CLIP6, a);
    w16(CLIP8, a);
  } else {
    a = add(rd(x, 0x06), 0x0001);
    w16(CLIP6, a);
    w16(CLIP8, a);
    a = add(a, 0x0054);
    w16(CLIP6 + 4, a);
    w16(CLIP8 + 4, a);
  }
  const t = rd(x, 0x0a) + 0xffc3;
  a = t & 0xffff;
  w16(CLIP6 + 2, a);
  w16(CLIP8 + 2, a);
  a = (a + 0x0039 + (t > 0xffff ? 1 : 0)) & 0xffff; // ADC without CLC: the carry of the add above
  w16(CLIP6 + 6, a);
  w16(CLIP8 + 6, a);
  reg.a = a;
}

/** $B682DF — Kudgel's club: hurts the Kongs, TNT barrels hitting it hurt Kudgel. */
export function kudgels_club_sprite_code(): void {
  const k = r16(0x0654);
  reg.x = k;
  reg.a = rd(k, 0x2e);
  if (!(reg.a & 0x0001)) {
    reg.a = r16(R.time_stop_flags);
    if (reg.a & 0x0004) return CODE_B684B7();
  }
  CODE_B682F4();
}

/** $B682F4 */
export function CODE_B682F4(): void {
  clubDB = reg.db;
  reg.db = 0xb6;
  reg.a = r16(0x0652);
  if (reg.a === 0) return CODE_B684B6();
  CODE_B68300();
}

/** $B68300 */
export function CODE_B68300(): void {
  process_sprite_animation();
  reg.x = r16(0x0654);
  reg.a = rd(reg.x, 0x2e);
  if (reg.a & 0x0100) {
    reg.x = cur();
    reg.a = rd(reg.x, 0x32);
    if (reg.a & 0x0008) {
      damage_kudgel();
      return CODE_B684B6();
    }
  }
  CODE_B6831D();
}

/** $B6831D */
export function CODE_B6831D(): void {
  reg.x = r16(0x0654);
  reg.a = rd(reg.x, 0x2e);
  if (!(reg.a & 0x2000)) return CODE_B683F7();
  CODE_B6832A();
}

/** $B6832A — the airborne club attack: smash a TNT barrel it touches. */
export function CODE_B6832A(): void {
  get_current_sprite_clipping();
  reg.a = 0x0200;
  reg.y = 0x0000;
  CODE_BEBD8E();
  if (reg.c) {
    w16(R.current_sprite, r16(R.colliding_sprite));
    delete_sprite_handle_deallocation();
    reg.y = C.special_sprite_spawn_id_004A;
    spawn_special_sprite_index();
    reg.y = C.special_sprite_spawn_id_0060;
    spawn_no_gfx_special_sprite_index();
    reg.y = C.special_sprite_spawn_id_0062;
    spawn_no_gfx_special_sprite_index();
    reg.x = r16(0x0656);
    w16(R.current_sprite, reg.x);
    reg.a = r16(0x074f);
    w16(0x074f, 0);
    if (reg.a === r16(R.current_held_sprite)) w16(R.current_held_sprite, 0);
  }
  CODE_B6836B();
}

/** $B6836B */
export function CODE_B6836B(): void {
  reg.x = r16(0x0656);
  reg.a = rd(reg.x, 0x30) & 0xffdf;
  wr(reg.x, 0x30, reg.a);
  reg.x = r16(0x0654);
  wr(reg.x, 0x30, reg.a);
  reg.a = r16(0x073d);
  if (reg.a !== 0) return CODE_B684B6();
  CODE_B68383();
}

/** $B68383 — the club knocks the Kong away (and breaks the TNT barrel he holds). */
export function CODE_B68383(): void {
  get_current_sprite_clipping();
  reg.a = 0x0c7b;
  check_complex_player_collision_B6();
  if (!reg.c) return CODE_B683F7();
  reg.x = r16(0x0654);
  reg.y = r16(R.active_kong_sprite);
  reg.a = rd(reg.x, 0x06);
  if (!ge(reg.a, rd(reg.y, 0x06))) return CODE_B683A2();
  reg.a = 0xfd00;
  CODE_B683A5();
}

/** $B683A2 */
export function CODE_B683A2(): void {
  reg.a = 0x0300;
  CODE_B683A5();
}

/** $B683A5 */
export function CODE_B683A5(): void {
  w16(0x0650, reg.a);
  reg.a = rd(reg.y, 0x12);
  if (reg.a & 0x4000) {
    reg.a = r16(0x0650) ^ 0xffff;
    w16(0x0650, reg.a);
  }
  CODE_B683BC();
}

/** $B683BC */
export function CODE_B683BC(): void {
  reg.y = r16(0x0650);
  reg.a = 0x001e;
  CODE_B3A600();
  reg.x = r16(0x0654);
  w16(0x073d, 0x0014);
  reg.a = r16(R.current_held_sprite);
  if (reg.a !== 0 && reg.a === r16(0x074f)) {
    w16(R.current_sprite, r16(0x074f));
    spawn_barrel_parts_and_smoke_global();
    delete_sprite_handle_deallocation();
    reg.x = r16(0x0656);
    w16(R.current_sprite, reg.x);
    w16(R.current_held_sprite, 0);
    w16(0x074f, 0);
  }
  CODE_B683F4();
}

/** $B683F4 */
export function CODE_B683F4(): void {
  CODE_B684B6();
}

/** $B683F7 */
export function CODE_B683F7(): void {
  reg.x = r16(0x0654);
  reg.a = r16(0x073d);
  if (reg.a !== 0) return CODE_B684B6();
  CODE_B68403();
}

/** $B68403 — dangerous club: the sprite collision routine decides (JML [ptr] with a return). */
export function CODE_B68403(): void {
  reg.a = rd(reg.x, 0x2e);
  if (!(reg.a & 0x0001)) return CODE_B6841D();
  get_current_sprite_clipping();
  reg.a = 0x0010;
  const p = R.sprite_collision_routine_address;
  jslAddr(r16(p) | (r8(p + 2) << 16));
  CODE_B68418();
}

/** $B68418 */
export function CODE_B68418(): void {
  if (reg.c) return CODE_B6843A();
  CODE_B684B6();
}

/** $B6841D */
export function CODE_B6841D(): void {
  reg.x = r16(0x0654);
  reg.a = rd(reg.x, 0x2e);
  if (reg.a & 0x2000) return CODE_B684B6();
  CODE_B6842A();
}

/** $B6842A */
export function CODE_B6842A(): void {
  get_current_sprite_clipping();
  reg.a = 0x0000;
  check_complex_player_collision_B6();
  if (reg.c) return CODE_B6843A();
  CODE_B684B6();
}

/** $B6843A */
export function CODE_B6843A(): void {
  w16(0x073d, 0x0014);
  reg.x = r16(R.current_held_sprite);
  CODE_B68446();
}

/** $B68446 — hit by the dangerous club: knocked off the buddy and sent flying. */
export function CODE_B68446(): void {
  reg.x = r16(0x0654);
  reg.a = rd(reg.x, 0x2e);
  if (!(reg.a & 0x0001)) return CODE_B68488();
  reg.y = r16(R.active_kong_sprite);
  reg.a = rd(reg.y, 0x30);
  if (reg.a & 0x0080) return CODE_B68488();
  CODE_B6800D();
  reg.a = C.player_interaction_26;
  set_player_interaction_global();
  if (reg.c) return CODE_B68488();
  reg.x = r16(0x0654);
  reg.a = rd(reg.x, 0x12);
  if (reg.a & 0x4000) return CODE_B6847C();
  w16(R.interaction_RAM_0A86, 0x0600);
  reg.a = 0x0700;
  CODE_B68485();
}

/** $B6847C */
export function CODE_B6847C(): void {
  w16(R.interaction_RAM_0A86, 0xfa00);
  reg.a = 0xf900;
  CODE_B68485();
}

/** $B68485 */
export function CODE_B68485(): void {
  w16(R.interaction_RAM_0A88, reg.a);
  CODE_B68488();
}

/** $B68488 */
export function CODE_B68488(): void {
  CODE_B684B6();
}

/** $B684B6 */
export function CODE_B684B6(): void {
  reg.db = clubDB;
  CODE_B684B7();
}

/** $B684B7 */
export function CODE_B684B7(): void {}

/** $B684BA — defeated: run the death return code, animate, keep in the arena. */
export function kudgel_defeated(): void {
  reg.x = cur();
  jsrAddr(B6 | rd(reg.x, 0x44));
  process_sprite_animation();
  process_kudgel_positioning();
}

/** $B689F8 — a TNT barrel hit Kudgel: knock him back (or, on the last hit, defeat him). */
export function damage_kudgel(): void {
  reg.a = r16(0x0652);
  if (reg.a === 0x0001) {
    reg.a = snd(5, "kudgel_hit");
    queue_sound_effect();
    w16(0x0652, 0);
    const x = r16(0x0654);
    reg.x = x;
    wr(x, 0x24, 0xf780);
    wr(x, 0x2a, 0xfc80);
    wr(x, 0x20, 0);
    wr(x, 0x26, 0);
    wr(x, 0x44, lo("kudgel_death_return_command"));
    w16(0x0751, 0x0001);
    w16(0x0753, lo("DATA_B68B07"));
    hurtAnims();
    return;
  }
  const x = r16(0x0654);
  reg.x = x;
  reg.y = r16(R.active_kong_sprite);
  reg.a = rd(x, 0x06);
  reg.y = ge(reg.a, rd(reg.y, 0x06)) ? 0x0460 : 0xfba0;
  wr(x, 0x20, reg.y);
  wr(x, 0x2e, (rd(x, 0x2e) | 0x0200) & 0xfeff);
  w16(0x073d, 0x0014);
  wr(x, 0x44, lo("CODE_B68C82"));
  wr(x, 0x24, 0xfc00);
  wr(x, 0x2a, 0x0600);
  wr(x, 0x26, 0);
  reg.a = rd(x, 0x32);
  reg.x = r16(0x0654);
  wr(reg.x, 0x32, 0);
  reg.x = r16(0x0656);
  wr(reg.x, 0x32, 0);
  hurtAnims();
}

function hurtAnims() {
  w16(R.alternate_sprite, r16(0x0654));
  reg.a = C.kudgel_hurt_anim_id;
  set_alt_sprite_animation();
  w16(R.alternate_sprite, r16(0x0656));
  reg.a = C.kudgel_club_hurt_anim_id;
  set_alt_sprite_animation();
}

/** $B68AAB — spawn the next death particle when its timer runs out ($0751, data at $0753). */
export function CODE_B68AAB(): void {
  if (dec(0, 0x0751) !== 0) return CODE_B68AFA();
  let x = r16(0x0753);
  reg.x = x;
  reg.y = lda(x + 0x0a);
  spawn_special_sprite_index();
  const y = r16(R.alternate_sprite);
  reg.y = y;
  reg.a = r16(R.level_number);
  if (reg.a === C.level_krocodile_kore) {
    reg.a = (rd(y, 0x12) & 0xcfff) | 0x2000;
    wr(y, 0x12, reg.a);
  }
  CODE_B68ACF();
}

/** $B68ACF */
export function CODE_B68ACF(): void {
  const x = r16(0x0753);
  reg.x = x;
  const y = reg.y;
  wr(y, 0x20, lda(x));
  wr(y, 0x26, lda(x + 2));
  wr(y, 0x24, lda(x + 4));
  wr(y, 0x2a, lda(x + 6));
  w16(0x0751, lda(x + 8));
  reg.a = add(x, 0x000c);
  w16(0x0753, reg.a);
  CODE_B68AFA();
}

/** $B68AFA */
export function CODE_B68AFA(): void {}

/** $B68BBB — defeated: fly up; at the top fall back down the other way (behind the stage). */
export function kudgel_death_return_command(): void {
  reg.a = 0x0004;
  interpolate_y_velocity_global();
  apply_position_from_velocity_global();
  CODE_B68AAB();
  const x = cur();
  reg.x = x;
  reg.a = rd(x, 0x0a);
  if (!ge(reg.a, 0x0030)) {
    w16(0x0751, 0x0021);
    w16(0x0753, lo("DATA_B68B2B"));
    wr(x, 0x0a, 0x0120);
    wr(x, 0x44, lo("kudgel_death_return_command_2"));
    anims(C.kudgel_death_anim_id, C.kudgel_club_death_anim_id);
    reg.a = snd(7, "kudgel_defeat_airborne");
    queue_sound_effect();
    const k = cur();
    reg.x = k;
    const club = r16(0x0656);
    reg.y = club;
    wr(k, 0x24, 0x0380);
    wr(k, 0x2a, 0x0380);
    wr(k, 0x12, rd(k, 0x12) ^ 0x3000);
    reg.a = rd(club, 0x12) ^ 0x3000;
    wr(club, 0x12, reg.a);
  }
  move_child_to_controller_spr();
}

/** $B68C27 — falling into the swamp: splash, then the fanfare countdown. */
export function kudgel_death_return_command_2(): void {
  apply_position_from_velocity_global();
  CODE_B68AAB();
  const x = cur();
  reg.x = x;
  reg.a = rd(x, 0x0a);
  if (ge(reg.a, 0x0270)) {
    wr(x, 0x44, lo("kudgel_set_fanfare_return_command"));
    w16(0x0747, 0x005a);
    reg.y = C.special_sprite_spawn_id_017A;
    spawn_special_sprite_index();
    reg.a = snd(5, "krool_splash_1");
    queue_sound_effect();
    reg.a = snd(6, "krool_splash_2");
    queue_sound_effect();
    const k = cur();
    reg.x = k;
    const y = r16(R.alternate_sprite);
    reg.y = y;
    wr(y, 0x06, rd(k, 0x06));
    reg.a = 0x01f3;
    wr(y, 0x0a, 0x01f3);
  }
  move_child_to_controller_spr();
}

/** $B68C6B — after $0747 frames: level cleared, Kremcoin interaction. */
export function kudgel_set_fanfare_return_command(): void {
  reg.a = r16(0x0747);
  if (reg.a === 0) return;
  if (dec(0, 0x0747) !== 0) return;
  set_current_level_as_cleared();
  reg.a = C.player_interaction_27;
  set_player_interaction_global();
}

/** $B68C82 — knocked back after a hit; once back on the ground start the next phase's script. */
export function CODE_B68C82(): void {
  reg.a = 0x0006;
  interpolate_x_velocity_global();
  reg.a = 0x0004;
  interpolate_y_velocity_global();
  process_terrain_interaction_global();
  const x = cur();
  reg.x = x;
  reg.a = rd(x, 0x2e);
  if (reg.a & 0x4000) {
    wr(x, 0x2e, reg.a & 0xbdff);
    dec(0, 0x0652);
    reg.y = (r16(0x0652) << 1) & 0xffff;
    reg.a = lda(PHASE_SCRIPTS + reg.y);
    wr(x, 0x46, reg.a);
    parseB6();
  }
  CODE_B68CB3();
}

/** $B68CB3 */
export function CODE_B68CB3(): void {
  move_child_to_controller_spr();
}

/** $B68CB7 — animation callback: Kudgel landed ($2E bit 14). */
export function CODE_B68CB7(): void {
  reg.x = r16(0x0654);
  reg.a = rd(reg.x, 0x2e) | 0x4000;
  wr(reg.x, 0x2e, reg.a);
}

/** $B68CC2 — animation callback: the swing is over, next command. */
export function CODE_B68CC2(): void {
  const db = reg.db;
  reg.db = 0xb6;
  anims(C.kudgel_attack_land_anim_id, C.kudgel_club_idle_anim_id);
  reg.x = r16(0x0654);
  parseB6();
  reg.db = db;
}

/** $B68CE1 — animation callback: club no longer dangerous; airborne: fall pose, else land. */
export function CODE_B68CE1(): void {
  const db = reg.db;
  reg.db = 0xb6;
  reg.x = r16(0x0656);
  reg.a = rd(reg.x, 0x30) | 0x0020;
  wr(reg.x, 0x30, reg.a);
  const x = r16(0x0654);
  reg.x = x;
  wr(x, 0x30, reg.a);
  wr(x, 0x2e, rd(x, 0x2e) & 0xdfff);
  reg.a = rd(x, 0x44);
  if (reg.a === RET_B6BC3E || reg.a === RET_B6BA3F || reg.a === RET_B6BCCF) return CODE_B68D0B(db);
  CODE_B68D21(db);
}

/** $B68D0B */
export function CODE_B68D0B(db = reg.db): void {
  anims(C.kudgel_fall_anim_id, C.kudgel_club_fall_anim_id);
  CODE_B68D35(db);
}

/** $B68D21 */
export function CODE_B68D21(db = reg.db): void {
  anims(C.kudgel_attack_land_anim_id, C.kudgel_club_idle_anim_id);
  CODE_B68D35(db);
}

/** $B68D35 */
export function CODE_B68D35(db = reg.db): void {
  reg.db = db;
}

/** $B68D37 — setup routine of the TNT barrel Kudgel's script spawns ($074F tracks it). */
export function CODE_B68D37(): void {
  const y = r16(R.alternate_sprite);
  reg.y = y;
  w16(0x074f, y);
  wr(y, 0x4e, lo("DATA_FF1D80"));
  wr(y, 0x4a, 0x3eac);
  reg.a = C.tnt_barrel_idle_anim_id;
  set_alt_sprite_animation();
  reg.x = r16(R.alternate_sprite);
  reg.a = C.barrel_sprite_palette;
  set_sprite_palette_global();
}

/** $B68D59 */
export function move_child_to_controller_spr_global(): void {
  move_child_to_controller_spr();
}

/** $B68D5D — the boss's child ($0656) takes the boss's ($0654) position. */
export function move_child_to_controller_spr(): void {
  reg.x = r16(0x0654);
  reg.y = r16(0x0656);
  if (reg.y === 0) return;
  move_sprite_in_y_to_sprite_in_x();
}

/** $B68D65 — sprite Y takes the position of sprite X. */
export function move_sprite_in_y_to_sprite_in_x(): void {
  wr(reg.y, 0x06, rd(reg.x, 0x06));
  reg.a = rd(reg.x, 0x0a);
  wr(reg.y, 0x0a, reg.a);
}

registerSprite({
  sprite_return_handle_despawn_B6, kudgel_sprite_code, process_kudgel_positioning, kudgels_club_sprite_code,
  CODE_B682F4, CODE_B68300, CODE_B6831D, CODE_B6832A, CODE_B6836B, CODE_B68383, CODE_B683A2, CODE_B683A5,
  CODE_B683BC, CODE_B683F4, CODE_B683F7, CODE_B68403, CODE_B68418, CODE_B6841D, CODE_B6842A, CODE_B6843A,
  CODE_B68446, CODE_B6847C, CODE_B68485, CODE_B68488, CODE_B684B6, CODE_B684B7, kudgel_defeated,
});
registerRts({
  CODE_B6800D, CODE_B68022, damage_kudgel, CODE_B68AAB, CODE_B68ACF, CODE_B68AFA, kudgel_death_return_command,
  kudgel_death_return_command_2, kudgel_set_fanfare_return_command, CODE_B68C82, CODE_B68CB3, CODE_B68D37,
  move_child_to_controller_spr, move_sprite_in_y_to_sprite_in_x,
});
registerRtl({
  CODE_B68CB7, CODE_B68CC2, CODE_B68CE1, CODE_B68D0B, CODE_B68D21, CODE_B68D35, move_child_to_controller_spr_global,
});
