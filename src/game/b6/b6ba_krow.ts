/**
 * Bank $B6 — Krow, the boss of Krow's Nest (world 1): his body (runs the boss command
 * script, see b6ba_boss_commands), his head, and his eggs.
 *
 * Eggs ($2E flags): bit 0 dropped by Krow, 1 falling, 2 landed/rolling, 3 moving vertically,
 * 4 held by a Kong, 5 thrown by a Kong, 7 a "fake" (rain) egg, 8 bounced, 9 cracked,
 * $0400 hit a Kong ($0800 bouncing off). Thrown eggs that hit the body or head hurt Krow.
 * $0652 is Krow's HP (4); $06A1 bit 15 = an egg already hit Krow this attack.
 * Krow's egg pieces and the rain-egg positions live in bank $BA.
 */
import { r8, r16, w8, w16, io8, io16, ioR16, rom16 } from "../../core/mem";
import { reg } from "../../core/cpu";
import { L, R, C, CPU, sprite } from "../../core/sym";
import {
  queue_sound_effect, spawn_special_sprite_index, spawn_special_sprite_address, spawn_no_gfx_special_sprite_address,
  set_sprite_animation, delete_sprite_handle_deallocation, get_current_sprite_clipping, check_for_sprite_collisions,
  CODE_BEBE8E, CODE_B3A600, disable_bullet_time_global, update_held_sprite_position_global, CODE_B4C175,
  CODE_B4AEAF, process_sprite_animation, CODE_BCFED8, CODE_BCFEC0, CODE_B3A334, CODE_B5F0CD, CODE_B5F0ED,
  CODE_BAC949,
} from "../../gen/routines";
import { cur, rd, wr, dec, inc, neg, isNeg, facingLeft, snd, jsrAddr, tsb, trb, BOSS, registerRts, registerRtl, registerSprite } from "./b6ba_common";
import { db16, krowPhase, parse_boss_command, check_complex_player_collision_B6, CODE_B6D923, CODE_B6CEA7 } from "./b6ba_boss_commands";

const KROW_EGG_PIECE_DATA = L("krow_egg_piece_data") & 0xffff;
const HIT_STAR = L("DATA_FF103A") & 0xffff;
const DATA_B6F932 = L("DATA_B6F932") & 0xffff;
const DATA_B6FDDE = L("DATA_B6FDDE") & 0xffff;
const DATA_B6FDEA = L("DATA_B6FDEA") & 0xffff;
const DATA_B6FDFA = L("DATA_B6FDFA") & 0xffff;
const DAMAGE_OFFSETS = L("big_king_zing_damage_pos_offsets") & 0xffff;
const CODE_B6CEA7_PTR = L("CODE_B6CEA7") & 0xffff;
const CODE_B6F8EE_PTR = L("CODE_B6F8EE") & 0xffff;
const RAIN_EGG_COUNT = L("DATA_BAAD2E");
const RAIN_EGG_TABLE = L("DATA_BAAD30");
const SPAWN_009C = 0x009c; // Krow's head

/** Values pushed by one label and pulled by a later one of the same routine. */
const stk: number[] = [];
/** DB pushed by the sprite codes (`PHB : PHK : PLB` ... `PLB`). */
let eggDB = 0xb6;
let bodyDB = 0xb6;

/**
 * `JSL CODE_BEBE8E` with Y = $20, the sprite's oam_property preserved; returns
 * carry = touched, A = how (2 = from above), and the Z flag of the restored X (the
 * original branches on it with BEQ right after `PLX`).
 */
function bumpCheck(a: number): { c: boolean; zx: boolean } {
  const x = reg.x, y = reg.y;
  reg.a = a;
  const prop = rd(cur(), 0x12);
  reg.y = 0x0020;
  CODE_BEBE8E();
  wr(cur(), 0x12, prop);
  reg.y = y;
  reg.x = x;
  return { c: reg.c, zx: (x & 0xffff) === 0 };
}

// ---------------------------------------------------------------------------------------
// Eggs

/** $B6ECB4 — the egg vanishes because another egg hit Krow: burst into pieces. */
export function CODE_B6ECB4(): void {
  delete_sprite_handle_deallocation();
  const x = cur();
  reg.x = x;
  reg.a = rd(x, 0x22);
  if (!isNeg(reg.a)) return CODE_B6ECCD();
  if (reg.a >= 0xffff) return CODE_B6ECC8();
  reg.a = 0x010a;
  CODE_B6ECD7();
}

/** $B6ECC8 */
export function CODE_B6ECC8(): void {
  reg.a = 0x0008;
  CODE_B6ECD7();
}

/** $B6ECCD */
export function CODE_B6ECCD(): void {
  if (reg.a >= 0x0001) return CODE_B6ECD4();
  CODE_B6ECC8();
}

/** $B6ECD4 */
export function CODE_B6ECD4(): void {
  reg.a = 0x000a;
  CODE_B6ECD7();
}

/** $B6ECD7 */
export function CODE_B6ECD7(): void {
  CODE_B6F266();
  reg.a = rd(reg.x, 0x2e);
  if (reg.a & 0x0080) return CODE_B6F055();
  CODE_B6ECE4();
}

/** $B6ECE4 — a real egg is gone: Krow may drop the next one (clear bit 2 of his flags). */
export function CODE_B6ECE4(): void {
  reg.y = r16(BOSS.body);
  reg.a = rd(reg.y, 0x2e) & 0xfffb;
  wr(reg.y, 0x2e, reg.a);
  CODE_B6F055();
}

/** $B6ECF3 */
export function krows_egg_sprite_code(): void {
  eggDB = reg.db;
  reg.db = 0xb6;
  const x = cur();
  reg.x = x;
  reg.a = r16(0x06a1);
  if (reg.a & 0x8000) return CODE_B6ECB4();
  reg.a = rd(x, 0x2e);
  if (reg.a & 0x0001) return CODE_B6ED0B();
  CODE_B6F031();
}

/** $B6ED0B — A = egg flags. */
export function CODE_B6ED0B(): void {
  const x = reg.x;
  if (reg.a & 0x0020) return CODE_B6ED54();
  reg.a = rd(x, 0x2e);
  if (reg.a & 0x0200) {
    reg.a = rd(x, 0x30) & 0xfffe;
    wr(x, 0x30, reg.a);
    return CODE_B6F031();
  }
  CODE_B6ED21();
}

/** $B6ED21 — an egg that hit a Kong: burst with a hit star. */
export function CODE_B6ED21(): void {
  const x = reg.x;
  reg.a = rd(x, 0x2e);
  if (!(reg.a & 0x0400)) return CODE_B6ED51();
  CODE_B6F063();
  reg.a = 0x0000;
  CODE_B6F266();
  reg.y = HIT_STAR;
  spawn_special_sprite_address();
  reg.y = r16(R.alternate_sprite);
  reg.x = x;
  wr(reg.y, 0x06, rd(x, 0x06) - 0x0002);
  reg.a = (rd(x, 0x0a) - 0x000f) & 0xffff;
  wr(reg.y, 0x0a, reg.a);
  CODE_B6F038();
}

/** $B6ED51 */
export function CODE_B6ED51(): void {
  CODE_B6EDCC();
}

/** $B6ED54 — thrown by a Kong: hit Krow, or burst against another sprite. */
export function CODE_B6ED54(): void {
  get_current_sprite_clipping();
  reg.a = 0x0020;
  check_for_sprite_collisions();
  if (!reg.c) return CODE_B6EDAD();
  const other = r16(R.colliding_sprite);
  reg.y = other;
  reg.a = r16(other + sprite.type);
  if (reg.a === C.sprite_krows_body || reg.a === C.sprite_krows_head) return CODE_B6EDB0();
  const egg = cur();
  w16(R.current_sprite, other);
  delete_sprite_handle_deallocation();
  reg.x = egg;
  w16(R.current_sprite, egg);
  reg.a = 0x0006;
  CODE_B6F266();
  reg.a = snd(4, "barrel_blast");
  queue_sound_effect();
  CODE_B6ED8B();
}

/** $B6ED8B */
export function CODE_B6ED8B(): void {
  delete_sprite_handle_deallocation();
  CODE_B6FEA2();
  const x = cur();
  reg.x = x;
  reg.a = rd(x, 0x2e);
  if (reg.a & 0x0080) return CODE_B6F055();
  CODE_B6ED9E();
}

