/**
 * Bank $80 — the file select screen (also used as the "save game" screen from Wrinkly's).
 *
 * Selection indices: 0-2 = files 1-3, 3 = COPY, 4 = language, 5 = ERASE, 6 = mono/stereo.
 * file_select_action bits:
 *   $0001 save game screen         $0002 erase: choose the file   $0004 erase done
 *   $0008 copy: choose the source  $0010 copy: choose the target  $0020 copy: target chosen
 *   $0040 copy done                $0080 language toggled         $0100 channel count toggled
 * An HDMA windowing table (hdma_menu_windowing, write_word entries for $2126/$2127) highlights
 * the selected entry.
 */
import { r8, r16, w16, io8, io16, ioR8, bus8, bus16, busW16 } from "../../core/mem";
import { reg, register } from "../../core/cpu";
import { endFrame } from "../../core/hybrid";
import { L, R, C, CPU, PPU, DMA, HDMA } from "../../core/sym";
import {
  disable_screen,
  decompress_data,
  upload_fileselect_tilemap,
  upload_language_tilemap,
  upload_channel_count_tilemap,
  upload_file_tilemaps,
  upload_file_tilemap,
  get_file_status,
  validate_save_file,
  dma_palette,
  set_fade,
  set_nmi_and_wait_2,
  fade_screen,
  intro_controller_read,
  init_game_mode_select,
} from "../../gen/routines";
import { init_registers_global, clear_vram } from "./b80a_boot";
import { clear_noncritical_wram, set_all_oam_offscreen, dma_to_vram_global } from "./b80a_wram";
import { prepare_oam_dma_channel } from "./b80a_frame";
import { CODE_8090BB, init_existing_file } from "./b80a_modes";
import { play_high_priority_sound, play_song, spend } from "./b80a_util";

const WINDOWING = R.hdma_menu_windowing; // write_word entries: count (1) + value (2)
const SRAM_FILE_OFFSETS = L("run_file_select_sram_file_offsets");
const FILE_TILEMAP_VRAM = L("DATA_80A866");
const MOVE_UP = L("run_file_select_move_selection_up");
const MOVE_DOWN = L("run_file_select_move_selection_down");
const MOVE_LEFT = L("run_file_select_move_selection_left");
const MOVE_RIGHT = L("run_file_select_move_selection_right");
const SAVE_FILE_SIZE = 0x2a8; // sizeof(save_file)
const SRAM_BANK = 0xb0;

const ACTION = R.file_select_action;
const SELECTION = R.file_select_selection;

function playSound(channel: number, effect: number) {
  reg.a = (channel << 8) | effect;
  play_high_priority_sound();
}

/** 24-bit pointer stored at dp (lo word) / dp+2 (bank) */
const ptrAt = (dp: number) => ((r16(dp + 2) & 0xff) << 16) | r16(dp);
const addY = (p: number, y: number) => (p + y) & 0xffffff;

/** SRAM address of file `n` into the pointer at `dp` (sram_file_offsets). */
function setFilePointer(dp: number, n: number) {
  w16(dp, bus16(SRAM_FILE_OFFSETS + ((n << 1) & 0xffff)));
  w16(dp + 2, SRAM_BANK);
}

