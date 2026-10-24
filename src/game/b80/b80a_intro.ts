/**
 * Bank $80 — the boot intro: the Rareware logo (mode 7 zoom on a wireframe logo that fades into
 * the gold logo) followed by "Nintendo presents" with its sparkles.
 *
 * Everything is driven by active_frame_counter (frames since init_rareware_logo):
 *   $000-$0DF  wireframe logo drawn in, palettes animated
 *   $0E0       switch to mode 7, the logo shrinks until $10E
 *   $110-$112  upload "Nintendo presents" and its sparkles (mode 1/5 split by HDMA)
 *   $118-$17F  the text glows; $121-$17B sparkles twinkle
 *   $1A0       fade out, then the Nintendo copyright screen
 * After the title screen has been reached once, A/B/X/Y/START skips the intro.
 */
import { r8, r16, w8, w16, io8, io16, ioR8, bus8, bus16 } from "../../core/mem";
import { reg, register } from "../../core/cpu";
import { endFrame } from "../../core/hybrid";
import { xba } from "../../core/ops";
import { L, R, C, CPU, PPU, DMA, HDMA } from "../../core/sym";
import {
  decompress_data,
  upload_mode_7_tilemap,
  clear_vram_block,
  set_nmi_and_wait_2,
  update_mode_7,
  intro_controller_read,
  get_random_number,
  init_nintendo_copyright,
  fade_screen,
} from "../../gen/routines";
import { reset_controller_state } from "./b80a_input";
import { init_registers, clear_vram, setup_title_screen_transition } from "./b80a_boot";
import { dma_to_vram_global } from "./b80a_wram";
import { queue_song, play_queued_song, spend } from "./b80a_util";

const BGMODE = R.hdma_intro_bgmode; // HDMA tables (write_byte entries: count, value)
const COLOR_MATH = R.hdma_intro_color_math;
const SUBSCREEN = R.hdma_intro_subscreen;
const WORKING_PALETTE = R.working_palette;
const NINTENDO_TEXT_PALETTE = 0x7e8968; // working_palette + $40
const SPARKLE_PALETTE_ROW = 0x7e8a48; // working_palette + $120

const BASE_SPARKLE_COLOR = L("base_sparkle_color");
const DATA_80B317 = L("DATA_80B317");
const DATA_80B318 = L("DATA_80B318");
const DATA_80B377 = L("DATA_80B377");

/** decompress_data X:Y = source, A = destination offset in $7F0000 */
function decompress(label: string, dest = 0) {
  const a = L(label);
  reg.x = a & 0xffff;
  reg.y = a >> 16;
  reg.a = dest;
  decompress_data();
}

/** VRAM address (words) then DMA `size` bytes from $7F:src. */
function upload(vramWord: number, src: number, size: number) {
  io16(PPU.vram_address, vramWord);
  reg.x = 0x7f;
  reg.a = src;
  reg.y = size;
  dma_to_vram_global();
}

