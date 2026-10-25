/**
 * Bank $80 — the per-level-type NMI sub modes (nmi_sub_mode_table) and their VBlank effects.
 *
 * Every frame of a level the NMI routine CODE_808819 runs the NMI sub mode of the level type
 * (level[0].nmi_sub_mode) before the game sub mode. The NMI sub mode does the VBlank work:
 * start the pending DMA/HDMA channels, upload the queued sprite graphics and the level
 * columns/rows, then write the layer scroll registers (parallax) and play the animated
 * background effects of the level type (lava glow, mine sparkles, waving flags, ...).
 *
 * Register stores are written with the exact width of the original: a 16-bit `STA` to a PPU
 * register writes two consecutive registers (e.g. `STA CPU.enable_dma` with 16-bit A also sets
 * the HDMA enable register $420C), the scroll registers are written twice (low, high byte).
 *
 * Absolute (`LDA table,x`) reads of bank-$80 tables go through the current data bank, like the
 * original (the NMI does not set DB).
 */
import { r8, r16, w8, w16, io8, io16, ioR8, bus8, bus16 } from "../../core/mem";
import { reg, register } from "../../core/cpu";
import { sbc16, flags } from "../../core/ops";
import { L, R, C, CPU, PPU, DMA, HDMA, level, sprite } from "../../core/sym";
import {
  dma_queued_sprite_graphics,
  dma_queued_sprite_palette,
  dma_level_columns,
  dma_level_rows,
  dma_ship_deck_rigging_columns,
  dma_ship_deck_rigging_rows,
  input_and_pause_handler,
  dma_palette,
} from "../../gen/routines";
import { get_random_number } from "./b80b_title";

const RAM_17C2 = 0x17c2; // layer 1 vertical scroll (screen_scroll_y_position adjusted by the camera)
const RAM_17C4 = 0x17c4;
const RAM_0913 = 0x0913;
const RAM_0915 = 0x0915;
const RAM_0917 = 0x0917;

const LAVA_FALL_PALETTE = L("DATA_80BA91");
const MINE_SPARKLE_POSITIONS = L("DATA_80BCC8");
const LAVA_STEAM_TILES = L("DATA_80D3ED"); // 3-byte pointers: word at +0, bank at +2
const BUBBLE_TILES_A = L("DATA_80CE97") & 0xffff;
const BUBBLE_TILES_B = L("DATA_80CEB5") & 0xffff;
const BUBBLE_TILES_C = L("DATA_80CED3") & 0xffff;
const RIGGING_TILES = L("DATA_80CEF1") & 0xffff;
const RIGGING_SAIL_TILES = L("DATA_80CF01") & 0xffff;
const MAST_FLAG_TILES = L("DATA_80CF11") & 0xffff;

/** 16-bit read of a bank-$80 table through the data bank (absolute addressing). */
const dbr16 = (addr16: number) => bus16(((reg.db & 0xff) << 16) | (addr16 & 0xffff));

const afc = () => r16(R.active_frame_counter);
const scrollX = () => r16(R.screen_scroll_x_position);

/** Two-write scroll register: low byte then high byte. */
function scroll(port: number, v: number) {
  io8(port, v & 0xff);
  io8(port, (v >> 8) & 0xff);
}

/** `LDA screen_brightness : STA PPU.screen` with 8-bit A. */
function brightness() {
  io8(PPU.screen, r8(R.screen_brightness));
}

/** `LDA pending_dma_hdma_channels : STA CPU.enable_dma` (16-bit: DMA and HDMA enables). */
function startPendingDma() {
  io16(CPU.enable_dma, r16(R.pending_dma_hdma_channels));
}

/** One general purpose DMA on channel `ch` (source written to both the address and $43x8). */
function dmaChannel(ch: number, dest: number, settings: number, src: number, bank: number, size: number, both = true) {
  const o = ch << 4;
  io16(PPU.vram_address, dest);
  io16(DMA.source + o, src);
  if (both) io16(DMA.unused_2 + o, src);
  io16(DMA.size + o, size);
  io16(DMA.settings + o, settings);
  io8(DMA.source_bank + o, bank);
  io8(CPU.enable_dma, 1 << ch);
}

/** CGRAM DMA from WRAM bank $7E on channel 0 (address register set by the caller). */
function cgramDma(src: number, size: number) {
  io16(DMA.source, src);
  io16(DMA.unused_2, src);
  io16(DMA.size, size);
  io16(DMA.settings, 0x2200);
  io8(DMA.source_bank, 0x7e);
  io8(CPU.enable_dma, 0x01);
}

