/**
 * Bank $B6 — Kleever, the boss of Kleever's Kiln (world 2): the haunted sword rising from
 * the lava. It shoots fireballs (phases 6-4, $0652 = HP 6..1), gets hit by cannonballs the
 * Kongs throw at it, then in the last phases flies around and attacks with its blade.
 *
 * Kleever ($0654; $42 = the fire/attack effect sprite, $0656 = the arm/hand, $0759 the hand
 * bubbles in the lava) flags in $2E: bit 0 hurt (stunned), 1 attack enabled, 2 flying/chasing,
 * 3 turning, 4 shooting fire, 6 on the right side, 7 cannonball pending, 8 attack done,
 * 9 cleared each frame, $0400 a hook phase, $0800 hooks spawned, $1000 initialised,
 * $2000 to be deleted, $4000 frozen (the Kong is dying).
 * $52 = the current "action" routine (JMP ($0052,x)), $46 its timer; $4C = the offset table
 * of the sword sprite relative to the body (bank $BA).
 * $06D5-$06DF: shake offsets / timers, $06E1-$06E7 the hover drift, $06E9 hurt timer,
 * $06EB-$06ED / $0711-$0715 the palette cycle.
 */
import { r8, r16, w8, w16, io8, io16, ioR16, rom16 } from "../../core/mem";
import { reg, callPtr } from "../../core/cpu";
import { L, R, C, CPU, sprite } from "../../core/sym";
import {
  queue_sound_effect, spawn_special_sprite_index, spawn_big_special_sprite_index, spawn_no_gfx_special_sprite_address,
  set_sprite_animation, set_alt_sprite_animation, delete_sprite_handle_deallocation, get_current_sprite_clipping,
  CODE_B3A600, CODE_B4C175, CODE_B4AEAF, process_sprite_animation, interpolate_x_velocity_global,
  interpolate_y_velocity_global, apply_position_from_velocity_global, set_sprite_palette_direct_global,
  set_sprite_palette_global, CODE_BEBD8E, kong_cutscene_handler, queue_or_reset_looping_sound_effect,
  CODE_BAC949,
} from "../../gen/routines";
import { cur, rd, wr, dec, inc, neg, isNeg, facingLeft, snd, BOSS, registerRts, registerRtl, registerSprite } from "./b6ba_common";
import { db16, setCE, ce16, ceAdd, check_complex_player_collision_B6, CODE_B6D923 } from "./b6ba_boss_commands";

const PATTERN_TABLE = L("kleever_attack_pattern_table") & 0xffff;
const CANBALL_X_LEFT = L("kleever_canball_x_spawn_pos_left") & 0xffff;
const CANBALL_X_RIGHT = L("kleever_canball_x_spawn_pos_right") & 0xffff;
const DATA_B6D451 = L("DATA_B6D451") & 0xffff;
const DATA_BAAB44 = L("DATA_BAAB44") & 0xffff;
const DATA_BAAB48 = L("DATA_BAAB48") & 0xffff;
const DATA_BAA6D0 = L("DATA_BAA6D0") & 0xffff;
const DATA_BAAAE8 = L("DATA_BAAAE8") & 0xffff;
const DATA_BAAABE = L("DATA_BAAABE") & 0xffff;
const DATA_BAA224 = L("DATA_BAA224") & 0xffff;
const Y_BOB_TABLE = L("kleever_y_bob_offset_table") & 0xffff;
const FRAGMENT_COUNT = L("kleever_fragment_spawn_count");
const DATA_B6D897 = L("DATA_B6D897") & 0xffff;
const DATA_B6D923 = L("DATA_B6D923") & 0xffff;
const DATA_B6E08F = L("DATA_B6E08F") & 0xffff;
const DATA_B6E0A3 = L("DATA_B6E0A3") & 0xffff;
const DATA_B6E0B3 = L("DATA_B6E0B3") & 0xffff;
const DATA_B6E8FC = L("DATA_B6E8FC") & 0xffff;
const DATA_B6E97C = L("DATA_B6E97C") & 0xffff;
const HOOK_SPAWN = L("DATA_FF1DC8") & 0xffff;
const PTR = (name: string) => L(name) & 0xffff;
const CLIP6 = 0x09a3 + 6 * 8;
const CLIP8 = 0x09a3 + 8 * 8;

/** Values pushed by one label and pulled by a later one of the same routine. */
const stk: number[] = [];
/** DB pushed by kleever_sprite_code. */
let kleeverDB = 0xb6;

/** Kleever's parameters for a phase (`kleever_attack_pattern_table[n]`). */
const phase = (n: number) => rom16(0xb60000 | ((PATTERN_TABLE + n * 2) & 0xffff));

/** $B6D1A1 — Kleever. The first frame sets up the fight (HP 6, the arm, fire, bubbles). */
export function kleever_sprite_code(): void {
  kleeverDB = reg.db;
  reg.db = 0xb6;
  CODE_BAC949();
  const x = cur();
  reg.x = x;
  reg.a = rd(x, 0x2e);
  if (reg.a & 0x1000) return CODE_B6D2C0();
  CODE_B6D1B4();
}

/** $B6D1B4 — first frame. */
export function CODE_B6D1B4(): void {
  let x = reg.x;
  wr(x, 0x2e, reg.a | 0x1000);
  wr(x, 0x32, 0);
  CODE_B4AEAF(); // clear the boss RAM
  reg.y = C.special_sprite_spawn_id_0188; // hand bubbles
  spawn_special_sprite_index();
  x = cur();
  reg.x = x;
  let y = r16(R.alternate_sprite);
  reg.y = y;
  w16(0x0759, y);
  wr(y, 0x06, rd(x, 0x06));
  wr(y, 0x0a, 0x02c0);
  w16(BOSS.hp, 0x0006);
  reg.y = phase(6);
  wr(x, 0x28, db16(reg.y + 6));
  wr(x, 0x22, 0x0005);
  reg.y = DATA_BAAB44;
  wr(x, 0x4c, DATA_BAAB44);
  CODE_B6DB52();
  x = reg.x;
  wr(x, 0x44, 0);
  wr(x, 0x2e, rd(x, 0x2e) | 0x00a0);
  w16(BOSS.pattern, 0x0208);
  w16(0x06e5, 0x0100);
  w16(0x06e7, 0x0100);
  w16(0x06e1, 0x001e);
  w16(0x06e3, 0x001b);
  w16(0x06e9, 0);
  for (const o of [0x26, 0x2a, 0x20, 0x24]) wr(x, o, 0);
  w16(0x0658, 0);
  wr(x, 0x4e, 0x006e);
  reg.a = 0x0005;
  interpolate_x_velocity_global();
  reg.a = 0x0005;
  interpolate_y_velocity_global();
  x = cur();
  reg.x = x;
  w16(0x06a1, 0);
  w16(0x06a3, 0);
  w16(0x06a5, 0);
  w16(BOSS.body, x);
  CODE_B6DC9B();
  reg.y = C.special_sprite_spawn_id_00A8; // the fire effect
  spawn_big_special_sprite_index();
  x = cur();
  reg.x = x;
  y = r16(R.alternate_sprite);
  reg.y = y;
  wr(x, 0x42, y);
  wr(y, 0x06, rd(x, 0x06));
  wr(y, 0x0a, rd(x, 0x0a));
  wr(y, 0x1c, 0xc000);
  wr(x, 0x54, 0);
  reg.y = C.special_sprite_spawn_id_00A6; // the arm
  spawn_special_sprite_index();
  x = cur();
  reg.x = x;
  y = r16(R.alternate_sprite);
  reg.y = y;
  w16(BOSS.head, y);
  wr(y, 0x06, rd(x, 0x06));
  wr(y, 0x0a, rd(x, 0x0a));
  wr(y, 0x42, 0x0003);
  wr(y, 0x44, Y_BOB_TABLE);
  wr(y, 0x46, Y_BOB_TABLE);
  wr(y, 0x48, DATA_BAA6D0);
  reg.y = x;
  const fire = rd(x, 0x42);
  wr(fire, 0x02, rd(fire, 0x02) + 1);
  const arm = r16(BOSS.head);
  wr(arm, 0x02, rd(arm, 0x02) - 1);
  x = cur();
  reg.x = x;
  wr(x, 0x52, PTR("CODE_B6D9DD"));
  wr(x, 0x46, 0x0064);
  CODE_B6E068();
  CODE_B6D2C0();
}

/** $B6D2C0 — every frame. */
export function CODE_B6D2C0(): void {
  const x = reg.x;
  reg.a = rd(x, 0x2e);
  if (reg.a & 0x2000) return CODE_B6D2FC();
  if (reg.a & 0x4000) return CODE_B6D302();
  reg.y = r16(R.active_kong_sprite);
  reg.a = rd(reg.y, 0x2e);
  if (reg.a === 0x0005 || reg.a === 0x003b) return CODE_B6D302(); // the Kong is dying
  CODE_B6D869();
  CODE_B6D358();
  CODE_B6D471();
  CODE_B6DAAF();
  CODE_B6DF9F();
  const x2 = cur();
  reg.x = x2;
  reg.a = rd(x2, 0x2e) & 0xfdff;
  wr(x2, 0x2e, reg.a);
  CODE_B6D2F4();
}

/** $B6D2F4 */
export function CODE_B6D2F4(): void {
  process_sprite_animation();
  CODE_B6D2F8();
}

/** $B6D2F8 — `PLB : JML [sprite_return_address]`. */
export function CODE_B6D2F8(): void {
  reg.db = kleeverDB;
}

/** $B6D2FC */
export function CODE_B6D2FC(): void {
  delete_sprite_handle_deallocation();
  CODE_B6D2F8();
}

/** $B6D302 — the Kong is dying: just hover. */
export function CODE_B6D302(): void {
  reg.a = r16(BOSS.head);
  if (reg.a !== 0) return CODE_B6D329();
  CODE_B6D7F4();
  const x = reg.x;
  wr(x, 0x26, r16(0x06e5));
  wr(x, 0x2a, r16(0x06e7));
  reg.a = rd(x, 0x22);
  interpolate_x_velocity_global();
  reg.x = cur();
  reg.a = rd(reg.x, 0x22);
  interpolate_y_velocity_global();
  apply_position_from_velocity_global();
  CODE_B6D329();
}

/** $B6D329 */
export function CODE_B6D329(): void {
  const x = reg.x;
  wr(x, 0x2e, rd(x, 0x2e) | 0x4000);
  reg.a = r16(0x06e9);
  if (reg.a === 0) return CODE_B6D2F4();
  CODE_B6E068();
  reg.a = C.kleever_idle_anim_id;
  set_sprite_animation();
  reg.a = r16(BOSS.head);
  if (reg.a === 0) return CODE_B6D2F4();
  w16(R.current_sprite, reg.a);
  reg.a = C.kleever_arm_idle_anim_id;
  set_sprite_animation();
  reg.a = r16(BOSS.body);
  w16(R.current_sprite, reg.a);
  CODE_B6D2F4();
}

/** $B6D358 — the cannonball: drop a new one when the last one is gone (or thrown away). */
export function CODE_B6D358(): void {
  const x = cur();
  reg.x = x;
  reg.a = r16(BOSS.hp);
  if (reg.a === 0) return CODE_B6D3C0();
  reg.y = rd(x, 0x44);
  reg.a = db16(reg.y); // its sprite type
  if (reg.a === C.sprite_kleever_canball || reg.a === C.sprite_kleever_falling_canball) return CODE_B6D390();
  reg.a = rd(x, 0x2e);
  if (reg.a & 0x0080) return CODE_B6D37B();
  CODE_B6D3C1();
  CODE_B6D3C0();
}