/** $8090DA — set up the intro screens and start the Rareware logo. */
export function init_rareware_logo() {
  reset_controller_state();
  w16(R.sprite_dma_buffer_limit, 0x002c);
  init_registers();
  clear_vram();
  w16(R.active_frame_counter, 0);
  w16(R.rng_result, 0xaa55);
  w16(R.rng_seed_2, 0x3765);
  reg.a = C.music_fanfare;
  queue_song();
  io8(CPU.enable_interrupts, 0x01); // auto-joypad only
  io8(PPU.screen, 0x8f);
  io8(PPU.sprite_select, 0);
  io8(PPU.video_mode, 0);
  io16(PPU.layer_mode, 0x0003); // mode 3
  io16(PPU.screens, 0x0102); // BG2 main, BG1 sub
  io16(PPU.color_addition_logic, 0x0202);
  io16(PPU.layer_all_tiledata_base, 0x0364);
  io16(PPU.layer_1_2_tilemap_base, 0x787c);
  io16(PPU.layer_3_4_tilemap_base, 0x0070);
  // clear VRAM by hand ($4000 words; STZ $2118 / DEX / BNE)
  io16(PPU.vram_address, 0);
  for (let x = 0x4000; x !== 0; x--) io16(PPU.vram_write, 0);
  spend(0x4000 * 60);
  // mode 7 tile data (only the high bytes of VRAM words)
  decompress("DATA_FA4C3E");
  io16(PPU.vram_address, 0);
  for (let x = 0; x < 0x3400; x++) io8(PPU.vram_write_high, r8(0x7f0000 + x));
  spend(0x3400 * 188);
  reg.x = 0x3400;
  w16(0x32, R.vram_intro_mode_7_tilemap);
  reg.a = L("DATA_F547BC") & 0xffff;
  reg.x = L("DATA_F547BC") >> 16;
  upload_mode_7_tilemap();
  w16(0x7c, 0x0100); // mode 7 scale 100%
  w16(0x7a, 0x0100);
  io8(PPU.mode_7_center_x, 0x05);
  io8(PPU.mode_7_center_x, 0x01);
  io8(PPU.mode_7_center_y, 0xd7);
  io8(PPU.mode_7_center_y, 0x00);
  io8(PPU.set_mode_7, 0x80);
  for (const block of [R.vram_intro_block_1, R.vram_intro_block_2, R.vram_intro_block_3, R.vram_intro_block_4]) {
    reg.a = block;
    clear_vram_block();
  }
  // "Nintendo presents" tilemap (two garbage tiles patched out)
  decompress("DATA_F52FC7");
  w16(0x7f0100, 0);
  w16(0x7f013e, 0);
  upload(R.vram_intro_nintendo_presents_tilemap, 0x0000, 0x0340);
  decompress("DATA_F80D10"); // mini Rare logo tilemap
  upload(R.vram_intro_mini_rare_logo_tilemap, 0x0000, 0x00c8);
  decompress("DATA_F50004");
  upload(R.vram_intro_unknown, 0x0000, 0x0380);
  decompress("DATA_F56AC9");
  upload(R.vram_intro_unknown2, 0x0000, 0x0380);
  decompress("DATA_F55D4A");
  upload(R.vram_intro_unknown3, 0x0000, 0x2400);
  decompress("DATA_F8063E");
  upload(R.vram_intro_unknown4, 0x0000, 0x1000);
  decompress("sparkle_layer_3_8x8_tilemap");
  upload(0x7000, 0x0000, 0x0800);
  // Nintendo presents logo at $7F0500, sparkle tiles at $7F0000 (the logo is decompressed
  // twice because the sparkles overwrite its start)
  decompress("DATA_F5325B");
  decompress("sparkle_layer_3_tiledata");
  decompress("DATA_F5325B", 0x0500);
  w16(R.screen_brightness, 0x000f);
  for (let x = 0x1fe; x >= 0; x -= 2) w16(WORKING_PALETTE + x, 0);
  for (let x = 0x1c; x >= 0; x -= 2) w16(R.temp_32 + x, 0);
  // HDMA tables: background mode, color math and subscreen per band of scanlines
  initHdmaTable(BGMODE, 0x0003, 0x0003);
  initHdmaTable(COLOR_MATH, 0x0002, 0x0002);
  initHdmaTable(SUBSCREEN, 0x0001, 0x0001);
  setupHdma(2, 0x0500, BGMODE); // $2105
  setupHdma(3, 0x3100, COLOR_MATH); // $2131
  setupHdma(4, 0x2d00, SUBSCREEN); // $212D
  ioR8(CPU.irq_flag);
  io8(PPU.oam_address_high, 0x80);
  io8(CPU.rom_speed, 0x01);
  w16(R.intro_sparkle_timer, (r16(R.intro_sparkle_timer) + 1) & 0xffff);
  reg.a = L("run_rareware_logo") & 0xffff;
  set_nmi_and_wait_2();
}

