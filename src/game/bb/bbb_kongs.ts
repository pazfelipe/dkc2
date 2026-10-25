/**
 * Bank $BB (part b) — spawning the Kongs (and the animal buddy) when a level starts, terrain
 * slope settings of the tileset configs, and the scripted "Kong cutscenes" (boss entries,
 * victories, the Stronghold Showdown walk).
 *
 * A cutscene script is a list of (duration, handler) word pairs. kong_cutscene_handler starts
 * script A; the Kong cutscene states call CODE_BBC140 every frame, which counts the duration of
 * the current step down and then runs the next handler. Handlers end by stepping the index
 * either for the next frame (CODE_BBC150) or immediately running the next step (CODE_BBC15D).
 */
import { r16, w16, rom16, bus16, busW16 } from "../../core/mem";
import { reg, register, callPtr } from "../../core/cpu";
import { setRetMode, RET_RTS, RET_RTL } from "../../core/hybrid";
import { L, R, C, level, sprite, sprite_table } from "../../core/sym";
import {
  request_palette_direct_global,
  spawn_special_sprite_index,
  spawn_special_sprite_address,
  set_anim_handle_dixie,
  request_sprite_palette,
  kong_cutscene_handler as kong_cutscene_handler_stub,
  CODE_B8D8D1,
  CODE_B8B83F,
  throw_exception,
  set_riding_kong_anim_handle_dixie,
  CODE_B893DB,
  work_on_active_kong_global,
  work_on_inactive_kong_global,
  start_player_falling_global,
  set_swimming_state_global,
  spawn_follower_animal_icon,
  set_current_level_as_cleared,
  set_player_interaction_27,
  CODE_B8B3EC,
  set_level_end_exit_state_global,
  CODE_B4AFAD,
  transition_song,
  set_anim_once_handle_dixie,
  drop_sprite_if_holding_global,
} from "../../gen/routines";
import { mergeBits } from "./bba_util";

const followerPresent = () => (r16(R.game_state_flags) & 0x4000) !== 0;

// ---------------------------------------------------------------------------------------------
// Terrain slope settings (tileset config slope routines)

function slope(v: number) {
  w16(0x88, v);
  reg.a = 0xfffc;
  w16(R.RAM_0BA4, 0xfffc);
}
/** $BBACE2 */
export function CODE_BBACE2() {
  slope(0x0006);
}
/** $BBACEE */
export function CODE_BBACEE() {
  slope(0x0005);
}
/** $BBACFA */
export function CODE_BBACFA() {
  slope(0x0005);
}

// ---------------------------------------------------------------------------------------------
// Kong spawning

/** $BBAD06 — Stronghold Showdown: the Kongs, then the walk cutscene unless already seen. */
export function CODE_BBAD06() {
  spawn_kongs_in_level();
  reg.a = r16(R.world_map_events) & 0x0003;
  if (reg.a !== 0) return;
  reg.a = 0x0001;
  kong_cutscene_handler_stub();
}

/** $BBAD19 — K. Rool Duel: the entry cutscene (short version after the first time). */
export function CODE_BBAD19() {
  spawn_kongs_in_level();
  if (r16(R.game_state_flags_2) & 0x0004) return CODE_BBAD2C();
  reg.a = 0x0002;
  kong_cutscene_handler_stub();
}

/** $BBAD2C */
export function CODE_BBAD2C() {
  reg.a = 0x0009;
  kong_cutscene_handler_stub();
}

function spawnKong(control: number, spawnId: number, constants: string, extra: string, dst: number) {
  w16(R.current_kong_control_variables, control);
  reg.y = spawnId;
  spawn_special_sprite_index();
  reg.x = r16(R.alternate_sprite);
  w16(R.current_sprite, reg.x);
  set_kong_spawn_position();
  reg.a = 0x0004; // run animation
  set_anim_handle_dixie();
  set_default_kong_palette();
  w16(dst, rom16(L(constants)));
  w16(dst + 2, rom16(L(extra)));
}

/** $BBAD34 — spawn Diddy and Dixie at the level entrance (and the animal, follower, boss intro). */
export function spawn_kongs_in_level() {
  reg.a = L("global_sprite_palette") & 0xffff;
  request_palette_direct_global();
  spawnKong(R.diddy_control_variables, C.special_sprite_spawn_id_000E, "diddy_kong_constants", "DATA_FF0042", 0x16ba);
  spawnKong(R.dixie_control_variables, C.special_sprite_spawn_id_0010, "dixie_kong_constants", "DATA_FF012C", 0x16e0);
  CODE_BBADDC();
  spawn_kongs_in_level_handle_boss_entry_cutscene();
}

