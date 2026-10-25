/**
 * Bank $B6 — K. Rool (K. Rool Duel, world 7, and Krocodile Kore, the Lost World): his main
 * code, his blunderbuss, the projectile spawners the shot commands call, and Donkey Kong being
 * shot at the start of the duel.
 *
 * K. Rool RAM: $0652 HP (9 in the duel, 1 in Krocodile Kore), $0654 K. Rool, $0656 his gun,
 * $065A, $070B, $072B dash dust, $072D vacuum time, $0727/$0729 shots left/delay, $0735 the
 * spikeball, $0737 projectile table pointer, $073B the DK barrel, $073D collision delay,
 * $075B/$075D/$075F tied-up Donkey Kong parts, $0763 how often Donkey was shot.
 * K. Rool's $2E: bit 0 dangerous, 4 knocked a held barrel, 9 bonk, 13 no touch damage,
 * 14 hit star pending; $4C/$4E blink timer/phase of the priority cycle.
 */
import { r16, w16, r8, bus16 } from "../../core/mem";
import { reg } from "../../core/cpu";
import { L, R, C, sprite } from "../../core/sym";
import {
  CODE_B4AEAF, spawn_special_sprite_index, set_sprite_animation, set_alt_sprite_animation,
  spawn_no_gfx_special_sprite_index, CODE_B6A701, get_current_sprite_clipping, check_complex_player_collision_B6,
  CODE_B6A3A1, release_held_sprite_from_kong, process_sprite_animation, CODE_B3E3E3, spawn_special_sprite_address,
  CODE_B6800D, set_player_interaction_global, queue_sound_effect, CODE_B6D923, interpolate_x_velocity_global,
  interpolate_y_velocity_global, apply_position_from_velocity_global, check_for_sprite_collisions,
  delete_sprite_if_offscreen,
} from "../../gen/routines";
import { cur, rd, wr, dec, inc, neg, snd, jsrAddr, jslAddr, registerSprite, registerRts, registerRtl } from "./b6ba_common";
import { lda, lo, ge, add } from "./w4_b6_util";
import { parseB6, move_sprite_in_y_to_sprite_in_x } from "./w4_b6_kudgel";
import { KROOL_EXIT } from "./w4_b6_krool_ammo";

/** `JSR ($0044,x)`: K. Rool's return code; CODE_B69E75 leaves his whole sprite code. */
function runReturnCode(): boolean {
  try {
    jsrAddr(B6 | rd(reg.x, 0x44));
  } catch (e) {
    if (e !== KROOL_EXIT) throw e;
    CODE_B68F33();
    return false;
  }
  return true;
}

const B6 = 0xb60000;
const DROPS_COUNT = L("DATA_B6906D");
const DROPS = lo("DATA_B6906F");
const PRIORITY_CYCLE = lo("DATA_B6905D");
const PRIORITY_TIMES = lo("DATA_B6905F");
const DESPAWN = lo("sprite_return_handle_despawn_B6");
const PROJECTILE = lo("DATA_FF1F8A");

let krDB = 0;
let gunDB = 0;

/** K. Rool's and his gun's animations. */
function anims(krool: number, gun: number) {
  reg.a = krool;
  set_sprite_animation();
  w16(R.alternate_sprite, r16(0x0656));
  reg.a = gun;
  set_alt_sprite_animation();
}

/** $B68D70 — K. Rool. First frame: set up the fight (soaked in Krocodile Kore). */
export function krool_sprite_code(): void {
  krDB = reg.db;
  reg.db = 0xb6;
  const x = cur();
  reg.x = x;
  reg.a = rd(x, 0x42);
  if (reg.a !== 0) return CODE_B68E88();
  CODE_B68D7C();
}

/** $B68D7C */
export function CODE_B68D7C(): void {
  CODE_B4AEAF();
  w16(0x0763, 0);
  let x = cur();
  reg.x = x;
  w16(0x073d, 0);
  wr(x, 0x32, 0);
  w16(0x06a1, 0);
  w16(0x06a3, 0);
  w16(0x06a5, 0);
  reg.y = C.special_sprite_spawn_id_00C2;
  spawn_special_sprite_index();
  const gun = r16(R.alternate_sprite);
  x = cur();
  reg.x = x;
  w16(0x0654, x);
  w16(0x0656, gun);
  wr(x, 0x42, gun);
  wr(x, 0x44, 0);
  reg.a = r16(R.level_number);
  if (reg.a !== C.level_krocodile_kore) return CODE_B68E56();
  CODE_B68DB3();
}

