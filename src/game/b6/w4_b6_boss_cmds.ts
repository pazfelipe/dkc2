/**
 * Bank $B6 — the rest of the boss command interpreter: the command entry points and the
 * commands of the bosses of worlds 3-7 (King Zing, Kreepy Krow, Kudgel, K. Rool).
 * Krow's commands live in b6ba_boss_commands.ts; several of the commands here jump into its
 * shared flight code (CODE_B6CB89/CODE_B6CB9D), which pulls the operand pointer pushed here
 * from the same value stack (`stk`).
 *
 * Commands run with X = boss sprite, Y = pointer to their operands (in bank $B6) and return Y
 * past their operands. Their "return code" ($44) runs every frame until it clears $44.
 *
 * Boss RAM used here: $0721 wait timer, $0723/$0725 dash interpolation/stop x, $0727/$0729
 * shot count/delay, $072B dash dust sprite, $072D vacuum duration, $072F dust timer, $0735
 * spikeball sprite, $0737 shot table pointer, $0739 vacuum effect sprite, $073B DK barrel,
 * $073F-$0745 palette cycle, $0747/$0749 jump delay/gravity, $074B landing y, $074F TNT barrel
 * held by Kudgel, $075B/$075F K. Rool's parts, $06F3-$06FF Kreepy Krow's mini-necky waves.
 */
import { r16, w16, rom16, bus16, io8, ioR16 } from "../../core/mem";
import { reg } from "../../core/cpu";
import { L, R, C, PPU, CPU, sprite } from "../../core/sym";
import {
  set_alt_sprite_animation, queue_sound_effect, set_sprite_animation, spawn_special_sprite_index,
  init_krool_projectile_position, CODE_B6D923, divide_a_by_y, interpolate_y_velocity_global,
  process_terrain_interaction_global, spawn_no_gfx_special_sprite_address, move_child_to_controller_spr,
  spawn_barrel_parts_and_smoke_global, delete_sprite_handle_deallocation, apply_position_from_velocity_global,
  get_current_sprite_clipping, CODE_BEBD8E, set_sprite_palette_global, get_random_number_2_global,
  spawn_special_sprite_address, queue_or_reset_looping_sound_effect, set_player_interaction_global,
  CODE_B3E3AF, interpolate_x_velocity_global, CODE_BA9480, CODE_B6CB2E, CODE_B6CB89, CODE_B6CB9D,
  CODE_B6F8F3,
} from "../../gen/routines";
import { cur, rd, wr, dec, neg, snd, jsrAddr, registerRts, registerRtl } from "./b6ba_common";
import { stk } from "./b6ba_boss_commands";
import { lda, lo, ge, add, sub, ABORT_PARSE } from "./w4_b6_util";

const push = (v: number) => stk.push(v & 0xffff);
const pop = () => stk.pop()! & 0xffff;
const peek = () => stk[stk.length - 1] & 0xffff;
/** X position of a sprite. */
const xpos = (s: number) => rd(s, 0x06);
/** Facing left (oam_property bit 14). */
const left = (s: number) => (rd(s, 0x12) & 0x4000) !== 0;
const B6 = 0xb60000;

const FISH_COUNT = L("krool_fish_spawn_count");
const FISH_DATA = lo("krool_fish_spawn_data");
const SHOTS_BOUNCING_GAS = lo("krool_bouncing_gas_clouds_shots");
const KUDGEL_JUMP_SPEEDS = lo("DATA_B6B98D");
const DK_BARREL = lo("DATA_FF2216");
const VACUUM = lo("krool_vacuum_attack_table");
const VACUUM2 = lo("krool_2_vacuum_attack_table");
const SHOT_COUNTS = lo("krool_shot_count_table");
const SHOTS = lo("krool_shot_table");
const PROJECTILE_TYPES = lo("krool_projectile_type_table");
const B6905F = lo("DATA_B6905F");
const MINI_NECKY_WAVES = lo("DATA_BAA0E0");
const MINI_NECKY_WAVES_BANK = (L("DATA_BAA0E0") >> 16) & 0xff;
const C20B = lo("CODE_B6C20B");


/** Set the boss's and its child's ($0656) animations: A for the boss, B for the child. */
function anims(boss: number, child: number) {
  reg.a = boss;
  set_sprite_animation();
  w16(R.alternate_sprite, r16(0x0656));
  reg.a = child;
  set_alt_sprite_animation();
}

/** $B6B68F — `JSR ($0044,x)` with DB = $B6: run the boss's current return code. */
export function execute_boss_return_command(): void {
  const db = reg.db;
  reg.db = 0xb6;
  jsrAddr(B6 | r16((0x44 + reg.x) & 0xffff));
  reg.db = db;
}

/** $B6B697 — `JSR ($0046,x)` with DB = $B6: run the command just parsed. */
export function execute_boss_command(): void {
  const db = reg.db;
  reg.db = 0xb6;
  jsrAddr(B6 | r16((0x46 + reg.x) & 0xffff));
  reg.db = db;
}

/** $B6B7C7 — the return code of commands that finish at once (never clears $44 itself). */
export function boss_command_return(): void {}

/** $B6B7C8 — command $49: K. Rool fires the fish (Krocodile Kore). */
export function boss_command_code_49(): void {
  push(reg.y);
  wr(reg.x, 0x44, 0);
  CODE_B6C28F();
  reg.a = C.smoke_cloud_5_anim_id;
  set_alt_sprite_animation();
  reg.a = snd(7, "krool_backfire");
  queue_sound_effect();
  anims(C.krool_shoot_fish_anim_id, C.krool_gun_shoot_fish_anim_id);
  w16(0x0650, bus16(FISH_COUNT));
  CODE_B6D923();
  reg.a = FISH_DATA;
  CODE_B6B7FE();
}

/** $B6B7FE — spawn the fish (A = pointer to their data, $0650 = count). */
export function CODE_B6B7FE(): void {
  do {
    push(reg.a);
    reg.y = C.special_sprite_spawn_id_0164;
    spawn_special_sprite_index();
    init_krool_projectile_position();
    const y = pop();
    reg.y = y;
    const x = r16(R.alternate_sprite);
    reg.x = x;
    wr(x, 0x20, lda(y));
    wr(x, 0x26, lda(y + 2));
    wr(x, 0x42, lda(y + 4));
    wr(x, 0x24, lda(y + 6));
    wr(x, 0x2a, lda(y + 8));
    wr(x, 0x44, lda(y + 0x0a));
    wr(x, 0x3a, lda(y + 0x0c));
    wr(x, 0x12, (rd(x, 0x12) & 0xbfff) | lda(y + 0x0e));
    wr(x, 0x46, 0x0078);
    reg.a = add(y, 0x0010);
  } while (dec(0, 0x0650) !== 0);
  reg.y = pop();
  reg.db = 0xb6;
}

/** $B6B84C — command $48 (count, shot table): a series of shots (return code CODE_B6B874). */
export function boss_command_code_48(): void {
  const y = reg.y;
  push(y);
  w16(0x06a3, r16(0x06a3) & 0xfeff);
  w16(0x0727, lda(y));
  w16(0x0729, 0x0001);
  w16(0x0737, lda(y + 2));
  reg.a = add(pop(), 0x0004);
  reg.y = reg.a;
}

/** $B6B874 — next shot of the series when the delay runs out. */
export function CODE_B6B874(): void {
  if (dec(0, 0x0729) === 0) return CODE_B6B87C();
  CODE_B6B8BC();
}

/** $B6B87C — fire: the shot routine comes from the shot table. */
export function CODE_B6B87C(): void {
  CODE_B6C28F();
  reg.a = C.smoke_cloud_4_anim_id;
  set_alt_sprite_animation();
  anims(C.krool_shoot_anim_id, C.krool_gun_shoot_anim_id);
  CODE_B6D923();
  const x = r16(0x0737);
  reg.x = x;
  w16(0x0650, lda(x));
  w16(0x0737, r16(0x0737) + 2);
  reg.x = 0;
  jsrAddr(B6 | r16(0x0650));
  if (dec(0, 0x0727) === 0) {
    reg.x = cur();
    wr(reg.x, 0x44, 0);
  }
  CODE_B6B8BC();
}

/** $B6B8BC */
export function CODE_B6B8BC(): void {}

/** $B6B8BD — command $47: K. Rool shoots Donkey Kong out of his gun (K. Rool Duel intro). */
export function boss_command_code_47(): void {
  wr(reg.x, 0x44, 0);
  push(reg.y);
  reg.a = C.krool_shoot_donkey_anim_id;
  set_sprite_animation();
  reg.a = snd(5, "barrel_blast");
  queue_sound_effect();
  w16(R.alternate_sprite, r16(0x0656));
  reg.a = C.krool_gun_shoot_donkey_anim_id;
  set_alt_sprite_animation();
  reg.y = C.special_sprite_spawn_id_0142;
  spawn_special_sprite_index();
  init_krool_projectile_position();
  const y = reg.y;
  wr(y, 0x20, 0xfa00);
  wr(y, 0x26, 0xfa00);
  wr(y, 0x24, 0xff00);
  wr(y, 0x2a, 0xff00);
  CODE_B6C28F();
  reg.a = C.smoke_cloud_4_anim_id;
  set_alt_sprite_animation();
  reg.y = pop();
}