/** $BBAD98 — boss levels start with their entry cutscene. */
export function spawn_kongs_in_level_handle_boss_entry_cutscene() {
  const cut: Record<number, number> = {
    [C.level_krows_nest]: 0x0005,
    [C.level_kreepy_krow]: 0x0006,
    [C.level_kleevers_kiln]: 0x0007,
    [C.level_kudgels_kontest]: 0x0008,
    [C.level_krocodile_kore]: 0x000a,
  };
  reg.a = r16(R.level_number);
  const n = cut[reg.a];
  if (n === undefined) return;
  reg.a = n;
  kong_cutscene_handler_stub();
}

/** $BBADDC — render orders, the follower Kong, and the animal buddy. */
export function CODE_BBADDC() {
  CODE_BBAE92();
  let x = r16(R.inactive_kong_sprite);
  w16(x + sprite.interaction_flags, 0);
  w16(x + sprite.render_order, 0x00d8);
  x = r16(R.active_kong_sprite);
  w16(x + sprite.interaction_flags, 0x001e);
  w16(x + sprite.render_order, 0x00e4);
  reg.x = x;
  reg.a = r16(R.animal_type);
  if (reg.a !== 0) return CODE_BBAE28();
  CODE_BBADFD();
}

/** $BBADFD — place the follower Kong (or hide the inactive one). */
export function CODE_BBADFD() {
  const x = r16(R.inactive_kong_sprite);
  reg.x = x;
  reg.a = r16(R.game_state_flags) & 0x4000;
  if (reg.a === 0) return CODE_BBAE23();
  w16(x + sprite.x_position, (r16(x + sprite.x_position) - 0x0020) & 0xffff);
  w16(x + sprite.state, 0x0022);
  reg.a = 0x001f;
  reg.x = 0x0003;
  reg.y = 0x0000;
  CODE_B8D8D1();
}

/** $BBAE23 — X = inactive Kong. */
export function CODE_BBAE23() {
  CODE_B8B83F();
}

/** $BBAE28 — the level starts with an animal: spawn it with the Kong riding, or turn into it. */
export function CODE_BBAE28() {
  if (r16(R.current_player_mount) === 0) return CODE_BBAE62();
  reg.x = ((r16(R.animal_type) - C.animal_sprite_type_range_start) >> 1) & 0x000e;
  reg.y = rom16(L("DATA_FF0D64") + reg.x);
  spawn_special_sprite_address();
  if (!reg.c) return CODE_BBAE4A();
  reg.a = 0x0010;
  throw_exception();
}

/** $BBAE4A — the rideable animal was spawned. */
export function CODE_BBAE4A() {
  const x = r16(R.alternate_sprite);
  reg.x = x;
  w16(R.current_player_mount, x);
  w16(R.current_sprite, x);
  w16(x + sprite.state, 0x0001);
  reg.a = 0x004f;
  set_riding_kong_anim_handle_dixie();
  CODE_B893DB();
  CODE_BBADFD();
}

/** $BBAE62 — transformation animals (the Kong is the animal). */
export function CODE_BBAE62() {
  work_on_active_kong_global();
  if (r16(R.animal_type) === C.sprite_enguarde) return CODE_BBAE73();
  start_player_falling_global();
  CODE_BBAE77();
}

/** $BBAE73 */
export function CODE_BBAE73() {
  set_swimming_state_global();
  CODE_BBAE77();
}

/** $BBAE77 — hide the inactive Kong; the follower is shown as an animal icon. */
export function CODE_BBAE77() {
  reg.x = r16(R.inactive_kong_sprite);
  CODE_B8B83F();
  reg.a = r16(R.game_state_flags) & 0x4000;
  if (reg.a === 0) return;
  spawn_follower_animal_icon();
  reg.x = r16(R.alternate_sprite);
  w16(reg.x + sprite.state, 0x0005);
}

/** $BBAE91 */
export function CODE_BBAE91() {}

/** $BBAE92 — entrances facing left flip both Kongs. */
export function CODE_BBAE92() {
  reg.a = r16(level.entrance_direction) & 0x0002;
  if (reg.a === 0) return;
  CODE_BBAE9B();
}

/** $BBAE9B */
export function CODE_BBAE9B() {
  reg.x = r16(R.active_kong_sprite);
  CODE_BBAEA8();
  reg.x = r16(R.inactive_kong_sprite);
  CODE_BBAEA8();
}

