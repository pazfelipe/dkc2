/**
 * Bank $B6 — the boss command interpreter and the commands Krow (Krow's Nest) uses.
 *
 * A boss runs a script of word commands (`boss_commands_table`): `parse_boss_command` reads the
 * command at sprite.$46 (Y = pointer to its operands), stores its "return code" (a routine
 * that runs every frame until the command is done, e.g. flying to a point) in sprite.$44 and
 * calls the command, which returns Y advanced past its operands. While $44 is non-zero the
 * boss code calls it each frame; when it clears $44 the next command is parsed.
 *
 * Krow variables: $06/$0A position (the head, sprite $42, follows), $0E the egg held in the
 * claws, $4C the egg being carried, $1E pending animation, $20-$2A Bresenham line state of a
 * flight ($20/$22 x/y step, $24/$26 x/y distance, $28 error, $2A minor distance), $2C speed,
 * $48/$4A target, $2E flags (bit 1 turning, 3 keep facing, 4 mirrored side, 5 swoop path
 * from a table, 6 flying, 8 animated wait, $0200 bonk, $1000 hurt).
 * Commands that only other bosses use (Kreepy Krow, King Zing, K. Rool, Kudgel) run the
 * original code.
 */
import { r8, r16, w8, w16, bus16, io8, io16, ioR16, rom16 } from "../../core/mem";
import { reg } from "../../core/cpu";
import { L, R, C, CPU } from "../../core/sym";
import {
  queue_sound_effect, spawn_special_sprite_index, spawn_special_sprite_address, enable_bullet_time_global,
  CODE_B5F0CD, CODE_B5F0ED, set_sprite_animation, CODE_BEBE8B,
} from "../../gen/routines";
import { cur, rd, wr, dec, neg, isNeg, facingLeft, snd, jsrAddr, BOSS, registerRts, registerRtl } from "./b6ba_common";

const TABLE16 = L("boss_commands_table") & 0xffff;
const KROW_PHASE_TABLE = L("DATA_B6FE24") & 0xffff;
const KROW_IDLE_SHAKE = L("krow_idle_shake_offsets") & 0xffff;
const KROW_HURT_SHAKE = L("krow_hurt_shake_offsets") & 0xffff;
const KROOL_VACUUM_ATTACK_TABLE = L("krool_vacuum_attack_table") & 0xffff;
const CODE_B6CA27_PTR = L("CODE_B6CA27") & 0xffff;
const HIT_STAR = L("DATA_FF103A") & 0xffff;
const KING_ZING_PATTERN_BANK = (L("king_zing_pattern_table") >> 16) & 0xff;

/** Values pushed by one label and pulled by a later one of the same routine (PHY ... PLA). */
export const stk: number[] = [];

/** `LDA abs,y` with the current data bank: WRAM below $2000, else ROM/bus. */
export function db16(a: number): number {
  a &= 0xffff;
  return a < 0x2000 ? r16(a) : bus16(((reg.db & 0xff) << 16) | a);
}

/** Long pointer at $CE (set with `STY $CE` + `PHK : PLA : STA $D0`). */
export function setCE(ptr: number) {
  w16(0xce, ptr & 0xffff);
  w8(0xd0, 0xb6);
}
/** `LDA [$CE]` */
export const ce16 = () => bus16(((r8(0xd0) << 16) | r16(0xce)) & 0xffffff);
/** `INC $CE` n times (16-bit). */
export const ceAdd = (n: number) => w16(0xce, (r16(0xce) + n) & 0xffff);

/** Pointer to Krow's parameters for the current HP (`DATA_B6FE24[hp]`). */
export const krowPhase = () => rom16(0xb60000 | ((KROW_PHASE_TABLE + r16(BOSS.hp) * 2) & 0xffff));

/**
 * $B6C603 — command $19 (piece set, pieces data): Krow's egg bursts. Sets $2E bit 5, keeps the
 * two script words in $10/$52 and $54, and remembers where the egg is ($0660/$0662).
 */
export function boss_command_code_19(): void {
  const y = reg.y;
  const x = r16(R.current_sprite);
  reg.x = x;
  wr(x, 0x2e, rd(x, 0x2e) | 0x0020);
  const set = db16(y);
  wr(x, 0x10, set);
  wr(x, 0x52, set);
  wr(x, 0x54, db16(y + 2));
  wr(x, 0x44, 0);
  w16(0x0660, rd(x, 0x06));
  w16(0x0662, rd(x, 0x0a));
  w16(0x06cf, 0x0004);
  reg.a = (y + 4) & 0xffff;
  reg.c = false;
  reg.y = reg.a;
}

/** $B6C635 — command $18: allow the egg hit again (clear bit 15 of $06A1). */
export function boss_command_code_18(): void {
  reg.a = r16(0x06a1) & 0x7fff;
  w16(0x06a1, reg.a);
  wr(reg.x, 0x44, 0);
}

/** $B6C643 — command $1C: stop the bonk cooldown. */
export function boss_command_code_1C(): void {
  wr(reg.x, 0x2e, rd(reg.x, 0x2e) & 0xfdff);
  wr(reg.x, 0x04, 0);
  wr(reg.x, 0x44, 0);
}

/** $B6C657 — command $16: Krow grabs a new egg in his claws ($0E). */
export function boss_command_code_16(): void {
  stk.push(reg.y);
  const x = reg.x;
  reg.a = snd(4, "knock");
  queue_sound_effect();
  reg.y = C.special_sprite_spawn_id_0016;
  spawn_special_sprite_index();
  reg.x = x;
  const egg = r16(R.alternate_sprite);
  reg.y = egg;
  wr(x, 0x0e, egg);
  wr(egg, 0x42, 0);
  wr(egg, 0x06, rd(x, 0x06) + 0x0014);
  wr(egg, 0x0a, rd(x, 0x0a) + 0xffb3);
  wr(x, 0x44, 0);
  reg.x = egg;
  wr(egg, 0x02, rd(egg, 0x02) + 1);
  reg.y = stk.pop()!;
}

/** $B6C68B — command $15 (dx, dy): spawn a hit star at an offset from Krow. */
export function boss_command_code_15(): void {
  setCE(reg.y);
  stk.push(reg.y);
  const x = reg.x;
  reg.y = HIT_STAR;
  spawn_special_sprite_address();
  const star = r16(R.alternate_sprite);
  reg.y = star;
  reg.x = x;
  wr(star, 0x06, rd(x, 0x06) + ce16());
  ceAdd(2);
  wr(star, 0x0a, rd(x, 0x0a) + ce16());
  wr(x, 0x44, 0);
  reg.a = (stk.pop()! + 4) & 0xffff;
  reg.y = reg.a;
}

/** $B6C6BE — command $13: switch to the other side of the arena (toggle $2E bit 4). */
export function boss_command_code_13(): void {
  wr(reg.x, 0x2e, rd(reg.x, 0x2e) ^ 0x0010);
  wr(reg.x, 0x44, 0);
}

