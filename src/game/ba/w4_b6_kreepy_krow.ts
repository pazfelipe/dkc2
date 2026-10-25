/**
 * Bank $BA — Kreepy Krow (Kreepy Krow, world 6 boss): body, head and the eggs that fall while
 * the Kongs climb. Krow throws barrels (one of them is a DK barrel... the barrel with the
 * mini-neckys of the current phase), the Kongs hit him with the barrels he drops. HP 3.
 *
 * Kreepy Krow RAM: $0652 HP, $0654 body, $0656 head, $0658 delay before the next mini-necky
 * (after death: palette table pointer), $065A/$065C death sequence timer/state, $06F3 mini-neckys
 * left, $06F5 delay after this one, $06F7 wave table pointer, $06F9 neckys still to spawn before
 * the ghost ones, $06FB the mini-necky carrying the barrel, $06FD barrel spawn positions, $0701/
 * $0703 countdowns of the eggs falling from above/the side, $0707 the barrel he holds.
 */
import { r16, w16, bus16, io8, io16, ioR16 } from "../../core/mem";
import { reg } from "../../core/cpu";
import { L, R, C, CPU } from "../../core/sym";
import {
  CODE_B4AEAF, spawn_special_sprite_index, get_current_sprite_clipping, check_complex_player_collision_B6,
  CODE_B3A600, execute_boss_return_command, process_sprite_animation, set_sprite_animation,
  set_alt_sprite_animation, queue_sound_effect, spawn_special_sprite_address, CODE_B4C175,
  set_sprite_palette_global, spawn_no_gfx_special_sprite_index, set_current_level_as_cleared,
  set_player_interaction_global, interpolate_x_velocity_global, interpolate_y_velocity_global,
  apply_position_from_velocity_global, delete_sprite_if_offscreen, delete_sprite_handle_deallocation,
} from "../../gen/routines";
import { cur, rd, wr, dec, inc, snd, jsrAddr, registerSprite, registerRts } from "../b6/b6ba_common";
import { lda, lo, bank, Stack, ge, add, sub } from "../b6/w4_b6_util";
import { parse_boss_command_BA } from "./w4_b6_king_zing";

const KK_COMMANDS = lo("DATA_B6AFE7");
const KK_COMMANDS_BANK = bank("DATA_B6AFE7");
const PHASE_2_SCRIPT = lo("DATA_B6B1ED");
const PHASE_SCRIPT = lo("DATA_B6B413");
const BIG_SHAKE = lo("big_king_zing_damage_pos_offsets");
const B6CEA7 = lo("CODE_B6CEA7");
const B6CEBE = lo("CODE_B6CEBE");
const DEATH_PALETTES = lo("kreepy_krow_death_palette_table");
const NECKY_VARS = lo("mini_necky_vars_setup_table");
const KONG_STATE_FLAGS = L("kong_state_flags_table");
const DEBRIS = L("DATA_BAC8AB");

const stk = new Stack();
let bodyDB = 0;

/** $BA9B3D — Kreepy Krow's body (runs the boss script). */
export function kreepy_krows_body_sprite_code(): void {
  bodyDB = reg.db;
  reg.db = 0xba;
  let x = cur();
  reg.x = x;
  if (rd(x, 0x42) === 0) {
    CODE_B4AEAF();
    x = reg.x;
    wr(x, 0x04, 0);
    wr(x, 0x32, 0);
    for (const a of [0x06a1, 0x06a3, 0x06a5, 0x0707, 0x0701, 0x0703, 0x06fb]) w16(a, 0);
    wr(x, 0x2e, 0x0010);
    w16(0x065a, KK_COMMANDS);
    w16(0x0652, 0x0003);
    reg.y = C.special_sprite_spawn_id_009E;
    spawn_special_sprite_index();
    const head = r16(R.alternate_sprite);
    x = cur();
    reg.x = x;
    w16(0x0654, x);
    w16(0x0656, head);
    wr(x, 0x42, head);
    wr(x, 0x44, 0);
    reg.a = head;
    parse_boss_command_BA();
  }
  reg.a = r16(0x0652);
  if (reg.a === 0) return handle_kreepy_krow_defeated_state();
  x = cur();
  reg.x = x;
  reg.a = rd(x, 0x32);
  if (reg.a !== 0) {
    wr(x, 0x32, 0);
    CODE_BA9C64();
  }
  x = reg.x;
  reg.a = rd(x, 0x2e);
  if (reg.a & 0x0200) {
    // bonked: touching him knocks the Kong back (with a cooldown in $04)
    reg.a = rd(x, 0x04);
    if (reg.a !== 0) {
      dec(x, 0x04);
    } else {
      get_current_sprite_clipping();
      reg.a = 0x007b;
      check_complex_player_collision_B6();
      if (reg.c) {
        reg.a = 0x001e;
        reg.y = 0xfe00;
        CODE_B3A600();
        x = r16(0x0654);
        reg.x = x;
        wr(x, 0x2e, rd(x, 0x2e) | 0x0200);
        reg.a = 0x0014;
        wr(x, 0x04, 0x0014);
      }
    }
  } else {
    get_current_sprite_clipping();
    reg.a = 0x0000;
    check_complex_player_collision_B6();
  }
  reg.a = rd(reg.x, 0x44);
  execute_boss_return_command();
  x = cur();
  reg.x = x;
  reg.a = rd(x, 0x44);
  if (reg.a === 0) parse_boss_command_BA();
  CODE_BA9D02();
  CODE_BA9E91();
  CODE_BA9C06();
}

