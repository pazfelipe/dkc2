/**
 * Bank $80 — boot screens: Nintendo copyright, title screen, and the helpers they share
 * (controller read of the menus, NMI wait, VRAM block clear, random numbers, mode 7 matrix of
 * the Rareware logo).
 */
import { r8, r16, w8, w16, io8, io16, ioR8, ioR16, bus8, bus16, inc16 } from "../../core/mem";
import { reg, register } from "../../core/cpu";
import { endFrame, frameEnded } from "../../core/hybrid";
import { waitUntil } from "../../core/ops";
import { L, R, C, CPU, PPU, DMA, joypad, sprite, sprite_table } from "../../core/sym";
import {
  disable_screen,
  clear_vram,
  init_registers_global,
  clear_wram_tables,
  init_sprite_render_order_global,
  decompress_data,
  dma_to_vram_global,
  dma_palette,
  set_fade,
  fade_screen,
  prepare_oam_dma_channel,
  sort_sprite_render_orders,
  CODE_B59F40,
  set_unused_oam_offscreen,
  init_file_select,
  set_game_mode_and_return,
  setup_title_screen_transition,
} from "../../gen/routines";
import { play_song, play_high_priority_sound, cpuTime } from "./b80a_util";

const SIN_COS = L("update_mode_7_sin_cos_table");
const RUN_TITLE_SCREEN = L("run_title_screen") & 0xffff;
const RUN_NINTENDO_COPYRIGHT = L("run_nintendo_copyright") & 0xffff;
const DEMO_GAME_MODE = L("CODE_8086F6") & 0xffff;
const SPRITE_SIZE = 0x5e;
/** master cycles per tile byte of upload_mode_7_tilemap's inner loop (measured on the original) */
const MODE7_BYTE_CYCLES = 155;
const MODE7_ROW_CYCLES = 210;
const MODE7_CALL_CYCLES = 300;

// ---------------------------------------------------------------------------------------------
// Controller read of the menus

/** $80B061 — read both joypads (menus, title, file select), then pick the active inputs. */
export function intro_controller_read() {
  waitUntil(() => (ioR8(CPU.ppu_status) & 0x01) === 0); // auto-joypad read finished
  const p1 = ioR16(CPU.port_0_data_1);
  w16(R.player_1_pressed, (p1 ^ r16(R.player_1_held)) & ioR16(CPU.port_0_data_1));
  w16(R.player_1_held, ioR16(CPU.port_0_data_1));
  const p2 = ioR16(CPU.port_1_data_1);
  w16(R.player_2_pressed, (p2 ^ r16(R.player_2_held)) & ioR16(CPU.port_1_data_1));
  w16(R.player_2_held, ioR16(CPU.port_1_data_1));
  CODE_80AFFE();
  const mode = r16(0x060d);
  if (mode === 2 || mode === 1) {
    // 2 players, contest: the player whose turn it is; team: the controller of the active Kong
    const x = mode === 2 ? (r16(0x060f) << 1) & 0xffff : r16(R.active_controller_number) & 0x0002;
    w16(R.player_active_held, r16(R.player_1_held + x));
    w16(R.player_active_pressed, r16(R.player_1_pressed + x));
    // .merge_input: both controllers can navigate the menus
    w16(R.player_1_held, r16(R.player_1_held) | r16(R.player_2_held));
    w16(R.player_1_pressed, r16(R.player_1_pressed) | r16(R.player_2_pressed));
  } else {
    w16(R.player_active_held, r16(R.player_1_held));
    w16(R.player_active_pressed, r16(R.player_1_pressed));
  }
}

/**
 * $80AFFE — reject devices that are not standard joypads. A device ID in the low bits of the
 * auto-read (e.g. a mouse) is drained by 16 manual reads and ignored; no device at all (serial
 * bit 0 clear) is ignored too. $4C counts a rejected second controller.
 */