/** $B6ED9E */
export function CODE_B6ED9E(): void {
  reg.y = r16(BOSS.body);
  reg.a = rd(reg.y, 0x2e) & 0xfffb;
  wr(reg.y, 0x2e, reg.a);
  CODE_B6F055();
}

/** $B6EDAD */
export function CODE_B6EDAD(): void {
  CODE_B6F07C();
}

/** $B6EDB0 — the thrown egg hit Krow. */
export function CODE_B6EDB0(): void {
  const x = cur();
  reg.x = x;
  reg.a = rd(x, 0x22);
  if (!isNeg(reg.a)) return CODE_B6EDBB();
  reg.a = 0x0004;
  CODE_B6EDBE();
}

/** $B6EDBB */
export function CODE_B6EDBB(): void {
  reg.a = 0x0104;
  CODE_B6EDBE();
}

/** $B6EDBE */
export function CODE_B6EDBE(): void {
  CODE_B6F266();
  const x = reg.x;
  reg.y = x;
  CODE_B6F82D();
  reg.x = x;
  w16(R.current_sprite, x);
  CODE_B6ED8B();
}

/** $B6EDCC — A = egg flags: an egg Krow still carries / that sits on the ground. */
export function CODE_B6EDCC(): void {
  if (reg.a & 0x000a) return CODE_B6EE06();
  reg.a = r16(0x06a1);
  if (reg.a & 0x4000) {
    reg.a &= 0xbfff;
    w16(0x06a1, reg.a);
    disable_bullet_time_global();
    reg.a = rd(reg.x, 0x2e) & 0xf7ff;
    wr(reg.x, 0x2e, reg.a);
  }
  CODE_B6EDEC();
}

/** $B6EDEC — idle egg animation by direction. */
export function CODE_B6EDEC(): void {
  const x = reg.x;
  reg.a = rd(x, 0x2e);
  if (!(reg.a & 0x0040)) {
    reg.a = rd(x, 0x20);
    if (!isNeg(reg.a)) return CODE_B6EDFE();
    reg.a = 0x02e8;
    wr(x, 0x0c, reg.a);
  }
  CODE_B6EE03();
}

/** $B6EDFE */
export function CODE_B6EDFE(): void {
  reg.a = 0x02e9;
  wr(reg.x, 0x0c, reg.a);
  CODE_B6EE03();
}

/** $B6EE03 */
export function CODE_B6EE03(): void {
  CODE_B6F015();
}

/** $B6EE06 — a falling egg: bounce off a Kong it lands on. */
export function CODE_B6EE06(): void {
  const x = reg.x;
  reg.a = rd(x, 0x2e);
  if (!(reg.a & 0x0800)) {
    get_current_sprite_clipping();
    const r = bumpCheck(0x0018);
    if (r.c && (r.zx || reg.a === 0x0002)) {
      CODE_B6EE32();
      return;
    }
  }
  CODE_B6EE63();
}

/** $B6EE32 — the egg landed on a Kong: hurt him and bounce up. */
export function CODE_B6EE32(): void {
  reg.a = 0x001e;
  reg.y = 0xff00;
  CODE_B3A600();
  reg.y = r16(BOSS.body);
  reg.a = rd(reg.y, 0x2e);
  if (reg.a & 0x0100) {
    reg.a = 0x0001;
    wr(reg.y, 0x0c, 0x0001);
  }
  CODE_B6EE4D();
}

/** $B6EE4D */
export function CODE_B6EE4D(): void {
  const x = reg.x;
  wr(x, 0x52, 0x0004);
  wr(x, 0x22, 0);
  reg.a = (rd(x, 0x2e) & 0xfffd) | 0x0800;
  wr(x, 0x2e, reg.a);
  reg.a = 0x0064;
  wr(x, 0x0e, reg.a);
  CODE_B6EE63();
}

/** $B6EE63 */
export function CODE_B6EE63(): void {
  const x = cur();
  reg.x = x;
  reg.a = rd(x, 0x2e);
  if (!(reg.a & 0x0002)) return CODE_B6EF23();
  CODE_B6EE6F();
}

/** $B6EE6F */
export function CODE_B6EE6F(): void {
  const x = cur();
  reg.x = x;
  reg.a = rd(x, 0x2e);
  if (!(reg.a & 0x0100)) return CODE_B6EF23();
  CODE_B6EE7B();
}

/** $B6EE7B — horizontal movement of a falling egg: x speed $22, Bresenham-like steps. */
export function CODE_B6EE7B(): void {
  const x = reg.x;
  wr(x, 0x06, rd(x, 0x06) + rd(x, 0x22));
  reg.a = rd(x, 0x22);
  if (!isNeg(reg.a)) return CODE_B6EE8F();
  reg.a = (rd(x, 0x10) + rd(x, 0x22)) & 0xffff;
  CODE_B6EE94();
}

/** $B6EE8F */
export function CODE_B6EE8F(): void {
  reg.a = (rd(reg.x, 0x10) - rd(reg.x, 0x22)) & 0xffff;
  CODE_B6EE94();
}

/** $B6EE94 */
export function CODE_B6EE94(): void {
  const x = reg.x;
  wr(x, 0x10, reg.a);
  w16(BOSS.flag, rd(x, 0x2a) & 0x00ff);
  reg.a = (rd(x, 0x28) - r16(BOSS.flag)) & 0xffff;
  wr(x, 0x28, reg.a);
  if (isNeg(reg.a)) {
    reg.a = (reg.a + 0x0010) & 0xffff;
    wr(x, 0x28, reg.a);
    reg.a = (rd(x, 0x06) + rd(x, 0x20)) & 0xffff;
    wr(x, 0x06, reg.a);
    dec(x, 0x10);
  }
  CODE_B6EEB9();
}

/** $B6EEB9 */
export function CODE_B6EEB9(): void {
  const x = reg.x;
  reg.a = rd(x, 0x2e);
  if (!(reg.a & 0x0004)) return CODE_B6EED7();
  const t = (r8(x + 0x24) - 1) & 0xff; // SEP #$20 : DEC $24,x
  w8(x + 0x24, t);
  if (t !== 0) return CODE_B6EF23();
  reg.a = rd(x, 0x26);
  w8(x + 0x24, reg.a & 0xff);
  const lo = (r8(x + 0x2a) - 1) & 0xff; // LDA $2A,x : DEC A (8-bit)
  reg.a = (reg.a & 0xff00) | lo;
  if (lo !== 0) return CODE_B6EF1D();
  CODE_B6EF09();
}

/** $B6EED7 — distance run out: start rolling/slowing ($2E bit 2). */
export function CODE_B6EED7(): void {
  const x = reg.x;
  reg.a = rd(x, 0x10);
  if (!isNeg(reg.a)) return CODE_B6EF23();
  wr(x, 0x2e, rd(x, 0x2e) | 0x0004);
  wr(x, 0x2c, 0xff80);
  reg.y = krowPhase();
  reg.a = db16(reg.y + 0x1a);
  w8(x + 0x0e, (reg.a + r8(x + 0x0e)) & 0xff); // 8-bit ADC, carry clear (from ASL of the HP)
  reg.a = 0x000a;
  wr(x, 0x26, 0x000a);
  w8(x + 0x24, 0x0a);
  CODE_B6EF23();
}

/** $B6EF09 */
export function CODE_B6EF09(): void {
  reg.a = rd(reg.x, 0x22);
  if (reg.a === 0) return CODE_B6F059();
  CODE_B6EF10();
}

/** $B6EF10 — slow the x speed down by one step towards 0. */
export function CODE_B6EF10(): void {
  reg.a = (reg.a - rd(reg.x, 0x20)) & 0xffff;
  wr(reg.x, 0x22, reg.a);
  if (reg.a === 0) return CODE_B6F059();
  CODE_B6EF1A();
}

/** $B6EF1A */
export function CODE_B6EF1A(): void {
  reg.a = 0x0010;
  CODE_B6EF1D();
}

/** $B6EF1D */
export function CODE_B6EF1D(): void {
  w8(reg.x + 0x2a, reg.a & 0xff);
  CODE_B6EF23();
}

/** $B6EF23 — vertical movement ($2E bit 3). */
export function CODE_B6EF23(): void {
  reg.a = rd(reg.x, 0x2e);
  if (!(reg.a & 0x0008)) return CODE_B6F031();
  CODE_B6EF2D();
}