/** $BBAEA8 — X = sprite: set the horizontal flip bit. */
export function CODE_BBAEA8() {
  reg.a = r16(reg.x + sprite.oam_property) | 0x4000;
  w16(reg.x + sprite.oam_property, reg.a);
}

/** $BBAEB0 — the current sprite to the level entrance. */
export function set_kong_spawn_position() {
  const x = r16(R.current_sprite);
  reg.x = x;
  w16(x + sprite.x_position, r16(level.entrance_x));
  reg.a = r16(level.entrance_y);
  w16(x + sprite.y_position, reg.a);
}

const ANIMAL_PALETTES = L("set_default_kong_palette_animal_palette_ids");

/** $BBAEBD — the current sprite's palette (the active Kong as an animal uses the animal's). */
export function set_default_kong_palette() {
  const cur = r16(R.current_sprite);
  if (cur === r16(R.active_kong_sprite)) {
    const animal = r16(R.animal_type);
    if (animal !== 0) {
      w16(0x32, animal);
      if (r16(R.current_player_mount) === 0) {
        reg.x = ((animal - C.animal_sprite_type_range_start) & 0xffff) >> 1;
        reg.a = rom16(ANIMAL_PALETTES + reg.x);
        request_sprite_palette();
        return setPaletteSlot();
      }
    }
  }
  reg.x = cur;
  reg.a = r16(cur + sprite.type) === C.sprite_diddy_kong ? C.diddy_active_sprite_palette : C.dixie_active_sprite_palette;
  request_sprite_palette();
  setPaletteSlot();
}
function setPaletteSlot() {
  const x = r16(R.current_sprite);
  reg.x = x;
  reg.a = mergeBits(r16(x + sprite.oam_property), reg.a, 0x0e00);
  w16(x + sprite.oam_property, reg.a);
}

// ---------------------------------------------------------------------------------------------
// Kong cutscenes

/** $BBC140 — per frame from the cutscene Kong states: wait, then run the next step. */
export function CODE_BBC140() {
  const x = r16(R.current_sprite);
  reg.x = x;
  if (x === r16(R.inactive_kong_sprite)) return;
  const t = r16(R.kong_cutscene_command_timer);
  if (t === 0) return CODE_BBC174();
  w16(R.kong_cutscene_command_timer, (t - 1) & 0xffff);
}

/** $BBC14F */
export function CODE_BBC14F() {}

function nextStep() {
  w16(R.kong_cutscene_script_index, (r16(R.kong_cutscene_script_index) + 4) & 0xffff);
}

/** $BBC150 — step done: the next one runs when its wait is over. */
export function CODE_BBC150() {
  nextStep();
}

/** $BBC15D — step done: run the next one now. */
export function CODE_BBC15D() {
  nextStep();
  CODE_BBC174();
}

/** $BBC16B — A = cutscene number: start it. */
export function kong_cutscene_handler() {
  w16(R.kong_cutscene_number, reg.a);
  w16(R.kong_cutscene_script_index, 0);
  w16(R.kong_cutscene_command_timer, 0);
  CODE_BBC174();
}

const SCRIPTS = L("CODE_BBC174_kong_cutscene_table");

/** $BBC174 — run the current step: load its wait and jump to its handler. */
export function CODE_BBC174() {
  reg.db = 0xbb;
  const x = (rom16(SCRIPTS + ((r16(R.kong_cutscene_number) << 1) & 0xffff)) + r16(R.kong_cutscene_script_index)) & 0xffff;
  reg.x = x;
  reg.a = rom16(0xbb0000 | x);
  w16(R.kong_cutscene_command_timer, reg.a);
  callPtr(0xbb, rom16(0xbb0000 | ((x + 2) & 0xffff)));
}

/** Both Kongs: run `fn` on the active one, and on the follower if there is one. */
function bothKongs(fn: () => void) {
  work_on_active_kong_global();
  fn();
  if (!followerPresent()) return CODE_BBC150();
  work_on_inactive_kong_global();
  fn();
  CODE_BBC150();
}