export function CODE_80AFFE() {
  w16(0x4c, 0);
  const pad = (held: number, pressed: number, port: number): boolean => {
    if (r16(held) & 0x0007) {
      for (let i = 0; i < 16; i++) ioR8(port);
      w16(held, 0);
      w16(pressed, 0);
      return false;
    }
    if (ioR8(port) & 0x01) return true;
    w16(held, 0);
    w16(pressed, 0);
    return false;
  };
  pad(R.player_1_held, R.player_1_pressed, joypad.port_0);
  if (!pad(R.player_2_held, R.player_2_pressed, joypad.port_1)) inc16(0x4c);
}

/** $80B0EE — A = new NMI routine; enable NMI + IRQ + auto-joypad and wait for the NMI. */
export function set_nmi_and_wait_2() {
  w16(R.nmi_pointer, reg.a);
  ioR8(CPU.nmi_flag);
  waitUntil(() => (ioR8(CPU.nmi_flag) & 0x80) === 0);
  io8(CPU.enable_interrupts, 0xb1);
  io8(joypad.port_0, 0);
  reg.a = (reg.a & 0xff00) | 0xb1;
  endFrame(); // WAI
}

/** $80B109 — A = VRAM word address: clear $800 words with a fixed-source DMA of a zero byte. */
export function clear_vram_block() {
  io16(PPU.vram_address, reg.a);
  // The original's fixed DMA source is the $00 operand byte of its own `LDA #$0800` ($80B116,
  // label .vram_zero_fill). That byte is code; the port, which runs without the original code,
  // uses the zero word clear_vram uses (vram_zero_fill, a data word in the same bank) instead.
  // Only the DMA source register value differs; the VRAM written is the same.
  const zero = L("vram_zero_fill") & 0xffff;
  io16(DMA.source, zero);
  io16(DMA.unused_2, zero);
  io16(DMA.size, 0x0800);
  io16(DMA.settings, 0x1809);
  io8(DMA.source_bank, 0x00);
  io8(CPU.enable_dma, 0x01);
  reg.a = (reg.a & 0xff00) | 0x01;
}

/**
 * $80B13E — 8-bit pseudo random number generator on rng_result/rng_seed_1..3. Returns the
 * result in the low byte of A (the high byte is left as it was) and in rng_result.
 */
export function get_random_number() {
  const s1 = r8(R.rng_seed_1);
  const s2 = r8(R.rng_seed_2);
  // ASL of seed 1 feeds its top bit into the first ROL of seed 2
  const c0 = s1 >> 7;
  const r1 = ((s2 << 1) | c0) & 0xff;
  const c1 = s2 >> 7;
  const newS2 = ((r1 << 1) | c1) & 0xff;
  const c2 = (r1 >> 7) & 1;
  w8(R.rng_seed_2, newS2);
  w8(R.rng_seed_1, s2 ^ r8(R.rng_seed_3));
  w8(R.rng_seed_3, s1);
  const res = s1 ^ newS2;
  w8(R.rng_seed_2, r8(R.rng_result));
  w8(R.rng_result, res);
  reg.a = (reg.a & 0xff00) | res;
  reg.c = c2 !== 0;
  reg.z = res === 0;
  reg.n = (res & 0x80) !== 0;
}

// ---------------------------------------------------------------------------------------------
// Mode 7 (Rareware logo)

/** .get_sin / .get_cos: [value, carry]; carry = the value is exactly 1.0 (skip the multiply). */
function sinCos(angle: number): [number, boolean] {
  angle &= 0xff;
  if (angle === 0x40) return [0x40, true];
  return [bus8(SIN_COS + angle), false];
}

/** Scale (lo, hi) times a sin/cos value with the PPU multiplier, result * 2 >> 8. */
function mulTrig(lo: number, hi: number, angle: number): [number, number] {
  io8(PPU.fixed_point_mul_A, lo);
  io8(PPU.fixed_point_mul_A, hi);
  const [v, one] = sinCos(angle);
  if (one) return [lo, hi];
  io8(PPU.fixed_point_mul_B, v);
  const r0 = ioR8(PPU.multiply_result_low);
  const r1 = ioR8(PPU.multiply_result_mid);
  const r2 = ioR8(PPU.multiply_result_high);
  const y = ((r1 << 1) | (r0 >> 7)) & 0xff;
  const x = ((r2 << 1) | (r1 >> 7)) & 0xff;
  return [y, x];
}