// ---------------------------------------------------------------------------------------------
// Simple sub modes

/** $80B705 — menus / map-like screens: DMA, sprite graphics and palettes, input handler. */
export function nmi_sub_mode_00() {
  startPendingDma();
  dma_queued_sprite_graphics();
  dma_queued_sprite_palette();
  brightness();
  input_and_pause_handler();
}

/** $80B720 — only start the pending DMA and set the brightness. */
export function nmi_sub_mode_05() {
  startPendingDma();
  brightness();
}

/** $80B731 — common start of most level NMI sub modes. */
export function dma_level_and_sprite_graphics() {
  startPendingDma();
  dma_queued_sprite_graphics();
  dma_level_columns();
  dma_level_rows();
  dma_queued_sprite_palette();
}

/** $80B746 — Forest (unused): layer 2 follows the camera, layer 3 at half speed. */
export function forest_unused_nmi_sub_mode() {
  dma_level_and_sprite_graphics();
  io8(PPU.layer_3_scroll_x, (scrollX() >> 1) & 0xff);
  io8(PPU.layer_3_scroll_x, 0);
  scroll(PPU.layer_2_scroll_x, scrollX());
  io8(PPU.layer_2_scroll_y, r8(RAM_17C2));
  io8(PPU.layer_2_scroll_y, 0);
  io8(PPU.layer_3_scroll_y, 0);
  io8(PPU.layer_3_scroll_y, 0);
  brightness();
}

/** $80B779 — Ship Hold (Lockjaw's Locker): animated water surface (HDMA), no scroll writes. */
export function ship_hold_nmi_sub_mode() {
  startPendingDma();
  CODE_80B89C();
  dma_queued_sprite_graphics();
  dma_level_columns();
  dma_level_rows();
  dma_queued_sprite_palette();
  brightness();
}

/**
 * $80B95F — (world map) sprite graphics only. The 16-bit store to layer_1_scroll_y writes
 * whatever A dma_queued_sprite_graphics returned to $210E and $210F.
 */
export function nmi_sub_mode_04() {
  startPendingDma();
  dma_queued_sprite_graphics();
  io16(PPU.layer_1_scroll_y, reg.a & 0xffff);
  brightness();
}

/** $80BC6D — same as nmi_sub_mode_04. */
export function nmi_sub_mode_0B() {
  startPendingDma();
  dma_queued_sprite_graphics();
  io16(PPU.layer_1_scroll_y, reg.a & 0xffff);
  brightness();
}

// ---------------------------------------------------------------------------------------------
// Water surface of the ship hold (HDMA tables)

/**
 * $80B89C — alternate the two HDMA table sets of the water every frame, then compute the
 * water line heights.
 */
export function CODE_80B89C() {
  if (afc() & 1) {
    io16(HDMA.source + 0x50, 0x8552);
    io16(HDMA.source + 0x60, 0x8812);
  } else {
    io16(HDMA.source + 0x50, 0x86b2);
    io16(HDMA.source + 0x60, 0x8822);
  }
  CODE_80B8BD();
}

/** Ice levels with RAM_0915 set freeze the water ripple phase. */
function ripplesFrozen() {
  return r16(level.tileset_type) === C.ice_1_layout_id && r16(RAM_0915) !== 0;
}

/**
 * Height in scanlines (clamped to $7E) from the top of the screen to a ripple line that moves
 * down with `phase` inside a `mask`+1 period starting at the water surface. Returns the value
 * stored to the HDMA line count and the carry of the clamp compare.
 */
function rippleLine(phase: number, mask: number, ifZero: number): [number, boolean] {
  const water = r16(R.water_y_position);
  let a = (((phase - water) & mask) + water - r16(R.screen_scroll_y_position)) & 0xffff;
  if (a & 0x8000) a &= mask;
  a >>= 1;
  if (a === 0) a = ifZero;
  if (a >= 0x7e) return [0x7e, true];
  return [a, false];
}