/** $B6EF2D */
export function CODE_B6EF2D(): void {
  const x = reg.x;
  wr(x, 0x0a, rd(x, 0x0a) + rd(x, 0x52));
  reg.a = rd(x, 0x2e);
  if (reg.a & 0x0080) return CODE_B6EFCB();
  CODE_B6EF3E();
}

/** $B6EF3E — reached the floor (y $1EB)? */
export function CODE_B6EF3E(): void {
  reg.a = rd(reg.x, 0x0a);
  if (reg.a < 0x01eb) return CODE_B6EFCB();
  CODE_B6EF48();
}

/** $B6EF48 — bounce on the floor: the new y speed loses $0E + $0F. */
export function CODE_B6EF48(): void {
  const x = reg.x, y = reg.y;
  reg.a = snd(5, "knock");
  queue_sound_effect();
  reg.y = y;
  reg.x = x;
  wr(x, 0x2e, rd(x, 0x2e) | 0x0100);
  wr(x, 0x0a, 0x01eb);
  let a = (rd(x, 0x54) - 2) & 0xffff;
  w8(x + 0x2b, a & 0xff);
  a = (a - 1) & 0xffff;
  w16(0x0767, a);
  a = rd(x, 0x52) ^ 0xffff;
  w16(BOSS.flag, r8(x + 0x0e));
  a = (a + r16(BOSS.flag)) & 0xffff;
  w16(BOSS.flag, r8(x + 0x0f));
  a = (a + r16(BOSS.flag)) & 0xffff;
  w8(x + 0x0f, 0);
  wr(x, 0x52, a);
  reg.a = a;
  if (!isNeg(a)) return CODE_B6EFA4();
  if (a >= 0xfffd) return CODE_B6EFA9();
  CODE_B6EFCB();
}

/** $B6EFA4 */
export function CODE_B6EFA4(): void {
  if (isNeg((reg.a - 0x0001) & 0xffff)) return CODE_B6EFCB();
  CODE_B6EFA9();
}

/** $B6EFA9 — too slow to bounce again: stop moving vertically. */
export function CODE_B6EFA9(): void {
  const x = reg.x;
  w8(x + 0x2b, 0);
  wr(x, 0x52, 0);
  w16(0x0767, 0xffff);
  wr(x, 0x2e, rd(x, 0x2e) & 0xfff7);
  wr(x, 0x22, 0);
  reg.a = rd(x, 0x2e) & 0xfffd;
  wr(x, 0x2e, reg.a);
  CODE_B6F031();
}

/** $B6EFCB — gravity: every $54 frames one more pixel per frame of fall speed. */
export function CODE_B6EFCB(): void {
  const x = reg.x;
  w8(x + 0x2b, (r8(x + 0x2b) + 1) & 0xff);
  reg.a = r8(x + 0x2b);
  if (reg.a === rd(x, 0x54)) {
    w8(x + 0x2b, 0);
    if (inc(x, 0x52) === 0) {
      reg.a = (rd(x, 0x12) & 0xcfff) | 0x3000;
      wr(x, 0x12, reg.a);
    }
  }
  CODE_B6EFEE();
}

/** $B6EFEE — sub-pixel accumulator $0767. */
export function CODE_B6EFEE(): void {
  const x = reg.x;
  w16(BOSS.flag, r8(x + 0x2b));
  reg.a = (r16(0x0767) - r16(BOSS.flag)) & 0xffff;
  if (!isNeg(reg.a)) return CODE_B6F00E();
  reg.a = (reg.a + rd(x, 0x54)) & 0xffff;
  w16(0x0767, reg.a);
  inc(x, 0x0a);
  CODE_B6F031();
}

/** $B6F00E */
export function CODE_B6F00E(): void {
  w16(0x0767, reg.a);
  CODE_B6F031();
}

/** $B6F015 — an egg on the ground: can be picked up; cracks after a while. */
export function CODE_B6F015(): void {
  CODE_B6F102();
  const x = reg.x;
  reg.a = rd(x, 0x2e);
  if (reg.a & 0x0010) return CODE_B6F031();
  if (dec(x, 0x4e) !== 0) return CODE_B6F031();
  reg.a = C.krow_egg_crack_anim_id;
  set_sprite_animation();
  reg.a = rd(reg.x, 0x2e) | 0x0200;
  wr(reg.x, 0x2e, reg.a);
  CODE_B6F031();
}

/** $B6F031 — fell off the bottom of the arena? */
export function CODE_B6F031(): void {
  reg.a = rd(reg.x, 0x0a);
  if (reg.a < 0x023a) return CODE_B6F051();
  CODE_B6F038();
}

/** $B6F038 — remove the egg. */
export function CODE_B6F038(): void {
  delete_sprite_handle_deallocation();
  reg.a = rd(reg.x, 0x2e);
  if (!(reg.a & 0x0080)) {
    reg.y = r16(BOSS.body);
    reg.a = rd(reg.y, 0x2e) & 0xfffb;
    wr(reg.y, 0x2e, reg.a);
  }
  CODE_B6F055();
}

/** $B6F051 */
export function CODE_B6F051(): void {
  process_sprite_animation();
  CODE_B6F055();
}

/** $B6F055 — `PLB : JML [sprite_return_address]`. */
export function CODE_B6F055(): void {
  reg.db = eggDB;
}

/** $B6F059 */
export function CODE_B6F059(): void {
  reg.a = rd(reg.x, 0x2e) & 0xfffd;
  wr(reg.x, 0x2e, reg.a);
  CODE_B6EF23();
}

/** $B6F063 — in the last phases two broken eggs make Krow swoop down at the Kongs. */
export function CODE_B6F063(): void {
  reg.a = r16(BOSS.hp);
  if (reg.a >= 0x0003) return CODE_B6F07B();
  reg.a = inc(0, 0x06d3);
  if (reg.a >= 0x0002) CODE_B6F2CE();
  CODE_B6F07B();
}

/** $B6F07B */
export function CODE_B6F07B(): void {}

/** $B6F07C — a thrown egg in flight: burst when it reaches the floor. */
export function CODE_B6F07C(): void {
  const x = cur();
  reg.x = x;
  wr(x, 0x06, rd(x, 0x06) + rd(x, 0x22));
  reg.a = (rd(x, 0x0a) + rd(x, 0x52)) & 0xffff;
  wr(x, 0x0a, reg.a);
  if (reg.a < 0x01eb) return CODE_B6F0C4();
  reg.a = rd(x, 0x22);
  if (!isNeg(reg.a)) return CODE_B6F09A();
  reg.a = 0x0102;
  CODE_B6F09D();
}

/** $B6F09A */
export function CODE_B6F09A(): void {
  reg.a = 0x0002;
  CODE_B6F09D();
}

/** $B6F09D */
export function CODE_B6F09D(): void {
  CODE_B6F266();
  reg.a = snd(4, "barrel_blast");
  queue_sound_effect();
  delete_sprite_handle_deallocation();
  reg.a = rd(reg.x, 0x2e);
  if (reg.a & 0x0080) return CODE_B6F055();
  reg.y = r16(BOSS.body);
  reg.a = rd(reg.y, 0x2e) & 0xfffb;
  wr(reg.y, 0x2e, reg.a);
  CODE_B6F063();
  CODE_B6F055();
}

/** $B6F0C4 — gravity of a thrown egg. */
export function CODE_B6F0C4(): void {
  const x = reg.x;
  w8(x + 0x2b, (r8(x + 0x2b) + 1) & 0xff);
  reg.a = r8(x + 0x2b);
  if (reg.a === rd(x, 0x54)) {
    w8(x + 0x2b, 0);
    inc(x, 0x52);
  }
  CODE_B6F0DB();
}

/** $B6F0DB */
export function CODE_B6F0DB(): void {
  const x = reg.x;
  w16(BOSS.flag, r8(x + 0x2b));
  reg.a = (r16(0x0767) - r16(BOSS.flag)) & 0xffff;
  if (!isNeg(reg.a)) return CODE_B6F0FB();
  reg.a = (reg.a + rd(x, 0x54)) & 0xffff;
  w16(0x0767, reg.a);
  inc(x, 0x0a);
  CODE_B6F031();
}

/** $B6F0FB */
export function CODE_B6F0FB(): void {
  w16(0x0767, reg.a);
  CODE_B6F031();
}