/** $B6D37B — wait $065A frames, then drop a cannonball. */
export function CODE_B6D37B(): void {
  const x = reg.x;
  reg.a = r16(BOSS.pattern);
  if (dec(0, BOSS.pattern) !== 0) return CODE_B6D3C0();
  wr(x, 0x2e, rd(x, 0x2e) & 0xff7f);
  CODE_B6D3EB();
  CODE_B6D3C0();
}

/** $B6D390 — a cannonball lying on the wrong side of the arena counts as gone. */
export function CODE_B6D390(): void {
  const x = reg.x, ball = reg.y;
  reg.a = rd(ball, 0x2e);
  if (reg.a !== 0) return CODE_B6D3C0();
  reg.a = rd(x, 0x2e);
  if (!(reg.a & 0x0040)) return CODE_B6D3AF();
  reg.a = rd(ball, 0x06);
  if (reg.a >= 0x050e) return CODE_B6D3C0();
  reg.a = 0x0005;
  wr(ball, 0x2e, 0x0005);
  CODE_B6D3C1();
  CODE_B6D3C0();
}

/** $B6D3AF */
export function CODE_B6D3AF(): void {
  const ball = reg.y;
  reg.a = rd(ball, 0x06);
  if (reg.a < 0x050e) return CODE_B6D3C0();
  reg.a = 0x0005;
  wr(ball, 0x2e, 0x0005);
  CODE_B6D3C1();
  CODE_B6D3C0();
}

/** $B6D3C0 */
export function CODE_B6D3C0(): void {}

/** $B6D3C1 — schedule the next cannonball ($065A frames). */
export function CODE_B6D3C1(): void {
  const x = cur();
  reg.x = x;
  wr(x, 0x2e, rd(x, 0x2e) | 0x0080);
  reg.y = r16(BOSS.body);
  reg.a = rd(reg.y, 0x2e);
  if (reg.a & 0x0001) {
    reg.a = r16(0x06e9);
    if (reg.a !== 0) {
      reg.a = (reg.a + 0x0014) & 0xffff;
      return CODE_B6D3E4();
    }
  }
  CODE_B6D3E1();
}

/** $B6D3E1 */
export function CODE_B6D3E1(): void {
  reg.a = 0x0050;
  CODE_B6D3E4();
}

/** $B6D3E4 */
export function CODE_B6D3E4(): void {
  w16(BOSS.pattern, reg.a);
  wr(reg.x, 0x44, 0);
}

/** $B6D3EB — drop a cannonball from the ceiling at a random x on Kleever's side. */
export function CODE_B6D3EB(): void {
  reg.y = C.special_sprite_spawn_id_00B0;
  spawn_special_sprite_index();
  const x = r16(BOSS.body);
  reg.x = x;
  reg.a = rd(x, 0x2e);
  if (reg.a & 0x0040) return CODE_B6D407();
  reg.y = DATA_B6D451;
  CODE_B6D424();
  reg.a = db16(CANBALL_X_LEFT + reg.y);
  CODE_B6D410();
}

/** $B6D407 */
export function CODE_B6D407(): void {
  reg.y = DATA_B6D451;
  CODE_B6D424();
  reg.a = db16(CANBALL_X_RIGHT + reg.y);
  CODE_B6D410();
}

/** $B6D410 */
export function CODE_B6D410(): void {
  const ball = r16(R.alternate_sprite);
  reg.y = ball;
  wr(ball, 0x06, reg.a);
  wr(ball, 0x24, 0x0340);
  reg.a = 0x0120;
  wr(ball, 0x0a, 0x0120);
  wr(reg.x, 0x44, ball);
}

/** $B6D424 — Y = 2 * (random % count), count = the word at Y. */
export function CODE_B6D424(): void {
  CODE_B4C175();
  w16(BOSS.flag, reg.a);
  io16(CPU.dividen, reg.a);
  reg.a = db16(reg.y);
  if (reg.a >= r16(BOSS.flag)) return CODE_B6D44A();
  io8(CPU.divisor, reg.a & 0xff);
  reg.a = ioR16(CPU.multiply_result); // $4216: the remainder
  CODE_B6D44E();
}

/** $B6D44A */
export function CODE_B6D44A(): void {
  reg.a = r16(BOSS.flag);
  CODE_B6D44E();
}

/** $B6D44E */
export function CODE_B6D44E(): void {
  reg.a = (reg.a << 1) & 0xffff;
  reg.y = reg.a;
}

/** $B6D471 — hits, Kong collisions, then the current action. */
export function CODE_B6D471(): void {
  reg.a = r16(BOSS.hp);
  CODE_B6D477();
}

/** $B6D477 */
export function CODE_B6D477(): void {
  const x = cur();
  reg.x = x;
  reg.a = rd(x, 0x2e);
  if (!(reg.a & 0x0001)) return CODE_B6D4D2();
  reg.a = rd(x, 0x54);
  if (reg.a !== 0) {
    dec(x, 0x54);
    return CODE_B6D53C();
  }
  CODE_B6D489();
}

/** $B6D489 — hurt: touching the blade hurts the Kongs. */
export function CODE_B6D489(): void {
  const x = reg.x;
  reg.a = r16(0x06e9);
  if (reg.a !== 0) return CODE_B6D4DB();
  reg.a = rd(x, 0x2e);
  if (!(reg.a & 0x0008)) return CODE_B6D4B3();
  get_current_sprite_clipping();
  reg.a = 0x0c7b;
  w16(BOSS.headAnim, 0);
  check_complex_player_collision_B6();
  if (reg.c) w16(BOSS.headAnim, r16(BOSS.headAnim) | 0x0002);
  CODE_B6D4B6();
}

/** $B6D4B3 */
export function CODE_B6D4B3(): void {
  CODE_B6E69F();
  CODE_B6D4B6();
}

/** $B6D4B6 */
export function CODE_B6D4B6(): void {
  reg.a = r16(BOSS.headAnim);
  if (reg.a & 0x0002) {
    reg.a = 0x001e;
    reg.y = 0xfe00;
    CODE_B3A600();
    const x = cur();
    reg.x = x;
    reg.a = 0x0014;
    wr(x, 0x54, 0x0014);
  }
  CODE_B6D53C();
}

/** $B6D4D2 */
export function CODE_B6D4D2(): void {
  reg.a = rd(reg.x, 0x32);
  if (reg.a === 0) return CODE_B6D4DB();
  CODE_B6D4D6();
}

/** $B6D4D6 — hit by a cannonball. */
export function CODE_B6D4D6(): void {
  CODE_B6E275();
  CODE_B6D53C();
}

/** $B6D4DB — check the cannonball / the Kongs against the blade ($065E bit 0 / bit 1). */
export function CODE_B6D4DB(): void {
  reg.a = rd(reg.x, 0x2e);
  if (!(reg.a & 0x0008)) return CODE_B6D52A();
  w16(BOSS.headAnim, 0);
  const x = cur();
  reg.x = x;
  reg.y = rd(x, 0x44);
  if (reg.y !== 0) {
    reg.a = rd(reg.y, 0x2e);
    if (reg.a === 0 || reg.a === 0x0006) return CODE_B6D510();
  }
  CODE_B6D4F5();
}

/** $B6D4F5 */
export function CODE_B6D4F5(): void {
  get_current_sprite_clipping();
  reg.a = 0x0200;
  reg.y = 0x0200;
  CODE_BEBD8E();
  if (reg.c) w16(BOSS.headAnim, r16(BOSS.headAnim) | 0x0001);
  CODE_B6D510();
}

/** $B6D510 */
export function CODE_B6D510(): void {
  get_current_sprite_clipping();
  reg.a = 0x0000;
  check_complex_player_collision_B6();
  if (reg.c) w16(BOSS.headAnim, r16(BOSS.headAnim) | 0x0002);
  CODE_B6D52D();
}

/** $B6D52A */
export function CODE_B6D52A(): void {
  CODE_B6E69F();
  CODE_B6D52D();
}

/** $B6D52D */
export function CODE_B6D52D(): void {
  reg.a = r16(0x06e9);
  if (reg.a !== 0) return CODE_B6D53C();
  reg.a = r16(BOSS.headAnim);
  if (reg.a & 0x0001) return CODE_B6D4D6();
  CODE_B6D53C();
}

/** $B6D53C — the sword moves with the body; run the action routine ($52). */
export function CODE_B6D53C(): void {
  const x = cur();
  reg.x = x;
  reg.y = rd(x, 0x4c);
  if (reg.y !== 0) CODE_B6DB86();
  CODE_B6D545();
}

/** $B6D545 */
export function CODE_B6D545(): void {
  const x = reg.x;
  reg.a = rd(x, 0x52);
  if (reg.a !== 0) return callPtr(0xb6, reg.a); // JMP ($0052,x)
  CODE_B6D54C();
}

/** $B6D54C */
export function CODE_B6D54C(): void {
  reg.a = rd(reg.x, 0x2e);
  if (!(reg.a & 0x0004)) return CODE_B6D642();
  CODE_B6D556();
}

/** $B6D556 — flying: count the hurt time down, then chase the Kong. */
export function CODE_B6D556(): void {
  reg.x = cur();
  reg.a = r16(0x06e9);
  if (reg.a === 0) return CODE_B6D580();
  if (dec(0, 0x06e9) !== 0) return CODE_B6D642();
  CODE_B6D566();
}

/** $B6D566 */
export function CODE_B6D566(): void {
  let x = cur();
  reg.x = x;
  reg.a = rd(x, 0x2e) & 0xfffe;
  wr(x, 0x2e, reg.a);
  if (!(reg.a & 0x0008)) {
    reg.a = C.kleever_idle_anim_id;
    set_sprite_animation();
    x = cur();
    reg.x = x;
  }
  CODE_B6D57D();
}

/** $B6D57D */
export function CODE_B6D57D(): void {
  CODE_B6E068();
  CODE_B6D580();
}

/** $B6D580 — close to the Kong? Then charge. */
export function CODE_B6D580(): void {
  const x = reg.x;
  const kong = r16(R.active_kong_sprite);
  reg.y = kong;
  wr(x, 0x48, rd(kong, 0x06));
  wr(x, 0x4a, rd(kong, 0x0a));
  reg.a = (rd(x, 0x06) - rd(kong, 0x06)) & 0xffff;
  if (isNeg(reg.a)) reg.a = neg(reg.a);
  CODE_B6D599();
}

/** $B6D599 */
export function CODE_B6D599(): void {
  if (reg.a >= 0x003c) return CODE_B6D649();
  CODE_B6D5A1();
}

/** $B6D5A1 */
export function CODE_B6D5A1(): void {
  reg.a = (rd(reg.x, 0x0a) + 0xffce - rd(reg.y, 0x0a)) & 0xffff;
  if (!isNeg(reg.a)) return CODE_B6D5B5();
  if (reg.a >= 0xffad) return CODE_B6D5BD();
  CODE_B6D649();
}

/** $B6D5B5 */
export function CODE_B6D5B5(): void {
  if (reg.a >= 0xffd0) return CODE_B6D5BD();
  CODE_B6D649();
}

