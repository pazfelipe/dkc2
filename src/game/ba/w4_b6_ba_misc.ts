/**
 * Bank $BA — the rest of the bank's code: the Krocodile Kore sparkle spawner and sparkles,
 * K. Rool's water drips and fish (Krocodile Kore), the bonus room title screen ("COLLECT THE
 * STARS!" ...) and the credits scroller, which run as the NMI logic of
 * `run_bonus_and_credits_screen` through the pointer at $067D (CODE_BAB31B).
 */
import { r8, r16, w8, w16, bus8, busW16, io8, io16, ioR16 } from "../../core/mem";
import { reg, callAddr } from "../../core/cpu";
import { R, C, CPU, PPU, DMA } from "../../core/sym";
import {
  set_current_level_as_cleared, set_level_end_exit_state_global, CODE_B5F0CD, CODE_B5F0ED,
  spawn_no_gfx_special_sprite_index, CODE_B4C175, divide_a_by_y, queue_sound_effect,
  apply_position_from_velocity_global, process_sprite_animation, delete_sprite_if_offscreen,
  delete_sprite_handle_deallocation, set_alt_sprite_animation, interpolate_x_velocity_global,
  interpolate_y_velocity_global, disable_screen, clear_vram_global, CODE_BAC7C0, play_song,
  vram_payload_handler_global, set_ppu_registers_global, dma_sprite_palette_from_index, dma_palette,
  set_fade_global, fade_screen_global, set_game_mode_and_return, input_and_pause_handler_global,
  clear_wram_tables, init_sprite_render_order_global, reset_camera_and_bg_scroll, restart_rareware_logo,
} from "../../gen/routines";
import { cur, rd, wr, dec, inc, snd, registerSprite, registerRts, registerRtl } from "../b6/b6ba_common";
import { lda, lda8, lo, bank, ge, add, sub } from "../b6/w4_b6_util";
import { cpuTime } from "../b80/b80a_util";

const FONT = lo("yellow_font_tile_offsets");
const FONT_BANK = bank("yellow_font_tile_offsets");
const TEXT_BUF = R.text_vram_buffer & 0xffff;

// ------------------------------------------------------------------ Krocodile Kore sprites

/** $BAB08E — after K. Rool falls: sparkles rise from the core, palette cycles, level ends. */
export function kore_sparkle_spawner_sprite_code(): void {
  reg.db = 0xba;
  const x = cur();
  reg.x = x;
  if (dec(x, 0x44) === 0) {
    set_current_level_as_cleared();
    set_level_end_exit_state_global();
  }
  CODE_BAB09E();
}

/** $BAB09E */
export function CODE_BAB09E(): void {
  const x = cur();
  reg.x = x;
  inc(x, 0x46);
  if (dec(x, 0x42) === 0) {
    inc(x, 0x46);
    inc(x, 0x46);
    wr(x, 0x42, 0x0003);
    reg.a = rd(x, 0x46);
    CODE_B5F0CD();
  }
  CODE_BAB0B5();
}

/** $BAB0B5 */
export function CODE_BAB0B5(): void {
  const x = reg.x;
  inc(x, 0x48);
  if (dec(x, 0x4a) !== 0) return CODE_BAB129();
  CODE_BAB0BE();
}

/** $BAB0BE — every 4 frames: palette step; a sparkle when the accumulator passes 300. */
export function CODE_BAB0BE(): void {
  let x = reg.x;
  inc(x, 0x4c);
  inc(x, 0x48);
  inc(x, 0x48);
  wr(x, 0x4a, 0x0004);
  reg.a = rd(x, 0x48);
  CODE_B5F0ED();
  x = reg.x;
  reg.a = add(rd(x, 0x4e), rd(x, 0x4c));
  wr(x, 0x4e, reg.a);
  if (!ge(reg.a, 0x012c)) return CODE_BAB129();
  reg.a = sub(reg.a, 0x012c);
  wr(x, 0x4e, reg.a);
  reg.y = C.special_sprite_spawn_id_013E;
  spawn_no_gfx_special_sprite_index();
  CODE_B4C175();
  reg.y = 0x0020;
  divide_a_by_y();
  const y = r16(R.alternate_sprite);
  reg.y = y;
  const rem = ioR16(CPU.multiply_result);
  wr(y, 0x06, add(0x01f0, rem));
  wr(y, 0x0a, 0x0160);
  wr(y, 0x24, 0xfd80);
  reg.a = sub(ioR16(CPU.multiply_result), 0x0010);
  if (!(reg.a & 0x8000)) return CODE_BAB11C();
  reg.a = ((reg.a << 3) | 0x0007) & 0xffff;
  CODE_BAB11F();
}