/** $B6C6C8 — command $10: keep facing while flying. */
export function boss_command_code_10(): void {
  wr(reg.x, 0x2e, rd(reg.x, 0x2e) | 0x0008);
  wr(reg.x, 0x44, 0);
}

/** $B6C6D2 — command $11: turn towards the flight direction again. */
export function boss_command_code_11(): void {
  wr(reg.x, 0x2e, rd(reg.x, 0x2e) & 0xfff7);
  wr(reg.x, 0x44, 0);
}

/** $B6C6DC — command $0E: start raining eggs. */
export function boss_command_code_0E(): void {
  wr(reg.x, 0x2e, rd(reg.x, 0x2e) | 0x0001);
  w16(0x0658, 0x0001);
  wr(reg.x, 0x44, 0);
}

/** $B6C6EF — command $0C (speed): fly to the egg drop point at the side of the screen. */
export function boss_command_code_0C(): void {
  const x = cur();
  reg.x = x;
  stk.push(reg.y);
  reg.a = db16(reg.y);
  if (reg.a === 0) {
    reg.y = krowPhase();
    reg.a = db16(reg.y + 6); // the phase's fly speed
  }
  CODE_B6C704();
}

/** $B6C704 */
export function CODE_B6C704(): void {
  const x = reg.x;
  wr(x, 0x2c, reg.a);
  if (rd(x, 0x2e) & 0x0010) {
    reg.a = (r16(R.screen_scroll_x_position) + 0x00ea) & 0xffff;
    wr(x, 0x48, reg.a);
    return CODE_B6C721();
  }
  CODE_B6C718();
}

/** $B6C718 */
export function CODE_B6C718(): void {
  reg.a = (r16(R.screen_scroll_x_position) + 0x001a) & 0xffff;
  wr(reg.x, 0x48, reg.a);
  CODE_B6C721();
}

/** Start a flight towards ($48, $4A): x part. Turns around when flying away from the facing. */
function flightX(next: () => void, toLeft: () => void) {
  const x = reg.x;
  reg.a = (rd(x, 0x48) - rd(x, 0x06)) & 0xffff;
  if (isNeg(reg.a)) return toLeft();
  next();
}
function turnIfNeeded(wantLeft: boolean) {
  const x = reg.x;
  const f = rd(x, 0x2e);
  if (f & 0x0008 || f & 0x0002) return;
  if (facingLeft(x) === wantLeft) return;
  CODE_B6CB2E();
}

/** $B6C721 */
export function CODE_B6C721(): void {
  const x = reg.x;
  wr(x, 0x4a, 0x0158);
  flightX(CODE_B6C750, () => {
    reg.a = neg(reg.a);
    wr(x, 0x24, reg.a);
    wr(x, 0x20, 0xffff);
    turnIfNeeded(true);
    CODE_B6C76D();
  });
}

/** $B6C750 */
export function CODE_B6C750(): void {
  const x = reg.x;
  wr(x, 0x24, reg.a);
  wr(x, 0x20, 0x0001);
  turnIfNeeded(false);
  CODE_B6C76D();
}

/** $B6C76D — y part of the flight. */
export function CODE_B6C76D(): void {
  const x = reg.x;
  reg.a = (rd(x, 0x4a) - rd(x, 0x0a)) & 0xffff;
  if (!isNeg(reg.a)) return CODE_B6C781();
  reg.a = neg(reg.a);
  wr(x, 0x26, reg.a);
  wr(x, 0x22, 0xffff);
  CODE_B6C788();
}

/** $B6C781 */
export function CODE_B6C781(): void {
  wr(reg.x, 0x26, reg.a);
  wr(reg.x, 0x22, 0x0001);
  CODE_B6C788();
}

/** $B6C788 — Bresenham setup: error = major distance / 2, $2A = minor distance. */
export function CODE_B6C788(): void {
  const x = reg.x;
  const dx = rd(x, 0x24), dy = rd(x, 0x26);
  if (dx === dy) return CODE_B6C7A6();
  if (dx < dy) return CODE_B6C79B();
  wr(x, 0x28, dx >> 1);
  reg.a = dy;
  wr(x, 0x2a, dy);
  CODE_B6C7AD();
}

/** $B6C79B */
export function CODE_B6C79B(): void {
  const x = reg.x;
  wr(x, 0x28, rd(x, 0x26) >> 1);
  reg.a = rd(x, 0x24);
  wr(x, 0x2a, reg.a);
  CODE_B6C7AD();
}

/** $B6C7A6 */
export function CODE_B6C7A6(): void {
  reg.a = 0x0001;
  wr(reg.x, 0x28, 0x0001);
  wr(reg.x, 0x2a, 0);
  CODE_B6C7AD();
}

/** $B6C7AD — skip the command's operand. */
export function CODE_B6C7AD(): void {
  reg.a = (stk.pop()! + 2) & 0xffff;
  reg.y = reg.a;
}

/** $B6C7B4 — command $0D (pattern): set the pattern to continue with after a goto/reset. */
export function boss_command_code_0D(): void {
  w16(BOSS.pattern, db16(reg.y));
  wr(reg.x, 0x44, 0);
  reg.a = (reg.y + 2) & 0xffff;
  reg.y = reg.a;
}

/** $B6C7C4 — command $14 (left, right): set the next pattern depending on the side. */
export function boss_command_code_14(): void {
  if (rd(reg.x, 0x2e) & 0x0010) return CODE_B6C7D0();
  reg.a = db16(reg.y);
  CODE_B6C7D3();
}

/** $B6C7D0 */
export function CODE_B6C7D0(): void {
  reg.a = db16(reg.y + 2);
  CODE_B6C7D3();
}

/** $B6C7D3 */
export function CODE_B6C7D3(): void {
  w16(BOSS.pattern, reg.a);
  wr(reg.x, 0x44, 0);
  reg.a = (reg.y + 4) & 0xffff;
  reg.y = reg.a;
}

/** $B6C7E0 — command $09: lock the camera (bullet time mode 1). */
export function boss_command_code_09(): void {
  stk.push(reg.y);
  reg.a = 0x0001;
  reg.y = 0x0000;
  enable_bullet_time_global();
  wr(reg.x, 0x44, 0);
  reg.y = stk.pop()!;
}

/** $B6C7EF — command $0A: set bit 14 of $06A1. */
export function boss_command_code_0A(): void {
  stk.push(reg.y);
  reg.a = r16(0x06a1) | 0x4000;
  w16(0x06a1, reg.a);
  wr(reg.x, 0x44, 0);
  reg.y = stk.pop()!;
}

/** $B6C7FF — command $0B (a, b): shake the screen. */
export function boss_command_code_0B(): void {
  reg.a = db16(reg.y);
  CODE_B5F0CD();
  reg.a = db16(reg.y + 2);
  CODE_B5F0ED();
  reg.y = (reg.y + 4) & 0xffff;
  reg.x = cur();
  wr(reg.x, 0x44, 0);
}

