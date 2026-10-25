/**
 * Bank $B5 (part A) — sprite graphics DMA, and streaming of level tilemap columns/rows.
 *
 * Levels are made of 32x32 "chunks" (4x4 8x8 tiles, 32 bytes each) indexed by a chunk map.
 * Each chunk map word is a chunk number plus flip bits ($8000 = v, $4000 = h). When the camera
 * crosses an 8-pixel boundary, the builders below decode one 8x8 column or row of tiles
 * (9 chunks -> 36 tiles) into `column_row_temp_buffer` ($195A), rotate it into the 64-byte DMA
 * buffers in VRAM order, and the dma_* routines (run in NMI) send the buffers to VRAM.
 *
 * Flipped chunks are decoded by reading the chunk's other tilemap ($34 = normal, $36 = the
 * horizontally mirrored column/row offset), reversing the order for the flip along the stream
 * direction and toggling the tile's own flip bits.
 *
 * DB matters here: absolute addresses (`$17C8`, `screen_scroll_x_position`, the buffers, the
 * chunk map) are read in the data bank, which the builders set to the level data bank ($9A) and,
 * through a leftover byte on the stack, to $9B (normally 0) when they return.
 */
import { r8, r16, w16, bus8, busW8, io8, io16 } from "../../core/mem";
import { reg, register } from "../../core/cpu";
import { setRetMode, RET_RTL } from "../../core/hybrid";
import { L, R, CPU, DMA, PPU } from "../../core/sym";
import { cpuTime } from "../b80/b80a_util";

const SPRITE_DMA = R.sprite_dma;
const TEMP = R.column_row_temp_buffer; // $195A
const TEMP_END = 0x19a2; // 9 chunks * 8 bytes
const LEVEL_COLUMN = R.level_column_dma_buffer;
const LEVEL_ROW_LEFT = R.level_row_left_dma_buffer;
const LEVEL_ROW_RIGHT = R.level_row_right_dma_buffer;
const LAYER_COLUMN = R.layer_column_dma_buffer; // ship deck rigging (BG2)
const LAYER_ROW_LEFT = R.layer_row_left_dma_buffer;
const LAYER_ROW_RIGHT = R.layer_row_right_dma_buffer;
const RIGGING_CHUNK_MAP = L("DATA_F526A7") & 0xffff;
const RIGGING_CHUNKS = L("DATA_F52087") & 0xffff;
const RIGGING_BANK = L("DATA_F52087") >> 16; // $F5

// ---- data-bank relative access ----
const dbAddr = (a: number) => (((reg.db & 0xff) << 16) + (a & 0xffff)) & 0xffffff;
function dbR16(a: number): number {
  const p = dbAddr(a);
  return bus8(p) | (bus8((p + 1) & 0xffffff) << 8);
}
function dbW16(a: number, v: number) {
  const p = dbAddr(a);
  busW8(p, v & 0xff);
  busW8((p + 1) & 0xffffff, (v >> 8) & 0xff);
}
/** `LDA ($32)`: read the chunk map word in the data bank (no bank carry for direct indirect). */
const chunkWord = (ptr: number) => bus8((((reg.db & 0xff) << 16) | (ptr & 0xffff))) |
  (bus8((((reg.db & 0xff) << 16) | ((ptr + 1) & 0xffff))) << 8);

/** One 64-byte DMA (mode 1, to $2118/$2119) from WRAM `source` to the current VRAM address. */
function dmaBuffer(source: number) {
  io16(DMA.source, source);
  io16(DMA.unused_2, source);
  io16(DMA.size, 0x0040);
  io16(DMA.settings, 0x1801);
  io8(DMA.source_bank, 0x00);
  io8(CPU.enable_dma, 0x01);
}

/**
 * Decode 9 chunks into column_row_temp_buffer. `offsets` are the 4 tile offsets inside a chunk in
 * stream order; `hBase`/`vBase` select which tilemap offset ($34/$36) a flipped chunk uses and
 * `hRev`/`vRev` whether its 4 tiles are taken in reverse order. `step` advances the chunk map
 * pointer $32 (with an optional wrap for the rigging map).
 */
