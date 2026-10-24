/**
 * Bank $80 — the game mode select screen shown when a new file is started:
 * 1 PLAYER / 2 PLAYER TEAM / 2 PLAYER CONTEST, plus the hidden MUSIC TEST and CHEAT entries
 * (current_game_mode = $060D = 3 and 4, reached by pressing DOWN five times on the last entry).
 * On the cheat entry, the button codes BARRALAX and YASADLAD enable the cheats.
 *
 * The menu scrolls vertically (screen_scroll_y_position eases to the selected entry) and an HDMA
 * table at $7E8012 (write_byte entries of $2130) highlights the selected row.
 */
import { r8, w8, r16, w16, io8, io16, ioR8, bus8, bus16 } from "../../core/mem";
import { reg, register } from "../../core/cpu";
import { endFrame } from "../../core/hybrid";
import { L, R, C, CPU, PPU, HDMA } from "../../core/sym";
import {
  disable_screen,
  decompress_data,
  clear_vram_block,
  dma_palette,
  dma_sprite_palette_from_index,
  set_fade,
  set_nmi_and_wait_2,
  fade_screen,
  intro_controller_read,
  init_new_file,
} from "../../gen/routines";
import { init_registers_global, clear_vram } from "./b80a_boot";
import { clear_noncritical_wram, set_all_oam_offscreen, dma_to_vram_global } from "./b80a_wram";
import { prepare_oam_dma_channel } from "./b80a_frame";
import { play_high_priority_sound, play_song_with_transition } from "./b80a_util";

const MODE = R.current_game_mode; // $060D: menu entry (0-2 game modes, 3 music test, 4 cheats)
const MUSIC_TEST_SONG = 0x84;
const DOWN_PRESSES = 0x36; // DOWN presses on the last entry (5 opens the next hidden entry)
const DOWN_TIMEOUT = 0x38;
const BARRALAX_INDEX = 0x3a;
const YASADLAD_INDEX = 0x3c;
const HDMA_TABLE = 0x7e8012;

const BARRALAX = L("barralax_cheat_inputs");
const YASADLAD = L("yasadlad_cheat_inputs");
const MUSIC_TEST_TEXT = L("music_test_text_table");
const YELLOW_FONT = L("yellow_font_tile_offsets");

const sound = (channel: number, effect: number) => (channel << 8) | effect;
function playSound(channel: number, effect: number) {
  reg.a = sound(channel, effect);
  play_high_priority_sound();
}

function decompress(label: string) {
  const a = L(label);
  reg.x = a & 0xffff;
  reg.y = a >> 16;
  reg.a = 0;
  decompress_data();
}
function upload(vramWord: number, bank: number, src: number, size: number) {
  io16(PPU.vram_address, vramWord);
  reg.x = bank;
  reg.a = src;
  reg.y = size;
  dma_to_vram_global();
}

