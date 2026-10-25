/**
 * Bank $B6 — K. Rool's ammunition: the cannonballs (the spikeball the Kongs can pick up and
 * throw back into his gun, which backfires: that is how he is hurt) and the spiked balls and
 * gas clouds (some stun, slow or confuse the Kongs: $0919/$0925). Also K. Rool's defeat
 * sequence in Krocodile Kore (CODE_B69D96...).
 *
 * Ammo $2E: bit 0 expanded spikeball, 1 expands on landing, 2 rolling, 3 bouncing, 4 knocked,
 * 5 bounced off (falls offscreen), 6 dangerous to K. Rool, 7 waiting ($46 frames) before moving,
 * 8 no terrain, 9/12 swirl path ($22/$28 centre, $4A interpolation presets), 10 stun cloud,
 * 11 slow cloud, 14 straight flight.
 */
import { r16, w16, r8, io8 } from "../../core/mem";
import { reg } from "../../core/cpu";
import { R, C, PPU, sprite } from "../../core/sym";
import {
  release_held_sprite_from_kong, delete_sprite_handle_deallocation, get_current_sprite_clipping,
  check_complex_player_collision_B6, check_for_sprite_collisions, queue_sound_effect, CODE_B6800D,
  interpolate_x_velocity_global, interpolate_y_velocity_global, apply_position_from_velocity_global,
  process_terrain_interaction_global, set_sprite_animation, process_sprite_animation, delete_sprite_if_offscreen,
  spawn_barrel_parts_and_smoke_global, set_alt_sprite_animation, CODE_B6C0FF, CODE_B68AAB, move_child_to_controller_spr,
  spawn_BB83EF_special_sprite_address, set_player_interaction_global, CODE_B3A600,
  set_sprite_palette_global, update_held_sprite_position_global, queue_or_reset_looping_sound_effect,
  process_current_movement,
} from "../../gen/routines";
import { cur, rd, wr, dec, snd, jslAddr, registerSprite, registerRts, registerRtl } from "./b6ba_common";
import { lo, ge, add } from "./w4_b6_util";
import { CODE_B6AD29 } from "./w4_b6_krool_misc";

/** Thrown by CODE_B69E75 (`PLA : BRL CODE_B68F33`): K. Rool's code ends right there. */
export const KROOL_EXIT = Object.freeze({ kroolExit: true });

let canDB = 0;
let spDB = 0;

const held = () => r16(R.current_held_sprite);
const isHeld = (x: number) => x === held();
const krool1C = () => rd(r16(0x0654), 0x1c) & 0xc000;
const collisionRoutine = () => {
  const p = R.sprite_collision_routine_address;
  return r16(p) | (r8(p + 2) << 16);
};

/** $B69A5A — a cannonball / the spikeball. */
export function krool_canball_sprite_code(): void {
  canDB = reg.db;
  reg.db = 0xb6;
  reg.a = r16(0x06a3);
  if (reg.a & 0x0100) {
    release_held_sprite_from_kong();
    w16(0x0735, 0);
    delete_sprite_handle_deallocation();
    CODE_B6AD29(0x9a72); // JSR at $B69A70
    return CODE_B69C37();
  }
  CODE_B69A76();
}

/** $B69A76 */
export function CODE_B69A76(): void {
  reg.x = cur();
  reg.a = rd(reg.x, 0x2e);
  if (reg.a & 0x0020) return CODE_B69C6A();
  CODE_B69A82();
}

/** $B69A82 */
export function CODE_B69A82(): void {
  if (isHeld(reg.x)) return CODE_B69C64();
  CODE_B69A8A();
}

/** $B69A8A */
export function CODE_B69A8A(): void {
  reg.a = rd(reg.x, 0x2e);
  if (reg.a & 0x0200) return CODE_B69A98();
  reg.a = rd(reg.x, 0x2e);
  if (!(reg.a & 0x0080)) return CODE_B69AA5();
  CODE_B69A98();
}

/** $B69A98 — hurts the Kongs. */
export function CODE_B69A98(): void {
  get_current_sprite_clipping();
  reg.a = 0x0000;
  check_complex_player_collision_B6();
  reg.x = cur();
  CODE_B69AA5();
}

/** $B69AA5 */
export function CODE_B69AA5(): void {
  if (!isHeld(reg.x)) {
    reg.a = rd(reg.x, 0x2e);
    if (reg.a & 0x0080) return CODE_B69B58();
  }
  CODE_B69AB4();
}

/** $B69AB4 */
export function CODE_B69AB4(): void {
  reg.a = rd(reg.x, 0x2e);
  if (reg.a & 0x0010) return CODE_B69B58();
  CODE_B69ABE();
}

/** $B69ABE — collisions with K. Rool, his gun and the other balls. */
export function CODE_B69ABE(): void {
  get_current_sprite_clipping();
  reg.a = 0x0020;
  check_for_sprite_collisions();
  if (!reg.c) return CODE_B69B30();
  reg.y = r16(R.colliding_sprite);
  reg.a = rd(reg.y, sprite.type);
  if (reg.a !== C.sprite_krool_gun) return CODE_B69AE8();
  reg.y = r16(0x0654);
  reg.a = rd(reg.y, 0x1c) & 0xc000;
  if (reg.a === 0) return CODE_B69CD4();
  CODE_B69AE3();
}

/** $B69AE3 */
export function CODE_B69AE3(): void {
  reg.y = r16(R.colliding_sprite);
  reg.a = rd(reg.y, sprite.type);
  CODE_B69AE8();
}

/** $B69AE8 — hit K. Rool himself: bounce off (while he is visible). */
export function CODE_B69AE8(): void {
  if (reg.a !== C.sprite_krool) return CODE_B69B1B();
  reg.y = r16(0x0654);
  reg.a = krool1C();
  if (reg.a !== 0) return CODE_B69B16();
  reg.a = snd(5, "krool_ammo_bounce");
  queue_sound_effect();
  CODE_B6800D();
  reg.x = cur();
  reg.a = rd(reg.x, 0x2e);
  if (reg.a & 0x0010) return CODE_B69B30();
  CODE_B69B0E();
}

/** $B69B0E */
export function CODE_B69B0E(): void {
  reg.x = cur();
  CODE_B69E7D();
  CODE_B69BC5();
}