/** $B6B903 — command $46: K. Rool hits the tied-up Donkey Kong. */
export function boss_command_code_46(): void {
  push(reg.y);
  reg.a = r16(0x0763);
  if (reg.a !== 0x0002) return CODE_B6B923();
  anims(C.krool_melee_donkey_2_anim_id, C.krool_gun_melee_donkey_2_anim_id);
  CODE_B6B937();
}

/** $B6B923 */
export function CODE_B6B923(): void {
  anims(C.krool_melee_donkey_anim_id, C.krool_gun_melee_donkey_anim_id);
  CODE_B6B937();
}

/** $B6B937 */
export function CODE_B6B937(): void {
  reg.x = cur();
  wr(reg.x, 0x44, 0);
  reg.y = pop();
}

/** $B6B93D — command $45 (state, x, y, facing, anim, anim2): set up K. Rool's two parts. */
export function boss_command_code_45(): void {
  const y = reg.y;
  reg.a = lda(y);
  const x = r16(0x075f);
  reg.x = x;
  w16(R.alternate_sprite, x);
  wr(x, 0x2e, reg.a);
  reg.a = lda(y + 2);
  if (reg.a !== 0) {
    wr(x, 0x06, reg.a);
    reg.a = lda(y + 4);
    wr(x, 0x0a, reg.a);
  }
  CODE_B6B953();
}

/** $B6B953 */
export function CODE_B6B953(): void {
  const y = reg.y;
  CODE_B6B982();
  reg.x = r16(0x075b);
  CODE_B6B982();
  reg.a = lda(y + 8);
  if (reg.a !== 0) {
    set_alt_sprite_animation();
    reg.y = y;
  }
  CODE_B6B967();
}

/** $B6B967 */
export function CODE_B6B967(): void {
  const y = reg.y;
  reg.x = r16(0x075b);
  w16(R.alternate_sprite, reg.x);
  reg.a = lda(y + 0x0a);
  if (reg.a !== 0) {
    set_alt_sprite_animation();
    reg.y = y;
  }
  CODE_B6B977();
}

/** $B6B977 */
export function CODE_B6B977(): void {
  reg.x = cur();
  wr(reg.x, 0x44, 0);
  reg.a = add(reg.y, 0x000c);
  reg.y = reg.a;
}

/** $B6B982 — facing of sprite X from operand +6. */
export function CODE_B6B982(): void {
  reg.a = (rd(reg.x, 0x12) & 0xbfff) | lda(reg.y + 6);
  wr(reg.x, 0x12, reg.a);
}

/** $B6B995 — command $44 (max speed, y speed, y target, gravity): Kudgel jumps at the Kong. */
export function boss_command_code_44(): void {
  push(reg.y);
  let x = r16(0x0656);
  reg.x = x;
  reg.a = rd(x, 0x30) | 0x0020;
  wr(x, 0x30, reg.a);
  x = r16(0x0654);
  reg.x = x;
  wr(x, 0x30, reg.a);
  wr(x, 0x2e, rd(x, 0x2e) & 0xdfff);
  reg.y = r16(R.active_kong_sprite);
  reg.a = sub(xpos(x), xpos(reg.y));
  if (reg.a & 0x8000) reg.a = neg(reg.a);
  CODE_B6B9BB();
}

/** $B6B9BB — horizontal speed = distance / (frames of the jump for this HP), 8.8 fixed point. */
export function CODE_B6B9BB(): void {
  const dist = reg.a;
  reg.y = lda(KUDGEL_JUMP_SPEEDS + ((r16(0x0652) << 1) & 0xffff));
  reg.a = dist;
  divide_a_by_y();
  const q = ioR16(CPU.divide_result);
  w16(0x0650, (q << 8) & 0xff00);
  reg.a = (ioR16(CPU.divide_remainder) & 0x00ff) | r16(0x0650);
  w16(0x0650, reg.a);
  const y = peek();
  reg.y = y;
  reg.a = r16(0x0650);
  if (ge(reg.a, lda(y))) reg.a = lda(y);
  CODE_B6B9F3();
}

/** $B6B9F3 */
export function CODE_B6B9F3(): void {
  const x = reg.x;
  const y = reg.y;
  wr(x, 0x20, reg.a);
  wr(x, 0x24, lda(y + 2));
  wr(x, 0x2a, lda(y + 4));
  w16(0x0749, lda(y + 6));
  w16(0x0747, 0x0011);
  reg.y = r16(R.active_kong_sprite);
  reg.a = xpos(x);
  if (ge(reg.a, xpos(reg.y))) {
    reg.a = neg(rd(x, 0x20));
    wr(x, 0x20, reg.a);
  }
  CODE_B6BA1F();
}

/** $B6BA1F */
export function CODE_B6BA1F(): void {
  wr(reg.x, 0x26, 0);
  make_boss_face_kong();
  anims(C.kudgel_jump_short_anim_id, C.kudgel_club_jump_short_anim_id);
  reg.a = add(pop(), 0x0008);
  reg.y = reg.a;
}

/** $B6BA3F — return code of $44: after the crouch delay, fall to the floor (y $0225). */
export function CODE_B6BA3F(): void {
  reg.a = r16(0x0747);
  if (reg.a !== 0 && dec(0, 0x0747) !== 0) return CODE_B6BA93();
  CODE_B6BA4A();
}

/** $B6BA4A */
export function CODE_B6BA4A(): void {
  reg.a = r16(0x0749);
  interpolate_y_velocity_global();
  process_terrain_interaction_global();
  let x = cur();
  reg.x = x;
  reg.a = rd(x, 0x0a);
  if (!ge(reg.a, 0x0225)) return CODE_B6BA93();
  reg.a = snd(5, "kudgel_land");
  queue_sound_effect();
  x = cur();
  reg.x = x;
  wr(x, 0x44, 0);
  reg.a = rd(x, 0x2e);
  if (reg.a & 0x2000) return CODE_B6BA93();
  anims(C.kudgel_land_anim_id, C.kudgel_club_land_anim_id);
  reg.y = lo("DATA_FF217A");
  spawn_no_gfx_special_sprite_address();
  reg.y = lo("DATA_FF21B4");
  spawn_no_gfx_special_sprite_address();
  CODE_B6BA93();
}

/** $B6BA93 */
export function CODE_B6BA93(): void {
  move_child_to_controller_spr();
}

/** $B6BA97 — command $42: wait for Kudgel to be on the ground (repeat this command while not). */
export function boss_command_code_42(): void {
  wr(reg.x, 0x32, 0);
  reg.x = r16(0x0656);
  wr(reg.x, 0x32, 0);
  const x = r16(0x0654);
  reg.x = x;
  reg.a = rd(x, 0x2e);
  if (reg.a & 0x2000) return CODE_B6BAB0();
  reg.a |= 0x0100;
  CODE_B6BAAB();
}

/** $B6BAAB */
export function CODE_B6BAAB(): void {
  wr(reg.x, 0x2e, reg.a);
  CODE_B6BAAD();
}

/** $B6BAAD */
export function CODE_B6BAAD(): void {
  wr(reg.x, 0x44, 0);
}

/**
 * $B6BAB0 — point the script back at this command and leave the whole parse
 * (`PLA : PLA` drops the return addresses of the command call and of `.parse_command`,
 * so the RTS returns from parse_boss_command itself).
 */
export function CODE_B6BAB0(): void {
  reg.y = (reg.y - 2) & 0xffff;
  wr(reg.x, 0x46, reg.y);
  CODE_B6BAAD();
  throw ABORT_PARSE;
}

/** $B6BAB8 — command $43: clear Kudgel's $2E bit 8. */
export function boss_command_code_43(): void {
  reg.a = rd(reg.x, 0x2e) & 0xfeff;
  CODE_B6BAAB();
}

/** $B6BABF — command $41 (wait, wait while holding TNT): wait timer (return code CODE_B6BAD8). */
export function boss_command_code_41(): void {
  reg.a = r16(0x074f);
  if (reg.a === 0) return CODE_B6BACA();
  reg.a = lda(reg.y + 2);
  CODE_B6BACD();
}

/** $B6BACA */
export function CODE_B6BACA(): void {
  reg.a = lda(reg.y);
  CODE_B6BACD();
}

/** $B6BACD */
export function CODE_B6BACD(): void {
  w16(0x0721, reg.a);
  reg.a = add(reg.y, 0x0004);
  reg.y = reg.a;
}

/** $B6BAD8 — wait; a TNT barrel taken away ends the wait early. */
export function CODE_B6BAD8(): void {
  reg.a = r16(0x0721);
  if (reg.a === 0 || reg.a & 0x8000) return CODE_B6BAE5();
  if (dec(0, 0x0721) !== 0) return CODE_B6BAEC();
  CODE_B6BAE5();
}

/** $B6BAE5 */
export function CODE_B6BAE5(): void {
  w16(0x0721, 0);
  wr(reg.x, 0x44, 0);
  CODE_B6BAF2();
}