/** $8097CD — build the game mode select screen. */
export function init_game_mode_select() {
  disable_screen();
  reg.db = 0x80;
  clear_vram();
  init_registers_global();
  clear_noncritical_wram();
  set_all_oam_offscreen();
  reg.db = 0x80;
  w16(R.cheat_enable_flags, 0);
  CODE_8097EB();
  io16(PPU.layer_mode, 0x0001);
  io16(PPU.screens, 0x0213);
  io16(PPU.layer_all_tiledata_base, 0x0014);
  io16(PPU.window_1, 0xff68);
  io8(PPU.set_window_sprite_color, 0x30);
  io8(PPU.fixed_color, 0xe8);
  io16(PPU.color_addition_logic, 0x4100);
  io16(PPU.layer_1_2_tilemap_base, 0x7c76);
  io8(PPU.layer_1_scroll_x, 0);
  io8(PPU.layer_1_scroll_x + 1, 0);
  io8(PPU.layer_1_scroll_x, 0);
  io8(PPU.layer_1_scroll_x + 1, 0);
  io8(PPU.layer_1_scroll_y, 0xff);
  io8(PPU.layer_1_scroll_y, 0xff);
  io8(PPU.layer_2_scroll_y, 0xff);
  io8(PPU.layer_2_scroll_y, 0xff);
  io8(PPU.layer_2_scroll_x, 0);
  io8(PPU.layer_2_scroll_x, 0);
  // color math HDMA ($2130): one band per menu row
  w16(0x7e8012, 0x004f);
  w16(0x7e8013, 0x0122);
  w16(0x7e8015, 0x0040);
  w16(0x7e8016, 0x8102);
  w16(0x7e8018, 0x0050);
  w16(0x7e8019, 0x8102);
  w16(0x7e801b, 0x0050);
  w16(0x7e801c, 0x8102);
  w16(0x7e801e, 0x0001);
  w16(0x7e801f, 0x8102);
  w16(0x7e8021, 0x0000);
  io16(HDMA.settings + 0x20, 0x3001);
  io16(HDMA.source + 0x20, 0x8012);
  io8(HDMA.source_bank + 0x20, 0x7e);
  io8(HDMA.indirect_source_bank + 0x20, 0);
  decompress("DATA_EC83A0");
  upload(0x1000, 0x7f, 0x0000, 0x6000);
  decompress("DATA_EC4D40");
  upload(0x4000, 0x7f, 0x0000, 0x8000);
  upload(0x0020, L("DATA_FC0660") >> 16, L("DATA_FC0660") & 0xffff, 0x1e00);
  decompress("DATA_EC7CF0");
  upload(0x7c00, 0x7f, 0x0000, 0x0800);
  reg.a = 0x7400;
  clear_vram_block();
  reg.a = 0x7800;
  clear_vram_block();
  decompress("DATA_EC4749");
  upload(0x7420, 0x7f, 0x0000, 0x0680);
  decompress("DATA_EC4AAD");
  upload(0x7780, 0x7f, 0x0000, 0x0240);
  decompress("DATA_EC4C1C");
  upload(0x78c0, 0x7f, 0x0000, 0x01c0);
  reg.y = 0x0000;
  reg.x = 0x0040;
  reg.a = L("file_select_screen_palette") & 0xffff;
  dma_palette();
  reg.y = 0x0080;
  reg.x = 0x0004;
  reg.a = C.map_p1_kong_and_text_spr_palette;
  dma_sprite_palette_from_index();
  w16(MUSIC_TEST_SONG, 0);
  reg.a = 0x0300;
  set_fade();
  CODE_8099A7();
}

/** $8097EB — clear the scratch RAM $32-$51. */
export function CODE_8097EB() {
  for (let x = 0x1e; x >= 0; x -= 2) w16(R.temp_32 + x, 0);
  reg.x = 0xfffe;
  reg.a = 0;
}

/** $8099A7 — (re)arm the menu NMI and wait (also after changing the music test song). */
export function CODE_8099A7() {
  w16(DOWN_PRESSES, 0);
  ioR8(CPU.irq_flag);
  io8(PPU.oam_address_high, 0x80);
  io8(CPU.rom_speed, 0x01);
  prepare_oam_dma_channel();
  reg.a = L("run_game_mode_select") & 0xffff;
  set_nmi_and_wait_2();
}

/** $8099C3 — NMI routine of the game mode select screen. */
export function run_game_mode_select() {
  io16(PPU.oam_address, 0);
  io16(CPU.enable_dma, 0x0401); // OAM DMA + color math HDMA
  const sy = (r16(R.screen_scroll_y_position) - 1) & 0xffff;
  io8(PPU.layer_1_scroll_y, sy & 0xff);
  io8(PPU.layer_1_scroll_y, sy >> 8);
  io8(PPU.screen, r8(R.screen_brightness));
  fade_screen();
  w16(R.active_frame_counter, (r16(R.active_frame_counter) + 1) & 0xffff);
  intro_controller_read();
  prepare_oam_dma_channel();
  for (const a of [0x7e8013, 0x7e8016, 0x7e8019, 0x7e801c, 0x7e801f]) w16(a, 0x4102);
  if (!(r16(R.screen_brightness) & 0x8000) && handleMenuInput()) return;
  // CODE_809ADC: ease the menu scroll towards the selected group of entries
  const mode = r16(MODE);
  const target = mode === 3 ? 0x48 : mode > 3 ? 0x90 : 0x00;
  scrollMenu(target);
  cheatCodes();
  // CODE_809C02: highlight the selected row
  w16(0x32, r16(MODE));
  w16(HDMA_TABLE + r16(MODE) * 3 + 1, 0x0120);
  if (r16(R.player_1_pressed) & C.input_ABXY_start && r16(MODE) < 3 && r16(R.screen_brightness) === 0x000f) {
    w16(R.screen_brightness, 0x820f); // fade out, then start the game
    playSound(6, C.sound_menu_select);
  }
  // CODE_809C38
  set_all_oam_offscreen();
  reg.db = 0x80;
  if (r16(MODE) === 3) {
    CODE_809DE2();
    if (musicTestInput()) return;
  }
  // CODE_809C8A
  if (r16(R.screen_brightness) === 0x8201) {
    init_new_file();
    return;
  }
  endFrame(); // .wait: WAI
}