/** $BA9C06 */
export function CODE_BA9C06(): void {
  process_sprite_animation();
  reg.db = bodyDB;
}

/** $BA9C0E — an egg falling on the Kongs. */
export function kreepy_krows_eggs_sprite_code(): void {
  const k = r16(R.active_kong_sprite);
  reg.x = k;
  reg.a = (rd(k, 0x2e) << 2) & 0xffff;
  reg.x = reg.a;
  reg.a = bus16(KONG_STATE_FLAGS + reg.x) & 0x0040;
  if (reg.a === 0) {
    get_current_sprite_clipping();
    reg.a = 0x0c18;
    check_complex_player_collision_B6();
  }
  let x = cur();
  reg.x = x;
  reg.a = rd(x, 0x32);
  if (reg.a !== 0) {
    // leftover of Krow's egg code: would break the egg into shell pieces
    reg.a = 0x0000;
    const db = reg.db;
    reg.db = 0xba;
    jsrAddr(0xbaf266);
    reg.db = db;
    delete_sprite_handle_deallocation();
    reg.a = snd(4, "barrel_blast");
    queue_sound_effect();
    return;
  }
  reg.a = rd(x, 0x42);
  interpolate_x_velocity_global();
  x = cur();
  reg.x = x;
  reg.a = rd(x, 0x44);
  interpolate_y_velocity_global();
  apply_position_from_velocity_global();
  delete_sprite_if_offscreen();
  process_sprite_animation();
}

/** $BA9C64 — Krow was hit by a barrel: lose HP, hurt shake; at 0 HP start dying. */
export function CODE_BA9C64(): void {
  stk.push(reg.y);
  stk.push(cur());
  const x = r16(0x0654);
  reg.x = x;
  w16(R.current_sprite, x);
  wr(x, 0x2e, (rd(x, 0x2e) | 0x1200) & 0xfff5);
  if (dec(0, 0x0652) !== 0) return CODE_BA9CA4();
  wr(x, 0x2e, 0);
  reg.a = C.krow_body_fly_anim_id;
  set_sprite_animation();
  reg.y = r16(0x0656);
  reg.a = C.kreepy_krow_head_last_hit_anim_id;
  w16(R.alternate_sprite, reg.y);
  set_alt_sprite_animation();
  w16(0x0658, DEATH_PALETTES);
  w16(0x065a, 0x000a);
  w16(0x065c, 0);
  CODE_BA9CFD();
}

/** $BA9CA4 — next phase script. */
export function CODE_BA9CA4(): void {
  reg.a = r16(0x0652);
  if (reg.a === 0x0002) return CODE_BA9CB2();
  reg.a = PHASE_SCRIPT;
  CODE_BA9CB5();
}

/** $BA9CB2 */
export function CODE_BA9CB2(): void {
  reg.a = PHASE_2_SCRIPT;
  CODE_BA9CB5();
}