/** $B6D5BD — face the Kong (turning first if needed), then the charge wait. */
export function CODE_B6D5BD(): void {
  const x = reg.x;
  reg.a = rd(x, 0x06);
  if (reg.a >= rd(x, 0x48)) return CODE_B6D5F4();
  reg.a = rd(x, 0x2e);
  if (reg.a & 0x0008) return CODE_B6D5D4();
  if (facingLeft(x)) return CODE_B6D607();
  CODE_B6DBFC();
  CODE_B6D5D4();
}

/** $B6D5D4 — stop and keep turning. */
export function CODE_B6D5D4(): void {
  const x = reg.x;
  wr(x, 0x26, 0);
  wr(x, 0x2a, 0);
  wr(x, 0x22, 0x0007);
  reg.a = 0x0007;
  interpolate_x_velocity_global();
  reg.x = cur();
  reg.a = rd(reg.x, 0x22);
  interpolate_y_velocity_global();
  apply_position_from_velocity_global();
  reg.x = cur();
  CODE_B6D7D2();
}

/** $B6D5F4 */
export function CODE_B6D5F4(): void {
  const x = reg.x;
  reg.a = rd(x, 0x2e);
  if (reg.a & 0x0008) return CODE_B6D5D4();
  if (!facingLeft(x)) return CODE_B6D607();
  CODE_B6DBFC();
  CODE_B6D5D4();
}

/** $B6D607 — start the charged attack: back off a little first. */
export function CODE_B6D607(): void {
  reg.a = C.kleever_charge_wait_anim_id;
  set_sprite_animation();
  const x = cur();
  reg.x = x;
  wr(x, 0x52, PTR("CODE_B6DA16"));
  wr(x, 0x20, 0);
  wr(x, 0x24, 0);
  if (!(rd(x, 0x12) & 0x4000)) return CODE_B6D63D();
  reg.a = 0xfc80;
  CODE_B6D620();
}

/** $B6D620 */
export function CODE_B6D620(): void {
  const x = reg.x;
  wr(x, 0x20, reg.a);
  wr(x, 0x26, 0);
  wr(x, 0x2a, 0);
  reg.y = phase(r16(BOSS.hp));
  wr(x, 0x46, db16(reg.y + 4));
  reg.a = 0x0007;
  wr(x, 0x22, 0x0007);
  CODE_B6DA16();
}

/** $B6D63D */
export function CODE_B6D63D(): void {
  reg.a = 0x0380;
  CODE_B6D620();
}

/** $B6D642 */
export function CODE_B6D642(): void {
  wr(reg.x, 0x2e, rd(reg.x, 0x2e) & 0xfffe);
  CODE_B6D649();
}

/** $B6D649 — follow the Kong (x), with the hover drift. */
export function CODE_B6D649(): void {
  reg.a = rd(reg.x, 0x2e);
  if (!(reg.a & 0x0002)) return CODE_B6D7EF();
  CODE_B6D653();
}

/** $B6D653 */
export function CODE_B6D653(): void {
  const x = reg.x;
  reg.y = r16(R.active_kong_sprite);
  reg.a = rd(x, 0x06);
  if (reg.a < rd(reg.y, 0x06)) return CODE_B6D69C();
  reg.a = rd(x, 0x2e);
  if (!(reg.a & 0x0018) && facingLeft(x)) CODE_B6DBFC();
  CODE_B6D672();
}

/** $B6D672 — the Kong is to the left. */
export function CODE_B6D672(): void {
  const x = reg.x;
  reg.y = r16(R.active_kong_sprite);
  reg.a = (rd(x, 0x06) + 0xffe0) & 0xffff;
  if (reg.a >= rd(reg.y, 0x06)) return CODE_B6D689();
  wr(x, 0x26, 0);
  CODE_B6D69A();
}

/** $B6D684 */
export function CODE_B6D684(): void {
  reg.a = 0xfc80;
  CODE_B6D698();
}

/** $B6D689 */
export function CODE_B6D689(): void {
  reg.a = (reg.a - rd(reg.y, 0x06)) & 0xffff;
  if (reg.a >= 0x0064) return CODE_B6D684();
  reg.a = (0 - rd(reg.x, 0x28) - 1) & 0xffff; // CLC : SBC
  CODE_B6D698();
}

/** $B6D698 */
export function CODE_B6D698(): void {
  wr(reg.x, 0x26, reg.a);
  CODE_B6D69A();
}

/** $B6D69A */
export function CODE_B6D69A(): void {
  CODE_B6D6D1();
}

/** $B6D69C — the Kong is to the right. */
export function CODE_B6D69C(): void {
  const x = reg.x;
  reg.a = rd(x, 0x2e);
  if (!(reg.a & 0x0018) && !facingLeft(x)) CODE_B6DBFC();
  CODE_B6D6AD();
}

/** $B6D6AD */
export function CODE_B6D6AD(): void {
  const x = reg.x;
  reg.y = r16(R.active_kong_sprite);
  reg.a = (rd(x, 0x06) + 0x0020) & 0xffff;
  if (reg.a < rd(reg.y, 0x06)) return CODE_B6D6C4();
  wr(x, 0x26, 0);
  CODE_B6D6D1();
}

/** $B6D6BF */
export function CODE_B6D6BF(): void {
  reg.a = 0x0380;
  CODE_B6D6CF();
}

/** $B6D6C4 */
export function CODE_B6D6C4(): void {
  reg.a = (reg.a - rd(reg.y, 0x06)) & 0xffff;
  if (reg.a < 0xff9c) return CODE_B6D6BF();
  reg.a = rd(reg.x, 0x28);
  CODE_B6D6CF();
}

/** $B6D6CF */
export function CODE_B6D6CF(): void {
  wr(reg.x, 0x26, reg.a);
  CODE_B6D6D1();
}

/** $B6D6D1 — the lava bubbles follow; flying: follow the Kong (y) too. */
export function CODE_B6D6D1(): void {
  const x = cur();
  reg.x = x;
  reg.y = r16(0x0759);
  if (reg.y !== 0) {
    reg.a = rd(x, 0x06);
    wr(reg.y, 0x06, reg.a);
  }
  CODE_B6D6E1();
}

/** $B6D6E1 */
export function CODE_B6D6E1(): void {
  reg.a = rd(reg.x, 0x2e);
  if (!(reg.a & 0x0004)) return CODE_B6D750();
  CODE_B6D6EB();
}

/** $B6D6EB */
export function CODE_B6D6EB(): void {
  const x = reg.x;
  reg.y = r16(R.active_kong_sprite);
  reg.a = (rd(x, 0x0a) + 0xffce) & 0xffff;
  if (reg.a < rd(reg.y, 0x0a)) return CODE_B6D715();
  reg.a = (rd(x, 0x0a) + 0x000d) & 0xffff;
  if (reg.a >= rd(reg.y, 0x0a)) return CODE_B6D70B();
  wr(x, 0x2a, 0);
  CODE_B6D713();
}

/** $B6D70B */
export function CODE_B6D70B(): void {
  reg.a = (0 - rd(reg.x, 0x28) - 1) & 0xffff;
  wr(reg.x, 0x2a, reg.a);
  CODE_B6D713();
}

/** $B6D713 */
export function CODE_B6D713(): void {
  CODE_B6D72B();
}

/** $B6D715 */
export function CODE_B6D715(): void {
  const x = reg.x;
  reg.y = r16(R.active_kong_sprite);
  reg.a = (rd(x, 0x0a) + 0x0020) & 0xffff;
  if (reg.a < rd(reg.y, 0x0a)) return CODE_B6D727();
  wr(x, 0x2a, 0);
  CODE_B6D72B();
}

/** $B6D727 */
export function CODE_B6D727(): void {
  reg.a = rd(reg.x, 0x28);
  wr(reg.x, 0x2a, reg.a);
  CODE_B6D72B();
}

/** $B6D72B */
export function CODE_B6D72B(): void {
  CODE_B6D7F4();
  const x = reg.x;
  wr(x, 0x26, rd(x, 0x26) + r16(0x06e5));
  wr(x, 0x2a, rd(x, 0x2a) + r16(0x06e7));
  reg.a = rd(x, 0x22);
  interpolate_x_velocity_global();
  reg.x = cur();
  reg.a = rd(reg.x, 0x22);
  interpolate_y_velocity_global();
  CODE_B6D79B();
}

/** $B6D750 — in the lava: bob up and down with the arm's table (bank $BA). */
export function CODE_B6D750(): void {
  let x = reg.x;
  reg.a = rd(x, 0x22);
  interpolate_x_velocity_global();
  x = cur();
  reg.x = x;
  wr(x, 0x2a, 0);
  wr(x, 0x24, 0);
  const arm = r16(BOSS.head);
  reg.x = arm;
  if (dec(arm, 0x42) !== 0) return CODE_B6D79B();
  wr(arm, 0x42, 0x0003);
  stk.push(arm);
  CODE_B6D923();
  reg.y = rd(arm, 0x44);
  reg.x = cur();
  reg.a = db16(reg.y) & 0x00ff;
  if (reg.a & 0x0080) reg.a |= 0xff00;
  CODE_B6D77E();
}

/** $B6D77E */
export function CODE_B6D77E(): void {
  const x = reg.x;
  w16(BOSS.flag, reg.a);
  wr(x, 0x0a, rd(x, 0x0a) + r16(BOSS.flag));
  reg.a = (reg.y + 1) & 0xffff;
  reg.y = stk.pop()!;
  reg.db = 0xb6;
  if (reg.a === rd(reg.y, 0x48)) reg.a = rd(reg.y, 0x46);
  CODE_B6D798();
}

/** $B6D798 */
export function CODE_B6D798(): void {
  wr(reg.y, 0x44, reg.a);
  CODE_B6D79B();
}

/** $B6D79B — move, and stay inside the arena while not flying. */
export function CODE_B6D79B(): void {
  apply_position_from_velocity_global();
  const x = cur();
  reg.x = x;
  reg.a = rd(x, 0x2e);
  if (reg.a & 0x0004) return CODE_B6D7D2();
  reg.y = r16(R.active_kong_sprite);
  reg.a = rd(x, 0x06);
  if (reg.a < rd(reg.y, 0x06)) return CODE_B6D7C5();
  reg.a = 0x042d;
  if (reg.a < rd(x, 0x06)) return CODE_B6D7D2();
  wr(x, 0x06, reg.a);
  wr(x, 0x20, 0);
  wr(x, 0x26, 0);
  CODE_B6D7D2();
}

/** $B6D7C5 */
export function CODE_B6D7C5(): void {
  const x = reg.x;
  reg.a = 0x05f5;
  if (reg.a >= rd(x, 0x06)) return CODE_B6D7D2();
  wr(x, 0x06, reg.a);
  wr(x, 0x20, 0);
  wr(x, 0x26, 0);
  CODE_B6D7D2();
}

/** $B6D7D2 — the arm and the fire follow the body. */
export function CODE_B6D7D2(): void {
  const x = reg.x;
  reg.y = r16(BOSS.head);
  if (reg.y !== 0) {
    wr(reg.y, 0x06, rd(x, 0x06));
    reg.a = rd(x, 0x0a);
    wr(reg.y, 0x0a, reg.a);
  }
  CODE_B6D7E1();
}

