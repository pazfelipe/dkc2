/**
 * Bank $BA — King Zing (King Zing Sting, world 3 boss) and his parts: the ring of zingers he
 * summons once he has shrunk, the smoke puffs, the stinger (the only weak spot: Squawks' eggs
 * bounce off it) and the spikes he shoots. Also the bank's first sprite main handler (King Zing,
 * Kreepy Krow) and the interpreter entry that runs boss command scripts from bank $BA.
 *
 * King Zing RAM (besides the boss block of b6ba_common): $0652 HP (9; at 3 he shrinks, at 0 he
 * dies), $0654 body, $0656 stinger, $0658 smoke parent, $0709 hurt/invincibility timer,
 * $070B, $070D/$070F spike shot countdown/period, $0711-$0715 palette cycles, $0717 countdown
 * before the ring zingers come, $071D countdown before the stinger is removed, $071F "a ring
 * zinger still lives" (set by every live ring zinger each frame), $0755/$0757 stinger palette
 * cycle timer/pointer (after death: countdown to the level end), $0765 bonk cooldown.
 * Body sprite: $2E flags (bit 0 hurt flight, 1 turning, 2 hurt by a ring zinger hit, 7 turn
 * pending, 9 hurt, 10 small shake, 12 hurt, 13 spike direction toggle, 14 shrinking, 15 dead),
 * $20-$2A movement (damage shake: $20 pointer, $22 end, $24/$26 counter/period).
 */
import { r16, w16 } from "../../core/mem";
import { reg } from "../../core/cpu";
import { R, C, sprite_table } from "../../core/sym";
import {
  CODE_B4AEAF, spawn_special_sprite_index, parse_boss_command, set_sprite_palette_direct_global,
  CODE_B6D82B, get_current_sprite_clipping, check_complex_player_collision_B6, delete_sprite_handle_deallocation,
  set_sprite_animation, CODE_B6ADF1, CODE_B6ADC6, execute_boss_return_command, process_sprite_animation,
  queue_sound_effect, spawn_no_gfx_special_sprite_address, set_alt_sprite_animation, CODE_B6D7F0,
  interpolate_x_velocity_global, interpolate_y_velocity_global, apply_position_from_velocity_global,
  turn_sprite_B6_2_global, set_current_level_as_cleared, set_player_interaction_global,
  spawn_special_sprite_address, request_sprite_palette_global, move_child_to_controller_spr_global,
  check_throwable_collision_global, defeat_sprite_using_anim_global, process_current_movement,
  check_if_sprite_offscreen_global, delete_sprite_no_deallocation, CODE_B6E736, CODE_B6FE9E,
  set_sprite_palette_global, process_terrain_interaction_global, check_for_sprite_collisions,
  execute_boss_command,
} from "../../gen/routines";
import { cur, rd, wr, inc, dec, neg, snd, cmpMi, spriteTail, registerSprite, registerRts, registerRtl } from "../b6/b6ba_common";
import { lda, lo, bank, Stack, ge, add } from "../b6/w4_b6_util";
import { rom16 } from "../../core/mem";
import { L } from "../../core/sym";

void parse_boss_command;

const MAIN_TABLE = (L("bank_BA_sprite_main_handler_1") + 6) & 0xffff;
const KZ_COMMANDS = lo("king_zing_boss_commands_table");
const STINGER_PALETTES = lo("king_zing_stinger_palette_table");
const DAMAGE_PALETTES = lo("king_zing_damage_palette_table");
const YELLOW = lo("zinger_yellow_sprite_palette");
const RED = lo("zinger_red_sprite_palette");
const PATTERNS = lo("king_zing_pattern_table");
const PATTERN_BANK = bank("king_zing_pattern_table");
const SPIKE_SHOT = lo("DATA_FF1EAA");
const SMOKE = lo("DATA_FF1EC8");
const SMOKE_PUFF = lo("DATA_FF16BA");
const BIG_SHAKE = lo("big_king_zing_damage_pos_offsets");
const SMALL_SHAKE = lo("small_king_zing_damage_pos_offsets");
const SMALL_SHAKE_END = lo("DATA_BA9736");
const B6CEA7 = lo("CODE_B6CEA7");
const B6AF3E = lo("CODE_B6AF3E");
const BA9324 = lo("CODE_BA9324");
const SMOKE_LARGE_SET = lo("DATA_BA98E6");
const SMOKE_MEDIUM_SET = lo("DATA_BA9918");
const STINGER_CLIP = lo("DATA_BA99A7");
const CMD_TABLE = lo("boss_commands_table");

const stk = new Stack();
let zingDB = 0;
let stingerDB = 0;

/** $BA9000 — `TAX : PHK : PLB : JMP (.main_table,x)`: King Zing and Kreepy Krow sprite mains. */
export function bank_BA_sprite_main_handler_1(): void {
  reg.x = reg.a & 0xffff;
  reg.db = 0xba;
  spriteTail(0xba0000 | rom16(0xba0000 | ((MAIN_TABLE + reg.x) & 0xffff)));
}

/**
 * $BA9016 — sprite collision check that also tags the hit sprite: on a hit, ORs Y into its $32
 * and stores in its $34 the hitter's slot offset with the direction bits (bit 15 from $20,
 * bit 14 = facing). Carry = hit.
 */
export function check_sprite_collision_BA(): void {
  w16(0x5e, reg.y);
  check_for_sprite_collisions();
  const x = cur();
  reg.x = x;
  if (!reg.c) return;
  const y = r16(R.colliding_sprite);
  reg.y = y;
  wr(y, 0x32, r16(0x5e) | rd(y, 0x32));
  let a = (((rd(x, 0x12) ^ rd(x, 0x20)) & 0x4000) ^ rd(x, 0x20)) & 0xc000;
  a = (a + x - sprite_table.slot_0) & 0xffff;
  wr(y, 0x34, a);
  reg.a = a;
  reg.c = true;
}

/** $BA9042 — DB = bank of king_zing_pattern_table. */
export function set_king_zing_pattern_bank(): void {
  reg.db = PATTERN_BANK;
}