/** $B6F102 — pick-up handling of an egg lying on the ground ($32 = interaction from kong). */
export function CODE_B6F102(): void {
  const x = cur();
  reg.x = x;
  reg.a = rd(x, 0x2e);
  if (reg.a & 0x0010) return CODE_B6F11B();
  wr(x, 0x30, rd(x, 0x30) | 0x0001);
  reg.a = rd(x, 0x32);
  if (reg.a !== 0) return CODE_B6F1FB();
  CODE_B6F119();
}

/** $B6F119 */
export function CODE_B6F119(): void {
  reg.c = false;
}

/** $B6F11B — held by a Kong: collisions with other sprites, throw. */
export function CODE_B6F11B(): void {
  reg.y = r16(BOSS.body);
  reg.a = rd(reg.y, 0x2e);
  if (reg.a & 0x0100) {
    reg.a = 0x0001;
    wr(reg.y, 0x0c, 0x0001);
  }
  CODE_B6F12C();
}

/** $B6F12C */
export function CODE_B6F12C(): void {
  get_current_sprite_clipping();
  reg.a = 0x0020;
  check_for_sprite_collisions();
  const x = cur();
  reg.x = x;
  if (!reg.c) return CODE_B6F19C();
  const other = r16(R.colliding_sprite);
  reg.y = other;
  reg.a = r16(other + sprite.type);
  if (reg.a === C.sprite_krows_body || reg.a === C.sprite_krows_head) return CODE_B6F1C2();
  CODE_B6F063();
  reg.a = rd(reg.y, 0x2e);
  if (!(reg.a & 0x000a)) return CODE_B6F19C();
  // smashed into a falling egg: both burst
  w16(R.current_held_sprite, 0);
  wr(reg.x, 0x2e, rd(reg.x, 0x2e) & 0xffef);
  const egg = cur();
  w16(R.current_sprite, r16(R.colliding_sprite));
  delete_sprite_handle_deallocation();
  reg.x = egg;
  w16(R.current_sprite, egg);
  reg.a = 0x0006;
  CODE_B6F266();
  reg.a = snd(4, "barrel_blast");
  queue_sound_effect();
  delete_sprite_handle_deallocation();
  CODE_B6FEA2();
  reg.x = cur();
  reg.a = rd(reg.x, 0x2e);
  if (reg.a & 0x0080) return CODE_B6F1BF();
  CODE_B6F18D();
}

/** $B6F18D */
export function CODE_B6F18D(): void {
  reg.y = r16(BOSS.body);
  reg.a = rd(reg.y, 0x2e) & 0xfffb;
  wr(reg.y, 0x2e, reg.a);
  CODE_B6F1BF();
}

/** $B6F19C — follow the Kong's hands; react to the interaction code in $32. */
export function CODE_B6F19C(): void {
  update_held_sprite_position_global();
  const x = cur();
  reg.x = x;
  reg.a = rd(x, 0x32);
  if (reg.a === 0) return CODE_B6F119();
  CODE_B6F1A9();
}

/** $B6F1A9 */
export function CODE_B6F1A9(): void {
  wr(reg.x, 0x32, 0);
  if (reg.a === 0x0001) return CODE_B6F1EE();
  if (reg.a === 0x0004 || reg.a === 0x0006 || reg.a === 0x0005) return CODE_B6F205();
  CODE_B6F1BF();
}

/** $B6F1BF */
export function CODE_B6F1BF(): void {
  CODE_B6F119();
}

/** $B6F1C2 — carried into Krow: hurts him. */
export function CODE_B6F1C2(): void {
  w16(R.current_held_sprite, 0);
  wr(reg.x, 0x2e, rd(reg.x, 0x2e) & 0xffef);
  reg.y = r16(BOSS.body);
  wr(reg.y, 0x2e, rd(reg.y, 0x2e) & 0xfffb);
  reg.a = 0x0000;
  CODE_B6F266();
  const x = reg.x;
  reg.y = x;
  CODE_B6F82D();
  reg.x = x;
  w16(R.current_sprite, x);
  delete_sprite_handle_deallocation();
  CODE_B6FEA2();
}

/** $B6F1EE — dropped. */
export function CODE_B6F1EE(): void {
  wr(reg.x, 0x2e, rd(reg.x, 0x2e) & 0xffef);
  reg.a = 0x1001;
  wr(reg.x, 0x1e, reg.a);
}

/** $B6F1FB */
export function CODE_B6F1FB(): void {
  wr(reg.x, 0x32, 0);
  if (reg.a === 0x0001) return CODE_B6F257();
  CODE_B6F119();
}

/** $B6F205 — thrown: fly in the Kong's facing direction. */
export function CODE_B6F205(): void {
  const x = reg.x;
  wr(x, 0x2e, (rd(x, 0x2e) & 0xffef) | 0x0020);
  reg.y = r16(R.active_kong_sprite);
  reg.a = rd(reg.y, 0x12);
  if (!(reg.a & 0x4000)) return CODE_B6F229();
  wr(x, 0x20, 0xffff);
  wr(x, 0x22, 0xfff9);
  reg.a = C.krow_egg_right_thrown_anim_id;
  CODE_B6F236();
}

/** $B6F229 */
export function CODE_B6F229(): void {
  wr(reg.x, 0x20, 0x0001);
  wr(reg.x, 0x22, 0x0007);
  reg.a = C.krow_egg_left_thrown_anim_id;
  CODE_B6F236();
}

/** $B6F236 */
export function CODE_B6F236(): void {
  set_sprite_animation();
  const x = reg.x;
  reg.a = 0x0001;
  w8(x + 0x2b, 0x01);
  wr(x, 0x54, 0x000a);
  w16(0x0767, 0x0005);
  wr(x, 0x52, 0);
  reg.a = (rd(x, 0x06) + rd(x, 0x22)) & 0xffff;
  wr(x, 0x06, reg.a);
}

/** $B6F257 — picked up. */
export function CODE_B6F257(): void {
  reg.a = 0x0010 | rd(reg.x, 0x2e);
  wr(reg.x, 0x2e, reg.a);
  reg.a = 0xfffc & rd(reg.x, 0x30);
  wr(reg.x, 0x30, reg.a);
}

/**
 * $B6F266 — burst the egg into pieces: A low byte = piece set in krow_egg_piece_data (bank
 * $BA), bit 8 = mirror the pieces' speeds. X and A are preserved.
 */
export function CODE_B6F266(): void {
  const x = reg.x, a = reg.a, db = reg.db;
  reg.y = a & 0x00ff;
  CODE_B6D923();
  reg.x = db16(KROW_EGG_PIECE_DATA + reg.y);
  w16(BOSS.flag, db16(reg.x));
  stk.push(x, a, db);
  CODE_B6F27A();
}

/** $B6F27A — spawn one piece per entry ($0C bytes each). */
export function CODE_B6F27A(): void {
  const a = stk[stk.length - 2];
  for (;;) {
    const entry = reg.x;
    reg.y = db16(entry + 2);
    spawn_no_gfx_special_sprite_address();
    reg.y = entry;
    const p = r16(R.alternate_sprite);
    reg.x = p;
    if (!(a & 0x0100)) {
      wr(p, 0x26, db16(entry + 8));
      reg.a = db16(entry + 0x0a);
      wr(p, 0x20, reg.a);
    } else {
      wr(p, 0x26, db16(entry + 8) ^ 0xffff);
      reg.a = db16(entry + 0x0a) ^ 0xffff;
      wr(p, 0x20, reg.a);
    }
    wr(p, 0x24, db16(entry + 0x0c));
    wr(p, 0x06, db16(entry + 4) + rd(p, 0x06));
    reg.a = (db16(entry + 6) + rd(p, 0x0a)) & 0xffff;
    wr(p, 0x0a, reg.a);
    reg.a = (entry + 0x0c) & 0xffff;
    reg.x = reg.a;
    if (dec(0, BOSS.flag) === 0) break;
  }
  reg.db = stk.pop()!;
  reg.a = stk.pop()!;
  reg.x = stk.pop()!;
}

/** $B6F2CE — Krow swoops down at the Kongs (script DATA_B6FDDE). */
export function CODE_B6F2CE(): void {
  const x0 = reg.x, y0 = reg.y;
  w16(0x06d3, 0);
  const x = r16(BOSS.body);
  reg.x = x;
  w16(R.current_sprite, x);
  CODE_B6F8F3();
  w16(BOSS.headAnim, C.krow_head_swoop_attack_anim_id);
  if (rd(x, 0x2e) & 0x0020) {
    wr(x, 0x06, r16(0x0660));
    wr(x, 0x0a, r16(0x0662));
  }
  stk.push(x0, y0);
  CODE_B6F2F5();
}