/** $B6BAEC */
export function CODE_B6BAEC(): void {
  reg.a = r16(0x074f);
  if (reg.a === 0) return CODE_B6BAE5();
  CODE_B6BAF2();
}

/** $B6BAF2 */
export function CODE_B6BAF2(): void {}

/** $B6BAF3 — command $40 (y speed, y target, gravity): Kudgel jumps straight up. */
export function boss_command_code_40(): void {
  const y = reg.y;
  push(y);
  const x = reg.x;
  wr(x, 0x24, lda(y));
  wr(x, 0x2a, lda(y + 2));
  w16(0x0749, lda(y + 4));
  wr(x, 0x20, 0);
  wr(x, 0x26, 0);
  w16(0x0747, 0x0014);
  anims(C.kudgel_jump_anim_id, C.kudgel_club_jump_anim_id);
  reg.a = add(pop(), 0x0006);
  reg.y = reg.a;
}

/** $B6BB2B — return code of $40: fall back to the floor. */
export function CODE_B6BB2B(): void {
  reg.a = r16(0x0747);
  if (reg.a !== 0 && dec(0, 0x0747) !== 0) return CODE_B6BB68();
  CODE_B6BB36();
}

/** $B6BB36 */
export function CODE_B6BB36(): void {
  reg.a = r16(0x0749);
  interpolate_y_velocity_global();
  process_terrain_interaction_global();
  const x = cur();
  reg.x = x;
  reg.a = rd(x, 0x0a);
  if (ge(reg.a, 0x0225)) {
    wr(x, 0x44, 0);
    reg.a = C.kudgel_land_anim_id;
    set_sprite_animation();
    reg.a = snd(5, "kudgel_land");
    queue_sound_effect();
    w16(R.alternate_sprite, r16(0x0656));
    reg.a = C.kudgel_club_land_anim_id;
    set_alt_sprite_animation();
  }
  CODE_B6BB68();
}

/** $B6BB68 */
export function CODE_B6BB68(): void {
  move_child_to_controller_spr();
}

/** $B6BB6C — command $3F: the TNT barrel Kudgel holds explodes. */
export function boss_command_code_3F(): void {
  push(reg.y);
  reg.a = r16(0x074f);
  if (reg.a !== 0) {
    w16(R.current_sprite, reg.a);
    spawn_barrel_parts_and_smoke_global();
    delete_sprite_handle_deallocation();
    reg.x = r16(0x0654);
    w16(R.current_sprite, reg.x);
    reg.a = r16(0x074f);
    if (reg.a === r16(R.current_held_sprite)) w16(R.current_held_sprite, 0);
  }
  CODE_B6BB8E();
}

/** $B6BB8E */
export function CODE_B6BB8E(): void {
  w16(0x074f, 0);
  reg.x = r16(0x0654);
  wr(reg.x, 0x44, 0);
  reg.y = pop();
}

/** $B6BB98 — command $3E (value): $074D. */
export function boss_command_code_3E(): void {
  reg.a = lda(reg.y);
  w16(0x074d, reg.a);
  reg.y = (reg.y + 2) & 0xffff;
  wr(reg.x, 0x44, 0);
}

/** $B6BBA4 — command $3D (unused): face the Kong. */
export function boss_command_code_3D(): void {
  make_boss_face_kong();
  wr(reg.x, 0x44, 0);
}

/** $B6BBAA — turn the boss (and its child) toward the active Kong. */
export function make_boss_face_kong(): void {
  const x = reg.x;
  reg.y = r16(R.active_kong_sprite);
  reg.a = xpos(x);
  if (!ge(reg.a, xpos(reg.y))) {
    reg.a = rd(x, 0x12);
    if (reg.a & 0x4000) turn_boss_and_child_sprite();
  } else {
    reg.a = rd(x, 0x12);
    if (!(reg.a & 0x4000)) turn_boss_and_child_sprite();
  }
}

/** $B6BBCB — command $3C: Kudgel's long club swing. */
export function boss_command_code_3C(): void {
  const y = reg.y;
  anims(C.kudgel_attack_long_anim_id, C.kudgel_club_attack_long_anim_id);
  reg.y = y;
}

/** $B6BBE2 — command $3B (landing y, y speed, y target, gravity): Kudgel's big jump. */
export function boss_command_code_3B(): void {
  const y = reg.y;
  push(y);
  let x = r16(0x0656);
  reg.x = x;
  reg.a = rd(x, 0x30) | 0x0020;
  wr(x, 0x30, reg.a);
  x = r16(0x0654);
  reg.x = x;
  wr(x, 0x30, reg.a);
  wr(x, 0x2e, rd(x, 0x2e) & 0xdfff);
  w16(0x074b, lda(y));
  wr(x, 0x24, lda(y + 2));
  wr(x, 0x2a, lda(y + 4));
  w16(0x0749, lda(y + 6));
  w16(0x0747, 0x0014);
  wr(x, 0x20, 0);
  wr(x, 0x26, 0);
  reg.a = rd(x, 0x2e);
  if (!(reg.a & 0x2000)) anims(C.kudgel_jump_anim_id, C.kudgel_club_jump_anim_id);
  CODE_B6BC37();
}

/** $B6BC37 */
export function CODE_B6BC37(): void {
  reg.a = add(pop(), 0x0008);
  reg.y = reg.a;
}

/** $B6BC3E — return code of $3B: rise until the top of the jump at $074B. */
export function CODE_B6BC3E(): void {
  reg.a = r16(0x0747);
  if (reg.a !== 0 && dec(0, 0x0747) !== 0) return CODE_B6BC77();
  CODE_B6BC49();
}

/** $B6BC49 */
export function CODE_B6BC49(): void {
  reg.a = r16(0x0749);
  interpolate_y_velocity_global();
  apply_position_from_velocity_global();
  const x = cur();
  reg.x = x;
  reg.a = rd(x, 0x0a);
  if (ge(reg.a, r16(0x074b))) return CODE_B6BC69();
  CODE_B6BC5F();
}

/** $B6BC5F */
export function CODE_B6BC5F(): void {
  wr(reg.x, 0x44, 0);
  reg.a = r16(0x074b);
  wr(reg.x, 0x0a, reg.a);
  CODE_B6BC77();
}

/** $B6BC69 */
export function CODE_B6BC69(): void {
  reg.a = rd(reg.x, 0x24) & 0xff00;
  if (reg.a !== 0) return CODE_B6BC77();
  reg.a = rd(reg.x, 0x24);
  if (!ge(reg.a, 0x0080)) return CODE_B6BC5F();
  CODE_B6BC77();
}

/** $B6BC77 */
export function CODE_B6BC77(): void {
  move_child_to_controller_spr();
}

/** $B6BC7B — command $3A (x: 0 = Kong's, 1 = keep; delay, y speed, y target, gravity): fall. */
export function boss_command_code_3A(): void {
  push(reg.y);
  reg.a = lda(reg.y);
  if (reg.a !== 0) return CODE_B6BC8A();
  reg.x = r16(R.active_kong_sprite);
  reg.a = xpos(reg.x);
  reg.x = cur();
  CODE_B6BC8F();
}

/** $B6BC8A */
export function CODE_B6BC8A(): void {
  if (reg.a === 0x0001) return CODE_B6BC91();
  CODE_B6BC8F();
}

/** $B6BC8F */
export function CODE_B6BC8F(): void {
  wr(reg.x, 0x06, reg.a);
  CODE_B6BC91();
}

/** $B6BC91 */
export function CODE_B6BC91(): void {
  const x = reg.x;
  const y = reg.y;
  w16(0x0747, lda(y + 2));
  wr(x, 0x24, lda(y + 4));
  wr(x, 0x2a, lda(y + 6));
  w16(0x0749, lda(y + 8));
  wr(x, 0x20, 0);
  wr(x, 0x26, 0);
  reg.a = rd(x, 0x2e);
  if (!(reg.a & 0x2000)) anims(C.kudgel_fall_anim_id, C.kudgel_club_fall_anim_id);
  CODE_B6BCC8();
}

/** $B6BCC8 */
export function CODE_B6BCC8(): void {
  reg.a = add(pop(), 0x000a);
  reg.y = reg.a;
}

/** $B6BCCF — return code of $3A: after the delay, fall; land on TNT barrels to blow them up. */
export function CODE_B6BCCF(): void {
  reg.a = r16(0x0747);
  if (reg.a === 0) return CODE_B6BCE9();
  if (dec(0, 0x0747) === 0) return CODE_B6BCDD();
  CODE_B6BD6F();
}

/** $B6BCDD */
export function CODE_B6BCDD(): void {
  reg.x = cur();
  make_boss_face_kong();
  reg.a = snd(5, "egg_kudgel_fall");
  queue_sound_effect();
  CODE_B6BCE9();
}

