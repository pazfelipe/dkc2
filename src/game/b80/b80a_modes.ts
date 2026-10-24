/**
 * Bank $80 — level game mode, demo (attract mode) start, new/existing file start, Kong setup
 * and the NMI routines of the NPC / bonus / credits screens.
 */
import { r8, w8, r16, w16, bus16, rom16 } from "../../core/mem";
import { reg, register } from "../../core/cpu";
import { jumpPtr } from "./b80a_util";
import { endFrame, frameEnded, setRetMode, RET_RTS } from "../../core/hybrid";
import { L, R, C, CPU, level, sprite, sprite_table } from "../../core/sym";
import { ioR8 } from "../../core/mem";
import {
  disable_screen,
  set_fade,
  prepare_oam_dma_channel,
  set_game_mode_and_return,
  set_nmi_and_wait,
  throw_exception,
  restart_rareware_logo,
  init_ending_parade,
  ending_parade_game_mode_hop,
  init_world_map,
  CODE_BB9210,
  CODE_BBC736,
  CODE_BBC85B,
  CODE_B48000,
  spawn_special_sprite_address,
  set_anim_handle_dixie,
  input_and_pause_handler_global,
  CODE_BAB31B,
  CODE_B4BE60,
  run_crocodile_isle_hop,
  run_crocodile_isle_krool_fall_hop,
  run_simple_world_map_hop,
  CODE_B491D7,
  CODE_B48B15,
  CODE_B4935E,
  CODE_B49978,
  CODE_B49886,
  CODE_B49F1D,
  CODE_B49ED7,
  CODE_B4AB6E,
  CODE_B4990F,
  CODE_B49B63,
  vram_payload_handler_global,
  set_ppu_registers_global,
  dma_palette,
} from "../../gen/routines";
import { io8 } from "../../core/mem";
import { PPU } from "../../core/sym";

const NMI_SUB_MODE_TABLE = L("nmi_sub_mode_table");
const GAME_SUB_MODE_TABLE = L("game_sub_mode_table");
const DEMO_LEVEL_SCRIPTS_TABLE = L("demo_level_scripts_table");
const ptr = (name: string) => L(name) & 0xffff;

// ---------------------------------------------------------------------------------------------
// Level game mode

/** $8087E1 — level game mode init: load the level, then run CODE_808819 every frame. */
export function CODE_8087E1() {
  reg.db = 0x80;
  disable_screen();
  CODE_BB9210(); // load the level (layout, graphics, sprites...)
  if (frameEnded) return;
  reg.db = 0x80;
  reg.a = 0x0200;
  set_fade();
  prepare_oam_dma_channel();
  w8(R.game_sub_mode, r8(level.game_sub_mode));
  w8(R.nmi_sub_mode, r8(level.nmi_sub_mode));
  reg.a = ptr("CODE_808819");
  set_game_mode_and_return();
}

/** $80880A — (unreferenced) A = nmi sub mode << 8 | game sub mode. */
export function CODE_80880A() {
  w8(R.game_sub_mode, reg.a & 0xff);
  w8(R.nmi_sub_mode, (reg.a >> 8) & 0xff);
  reg.a = ptr("CODE_808819");
  set_game_mode_and_return();
}

/**
 * $808819 — level game mode, every frame: first the VBlank uploads of the current NMI sub mode,
 * then the game logic of the current game sub mode (which ends the frame).
 */
export function CODE_808819() {
  reg.x = (r16(R.nmi_sub_mode) << 1) & 0xffff;
  jumpPtr(0x80, rom16(NMI_SUB_MODE_TABLE + reg.x));
  if (frameEnded) return;
  // the uploads must have finished inside VBlank (a debug check; throw_exception is a no-op)
  if (!(ioR8(CPU.ppu_status) & 0x80)) {
    reg.a = 0x0005;
    throw_exception();
  }
  CODE_808830();
}

/** $808830 — JMP (game_sub_mode_table,x) */
export function CODE_808830() {
  reg.x = (r16(R.game_sub_mode) << 1) & 0xffff;
  reg.a = reg.x;
  jumpPtr(0x80, rom16(GAME_SUB_MODE_TABLE + reg.x));
}

// ---------------------------------------------------------------------------------------------
// Demo (attract mode)

/** $8086F6 — start the attract mode demo (from the title screen timeout). */
export function CODE_8086F6() {
  disable_screen();
  reg.db = 0x80;
  w16(R.game_state_flags_2, r16(R.game_state_flags_2) | 0x8000);
  w16(R.demo_status, 1);
  CODE_808712();
  if (frameEnded) return;
  reg.a = ptr("CODE_8087E1");
  set_game_mode_and_return();
}

