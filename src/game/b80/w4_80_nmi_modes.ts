/**
 * Bank $80 (package w4_80) — the NMI sub modes of the level types of worlds 3-7 and the Lost
 * World, and their VBlank effects: animated tiles (wasp hive honey, castle torches, Kackle,
 * falling leaves, mine debris, Krocodile Kore beam), palette pulses (castle torches, the
 * Krocodile Kore glow, the freezing water of the ice levels), HDMA tables (water surfaces,
 * forest light shafts, ice distortion, swamp fog, wind waves) and the parallax scroll registers.
 *
 * Like b80b_nmi_modes.ts: register stores keep the width of the original (an 8-bit `STA` +
 * `STZ` pair writes the low byte then 0; `STA` + `XBA` + `STA` writes low then high byte), and
 * absolute reads of bank-$80 tables go through the current data bank (the NMI does not set DB).
 */
import { r8, r16, w8, w16, io8, io16, rom8, rom16, bus16 } from "../../core/mem";
import { reg, register } from "../../core/cpu";
import { setRetMode, RET_RTS, RET_RTL } from "../../core/hybrid";
import { xba } from "../../core/ops";
import { L, R, CPU, PPU, DMA, HDMA } from "../../core/sym";
import {
  dma_queued_sprite_graphics,
  dma_queued_sprite_palette,
  dma_level_columns,
  dma_level_rows,
  dma_level_and_sprite_graphics,
  dma_palette,
  dma_to_vram_global,
  CODE_80B89C,
  CODE_80B8BD,
  update_ship_mast_flag_graphics,
} from "../../gen/routines";

const W = 0x7e0000;
const RAM_17C2 = 0x17c2; // layer 1 vertical scroll (camera adjusted)
const RAM_0913 = 0x0913; // backdrop colour of the ice / hot water fade
const RAM_0915 = 0x0915; // target heat / freeze
const RAM_0917 = 0x0917; // current heat / freeze
const RAM_0B00 = 0x0b00; // normal sprite DMA budget

const SINE = L("DATA_B3F4D8"); // 256-entry signed wave table (words)
const FIREWORKS_PALETTE = L("fireworks_palette") & 0xffff;
const KORE_GLOW_PALETTE = L("DATA_FD2CF0");
const KORE_BEAM_TILES = L("DATA_80CAE5") & 0xffff;
const CASTLE_TORCH_TILES = L("castle_torch_tiledata_table");
const CASTLE_TORCH_BANK = (L("castle_torch_tiledata_frame1") >> 16) & 0xff;
const CASTLE_TORCH_PALETTE = L("castle_level_palette") + 0xd0;
const KACKLE_TILES_A = L("DATA_80C38C");
const KACKLE_TILES_B = L("DATA_80C446");
const KACKLE_BANK_A = (L("DATA_F429D2") >> 16) & 0xff;
const KACKLE_BANK_B = (L("DATA_F41852") >> 16) & 0xff;
const WATER_FROZEN_PALETTE = L("water_frozen_layer_3_palette") & 0xffff;
const WATER_FREEZING_PALETTE = L("DATA_FD396E") & 0xffff;
const LOCKJAWS_LOCKER_PALETTE = L("lockjaws_locker_level_palette") & 0xffff;
const MINE_DEBRIS_TILES = L("DATA_80C963");
const LEAVES_TILES = L("DATA_80CCE8");
const LEAVES_BANK = (L("falling_leaves_tiledata") >> 16) & 0xff;
const HIVE_TILES_A = L("DATA_80CD5E");
const HIVE_TILES_B = L("DATA_80CD6E");
const LIGHT_SHAFT_HDMA = L("DATA_BBA35F") & 0xffff;
const LIGHT_SHAFT_TOPS = L("DATA_80D0B8");
const LIGHT_WINDOW_HDMA_EVEN = L("DATA_BBA40F") & 0xffff;
const LIGHT_WINDOW_HDMA_ODD = L("DATA_BBA408") & 0xffff;

/** 16-bit read of a bank-$80 table through the data bank (absolute addressing). */
const dbr16 = (addr16: number) => bus16(((reg.db & 0xff) << 16) | (addr16 & 0xffff));

const afc = () => r16(R.active_frame_counter);
const scrollX = () => r16(R.screen_scroll_x_position);
const scrollY = () => r16(R.screen_scroll_y_position);
const layerY = () => r16(RAM_17C2);
const paused = () => (r16(R.game_state_flags) & 0x0140) !== 0;

/** Two-write scroll register: low byte then high byte. */
function scroll(port: number, v: number) {
  io8(port, v & 0xff);
  io8(port, (v >> 8) & 0xff);
}
/** `STA port : STZ port` with 8-bit A: the low byte, then 0. */
function scroll8(port: number, v: number) {
  io8(port, v & 0xff);
  io8(port, 0);
}
function brightness() {
  io8(PPU.screen, r8(R.screen_brightness));
}
function startPendingDma() {
  io16(CPU.enable_dma, r16(R.pending_dma_hdma_channels));
}
/** The level uploads in the order of the sub modes that do not JSR dma_level_and_sprite_graphics. */
function levelUploads() {
  dma_queued_sprite_graphics();
  dma_level_columns();
  dma_level_rows();
  dma_queued_sprite_palette();
}
const clamp0 = (v: number) => (v & 0x8000 ? 0 : v & 0xffff);

