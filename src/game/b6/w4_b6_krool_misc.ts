/**
 * Bank $B6 — the rest of K. Rool's fights: the tied-up Donkey Kong (K. Rool Duel intro and
 * ending: shot, freed, punches K. Rool through the roof), defeated K. Rool, the puddle and the
 * splash/sparkle sprites, and the animation callbacks K. Rool's animations call (bank $B9
 * animation scripts JSL them): backfire smoke and fireballs, the soot face, the stun after a
 * hit, priority/bonk flags.
 */
import { r16, w16, bus16 } from "../../core/mem";
import { reg } from "../../core/cpu";
import { L, R, C } from "../../core/sym";
import {
  delete_sprite_handle_deallocation, process_sprite_animation, set_alt_sprite_animation, set_sprite_animation,
  CODE_B68F50, CODE_B4AFAD, spawn_special_sprite_index, CODE_B6D923, interpolate_y_velocity_global,
  apply_position_from_velocity_global, queue_sound_effect, move_child_to_controller_spr,
  CODE_B6D929, set_sprite_palette_global, CODE_B5F0CD, CODE_B5F0ED, set_current_level_as_cleared,
  set_level_end_exit_state_global, interpolate_x_velocity_global, spawn_special_sprite_address,
  init_krool_projectile_position, request_palette_direct_global, spawn_no_gfx_special_sprite_address,
} from "../../gen/routines";
import { cur, rd, wr, dec, inc, neg, snd, spriteTail, registerSprite, registerRts, registerRtl } from "./b6ba_common";
import { lda, lda8, lo, ge, add, sub } from "./w4_b6_util";
import { parseB6, move_sprite_in_y_to_sprite_in_x } from "./w4_b6_kudgel";

const B6 = 0xb60000;
const DK_STATES = lo("DATA_B6A495");
const ROOF_PIECES = L("krool_roof_piece_spawn_count");
const BACKFIRE_SPEEDS = lo("krool_backfire_projectile_speeds");
const VACUUM = lo("krool_vacuum_attack_table");
const VACUUM2 = lo("krool_2_vacuum_attack_table");
const SPARKS = lo("DATA_B6D14B");
const HAND_PAL = lo("kleever_hand_sprite_palette");
const GLOBAL_PAL = lo("global_sprite_palette");

const alt = (s: number) => w16(R.alternate_sprite, s);

/** $B6A3DD — K. Rool's puddle (goes when $06A3 bit 14 is set). */
export function krool_puddle_sprite_code(): void {
  reg.a = r16(0x06a3);
  if (reg.a & 0x4000) {
    delete_sprite_handle_deallocation();
    return;
  }
  process_sprite_animation();
}

/** $B6A3F4 — animation callback: Donkey looks scared. */
export function CODE_B6A3F4(): void {
  alt(r16(0x075f));
  reg.a = C.donkey_scared_anim_id;
  set_alt_sprite_animation();
  alt(r16(0x075b));
  reg.a = C.donkey_rope_scared_anim_id;
  set_alt_sprite_animation();
}

/** $B6A40F — animation callback: spawn the tied-up Donkey (state 4: falls in). */
export function CODE_B6A40F(): void {
  CODE_B68F50();
  reg.a = 0x0004;
  CODE_B6A415();
}

/** $B6A415 */
export function CODE_B6A415(): void {
  reg.y = r16(0x075f);
  wr(reg.y, 0x2e, reg.a);
}

/** $B6A41C — animation callback: Donkey state 2 (pulled up and away). */
export function CODE_B6A41C(): void {
  reg.a = 0x0002;
  CODE_B6A415();
}

/** $B6A421 — animation callback: spawn Donkey thrown out (state 6). */
export function CODE_B6A421(): void {
  CODE_B68F50();
  reg.y = r16(0x075f);
  wr(reg.y, 0x2e, 0x0006);
  reg.a = 0x001c;
  CODE_B6A5B0();
}

/** $B6A434 */
export function CODE_B6A434(): void {
  delete_sprite_handle_deallocation();
}

/** $B6A43B — spawner of the tied-up Donkey in K. Rool Duel (only once: world_map_events). */
export function tied_up_dk_spawner_sprite_code(): void {
  reg.a = r16(R.world_map_events);
  if (reg.a & 0x0003) return CODE_B6A434();
  reg.a |= 0x0003;
  w16(R.world_map_events, reg.a);
  CODE_B4AFAD();
  const x = cur();
  reg.x = x;
  wr(x, 0x00, C.sprite_tied_up_donkey_kong);
  reg.a = rd(x, 0x4e);
  if (reg.a !== 0) return tied_up_donkey_kong_sprite_code();
  inc(x, 0x4e);
  w16(0x075f, x);
  reg.y = C.special_sprite_spawn_id_011C;
  spawn_special_sprite_index();
  const rope = r16(R.alternate_sprite);
  reg.x = rope;
  w16(0x075b, rope);
  wr(rope, 0x12, rd(rope, 0x12) | 0x4000);
  reg.y = C.special_sprite_spawn_id_011E;
  spawn_special_sprite_index();
  const bind = r16(R.alternate_sprite);
  reg.y = bind;
  w16(0x075d, bind);
  reg.a = rd(bind, 0x12) | 0x4000;
  wr(bind, 0x12, reg.a);
  tied_up_donkey_kong_sprite_code();
}

