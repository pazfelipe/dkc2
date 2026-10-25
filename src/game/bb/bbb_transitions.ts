/**
 * Bank $BB (part b) — leaving a level: exits through destinations (bonus barrels, doors, warps,
 * level goals), returning from bonus/sub levels, leaving to the world map after dying or from
 * the pause menu, the map unlock queue ($06D7: count, then 4-byte entries at $06D9:
 * from-level, to-level, flags) and the 2-player handover.
 *
 * Most paths here end the frame (JML init_world_map / set_game_mode_and_return / WAI): in the
 * port the call is the last statement and the routine returns.
 */
import { r16, w16, rom16, bus16 } from "../../core/mem";
import { reg, register, callPtr } from "../../core/cpu";
import { setRetMode, RET_RTS, RET_RTL, endFrame } from "../../core/hybrid";
import { L, R, C, level } from "../../core/sym";
import {
  init_world_map,
  set_game_mode_and_return,
  restart_rareware_logo,
  swap_active_kong_global,
  throw_exception,
  CODE_BBAF0C,
  CODE_BBAF0F,
  CODE_BBBD8E,
  CODE_BBC85B,
  CODE_BBC736,
} from "../../gen/routines";

const EXIT_BY_TYPE = L("DATA_BBBE92");
const ENTER_BY_TYPE = L("DATA_BBBF22");
const ANIMALS = L("DATA_BBC070");
const LEVEL_1 = level._base + 0x3e; // level[1]: config of the destination being entered
const lbl16 = (n: string) => L(n) & 0xffff;
const tsb = (a: number, m: number) => w16(a, r16(a) | m);
const trb = (a: number, m: number) => w16(a, r16(a) & ~m & 0xffff);

function toWorldMap() {
  reg.a = r16(R.world_number);
  init_world_map();
}

/** $BBBDC4 — leave the level from the pause menu (exit to map). */
export function CODE_BBBDC4() {
  reg.db = 0xbb;
  CODE_BBC0A4();
  CODE_BBC007();
  w16(0x06cf, 0x0003);
  w16(0x06d1, 0x000a);
  tsb(0x06a3, 0x0040);
  w16(0x06ad, 0);
  w16(0x06af, 0);
  w16(R.animal_type, 0);
  w16(R.current_player_mount, 0);
  const parent = r16(R.parent_level_number);
  w16(R.temp_level_number, parent);
  w16(R.level_number, parent);
  w16(R.collected_kong_letters, 0);
  w16(R.level_entrance_number, 0);
  toWorldMap();
}

/** $BBBE01 — take the level exit in level_destination_number (after a reset-vector check). */
export function CODE_BBBE01() {
  w16(0x28, 0x00c0);
  w16(0x26, 0x2139);
  reg.y = 0xdec3;
  // the reset vector at $C0FFFC, disguised; a tampered ROM sends every exit to the map
  if (((bus16(0xc0fffc) - 0x1248) & 0xffff) !== 0x71af) w16(R.level_destination_number, rom16(L("DATA_BBBE43")));
  CODE_BBBE24();
}

/** $BBBE24 */
export function CODE_BBBE24() {
  CODE_BBBE28();
}

/** $BBBE28 — reload the current level's config and run the exit handler of its type. */
export function CODE_BBBE28() {
  const savedDb = reg.db;
  reg.db = 0xbb;
  CODE_BBC0A4();
  const e = r16(R.level_entrance_number);
  reg.a = (((e >> 8) | (e << 8)) & 0xffff) | r16(R.level_number);
  CODE_BBAF0C();
  w16(0x06cf, 0x0001);
  reg.a = r16(R.level_destination_number);
  if (reg.a === 0xffff) return CODE_BBBE54();
  reg.x = (r16(level.type) & 0x0007) << 1;
  callPtr(0xbb, rom16(EXIT_BY_TYPE + reg.x));
  reg.db = savedDb;
}

/** $BBBE54 — no destination: back to the world map (game over when out of lives). */
export function CODE_BBBE54() {
  tsb(R.exiting_sub_level_flag, 0x8000);
  w16(R.level_entrance_number, 0);
  w16(R.animal_type, 0);
  w16(R.current_player_mount, 0);
  w16(R.collected_kong_letters, 0);
  const parent = r16(R.parent_level_number);
  w16(R.temp_level_number, parent);
  w16(R.level_number, parent);
  trb(0x06d1, 0x0003);
  if (r16(R.life_count) & 0x8000) {
    reg.a = lbl16("init_game_over_screen");
    set_game_mode_and_return();
    return;
  }
  CODE_BBBE7E();
}