/** $8087C9 — start the next demo level. */
export function CODE_8087C9() {
  disable_screen();
  reg.db = 0x80;
  CODE_808712();
  if (frameEnded) return;
  reg.a = ptr("CODE_8087E1");
  set_game_mode_and_return();
}

/**
 * $808712 — prepare a demo: fixed RNG seed, cleared inputs, and the next level of the demo
 * cycle (every 4th demo restarts the intro instead).
 */
export function CODE_808712() {
  w16(R.rng_result, 0xaa55);
  w16(R.rng_seed_2, 0x3765);
  w16(R.demo_sequence_index, 0);
  w16(R.demo_input_timer, 0);
  w16(R.game_state_flags, r16(R.game_state_flags) & ~0x0040);
  w16(R.player_1_held, 0);
  w16(R.player_1_pressed, 0);
  w16(R.player_1_released, 0);
  if (r16(R.demo_status) === 2) {
    // demo recording (debug): Mainbrace Mayhem; the recorded header goes to ROM (no effect)
    w16(R.level_number, C.level_mainbrace_mayhem);
    w16(R.temp_level_number, C.level_mainbrace_mayhem);
    w16(R.level_entrance_number, 1);
    w16(R.demo_sequence_index, (r16(R.demo_sequence_index) + 4) & 0xffff);
  }
  CODE_80875E();
}

/** $80875E */
export function CODE_80875E() {
  reg.a = r16(R.demo_sequence_number) & 0x0003;
  if (reg.a === 3) return restart_rareware_logo();
  CODE_80876E();
}

/** $80876E — A = demo number (0-2): load its script header (size, level, entrance, timer). */
export function CODE_80876E() {
  reg.x = (reg.a << 1) & 0xffff;
  w16(R.demo_sequence_address, bus16(DEMO_LEVEL_SCRIPTS_TABLE + reg.x));
  w16(R.demo_sequence_number, (r16(R.demo_sequence_number) + 1) & 0xffff);
  const script = 0xfe0000 | r16(R.demo_sequence_address);
  w16(0x36, script & 0xffff);
  w16(0x38, 0x00fe);
  reg.a = r16(R.demo_status);
  if (reg.a !== 1) return CODE_8087B8();
  let y = r16(R.demo_sequence_index);
  const at = (o: number) => bus16((script + o) & 0xffffff);
  w16(R.demo_sequence_size, at(y));
  y += 2;
  reg.a = at(y);
  w16(R.level_number, reg.a);
  w16(R.temp_level_number, reg.a);
  y += 2;
  w16(R.level_entrance_number, at(y));
  y += 2;
  w16(R.demo_sequence_index, y & 0xffff);
  y += 2;
  reg.a = at(y);
  w16(R.demo_input_timer, reg.a);
  reg.y = y & 0xffff;
  CODE_8087B8();
}

/** $8087B8 */
export function CODE_8087B8() {}

// ---------------------------------------------------------------------------------------------
// Ending / world map hops

/** $8087B9 */
export function start_ending_parade() {
  init_ending_parade();
  if (frameEnded) return;
  reg.db = 0x80;
  reg.a = ptr("ending_parade_game_mode");
  set_game_mode_and_return();
}

/** $8087C5 */
export function ending_parade_game_mode() {
  ending_parade_game_mode_hop();
}

/** $8087D9 — game mode: enter the world map of the current world. */
export function CODE_8087D9() {
  reg.a = r16(R.world_number);
  init_world_map();
}

// ---------------------------------------------------------------------------------------------
// Kongs

/** $808837 */
export function set_active_kong_global() {
  set_active_kong();
}

/** $80883B — A = 0: Diddy leads, else Dixie leads (BNE on the caller's A). */
export function set_active_kong() {
  if (reg.a & 0xffff) return set_active_kong_set_dixie();
  w16(R.active_kong_sprite, sprite_table.slot_1);
  w16(R.active_kong_control_variables, R.diddy_control_variables);
  w16(R.active_kong_number, 0);
  w16(R.active_controller_number, 1);
  w16(R.inactive_kong_sprite, sprite_table.slot_2);
  w16(R.inactive_kong_control_variables, R.dixie_control_variables);
  setDefaultInteractionFlags();
}