/** $B6BCE9 */
export function CODE_B6BCE9(): void {
  reg.a = r16(0x0749);
  interpolate_y_velocity_global();
  process_terrain_interaction_global();
  let x = cur();
  reg.x = x;
  reg.a = rd(x, 0x0a);
  if (ge(reg.a, 0x0225)) {
    wr(x, 0x44, 0);
    reg.a = snd(5, "kudgel_land");
    queue_sound_effect();
    x = cur();
    reg.x = x;
    reg.a = rd(x, 0x2e);
    if (!(reg.a & 0x2000)) {
      anims(C.kudgel_land_anim_id, C.kudgel_club_land_anim_id);
      reg.y = lo("DATA_FF217A");
      spawn_no_gfx_special_sprite_address();
      reg.y = lo("DATA_FF21B4");
      spawn_no_gfx_special_sprite_address();
    }
  }
  CODE_B6BD32();
}

/** $B6BD32 */
export function CODE_B6BD32(): void {
  get_current_sprite_clipping();
  reg.a = 0x0200;
  reg.y = 0x0200;
  CODE_BEBD8E();
  if (reg.c) {
    const y = r16(R.colliding_sprite);
    reg.y = y;
    reg.a = rd(y, sprite.type);
    if (reg.a === C.sprite_tnt_barrel) {
      reg.a = rd(y, 0x20);
      if (reg.a === 0) {
        w16(R.current_sprite, y);
        spawn_barrel_parts_and_smoke_global();
        delete_sprite_handle_deallocation();
        reg.x = r16(0x0654);
        w16(R.current_sprite, reg.x);
        reg.a = r16(0x074f);
        w16(0x074f, 0);
        if (reg.a === r16(R.current_held_sprite)) w16(R.current_held_sprite, 0);
      }
    }
  }
  CODE_B6BD6F();
}

/** $B6BD6F */
export function CODE_B6BD6F(): void {
  move_child_to_controller_spr();
}

/** $B6BD73 — command $38: set $2E bit 13. */
export function boss_command_code_38(): void {
  reg.a = rd(reg.x, 0x2e) | 0x2000;
  CODE_B6BD78();
}

/** $B6BD78 */
export function CODE_B6BD78(): void {
  wr(reg.x, 0x2e, reg.a);
  wr(reg.x, 0x44, 0);
}

/** $B6BD7D — command $39: clear $2E bit 13. */
export function boss_command_code_39(): void {
  reg.a = rd(reg.x, 0x2e) & 0xdfff;
  CODE_B6BD78();
}

/** $B6BD84 — command $37 (palette pairs start, end, period): palette cycle (CODE_B6BDA4). */
export function boss_command_code_37(): void {
  const y = reg.y;
  w16(0x073f, lda(y));
  w16(0x0741, lda(y + 2));
  reg.a = lda(y + 4);
  w16(0x0745, reg.a);
  w16(0x0743, reg.a);
  reg.a = add(y, 0x0006);
  reg.y = reg.a;
}

/** $B6BDA4 — every $0745 frames set the next palette pair on the boss and its child. */
export function CODE_B6BDA4(): void {
  if (dec(0, 0x0743) !== 0) return CODE_B6BDE1();
  w16(0x0743, r16(0x0745));
  reg.y = r16(0x073f);
  if (reg.y !== r16(0x0741)) return CODE_B6BDBF();
  reg.x = cur();
  wr(reg.x, 0x44, 0);
  CODE_B6BDE1();
}

/** $B6BDBF */
export function CODE_B6BDBF(): void {
  reg.a = lda(reg.y);
  reg.x = cur();
  set_sprite_palette_global();
  reg.x = r16(0x0656);
  reg.y = r16(0x073f);
  reg.a = lda(reg.y + 2);
  set_sprite_palette_global();
  reg.a = add(r16(0x073f), 0x0004);
  w16(0x073f, reg.a);
  CODE_B6BDE1();
}

/** $B6BDE1 */
export function CODE_B6BDE1(): void {}

/** $B6BDE2 — command $36 (time): wait, unless the Kong is not able to be hit at the moment. */
export function boss_command_code_36(): void {
  reg.a = r16(0x0919) & 0x0003;
  if (reg.a === 0) {
    reg.a = r16(0x091b);
    if (reg.a !== 0x0100) {
      wr(reg.x, 0x44, 0);
      return CODE_B6BDFD();
    }
  }
  CODE_B6BDF6();
}

/** $B6BDF6 */
export function CODE_B6BDF6(): void {
  reg.a = lda(reg.y);
  w16(0x0721, reg.a);
  CODE_B6BDFD();
}

/** $B6BDFD */
export function CODE_B6BDFD(): void {
  reg.y = (reg.y + 2) & 0xffff;
}

/** $B6BE00 — command $35 (duration): vacuum attack for a given time. */
export function boss_command_code_35(): void {
  reg.a = lda(reg.y);
  reg.y = (reg.y + 2) & 0xffff;
  push(reg.y);
  w16(0x072d, reg.a);
  CODE_B6C0BC();
}

/** $B6BE0D — command $34 (distance): K. Rool appears at a random side of the Kong. */
export function boss_command_code_34(): void {
  push(reg.y);
  reg.y = 0x7fff;
  get_random_number_2_global();
  reg.x = cur();
  if (!(reg.a & 0x0001)) return CODE_B6BE2D();
  CODE_B6BE1C();
}

/** $B6BE1C — try the right side; too far right: the left side. */
export function CODE_B6BE1C(): void {
  for (;;) {
    reg.y = peek();
    reg.x = r16(R.active_kong_sprite);
    reg.a = add(xpos(reg.x), lda(reg.y));
    if (!ge(reg.a, 0x0278)) return CODE_B6BE3E();
    if (!tryLeft()) return CODE_B6BE3E();
  }
}

/** $B6BE2D — try the left side; too far left: the right side. */
export function CODE_B6BE2D(): void {
  if (tryLeft()) return CODE_B6BE1C();
  CODE_B6BE3E();
}

/** The left side: A = Kong x - distance; true when that is too far left (go right). */
function tryLeft(): boolean {
  reg.y = peek();
  reg.x = r16(R.active_kong_sprite);
  reg.a = sub(xpos(reg.x), lda(reg.y));
  return !ge(reg.a, 0x012c);
}

/** $B6BE3E */
export function CODE_B6BE3E(): void {
  const x = cur();
  reg.x = x;
  wr(x, 0x06, reg.a);
  reg.y = r16(0x0656);
  wr(reg.y, 0x06, reg.a);
  reg.y = r16(R.active_kong_sprite);
  reg.a = xpos(x);
  if (ge(reg.a, xpos(reg.y))) return CODE_B6BE5E();
  reg.a = rd(x, 0x12);
  if (reg.a & 0x4000) turn_boss_and_child_sprite();
  CODE_B6BE68();
}

/** $B6BE5E */
export function CODE_B6BE5E(): void {
  reg.a = rd(reg.x, 0x12);
  if (!(reg.a & 0x4000)) turn_boss_and_child_sprite();
  CODE_B6BE68();
}

/** $B6BE68 */
export function CODE_B6BE68(): void {
  reg.y = (pop() + 2) & 0xffff;
  reg.x = cur();
  wr(reg.x, 0x44, 0);
}

/** $B6BE70 — flip the boss ($0654) and its child ($0656). */
export function turn_boss_and_child_sprite(): void {
  reg.x = r16(0x0654);
  turn_sprite_B6();
  reg.x = r16(0x0656);
  turn_sprite_B6();
}

/** $B6BE7D — flip sprite X horizontally. */
export function turn_sprite_B6(): void {
  reg.a = rd(reg.x, 0x12) ^ 0x4000;
  wr(reg.x, 0x12, reg.a);
}

/** $B6BE85 — command $33 (priority bits, 0 = hide): show/hide the boss, its child and dust. */
export function boss_command_code_33(): void {
  let x = cur();
  reg.x = x;
  wr(x, 0x44, 0);
  reg.a = lda(reg.y);
  if (reg.a === 0) return CODE_B6BEB2();
  w16(0x0650, reg.a);
  wr(x, 0x12, (rd(x, 0x12) & 0xcfff) | r16(0x0650));
  wr(x, 0x1c, 0);
  x = r16(0x0656);
  reg.x = x;
  reg.a = (rd(x, 0x12) & 0xcfff) | r16(0x0650);
  wr(x, 0x12, reg.a);
  wr(x, 0x1c, 0);
  CODE_B6BEAF();
}

/** $B6BEAF */
export function CODE_B6BEAF(): void {
  reg.y = (reg.y + 2) & 0xffff;
}

/** $B6BEB2 */
export function CODE_B6BEB2(): void {
  reg.a = 0xc000;
  wr(reg.x, 0x1c, reg.a);
  reg.x = r16(0x0656);
  wr(reg.x, 0x1c, reg.a);
  reg.x = r16(0x072b);
  if (reg.x !== 0) wr(reg.x, 0x1c, reg.a);
  CODE_B6BEAF();
}

/** $B6BEC5 — command $31. */
export function boss_command_code_31(): void {
  wr(reg.x, 0x4e, 0);
  reg.a = lda(B6905F);
  wr(reg.x, 0x4c, reg.a);
  wr(reg.x, 0x44, 0);
}

/** $B6BECF — priority bits of sprite X = %10. */
export function CODE_B6BECF(): void {
  reg.a = (rd(reg.x, 0x12) & 0xcfff) | 0x2000;
  wr(reg.x, 0x12, reg.a);
}