/** $B69B16 */
export function CODE_B69B16(): void {
  reg.y = r16(R.colliding_sprite);
  reg.a = rd(reg.y, sprite.type);
  CODE_B69B1B();
}

/** $B69B1B — two balls knock each other away. */
export function CODE_B69B1B(): void {
  if (reg.a !== C.sprite_krool_canball) return CODE_B69B30();
  reg.a = rd(reg.y, 0x2e);
  if (reg.a & 0x0040) return CODE_B69B30();
  CODE_B69EB0();
  reg.x = cur();
  CODE_B69BC5();
}

/** $B69B30 */
export function CODE_B69B30(): void {
  if (reg.a !== C.sprite_spiked_canballs) return CODE_B69B45();
  reg.a = rd(reg.y, 0x2e);
  if (reg.a & 0x0040) return CODE_B69B45();
  CODE_B69EB0();
  reg.x = cur();
  CODE_B69BC5();
}

/** $B69B45 */
export function CODE_B69B45(): void {
  if (isHeld(reg.x)) return CODE_B69C64();
  CODE_B69B4D();
}

/** $B69B4D */
export function CODE_B69B4D(): void {
  reg.x = cur();
  reg.a = rd(reg.x, 0x2e);
  if (!(reg.a & 0x0008)) wr(reg.x, 0x26, 0);
  CODE_B69B58();
}

/** $B69B58 — on the ground: bounce or roll. */
export function CODE_B69B58(): void {
  const x = reg.x;
  reg.a = rd(x, 0x1e);
  if (reg.a & 0x0001) {
    reg.a = rd(x, 0x2e);
    if (reg.a & 0x0008) {
      wr(x, 0x24, 0);
      wr(x, 0x2a, 0);
    } else {
      return CODE_B69B6C();
    }
  }
  CODE_B69B94();
}

/** $B69B6C */
export function CODE_B69B6C(): void {
  reg.a = rd(reg.x, 0x24);
  if (!ge(reg.a, 0x02ff)) return CODE_B69B9E();
  bounceUp();
  CODE_B69B94();
}

/** A landing fast enough: bounce back up. */
function bounceUp() {
  wr(reg.x, 0x24, (-reg.a) & 0xffff);
  const x = cur();
  reg.x = x;
  wr(x, 0x2a, 0x0600);
  wr(x, 0x42, 0x0009);
  wr(x, 0x44, 0x0009);
  reg.a = (rd(x, 0x2e) | 0x0048) & 0xff7f;
  wr(x, 0x2e, reg.a);
}

/** $B69B94 */
export function CODE_B69B94(): void {
  reg.a = rd(reg.x, 0x1e) & 0x0101;
  if (reg.a !== 0x0101) return CODE_B69BB7();
  CODE_B69B9E();
}

/** $B69B9E — settled: roll. */
export function CODE_B69B9E(): void {
  settle();
  reg.x = cur();
  CODE_B69BC5();
}

function settle() {
  const x = reg.x;
  wr(x, 0x24, 0);
  wr(x, 0x2a, 0);
  wr(x, 0x26, 0);
  wr(x, 0x2e, (rd(x, 0x2e) & 0xfff7) | 0x0004);
  reg.a = 0x000a;
  wr(x, 0x42, 0x000a);
}

/** $B69BB7 */
export function CODE_B69BB7(): void {
  if (reg.a === 0x0001) {
    reg.a = snd(5, "krool_ammo_bounce");
    queue_sound_effect();
    reg.x = cur();
  }
  CODE_B69BC5();
}

/** $B69BC5 — move (after the start delay). */
export function CODE_B69BC5(): void {
  const x = reg.x;
  reg.a = rd(x, 0x2e);
  if (reg.a & 0x0080) {
    reg.a = rd(x, 0x46);
    if (reg.a !== 0) {
      dec(x, 0x46);
      return CODE_B69BE2();
    }
  }
  CODE_B69BD4();
}

/** $B69BD4 */
export function CODE_B69BD4(): void {
  interpolate();
  CODE_B69BE2();
}

function interpolate() {
  let x = reg.x;
  reg.a = rd(x, 0x42);
  interpolate_x_velocity_global();
  x = cur();
  reg.x = x;
  reg.a = rd(x, 0x44);
  interpolate_y_velocity_global();
}

/** $B69BE2 */
export function CODE_B69BE2(): void {
  reg.x = cur();
  reg.a = rd(reg.x, 0x2e);
  if (!(reg.a & 0x0100)) return CODE_B69BF7();
  apply_position_from_velocity_global();
  CODE_B69C87();
  if (reg.c) return CODE_B69C37();
  CODE_B69BFB();
}

/** $B69BF7 */
export function CODE_B69BF7(): void {
  process_terrain_interaction_global();
  CODE_B69BFB();
}

/** $B69BFB — stopped: the spikeball expands, a ball becomes throwable. */
export function CODE_B69BFB(): void {
  reg.a = rd(reg.x, 0x20);
  if (reg.a !== 0) return CODE_B69C20();
  wr(reg.x, 0x04, 0);
  const x = cur();
  reg.x = x;
  reg.a = rd(x, 0x2e);
  if (reg.a & 0x0001) return CODE_B69C20();
  if (!(reg.a & 0x0002)) return CODE_B69C3B();
  wr(x, 0x2e, (rd(x, 0x2e) | 0x0001) & 0xfffd);
  reg.a = C.krool_spikeball_expanded_anim_id;
  set_sprite_animation();
  CODE_B69C20();
}

/** $B69C20 */
export function CODE_B69C20(): void {
  process_sprite_animation();
  CODE_B69C24();
}

/** Hidden while the vacuum pulls ($06A3 bit 7 clear). */
function visibility() {
  const x = cur();
  reg.x = x;
  reg.y = r16(0x06a3) & 0x0080 ? 0x0000 : 0xc000;
  wr(x, 0x1c, reg.y);
}

/** $B69C24 */
export function CODE_B69C24(): void {
  visibility();
  CODE_B69C35();
}

/** $B69C35 — (the store; reached through CODE_B69C24). */
export function CODE_B69C35(): void {
  CODE_B69C37();
}

/** $B69C37 */
export function CODE_B69C37(): void {
  reg.db = canDB;
}