function tilemap(label: string, vramWord: number) {
  const a = L(label);
  reg.x = a & 0xffff;
  reg.y = a >> 16;
  reg.a = vramWord;
  upload_fileselect_tilemap();
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

/** $80A5F1 — build the file select screen (saving the game first when coming from Wrinkly). */
export function init_file_select() {
  disable_screen();
  reg.db = 0x80;
  clear_vram();
  init_registers_global();
  clear_noncritical_wram();
  set_all_oam_offscreen();
  reg.a = C.music_file_select;
  play_song();
  if (r16(ACTION)) {
    // save game: write the file buffer to the selected SRAM file
    setFilePointer(R.temp_32, r16(SELECTION));
    const dst = ptrAt(R.temp_32);
    for (let y = SAVE_FILE_SIZE - 2; y >= 0; y -= 2) busW16(addY(dst, y), r16(R.sram_file_buffer + y));
    spend((SAVE_FILE_SIZE / 2) * 140);
    reg.y = 0xfffe;
  }
  // .skip_sram_copy
  reg.db = 0x80;
  io16(PPU.layer_mode, 0x0001);
  io16(PPU.screens, 0x0213);
  io16(PPU.layer_all_tiledata_base, 0x0015);
  io16(PPU.window_1, 0x8020);
  io8(PPU.set_window_sprite_color, 0x30);
  io8(PPU.fixed_color, 0xe8);
  io16(PPU.color_addition_logic, 0x4122);
  io16(PPU.layer_1_2_tilemap_base, 0x7c74);
  // STZ (16-bit) $210D twice: also clears $210E, which is then set to $FF
  for (let i = 0; i < 2; i++) {
    io8(PPU.layer_1_scroll_x, 0);
    io8(PPU.layer_1_scroll_x + 1, 0);
  }
  io8(PPU.layer_1_scroll_y, 0xff);
  io8(PPU.layer_1_scroll_y, 0xff);
  io8(PPU.layer_2_scroll_y, 0xff);
  io8(PPU.layer_2_scroll_y, 0xff);
  io8(PPU.layer_2_scroll_x, 0);
  io8(PPU.layer_2_scroll_x, 0);
  // windowing HDMA: header, files 1-3, copy/erase, language/channels
  const rows: [number, number][] = [
    [0x28, 0x0000],
    [0x28, 0x8102],
    [0x28, 0x8102],
    [0x28, 0x8102],
    [0x28, 0x8102],
    [0x01, 0x8102],
  ];
  rows.forEach(([count, value], i) => {
    w16(WINDOWING + i * 3, count);
    w16(WINDOWING + i * 3 + 1, value);
  });
  w16(WINDOWING + 6 * 3, 0x0000);
  io16(HDMA.settings + 0x20, 0x2601);
  io16(HDMA.source + 0x20, WINDOWING & 0xffff);
  io8(HDMA.source_bank + 0x20, WINDOWING >> 16);
  io8(HDMA.indirect_source_bank + 0x20, 0);
  decompress("DATA_ED5E3F"); // menu font / UI tiles
  upload(R.vram_menus_ui_tiledata, 0x7f, 0x0000, 0x6000);
  tilemap("DATA_ED7507", R.vram_menus_select_game_tilemap);
  tilemap("DATA_ED7429", R.vram_menus_file_number_1_tilemap);
  tilemap("DATA_ED7433", R.vram_menus_file_number_2_tilemap);
  tilemap("DATA_ED743D", R.vram_menus_file_number_3_tilemap);
  if (r16(ACTION)) {
    tilemap("DATA_ED7607", R.vram_menus_save_game_tilemap);
  } else {
    tilemap("DATA_ED7569", R.vram_menus_copy_erase_tilemap);
    upload_language_tilemap();
    upload_channel_count_tilemap();
  }
  // .skip_options: the map background
  decompress("DATA_EC83A0");
  upload(R.vram_menus_map_bg_tiledata, 0x7f, 0x0000, 0x8000);
  decompress("DATA_EC7CF0");
  upload(R.vram_menus_map_bg_tilemap, 0x7f, 0x0000, 0x0800);
  upload_file_tilemaps();
  reg.y = 0x0000;
  reg.x = 0x0040;
  reg.a = L("file_select_screen_palette") & 0xffff;
  dma_palette();
  // first frames of the spinning DK coin and Kremkoin
  io16(PPU.vram_address, 0);
  reg.x = 0xfb;
  reg.a = L("DATA_FB0180") & 0xffff;
  reg.y = 0x0080;
  dma_to_vram_global();
  reg.x = 0xfb;
  reg.a = L("DATA_FB0400") & 0xffff;
  reg.y = 0x0080;
  dma_to_vram_global();
  w16(R.oam_attribute_table + 0, 0);
  w16(R.oam_attribute_table + 2, 0);
  w16(R.oam_attribute_table + 4, 0);
  reg.a = 0x0300;
  set_fade();
  ioR8(CPU.irq_flag); // acknowledge a stray IRQ
  io8(PPU.oam_address_high, 0x80);
  io8(CPU.rom_speed, 0x01);
  prepare_oam_dma_channel();
  reg.a = L("run_file_select") & 0xffff;
  set_nmi_and_wait_2();
}

/** $80A82B — write a 16x16 sprite (4 OAM entries at X) at position $36 with tile $34. */
export function CODE_80A82B() {
  const x = reg.x;
  const pos = r16(0x36);
  const tile = r16(0x34);
  w16(0x0200 + x, pos);
  w16(0x0202 + x, tile);
  w16(0x0204 + x, (pos + 0x0008) & 0xffff);
  w16(0x0206 + x, (tile + 1) & 0xffff);
  w16(0x0208 + x, (pos + 0x0800) & 0xffff);
  w16(0x020a + x, (tile + 2) & 0xffff);
  w16(0x020c + x, (pos + 0x0808) & 0xffff);
  reg.a = (tile + 3) & 0xffff;
  w16(0x020e + x, reg.a);
}

/** $80A86C — NMI routine of the file select screen. */
export function run_file_select() {
  io16(PPU.oam_address, 0);
  io16(CPU.enable_dma, 0x0401); // OAM DMA + windowing HDMA
  if (!(r16(ACTION) & 0x00e4)) animateCoins();
  // .skip_kremkoin_update
  if (r16(ACTION) & 0x0080) {
    upload_language_tilemap();
    w16(ACTION, r16(ACTION) & ~0x0080);
  }
  if (r16(ACTION) & 0x0100) {
    upload_channel_count_tilemap();
    w16(ACTION, r16(ACTION) & ~0x0100);
  }
  let refresh = false;
  if (r16(ACTION) & 0x0004) {
    w16(ACTION, r16(ACTION) & ~0x0006); // erase done
    refresh = true;
  } else if (r16(ACTION) & 0x0040) {
    w16(ACTION, r16(ACTION) & ~0x0078); // copy done
    refresh = true;
  }
  if (refresh) {
    // .handle_file_action: redraw the changed file's line
    const x = (r16(SELECTION) << 1) & 0xffff;
    w16(0x54, bus16(SRAM_FILE_OFFSETS + x));
    w16(0x56, SRAM_BANK);
    reg.a = bus16(FILE_TILEMAP_VRAM + x);
    reg.x = r16(SELECTION);
    upload_file_tilemap();
  }
  // .skip_ending_copy
  if (r16(ACTION) & 0x0020) {
    // copy target chosen: blank its line first
    reg.a = bus16(FILE_TILEMAP_VRAM + ((r16(SELECTION) << 1) & 0xffff));
    const t = L("DATA_ED7717");
    reg.x = t & 0xffff;
    reg.y = t >> 16;
    upload_fileselect_tilemap();
    w16(ACTION, r16(ACTION) | 0x0040);
  }
  io8(PPU.screen, r8(R.screen_brightness));
  w16(R.nmi_pointer, L("run_incomplete_frame") & 0xffff);
  fade_screen();
  // windowing off on every entry (re-enabled below for the selected one)
  for (let i = 1; i <= 5; i++) w16(WINDOWING + i * 3 + 1, 0xff00);
  if (!(r16(R.screen_brightness) & 0x8000) && !(r16(ACTION) & 0x0001)) moveSelection();
  // .no_directions_pressed
  const f = r16(R.active_frame_counter);
  if (!(r16(ACTION) & 0x000a) || f & 0x0004) highlightSelection();
  // .skip_windowing: flash COPY and the source file / ERASE while choosing
  if (r16(ACTION) & 0x0008 && f & 0x0008) {
    w16(WINDOWING + 4 * 3 + 1, 0xff80);
    if (r16(ACTION) & 0x0010) w16(WINDOWING + 3 + r16(R.file_select_file_to_copy) * 3 + 1, 0x0000);
  }
  if (r16(ACTION) & 0x0002 && f & 0x0008) w16(WINDOWING + 4 * 3 + 1, 0x8000);
  if (r16(R.player_active_pressed) & C.input_ABXY_start && r16(R.screen_brightness) === 0x000f) checkMenuSelection();
  // .finish_file_select_frame
  intro_controller_read();
  w16(R.active_frame_counter, (r16(R.active_frame_counter) + 1) & 0xffff);
  if (r16(R.screen_brightness) === 0x8201) {
    // faded out: continue
    if (r16(ACTION)) CODE_8090BB(); // back to Wrinkly after saving
    else loadSelectedFile();
    return;
  }
  // .prepare_file_select_nmi
  prepare_oam_dma_channel();
  w16(R.nmi_pointer, L("run_file_select") & 0xffff);
  endFrame(); // .spinlock: WAI
}

/** Spin the DK coin and the Kremkoin (8 frames each, every 4th frame, out of phase). */
function animateCoins() {
  const f = r16(R.active_frame_counter);
  if (!(f & 0x0003)) coinFrame(L("DATA_FB0000"), (f & 0x001c) << 5, 0x0000, R.vram_menus_dk_coin);
  const g = (f + 2) & 0xffff;
  if (!(g & 0x0003)) coinFrame(L("DATA_FB0400"), (g & 0x001c) << 5, 0x0040, 0x0080);
}

function coinFrame(base: number, offset: number, vramWord: number, size: number) {
  const src = ((base & 0xffff) + offset) & 0xffff;
  io16(DMA.source + 0x10, src);
  io16(DMA.unused_2 + 0x10, src);
  io16(PPU.vram_address, vramWord);
  io16(DMA.size + 0x10, size);
  io16(DMA.settings + 0x10, 0x1801);
  io8(DMA.source_bank + 0x10, base >> 16);
  io8(CPU.enable_dma, 0x02);
}

/** D-pad: move the selection through the menu grid. */
function moveSelection() {
  const x = r16(SELECTION);
  const p = r16(R.player_active_pressed_high);
  let table: number;
  if (p & 0x01) table = MOVE_RIGHT;
  else if (p & 0x02) table = MOVE_LEFT;
  else if (p & 0x04) table = MOVE_DOWN;
  else if (p & 0x08) table = MOVE_UP;
  else return;
  const next = bus8(table + x);
  if (next === r16(SELECTION)) return;
  w16(SELECTION, next);
  playSound(6, C.sound_menu_move);
}

/** .skip_window_flashing — window the selected entry (left/right half for the option pairs). */
function highlightSelection() {
  const sel = r16(SELECTION);
  let value: number;
  let x: number;
  if (sel === 4) [value, x] = [0x8000, 0x0d]; // language: right half of the last row
  else if (sel === 6) [value, x] = [0xff80, 0x0d]; // channels: left half
  else if (sel === 5) [value, x] = [0x8000, 0x0a]; // erase: right half
  else if (sel === 3) [value, x] = [0xff80, 0x0a]; // copy: left half
  else {
    // a file: the whole row
    w16(R.temp_32, sel);
    x = (sel * 3 + 1) & 0xffff;
    value = 0x0000;
  }
  w16(WINDOWING + 3 + x, value);
}

/** .check_menu_selection — A/B/X/Y/START on the selected entry. */
function checkMenuSelection() {
  const sel = r16(SELECTION);
  if (sel === 5) {
    // .handle_erase_selection: toggle erase mode
    playSound(6, C.sound_menu_select);
    if (r16(ACTION) & 0x0002) w16(ACTION, r16(ACTION) & ~0x0006);
    else w16(ACTION, 0x0002);
    return;
  }
  if (sel === 3) {
    // .handle_copy_selection: toggle copy mode
    playSound(6, C.sound_menu_select);
    if (r16(ACTION) & 0x0008) w16(ACTION, r16(ACTION) & ~0x0078);
    else w16(ACTION, 0x0008);
    return;
  }
  if (sel === 4) {
    playSound(6, C.sound_menu_select);
    w16(R.language_select, r16(R.language_select) ^ 0x0001);
    w16(ACTION, 0x0080);
    return;
  }
  if (sel === 6) {
    playSound(6, C.sound_menu_select);
    w16(R.stereo_select, r16(R.stereo_select) ^ 0x0001);
    w16(ACTION, 0x0100);
    return;
  }
  // a file was chosen
  const action = r16(ACTION);
  if (action & 0x0008) {
    if (!(action & 0x0010)) {
      // .handle_first_copy_file_selected
      w16(ACTION, r16(ACTION) | 0x0010);
      playSound(6, C.sound_menu_select);
      w16(R.file_select_file_to_copy, r16(SELECTION));
    } else copyFile();
    return;
  }
  if (action & 0x0002) {
    playSound(6, C.sound_menu_select);
    eraseFile();
    return;
  }
  // .handle_file_selected: fade out and load it
  playSound(6, C.sound_menu_select);
  w16(R.screen_brightness, 0x820f);
}

/** .erase_file — invalidate the selected file by bumping its checksum. */
function eraseFile() {
  setFilePointer(R.temp_32, r16(SELECTION));
  const p = ptrAt(R.temp_32);
  busW16(p, (bus16(p) + 1) & 0xffff); // additive_checksum
  w16(ACTION, r16(ACTION) | 0x0004);
  reg.a = r16(SELECTION);
  get_file_status();
}

/** .copy_file — copy file_select_file_to_copy over the selected file, if the target is free. */
function copyFile() {
  reg.a = r16(SELECTION);
  validate_save_file();
  if (reg.c) return; // the target holds a valid file
  playSound(6, C.sound_menu_select);
  setFilePointer(R.temp_32, r16(SELECTION));
  setFilePointer(0x36, r16(R.file_select_file_to_copy));
  const dst = ptrAt(R.temp_32);
  const src = ptrAt(0x36);
  for (let y = SAVE_FILE_SIZE - 2; y >= 0; y -= 2) busW16(addY(dst, y), bus16(addY(src, y)));
  spend((SAVE_FILE_SIZE / 2) * 150);
  reg.a = r16(SELECTION);
  get_file_status();
  w16(ACTION, r16(ACTION) | 0x0020);
}

/** .load_selected_file — a valid file is loaded into sram_file_buffer, else a new game starts. */
function loadSelectedFile() {
  reg.a = r16(SELECTION);
  validate_save_file();
  if (!reg.c) {
    init_game_mode_select(); // new (or corrupt) file
    return;
  }
  setFilePointer(R.temp_32, r16(SELECTION));
  const src = ptrAt(R.temp_32);
  // (copies 2 bytes more than the file)
  for (let y = SAVE_FILE_SIZE; y >= 0; y -= 2) w16(R.sram_file_buffer + y, bus16(addY(src, y)));
  spend((SAVE_FILE_SIZE / 2 + 1) * 140);
  reg.db = 0x80;
  init_existing_file();
}

register({
  init_file_select,
  CODE_80A82B,
  run_file_select,
});