/** $B68DB3 — Krocodile Kore: K. Rool comes back soaked, dripping. */
export function CODE_B68DB3(): void {
  for (const s of [r16(R.active_kong_sprite), r16(R.inactive_kong_sprite), r16(0x0654), r16(0x0656)]) {
    reg.y = s;
    CODE_B68F37();
  }
  const x = reg.x;
  const gun = r16(0x0656);
  reg.y = gun;
  wr(x, 0x06, 0x02c8);
  wr(gun, 0x06, 0x02c8);
  wr(x, 0x0a, 0x01c1);
  wr(gun, 0x0a, 0x01c1);
  reg.a = C.krool_soaked_anim_id;
  set_sprite_animation();
  reg.a = C.krool_gun_soaked_anim_id;
  set_alt_sprite_animation();
  reg.x = cur();
  wr(reg.x, 0x46, lo("krool_rematch_start"));
  w16(0x0652, 0x0001);
  w16(0x070b, 0x0001);
  reg.y = C.special_sprite_spawn_id_0160;
  spawn_special_sprite_index();
  reg.y = r16(R.alternate_sprite);
  reg.x = cur();
  move_sprite_in_y_to_sprite_in_x();
  w16(0x0650, bus16(DROPS_COUNT));
  reg.a = DROPS;
  CODE_B68E1A();
}

/** $B68E1A — the water drops around him (A = their data). */
export function CODE_B68E1A(): void {
  do {
    const p = reg.a;
    reg.y = C.special_sprite_spawn_id_0162;
    spawn_no_gfx_special_sprite_index();
    const y = r16(R.alternate_sprite);
    reg.y = y;
    reg.x = cur();
    move_sprite_in_y_to_sprite_in_x();
    reg.x = p;
    wr(y, 0x06, add(rd(y, 0x06), lda(p)));
    wr(y, 0x0a, add(rd(y, 0x0a), lda(p + 2)));
    reg.a = lda(p + 4);
    wr(y, 0x42, reg.a);
    set_alt_sprite_animation();
    reg.x = p;
    reg.a = add(p, 0x0006);
  } while (dec(0, 0x0650) !== 0);
  CODE_B68E7E();
}

/** $B68E56 — K. Rool Duel: the first time Donkey is shot (intro), else straight to the fight. */
export function CODE_B68E56(): void {
  reg.a = 0x0004;
  if (!(r16(R.game_state_flags_2) & 0x0004)) return CODE_B68E63();
  reg.y = lo("krool_intro_phase");
  CODE_B68E6C();
}

/** $B68E63 */
export function CODE_B68E63(): void {
  w16(R.game_state_flags_2, r16(R.game_state_flags_2) | reg.a);
  CODE_B68F50();
  reg.y = lo("krool_dk_intro_phase");
  CODE_B68E6C();
}

/** $B68E6C */
export function CODE_B68E6C(): void {
  reg.x = cur();
  wr(reg.x, 0x46, reg.y);
  w16(0x0652, 0x0009);
  reg.a = 0x0003;
  w16(0x070b, 0x0003);
  CODE_B68E7E();
}

/** $B68E7E */
export function CODE_B68E7E(): void {
  w16(0x065a, 0);
  reg.x = cur();
  parseB6();
  CODE_B68E88();
}

/** $B68E88 */
export function CODE_B68E88(): void {
  const x = cur();
  reg.x = x;
  reg.a = rd(x, 0x2e);
  if (!(reg.a & 0x0001)) {
    reg.a = r16(R.time_stop_flags);
    if (reg.a & 0x0004) return CODE_B68F33();
  }
  CODE_B68E9C();
}

/** $B68E9C */
export function CODE_B68E9C(): void {
  reg.a = r16(0x0654);
  if (reg.a !== r16(0x0ae8)) CODE_B6A701();
  CODE_B68EA8();
}

/** $B68EA8 */
export function CODE_B68EA8(): void {
  reg.a = r16(0x0652);
  if (reg.a !== 0) return CODE_B68EBB();
  reg.a = r16(R.level_number);
  if (reg.a === C.level_krocodile_kore) return CODE_B68F44();
  CODE_B68EB8();
}

/** $B68EB8 */
export function CODE_B68EB8(): void {
  CODE_B68F2B();
}

/** $B68EBB — alive: touching K. Rool hurts; a barrel the Kong holds gets knocked away. */
export function CODE_B68EBB(): void {
  let x = cur();
  reg.x = x;
  wr(x, 0x2e, rd(x, 0x2e) & 0xfdff);
  wr(x, 0x32, 0);
  x = r16(0x0656);
  reg.x = x;
  if (x !== 0) wr(x, 0x32, 0);
  CODE_B68ECD();
}

/** $B68ECD */
export function CODE_B68ECD(): void {
  reg.x = cur();
  reg.a = r16(0x073d);
  if (reg.a === 0) return CODE_B68EDB();
  dec(0, 0x073d);
  CODE_B68F0F();
}

/** $B68EDB */
export function CODE_B68EDB(): void {
  reg.a = rd(reg.x, 0x2e);
  if (reg.a & 0x2000) return CODE_B68F0F();
  get_current_sprite_clipping();
  reg.a = 0x0000;
  check_complex_player_collision_B6();
  if (!reg.c) return CODE_B68F0F();
  reg.x = cur();
  w16(0x073d, 0x0014);
  reg.x = r16(R.current_held_sprite);
  if (reg.x === 0) return CODE_B68F0F();
  knockHeld();
  CODE_B68F0F();
}