/**
 * $80B15E — compute the mode 7 matrix from the scale ($7A vertical, $7C horizontal) and the
 * rotation ($84) and write it to the PPU: A = sx*cos, B = sx*sin, C = -sy*sin, D = sy*cos.
 */
export function update_mode_7() {
  const rot = r8(0x84);
  let [lo, hi] = mulTrig(r8(0x7c), r8(0x7d), (rot + 0x40) & 0xff);
  w8(0x86, lo);
  w8(0x87, hi);
  [lo, hi] = mulTrig(r8(0x7c), r8(0x7d), rot);
  w8(0x82, lo);
  w8(0x83, hi);
  [lo, hi] = mulTrig(r8(0x7a), r8(0x7b), rot);
  // two's complement negation, byte by byte
  const nLo = ((lo ^ 0xff) + 1) & 0xff;
  w8(0x80, nLo);
  w8(0x81, ((hi ^ 0xff) + (nLo === 0 ? 1 : 0)) & 0xff);
  [lo, hi] = mulTrig(r8(0x7a), r8(0x7b), (rot + 0x40) & 0xff);
  w8(0x7e, lo);
  w8(0x7f, hi);
  for (const [port, a] of [
    [PPU.mode_7_A, 0x86],
    [PPU.mode_7_B, 0x82],
    [PPU.mode_7_C, 0x80],
    [PPU.mode_7_D, 0x7e],
  ]) {
    io8(port, r8(a));
    io8(port, r8(a + 1));
  }
  reg.a = r8(0x7f);
}

/**
 * $80AFBA — A:X = 24-bit pointer to a mode 7 tilemap (byte columns, byte rows, then one byte
 * per tile), $32 = VRAM word address. Rows are $80 words apart (128x128 map).
 */
export function upload_mode_7_tilemap() {
  w16(0x34, reg.a);
  w16(0x36, reg.x);
  w16(0x39, 0);
  io8(PPU.vram_control, 0x00); // increment after writes to $2118
  const p = ((r8(0x36) << 16) | r16(0x34)) & 0xffffff;
  w16(0x38, bus16(p));
  const cols = r8(0x38);
  let rows = r16(0x39);
  let y = 2;
  let dest = r16(0x32);
  let bytes = 0;
  let rowCount = 0;
  do {
    io16(PPU.vram_address, dest);
    for (let x = cols || 0x10000; x > 0; x--) {
      io8(PPU.vram_write, bus8((p + y) & 0xffffff));
      y = (y + 1) & 0xffff;
      bytes++;
    }
    dest = (dest + 0x80) & 0xffff;
    w16(0x32, dest);
    rows = (rows - 1) & 0xffff;
    w16(0x39, rows);
    rowCount++;
  } while (rows !== 0);
  io8(PPU.vram_control, 0x80);
  // charge the time of the loop (measured: 10x14 map = 24984 master cycles)
  cpuTime(bytes * MODE7_BYTE_CYCLES + rowCount * MODE7_ROW_CYCLES + MODE7_CALL_CYCLES);
  reg.x = 0;
  reg.y = y;
}

// ---------------------------------------------------------------------------------------------
// Nintendo copyright