/** $B6BEDA — command $32. */
export function boss_command_code_32(): void {
  CODE_B6BECF();
  wr(reg.x, 0x4c, 0);
  wr(reg.x, 0x44, 0);
  reg.x = r16(0x0656);
  CODE_B6BECF();
}

/** $B6BEE8 — command $30: clear $0919. */
export function boss_command_code_30(): void {
  w16(0x0919, 0);
  wr(reg.x, 0x44, 0);
}

/** $B6BEEE — command $2F: three bouncing gas clouds (return code CODE_B6BF11). */
export function boss_command_code_2F(): void {
  push(reg.y);
  reg.a = r16(0x06a3) & 0xfeff;
  w16(0x06a3, reg.a);
  w16(0x0727, 0x0003);
  w16(0x0729, 0x0001);
  w16(0x0737, SHOTS_BOUNCING_GAS);
  reg.y = pop();
}

/** $B6BF11 */
export function CODE_B6BF11(): void {
  if (dec(0, 0x0729) === 0) return CODE_B6BF19();
  CODE_B6C009();
}

/** $B6BF19 — fire one gas cloud from the gun. */
export function CODE_B6BF19(): void {
  push(reg.y);
  w16(0x06a3, r16(0x06a3) & 0xfeff);
  reg.y = C.special_sprite_spawn_id_017C;
  spawn_special_sprite_index();
  reg.y = r16(R.alternate_sprite);
  const x = cur();
  reg.x = x;
  reg.a = rd(x, 0x12);
  if (reg.a & 0x4000) return CODE_B6BF45();
  wr(reg.y, 0x20, 0x0100);
  reg.a = add(xpos(x), 0x0028);
  CODE_B6BF51();
}

/** $B6BF45 */
export function CODE_B6BF45(): void {
  wr(reg.y, 0x20, 0xff00);
  reg.a = sub(xpos(reg.x), 0x0028);
  CODE_B6BF51();
}

/** $B6BF51 */
export function CODE_B6BF51(): void {
  let x = reg.x;
  let y = reg.y;
  wr(y, 0x06, reg.a);
  wr(y, 0x0a, add(rd(x, 0x0a), 0xffe4));
  wr(y, 0x2a, 0xfd80);
  wr(y, 0x42, 0x0004);
  wr(y, 0x44, 0x0006);
  reg.a = C.smoke_cloud_3_anim_id;
  set_alt_sprite_animation();
  anims(C.krool_shoot_anim_id, C.krool_gun_shoot_anim_id);
  reg.y = C.special_sprite_spawn_id_0180;
  spawn_special_sprite_index();
  init_krool_projectile_position();
  y = reg.y;
  wr(y, 0x2e, rd(y, 0x2e) | 0x0890);
  CODE_B6D923();
  x = reg.x;
  reg.a = rd(x, 0x12);
  const t = r16(0x0737);
  reg.x = t;
  if (reg.a & 0x4000) return CODE_B6BFB5();
  wr(y, 0x20, lda(t));
  reg.a = lda(t + 4);
  CODE_B6BFC6();
}

/** $B6BFB5 */
export function CODE_B6BFB5(): void {
  const t = reg.x;
  wr(reg.y, 0x20, neg(lda(t)));
  reg.a = neg(lda(t + 4));
  CODE_B6BFC6();
}

/** $B6BFC6 */
export function CODE_B6BFC6(): void {
  const t = reg.x;
  const y = reg.y;
  wr(y, 0x26, reg.a);
  wr(y, 0x42, lda(t + 8));
  wr(y, 0x44, lda(t + 0x0a));
  wr(y, 0x24, lda(t + 2));
  wr(y, 0x2a, lda(t + 6));
  w16(0x0729, lda(t + 0x10));
  wr(y, 0x46, lda(t + 0x0c));
  wr(y, 0x48, lda(t + 0x0e));
  reg.a = add(t, 0x0012);
  w16(0x0737, reg.a);
  reg.y = pop();
  reg.db = 0xb6;
  if (dec(0, 0x0727) === 0) {
    reg.x = cur();
    wr(reg.x, 0x44, 0);
  }
  CODE_B6C009();
}

/** $B6C009 */
export function CODE_B6C009(): void {}

/**
 * $B6C00A — command $2E (sprite, x, y, routine, smoke dx, smoke dy): spawn a sprite with a
 * smoke puff and run a setup routine on it (the DK barrel only once: $073B).
 */
export function boss_command_code_2E(): void {
  push(reg.y);
  reg.a = lda(reg.y);
  if (reg.a === DK_BARREL) {
    reg.y = r16(0x073b);
    if (reg.y !== 0) return CODE_B6C068();
  }
  CODE_B6C018();
}

/** $B6C018 */
export function CODE_B6C018(): void {
  w16(0x06a3, r16(0x06a3) & 0xfeff);
  reg.y = C.special_sprite_spawn_id_017C;
  spawn_special_sprite_index();
  let x = r16(R.alternate_sprite);
  reg.x = x;
  let y = peek();
  reg.y = y;
  wr(x, 0x06, add(lda(y + 2), lda(y + 8)));
  reg.a = add(lda(y + 4), lda(y + 0x0a));
  wr(x, 0x0a, reg.a);
  reg.a = C.smoke_cloud_4_anim_id;
  set_alt_sprite_animation();
  y = peek();
  reg.y = lda(y);
  spawn_special_sprite_address();
  x = r16(R.alternate_sprite);
  reg.x = x;
  y = peek();
  reg.y = y;
  wr(x, 0x06, lda(y + 2));
  reg.a = lda(y + 4);
  wr(x, 0x0a, reg.a);
  reg.x = y;
  jsrAddr(B6 | rom16(B6 | ((y + 6) & 0xffff)));
  reg.x = cur();
  CODE_B6C068();
}

/** $B6C068 */
export function CODE_B6C068(): void {
  wr(reg.x, 0x44, 0);
  reg.a = add(pop(), 0x000c);
  reg.y = reg.a;
}

/** $B6C071 — command $2D (target): goto target while there is no spikeball ($0735). */
export function boss_command_code_2D(): void {
  reg.a = r16(0x0735);
  if (reg.a !== 0) return CODE_B6C07D();
  reg.a = lda(reg.y);
  reg.y = reg.a;
  CODE_B6C07F();
}

/** $B6C07D */
export function CODE_B6C07D(): void {
  reg.y = (reg.y + 2) & 0xffff;
  CODE_B6C07F();
}

/** $B6C07F */
export function CODE_B6C07F(): void {
  wr(reg.x, 0x44, 0);
}

/** $B6C082 — command $2C: retract the spikeball (STP if there is none: a script error). */
export function boss_command_code_2C(): void {
  push(reg.y);
  wr(reg.x, 0x44, 0);
  reg.x = r16(0x0735);
  if (reg.x === 0) {
    io8(PPU.screen, 0x08);
    throw new Error("boss_command_code_2C: STP (no spikeball)");
  }
  CODE_B6C095();
}

/** $B6C095 */
export function CODE_B6C095(): void {
  w16(R.alternate_sprite, reg.x);
  reg.a = C.krool_spikeball_removed_anim_id;
  set_alt_sprite_animation();
  reg.y = pop();
}

/** Vacuum attack parameters for the current HP (K. Rool's second fight has its own table). */
function vacuumParams(): number {
  reg.y = (r16(0x0652) << 1) & 0xffff;
  reg.a = lda(VACUUM + reg.y);
  reg.x = r16(R.level_number);
  if (reg.x === C.level_krocodile_kore) reg.a = lda(VACUUM2 + reg.y);
  return reg.a;
}

/** $B6C0A0 — command $2B: vacuum attack (return code CODE_B6C122). */
export function boss_command_code_2B(): void {
  push(reg.y);
  vacuumParams();
  CODE_B6C0B4();
}

/** $B6C0B4 */
export function CODE_B6C0B4(): void {
  reg.y = reg.a;
  reg.a = lda(reg.y);
  w16(0x072d, reg.a);
  CODE_B6C0BC();
}

/** $B6C0BC — vacuum animations and the suction effect sprite. */
export function CODE_B6C0BC(): void {
  anims(C.krool_vacuum_anim_id, C.krool_gun_vacuum_anim_id);
  reg.y = C.special_sprite_spawn_id_00C8;
  spawn_special_sprite_index();
  reg.x = cur();
  reg.y = r16(R.alternate_sprite);
  w16(0x0739, reg.y);
  reg.a = rd(reg.x, 0x12) & 0x4000;
  if (reg.a !== 0) return CODE_B6C0ED();
  reg.a = rd(reg.y, 0x12) & 0xbfff;
  CODE_B6C0F3();
}

/** $B6C0ED */
export function CODE_B6C0ED(): void {
  reg.a = rd(reg.y, 0x12) | 0x4000;
  CODE_B6C0F3();
}

/** $B6C0F3 */
export function CODE_B6C0F3(): void {
  wr(reg.y, 0x12, reg.a);
  w16(0x0650, reg.a);
  CODE_B6C44F();
  reg.y = pop();
}