/** The held barrel is knocked out of the Kong's hands (`LDA #$000B : STA $44,x ...`). */
function knockHeld() {
  CODE_B6A3A1();
  const x = reg.x;
  wr(x, 0x44, 0x000b);
  reg.a = rd(x, 0x2e) | 0x0010;
  wr(x, 0x2e, reg.a);
  release_held_sprite_from_kong();
}

/** $B68F0F — run the return code; parse the next command when done; the per-frame extras. */
export function CODE_B68F0F(): void {
  let x = cur();
  reg.x = x;
  reg.a = rd(x, 0x44);
  if (!runReturnCode()) return;
  x = cur();
  reg.x = x;
  reg.a = rd(x, 0x44);
  if (reg.a === 0) parseB6();
  CODE_B68F1F();
}

/** $B68F1F */
export function CODE_B68F1F(): void {
  CODE_B68F76();
  CODE_B68FE9();
  CODE_B68FD8();
  CODE_B68F9B();
  CODE_B68F2B();
}

/** $B68F2B */
export function CODE_B68F2B(): void {
  process_sprite_animation();
  CODE_B3E3E3();
  CODE_B68F33();
}

/** $B68F33 */
export function CODE_B68F33(): void {
  reg.db = krDB;
}

/** $B68F37 — sprite Y in front of the foreground (priority 3). */
export function CODE_B68F37(): void {
  reg.a = (rd(reg.y, 0x12) & 0xcfff) | 0x3000;
  wr(reg.y, 0x12, reg.a);
}

/** $B68F44 — defeated in Krocodile Kore: only the return code runs. */
export function CODE_B68F44(): void {
  reg.x = cur();
  if (!runReturnCode()) return;
  process_sprite_animation();
  CODE_B68F2B();
}

/** $B68F50 — spawn the tied-up Donkey Kong and his rope and bindings. */
export function CODE_B68F50(): void {
  reg.y = C.special_sprite_spawn_id_0140;
  spawn_special_sprite_index();
  reg.a = r16(R.alternate_sprite);
  w16(0x075f, reg.a);
  reg.y = C.special_sprite_spawn_id_011C;
  spawn_special_sprite_index();
  reg.y = r16(R.alternate_sprite);
  w16(0x075b, reg.y);
  reg.y = C.special_sprite_spawn_id_011E;
  spawn_special_sprite_index();
  reg.y = r16(R.alternate_sprite);
  w16(0x075d, reg.y);
}

/** $B68F76 — $06A3 bit 7: the vacuum is not (or no longer) pulling. */
export function CODE_B68F76(): void {
  reg.a = r16(0x072d);
  if (reg.a === 0 || ge(reg.a, 0x0078) || reg.a & 0x0004) return CODE_B68F8F();
  reg.a = r16(0x06a3) & 0xff7f;
  CODE_B68F96();
}

/** $B68F8F */
export function CODE_B68F8F(): void {
  reg.a = r16(0x06a3) | 0x0080;
  CODE_B68F96();
}

/** $B68F96 */
export function CODE_B68F96(): void {
  w16(0x06a3, reg.a);
}

/** $B68F9B — a hit star over the Kong when he gets hurt (state $5D). */
export function CODE_B68F9B(): void {
  const x = cur();
  reg.x = x;
  reg.y = r16(R.active_kong_sprite);
  reg.a = rd(reg.y, 0x2e);
  if (reg.a === 0x005d) return CODE_B68FD0();
  reg.a = rd(x, 0x2e);
  if (reg.a & 0x4000) {
    wr(x, 0x2e, reg.a & 0xbfff);
    reg.y = lo("DATA_FF103A");
    spawn_special_sprite_address();
    const y = r16(R.alternate_sprite);
    reg.y = y;
    const k = r16(R.active_kong_sprite);
    reg.x = k;
    wr(y, 0x06, rd(k, 0x06));
    reg.a = (rd(k, 0x0a) - 0x0010) & 0xffff;
    wr(y, 0x0a, reg.a);
  }
  CODE_B68FD7();
}

/** $B68FD0 */
export function CODE_B68FD0(): void {
  reg.a = rd(reg.x, 0x2e) | 0x4000;
  wr(reg.x, 0x2e, reg.a);
  CODE_B68FD7();
}

/** $B68FD7 */
export function CODE_B68FD7(): void {}

/** $B68FD8 — forget the DK barrel once it is gone. */
export function CODE_B68FD8(): void {
  reg.y = r16(0x073b);
  if (reg.y === 0) return CODE_B68FE8();
  reg.a = lda(reg.y);
  if (reg.a !== C.sprite_dk_barrel) w16(0x073b, 0);
  CODE_B68FE8();
}

/** $B68FE8 */
export function CODE_B68FE8(): void {}