/** $BA9048 — King Zing's body. First frame: set up the fight and spawn the stinger. */
export function king_zing_sprite_code(): void {
  zingDB = reg.db;
  reg.db = 0xba;
  let x = cur();
  reg.x = x;
  if (rd(x, 0x42) === 0) {
    CODE_B4AEAF();
    x = reg.x;
    w16(0x0765, 0);
    wr(x, 0x32, 0);
    w16(0x06a1, 0);
    w16(0x06a3, 0);
    w16(0x06a5, 0);
    w16(0x065a, KZ_COMMANDS);
    w16(0x0652, 0x0009);
    w16(0x070b, 0x0002);
    reg.y = C.special_sprite_spawn_id_00A0;
    spawn_special_sprite_index();
    const stinger = r16(R.alternate_sprite);
    x = cur();
    reg.x = x;
    w16(0x0654, x);
    w16(0x0656, stinger);
    wr(x, 0x42, stinger);
    wr(x, 0x44, 0);
    w16(0x0755, 0x000a);
    w16(0x0757, STINGER_PALETTES);
    reg.a = STINGER_PALETTES;
    parse_boss_command_BA();
  }
  CODE_BA909F();
}

/** $BA909F */
export function CODE_BA909F(): void {
  reg.a = r16(0x0652);
  if (reg.a !== 0) return CODE_BA90A8();
  CODE_BA94CF();
}

/** $BA90A8 — alive: zinger buzz, hurt timer (back to yellow when it runs out). */
export function CODE_BA90A8(): void {
  w16(R.zinger_loop_sound_enabler, r16(R.zinger_loop_sound_enabler) + 1);
  reg.a = r16(0x0709);
  if (reg.a === 0) return CODE_BA90D5();
  if (dec(0, 0x0709) !== 0) return CODE_BA90D1();
  reg.a = YELLOW;
  set_sprite_palette_direct_global();
  let x = cur();
  wr(x, 0x2e, rd(x, 0x2e) & 0xfdff);
  wr(x, 0x32, 0);
  x = r16(0x0656);
  reg.x = x;
  if (x !== 0) wr(x, 0x32, 0);
  CODE_BA90D5();
}

/** $BA90D1 — still hurt: flash. */
export function CODE_BA90D1(): void {
  CODE_B6D82B();
  CODE_BA90D5();
}

/** $BA90D5 */
export function CODE_BA90D5(): void {
  const x = cur();
  reg.x = x;
  reg.a = rd(x, 0x2e);
  CODE_BA90D9();
}

/** $BA90D9 — A = flags: during the bonk cooldown skip the touch check. */
export function CODE_BA90D9(): void {
  if (reg.a & 0x0200) {
    reg.a = r16(0x0765);
    if (reg.a !== 0) {
      dec(0, 0x0765);
      return CODE_BA911F();
    }
  }
  CODE_BA9114();
}

/** $BA9114 — touching King Zing hurts the Kongs. */
export function CODE_BA9114(): void {
  get_current_sprite_clipping();
  reg.a = 0x0000;
  check_complex_player_collision_B6();
  CODE_BA911F();
}

/** $BA911F */
export function CODE_BA911F(): void {
  const x = cur();
  reg.x = x;
  reg.a = rd(x, 0x2e);
  if (!(reg.a & 0x4000)) return CODE_BA91C4();
  CODE_BA912B();
}

/** $BA912B — shrinking: after $0717 frames summon the four ring zingers. */
export function CODE_BA912B(): void {
  let x = reg.x;
  wr(x, 0x32, 0);
  reg.a = r16(0x0717);
  if (reg.a !== 0 && dec(0, 0x0717) === 0) {
    wr(x, 0x2e, rd(x, 0x2e) & 0xbfff);
    x = r16(0x0654);
    wr(x, 0x4e, 0x2800);
    wr(x, 0x4c, 0);
    const ring: [number, number][] = [[0x0000, 0x0001], [0x4000, 0x000f], [0x8000, 0x001e], [0xc000, 0x002d]];
    for (const [angle, delay] of ring) {
      reg.y = C.special_sprite_spawn_id_00C0;
      spawn_special_sprite_index();
      x = r16(R.alternate_sprite);
      reg.x = x;
      wr(x, 0x4a, angle);
      reg.a = delay;
      wr(x, 0x1e, delay);
    }
  }
  CODE_BA9192();
}

/** $BA9192 — then after $071D frames the stinger goes and the small King Zing remains. */
export function CODE_BA9192(): void {
  reg.a = r16(0x071d);
  if (reg.a !== 0 && dec(0, 0x071d) === 0) {
    w16(R.current_sprite, r16(0x0656));
    delete_sprite_handle_deallocation();
    w16(R.current_sprite, r16(0x0654));
    w16(0x0656, 0);
    reg.a = C.king_zing_small_idle_anim_id;
    set_sprite_animation();
    const x = cur();
    reg.x = x;
    reg.a = add(rd(x, 0x0a), 0xfff8);
    wr(x, 0x0a, reg.a);
  }
  CODE_BA91C1();
}

/** $BA91C1 */
export function CODE_BA91C1(): void {
  CODE_BA924E();
}

/** $BA91C4 — the big King Zing while hurt only runs his script. */
export function CODE_BA91C4(): void {
  const x = reg.x;
  reg.a = r16(0x0652);
  if (ge(reg.a, 0x0004)) {
    reg.a = rd(x, 0x2e);
    if (reg.a & 0x0200) return CODE_BA923C();
  }
  CODE_BA91D4();
}

/** $BA91D4 */
export function CODE_BA91D4(): void {
  reg.a = rd(reg.x, 0x2e);
  if (reg.a & 0x0400) {
    CODE_BA9697();
    return CODE_BA924E();
  }
  CODE_BA91E1();
}

/** $BA91E1 */
export function CODE_BA91E1(): void {
  if (reg.a & 0x0004) {
    CODE_B6ADF1();
    return CODE_BA91F1();
  }
  CODE_BA91EC();
}

/** $BA91EC */
export function CODE_BA91EC(): void {
  if (!(reg.a & 0x0001)) return CODE_BA923C();
  CODE_BA91F1();
}

/** $BA91F1 — chase the Kong. */
export function CODE_BA91F1(): void {
  reg.a = r16(0x0652);
  if (!ge(reg.a, 0x0004)) CODE_B6ADC6();
  CODE_BA91FE();
}