/** $B6A485 — the tied-up Donkey Kong (state machine, DATA_B6A495). */
export function tied_up_donkey_kong_sprite_code(): void {
  const x = cur();
  reg.x = x;
  reg.a = rd(x, 0x2e);
  if (reg.a === 0) return CODE_B6A492();
  reg.x = (reg.a << 1) & 0xffff;
  reg.db = 0xb6;
  spriteTail(B6 | lda(DK_STATES + reg.x));
}

/** $B6A492 */
export function CODE_B6A492(): void {}

/** Signed byte. */
const sb = (v: number) => (v & 0x80 ? v | 0xff00 : v & 0xff);

/** $B6A4A9 — state 1: hanging; shaken along a byte path ($42) after being hit. */
export function CODE_B6A4A9(): void {
  const x = cur();
  reg.x = x;
  wr(x, 0x06, rd(x, 0x44));
  wr(x, 0x0a, rd(x, 0x46));
  const y = rd(x, 0x42);
  reg.y = y;
  if (y === 0) return CODE_B6A510();
  CODE_B6D923();
  reg.a = sb(lda8(y));
  w16(0x0650, reg.a);
  wr(x, 0x06, add(rd(x, 0x06), r16(0x0650)));
  reg.a = sb(lda8(y + 1));
  w16(0x0650, reg.a);
  wr(x, 0x0a, add(rd(x, 0x0a), r16(0x0650)));
  reg.a = lda8(y + 2);
  if (reg.a === 0x007f) {
    wr(x, 0x42, 0);
    return CODE_B6A510();
  }
  if (reg.a === 0x007e) {
    reg.a = lda(y + 3);
  } else {
    reg.a = add(y, 0x0002);
  }
  wr(x, 0x42, reg.a);
  CODE_B6A510();
}

/** $B6A510 */
export function CODE_B6A510(): void {
  CODE_B6A51B();
  process_sprite_animation();
}

/** $B6A51B — the rope and the bindings follow Donkey. */
export function CODE_B6A51B(): void {
  const x = r16(0x075f);
  reg.x = x;
  reg.y = r16(0x075b);
  move_sprite_in_y_to_sprite_in_x();
  const y = r16(0x075d);
  reg.y = y;
  wr(y, 0x06, rd(x, 0x06));
  reg.a = sub(rd(x, 0x0a), 0x0048);
  wr(y, 0x0a, reg.a);
}

/** $B6A536 — state 2: pulled up out of the screen, then deleted with rope and bindings. */
export function CODE_B6A536(): void {
  let x = cur();
  reg.x = x;
  wr(x, 0x24, sub(rd(x, 0x24), 0x0020));
  apply_position_from_velocity_global();
  x = cur();
  reg.x = x;
  reg.a = rd(x, 0x0a);
  if (ge(reg.a, 0x0100)) return CODE_B6A56C();
  delete_sprite_handle_deallocation();
  w16(R.current_sprite, r16(0x075b));
  delete_sprite_handle_deallocation();
  w16(R.current_sprite, r16(0x075d));
  delete_sprite_handle_deallocation();
  reg.x = x;
  w16(R.current_sprite, x);
}

/** $B6A56C */
export function CODE_B6A56C(): void {
  CODE_B6A510();
}

/** $B6A56F — state 3: hanging still. */
export function CODE_B6A56F(): void {
  CODE_B6A510();
}

/** $B6A572 — state 4: dropped in beside K. Rool. */
export function CODE_B6A572(): void {
  reg.a = 0x0050;
  CODE_B6A5B0();
  reg.x = cur();
  inc(reg.x, 0x2e);
  CODE_B6A57C();
}

/** $B6A57C — state 5: bounce down to the hanging height. */
export function CODE_B6A57C(): void {
  reg.a = 0x0003;
  interpolate_y_velocity_global();
  apply_position_from_velocity_global();
  const x = cur();
  reg.x = x;
  reg.a = rd(x, 0x0a);
  if (ge(reg.a, 0x0195)) {
    reg.a = neg(rd(x, 0x24));
    wr(x, 0x24, reg.a);
    if (ge(reg.a, 0xff00)) {
      wr(x, 0x24, 0);
      wr(x, 0x2a, 0);
      reg.a = 0x0003;
      wr(x, 0x2e, 0x0003);
    }
  }
  CODE_B6A5A6();
}

/** $B6A5A6 */
export function CODE_B6A5A6(): void {
  CODE_B6A51B();
  process_sprite_animation();
}

/** $B6A5B0 — Donkey (and rope, bindings) appear A px in front of K. Rool, falling. */
export function CODE_B6A5B0(): void {
  w16(0x0650, reg.a);
  let x = r16(0x075f);
  reg.x = x;
  wr(x, 0x24, 0x0400);
  wr(x, 0x2a, 0x0600);
  const y = r16(0x0654);
  reg.y = y;
  reg.a = rd(y, 0x12);
  if (reg.a & 0x4000) return CODE_B6A5F1();
  wr(x, 0x06, add(rd(y, 0x06), r16(0x0650)));
  wr(x, 0x12, rd(x, 0x12) | 0x4000);
  x = r16(0x075d);
  wr(x, 0x12, rd(x, 0x12) | 0x4000);
  x = r16(0x075b);
  reg.x = x;
  reg.a = rd(x, 0x12) | 0x4000;
  CODE_B6A60A();
}