/** $BAB11C */
export function CODE_BAB11C(): void {
  reg.a = (reg.a << 3) & 0xffff;
  CODE_BAB11F();
}

/** $BAB11F */
export function CODE_BAB11F(): void {
  wr(reg.y, 0x20, reg.a);
  reg.a = snd(7, "krool_gun_exhaust");
  queue_sound_effect();
  CODE_BAB129();
}

/** $BAB129 */
export function CODE_BAB129(): void {}

/** $BAB12C — a sparkle rising from the core. */
export function kore_sparkle_sprite_code(): void {
  apply_position_from_velocity_global();
  process_sprite_animation();
  delete_sprite_if_offscreen();
}

/** $BAC0D2 — water dripping from the soaked K. Rool (goes with $06A3 bit 14). */
export function krool_water_drips_sprite_code(): void {
  reg.a = r16(0x06a3);
  if (reg.a & 0x4000) {
    delete_sprite_handle_deallocation();
    return;
  }
  let x = cur();
  reg.x = x;
  const state = rd(x, 0x2e);
  reg.x = (state << 1) & 0xffff;
  reg.db = 0xba;
  switch (state) {
    case 0:
      process_sprite_animation();
      return;
    case 1: {
      reg.y = C.special_sprite_spawn_id_0162;
      spawn_no_gfx_special_sprite_index();
      x = cur();
      reg.x = x;
      inc(x, 0x2e);
      reg.a = rd(x, 0x42);
      const y = r16(R.alternate_sprite);
      reg.y = y;
      wr(y, 0x42, reg.a);
      set_alt_sprite_animation();
      return;
    }
    default: {
      x = cur();
      reg.x = x;
      wr(x, 0x24, add(rd(x, 0x24), 0x0020));
      apply_position_from_velocity_global();
      x = cur();
      reg.x = x;
      reg.a = rd(x, 0x0a);
      if (ge(reg.a, 0x01c0)) {
        wr(x, 0x2e, 0);
        process_sprite_animation();
      }
    }
  }
}

/** `.interpolate_fish_speeds` */
function fishMove() {
  let x = cur();
  reg.a = rd(x, 0x42);
  interpolate_x_velocity_global();
  x = cur();
  reg.x = x;
  reg.a = rd(x, 0x44);
  interpolate_y_velocity_global();
  apply_position_from_velocity_global();
  reg.x = cur();
}

/** $BAC133 — the fish K. Rool shoots: bounces on the water, then jumps out of the screen. */
export function krool_fish_sprite_code(): void {
  let x = cur();
  reg.x = x;
  const state = rd(x, 0x2e);
  reg.x = (state << 1) & 0xffff;
  reg.db = 0xba;
  if (state !== 0) {
    fishMove();
    process_sprite_animation();
    delete_sprite_if_offscreen();
    return;
  }
  fishMove();
  x = reg.x;
  reg.a = rd(x, 0x0a);
  if (ge(reg.a, 0x01c5)) {
    wr(x, 0x0a, 0x01c5);
    reg.a = rd(x, 0x46);
    if (reg.a === 0) {
      inc(x, 0x2e);
      wr(x, 0x24, 0xfb00);
      wr(x, 0x2a, 0x0700);
      wr(x, 0x44, 0x0003);
      splash();
      process_sprite_animation();
      return;
    }
    reg.c = true; // carry of the CMP #$01C5 above
    CODE_B4C175();
    reg.y = 0x00ff;
    divide_a_by_y();
    w16(0x0650, ioR16(CPU.multiply_result));
    reg.a = sub(0xfe80, r16(0x0650));
    x = cur();
    reg.x = x;
    wr(x, 0x24, reg.a);
    splash();
    x = cur();
    reg.x = x;
    inc(x, 0x42);
  }
  reg.a = rd(x, 0x46);
  if (reg.a !== 0) dec(x, 0x46);
  process_sprite_animation();
}

function splash() {
  reg.a = snd(5, "krool_splash_1");
  queue_sound_effect();
  reg.a = snd(6, "krool_splash_2");
  queue_sound_effect();
}

// ------------------------------------------------------------------ bonus title screen