/** Three bands ($7F, $18, then 16-bit stores of `last` overlapping count+value) + terminator. */
function initHdmaTable(t: number, first: number, last: number) {
  w16(t + 0, 0x007f);
  w16(t + 1, first);
  w16(t + 2, 0x0018);
  w16(t + 3, last);
  w16(t + 4, last);
  w16(t + 5, last);
  w16(t + 6, 0x0000);
}

function setupHdma(ch: number, settings: number, table: number) {
  const o = ch * 0x10;
  io16(HDMA.settings + o, settings);
  io16(HDMA.source + o, table & 0xffff);
  io8(HDMA.source_bank + o, 0x7e);
  io8(HDMA.indirect_source_bank + o, 0x00);
}

/** $8093B8 — NMI routine of the intro: uploads, then the animation, then wait for NMI. */
export function run_rareware_logo() {
  // working palette -> CGRAM (DMA channel 1)
  io16(DMA.source + 0x10, WORKING_PALETTE & 0xffff);
  io16(DMA.unused_2 + 0x10, WORKING_PALETTE & 0xffff);
  io16(DMA.size + 0x10, 0x0200);
  io16(DMA.settings + 0x10, 0x2200);
  io8(DMA.source_bank + 0x10, 0x7e);
  io8(PPU.cgram_address, 0);
  io8(CPU.enable_dma, 0x02);
  io16(CPU.enable_dma, 0x1c00); // HDMA on channels 2-4
  let f = r16(R.active_frame_counter);
  if (f >= 0x00e0) update_mode_7();
  if (f === 0x00e0) {
    // switch the top bands to mode 7
    w8(BGMODE + 1, 7);
    w8(BGMODE + 3, 7);
    w8(BGMODE + 5, 7);
    io8(PPU.layer_1_2_tilemap_base, 0x74);
    io8(PPU.screens, 0x01);
  }
  if (f === 0x0110) upload(R.vram_intro_nintendo_presents_tiledata1, 0x0500, 0x1440);
  if (f === 0x0111) {
    upload(R.vram_intro_nintendo_presents_tiledata2, 0x1940, 0x1440);
    for (let x = 0x1e; x !== 0; x -= 2) w16(WORKING_PALETTE + x, 0);
  }
  if (f === 0x0112) {
    upload(R.vram_intro_sparkle_tilemap, 0x0000, 0x0500);
    // mode 1 for the text area, mode 5 below; sparkles on BG3 in the subscreen
    w8(BGMODE + 1, 0x01);
    w8(BGMODE + 3, 0x01);
    w8(BGMODE + 5, 0x05);
    w8(COLOR_MATH + 1, 0x21);
    w8(COLOR_MATH + 3, 0x21);
    w8(SUBSCREEN + 1, 0x04);
    w8(SUBSCREEN + 3, 0x04);
    w8(COLOR_MATH + 5, 0x00);
  }
  io8(PPU.layer_3_scroll_x, r8(R.intro_sparkle_x_position));
  io8(PPU.layer_3_scroll_x, 0);
  io8(PPU.layer_3_scroll_y, r8(R.intro_sparkle_y_position));
  io8(PPU.layer_3_scroll_y, 0);
  io8(PPU.screen, r8(R.screen_brightness));
  // mode 7 shrink: frames $E0-$10E
  let a = (f - 0x00e0) & 0xffff;
  if (a < 0x002f) {
    if (a & 0x0020) a ^= 0x003f;
    const half = a >> 1;
    w16(R.temp_32, half);
    const scale = ((half >> 1) + half + (half & 1) + r16(0x7c)) & 0xffff;
    w16(0x7c, scale);
    w16(0x7a, scale);
  }
  intro_controller_read();
  f = (r16(R.active_frame_counter) + 1) & 0xffff;
  w16(R.active_frame_counter, f);
  if (f === 0x0001) play_queued_song();
  if (f === 0x00f0) {
    // keep a copy of the gold logo palette (palettes 0/1 -> 5/6)
    for (let x = 0x3e; x >= 0; x -= 2) w16(0x7e89c8 + x, r16(WORKING_PALETTE + x));
  }
  if (((f - 0x0121) & 0xffff) < 0x005b) sparkles();
  nintendoTextGlow(f);
  rareLogoPalette(f);
  wireframeSweep(f);
  // CODE_80978E: skip the intro / fade out at the end
  let fadeOut = false;
  if (r16(R.enable_intro_bypass) && r16(R.screen_brightness) === 0x000f && bus16(R.player_1_pressed) & C.input_ABXY_start)
    fadeOut = true;
  else if (r16(R.active_frame_counter) === 0x01a0) fadeOut = true;
  if (fadeOut) w8(R.screen_fade_speed, 0x82);
  if (r16(R.screen_brightness) === 0) {
    if (r16(R.active_frame_counter) >= 0x01a0) init_nintendo_copyright();
    else setup_title_screen_transition(); // the player skipped the intro
    return;
  }
  // .fade
  fade_screen();
  endFrame(); // WAI
}