/** $80B8BD — write the water HDMA line counts and the water layer scroll values ($B6-$C4). */
export function CODE_80B8BD() {
  // first table: a slow ripple (frame / 2, period 16)
  const [l1, c1] = rippleLine(ripplesFrozen() ? 0 : afc() >> 1, 0x000f, 0x0008);
  w8(0x886c | 0x7e0000, l1);
  w8(0x886f | 0x7e0000, (l1 + (c1 ? 1 : 0)) & 0xff);
  // second table: a faster ripple (frame, period 32)
  const [l2, c2] = rippleLine(ripplesFrozen() ? 0 : afc(), 0x001f, 0x0010);
  w8(0x8012 | 0x7e0000, l2);
  w8(0x8015 | 0x7e0000, (l2 + (c2 ? 1 : 0)) & 0xff);
  // scroll values of the water layer, the second row is offset by one pixel
  const x = scrollX();
  const y = r16(R.screen_scroll_y_position);
  w16(0xb6, x);
  w16(0xc2, x);
  w16(0xba, (x + 1) & 0xffff);
  w16(0xbe, (x + 1) & 0xffff);
  w16(0xb8, y);
  w16(0xbc, y);
  w16(0xc0, (y - 1) & 0xffff);
  w16(0xc4, (y - 1) & 0xffff);
  reg.a = (y - 1) & 0xffff;
}

// ---------------------------------------------------------------------------------------------
// Ship deck

/** Layer 1 follows the camera, layer 3 (water and sky) uses the scroll in $B8. */
function shipDeckScroll() {
  const x = scrollX();
  io8(PPU.layer_1_scroll_x, x & 0xff);
  io8(PPU.layer_1_scroll_x, (x >> 8) & 0xff);
  io8(PPU.layer_3_scroll_x, r8(0xb8));
  io8(PPU.layer_3_scroll_x, r8(0xb9));
  const y = r8(RAM_17C2);
  io8(PPU.layer_1_scroll_y, y);
  io8(PPU.layer_1_scroll_y, 0);
  io8(PPU.layer_3_scroll_y, y);
  io8(PPU.layer_3_scroll_y, 0);
  brightness();
}

/** $80B977 — Ship Deck (Pirate Panic): rigging layer columns/rows and parallax. */
export function ship_deck_nmi_sub_mode() {
  startPendingDma();
  dma_queued_sprite_graphics();
  dma_ship_deck_rigging_columns();
  dma_ship_deck_rigging_rows();
  dma_level_columns();
  dma_level_rows();
  dma_queued_sprite_palette();
  shipDeckScroll();
}

/** $80C5DE — Ship Deck (Sunset, Gangplank Galley): like the ship deck, plus a full palette upload on request. */
export function ship_deck_sunset_nmi_sub_mode() {
  startPendingDma();
  dma_queued_sprite_graphics();
  dma_ship_deck_rigging_columns();
  dma_ship_deck_rigging_rows();
  dma_level_columns();
  dma_level_rows();
  dma_queued_sprite_palette();
  if (r16(RAM_0913)) {
    // the sunset palette changed: upload all 256 colours from the WRAM palette buffer
    const pal = R.primary_palette;
    io16(DMA.source, pal & 0xffff);
    io16(DMA.unused_2, pal & 0xffff);
    io16(DMA.size, 0x0100);
    io16(DMA.settings, 0x2200);
    io8(DMA.source_bank, (pal >> 16) & 0xff);
    io8(PPU.cgram_address, 0);
    io8(CPU.enable_dma, 0x01);
    w16(RAM_0913, 0);
  }
  shipDeckScroll();
}

/** $80BC3D — Ship Deck (Cabin): single layer, no level streaming. */
export function ship_deck_cabin_nmi_sub_mode() {
  startPendingDma();
  dma_queued_sprite_graphics();
  dma_queued_sprite_palette();
  scroll(PPU.layer_1_scroll_x, scrollX());
  scroll(PPU.layer_1_scroll_y, r16(RAM_17C2));
  brightness();
}

// ---------------------------------------------------------------------------------------------
// Lava

/** $80B9C6 — Lava (Hot-Head Hop, Kleever's Kiln): bubbles, lava falls, glow and heat haze. */
export function lava_nmi_sub_mode() {
  dma_level_and_sprite_graphics();
  update_lava_bubble_graphics();
  update_lava_fall_effect();
  update_lava_palette_glow_effect();
  CODE_80BAB1();
  io8(PPU.layer_3_scroll_x, (scrollX() >> 2) & 0xff);
  io8(PPU.layer_3_scroll_x, 0);
  let y = r16(RAM_17C2);
  if (r16(R.level_number) === C.level_kleevers_kiln) y = (y - 0x30) & 0xffff;
  io8(PPU.layer_3_scroll_y, (y >> 2) & 0xff);
  io8(PPU.layer_3_scroll_y, 0);
}