/**
 * Fade a BGR555 colour towards black: subtract `amount` from each channel (red in $32, green
 * << 5 in $34, blue << 10 in $36) and clamp each at 0 (the palette pulses of the Krocodile Kore
 * glow, the castle torches and the forest lights).
 */
function setFadeAmounts(amount: number) {
  w16(0x32, amount);
  const t = (amount << 2) & 0xffff;
  w16(0x36, xba(t));
  w16(0x34, (t << 3) & 0xffff);
}
function fadeColour(c: number): number {
  w16(0x38, clamp0((c & 0x001f) - r16(0x32)));
  w16(0x38, r16(0x38) | clamp0((c & 0x03e0) - r16(0x34)));
  return clamp0((c & 0x7c00) - r16(0x36)) | r16(0x38);
}

// ---------------------------------------------------------------------------------------------
// Wasp hive

/** $80B79C — X = (X + 2) & $1E (A preserved): next entry of a 16-entry wave table. */
export function CODE_80B79C() {
  reg.x = (reg.x + 2) & 0x001e;
}

/**
 * $80B7A6 — Wasp Hive (Hornet Hole, Rambi Rumble, Parrot Chute Panic): animated honey tiles,
 * a wavy layer 1 (HDMA scroll table at $7E80D2, one bump of 8 lines up, 7 down) and parallax.
 */
export function wasp_hive_nmi_sub_mode() {
  dma_level_and_sprite_graphics();
  CODE_80CCF8();
  const sy = scrollY();
  w8(W + 0x80f2, (((sy & 1) ^ 1) + 1) & 0xff); // line count of the first band
  let x = (sy ^ 0xffff) & 0x001e;
  let a = ((((afc() ^ 0xffff) >> 2) + sy) & 0xffff);
  w16(W + 0x80d2 + x, a);
  for (let i = 0; i < 8; i++) {
    x = (x + 2) & 0x001e;
    a = (a + 1) & 0xffff;
    w16(W + 0x80d2 + x, a);
  }
  for (let i = 0; i < 7; i++) {
    x = (x + 2) & 0x001e;
    a = (a - 1) & 0xffff;
    w16(W + 0x80d2 + x, a);
  }
  reg.x = x;
  const sx = scrollX();
  scroll(PPU.layer_1_scroll_x, ((sx >> 2) + sx) & 0xffff);
  scroll(PPU.layer_2_scroll_x, sx);
  scroll8(PPU.layer_3_scroll_y, scrollY() >> 1);
  scroll8(PPU.layer_3_scroll_x, scrollX() >> 1);
  scroll8(PPU.layer_2_scroll_y, r8(RAM_17C2));
  brightness();
}

/**
 * $80CCF8 — honey tiles of the wasp hive: three tile groups, one per frame (frame & 3 = 0, 1,
 * 2), each with its own animation table; nothing on the fourth frame.
 */
export function CODE_80CCF8() {
  const t = afc();
  let dest: number, src: number, size: number;
  switch (t & 3) {
    case 0: {
      dest = 0x2010;
      const x = ((t >> 1) + 8) & 0x000e;
      src = rom16(HIVE_TILES_A + x);
      size = 0x0140;
      reg.x = x;
      break;
    }
    case 1:
    case 2: {
      dest = t & 1 ? 0x20b0 : 0x2100;
      const a = t & 1 ? t : (t + 0x20) & 0xffff;
      const x = (a >> 1) & 0x003e;
      src = rom16(HIVE_TILES_B + x);
      size = 0x00a0;
      break;
    }
    default:
      return;
  }
  io16(DMA.source, src);
  io16(DMA.unused_2, src);
  io16(PPU.vram_address, dest);
  io16(DMA.size, size);
  io16(DMA.settings, 0x1801);
  io8(DMA.source_bank, 0xf5);
  io8(CPU.enable_dma, 0x01);
  reg.x = size;
  reg.y = dest;
}

// ---------------------------------------------------------------------------------------------
// Water surface HDMA scroll values of the ship mast (water) and ice (water) levels

/** Write the scroll pairs of the four water HDMA entries ($7E80D2..$7E80E0), then CODE_80B8BD. */
function waterScrollTable(x: number) {
  w16(W + 0x80d2, x);
  w16(W + 0x80de, x);
  w16(W + 0x80d6, (x + 1) & 0xffff);
  w16(W + 0x80da, (x + 1) & 0xffff);
  const y = scrollY() >> 1;
  w16(W + 0x80d4, y);
  w16(W + 0x80d8, y);
  w16(W + 0x80dc, (y - 1) & 0xffff);
  w16(W + 0x80e0, (y - 1) & 0xffff);
  CODE_80B8BD();
}