/**
 * CODE_809A13 — UP/DOWN move through the entries; DOWN 5 times on the last visible entry
 * reveals the music test / cheat entries. Returns true when the frame was already ended
 * (leaving the music test restarts the menu's NMI).
 */
function handleMenuInput(): boolean {
  const p = r16(R.player_1_pressed);
  if (p & C.input_up && r16(MODE) !== 0) {
    if (r16(MODE) === 3 && r16(MUSIC_TEST_SONG) !== 0) {
      leaveMusicTest(-1);
      return true;
    }
    // CODE_809A49
    playSound(6, C.sound_menu_move);
    w16(MODE, (r16(MODE) - 1) & 0xffff);
  }
  // CODE_809A53
  if (p & C.input_down && r16(MODE) < 2) {
    w16(MODE, r16(MODE) + 1);
    playSound(6, C.sound_menu_move);
    return false;
  }
  // CODE_809A6F: count DOWN presses on the last entry (reset after $20 frames or another button)
  w16(DOWN_TIMEOUT, (r16(DOWN_TIMEOUT) + 1) & 0xffff);
  if (r16(DOWN_TIMEOUT) === 0x20 || p & ~C.input_down & 0xffff) {
    w16(DOWN_PRESSES, 0);
    w16(DOWN_TIMEOUT, 0);
  }
  // CODE_809A84
  if (r16(MODE) >= 2 && p & C.input_down) {
    w16(DOWN_PRESSES, (r16(DOWN_PRESSES) + 1) & 0xffff);
    w16(DOWN_TIMEOUT, 0);
    if (r16(DOWN_PRESSES) === 5) {
      w16(DOWN_PRESSES, 0);
      const mode = r16(MODE);
      if (mode !== 4) {
        if (mode === 3 && r16(MUSIC_TEST_SONG) !== 0) {
          leaveMusicTest(+1);
          return true;
        }
        // CODE_809AD2
        playSound(6, C.sound_menu_move);
        w16(MODE, (r16(MODE) + 1) & 0xffff);
      }
    }
  }
  return false;
}

/** Leaving the music test with a song playing: back to the menu music. */
function leaveMusicTest(dir: number) {
  io8(CPU.enable_interrupts, 0x01); // NMI off while the song uploads
  reg.a = C.music_file_select;
  play_song_with_transition();
  w16(MUSIC_TEST_SONG, 0);
  if (dir < 0) {
    w16(MODE, (r16(MODE) - 1) & 0xffff);
    playSound(6, C.sound_menu_move);
  } else {
    w16(MODE, (r16(MODE) + 1) & 0xffff);
    playSound(6, C.sound_menu_move);
  }
  CODE_8099A7();
}

/** CODE_809AF1 — scroll += (target - scroll) / 8 with 16.16 precision ($17C2 = fraction). */
function scrollMenu(target: number) {
  let a = (target - r16(R.screen_scroll_y_position)) & 0xffff;
  let frac = 0;
  for (let i = 0; i < 3; i++) {
    const bit = a & 1;
    a = (a >> 1) | (a & 0x8000); // CMP #$8000 : ROR A (arithmetic shift)
    frac = (frac >> 1) | (bit << 15);
  }
  w16(0x32, frac);
  w16(0x34, a);
  const f = r16(0x17c2) + frac;
  w16(0x17c2, f & 0xffff);
  const scroll = (r16(R.screen_scroll_y_position) + a + (f > 0xffff ? 1 : 0)) & 0xffff;
  w16(R.screen_scroll_y_position, scroll);
  // the HDMA table's first band shrinks as the menu scrolls up
  if (scroll < 0x004f) {
    w8(0x7e8012, (0x004f - scroll) & 0xff);
    w8(0x7e8015, 0x40);
    w8(0x7e8018, 0x50);
    io16(HDMA.source + 0x20, 0x8012);
  } else if (scroll < 0x008f) {
    w8(0x7e8015, (0x008f - scroll) & 0xff);
    w8(0x7e8018, 0x50);
    io16(HDMA.source + 0x20, 0x8015);
  } else {
    w8(0x7e8018, (0x00df - scroll) & 0xff);
    io16(HDMA.source + 0x20, 0x8018);
  }
}