/** $B6C0FF — end the vacuum: delete the effect, stop the looping sounds. */
export function CODE_B6C0FF(): void {
  w16(R.current_sprite, r16(0x0739));
  delete_sprite_handle_deallocation();
  reg.a = snd(7, "krool_suck_whoosh");
  reg.c = false;
  queue_or_reset_looping_sound_effect();
  reg.a = snd(4, "krool_suck_vroom");
  reg.c = false;
  queue_or_reset_looping_sound_effect();
  reg.x = r16(0x0654);
  w16(R.current_sprite, reg.x);
  w16(0x0739, 0);
}

/** $B6C122 — vacuum: pull the Kong; caught in front of the gun: the melee hit. */
export function CODE_B6C122(): void {
  if (dec(0, 0x072d) === 0) return CODE_B6C12A();
  CODE_B6C1A4();
}

/** $B6C12A — time over. */
export function CODE_B6C12A(): void {
  w16(0x06a3, r16(0x06a3) | 0x0100);
  reg.x = cur();
  wr(reg.x, 0x44, 0);
  anims(C.krool_idle_anim_id, C.krool_gun_idle_anim_id);
  CODE_B6C0FF();
  CODE_B6C20A();
}

/** $B6C153 — the Kong was sucked in: knock him away with the gun. */
export function CODE_B6C153(): void {
  w16(0x06a3, r16(0x06a3) | 0x0100);
  w16(0x072d, 0);
  CODE_B6C0FF();
  reg.y = r16(R.active_kong_sprite);
  reg.a = rd(reg.y, 0x30);
  if (!(reg.a & 0x0080)) {
    reg.a = C.player_interaction_1F;
    set_player_interaction_global();
    if (!reg.c) {
      reg.x = r16(0x0654);
      reg.a = (rd(reg.x, 0x12) & 0x4000) ^ 0x4000;
      w16(R.interaction_RAM_0A86, reg.a);
    }
  }
  CODE_B6C186();
}

/** $B6C186 */
export function CODE_B6C186(): void {
  anims(C.krool_melee_anim_id, C.krool_gun_melee_anim_id);
  reg.x = cur();
  reg.a = C20B;
  wr(reg.x, 0x44, reg.a);
  CODE_B6C20A();
}

/** $B6C1A4 — keep the suction sounds looping; check whether the Kong is at the muzzle. */
export function CODE_B6C1A4(): void {
  reg.a = snd(7, "krool_suck_whoosh");
  reg.c = true;
  queue_or_reset_looping_sound_effect();
  reg.a = snd(4, "krool_suck_vroom");
  reg.c = true;
  queue_or_reset_looping_sound_effect();
  const x = cur();
  reg.x = x;
  reg.y = r16(R.active_kong_sprite);
  reg.a = rd(x, 0x12);
  if (reg.a & 0x4000) return CODE_B6C1CD();
  reg.a = add(xpos(x), 0x002a);
  if (ge(reg.a, xpos(reg.y))) return CODE_B6C153();
  CODE_B6C1DB();
}

/** $B6C1CD */
export function CODE_B6C1CD(): void {
  reg.a = sub(xpos(reg.x), 0x002a);
  if (ge(reg.a, xpos(reg.y))) return CODE_B6C1DB();
  CODE_B6C153();
}

/** $B6C1DB — pull the Kong with a random jitter. */
export function CODE_B6C1DB(): void {
  vacuumParams();
  CODE_B6C1EE();
}

/** $B6C1EE */
export function CODE_B6C1EE(): void {
  const p = reg.a;
  reg.y = p;
  reg.a = lda(p + 4);
  push(p);
  reg.y = reg.a;
  get_random_number_2_global();
  if (reg.a & 0x8000) reg.y = neg(reg.y);
  CODE_B6C200();
}

/** $B6C200 */
export function CODE_B6C200(): void {
  reg.a = reg.y;
  reg.y = pop();
  reg.a = add(reg.a, lda(reg.y + 2));
  CODE_B3E3AF();
  CODE_B6C20A();
}

/** $B6C20A */
export function CODE_B6C20A(): void {}

/** $B6C20B — return code that never ends (the melee animation's callback changes $44). */
export function CODE_B6C20B(): void {}

/** $B6C20C — command $2A: K. Rool's shots for the current HP (return code CODE_B6C256). */
export function boss_command_code_2A(): void {
  push(reg.y);
  w16(0x06a3, r16(0x06a3) & 0xfeff);
  reg.y = r16(0x0652);
  CODE_B6D923();
  reg.a = lda(SHOT_COUNTS + reg.y) & 0x00ff;
  w16(0x0727, reg.a);
  w16(0x0729, 0x0001);
  reg.y = (r16(0x0652) << 1) & 0xffff;
  reg.a = lda(SHOTS + reg.y);
  w16(0x0737, reg.a);
  reg.db = 0xb6;
  reg.y = pop();
}

/** $B6C256 — fire one shot of the HP's projectile type when the delay runs out. */
export function CODE_B6C256(): void {
  if (dec(0, 0x0729) !== 0) return CODE_B6C28E();
  CODE_B6C25E();
}

/** $B6C25E */
export function CODE_B6C25E(): void {
  CODE_B6C28F();
  reg.a = C.smoke_cloud_5_anim_id;
  set_alt_sprite_animation();
  anims(C.krool_shoot_anim_id, C.krool_gun_shoot_anim_id);
  reg.x = (r16(0x0652) << 1) & 0xffff;
  jsrAddr(B6 | rom16(B6 | ((PROJECTILE_TYPES + reg.x) & 0xffff)));
  if (dec(0, 0x0727) === 0) {
    reg.x = cur();
    wr(reg.x, 0x44, 0);
  }
  CODE_B6C28E();
}

/** $B6C28E */
export function CODE_B6C28E(): void {}

/** $B6C28F — the gun's muzzle smoke puff (moves away from K. Rool). */
export function CODE_B6C28F(): void {
  reg.y = C.special_sprite_spawn_id_017C;
  spawn_special_sprite_index();
  reg.y = r16(R.alternate_sprite);
  reg.x = cur();
  reg.a = rd(reg.x, 0x12);
  if (reg.a & 0x4000) return CODE_B6C2AF();
  wr(reg.y, 0x20, 0x0100);
  reg.a = add(xpos(reg.x), 0x0028);
  CODE_B6C2BB();
}

/** $B6C2AF */
export function CODE_B6C2AF(): void {
  wr(reg.y, 0x20, 0xff00);
  reg.a = sub(xpos(reg.x), 0x0028);
  CODE_B6C2BB();
}

/** $B6C2BB */
export function CODE_B6C2BB(): void {
  const x = reg.x;
  const y = reg.y;
  wr(y, 0x06, reg.a);
  wr(y, 0x0a, add(rd(x, 0x0a), 0xffe4));
  wr(y, 0x2a, 0xfe80);
  wr(y, 0x42, 0x0004);
  reg.a = 0x0006;
  wr(y, 0x44, 0x0006);
}

/** $B6C2DA — command $29 (speed, interpolation): K. Rool's dash (return code CODE_B6C36C). */
export function boss_command_code_29(): void {
  push(reg.y);
  const x = reg.x;
  wr(x, 0x24, 0);
  wr(x, 0x2a, 0);
  w16(0x0723, lda(reg.y + 2));
  reg.a = rd(x, 0x12);
  if (reg.a & 0x4000) return CODE_B6C2FE();
  w16(0x0725, 0x0240);
  wr(x, 0x20, 0x0081);
  reg.a = lda(reg.y);
  CODE_B6C311();
}

/** $B6C2FE */
export function CODE_B6C2FE(): void {
  w16(0x0725, 0x015a);
  wr(reg.x, 0x20, 0xff7f);
  reg.a = neg(lda(reg.y));
  CODE_B6C311();
}

/** $B6C311 */
export function CODE_B6C311(): void {
  wr(reg.x, 0x26, reg.a);
  w16(0x0721, 0x0012);
  anims(C.krool_dash_anim_id, C.krool_gun_dash_anim_id);
  reg.y = C.special_sprite_spawn_id_00C6;
  spawn_special_sprite_index();
  reg.x = cur();
  reg.y = r16(R.alternate_sprite);
  w16(0x072b, reg.y);
  wr(reg.y, 0x42, 0);
  reg.a = rd(reg.x, 0x12) & 0x4000;
  if (reg.a === 0) return CODE_B6C351();
  reg.a = rd(reg.y, 0x12) & 0xbfff;
  CODE_B6C357();
}

/** $B6C351 */
export function CODE_B6C351(): void {
  reg.a = rd(reg.y, 0x12) | 0x4000;
  CODE_B6C357();
}

/** $B6C357 */
export function CODE_B6C357(): void {
  wr(reg.y, 0x12, reg.a);
  w16(0x0650, reg.a);
  w16(0x072F, 0x000a);
  reg.a = add(pop(), 0x0004);
  reg.y = reg.a;
}

/** $B6C36C — the dash: accelerate, brake near the wall ($0725), dust puffs. */
export function CODE_B6C36C(): void {
  reg.x = cur();
  reg.a = r16(0x0721);
  if (reg.a !== 0) {
    if (dec(0, 0x0721) !== 0) return CODE_B6C386();
    reg.y = r16(0x0654);
    reg.x = r16(0x072b);
    reg.a = rd(reg.y, 0x1c);
    wr(reg.x, 0x1c, reg.a);
  }
  CODE_B6C389();
}

