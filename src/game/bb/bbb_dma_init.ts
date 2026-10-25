/**
 * Bank $BB (part b) — the remaining level HDMA setups ("dma init" routines, see bba_dma_init.ts
 * for the format) and the initial water / moving-floor height of the levels that have one.
 */
import { r16, w16, rom8, rom16, io8, io16 } from "../../core/mem";
import { reg, register } from "../../core/cpu";
import { setRetMode, RET_RTS } from "../../core/hybrid";
import { L, R, C, level, HDMA } from "../../core/sym";
import {
  set_default_sprite_dma_buffer_size,
  spawn_no_gfx_special_sprite_address,
  spawn_special_sprite_index,
  handle_ship_deck_sunset_global,
} from "../../gen/routines";

/** Program HDMA channel `ch` (indirect = null leaves $43x7 alone). */
function hdma(ch: number, settings: number, source: number, bank: number, indirect: number | null) {
  const base = ch * 0x10;
  io16(HDMA.settings + base, settings);
  io16(HDMA.source + base, source);
  io8(HDMA.source_bank + base, bank);
  if (indirect !== null) io8(HDMA.indirect_source_bank + base, indirect);
  reg.x = source;
}
const enable = (mask: number) => {
  reg.a = mask;
  w16(R.pending_dma_hdma_channels, mask);
};
/** 16-bit store to bank $7E (the tables overlap: write order matters). */
const st = (addr: number, v: number) => w16(0x7e0000 | addr, v);
const BUBBLES = L("DATA_FF0FD2") & 0xffff;

function spawnBubbles() {
  reg.y = BUBBLES;
  spawn_no_gfx_special_sprite_address(); // water bubbles
}

/** Water surface wobble lines ($7E8872+): X = offset. */
function surfaceLoop(x: number) {
  do {
    st(0x8872 + x, 0x0004);
    st(0x8873 + x, 0x00b6);
    st(0x8875 + x, 0x0004);
    st(0x8876 + x, 0x00ba);
    st(0x8878 + x, 0x0004);
    st(0x8879 + x, 0x00be);
    st(0x887b + x, 0x0004);
    st(0x887c + x, 0x00c2);
    x = (x + 0x0c) & 0xffff;
  } while (x !== 0x00a8);
  st(0x8872 + x, 0x0000);
  reg.x = x;
}
/** Underwater lines ($7E8018+): X = offset. */
function linesLoop(x: number) {
  do {
    st(0x8018 + x, 0x0008);
    st(0x8019 + x, 0x80d2);
    st(0x801b + x, 0x0008);
    st(0x801c + x, 0x80d6);
    st(0x801e + x, 0x0008);
    st(0x801f + x, 0x80da);
    st(0x8021 + x, 0x0008);
    st(0x8022 + x, 0x80de);
    x = (x + 0x0c) & 0xffff;
  } while (x !== 0x00a8);
  st(0x8018 + x, 0x0000);
  reg.x = x;
}

/** $BBA477 — (loop entry of dma_init_06) X = offset: rest of dma_init_06. */
export function CODE_BBA477() {
  surfaceLoop(reg.x & 0xffff);
  st(0x8012, 0x0040);
  st(0x8013, 0x80d2);
  st(0x8015, 0x0040);
  st(0x8016, 0x80d2);
  CODE_BBA4E0_from(0);
}

/** $BBA4E0 — (loop entry of dma_init_06) X = offset. */
export function CODE_BBA4E0() {
  CODE_BBA4E0_from(reg.x & 0xffff);
}
function CODE_BBA4E0_from(x: number) {
  linesLoop(x);
  hdma(6, 0x2c00, 0x80e2, 0x7e, 0x7e);
  hdma(2, 0x0d43, 0x886c, 0x7e, 0x7e);
  hdma(3, 0x0f43, 0x8012, 0x7e, 0x7e);
  hdma(4, 0x1142, 0x884b, 0x7e, 0x7e);
  hdma(7, 0x1202, 0x8832, 0x7e, 0);
  w16(R.water_y_position, 0x1680);
  init_level_water_height();
  spawnBubbles();
  enable(0xdc01);
}

/** $BBA5A9 — no HDMA; boss levels get a bigger sprite DMA budget. */
export function dma_init_05() {
  reg.a = r16(level.type);
  if (reg.a === C.boss_level_type) return CODE_BBA5BD();
  w16(R.sprite_dma_buffer_limit, 0x001c);
  enable(0x0001);
}

/** $BBA5BD */
export function CODE_BBA5BD() {
  w16(R.sprite_dma_buffer_limit, 0x0024);
  enable(0x0001);
}