function decodeChunks(
  offsets: number[],
  base: { n: number; h: number; v: number; hv: number },
  rev: { h: boolean; v: boolean },
  step: (p: number) => number,
) {
  for (let x: number = TEMP; x !== TEMP_END; x += 8) {
    const chunk = chunkWord(r16(0x32));
    const flip = chunk & 0xc000;
    let baseAddr: number;
    let reverse: boolean;
    switch (flip) {
      case 0x0000: baseAddr = base.n; reverse = false; break;
      case 0x4000: baseAddr = base.h; reverse = rev.h; break;
      case 0x8000: baseAddr = base.v; reverse = rev.v; break;
      default: baseAddr = base.hv; reverse = true; break;
    }
    // chunk * 32 + base (the ADC also takes the bit shifted out by the last ASL: chunk bit 11)
    const y = (((chunk << 5) & 0xffff) + r16(baseAddr) + ((chunk >> 11) & 1)) & 0xffff;
    for (let i = 0; i < 4; i++) {
      const off = offsets[reverse ? 3 - i : i];
      const tile = bus8(dbAddr(0) + y + off) | (bus8(((dbAddr(0) + y + off + 1) & 0xffffff)) << 8);
      w16(x + 2 * i, tile ^ flip);
    }
    w16(0x32, step(r16(0x32)));
  }
}

const COLUMN = [0x00, 0x08, 0x10, 0x18]; // a column of a chunk (tiles 8 bytes apart)
const ROW = [0x00, 0x02, 0x04, 0x06]; // a row of a chunk
const plus = (n: number) => (p: number) => (p + n) & 0xffff;

/**
 * Copy the 36 decoded tiles into a 32-entry DMA buffer, rotated so that tile k lands at the VRAM
 * slot of screen position k (`wrap` = byte mask of the buffer, `or` = buffer half select).
 */
function rotateIntoBuffer(start: number, target: number, wrap: number, extra: number, or: number) {
  const x0 = start & 0x0006;
  const end = (x0 + extra) & 0xffff;
  w16(0x34, end);
  let y = start;
  for (let x = x0; x !== end; x += 2) {
    dbW16(target + y, dbR16(TEMP + x));
    y = (((y + 2) & wrap) | or) & 0xffff;
  }
}

// ---------------------------------------------------------------------------------------------
// Sprite graphics
// ---------------------------------------------------------------------------------------------

/** $B5A919 — NMI: run every queued sprite graphics DMA (buffer ends at a bank word >= 0). */
export function dma_queued_sprite_graphics() {
  io16(DMA.settings, 0x1801);
  for (let x = 0; ; x = (x + 8) & 0xff) {
    const bank = r16(SPRITE_DMA + 6 + x);
    if (!(bank & 0x8000)) break;
    io16(DMA.source_bank, bank);
    io16(DMA.size, r16(SPRITE_DMA + x));
    io16(PPU.vram_address, r16(SPRITE_DMA + 2 + x));
    io16(DMA.source, r16(SPRITE_DMA + 4 + x));
    w16(SPRITE_DMA + 6 + x, 0);
    io8(CPU.enable_dma, 0x01);
  }
}

// ---------------------------------------------------------------------------------------------
// Ship deck rigging (BG2 layer streamed from the chunk map at $F526A7)
// ---------------------------------------------------------------------------------------------