/** $B6A5F1 */
export function CODE_B6A5F1(): void {
  let x = reg.x;
  const y = reg.y;
  wr(x, 0x06, sub(rd(y, 0x06), r16(0x0650)));
  wr(x, 0x12, rd(x, 0x12) & 0xbfff);
  x = r16(0x075b);
  reg.x = x;
  reg.a = rd(x, 0x12) & 0xbfff;
  CODE_B6A60A();
}

/** $B6A60A */
export function CODE_B6A60A(): void {
  wr(reg.x, 0x12, reg.a);
}

/** $B6A60D — state 6: thrown out by K. Rool, lands and waits to be freed. */
export function CODE_B6A60D(): void {
  reg.a = 0x0003;
  interpolate_y_velocity_global();
  apply_position_from_velocity_global();
  const x = cur();
  reg.x = x;
  reg.a = 0x0145;
  if (ge(0x0145, rd(x, 0x0a))) return CODE_B6A665();
  wr(x, 0x0a, 0x0145);
  reg.a = add(neg(rd(x, 0x24)), 0x00a0);
  wr(x, 0x24, reg.a);
  if (!ge(reg.a, 0xff00)) return CODE_B6A5A6();
  CODE_B6A637();
}

/** $B6A637 */
export function CODE_B6A637(): void {
  const x = reg.x;
  wr(x, 0x24, 0);
  wr(x, 0x2a, 0);
  inc(x, 0x2e);
  reg.a = C.donkey_idle_anim_id;
  set_sprite_animation();
  alt(r16(0x075b));
  reg.a = C.donkey_rope_idle_anim_id;
  set_alt_sprite_animation();
  reg.x = cur();
  wr(reg.x, 0x3a, 0x0140);
  reg.y = r16(0x075b);
  wr(reg.y, 0x3a, 0x0140);
  reg.a = 0x00aa;
  w16(0x0747, 0x00aa);
  CODE_B6A665();
}

/** $B6A665 */
export function CODE_B6A665(): void {
  CODE_B6A51B();
  CODE_B6A668();
}

/** $B6A668 */
export function CODE_B6A668(): void {
  process_sprite_animation();
}

/** $B6A66F — state 7: struggling; after $0747 frames the rope snaps: free. */
export function CODE_B6A66F(): void {
  if (dec(0, 0x0747) !== 0) return CODE_B6A6B5();
  let x = cur();
  reg.x = x;
  w16(R.current_sprite, r16(0x075b));
  delete_sprite_handle_deallocation();
  reg.x = x;
  w16(R.current_sprite, x);
  w16(0x0650, 0);
  w16(0x0658, 0);
  CODE_B6AB5F();
  reg.x = r16(0x075f);
  reg.y = r16(R.alternate_sprite);
  move_sprite_in_y_to_sprite_in_x();
  const y = r16(R.alternate_sprite);
  reg.y = y;
  wr(y, 0x0a, add(rd(y, 0x0a), 0xffe0));
  x = cur();
  reg.x = x;
  inc(x, 0x2e);
  wr(x, 0x24, 0);
  wr(x, 0x2a, 0x0800);
  reg.a = C.donkey_free_anim_id;
  set_sprite_animation();
  CODE_B6A668();
}

/** $B6A6B5 — struggle faster near the end. */
export function CODE_B6A6B5(): void {
  reg.a = r16(0x0747);
  if (reg.a === 0x003c) {
    reg.x = cur();
    wr(reg.x, 0x3a, 0x0280);
    reg.y = r16(0x075b);
    reg.a = 0x0280;
    wr(reg.y, 0x3a, 0x0280);
  }
  CODE_B6A6CB();
}

/** $B6A6CB */
export function CODE_B6A6CB(): void {
  CODE_B6A665();
}

/** $B6A6CE — state 8: falls to the floor and punches. */
export function CODE_B6A6CE(): void {
  reg.a = 0x0004;
  interpolate_y_velocity_global();
  apply_position_from_velocity_global();
  const x = cur();
  reg.x = x;
  reg.a = rd(x, 0x0a);
  if (ge(reg.a, 0x01bd)) {
    wr(x, 0x24, 0);
    wr(x, 0x2a, 0);
    inc(x, 0x2e);
    reg.a = C.donkey_punch_anim_id;
    set_sprite_animation();
  }
  CODE_B6A6EF();
}

/** $B6A6EF */
export function CODE_B6A6EF(): void {
  process_sprite_animation();
}

/** $B6A6F6 — state 9. */
export function CODE_B6A6F6(): void {
  process_sprite_animation();
}

/** $B6A701 — keep the camera between the boss and the Kong. */
export function CODE_B6A701(): void {
  w16(0x0ab8, (r16(0x0ab8) & 0xbfff) | 0x8000);
  const x = cur();
  reg.x = x;
  reg.y = r16(R.active_kong_sprite);
  reg.a = rd(reg.y, 0x06);
  if (!ge(reg.a, rd(x, 0x06))) return CODE_B6A71E();
  reg.a = 0xc800;
  CODE_B6A721();
}

/** $B6A71E */
export function CODE_B6A71E(): void {
  reg.a = 0x3800;
  CODE_B6A721();
}