/** $BBA5C9 */
export function dma_init_0C() {
  set_default_sprite_dma_buffer_size();
  CODE_BBA662();
}

/** $BBA5D0 — ship deck at sunset: the sunset controller and the sky palette. */
export function dma_init_17() {
  reg.y = C.special_sprite_spawn_id_0002;
  spawn_special_sprite_index();
  CODE_BBA5E1();
  dma_init_04();
}

/** $BBA5DA */
export function dma_init_04() {
  set_default_sprite_dma_buffer_size();
  CODE_BBA662();
}

/** $BBA5E1 — Gangplank Galley bonus 2 computes the sunset palette as if scrolled to $1C31. */
export function CODE_BBA5E1() {
  reg.a = r16(R.level_number);
  if (reg.a !== C.level_gangplank_galley_bonus_2) return CODE_BBA605();
  const sx = r16(R.screen_scroll_x_position);
  const v911 = r16(0x0911);
  w16(0x0911, 0);
  w16(R.screen_scroll_x_position, 0x1c31);
  CODE_BBA605();
  w16(0x0911, v911);
  reg.a = sx;
  w16(R.screen_scroll_x_position, sx);
}

/** $BBA605 — load the galley base palette (r,g,b words) and build the first sunset palette. */
export function CODE_BBA605() {
  w16(0x0911, 0x0100);
  const src = L("DATA_FD334E");
  for (let x = 0x02fe; x >= 0; x -= 2) w16(R.working_palette + x, rom16(src + x));
  // DB = $7E: pack the channel words into BGR555
  let x = 0;
  for (let y = 0; y !== 0x0100; y += 2) {
    const r = r16(R.working_palette + x);
    const red = (((r >> 8) | (r << 8)) & 0xffff) & 0x001f;
    w16(0x34, red);
    w16(0x34, r16(0x34) | (r16(0x7e892a + x) & 0x03e0));
    const v = (r16(0x7e892c + x) & 0x7c00) | r16(0x34);
    w16(R.primary_palette + y, v);
    x += 6;
  }
  reg.x = x;
  reg.y = 0x0100;
  reg.db = 0xbb;
  CODE_BBA64F();
}

/** $BBA64F — run the sunset update until it settles. */
export function CODE_BBA64F() {
  do {
    w16(0x0913, 0);
    handle_ship_deck_sunset_global();
  } while (r16(0x0913) !== 0);
  reg.a = 0x0001;
  w16(0x0913, 0x0001);
}

const SUNSET_TABLE = L("DATA_BBA6D3");

/** $BBA662 — ship deck: brightness/colour gradient tables on channels 1-2. */
export function CODE_BBA662() {
  st(0x8012, 0x0018);
  st(0x8013, 0x0000);
  st(0x8015, 0x0018);
  st(0x8016, 0x0000);
  st(0x8018, 0x0038);
  st(0x8019, 0x0000);
  st(0x8012 + 9, 0x00ff);
  st(0x8013 + 9, 0x0001);
  hdma(1, 0x0f02, 0x8012, 0x7e, 0);
  hdma(2, 0x3200, SUNSET_TABLE & 0xffff, (SUNSET_TABLE >> 16) & 0xff, 0);
  enable(0x0601);
}

/** Glimmer's Galleon light gradient ($7E80F9 + x, x = 0..$E1). */
function lightRamp(x0: number) {
  for (let x = x0; x !== 0x00e2; x++) {
    let a = (x << 1) & 0xffff;
    if (!(a & 0x0100)) a ^= 0x00ff;
    a = (a & 0x00ff) + 0x0030;
    if (a >= 0x00ff) a = 0x00ff;
    st(0x80f9 + x, a);
  }
  reg.x = 0x00e2;
}

/** $BBA726 — Glimmer's Galleon: water plus the light around Glimmer. */
export function dma_init_11() {
  set_default_sprite_dma_buffer_size();
  waterWindow();
  st(0x886c, 0x0040);
  st(0x886d, 0x00b6);
  st(0x886f, 0x0040);
  st(0x8870, 0x00b6);
  CODE_BBA78E_from(0);
}
function waterWindow() {
  st(0x80d2, 0x0078);
  st(0x80d3, 0x0000);
  st(0x80d5, 0x20c4);
  st(0x80d7, 0x0001);
  st(0x80d8, 0x0000);
  st(0x80da, 0x20c4);
  st(0x80dc, 0x0001);
  st(0x80dd, 0x0000);
  st(0x80df, 0x14a0);
  st(0x80e1, 0x0000);
}