/** $808863 .set_dixie */
function set_active_kong_set_dixie() {
  w16(R.active_kong_sprite, sprite_table.slot_2);
  w16(R.active_kong_control_variables, R.dixie_control_variables);
  w16(R.active_kong_number, 1);
  w16(R.active_controller_number, 2);
  w16(R.inactive_kong_sprite, sprite_table.slot_1);
  w16(R.inactive_kong_control_variables, R.diddy_control_variables);
  setDefaultInteractionFlags();
}

/** .set_default_interaction_flags — only the leading Kong interacts with sprites. */
function setDefaultInteractionFlags() {
  w16(r16(R.active_kong_sprite) + sprite.interaction_flags, 0x001e);
  w16(r16(R.inactive_kong_sprite) + sprite.interaction_flags, 0x0000);
  reg.a = 0;
}

/** $80889C */
export function swap_active_kong_global() {
  swap_active_kong();
}

/** $8088A0 — make the other Kong the leader. */
export function swap_active_kong() {
  reg.a = r16(R.active_kong_number) ^ 0x0001;
  set_active_kong();
}

/** $8088A8 — A = level_number. */
export function get_level_number() {
  reg.a = r16(R.level_number);
}

// ---------------------------------------------------------------------------------------------
// NPC screens (Cranky, Funky, Swanky, Wrinkly, Klubba...), bonus and credits screens.
// Each of these is an NMI routine: run the screen's logic and wait for the next NMI.

function npcFrame(logic: () => void, withInput: boolean) {
  // LDX #stack : TXS
  w16(R.active_frame_counter, (r16(R.active_frame_counter) + 1) & 0xffff);
  logic();
  if (frameEnded) return;
  if (withInput) {
    input_and_pause_handler_global();
    if (frameEnded) return;
  }
  npc_wait_for_nmi();
}

/** $808CC9 */
export function run_bonus_and_credits_screen() {
  npcFrame(CODE_BAB31B, true);
}
/** $808CD9 — also used for the video game hero screen. */
export function run_ending_monkey_museum() {
  npcFrame(CODE_B4BE60, true);
}
/** $808CE9 */
export function run_crocodile_isle() {
  run_crocodile_isle_hop();
}
/** $808CED */
export function run_crocodile_isle_krool_fall() {
  run_crocodile_isle_krool_fall_hop();
}
/** $808CF1 */
export function run_simple_world_map() {
  run_simple_world_map_hop();
}
/** $808CF5 */
export function run_808CF5() {
  npcFrame(CODE_B491D7, false);
}
/** $808D02 */
export function run_808D02() {
  npcFrame(CODE_B48B15, false);
}
/** $808D0E */
export function run_npc_intro_dialogue() {
  npcFrame(CODE_B4935E, true);
}
/** $808D1C — WAI: end of the frame. */
export function npc_wait_for_nmi() {
  endFrame();
}
/** $808D1F */
export function run_npc_dialogue_selection() {
  npcFrame(CODE_B49978, true);
}
/** $808D30 */
export function run_808D30() {
  npcFrame(CODE_B49886, false);
}
/** $808D3D */
export function run_808D3D() {
  npcFrame(CODE_B49F1D, true);
}
/** $808D4E */
export function run_808D4E() {
  npcFrame(CODE_B49ED7, true);
}
/** $808D5F */
export function run_808D5F() {
  npcFrame(CODE_B4AB6E, true);
}
/** $808D70 */
export function run_808D70() {
  npcFrame(CODE_B4990F, false);
}
/** $808D7D */
export function run_npc_exit() {
  npcFrame(CODE_B49B63, false);
}

/** $808D8A — spawn Diddy and Dixie for an NPC screen (Kong family / Klubba / etc.). */
export function init_npc_screen_kongs() {
  w16(R.game_state_flags, r16(R.game_state_flags) | 0x8000);
  reg.a = r16(R.active_kong_number);
  set_active_kong_global();
  // X is whatever the caller left in it (set_active_kong preserves X)
  w16(reg.x + sprite.interaction_flags, r16(reg.x + sprite.interaction_flags) | 0x0020);
  spawn_npc_screen_diddy();
  w16(R.current_kong_control_variables, R.dixie_control_variables);
  reg.y = L("DATA_FF136E") & 0xffff;
  spawn_special_sprite_address();
  reg.x = r16(R.alternate_sprite);
  w16(R.current_sprite, reg.x);
  reg.a = C.diddy_run_anim_id;
  set_anim_handle_dixie();
  w16(R.dixie_control_variables + 0x8, bus16(L("dixie_kong_constants"))); // gravity
  w16(R.dixie_control_variables + 0xa, bus16(L("DATA_FF012C"))); // terminal velocity
  reg.x = r16(R.active_kong_sprite);
  w16(reg.x + sprite.state, 0x001d);
  w16(reg.x + sprite.render_order, 0x00e4);
  CODE_808DFB();
  reg.x = r16(R.inactive_kong_sprite);
  w16(reg.x + sprite.state, 0x001e);
  w16(reg.x + sprite.render_order, 0x00d8);
  CODE_808DFB();
  reg.a = r16(R.game_state_flags);
  if (!(reg.a & 0x4000)) {
    // only one Kong in the party: hide the other one
    reg.y = r16(R.inactive_kong_sprite);
    reg.a = 0xc000;
    w16(reg.y + sprite.display_mode, 0xc000);
  }
}