/** $B6D7E1 */
export function CODE_B6D7E1(): void {
  const x = reg.x;
  reg.y = rd(x, 0x42);
  if (reg.y !== 0) {
    wr(reg.y, 0x06, rd(x, 0x06));
    reg.a = rd(x, 0x0a);
    wr(reg.y, 0x0a, reg.a);
  }
  CODE_B6D7EF();
}

/** $B6D7EF */
export function CODE_B6D7EF(): void {}

/** $B6D7F0 — JSL wrapper of CODE_B6D7F4. */
export function CODE_B6D7F0(): void {
  CODE_B6D7F4();
}

/** $B6D7F4 — the hover drift: reverse x every $1E frames, y every $1B frames. */
export function CODE_B6D7F4(): void {
  reg.x = cur();
  if (dec(0, 0x06e1) === 0) {
    w16(0x06e1, 0x001e);
    reg.a = neg(r16(0x06e5));
    w16(0x06e5, reg.a);
  }
  CODE_B6D80E();
}

/** $B6D80E */
export function CODE_B6D80E(): void {
  if (dec(0, 0x06e3) === 0) {
    w16(0x06e3, 0x001b);
    reg.a = neg(r16(0x06e7));
    w16(0x06e7, reg.a);
  }
  CODE_B6D826();
}

/** $B6D826 */
export function CODE_B6D826(): void {}

/** $B6D82B — JSL to CODE_B6D835. */
export function CODE_B6D82B(): void {
  CODE_B6D835();
}

/** $B6D82F — palette cycle (direct palette) while hurt. */
export function CODE_B6D82F(): void {
  reg.a = r16(0x06e9);
  if (reg.a === 0) return CODE_B6D862();
  CODE_B6D835();
}

/** Step the palette cycle: every $0715 frames the next palette of the list $06EB..$0711. */
function paletteStep(setPalette: () => void, done: () => void): boolean {
  if (dec(0, 0x06ed) !== 0) {
    done();
    return true;
  }
  w16(0x06ed, r16(0x0715));
  reg.y = r16(0x06eb);
  reg.a = db16(reg.y);
  reg.x = cur();
  setPalette();
  reg.a = (r16(0x06eb) + 2) & 0xffff;
  return false;
}

/** $B6D835 */
export function CODE_B6D835(): void {
  if (paletteStep(set_sprite_palette_direct_global, CODE_B6D862)) return;
  if (reg.a === r16(0x0711)) reg.a = r16(0x0713);
  CODE_B6D85E();
}

/** $B6D85E */
export function CODE_B6D85E(): void {
  w16(0x06eb, reg.a);
  CODE_B6D862();
}

/** $B6D862 */
export function CODE_B6D862(): void {}

/** $B6D869 — Kleever's palette cycle (glowing eyes/handle, or red when hurt). */
export function CODE_B6D869(): void {
  if (paletteStep(set_sprite_palette_global, CODE_B6D896)) return;
  if (reg.a === r16(0x0711)) reg.a = r16(0x0713);
  CODE_B6D892();
}

/** $B6D892 */
export function CODE_B6D892(): void {
  w16(0x06eb, reg.a);
  CODE_B6D896();
}

/** $B6D896 */
export function CODE_B6D896(): void {}

/** $B6D929 — defeated: spawn the next fragment of Kleever (list at $06F1, bank $BA). */
export function CODE_B6D929(): void {
  stk.push(reg.db);
  reg.a = r16(0x06ef);
  if (reg.a === 0) return CODE_B6D9A9();
  CODE_B6D923();
  stk.push(reg.x);
  const entry = r16(0x06f1);
  reg.x = entry;
  reg.y = db16(entry);
  spawn_no_gfx_special_sprite_address();
  reg.y = entry;
  if (reg.c) return CODE_B6D9AB();
  const p = r16(R.alternate_sprite);
  reg.x = p;
  if (p === 0) return CODE_B6D9AB();
  wr(p, 0x1c, 0xc000);
  wr(p, 0x26, db16(entry + 6));
  wr(p, 0x20, db16(entry + 8));
  wr(p, 0x24, db16(entry + 0x0a));
  wr(p, 0x2a, db16(entry + 0x0c));
  wr(p, 0x42, db16(entry + 0x0e));
  wr(p, 0x44, db16(entry + 0x10));
  wr(p, 0x46, 0);
  wr(p, 0x48, 0);
  wr(p, 0x12, (rd(p, 0x12) & 0x3fff) | db16(entry + 0x12));
  const k = cur();
  wr(p, 0x06, rd(k, 0x06));
  wr(p, 0x0a, rd(k, 0x0a));
  wr(p, 0x06, db16(entry + 2) + rd(p, 0x06));
  wr(p, 0x0a, db16(entry + 4) + rd(p, 0x0a));
  w16(0x06f1, (entry + 0x16) & 0xffff);
  dec(0, 0x06ef);
  reg.a = db16(entry + 0x14);
  set_alt_sprite_animation();
  CODE_B6D9A8();
}

/** $B6D9A8 */
export function CODE_B6D9A8(): void {
  reg.x = stk.pop()!;
  CODE_B6D9A9();
}

/** $B6D9A9 */
export function CODE_B6D9A9(): void {
  reg.db = stk.pop()!;
}

/** $B6D9AB */
export function CODE_B6D9AB(): void {
  w16(0x06ef, 0);
  CODE_B6D9A8();
}

/** $B6D9B0 — action: rising out of the lava (offsets DATA_B6D897). */
export function CODE_B6D9B0(): void {
  wr(r16(0x0759), 0x1c, 0);
  reg.x = cur();
  if (dec(0, 0x06df) !== 0) return CODE_B6D9C8();
  reg.x = cur();
  CODE_B6DC9B();
  CODE_B6DD13();
  wr(reg.x, 0x52, 0);
  CODE_B6D9DC();
}

/** $B6D9C8 */
export function CODE_B6D9C8(): void {
  CODE_B6E41C();
  reg.a = r16(0x06d5);
  if (reg.a === r16(0x06d7)) w16(0x06df, 0x0001);
  CODE_B6D9DC();
}

/** $B6D9DC */
export function CODE_B6D9DC(): void {}

/** $B6D9DD — action: wait $46 frames before rising out of the lava. */
export function CODE_B6D9DD(): void {
  const x = reg.x;
  if (dec(x, 0x46) !== 0) return CODE_B6DA11();
  wr(x, 0x52, PTR("CODE_B6D9B0"));
  w16(0x06df, 0x00c8);
  w16(0x06d5, DATA_B6D897);
  w16(0x06d7, DATA_B6D897);
  w16(0x06d9, DATA_B6D923);
  w16(0x06db, 0x0001);
  w16(0x06dd, 0x0001);
  reg.a = snd(7, "lava_bubble_1");
  queue_sound_effect();
  CODE_B6DA11();
}

/** $B6DA11 */
export function CODE_B6DA11(): void {}

/** $B6DA16 — action: charge wait (backing off), then the charged attack. */
export function CODE_B6DA16(): void {
  let x = reg.x;
  if (dec(x, 0x46) !== 0) return CODE_B6DA4C();
  x = cur();
  reg.x = x;
  reg.a = rd(x, 0x2e);
  if (reg.a & 0x0008) {
    inc(x, 0x46);
    return CODE_B6DA4C();
  }
  CODE_B6DA27();
}

/** $B6DA27 */
export function CODE_B6DA27(): void {
  reg.a = C.kleever_charge_attack_anim_id;
  set_sprite_animation();
  const x = cur();
  reg.x = x;
  reg.a = 0x001e;
  wr(x, 0x46, 0x001e);
  if (!(rd(x, 0x12) & 0x4000)) return CODE_B6DA47();
  reg.a = 0x0440;
  CODE_B6DA3C();
}

/** $B6DA3C */
export function CODE_B6DA3C(): void {
  wr(reg.x, 0x26, reg.a);
  wr(reg.x, 0x2a, 0);
  reg.a = PTR("CODE_B6DA5F");
  wr(reg.x, 0x52, reg.a);
  CODE_B6DA5E();
}

/** $B6DA47 */
export function CODE_B6DA47(): void {
  reg.a = 0xfbc0;
  CODE_B6DA3C();
}

/** $B6DA4C */
export function CODE_B6DA4C(): void {
  reg.a = rd(reg.x, 0x22);
  interpolate_x_velocity_global();
  reg.x = cur();
  reg.a = rd(reg.x, 0x22);
  interpolate_y_velocity_global();
  apply_position_from_velocity_global();
  CODE_B6DA5E();
}

/** $B6DA5E */
export function CODE_B6DA5E(): void {}

/** $B6DA5F — action: the charge itself. */
export function CODE_B6DA5F(): void {
  const x = reg.x;
  if (dec(x, 0x46) !== 0) return CODE_B6DA7F();
  wr(x, 0x46, 0x005a);
  wr(x, 0x26, 0);
  wr(x, 0x2a, 0);
  wr(x, 0x22, 0x0007);
  wr(x, 0x52, PTR("CODE_B6DA93"));
  reg.a = rd(x, 0x2e) | 0x0100;
  wr(x, 0x2e, reg.a);
  CODE_B6DA92();
}

/** $B6DA7F */
export function CODE_B6DA7F(): void {
  reg.a = 0x000b;
  interpolate_x_velocity_global();
  reg.x = cur();
  reg.a = rd(reg.x, 0x22);
  interpolate_y_velocity_global();
  apply_position_from_velocity_global();
  CODE_B6DA92();
}

/** $B6DA92 */
export function CODE_B6DA92(): void {}

/** $B6DA93 — action: slow down after the charge. */
export function CODE_B6DA93(): void {
  const x = reg.x;
  if (dec(x, 0x46) === 0) {
    CODE_B6DC9B();
    wr(reg.x, 0x52, 0);
  }
  CODE_B6DA9C();
}

/** $B6DA9C */
export function CODE_B6DA9C(): void {
  reg.a = rd(reg.x, 0x22);
  interpolate_x_velocity_global();
  reg.x = cur();
  reg.a = rd(reg.x, 0x22);
  interpolate_y_velocity_global();
  apply_position_from_velocity_global();
}

/** $B6DAAF — in the lava phases: shoot fire every $4E frames. */
export function CODE_B6DAAF(): void {
  const x = cur();
  reg.x = x;
  reg.a = rd(x, 0x52);
  if (reg.a !== 0) return CODE_B6DB2E();
  CODE_B6DAB7();
}

/** $B6DAB7 */
export function CODE_B6DAB7(): void {
  const x = reg.x;
  reg.a = r16(BOSS.hp);
  if (reg.a < 0x0004) return CODE_B6DB2E();
  reg.a = rd(x, 0x4e);
  if (reg.a !== 0) {
    dec(x, 0x4e);
    return CODE_B6DB2E();
  }
  CODE_B6DAC8();
}

/** $B6DAC8 */
export function CODE_B6DAC8(): void {
  reg.a = rd(reg.x, 0x2e);
  if (reg.a & 0x0008) {
    reg.a = 0x0001;
    wr(reg.x, 0x4e, 0x0001);
    return CODE_B6DB2E();
  }
  CODE_B6DAD6();
}