/** $80B83D — Slime Climb: the water layer drifts with time at half the camera speed. */
export function CODE_80B83D() {
  waterScrollTable(((((afc() >> 1) + scrollX()) & 0xffff) >> 1) & 0xffff);
}

/** $80B86E — ice water levels: the water layer at a quarter of the camera speed. */
export function CODE_80B86E() {
  waterScrollTable(scrollX() >> 2);
}

// ---------------------------------------------------------------------------------------------
// Roller coaster

/**
 * $80BBD5 — Roller Coaster (Rickety Race, Target Terror): fireworks palette cycling (RAM_0929
 * = palette slot of the current firework), the firework flash (fixed colour) and parallax.
 */
export function roller_coaster_nmi_sub_mode() {
  dma_level_and_sprite_graphics();
  const slot = r16(0x0929);
  if (slot && (afc() & 7) === 0) {
    reg.y = slot;
    reg.a = (((afc() & 0x0018) << 2) + FIREWORKS_PALETTE) & 0xffff;
    reg.x = 0x0004;
    dma_palette();
  }
  io8(PPU.fixed_color, 0xe0);
  const flick = r8(R.firework_flicker_flag);
  w8(R.firework_flicker_flag, flick & 0xfe);
  if (flick & 1) io8(PPU.fixed_color, 0xe2);
  scroll8(PPU.layer_2_scroll_x, scrollX() >> 3);
  scroll(PPU.layer_1_scroll_x, scrollX());
  scroll(PPU.layer_1_scroll_y, layerY());
  brightness();
}

// ---------------------------------------------------------------------------------------------
// Forest

/** Common scroll of the forest sub modes: layer 2 follows the camera, layer 3 at half speed. */
function forestScroll() {
  scroll8(PPU.layer_3_scroll_x, scrollX() >> 1);
  scroll(PPU.layer_2_scroll_x, scrollX());
  scroll8(PPU.layer_2_scroll_y, r8(RAM_17C2));
  io8(PPU.layer_3_scroll_y, 0);
  io8(PPU.layer_3_scroll_y, 0);
  brightness();
}

/** $80BE9C — Forest (Lights, Ghostly Grove): light shafts. */
export function forest_lights_nmi_sub_mode() {
  dma_level_and_sprite_graphics();
  update_forest_light_shaft_effect();
  forestScroll();
}

/** $80BED2 — Forest (Windy, Gusty Glade): falling leaves. */
export function forest_windy_nmi_sub_mode() {
  dma_level_and_sprite_graphics();
  update_forest_leaves_effect();
  forestScroll();
}

/** $80C8FF — Forest (Misty, Web Woods): double-buffered mist HDMA tables. */
export function forest_misty_nmi_sub_mode() {
  startPendingDma();
  levelUploads();
  if (afc() & 1) {
    io16(HDMA.source + 0x10, 0x80f2);
    io16(HDMA.source + 0x20, 0x8012);
  } else {
    io16(HDMA.source + 0x10, 0x810a);
    io16(HDMA.source + 0x20, 0x85d2);
  }
  forestScroll();
}

/**
 * $80CFDC — light shafts of Ghostly Grove: the shaft HDMA table follows the vertical scroll,
 * the window of the light beams follows the screen's light position (DATA_80D0B8, one top per
 * screen), and colours $71.. are refreshed from the palette buffer.
 */
export function update_forest_light_shaft_effect() {
  const v = (((afc() >> 2) + scrollY()) & 0x0007);
  w16(0x32, v);
  io16(HDMA.source + 0x10, (v * 3 + LIGHT_SHAFT_HDMA) & 0xffff);
  const x = ((r16(R.screen_scroll_x_screen) & 0x00ff) - 1) & 0xffff;
  const top = rom8((LIGHT_SHAFT_TOPS + x) & 0xffffff);
  const a = (scrollY() - top) & 0xffff;
  w16(0x17c4, a);
  w16(0x17c6, (a - 1) & 0xffff);
  const h = clamp0((0x01c8 - a) & 0xffff);
  // 8-bit: line count of the two halves of the shaft (rounded up for the second)
  const half = (h & 0xff) >> 1;
  w8(W + 0x8332, half);
  const half2 = (half + (h & 1)) & 0xff;
  w8(W + 0x8335, half2);
  const q = half2 >> 1;
  w16(0x34, q);
  const left = clamp0((((scrollX() & 0xff) ^ 0xff) + 0x80 + q - 0x0160) & 0xffff);
  w8(W + 0x8333, left);
  w8(W + 0x8336, left);
  io16(HDMA.source + 0x20, afc() & 1 ? LIGHT_WINDOW_HDMA_ODD : LIGHT_WINDOW_HDMA_EVEN);
  let right = (((scrollX() & 0xff) ^ 0xff) + 0x80 - q + 0x30) & 0xffff;
  if (right >= 0x00ff) right = 0x00ff;
  w8(W + 0x8334, right);
  w8(W + 0x8337, right);
  io8(PPU.cgram_address, 0x71);
  const pal = R.primary_palette;
  io16(DMA.source, pal & 0xffff);
  io16(DMA.unused_2, pal & 0xffff);
  io16(DMA.size, 0x001e);
  io16(DMA.settings, 0x2200);
  io8(DMA.source_bank, (pal >> 16) & 0xff);
  io8(CPU.enable_dma, 0x01);
  reg.x = afc() & 1 ? LIGHT_WINDOW_HDMA_ODD : LIGHT_WINDOW_HDMA_EVEN;
}