/** $B6C386 */
export function CODE_B6C386(): void {
  CODE_B6C435();
}

/** $B6C389 */
export function CODE_B6C389(): void {
  reg.a = r16(0x0723);
  interpolate_x_velocity_global();
  apply_position_from_velocity_global();
  const x = cur();
  reg.x = x;
  reg.y = xpos(x);
  reg.a = rd(x, 0x20);
  if (reg.a & 0x8000) return CODE_B6C3A9();
  if (!ge(reg.a, 0x0080)) return CODE_B6C3BE();
  if (!ge(reg.y, r16(0x0725))) return CODE_B6C3FC();
  CODE_B6C3B3();
}

/** $B6C3A9 */
export function CODE_B6C3A9(): void {
  if (ge(reg.a, 0xff80)) return CODE_B6C3BE();
  if (ge(reg.y, r16(0x0725))) return CODE_B6C3FC();
  CODE_B6C3B3();
}

/** $B6C3B3 — reached the wall: brake. */
export function CODE_B6C3B3(): void {
  wr(reg.x, 0x26, 0);
  w16(0x0723, 0x000a);
  CODE_B6C435();
}

/** $B6C3BE — stopped: end of the dash. */
export function CODE_B6C3BE(): void {
  const x = reg.x;
  wr(x, 0x20, 0);
  wr(x, 0x04, 0);
  wr(x, 0x44, 0);
  reg.x = r16(0x072b);
  w16(R.current_sprite, reg.x);
  delete_sprite_handle_deallocation();
  w16(R.current_sprite, r16(0x0654));
  w16(0x072b, 0);
  w16(R.alternate_sprite, r16(0x0654));
  reg.a = C.krool_dash_end_anim_id;
  set_alt_sprite_animation();
  w16(R.alternate_sprite, r16(0x0656));
  reg.a = C.krool_gun_dash_end_anim_id;
  set_alt_sprite_animation();
  reg.a = snd(7, "krool_exhaust");
  reg.c = false;
  queue_or_reset_looping_sound_effect();
  reg.x = cur();
  CODE_B6C435();
}

/** $B6C3FC — dashing: exhaust sound, a dust puff every 15 frames. */
export function CODE_B6C3FC(): void {
  reg.a = snd(7, "krool_exhaust");
  reg.c = true;
  queue_or_reset_looping_sound_effect();
  reg.x = cur();
  if (dec(0, 0x072f) !== 0) return CODE_B6C435();
  w16(0x072f, 0x000f);
  reg.a = rd(reg.x, 0x12);
  if (reg.a & 0x4000) return CODE_B6C41E();
  reg.y = lo("DATA_FF214A");
  CODE_B6C421();
}

/** $B6C41E */
export function CODE_B6C41E(): void {
  reg.y = lo("DATA_FF2162");
  CODE_B6C421();
}

/** $B6C421 */
export function CODE_B6C421(): void {
  spawn_no_gfx_special_sprite_address();
  reg.y = r16(R.alternate_sprite);
  reg.x = cur();
  reg.a = rd(reg.x, 0x20);
  if (!(reg.a & 0x8000)) return CODE_B6C431();
  reg.a = (reg.a >> 1) | 0x8000;
  CODE_B6C432();
}

/** $B6C431 */
export function CODE_B6C431(): void {
  reg.a = (reg.a & 0xffff) >> 1;
  CODE_B6C432();
}

/** $B6C432 */
export function CODE_B6C432(): void {
  wr(reg.y, 0x20, reg.a);
  CODE_B6C435();
}

/** $B6C435 — the gun and the dust follow K. Rool. */
export function CODE_B6C435(): void {
  const x = reg.x;
  reg.y = r16(0x0656);
  CODE_B6C44F();
  const y = r16(0x072b);
  reg.y = y;
  if (y !== 0) {
    wr(y, 0x06, xpos(x));
    reg.a = add(rd(x, 0x0a), rd(y, 0x42));
    wr(y, 0x0a, reg.a);
  }
  CODE_B6C44E();
}

/** $B6C44E */
export function CODE_B6C44E(): void {}

/** $B6C44F — sprite Y takes the position of sprite X. */
export function CODE_B6C44F(): void {
  wr(reg.y, 0x06, xpos(reg.x));
  reg.a = rd(reg.x, 0x0a);
  wr(reg.y, 0x0a, reg.a);
}

/** $B6C45A — command $28 (time): wait (return code CODE_B6C464). */
export function boss_command_code_28(): void {
  reg.a = lda(reg.y);
  w16(0x0721, reg.a);
  reg.y = (reg.y + 2) & 0xffff;
}

/** $B6C464 — count down $0721 (0 or negative: done at once). */
export function CODE_B6C464(): void {
  reg.a = r16(0x0721);
  if (reg.a === 0 || reg.a & 0x8000) return CODE_B6C471();
  if (dec(0, 0x0721) !== 0) return CODE_B6C473();
  CODE_B6C471();
}

/** $B6C471 */
export function CODE_B6C471(): void {
  wr(reg.x, 0x44, 0);
  CODE_B6C473();
}

/** $B6C473 */
export function CODE_B6C473(): void {}

/** $B6C474 — command $26 (target x, target y, speed table): fly to a point, speed by HP. */
export function boss_command_code_26(): void {
  push(reg.y);
  CODE_B6C59D();
  wr(reg.x, 0x4a, reg.a);
  reg.y = add((r16(0x0652) << 1) & 0xffff, lda(reg.y + 4));
  reg.a = lda(reg.y);
  CODE_B6CB9D();
}

/** $B6C48A — command $27 (0 = face right, else left): King Zing turns if needed. */
export function boss_command_code_27(): void {
  push(reg.y);
  reg.a = lda(reg.y);
  if (reg.a !== 0) return CODE_B6C49D();
  reg.a = rd(reg.x, 0x12);
  if (reg.a & 0x4000) CODE_BA9480();
  CODE_B6C4A8();
}

/** $B6C49D */
export function CODE_B6C49D(): void {
  reg.a = rd(reg.x, 0x12);
  if (!(reg.a & 0x4000)) CODE_BA9480();
  CODE_B6C4A8();
}

/** $B6C4A8 */
export function CODE_B6C4A8(): void {
  wr(reg.x, 0x44, 0);
  reg.y = (pop() + 2) & 0xffff;
}

/** $B6C4AE — command $25: Krow-style turn toward the Kong. */
export function boss_command_code_25(): void {
  push(reg.y);
  reg.y = r16(R.active_kong_sprite);
  reg.a = xpos(reg.x);
  if (ge(reg.a, xpos(reg.y))) return CODE_B6C4C5();
  reg.a = rd(reg.x, 0x12);
  if (reg.a & 0x4000) CODE_B6CB2E();
  CODE_B6C4CF();
}

/** $B6C4C5 */
export function CODE_B6C4C5(): void {
  reg.a = rd(reg.x, 0x12);
  if (!(reg.a & 0x4000)) CODE_B6CB2E();
  CODE_B6C4CF();
}

/** $B6C4CF */
export function CODE_B6C4CF(): void {
  wr(reg.x, 0x44, 0);
  reg.y = pop();
}

/** $B6C4D3 — command $24 (WRAM address): set bit 5 of a WRAM word. */
export function boss_command_code_24(): void {
  const db = reg.db;
  const a = lda(reg.y);
  reg.x = a;
  reg.a = r16(0x7e0000 | a) | 0x0020;
  w16(0x7e0000 | a, reg.a);
  reg.x = r16(0x0654);
  wr(reg.x, 0x44, 0);
  reg.y = (reg.y + 2) & 0xffff;
  reg.db = db;
}

/** $B6C4F1 — command $23: the barrel Kreepy Krow holds ($0707) breaks. */
export function boss_command_code_23(): void {
  push(reg.y);
  reg.y = r16(0x0707);
  if (reg.y !== 0) {
    wr(reg.y, 0x32, 0x0200);
    w16(0x0707, 0);
  }
  CODE_B6C500();
}

/** $B6C500 */
export function CODE_B6C500(): void {
  wr(reg.x, 0x44, 0);
  reg.y = pop();
}

/** $B6C504 — command $21 (y): wait until the Kong climbs above y (return code CODE_B6C50E). */
export function boss_command_code_21(): void {
  reg.a = lda(reg.y);
  w16(0x0705, reg.a);
  reg.y = (reg.y + 2) & 0xffff;
}

/** $B6C50E */
export function CODE_B6C50E(): void {
  reg.y = r16(R.active_kong_sprite);
  reg.a = r16(0x0705);
  if (ge(reg.a, rd(reg.y, 0x0a))) {
    reg.x = cur();
    wr(reg.x, 0x44, 0);
  }
  CODE_B6C51E();
}

/** $B6C51E */
export function CODE_B6C51E(): void {}

/** $B6C51F — command $22: set $2E bit 13. */
export function boss_command_code_22(): void {
  reg.x = cur();
  wr(reg.x, 0x2e, rd(reg.x, 0x2e) | 0x2000);
  wr(reg.x, 0x44, 0);
}