/** $B6A721 */
export function CODE_B6A721(): void {
  w16(0x0aec, reg.a);
}

/** $B6A725 — K. Rool punched through the roof by Donkey; then the roof falls in, level ends. */
export function defeated_krool_sprite_code(): void {
  CODE_B6A701();
  const x = cur();
  reg.x = x;
  const state = rd(x, 0x42);
  reg.x = (state << 1) & 0xffff;
  reg.db = 0xb6;
  if (state === 0) {
    apply_position_from_velocity_global();
    const k = r16(0x0654);
    reg.x = k;
    reg.a = rd(k, 0x0a);
    if (!ge(reg.a, 0x0100)) {
      reg.a = snd(6, "explosion");
      queue_sound_effect();
      reg.a = snd(7, "wall_break");
      queue_sound_effect();
      w16(R.current_sprite, r16(0x0656));
      delete_sprite_handle_deallocation();
      w16(0x0656, 0);
      reg.x = k;
      w16(R.current_sprite, k);
      inc(k, 0x42);
      w16(0x06ef, bus16(ROOF_PIECES));
      w16(0x06f1, lo("DATA_BAA3B2"));
      reg.a = 0x0009;
      w16(0x0747, 0x0009);
    }
    move_child_to_controller_spr();
    process_sprite_animation();
    return;
  }
  if (state === 1) {
    for (let i = 0; i < 2; i++) {
      CODE_B6D929();
      reg.x = r16(R.alternate_sprite);
      reg.a = C.krool_roof_piece_sprite_palette;
      set_sprite_palette_global();
    }
    if (dec(0, 0x0747) !== 0) return;
    w16(0x06a3, r16(0x06a3) | 0x0010);
    reg.x = cur();
    inc(reg.x, 0x42);
    w16(0x0747, 0x0096);
    reg.a = 0x1000;
    CODE_B5F0CD();
    reg.a = 0x0400;
    CODE_B5F0ED();
    return;
  }
  // state 2
  if (dec(0, 0x0747) !== 0) return;
  reg.a = 0x0040;
  w16(0x06a5, r16(0x06a5) | 0x0040);
  reg.a = 0x0012;
  w16(R.world_map_events, r16(R.world_map_events) | 0x0012);
  set_current_level_as_cleared();
  set_level_end_exit_state_global();
}

/** $B6A7E8 — animation callback: Donkey's punch hits K. Rool (he becomes defeated_krool). */
export function CODE_B6A7E8(): void {
  const y = r16(0x0654);
  reg.y = y;
  wr(y, 0x00, C.sprite_defeated_krool);
  wr(y, 0x24, 0xf500);
  wr(y, 0x42, 0);
  reg.a = rd(reg.x, 0x12);
  reg.x = 0xfe00;
  if (!(reg.a & 0x4000)) reg.x = 0x0200;
  CODE_B6A80A();
}

/** $B6A80A */
export function CODE_B6A80A(): void {
  const y = reg.y;
  w16((0x20 + y) & 0xffff, reg.x);
  alt(y);
  reg.a = C.krool_donkey_punched_anim_id;
  set_alt_sprite_animation();
  alt(r16(0x0656));
  reg.a = C.krool_gun_donkey_punched_anim_id;
  set_alt_sprite_animation();
  reg.y = C.special_sprite_spawn_id_0194;
  spawn_special_sprite_index();
}

/** $B6A82A — Donkey's rope / bindings: animate while Donkey is active. */
export function donkey_kong_rope_sprite_code(): void {
  reg.x = r16(0x075f);
  reg.a = rd(reg.x, 0x2e);
  if (reg.a !== 0) process_sprite_animation();
}

/** $B6A838 — animation callback: K. Rool hits Donkey (shake path; the third hit is longer). */
export function CODE_B6A838(): void {
  inc(0, 0x0763);
  const y = r16(0x075f);
  reg.y = y;
  wr(y, 0x2e, 0x0001);
  reg.x = lo("DATA_BAA512");
  reg.a = r16(0x0763);
  if (reg.a === 0x0003) reg.x = lo("DATA_BAA5EF");
  CODE_B6A853();
}

/** $B6A853 */
export function CODE_B6A853(): void {
  wr(reg.y, 0x42, reg.x);
  w16(0x0761, 0x0002);
  alt(r16(0x075f));
  reg.a = C.donkey_hurt_anim_id;
  set_alt_sprite_animation();
  alt(r16(0x075b));
  reg.a = C.donkey_rope_hurt_anim_id;
  set_alt_sprite_animation();
}

/** $B6A877 — lava splash / Kreepy Krow sparkle: move and animate. */
export function boss_splash_and_sparkle_sprite_code(): void {
  let x = cur();
  reg.a = rd(x, 0x42);
  interpolate_x_velocity_global();
  x = cur();
  reg.x = x;
  reg.a = rd(x, 0x44);
  interpolate_y_velocity_global();
  apply_position_from_velocity_global();
  process_sprite_animation();
}

/** $B6A892 — animation callback: backfire sparks at the gun. */
export function CODE_B6A892(): void {
  reg.a = snd(7, "krool_backfire");
  queue_sound_effect();
  reg.y = C.special_sprite_spawn_id_016E;
  spawn_special_sprite_index();
  reg.y = r16(R.alternate_sprite);
  reg.x = r16(0x0654);
  reg.a = rd(reg.x, 0x12);
  if (reg.a & 0x4000) return CODE_B6A8BD();
  wr(reg.y, 0x12, rd(reg.y, 0x12) & 0xbfff);
  reg.a = rd(reg.x, 0x06);
  CODE_B6A8CC();
}