/** $B68FE9 — the priority cycle (K. Rool walking behind/in front of the scenery). */
export function CODE_B68FE9(): void {
  let x = cur();
  reg.x = x;
  reg.a = rd(x, 0x4c);
  if (reg.a === 0) return CODE_B69042();
  if (dec(x, 0x4c) !== 0) return CODE_B69042();
  reg.a = (rd(x, 0x4e) + 1) & 0x0003;
  wr(x, 0x4e, reg.a);
  const y = (reg.a << 2) & 0xffff;
  reg.y = y;
  const prio = lda(PRIORITY_CYCLE + y);
  wr(x, 0x12, (rd(x, 0x12) & 0xcfff) | prio);
  x = r16(0x0656);
  reg.x = x;
  wr(x, 0x12, (rd(x, 0x12) & 0xcfff) | prio);
  x = cur();
  reg.x = x;
  wr(x, 0x4c, lda(PRIORITY_TIMES + y));
  reg.a = prio;
  if (reg.a !== 0) return CODE_B69034();
  reg.a = 0xc000;
  wr(x, 0x1c, reg.a);
  reg.x = r16(0x0656);
  wr(reg.x, 0x1c, reg.a);
  reg.x = r16(0x072b);
  if (reg.x !== 0) wr(reg.x, 0x1c, reg.a);
  CODE_B69042();
}

/** $B69034 */
export function CODE_B69034(): void {
  wr(reg.x, 0x1c, 0);
  reg.x = r16(0x0656);
  wr(reg.x, 0x1c, 0);
  reg.x = r16(0x072b);
  if (reg.x !== 0) wr(reg.x, 0x1c, 0);
  CODE_B69042();
}

/** $B69042 */
export function CODE_B69042(): void {}

/** $B69043 — animation callback: next command, back to idle (leaves DB = $B6). */
export function CODE_B69043(): void {
  reg.db = 0xb6;
  parseB6();
  anims(C.krool_idle_anim_id, C.krool_gun_idle_anim_id);
}

/** $B69397 — K. Rool's gun (the dangerous part while he swings it). */
export function krool_gun_sprite_code(): void {
  reg.x = r16(0x0654);
  reg.a = rd(reg.x, 0x2e);
  if (!(reg.a & 0x0001)) {
    reg.a = r16(R.time_stop_flags);
    if (reg.a & 0x0004) return CODE_B69490();
  }
  CODE_B693AC();
}

/** $B693AC */
export function CODE_B693AC(): void {
  gunDB = reg.db;
  reg.db = 0xb6;
  reg.a = r16(0x0652);
  if (reg.a === 0) return CODE_B6948B();
  CODE_B693B8();
}

/** $B693B8 */
export function CODE_B693B8(): void {
  reg.x = r16(0x0654);
  reg.a = r16(0x073d);
  if (reg.a !== 0) return CODE_B6948B();
  CODE_B693C4();
}

/** $B693C4 */
export function CODE_B693C4(): void {
  reg.a = rd(reg.x, 0x2e);
  if (!(reg.a & 0x0001)) return CODE_B693DE();
  get_current_sprite_clipping();
  reg.a = 0x0010;
  const p = R.sprite_collision_routine_address;
  jslAddr(r16(p) | (r8(p + 2) << 16));
  CODE_B693D9();
}

/** $B693D9 */
export function CODE_B693D9(): void {
  if (reg.c) return CODE_B693FB();
  CODE_B6948B();
}

/** $B693DE */
export function CODE_B693DE(): void {
  reg.x = r16(0x0654);
  reg.a = rd(reg.x, 0x2e);
  if (reg.a & 0x2000) return CODE_B6948B();
  CODE_B693EB();
}

/** $B693EB */
export function CODE_B693EB(): void {
  get_current_sprite_clipping();
  reg.a = 0x0000;
  check_complex_player_collision_B6();
  if (reg.c) return CODE_B693FB();
  CODE_B6948B();
}

/** $B693FB */
export function CODE_B693FB(): void {
  w16(0x073d, 0x0014);
  reg.x = r16(R.current_held_sprite);
  if (reg.x !== 0) knockHeld();
  CODE_B69419();
}

/** $B69419 — the swinging gun knocks the Kong off his buddy and away. */
export function CODE_B69419(): void {
  reg.x = r16(0x0654);
  reg.a = rd(reg.x, 0x2e);
  if (!(reg.a & 0x0001)) return CODE_B6945B();
  reg.y = r16(R.active_kong_sprite);
  reg.a = rd(reg.y, 0x30);
  if (reg.a & 0x0080) return CODE_B6945B();
  CODE_B6800D();
  reg.a = C.player_interaction_26;
  set_player_interaction_global();
  if (reg.c) return CODE_B6945B();
  reg.x = r16(0x0654);
  reg.a = rd(reg.x, 0x12);
  if (reg.a & 0x4000) return CODE_B6944F();
  w16(R.interaction_RAM_0A86, 0x0600);
  reg.a = 0x0700;
  CODE_B69458();
}