/** Triangle wave 0..3..0 of a 3-bit counter. */
const triangle = (v: number) => {
  v &= 7;
  return v & 4 ? v ^ 7 : v;
};

/** $80B9FF — pulse the fixed colour (red/green channels) used for the lava glow color math. */
export function update_lava_palette_glow_effect() {
  const t = afc();
  const slow = triangle((((t >> 3) + t) & 0xffff) >> 4);
  const fast = triangle(t >> 3);
  const v = (slow + fast) & 0xffff;
  w16(0x32, v);
  io8(PPU.fixed_color, (v | 0xc0) & 0xff); // blue
  io8(PPU.fixed_color, (v | 0x20) & 0xff); // red
  reg.a = v | 0x20;
}

/** $80BA44 — every 4th frame cycle colours 5-7 through the lava fall palette (DATA_80BA91). */
export function update_lava_fall_effect() {
  io8(PPU.cgram_address, 0x05);
  const t = r8(R.active_frame_counter);
  if (t & 3) return;
  let x = (t >> 1) & 0x0e;
  for (let i = 0; i < 3; i++) {
    io8(PPU.cgram_write, bus8(LAVA_FALL_PALETTE + x));
    io8(PPU.cgram_write, bus8(LAVA_FALL_PALETTE + x + 1));
    x = (x + 6) & 0xff;
  }
}

/**
 * $80BAB1 — fill the heat haze HDMA tables of the lava levels: scroll values for the layers
 * and the height of the haze band, which depends on the level's lava depth.
 */
export function CODE_80BAB1() {
  const x = scrollX();
  const y = r16(RAM_17C2);
  for (const a of [0x8013, 0x8018, 0x802d]) w16(0x7e0000 | a, x);
  for (const a of [0x8015, 0x801a, 0x802f]) w16(0x7e0000 | a, y);
  // scroll x * 2 with the top bit of the sub-pixel position shifted in
  const x2 = ((x << 1) | (r16(R.screen_scroll_x_sub_position_low) >> 15)) & 0xffff;
  w16(0x7e801d, x2);
  w16(0x7e8023, x2 >> 2);
  w16(0x7e8028, x2 >> 2);
  const yHalf = ((y >> 1) - 0x0198) & 0xffff;
  w16(0x7e8025, yHalf);
  w16(0x7e802a, yHalf);
  // per-level offset of the lava surface
  let base: number;
  const lvl = r16(R.level_number);
  if (lvl === C.level_hot_head_hop_bonus_1) base = y - 0x00c0;
  else if (lvl === C.level_kleevers_kiln || lvl === C.level_fiery_furnace) base = y - 0x0080;
  else if (lvl === C.level_hot_head_hop) base = y - 0x0100;
  else base = y;
  base &= 0xffff;
  const top = (((base >> 2) + y - 0x0060) & 0xffff);
  w16(0x7e801f, top);
  let h = ((((top - 0x0070) & 0x01ff) ^ 0x01ff)) & 0xffff;
  let c: boolean;
  if (h >= 0x00ff) {
    h = 0x00ff;
  }
  // 8-bit: LSR, then the line count of the second entry is rounded up
  c = (h & 1) !== 0;
  const half = (h & 0xff) >> 1;
  for (const a of [0x8012, 0x8022, 0x8032, 0x803c]) w8(0x7e0000 | a, half);
  const half2 = (half + (c ? 1 : 0)) & 0xff;
  for (const a of [0x8017, 0x8027, 0x8035, 0x803e]) w8(0x7e0000 | a, half2);
  brightness();
}

/** $80C05A — Lava (Geyser, Red-Hot Ride): bubbles, rising hot air columns, heat haze. */
export function lava_geyser_nmi_sub_mode() {
  dma_level_and_sprite_graphics();
  update_lava_bubble_graphics();
  io8(PPU.layer_3_scroll_y, r8(RAM_17C2));
  io8(PPU.layer_3_scroll_y, 0);
  update_lava_hot_air_effect();
  CODE_80BAB1();
}

/** $80CAF5 — X = (X + 2) & $0E: next entry of the 8-entry hot air wave table. */
export function CODE_80CAF5() {
  reg.x = (reg.x + 2) & 0x000e;
  reg.a = reg.x;
}