/** $B6C816 — command $06: spawn the egg Krow carries ($4C). */
export function boss_command_code_06(): void {
  stk.push(reg.y);
  reg.a = snd(5, "krow_grab_egg");
  queue_sound_effect();
  reg.y = C.special_sprite_spawn_id_00A2;
  spawn_special_sprite_index();
  const egg = r16(R.alternate_sprite);
  const x = cur();
  reg.y = egg;
  reg.x = x;
  wr(x, 0x4c, egg);
  wr(egg, 0x06, rd(x, 0x06) + r16(0x06d1));
  wr(egg, 0x0a, rd(x, 0x0a) + 0x001b);
  reg.a = 0;
  wr(egg, 0x0c, 0);
  wr(x, 0x44, 0);
  reg.y = stk.pop()!;
}

/**
 * $B6C848 — command $07 (side): drop the egg towards a point near the screen edge: sets up
 * its fall (x step/distance, speed by division, timers from the phase table).
 */
export function boss_command_code_07(): void {
  stk.push(reg.y);
  reg.a = snd(5, "egg_kudgel_fall");
  queue_sound_effect();
  w8(0xd0, 0xb6);
  w16(0xce, (krowPhase() + 4) & 0xffff);
  const x = cur();
  reg.x = x;
  reg.a = db16(reg.y);
  if (reg.a === 0) return CODE_B6C885();
  reg.a = (0x0100 - ce16()) & 0xffff;
  w16(BOSS.flag, reg.a);
  reg.a = (r16(R.screen_scroll_x_position) + r16(BOSS.flag)) & 0xffff;
  CODE_B6C88B();
}

/** $B6C885 */
export function CODE_B6C885(): void {
  reg.a = (r16(R.screen_scroll_x_position) + ce16()) & 0xffff;
  CODE_B6C88B();
}

/** $B6C88B — x distance from the egg to the drop point. */
export function CODE_B6C88B(): void {
  ceAdd(4);
  const egg = rd(reg.x, 0x4c);
  reg.y = egg;
  reg.a = (reg.a - rd(egg, 0x06)) & 0xffff;
  if (!isNeg(reg.a)) return CODE_B6C8B3();
  reg.a = neg(reg.a);
  wr(egg, 0x10, reg.a);
  wr(egg, 0x20, 0xffff);
  reg.a = neg(ce16());
  wr(egg, 0x22, reg.a);
  CODE_B6C8C1();
}

/** $B6C8B3 */
export function CODE_B6C8B3(): void {
  const egg = reg.y;
  wr(egg, 0x10, reg.a);
  wr(egg, 0x20, 0x0001);
  reg.a = ce16();
  wr(egg, 0x22, reg.a);
  CODE_B6C8C1();
}

/** $B6C8C1 — distance / ((speed + 1) * 16) on the hardware divider. */
export function CODE_B6C8C1(): void {
  io16(CPU.dividen, rd(reg.y, 0x10));
  reg.a = (((ce16() + 1) & 0xffff) << 4) & 0xffff;
  io8(CPU.divisor, reg.a & 0xff);
  reg.a = 0x0008;
  CODE_B6C8D8();
}

/** $B6C8D8 — wait for the division, then set up the egg's timers and flags. */
export function CODE_B6C8D8(): void {
  reg.a = 0; // DEC A : BNE (busy wait)
  const egg = reg.y;
  const q = ioR16(CPU.divide_result);
  w8(egg + 0x24, q & 0xff);
  w8(egg + 0x26, q & 0xff);
  wr(egg, 0x28, 0x0010);
  ceAdd(2);
  w8(egg + 0x2a, ce16() & 0xff);
  ceAdd(2);
  w8(egg + 0x0e, ce16() & 0xff);
  ceAdd(2);
  w8(egg + 0x0f, ce16() & 0xff);
  ceAdd(2);
  wr(egg, 0x4e, ce16());
  ceAdd(2);
  wr(egg, 0x54, ce16());
  wr(egg, 0x52, 0x0001);
  const a = (rd(egg, 0x54) - 2) & 0xffff;
  w8(egg + 0x2b, a & 0xff);
  w16(0x0767, (a - 1) & 0xffff);
  wr(egg, 0x12, (rd(egg, 0x12) & 0xcfff) | 0x3000);
  wr(reg.x, 0x44, 0);
  if (!isNeg(rd(egg, 0x20))) return CODE_B6C956();
  reg.a = 0x0302;
  CODE_B6C959();
}

/** $B6C956 */
export function CODE_B6C956(): void {
  reg.a = 0x02fe;
  CODE_B6C959();
}

/** $B6C959 — the egg is released ($4C cleared) and starts falling. */
export function CODE_B6C959(): void {
  const egg = reg.y;
  wr(egg, 0x0c, reg.a);
  wr(reg.x, 0x4c, 0);
  wr(egg, 0x2e, rd(egg, 0x2e) | 0x000b);
  wr(egg, 0x30, rd(egg, 0x30) | 0x0020);
  reg.a = (stk.pop()! + 2) & 0xffff;
  reg.y = reg.a;
}

/** $B6C977 — command $02 (left, right): goto, or back to the pattern start ($065A) for 0. */
export function boss_command_code_02(): void {
  wr(reg.x, 0x44, 0);
  reg.a = db16(reg.y);
  if (reg.a === 0) return CODE_B6C990();
  if (rd(reg.x, 0x2e) & 0x0010) return CODE_B6C98A();
  reg.a = db16(reg.y);
  CODE_B6C98D();
}

/** $B6C98A */
export function CODE_B6C98A(): void {
  reg.a = db16(reg.y + 2);
  CODE_B6C98D();
}

/** $B6C98D */
export function CODE_B6C98D(): void {
  reg.y = reg.a;
  CODE_B6C993();
}

/** $B6C990 */
export function CODE_B6C990(): void {
  reg.y = r16(BOSS.pattern);
  CODE_B6C993();
}

/** $B6C993 */
export function CODE_B6C993(): void {}

/** $B6C9C4 — command $08 (anim): wait (animated) for the egg; time from the phase table. */
export function boss_command_code_08(): void {
  reg.a = (reg.y + 2) & 0xffff;
  stk.push(reg.a);
  const x = reg.x;
  wr(x, 0x2e, rd(x, 0x2e) | 0x0100);
  wr(x, 0x1e, db16(reg.y));
  reg.x = krowPhase();
  reg.a = db16(reg.x);
  CODE_B6CA0E();
}

/** $B6C9E5 — command $0F (anim): animated wait, time from the phase table (+$14). */
export function boss_command_code_0F(): void {
  wr(reg.x, 0x1e, db16(reg.y));
  stk.push((reg.y + 2) & 0xffff);
  reg.x = krowPhase();
  reg.a = db16(reg.x + 0x14);
  CODE_B6CA0E();
}

/** $B6C9FF — command $1A (time, anim): animated wait. */
export function boss_command_code_1A(): void {
  wr(reg.x, 0x1e, db16(reg.y + 2));
  reg.x = db16(reg.y);
  stk.push((reg.y + 4) & 0xffff);
  reg.a = reg.x;
  CODE_B6CA0E();
}