/** $B6944F */
export function CODE_B6944F(): void {
  w16(R.interaction_RAM_0A86, 0xfa00);
  reg.a = 0xf900;
  CODE_B69458();
}

/** $B69458 */
export function CODE_B69458(): void {
  w16(R.interaction_RAM_0A88, reg.a);
  CODE_B6945B();
}

/** $B6945B */
export function CODE_B6945B(): void {
  CODE_B6948B();
}

/** $B6948B */
export function CODE_B6948B(): void {
  process_sprite_animation();
  reg.db = gunDB;
  CODE_B69490();
}

/** $B69490 */
export function CODE_B69490(): void {}

// ---- projectile spawners (krool_projectile_type_table / shot tables; X = index on entry) ----

/** Spawn a projectile in front of the gun: sound, sprite, start position. Y = projectile. */
function fire(spawn: () => void) {
  reg.a = snd(5, "barrel_blast");
  queue_sound_effect();
  spawn();
  init_krool_projectile_position();
}
const spawnAddr = (a: number) => () => {
  reg.y = a;
  spawn_special_sprite_address();
};
const spawnIdx = (id: number) => () => {
  reg.y = id;
  spawn_special_sprite_index();
};

/** x speed $0300 forward; A = 0 (the max x speed written next). */
function forward300() {
  wr(reg.y, 0x20, rd(reg.x, 0x12) & 0x4000 ? 0xfd00 : 0x0300);
  reg.a = 0x0000;
}

/** $B6949C — a cannonball rolling forward. */
export function CODE_B6949C(): void {
  fire(spawnAddr(PROJECTILE));
  const y = reg.y;
  wr(y, 0x2e, rd(y, 0x2e) | 0x0090);
  forward300();
  wr(y, 0x26, reg.a);
  wr(y, 0x42, 0x0005);
  wr(y, 0x44, 0x0003);
  wr(y, 0x24, 0x0000);
  wr(y, 0x2a, 0x0200);
  reg.a = 0x0001;
  wr(y, 0x46, 0x0001);
}

/** $B694F3 — the spikeball. */
export function CODE_B694F3(): void {
  fire(spawnAddr(PROJECTILE));
  const y = reg.y;
  wr(y, 0x2e, rd(y, 0x2e) | 0x0200);
  w16(0x0735, y);
  CODE_B69557();
  if (rd(reg.x, 0x12) & 0x4000) return CODE_B69525();
  wr(y, 0x20, 0x0300);
  reg.a = 0x0000;
  CODE_B6952E();
}

/** $B69525 */
export function CODE_B69525(): void {
  wr(reg.y, 0x20, 0xfd00);
  reg.a = 0x0000;
  CODE_B6952E();
}

/** $B6952E */
export function CODE_B6952E(): void {
  const y = reg.y;
  wr(y, 0x26, reg.a);
  wr(y, 0x42, 0x0005);
  wr(y, 0x44, 0x0003);
  wr(y, 0x24, 0x0000);
  wr(y, 0x2a, 0x0200);
  wr(y, 0x46, 0x001a);
  reg.a = C.krool_spikeball_retracted_anim_id;
  set_alt_sprite_animation();
}

/** $B69557 */
export function CODE_B69557(): void {
  reg.a = rd(reg.y, 0x2e) | 0x0092;
  wr(reg.y, 0x2e, reg.a);
}

/** $B69561 — the last ball of the volley becomes the spikeball (if there is none). */
export function CODE_B69561(): void {
  wr(reg.y, 0x46, 0x0008);
  reg.a = r16(0x0735);
  if (reg.a === 0) w16(0x0735, reg.y);
  CODE_B69570();
}

/** $B69570 */
export function CODE_B69570(): void {
  CODE_B695AC();
}

/** $B69572 — a volley of balls; on odd frames one becomes the spikeball. */
export function CODE_B69572(): void {
  fire(spawnAddr(PROJECTILE));
  const y = reg.y;
  wr(y, 0x2e, rd(y, 0x2e) | 0x0200);
  reg.a = r16(0x0727);
  if (reg.a === 0x0001) return CODE_B69561();
  wr(y, 0x46, 0x002e);
  w16(0x0729, 0x002d);
  reg.a = r16(R.active_frame_counter);
  if (reg.a & 0x0001) w16(0x0735, y);
  CODE_B695AC();
}

/** $B695AC */
export function CODE_B695AC(): void {
  CODE_B69557();
  if (rd(reg.x, 0x12) & 0x4000) return CODE_B695C1();
  wr(reg.y, 0x20, 0x0300);
  reg.a = 0x0000;
  CODE_B695CA();
}

/** $B695C1 */
export function CODE_B695C1(): void {
  wr(reg.y, 0x20, 0xfd00);
  reg.a = 0x0000;
  CODE_B695CA();
}