/** $BBBE7E */
export function CODE_BBBE7E() {
  tsb(0x06d1, 0x0002);
  w16(R.level_destination_number, 0);
  CODE_BBBED7();
  toWorldMap();
}

/** $BBBEA0 — after the game over screen: 2-player contest hands over, else restart. */
export function restart_logo_or_world_map() {
  if (r16(R.current_game_mode) !== C.gamemode_2_player_contest) return restart_logo_or_world_map_restart_logo();
  CODE_BBC85B();
  if (r16(R.life_count) & 0x8000) return restart_logo_or_world_map_restart_logo();
  CODE_BBC85B();
  CODE_BBC736();
  tsb(0x06d1, 0x0002);
  trb(0x06d1, 0x0005);
  w16(R.level_destination_number, 0);
  CODE_BBBED7();
  toWorldMap();
}

/** $BBBED3 */
export function restart_logo_or_world_map_restart_logo() {
  restart_rareware_logo();
}

/** $BBBED7 — 2-player: contest flags the turn change, team swaps the Kongs. */
export function CODE_BBBED7() {
  reg.a = r16(R.current_game_mode);
  if (reg.a === C.gamemode_2_player_contest) {
    reg.a = r16(R.game_state_flags) & 0x1000;
    if (reg.a === 0) {
      reg.a = 0x0004;
      tsb(0x06d1, 0x0004);
      return;
    }
  }
  CODE_BBBEEE();
}

/** $BBBEED */
export function CODE_BBBEED() {}

/** $BBBEEE — A = game mode (or flag): team mode swaps the active Kong. */
export function CODE_BBBEEE() {
  if (reg.a !== C.gamemode_2_player_team) return;
  swap_active_kong_global();
}

/** $BBBEF8 — normal level exit: load the destination's config into level[1] and enter it. */
export function CODE_BBBEF8() {
  CODE_BBC116();
  reg.x = (r16(R.level_destination_number) << 1) & 0xffff;
  const dest = r16(level.destinations + reg.x) & 0x01ff;
  w16(R.temp_level_number, dest);
  const e = r16(R.destination_level_entrance_number);
  reg.a = (((e >> 8) | (e << 8)) & 0xffff) | dest;
  reg.x = LEVEL_1;
  CODE_BBAF0F();
  reg.x = (r16(LEVEL_1) & 0x0007) << 1;
  callPtr(0xbb, rom16(ENTER_BY_TYPE + reg.x));
}

/** $BBBF30 — the destination is another level: finish this one and go to the map. */
export function CODE_BBBF30() {
  for (const a of [R.collected_kong_letters, R.level_entrance_number, R.animal_type, R.current_player_mount, R.checkpoint_level_entrance_number, R.checkpoint_level_number, R.checkpoint_animal_type, R.checkpoint_collected_kong_letters]) w16(a, 0);
  if (r16(R.parent_level_number) !== r16(R.temp_level_number)) {
    w16(0x06cf, (r16(R.active_kong_number) + 2) & 0xffff);
    reg.y = r16(R.parent_level_number);
    reg.a = r16(R.temp_level_number);
    CODE_BBC0DD(); // unlock the path parent -> destination
    CODE_BBC07E(); // and the level's extra unlocks
  }
  CODE_BBBF65();
}

/** $BBBF65 */
export function CODE_BBBF65() {
  const t = r16(R.temp_level_number);
  w16(R.level_number, t);
  w16(R.parent_level_number, t);
  w16(R.level_entrance_number, 0);
  trb(R.exiting_sub_level_flag, 0x8000);
  CODE_BBBED7();
  toWorldMap();
}

/** $BBBF81 — enter a bonus / sub level (remembering where to come back to). */
export function CODE_BBBF81() {
  CODE_BBBD8E();
  w16(R.returning_level_number, r16(R.level_number));
  w16(R.returning_entrance_number, r16(R.destination_level_entrance_number));
  w16(R.level_number, r16(R.temp_level_number));
  w16(R.level_entrance_number, 0);
  const bonus = r16(LEVEL_1 + 0x18) & 0x00ff; // level[1].bonus_type
  if (r16(LEVEL_1) === C.bonus_level_type && bonus !== 0) {
    // bonus levels with a title screen ("Find the token!" etc.)
    w16(0x067d, lbl16("init_bonus_screen"));
    w16(0x0650, ((r16(LEVEL_1 + 0x18) & 0x0003) - 1) & 0xffff);
    reg.a = lbl16("run_bonus_and_credits_screen");
    w16(R.nmi_pointer, reg.a);
    return CODE_BBBFBE();
  }
  CODE_BBBFC1();
}