/** $B6A8BD */
export function CODE_B6A8BD(): void {
  wr(reg.y, 0x12, rd(reg.y, 0x12) | 0x4000);
  reg.a = rd(reg.x, 0x06);
  CODE_B6A8CC();
}

/** $B6A8CC */
export function CODE_B6A8CC(): void {
  const x = reg.x;
  const y = reg.y;
  wr(y, 0x06, reg.a);
  wr(y, 0x0a, add(rd(x, 0x0a), 0xffe4));
  reg.a = C.krool_backfire_sparks_anim_id;
  set_alt_sprite_animation();
}

/** The two fireballs and the smoke of the backfire (dx = sign of the facing). */
function backfireDebris(fireball: () => void, xs: number) {
  fireball();
  reg.a = HAND_PAL;
  CODE_B6AA78();
  let y = reg.y;
  wr(y, 0x0a, sub(rd(y, 0x0a), 0x000d));
  wr(y, 0x20, xs);
  wr(y, 0x24, 0xfe40);
  wr(y, 0x42, 0x0003);
  wr(y, 0x44, 0x0003);
  wr(y, 0x12, rd(y, 0x12) | 0x8000);
  fireball();
  reg.a = HAND_PAL;
  CODE_B6AA78();
  y = reg.y;
  wr(y, 0x20, xs);
  wr(y, 0x24, 0x0100);
  wr(y, 0x42, 0x0003);
  wr(y, 0x44, 0x0003);
  fireball();
  reg.a = C.smoke_cloud_2_anim_id;
  set_alt_sprite_animation();
  reg.a = GLOBAL_PAL;
  CODE_B6AA78();
  y = reg.y;
  wr(y, 0x0a, sub(rd(y, 0x0a), 0x0007));
  wr(y, 0x20, 0);
  reg.a = 0x0002;
  wr(y, 0x42, 0x0002);
}

let a8e0DB = 0;

/** $B6A8E0 — animation callback: the backfire: fireballs, smoke and the cannonball thrown back. */
export function CODE_B6A8E0(): void {
  a8e0DB = reg.db;
  reg.db = 0xb6;
  reg.x = r16(0x0654);
  reg.a = rd(reg.x, 0x12);
  if (reg.a & 0x4000) return CODE_B6A968();
  CODE_B6A8F0();
}

/** $B6A8F0 */
export function CODE_B6A8F0(): void {
  backfireDebris(CODE_B6AA27, 0xfe80);
  CODE_B6A9DD();
}

/** $B6A968 */
export function CODE_B6A968(): void {
  backfireDebris(CODE_B6AA49, 0x0180);
  CODE_B6A9DD();
}

/** $B6A9DD */
export function CODE_B6A9DD(): void {
  w16(0x06a3, r16(0x06a3) & 0xfeff);
  reg.y = lo("DATA_FF1F8A");
  spawn_special_sprite_address();
  init_krool_projectile_position();
  const y = reg.y;
  wr(y, 0x2e, rd(y, 0x2e) | 0x0191);
  const x = reg.x;
  reg.a = lda(BACKFIRE_SPEEDS + ((r16(0x0652) << 1) & 0xffff));
  reg.x = x;
  if (rd(x, 0x12) & 0x4000) return CODE_B6AA14();
  wr(y, 0x20, reg.a);
  CODE_B6AA1C();
}

/** $B6AA14 */
export function CODE_B6AA14(): void {
  reg.a = neg(reg.a);
  wr(reg.y, 0x20, reg.a);
  CODE_B6AA1C();
}

/** $B6AA1C */
export function CODE_B6AA1C(): void {
  wr(reg.y, 0x26, reg.a);
  reg.a = 0x270f;
  wr(reg.y, 0x46, 0x270f);
  reg.db = a8e0DB;
}

/** $B6AA27 — a fireball at the gun's right side. */
export function CODE_B6AA27(): void {
  fireballAt(0x0014);
}

/** $B6AA49 — a fireball at the gun's left side. */
export function CODE_B6AA49(): void {
  fireballAt(0xffec);
}

function fireballAt(dx: number) {
  CODE_B6AA6B();
  reg.a = C.krool_fireball_anim_id;
  set_alt_sprite_animation();
  const y = r16(R.alternate_sprite);
  reg.y = y;
  const x = r16(0x0654);
  reg.x = x;
  wr(y, 0x06, add(rd(x, 0x06), dx));
  reg.a = add(rd(x, 0x0a), 0xffec);
  wr(y, 0x0a, reg.a);
}

/** $B6AA6B — spawn a smoke-type sprite ($017C); Y = it, X = K. Rool. */
export function CODE_B6AA6B(): void {
  reg.y = C.special_sprite_spawn_id_017C;
  spawn_special_sprite_index();
  reg.y = r16(R.alternate_sprite);
  reg.x = r16(0x0654);
}