/** $B695CA */
export function CODE_B695CA(): void {
  const y = reg.y;
  wr(y, 0x26, reg.a);
  wr(y, 0x42, 0x0005);
  wr(y, 0x44, 0x0003);
  wr(y, 0x24, 0x0000);
  wr(y, 0x2a, 0x0200);
  reg.a = 0x0289;
  set_alt_sprite_animation();
}

/** Next entry of the projectile table ($0737; DB = its bank): x speeds, signed by facing. */
function tableSpeeds(withFlip4C: boolean): number {
  CODE_B6D923();
  const facing = rd(reg.x, 0x12);
  const t = r16(0x0737);
  reg.x = t;
  const y = reg.y;
  const s = (v: number) => (facing & 0x4000 ? neg(v) : v);
  if (withFlip4C) wr(y, 0x4c, s(lda(t + 0x0a)));
  wr(y, 0x20, s(lda(t)));
  reg.a = s(lda(t + 4));
  return t;
}

/** Shot table tail with A = max x speed (CODE_B6964F/CODE_B6983F layout, 16-byte entries). */
function tail16(t: number) {
  const y = reg.y;
  wr(y, 0x26, reg.a);
  wr(y, 0x42, lda(t + 8));
  wr(y, 0x44, lda(t + 0x0a));
  wr(y, 0x24, lda(t + 2));
  wr(y, 0x2a, lda(t + 6));
  w16(0x0729, lda(t + 0x0c));
  wr(y, 0x0a, add(rd(y, 0x0a), lda(t + 0x0e)));
  reg.a = add(t, 0x0010);
  w16(0x0737, reg.a);
  reg.db = 0xb6;
}

/** $B695ED — a gas cloud (the first of the volley is the spikeball when there is none). */
export function CODE_B695ED(): void {
  reg.a = r16(0x0727);
  if (reg.a === 0x0001) {
    CODE_B69687();
    if (!reg.c) return CODE_B69610();
  }
  CODE_B695FB();
}

/** $B695FB */
export function CODE_B695FB(): void {
  reg.a = snd(5, "barrel_blast");
  queue_sound_effect();
  reg.y = C.special_sprite_spawn_id_0186;
  spawn_special_sprite_index();
  reg.a = 0x0282;
  set_alt_sprite_animation();
  CODE_B69610();
}

/** $B69610 */
export function CODE_B69610(): void {
  init_krool_projectile_position();
  reg.a = r16(R.level_number);
  if (reg.a === C.level_krocodile_kore) CODE_B68F37();
  CODE_B6961D();
}

/** $B6961D */
export function CODE_B6961D(): void {
  const y = reg.y;
  wr(y, 0x2e, rd(y, 0x2e) | 0x0091);
  const t = tableSpeeds(false);
  tail16(t);
}

/** $B6963E — (facing left: speeds negated; reached through CODE_B6961D). */
export function CODE_B6963E(): void {
  const t = reg.x;
  wr(reg.y, 0x20, neg(lda(t)));
  reg.a = neg(lda(t + 4));
  CODE_B6964F();
}

/** $B6964F */
export function CODE_B6964F(): void {
  tail16(reg.x);
}

/** $B69687 — spawn the spikeball unless there is one (carry set then). */
export function CODE_B69687(): void {
  reg.a = r16(0x0735);
  if (reg.a !== 0) return CODE_B696B3();
  reg.y = C.special_sprite_spawn_id_0184;
  spawn_special_sprite_index();
  reg.a = snd(5, "barrel_blast");
  queue_sound_effect();
  const y = r16(R.alternate_sprite);
  reg.y = y;
  w16(0x0735, y);
  reg.a = rd(y, 0x20);
  if (!(reg.a & 0x8000)) return CODE_B696AA();
  reg.a = 0x027d;
  CODE_B696AD();
}

/** $B696AA */
export function CODE_B696AA(): void {
  reg.a = 0x0281;
  CODE_B696AD();
}

/** $B696AD */
export function CODE_B696AD(): void {
  set_alt_sprite_animation();
  reg.c = false;
}

/** $B696B3 */
export function CODE_B696B3(): void {
  reg.c = true;
}

/** $B696B5 — a gas cloud with a homing path (18-byte entries). */
export function CODE_B696B5(): void {
  reg.a = r16(0x0727);
  if (reg.a === 0x0001) {
    CODE_B69687();
    if (!reg.c) return CODE_B696D8();
  }
  CODE_B696C3();
}

/** $B696C3 */
export function CODE_B696C3(): void {
  reg.a = snd(5, "barrel_blast");
  queue_sound_effect();
  reg.y = C.special_sprite_spawn_id_0186;
  spawn_special_sprite_index();
  reg.a = 0x0282;
  set_alt_sprite_animation();
  CODE_B696D8();
}

/** $B696D8 */
export function CODE_B696D8(): void {
  init_krool_projectile_position();
  const y = reg.y;
  wr(y, 0x2e, rd(y, 0x2e) | 0x0092);
  tableSpeeds(false);
  CODE_B6970D();
}