/** Add / subtract a word in low WRAM (`LDA $0000,x : ADC ... : STA`), returning the carry. */
let carry = false;
function addw(a: number, v: number, c: boolean) {
  const s = r16(a) + v + (c ? 1 : 0);
  carry = s > 0xffff;
  return s & 0xffff;
}
function subw(a: number, v: number) {
  const s = r16(a) - v;
  carry = s >= 0;
  return s & 0xffff;
}

/**
 * The title's sprites ($0200 OAM buffer copy: 4 entries per letter, two rows) move apart (dir > 0)
 * or together: x of the upper half +d / lower half -d, the tile rows follow (+$0800).
 */
function moveTitle(count: number, d: number, chain = false) {
  let x = 0x0200;
  for (let i = 0; i < count; i++) {
    let a = d > 0 ? addw(x, d, false) : subw(x, -d);
    w16(x, a);
    a = (a + 0x0800 + (chain && carry ? 1 : 0)) & 0xffff; // CODE_BAB2D6 has no CLC there
    w16(x + 4, a);
    a = d > 0 ? subw(x + 8, d) : addw(x + 8, -d, false);
    w16(x + 8, a);
    w16(x + 0x0c, (a + 0x0800) & 0xffff);
    x = (x + 0x10) & 0xffff;
  }
  reg.x = x;
  reg.a = x;
}

/** $BAB1B9 — set up the bonus title screen (A in $0650 = bonus type). */
export function init_bonus_screen(): void {
  io16(CPU.enable_interrupts, 0x0000);
  reg.db = 0xba;
  io16(PPU.oam_address, 0x0000);
  io16(PPU.screen, 0x0080);
  w16(0xcc, 0xbaba);
  reg.x = (r16(0x0650) << 1) & 0xffff;
  w16(0x0650, lda(lo("bonus_screen_config_table") + reg.x));
  disable_screen();
  clear_vram_global();
  CODE_BAC7C0();
  for (const r of [PPU.layer_2_scroll_x, PPU.layer_2_scroll_x]) io8(r, 0x00);
  io8(PPU.layer_2_scroll_y, 0xff);
  io8(PPU.layer_2_scroll_y, 0xff);
  io8(PPU.layer_1_scroll_x, 0x00);
  io8(PPU.layer_1_scroll_x, 0x00);
  io8(PPU.layer_1_scroll_y, 0xff);
  io8(PPU.layer_1_scroll_y, 0xff);
  const cfg = r16(0x0650);
  reg.y = cfg;
  reg.a = lda(cfg + 4);
  play_song();
  reg.x = cfg;
  reg.a = lda8(cfg);
  vram_payload_handler_global();
  reg.a = lda8(cfg + 1);
  set_ppu_registers_global();
  reg.a = 0x00aa;
  reg.y = 0x00e0;
  reg.x = 0x0004;
  dma_sprite_palette_from_index();
  reg.a = lo("DATA_FD3DAE");
  reg.y = 0x0000;
  reg.x = 0x0008;
  dma_palette();
  reg.a = lda(cfg + 2);
  reg.y = 0x0020;
  reg.x = 0x0018;
  dma_palette();
  // PLA : ADC #$0006 — the carry left by dma_palette's ASLs of X ($18) is clear
  reg.x = add(cfg, 0x0006);
  w16(0x0654, 0);
  w16(0x0658, 0);
  reg.a = 0x00b4;
  CODE_BAB48B();
  // upload the text tiles to VRAM $0000
  const len = r8(0x065b);
  io16(DMA.size, (len << 5) & 0xffff);
  io16(PPU.vram_address, 0x0000);
  io8(DMA.settings, 0x01);
  io8(DMA.destination, 0x18);
  io16(DMA.source, TEXT_BUF);
  io8(DMA.source_bank, 0x7e);
  io8(DMA.unused_1, 0x00);
  io8(CPU.enable_dma, 0x01);
  w8(0x065a, 0x00);
  // copy the title's OAM entries ($7E3A00) to the OAM buffer at $0200 (MVN $00,$7E)
  const n = ((r8(0x065b) << 2) - 1 + 1) & 0xffff;
  for (let i = 0; i < n; i++) w8((0x0200 + i) & 0xffff, r8(0x7e3a00 + i));
  w16(0x067d, lo("CODE_BAB31E"));
  reg.a = 0x0100;
  set_fade_global();
  reg.a = ((r16(0x065a) >> 8) & 0x00ff) >> 2;
  reg.a = (reg.a + 1) & 0xffff;
  w16(0x0650, reg.a);
  w16(0x065a, reg.a);
  CODE_BAB2D6();
}