/** $B6C52B — command $20 (hook list): Kreepy Krow's hooks drop in (unless he is dead). */
export function boss_command_code_20(): void {
  reg.a = r16(0x0652);
  if (!ge(reg.a, 0x0001)) return CODE_B6C58C();
  CODE_B6C537();
}

/** $B6C537 */
export function CODE_B6C537(): void {
  push(reg.y);
  reg.y = lda(reg.y);
  w16(0x0650, lda(reg.y));
  CODE_B6C543();
}

/** $B6C543 */
export function CODE_B6C543(): void {
  do {
    const y = reg.y;
    reg.y = lo("DATA_FF1DC8");
    spawn_no_gfx_special_sprite_address();
    reg.y = y;
    const x = r16(R.alternate_sprite);
    reg.x = x;
    wr(x, 0x4e, 0);
    wr(x, 0x06, lda(y + 2));
    wr(x, 0x0a, sub(r16(R.screen_scroll_y_position), 0x0040));
    wr(x, 0x46, lda(y + 4));
    wr(x, 0x12, (rd(x, 0x12) & 0xcfff) | 0x3000);
    reg.y = (y + 4) & 0xffff;
    wr(x, 0x44, 0);
  } while (dec(0, 0x0650) !== 0);
  reg.x = r16(0x0654);
  wr(reg.x, 0x2e, rd(reg.x, 0x2e) & 0xdfff);
  reg.a = snd(5, "hooks_appear");
  queue_sound_effect();
  reg.x = cur();
  reg.y = pop();
  CODE_B6C58C();
}

/** $B6C58C */
export function CODE_B6C58C(): void {
  wr(reg.x, 0x44, 0);
  reg.y = (reg.y + 2) & 0xffff;
}

/** $B6C591 — command $1F (offset): $06FF, added to the speed of command $1E. */
export function boss_command_code_1F(): void {
  reg.a = lda(reg.y);
  w16(0x06ff, reg.a);
  wr(reg.x, 0x44, 0);
  reg.y = (reg.y + 2) & 0xffff;
}

/** $B6C59D — flying to a point: $2E bit 6, target x in $48, A = target y. */
export function CODE_B6C59D(): void {
  reg.x = cur();
  wr(reg.x, 0x2e, rd(reg.x, 0x2e) | 0x0040);
  wr(reg.x, 0x48, lda(reg.y));
  reg.a = lda(reg.y + 2);
}

/** $B6C5AF — command $1E (x, y, speed): fly to a point, target y + $06FF. */
export function boss_command_code_1E(): void {
  push(reg.y);
  CODE_B6C59D();
  reg.a = add(reg.a, r16(0x06ff));
  CODE_B6CB89();
}

/** $B6C5BB — command $1D (count, spawn table): a wave of mini-neckys for the current phase. */
export function boss_command_code_1D(): void {
  const x = cur();
  reg.x = x;
  wr(x, 0x2e, rd(x, 0x2e) | 0x0001);
  const db = reg.db;
  reg.db = MINI_NECKY_WAVES_BANK;
  const i = ((r16(0x0652) - 1) << 2) & 0xffff;
  w16(0x06f3, lda(MINI_NECKY_WAVES + i));
  w16(0x06f7, lda(MINI_NECKY_WAVES + 2 + i));
  reg.db = db;
  reg.x = x;
  w16(0x06fb, 0);
  w16(0x06f9, lda(reg.y));
  w16(0x06fd, lda(reg.y + 2));
  w16(0x06f5, 0);
  w16(0x0658, 0);
  wr(x, 0x44, 0);
  reg.a = add(reg.y, 0x0004);
  reg.y = reg.a;
}

/** $B6C64F — command $17: Krow's egg-throw cleanup (CODE_B6F8F3). */
export function boss_command_code_17(): void {
  push(reg.y);
  CODE_B6F8F3();
  wr(reg.x, 0x44, 0);
  reg.y = pop();
}

/** $B6C994 — command $01 (unused, body anim, head anim): Krow turns. */
export function boss_command_code_01(): void {
  const y0 = reg.y;
  push(y0);
  w16(0x065c, lda(y0));
  w16(0x065e, lda(y0 + 2));
  const x = cur();
  reg.x = x;
  wr(x, 0x2e, rd(x, 0x2e) | 0x0002);
  wr(x, 0x1e, C.krow_body_turn_anim_id);
  wr(x, 0x44, 0);
  reg.y = rd(x, 0x42);
  wr(reg.y, 0x1e, C.krow_head_turn_anim_id);
  wr(x, 0x44, 0);
  reg.a = add(pop(), 0x0004);
  reg.y = reg.a;
}

registerRtl({ execute_boss_return_command, execute_boss_command });
registerRts({
  boss_command_return, boss_command_code_49, CODE_B6B7FE, boss_command_code_48, CODE_B6B874,
  CODE_B6B87C, CODE_B6B8BC, boss_command_code_47, boss_command_code_46, CODE_B6B923, CODE_B6B937,
  boss_command_code_45, CODE_B6B953, CODE_B6B967, CODE_B6B977, CODE_B6B982, boss_command_code_44,
  CODE_B6B9BB, CODE_B6B9F3, CODE_B6BA1F, CODE_B6BA3F, CODE_B6BA4A, CODE_B6BA93, boss_command_code_42,
  CODE_B6BAAB, CODE_B6BAAD, CODE_B6BAB0, boss_command_code_43, boss_command_code_41, CODE_B6BACA,
  CODE_B6BACD, CODE_B6BAD8, CODE_B6BAE5, CODE_B6BAEC, CODE_B6BAF2, boss_command_code_40, CODE_B6BB2B,
  CODE_B6BB36, CODE_B6BB68, boss_command_code_3F, CODE_B6BB8E, boss_command_code_3E,
  boss_command_code_3D, make_boss_face_kong, boss_command_code_3C, boss_command_code_3B, CODE_B6BC37,
  CODE_B6BC3E, CODE_B6BC49, CODE_B6BC5F, CODE_B6BC69, CODE_B6BC77, boss_command_code_3A, CODE_B6BC8A,
  CODE_B6BC8F, CODE_B6BC91, CODE_B6BCC8, CODE_B6BCCF, CODE_B6BCDD, CODE_B6BCE9, CODE_B6BD32,
  CODE_B6BD6F, boss_command_code_38, CODE_B6BD78, boss_command_code_39, boss_command_code_37,
  CODE_B6BDA4, CODE_B6BDBF, CODE_B6BDE1, boss_command_code_36, CODE_B6BDF6, CODE_B6BDFD,
  boss_command_code_35, boss_command_code_34, CODE_B6BE1C, CODE_B6BE2D, CODE_B6BE3E, CODE_B6BE5E,
  CODE_B6BE68, turn_boss_and_child_sprite, turn_sprite_B6, boss_command_code_33, CODE_B6BEAF,
  CODE_B6BEB2, boss_command_code_31, CODE_B6BECF, boss_command_code_32, boss_command_code_30,
  boss_command_code_2F, CODE_B6BF11, CODE_B6BF19, CODE_B6BF45, CODE_B6BF51, CODE_B6BFB5, CODE_B6BFC6,
  CODE_B6C009, boss_command_code_2E, CODE_B6C018, CODE_B6C068, boss_command_code_2D, CODE_B6C07D,
  CODE_B6C07F, boss_command_code_2C, CODE_B6C095, boss_command_code_2B, CODE_B6C0B4, CODE_B6C0BC,
  CODE_B6C0ED, CODE_B6C0F3, CODE_B6C0FF, CODE_B6C122, CODE_B6C12A, CODE_B6C153, CODE_B6C186,
  CODE_B6C1A4, CODE_B6C1CD, CODE_B6C1DB, CODE_B6C1EE, CODE_B6C200, CODE_B6C20A, CODE_B6C20B,
  boss_command_code_2A, CODE_B6C256, CODE_B6C25E, CODE_B6C28E, CODE_B6C28F, CODE_B6C2AF, CODE_B6C2BB,
  boss_command_code_29, CODE_B6C2FE, CODE_B6C311, CODE_B6C351, CODE_B6C357, CODE_B6C36C, CODE_B6C386,
  CODE_B6C389, CODE_B6C3A9, CODE_B6C3B3, CODE_B6C3BE, CODE_B6C3FC, CODE_B6C41E, CODE_B6C421,
  CODE_B6C431, CODE_B6C432, CODE_B6C435, CODE_B6C44E, CODE_B6C44F, boss_command_code_28, CODE_B6C464,
  CODE_B6C471, CODE_B6C473, boss_command_code_26, boss_command_code_27, CODE_B6C49D, CODE_B6C4A8,
  boss_command_code_25, CODE_B6C4C5, CODE_B6C4CF, boss_command_code_24, boss_command_code_23,
  CODE_B6C500, boss_command_code_21, CODE_B6C50E, CODE_B6C51E, boss_command_code_22,
  boss_command_code_20, CODE_B6C537, CODE_B6C543, CODE_B6C58C, boss_command_code_1F, CODE_B6C59D,
  boss_command_code_1E, boss_command_code_1D, boss_command_code_17, boss_command_code_01,
});