/** $B696FC */
export function CODE_B696FC(): void {
  const t = reg.x;
  wr(reg.y, 0x20, neg(lda(t)));
  reg.a = neg(lda(t + 4));
  CODE_B6970D();
}

/** $B6970D */
export function CODE_B6970D(): void {
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
  reg.db = 0xb6;
}

/** Tail of the swirling shots (CODE_B697AF / CODE_B698CA, 18-byte entries). */
function swirlTail(t: number) {
  const y = reg.y;
  wr(y, 0x26, reg.a);
  wr(y, 0x4a, lda(t + 8));
  wr(y, 0x48, lda(t + 0x0c));
  wr(y, 0x46, DESPAWN);
  wr(y, 0x24, lda(t + 2));
  wr(y, 0x2a, lda(t + 6));
  reg.a = add(rd(y, 0x0a), lda(t + 0x10));
  wr(y, 0x0a, reg.a);
  wr(y, 0x28, reg.a);
  wr(y, 0x22, rd(y, 0x06));
  w16(0x0729, lda(t + 0x0e));
  wr(y, 0x52, 0x000a);
  reg.a = add(t, 0x0012);
  w16(0x0737, reg.a);
  reg.db = 0xb6;
}

/** $B69747 — swirling gas clouds. */
export function CODE_B69747(): void {
  reg.a = r16(0x0727);
  if (reg.a === 0x0001) {
    CODE_B69687();
    if (!reg.c) return CODE_B6976A();
  }
  CODE_B69755();
}

/** $B69755 */
export function CODE_B69755(): void {
  reg.a = snd(5, "barrel_blast");
  queue_sound_effect();
  reg.y = C.special_sprite_spawn_id_0186;
  spawn_special_sprite_index();
  reg.a = 0x0282;
  set_alt_sprite_animation();
  CODE_B6976A();
}

/** $B6976A */
export function CODE_B6976A(): void {
  init_krool_projectile_position();
  const y = reg.y;
  wr(y, 0x2e, rd(y, 0x2e) | 0x0290);
  tableSpeeds(true);
  CODE_B697AF();
}

/** $B69794 */
export function CODE_B69794(): void {
  const t = reg.x;
  wr(reg.y, 0x4c, neg(lda(t + 0x0a)));
  wr(reg.y, 0x20, neg(lda(t)));
  reg.a = neg(lda(t + 4));
  CODE_B697AF();
}

/** $B697AF */
export function CODE_B697AF(): void {
  swirlTail(reg.x);
}

/** $B697FC — slow spikeballs. */
export function CODE_B697FC(): void {
  fire(spawnIdx(C.special_sprite_spawn_id_0182));
  const y = reg.y;
  wr(y, 0x2e, rd(y, 0x2e) | 0x0490);
  CODE_B69816();
}

/** $B69816 */
export function CODE_B69816(): void {
  tableSpeeds(false);
  CODE_B6983F();
}

/** $B6982E */
export function CODE_B6982E(): void {
  const t = reg.x;
  wr(reg.y, 0x20, neg(lda(t)));
  reg.a = neg(lda(t + 4));
  CODE_B6983F();
}

/** $B6983F */
export function CODE_B6983F(): void {
  tail16(reg.x);
}

/** $B69877 — swirling spikeballs. */
export function CODE_B69877(): void {
  fire(spawnIdx(C.special_sprite_spawn_id_017E));
  const y = reg.y;
  wr(y, 0x2e, rd(y, 0x2e) | 0x1090);
  tableSpeeds(true);
  CODE_B698CA();
}

/** $B698AF */
export function CODE_B698AF(): void {
  const t = reg.x;
  wr(reg.y, 0x4c, neg(lda(t + 0x0a)));
  wr(reg.y, 0x20, neg(lda(t)));
  reg.a = neg(lda(t + 4));
  CODE_B698CA();
}

/** $B698CA */
export function CODE_B698CA(): void {
  swirlTail(reg.x);
}

/** $B69917 — bouncing gas clouds. */
export function CODE_B69917(): void {
  fire(spawnIdx(C.special_sprite_spawn_id_0186));
  const y = reg.y;
  wr(y, 0x2e, rd(y, 0x2e) | 0x4090);
  tableSpeeds(false);
  CODE_B6995A();
}

/** $B69949 */
export function CODE_B69949(): void {
  const t = reg.x;
  wr(reg.y, 0x20, neg(lda(t)));
  reg.a = neg(lda(t + 4));
  CODE_B6995A();
}

/** $B6995A */
export function CODE_B6995A(): void {
  const t = reg.x;
  const y = reg.y;
  wr(y, 0x26, reg.a);
  wr(y, 0x42, lda(t + 8));
  wr(y, 0x44, lda(t + 0x0a));
  wr(y, 0x24, lda(t + 2));
  wr(y, 0x2a, lda(t + 6));
  w16(0x0729, lda(t + 0x0c));
  wr(y, 0x0a, add(rd(y, 0x0a), lda(t + 0x0e)));
  reg.a = lda(t + 0x10);
  wr(y, 0x46, reg.a);
  wr(y, 0x48, reg.a);
  wr(y, 0x4a, 0);
  w16(0x0737, add(t, 0x0012));
  reg.a = 0x0282;
  set_alt_sprite_animation();
  reg.db = 0xb6;
}