/** Stopped ball: can be picked up; its $32 hit flags. */
function pickable(next: () => void, toHeld: () => void) {
  const x = reg.x;
  wr(x, 0x30, rd(x, 0x30) | 0x0001);
  reg.a = held();
  if (reg.a === cur()) return toHeld();
  wr(x, 0x2e, rd(x, 0x2e) | 0x0010);
  reg.a = rd(x, 0x32);
  if (reg.a === 0) return next();
  wr(x, 0x32, 0);
  if (reg.a !== 0x0001) return next();
  reg.a = 0xfffc & rd(x, 0x30);
  wr(x, 0x30, reg.a);
  next();
}

/** $B69C3B */
export function CODE_B69C3B(): void {
  pickable(CODE_B69C24, CODE_B69C64);
}

/** $B69C64 — held by the Kong. */
export function CODE_B69C64(): void {
  CODE_B6A1C2();
  CODE_B69C24();
}

/** $B69C6A */
export function CODE_B69C6A(): void {
  CODE_B69C70();
  CODE_B69C20();
}

/** $B69C70 — bounced off: fly away and vanish offscreen. */
export function CODE_B69C70(): void {
  interpolate();
  apply_position_from_velocity_global();
  delete_sprite_if_offscreen();
}

/** $B69C87 — outside the arena (x < $E8 or >= $0312): deleted, carry set. */
export function CODE_B69C87(): void {
  reg.x = cur();
  reg.a = rd(reg.x, 0x06);
  if (!ge(reg.a, 0x00e8) || ge(reg.a, 0x0312)) return CODE_B69C95();
  CODE_B69C9D();
}

/** $B69C95 */
export function CODE_B69C95(): void {
  delete_sprite_handle_deallocation();
  reg.x = cur();
  reg.c = true;
}

/** $B69C9D */
export function CODE_B69C9D(): void {
  reg.c = false;
}

/** $B69C9F — knocked out of the Kong's hands: fly up and away. Carry set. */
export function CODE_B69C9F(): void {
  reg.a = held();
  if (reg.a === cur()) return CODE_B69CAF();
  reg.a = rd(reg.x, 0x20);
  if (!(reg.a & 0x8000)) return CODE_B69CBA();
  CODE_B69CAA();
}

/** $B69CAA */
export function CODE_B69CAA(): void {
  reg.a = 0x0400;
  CODE_B69CBD();
}

/** $B69CAF */
export function CODE_B69CAF(): void {
  reg.y = r16(R.active_kong_sprite);
  reg.a = rd(reg.y, 0x12);
  if (reg.a & 0x4000) return CODE_B69CAA();
  CODE_B69CBA();
}

/** $B69CBA */
export function CODE_B69CBA(): void {
  reg.a = 0xfc00;
  CODE_B69CBD();
}

/** $B69CBD */
export function CODE_B69CBD(): void {
  const x = reg.x;
  wr(x, 0x20, reg.a);
  wr(x, 0x24, 0xf610);
  wr(x, 0x26, 0);
  wr(x, 0x2a, 0x1000);
  reg.a = rd(x, 0x30) & 0xfffe;
  wr(x, 0x30, reg.a);
  reg.c = true;
}

/** $B69CD4 — the ball went into the gun: K. Rool is hurt (while vacuuming), else it bounces. */
export function CODE_B69CD4(): void {
  reg.a = r16(0x072d);
  if (reg.a !== 0) return CODE_B69CEC();
  reg.a = snd(5, "krool_ammo_bounce");
  queue_sound_effect();
  CODE_B6800D();
  reg.x = cur();
  CODE_B69E7D();
  CODE_B69BC5();
}

/** $B69CEC */
export function CODE_B69CEC(): void {
  CODE_B69CF2();
  CODE_B69C24();
}

/** $B69CF2 — the gun backfires: the hit on K. Rool. */
export function CODE_B69CF2(): void {
  reg.a = snd(7, "krool_gun_exhaust");
  queue_sound_effect();
  reg.y = r16(0x073b);
  if (reg.y !== 0) {
    const x = cur();
    reg.x = x;
    w16(R.current_sprite, reg.y);
    delete_sprite_handle_deallocation();
    spawn_barrel_parts_and_smoke_global();
    reg.x = x;
    w16(R.current_sprite, x);
  }
  CODE_B69D0E();
}

/** $B69D0E */
export function CODE_B69D0E(): void {
  w16(0x06a3, r16(0x06a3) | 0x0100);
  CODE_B6800D();
  w16(0x072d, 0);
  reg.a = r16(R.level_number);
  if (reg.a !== C.level_krocodile_kore) return CODE_B69D44();
  const x = r16(0x0654);
  reg.x = x;
  w16(R.alternate_sprite, x);
  wr(x, 0x2e, rd(x, 0x2e) | 0x2000);
  reg.a = C.krool_lost_final_hit_anim_id;
  set_alt_sprite_animation();
  w16(R.alternate_sprite, r16(0x0656));
  reg.a = C.krool_lost_gun_final_hit_anim_id;
  CODE_B69D75();
}

/** $B69D44 */
export function CODE_B69D44(): void {
  w16(R.alternate_sprite, r16(0x0654));
  reg.a = r16(0x0652);
  if (reg.a === 0x0001) return CODE_B69D65();
  reg.a = C.krool_backfire_anim_id;
  set_alt_sprite_animation();
  w16(R.alternate_sprite, r16(0x0656));
  reg.a = C.krool_gun_backfire_anim_id;
  CODE_B69D75();
}

/** $B69D65 */
export function CODE_B69D65(): void {
  reg.a = C.krool_backfire_final_anim_id;
  set_alt_sprite_animation();
  w16(R.alternate_sprite, r16(0x0656));
  reg.a = C.krool_gun_backfire_final_anim_id;
  CODE_B69D75();
}

/** $B69D75 */
export function CODE_B69D75(): void {
  set_alt_sprite_animation();
  const x = cur();
  reg.x = x;
  CODE_B6C0FF();
  reg.x = x;
  w16(R.current_sprite, x);
  reg.y = r16(0x0654);
  wr(reg.y, 0x44, lo("boss_command_return"));
  release_held_sprite_from_kong();
  w16(0x0735, 0);
  delete_sprite_handle_deallocation();
}