/** $B6CA0E — set the wait timer and the idle shake (bobbing) offsets. */
export function CODE_B6CA0E(): void {
  const x = cur();
  reg.x = x;
  wr(x, 0x0c, reg.a);
  wr(x, 0x20, KROW_IDLE_SHAKE);
  wr(x, 0x26, KROW_IDLE_SHAKE);
  wr(x, 0x28, KROW_HURT_SHAKE);
  reg.a = 0x0004;
  wr(x, 0x22, 0x0004);
  wr(x, 0x24, 0x0004);
  reg.y = stk.pop()!;
}

/** $B6CA27 — return code of the waits: count down $0C while bobbing up and down. */
export function CODE_B6CA27(): void {
  const x = cur();
  reg.x = x;
  if (dec(x, 0x0c) !== 0) return CODE_B6CA39();
  reg.a = rd(x, 0x2e) & 0xfeff;
  wr(x, 0x2e, reg.a);
  wr(x, 0x44, 0);
  CODE_B6CA92();
}

/** $B6CA39 — every $24 frames apply the next offset of the shake table (body, head, egg). */
export function CODE_B6CA39(): void {
  const x = reg.x;
  if (dec(x, 0x22) !== 0) return CODE_B6CA92();
  wr(x, 0x22, rd(x, 0x24));
  setCE(rd(x, 0x20));
  let y = rd(x, 0x42);
  reg.a = (rd(x, 0x06) + ce16()) & 0xffff;
  wr(x, 0x06, reg.a);
  wr(y, 0x06, reg.a);
  ceAdd(2);
  y = rd(x, 0x42);
  reg.a = (rd(x, 0x0a) + ce16()) & 0xffff;
  wr(x, 0x0a, reg.a);
  wr(y, 0x0a, reg.a);
  reg.y = rd(x, 0x0e);
  if (facingLeft(x)) return CODE_B6CA93();
  reg.a = (rd(x, 0x06) + 0x0014) & 0xffff;
  wr(reg.y, 0x06, reg.a);
  CODE_B6CA7B();
}

/** $B6CA7B */
export function CODE_B6CA7B(): void {
  const x = reg.x;
  wr(reg.y, 0x0a, rd(x, 0x0a) + 0xffb3);
  reg.a = (rd(x, 0x20) + 4) & 0xffff;
  if (reg.a === rd(x, 0x28)) reg.a = rd(x, 0x26); // wrap around to the start of the table
  CODE_B6CA90();
}

/** $B6CA90 */
export function CODE_B6CA90(): void {
  wr(reg.x, 0x20, reg.a);
  CODE_B6CA92();
}

/** $B6CA92 */
export function CODE_B6CA92(): void {}

/** $B6CA93 */
export function CODE_B6CA93(): void {
  reg.a = (rd(reg.x, 0x06) - 0x0014) & 0xffff;
  wr(reg.y, 0x06, reg.a);
  CODE_B6CA7B();
}

/** $B6CA9E — clear Krow's hurt flag ($2E bit 12). */
export function CODE_B6CA9E(): void {
  const x = r16(BOSS.body);
  reg.x = x;
  reg.a = rd(x, 0x2e) & 0xefff;
  wr(x, 0x2e, reg.a);
}

/** $B6CAA9 — command $05 (body anim, head anim): set animations. */
export function boss_command_code_05(): void {
  reg.x = cur();
  CODE_B6CAB7();
  reg.a = (reg.y + 4) & 0xffff;
  reg.y = reg.a;
  wr(reg.x, 0x44, 0);
}

/** $B6CAB7 — body animation goes to $1E (set later), the head's is set now. */
export function CODE_B6CAB7(): void {
  reg.a = db16(reg.y);
  if (reg.a !== 0) wr(reg.x, 0x1e, reg.a);
  CODE_B6CABE();
}

/** $B6CABE */
export function CODE_B6CABE(): void {
  stk.push(reg.x);
  reg.x = rd(reg.x, 0x42);
  reg.a = db16(reg.y + 2);
  if (reg.a !== 0) {
    const y = reg.y;
    const saved = cur();
    w16(R.current_sprite, reg.x);
    set_sprite_animation();
    reg.y = saved;
    w16(R.current_sprite, saved);
    reg.y = y;
  }
  CODE_B6CAD5();
}

/** $B6CAD5 */
export function CODE_B6CAD5(): void {
  reg.x = stk.pop()!;
}

/** $B6CAD7 — return code of command $03: wait until the turn is done. */
export function CODE_B6CAD7(): void {
  const x = cur();
  reg.x = x;
  reg.a = rd(x, 0x2e);
  if (!(reg.a & 0x0002)) wr(x, 0x44, 0);
  CODE_B6CAE2();
}

/** $B6CAE2 */
export function CODE_B6CAE2(): void {}

/** $B6CAE3 — command $04 (priority): set the layer priority bits of body and head. */
export function boss_command_code_04(): void {
  const x = cur();
  reg.x = x;
  w16(BOSS.flag, db16(reg.y));
  wr(x, 0x12, (rd(x, 0x12) & 0xcfff) | r16(BOSS.flag));
  const head = rd(x, 0x42);
  reg.a = (rd(head, 0x12) & 0xcfff) | r16(BOSS.flag);
  wr(head, 0x12, reg.a);
  wr(x, 0x44, 0);
  reg.y = (reg.y + 2) & 0xffff;
}

/** $B6CB0D — command $1B (priority): layer priority of the carried egg. */
export function boss_command_code_1B(): void {
  stk.push(reg.y);
  const x = cur();
  reg.x = x;
  reg.a = db16(reg.y);
  w16(BOSS.flag, reg.a);
  const egg = rd(x, 0x4c);
  reg.y = egg;
  if (egg !== 0) {
    reg.a = (rd(egg, 0x12) & 0xcfff) | r16(BOSS.flag);
    wr(egg, 0x12, reg.a);
  }
  CODE_B6CB28();
}

/** $B6CB28 */
export function CODE_B6CB28(): void {
  reg.y = stk.pop()!;
  wr(reg.x, 0x44, 0);
  reg.y = (reg.y + 2) & 0xffff;
}

/** $B6CB2E — turn Krow around (not in King Zing Sting, which shares this code). */
export function CODE_B6CB2E(): void {
  reg.a = r16(R.level_number);
  if (reg.a === C.level_king_zing_sting) return;
  CODE_B6CB36();
}

/** $B6CB36 — remember the current animations ($065C/$065E) and play the turn animations. */
export function CODE_B6CB36(): void {
  const y = reg.y;
  let x = reg.x;
  w16(BOSS.bodyAnim, rd(x, 0x36));
  w16(BOSS.headAnim, rd(rd(x, 0x42), 0x36));
  wr(x, 0x2e, rd(x, 0x2e) | 0x0002);
  reg.a = C.krow_body_turn_anim_id;
  set_sprite_animation();
  x = reg.x;
  reg.a = rd(x, 0x42);
  w16(R.current_sprite, reg.a);
  reg.a = C.krow_head_turn_anim_id;
  set_sprite_animation();
  reg.x = x;
  w16(R.current_sprite, x);
  reg.y = y;
}