/** $B6DAD6 — shoot: fire animations; the delay to the next shot from the phase table. */
export function CODE_B6DAD6(): void {
  let x = reg.x;
  wr(x, 0x2e, rd(x, 0x2e) | 0x0010);
  wr(x, 0x4c, DATA_BAAB48);
  reg.y = rd(x, 0x42);
  w16(R.current_sprite, reg.y);
  reg.x = r16(BOSS.head);
  w16(R.current_sprite, reg.x);
  reg.a = C.kleever_arm_shoot_fire_anim_id;
  set_sprite_animation();
  reg.x = x;
  w16(R.current_sprite, x);
  reg.a = C.kleever_shoot_fire_anim_id;
  set_sprite_animation();
  x = cur();
  reg.x = x;
  reg.a = r16(BOSS.hp);
  reg.y = r16(0x06e9);
  if (reg.y !== 0) reg.a = (reg.a + 1) & 0xffff;
  CODE_B6DB09();
}

/** $B6DB09 — every third shot the longer delay. */
export function CODE_B6DB09(): void {
  reg.y = phase(reg.a);
  reg.a = inc(0, 0x0658);
  if (reg.a >= 0x0003) {
    reg.a = r16(0x06e9);
    if (reg.a === 0) {
      reg.a = db16(reg.y + 8);
      w16(0x0658, 0);
      return CODE_B6DB2C();
    }
  }
  CODE_B6DB29();
}

/** $B6DB29 */
export function CODE_B6DB29(): void {
  reg.a = db16(reg.y + 0x0a);
  CODE_B6DB2C();
}

/** $B6DB2C */
export function CODE_B6DB2C(): void {
  wr(reg.x, 0x4e, reg.a);
  CODE_B6DB2E();
}

/** $B6DB2E */
export function CODE_B6DB2E(): void {
  reg.y = rd(reg.x, 0x4c);
  if (reg.y !== 0) CODE_B6DB52();
  CODE_B6DB35();
}

/** $B6DB35 */
export function CODE_B6DB35(): void {}

/** $B6DB36 — animation callback: the shot is over, back to the idle sword offsets. */
export function CODE_B6DB36(): void {
  const db = reg.db;
  reg.db = 0xb6;
  const x = reg.x;
  wr(x, 0x2e, rd(x, 0x2e) & 0xffef);
  CODE_B6DC9B();
  reg.y = rd(reg.x, 0x4c);
  CODE_B6DB86();
  reg.y = DATA_BAAB44;
  wr(reg.x, 0x4c, DATA_BAAB44);
  CODE_B6DB52();
  reg.db = db;
}

/** $B6DB52 — apply the sword offset at Y (bank $BA; +$50 while turning), mirrored. */
export function CODE_B6DB52(): void {
  CODE_B6D923();
  const x = reg.x;
  if (rd(x, 0x2e) & 0x0008) reg.y = (reg.y + 0x0050) & 0xffff;
  CODE_B6DB62();
}

/** $B6DB62 */
export function CODE_B6DB62(): void {
  const x = reg.x;
  if (facingLeft(x)) return CODE_B6DB73();
  reg.a = (rd(x, 0x06) + db16(reg.y)) & 0xffff;
  wr(x, 0x06, reg.a);
  CODE_B6DB7B();
}

/** $B6DB73 */
export function CODE_B6DB73(): void {
  reg.a = (rd(reg.x, 0x06) - db16(reg.y)) & 0xffff;
  wr(reg.x, 0x06, reg.a);
  CODE_B6DB7B();
}

/** $B6DB7B */
export function CODE_B6DB7B(): void {
  reg.a = (rd(reg.x, 0x0a) + db16(reg.y + 2)) & 0xffff;
  wr(reg.x, 0x0a, reg.a);
  reg.db = 0xb6;
}

/** $B6DB86 — remove the sword offset at Y (inverse of CODE_B6DB52). */
export function CODE_B6DB86(): void {
  CODE_B6D923();
  const x = reg.x;
  if (rd(x, 0x2e) & 0x0008) reg.y = (reg.y + 0x0050) & 0xffff;
  CODE_B6DB96();
}

/** $B6DB96 */
export function CODE_B6DB96(): void {
  const x = reg.x;
  if (facingLeft(x)) return CODE_B6DBA7();
  reg.a = (rd(x, 0x06) - db16(reg.y)) & 0xffff;
  wr(x, 0x06, reg.a);
  CODE_B6DBAF();
}

/** $B6DBA7 */
export function CODE_B6DBA7(): void {
  reg.a = (rd(reg.x, 0x06) + db16(reg.y)) & 0xffff;
  wr(reg.x, 0x06, reg.a);
  CODE_B6DBAF();
}

/** $B6DBAF */
export function CODE_B6DBAF(): void {
  reg.a = (rd(reg.x, 0x0a) - db16(reg.y + 2)) & 0xffff;
  wr(reg.x, 0x0a, reg.a);
  reg.db = 0xb6;
}

/** $B6DBBA — animation callback: advance the sword offset by one entry. */
export function CODE_B6DBBA(): void {
  reg.y = rd(reg.x, 0x4c);
  if (reg.y !== 0) {
    const db = reg.db;
    reg.db = 0xb6;
    CODE_B6DB86();
    reg.a = (rd(reg.x, 0x4c) + 4) & 0xffff;
    wr(reg.x, 0x4c, reg.a);
    reg.y = reg.a;
    CODE_B6DB52();
    reg.db = db;
  }
  CODE_B6DBD1();
}

/** $B6DBD1 */
export function CODE_B6DBD1(): void {}

/** $B6DBD2 — animation callback: snap to Kleever's position. */
export function CODE_B6DBD2(): void {
  reg.y = r16(BOSS.body);
  wr(reg.x, 0x06, rd(reg.y, 0x06));
  reg.a = rd(reg.y, 0x0a);
  wr(reg.x, 0x0a, reg.a);
}

/** $B6DBE0 — animation callback: show the fire trail. */
export function CODE_B6DBE0(): void {
  const x = reg.x;
  reg.y = rd(x, 0x42);
  reg.a = 0;
  wr(reg.y, 0x1c, 0);
  w16(R.current_sprite, reg.y);
  reg.a = C.kleever_shoot_fire_trail_anim_id;
  set_sprite_animation();
  reg.x = x;
  w16(R.current_sprite, x);
}

/** $B6DBF6 — animation callback: hide the sprite ($1C = $C000). */
export function CODE_B6DBF6(): void {
  reg.a = 0xc000;
  wr(reg.x, 0x1c, 0xc000);
}

/** $B6DBFC — start turning around (arm and body). */
export function CODE_B6DBFC(): void {
  reg.y = r16(BOSS.head);
  if (reg.y !== 0) {
    const x = reg.x;
    w16(R.current_sprite, reg.y);
    reg.a = C.kleever_arm_turn_anim_id;
    set_sprite_animation();
    reg.x = x;
    w16(R.current_sprite, x);
  }
  CODE_B6DC0E();
}

/** $B6DC0E */
export function CODE_B6DC0E(): void {
  reg.a = C.kleever_turn_anim_id;
  set_sprite_animation();
  const x = cur();
  reg.x = x;
  reg.a = rd(x, 0x2e) | 0x0008;
  wr(x, 0x2e, reg.a);
}

/** $B6DC1F */
export function turn_sprite_B6_2_global(): void {
  turn_sprite_B6_2();
}

/** $B6DC23 — flip the sprite horizontally. */
export function turn_sprite_B6_2(): void {
  reg.a = rd(reg.x, 0x12) ^ 0x4000;
  wr(reg.x, 0x12, reg.a);
}

/** $B6DC2B — animation callback (turn done): flip body, fire and arm. */
export function CODE_B6DC2B(): void {
  turn_sprite_B6_2();
  reg.y = rd(reg.x, 0x42);
  if (reg.y !== 0) {
    reg.x = reg.y;
    turn_sprite_B6_2();
  }
  CODE_B6DC36();
}

/** $B6DC36 */
export function CODE_B6DC36(): void {
  reg.x = r16(BOSS.head);
  if (reg.x !== 0) turn_sprite_B6_2();
  CODE_B6DC3E();
}

/** $B6DC3E */
export function CODE_B6DC3E(): void {}

/** $B6DC3F — animation callback: turn finished, idle sword offsets (+ anti-piracy check). */
export function CODE_B6DC3F(): void {
  stk.push(reg.db);
  reg.db = 0xb6;
  reg.y = rd(reg.x, 0x4c);
  if (reg.y === 0) return CODE_B6DC92();
  CODE_B6DB86();
  wr(reg.x, 0x2e, rd(reg.x, 0x2e) & 0xfff7);
  reg.y = DATA_BAAB44;
  wr(reg.x, 0x4c, DATA_BAAB44);
  CODE_B6DB52();
  CODE_B6DC58();
}

/** $B6DC58 */
export function CODE_B6DC58(): void {
  reg.a = r16(0x06e9);
  if (reg.a === 0) return CODE_B6DC67();
  reg.a = C.kleever_attack_anim_id;
  set_sprite_animation();
  CODE_B6DC6E();
}

/** $B6DC67 */
export function CODE_B6DC67(): void {
  reg.a = C.kleever_idle_anim_id;
  set_sprite_animation();
  CODE_B6DC6E();
}

/**
 * $B6DC6E — anti-piracy: if the copier-detection branch at $808413 was patched, Kleever's
 * flags are inverted (the fight breaks).
 */
export function CODE_B6DC6E(): void {
  reg.db = 0x80;
  reg.a = 0x8400;
  reg.x = 0x8400;
  reg.y = rom16(0x808413);
  if (reg.y !== 0xab82) {
    reg.x = r16(BOSS.body);
    reg.a = rd(reg.x, 0x2e) ^ 0xffff;
    wr(reg.x, 0x2e, reg.a);
  }
  CODE_B6DC8F();
}

/** $B6DC8F */
export function CODE_B6DC8F(): void {
  reg.db = stk.pop()!;
}

/** $B6DC92 */
export function CODE_B6DC92(): void {
  wr(reg.x, 0x2e, rd(reg.x, 0x2e) & 0xfff7);
  CODE_B6DC58();
}

/** $B6DC9B — enable the attacks (+ flying in the last phases). */
export function CODE_B6DC9B(): void {
  stk.push(reg.x);
  const x = r16(BOSS.body);
  reg.x = x;
  reg.a = r16(BOSS.hp);
  if (reg.a >= 0x0004) return CODE_B6DCAF();
  reg.a = rd(x, 0x2e) | 0x0006;
  CODE_B6DCB4();
}

/** $B6DCAF */
export function CODE_B6DCAF(): void {
  reg.a = rd(reg.x, 0x2e) | 0x0002;
  CODE_B6DCB4();
}

/** $B6DCB4 */
export function CODE_B6DCB4(): void {
  wr(reg.x, 0x2e, reg.a);
  reg.x = stk.pop()!;
}

/** $B6DCB8 — defeated: the sword breaks (hilt and fire sprites), roof pieces fall. */
export function CODE_B6DCB8(): void {
  reg.y = rd(reg.x, 0x4c);
  if (reg.y !== 0) CODE_B6DB52();
  CODE_B6DCBF();
}