/** $B69D96 — animation callback: Krocodile Kore K. Rool defeated (flies up). */
export function CODE_B69D96(): void {
  w16(0x0652, 0);
  const x = reg.x;
  wr(x, 0x24, 0xf780);
  wr(x, 0x2a, 0xfc80);
  wr(x, 0x20, 0);
  wr(x, 0x26, 0);
  wr(x, 0x44, lo("CODE_B69DC2"));
  w16(0x0751, 0x0001);
  w16(0x0753, lo("DATA_B68AFB"));
  reg.a = snd(5, "krool_down");
  queue_sound_effect();
}

/** $B69DC2 — up and off the top; then falling into the map (behind, sub screen). */
export function CODE_B69DC2(): void {
  reg.a = 0x0004;
  interpolate_y_velocity_global();
  apply_position_from_velocity_global();
  CODE_B68AAB();
  let x = cur();
  reg.x = x;
  reg.a = rd(x, 0x0a);
  if (!ge(reg.a, 0x0060)) {
    wr(x, 0x06, 0x0200);
    io8(PPU.sub_screen, 0x02);
    w16(0x0751, 0x0028);
    w16(0x0753, lo("DATA_B68B2B"));
    wr(x, 0x0a, 0x00c6);
    wr(x, 0x44, lo("CODE_B69E33"));
    reg.a = C.krool_map_fall_anim_id;
    set_sprite_animation();
    const gun = r16(0x0656);
    reg.x = gun;
    w16(R.alternate_sprite, gun);
    wr(gun, 0x1c, 0xc000);
    reg.a = C.krool_map_fall_anim_id;
    set_alt_sprite_animation();
    x = cur();
    reg.x = x;
    reg.y = r16(0x0656);
    wr(x, 0x24, 0x0280);
    wr(x, 0x12, rd(x, 0x12) ^ 0x1000);
    reg.a = snd(7, "kudgel_defeat_airborne");
    queue_sound_effect();
  }
  CODE_B69E2F();
}

/** $B69E2F */
export function CODE_B69E2F(): void {
  move_child_to_controller_spr();
}

/** $B69E33 — fallen: the sparkles, the gun goes, K. Rool's code ends (CODE_B69E75). */
export function CODE_B69E33(): void {
  apply_position_from_velocity_global();
  CODE_B68AAB();
  let x = cur();
  reg.x = x;
  reg.a = rd(x, 0x0a);
  if (!ge(reg.a, 0x0180)) return CODE_B69E79();
  w16(0x06a5, r16(0x06a5) | 0x0200);
  reg.y = lo("DATA_FF281C");
  spawn_BB83EF_special_sprite_address();
  reg.x = r16(R.alternate_sprite);
  wr(reg.x, 0x44, 0x02bc);
  x = cur();
  w16(R.current_sprite, r16(0x0656));
  reg.x = r16(0x0656);
  delete_sprite_handle_deallocation();
  reg.x = x;
  w16(R.current_sprite, x);
  wr(x, 0x44, lo("CODE_B69E75"));
  wr(x, 0x1c, 0xc000);
  CODE_B69E75();
}

/** $B69E75 — `PLA : BRL CODE_B68F33`: drop the return code's return and leave K. Rool's code. */
export function CODE_B69E75(): void {
  throw KROOL_EXIT;
}

/** $B69E79 */
export function CODE_B69E79(): void {
  move_child_to_controller_spr();
}

/** $B69E7D — knocked: fly up and back. */
export function CODE_B69E7D(): void {
  wr(reg.x, 0x2e, rd(reg.x, 0x2e) | 0x0010);
  reg.a = rd(reg.x, 0x20);
  if (!(reg.a & 0x8000)) return CODE_B69E8D();
  reg.a = 0x0400;
  CODE_B69E90();
}

/** $B69E8D */
export function CODE_B69E8D(): void {
  reg.a = 0xfc00;
  CODE_B69E90();
}

/** $B69E90 */
export function CODE_B69E90(): void {
  const x = reg.x;
  wr(x, 0x20, reg.a);
  wr(x, 0x24, 0xf610);
  wr(x, 0x26, 0);
  wr(x, 0x2a, 0x1000);
  wr(x, 0x42, 0x0007);
  wr(x, 0x44, 0x0007);
  reg.a = rd(x, 0x30) & 0xfffe;
  wr(x, 0x30, reg.a);
}

/** $B69EB0 — two balls collide: both knocked away from each other (the other one higher). */
export function CODE_B69EB0(): void {
  reg.x = cur();
  CODE_B69E7D();
  const x = r16(R.colliding_sprite);
  reg.x = x;
  wr(x, 0x2e, rd(x, 0x2e) | 0x0020);
  CODE_B69E7D();
  reg.a = add(((rd(x, 0x24) >> 1) | 0x8000) & 0xffff, rd(x, 0x24));
  wr(x, 0x24, reg.a);
  const y = cur();
  reg.y = y;
  reg.a = rd(y, 0x06);
  if (ge(reg.a, rd(x, 0x06))) return CODE_B69EDE();
  wr(y, 0x20, 0xfc00);
  reg.a = 0x0400;
  CODE_B69EE7();
}

/** $B69EDE */
export function CODE_B69EDE(): void {
  wr(reg.y, 0x20, 0x0400);
  reg.a = 0xfc00;
  CODE_B69EE7();
}

/** $B69EE7 */
export function CODE_B69EE7(): void {
  wr(reg.x, 0x20, reg.a);
}

// ---------------------------------------------------------------- spiked balls and gas clouds

/** $B69EEA — spiked balls / gas clouds. */
export function spiked_canballs_sprite_code(): void {
  spDB = reg.db;
  reg.db = 0xb6;
  reg.a = r16(0x06a3);
  if (reg.a & 0x0100) {
    release_held_sprite_from_kong();
    w16(0x0735, 0);
    delete_sprite_handle_deallocation();
    CODE_B6AD29(0x9f02); // JSR at $B69F00
    return CODE_B6A18F();
  }
  CODE_B69F06();
}

/** $B69F06 */
export function CODE_B69F06(): void {
  reg.x = cur();
  reg.a = rd(reg.x, 0x2e);
  if (reg.a & 0x0020) return CODE_B6A27A();
  CODE_B69F12();
}