/** $B6F2F5 */
export function CODE_B6F2F5(): void {
  const x = reg.x;
  wr(x, 0x2e, rd(x, 0x2e) & 0xffda);
  wr(x, 0x46, DATA_B6FDDE);
  wr(x, 0x2e, rd(x, 0x2e) & 0xfffd);
  wr(x, 0x1e, 0);
  reg.a = C.krow_body_idle_anim_id;
  set_sprite_animation();
  const head = r16(BOSS.head);
  reg.x = head;
  w16(R.current_sprite, head);
  wr(head, 0x1e, 0);
  reg.a = C.krow_head_idle_anim_id;
  set_sprite_animation();
  reg.y = stk.pop()!;
  const x0 = stk.pop()!;
  reg.x = x0;
  w16(R.current_sprite, x0);
  wr(x0, 0x44, 0);
}

/** $B6F326 — raining eggs (Krow bit 0): shake the screen, drop an egg every $0658 frames. */
export function CODE_B6F326(): void {
  reg.a = r16(0x0af6);
  if (reg.a < 0x0100) {
    reg.a = 0x0200;
    CODE_B5F0CD();
  }
  CODE_B6F335();
}

/** $B6F335 */
export function CODE_B6F335(): void {
  reg.a = r16(0x0af8);
  if (reg.a < 0x0100) {
    reg.a = 0x0200;
    CODE_B5F0ED();
  }
  CODE_B6F344();
}

/** $B6F344 */
export function CODE_B6F344(): void {
  if (dec(0, 0x0658) === 0) return CODE_B6F34A();
}

/** $B6F34A — spawn a rain egg at a random position of the table in bank $BA. */
export function CODE_B6F34A(): void {
  stk.push(reg.x);
  reg.x = (r16(BOSS.hp) * 2) & 0xffff;
  reg.y = krowPhase();
  w16(0x0658, db16(reg.y + 0x16));
  trb(0x06a1, 0x8000);
  reg.y = C.special_sprite_spawn_id_00A2;
  spawn_special_sprite_index();
  reg.a = snd(5, "egg_kudgel_fall");
  queue_sound_effect();
  CODE_B4C175(); // random number
  w16(BOSS.flag, reg.a);
  io16(CPU.dividen, reg.a);
  reg.a = rom16(RAIN_EGG_COUNT);
  if (reg.a >= r16(BOSS.flag)) return CODE_B6F396();
  io8(CPU.divisor, reg.a & 0xff);
  reg.a = 0x0008;
  CODE_B6F38E();
}

/** $B6F38E — random % count (read from $4216, the remainder). */
export function CODE_B6F38E(): void {
  reg.a = ioR16(CPU.multiply_result);
  CODE_B6F39A();
}

/** $B6F396 */
export function CODE_B6F396(): void {
  reg.a = r16(BOSS.flag);
  CODE_B6F39A();
}

/** $B6F39A — set up the rain egg's fall towards the chosen point. */
export function CODE_B6F39A(): void {
  reg.x = (reg.a << 1) & 0xffff;
  w16(0xcf, 0xba00);
  reg.a = rom16((RAIN_EGG_TABLE + reg.x) & 0xffffff);
  w16(0xce, reg.a);
  const egg = r16(R.alternate_sprite);
  reg.y = egg;
  wr(egg, 0x30, rd(egg, 0x30) | 0x0020);
  wr(egg, 0x06, 0x01b0);
  wr(egg, 0x0a, 0x0168);
  const body = r16(BOSS.body);
  reg.x = body;
  reg.a = rd(body, 0x2e);
  if (reg.a & 0x0004) return CODE_B6F3E0();
  CODE_B4C175();
  if (reg.a >= 0x8000) return CODE_B6F3E0(); // a "fake" egg
  wr(reg.x, 0x2e, rd(reg.x, 0x2e) | 0x0004);
  reg.a = rd(reg.y, 0x2e) | 0x010b; // a real egg
  CODE_B6F3E6();
}

/** $B6F3E0 */
export function CODE_B6F3E0(): void {
  reg.a = rd(reg.y, 0x2e) | 0x018b;
  CODE_B6F3E6();
}

const ceRead = () => {
  const lo = r16(0xce);
  return rom16((((r8(0xd0) << 16) | lo) & 0xffffff));
};
const ceInc = (n: number) => w16(0xce, (r16(0xce) + n) & 0xffff);

/** $B6F3E6 */
export function CODE_B6F3E6(): void {
  const egg = reg.y;
  wr(egg, 0x2e, reg.a);
  reg.a = ceRead();
  ceInc(2);
  reg.a = (reg.a - rd(egg, 0x06)) & 0xffff;
  if (!isNeg(reg.a)) return CODE_B6F40D();
  reg.a = neg(reg.a);
  wr(egg, 0x10, reg.a);
  wr(egg, 0x20, 0xffff);
  reg.a = neg(ceRead());
  wr(egg, 0x22, reg.a);
  CODE_B6F41B();
}

/** $B6F40D */
export function CODE_B6F40D(): void {
  const egg = reg.y;
  wr(egg, 0x10, reg.a);
  wr(egg, 0x20, 0x0001);
  reg.a = ceRead();
  wr(egg, 0x22, reg.a);
  CODE_B6F41B();
}

/** $B6F41B */
export function CODE_B6F41B(): void {
  io16(CPU.dividen, rd(reg.y, 0x10));
  reg.a = (((ceRead() + 1) & 0xffff) << 4) & 0xffff;
  io8(CPU.divisor, reg.a & 0xff);
  reg.a = 0x0008;
  CODE_B6F432();
}

/** $B6F432 */
export function CODE_B6F432(): void {
  reg.a = ioR16(CPU.divide_result);
  if (reg.a === 0) reg.a = 1;
  CODE_B6F43B();
}

/** $B6F43B */
export function CODE_B6F43B(): void {
  const egg = reg.y;
  w8(egg + 0x24, reg.a & 0xff);
  w8(egg + 0x26, reg.a & 0xff);
  wr(egg, 0x28, 0x0010);
  ceInc(2);
  w8(egg + 0x2a, ceRead() & 0xff);
  ceInc(2);
  w8(egg + 0x0e, ceRead() & 0xff);
  ceInc(2);
  w8(egg + 0x0f, ceRead() & 0xff);
  ceInc(2);
  wr(egg, 0x4e, ceRead());
  ceInc(2);
  wr(egg, 0x54, ceRead());
  let a = (rd(egg, 0x54) - 2) & 0xffff;
  w8(egg + 0x2b, a & 0xff);
  a = (a - 1) & 0xffff;
  w16(0x0767, a);
  ceInc(2);
  wr(egg, 0x52, ceRead());
  w16(R.current_sprite, egg);
  reg.a = rd(egg, 0x20);
  if (!isNeg(reg.a)) return CODE_B6F4AA();
  reg.a = 0x0302;
  CODE_B6F4AD();
}

/** $B6F4AA */
export function CODE_B6F4AA(): void {
  reg.a = 0x02fe;
  CODE_B6F4AD();
}

/** $B6F4AD */
export function CODE_B6F4AD(): void {
  const egg = reg.y;
  wr(egg, 0x0c, reg.a);
  reg.a = rd(egg, 0x2e);
  if (!(reg.a & 0x0080)) return CODE_B6F56D();
  CODE_B6F4BB();
}

/**
 * $B6F4BB — a fake egg: aimed at the active Kong instead (x speed from the distance to the
 * arena centre $1B0, random bounce count).
 */
export function CODE_B6F4BB(): void {
  const egg = reg.y;
  wr(egg, 0x10, 0x270f);
  w8(egg + 0x24, 0);
  w8(egg + 0x26, 0);
  const kong = r16(R.active_kong_sprite);
  reg.x = kong;
  reg.a = (rd(kong, 0x06) - 0x01b0 - 1) & 0xffff; // CLC : SBC
  if (isNeg(reg.a)) reg.a = neg(reg.a);
  CODE_B6F4DC();
}

/** $B6F4DC */
export function CODE_B6F4DC(): void {
  io16(CPU.dividen, reg.a);
  reg.a = 0x0083;
  io8(CPU.divisor, 0x83);
  reg.a = 0x0008;
  CODE_B6F4EC();
}