/** $B6AA78 — palette A for the alternate sprite (palette bits into its oam property). */
export function CODE_B6AA78(): void {
  request_palette_direct_global();
  const y = r16(R.alternate_sprite);
  reg.y = y;
  reg.a = ((reg.a ^ rd(y, 0x12)) & 0x0e00) ^ rd(y, 0x12);
  wr(y, 0x12, reg.a);
}

/** $B6AA8B — animation callback: dangerous (bit 0). */
export function CODE_B6AA8B(): void {
  reg.a = rd(reg.x, 0x2e) | 0x0001;
  wr(reg.x, 0x2e, reg.a);
}

/** $B6AA93 — animation callback: harmless. */
export function CODE_B6AA93(): void {
  reg.a = rd(reg.x, 0x2e) & 0xfffe;
  wr(reg.x, 0x2e, reg.a);
}

/** $B6AA9B — animation callback: dash dust offset 2. */
export function CODE_B6AA9B(): void {
  reg.x = r16(0x072b);
  reg.a = 0x0002;
  wr(reg.x, 0x42, 0x0002);
}

/** $B6AAA4 — animation callback: dash dust offset 0. */
export function CODE_B6AAA4(): void {
  reg.x = r16(0x072b);
  wr(reg.x, 0x42, 0);
}

/** $B6AAAA — animation callback: the soot-face eyes after a backfire. */
export function CODE_B6AAAA(): void {
  reg.a = C.krool_blinking_eyes_sprite_palette;
  set_sprite_palette_global();
  reg.y = C.special_sprite_spawn_id_0158;
  spawn_special_sprite_index();
  reg.y = r16(R.alternate_sprite);
  w16(0x0733, reg.y);
}

/** $B6AABE — animation callback: smoking after the backfire (return code CODE_B6AB94). */
export function CODE_B6AABE(): void {
  wr(reg.x, 0x44, lo("CODE_B6AB94"));
  w16(0x0731, 0x0003);
  const puffs: [number, number, number, number, boolean][] = [
    [0x000c, 0xfff6, 0xfd80, 0x0009, false],
    [0xfff2, 0xfff6, 0xfe00, 0x0005, false],
    [0x000c, 0xfff6, 0xff80, 0x0005, true],
    [0xffee, 0xfff9, 0xffa0, 0x0002, false],
  ];
  for (const [dx, dy, ys, preset, behind] of puffs) {
    w16(0x0650, dx);
    w16(0x0658, dy);
    CODE_B6AB5F();
    const y = r16(R.alternate_sprite);
    reg.y = y;
    wr(y, 0x2a, ys);
    reg.a = preset;
    wr(y, 0x44, preset);
    if (behind) {
      reg.a = rd(y, 0x12) | 0x8000;
      wr(y, 0x12, reg.a);
    }
  }
  reg.a = r16(0x0733);
  if (reg.a !== 0) {
    alt(reg.a);
    reg.a = C.krool_soot_eyes_angry_anim_id;
    set_alt_sprite_animation();
  }
  CODE_B6AB5E();
}

/** $B6AB5E */
export function CODE_B6AB5E(): void {}

/** $B6AB5F — a smoke puff at K. Rool + ($0650 mirrored, $0658). */
export function CODE_B6AB5F(): void {
  CODE_B6AA6B();
  const x = reg.x;
  reg.a = rd(x, 0x12);
  if (reg.a & 0x4000) return CODE_B6AB72();
  reg.a = add(rd(x, 0x06), r16(0x0650));
  CODE_B6AB79();
}

/** $B6AB72 */
export function CODE_B6AB72(): void {
  reg.a = sub(rd(reg.x, 0x06), r16(0x0650));
  CODE_B6AB79();
}

/** $B6AB79 */
export function CODE_B6AB79(): void {
  const x = reg.x;
  const y = reg.y;
  wr(y, 0x06, reg.a);
  wr(y, 0x0a, add(rd(x, 0x0a), r16(0x0658)));
  reg.a = GLOBAL_PAL;
  CODE_B6AA78();
  reg.a = C.smoke_cloud_2_anim_id;
  set_alt_sprite_animation();
}

/** $B6AB94 — return code: K. Rool trembles (moves 4 px back and forth every 3 frames). */
export function CODE_B6AB94(): void {
  if (dec(0, 0x0731) !== 0) return CODE_B6ABC7();
  w16(0x0731, 0x0003);
  const x = cur();
  reg.x = x;
  reg.y = r16(0x0733);
  if (reg.y === 0) reg.y = x;
  CODE_B6ABA8();
}

/** $B6ABA8 */
export function CODE_B6ABA8(): void {
  const x = reg.x;
  reg.a = rd(x, 0x2e) ^ 0x0004;
  wr(x, 0x2e, reg.a);
  if (!(reg.a & 0x0004)) return CODE_B6ABBC();
  reg.a = sub(rd(x, 0x06), 0x0004);
  CODE_B6ABC2();
}

/** $B6ABBC */
export function CODE_B6ABBC(): void {
  reg.a = add(rd(reg.x, 0x06), 0x0004);
  CODE_B6ABC2();
}

/** $B6ABC2 */
export function CODE_B6ABC2(): void {
  wr(reg.x, 0x06, reg.a);
  wr(reg.y, 0x06, reg.a);
  CODE_B6ABC7();
}

/** $B6ABC7 */
export function CODE_B6ABC7(): void {
  move_child_to_controller_spr();
}

let abcbDB = 0;