/** $BA9CB5 */
export function CODE_BA9CB5(): void {
  let x = reg.x;
  wr(x, 0x46, reg.a);
  wr(x, 0x1e, 0);
  reg.a = C.krow_body_hurt_anim_id;
  set_sprite_animation();
  x = r16(0x0656);
  reg.x = x;
  w16(R.current_sprite, x);
  wr(x, 0x1e, 0);
  reg.a = C.krow_head_hurt_anim_id;
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
  if (ge(reg.a, rd(reg.y, 0x06))) return CODE_BA9CF3();
  reg.a = 0xffff;
  CODE_BA9CF6();
}

/** $BA9CF3 */
export function CODE_BA9CF3(): void {
  reg.a = 0x0001;
  CODE_BA9CF6();
}

/** $BA9CF6 */
export function CODE_BA9CF6(): void {
  wr(reg.x, 0x28, reg.a);
  reg.a = B6CEBE;
  wr(reg.x, 0x44, reg.a);
  CODE_BA9CFD();
}

/** $BA9CFD */
export function CODE_BA9CFD(): void {
  reg.x = stk.pop();
  w16(R.current_sprite, reg.x);
  reg.y = stk.pop();
}

/** $BA9D02 — the mini-necky carrying the barrel reached its spot: drop a barrel. */
export function CODE_BA9D02(): void {
  reg.x = r16(0x06fb);
  if (reg.x === 0) return CODE_BA9D96();
  CODE_BA9D0A();
}

/** $BA9D0A */
export function CODE_BA9D0A(): void {
  reg.a = rd(reg.x, 0x2e);
  if (reg.a !== 0x0005) return CODE_BA9D96();
  CODE_BA9D14();
}

/** $BA9D14 — the crate breaks and a barrel appears at one of three random spots. */
export function CODE_BA9D14(): void {
  reg.a = snd(4, "animal_crate_break_a");
  queue_sound_effect();
  reg.a = snd(5, "animal_crate_break_c");
  queue_sound_effect();
  reg.a = snd(6, "animal_crate_break_d");
  queue_sound_effect();
  reg.a = snd(7, "animal_crate_break_b");
  queue_sound_effect();
  reg.y = lo("DATA_FF1E74");
  spawn_special_sprite_address();
  reg.y = r16(0x06fd);
  CODE_B4C175();
  w16(0x0650, reg.a);
  io16(CPU.dividen, reg.a);
  reg.a = 0x0003;
  if (ge(0x0003, r16(0x0650))) return CODE_BA9D60();
  io8(CPU.divisor, 0x03);
  reg.a = ioR16(CPU.multiply_result);
  CODE_BA9D64();
}

/** $BA9D60 */
export function CODE_BA9D60(): void {
  reg.a = r16(0x0650);
  CODE_BA9D64();
}

/** $BA9D64 — A = spot 0..2. */
export function CODE_BA9D64(): void {
  reg.a = add((reg.a << 2) & 0xffff, r16(0x06fd));
  reg.y = reg.a;
  const db = reg.db;
  reg.db = KK_COMMANDS_BANK;
  CODE_BA9E84();
  reg.db = db;
  const x = reg.x;
  wr(x, 0x32, 0);
  w16(0x0707, x);
  reg.a = (rd(x, 0x12) & 0xcfff) | 0x3000;
  wr(x, 0x12, reg.a);
  w16(R.current_sprite, x);
  reg.y = lo("DATA_FF1E58");
  spawn_special_sprite_address();
  reg.x = r16(0x0654);
  w16(R.current_sprite, reg.x);
  w16(0x06fb, 0);
  CODE_BA9D96();
}

/** $BA9D96 — mini-necky waves: spawn the next one when its delay runs out. */
export function CODE_BA9D96(): void {
  reg.x = cur();
  reg.a = rd(reg.x, 0x2e);
  if (!(reg.a & 0x0001)) return CODE_BA9E83();
  CODE_BA9DA2();
}

/** $BA9DA2 */
export function CODE_BA9DA2(): void {
  reg.a = r16(0x0658);
  if (reg.a === 0) return CODE_BA9DAE();
  dec(0, 0x0658);
  CODE_BA9E83();
}

/** $BA9DAE — spawn a mini-necky from the wave table. */
export function CODE_BA9DAE(): void {
  let y = r16(0x06f7);
  reg.x = add((lda(y) << 1) & 0xffff, NECKY_VARS);
  w16(0x06f5, lda(y + 2));
  y = (y + 4) & 0xffff;
  w16(0x06f7, y);
  y = lda(reg.x);
  reg.y = y;
  stk.push(y);
  reg.a = lda(y + 0x10);
  if (reg.a & 0x8000) return CODE_BA9DD6();
  reg.y = lo("DATA_FF1E32");
  CODE_BA9DD9();
}