/** $BAB2D6 — spread the two halves of the title vertically by one row. */
export function CODE_BAB2D6(): void {
  moveTitle(r16(0x0650), 0x0100, true);
  w16(0x0650, 0);
  w16(0x065e, 0x012c);
  w16(0x0660, 0x000b);
  w16(0x0656, 0x000b);
  reg.a = 0x0081;
  io16(CPU.enable_interrupts, 0x0081);
}

/** $BAB31B — `JMP ($067D)`: the bonus/credits screen's logic for this frame. */
export function CODE_BAB31B(): void {
  callAddr(0xba0000 | r16(0x067d));
}

/** $BAB31E — each frame: OAM DMA, fade; every 11 frames the title halves swap sides. */
export function CODE_BAB31E(): void {
  io16(DMA.source, 0x0200);
  io16(DMA.unused_2, 0x0200);
  io16(DMA.size, 0x0220);
  io16(DMA.settings, 0x0400);
  io8(DMA.source_bank, 0x00);
  io8(CPU.enable_dma, 0x01);
  fade_screen_global();
  io8(PPU.screen, r8(R.screen_brightness));
  if (dec(0, 0x0660) !== 0) return CODE_BAB3D1();
  w16(0x0660, r16(0x0656));
  reg.x = 0x0200;
  w16(0x0650, r16(0x065a));
  reg.a = r16(0x06a3) ^ 0x2000;
  w16(0x06a3, reg.a);
  if (!(reg.a & 0x2000)) return CODE_BAB3A4();
  CODE_BAB375();
}

/** $BAB375 */
export function CODE_BAB375(): void {
  moveTitle(r16(0x0650), -0x0200);
  w16(0x0650, 0);
  CODE_BAB3D1();
}

/** $BAB3A4 */
export function CODE_BAB3A4(): void {
  moveTitle(r16(0x0650), 0x0200);
  w16(0x0650, 0);
  CODE_BAB3D1();
}

/** $BAB3D1 — after 300 frames (or a button once faded in) fade out; faded out: the bonus room. */
export function CODE_BAB3D1(): void {
  if (dec(0, 0x065e) === 0) return CODE_BAB3F6();
  reg.a = r16(R.screen_brightness) & 0x000f;
  if (reg.a === 0) {
    reg.a = lo("CODE_8087E1");
    set_game_mode_and_return();
    return;
  }
  CODE_BAB3E5();
}

/** $BAB3E5 */
export function CODE_BAB3E5(): void {
  if (reg.a !== 0x000f) return CODE_BAB3FD();
  input_and_pause_handler_global();
  reg.a = r16(R.player_active_pressed);
  if (!(reg.a & 0xf0c0)) return CODE_BAB3FD();
  CODE_BAB3F6();
}

/** $BAB3F6 */
export function CODE_BAB3F6(): void {
  reg.a = 0x810f;
  set_fade_global();
  CODE_BAB3FD();
}

/** $BAB3FD */
export function CODE_BAB3FD(): void {}

/**
 * $BAB48B — render a string (X = length-prefixed English then French text) as big letters:
 * tiles copied from the font ($FC) into the text buffer, OAM entries at $7E3A00.
 * A = y position ($065C high byte).
 */
export function CODE_BAB48B(): void {
  const db = reg.db;
  reg.db = 0xba;
  w16(0x065c, ((reg.a >> 8) | (reg.a << 8)) & 0xffff);
  let x = reg.x;
  reg.y = r16(R.language_select);
  if (reg.y !== 0) {
    w16(0x0650, lda8(x));
    x = (x + r16(0x0650) + 2) & 0xffff;
    reg.x = x;
  }
  CODE_BAB4AE(db);
}

/** $BAB4AE */
export function CODE_BAB4AE(db = reg.db): void {
  let x = reg.x;
  w16(0x0650, 0);
  const n = lda8(x);
  w8(0x0650, n);
  w8(0x065b, (n << 1) & 0xff);
  w8(0x065c, (n << 3) & 0xff);
  w8(0x065c, ((0xff - r8(0x065c)) & 0xff) >> 1);
  x = (x + 2) & 0xffff;
  reg.x = x;
  w16(0xcb, x);
  w16(0xce, 0x3a00);
  reg.y = TEXT_BUF;
  w8(0xd0, 0x7e);
  CODE_BAB4EA(db);
}

/** `[$CB]` (bank in $CD) */
const cb8 = () => bus8(((r8(0xcd) << 16) | r16(0xcb)) & 0xffffff);
/** `STA [$CE]` 16-bit, then `INC $CE : INC $CE`. */
function putCE(v: number) {
  busW16(((r8(0xd0) << 16) | r16(0xce)) & 0xffffff, v & 0xffff);
  w16(0xce, (r16(0xce) + 2) & 0xffff);
}