/** $B6ABCB — animation callback: the hit is over: lose HP, next script; stunned every 3 hits. */
export function CODE_B6ABCB(): void {
  abcbDB = reg.db;
  reg.db = 0xb6;
  reg.a = r16(0x0733);
  if (reg.a !== 0) {
    w16(R.current_sprite, reg.a);
    delete_sprite_handle_deallocation();
    w16(0x0733, 0);
  }
  CODE_B6ABDD();
}

/** $B6ABDD */
export function CODE_B6ABDD(): void {
  let x = r16(0x0654);
  reg.x = x;
  w16(R.current_sprite, x);
  reg.a = C.krool_sprite_palette;
  set_sprite_palette_global();
  reg.x = cur();
  dec(0, 0x0652);
  reg.y = (r16(0x0652) << 1) & 0xffff;
  reg.a = lda(VACUUM + reg.y);
  reg.x = r16(R.level_number);
  if (reg.x === C.level_krocodile_kore) reg.a = lda(VACUUM2 + reg.y);
  CODE_B6AC01();
}

/** $B6AC01 */
export function CODE_B6AC01(): void {
  reg.y = reg.a;
  reg.a = lda(reg.y + 6);
  reg.x = cur();
  wr(reg.x, 0x46, reg.a);
  w16(0x065a, reg.a);
  const x = r16(0x0654);
  reg.x = x;
  if (dec(0, 0x070b) !== 0) return CODE_B6AC7F();
  wr(x, 0x44, lo("boss_command_return"));
  reg.a = r16(R.level_number);
  if (reg.a !== C.level_krocodile_kore) return CODE_B6AC34();
  stun(C.krool_stun_3_anim_id, C.krool_gun_stun_3_anim_id);
}

function stun(krool: number, gun: number) {
  reg.a = krool;
  set_sprite_animation();
  const g = r16(0x0656);
  reg.x = g;
  alt(g);
  wr(g, 0x1c, 0);
  reg.a = gun;
  CODE_B6AC79();
}

/** $B6AC34 */
export function CODE_B6AC34(): void {
  reg.a = r16(0x0652);
  if (reg.a === 0x0006) return CODE_B6AC68();
  if (reg.a === 0x0003) return CODE_B6AC55();
  stun(C.krool_stun_3_anim_id, C.krool_gun_stun_3_anim_id);
}

/** $B6AC55 */
export function CODE_B6AC55(): void {
  stun(C.krool_stun_2_anim_id, C.krool_gun_stun_2_anim_id);
}

/** $B6AC68 */
export function CODE_B6AC68(): void {
  stun(C.krool_stun_anim_id, C.krool_gun_stun_anim_id);
}

/** $B6AC79 */
export function CODE_B6AC79(): void {
  set_alt_sprite_animation();
  CODE_B6AC97();
}

/** $B6AC7F */
export function CODE_B6AC7F(): void {
  parseB6();
  reg.a = C.krool_idle_anim_id;
  set_sprite_animation();
  const g = r16(0x0656);
  reg.x = g;
  alt(g);
  wr(g, 0x1c, 0);
  reg.a = C.krool_gun_idle_anim_id;
  set_alt_sprite_animation();
  CODE_B6AC97();
}

/** $B6AC97 */
export function CODE_B6AC97(): void {
  reg.db = abcbDB;
}

/** $B6AC99 — animation callback: recover from the stun. */
export function CODE_B6AC99(): void {
  reg.a = r16(0x0652);
  if (reg.a === 0) return CODE_B6ACD7();
  w16(0x070b, 0x0003);
  reg.a = r16(0x0652);
  if (reg.a === 0x0006) return CODE_B6ACC1();
  reg.a = C.krool_stun_recover_2_anim_id;
  set_sprite_animation();
  alt(r16(0x0656));
  reg.a = C.krool_gun_stun_recover_2_anim_id;
  CODE_B6ACD1();
}

/** $B6ACC1 */
export function CODE_B6ACC1(): void {
  reg.a = C.krool_stun_recover_anim_id;
  set_sprite_animation();
  alt(r16(0x0656));
  reg.a = C.krool_gun_stun_recover_anim_id;
  CODE_B6ACD1();
}

/** $B6ACD1 */
export function CODE_B6ACD1(): void {
  set_alt_sprite_animation();
  CODE_B6ACD7();
}

/** $B6ACD7 */
export function CODE_B6ACD7(): void {}

/** $B6ACD8 — animation callback: recovered: next command. */
export function CODE_B6ACD8(): void {
  const db = reg.db;
  reg.db = 0xb6;
  parseB6();
  reg.a = C.krool_idle_anim_id;
  set_sprite_animation();
  const g = r16(0x0656);
  reg.x = g;
  alt(g);
  reg.a = C.krool_gun_recovered_wait_anim_id;
  set_alt_sprite_animation();
  reg.db = db;
}

/** $B6ACF3 — spawn-command setup: the spawned ball is the spikeball. */
export function CODE_B6ACF3(): void {
  const y = r16(R.alternate_sprite);
  reg.y = y;
  reg.a = rd(y, 0x2e) | 0x0018;
  wr(y, 0x2e, reg.a);
  w16(0x0735, y);
}