/**
 * Wind wave HDMA table shared by the leaves and the mine debris: 15 entries of 3 bytes at
 * $7E8013 (DB = $7E in the original), the horizontal scroll per band taken from the sine table.
 */
function windWaveTable(extra: number) {
  let a = ((((r16(0x17c4) & 0xfff0) << 1) + afc()) << 1) & 0xffff;
  for (let y = 0; y !== 0x2d; y += 3) {
    const x = a & 0x01fe;
    const v = ((rom16(SINE + x) >> 2) + extra + scrollX()) & 0xffff;
    w16(W + 0x8013 + y, v);
    a = (x + 0x0040) & 0xffff;
  }
}

/**
 * $80CC36 — falling leaves of the windy forest / brambles: the leaf tiles animate every 4th
 * frame, the leaf layer drifts with the wind ($19BE) and waves (HDMA table at $7E8012).
 */
export function update_forest_leaves_effect() {
  if (paused()) return;
  const t = afc();
  if ((t & 3) === 0) {
    const x = (t >> 1) & 0x000e;
    io16(DMA.source, rom16(LEAVES_TILES + x));
    io16(DMA.size, 0x0220);
    io16(DMA.settings, 0x1801);
    io16(PPU.vram_address, 0x7010);
    io8(DMA.source_bank, LEAVES_BANK);
    io8(CPU.enable_dma, 0x01);
  }
  // CODE_80CC72: wind drift and the vertical wobble of the leaves
  w16(0x17c6, (r16(0x17c6) + r16(0x19be)) & 0xffff);
  const x = (afc() << 2) & 0x01fe;
  let a = ((rom16(SINE + x) >> 3) - afc()) & 0xffff;
  a = ((a >> 1) + scrollY()) & 0xffff;
  w16(0x17c4, a);
  windWaveTable(r16(0x17c7));
  reg.db = 0x80;
  const v = r8(0x17c4);
  scroll8(PPU.layer_1_scroll_y, v);
  scroll8(PPU.layer_2_scroll_y, v);
  w8(W + 0x8012, (((v ^ 0x0f) & 0x0f) + 1) & 0xff);
}

// ---------------------------------------------------------------------------------------------
// Swamp, brambles, jungle

/** $80BF08 — Swamp (Barrel Bayou, Krockhead Klamber, Mudhole Marsh): fog bands and parallax. */
export function swamp_nmi_sub_mode() {
  dma_level_and_sprite_graphics();
  let a = (scrollY() + r16(0x19ca)) & 0xffff;
  if (a >= 0x0080) a = 0x0080;
  w16(W + 0x8013, a);
  w16(W + 0x8019, clamp0((scrollY() + 0x5e - r16(0x0afe)) & 0xffff));
  scroll8(PPU.layer_3_scroll_x, scrollX() >> 1);
  // layer 1 at double speed: (x << 1) with the top bit of the sub-pixel position
  scroll(PPU.layer_1_scroll_x, ((scrollX() << 1) | (r16(R.screen_scroll_x_sub_position_low) >> 15)) & 0xffff);
  scroll(PPU.layer_2_scroll_x, scrollX());
  scroll8(PPU.layer_2_scroll_y, r8(RAM_17C2));
  scroll8(PPU.layer_3_scroll_y, ((layerY() - 0x0120) & 0xffff) >> 2);
  brightness();
}

/** Brambles scroll: drifting layer 3 clouds, layer 2 at half speed. */
function bramblesScroll(withLayer2Y: boolean) {
  scroll8(PPU.layer_3_scroll_x, ((scrollX() + afc()) & 0xffff) >> 2);
  scroll(PPU.layer_1_scroll_x, scrollX());
  scroll8(PPU.layer_2_scroll_x, scrollX() >> 1);
  scroll8(PPU.layer_3_scroll_y, layerY() >> 2);
  scroll8(PPU.layer_1_scroll_y, r8(RAM_17C2));
  if (withLayer2Y) scroll8(PPU.layer_2_scroll_y, layerY() >> 1);
  brightness();
}

/** $80BF82 — Brambles (Bramble Blast, Bramble Scramble, Screech's Sprint, ...). */
export function brambles_nmi_sub_mode() {
  dma_level_and_sprite_graphics();
  bramblesScroll(true);
}

/** $80C847 — Brambles (Windy, Animal Antics Squawks area): leaves blown by the wind. */
export function brambles_windy_nmi_sub_mode() {
  startPendingDma();
  levelUploads();
  update_forest_leaves_effect();
  bramblesScroll(false);
}