/** $BAB4EA — one character. */
export function CODE_BAB4EA(db = reg.db): void {
  for (;;) {
    reg.a = (cb8() - 0x21) & 0xffff;
    if (reg.a & 0x8000) {
      // a space: no letter, advance the x position
      w8(0x065b, (r8(0x065b) - 2) & 0xff);
      w16(0x065c, add(r16(0x065c), 0x0008));
    } else {
      CODE_BAB50D();
    }
    w16(0xcb, (r16(0xcb) + 1) & 0xffff);
    if (dec(0, 0x0650) === 0) break;
  }
  CODE_BAB57B(db);
}

/** $BAB50D — copy the letter's tiles (64 bytes) and add its two OAM entries (top, bottom). */
export function CODE_BAB50D(): void {
  reg.x = reg.a;
  reg.db = FONT_BANK;
  reg.a = lda(FONT + reg.x);
  reg.db = 0xba;
  const src = add(((reg.a & 0x00ff) << 6) & 0xffff, 0x0660);
  let y = reg.y;
  for (let i = 0; i < 0x40; i++) w8(0x7e0000 | ((y + i) & 0xffff), bus8(0xfc0000 | ((src + i) & 0xffff)));
  y = (y + 0x40) & 0xffff;
  reg.y = y;
  reg.x = (src + 0x40) & 0xffff;
  cpuTime(0x40 * 7 * 8);
  putCE(r16(0x065c));
  putCE(0x3c00 | r16(0x0654));
  inc(0, 0x0654);
  putCE(add(r16(0x065c), 0x0800));
  putCE(0x3c00 | r16(0x0654));
  inc(0, 0x0654);
  reg.a = add(r16(0x065c), 0x0008);
  w16(0x065c, reg.a);
}

/** $BAB571 — (the advance to the next character; inside CODE_BAB4EA's loop). */
export function CODE_BAB571(): void {
  w16(0xcb, (r16(0xcb) + 1) & 0xffff);
  if (dec(0, 0x0650) === 0) return CODE_BAB57B();
  CODE_BAB4EA();
}

/** $BAB57B */
export function CODE_BAB57B(db = reg.db): void {
  inc(0, 0x065a);
  reg.db = db;
}

// ------------------------------------------------------------------ credits

/** `STA [$C8],y` */
const putC8 = (y: number, v: number) => busW16(((r8(0xca) << 16) | ((r16(0xc8) + y) & 0xffff)) & 0xffffff, v);
/** `LDA [$CE]` 8-bit (bank in $D0) */
const ce8 = () => bus8(((r8(0xd0) << 16) | r16(0xce)) & 0xffffff);

/** $BAB580 — render a credits line (X = its text: length, attribute, characters). */
export function CODE_BAB580(): void {
  w16(0x065e, 0x0010);
  CODE_BAB60F();
  const db = reg.db;
  reg.db = FONT_BANK;
  CODE_BAB5F5();
  w16(0x0650, ce8());
  reg.a = sub(0x0020, r16(0x0650));
  if (reg.a & 0x0001) reg.a = (reg.a - 1) & 0xffff;
  CODE_BAB5AA(db);
}

/** $BAB5AA — Y = start column (centred). */
export function CODE_BAB5AA(db = reg.db): void {
  reg.y = reg.a;
  w16(0xce, (r16(0xce) + 1) & 0xffff);
  const attr = ce8() << 8;
  w16(0xce, (r16(0xce) + 1) & 0xffff);
  reg.a = attr;
  CODE_BAB5B5(db);
}

/** $BAB5B5 — the characters (two tile rows each) until the 0 terminator. */
export function CODE_BAB5B5(db = reg.db): void {
  for (;;) {
    const ch = ce8();
    reg.a = (reg.a & 0xff00) | ch;
    if (ch === 0) {
      w16(0xce, (r16(0xce) + 1) & 0xffff);
      reg.db = db;
      return;
    }
    const c = (ch - 0x21) & 0xff;
    if (c & 0x80) {
      reg.a = (((reg.a & 0xff00) | c) & 0xfe00) | 0x00fe;
    } else {
      w8(0x065c, c);
      reg.x = r16(0x065c);
      const t = lda8(FONT + reg.x);
      reg.a = (reg.a & 0xff00) | ((t << 1) & 0xff);
    }
    const y = reg.y;
    putC8(y, reg.a);
    reg.a = (reg.a + 1) & 0xffff;
    putC8((y + 0x40) & 0xffff, reg.a);
    reg.y = (y + 2) & 0xffff;
    w16(0xce, (r16(0xce) + 1) & 0xffff);
    dec(0, 0x0654);
  }
}