/** $B6DCBF */
export function CODE_B6DCBF(): void {
  reg.a = snd(7, "kleever_defeat_spin");
  queue_sound_effect();
  w16(0x06a3, r16(0x06a3) | 0x0010);
  const x = cur();
  reg.x = x;
  wr(x, 0x2e, rd(x, 0x2e) | 0x2000);
  wr(x, 0x1c, 0xc000);
  reg.y = C.special_sprite_spawn_id_015C; // broken hilt
  spawn_special_sprite_index();
  const hilt = r16(R.alternate_sprite);
  reg.x = hilt;
  wr(hilt, 0x1c, 0xc000);
  reg.y = DATA_BAAAE8;
  wr(hilt, 0x42, DATA_BAAAE8);
  CODE_B6D923();
  CODE_B6EA83();
  reg.db = 0xb6;
  wr(reg.x, 0x24, 0);
  wr(reg.x, 0x20, 0);
  reg.y = C.special_sprite_spawn_id_015A; // broken fire
  spawn_special_sprite_index();
  const fire = r16(R.alternate_sprite);
  reg.x = fire;
  w16(BOSS.head, fire);
  reg.a = 0xc000;
  wr(fire, 0x1c, 0xc000);
  reg.x = cur();
  CODE_B6DD55();
}

/** $B6DD13 — after an action: what next, by HP. */
export function CODE_B6DD13(): void {
  const x = cur();
  reg.x = x;
  wr(x, 0x52, 0);
  reg.a = r16(BOSS.hp);
  if (reg.a === 0) return CODE_B6DCB8();
  reg.c = reg.a >= 0x0003;
  if (reg.a !== 0x0003) return CODE_B6DD56();
  reg.a = r16(BOSS.head);
  if (reg.a === 0) return CODE_B6DD4E();
  // HP 3 with the arm still there: the arm sinks into the lava (action CODE_B6E80D)
  wr(x, 0x2e, rd(x, 0x2e) | 0x0001);
  wr(x, 0x52, PTR("CODE_B6E80D"));
  const arm = r16(BOSS.head);
  reg.y = arm;
  wr(arm, 0x42, 0x0002);
  wr(arm, 0x44, DATA_BAAABE);
  wr(arm, 0x46, DATA_BAAABE);
  reg.a = DATA_BAAAE8;
  wr(arm, 0x48, DATA_BAAAE8);
  CODE_B6DD55();
}

/** $B6DD4E */
export function CODE_B6DD4E(): void {
  reg.a = rd(reg.x, 0x2e) & 0xfffe;
  wr(reg.x, 0x2e, reg.a);
  CODE_B6DD55();
}

/** $B6DD55 */
export function CODE_B6DD55(): void {}

/** $B6DD56 — carry from `CMP #$0003`. */
export function CODE_B6DD56(): void {
  if (reg.c) return CODE_B6DD4E();
  reg.a = C.kleever_attack_anim_id;
  set_sprite_animation();
  reg.x = cur();
  CODE_B6DD55();
}

/** $B6DD63 — animation callback: shoot a fireball (unless hidden). */
export function CODE_B6DD63(): void {
  reg.a = rd(reg.x, 0x1c);
  if (reg.a & 0xc000) return CODE_B6DD80();
  CODE_B6DD6D();
}

/** $B6DD6D */
export function CODE_B6DD6D(): void {
  const db = reg.db;
  reg.db = 0xb6;
  w16(BOSS.flag, reg.x);
  reg.y = C.special_sprite_spawn_id_00AA;
  spawn_special_sprite_index();
  reg.y = r16(R.alternate_sprite);
  CODE_B6DD81();
  reg.db = db;
  CODE_B6DD80();
}

/** $B6DD80 */
export function CODE_B6DD80(): void {}

/** $B6DD81 — aim the fireball (Y) at the Kong: Bresenham setup, speed from the phase. */
export function CODE_B6DD81(): void {
  reg.x = r16(BOSS.body);
  reg.a = rd(reg.x, 0x12);
  if (!(reg.a & 0x4000)) return CODE_B6DD96();
  reg.x = r16(BOSS.flag);
  reg.a = (rd(reg.x, 0x06) - 0xffd7) & 0xffff;
  CODE_B6DD9F();
}

/** $B6DD96 */
export function CODE_B6DD96(): void {
  reg.x = r16(BOSS.flag);
  reg.a = (rd(reg.x, 0x06) + 0xffd7) & 0xffff;
  CODE_B6DD9F();
}

/** $B6DD9F */
export function CODE_B6DD9F(): void {
  const fb = reg.y;
  wr(fb, 0x06, reg.a);
  const sum = rd(reg.x, 0x0a) + 0xffa6;
  wr(fb, 0x0a, sum);
  reg.x = fb;
  const kong = r16(R.active_kong_sprite);
  reg.y = kong;
  wr(fb, 0x48, rd(kong, 0x06));
  wr(fb, 0x4a, rd(kong, 0x0a) + 0xffef + (sum > 0xffff ? 1 : 0)); // ADC with the carry of the last add
  reg.a = r16(BOSS.hp);
  reg.y = r16(0x06e9);
  if (reg.y !== 0) reg.a = (reg.a + 1) & 0xffff;
  CODE_B6DDC6();
}

/** $B6DDC6 */
export function CODE_B6DDC6(): void {
  const x = reg.x;
  reg.y = phase(reg.a);
  wr(x, 0x2c, db16(reg.y));
  reg.a = (rd(x, 0x48) - rd(x, 0x06)) & 0xffff;
  if (!isNeg(reg.a)) return CODE_B6DDE5();
  reg.a = neg(reg.a);
  wr(x, 0x24, reg.a);
  wr(x, 0x20, 0xffff);
  CODE_B6DDF3();
}

/** $B6DDE5 */
export function CODE_B6DDE5(): void {
  const x = reg.x;
  wr(x, 0x24, reg.a);
  wr(x, 0x20, 0x0001);
  reg.a = rd(x, 0x12) ^ 0x4000;
  wr(x, 0x12, reg.a);
  CODE_B6DDF3();
}

/** $B6DDF3 */
export function CODE_B6DDF3(): void {
  const x = reg.x;
  reg.a = (rd(x, 0x4a) - rd(x, 0x0a)) & 0xffff;
  if (!isNeg(reg.a)) return CODE_B6DE07();
  reg.a = neg(reg.a);
  wr(x, 0x26, reg.a);
  wr(x, 0x22, 0xffff);
  CODE_B6DE0E();
}

/** $B6DE07 */
export function CODE_B6DE07(): void {
  wr(reg.x, 0x26, reg.a);
  wr(reg.x, 0x22, 0x0001);
  CODE_B6DE0E();
}

/** $B6DE0E */
export function CODE_B6DE0E(): void {
  const x = reg.x;
  const dx = rd(x, 0x24), dy = rd(x, 0x26);
  if (dx === dy) return CODE_B6DE2C();
  if (dx < dy) return CODE_B6DE21();
  wr(x, 0x28, dx >> 1);
  reg.a = dy;
  wr(x, 0x2a, dy);
  CODE_B6DE33();
}

/** $B6DE21 */
export function CODE_B6DE21(): void {
  const x = reg.x;
  wr(x, 0x28, rd(x, 0x26) >> 1);
  reg.a = rd(x, 0x24);
  wr(x, 0x2a, reg.a);
  CODE_B6DE33();
}

/** $B6DE2C */
export function CODE_B6DE2C(): void {
  reg.a = 0x0001;
  wr(reg.x, 0x28, 0x0001);
  wr(reg.x, 0x2a, 0);
  CODE_B6DE33();
}

/** $B6DE33 */
export function CODE_B6DE33(): void {}

/** $B6DF9F — when the cannonball side matches, enable the hooks ($0400); hook phases. */
export function CODE_B6DF9F(): void {
  const x = cur();
  reg.x = x;
  reg.a = r16(BOSS.hp);
  if (reg.a === 0) return CODE_B6DFCA();
  reg.a = rd(x, 0x2e);
  if (reg.a & 0x0100) return CODE_B6DFEF();
  if (reg.a & 0x0800) return CODE_B6DFEC();
  reg.y = r16(R.active_kong_sprite);
  reg.a = rd(x, 0x2e);
  if (!(reg.a & 0x0040)) return CODE_B6DFE2();
  reg.a = rd(reg.y, 0x06);
  if (reg.a < 0x050e) return CODE_B6DFEC();
  CODE_B6DFC5();
}

/** $B6DFC5 */
export function CODE_B6DFC5(): void {
  reg.a = rd(reg.y, 0x2e);
  if (reg.a !== 0) return CODE_B6DFEC();
  CODE_B6DFCA();
}

/** $B6DFCA */
export function CODE_B6DFCA(): void {
  const x = reg.x;
  wr(x, 0x2e, rd(x, 0x2e) | 0x0400);
  reg.a = r16(BOSS.hp);
  if (reg.a >= 0x0004) {
    w16(0x06e9, 0);
    CODE_B6E068();
  }
  CODE_B6DFE0();
}

/** $B6DFE0 */
export function CODE_B6DFE0(): void {
  CODE_B6DFEC();
}

/** $B6DFE2 */
export function CODE_B6DFE2(): void {
  reg.a = rd(reg.y, 0x06);
  if (reg.a >= 0x050e) return CODE_B6DFEC();
  CODE_B6DFC5();
}

/** $B6DFEC */
export function CODE_B6DFEC(): void {
  CODE_B6E067();
}

/** $B6DFEF — attack done ($0100): spawn the hooks for the next phase. */
export function CODE_B6DFEF(): void {
  const x = reg.x;
  if (reg.a & 0x0800) return CODE_B6DFEC();
  if (reg.a & 0x0200) {
    reg.a |= 0x0400;
    wr(x, 0x2e, reg.a);
    return CODE_B6E067();
  }
  CODE_B6E001();
}

/** $B6E001 */
export function CODE_B6E001(): void {
  reg.a &= 0xfaff;
  wr(reg.x, 0x2e, reg.a);
  reg.a = r16(BOSS.hp);
  if (reg.a === 0) return CODE_B6E067();
  if (reg.a !== 0x0003) return CODE_B6E024();
  w16(0x0923, 0x0001);
  reg.a = r16(0x06a3) | 0x0004;
  w16(0x06a3, reg.a);
  CODE_B6E055();
}

/** $B6E024 */
export function CODE_B6E024(): void {
  reg.x = ((reg.a - 1) << 1) & 0xffff;
  reg.y = db16(DATA_B6E0B3 + reg.x);
  if (reg.y === 0) return CODE_B6E067();
  w16(BOSS.flag, db16(reg.y));
  CODE_B6E033();
}

/** $B6E033 — spawn one hook per entry (x, y target). */
export function CODE_B6E033(): void {
  for (;;) {
    const entry = reg.y;
    reg.y = HOOK_SPAWN;
    spawn_no_gfx_special_sprite_address();
    reg.y = entry;
    const h = r16(R.alternate_sprite);
    reg.x = h;
    wr(h, 0x06, db16(entry + 2));
    wr(h, 0x46, db16(entry + 4));
    reg.y = (entry + 4) & 0xffff;
    wr(h, 0x44, 0);
    if (dec(0, BOSS.flag) === 0) break;
  }
  inc(reg.x, 0x44); // the last hook
  CODE_B6E055();
}

/** $B6E055 */
export function CODE_B6E055(): void {
  const x = cur();
  reg.x = x;
  reg.a = r16(BOSS.hp);
  if (reg.a === 0x0003) {
    reg.a = rd(x, 0x2e) | 0x0800;
    wr(x, 0x2e, reg.a);
  }
  CODE_B6E067();
}

/** $B6E067 */
export function CODE_B6E067(): void {}