/** $B6F4EC */
export function CODE_B6F4EC(): void {
  const egg = reg.y, kong = reg.x;
  reg.a = ioR16(CPU.divide_result);
  wr(egg, 0x22, reg.a);
  io16(CPU.dividen, 0x0010);
  reg.a = rd(kong, 0x06);
  if (reg.a >= 0x018b && reg.a < 0x01d5) {
    reg.a = 0x0008;
    return CODE_B6F51C();
  }
  CODE_B6F50C();
}

/** $B6F50C */
export function CODE_B6F50C(): void {
  io8(CPU.divisor, reg.a & 0xff);
  reg.a = 0x0008;
  CODE_B6F516();
}

/** $B6F516 */
export function CODE_B6F516(): void {
  reg.a = ioR16(CPU.divide_remainder);
  CODE_B6F51C();
}

/** $B6F51C */
export function CODE_B6F51C(): void {
  const egg = reg.y, kong = reg.x;
  wr(egg, 0x2a, reg.a);
  if (0x01b0 >= rd(kong, 0x06)) {
    wr(egg, 0x22, neg(rd(egg, 0x22)));
    wr(egg, 0x20, 0xffff);
    reg.a = 0x0306;
    return CODE_B6F544();
  }
  CODE_B6F53B();
}

/** $B6F53B */
export function CODE_B6F53B(): void {
  wr(reg.y, 0x20, 0x0001);
  reg.a = 0x0305;
  CODE_B6F544();
}

/** $B6F544 */
export function CODE_B6F544(): void {
  wr(reg.y, 0x0c, reg.a);
  CODE_B4C175();
  io16(CPU.dividen, reg.a);
  reg.a = 0x000e;
  io8(CPU.divisor, 0x0e);
  reg.a = 0x0008;
  CODE_B6F55B();
}

/** $B6F55B */
export function CODE_B6F55B(): void {
  reg.a = (ioR16(CPU.divide_remainder) + 1) & 0xffff;
  if (reg.a < 0x0003) reg.a = (reg.a + 0x0003) & 0xffff;
  CODE_B6F56A();
}

/** $B6F56A */
export function CODE_B6F56A(): void {
  wr(reg.y, 0x54, reg.a);
  CODE_B6F56D();
}

/** $B6F56D */
export function CODE_B6F56D(): void {
  const x = stk.pop()!;
  reg.x = x;
  w16(R.current_sprite, x);
}

// ---------------------------------------------------------------------------------------
// Body

/** $B6F571 — Krow's body: spawns the head and runs the boss script. */
export function krows_body_sprite_code(): void {
  bodyDB = reg.db;
  reg.db = 0xb6;
  CODE_BAC949();
  reg.x = cur();
  process_sprite_animation();
  let x = cur();
  reg.x = x;
  reg.a = rd(x, 0x42);
  if (reg.a === 0) {
    // first frame: clear the boss RAM, set up HP and the first pattern, spawn the head
    CODE_B4AEAF();
    x = reg.x;
    wr(x, 0x04, 0);
    wr(x, 0x32, 0);
    w16(0x06a1, 0);
    w16(0x06a3, 0);
    w16(0x06a5, 0);
    w16(BOSS.pattern, DATA_B6F932);
    w16(BOSS.hp, 0x0004);
    w16(0x06d5, 0x0001);
    for (const a of [0x06d7, 0x06d9, 0x06db, 0x06dd, 0x06df]) w16(a, 0);
    reg.y = SPAWN_009C;
    spawn_special_sprite_index();
    reg.a = r16(R.alternate_sprite);
    x = cur();
    reg.x = x;
    w16(BOSS.body, x);
    w16(BOSS.head, reg.a);
    wr(x, 0x42, reg.a);
    wr(x, 0x44, 0);
    wr(x, 0x0e, 0);
    w16(0x06d3, 0);
    parse_boss_command();
  }
  reg.a = r16(BOSS.hp);
  if (reg.a === 0) return CODE_B6F692();
  krowAlive();
}

/** `.alive`: the bonk check (touching Krow hurts the Kongs). */
function krowAlive(): void {
  const x = cur();
  reg.x = x;
  reg.a = rd(x, 0x2e);
  if (!(reg.a & 0x0200)) return CODE_B6F61A();
  reg.a = rd(x, 0x04);
  if (reg.a !== 0) {
    dec(x, 0x04);
    return CODE_B6F672();
  }
  get_current_sprite_clipping();
  reg.a = 0x007b;
  check_complex_player_collision_B6();
  if (!reg.c) return CODE_B6F672();
  reg.a = 0x001e;
  reg.y = 0xfe00;
  CODE_B3A600();
  const body = r16(BOSS.body);
  reg.x = body;
  wr(body, 0x2e, rd(body, 0x2e) | 0x0200);
  reg.a = 0x0014;
  wr(body, 0x04, 0x0014);
  CODE_B6F672();
}

/** $B6F61A — a Kong jumping on Krow (only allowed from above after the egg hits). */
export function CODE_B6F61A(): void {
  get_current_sprite_clipping();
  const r = bumpCheck(0x0000);
  if (!r.c) return CODE_B6F672();
  if (r.zx || reg.a === 0x0002) return CODE_B6F650();
  reg.a = r16(BOSS.hp);
  if (reg.a >= 0x0003) return CODE_B6F672();
  reg.a = 0x8000;
  tsb(0x06a1, 0x8000);
  CODE_B6F672();
}

/** $B6F650 — stomped: bonk the Kong away and hurt Krow. */
export function CODE_B6F650(): void {
  const body = r16(BOSS.body);
  reg.x = body;
  wr(body, 0x2e, rd(body, 0x2e) | 0x0200);
  wr(body, 0x04, 0x0014);
  reg.a = 0x001e;
  reg.y = 0xfe00;
  CODE_B3A600();
  reg.y = r16(R.inactive_kong_sprite);
  CODE_B6F82D();
  reg.x = r16(BOSS.body);
  CODE_B6F672();
}

/** $B6F672 — rain eggs, then run the current command's return code / the next command. */
export function CODE_B6F672(): void {
  reg.a = rd(reg.x, 0x2e);
  if (reg.a & 0x0001) {
    CODE_B6F326();
    reg.a = rd(reg.x, 0x44);
    if (reg.a === 0) return CODE_B6F68B();
  }
  CODE_B6F680();
}

/** $B6F680 */
export function CODE_B6F680(): void {
  reg.a = rd(reg.x, 0x44);
  jsrAddr(0xb60000 | reg.a);
  const x = cur();
  reg.x = x;
  reg.a = rd(x, 0x44);
  if (reg.a !== 0) return CODE_B6F68E();
  CODE_B6F68B();
}

/** $B6F68B */
export function CODE_B6F68B(): void {
  parse_boss_command();
  CODE_B6F68E();
}

/** $B6F68E — `PLB : JML [sprite_return_address]`. */
export function CODE_B6F68E(): void {
  reg.db = bodyDB;
}

/** $B6F692 — defeated: fall (bit $0400 set by CODE_B6F904) and bounce on the floor. */
export function CODE_B6F692(): void {
  reg.a = rd(reg.x, 0x2e);
  if (!(reg.a & 0x0400)) return CODE_B6F68E();
  CODE_B6F69C();
}

/** $B6F69C */
export function CODE_B6F69C(): void {
  reg.a = rd(reg.x, 0x2e);
  if (reg.a & 0x0800) return CODE_B6F70A();
  CODE_B6F6A6();
}

/** $B6F6A6 — fall with speed $0C; on the floor ($1EB) bounce once, then stay. */
export function CODE_B6F6A6(): void {
  const x = reg.x;
  reg.a = (rd(x, 0x0a) + rd(x, 0x0c)) & 0xffff;
  wr(x, 0x0a, reg.a);
  if (reg.a < 0x01eb) return CODE_B6F6EA();
  wr(x, 0x0a, 0x01eb);
  wr(x, 0x0e, 0x0000);
  reg.a = 0xffff;
  wr(x, 0x10, 0xffff);
  reg.a = rd(x, 0x0c);
  if (reg.a < 0x0004) return CODE_B6F6D8();
  wr(x, 0x0c, 0xfffc);
  reg.a = snd(4, "knock");
  queue_sound_effect();
  reg.x = x;
  CODE_B6F6EA();
}