/** $BAB5CD — (store of one character; inside CODE_BAB5B5). */
export function CODE_BAB5CD(): void {
  CODE_BAB5B5();
}

/** $BAB5E5 — (end of the line; inside CODE_BAB5B5). */
export function CODE_BAB5E5(): void {
  w16(0xce, (r16(0xce) + 1) & 0xffff);
}

/** $BAB5E9 — (`PLB : RTS`). */
export function CODE_BAB5E9(): void {}

/** $BAB5EB — (a non-letter: blank tile; inside CODE_BAB5B5). */
export function CODE_BAB5EB(): void {
  reg.a = (reg.a & 0xfe00) | 0x00fe;
}

/** $BAB5F5 — text pointers: [$C8] = the text buffer, [$CE] = $BA:X, 32 columns. */
export function CODE_BAB5F5(): void {
  w16(0xc8, TEXT_BUF);
  w16(0x065c, 0);
  w16(0xcf, 0xba00);
  w16(0xce, reg.x);
  reg.y = 0x0000;
  reg.a = 0x0020;
  w16(0x0654, 0x0020);
}

/** $BAB60F — clear the line in the text buffer (blank tiles). */
export function CODE_BAB60F(): void {
  const db = reg.db;
  reg.db = FONT_BANK;
  CODE_BAB5F5();
  reg.a = 0x00fe;
  CODE_BAB61B();
  reg.db = db;
}

/** $BAB61B */
export function CODE_BAB61B(): void {
  do {
    const y = reg.y;
    putC8(y, reg.a);
    putC8((y + 0x40) & 0xffff, reg.a);
    reg.y = (y + 2) & 0xffff;
  } while (dec(0, 0x0654) !== 0);
}

/** $BAB633 — set up the credits screen. */
export function init_credits_screen(): void {
  io16(CPU.enable_interrupts, 0x0000);
  reg.db = 0xba;
  io16(PPU.oam_address, 0x0000);
  io16(PPU.screen, 0x0080);
  w16(0x06a5, 0);
  w16(0xcc, 0xbaba);
  disable_screen();
  clear_vram_global();
  CODE_BAC7C0();
  clear_wram_tables();
  init_sprite_render_order_global();
  reset_camera_and_bg_scroll();
  w16(0x0650, 0x0780);
  reg.a = 0x3eff;
  reg.x = 0x7000;
  io16(PPU.vram_address, 0x7000);
  CODE_BAB671();
}

/** $BAB671 — fill the text layer's map with the blank tile. */
export function CODE_BAB671(): void {
  const n = r16(0x0650) || 0x10000;
  for (let i = 0; i < n; i++) io16(PPU.vram_write, reg.a);
  w16(0x0650, 0);
  cpuTime(n * 16 * 8);
  reg.a = C.credits_vram_payload_id;
  vram_payload_handler_global();
  reg.a = C.credits_ppu_config_id;
  set_ppu_registers_global();
  w16(0x0662, lo("credits_text_data"));
  w16(0x065e, 0x0008);
  w16(0x0660, 0x0002);
  const pal = (a: number, y: number, x: number) => {
    reg.a = a;
    reg.y = y;
    reg.x = x;
    dma_palette();
  };
  pal(lo("DATA_FD3DAE"), 0x0000, 0x0008);
  pal(lo("credits_header_layer_1_palette"), 0x0030, 0x0004);
  reg.a = 0x00aa;
  reg.y = 0x0020;
  reg.x = 0x0004;
  dma_sprite_palette_from_index();
  pal(lo("credits_name_text_layer_1_palette"), 0x0040, 0x0004);
  w16(0x0652, 0x73c0);
  w16(0x0666, 0xff08);
  w16(0x0664, 0);
  w16(0x067d, lo("CODE_BAB6F6"));
  reg.a = 0x0100;
  set_fade_global();
  reg.a = 0x0081;
  io16(CPU.enable_interrupts, 0x0081);
}

/** One DMA to VRAM (channel 0, word writes to $2118). */
function vramDma(size: number, vaddr: number, src: number, srcBank: number) {
  io16(DMA.size, size);
  io16(PPU.vram_address, vaddr);
  io8(DMA.settings, 0x01);
  io8(DMA.destination, 0x18);
  io16(DMA.source, src);
  io8(DMA.source_bank, srcBank);
  io8(DMA.unused_1, 0x00);
  io8(CPU.enable_dma, 0x01);
}