/** $BBA78E — (loop entry of dma_init_11) X = offset. */
export function CODE_BBA78E() {
  CODE_BBA78E_from(reg.x & 0xffff);
}
function CODE_BBA78E_from(x: number) {
  surfaceLoop(x);
  st(0x80f2, 0x00f0);
  st(0x80f3, 0x80f9);
  st(0x80f5, 0x00f0);
  st(0x80f6, 0x8169);
  st(0x80f8, 0x0000);
  lightRamp(0);
  glimmerTail();
}
function glimmerTail() {
  const pal = rom16(L("glimmers_galleon_level_palette"));
  st(0x8832, 0x006f);
  st(0x8833, 0x0000);
  st(0x8835, pal);
  st(0x8837, 0x006f);
  st(0x8838, 0x0000);
  st(0x883a, pal);
  st(0x883c, 0x0001);
  st(0x883d, 0x0000);
  st(0x883f, 0x0000);
  hdma(1, 0x0d43, 0x886c, 0x7e, 0);
  hdma(2, 0x2640, 0x80f2, 0x7e, 0x80);
  hdma(3, 0x2103, 0x8832, 0x7e, 0x7e);
  hdma(5, 0x0f03, 0x8552, 0x7e, 0);
  hdma(6, 0x0800, 0x8812, 0x7e, 0);
  init_level_water_height();
  spawnBubbles();
  enable(0x6e01);
}

/** $BBA7FE — (loop entry of dma_init_11) X = index into the light ramp. */
export function CODE_BBA7FE() {
  lightRamp(reg.x & 0xffff);
  glimmerTail();
}

/** $BBA8DD */
export function set_default_sprite_dma_buffer_size_() {
  reg.a = 0x002c;
  w16(R.sprite_dma_buffer_limit, 0x002c);
}

/** $BBA8E3 */
export function dma_init_19() {
  dma_init_13();
  reg.a = 0x03e0;
  w16(0x0911, 0x0000);
  w16(0x0913, 0x03e0);
}

/** $BBA8F3 — toxic tower style: no water, three-band colour window. */
export function dma_init_20() {
  set_default_sprite_dma_buffer_size();
  CODE_BBA9F7();
  w16(R.water_y_position, 0x7fff);
  enable(0x7e01);
  st(0x80e2, 0x007c);
  st(0x80e3, 0x0211);
  st(0x80e5, 0x0050);
  st(0x80e6, 0x0215);
  st(0x80e8, 0x0001);
  st(0x80e9, 0x0314);
  st(0x80eb, 0x0000);
  st(0x8832, 0x006c);
  st(0x8833, 0x0020);
  st(0x8834, 0x0050);
  st(0x8835, 0x0020);
  st(0x8836, 0x0010);
  st(0x8837, 0x0060);
  st(0x8838, 0x0001);
  st(0x8839, 0x0020);
  st(0x883a, 0x0000);
  st(0x884b, 0x007c);
  st(0x884e, 0x0050);
  st(0x8851, 0x0001);
  st(0x8854, 0x0000);
  hdma(2, 0x3100, 0x8832, 0x7e, 0);
  hdma(3, 0x2c01, 0x80e2, 0x7e, 0);
  hdma(4, 0x1102, 0x884b, 0x7e, 0);
}

/** $BBA9D2 */
export function dma_init_12() {
  dma_init_13();
  st(0x8865, L("DATA_8081E0") & 0xffff);
  init_level_water_height();
}

/** $BBA9E0 — water levels with a moving surface. */
export function dma_init_13() {
  set_default_sprite_dma_buffer_size();
  CODE_BBA9F7();
  init_level_water_height();
  spawnBubbles();
  enable(0xfe01);
}

/** $BBA9F7 — the tables and channels of the moving-water levels. */
export function CODE_BBA9F7() {
  waterWindow();
  st(0x80e2, 0x007f);
  st(0x80e3, 0x0007);
  st(0x80e4, 0x0008);
  st(0x80e5, 0x0007);
  st(0x80e6, 0x0030);
  st(0x80e7, 0x0005);
  st(0x80e8, 0x0001);
  st(0x80e9, 0x0004);
  st(0x80ea, 0x0000);
  st(0x80f2, 0x002c);
  st(0x80f3, 0x0000);
  st(0x80f5, 0x001e);
  st(0x80f6, 0x0000);
  st(0x80f8, 0x0026);
  st(0x80f9, 0x0000);
  st(0x80f2 + 9, 0x00ff);
  st(0x80f3 + 9, 0x0001);
  st(0x8864, 0x00f8);
  st(0x8865, L("DATA_808000") & 0xffff);
  st(0x8867, 0x0001);
  st(0x8868, 0x0911);
  st(0x886a, 0x0000);
  w16(0x0911, 0x0000);
  w16(0x0913, 0x1440);
  st(0x886c, 0x0040);
  st(0x886d, 0x00b6);
  st(0x886f, 0x0040);
  st(0x8870, 0x00b6);
  CODE_BBAB05_from(0);
}