/** $B69F12 */
export function CODE_B69F12(): void {
  if (isHeld(reg.x)) return CODE_B6A1BC();
  CODE_B69F1A();
}

/** $B69F1A */
export function CODE_B69F1A(): void {
  reg.a = rd(reg.x, 0x2e);
  if (!(reg.a & 0x1c00)) return CODE_B69F96();
  CODE_B69F24();
}

/** $B69F24 — a gas cloud touched by the Kong (sprite collision routine). */
export function CODE_B69F24(): void {
  get_current_sprite_clipping();
  reg.a = 0x0010;
  jslAddr(collisionRoutine());
  CODE_B69F32();
}

/** $B69F32 — gas effects: stun cloud (interaction $24), slow (2), confusion (1, Krocodile Kore). */
export function CODE_B69F32(): void {
  if (!reg.c) return CODE_B69F6E();
  reg.x = cur();
  reg.a = r16(R.level_number);
  if (reg.a === C.level_krocodile_kore) return CODE_B69F89();
  reg.a = rd(reg.x, 0x2e);
  if (!(reg.a & 0x0400)) return CODE_B69F71();
  reg.a = C.player_interaction_24;
  set_player_interaction_global();
  if (reg.c) return CODE_B69F6E();
  w16(R.interaction_RAM_0A86, 0x0013);
  reg.a = held();
  if (reg.a !== 0) {
    release_held_sprite_from_kong();
    if (reg.c) {
      reg.x = cur();
      CODE_B6A3A1();
      wr(reg.x, 0x44, 0x000b);
    }
  }
  CODE_B69F67();
}

/** $B69F67 */
export function CODE_B69F67(): void {
  delete_sprite_handle_deallocation();
  CODE_B6A18F();
}

/** $B69F6E */
export function CODE_B69F6E(): void {
  CODE_B69FFC();
}

/** $B69F71 */
export function CODE_B69F71(): void {
  if (!(reg.a & 0x0800)) return CODE_B69F89();
  reg.a = r16(0x0919);
  if (reg.a !== 0) return CODE_B69F67();
  reg.a ^= 0x0002;
  w16(0x0919, reg.a);
  w16(0x0925, 0x0100);
  CODE_B69F67();
}

/** $B69F89 */
export function CODE_B69F89(): void {
  reg.a = r16(0x0919);
  if (reg.a !== 0) return CODE_B69F67();
  reg.a ^= 0x0001;
  w16(0x0919, reg.a);
  CODE_B69F67();
}

/** $B69F96 — a ball in a barrel (the spikeball's shell): breaks when the Kong jumps on it. */
export function CODE_B69F96(): void {
  if (!(reg.a & 0x0080)) return CODE_B69FFE();
  CODE_B69F9E();
}

/** $B69F9E */
export function CODE_B69F9E(): void {
  get_current_sprite_clipping();
  reg.a = r16(0x0735);
  if (reg.a !== cur()) return CODE_B69FAF();
  reg.a = 0x0c18;
  CODE_B69FB2();
}

/** $B69FAF */
export function CODE_B69FAF(): void {
  reg.a = 0x0000;
  CODE_B69FB2();
}

/** $B69FB2 */
export function CODE_B69FB2(): void {
  check_complex_player_collision_B6();
  if (!reg.c) return CODE_B69FFC();
  // Z of the PLX that ends the collision check (the caller's X), then the collision type
  if ((reg.x & 0xffff) !== 0 && reg.a !== 0x0002) return CODE_B69FFC();
  CODE_B69FBF();
}

/** $B69FBF */
export function CODE_B69FBF(): void {
  reg.a = 0x001e;
  reg.y = 0xff00;
  CODE_B3A600();
  spawn_barrel_parts_and_smoke_global();
  reg.a = C.krool_canball_from_barrel_anim_id;
  set_sprite_animation();
  reg.x = cur();
  reg.a = C.canball_sprite_palette;
  set_sprite_palette_global();
  const x = cur();
  reg.x = x;
  CODE_B6A3A1();
  wr(x, 0x42, 0);
  wr(x, 0x44, 0x000b);
  wr(x, 0x2e, rd(x, 0x2e) & 0xe17c);
  reg.a = rd(x, 0x06);
  if (ge(reg.a, 0x028a)) {
    reg.a = 0x0289;
    wr(x, 0x06, 0x0289);
  }
  CODE_B69FFC();
}

/** $B69FFC */
export function CODE_B69FFC(): void {
  reg.x = cur();
  CODE_B69FFE();
}

/** $B69FFE — dispatch on the kind of shot. */
export function CODE_B69FFE(): void {
  if (isHeld(reg.x)) return CODE_B6A045();
  reg.a = rd(reg.x, 0x2e);
  if (reg.a & 0x0001) return CODE_B6A280();
  CODE_B6A00D();
}

/** $B6A00D */
export function CODE_B6A00D(): void {
  if (reg.a & 0x0002) return CODE_B6A2A5();
  CODE_B6A015();
}

/** $B6A015 */
export function CODE_B6A015(): void {
  if (reg.a & 0x0200) return CODE_B6A2E2();
  CODE_B6A01D();
}

/** $B6A01D */
export function CODE_B6A01D(): void {
  if (reg.a & 0x0400) return CODE_B6A280();
  CODE_B6A025();
}

/** $B6A025 */
export function CODE_B6A025(): void {
  if (reg.a & 0x0800) return CODE_B6A2A5();
  CODE_B6A02D();
}

/** $B6A02D */
export function CODE_B6A02D(): void {
  if (reg.a & 0x1000) return CODE_B6A2E2();
  CODE_B6A035();
}

/** $B6A035 */
export function CODE_B6A035(): void {
  if (reg.a & 0x4000) return CODE_B6A378();
  CODE_B6A03D();
}

/** $B6A03D */
export function CODE_B6A03D(): void {
  if (reg.a & 0x0080) return CODE_B6A0C5();
  CODE_B6A045();
}