/** $BAB6F6 — each frame of the credits: uploads, fade, scroll, the next line every 16 px. */
export function CODE_BAB6F6(): void {
  reg.a = r16(0x06a5);
  if (reg.a & 0x0002) {
    w16(0x06a5, reg.a & 0xfffd);
    vramDma(0x0660, 0x5800, lo("DATA_FC0000"), bank("DATA_FC0000"));
    vramDma(0x0240, r16(0x0652), lo("DATA_F57D13"), bank("DATA_F57D13"));
    reg.a = 0xff08;
    w16(0x0666, 0xff08);
  }
  CODE_BAB768();
}

/** $BAB768 */
export function CODE_BAB768(): void {
  reg.a = r16(0x06a5);
  if (reg.a & 0x0040) {
    w16(0x06a5, reg.a & 0xffbf);
    vramDma(0x0080, r16(0x0652), TEXT_BUF, 0x7e);
  }
  CODE_BAB7A6();
}

/** $BAB7A6 */
export function CODE_BAB7A6(): void {
  fade_screen_global();
  io8(PPU.screen, r8(R.screen_brightness));
  reg.a = r16(R.screen_brightness);
  if (reg.a === 0) {
    callAddr(0xba0000 | r16(0x067f));
    return;
  }
  CODE_BAB7BC();
}

/** $BAB7BC */
export function CODE_BAB7BC(): void {
  if (dec(0, 0x0660) === 0) return CODE_BAB7C4();
  CODE_BAB8CD();
}

/** $BAB7C4 */
export function CODE_BAB7C4(): void {
  w16(0x0660, 0x0002);
  if (dec(0, 0x065e) !== 0) return CODE_BAB8B2();
  CODE_BAB7D3();
}

/** $BAB7D3 — scrolled one line: next line of text (control codes $00, $60-$63). */
export function CODE_BAB7D3(): void {
  w16(0x065e, 0x0010);
  reg.a = r16(0x06a5);
  if (!(reg.a & 0x0004)) {
    reg.a = add(r16(0x0652), 0x0040);
    if (ge(reg.a, 0x7800)) reg.a = 0x7000;
    CODE_BAB7F3();
  }
  CODE_BAB7F7();
}

/** $BAB7F3 — (store of the next VRAM line; inside CODE_BAB7D3). */
export function CODE_BAB7F3(): void {
  w16(0x0652, reg.a);
}

/** $BAB7F7 */
export function CODE_BAB7F7(): void {
  const x = r16(0x0662);
  reg.x = x;
  reg.a = lda8(x);
  if (reg.a !== 0) return CODE_BAB812();
  w16(0x065e, 0x0010);
  CODE_BAB60F();
  inc(0, 0x0662);
  CODE_BAB8A7();
}

/** $BAB812 — $61: stop scrolling. */
export function CODE_BAB812(): void {
  if (reg.a !== 0x0061) return CODE_BAB828();
  w16(0x06a5, r16(0x06a5) | 0x0004);
  inc(0, 0x0662);
  CODE_BAB8B2();
}

/** $BAB828 — $62: upload the logo. */
export function CODE_BAB828(): void {
  if (reg.a !== 0x0062) return CODE_BAB83E();
  w16(0x06a5, r16(0x06a5) | 0x0002);
  inc(0, 0x0662);
  CODE_BAB8B2();
}

/** $BAB83E — $63: the end: fade out to the museum. */
export function CODE_BAB83E(): void {
  if (reg.a !== 0x0063) return CODE_BAB858();
  w16(0x065e, reg.a);
  reg.a = 0x810f;
  set_fade_global();
  w16(0x067f, lo("CODE_BAB8FD"));
  CODE_BAB8B2();
}

/** $BAB858 — $60: skip. */
export function CODE_BAB858(): void {
  if (reg.a !== 0x0060) return CODE_BAB862();
  inc(0, 0x0662);
  CODE_BAB8B2();
}

/** $BAB862 — a text line (bit 3 of the attribute: English/French pair). */
export function CODE_BAB862(): void {
  let x = reg.x;
  reg.a = lda(x + 1) & 0x0008;
  if (reg.a === 0) return CODE_BAB89E();
  reg.a = r16(R.language_select);
  if (reg.a === 0) return CODE_BAB883();
  reg.a = (lda8(x) + 2 + r16(0x0662) + 1) & 0xffff;
  w16(0x0662, reg.a);
  reg.x = reg.a;
  CODE_BAB89E();
}