/** $BA91FE */
export function CODE_BA91FE(): void {
  CODE_BA9324();
  reg.a = r16(0x0652);
  if (ge(reg.a, 0x0004)) return CODE_BA924B();
  CODE_BA920D();
}

/** $BA920D — small King Zing: red while a ring zinger lives, hit when they are all gone. */
export function CODE_BA920D(): void {
  let x = cur();
  reg.x = x;
  reg.a = r16(0x0709);
  if (reg.a !== 0) return CODE_BA924B();
  reg.a = r16(0x071f);
  if (reg.a !== 0) return CODE_BA922F();
  reg.a = YELLOW;
  set_sprite_palette_direct_global();
  x = cur();
  reg.x = x;
  reg.a = rd(x, 0x32);
  if (reg.a !== 0) {
    wr(x, 0x32, 0);
    CODE_BA960F();
  }
  CODE_BA924B();
}

/** $BA922F */
export function CODE_BA922F(): void {
  const x = cur();
  reg.x = x;
  wr(x, 0x32, 0);
  reg.a = RED;
  set_sprite_palette_direct_global();
  CODE_BA924B();
}

/** $BA923C — run the current boss command; parse the next when it is done. */
export function CODE_BA923C(): void {
  reg.a = rd(reg.x, 0x44);
  execute_boss_return_command();
  const x = cur();
  reg.x = x;
  reg.a = rd(x, 0x44);
  if (reg.a === 0) parse_boss_command_BA();
  CODE_BA924B();
}

/** $BA924B */
export function CODE_BA924B(): void {
  CODE_BA9274();
  CODE_BA924E();
}

/** $BA924E — spin the ring, remember whether a ring zinger still lives. */
export function CODE_BA924E(): void {
  const x = cur();
  reg.x = x;
  wr(x, 0x4c, rd(x, 0x4c) + 0x0180);
  reg.a = r16(0x071f);
  if (reg.a === 0) {
    reg.a = r16(0x06a5) | 0x1000;
    w16(0x06a5, reg.a);
  }
  w16(0x071f, 0);
  CODE_BA926C();
}

/** $BA926C */
export function CODE_BA926C(): void {
  process_sprite_animation();
  reg.db = zingDB;
}

/** $BA9274 — toggle the spike direction; when the shot countdown runs out fire a volley. */
export function CODE_BA9274(): void {
  const x = cur();
  reg.x = x;
  reg.a = rd(x, 0x2e) ^ 0x2000;
  wr(x, 0x2e, reg.a);
  reg.a = r16(0x070d);
  if (reg.a === 0) return CODE_BA92F1();
  if (dec(0, 0x070d) !== 0) return CODE_BA92F1();
  reg.a = snd(7, "king_zing_spike_shot");
  queue_sound_effect();
  w16(0x070d, r16(0x070f));
  w16(0x0650, 0x0008);
  set_king_zing_pattern_bank();
  reg.y = (r16(0x0652) << 1) & 0xffff;
  reg.y = lda(PATTERNS + reg.y);
  reg.a = lda(reg.y + 0x0a);
  CODE_BA92AE();
}

/** $BA92AE — spawn the eight spikes of the volley (A = pointer to their data). */
export function CODE_BA92AE(): void {
  do {
    const p = reg.a;
    reg.y = SPIKE_SHOT;
    spawn_no_gfx_special_sprite_address();
    const y = r16(R.alternate_sprite);
    reg.y = y;
    reg.x = p;
    wr(y, 0x20, lda(p));
    wr(y, 0x24, lda(p + 2));
    wr(y, 0x26, lda(p + 4));
    wr(y, 0x2a, lda(p + 6));
    wr(y, 0x42, lda(p + 8));
    wr(y, 0x44, lda(p + 0x0a));
    reg.a = lda(p + 0x0c);
    set_alt_sprite_animation();
    reg.a = add(p, 0x000e);
  } while (dec(0, 0x0650) !== 0);
  reg.db = 0xba;
  CODE_BA92F1();
}

/** $BA92F1 */
export function CODE_BA92F1(): void {}

/** $BA92F2 */
export function CODE_BA92F2(): void {
  CODE_BA92F6();
}

/** $BA92F6 — start the hurt palette cycles. */
export function CODE_BA92F6(): void {
  w16(0x06ed, 0x0005);
  w16(0x0715, 0x0005);
  w16(0x06eb, DAMAGE_PALETTES);
  w16(0x0713, DAMAGE_PALETTES);
  w16(0x0711, STINGER_PALETTES);
  reg.a = STINGER_PALETTES;
}

/** $BA9324 — follow the Kong (or, at the end of the hurt flight, restart the script). */
export function CODE_BA9324(): void {
  const x = cur();
  reg.x = x;
  reg.a = r16(0x06e9);
  if (reg.a === 0) return CODE_BA935E();
  if (dec(0, 0x06e9) === 0) return CODE_BA9334();
  CODE_BA935E();
}

/** $BA9334 */
export function CODE_BA9334(): void {
  let x = r16(0x0656);
  wr(x, 0x32, 0);
  x = cur();
  reg.x = x;
  w16(0x0765, 0);
  wr(x, 0x2e, rd(x, 0x2e) & 0xfdfe);
  reg.a = YELLOW;
  set_sprite_palette_direct_global();
  w16(0x070d, 0);
  x = cur();
  reg.x = x;
  wr(x, 0x44, 0);
  wr(x, 0x46, KZ_COMMANDS);
  parse_boss_command_BA();
  CODE_BA9439();
}

/** $BA935E — horizontal: turn toward the Kong, steer while more than 16 px away. */
export function CODE_BA935E(): void {
  const x = reg.x;
  reg.y = r16(R.active_kong_sprite);
  reg.a = rd(x, 0x06);
  if (!ge(reg.a, rd(reg.y, 0x06))) return CODE_BA9399();
  if (!(rd(x, 0x2e) & 0x0002) && !(rd(x, 0x12) & 0x4000)) CODE_BA9484();
  CODE_BA937D();
}