/**
 * $80CAFD — hot air of Red-Hot Ride: a wobbling horizontal scroll wave (HDMA table at
 * $7E8048) below the lava line, and the steam tiles of up to four active hot air columns
 * (RAM_095B..$0961) uploaded to the layer 3 tilemap.
 */
export function update_lava_hot_air_effect() {
  let h = (0x022a - r16(R.screen_scroll_y_position)) & 0xffff;
  if (h === 0 || h & 0x8000) h = 1;
  if (h >= 0x007f) h = 0x007f;
  w8(0x7e8043, h);
  // wave of horizontal offsets (0, +1, +2, +2, +1, 0, -1, -1) rotating every 8 frames
  const x = scrollX();
  const wave = [0, 1, 2, 2, 1, 0, -1, -1];
  let i = (afc() & 0x0038) >> 2;
  for (let k = 0; k < 8; k++) {
    w16(0x7e8048 + i, (x + wave[k]) & 0xffff);
    if (k < 7) i = (i + 2) & 0x000e;
  }
  io16(PPU.window_1, r16(0x84));
  io8(PPU.vram_control, 0x81); // increment after $2119, by 32 (columns)
  for (let slot = 0; slot < 8; slot += 2) {
    const v = r16(0x095b + slot);
    if (!v) continue;
    if (!(v & 0x4000) && afc() & 3) continue; // ordinary columns animate every 4th frame
    reg.x = slot;
    reg.a = v;
    CODE_80CBB1();
  }
  io8(PPU.vram_control, 0x80);
  reg.x = 8;
}

/**
 * $80CBB1 — A = hot air column (bits 0-9 tilemap position, bit 15 tall, bit 14 ending).
 * Upload three columns of steam tiles to the layer 3 tilemap ($7400).
 */
export function CODE_80CBB1() {
  const v = reg.a & 0xffff;
  const savedX = reg.x;
  w16(0x32, v);
  let x = afc() & 0x000c;
  let size = 0x0014;
  if (v & 0x8000) {
    size = 0x0024;
    x |= 0x0010;
  }
  if (v & 0x4000) x = 0x0020;
  w16(0x38, size);
  let addr = (v & 0x03ff) | 0x7400;
  w16(0x32, addr);
  io16(PPU.vram_address, addr);
  io16(DMA.source, bus16(LAVA_STEAM_TILES + x));
  io16(DMA.size, size);
  io16(DMA.settings, 0x1801);
  io8(DMA.source_bank, bus8(LAVA_STEAM_TILES + x + 2));
  io8(CPU.enable_dma, 0x01);
  // next column: increment the column inside the 32-tile row
  addr = (((addr + 1) ^ addr) & 0x001f) ^ addr;
  w16(0x32, addr);
  io16(PPU.vram_address, addr);
  io16(DMA.size, size);
  io8(CPU.enable_dma, 0x01);
  addr = (((addr + 1) ^ addr) & 0x001f) ^ addr;
  io16(PPU.vram_address, addr);
  io16(DMA.size, size);
  io8(CPU.enable_dma, 0x01);
  reg.a = addr;
  reg.y = 1;
  reg.x = savedX;
}

/**
 * $80CDAE — animate the lava bubble tiles: the frame advances every 4th frame and one of the
 * four tile groups is uploaded per frame.
 */
export function update_lava_bubble_graphics() {
  if ((afc() & 3) === 0) {
    let f = (r16(0x0957) + 2) & 0xffff;
    if (f === 0x001e) f = 0;
    w16(0x0957, f);
  }
  const f = r16(0x0957);
  switch (afc() & 3) {
    case 0: // CODE_80CE09
      dmaChannel(0, 0x2270, 0x1801, dbr16(BUBBLE_TILES_A + f), 0xfb, 0x02c0);
      break;
    case 1: // CODE_80CE37
      dmaChannel(0, 0x20d0, 0x1801, dbr16(BUBBLE_TILES_B + f), 0xfb, 0x01a0);
      break;
    case 3: // CODE_80CDDB
      dmaChannel(0, 0x2010, 0x1801, dbr16(BUBBLE_TILES_C + f), 0xf5, 0x0180);
      break;
    default: // CODE_80CE65: second half of the B tiles
      dmaChannel(0, 0x21a0, 0x1801, (dbr16(BUBBLE_TILES_B + f) + 0x1860) & 0xffff, 0xfb, 0x01a0);
      break;
  }
  reg.x = f;
}