/** $BAB883 — English: render it, skip the French one. */
export function CODE_BAB883(): void {
  CODE_BAB580();
  const x = r16(0xce);
  reg.x = x;
  w16(0x0662, x);
  reg.a = (lda8(x) + 2 + r16(0x0662) + 1) & 0xffff;
  w16(0x0662, reg.a);
  CODE_BAB8A7();
}

/** $BAB89E */
export function CODE_BAB89E(): void {
  CODE_BAB580();
  reg.a = r16(0xce);
  w16(0x0662, reg.a);
  CODE_BAB8A7();
}

/** $BAB8A7 */
export function CODE_BAB8A7(): void {
  w16(0x06a5, r16(0x06a5) | 0x0040);
  CODE_BAB8B2();
}

/** $BAB8B2 — scroll one pixel. */
export function CODE_BAB8B2(): void {
  reg.a = r16(0x06a5);
  if (reg.a & 0x0004) return CODE_BAB8D6();
  inc(0, 0x0664);
  reg.a = r16(0x0664);
  io8(PPU.layer_1_scroll_y, reg.a & 0xff);
  io8(PPU.layer_1_scroll_y, (reg.a >> 8) & 0xff);
  reg.a = ((reg.a >> 8) | (reg.a << 8)) & 0xffff;
  CODE_BAB8CD();
}

/** $BAB8CD */
export function CODE_BAB8CD(): void {
  reg.a = r16(0x06a5);
  if (!(reg.a & 0x0004)) return CODE_BAB8F8();
  CODE_BAB8D6();
}

/** $BAB8D6 — scrolling stopped: a button returns to the Rareware logo. */
export function CODE_BAB8D6(): void {
  reg.a = r16(R.screen_brightness);
  if (reg.a !== 0x000f) return CODE_BAB8F8();
  input_and_pause_handler_global();
  reg.a = r16(R.player_active_held);
  if (reg.a & C.input_ABXY_start) {
    w16(0x067f, lo("CODE_BAB8F9"));
    reg.a = 0x810f;
    set_fade_global();
  }
  CODE_BAB8F8();
}

/** $BAB8F8 */
export function CODE_BAB8F8(): void {}

/** $BAB8F9 */
export function CODE_BAB8F9(): void {
  restart_rareware_logo();
}

/** $BAB8FD — to the monkey museum (ending). */
export function CODE_BAB8FD(): void {
  reg.a = lo("run_ending_monkey_museum");
  w16(R.nmi_pointer, reg.a);
  reg.a = lo("CODE_B490D9");
  w16(0x067d, reg.a);
  CODE_BAB8F8();
}


registerSprite({
  kore_sparkle_spawner_sprite_code, CODE_BAB09E, CODE_BAB0B5, CODE_BAB0BE, CODE_BAB11C, CODE_BAB11F, CODE_BAB129,
  kore_sparkle_sprite_code, krool_water_drips_sprite_code, krool_fish_sprite_code,
});
registerRtl({
  init_bonus_screen, CODE_BAB2D6, CODE_BAB31B, CODE_BAB31E, CODE_BAB375, CODE_BAB3A4, CODE_BAB3D1, CODE_BAB3E5,
  CODE_BAB3F6, CODE_BAB3FD, init_credits_screen, CODE_BAB671, CODE_BAB6F6, CODE_BAB768, CODE_BAB7A6, CODE_BAB7BC,
  CODE_BAB7C4, CODE_BAB7D3, CODE_BAB7F3, CODE_BAB7F7, CODE_BAB812, CODE_BAB828, CODE_BAB83E, CODE_BAB858,
  CODE_BAB862, CODE_BAB883, CODE_BAB89E, CODE_BAB8A7, CODE_BAB8B2, CODE_BAB8CD, CODE_BAB8D6, CODE_BAB8F8,
  CODE_BAB8F9, CODE_BAB8FD,
});
registerRts({
  CODE_BAB48B, CODE_BAB4AE, CODE_BAB4EA, CODE_BAB50D, CODE_BAB571, CODE_BAB57B, CODE_BAB580, CODE_BAB5AA,
  CODE_BAB5B5, CODE_BAB5CD, CODE_BAB5E5, CODE_BAB5E9, CODE_BAB5EB, CODE_BAB5F5, CODE_BAB60F, CODE_BAB61B,
});