/** $B5A950 — build the rigging column entering the screen (layer x position $B8). */
export function CODE_B5A950() {
  const col = r16(0xb8) & 0xfff8;
  if (col === r16(0xc6)) return;
  let a = r16(0xb6);
  if (col >= r16(0xc6)) {
    // moving right: the column on the far side, wrapping in the 40-chunk wide map
    a = (a + 0x100) & 0xffff;
    if (a >= 0x0500) a -= 0x0500;
  }
  const y = a;
  w16(0x32, ((a & 0x0fe0) + RIGGING_CHUNK_MAP) & 0xffff);
  w16(0x32, ((((dbR16(R.screen_scroll_y_position) - 0x100) & 0x01e0) >> 4) + r16(0x32)) & 0xffff);
  w16(0x34, (((y & 0x0018) >> 2) + RIGGING_CHUNKS) & 0xffff);
  w16(0x36, ((((y & 0x0018) ^ 0x0018) >> 2) + RIGGING_CHUNKS) & 0xffff);
  reg.db = RIGGING_BANK;
  decodeChunks(COLUMN, { n: 0x34, h: 0x36, v: 0x34, hv: 0x36 }, { h: false, v: true }, plus(2));
  reg.db = 0x00; // PLB pulls the high byte of the pushed bank word
  CODE_B5AA5F();
  // decoding a column is CPU-heavy on the console; level loads draw 64 in a row (measured)
  cpuTime(14400);
}

/** $B5AA5F — rotate the decoded rigging column into layer_column_dma_buffer. */
export function CODE_B5AA5F() {
  const start = (dbR16(R.screen_scroll_y_position) & 0x00f8) >> 2;
  rotateIntoBuffer(start, LAYER_COLUMN, 0x3e, 0x40, 0);
}

/** $B5AA88 — NMI: upload the rigging column to the BG2 tilemap at $7800. */
export function dma_ship_deck_rigging_columns() {
  const col = r16(0xb8) & 0xfff8;
  if (col === r16(0xc6)) return;
  const right = col >= r16(0xc6);
  w16(0xc6, col);
  io8(PPU.vram_control, 0x81); // increment after $2119, by 32 words: vertical strip
  let a = r16(0xb8);
  if (right) a = (a + 0x100) & 0xffff;
  a = (a >> 3) & 0x003f;
  if (a & 0x0020) a += 0x03e0; // right tilemap screen
  io16(PPU.vram_address, (a + 0x7800) & 0xffff);
  dmaBuffer(LAYER_COLUMN);
  io8(PPU.vram_control, 0x80);
}

/** $B5AAE6 — build the rigging row entering the screen. */
export function CODE_B5AAE6() {
  const row = dbR16(R.screen_scroll_y_position) & 0x00f8;
  if (row === dbR16(0x17ce)) return;
  w16(0x32, ((r16(0xb6) & 0x0fe0) + 0x26a7) & 0xffff);
  const sy = dbR16(R.screen_scroll_y_position);
  const a = dbR16(0x17d2) & 0x8000 ? (sy - 0x100) & 0xffff : (sy - 0x20) & 0xffff;
  const y = a;
  let s = ((a & 0x01e0) >> 4) + r16(0x32);
  let c = s > 0xffff ? 1 : 0;
  w16(0x32, s & 0xffff);
  s = (y & 0x0018) + 0x2087 + c;
  c = s > 0xffff ? 1 : 0;
  w16(0x34, s & 0xffff);
  w16(0x36, (((y & 0x0018) ^ 0x0018) + 0x2087 + c) & 0xffff);
  reg.db = 0xf5;
  decodeChunks(ROW, { n: 0x34, h: 0x34, v: 0x36, hv: 0x36 }, { h: true, v: false }, (p) => {
    // next chunk row, wrapping inside the 40-row map
    let n = (p + 0x20) & 0xffff;
    if (n >= 0x2ba7) n -= 0x0500;
    return n;
  });
  reg.db = 0x00;
  // CODE_B5ABFD
  const start = (r16(0xb8) & 0x01f8) >> 2;
  rotateIntoBuffer(start, LAYER_ROW_LEFT, 0x7e, 0x42, 0);
}