/** $B6A045 — a ball: collisions with K. Rool, his gun and the other balls. */
export function CODE_B6A045(): void {
  reg.a = rd(reg.x, 0x2e);
  if (reg.a & 0x0010) return CODE_B6A0C5();
  get_current_sprite_clipping();
  reg.a = 0x0020;
  check_for_sprite_collisions();
  if (!reg.c) return CODE_B6A0B2();
  reg.y = r16(R.colliding_sprite);
  reg.a = rd(reg.y, sprite.type);
  if (reg.a !== C.sprite_krool_gun) return CODE_B6A076();
  reg.y = r16(0x0654);
  reg.a = rd(reg.y, 0x1c) & 0xc000;
  if (reg.a === 0) return CODE_B6A3B0();
  CODE_B6A071();
}

/** $B6A071 */
export function CODE_B6A071(): void {
  reg.y = r16(R.colliding_sprite);
  reg.a = rd(reg.y, sprite.type);
  CODE_B6A076();
}

/** $B6A076 */
export function CODE_B6A076(): void {
  if (reg.a !== C.sprite_krool) return CODE_B6A09D();
  reg.y = r16(0x0654);
  reg.a = krool1C();
  if (reg.a !== 0) return CODE_B6A098();
  reg.a = snd(5, "krool_ammo_bounce");
  queue_sound_effect();
  CODE_B6800D();
  reg.x = cur();
  CODE_B69E7D();
  CODE_B6A130();
}

/** $B6A098 */
export function CODE_B6A098(): void {
  reg.y = r16(R.colliding_sprite);
  reg.a = rd(reg.y, sprite.type);
  CODE_B6A09D();
}

/** $B6A09D */
export function CODE_B6A09D(): void {
  if (reg.a !== C.sprite_spiked_canballs) return CODE_B6A0B2();
  reg.a = rd(reg.y, 0x2e);
  if (reg.a & 0x0040) return CODE_B6A0B2();
  CODE_B69EB0();
  reg.x = cur();
  CODE_B6A130();
}

/** $B6A0B2 */
export function CODE_B6A0B2(): void {
  if (isHeld(reg.x)) return CODE_B6A1BC();
  CODE_B6A0BA();
}

/** $B6A0BA */
export function CODE_B6A0BA(): void {
  reg.x = cur();
  reg.a = rd(reg.x, 0x2e);
  if (!(reg.a & 0x0008)) wr(reg.x, 0x26, 0);
  CODE_B6A0C5();
}

/** $B6A0C5 */
export function CODE_B6A0C5(): void {
  const x = reg.x;
  reg.a = rd(x, 0x1e);
  if (reg.a & 0x0001) {
    reg.a = rd(x, 0x2e);
    if (reg.a & 0x0008) {
      wr(x, 0x24, 0);
      wr(x, 0x2a, 0);
    } else {
      return CODE_B6A0D9();
    }
  }
  CODE_B6A0FF();
}

/** $B6A0D9 */
export function CODE_B6A0D9(): void {
  reg.a = rd(reg.x, 0x24);
  if (!ge(reg.a, 0x02ff)) return CODE_B6A109();
  const x = reg.x;
  wr(x, 0x24, (-reg.a) & 0xffff);
  wr(x, 0x2a, 0x0600);
  wr(x, 0x42, 0x0009);
  wr(x, 0x44, 0x0009);
  reg.a = (rd(x, 0x2e) | 0x0048) & 0xff7f;
  wr(x, 0x2e, reg.a);
  CODE_B6A0FF();
}

/** $B6A0FF */
export function CODE_B6A0FF(): void {
  reg.a = rd(reg.x, 0x1e) & 0x0101;
  if (reg.a !== 0x0101) return CODE_B6A122();
  CODE_B6A109();
}

/** $B6A109 */
export function CODE_B6A109(): void {
  settle();
  reg.x = cur();
  CODE_B6A130();
}

/** $B6A122 */
export function CODE_B6A122(): void {
  if (reg.a === 0x0001) {
    reg.a = snd(5, "krool_ammo_bounce");
    queue_sound_effect();
    reg.x = cur();
  }
  CODE_B6A130();
}

/** $B6A130 */
export function CODE_B6A130(): void {
  const x = reg.x;
  reg.a = rd(x, 0x2e);
  if (reg.a & 0x0080) {
    reg.a = rd(x, 0x46);
    if (reg.a !== 0) {
      dec(x, 0x46);
      return CODE_B6A14D();
    }
  }
  CODE_B6A13F();
}

/** $B6A13F */
export function CODE_B6A13F(): void {
  interpolate();
  CODE_B6A14D();
}

/** $B6A14D */
export function CODE_B6A14D(): void {
  reg.x = cur();
  reg.a = rd(reg.x, 0x2e);
  if (!(reg.a & 0x0100)) return CODE_B6A162();
  apply_position_from_velocity_global();
  CODE_B69C87();
  if (reg.c) return CODE_B6A18F();
  CODE_B6A166();
}

/** $B6A162 */
export function CODE_B6A162(): void {
  process_terrain_interaction_global();
  CODE_B6A166();
}

/** $B6A166 */
export function CODE_B6A166(): void {
  reg.a = rd(reg.x, 0x20);
  if (reg.a !== 0) return CODE_B6A178();
  wr(reg.x, 0x04, 0);
  reg.a = rd(reg.x, 0x2e);
  if (!(reg.a & 0x0040)) return CODE_B6A178();
  reg.x = cur();
  CODE_B6A193();
}

/** $B6A178 */
export function CODE_B6A178(): void {
  process_sprite_animation();
  CODE_B6A17C();
}

/** $B6A17C */
export function CODE_B6A17C(): void {
  visibility();
  CODE_B6A18D();
}

/** $B6A18D — (the store; reached through CODE_B6A17C). */
export function CODE_B6A18D(): void {
  CODE_B6A18F();
}

/** $B6A18F */
export function CODE_B6A18F(): void {
  reg.db = spDB;
}

/** $B6A193 */
export function CODE_B6A193(): void {
  pickable(CODE_B6A17C, CODE_B6A1BC);
}

/** $B6A1BC */
export function CODE_B6A1BC(): void {
  CODE_B6A1C2();
  CODE_B6A17C();
}