/** $808DFB — (dead) the terrain setup that followed was disabled with an early RTS. */
export function CODE_808DFB() {}

/** $808E29 — spawn Diddy for an NPC screen. */
export function spawn_npc_screen_diddy() {
  w16(R.current_kong_control_variables, R.diddy_control_variables);
  reg.y = L("DATA_FF1330") & 0xffff;
  spawn_special_sprite_address();
  reg.x = r16(R.alternate_sprite);
  w16(R.current_sprite, reg.x);
  reg.a = 0x0001;
  set_anim_handle_dixie();
  w16(R.diddy_control_variables + 0x8, bus16(L("diddy_kong_constants")));
  w16(R.diddy_control_variables + 0xa, bus16(L("DATA_FF0042")));
}

/** $8090BB — open Wrinkly's screen. */
export function CODE_8090BB() {
  disable_screen();
  w16(R.npc_screen_type, C.npc_screen_type_wrinkly);
  reg.a = ptr("run_808D02");
  set_nmi_and_wait();
}

// ---------------------------------------------------------------------------------------------
// New / existing save file

/** $808EEA — start a new game. */
export function init_new_file() {
  disable_screen();
  reg.db = 0x80;
  CODE_808FFB();
  reg.a = 0;
  set_active_kong_global();
  CODE_808F4A();
  reg.a = ptr("CODE_8087D9");
  set_game_mode_and_return();
}

/** $808F04 — continue a saved game (the file was loaded into sram_file_buffer). */
export function init_existing_file() {
  disable_screen();
  reg.db = 0x80;
  CODE_808FFB();
  w16(R.active_controller, bus16(R.sram_file_buffer + 4) & 0x0001);
  const mode = bus16(R.sram_file_buffer + 5) & 0x0003;
  w16(R.current_game_mode, mode);
  CODE_808FDC();
  CODE_BBC736(); // load the file's progress
  if (mode === C.gamemode_2_player_contest) {
    // contest: CODE_BBC85B swaps to the other player's data, load it too, swap back
    CODE_BBC85B();
    CODE_BBC736();
    CODE_BBC85B();
  }
  // .CODE_808F2D
  reg.a = r16(R.world_number);
  init_world_map();
}

/** $808F4A — default status for a new file (both players in contest mode). */
export function CODE_808F4A() {
  CODE_808FDC();
  if (r16(R.current_game_mode) === C.gamemode_2_player_contest) return CODE_808F59();
  set_default_new_file_status();
}

/** $808F59 */
export function CODE_808F59() {
  CODE_BBC85B();
  set_default_new_file_status();
  CODE_BBC85B();
  set_default_new_file_status();
}

/** $808F68 */
export function set_default_new_file_status_global() {
  set_default_new_file_status();
}

/** $808F6C — start of a new game: Pirate Panic, 4 lives (50 with the yasadlad cheat)... */
export function set_default_new_file_status() {
  w16(R.level_number, C.level_pirate_panic);
  w16(R.pirate_panic_level_number_unused, C.level_pirate_panic);
  w16(R.parent_level_number, C.level_pirate_panic);
  w16(R.RAM_0BA4, 0xfffc);
  for (const a of [
    R.exiting_sub_level_flag,
    R.game_state_flags,
    R.gameplay_frame_counter,
    R.gameplay_frame_counter_high,
    R.current_player_mount,
    R.animal_type,
    R.level_entrance_number,
    R.checkpoint_level_entrance_number,
    R.checkpoint_level_number,
    R.checkpoint_animal_type,
    R.banana_count,
    R.banana_counter_current,
  ])
    w16(a, 0);
  const lives = r16(R.cheat_enable_flags) & 0x0002 ? 0x32 : 0x04;
  w16(R.life_count, lives);
  w16(R.life_count_display, lives);
  w16(R.screen_brightness, 0x0080);
  w16(R.sprite_dma_buffer_limit, 0x002c);
  reg.a = r16(R.active_kong_number);
  set_active_kong_global();
  CODE_B48000(); // initialize the world map state
  // (Rev 1) clear the collected tokens buffer
  for (let x = 0; x < 0x60; x += 2) w16(R.collected_tokens_buffer + x, 0);
  reg.x = 0x60;
  reg.a = 0;
}