/** $80C750 — Jungle (Jungle Jinx, Animal Antics): three-layer parallax. */
export function jungle_nmi_sub_mode() {
  startPendingDma();
  levelUploads();
  scroll(PPU.layer_1_scroll_x, scrollX());
  scroll8(PPU.layer_1_scroll_y, r8(RAM_17C2));
  scroll8(PPU.layer_2_scroll_x, scrollX() >> 1);
  scroll8(PPU.layer_3_scroll_x, scrollX() >> 2);
  scroll(PPU.layer_2_scroll_y, ((scrollY() >> 1) - 0x0040) & 0xffff);
  scroll8(PPU.layer_3_scroll_y, ((scrollY() - 0x0080) & 0xffff) >> 2);
  brightness();
}

// ---------------------------------------------------------------------------------------------
// Krocodile Kore

/**
 * $80C074 — Krocodile Kore: while $06A5 bit 9 is set the glow palette (colours 1-15) pulses,
 * the beam tiles animate every 8th frame (with a smaller sprite DMA budget on the frames
 * around the upload), layer 2 is offset by $80.
 */
export function krocodile_kore_nmi_sub_mode() {
  dma_level_and_sprite_graphics();
  if (r16(0x06a5) & 0x0200) {
    io8(PPU.cgram_address, 0x01);
    let v = (afc() >> 2) & 0x001f;
    if (v & 0x0010) v ^= 0x001f;
    const acc = (v + r16(0x84)) & 0xffff;
    w16(0x84, acc);
    let amount = (acc >> 1) & 0x003f;
    if (amount & 0x0020) amount ^= 0x003f;
    setFadeAmounts(amount);
    for (let x = 0; x !== 0x1e; x += 2) {
      const c = fadeColour(rom16(KORE_GLOW_PALETTE + x));
      io8(PPU.cgram_write, c & 0xff);
      io8(PPU.cgram_write, (c >> 8) & 0xff);
      reg.x = x + 2;
    }
  }
  // CODE_80C0FB: beam tiles
  io16(PPU.vram_address, 0x7010);
  const t = afc();
  if ((t & 7) === 0) {
    const x = ((t >> 2) & 0x000e) ^ 0x000e;
    const src = dbr16(KORE_BEAM_TILES + x);
    io16(DMA.source + 0x10, src);
    io16(DMA.unused_2 + 0x10, src);
    io16(DMA.size + 0x10, 0x09a0);
    io16(DMA.settings + 0x10, 0x1801);
    io8(DMA.source_bank + 0x10, 0xf3);
    io8(CPU.enable_dma, 0x02);
    reg.x = x;
    w16(R.sprite_dma_buffer_limit, r16(RAM_0B00));
  } else if (((t + 1) & 7) === 0) {
    w16(R.sprite_dma_buffer_limit, 0x0004); // the beam uploads next frame: few sprite tiles
  } else {
    w16(R.sprite_dma_buffer_limit, r16(RAM_0B00));
  }
  scroll(PPU.layer_1_scroll_x, scrollX());
  scroll(PPU.layer_2_scroll_x, (scrollX() + 0x0080) & 0xffff);
  scroll8(PPU.layer_1_scroll_y, r8(RAM_17C2));
  scroll8(PPU.layer_2_scroll_y, r8(RAM_17C2));
  brightness();
}

/** $80C17A — A = 0 if the last result was negative. */
export function CODE_80C17A() {
  if (reg.a & 0x8000) reg.a = 0;
}

// ---------------------------------------------------------------------------------------------
// K. Rool duel

/** $80C584 — K. Rool Duel: layer 2 offset by $80, layer 3 scrolls with time. */
export function krool_duel_nmi_sub_mode() {
  startPendingDma();
  levelUploads();
  scroll(PPU.layer_1_scroll_x, scrollX());
  scroll(PPU.layer_2_scroll_x, (scrollX() + 0x0080) & 0xffff);
  scroll8(PPU.layer_1_scroll_y, r8(RAM_17C2));
  scroll8(PPU.layer_2_scroll_y, r8(RAM_17C2));
  brightness();
  scroll(PPU.layer_3_scroll_x, (afc() + scrollX()) & 0xffff);
}

// ---------------------------------------------------------------------------------------------
// Castle

/** $80C180 — Castle (Castle Crush, Chain Link Chamber, Stronghold Showdown, ...). */
export function castle_nmi_sub_mode() {
  startPendingDma();
  CODE_80B89C();
  levelUploads();
  CODE_80CA1B();
  CODE_80C1A9();
  brightness();
}

/** $80C821 — Castle (Toxic, Toxic Tower): water surface and torches. */
export function castle_toxic_nmi_sub_mode() {
  startPendingDma();
  CODE_80B89C();
  levelUploads();
  CODE_80C1A9();
  brightness();
}