/** $B6CB65 — command $12 (dx, dy, speed): fly relative to the current position. */
export function boss_command_code_12(): void {
  stk.push(reg.y);
  const x = cur();
  reg.x = x;
  const sx = db16(reg.y) + rd(x, 0x06);
  wr(x, 0x48, sx);
  reg.a = (db16(reg.y + 2) + rd(x, 0x0a) + (sx > 0xffff ? 1 : 0)) & 0xffff;
  CODE_B6CB89();
}

/** $B6CB77 — command $00 (x, y, speed): fly to a point (speed 0 = the phase's speed). */
export function boss_command_code_00(): void {
  stk.push(reg.y);
  const x = cur();
  reg.x = x;
  wr(x, 0x2e, rd(x, 0x2e) | 0x0040);
  wr(x, 0x48, db16(reg.y));
  reg.a = db16(reg.y + 2);
  CODE_B6CB89();
}

/** $B6CB89 */
export function CODE_B6CB89(): void {
  wr(reg.x, 0x4a, reg.a);
  reg.a = db16(reg.y + 4);
  if (reg.a !== 0) return CODE_B6CB9D();
  reg.y = krowPhase();
  reg.a = db16(reg.y + 6);
  CODE_B6CB9D();
}

/** $B6CB9D — set the speed; on a swoop path measure from the path's base point. */
export function CODE_B6CB9D(): void {
  const x = reg.x;
  wr(x, 0x2c, reg.a);
  if (rd(x, 0x2e) & 0x0020) {
    stk.push(rd(x, 0x06));
    stk.push(rd(x, 0x0a));
    wr(x, 0x06, r16(0x0660));
    reg.a = r16(0x0662);
    wr(x, 0x0a, reg.a);
  }
  CODE_B6CBB8();
}

/** $B6CBB8 */
export function CODE_B6CBB8(): void {
  const x = reg.x;
  flightX(CODE_B6CBE2, () => {
    reg.a = neg(reg.a);
    wr(x, 0x24, reg.a);
    wr(x, 0x20, 0xffff);
    turnIfNeeded(true);
    CODE_B6CBFF();
  });
}

/** $B6CBE2 */
export function CODE_B6CBE2(): void {
  const x = reg.x;
  wr(x, 0x24, reg.a);
  wr(x, 0x20, 0x0001);
  turnIfNeeded(false);
  CODE_B6CBFF();
}

/** $B6CBFF */
export function CODE_B6CBFF(): void {
  const x = reg.x;
  reg.a = (rd(x, 0x4a) - rd(x, 0x0a)) & 0xffff;
  if (!isNeg(reg.a)) return CODE_B6CC13();
  reg.a = neg(reg.a);
  wr(x, 0x26, reg.a);
  wr(x, 0x22, 0xffff);
  CODE_B6CC1A();
}

/** $B6CC13 */
export function CODE_B6CC13(): void {
  wr(reg.x, 0x26, reg.a);
  wr(reg.x, 0x22, 0x0001);
  CODE_B6CC1A();
}

/** $B6CC1A */
export function CODE_B6CC1A(): void {
  const x = reg.x;
  const dx = rd(x, 0x24), dy = rd(x, 0x26);
  if (dx === dy) return CODE_B6CC38();
  if (dx < dy) return CODE_B6CC2D();
  wr(x, 0x28, dx >> 1);
  reg.a = dy;
  wr(x, 0x2a, dy);
  CODE_B6CC3F();
}

/** $B6CC2D */
export function CODE_B6CC2D(): void {
  const x = reg.x;
  wr(x, 0x28, rd(x, 0x26) >> 1);
  reg.a = rd(x, 0x24);
  wr(x, 0x2a, reg.a);
  CODE_B6CC3F();
}

/** $B6CC38 */
export function CODE_B6CC38(): void {
  reg.a = 0x0001;
  wr(reg.x, 0x28, 0x0001);
  wr(reg.x, 0x2a, 0);
  CODE_B6CC3F();
}

/** $B6CC3F */
export function CODE_B6CC3F(): void {
  const x = reg.x;
  reg.a = rd(x, 0x2e);
  if (reg.a & 0x0020) {
    reg.a = stk.pop()!;
    wr(x, 0x0a, reg.a);
    reg.a = stk.pop()!;
    wr(x, 0x06, reg.a);
  }
  CODE_B6CC4C();
}

/** $B6CC4C */
export function CODE_B6CC4C(): void {
  reg.a = (stk.pop()! + 6) & 0xffff;
  reg.y = reg.a;
}

/**
 * $B6CC53 — return code of the flights: move up to $2C pixels along the line this frame
 * (one more on frames where the counter $0769 is 0), until the target is reached.
 */
export function CODE_B6CC53(): void {
  const x = cur();
  reg.x = x;
  if (rd(x, 0x2e) & 0x0020) {
    wr(x, 0x06, r16(0x0660));
    reg.a = r16(0x0662);
    wr(x, 0x0a, reg.a);
  }
  CODE_B6CC68();
}

/** $B6CC68 */
export function CODE_B6CC68(): void {
  w16(BOSS.flag, rd(reg.x, 0x2c));
  reg.a = r16(0x0769);
  if (reg.a === 0) w16(BOSS.flag, (r16(BOSS.flag) + 1) & 0xffff);
  CODE_B6CC77();
}

/** $B6CC77 — King Zing: in some phases one more step every other frame. */
export function CODE_B6CC77(): void {
  const x = reg.x;
  reg.a = r16(R.level_number);
  if (reg.a === C.level_king_zing_sting) {
    reg.a = r16(BOSS.hp);
    if (reg.a >= 0x0003 && !(reg.a & 0x0001)) {
      reg.a = rd(x, 0x2e) ^ 0x0100;
      wr(x, 0x2e, reg.a);
      reg.a &= 0x0100;
      if (reg.a !== 0) w16(BOSS.flag, (r16(BOSS.flag) + 1) & 0xffff);
    }
  }
  CODE_B6CC9B();
}

/** $B6CC9B */
export function CODE_B6CC9B(): void {
  const x = reg.x;
  reg.a = rd(x, 0x24);
  if (reg.a === rd(x, 0x26)) return CODE_B6CD6D();
  CODE_B6CCA4();
}

/** $B6CCA4 */
export function CODE_B6CCA4(): void {
  if (rd(reg.x, 0x24) >= rd(reg.x, 0x26)) return CODE_B6CCA9();
  CODE_B6CD0C();
}

/** The egg in the claws ($0E) is kept $14 pixels in front of the body (not while turning). */
function heldEggSkipped(x: number): boolean {
  reg.y = rd(x, 0x0e);
  return reg.y === 0 || (rd(x, 0x2e) & 0x0002) !== 0;
}