/** $BBBFBE — WAI forever: the NMI runs the bonus screen from now on. */
export function CODE_BBBFBE() {
  endFrame();
}

/** $BBBFC1 */
export function CODE_BBBFC1() {
  reg.a = lbl16("CODE_8087E1");
  set_game_mode_and_return();
}

/** $BBBFC8 — destination of type 6: load it directly. */
export function CODE_BBBFC8() {
  w16(R.level_number, r16(R.temp_level_number));
  w16(R.level_entrance_number, 0);
  trb(R.exiting_sub_level_flag, 0x8000);
  reg.a = lbl16("CODE_8087E1");
  set_game_mode_and_return();
}

/** $BBBFDD — leaving a bonus level: restore bananas and the level's animal, then return. */
export function CODE_BBBFDD() {
  CODE_BBC007();
  CODE_BBC059();
  CODE_BBBFE3();
}

/** $BBBFE3 — back to the level (and entrance) the bonus/sub level was entered from. */
export function CODE_BBBFE3() {
  tsb(R.exiting_sub_level_flag, 0x8000);
  w16(R.temp_level_number, r16(R.returning_level_number));
  w16(R.level_entrance_number, r16(R.returning_entrance_number));
  w16(R.level_number, r16(R.temp_level_number));
  tsb(R.game_state_flags, 0x0080);
  reg.a = lbl16("CODE_8087E1");
  set_game_mode_and_return();
}

/** $BBC007 — restore the banana count saved in $19D8 (bit 15 = saved). */
export function CODE_BBC007() {
  const v = r16(0x19d8);
  w16(0x19d8, v & 0x7fff);
  if (!(v & 0x8000)) return;
  reg.a = v & 0x7fff;
  w16(R.banana_count, reg.a);
  w16(R.banana_counter_current, reg.a);
}

/** $BBC018 */
export function CODE_BBC018() {}

/** $BBC019 — boss beaten: unlock and go to the world map. */
export function CODE_BBC019() {
  w16(0x06cf, (r16(R.active_kong_number) + 2) & 0xffff);
  w16(0x06d1, 0x0001);
  w16(R.animal_type, 0);
  w16(R.current_player_mount, 0);
  CODE_BBC07E();
  w16(level.type, r16(0x06d9));
  w16(R.temp_level_number, r16(0x06db));
  w16(R.level_entrance_number, 0);
  trb(R.exiting_sub_level_flag, 0x8000);
  CODE_BBBED7();
  reg.a = 0;
  init_world_map();
}

/** $BBC053 */
export function CODE_BBC053() {
  CODE_BBBEF8();
}
/** $BBC056 */
export function CODE_BBC056() {
  CODE_BBBEF8();
}

/** $BBC059 — give back the animal the level starts with. */
export function CODE_BBC059() {
  reg.a = r16(level.animal) & 0x0007;
  if (reg.a === 0) return;
  CODE_BBC062();
}

/** $BBC061 */
export function CODE_BBC061() {}

/** $BBC062 — A = animal index (1-6). */
export function CODE_BBC062() {
  reg.x = ((reg.a - 1) << 1) & 0xffff;
  reg.a = rom16(ANIMALS + reg.x);
  w16(R.animal_type, reg.a);
  if (reg.a === 0) w16(R.current_player_mount, 0);
}

/** $BBC07E — queue the current level's extra map unlocks (pairs until $FFFF). */
export function CODE_BBC07E() {
  w16(0x26, r16(level.extra_unlocks_ptr));
  w16(0x28, (L("level_settings_data_bank") >> 16) & 0xff);
  CODE_BBC098();
}

/** $BBC08A — A = from-level: read the to-level and queue the pair. */
export function CODE_BBC08A() {
  reg.y = reg.a;
  w16(0x26, (r16(0x26) + 2) & 0xffff);
  reg.a = bus16((r16(0x28) << 16) | r16(0x26));
  w16(0x26, (r16(0x26) + 2) & 0xffff);
  CODE_BBC0DD();
  CODE_BBC098();
}

/** $BBC098 */
export function CODE_BBC098() {
  for (;;) {
    reg.a = bus16(((r16(0x28) & 0xff) << 16) | r16(0x26));
    if (reg.a === 0xffff) return;
    reg.y = reg.a;
    w16(0x26, (r16(0x26) + 2) & 0xffff);
    reg.a = bus16(((r16(0x28) & 0xff) << 16) | r16(0x26));
    w16(0x26, (r16(0x26) + 2) & 0xffff);
    CODE_BBC0DD();
  }
}