// ---------------------------------------------------------------------------------------------
// Ship mast

/** $80CF21 — every 8th frame upload the next frame of the waving flag tiles (channel 1). */
export function update_ship_mast_flag_graphics() {
  const t = afc();
  if (t & 7) return;
  const x = (t >> 2) & 0x000e;
  dmaChannel(1, 0x2010, 0x1801, dbr16(MAST_FLAG_TILES + x), 0xfa, 0x03c0);
  reg.x = x;
}

/** $80CF58 — flag, then the swaying rigging (even frames) or sail tiles (odd frames). */
export function update_rigging_graphics() {
  if (r16(R.level_number) !== C.level_krows_nest) update_ship_mast_flag_graphics();
  const t = afc();
  if (!(r16(level.effects) & 0x1000) && !(t & 1)) {
    const x = t & 0x000e;
    dmaChannel(1, 0x4f00, 0x1801, dbr16(RIGGING_TILES + x), 0xf3, 0x0200);
    reg.x = x;
    return;
  }
  // CODE_80CF9F
  if (r16(level.type) === C.boss_level_type) return;
  if (!(t & 1)) return;
  const x = t & 0x000e;
  dmaChannel(1, 0x6000, 0x1801, dbr16(RIGGING_SAIL_TILES + x), 0xf6, 0x0400);
  reg.x = x;
}

/** $80BB77 — Ship Mast (Rain, Topsail Trouble): rain layers scroll with time. */
export function ship_mast_rain_nmi_sub_mode() {
  dma_level_and_sprite_graphics();
  update_rigging_graphics();
  const t = afc();
  const x = scrollX();
  const y = r16(RAM_17C2);
  io8(PPU.layer_2_scroll_x, ((((t >> 1) + x) & 0xffff) >> 1) & 0xff);
  io8(PPU.layer_2_scroll_x, 0);
  io8(PPU.layer_2_scroll_y, (y >> 1) & 0xff);
  io8(PPU.layer_2_scroll_y, 0);
  io8(PPU.layer_3_scroll_x, (((((t + x) & 0xffff) >> 2) + x) & 0xff));
  io8(PPU.layer_3_scroll_x, 0);
  scroll(PPU.layer_1_scroll_x, x);
  io8(PPU.layer_1_scroll_y, y & 0xff);
  io8(PPU.layer_1_scroll_y, 0);
  io8(PPU.layer_3_scroll_y, y & 0xff);
  io8(PPU.layer_3_scroll_y, 0);
  brightness();
}

/**
 * $80BDAA — Ship Mast (Clouds, Mainbrace Mayhem / Krow's Nest): flag, drifting clouds with a
 * slowly oscillating vertical speed (RAM_06D5..$06DF).
 */
export function ship_mast_clouds_nmi_sub_mode() {
  dma_level_and_sprite_graphics();
  if (r16(R.level_number) !== C.level_krows_nest) update_ship_mast_flag_graphics();
  if (r16(R.game_state_flags) & 0x0140) {
    // paused / level ending: brightness only (A is 16-bit here: also writes $2101)
    io16(PPU.screen, r16(R.screen_brightness));
    return;
  }
  // CODE_80BDC2: cloud layer vertical position
  const cloudY = (r16(0x06dd) + r16(0x06db)) & 0xffff;
  w16(0x06dd, cloudY);
  io8(PPU.layer_3_scroll_y, cloudY & 0xff);
  io8(PPU.layer_3_scroll_y, 0);
  let acc = (r16(0x06d7) + 2) & 0xffff;
  w16(0x06d7, acc);
  if (acc >= 0x01f4) {
    acc = (acc - 0x01f4) & 0xffff;
    w16(0x06d7, acc);
    w16(0x06df, (r16(0x06df) + r16(0x06d5)) & 0xffff);
  }
  // CODE_80BDFF
  w16(0x06db, r16(0x06df));
  let acc2 = (acc + r16(0x06d9)) & 0xffff;
  w16(0x06d9, acc2);
  if (acc2 >= 0x01f4) {
    acc2 = (acc2 - 0x01f4) & 0xffff;
    w16(0x06d9, acc2);
    w16(0x06db, (r16(0x06db) + r16(0x06d5)) & 0xffff);
  }
  // CODE_80BE2E: reverse the drift direction at the ends (speed -1 .. 1)
  if (r16(0x06d5) & 0x8000) {
    if (r16(0x06df) === 0xffff) w16(0x06d5, 0x0001);
  } else if (r16(0x06df) === 0x0001) {
    w16(0x06d5, 0xffff);
  }
  // CODE_80BE56
  const t = afc();
  const x = scrollX();
  io8(PPU.layer_2_scroll_x, (t + x) & 0xff);
  io8(PPU.layer_2_scroll_x, 0);
  io8(PPU.layer_2_scroll_y, 0x6f);
  io8(PPU.layer_2_scroll_y, 0);
  io8(PPU.layer_3_scroll_x, ((t << 2) + x) & 0xff);
  io8(PPU.layer_3_scroll_x, 0);
  scroll(PPU.layer_1_scroll_x, x);
  io8(PPU.layer_1_scroll_y, r8(RAM_17C2));
  io8(PPU.layer_1_scroll_y, 0);
  brightness();
}