/** $B6CCA9 — x-major step. */
export function CODE_B6CCA9(): void {
  const x = reg.x;
  reg.a = (rd(x, 0x28) - rd(x, 0x2a)) & 0xffff;
  if (!isNeg(reg.a)) return CODE_B6CCC4();
  reg.a = (reg.a + rd(x, 0x24)) & 0xffff;
  wr(x, 0x28, reg.a);
  reg.a = (rd(x, 0x0a) + rd(x, 0x22)) & 0xffff;
  wr(x, 0x0a, reg.a);
  reg.y = r16(BOSS.head);
  wr(reg.y, 0x0a, reg.a);
  CODE_B6CCC6();
}

/** $B6CCC4 */
export function CODE_B6CCC4(): void {
  wr(reg.x, 0x28, reg.a);
  CODE_B6CCC6();
}

/** $B6CCC6 */
export function CODE_B6CCC6(): void {
  CODE_B6CF78();
  if (reg.c) return CODE_B6CDBF();
  CODE_B6CCCE();
}

/** $B6CCCE */
export function CODE_B6CCCE(): void {
  const x = reg.x;
  reg.a = (rd(x, 0x06) + rd(x, 0x20)) & 0xffff;
  wr(x, 0x06, reg.a);
  reg.y = r16(BOSS.head);
  wr(reg.y, 0x06, reg.a);
  if (heldEggSkipped(x)) return CODE_B6CCFE();
  if (facingLeft(x)) return CODE_B6CCF5();
  reg.a = (rd(x, 0x06) + 0x0014) & 0xffff;
  CODE_B6CCFB();
}

/** $B6CCF5 */
export function CODE_B6CCF5(): void {
  reg.a = (rd(reg.x, 0x06) - 0x0014) & 0xffff;
  CODE_B6CCFB();
}

/** $B6CCFB */
export function CODE_B6CCFB(): void {
  wr(reg.y, 0x06, reg.a);
  CODE_B6CCFE();
}

/** $B6CCFE */
export function CODE_B6CCFE(): void {
  CODE_B6CF78();
  if (dec(0, BOSS.flag) !== 0) return CODE_B6CCA9();
  CODE_B6CD09();
}

/** $B6CD09 */
export function CODE_B6CD09(): void {
  CODE_B6CDBF();
}

/** $B6CD0C — y-major step. */
export function CODE_B6CD0C(): void {
  const x = reg.x;
  reg.a = (rd(x, 0x28) - rd(x, 0x2a)) & 0xffff;
  if (!isNeg(reg.a)) return CODE_B6CD49();
  reg.a = (reg.a + rd(x, 0x26)) & 0xffff;
  wr(x, 0x28, reg.a);
  reg.a = (rd(x, 0x06) + rd(x, 0x20)) & 0xffff;
  wr(x, 0x06, reg.a);
  reg.y = rd(x, 0x42);
  wr(reg.y, 0x06, reg.a);
  if (heldEggSkipped(x)) return CODE_B6CD4B();
  if (facingLeft(x)) return CODE_B6CD3E();
  reg.a = (rd(x, 0x06) + 0x0014) & 0xffff;
  CODE_B6CD44();
}

/** $B6CD3E */
export function CODE_B6CD3E(): void {
  reg.a = (rd(reg.x, 0x06) - 0x0014) & 0xffff;
  CODE_B6CD44();
}

/** $B6CD44 */
export function CODE_B6CD44(): void {
  wr(reg.y, 0x06, reg.a);
  CODE_B6CD4B();
}

/** $B6CD49 */
export function CODE_B6CD49(): void {
  wr(reg.x, 0x28, reg.a);
  CODE_B6CD4B();
}

/** $B6CD4B */
export function CODE_B6CD4B(): void {
  CODE_B6CF78();
  if (reg.c) return CODE_B6CDBF();
  CODE_B6CD53();
}

/** $B6CD53 */
export function CODE_B6CD53(): void {
  const x = reg.x;
  reg.a = (rd(x, 0x0a) + rd(x, 0x22)) & 0xffff;
  wr(x, 0x0a, reg.a);
  reg.y = rd(x, 0x42);
  wr(reg.y, 0x0a, reg.a);
  CODE_B6CF78();
  if (dec(0, BOSS.flag) !== 0) return CODE_B6CD0C();
  CODE_B6CD6A();
}

/** $B6CD6A */
export function CODE_B6CD6A(): void {
  CODE_B6CDBF();
}

/** $B6CD6D — diagonal step. */
export function CODE_B6CD6D(): void {
  const x = reg.x;
  reg.a = (rd(x, 0x06) + rd(x, 0x20)) & 0xffff;
  wr(x, 0x06, reg.a);
  reg.y = rd(x, 0x42);
  wr(reg.y, 0x06, reg.a);
  if (heldEggSkipped(x)) return CODE_B6CDA0();
  if (facingLeft(x)) return CODE_B6CD97();
  reg.a = (rd(x, 0x06) + 0x0014) & 0xffff;
  wr(reg.y, 0x06, reg.a);
  CODE_B6CD9D();
}

/** $B6CD97 */
export function CODE_B6CD97(): void {
  reg.a = (rd(reg.x, 0x06) - 0x0014) & 0xffff;
  CODE_B6CD9D();
}

/** $B6CD9D */
export function CODE_B6CD9D(): void {
  wr(reg.y, 0x06, reg.a);
  CODE_B6CDA0();
}

/** $B6CDA0 */
export function CODE_B6CDA0(): void {
  CODE_B6CF78();
  if (reg.c) return CODE_B6CDBF();
  CODE_B6CDA8();
}

/** $B6CDA8 */
export function CODE_B6CDA8(): void {
  const x = reg.x;
  reg.a = (rd(x, 0x0a) + rd(x, 0x22)) & 0xffff;
  wr(x, 0x0a, reg.a);
  reg.y = rd(x, 0x42);
  wr(reg.y, 0x0a, reg.a);
  CODE_B6CF78();
  if (dec(0, BOSS.flag) !== 0) return CODE_B6CD6D();
  CODE_B6CDBF();
}

/**
 * $B6CDBF — after the steps: remember the line position ($0660/$0662); on a swoop path add
 * the path table's offset (bank of king_zing_pattern_table); then move the held and the
 * carried egg along.
 */
export function CODE_B6CDBF(): void {
  const x = cur();
  reg.x = x;
  w16(0x0660, rd(x, 0x06));
  reg.a = rd(x, 0x0a);
  w16(0x0662, reg.a);
  reg.a = rd(x, 0x2e);
  if (reg.a & 0x0020) {
    reg.y = rd(x, 0x10);
    const db = reg.db;
    CODE_B6D923();
    wr(x, 0x06, rd(x, 0x06) + db16(reg.y));
    reg.a = (rd(x, 0x0a) + db16(reg.y + 2)) & 0xffff;
    wr(x, 0x0a, reg.a);
    reg.db = db;
    reg.y = rd(x, 0x42);
    wr(reg.y, 0x0a, reg.a);
    reg.a = rd(x, 0x06);
    wr(reg.y, 0x06, reg.a);
    if (dec(0, 0x06cf) === 0) {
      w16(0x06cf, 0x0004);
      reg.a = (rd(x, 0x10) + 4) & 0xffff;
      if (reg.a === rd(x, 0x54)) reg.a = rd(x, 0x52);
      wr(x, 0x10, reg.a);
    }
  }
  CODE_B6CE0F();
}