/** $B6F6D8 */
export function CODE_B6F6D8(): void {
  const x = reg.x;
  wr(x, 0x2e, rd(x, 0x2e) | 0x0800);
  reg.a = snd(4, "knock");
  queue_sound_effect();
  reg.x = x;
  CODE_B6F70A();
}

/** $B6F6EA — gravity: speed +1 every 2 frames, with a sub-pixel counter in $10. */
export function CODE_B6F6EA(): void {
  const x = reg.x;
  reg.a = inc(x, 0x0e);
  if (reg.a === 0x0002) {
    wr(x, 0x0e, 0);
    inc(x, 0x0c);
  }
  CODE_B6F6F7();
}

/** $B6F6F7 */
export function CODE_B6F6F7(): void {
  const x = reg.x;
  reg.a = (rd(x, 0x10) - rd(x, 0x0e)) & 0xffff;
  if (!isNeg(reg.a)) return CODE_B6F708();
  reg.a = (reg.a + 0x0002) & 0xffff;
  wr(x, 0x10, reg.a);
  inc(x, 0x0a);
  CODE_B6F70A();
}

/** $B6F708 */
export function CODE_B6F708(): void {
  wr(reg.x, 0x10, reg.a);
  CODE_B6F70A();
}

/** $B6F70A — the head follows the body. */
export function CODE_B6F70A(): void {
  const x = reg.x;
  reg.y = r16(BOSS.head);
  wr(reg.y, 0x0a, rd(x, 0x0a));
  reg.a = rd(x, 0x06);
  wr(reg.y, 0x06, reg.a);
  CODE_B6F68E();
}

/** $B6F71A — animation callback: play the animation in $0C, if any. */
export function CODE_B6F71A(): void {
  const x = cur();
  reg.x = x;
  reg.a = rd(x, 0x0c);
  if (reg.a !== 0) set_sprite_animation();
  CODE_B6F724();
}

/** $B6F724 */
export function CODE_B6F724(): void {}

/** $B6F725 — animation callback: flying ($2E bit 6). */
export function CODE_B6F725(): void {
  const x = cur();
  reg.x = x;
  reg.a = rd(x, 0x2e) | 0x0040;
  wr(x, 0x2e, reg.a);
}

/** $B6F72F — animation callback: speed the animation up ($3A += $20, below $200). */
export function CODE_B6F72F(): void {
  const x = cur();
  reg.x = x;
  reg.a = rd(x, 0x2e);
  if (!(reg.a & 0x0002)) {
    reg.a = (rd(x, 0x3a) + 0x0020) & 0xffff;
    if (reg.a < 0x0200) wr(x, 0x3a, reg.a);
  }
  CODE_B6F745();
}

/** $B6F745 */
export function CODE_B6F745(): void {}

/** $B6F746 — animation callback: start falling (defeated), no more bonks. */
export function CODE_B6F746(): void {
  const x = cur();
  reg.x = x;
  reg.a = (rd(x, 0x2e) | 0x0400) & 0xfdff;
  wr(x, 0x2e, reg.a);
}

/**
 * $B6F753 — animation callback at the end of an animation: apply the pending animations of
 * body/head ($1E), and after a turn flip both sprites and restore the remembered animations.
 */
export function CODE_B6F753(): void {
  const x = cur();
  reg.x = x;
  reg.a = rd(x, 0x1e);
  reg.y = rd(x, 0x42);
  reg.a |= rd(reg.y, 0x1e);
  if (reg.a === 0) return CODE_B6F780();
  reg.a = rd(x, 0x1e);
  if (reg.a !== 0) {
    w16(BOSS.bodyAnim, reg.a);
    wr(x, 0x1e, 0);
  }
  CODE_B6F768();
}

/** $B6F768 */
export function CODE_B6F768(): void {
  const x = reg.x;
  reg.y = rd(x, 0x42);
  reg.a = rd(reg.y, 0x1e);
  if (reg.a !== 0) {
    w16(BOSS.headAnim, reg.a);
    reg.a = 0;
    wr(reg.y, 0x1e, 0);
  }
  CODE_B6F779();
}

/** $B6F779 */
export function CODE_B6F779(): void {
  reg.a = rd(reg.x, 0x2e);
  if (!(reg.a & 0x0002)) return CODE_B6F79E();
  CODE_B6F780();
}

/** $B6F780 */
export function CODE_B6F780(): void {
  const x = reg.x;
  reg.a = rd(x, 0x2e);
  if (!(reg.a & 0x0002)) return CODE_B6F7C2();
  wr(x, 0x2e, reg.a & 0xfffd);
  wr(x, 0x12, rd(x, 0x12) ^ 0x4000);
  reg.y = rd(x, 0x42);
  reg.a = rd(reg.y, 0x12) ^ 0x4000;
  wr(reg.y, 0x12, reg.a);
  CODE_B6F79E();
}

/** $B6F79E */
export function CODE_B6F79E(): void {
  reg.a = r16(BOSS.bodyAnim);
  if (reg.a !== 0) {
    set_sprite_animation();
    w16(BOSS.bodyAnim, 0);
  }
  CODE_B6F7AB();
}

/** $B6F7AB */
export function CODE_B6F7AB(): void {
  reg.a = r16(BOSS.headAnim);
  if (reg.a !== 0) {
    const x = cur();
    reg.x = x;
    reg.y = rd(x, 0x42);
    w16(R.current_sprite, reg.y);
    set_sprite_animation();
    w16(BOSS.headAnim, 0);
    reg.x = x;
    w16(R.current_sprite, x);
  }
  CODE_B6F7C2();
}

/** $B6F7C2 */
export function CODE_B6F7C2(): void {}

// ---------------------------------------------------------------------------------------
// Head

/** $B6F7C3 — the head: hurts Kongs touching it (or flags a hit from below). */
export function krows_head_sprite_code(): void {
  reg.a = r16(BOSS.hp);
  if (reg.a === 0) return CODE_B6F824();
  CODE_B6F7CC();
}

/** $B6F7CC */
export function CODE_B6F7CC(): void {
  reg.x = r16(BOSS.body);
  reg.a = rd(reg.x, 0x2e);
  if (reg.a & 0x0200) return CODE_B6F7FC();
  get_current_sprite_clipping();
  const r = bumpCheck(0x0000);
  if (!r.c) return CODE_B6F824();
  reg.a = 0x8000;
  tsb(0x06a1, 0x8000);
  CODE_B6F824();
}

/** $B6F7FC */
export function CODE_B6F7FC(): void {
  reg.x = r16(BOSS.body);
  reg.a = rd(reg.x, 0x04);
  if (reg.a !== 0) return CODE_B6F824();
  reg.x = cur();
  get_current_sprite_clipping();
  reg.a = 0x007b;
  check_complex_player_collision_B6();
  if (!reg.c) return CODE_B6F824();
  reg.a = 0x001e;
  reg.y = 0xfe00;
  CODE_B3A600();
  reg.x = r16(BOSS.body);
  reg.a = 0x0014;
  wr(reg.x, 0x04, 0x0014);
  CODE_B6F824();
}

/** $B6F824 */
export function CODE_B6F824(): void {
  reg.x = cur();
  process_sprite_animation();
}

// ---------------------------------------------------------------------------------------
// Krow gets hurt

/**
 * $B6F82D — Krow is hit (Y = the sprite that hit him: an egg or the Kong): lose 1 HP,
 * knock-back shake away from Y, then the next pattern (or the defeat when HP is 0).
 */
export function CODE_B6F82D(): void {
  stk.push(reg.y);
  const body = r16(BOSS.body);
  reg.x = body;
  w16(R.current_sprite, body);
  wr(body, 0x4c, 0);
  wr(body, 0x2e, rd(body, 0x2e) & 0xffef);
  disable_bullet_time_global();
  reg.a = r16(BOSS.hp);
  if (reg.a < 0x0003) w16(0x06d3, 0);
  CODE_B6F84C();
}

/** $B6F84C */
export function CODE_B6F84C(): void {
  dec(0, BOSS.hp);
  w16(0x06a1, r16(0x06a1) | 0x8000);
  CODE_B6F8F3();
  const x = reg.x;
  wr(x, 0x2e, (rd(x, 0x2e) | 0x1200) & 0xfffd);
  reg.a = rd(x, 0x2e);
  if (reg.a & 0x0020) {
    wr(x, 0x06, r16(0x0660));
    wr(x, 0x0a, r16(0x0662));
  }
  CODE_B6F87A();
}