/**
 * $80C1A9 — castle torches (not while paused / ending): every 4th frame upload the next of 6
 * flame frames (with the normal sprite DMA budget; the frame before gets a smaller one), and
 * every frame flicker the torch light colours $68-$6F.
 */
export function CODE_80C1A9() {
  if (paused()) return;
  const t = afc();
  if ((t & 3) === 0) {
    let f = (r16(0x091d) + 1) & 0xffff;
    if (f >= 0x0006) f = 0;
    w16(0x091d, f);
    io16(PPU.vram_address, 0x2010);
    reg.x = (f << 1) & 0xffff;
    reg.a = rom16(CASTLE_TORCH_TILES + reg.x);
    reg.y = 0x0380;
    reg.x = CASTLE_TORCH_BANK;
    dma_to_vram_global();
    w16(R.sprite_dma_buffer_limit, r16(RAM_0B00));
  } else if (((t + 1) & 3) === 0) {
    w16(R.sprite_dma_buffer_limit, 0x0014);
  }
  // CODE_80C1F0: flicker 0, 1, 2, 1
  let v = (afc() >> 2) & 0x0003;
  if (v & 0x0002) v = ((v ^ 0x0003) + 1) & 0xffff;
  setFadeAmounts(v);
  io8(PPU.cgram_address, 0x68);
  for (let x = 0; x !== 0x10; x += 2) {
    const c = fadeColour(rom16(CASTLE_TORCH_PALETTE + x));
    io8(PPU.cgram_write, c & 0xff);
    io8(PPU.cgram_write, (c >> 8) & 0xff);
    reg.x = x + 2;
  }
}

/**
 * $80CA1B — castle water / lava level ($0D54): layer 3 vertical scroll and the surface HDMA
 * line counts (clamped at $38 lines below the top), and the horizontal scroll values of the
 * surface bands ($7E884C/$7E884F = 7/8 speed, $7E8852 = 9/8 speed).
 */
export function CODE_80CA1B() {
  let a = (r16(0x0d54) - scrollY()) & 0xffff;
  if (a >= 0x0038) a = 0x0038;
  w16(0x32, a);
  scroll8(PPU.layer_3_scroll_y, (a ^ 0x00ff) & 0xff);
  const lines = (r8(0x32) + 0x44) & 0xff;
  w8(W + 0x80e5, lines);
  w8(W + 0x8834, lines);
  w8(W + 0x884e, lines);
  const sx = scrollX();
  const slow = (((sx >> 3) ^ 0xffff) + sx) & 0xffff;
  w16(W + 0x884c, slow);
  w16(W + 0x884f, slow);
  // (x:sub) >> 3 as a 32-bit value, added to (x:sub)
  const sub = r16(R.screen_scroll_x_sub_position_low);
  const lo = ((((sx & 7) << 16) | sub) >>> 3) & 0xffff;
  const hi = sx >> 3;
  w16(0x32, hi);
  const carry = lo + sub > 0xffff ? 1 : 0;
  w16(W + 0x8852, (hi + sx + carry) & 0xffff);
}

// ---------------------------------------------------------------------------------------------
// Haunted

/**
 * $80C26B — Haunted (Haunted Hall): Kackle's tiles, the ghost layer (layer 2) placed on the
 * sprite at $0D5A (the "screen" layer config comes from that sprite), and the window HDMA
 * edges ($7E8012/$7E8014) chosen by the layer's vertical position.
 */
export function haunted_nmi_sub_mode() {
  dma_level_and_sprite_graphics();
  update_kackle_graphics();
  const s = r16(0x0d5a);
  let a = 0x0100;
  if (s) {
    io16(PPU.screens, r16((s + 0x12) & 0xffff));
    a = (scrollX() - r16((s + 0x06) & 0xffff) + 0x0080) & 0xffff;
  }
  scroll(PPU.layer_2_scroll_x, a);
  a = (layerY() - r16((s + 0x0a) & 0xffff) + 0x0040) & 0xffff;
  scroll8(PPU.layer_2_scroll_y, a);
  let x: number, y: number;
  if (!((a - 0x00a0) & 0x8000)) {
    x = 0xff60;
    y = 0xff60;
  } else if (!((a - 0x0020) & 0x8000)) {
    x = 0x0060;
    y = 0xff60;
  } else if ((a - 0xffa0) & 0x8000) {
    x = 0xff60;
    y = 0x0060;
  } else {
    x = 0x0060;
    y = 0x0060;
  }
  w16(W + 0x8012, x);
  w16(W + 0x8014, y);
  scroll(PPU.layer_3_scroll_x, scrollX() >> 1);
  scroll(PPU.layer_1_scroll_x, scrollX());
  scroll8(PPU.layer_3_scroll_y, ((layerY() - 0x0100) & 0xffff) >> 3);
  scroll8(PPU.layer_1_scroll_y, r8(RAM_17C2));
  brightness();
  reg.x = x;
  reg.y = y;
}

/** $80C31D — long wrapper (the ending parade). */
export function update_kackle_graphics_global() {
  update_kackle_graphics();
}