/** CODE_809510 — Nintendo presents sparkles: random position every 8 frames, color pulse. */
function sparkles() {
  let t = (r16(R.intro_sparkle_timer) - 1) & 0xffff;
  w16(R.intro_sparkle_timer, t);
  if (t & 0x8000) {
    get_random_number();
    w16(R.intro_sparkle_random_offset, ((reg.a & 0x0060) - 0x0040) & 0xffff);
    w16(R.intro_sparkle_timer, 0x0008);
  }
  // CODE_809528
  t = r16(R.intro_sparkle_timer);
  if (t & 0xffe0) return;
  if (!(t & 0x0007)) {
    get_random_number();
    const off = r16(R.intro_sparkle_random_offset);
    const x = ((reg.a & 0x003f) + off) & 0xffff;
    w16(R.intro_sparkle_x_position, x);
    const y = ((((x - off) & 0xffff) ^ 0x00ff) >> 1) - 0x0050;
    w16(R.intro_sparkle_y_position, y & 0xffff);
  }
  // CODE_809554: brightness = triangle wave of the timer, times 1.25
  let b = (r8(R.intro_sparkle_timer) << 5) & 0xff;
  if (b & 0x80) b = (-b) & 0xff;
  w8(0x32, b);
  b = ((b >> 2) + b) & 0xff;
  io8(PPU.fixed_point_mul_A, b);
  io8(PPU.fixed_point_mul_A, 0);
  for (let y = 0, x = 0; y < 0x10; y++, x += 2) {
    io8(PPU.fixed_point_mul_B, bus8(BASE_SPARKLE_COLOR + y));
    const c = ioR8(PPU.multiply_result_mid) & 0x1f;
    // grey-ish color: r = c, g = c, b = min(1.5c, 31)
    w16(0x32, c);
    w16(0x34, c << 5);
    w16(0x36, (c << 9) & 0xffff);
    let blue = ((c << 10) + (c << 9)) & 0xffff;
    if (blue >= 0x7c00) blue = 0x7c00;
    w16(WORKING_PALETTE + x, ((blue & 0x7c00) + (c << 5) + c) & 0xffff);
  }
}