// ---------------------------------------------------------------------------------------------
// Mine

/** $80BC85 — Mine (Kannon's Klaim, Squawks's Shaft): parallax and wandering sparkles. */
export function mine_nmi_sub_mode() {
  dma_level_and_sprite_graphics();
  const x = scrollX();
  io8(PPU.layer_2_scroll_x, (x >> 2) & 0xff);
  io8(PPU.layer_2_scroll_x, 0);
  scroll(PPU.layer_1_scroll_x, x);
  scroll(PPU.layer_1_scroll_y, r16(RAM_17C2));
  update_mine_sparkle_effect();
  io8(PPU.layer_2_scroll_y, (r16(RAM_17C2) >> 2) & 0xff);
  io8(PPU.layer_2_scroll_y, 0);
  brightness();
}

/**
 * $80BD08 — every 32 frames move the sparkle layer (layer 3) to a random position from
 * DATA_80BCC8, then upload the sparkle colours (palette buffer $7E8014/$7E8032).
 */
export function update_mine_sparkle_effect() {
  if (((afc() + 0x10) & 0x1f) === 0) {
    get_random_number();
    const x = ((reg.a & 0x1f) << 1) & 0xffff; // ASL clears the carry
    // the SBCs run with the carry left by the ASL (clear) and by the first SBC
    const sx = sbc16(0x00dc, bus16(MINE_SPARKLE_POSITIONS + x), false);
    w16(R.layer_screen_scroll_x_position, sx);
    const sy = sbc16(0x00f0, bus16(MINE_SPARKLE_POSITIONS + x + 1), flags.c);
    w16(RAM_17C4, sy);
    reg.x = x;
  }
  // CODE_80BD2F
  io8(PPU.layer_3_scroll_x, ((scrollX() >> 2) + r16(R.layer_screen_scroll_x_position)) & 0xff);
  io8(PPU.layer_3_scroll_x, 0);
  io8(PPU.layer_3_scroll_y, ((r16(RAM_17C2) >> 2) + r16(RAM_17C4)) & 0xff);
  io8(PPU.layer_3_scroll_y, 0);
  io8(PPU.cgram_address, 0x01);
  cgramDma(0x8014, 0x001e);
  io8(PPU.cgram_address, 0x21);
  cgramDma(0x8032, 0x000c);
  reg.a = (reg.a & 0xff00) | 0x01;
}

// ---------------------------------------------------------------------------------------------
// Ship hold variants

/**
 * $80BFDE — Ship Hold (Dark, Glimmer's Galleon): the light window follows Glimmer, with the
 * window HDMA pointed at one of two double-buffered tables.
 */
export function ship_hold_dark_nmi_sub_mode() {
  startPendingDma();
  io16(PPU.window_1, 0xfe01);
  let settings = 0x2640;
  const g = r16(R.glimmer_sprite);
  if (!g) {
    io16(PPU.window_1, 0x0001);
  } else {
    io8(PPU.sub_screen, 0x13);
    const gfx = r16(g + sprite.current_graphic);
    if (gfx === C.glimmer_turn_frame5) {
      io8(PPU.sub_screen, 0x00);
    } else {
      // the light is mirrored when Glimmer faces the other way of its turn
      const flipped = (r16(g + sprite.oam_property) & 0x4000) !== 0;
      if (gfx > C.glimmer_turn_frame5 ? !flipped : flipped) settings = 0x2740;
    }
    io16(HDMA.settings + 0x20, settings);
    io16(HDMA.source + 0x20, ((((afc() & 1) ^ 1) << 8) + 0x80f2) & 0xffff);
  }
  CODE_80B89C();
  dma_queued_sprite_graphics();
  dma_level_columns();
  dma_level_rows();
  dma_queued_sprite_palette();
  brightness();
}