/**
 * $808FDC — seed the RNG for a file. The original also checks at runtime that bank $80's code
 * ends below the ROM header (constant data; the check always passes).
 */
export function CODE_808FDC() {
  w16(R.rng_result, 0x1234);
  w16(R.rng_seed_2, 0x1234);
  reg.a = L("bank_80_end") & 0xffff;
  if (((reg.a - (L("rom_header") & 0xffff)) & 0x8000) === 0) return CODE_808FF3();
  CODE_808FFA();
}

/** $808FF3 */
export function CODE_808FF3() {
  reg.a = 0x000f;
  throw_exception();
  CODE_808FFA();
}

/** $808FFA */
export function CODE_808FFA() {}

/** $808FFB — (dead) the demo recorder that followed was disabled with an early RTS. */
export function CODE_808FFB() {}

/** $809012 — (dead demo recorder) start a new [buttons, frames] entry; the writes go to ROM. */
export function CODE_809012() {
  reg.x = (reg.x + 4) & 0xffff;
  reg.a = 1;
  w16(R.demo_sequence_index, reg.x);
}

// ---------------------------------------------------------------------------------------------

/** $808684 — (unreferenced debug) show the monkey museum text screen and hang. */
export function CODE_808684() {
  disable_screen();
  io8(PPU.layer_1_scroll_y, 0xff);
  io8(PPU.layer_1_scroll_y, 0xff);
  reg.a = L("monkey_museum_palette") & 0xffff;
  reg.y = 0;
  reg.x = 0x40;
  dma_palette();
  reg.a = C.monkey_museum_vram_payload_id;
  vram_payload_handler_global();
  reg.a = C.npc_generic_ppu_config_id;
  set_ppu_registers_global();
  // upload $64 rows of 8 text words followed by 8 blank words ("spaced out text")
  const TEXT = L("text_tiledata");
  io8(PPU.vram_address, 0x00);
  io8(PPU.vram_address + 1, 0x70);
  let x = 0;
  for (let row = 0; row < 0x64; row++) {
    do {
      const v = bus16(TEXT + x);
      io8(PPU.vram_write, v & 0xff);
      io8(PPU.vram_write + 1, v >> 8);
      x += 2;
    } while (x & 0x0f);
    for (let i = 0; i < 8; i++) {
      io8(PPU.vram_write, 0);
      io8(PPU.vram_write + 1, 0);
    }
  }
  w16(R.pending_dma_hdma_channels, 1);
  io8(PPU.screen, 0x0f);
  // .infinite_loop: the original hangs here forever (NMIs keep firing)
  endFrame();
}

// tails of RTS routines whose generated stubs assume RTL
for (const t of ["CODE_80875E", "CODE_80876E", "CODE_808FF3"]) setRetMode(L(t), RET_RTS);

register({
  CODE_8087E1,
  CODE_80880A,
  CODE_808819,
  CODE_808830,
  CODE_8086F6,
  CODE_8087C9,
  CODE_808712,
  CODE_80875E,
  CODE_80876E,
  CODE_8087B8,
  start_ending_parade,
  ending_parade_game_mode,
  CODE_8087D9,
  set_active_kong_global,
  set_active_kong,
  swap_active_kong_global,
  swap_active_kong,
  get_level_number,
  run_bonus_and_credits_screen,
  run_ending_monkey_museum,
  run_crocodile_isle,
  run_crocodile_isle_krool_fall,
  run_simple_world_map,
  run_808CF5,
  run_808D02,
  run_npc_intro_dialogue,
  npc_wait_for_nmi,
  run_npc_dialogue_selection,
  run_808D30,
  run_808D3D,
  run_808D4E,
  run_808D5F,
  run_808D70,
  run_npc_exit,
  init_npc_screen_kongs,
  CODE_808DFB,
  spawn_npc_screen_diddy,
  CODE_8090BB,
  init_new_file,
  init_existing_file,
  CODE_808F4A,
  CODE_808F59,
  set_default_new_file_status_global,
  set_default_new_file_status,
  CODE_808FDC,
  CODE_808FF3,
  CODE_808FFA,
  CODE_808FFB,
  CODE_809012,
  CODE_808684,
});