/** $B6CE0D */
export function CODE_B6CE0D(): void {
  wr(reg.x, 0x10, reg.a);
  CODE_B6CE0F();
}

/** $B6CE0F */
export function CODE_B6CE0F(): void {
  const x = reg.x;
  reg.y = rd(x, 0x0e);
  if (reg.y !== 0) {
    reg.a = (rd(x, 0x0a) + 0xffb3) & 0xffff;
    wr(reg.y, 0x0a, reg.a);
  }
  CODE_B6CE1C();
}

/** $B6CE1C */
export function CODE_B6CE1C(): void {
  const x = reg.x;
  reg.a = r16(R.level_number);
  if (reg.a !== C.level_king_zing_sting) {
    reg.y = rd(x, 0x4c);
    if (reg.y !== 0) {
      wr(reg.y, 0x06, rd(x, 0x06) + r16(0x06d1));
      reg.a = (rd(x, 0x0a) + 0x001b) & 0xffff;
      wr(reg.y, 0x0a, reg.a);
    }
  }
  CODE_B6CE3A();
}

/** $B6CE3A */
export function CODE_B6CE3A(): void {}

/** $B6D923 — `%pea_mask_dbr(king_zing_pattern_table) : PLB : PLB` (DB = that table's bank). */
export function CODE_B6D923(): void {
  reg.db = KING_ZING_PATTERN_BANK;
}

/** $B6CEA7 — return code after Krow is hit: the hurt shake (JSL wrapper of CODE_B6CEBE). */
export function CODE_B6CEA7(): void {
  const db = reg.db;
  reg.db = 0xb6;
  CODE_B6CEBE();
  reg.db = db;
}

/** $B6CEAF — moving left: clamp at x = $120. */
export function CODE_B6CEAF(): void {
  reg.a = (rd(reg.x, 0x06) - ce16()) & 0xffff;
  if (reg.a < 0x0120) reg.a = 0x0120;
  CODE_B6CEED();
}

/**
 * $B6CEBE — knock Krow back along $28 (direction) with the offsets at $20 (one every $26
 * frames, until $22), clamped to the arena; when finished set up the next phase's wait.
 */
export function CODE_B6CEBE(): void {
  const x = cur();
  reg.x = x;
  reg.a = rd(x, 0x20);
  if (reg.a === rd(x, 0x22)) return CODE_B6CF25();
  if (dec(x, 0x24) !== 0) return CODE_B6CF25();
  wr(x, 0x24, rd(x, 0x26));
  setCE(rd(x, 0x20));
  reg.y = rd(x, 0x42);
  if (isNeg(rd(x, 0x28))) return CODE_B6CEAF();
  reg.a = (rd(x, 0x06) + ce16()) & 0xffff;
  if (reg.a >= 0x0260) reg.a = 0x0260;
  CODE_B6CEED();
}

/** $B6CEED */
export function CODE_B6CEED(): void {
  const x = reg.x;
  wr(x, 0x06, reg.a);
  wr(reg.y, 0x06, reg.a);
  ceAdd(2);
  reg.a = (rd(x, 0x0a) + ce16()) & 0xffff;
  wr(x, 0x0a, reg.a);
  wr(reg.y, 0x0a, reg.a);
  reg.y = rd(x, 0x0e);
  if (reg.y === 0) return CODE_B6CF1D();
  if (facingLeft(x)) return CODE_B6CF2D();
  reg.a = (rd(x, 0x06) + 0x0014) & 0xffff;
  wr(reg.y, 0x06, reg.a);
  CODE_B6CF14();
}

/** $B6CF14 */
export function CODE_B6CF14(): void {
  reg.a = (rd(reg.x, 0x0a) + 0xffb3) & 0xffff;
  wr(reg.y, 0x0a, reg.a);
  CODE_B6CF1D();
}

/** $B6CF1D */
export function CODE_B6CF1D(): void {
  reg.a = (rd(reg.x, 0x20) + 4) & 0xffff;
  wr(reg.x, 0x20, reg.a);
  CODE_B6CF25();
}

/** $B6CF25 */
export function CODE_B6CF25(): void {
  reg.a = rd(reg.x, 0x2e);
  if (reg.a & 0x1000) return CODE_B6CF2C();
  CODE_B6CF38();
}

/** $B6CF2C */
export function CODE_B6CF2C(): void {}

/** $B6CF2D */
export function CODE_B6CF2D(): void {
  reg.a = (rd(reg.x, 0x06) - 0x0014) & 0xffff;
  wr(reg.y, 0x06, reg.a);
  CODE_B6CF14();
}

/** $B6CF38 — the hurt is over: wait (bobbing) for the phase's time before the next attack. */
export function CODE_B6CF38(): void {
  reg.x = (r16(BOSS.hp) * 2) & 0xffff;
  reg.y = krowPhase();
  const x = r16(BOSS.body);
  reg.x = x;
  w16(R.current_sprite, x);
  wr(x, 0x0c, db16(reg.y + 2));
  reg.a = db16(reg.y + 0x18);
  wr(x, 0x22, reg.a);
  wr(x, 0x24, reg.a);
  wr(x, 0x20, KROW_HURT_SHAKE);
  wr(x, 0x26, KROW_HURT_SHAKE);
  wr(x, 0x28, KROOL_VACUUM_ATTACK_TABLE);
  reg.a = CODE_B6CA27_PTR;
  wr(x, 0x44, reg.a);
  CODE_B6CF2C();
}

/**
 * $B6CF65 — check_complex_player_collision with the sprite's oam_property preserved
 * (CODE_BEBE8B may flip it). X and Y are preserved; the result is in carry.
 */
export function check_complex_player_collision_B6(): void {
  const x = reg.x, y = reg.y;
  const prop = rd(cur(), 0x12);
  CODE_BEBE8B();
  wr(cur(), 0x12, prop);
  reg.y = y;
  reg.x = x;
}

/** $B6CF78 — reached the target ($48, $4A)? Then the command is done: carry set. */
export function CODE_B6CF78(): void {
  const x = reg.x;
  reg.a = rd(x, 0x06);
  if (reg.a !== rd(x, 0x48)) return CODE_B6CF8F();
  reg.a = rd(x, 0x0a);
  if (reg.a !== rd(x, 0x4a)) return CODE_B6CF8F();
  wr(x, 0x44, 0);
  reg.a = 0x0001;
  w16(BOSS.flag, 0x0001);
  reg.c = true;
}

/** $B6CF8F */
export function CODE_B6CF8F(): void {
  reg.c = false;
}