/** $80B5FA — set up the "Nintendo presents" copyright screen. */
export function init_nintendo_copyright() {
  disable_screen();
  clear_vram(); // (a JSL to an RTS routine: leaves one stray byte on the stack, reset later)
  init_registers_global();
  init_sprite_render_order_global();
  io16(PPU.layer_mode, 0x0001);
  io16(PPU.screens, 0x0001);
  io16(PPU.layer_all_tiledata_base, 0x0000);
  io16(PPU.layer_1_2_tilemap_base, 0x787c);
  io16(PPU.vram_address, 0);
  const tiles = L("nintendo_copyright_tiledata");
  reg.x = tiles >> 16;
  reg.a = tiles & 0xffff;
  reg.y = 0x2000;
  dma_to_vram_global();
  reg.a = R.vram_intro_block_4;
  clear_vram_block();
  io16(PPU.vram_address, R.vram_intro_nintendo_copyright_tilemap);
  const map = L("nintendo_copyright_tilemap");
  reg.x = map >> 16;
  reg.a = map & 0xffff;
  reg.y = 0x0240;
  dma_to_vram_global();
  const pal = L("nintendo_copyright_palette") & 0xffff;
  for (const dest of [0x0000, 0x0070]) {
    reg.a = pal;
    reg.y = dest;
    reg.x = 0x0004;
    dma_palette();
  }
  w16(R.screen_brightness, 0x0200);
  ioR8(CPU.irq_flag);
  io8(PPU.oam_address_high, 0x80);
  io8(CPU.rom_speed, 0x01);
  w16(R.active_frame_counter, 0);
  reg.a = RUN_NINTENDO_COPYRIGHT;
  set_nmi_and_wait_2();
}

/** $80B681 — copyright screen frame: fade in, fade out at frame $70, then the title screen. */
export function run_nintendo_copyright() {
  io16(PPU.oam_address, 0);
  io8(PPU.layer_1_scroll_x, 0);
  io8(PPU.layer_1_scroll_x, 0);
  io8(PPU.layer_1_scroll_y, 0xff);
  io8(PPU.layer_1_scroll_y, 0);
  io8(PPU.screen, r8(R.screen_brightness));
  inc16(R.active_frame_counter);
  intro_controller_read();
  fade_screen();
  if (r16(R.active_frame_counter) === 0x0070) w16(R.screen_fade_speed, 0x0082);
  if (r16(R.screen_brightness)) {
    endFrame(); // WAI
    return;
  }
  setup_title_screen_transition();
}

// ---------------------------------------------------------------------------------------------
// Title screen

/** $80B3D7 — set up the title screen: graphics, music, RNG seed and the 4 chest sparkles. */
export function init_title_screen() {
  disable_screen();
  reg.db = 0x80;
  w16(R.player_skipped_demo, 0);
  w16(R.cheat_enable_flags, 0);
  clear_vram();
  init_registers_global();
  clear_wram_tables();
  init_sprite_render_order_global();
  reg.a = C.music_main_theme;
  play_song();
  w16(R.active_frame_counter, 0);
  setup_title_screen_screen();
  w16(R.rng_result, 0x55aa);
  w16(R.rng_seed_2, 0xff00);
  // sparkle sprites start off screen; they respawn at random places on the treasure chest
  let i = 0;
  for (let x: number = sprite_table.slot_1; x !== 0x0f5a; x += SPRITE_SIZE, i++) {
    w16(x + sprite.type, 0x0001);
    w16(x + sprite.x_position, 0x0180);
    w16(x + sprite.y_position, 0xff88);
    w16(x + sprite.oam_property, 0x2000);
    w16(x + sprite.current_graphic, (i * 8 + C.sparkle_frame1) & 0xffff);
  }
  ioR8(CPU.irq_flag);
  io8(PPU.oam_address_high, 0x80);
  io8(CPU.rom_speed, 0x01);
  reg.a = 0x0400;
  set_fade();
  prepare_oam_dma_channel();
  io16(CPU.enable_dma, 0x0001);
  prepare_oam_dma_channel();
  reg.a = RUN_TITLE_SCREEN;
  set_nmi_and_wait_2();
}