/** $BBAB05 — (loop entry of CODE_BBA9F7) X = offset. */
export function CODE_BBAB05() {
  CODE_BBAB05_from(reg.x & 0xffff);
}
function CODE_BBAB05_from(x: number) {
  surfaceLoop(x);
  hdma(1, 0x0d43, 0x886c, 0x7e, 0x7e);
  hdma(2, 0x2143, 0x8864, 0x7e, 0x80); // indirect bank of DATA_808000/DATA_8081E0
  hdma(3, 0x2c00, 0x80e2, 0x7e, 0);
  hdma(4, 0x1142, 0x884b, 0x7e, 0x7e);
  hdma(5, 0x0f03, 0x8552, 0x7e, 0);
  hdma(6, 0x0800, 0x8812, 0x7e, 0);
  hdma(7, 0x1202, 0x8832, 0x7e, 0);
}

const WATER_LEVELS = L("water_height_levels_table"); // (level, index) byte pairs, ascending
const WATER_HEIGHTS = L("water_height_data_table");

/** $BBABE2 — the level's starting water height (by level and entrance), if it has water. */
export function init_level_water_height() {
  w16(R.water_y_position, (r16(R.screen_scroll_y_position) + 0x0020) & 0xffff);
  const lvl = (r16(R.level_number) - 1) & 0xff;
  let x = 0;
  while (lvl >= rom8(WATER_LEVELS + x)) x += 2;
  // EOR #$FF / ADC (carry clear): zero only if the entry is our level
  if (((rom8(WATER_LEVELS + x) + (lvl ^ 0xff)) & 0xff) !== 0) {
    reg.x = x;
    return CODE_BBAC40();
  }
  const i = (((rom8(WATER_LEVELS + 1 + x) + r16(R.level_entrance_number)) << 1) & 0xffff);
  reg.x = i;
  const h = rom16(WATER_HEIGHTS + i);
  reg.a = h;
  if (h & 0x8000) return CODE_BBAC23();
  w16(0x0d52, h);
  reg.a = 0x8000;
  w16(R.water_current_y_velocity, 0x8000);
}

/** $BBAC23 — A = negative height: a rising level (Castle Crush floor): start it moving. */
export function CODE_BBAC23() {
  w16(0x0d54, (-reg.a) & 0xffff);
  w16(R.water_current_y_velocity, 0xff40);
  w16(R.water_target_y_velocity, 0xff40);
  w16(0x0d52, 0x012b);
  reg.a = r16(R.game_state_flags);
  w16(0x0d56, reg.a);
}

/** $BBAC40 — no water in this level. */
export function CODE_BBAC40() {
  reg.a = 0xf000;
  w16(0x0d54, 0xf000);
  w16(R.water_current_y_velocity, 0);
}

for (const n of [
  "CODE_BBA477", "CODE_BBA4E0", "dma_init_05", "CODE_BBA5BD", "dma_init_0C", "dma_init_17", "dma_init_04", "CODE_BBA5E1",
  "CODE_BBA605", "CODE_BBA64F", "CODE_BBA662", "dma_init_11", "CODE_BBA78E", "CODE_BBA7FE", "set_default_sprite_dma_buffer_size",
  "dma_init_19", "dma_init_20", "dma_init_12", "dma_init_13", "CODE_BBA9F7", "CODE_BBAB05", "init_level_water_height",
  "CODE_BBAC23", "CODE_BBAC40",
]) setRetMode(L(n), RET_RTS);

register({
  CODE_BBA477,
  CODE_BBA4E0,
  dma_init_05,
  CODE_BBA5BD,
  dma_init_0C,
  dma_init_17,
  dma_init_04,
  CODE_BBA5E1,
  CODE_BBA605,
  CODE_BBA64F,
  CODE_BBA662,
  dma_init_11,
  CODE_BBA78E,
  CODE_BBA7FE,
  set_default_sprite_dma_buffer_size: set_default_sprite_dma_buffer_size_,
  dma_init_19,
  dma_init_20,
  dma_init_12,
  dma_init_13,
  CODE_BBA9F7,
  CODE_BBAB05,
  init_level_water_height,
  CODE_BBAC23,
  CODE_BBAC40,
});