function ccSetLevelCleared() {
  set_current_level_as_cleared();
  set_player_interaction_27();
  CODE_BBC15D();
}
function ccGiveReward() {
  work_on_active_kong_global();
  CODE_B8B3EC();
  CODE_BBC150();
}
/** Face the active Kong towards sprite Y. */
function faceTowards(x: number, y: number) {
  const a = ((r16(y + sprite.x_position) - r16(x + sprite.x_position)) & 0xffff) >> 1;
  reg.a = mergeBits(r16(x + sprite.oam_property), a, 0x4000);
  w16(x + sprite.oam_property, reg.a);
}
function ccFaceSlot3() {
  reg.y = sprite_table.slot_3;
  reg.x = r16(R.active_kong_sprite);
  faceTowards(reg.x, reg.y);
  CODE_BBC15D();
}
function ccCameraTarget() {
  reg.a = r16(0x0654);
  w16(0x0ae8, reg.a);
  CODE_BBC150();
}
function ccCameraTargetOff() {
  w16(0x0ae8, 0);
  CODE_BBC150();
}
function ccLevelEnd() {
  reg.a = r16(R.world_map_events) | 0x0003;
  w16(R.world_map_events, reg.a);
  set_level_end_exit_state_global();
  CODE_B4AFAD();
  CODE_BBC150();
}
function ccMusicFlyingKrock() {
  reg.a = 0x0001;
  transition_song();
  CODE_BBC150();
}
function ccLiftDk() {
  reg.x = r16(0x075f); // DK's sprite
  reg.a = 0x0002;
  w16(reg.x + sprite.state, 0x0002);
  CODE_BBC150();
}
function ccActiveX(v: number) {
  reg.x = r16(R.active_kong_sprite);
  reg.a = v;
  w16(reg.x + sprite.x_position, v);
  CODE_BBC15D();
}
function ccFollowerBehind() {
  if (followerPresent()) {
    reg.y = r16(R.inactive_kong_sprite);
    reg.x = r16(R.active_kong_sprite);
    reg.a = (r16(reg.x + sprite.x_position) - 0x001c) & 0xffff;
    w16(reg.y + sprite.x_position, reg.a);
  }
  CODE_BBC15D();
}
function standOnGround(x: number) {
  w16(x + sprite.ground_y_position, r16(x + sprite.y_position));
  w16(x + sprite.ground_distance, 0);
}
function ccCelebrate() {
  work_on_active_kong_global();
  let x = reg.x;
  standOnGround(x);
  w16(x + sprite.max_x_speed, 0);
  w16(x + sprite.x_speed, 0);
  w16(x + sprite.state, C.kong_state_74);
  reg.a = 0x0045;
  set_anim_once_handle_dixie();
  if (followerPresent()) {
    work_on_inactive_kong_global();
    x = reg.x;
    w16(x + sprite.max_x_speed, 0);
    w16(x + sprite.state, C.kong_state_74);
    reg.a = 0x0001;
    set_anim_once_handle_dixie();
  }
  CODE_BBC150();
}
function ccCutsceneMove() {
  bothKongs(() => {
    reg.a = C.kong_state_75;
    w16(reg.x + sprite.state, reg.a);
    w16(reg.x + sprite.max_x_speed, 0);
  });
}
function ccFreeze() {
  work_on_active_kong_global();
  drop_sprite_if_holding_global();
  const x = r16(R.current_sprite);
  reg.x = x;
  w16(x + sprite.state, C.kong_state_7C);
  w16(x + sprite.max_x_speed, 0);
  w16(x + sprite.y_speed, 0);
  w16(x + sprite.display_mode, 0);
  if (followerPresent()) {
    work_on_inactive_kong_global();
    reg.a = C.kong_state_22;
    w16(reg.x + sprite.state, reg.a);
  }
  CODE_BBC150();
}
function ccIdle() {
  bothKongs(() => {
    w16(reg.x + sprite.max_x_speed, 0);
    w16(reg.x + sprite.state, C.kong_state_74);
    reg.a = 0x0001;
    set_anim_once_handle_dixie();
  });
}
function ccWalkRight() {
  bothKongs(() => {
    const x = reg.x;
    standOnGround(x);
    w16(x + sprite.max_x_speed, 0x0200);
    w16(x + sprite.x_speed, 0x0200);
    w16(x + sprite.state, C.kong_state_75);
    reg.a = 0x0003;
    set_anim_once_handle_dixie();
  });
}
function ccRunRight() {
  bothKongs(() => {
    const x = reg.x;
    standOnGround(x);
    w16(x + sprite.max_x_speed, 0x0400);
    w16(x + sprite.x_speed, 0x0400);
    w16(x + sprite.state, 0x0075);
    // (sets bit 2 of the x position of whatever sprite Y holds, DB = $BB)
    const ya = 0xbb0000 | ((reg.y + sprite.x_position) & 0xffff);
    busW16(ya, bus16(ya) | 0x0004);
    reg.a = 0x0004;
    set_anim_once_handle_dixie();
  });
}
function ccLookAround() {
  w16(R.current_held_sprite, 0);
  bothKongs(() => {
    const x = reg.x;
    if (r16(R.level_number) === C.level_krool_duel) {
      reg.y = r16(0x0654);
      faceTowards(x, reg.y);
    }
    standOnGround(x);
    w16(x + sprite.max_x_speed, 0);
    w16(x + sprite.x_speed, 0);
    w16(x + sprite.state, C.kong_state_74);
    reg.a = 0x009f;
    set_anim_once_handle_dixie();
  });
}
function ccEnd() {
  work_on_active_kong_global();
  w16(reg.x + sprite.state, 0);
  if (followerPresent()) {
    work_on_inactive_kong_global();
    w16(reg.x + sprite.state, C.kong_state_22);
    reg.a = 0x001f;
    reg.x = 0x0003;
    reg.y = 0x0000;
    CODE_B8D8D1();
  }
  CODE_BBC150();
}