/** $80B461 — title screen frame: sparkles, then file select (button) or the demo (timeout). */
export function run_title_screen() {
  io16(PPU.oam_address, 0);
  io8(CPU.enable_dma, 0x01); // OAM DMA of the sparkles
  io8(PPU.screen, r8(R.screen_brightness));
  intro_controller_read();
  inc16(R.active_frame_counter);
  if ((r16(R.active_frame_counter) & 3) === 0) {
    for (let x: number = sprite_table.slot_1; x !== sprite_table.end; x += SPRITE_SIZE) {
      let g = (r16(x + sprite.current_graphic) + 4) & 0xffff;
      if (g === C.sparkle_frame8 + 4) {
        // the sparkle finished: respawn it at a random spot of the chest
        get_random_number();
        const rx = reg.a & 0x003f;
        w16(0x32, rx);
        w16(x + sprite.x_position, ((rx >> 2) + rx + 0x0050) & 0xffff);
        get_random_number();
        const ry = reg.a & 0x001f;
        w16(0x32, ry);
        w16(x + sprite.y_position, ((ry >> 1) + ry + 0x0090) & 0xffff);
        g = C.sparkle_frame1;
      }
      w16(x + sprite.current_graphic, g);
    }
  }
  sort_sprite_render_orders();
  w16(R.next_oam_slot, R.oam_table);
  w16(0x56, 0x0400);
  for (let i = 0; i < 0x20; i += 2) w16(R.oam_attribute + i, 0);
  w16(R.sprite_dma_buffer_limit, 0x001c);
  CODE_B59F40();
  w16(R.next_sprite_dma_buffer_slot, 0);
  set_unused_oam_offscreen();
  prepare_oam_dma_channel();
  if (r16(R.screen_brightness) === 0x000f) {
    let trigger = false;
    if (r16(R.player_1_held) & 0xd080) {
      // B, Y, START or A: go to the file select
      inc16(R.player_skipped_demo);
      trigger = true;
    } else if (r16(R.active_frame_counter) === 0x0960) {
      trigger = true; // idle: start the demo
    }
    if (trigger) {
      reg.a = 0x840f;
      set_fade();
      reg.a = (6 << 8) | C.sound_menu_select;
      play_high_priority_sound();
    }
  }
  // .run_fadeout
  if (r16(R.screen_brightness) !== 0x8401) {
    fade_screen();
    endFrame(); // WAI
    return;
  }
  // .execute_transition
  if (r16(R.player_skipped_demo)) {
    w16(R.file_select_action, 0);
    init_file_select();
    return;
  }
  reg.a = DEMO_GAME_MODE;
  set_game_mode_and_return();
}

/** $80B560 — PPU setup and graphics uploads of the title screen. */
export function setup_title_screen_screen() {
  io16(PPU.layer_mode, 0x0001);
  io16(PPU.screens, 0x1001);
  io16(PPU.layer_all_tiledata_base, 0x0024);
  io16(PPU.color_addition_logic, 0x0102);
  io16(PPU.layer_1_2_tilemap_base, 0x4c1c);
  for (const p of [PPU.layer_1_scroll_x, PPU.layer_1_scroll_x, PPU.layer_2_scroll_x, PPU.layer_2_scroll_x]) io8(p, 0);
  for (const p of [PPU.layer_1_scroll_y, PPU.layer_1_scroll_y, PPU.layer_2_scroll_y, PPU.layer_2_scroll_y]) io8(p, 0xff);
  const upload = (label: string, vram: number, size: number) => {
    const src = L(label);
    reg.x = src & 0xffff;
    reg.y = src >> 16;
    reg.a = 0;
    decompress_data();
    io16(PPU.vram_address, vram);
    reg.x = 0x007f;
    reg.a = 0x0000;
    reg.y = size;
    dma_to_vram_global(); // from the decompression buffer $7F0000
  };
  upload("title_screen_tiledata", R.vram_intro_title_screen_tiledata, 0x6400);
  upload("title_screen_tilemap", R.vram_intro_title_screen_tilemap, 0x0700);
  io16(PPU.vram_address, 0);
  const sparkle = L("sparkle_graphics");
  reg.x = sparkle >> 16;
  reg.a = sparkle & 0xffff;
  reg.y = 0x01a0;
  dma_to_vram_global();
  reg.y = 0x0000;
  reg.x = 0x0040;
  reg.a = L("title_screen_palette") & 0xffff;
  dma_palette();
}

register({
  intro_controller_read,
  CODE_80AFFE,
  set_nmi_and_wait_2,
  clear_vram_block,
  get_random_number,
  update_mode_7,
  upload_mode_7_tilemap,
  init_nintendo_copyright,
  run_nintendo_copyright,
  init_title_screen,
  run_title_screen,
  setup_title_screen_screen,
});

void frameEnded;