/** $BA937D */
export function CODE_BA937D(): void {
  const x = reg.x;
  reg.y = r16(R.active_kong_sprite);
  reg.a = add(rd(x, 0x06), 0xfff0);
  if (ge(reg.a, rd(reg.y, 0x06))) return CODE_BA938F();
  wr(x, 0x26, 0);
  CODE_BA9397();
}

/** $BA938F */
export function CODE_BA938F(): void {
  reg.a = (-1 - rd(reg.x, 0x28)) & 0xffff;
  wr(reg.x, 0x26, reg.a);
  CODE_BA9397();
}

/** $BA9397 */
export function CODE_BA9397(): void {
  CODE_BA93C0();
}

/** $BA9399 */
export function CODE_BA9399(): void {
  const x = reg.x;
  if (!(rd(x, 0x2e) & 0x0002) && rd(x, 0x12) & 0x4000) CODE_BA9484();
  CODE_BA93AA();
}

/** $BA93AA */
export function CODE_BA93AA(): void {
  const x = reg.x;
  reg.y = r16(R.active_kong_sprite);
  reg.a = add(rd(x, 0x06), 0x0010);
  if (!ge(reg.a, rd(reg.y, 0x06))) return CODE_BA93BC();
  wr(x, 0x26, 0);
  CODE_BA93C0();
}

/** $BA93BC */
export function CODE_BA93BC(): void {
  reg.a = rd(reg.x, 0x28);
  wr(reg.x, 0x26, reg.a);
  CODE_BA93C0();
}

/** $BA93C0 — vertical: steer toward 10 px above the Kong. */
export function CODE_BA93C0(): void {
  const x = reg.x;
  reg.y = r16(R.active_kong_sprite);
  reg.a = add(rd(x, 0x0a), 0xfff6);
  if (!ge(reg.a, rd(reg.y, 0x0a))) return CODE_BA93EA();
  reg.y = r16(R.active_kong_sprite);
  reg.a = add(rd(x, 0x0a), 0xfff6);
  if (ge(reg.a, rd(reg.y, 0x0a))) return CODE_BA93E0();
  wr(x, 0x2a, 0);
  CODE_BA93E8();
}

/** $BA93E0 */
export function CODE_BA93E0(): void {
  reg.a = (-1 - rd(reg.x, 0x28)) & 0xffff;
  wr(reg.x, 0x2a, reg.a);
  CODE_BA93E8();
}

/** $BA93E8 */
export function CODE_BA93E8(): void {
  CODE_BA9400();
}

/** $BA93EA */
export function CODE_BA93EA(): void {
  const x = reg.x;
  reg.y = r16(R.active_kong_sprite);
  reg.a = add(rd(x, 0x0a), 0xfff7);
  if (!ge(reg.a, rd(reg.y, 0x0a))) return CODE_BA93FC();
  wr(x, 0x2a, 0);
  CODE_BA9400();
}

/** $BA93FC */
export function CODE_BA93FC(): void {
  reg.a = rd(reg.x, 0x28);
  wr(reg.x, 0x2a, reg.a);
  CODE_BA9400();
}

/** $BA9400 — add the hover wobble and move; the stinger follows. */
export function CODE_BA9400(): void {
  CODE_B6D7F0();
  let x = reg.x;
  wr(x, 0x26, rd(x, 0x26) + r16(0x06e5));
  reg.a = add(rd(x, 0x2a), r16(0x06e7));
  wr(x, 0x2a, reg.a);
  reg.a = rd(x, 0x22);
  interpolate_x_velocity_global();
  x = cur();
  reg.x = x;
  reg.a = rd(x, 0x22);
  interpolate_y_velocity_global();
  apply_position_from_velocity_global();
  x = cur();
  reg.x = x;
  const y = r16(0x0656);
  reg.y = y;
  if (y !== 0) {
    wr(y, 0x06, rd(x, 0x06));
    reg.a = rd(x, 0x0a);
    wr(y, 0x0a, reg.a);
  }
  CODE_BA9439();
}

/** $BA9439 */
export function CODE_BA9439(): void {}

/** $BA943A — finish a turn: flip body and stinger. */
export function CODE_BA943A(): void {
  turn_sprite_B6_2_global();
  reg.x = r16(0x0656);
  turn_sprite_B6_2_global();
  const x = r16(0x0654);
  reg.x = x;
  reg.a = rd(x, 0x2e) & 0xff7f;
  wr(x, 0x2e, reg.a);
}

/** $BA9450 — turn done: back to the idle animations. */
export function CODE_BA9450(): void {
  wr(reg.x, 0x2e, rd(reg.x, 0x2e) & 0xfffd);
  reg.a = r16(0x0652);
  if (!ge(reg.a, 0x0004)) {
    reg.a = 0x0240;
    return CODE_BA9468();
  }
  CODE_BA9465();
}

/** $BA9465 */
export function CODE_BA9465(): void {
  reg.a = C.king_zing_idle_anim_id;
  CODE_BA9468();
}

/** $BA9468 */
export function CODE_BA9468(): void {
  set_sprite_animation();
  const x = r16(0x0656);
  reg.x = x;
  if (x !== 0) {
    w16(R.current_sprite, x);
    reg.a = C.king_zing_stinger_idle_anim_id;
    set_sprite_animation();
    reg.x = r16(0x0654);
    w16(R.current_sprite, reg.x);
  }
  CODE_BA947F();
}

/** $BA947F */
export function CODE_BA947F(): void {}

/** $BA9480 */
export function CODE_BA9480(): void {
  CODE_BA9484();
}

/** $BA9484 — start turning around (body and stinger turn animations). */
export function CODE_BA9484(): void {
  stk.push(reg.y);
  const x = cur();
  reg.x = x;
  wr(x, 0x2e, rd(x, 0x2e) | 0x0080);
  w16(0x065c, rd(x, 0x36));
  reg.y = r16(0x0656);
  w16(0x065e, rd(reg.y, 0x36));
  wr(x, 0x2e, rd(x, 0x2e) | 0x0002);
  reg.a = r16(0x0652);
  if (!ge(reg.a, 0x0004)) {
    reg.a = C.king_zing_small_turn_anim_id;
    return CODE_BA94B6();
  }
  CODE_BA94B3();
}