/** $BA9DD6 */
export function CODE_BA9DD6(): void {
  reg.y = lo("DATA_FF1E0C");
  CODE_BA9DD9();
}

/** $BA9DD9 */
export function CODE_BA9DD9(): void {
  spawn_special_sprite_address();
  const x = stk.pop();
  reg.x = x;
  const y = r16(R.alternate_sprite);
  reg.y = y;
  const fields = [0x06, 0x0a, 0x46, 0x26, 0x0c, 0x0e, 0x22, 0x28, 0x20, 0x4e, 0x50];
  fields.forEach((f, i) => wr(y, f, lda(x + i * 2)));
  wr(y, 0x2e, 0x0001);
  reg.a = r16(0x06f9);
  if (reg.a !== 0) return CODE_BA9E4D();
  // the first necky of the wave carries the barrel
  reg.a = (rd(y, 0x12) & 0xcfff) | 0x3000;
  wr(y, 0x12, reg.a);
  w16(0x06fb, y);
  w16(R.current_sprite, y);
  reg.x = r16(0x0654);
  w16(R.current_sprite, reg.x);
  reg.a = snd(5, "necky_attack");
  queue_sound_effect();
  CODE_BA9E68();
}

/** $BA9E4D — the others are ghost mini-neckys. */
export function CODE_BA9E4D(): void {
  const y = reg.y;
  reg.a = (rd(y, 0x12) & 0xcfff) | 0x1000;
  wr(y, 0x12, reg.a);
  reg.x = y;
  reg.a = C.ghost_mini_necky_sprite_palette;
  set_sprite_palette_global();
  reg.a = snd(5, "necky_attack");
  queue_sound_effect();
  CODE_BA9E68();
}

/** $BA9E68 */
export function CODE_BA9E68(): void {
  dec(0, 0x06f9);
  if (dec(0, 0x06f3) === 0) return CODE_BA9E7A();
  reg.a = r16(0x06f5);
  w16(0x0658, reg.a);
  CODE_BA9E83();
}

/** $BA9E7A — wave over. */
export function CODE_BA9E7A(): void {
  reg.x = cur();
  reg.a = rd(reg.x, 0x2e) & 0xfffe;
  wr(reg.x, 0x2e, reg.a);
  CODE_BA9E83();
}

/** $BA9E83 */
export function CODE_BA9E83(): void {}

/** $BA9E84 — the spawned sprite at the position at Y. */
export function CODE_BA9E84(): void {
  const x = r16(R.alternate_sprite);
  reg.x = x;
  wr(x, 0x06, lda(reg.y));
  reg.a = lda(reg.y + 2);
  wr(x, 0x0a, reg.a);
}

/** $BA9E91 — eggs fall while the Kong climbs certain heights (hard-coded y ranges). */
export function CODE_BA9E91(): void {
  reg.y = r16(R.active_kong_sprite);
  const a = rd(reg.y, 0x0a);
  reg.a = a;
  if (!ge(a, 0x0378)) return CODE_BA9EBE();
  if (!ge(a, 0x0608)) return CODE_BA9F1F();
  if (!ge(a, 0x08b0)) return CODE_BA9EBE();
  if (!ge(a, 0x0aab)) return CODE_BA9EE8();
  if (!ge(a, 0x0ae2)) return CODE_BA9ECD();
  if (!ge(a, 0x0b80)) return CODE_BA9EB6();
}

/** $BA9EB6 */
export function CODE_BA9EB6(): void {
  reg.a = 0x0050;
  w16(0x0701, 0x0050);
}

/** $BA9EBE */
export function CODE_BA9EBE(): void {
  w16(0x0701, 0x0050);
  reg.a = 0x0014;
  w16(0x0703, 0x0014);
}

/** $BA9ECD — one egg at a fixed x when the Kong passes this height. */
export function CODE_BA9ECD(): void {
  reg.x = cur();
  reg.a = rd(reg.x, 0x2e);
  if (reg.a & 0x0004) return CODE_BA9EE7();
  CODE_BA9EEE();
  reg.a = 0x020a;
  wr(reg.x, 0x06, 0x020a);
  reg.x = cur();
  reg.a = rd(reg.x, 0x2e) | 0x0004;
  wr(reg.x, 0x2e, reg.a);
  CODE_BA9EE7();
}