/** $80C57E — clamp a negative A to zero (callers pass the N flag of their SBC). */
export function CODE_80C57E() {
  if (reg.a & 0x8000) reg.a = 0;
}
const clampNeg = (v: number) => (v & 0x8000 ? 0 : v & 0xffff);

/**
 * $80C4A5 — Ship Hold (Hot, Lava Lagoon): the water heats up / cools down. RAM_0915 is the
 * target heat (set by Clapper), RAM_0917 the current heat; the heat fades colour 0 (the
 * backdrop) from blue to red and selects the level palette.
 */
export function ship_hold_hot_nmi_sub_mode() {
  startPendingDma();
  CODE_80B89C();
  dma_queued_sprite_graphics();
  dma_level_columns();
  dma_level_rows();
  dma_queued_sprite_palette();
  if (!(r16(R.game_state_flags) & 0x0140)) {
    if (r16(RAM_0915)) w16(RAM_0915, (r16(RAM_0915) - 1) & 0xffff);
    const target = r16(RAM_0915);
    const cur = r16(RAM_0917);
    if (target !== cur) {
      if (target < cur) {
        w16(RAM_0917, (cur - 1) & 0xffff);
      } else {
        // heat up quickly while far from the target
        const step = target - cur >= 4 ? 4 : 1;
        let v = (step + cur) & 0xffff;
        if (v === 0x0040) v = 0x00b4;
        w16(RAM_0917, v);
      }
    }
  }
  // CODE_80C4F8: heat level 0..$18
  let a = r16(RAM_0917);
  if (a >= 0x003f) a = (clampNeg((a - 0x00b4) & 0xffff) + 0x003f) & 0xffff;
  a >>= 2;
  if (a >= 0x0018) a = 0x0018;
  w16(0x32, a);
  const cool = (0x0018 - a) & 0xffff;
  w16(0x34, cool);
  // backdrop colour (BGR555): red = cool, blue = 5 - cool, green = 2 - cool (clamped at 0)
  let col = cool;
  col |= (xba16(clampNeg((0x0005 - cool) & 0xffff)) << 2) & 0xffff;
  w16(0x36, col);
  col = ((clampNeg((0x0002 - cool) & 0xffff) << 5) | col) & 0xffff;
  w16(RAM_0913, col);
  let pal = L("lockjaws_locker_level_palette");
  if (a < 0x0014) {
    pal = L("water_hot_fade_layer_3_palette");
    if (a < 0x0010) pal = L("lava_lagoon_level_palette");
  }
  reg.a = pal & 0xffff;
  reg.x = 0x0004;
  reg.y = 0x0000;
  dma_palette();
  io8(PPU.cgram_address, 0);
  io8(PPU.cgram_write, r8(RAM_0913));
  io8(PPU.cgram_write, r8(RAM_0913 + 1));
  brightness();
}
const xba16 = (v: number) => ((v >> 8) & 0xff) | ((v & 0xff) << 8);

register({
  nmi_sub_mode_00,
  nmi_sub_mode_05,
  dma_level_and_sprite_graphics,
  forest_unused_nmi_sub_mode,
  ship_hold_nmi_sub_mode,
  nmi_sub_mode_04,
  nmi_sub_mode_0B,
  CODE_80B89C,
  CODE_80B8BD,
  ship_deck_nmi_sub_mode,
  ship_deck_sunset_nmi_sub_mode,
  ship_deck_cabin_nmi_sub_mode,
  lava_nmi_sub_mode,
  update_lava_palette_glow_effect,
  update_lava_fall_effect,
  CODE_80BAB1,
  lava_geyser_nmi_sub_mode,
  CODE_80CAF5,
  update_lava_hot_air_effect,
  CODE_80CBB1,
  update_lava_bubble_graphics,
  update_ship_mast_flag_graphics,
  update_rigging_graphics,
  ship_mast_rain_nmi_sub_mode,
  ship_mast_clouds_nmi_sub_mode,
  mine_nmi_sub_mode,
  update_mine_sparkle_effect,
  ship_hold_dark_nmi_sub_mode,
  CODE_80C57E,
  ship_hold_hot_nmi_sub_mode,
});