/** $80C321 — on even frames upload Kackle's two tile groups (two animation tables). */
export function update_kackle_graphics() {
  const t = afc();
  if (t & 1) return;
  kackleDma(0x7010, rom16(KACKLE_TILES_A + ((t >> 1) & 0x007e)), 0x0300, KACKLE_BANK_A);
  kackleDma(0x7190, rom16(KACKLE_TILES_B + ((t >> 1) & 0x001e)), 0x0380, KACKLE_BANK_B);
  reg.x = 0x0380;
  reg.y = 0x7190;
}
function kackleDma(dest: number, src: number, size: number, bank: number) {
  io16(DMA.source + 0x10, src);
  io16(DMA.unused_2 + 0x10, src);
  io16(PPU.vram_address, dest);
  io16(DMA.size + 0x10, size);
  io16(DMA.settings + 0x10, 0x1801);
  io8(DMA.source_bank + 0x10, bank);
  io8(CPU.enable_dma, 0x02);
}

// ---------------------------------------------------------------------------------------------
// Ship mast (water), ice

/** $80C466 — Ship Mast (Water, Slime Climb): rising water surface, flag. */
export function ship_mast_water_nmi_sub_mode() {
  startPendingDma();
  CODE_80B83D();
  levelUploads();
  update_ship_mast_flag_graphics();
  scroll8(PPU.layer_2_scroll_y, layerY() >> 1);
  scroll8(PPU.layer_1_scroll_y, r8(RAM_17C2));
  brightness();
}

/**
 * $80C65B — Ice (Water, Arctic Abyss / Clapper's Cavern): RAM_0915 is the freeze timer set by
 * Clapper, RAM_0917 the current freeze; the freeze whitens the backdrop colour (RAM_0913) and
 * selects the water palette (thawed / freezing / frozen).
 */
export function ice_water_nmi_sub_mode() {
  startPendingDma();
  CODE_80B86E();
  levelUploads();
  scroll8(PPU.layer_2_scroll_x, scrollX() >> 1);
  scroll8(PPU.layer_2_scroll_y, layerY() >> 1);
  if (!paused()) {
    if (r16(RAM_0915)) w16(RAM_0915, (r16(RAM_0915) - 1) & 0xffff);
    const target = r16(RAM_0915);
    const cur = r16(RAM_0917);
    if (target !== cur) {
      if (target < cur) {
        w16(RAM_0917, (cur - 1) & 0xffff);
      } else {
        const step = target - cur >= 4 ? 4 : 1;
        let v = (step + cur) & 0xffff;
        if (v === 0x0040) v = 0x00b4;
        w16(RAM_0917, v);
      }
    }
  }
  // CODE_80C6CA: freeze level 0..$1C
  let a = r16(RAM_0917);
  if (a >= 0x003f) a = (clamp0((a - 0x00b4) & 0xffff) + 0x003f) & 0xffff;
  a >>= 2;
  if (a >= 0x001c) a = 0x001c;
  w16(0x32, a);
  w16(0x36, a);
  w16(0x34, a);
  w16(0x36, r16(0x36) | ((xba(clamp0(a)) << 2) & 0xffff));
  const col = ((clamp0(a) << 5) | r16(0x36)) & 0xffff;
  w16(RAM_0913, col);
  let pal = WATER_FROZEN_PALETTE;
  if (a < 0x0014) {
    pal = WATER_FREEZING_PALETTE;
    if (a < 0x000c) pal = LOCKJAWS_LOCKER_PALETTE;
  }
  reg.y = 0;
  reg.a = pal;
  reg.x = 0x0004;
  dma_palette();
  io8(PPU.cgram_address, 0);
  io8(PPU.cgram_write, r8(RAM_0913));
  io8(PPU.cgram_write, r8(RAM_0913 + 1));
  brightness();
}

/** $80C7C6 — Ice (Transparent, Black Ice Battle / bonus rooms): wavy ice layer. */
export function ice_transparent_nmi_sub_mode() {
  startPendingDma();
  levelUploads();
  update_ice_distortion_effect();
  scroll(PPU.layer_1_scroll_x, scrollX());
  scroll8(PPU.layer_1_scroll_y, r8(RAM_17C2));
  scroll8(PPU.layer_2_scroll_x, scrollX() >> 1);
  const v = (layerY() >> 1) & 0xff;
  scroll8(PPU.layer_2_scroll_y, v);
  scroll8(PPU.layer_3_scroll_y, (v + 4) & 0xff);
  brightness();
}

/**
 * $80CA7E — ice distortion: an 8-entry HDMA table of layer 3 horizontal scroll values at
 * $7E8012 (half camera speed + 4, offsets 0 1 2 2 1 0 -1 -1) rotating with the camera.
 */
export function update_ice_distortion_effect() {
  let x = (scrollX() >> 2) & 0x000e;
  const base = ((scrollX() >> 1) + 4) & 0xffff;
  w16(0x32, base);
  const wave = [0, 1, 2, 2, 1, 0, -1, -1];
  for (let i = 0; i < 8; i++) {
    w16(W + 0x8012 + x, (base + wave[i]) & 0xffff);
    if (i < 7) x = (x + 2) & 0x000e;
  }
  reg.x = x;
}