/** $B5AC25 — NMI: upload the rigging row (two 32-tile halves) to the BG2 tilemap at $7800. */
export function dma_ship_deck_rigging_rows() {
  const sy = dbR16(R.screen_scroll_y_position);
  if ((sy & 0x00f8) === dbR16(0x17ce)) return;
  const a = dbR16(0x17d2) & 0x8000 ? sy : (sy + 0xe0) & 0xffff;
  const addr = ((((a << 2) & 0x03e0) + 0x7800) & 0xffff);
  w16(0x32, addr);
  io16(PPU.vram_address, addr);
  dmaBuffer(LAYER_ROW_LEFT);
  io16(PPU.vram_address, (r16(0x32) + 0x0400) & 0xffff);
  dmaBuffer(LAYER_ROW_RIGHT);
}

// ---------------------------------------------------------------------------------------------
// Level tilemap (BG1), chunk map at [$98] in bank $9A
// ---------------------------------------------------------------------------------------------

/** Bank switch of the builders: PHA (A = $9A word) : PLB. */
function enterLevelBank() {
  reg.db = r8(0x9a);
}
/** The final PLB pulls the other byte of that word. */
function leaveLevelBank() {
  reg.db = r8(0x9b);
}

/** Camera x used for a new column: the left edge when scrolling left ($17D6 < 0). */
function columnX(): number {
  const sx = dbR16(R.screen_scroll_x_position);
  return dbR16(0x17d6) & 0x8000 ? (sx - 0x100) & 0xffff : sx;
}

/** $B5AC9C — horizontal levels: build the level column entering the screen. */
export function CODE_B5AC9C() {
  if ((dbR16(R.screen_scroll_x_position) & 0xfff8) === dbR16(0x17ca)) return;
  const y = columnX();
  w16(0x32, ((y & 0xffe0) + r16(R.level_tilemap)) & 0xffff);
  w16(0x32, ((((dbR16(R.screen_scroll_y_position) - 0x100) & 0x01e0) >> 4) + r16(0x32)) & 0xffff);
  w16(0x34, (((y & 0x0018) >> 2) + dbR16(R.unknown_17B4)) & 0xffff);
  w16(0x36, ((((y & 0x0018) ^ 0x0018) >> 2) + dbR16(R.unknown_17B4)) & 0xffff);
  enterLevelBank();
  decodeChunks(COLUMN, { n: 0x34, h: 0x36, v: 0x34, hv: 0x36 }, { h: false, v: true }, plus(2));
  leaveLevelBank();
  CODE_B5ADA9();
  cpuTime(15800); // measured cost of decoding one level column on the console
}

/** $B5ADA9 — rotate the decoded column into level_column_dma_buffer ($17C8 = buffer half). */
export function CODE_B5ADA9() {
  const half = dbR16(0x17c8);
  const start = (((dbR16(R.screen_scroll_y_position) & 0x00f8) >> 2) | half) & 0xffff;
  rotateIntoBuffer(start, LEVEL_COLUMN, 0x3e, 0x40, half);
}

/** Shared tail of dma_level_columns and its dead-code twin: set the VRAM column, run the DMA. */
function uploadColumn(base: number, source: number) {
  io8(PPU.vram_control, 0x81);
  let a = dbR16(0x17d6) & 0x8000 ? dbR16(R.screen_scroll_x_position) : (dbR16(R.screen_scroll_x_position) + 0x100) & 0xffff;
  a = (a >> 3) & 0x003f;
  if (a & 0x0020) a += 0x03e0;
  io16(PPU.vram_address, (a + base) & 0xffff);
  dmaBuffer(source);
  io8(PPU.vram_control, 0x80);
}

/** $B5ADD8 — NMI: upload the new level column when the camera crossed an 8-pixel boundary. */
export function dma_level_columns() {
  const col = dbR16(R.screen_scroll_x_position) & 0xfff8;
  if (col === dbR16(0x17ca)) return;
  dbW16(0x17ca, col);
  uploadColumn(dbR16(R.level_tilemap_vram_address), LEVEL_COLUMN);
}

/** $B5AE4D — (only reachable from dead code at $B5AE41) column upload of the BG2 row buffer. */
export function CODE_B5AE4D() {
  uploadColumn(0x7800, LAYER_ROW_RIGHT);
}