/** $BA94B3 */
export function CODE_BA94B3(): void {
  reg.a = C.king_zing_turn_anim_id;
  CODE_BA94B6();
}

/** $BA94B6 */
export function CODE_BA94B6(): void {
  set_sprite_animation();
  reg.a = r16(0x0656);
  if (reg.a !== 0) {
    const x = reg.x;
    w16(R.current_sprite, reg.a);
    reg.a = C.king_zing_stinger_turn_anim_id;
    set_sprite_animation();
    reg.x = x;
    w16(R.current_sprite, x);
  }
  CODE_BA94CD();
}

/** $BA94CD */
export function CODE_BA94CD(): void {
  reg.y = stk.pop();
}

/** $BA94CF — defeated: fall, then clear the level when $0757 runs out. */
export function CODE_BA94CF(): void {
  reg.a = 0x000f;
  interpolate_x_velocity_global();
  reg.a = 0x0001;
  interpolate_y_velocity_global();
  apply_position_from_velocity_global();
  const x = cur();
  reg.x = x;
  reg.a = rd(x, 0x26);
  if (reg.a === rd(x, 0x20)) {
    reg.a = neg(reg.a);
    wr(x, 0x26, reg.a);
  }
  CODE_BA94EF();
}

/** $BA94EF */
export function CODE_BA94EF(): void {
  if (dec(0, 0x0757) === 0) {
    set_current_level_as_cleared();
    reg.a = C.player_interaction_27;
    set_player_interaction_global();
  }
  CODE_BA94FF();
}

/** $BA94FF */
export function CODE_BA94FF(): void {
  CODE_BA926C();
}

/** $BA9502 — the big King Zing's stinger was hit by an egg. */
export function CODE_BA9502(): void {
  stk.push(reg.y);
  reg.a = snd(6, "king_zing_hit");
  queue_sound_effect();
  stk.push(cur());
  CODE_BA92F6();
  const x = r16(0x0654);
  reg.x = x;
  w16(R.current_sprite, x);
  reg.a = rd(x, 0x2e);
  if (reg.a & 0x0080) CODE_BA943A();
  CODE_BA9520();
}

/** $BA9520 — at 3 HP he shrinks (smoke). */
export function CODE_BA9520(): void {
  const x = reg.x;
  w16(0x0709, 0x00b4);
  wr(x, 0x2e, (rd(x, 0x2e) | 0x1200) & 0xfffd);
  dec(0, 0x0652);
  reg.a = r16(0x0652);
  if (reg.a === 0x0003) return CODE_BA9540();
  CODE_BA95C3();
}

/** One smoke group of the shrink: a parent puff then the rest following it. */
function smokeGroup(set: number, anim: number, palette: number) {
  reg.x = set;
  w16(0x0650, lda(set));
  stk.push(set);
  reg.y = SMOKE;
  CODE_BA9769();
  reg.x = r16(R.alternate_sprite);
  w16(0x0658, reg.x);
  reg.a = anim;
  set_alt_sprite_animation();
  reg.a = palette;
  request_sprite_palette_global();
  const y = r16(R.alternate_sprite);
  reg.y = y;
  reg.a = ((reg.a ^ rd(y, 0x12)) & 0x0e00) ^ rd(y, 0x12);
  wr(y, 0x12, reg.a);
  reg.a = add(stk.pop(), 0x000c);
  reg.x = reg.a;
  dec(0, 0x0650);
  CODE_BA9736();
}

/** $BA9540 */
export function CODE_BA9540(): void {
  w16(0x0717, 0x00aa);
  smokeGroup(SMOKE_LARGE_SET, C.king_zing_smoke_large_anim_id, C.global_sprite_palette);
  smokeGroup(SMOKE_MEDIUM_SET, C.king_zing_smoke_medium_anim_id, C.coins_sprite_palette);
  CODE_BA95C3();
}

/** $BA95C3 — hurt animations and the damage shake (return code CODE_B6AF3E). */
export function CODE_BA95C3(): void {
  dec(0, 0x070b);
  reg.a = C.king_zing_hurt_anim_id;
  set_sprite_animation();
  let x = r16(0x0656);
  reg.x = x;
  w16(R.current_sprite, x);
  wr(x, 0x1e, 0);
  reg.a = C.king_zing_stinger_hurt_anim_id;
  set_sprite_animation();
  x = r16(0x0654);
  reg.x = x;
  w16(R.current_sprite, x);
  wr(x, 0x20, BIG_SHAKE);
  wr(x, 0x22, B6CEA7);
  wr(x, 0x24, 0x0001);
  wr(x, 0x26, 0x0001);
  reg.y = r16(R.active_kong_sprite);
  reg.a = rd(x, 0x06);
  if (ge(reg.a, rd(reg.y, 0x06))) return CODE_BA9600();
  reg.a = 0xffff;
  CODE_BA9603();
}

/** $BA9600 */
export function CODE_BA9600(): void {
  reg.a = 0x0001;
  CODE_BA9603();
}

/** $BA9603 */
export function CODE_BA9603(): void {
  wr(reg.x, 0x28, reg.a);
  reg.a = B6AF3E;
  wr(reg.x, 0x44, reg.a);
  reg.x = stk.pop();
  w16(R.current_sprite, reg.x);
  reg.y = stk.pop();
}

/** $BA960F — the small King Zing was hit; at 0 HP he dies. */
export function CODE_BA960F(): void {
  reg.a = snd(6, "king_zing_hit");
  queue_sound_effect();
  CODE_BA92F6();
  const x = r16(0x0654);
  reg.x = x;
  w16(R.current_sprite, x);
  w16(0x0765, 0x0014);
  w16(0x0709, 0x00b4);
  wr(x, 0x2e, (rd(x, 0x2e) | 0x0200) & 0xfffd);
  if (dec(0, 0x0652) !== 0) return CODE_BA967E();
  wr(x, 0x24, 0);
  wr(x, 0x2a, 0x0180);
  wr(x, 0x20, 0x02e0);
  wr(x, 0x26, 0x0300);
  w16(0x0757, 0x0190);
  w16(R.alternate_sprite, r16(0x0654));
  reg.a = C.king_zing_death_anim_id;
  set_alt_sprite_animation();
  reg.a = snd(4, "king_zing_defeated");
  queue_sound_effect();
  reg.y = C.special_sprite_spawn_id_0196;
  spawn_special_sprite_index();
  reg.y = C.special_sprite_spawn_id_0198;
  spawn_special_sprite_index();
  reg.y = C.special_sprite_spawn_id_019A;
  spawn_special_sprite_index();
  CODE_BA9696();
}