/** CODE_8095B3 — frames $118-$17F: the "Nintendo" text palette glows up and down. */
function nintendoTextGlow(f: number) {
  let a = (f - 0x0118) & 0xffff;
  if (a >= 0x0068) return;
  a = xba(a) >> 3;
  if (a >= 0x0cff) a = 0x0cff;
  if (a >= 0x0500) a -= 0x0400;
  if (a >= 0x0500) a -= 0x0400;
  if (a >= 0x0300) a = ((a ^ 0x07ff) - 0x0200) & 0xffff;
  setFactor(a);
  for (let x = 2; x !== 0x60; x += 2) {
    w16(0x32, 0);
    const r = scaled8(bus8(DATA_80B317 + x));
    w8(0x32, r);
    w16(0x32, r16(0x32) | (((r & 0x1f) << 8) >> 3));
    // 16-bit store to $211C/$211D and 16-bit read of $2135/$2136
    io16(PPU.fixed_point_mul_B, bus16(DATA_80B318 + x) & 0x001f);
    let v = ioR8(PPU.multiply_result_mid) | (ioR8(PPU.multiply_result_mid + 1) << 8);
    if (v >= 0x001f) v = 0x001f;
    w16(NINTENDO_TEXT_PALETTE + x, ((v & 0x1f) << 10) | r16(0x32));
  }
}

/** factor (8.8) for the PPU multiplier: M7A = a */
function setFactor(a: number) {
  io8(PPU.fixed_point_mul_A, a & 0xff);
  io8(PPU.fixed_point_mul_A, (a >> 8) & 0xff);
}

/** component * factor >> 8 (PPU multiplier), clamped to 31 */
function scaled8(component: number): number {
  io8(PPU.fixed_point_mul_B, component & 0x1f);
  const v = ioR8(PPU.multiply_result_mid);
  return v >= 0x1f ? 0x1f : v;
}

/** CODE_80964C — the Rareware logo palette fades in ($78-$A0) and the mini logo ($118-$14F). */
function rareLogoPalette(f: number) {
  let x = 0x00a0;
  let a = (f - 0x0110) & 0xffff;
  if (!(a < 0x0040 && a >= 0x0008)) {
    // CODE_80965F
    x = 0;
    a = (f - 0x0078) & 0xffff;
    if (a >= 0x0029) return;
  }
  // CODE_809670
  a = (a << 5) & 0xffff;
  if (a >= 0x04ff) a = 0x04ff;
  if (a >= 0x0300) a = ((a ^ 0x07ff) - 0x0200) & 0xffff;
  setFactor(a);
  for (let y = 0; y !== 0x60; y += 3, x += 2) {
    w16(0x32, 0);
    w8(0x32, scaled8(bus8(DATA_80B377 + y)));
    const g = scaled8(bus8(DATA_80B377 + y + 1));
    w16(0x32, r16(0x32) | ((g & 0x1f) << 5));
    const b = scaled8(bus8(DATA_80B377 + y + 2));
    w16(WORKING_PALETTE + x, ((b & 0x1f) << 10) | r16(0x32));
  }
}

/** CODE_8096FB / CODE_80973E — white "drawing" sweeps across the wireframe palettes. */
function wireframeSweep(f: number) {
  if (f < 0x0072) {
    let x = (f & 0x00ff) << 1;
    if (x < 0x00e0) {
      w16(NINTENDO_TEXT_PALETTE + x, 0x7fff);
      w16(SPARKLE_PALETTE_ROW + x, 0x7fff);
    }
    x = (x - 2) & 0xffff;
    if (x < 0x00e0) {
      w16(NINTENDO_TEXT_PALETTE + x, 0x7e10);
      w16(SPARKLE_PALETTE_ROW + x, 0x7e10);
    }
    x = (x - 2) & 0xffff;
    if (x < 0x00e0) {
      w16(NINTENDO_TEXT_PALETTE + x, 0x03e0);
      w16(SPARKLE_PALETTE_ROW + x, 0x01c0);
    }
  }
  const a = (f - 0x0098) & 0xffff;
  if (a >= 0x0040) return;
  let x = (a & 0x007f) << 3;
  const trail = [0x7fff, 0x4210, 0x0000, 0x0000, 0x0000, 0x0000];
  for (const color of trail) {
    w16(NINTENDO_TEXT_PALETTE + x, color);
    x = (x - 2) & 0xffff;
    if (x & 0x8000) break;
  }
}

register({ init_rareware_logo, run_rareware_logo });