/** $B6E068 — start the normal palette cycle (glowing eyes) unless already running. */
export function CODE_B6E068(): void {
  reg.a = DATA_B6E0A3;
  if (reg.a === r16(0x0713)) return CODE_B6E08E();
  w16(0x06ed, 0x0006);
  w16(0x0715, 0x0006);
  w16(0x06eb, DATA_B6E0A3);
  w16(0x0713, DATA_B6E0A3);
  reg.a = DATA_B6E0B3;
  w16(0x0711, DATA_B6E0B3);
  CODE_B6E08E();
}

/** $B6E08E */
export function CODE_B6E08E(): void {}

/**
 * $B6E275 — Kleever is hit by a cannonball: lose 1 HP (the last hit starts the defeat
 * cutscene and the fragments), red palette, stun and shake for the phase's time.
 */
export function CODE_B6E275(): void {
  const x0 = reg.x;
  let x = r16(BOSS.body);
  reg.x = x;
  wr(x, 0x2e, rd(x, 0x2e) & 0xfff7);
  reg.x = r16(BOSS.head);
  if (reg.x !== 0) {
    w16(R.current_sprite, reg.x);
    reg.a = C.kleever_arm_idle_anim_id;
    set_sprite_animation();
  }
  reg.a = snd(6, "kleever_hit");
  queue_sound_effect();
  reg.x = x0;
  w16(R.current_sprite, x0);
  reg.a = C.kleever_idle_anim_id;
  set_sprite_animation();
  if (dec(0, BOSS.hp) === 0) {
    const s = cur();
    reg.a = 0x000c;
    kong_cutscene_handler();
    w16(R.current_sprite, s);
    reg.a = s;
    reg.db = 0xb6;
    x = r16(BOSS.body);
    reg.x = x;
    wr(x, 0x2e, (rd(x, 0x2e) & 0xf7ff) | 0x0400);
    w16(0x06ef, rom16(FRAGMENT_COUNT));
    reg.a = DATA_BAA224;
    w16(0x06f1, DATA_BAA224);
  }
  CODE_B6E2CF();
}

/** $B6E2CF */
export function CODE_B6E2CF(): void {
  reg.a = r16(BOSS.hp);
  if (reg.a === 0x0003) return CODE_B6E306();
  if (reg.a < 0x0004) return CODE_B6E2E2();
  reg.a = 0xffff;
  CODE_B6E2E5();
}

/** $B6E2E2 */
export function CODE_B6E2E2(): void {
  reg.a = 0x0163;
  CODE_B6E2E5();
}

/** $B6E2E5 — hurt timer and the red palette cycle. */
export function CODE_B6E2E5(): void {
  w16(0x06e9, reg.a);
  w16(0x06ed, 0x0005);
  w16(0x0715, 0x0005);
  w16(0x06eb, DATA_B6E08F);
  w16(0x0713, DATA_B6E08F);
  reg.a = DATA_B6E0A3;
  w16(0x0711, DATA_B6E0A3);
  CODE_B6E306();
}

/** $B6E306 */
export function CODE_B6E306(): void {
  const x = r16(BOSS.body);
  reg.x = x;
  reg.y = phase(r16(BOSS.hp));
  wr(x, 0x28, db16(reg.y + 6));
  reg.y = rd(x, 0x4c);
  if (reg.y !== 0) {
    CODE_B6DB86();
    reg.y = DATA_BAAB48;
    wr(reg.x, 0x4c, DATA_BAAB48);
    CODE_B6DB52();
  }
  CODE_B6E327();
}

/** $B6E327 — stunned: hide the fire, shake (action CODE_B6E3EA), next phase's flags. */
export function CODE_B6E327(): void {
  let x = reg.x;
  wr(x, 0x2e, rd(x, 0x2e) & 0xffef);
  reg.y = rd(x, 0x42);
  wr(reg.y, 0x1c, 0xc000);
  w16(0x0658, 0);
  wr(x, 0x4e, 0x0001);
  x = r16(BOSS.body);
  reg.x = x;
  wr(x, 0x32, 0);
  reg.a = rd(x, 0x2e) | 0x0001;
  reg.y = r16(BOSS.hp);
  if (reg.y >= 0x0004) reg.a |= 0x0100;
  CODE_B6E353();
}

/** $B6E353 — switch sides. */
export function CODE_B6E353(): void {
  const x = reg.x;
  reg.a ^= 0x0040;
  wr(x, 0x2e, reg.a);
  wr(x, 0x52, PTR("CODE_B6E3EA"));
  wr(x, 0x2e, rd(x, 0x2e) & 0xfff9);
  reg.a = r16(BOSS.hp);
  if (reg.a === 0x0003) {
    // the fire effect is gone for good
    reg.a = rd(x, 0x42);
    wr(x, 0x42, 0);
    w16(R.current_sprite, reg.a);
    delete_sprite_handle_deallocation();
    reg.x = x;
    w16(R.current_sprite, x);
    reg.a = r16(BOSS.hp);
  }
  CODE_B6E37F();
}

/** $B6E37F — the stun time and shake offsets of the phase. */
export function CODE_B6E37F(): void {
  const p = phase(reg.a);
  reg.x = p;
  w16(0x06df, db16(p + 2));
  w16(0x06d5, db16(p + 0x0c));
  w16(0x06d7, db16(p + 0x0c));
  w16(0x06d9, db16(p + 0x0e));
  reg.a = 0x0001;
  w16(0x06db, 0x0001);
  w16(0x06dd, 0x0001);
}

/** $B6E3EA — action: stunned (shaking); when defeated spawn the fragments. */
export function CODE_B6E3EA(): void {
  let x = cur();
  reg.x = x;
  if (dec(0, 0x06df) !== 0) return CODE_B6E404();
  wr(x, 0x32, 0);
  reg.a = C.kleever_idle_anim_id;
  set_sprite_animation();
  x = cur();
  reg.x = x;
  CODE_B6DC9B();
  CODE_B6DD13();
  CODE_B6E41B();
}

/** $B6E404 */
export function CODE_B6E404(): void {
  CODE_B6E41C();
  reg.a = r16(BOSS.hp);
  if (reg.a === 0) {
    const x = cur();
    reg.x = x;
    reg.a = rd(x, 0x2e);
    if (!(reg.a & 0x0200)) {
      CODE_B6D929();
      reg.x = cur();
    }
  }
  CODE_B6E41B();
}

/** $B6E41B */
export function CODE_B6E41B(): void {}

/** $B6E41C — apply the next shake offset ($06D5 list, every $06DD frames); arm follows. */
export function CODE_B6E41C(): void {
  if (dec(0, 0x06db) !== 0) return CODE_B6E46D();
  w16(0x06db, r16(0x06dd));
  const x = reg.x;
  reg.y = r16(0x06d5);
  setCE(reg.y);
  wr(x, 0x06, rd(x, 0x06) + ce16());
  ceAdd(2);
  wr(x, 0x0a, rd(x, 0x0a) + ce16());
  reg.a = (r16(0x06d5) + 4) & 0xffff;
  if (reg.a === r16(0x06d9)) reg.a = r16(0x06d7);
  CODE_B6E45A();
}

/** $B6E45A */
export function CODE_B6E45A(): void {
  const x = reg.x;
  w16(0x06d5, reg.a);
  reg.y = r16(BOSS.head);
  if (reg.y !== 0) {
    wr(reg.y, 0x06, rd(x, 0x06));
    reg.a = rd(x, 0x0a);
    wr(reg.y, 0x0a, reg.a);
  }
  CODE_B6E46D();
}

/** $B6E46D */
export function CODE_B6E46D(): void {}

/** $B6E46E — action: rising again after the arm sank (offsets DATA_B6E8FC). */
export function CODE_B6E46E(): void {
  reg.y = r16(BOSS.head);
  const x = cur();
  reg.x = x;
  if (dec(0, 0x06df) !== 0) return CODE_B6E489();
  CODE_B6DC9B();
  CODE_B6DD13();
  wr(reg.x, 0x52, 0);
  reg.a = rd(reg.x, 0x2e) & 0xfffe;
  wr(reg.x, 0x2e, reg.a);
  CODE_B6E49D();
}

/** $B6E489 */
export function CODE_B6E489(): void {
  CODE_B6E41C();
  reg.a = r16(0x06d5);
  if (reg.a === r16(0x06d7)) w16(0x06df, 0x0001);
  CODE_B6E49D();
}

/** $B6E49D */
export function CODE_B6E49D(): void {}

/**
 * $B6E69F — blade hitboxes: Kleever's current attack frame selects a list of boxes (bank
 * $BA); each is checked against the Kongs ($065E bit 1) and the cannonball (bit 0).
 */
export function CODE_B6E69F(): void {
  w16(BOSS.headAnim, 0);
  reg.a = r16(BOSS.hp);
  if (reg.a === 0) return CODE_B6E733();
  CODE_B6E6AB();
}

/** $B6E6AB */
export function CODE_B6E6AB(): void {
  get_current_sprite_clipping();
  const x = r16(BOSS.body);
  reg.x = x;
  w16(0x32, rd(x, sprite.oam_property));
  reg.a = ((rd(x, sprite.current_graphic) - C.kleever_attack_frame1) & 0xffff) >> 1;
  reg.y = reg.a;
  CODE_B6D923();
  reg.a = db16(DATA_BAA6D0 + reg.y);
  reg.y = reg.a;
  w16(BOSS.bodyAnim, db16(reg.y));
  CODE_B6E6CC();
}

/** $B6E6CC — one box per pass. */
export function CODE_B6E6CC(): void {
  for (;;) {
    CODE_B6E73A();
    reg.x = r16(BOSS.body);
    reg.a = rd(reg.x, sprite.state) & 0x0001 ? 0x0c7b : 0x0000;
    const y = reg.y;
    check_complex_player_collision_B6();
    if (reg.c) {
      wr(reg.x, 0x54, 0x0014);
      w16(BOSS.headAnim, r16(BOSS.headAnim) | 0x0002);
    }
    reg.x = r16(BOSS.body);
    reg.y = rd(reg.x, 0x44);
    let skip = false;
    if (reg.y !== 0) {
      reg.c = false;
      reg.a = rd(reg.y, 0x2e);
      if (reg.a === 0 || reg.a === 0x0006) skip = true;
    }
    if (!skip && !(r16(BOSS.headAnim) & 0x0001)) {
      reg.a = 0x0200;
      reg.y = 0x0200;
      CODE_BEBD8E();
      if (reg.c) w16(BOSS.headAnim, r16(BOSS.headAnim) | 0x0001);
    }
    reg.y = y;
    reg.x = r16(BOSS.body);
    if (dec(0, BOSS.bodyAnim) === 0) break;
  }
  CODE_B6E733();
}

/** $B6E733 */
export function CODE_B6E733(): void {
  reg.db = 0xb6;
}

/** $B6E736 — JSL wrapper of CODE_B6E743. */
export function CODE_B6E736(): void {
  CODE_B6E743();
}

/** $B6E73A — set the box at Y, then Y += 8 (+ the carry of the last add). */
export function CODE_B6E73A(): void {
  CODE_B6E743();
  reg.a = (reg.y + 0x0008 + (reg.c ? 1 : 0)) & 0xffff;
  reg.c = reg.y + 0x0008 + (reg.c ? 1 : 0) > 0xffff;
  reg.y = reg.a;
}