/** $BBC0A4 — clear the unlock queue and map event words ($06D1-$0717). */
export function CODE_BBC0A4() {
  for (let x = 0x48; x !== 0; x -= 2) w16(0x06cf + x, 0);
  reg.x = 0;
  reg.a = 0;
}

/** $BBC0DD — Y = from-level, A = to-level: queue the unlock unless they are the same. */
export function CODE_BBC0DD() {
  w16(0x5e, reg.y);
  if ((reg.a & 0xffff) === (reg.y & 0xffff)) return;
  w16(0x60, reg.a);
  CODE_BBC0E9();
}

/** $BBC0E8 */
export function CODE_BBC0E8() {}

/** $BBC0E9 — append ($5E, $60) to the unlock queue (12 entries max). */
export function CODE_BBC0E9() {
  for (let x = 0; x !== 0x30; x += 4) {
    if (r16(0x06d9 + x) === 0) {
      reg.x = x;
      return CODE_BBC103();
    }
  }
  reg.x = 0x30;
  reg.a = 0x000b;
  throw_exception();
}

/** $BBC103 — X = free entry. */
export function CODE_BBC103() {
  const x = reg.x;
  w16(0x06d9 + x, r16(0x5e));
  w16(0x06db + x, r16(0x60));
  w16(0x06dd + x, 0);
  w16(0x06d7, (r16(0x06d7) + 1) & 0xffff);
}

/** $BBC116 — validate level_destination_number (0-7 and a non-empty destination). */
export function CODE_BBC116() {
  if (!((r16(R.level_destination_number) - 8) & 0x8000)) {
    reg.a = 0x0009;
    throw_exception();
    w16(R.level_destination_number, 0);
  }
  reg.x = (r16(R.level_destination_number) << 1) & 0xffff;
  reg.a = r16(level.destinations + reg.x) & 0x01ff;
  if (reg.a !== 0) return;
  reg.a = 0x000a;
  throw_exception();
  w16(R.level_destination_number, 0);
}

for (const n of ["CODE_BBBE28", "CODE_BBBE7E", "CODE_BBBED7", "CODE_BBBEED", "CODE_BBBEEE", "CODE_BBBEF8", "CODE_BBBF30", "CODE_BBBF65", "CODE_BBBF81", "CODE_BBBFC8", "CODE_BBBFDD", "CODE_BBBFE3", "CODE_BBC007", "CODE_BBC018", "CODE_BBC019", "CODE_BBC053", "CODE_BBC056", "CODE_BBC059", "CODE_BBC061", "CODE_BBC062", "CODE_BBC07E", "CODE_BBC08A", "CODE_BBC098", "CODE_BBC0A4", "CODE_BBC0DD", "CODE_BBC0E8", "CODE_BBC0E9", "CODE_BBC103", "CODE_BBC116"]) setRetMode(L(n), RET_RTS);
for (const n of ["CODE_BBBDC4", "CODE_BBBE01", "CODE_BBBE24", "CODE_BBBE54", "restart_logo_or_world_map", "restart_logo_or_world_map_restart_logo"]) setRetMode(L(n), RET_RTL);

register({
  CODE_BBBDC4,
  CODE_BBBE01,
  CODE_BBBE24,
  CODE_BBBE28,
  CODE_BBBE54,
  CODE_BBBE7E,
  restart_logo_or_world_map,
  restart_logo_or_world_map_restart_logo,
  CODE_BBBED7,
  CODE_BBBEED,
  CODE_BBBEEE,
  CODE_BBBEF8,
  CODE_BBBF30,
  CODE_BBBF65,
  CODE_BBBF81,
  CODE_BBBFBE,
  CODE_BBBFC1,
  CODE_BBBFC8,
  CODE_BBBFDD,
  CODE_BBBFE3,
  CODE_BBC007,
  CODE_BBC018,
  CODE_BBC019,
  CODE_BBC053,
  CODE_BBC056,
  CODE_BBC059,
  CODE_BBC061,
  CODE_BBC062,
  CODE_BBC07E,
  CODE_BBC08A,
  CODE_BBC098,
  CODE_BBC0A4,
  CODE_BBC0DD,
  CODE_BBC0E8,
  CODE_BBC0E9,
  CODE_BBC103,
  CODE_BBC116,
});