/** $BA967E */
export function CODE_BA967E(): void {
  const x = reg.x;
  wr(x, 0x2e, rd(x, 0x2e) | 0x0400);
  wr(x, 0x20, SMALL_SHAKE);
  wr(x, 0x22, SMALL_SHAKE_END);
  reg.a = 0x0001;
  wr(x, 0x24, 0x0001);
  wr(x, 0x26, 0x0001);
  CODE_BA9696();
}

/** $BA9696 */
export function CODE_BA9696(): void {}

/** $BA9697 — the small King Zing's damage shake (table at $20 up to $22). */
export function CODE_BA9697(): void {
  const x = cur();
  reg.x = x;
  reg.a = rd(x, 0x20);
  if (reg.a === rd(x, 0x22)) return CODE_BA96BA();
  if (dec(x, 0x24) !== 0) return CODE_BA96B9();
  wr(x, 0x24, rd(x, 0x26));
  let y = rd(x, 0x20);
  reg.a = add(rd(x, 0x06), lda(y));
  wr(x, 0x06, reg.a);
  y = (y + 2) & 0xffff;
  reg.y = y;
  wr(x, 0x20, y);
  move_child_to_controller_spr_global();
  CODE_BA96B9();
}

/** $BA96B9 */
export function CODE_BA96B9(): void {}

/** $BA96BA */
export function CODE_BA96BA(): void {
  const x = reg.x;
  wr(x, 0x2e, rd(x, 0x2e) & 0xfbff);
  wr(x, 0x26, 0);
  wr(x, 0x2a, 0);
  wr(x, 0x20, 0);
  wr(x, 0x24, 0);
}

/** $BA9736 — spawn the remaining puffs of a smoke group (X = data, $0650 = count). */
export function CODE_BA9736(): void {
  do {
    stk.push(reg.x);
    reg.y = SMOKE;
    CODE_BA9762();
    const s = r16(R.alternate_sprite);
    reg.x = s;
    wr(s, 0x48, r16(0x0658));
    reg.a = add(stk.pop(), 0x000c);
    reg.x = reg.a;
  } while (dec(0, 0x0650) !== 0);
}

/** $BA9751 — remove the smoke: flag the body ($2E bit 15) and delete self. */
export function CODE_BA9751(): void {
  const y = r16(0x0654);
  reg.y = y;
  wr(y, 0x2e, rd(y, 0x2e) | 0x8000);
  delete_sprite_handle_deallocation();
}

/** $BA9762 — spawn (no graphics) Y and set it up from the data at X. */
export function CODE_BA9762(): void {
  stk.push(reg.x);
  spawn_no_gfx_special_sprite_address();
  CODE_BA976E();
}

/** $BA9769 — spawn Y and set it up from the data at X. */
export function CODE_BA9769(): void {
  stk.push(reg.x);
  spawn_special_sprite_address();
  CODE_BA976E();
}

/** $BA976E */
export function CODE_BA976E(): void {
  const x = stk.pop();
  reg.x = x;
  const y = r16(R.alternate_sprite);
  reg.y = y;
  wr(y, 0x4a, lda(x + 2));
  wr(y, 0x4c, lda(x + 4));
  wr(y, 0x24, lda(x + 6));
  wr(y, 0x2a, lda(x + 8));
  wr(y, 0x46, lda(x + 0x0a));
  reg.a = lda(x + 0x0c);
  wr(y, 0x42, reg.a);
}

/** Ring zinger: keep circling King Zing (ring centre = his position, angle = his $4C + own $4A). */
function ringFollow() {
  const y = r16(0x0654);
  const x = cur();
  reg.y = y;
  reg.x = x;
  wr(x, 0x42, rd(y, 0x06));
  wr(x, 0x44, rd(y, 0x0a));
  wr(x, 0x46, rd(y, 0x4c) + rd(x, 0x4a));
  reg.a = rd(y, 0x4e);
  wr(x, 0x48, reg.a);
  process_current_movement();
}

/**
 * $BA9796 — a ring zinger: appears after a delay, circles King Zing, dies from one hit
 * (a thrown sprite) and flies off; respawns while King Zing is not hit.
 */
export function king_zing_ring_zinger_sprite_code(): void {
  if (r16(0x0652) === 0) {
    delete_sprite_handle_deallocation();
    return;
  }
  const y = cur();
  reg.y = y;
  w16(R.current_sprite_constants, rd(y, 0x54));
  const state = rd(y, 0x2e) & 0xff;
  reg.x = state * 2;
  let x = y;
  switch (state) {
    case 0:
      reg.x = x;
      inc(x, 0x2e);
      wr(x, 0x12, (rd(x, 0x12) & 0xcfff) | 0x2000);
      wr(x, 0x02, 0x00d4);
      wr(x, 0x52, 0x000a);
      wr(x, 0x4c, 0x0001);
      wr(x, 0x1c, 0xc000);
      reg.y = r16(0x0654);
      wr(x, 0x06, rd(reg.y, 0x06));
      wr(x, 0x0a, rd(reg.y, 0x0a));
      ringFollow();
      return;
    case 1:
      reg.x = x;
      if (dec(x, 0x1e) !== 0) return;
      reg.a = snd(6, "king_zing_spawn_zingers");
      queue_sound_effect();
      x = cur();
      reg.x = x;
      inc(x, 0x2e);
      wr(x, 0x1c, 0);
      wr(x, 0x32, 0);
      wr(x, 0x30, 0x0120);
      ringFollow();
      reg.y = SMOKE_PUFF;
      spawn_special_sprite_address();
      reg.a = C.smoke_cloud_3_anim_id;
      set_alt_sprite_animation();
      reg.x = r16(R.alternate_sprite);
      inc(reg.x, 0x02);
      reg.a = r16(0x06a5) & 0xefff;
      w16(0x06a5, reg.a);
      return ringState2();
    case 2:
      return ringState2();
    case 3:
      process_current_movement();
      process_sprite_animation();
      check_if_sprite_offscreen_global();
      if (reg.c) {
        x = cur();
        reg.x = x;
        wr(x, 0x1c, 0xc000);
        inc(x, 0x2e);
        wr(x, 0x4c, 0x0168);
      }
      return;
    case 4:
      reg.x = x;
      if (r16(0x06a5) & 0x1000) {
        delete_sprite_handle_deallocation();
        return;
      }
      if (dec(x, 0x4c) !== 0) return;
      wr(x, 0x2e, 0);
      inc(x, 0x1e);
      reg.a = C.king_zing_small_idle_anim_id;
      set_sprite_animation();
      return;
  }
}