/** $B6E743 — sprite_clipping[6] and [8] = box (x, y, w, h at Y+2..) relative to X, mirrored. */
export function CODE_B6E743(): void {
  const x = reg.x, y = reg.y;
  if (rd(x, 0x12) & 0x4000) return CODE_B6E762();
  let a = (rd(x, 0x06) + db16(y + 2)) & 0xffff;
  w16(CLIP6, a);
  w16(CLIP8, a);
  a = (a + db16(y + 6)) & 0xffff;
  w16(CLIP6 + 4, a);
  w16(CLIP8 + 4, a);
  reg.a = a;
  CODE_B6E788();
}

/** $B6E762 */
export function CODE_B6E762(): void {
  const x = reg.x, y = reg.y;
  let a = (neg(db16(y + 2)) + rd(x, 0x06)) & 0xffff;
  w16(CLIP6 + 4, a);
  w16(CLIP8 + 4, a);
  w16(BOSS.flag, a);
  a = (neg(db16(y + 6)) + r16(BOSS.flag)) & 0xffff;
  w16(CLIP6, a);
  w16(CLIP8, a);
  reg.a = a;
  CODE_B6E788();
}

/** $B6E788 */
export function CODE_B6E788(): void {
  const x = reg.x, y = reg.y;
  const t = rd(x, 0x0a) + db16(y + 4);
  w16(CLIP6 + 2, t);
  w16(CLIP8 + 2, t);
  const b = (t & 0xffff) + db16(y + 8) + (t > 0xffff ? 1 : 0);
  w16(CLIP6 + 6, b);
  w16(CLIP8 + 6, b);
  reg.a = b & 0xffff;
  reg.c = b > 0xffff;
}

/** $B6E80D — action: the arm sinks into the lava; Kleever then rises with the blade. */
export function CODE_B6E80D(): void {
  reg.a = snd(7, "lava_bubble_1");
  reg.c = true;
  queue_or_reset_looping_sound_effect();
  let arm = r16(BOSS.head);
  reg.x = arm;
  reg.a = rd(arm, 0x42);
  if (reg.a === 0) {
    wr(arm, 0x42, 0x0002);
    reg.y = rd(arm, 0x44);
    CODE_B6D923();
    CODE_B6E8C5();
    reg.x = r16(BOSS.body);
    CODE_B6E8C5();
    reg.db = 0xb6;
    arm = r16(BOSS.head);
    reg.x = arm;
    reg.y = (reg.y + 2) & 0xffff;
    reg.a = reg.y;
    if (reg.a === rd(arm, 0x48)) reg.y = rd(arm, 0x46);
    wr(arm, 0x44, reg.y);
  }
  CODE_B6E83F();
}

/** $B6E83F */
export function CODE_B6E83F(): void {
  const x = reg.x;
  dec(x, 0x42);
  reg.a = rd(x, 0x0a);
  if (reg.a >= 0x0350) {
    reg.a = r16(0x0759);
    if (reg.a !== 0) {
      w16(R.current_sprite, reg.a);
      delete_sprite_handle_deallocation();
      w16(0x0759, 0);
      reg.a = r16(BOSS.body);
      w16(R.current_sprite, reg.a);
    }
  }
  CODE_B6E85D();
}

/** $B6E85D */
export function CODE_B6E85D(): void {
  const arm = r16(BOSS.head);
  reg.x = arm;
  reg.a = rd(arm, 0x0a);
  if (reg.a < 0x0365) return CODE_B6E8C4();
  w16(R.current_sprite, arm);
  delete_sprite_handle_deallocation();
  w16(BOSS.head, 0);
  const x = r16(BOSS.body);
  reg.x = x;
  w16(R.current_sprite, x);
  wr(x, 0x52, PTR("CODE_B6E46E"));
  wr(x, 0x0a, 0x0300);
  w16(0x06df, 0x012c);
  w16(0x06d5, DATA_B6E8FC);
  w16(0x06d7, DATA_B6E8FC);
  w16(0x06d9, DATA_B6E97C);
  w16(0x06db, 0x0001);
  w16(0x06dd, 0x0001);
  reg.x = r16(BOSS.body);
  wr(reg.x, 0x4c, 0);
  reg.y = C.special_sprite_spawn_id_0152;
  spawn_special_sprite_index();
  reg.y = C.special_sprite_spawn_id_0154;
  spawn_special_sprite_index();
  reg.y = C.special_sprite_spawn_id_0156;
  spawn_special_sprite_index();
  reg.a = snd(5, "blade_swing");
  queue_sound_effect();
  CODE_B6E8C4();
}

/** $B6E8C4 */
export function CODE_B6E8C4(): void {}

/** $B6E8C5 — add the signed byte offsets at Y (x, y) to sprite X's position. */
export function CODE_B6E8C5(): void {
  const x = reg.x, y = reg.y;
  let a = db16(y) & 0x00ff;
  if (a & 0x0080) a |= 0xff00;
  w16(BOSS.flag, a);
  wr(x, 0x06, rd(x, 0x06) + a);
  a = db16(y + 1) & 0x00ff;
  if (a & 0x0080) a |= 0xff00;
  w16(BOSS.flag, a);
  reg.a = (rd(x, 0x0a) + a) & 0xffff;
  wr(x, 0x0a, reg.a);
}

/** $B6EA83 — load the broken hilt's next movement entry at Y (bank $BA). */
export function CODE_B6EA83(): void {
  const x = reg.x, y = reg.y;
  wr(x, 0x44, db16(y));
  wr(x, 0x26, db16(y + 2));
  wr(x, 0x2a, db16(y + 4));
  wr(x, 0x46, db16(y + 6));
  wr(x, 0x48, db16(y + 8));
  reg.a = (y + 0x000a) & 0xffff;
  wr(x, 0x42, reg.a);
}


registerSprite({
  kleever_sprite_code, CODE_B6D1B4, CODE_B6D2C0, CODE_B6D2F4, CODE_B6D2F8, CODE_B6D2FC,
  CODE_B6D302, CODE_B6D329,
});
registerRtl({
  CODE_B6D7F0, CODE_B6D82B, CODE_B6DB36, CODE_B6DBBA, CODE_B6DBD1, CODE_B6DBD2, CODE_B6DBE0,
  CODE_B6DBF6, turn_sprite_B6_2_global, CODE_B6DC2B, CODE_B6DC36, CODE_B6DC3E, CODE_B6DC3F,
  CODE_B6DC58, CODE_B6DC67, CODE_B6DC6E, CODE_B6DC8F, CODE_B6DC92, CODE_B6DD63, CODE_B6DD6D,
  CODE_B6DD80, CODE_B6E736,
});
registerRts({
  CODE_B6D358, CODE_B6D37B, CODE_B6D390, CODE_B6D3AF, CODE_B6D3C0, CODE_B6D3C1, CODE_B6D3E1,
  CODE_B6D3E4, CODE_B6D3EB, CODE_B6D407, CODE_B6D410, CODE_B6D424, CODE_B6D44A, CODE_B6D44E,
  CODE_B6D471, CODE_B6D477, CODE_B6D489, CODE_B6D4B3, CODE_B6D4B6, CODE_B6D4D2, CODE_B6D4D6,
  CODE_B6D4DB, CODE_B6D4F5, CODE_B6D510, CODE_B6D52A, CODE_B6D52D, CODE_B6D53C, CODE_B6D545,
  CODE_B6D54C, CODE_B6D556, CODE_B6D566, CODE_B6D57D, CODE_B6D580, CODE_B6D599, CODE_B6D5A1,
  CODE_B6D5B5, CODE_B6D5BD, CODE_B6D5D4, CODE_B6D5F4, CODE_B6D607, CODE_B6D620, CODE_B6D63D,
  CODE_B6D642, CODE_B6D649, CODE_B6D653, CODE_B6D672, CODE_B6D684, CODE_B6D689, CODE_B6D698,
  CODE_B6D69A, CODE_B6D69C, CODE_B6D6AD, CODE_B6D6BF, CODE_B6D6C4, CODE_B6D6CF, CODE_B6D6D1,
  CODE_B6D6E1, CODE_B6D6EB, CODE_B6D70B, CODE_B6D713, CODE_B6D715, CODE_B6D727, CODE_B6D72B,
  CODE_B6D750, CODE_B6D77E, CODE_B6D798, CODE_B6D79B, CODE_B6D7C5, CODE_B6D7D2, CODE_B6D7E1,
  CODE_B6D7EF, CODE_B6D7F4, CODE_B6D80E, CODE_B6D826, CODE_B6D82F, CODE_B6D835, CODE_B6D85E,
  CODE_B6D862, CODE_B6D869, CODE_B6D892, CODE_B6D896, CODE_B6D929, CODE_B6D9A8, CODE_B6D9A9,
  CODE_B6D9AB, CODE_B6D9B0, CODE_B6D9C8, CODE_B6D9DC, CODE_B6D9DD, CODE_B6DA11, CODE_B6DA16,
  CODE_B6DA27, CODE_B6DA3C, CODE_B6DA47, CODE_B6DA4C, CODE_B6DA5E, CODE_B6DA5F, CODE_B6DA7F,
  CODE_B6DA92, CODE_B6DA93, CODE_B6DA9C, CODE_B6DAAF, CODE_B6DAB7, CODE_B6DAC8, CODE_B6DAD6,
  CODE_B6DB09, CODE_B6DB29, CODE_B6DB2C, CODE_B6DB2E, CODE_B6DB35, CODE_B6DB52, CODE_B6DB62,
  CODE_B6DB73, CODE_B6DB7B, CODE_B6DB86, CODE_B6DB96, CODE_B6DBA7, CODE_B6DBAF, CODE_B6DBFC,
  CODE_B6DC0E, turn_sprite_B6_2, CODE_B6DC9B, CODE_B6DCAF, CODE_B6DCB4, CODE_B6DCB8, CODE_B6DCBF,
  CODE_B6DD13, CODE_B6DD4E, CODE_B6DD55, CODE_B6DD56, CODE_B6DD81, CODE_B6DD96, CODE_B6DD9F,
  CODE_B6DDC6, CODE_B6DDE5, CODE_B6DDF3, CODE_B6DE07, CODE_B6DE0E, CODE_B6DE21, CODE_B6DE2C,
  CODE_B6DE33, CODE_B6DF9F, CODE_B6DFC5, CODE_B6DFCA, CODE_B6DFE0, CODE_B6DFE2, CODE_B6DFEC,
  CODE_B6DFEF, CODE_B6E001, CODE_B6E024, CODE_B6E033, CODE_B6E055, CODE_B6E067, CODE_B6E068,
  CODE_B6E08E, CODE_B6E275, CODE_B6E2CF, CODE_B6E2E2, CODE_B6E2E5, CODE_B6E306, CODE_B6E327,
  CODE_B6E353, CODE_B6E37F, CODE_B6E3EA, CODE_B6E404, CODE_B6E41B, CODE_B6E41C, CODE_B6E45A,
  CODE_B6E46D, CODE_B6E46E, CODE_B6E489, CODE_B6E49D, CODE_B6E69F, CODE_B6E6AB, CODE_B6E6CC,
  CODE_B6E733, CODE_B6E73A, CODE_B6E743, CODE_B6E762, CODE_B6E788, CODE_B6E80D, CODE_B6E83F,
  CODE_B6E85D, CODE_B6E8C4, CODE_B6E8C5, CODE_B6EA83,
});