/** $BA9EE7 */
export function CODE_BA9EE7(): void {}

/** $BA9EE8 */
export function CODE_BA9EE8(): void {
  reg.a = r16(0x0701);
  if (reg.a !== 0) return CODE_BA9F1B();
  CODE_BA9EEE();
}

/** An egg from the top of the screen above the Kong (X = egg, Y = Kong). */
function eggFromTop() {
  const x = reg.x;
  const y = reg.y;
  wr(x, 0x06, rd(y, 0x06));
  wr(x, 0x0a, sub(r16(R.screen_scroll_y_position), 0x0020));
  wr(x, 0x24, 0x0200);
  wr(x, 0x2a, 0x0280);
  wr(x, 0x20, 0);
  wr(x, 0x26, 0);
  wr(x, 0x42, 0);
  wr(x, 0x44, 0x0002);
  reg.a = 0x0064;
  w16(0x0701, 0x0064);
}

/** $BA9EEE */
export function CODE_BA9EEE(): void {
  spawn_kreepy_krow_egg();
  eggFromTop();
  CODE_BA9F1B();
}

/** $BA9F1B */
export function CODE_BA9F1B(): void {
  dec(0, 0x0701);
}

/** $BA9F1F — eggs from above and from the left side. */
export function CODE_BA9F1F(): void {
  reg.a = r16(0x0701);
  if (reg.a === 0) {
    spawn_kreepy_krow_egg();
    eggFromTop();
  }
  CODE_BA9F52();
}

/** $BA9F52 */
export function CODE_BA9F52(): void {
  dec(0, 0x0701);
  reg.a = r16(0x0703);
  if (reg.a === 0) {
    spawn_kreepy_krow_egg();
    const x = reg.x;
    const y = reg.y;
    wr(x, 0x0a, rd(y, 0x0a));
    wr(x, 0x06, sub(r16(R.screen_scroll_x_position), 0x0020));
    wr(x, 0x20, 0x0200);
    wr(x, 0x26, 0x0280);
    wr(x, 0x24, 0);
    wr(x, 0x2a, 0);
    wr(x, 0x42, 0x0002);
    wr(x, 0x44, 0);
    reg.a = 0x0064;
    w16(0x0703, 0x0064);
  }
  CODE_BA9F88();
}

/** $BA9F88 */
export function CODE_BA9F88(): void {
  dec(0, 0x0703);
}

/** $BA9F8C — spawn an egg: X = egg, Y = active Kong. */
export function spawn_kreepy_krow_egg(): void {
  reg.a = snd(5, "egg_kudgel_fall");
  queue_sound_effect();
  reg.y = C.special_sprite_spawn_id_00A4;
  spawn_special_sprite_index();
  reg.x = r16(R.alternate_sprite);
  reg.y = r16(R.active_kong_sprite);
}

/**
 * $BA9FA0 — Kreepy Krow defeated: flash the dying palettes (state 0), burst into pieces
 * (state 1, one piece per frame from DATA_BAC8AB), then end the level when the Kong lands
 * (state 2).
 */