/** $B6AD02 — spawn-command setup: remember the DK barrel. */
export function CODE_B6AD02(): void {
  reg.y = r16(0x073b);
  if (reg.y !== 0) return CODE_B6AD0C();
  reg.y = r16(R.alternate_sprite);
  w16(0x073b, reg.y);
  CODE_B6AD0C();
}

/** $B6AD0C */
export function CODE_B6AD0C(): void {}

/** $B6AD0D — animation callback: next command, idle. */
export function CODE_B6AD0D(): void {
  const db = reg.db;
  reg.db = 0xb6;
  parseB6();
  reg.a = C.krool_idle_anim_id;
  set_sprite_animation();
  alt(r16(0x0656));
  reg.a = C.krool_gun_idle_anim_id;
  set_alt_sprite_animation();
  reg.db = db;
}

/**
 * $B6AD29 — the balls burst when the vacuum ends ($06A3 bit 8): fragments. The direction
 * depends on bit 8 of the return address on the stack (`LDA $01,s : AND #$0100`): the
 * cannonball's call ($B69A72) and the spiked ball's call ($B69F02) differ there.
 */
export function CODE_B6AD29(ret = 0x9a72): void {
  reg.a = snd(7, "krool_backfire");
  queue_sound_effect();
  reg.x = SPARKS;
  w16(0x0650, lda(SPARKS));
  CODE_B6AD3A(ret);
}

/** $B6AD3A */
export function CODE_B6AD3A(ret = 0x9a72): void {
  do {
    const t = reg.x;
    reg.y = lda(t + 2);
    spawn_no_gfx_special_sprite_address();
    reg.y = t;
    const x = r16(R.alternate_sprite);
    reg.x = x;
    if (!(ret & 0x0100)) {
      wr(x, 0x26, lda(t + 8));
      wr(x, 0x20, lda(t + 0x0a));
    } else {
      wr(x, 0x26, (-1 - lda(t + 8)) & 0xffff);
      wr(x, 0x20, (-1 - lda(t + 0x0a)) & 0xffff);
    }
    wr(x, 0x24, lda(t + 0x0c));
    wr(x, 0x06, add(lda(t + 4), rd(x, 0x06)));
    wr(x, 0x0a, add(lda(t + 6), rd(x, 0x0a)));
    reg.a = add(t, 0x000c);
    reg.x = reg.a;
  } while (dec(0, 0x0650) !== 0);
}

/** $B6AD8B — animation callback: bonk on. */
export function CODE_B6AD8B(): void {
  reg.a = rd(reg.x, 0x2e) | 0x0200;
  wr(reg.x, 0x2e, reg.a);
}

/** $B6AD93 — animation callback: bonk off. */
export function CODE_B6AD93(): void {
  reg.a = rd(reg.x, 0x2e) & 0xfdff;
  wr(reg.x, 0x2e, reg.a);
}

registerSprite({
  krool_puddle_sprite_code, CODE_B6A434, tied_up_dk_spawner_sprite_code, tied_up_donkey_kong_sprite_code,
  CODE_B6A492, CODE_B6A4A9, CODE_B6A510, CODE_B6A536, CODE_B6A56C, CODE_B6A56F, CODE_B6A572, CODE_B6A57C,
  CODE_B6A5A6, CODE_B6A60D, CODE_B6A637, CODE_B6A665, CODE_B6A668, CODE_B6A66F, CODE_B6A6B5, CODE_B6A6CB,
  CODE_B6A6CE, CODE_B6A6EF, CODE_B6A6F6, defeated_krool_sprite_code, donkey_kong_rope_sprite_code,
  boss_splash_and_sparkle_sprite_code,
});
registerRts({
  CODE_B6A51B, CODE_B6A5B0, CODE_B6A5F1, CODE_B6A60A, CODE_B6A701, CODE_B6A71E, CODE_B6A721, CODE_B6AA27,
  CODE_B6AA49, CODE_B6AA6B, CODE_B6AA78, CODE_B6AB5F, CODE_B6AB72, CODE_B6AB79, CODE_B6AB94, CODE_B6ABA8,
  CODE_B6ABBC, CODE_B6ABC2, CODE_B6ABC7, CODE_B6ACF3, CODE_B6AD02, CODE_B6AD0C, CODE_B6AD29, CODE_B6AD3A,
});
registerRtl({
  CODE_B6A3F4, CODE_B6A40F, CODE_B6A415, CODE_B6A41C, CODE_B6A421, CODE_B6A7E8, CODE_B6A80A, CODE_B6A838,
  CODE_B6A853, CODE_B6A892, CODE_B6A8BD, CODE_B6A8CC, CODE_B6A8E0, CODE_B6A8F0, CODE_B6A968, CODE_B6A9DD,
  CODE_B6AA14, CODE_B6AA1C, CODE_B6AA8B, CODE_B6AA93, CODE_B6AA9B, CODE_B6AAA4, CODE_B6AAAA, CODE_B6AABE,
  CODE_B6AB5E, CODE_B6ABCB, CODE_B6ABDD, CODE_B6AC01, CODE_B6AC34, CODE_B6AC55, CODE_B6AC68, CODE_B6AC79,
  CODE_B6AC7F, CODE_B6AC97, CODE_B6AC99, CODE_B6ACC1, CODE_B6ACD1, CODE_B6ACD7, CODE_B6ACD8, CODE_B6AD0D,
  CODE_B6AD8B, CODE_B6AD93,
});