/** $B6F87A */
export function CODE_B6F87A(): void {
  const x = reg.x;
  wr(x, 0x2e, rd(x, 0x2e) & 0xffda);
  reg.a = r16(BOSS.hp);
  if (reg.a === 0) return CODE_B6F891();
  if (reg.a >= 0x0003) return CODE_B6F8A1();
  reg.a = DATA_B6FDFA;
  CODE_B6F8A4();
}

/** $B6F891 — last hit: defeat animations (pending in $1E). */
export function CODE_B6F891(): void {
  reg.a = 0x0202;
  wr(reg.x, 0x1e, 0x0202);
  reg.y = r16(BOSS.head);
  reg.a = 0x020a;
  wr(reg.y, 0x1e, 0x020a);
  CODE_B6F8EC();
}

/** $B6F8A1 */
export function CODE_B6F8A1(): void {
  reg.a = DATA_B6FDEA;
  CODE_B6F8A4();
}

/** $B6F8A4 */
export function CODE_B6F8A4(): void {
  wr(reg.x, 0x46, reg.a);
  wr(reg.x, 0x1e, 0);
  reg.a = C.krow_body_hurt_anim_id;
  set_sprite_animation();
  const head = r16(BOSS.head);
  reg.x = head;
  w16(R.current_sprite, head);
  wr(head, 0x1e, 0);
  reg.a = C.krow_head_hurt_anim_id;
  set_sprite_animation();
  const x = r16(BOSS.body);
  reg.x = x;
  w16(R.current_sprite, x);
  wr(x, 0x20, DAMAGE_OFFSETS);
  wr(x, 0x22, CODE_B6CEA7_PTR); // end of the offsets table
  wr(x, 0x24, 0x0001);
  wr(x, 0x26, 0x0001);
  const hitter = stk[stk.length - 1];
  reg.y = hitter;
  if (rd(x, 0x06) >= rd(hitter, 0x06)) return CODE_B6F8E2();
  reg.a = 0xffff;
  CODE_B6F8E5();
}

/** $B6F8E2 */
export function CODE_B6F8E2(): void {
  reg.a = 0x0001;
  CODE_B6F8E5();
}

/** $B6F8E5 */
export function CODE_B6F8E5(): void {
  wr(reg.x, 0x28, reg.a);
  reg.a = CODE_B6F8EE_PTR;
  wr(reg.x, 0x44, reg.a);
  CODE_B6F8EC();
}

/** $B6F8EC */
export function CODE_B6F8EC(): void {
  reg.y = stk.pop()!;
}

/** $B6F8EE — return code while hurt. */
export function CODE_B6F8EE(): void {
  CODE_B6CEA7();
}

/** $B6F8F3 — delete the egg Krow holds in his claws. */
export function CODE_B6F8F3(): void {
  const x = reg.x;
  reg.a = rd(x, 0x0e);
  if (reg.a !== 0) {
    w16(R.current_sprite, reg.a);
    delete_sprite_handle_deallocation();
    reg.x = x;
    w16(R.current_sprite, x);
    wr(x, 0x0e, 0);
  }
  CODE_B6F903();
}

/** $B6F903 */
export function CODE_B6F903(): void {}

/** $B6F904 — animation callback: Krow is defeated, start falling. */
export function CODE_B6F904(): void {
  const x0 = reg.x;
  const body = r16(BOSS.body);
  reg.x = body;
  wr(body, 0x2e, rd(body, 0x2e) | 0x0400);
  wr(body, 0x0c, 0x0001);
  wr(body, 0x0e, 0x0000);
  reg.a = 0xffff;
  wr(body, 0x10, 0xffff);
  w16(R.current_sprite, body);
  reg.a = C.krow_body_defeat_anim_id;
  set_sprite_animation();
  reg.x = x0;
  w16(R.current_sprite, x0);
  reg.a = C.krow_head_defeat_anim_id;
  set_sprite_animation();
}

/** $B6FE9E — JSL wrapper of CODE_B6FEA2. */
export function CODE_B6FE9E(): void {
  CODE_B6FEA2();
}

/** $B6FEA2 — spawn a hit star between the colliding sprites. */
export function CODE_B6FEA2(): void {
  CODE_BCFED8();
  CODE_BCFEC0();
  CODE_B3A334();
  reg.y = HIT_STAR;
  spawn_special_sprite_address();
  reg.x = cur();
}

registerSprite({
  CODE_B6ECB4, CODE_B6ECC8, CODE_B6ECCD, CODE_B6ECD4, CODE_B6ECD7, CODE_B6ECE4,
  krows_egg_sprite_code, CODE_B6ED0B, CODE_B6ED21, CODE_B6ED51, CODE_B6ED54, CODE_B6ED8B,
  CODE_B6ED9E, CODE_B6EDAD, CODE_B6EDB0, CODE_B6EDBB, CODE_B6EDBE, CODE_B6EDCC, CODE_B6EDEC,
  CODE_B6EDFE, CODE_B6EE03, CODE_B6EE06, CODE_B6EE32, CODE_B6EE4D, CODE_B6EE63, CODE_B6EE6F,
  CODE_B6EE7B, CODE_B6EE8F, CODE_B6EE94, CODE_B6EEB9, CODE_B6EED7, CODE_B6EF09, CODE_B6EF10,
  CODE_B6EF1A, CODE_B6EF1D, CODE_B6EF23, CODE_B6EF2D, CODE_B6EF3E, CODE_B6EF48, CODE_B6EFA4,
  CODE_B6EFA9, CODE_B6EFCB, CODE_B6EFEE, CODE_B6F00E, CODE_B6F015, CODE_B6F031, CODE_B6F038,
  CODE_B6F051, CODE_B6F055, CODE_B6F059, krows_body_sprite_code, CODE_B6F61A, CODE_B6F650,
  CODE_B6F672, CODE_B6F680, CODE_B6F68B, CODE_B6F68E, CODE_B6F692, CODE_B6F69C, CODE_B6F6A6,
  CODE_B6F6D8, CODE_B6F6EA, CODE_B6F6F7, CODE_B6F708, CODE_B6F70A, krows_head_sprite_code,
  CODE_B6F7CC, CODE_B6F7FC, CODE_B6F824, CODE_B6F07C, CODE_B6F09A, CODE_B6F09D, CODE_B6F0C4,
  CODE_B6F0DB, CODE_B6F0FB,
});
registerRtl({
  CODE_B6F71A, CODE_B6F724, CODE_B6F725, CODE_B6F72F, CODE_B6F745, CODE_B6F746, CODE_B6F753,
  CODE_B6F768, CODE_B6F779, CODE_B6F780, CODE_B6F79E, CODE_B6F7AB, CODE_B6F7C2, CODE_B6F904,
  CODE_B6FE9E,
});
registerRts({
  CODE_B6F063, CODE_B6F07B, CODE_B6F102, CODE_B6F119, CODE_B6F11B, CODE_B6F12C, CODE_B6F18D,
  CODE_B6F19C, CODE_B6F1A9, CODE_B6F1BF, CODE_B6F1C2, CODE_B6F1EE, CODE_B6F1FB, CODE_B6F205,
  CODE_B6F229, CODE_B6F236, CODE_B6F257, CODE_B6F266, CODE_B6F27A, CODE_B6F2CE, CODE_B6F2F5,
  CODE_B6F326, CODE_B6F335, CODE_B6F344, CODE_B6F34A, CODE_B6F38E, CODE_B6F396, CODE_B6F39A,
  CODE_B6F3E0, CODE_B6F3E6, CODE_B6F40D, CODE_B6F41B, CODE_B6F432, CODE_B6F43B, CODE_B6F4AA,
  CODE_B6F4AD, CODE_B6F4BB, CODE_B6F4DC, CODE_B6F4EC, CODE_B6F50C, CODE_B6F516, CODE_B6F51C,
  CODE_B6F53B, CODE_B6F544, CODE_B6F55B, CODE_B6F56A, CODE_B6F56D, CODE_B6F82D, CODE_B6F84C,
  CODE_B6F87A, CODE_B6F891, CODE_B6F8A1, CODE_B6F8A4, CODE_B6F8E2, CODE_B6F8E5, CODE_B6F8EC,
  CODE_B6F8EE, CODE_B6F8F3, CODE_B6F903, CODE_B6FEA2,
});