/** Ring zinger state 2: alive, circling; one hit kills it. */
function ringState2() {
  w16(0x071f, r16(0x071f) + 1);
  reg.a = 0x0118;
  check_throwable_collision_global();
  let hit = false;
  let z = false;
  if (reg.c) {
    hit = true;
    z = (reg.a & 0xffff) === 0;
  } else {
    get_current_sprite_clipping();
    reg.a = 0x5000;
    check_complex_player_collision_B6();
    if (reg.c) {
      hit = true;
      z = (reg.x & 0xffff) === 0; // flags of the PLX that ends the collision check
    }
  }
  if (hit && z && dec(reg.x, 0x4c) === 0) {
    reg.a = 0x0199;
    defeat_sprite_using_anim_global();
    reg.a = snd(5, "zinger_flitter_hit");
    queue_sound_effect();
    const c = r16(R.colliding_sprite);
    reg.x = c;
    reg.a = rd(c, 0x12) & 0x4000 ? 0xff00 : 0x0100;
    const x = cur();
    reg.x = x;
    wr(x, 0x26, reg.a);
    wr(x, 0x20, reg.a);
    wr(x, 0x24, 0xf800);
    wr(x, 0x52, 0x0004);
    inc(x, 0x2e);
    return;
  }
  ringFollow();
  process_sprite_animation();
}

/** $BA993E — King Zing's smoke puffs (follow the parent puff or King Zing). */
export function king_zing_smoke_effect_sprite_code(): void {
  let x = r16(0x0654);
  reg.x = x;
  if (rd(x, 0x2e) & 0x8000) {
    delete_sprite_no_deallocation();
    return;
  }
  x = cur();
  reg.x = x;
  let y = rd(x, 0x48);
  reg.y = y;
  if (y !== 0) {
    reg.a = rd(y, 0x42);
    if (reg.a !== 0) return;
  } else {
    reg.a = rd(x, 0x42);
    if (reg.a === 0) return smokeMove();
    if (dec(x, 0x42) !== 0) return;
  }
  wr(x, 0x1c, 0);
  y = r16(0x0654);
  reg.y = y;
  wr(x, 0x06, rd(y, 0x06) + rd(x, 0x4a));
  reg.a = add(rd(y, 0x0a), rd(x, 0x4c));
  wr(x, 0x0a, reg.a);
  smokeMove();
}

function smokeMove() {
  let x = cur();
  reg.a = rd(x, 0x44);
  interpolate_x_velocity_global();
  x = cur();
  reg.x = x;
  reg.a = rd(x, 0x46);
  interpolate_y_velocity_global();
  apply_position_from_velocity_global();
  x = cur();
  reg.x = x;
  const y = rd(x, 0x48);
  reg.y = y;
  if (y === 0) {
    process_sprite_animation();
    return;
  }
  wr(x, 0x12, rd(y, 0x12));
  wr(x, 0x1a, rd(y, 0x1a));
  reg.a = rd(y, 0x16);
  wr(x, 0x16, reg.a);
}

/** $BA99B1 — the stinger: Squawks' eggs bounce off it and hurt the big King Zing. */
export function king_zing_stinger_sprite_code(): void {
  stingerDB = reg.db;
  reg.db = 0xba;
  reg.a = r16(0x0652);
  if (reg.a === 0) return CODE_BA9A71();
  let x = r16(0x0654);
  reg.x = x;
  reg.a = rd(x, 0x2e);
  if (reg.a & 0x0200) return CODE_BA9A24();
  get_current_sprite_clipping();
  reg.a = 0x0000;
  check_complex_player_collision_B6();
  reg.x = r16(0x0656);
  reg.y = STINGER_CLIP;
  CODE_B6E736();
  reg.a = 0x0200;
  reg.y = 0x0000;
  check_sprite_collision_BA();
  if (!reg.c) return CODE_BA9A22();
  reg.a = r16(0x0656);
  if (reg.a === r16(R.colliding_sprite)) return CODE_BA9A22();
  x = r16(R.colliding_sprite);
  reg.x = x;
  reg.a = rd(x, 0x2e);
  if (reg.a === 0x0001) return CODE_BA9A22();
  CODE_B6FE9E();
  x = cur();
  reg.x = x;
  wr(x, 0x32, rd(x, 0x32) | 0x0008);
  x = r16(R.colliding_sprite);
  reg.x = x;
  wr(x, 0x2e, 0x0001);
  wr(x, 0x24, 0xfc00);
  reg.a = r16(0xdb);
  if (cmpMi(reg.a, r16(0xe3))) return CODE_BA9A20();
  reg.a = neg(rd(x, 0x20));
  wr(x, 0x20, reg.a);
  CODE_BA9A20();
}

/** $BA9A20 */
export function CODE_BA9A20(): void {
  wr(reg.x, 0x26, 0);
  CODE_BA9A22();
}

/** $BA9A22 */
export function CODE_BA9A22(): void {
  CODE_BA9A55();
}

/** $BA9A24 */
export function CODE_BA9A24(): void {
  reg.x = r16(0x0654);
  reg.a = r16(0x0765);
  CODE_BA9A71();
}