/** $80CADD — X = (X + 2) & $0E. */
export function CODE_80CADD() {
  reg.x = (reg.x + 2) & 0x000e;
  reg.a = reg.x;
}

// ---------------------------------------------------------------------------------------------
// Mine (windy)

/** $80C8AA — Mine (Windy, Windy Well): blowing debris. */
export function mine_windy_nmi_sub_mode() {
  startPendingDma();
  levelUploads();
  update_mine_debris_effect();
  scroll8(PPU.layer_2_scroll_x, scrollX() >> 2);
  scroll(PPU.layer_1_scroll_x, scrollX());
  scroll(PPU.layer_1_scroll_y, layerY());
  scroll8(PPU.layer_2_scroll_y, layerY() >> 2);
  brightness();
}

/**
 * $80C973 — debris of Windy Well: the debris layer (layer 3) rises with the wind ($19BE),
 * waves (HDMA table at $7E8012) and its tiles animate on odd frames.
 */
export function update_mine_debris_effect() {
  if (paused()) return;
  w16(0x17c6, (r16(0x17c6) + r16(0x19be)) & 0xffff);
  const x = (afc() << 2) & 0x01fe;
  w16(0x17c4, ((rom16(SINE + x) >> 4) + r16(0x17c7) + scrollY()) & 0xffff);
  windWaveTable(0);
  reg.db = 0x80;
  const v = r8(0x17c4);
  scroll8(PPU.layer_3_scroll_y, v);
  w8(W + 0x8012, (((v ^ 0x0f) & 0x0f) + 1) & 0xff);
  const t = afc();
  if (t & 1) {
    const i = t & 0x000e;
    io16(DMA.source, rom16(MINE_DEBRIS_TILES + i));
    io16(DMA.size, 0x0120);
    io16(DMA.settings, 0x1801);
    io16(PPU.vram_address, 0x5008);
    io8(DMA.source_bank, 0xf3);
    io8(CPU.enable_dma, 0x01);
    reg.x = i;
  }
}

// these are entered with JSR (nmi_sub_mode_table / JSR): the generated stubs may guess RTL
for (const t of [
  "CODE_80B79C",
  "wasp_hive_nmi_sub_mode",
  "CODE_80CCF8",
  "CODE_80B83D",
  "CODE_80B86E",
  "roller_coaster_nmi_sub_mode",
  "forest_lights_nmi_sub_mode",
  "forest_windy_nmi_sub_mode",
  "forest_misty_nmi_sub_mode",
  "update_forest_light_shaft_effect",
  "update_forest_leaves_effect",
  "swamp_nmi_sub_mode",
  "brambles_nmi_sub_mode",
  "brambles_windy_nmi_sub_mode",
  "jungle_nmi_sub_mode",
  "krocodile_kore_nmi_sub_mode",
  "CODE_80C17A",
  "krool_duel_nmi_sub_mode",
  "castle_nmi_sub_mode",
  "castle_toxic_nmi_sub_mode",
  "CODE_80C1A9",
  "CODE_80CA1B",
  "haunted_nmi_sub_mode",
  "update_kackle_graphics",
  "ship_mast_water_nmi_sub_mode",
  "ice_water_nmi_sub_mode",
  "ice_transparent_nmi_sub_mode",
  "update_ice_distortion_effect",
  "CODE_80CADD",
  "mine_windy_nmi_sub_mode",
  "update_mine_debris_effect",
])
  setRetMode(L(t), RET_RTS);
setRetMode(L("update_kackle_graphics_global"), RET_RTL);

register({
  CODE_80B79C,
  wasp_hive_nmi_sub_mode,
  CODE_80CCF8,
  CODE_80B83D,
  CODE_80B86E,
  roller_coaster_nmi_sub_mode,
  forest_lights_nmi_sub_mode,
  forest_windy_nmi_sub_mode,
  forest_misty_nmi_sub_mode,
  update_forest_light_shaft_effect,
  update_forest_leaves_effect,
  swamp_nmi_sub_mode,
  brambles_nmi_sub_mode,
  brambles_windy_nmi_sub_mode,
  jungle_nmi_sub_mode,
  krocodile_kore_nmi_sub_mode,
  CODE_80C17A,
  krool_duel_nmi_sub_mode,
  castle_nmi_sub_mode,
  castle_toxic_nmi_sub_mode,
  CODE_80C1A9,
  CODE_80CA1B,
  haunted_nmi_sub_mode,
  update_kackle_graphics_global,
  update_kackle_graphics,
  ship_mast_water_nmi_sub_mode,
  ice_water_nmi_sub_mode,
  ice_transparent_nmi_sub_mode,
  update_ice_distortion_effect,
  CODE_80CADD,
  mine_windy_nmi_sub_mode,
  update_mine_debris_effect,
});