/** $B6A1C2 — a ball held by the Kong: knocked away by another ball, or its $32 hit flags. */
export function CODE_B6A1C2(): void {
  let x = cur();
  reg.x = x;
  wr(x, 0x2e, rd(x, 0x2e) & 0xfff7);
  get_current_sprite_clipping();
  reg.a = 0x0020;
  check_for_sprite_collisions();
  if (!reg.c) return CODE_B6A1F7();
  reg.y = r16(R.colliding_sprite);
  reg.a = rd(reg.y, sprite.type);
  if (reg.a !== C.sprite_krool_canball) return CODE_B6A1F7();
  reg.y = r16(R.colliding_sprite);
  reg.a = rd(reg.y, 0x2e);
  if (!(reg.a & 0x0080)) return CODE_B6A1F7();
  w16(R.current_held_sprite, 0);
  CODE_B69EB0();
  reg.x = cur();
  CODE_B6A24E();
}

/** $B6A1F7 */
export function CODE_B6A1F7(): void {
  if (reg.a !== 0x02a0) return CODE_B6A211();
  reg.y = r16(R.colliding_sprite);
  reg.a = rd(reg.y, 0x2e);
  if (!(reg.a & 0x0080)) return CODE_B6A211();
  w16(R.current_held_sprite, 0);
  CODE_B69EB0();
  reg.x = cur();
  CODE_B6A24E();
}

/** $B6A211 */
export function CODE_B6A211(): void {
  const x = cur();
  reg.x = x;
  wr(x, 0x2e, rd(x, 0x2e) & 0xffbf);
  reg.a = rd(x, 0x32);
  if (reg.a === 0) return CODE_B6A241();
  wr(x, 0x32, 0);
  if (reg.a === 0x0001) return CODE_B6A24F();
  if (reg.a === 0x0002 || reg.a === 0x0004 || reg.a === 0x0006 || reg.a === 0x0005) return CODE_B6A258();
  w16(R.current_held_sprite, 0);
  CODE_B69C9F();
  if (reg.c) return CODE_B6A24E();
  CODE_B6A241();
}

/** $B6A241 */
export function CODE_B6A241(): void {
  update_held_sprite_position_global();
  reg.x = cur();
  reg.a = rd(reg.x, 0x2e) & 0xffef;
  wr(reg.x, 0x2e, reg.a);
  CODE_B6A24E();
}

/** $B6A24E */
export function CODE_B6A24E(): void {}

/** $B6A24F */
export function CODE_B6A24F(): void {
  reg.a = rd(reg.x, 0x30) | 0x0001;
  wr(reg.x, 0x30, reg.a);
  CODE_B6A24E();
}

/** $B6A258 — thrown: roll. */
export function CODE_B6A258(): void {
  const x = reg.x;
  wr(x, 0x2e, rd(x, 0x2e) | 0x0004);
  wr(x, 0x30, rd(x, 0x30) & 0xfffe);
  wr(x, 0x44, 0x0006);
  wr(x, 0x42, 0x0009);
  wr(x, 0x26, 0);
  reg.a = 0x0900;
  wr(x, 0x2a, 0x0900);
  CODE_B6A24E();
}

/** $B6A27A */
export function CODE_B6A27A(): void {
  CODE_B69C70();
  CODE_B6A178();
}

/** The spikeball was deleted (outside the arena): forget it. */
function forgetSpikeball() {
  if (reg.c) {
    reg.a = cur();
    if (reg.a === r16(0x0735)) w16(0x0735, 0);
  }
}

/** $B6A280 — straight flight. */
export function CODE_B6A280(): void {
  interpolate();
  apply_position_from_velocity_global();
  CODE_B69C87();
  forgetSpikeball();
  CODE_B6A2A2();
}

/** $B6A2A2 */
export function CODE_B6A2A2(): void {
  CODE_B6A178();
}

/** $B6A2A5 — bouncing on the floor (y $01C1). */
export function CODE_B6A2A5(): void {
  reg.a = rd(reg.x, 0x0a);
  if (ge(reg.a, 0x01c1)) {
    reg.a = snd(5, "krool_ammo_bounce");
    queue_sound_effect();
    const x = cur();
    reg.x = x;
    wr(x, 0x24, rd(x, 0x46));
    reg.a = rd(x, 0x48);
    wr(x, 0x2a, reg.a);
  }
  CODE_B6A2BD();
}

/** $B6A2BD */
export function CODE_B6A2BD(): void {
  interpolate();
  apply_position_from_velocity_global();
  CODE_B69C87();
  forgetSpikeball();
  CODE_B6A2DF();
}

/** $B6A2DF */
export function CODE_B6A2DF(): void {
  CODE_B6A178();
}

/** $B6A2E2 — swirling around a moving centre ($22/$28). */
export function CODE_B6A2E2(): void {
  let x = reg.x;
  wr(x, 0x06, rd(x, 0x22));
  wr(x, 0x0a, rd(x, 0x28));
  reg.a = rd(x, 0x4a) & 0x00ff;
  interpolate_x_velocity_global();
  x = cur();
  reg.x = x;
  reg.a = (rd(x, 0x4a) >> 8) & 0x00ff;
  interpolate_y_velocity_global();
  apply_position_from_velocity_global();
  x = cur();
  reg.x = x;
  reg.a = rd(x, 0x06);
  if (!ge(reg.a, 0x02c0)) return CODE_B6A312();
  delete_sprite_handle_deallocation();
  CODE_B6A317();
}

/** $B6A312 */
export function CODE_B6A312(): void {
  CODE_B69C87();
  if (!reg.c) return CODE_B6A33E();
  CODE_B6A317();
}

/** $B6A317 — gone: stop its looping sound. */
export function CODE_B6A317(): void {
  reg.a = r16(0x0735);
  if (reg.a !== cur()) return CODE_B6A329();
  reg.a = snd(6, "barrel_roll");
  reg.c = false;
  queue_or_reset_looping_sound_effect();
  CODE_B6A331();
}

/** $B6A329 */
export function CODE_B6A329(): void {
  reg.a = snd(7, "krool_ammo_swirl");
  reg.c = false;
  queue_or_reset_looping_sound_effect();
  CODE_B6A331();
}

/** $B6A331 */
export function CODE_B6A331(): void {
  reg.a = cur();
  if (reg.a === r16(0x0735)) w16(0x0735, 0);
  CODE_B6A375();
}

/** $B6A33E — keep its looping sound going. */
export function CODE_B6A33E(): void {
  reg.a = r16(0x0735);
  if (reg.a !== cur()) return CODE_B6A350();
  reg.a = snd(6, "barrel_roll");
  reg.c = true;
  queue_or_reset_looping_sound_effect();
  CODE_B6A358();
}