/** $BA9A55 — an egg hit the stinger ($32): hurt King Zing (unless already hurt). */
export function CODE_BA9A55(): void {
  const y = r16(0x0654);
  reg.y = y;
  reg.a = rd(y, 0x2e);
  if (reg.a & 0x0001) return CODE_BA9A71();
  const x = cur();
  reg.x = x;
  reg.a = r16(0x0765);
  if (reg.a !== 0) return CODE_BA9A71();
  reg.a = rd(x, 0x32);
  if (reg.a === 0) return CODE_BA9A71();
  wr(x, 0x32, 0);
  CODE_BA9502();
  CODE_BA9A71();
}

/** $BA9A71 — cycle the stinger's palette every 10 frames. */
export function CODE_BA9A71(): void {
  if (dec(0, 0x0755) !== 0) return CODE_BA9A96();
  w16(0x0755, 0x000a);
  let y = r16(0x0757);
  reg.a = lda(y);
  y = (y + 2) & 0xffff;
  reg.y = y;
  if (y !== BA9324) return CODE_BA9A8D();
  reg.y = STINGER_PALETTES;
  CODE_BA9A8D();
}

/** $BA9A8D */
export function CODE_BA9A8D(): void {
  w16(0x0757, reg.y);
  reg.x = cur();
  set_sprite_palette_global();
  CODE_BA9A96();
}

/** $BA9A96 */
export function CODE_BA9A96(): void {
  process_sprite_animation();
  reg.db = stingerDB;
}

/** $BA9A9E — a spike: flies straight; hurts the Kongs while King Zing shoots, else hits terrain. */
export function king_zing_spikes_sprite_code(): void {
  let x = cur();
  reg.a = rd(x, 0x42);
  interpolate_x_velocity_global();
  x = cur();
  reg.x = x;
  reg.a = rd(x, 0x44);
  interpolate_y_velocity_global();
  reg.x = r16(0x0654);
  reg.a = rd(reg.x, 0x2e);
  if (reg.a & 0x2000) {
    get_current_sprite_clipping();
    reg.a = 0x0000;
    check_complex_player_collision_B6();
    apply_position_from_velocity_global();
  } else {
    process_terrain_interaction_global();
  }
  x = cur();
  reg.x = x;
  reg.a = rd(x, 0x1e);
  if (reg.a & 0x0007 || (rd(x, 0x20) | rd(x, 0x24)) === 0) {
    delete_sprite_handle_deallocation();
    return;
  }
  // a spike with no speed on an axis jitters by one pixel on that axis, following the toggle
  const y = r16(0x0654);
  reg.y = y;
  reg.a = rd(x, 0x20);
  if (reg.a === 0) {
    reg.a = rd(y, 0x2e);
    if (reg.a & 0x2000) dec(x, 0x06);
    else inc(x, 0x06);
  }
  reg.a = rd(x, 0x24);
  if (reg.a !== 0) return;
  reg.a = rd(y, 0x2e);
  if (reg.a & 0x2000) dec(x, 0x0a);
  else inc(x, 0x0a);
}

/**
 * $BA9B0E — run boss commands (script at $46, X = boss) until one leaves a return code in $44.
 * The command words and their operands live in bank $B6.
 */
export function parse_boss_command_BA(): void {
  do {
    const saved = reg.db;
    reg.db = 0xb6;
    let x = reg.x;
    let y = rd(x, 0x46);
    reg.a = (lda(y) << 2) & 0xffff;
    const i = reg.a;
    wr(x, 0x46, lda(CMD_TABLE + i));
    reg.a = lda(CMD_TABLE + i + 2);
    wr(x, 0x44, reg.a);
    reg.y = (y + 2) & 0xffff;
    if (process.env.DBGB) console.log("cmd", x.toString(16), y.toString(16), (i>>2).toString(16), rd(x,0x46).toString(16));
    execute_boss_command();
    reg.db = saved;
    x = cur();
    reg.x = x;
    y = reg.y;
    wr(x, 0x46, y);
    reg.a = rd(x, 0x44);
  } while (reg.a === 0);
}

registerSprite({
  bank_BA_sprite_main_handler_1, king_zing_sprite_code, CODE_BA909F, CODE_BA90A8, CODE_BA90D1,
  CODE_BA90D5, CODE_BA90D9, CODE_BA9114, CODE_BA911F, CODE_BA912B, CODE_BA9192, CODE_BA91C1,
  CODE_BA91C4, CODE_BA91D4, CODE_BA91E1, CODE_BA91EC, CODE_BA91F1, CODE_BA91FE, CODE_BA920D,
  CODE_BA922F, CODE_BA923C, CODE_BA924B, CODE_BA924E, CODE_BA926C, CODE_BA94CF, CODE_BA94EF,
  CODE_BA94FF, king_zing_ring_zinger_sprite_code, king_zing_smoke_effect_sprite_code,
  king_zing_stinger_sprite_code, CODE_BA9A20, CODE_BA9A22, CODE_BA9A24, CODE_BA9A55, CODE_BA9A71,
  CODE_BA9A8D, CODE_BA9A96, king_zing_spikes_sprite_code,
});
registerRts({
  set_king_zing_pattern_bank, CODE_BA9274, CODE_BA92AE, CODE_BA92F1, CODE_BA92F6, CODE_BA9324,
  CODE_BA9334, CODE_BA935E, CODE_BA937D, CODE_BA938F, CODE_BA9397, CODE_BA9399, CODE_BA93AA,
  CODE_BA93BC, CODE_BA93C0, CODE_BA93E0, CODE_BA93E8, CODE_BA93EA, CODE_BA93FC, CODE_BA9400,
  CODE_BA9439, CODE_BA9484, CODE_BA94B3, CODE_BA94B6, CODE_BA94CD, CODE_BA9502, CODE_BA9520,
  CODE_BA9540, CODE_BA95C3, CODE_BA9600, CODE_BA9603, CODE_BA960F, CODE_BA967E, CODE_BA9696,
  CODE_BA9697, CODE_BA96B9, CODE_BA96BA, CODE_BA9736, CODE_BA9762, CODE_BA9769, CODE_BA976E,
  parse_boss_command_BA,
});
registerRtl({
  check_sprite_collision_BA, CODE_BA92F2, CODE_BA943A, CODE_BA9450, CODE_BA9465, CODE_BA9468,
  CODE_BA947F, CODE_BA9480, CODE_BA9751,
});