export function handle_kreepy_krow_defeated_state(): void {
  const self = reg.x;
  const state = r16(0x065c);
  reg.y = self;
  reg.x = (state << 1) & 0xffff;
  if (state === 0) {
    reg.x = self;
    if (dec(0, 0x065a) !== 0) return CODE_BA9C06();
    w16(0x065a, 0x000a);
    const y = r16(0x0658);
    reg.y = y;
    reg.a = lda(y + 2);
    if (reg.a !== 0) {
      set_sprite_palette_global();
      reg.y = y;
      reg.x = r16(0x0656);
      reg.a = lda(y);
      set_sprite_palette_global();
      reg.a = add(y, 0x0004);
      w16(0x0658, reg.a);
      return CODE_BA9C06();
    }
    inc(0, 0x065c);
    reg.a = snd(5, "kreepy_krow_defeated");
    queue_sound_effect();
    for (const id of [C.special_sprite_spawn_id_0138, C.special_sprite_spawn_id_019C, C.special_sprite_spawn_id_019E,
      C.special_sprite_spawn_id_01A0, C.special_sprite_spawn_id_013C]) {
      reg.y = id;
      spawn_special_sprite_index();
    }
    for (const s of [r16(0x0654), r16(0x0656)]) {
      reg.x = s;
      wr(s, 0x1c, 0xc000);
      wr(s, 0x3a, 0);
    }
    reg.a = 0xc000;
    w16(0x0658, 0);
  }
  if (state <= 1) {
    reg.y = C.special_sprite_spawn_id_013A;
    spawn_no_gfx_special_sprite_index();
    const body = r16(0x0654);
    const y = r16(R.alternate_sprite);
    reg.y = y;
    wr(y, 0x06, rd(body, 0x06));
    wr(y, 0x0a, rd(body, 0x0a));
    let x = r16(0x0658);
    const piece = (o: number) => bus16(DEBRIS + x + o);
    wr(y, 0x20, piece(0));
    wr(y, 0x26, piece(2));
    wr(y, 0x24, piece(4));
    wr(y, 0x2a, piece(6));
    wr(y, 0x42, piece(8) & 0x00ff);
    wr(y, 0x44, piece(9) & 0x00ff);
    reg.a = piece(0x0a);
    wr(y, 0x3a, reg.a);
    x = (x + 0x0c) & 0xffff;
    reg.x = x;
    reg.a = piece(0);
    if (reg.a !== 0x0001) {
      w16(0x0658, x);
      return CODE_BA9C06();
    }
    w16(0x065a, 0x0078);
    reg.x = cur();
    inc(0, 0x065c);
  }
  // state 2: wait, then clear the level once the Kong stands on the ground
  reg.a = r16(0x065a);
  if (reg.a === 0 || dec(0, 0x065a) === 0) {
    reg.x = r16(R.active_kong_sprite);
    reg.a = rd(reg.x, 0x1e);
    if (reg.a & 1) {
      dec(0, 0x065a);
      set_current_level_as_cleared();
      reg.a = C.player_interaction_27;
      set_player_interaction_global();
    }
  }
  CODE_BA9C06();
}

/** $BAA1C6 — Kreepy Krow's head (a barrel thrown at it hurts him, touching it hurts the Kong). */
export function kreepy_krows_head_sprite_code(): void {
  reg.a = r16(0x0652);
  if (reg.a !== 0) {
    let x = cur();
    reg.x = x;
    reg.a = rd(x, 0x32);
    if (reg.a !== 0) {
      wr(x, 0x32, 0);
      CODE_BA9C64();
    }
    x = r16(0x0654);
    reg.x = x;
    reg.a = rd(x, 0x2e);
    if (!(reg.a & 0x0200)) {
      get_current_sprite_clipping();
      reg.a = 0x0000;
      check_complex_player_collision_B6();
    } else {
      reg.a = rd(x, 0x04);
      if (reg.a === 0) {
        reg.x = cur();
        get_current_sprite_clipping();
        reg.a = 0x007b;
        check_complex_player_collision_B6();
        if (reg.c) {
          reg.a = 0x001e;
          reg.y = 0xfe00;
          CODE_B3A600();
          reg.x = r16(0x0654);
          reg.a = 0x0014;
          wr(reg.x, 0x04, 0x0014);
        }
      }
    }
  }
  reg.x = cur();
  process_sprite_animation();
}

registerSprite({
  kreepy_krows_body_sprite_code, CODE_BA9C06, kreepy_krows_eggs_sprite_code,
  handle_kreepy_krow_defeated_state, kreepy_krows_head_sprite_code,
});
registerRts({
  CODE_BA9C64, CODE_BA9CA4, CODE_BA9CB2, CODE_BA9CB5, CODE_BA9CF3, CODE_BA9CF6, CODE_BA9CFD,
  CODE_BA9D02, CODE_BA9D0A, CODE_BA9D14, CODE_BA9D60, CODE_BA9D64, CODE_BA9D96, CODE_BA9DA2,
  CODE_BA9DAE, CODE_BA9DD6, CODE_BA9DD9, CODE_BA9E4D, CODE_BA9E68, CODE_BA9E7A, CODE_BA9E83,
  CODE_BA9E84, CODE_BA9E91, CODE_BA9EB6, CODE_BA9EBE, CODE_BA9ECD, CODE_BA9EE7, CODE_BA9EE8,
  CODE_BA9EEE, CODE_BA9F1B, CODE_BA9F1F, CODE_BA9F52, CODE_BA9F88, spawn_kreepy_krow_egg,
});