/** $B5AEA7 — horizontal levels: build the level row entering the screen. */
export function CODE_B5AEA7() {
  if ((dbR16(R.screen_scroll_y_position) & 0x00f8) === dbR16(0x17ce)) return;
  w16(0x32, (((dbR16(R.screen_scroll_x_position) - 0x100) & 0xffe0) + r16(R.level_tilemap)) & 0xffff);
  let a = (dbR16(R.screen_scroll_y_position) - 0x20) & 0xffff;
  if (dbR16(0x17d2) & 0x8000) a = (a - 0xe0) & 0xffff;
  const y = a;
  let s = ((a & 0x01e0) >> 4) + r16(0x32);
  let c = s > 0xffff ? 1 : 0;
  w16(0x32, s & 0xffff);
  s = (y & 0x0018) + dbR16(R.unknown_17B4) + c;
  c = s > 0xffff ? 1 : 0;
  w16(0x34, s & 0xffff);
  w16(0x36, (((y & 0x0018) ^ 0x0018) + dbR16(R.unknown_17B4) + c) & 0xffff);
  enterLevelBank();
  decodeChunks(ROW, { n: 0x34, h: 0x34, v: 0x36, hv: 0x36 }, { h: true, v: false }, plus(0x20));
  leaveLevelBank();
  CODE_B5AFB4();
}

/** $B5AFB4 — rotate the decoded row into level_row_left (or, when $17C8 != 0, the BG2 buffer). */
export function CODE_B5AFB4() {
  const target = dbR16(0x17c8) !== 0 ? LAYER_COLUMN : LEVEL_ROW_LEFT;
  const start = (dbR16(R.screen_scroll_x_position) & 0x01f8) >> 2;
  rotateIntoBuffer(start, target, 0x7e, 0x42, 0);
}

/** Shared tail of dma_level_rows and its dead-code twin: two 32-tile DMAs, $400 words apart. */
function uploadRow(base: number, left: number, right: number) {
  const sy = dbR16(R.screen_scroll_y_position);
  const a = dbR16(0x17d2) & 0x8000 ? sy : (sy + 0xe0) & 0xffff;
  const addr = (((a << 2) & 0x03e0) + base) & 0xffff;
  w16(0x32, addr);
  io16(PPU.vram_address, addr);
  dmaBuffer(left);
  io16(PPU.vram_address, (r16(0x32) + 0x0400) & 0xffff);
  dmaBuffer(right);
}

/** $B5B00B — NMI: upload the new level row when the camera crossed an 8-pixel boundary. */
export function dma_level_rows() {
  const row = dbR16(R.screen_scroll_y_position) & 0x00f8;
  if (row === dbR16(0x17ce)) return;
  dbW16(0x17ce, row);
  uploadRow(dbR16(R.level_tilemap_vram_address), LEVEL_ROW_LEFT, LEVEL_ROW_RIGHT);
}

/** $B5B091 — (only reachable from dead code at $B5B085) row upload of the BG2 buffers. */
export function CODE_B5B091() {
  uploadRow(0x7800, LAYER_COLUMN, LAYER_ROW_LEFT);
}

/** $B5B0FC — vertical levels (chunk map stored column-major): build the entering column. */
export function CODE_B5B0FC() {
  if ((dbR16(R.screen_scroll_x_position) & 0xfff8) === dbR16(0x17ca)) return;
  const y = columnX();
  w16(0x32, (((y & 0xffe0) >> 4) + r16(R.level_tilemap)) & 0xffff);
  w16(0x32, (((dbR16(R.screen_scroll_y_position) - 0x100) & 0xffe0) + r16(0x32)) & 0xffff);
  w16(0x34, (((y & 0x0018) >> 2) + dbR16(R.unknown_17B4)) & 0xffff);
  w16(0x36, ((((y & 0x0018) ^ 0x0018) >> 2) + dbR16(R.unknown_17B4)) & 0xffff);
  enterLevelBank();
  decodeChunks(COLUMN, { n: 0x34, h: 0x36, v: 0x34, hv: 0x36 }, { h: false, v: true }, plus(0x20));
  leaveLevelBank();
  CODE_B5ADA9();
  cpuTime(15800); // measured cost of decoding one level column on the console
}