/** $B6A350 */
export function CODE_B6A350(): void {
  reg.a = snd(7, "krool_ammo_swirl");
  reg.c = true;
  queue_or_reset_looping_sound_effect();
  CODE_B6A358();
}

/** $B6A358 — the swirl: circle around the centre, the angle advances by $4C. */
export function CODE_B6A358(): void {
  let x = cur();
  reg.x = x;
  reg.a = rd(x, 0x06);
  wr(x, 0x22, reg.a);
  wr(x, 0x42, reg.a);
  reg.a = rd(x, 0x0a);
  wr(x, 0x28, reg.a);
  wr(x, 0x44, reg.a);
  const angle = rd(x, 0x46);
  process_current_movement();
  x = cur();
  reg.x = x;
  reg.a = add(angle, rd(x, 0x4c));
  wr(x, 0x46, reg.a);
  CODE_B6A375();
}

/** $B6A375 */
export function CODE_B6A375(): void {
  CODE_B6A178();
}

/** $B6A378 — straight flight without terrain. */
export function CODE_B6A378(): void {
  interpolate();
  apply_position_from_velocity_global();
  CODE_B69C87();
  forgetSpikeball();
  CODE_B6A39A();
}

/** $B6A39A */
export function CODE_B6A39A(): void {
  process_sprite_animation();
  CODE_B6A18F();
}

/** $B6A3A1 — knocked out of the Kong's hands: drop. */
export function CODE_B6A3A1(): void {
  const x = reg.x;
  wr(x, 0x20, 0);
  wr(x, 0x26, 0);
  wr(x, 0x2a, 0x0900);
  reg.a = 0x0100;
  wr(x, 0x24, 0x0100);
}

/** $B6A3B0 — a ball into the gun. */
export function CODE_B6A3B0(): void {
  reg.a = r16(0x072d);
  if (reg.a !== 0) return CODE_B6A3C8();
  reg.a = snd(5, "krool_ammo_bounce");
  queue_sound_effect();
  CODE_B6800D();
  reg.x = cur();
  CODE_B69E7D();
  CODE_B6A130();
}

/** $B6A3C8 */
export function CODE_B6A3C8(): void {
  CODE_B69CF2();
  CODE_B6A17C();
}

/** $B6A3CE — animation callback: clear $2E bit 0. */
export function CODE_B6A3CE(): void {
  reg.a = rd(reg.x, 0x2e) & 0xfffe;
  wr(reg.x, 0x2e, reg.a);
}

/** $B6A3D6 — gun fire, vacuum effect, blinking eyes: just animate. */
export function krool_misc_sprite_code(): void {
  process_sprite_animation();
}

registerSprite({
  krool_canball_sprite_code, CODE_B69A76, CODE_B69A82, CODE_B69A8A, CODE_B69A98, CODE_B69AA5, CODE_B69AB4,
  CODE_B69ABE, CODE_B69AE3, CODE_B69AE8, CODE_B69B0E, CODE_B69B16, CODE_B69B1B, CODE_B69B30, CODE_B69B45,
  CODE_B69B4D, CODE_B69B58, CODE_B69B6C, CODE_B69B94, CODE_B69B9E, CODE_B69BB7, CODE_B69BC5, CODE_B69BD4,
  CODE_B69BE2, CODE_B69BF7, CODE_B69BFB, CODE_B69C20, CODE_B69C24, CODE_B69C35, CODE_B69C37, CODE_B69C3B,
  CODE_B69C64, CODE_B69C6A, CODE_B69CD4, CODE_B69CEC,
  spiked_canballs_sprite_code, CODE_B69F06, CODE_B69F12, CODE_B69F1A, CODE_B69F24, CODE_B69F32, CODE_B69F67,
  CODE_B69F6E, CODE_B69F71, CODE_B69F89, CODE_B69F96, CODE_B69F9E, CODE_B69FAF, CODE_B69FB2, CODE_B69FBF,
  CODE_B69FFC, CODE_B69FFE, CODE_B6A00D, CODE_B6A015, CODE_B6A01D, CODE_B6A025, CODE_B6A02D, CODE_B6A035,
  CODE_B6A03D, CODE_B6A045, CODE_B6A071, CODE_B6A076, CODE_B6A098, CODE_B6A09D, CODE_B6A0B2, CODE_B6A0BA,
  CODE_B6A0C5, CODE_B6A0D9, CODE_B6A0FF, CODE_B6A109, CODE_B6A122, CODE_B6A130, CODE_B6A13F, CODE_B6A14D,
  CODE_B6A162, CODE_B6A166, CODE_B6A178, CODE_B6A17C, CODE_B6A18D, CODE_B6A18F, CODE_B6A193, CODE_B6A1BC,
  CODE_B6A27A, CODE_B6A280, CODE_B6A2A2, CODE_B6A2A5, CODE_B6A2BD, CODE_B6A2DF, CODE_B6A2E2, CODE_B6A312,
  CODE_B6A317, CODE_B6A329, CODE_B6A331, CODE_B6A33E, CODE_B6A350, CODE_B6A358, CODE_B6A375, CODE_B6A378,
  CODE_B6A39A, CODE_B6A3B0, CODE_B6A3C8, krool_misc_sprite_code,
});
registerRts({
  CODE_B69C70, CODE_B69C87, CODE_B69C95, CODE_B69C9D, CODE_B69C9F, CODE_B69CAA, CODE_B69CAF, CODE_B69CBA,
  CODE_B69CBD, CODE_B69CF2, CODE_B69D0E, CODE_B69D44, CODE_B69D65, CODE_B69D75, CODE_B69DC2, CODE_B69E2F,
  CODE_B69E33, CODE_B69E75, CODE_B69E79, CODE_B69E7D, CODE_B69E8D, CODE_B69E90, CODE_B69EB0, CODE_B69EDE,
  CODE_B69EE7, CODE_B6A1C2, CODE_B6A1F7, CODE_B6A211, CODE_B6A241, CODE_B6A24E, CODE_B6A24F, CODE_B6A258,
  CODE_B6A3A1,
});
registerRtl({ CODE_B69D96, CODE_B6A3CE });