const HANDLERS: Record<string, () => void> = {
  CODE_BBC174_CODE_BBC30B: ccSetLevelCleared,
  CODE_BBC174_give_reward_to_player: ccGiveReward,
  CODE_BBC174_CODE_BBC321: ccFaceSlot3,
  CODE_BBC174_CODE_BBC33A: ccCameraTarget,
  CODE_BBC174_CODE_BBC344: ccCameraTargetOff,
  CODE_BBC174_CODE_BBC34A: ccLevelEnd,
  CODE_BBC174_transition_music_to_flying_krock: ccMusicFlyingKrock,
  CODE_BBC174_lift_dk_off_screen: ccLiftDk,
  CODE_BBC174_set_kong_to_0180_X_pos: () => ccActiveX(0x0180),
  CODE_BBC174_set_kong_to_0350_Y_pos: () => ccActiveX(0x0350),
  CODE_BBC174_move_active_kong_to_left_of_level: () => ccActiveX(0x0100),
  CODE_BBC174_move_inactive_kong_left_of_active: ccFollowerBehind,
  CODE_BBC174_stop_kongs_and_celebrate: ccCelebrate,
  CODE_BBC174_set_kong_states_to_cutscene_move: ccCutsceneMove,
  CODE_BBC174_CODE_BBC406: ccFreeze,
  CODE_BBC174_CODE_BBC42F: ccIdle,
  CODE_BBC174_set_kongs_walking_right: ccWalkRight,
  CODE_BBC174_CODE_BBC48A: ccRunRight,
  CODE_BBC174_CODE_BBC4C6: ccLookAround,
  CODE_BBC174_CODE_BBC513: ccEnd,
};

for (const n of [
  "CODE_BBACE2", "CODE_BBACEE", "CODE_BBACFA", "CODE_BBAD06", "CODE_BBAD19", "CODE_BBAD2C", "spawn_kongs_in_level",
  "spawn_kongs_in_level_handle_boss_entry_cutscene", "CODE_BBADDC", "CODE_BBADFD", "CODE_BBAE23", "CODE_BBAE28",
  "CODE_BBAE4A", "CODE_BBAE62", "CODE_BBAE73", "CODE_BBAE77", "CODE_BBAE91", "CODE_BBAE92", "CODE_BBAE9B", "CODE_BBAEA8",
  "set_kong_spawn_position", "set_default_kong_palette",
]) setRetMode(L(n), RET_RTS);
for (const n of ["CODE_BBC140", "CODE_BBC14F", "CODE_BBC150", "CODE_BBC15D", "kong_cutscene_handler", "CODE_BBC174", ...Object.keys(HANDLERS)]) setRetMode(L(n), RET_RTL);

register({
  CODE_BBACE2,
  CODE_BBACEE,
  CODE_BBACFA,
  CODE_BBAD06,
  CODE_BBAD19,
  CODE_BBAD2C,
  spawn_kongs_in_level,
  spawn_kongs_in_level_handle_boss_entry_cutscene,
  CODE_BBADDC,
  CODE_BBADFD,
  CODE_BBAE23,
  CODE_BBAE28,
  CODE_BBAE4A,
  CODE_BBAE62,
  CODE_BBAE73,
  CODE_BBAE77,
  CODE_BBAE91,
  CODE_BBAE92,
  CODE_BBAE9B,
  CODE_BBAEA8,
  set_kong_spawn_position,
  set_default_kong_palette,
  CODE_BBC140,
  CODE_BBC14F,
  CODE_BBC150,
  CODE_BBC15D,
  kong_cutscene_handler,
  CODE_BBC174,
  ...HANDLERS,
});