// Animation callbacks: x offset of the carried egg ($06D1) relative to Krow, mirrored when
// Krow faces left.
/** $B6CF91 */
export function CODE_B6CF91(): void { reg.a = 0x0003; CODE_B6CFAD(); }
/** $B6CF96 */
export function CODE_B6CF96(): void { reg.a = 0x0001; CODE_B6CFAD(); }
/** $B6CF9B */
export function CODE_B6CF9B(): void { reg.a = 0xffff; CODE_B6CFAD(); }
/** $B6CFA0 */
export function CODE_B6CFA0(): void { reg.a = 0x0000; CODE_B6CFAD(); }
/** $B6CFA5 */
export function CODE_B6CFA5(): void { reg.a = 0x0002; CODE_B6CFAD(); }
/** $B6CFAA */
export function CODE_B6CFAA(): void { reg.a = 0xfffe; CODE_B6CFAD(); }

/** $B6CFAD */
export function CODE_B6CFAD(): void {
  w16(0x06d1, reg.a);
  stk.push(reg.x);
  reg.x = r16(BOSS.body);
  reg.a = rd(reg.x, 0x12);
  if (reg.a & 0x4000) {
    reg.a = neg(r16(0x06d1));
    w16(0x06d1, reg.a);
  }
  CODE_B6CFC8();
}

/** $B6CFC8 */
export function CODE_B6CFC8(): void {
  reg.x = stk.pop()!;
}

// Animation callbacks: x offset of the egg in the claws relative to Krow.
/** $B6CFCA */
export function CODE_B6CFCA(): void { reg.a = 0x000a; CODE_B6CFDF(); }
/** $B6CFD1 */
export function CODE_B6CFD1(): void { reg.a = 0x0000; CODE_B6CFDF(); }
/** $B6CFD8 */
export function CODE_B6CFD8(): void { reg.a = 0xfff6; CODE_B6CFDF(); }

/** $B6CFDF */
export function CODE_B6CFDF(): void {
  w16(BOSS.flag, reg.a);
  const x = r16(BOSS.body);
  reg.x = x;
  reg.y = rd(x, 0x0e);
  if (reg.y === 0) return CODE_B6D007();
  reg.a = rd(x, 0x12);
  if (reg.a & 0x4000) return CODE_B6CFFD();
  reg.a = (rd(x, 0x06) + r16(BOSS.flag)) & 0xffff;
  wr(reg.y, 0x06, reg.a);
  CODE_B6D007();
}

/** $B6CFFD */
export function CODE_B6CFFD(): void {
  reg.a = (rd(reg.x, 0x06) - r16(BOSS.flag)) & 0xffff;
  wr(reg.y, 0x06, reg.a);
  CODE_B6D007();
}

/** $B6D007 */
export function CODE_B6D007(): void {}

/**
 * $B6D008 — run boss commands until one leaves a return code in $44 (X = boss sprite).
 * The commands run with DB = $B6 (scripts live in this bank).
 */
export function parse_boss_command(): void {
  do {
    let x = reg.x;
    const cmdPtr = rd(x, 0x46);
    const index = (db16(cmdPtr) * 4) & 0xffff;
    const code = db16(TABLE16 + index);
    wr(x, 0x46, code);
    reg.a = db16(TABLE16 + index + 2);
    wr(x, 0x44, reg.a);
    reg.y = (cmdPtr + 2) & 0xffff;
    jsrAddr(0xb60000 | code);
    x = cur();
    reg.x = x;
    wr(x, 0x46, reg.y);
    reg.a = rd(x, 0x44);
  } while (reg.a === 0);
}

registerRts({
  boss_command_code_19, boss_command_code_18, boss_command_code_1C, boss_command_code_16, boss_command_code_15,
  boss_command_code_13, boss_command_code_10, boss_command_code_11, boss_command_code_0E,
  boss_command_code_0C, CODE_B6C704, CODE_B6C718, CODE_B6C721, CODE_B6C750, CODE_B6C76D,
  CODE_B6C781, CODE_B6C788, CODE_B6C79B, CODE_B6C7A6, CODE_B6C7AD, boss_command_code_0D,
  boss_command_code_14, CODE_B6C7D0, CODE_B6C7D3, boss_command_code_09, boss_command_code_0A,
  boss_command_code_0B, boss_command_code_06, boss_command_code_07, CODE_B6C885, CODE_B6C88B,
  CODE_B6C8B3, CODE_B6C8C1, CODE_B6C8D8, CODE_B6C956, CODE_B6C959, boss_command_code_02,
  CODE_B6C98A, CODE_B6C98D, CODE_B6C990, CODE_B6C993, boss_command_code_08, boss_command_code_0F,
  boss_command_code_1A, CODE_B6CA0E, CODE_B6CA27, CODE_B6CA39, CODE_B6CA7B, CODE_B6CA90,
  CODE_B6CA92, CODE_B6CA93, boss_command_code_05, CODE_B6CAB7, CODE_B6CABE, CODE_B6CAD5,
  CODE_B6CAD7, CODE_B6CAE2, boss_command_code_04, boss_command_code_1B, CODE_B6CB28, CODE_B6CB2E,
  CODE_B6CB36, boss_command_code_12, boss_command_code_00, CODE_B6CB89, CODE_B6CB9D, CODE_B6CBB8,
  CODE_B6CBE2, CODE_B6CBFF, CODE_B6CC13, CODE_B6CC1A, CODE_B6CC2D, CODE_B6CC38, CODE_B6CC3F,
  CODE_B6CC4C, CODE_B6CC53, CODE_B6CC68, CODE_B6CC77, CODE_B6CC9B, CODE_B6CCA4, CODE_B6CCA9,
  CODE_B6CCC4, CODE_B6CCC6, CODE_B6CCCE, CODE_B6CCF5, CODE_B6CCFB, CODE_B6CCFE, CODE_B6CD09,
  CODE_B6CD0C, CODE_B6CD3E, CODE_B6CD44, CODE_B6CD49, CODE_B6CD4B, CODE_B6CD53, CODE_B6CD6A,
  CODE_B6CD6D, CODE_B6CD97, CODE_B6CD9D, CODE_B6CDA0, CODE_B6CDA8, CODE_B6CDBF, CODE_B6CE0D,
  CODE_B6CE0F, CODE_B6CE1C, CODE_B6CE3A, CODE_B6D923, CODE_B6CEAF, CODE_B6CEBE, CODE_B6CEED,
  CODE_B6CF14, CODE_B6CF1D, CODE_B6CF25, CODE_B6CF2C, CODE_B6CF2D, CODE_B6CF38, CODE_B6CF78,
  CODE_B6CF8F, CODE_B6CFDF, CODE_B6CFFD, CODE_B6D007, parse_boss_command,
});
registerRtl({
  CODE_B6CA9E, CODE_B6CEA7, check_complex_player_collision_B6, CODE_B6CF91, CODE_B6CF96,
  CODE_B6CF9B, CODE_B6CFA0, CODE_B6CFA5, CODE_B6CFAA, CODE_B6CFAD, CODE_B6CFC8, CODE_B6CFCA,
  CODE_B6CFD1, CODE_B6CFD8,
});