/** $B5B20D — vertical levels: build the entering row. */
export function CODE_B5B20D() {
  if ((dbR16(R.screen_scroll_y_position) & 0x00f8) === dbR16(0x17ce)) return;
  w16(0x32, ((((dbR16(R.screen_scroll_x_position) - 0x100) & 0xffe0) >> 4) + r16(R.level_tilemap)) & 0xffff);
  let a = (dbR16(R.screen_scroll_y_position) - 0x20) & 0xffff;
  if (dbR16(0x17d2) & 0x8000) a = (a - 0xe0) & 0xffff;
  const y = a;
  let s = (a & 0xffe0) + r16(0x32);
  let c = s > 0xffff ? 1 : 0;
  w16(0x32, s & 0xffff);
  s = (y & 0x0018) + dbR16(R.unknown_17B4) + c;
  c = s > 0xffff ? 1 : 0;
  w16(0x34, s & 0xffff);
  w16(0x36, (((y & 0x0018) ^ 0x0018) + dbR16(R.unknown_17B4) + c) & 0xffff);
  enterLevelBank();
  decodeChunks(ROW, { n: 0x34, h: 0x34, v: 0x36, hv: 0x36 }, { h: true, v: false }, plus(2));
  leaveLevelBank();
  CODE_B5AFB4();
}

/** $B5B317 — vertical level scroll step (game sub modes): column then row. */
export function CODE_B5B317() {
  dbW16(0x17c8, 0);
  CODE_B5B0FC();
  CODE_B5B20D();
}

/** $B5B322 — square levels (chunk map 5 * 32 bytes per chunk row): build the entering column. */
export function CODE_B5B322() {
  if ((dbR16(R.screen_scroll_x_position) & 0xfff8) === dbR16(0x17ca)) return;
  const y = columnX();
  w16(0x32, (((y & 0xffe0) >> 4) + r16(R.level_tilemap)) & 0xffff);
  const rowOff = (dbR16(R.screen_scroll_y_position) - 0x100) & 0xffe0;
  w16(0x34, rowOff);
  w16(0x32, ((((rowOff << 2) & 0xffff) + rowOff + r16(0x32)) & 0xffff));
  w16(0x34, (((y & 0x0018) >> 2) + dbR16(R.unknown_17B4)) & 0xffff);
  w16(0x36, ((((y & 0x0018) ^ 0x0018) >> 2) + dbR16(R.unknown_17B4)) & 0xffff);
  enterLevelBank();
  // CODE_B5B380 loop
  decodeChunks(COLUMN, { n: 0x34, h: 0x36, v: 0x34, hv: 0x36 }, { h: false, v: true }, plus(0xa0));
  leaveLevelBank();
  CODE_B5ADA9();
  cpuTime(15800); // measured cost of decoding one level column on the console
}

const entries = {
  dma_queued_sprite_graphics,
  CODE_B5A950,
  CODE_B5AA5F,
  dma_ship_deck_rigging_columns,
  CODE_B5AAE6,
  dma_ship_deck_rigging_rows,
  CODE_B5AC9C,
  CODE_B5ADA9,
  dma_level_columns,
  CODE_B5AE4D,
  CODE_B5AEA7,
  CODE_B5AFB4,
  dma_level_rows,
  CODE_B5B091,
  CODE_B5B0FC,
  CODE_B5B20D,
  CODE_B5B317,
  CODE_B5B322,
};
register(entries);
// entered by JMP from the scroll handlers of the next part of the bank: they return with RTL
setRetMode(L("CODE_B5ADA9"), RET_RTL);
setRetMode(L("CODE_B5AFB4"), RET_RTL);
setRetMode(L("CODE_B5AE4D"), RET_RTL);
setRetMode(L("CODE_B5B091"), RET_RTL);