/** $B699A8 — (unused) slow spikeballs from the swirling sprite. */
export function CODE_B699A8(): void {
  fire(spawnIdx(C.special_sprite_spawn_id_017E));
  const y = reg.y;
  wr(y, 0x2e, rd(y, 0x2e) | 0x0490);
  CODE_B69816();
}

/** $B699C5 — the projectile (alternate sprite) at the gun's muzzle. X = K. Rool, Y = it. */
export function init_krool_projectile_position(): void {
  const x = cur();
  const y = r16(R.alternate_sprite);
  reg.x = x;
  reg.y = y;
  wr(y, 0x0a, add(rd(x, 0x0a), 0xfff5));
  reg.a = rd(x, 0x12) & 0x4000 ? add(rd(x, 0x06), 0xffd8) : (rd(x, 0x06) - 0xffd8) & 0xffff;
  wr(y, 0x06, reg.a);
}

/** $B699EB — Donkey Kong shot out of the gun: flies until he hits the bindings' sprite. */
export function shot_donkey_kong_sprite_code(): void {
  let x = cur();
  reg.a = rd(x, 0x42);
  interpolate_x_velocity_global();
  x = cur();
  reg.x = x;
  reg.a = rd(x, 0x44);
  interpolate_y_velocity_global();
  apply_position_from_velocity_global();
  x = cur();
  reg.x = x;
  reg.a = rd(x, 0x46);
  if (reg.a === 0) {
    get_current_sprite_clipping();
    reg.a = 0x0200;
    check_for_sprite_collisions();
    if (reg.c) {
      inc(0, 0x0763);
      const y = r16(0x075f);
      reg.y = y;
      w16(R.alternate_sprite, y);
      wr(y, 0x2e, 0x0001);
      wr(y, 0x42, 0xa609);
      reg.a = 0x0252;
      set_alt_sprite_animation();
      w16(R.alternate_sprite, r16(0x075b));
      reg.a = 0x0253;
      set_alt_sprite_animation();
      x = cur();
      reg.x = x;
      inc(x, 0x46);
      wr(x, 0x20, 0x0300);
      wr(x, 0x26, 0);
      wr(x, 0x24, 0xf200);
      reg.a = 0x0a00;
      wr(x, 0x2a, 0x0a00);
    }
  }
  process_sprite_animation();
  delete_sprite_if_offscreen();
}

void sprite;
void forward300;

registerSprite({
  krool_sprite_code, CODE_B68D7C, CODE_B68DB3, CODE_B68E1A, CODE_B68E56, CODE_B68E63, CODE_B68E6C, CODE_B68E7E,
  CODE_B68E88, CODE_B68E9C, CODE_B68EA8, CODE_B68EB8, CODE_B68EBB, CODE_B68ECD, CODE_B68EDB, CODE_B68F0F,
  CODE_B68F1F, CODE_B68F2B, CODE_B68F33, CODE_B68F44, krool_gun_sprite_code, CODE_B693AC, CODE_B693B8,
  CODE_B693C4, CODE_B693D9, CODE_B693DE, CODE_B693EB, CODE_B693FB, CODE_B69419, CODE_B6944F, CODE_B69458,
  CODE_B6945B, CODE_B6948B, CODE_B69490, shot_donkey_kong_sprite_code,
});
registerRts({
  CODE_B68F37, CODE_B68F50, CODE_B68F76, CODE_B68F8F, CODE_B68F96, CODE_B68F9B, CODE_B68FD0, CODE_B68FD7,
  CODE_B68FD8, CODE_B68FE8, CODE_B68FE9, CODE_B69034, CODE_B69042, CODE_B6949C, CODE_B694F3, CODE_B69525,
  CODE_B6952E, CODE_B69557, CODE_B69561, CODE_B69570, CODE_B69572, CODE_B695AC, CODE_B695C1, CODE_B695CA,
  CODE_B695ED, CODE_B695FB, CODE_B69610, CODE_B6961D, CODE_B6963E, CODE_B6964F, CODE_B69687, CODE_B696AA,
  CODE_B696AD, CODE_B696B3, CODE_B696B5, CODE_B696C3, CODE_B696D8, CODE_B696FC, CODE_B6970D, CODE_B69747,
  CODE_B69755, CODE_B6976A, CODE_B69794, CODE_B697AF, CODE_B697FC, CODE_B69816, CODE_B6982E, CODE_B6983F,
  CODE_B69877, CODE_B698AF, CODE_B698CA, CODE_B69917, CODE_B69949, CODE_B6995A, CODE_B699A8,
  init_krool_projectile_position,
});
registerRtl({ CODE_B69043 });