/** CODE_809B82 / CODE_809BC2 — BARRALAX and YASADLAD button codes on the cheat entry. */
function cheatCodes() {
  checkCheat(BARRALAX, BARRALAX_INDEX, 0x0001);
  checkCheat(YASADLAD, YASADLAD_INDEX, 0x0002);
}

function checkCheat(table: number, index: number, flag: number) {
  if (r16(MODE) !== 4 || r16(R.cheat_enable_flags) & flag) return;
  const x = r16(index);
  const p = r16(R.player_1_pressed);
  if (!p) return;
  if (!(p & bus16(table + x))) {
    w16(index, 0); // wrong button: start over
    return;
  }
  w16(index, (x + 2) & 0xffff);
  if (r16(index) !== 0x10) return;
  playSound(5, C.sound_swap_kongs);
  w16(R.cheat_enable_flags, r16(R.cheat_enable_flags) | flag);
  io8(PPU.screen, 0); // the screen blinks off for a frame
}

/**
 * CODE_809C38 (music test part) — LEFT / RIGHT-ish buttons change the song (1-$1F) and play it.
 * Returns true when a song was started (the menu NMI is re-armed, frame ended).
 */
function musicTestInput(): boolean {
  const p = r16(R.player_1_pressed);
  let song = r16(MUSIC_TEST_SONG);
  if (p & C.input_left) {
    song = (song - 1) & 0xffff;
    if (song & 0x8000 || song === 0) song = 0x1f;
  } else if (p & 0xd1c0) {
    song = (song + 1) & 0xffff;
    if (song >= 0x20) song = 1;
  } else return false;
  w16(MUSIC_TEST_SONG, song);
  // CODE_809C6F
  io8(CPU.enable_interrupts, 0x01);
  reg.a = song === C.music_bonus ? C.music_bonus | 0x0300 : song;
  play_song_with_transition();
  CODE_8099A7();
  return true;
}

/** $809DE2 — draw the name of the music test song with yellow font sprites. */
export function CODE_809DE2() {
  const song = r16(MUSIC_TEST_SONG);
  if (song) {
    w16(0x3a, bus16(MUSIC_TEST_TEXT + song * 2));
    w16(0x3c, MUSIC_TEST_TEXT >> 16);
    let y = 0;
    let pos = (0x0100 - r16(R.screen_scroll_y_position)) & 0xffff;
    pos = ((pos >> 8) | ((pos & 0xff) << 8)) + 0x1080;
    if (pos > 0xffff || pos >= 0xe000) pos = 0xe000;
    w16(0x32, pos);
    for (;;) {
      const text = ((r16(0x3c) & 0xff) << 16) | r16(0x3a);
      const ch = bus8(text);
      if (ch === 0) break;
      if (ch !== 0x20) {
        const tile = ((bus8(YELLOW_FONT + ch - 0x21) << 1) + 0x3002) & 0xffff;
        w16(0x34, tile);
        // two 8x8 sprites: top and bottom halves of the letter
        w16(0x0200 + y, r16(0x32));
        w16(0x0202 + y, tile);
        w16(0x0204 + y, (r16(0x32) + 0x0800) & 0xffff);
        w16(0x34, (tile + 1) & 0xffff);
        w16(0x0206 + y, (tile + 1) & 0xffff);
        y += 8;
      }
      // CODE_809E4D
      w16(0x3a, (r16(0x3a) + 1) & 0xffff);
      w16(0x32, (r16(0x32) + 8) & 0xffff);
    }
    reg.y = y;
  }
  CODE_809E59();
}

/** $809E59 — 8x8 size for the first 18 sprites (the music test text). */
export function CODE_809E59() {
  for (let i = 0; i <= 0x10; i += 2) w16(R.oam_attribute_table + i, 0);
}

register({
  init_game_mode_select,
  CODE_8097EB,
  CODE_8099A7,
  run_game_mode_select,
  CODE_809DE2,
  CODE_809E59,
});
