/**
 * Bank $B5 (part B) — level scroll handlers and the column/row builders of the chunk map
 * layouts with rows of $A0 (square levels), $C0 and $40 (vertical levels) bytes, plus the
 * level scroll initialisation that pre-fills the whole screen (CODE_B5B9F1).
 *
 * The builders work like the ones of part A (b5a_level_stream.ts): when the camera crosses an
 * 8-pixel boundary they decode 9 chunks of the chunk map at [$98] into column_row_temp_buffer
 * ($195A), then jump to the shared rotate-into-DMA-buffer tails CODE_B5ADA9 (columns) and
 * CODE_B5AFB4 (rows). A chunk map word is a chunk number plus flip bits ($8000 v, $4000 h);
 * a flipped chunk is read from the mirrored tile offset ($36 instead of $34) and/or in reverse
 * order, and its tiles get the flip bits toggled.
 *
 * DB: absolute variables are read in the caller's data bank; during decoding DB is the chunk
 * map bank ($9A), and the final PLB leaves DB = $9B (the other byte of the pushed word).
 */
import { r8, r16, w16, bus8 } from "../../core/mem";
import { reg, register } from "../../core/cpu";
import { setRetMode, RET_RTL, RET_RTS } from "../../core/hybrid";
import { L, R, C, level } from "../../core/sym";
import {
  CODE_B5ADA9,
  CODE_B5AFB4,
  CODE_B5AC9C,
  CODE_B5AEA7,
  CODE_B5A950,
  CODE_B5AAE6,
  CODE_B5B322,
  CODE_B5B0FC,
  CODE_B5E0E2,
  CODE_80E522,
  camera_handler,
  dma_ship_deck_rigging_columns,
  dma_level_columns,
} from "../../gen/routines";

const TEMP: number = R.column_row_temp_buffer; // $195A
const TEMP_END = 0x19a2; // 9 chunks * 8 bytes

// ---- data-bank relative access ----
const dbAddr = (a: number) => (((reg.db & 0xff) << 16) + (a & 0xffff)) & 0xffffff;
function dbR16(a: number): number {
  const p = dbAddr(a);
  return bus8(p) | (bus8((p + 1) & 0xffffff) << 8);
}
function dbW16(a: number, v: number) {
  // only WRAM variables below $2000 are written: the data bank is a WRAM mirror there
  w16(a & 0xffff, v);
}

const COLUMN = [0x00, 0x08, 0x10, 0x18]; // a column of a chunk (tiles 8 bytes apart)
const ROW = [0x00, 0x02, 0x04, 0x06]; // a row of a chunk
/** Which tilemap offset a chunk with flip bits 0/h/v/hv reads, and whether in reverse order. */
const COLUMN_FLIPS = { base: [0x34, 0x36, 0x34, 0x36], rev: [false, false, true, true] };
const ROW_FLIPS = { base: [0x34, 0x34, 0x36, 0x36], rev: [false, true, false, true] };

/**
 * Decode 9 chunks of the chunk map (pointer $32, advanced by `step`) into the temp buffer.
 * Runs with DB = $9A and leaves DB = $9B, like the original's PHA/PLB ... PLB.
 */
function decodeChunks(offsets: number[], flips: { base: number[]; rev: boolean[] }, step: number) {
  reg.db = r8(0x9a);
  const bank = (reg.db & 0xff) << 16;
  for (let x: number = TEMP; x !== TEMP_END; x += 8) {
    const p = r16(0x32);
    const chunk = bus8(bank | p) | (bus8(bank | ((p + 1) & 0xffff)) << 8); // LDA ($32)
    const flip = chunk & 0xc000;
    // flip index: 0 = none, 1 = h ($4000), 2 = v ($8000), 3 = both
    const fi = (flip & 0x8000 ? 2 : 0) | (flip & 0x4000 ? 1 : 0);
    // ASL x5 then ADC: the carry is the bit shifted out last (chunk bit 11)
    const y = (((chunk << 5) & 0xffff) + r16(flips.base[fi]) + ((chunk >> 11) & 1)) & 0xffff;
    for (let i = 0; i < 4; i++) {
      const off = offsets[flips.rev[fi] ? 3 - i : i];
      const ea = (bank + y + off) & 0xffffff;
      const tile = bus8(ea) | (bus8((ea + 1) & 0xffffff) << 8);
      w16(x + 2 * i, tile ^ flip);
    }
    w16(0x32, (p + step) & 0xffff);
  }
  reg.db = r8(0x9b);
}

/** Camera x used for a new column: the left edge when scrolling left ($17D6 < 0). */
function columnX(): number {
  const sx = dbR16(R.screen_scroll_x_position);
  return dbR16(0x17d6) & 0x8000 ? (sx - 0x100) & 0xffff : sx;
}

/** Camera y used for a new row: above the screen when scrolling up ($17D2 < 0), else below. */
function rowY(): number {
  let a = (dbR16(R.screen_scroll_y_position) - 0x20) & 0xffff;
  if (dbR16(0x17d2) & 0x8000) a = (a - 0xe0) & 0xffff;
  return a;
}

/** Chunk map pointer of the column containing camera x - $100 (rows use the left edge). */
function rowColumnBase(): number {
  return ((((dbR16(R.screen_scroll_x_position) - 0x100) & 0xffe0) >> 4) + r16(R.level_tilemap)) & 0xffff;
}

/** $34/$36 for a row: tile row offset in the chunk, normal and vertically mirrored (with carry in). */
function rowTileOffsets(y: number, carry: number) {
  let s = (y & 0x0018) + dbR16(R.unknown_17B4) + carry;
  const c = s > 0xffff ? 1 : 0;
  w16(0x34, s & 0xffff);
  s = ((y & 0x0018) ^ 0x0018) + dbR16(R.unknown_17B4) + c;
  w16(0x36, s & 0xffff);
}

/** $34/$36 for a column: tile column offset in the chunk, normal and mirrored. */
function columnTileOffsets(x: number) {
  w16(0x34, (((x & 0x0018) >> 2) + dbR16(R.unknown_17B4)) & 0xffff);
  w16(0x36, ((((x & 0x0018) ^ 0x0018) >> 2) + dbR16(R.unknown_17B4)) & 0xffff);
}

// =============================================================================================
// Square levels (chunk map rows of $A0 bytes): row builder (the column builder is CODE_B5B322)
// =============================================================================================

/** $B5B43A — square levels: build the level row entering the screen. */
export function CODE_B5B43A() {
  if ((dbR16(R.screen_scroll_y_position) & 0x00f8) === dbR16(0x17ce)) return;
  w16(0x32, rowColumnBase());
  const y = rowY();
  const r = y & 0xffe0;
  w16(0x34, r);
  // ASL ASL CLC ADC $34 ADC $32: row * 5 (rows of $A0 bytes), carries chained into the next ADCs
  let s = ((r << 2) & 0xffff) + r;
  let c = s > 0xffff ? 1 : 0;
  s = (s & 0xffff) + r16(0x32) + c;
  c = s > 0xffff ? 1 : 0;
  w16(0x32, s & 0xffff);
  rowTileOffsets(y, c);
  decodeChunks(ROW, ROW_FLIPS, 2);
  CODE_B5AFB4();
}

/** $B5B54A — scroll handler of square levels: column then row. */
export function square_level_scroll_handler() {
  dbW16(0x17c8, 0);
  CODE_B5B322();
  CODE_B5B43A();
}

// =============================================================================================
// Levels with chunk map rows of $C0 bytes (6 chunks)
// =============================================================================================

/** $B5B555 — build the level column entering the screen (rows of $C0 bytes). */
export function CODE_B5B555() {
  if ((dbR16(R.screen_scroll_x_position) & 0xfff8) === dbR16(0x17ca)) return;
  const x = columnX();
  w16(0x32, (((x & 0xffe0) >> 4) + r16(R.level_tilemap)) & 0xffff);
  const r2 = (((dbR16(R.screen_scroll_y_position) - 0x100) & 0xffe0) << 1) & 0xffff;
  w16(0x34, r2);
  // row * 6 (CLC before each ADC)
  w16(0x32, (((((r2 << 1) & 0xffff) + r2) & 0xffff) + r16(0x32)) & 0xffff);
  columnTileOffsets(x);
  decodeChunks(COLUMN, COLUMN_FLIPS, 0xc0);
  CODE_B5ADA9();
}

/** $B5B66D — build the level row entering the screen (rows of $C0 bytes). */
export function CODE_B5B66D() {
  if ((dbR16(R.screen_scroll_y_position) & 0x00f8) === dbR16(0x17ce)) return;
  w16(0x32, rowColumnBase());
  const y = rowY();
  const r2 = ((y & 0xffe0) << 1) & 0xffff;
  w16(0x34, r2);
  // ASL CLC ADC $34 ADC $32: row * 6, carries chained
  let s = ((r2 << 1) & 0xffff) + r2;
  let c = s > 0xffff ? 1 : 0;
  s = (s & 0xffff) + r16(0x32) + c;
  c = s > 0xffff ? 1 : 0;
  w16(0x32, s & 0xffff);
  rowTileOffsets(y, c);
  decodeChunks(ROW, ROW_FLIPS, 2);
  CODE_B5AFB4();
}

/** $B5B77D — scroll handler for the $C0-stride layout: column then row. */
export function CODE_B5B77D() {
  dbW16(0x17c8, 0);
  CODE_B5B555();
  CODE_B5B66D();
}

// =============================================================================================
// Vertical levels (chunk map rows of $40 bytes)
// =============================================================================================

/** $B5B788 — vertical levels: build the level column entering the screen. */
export function CODE_B5B788() {
  if ((dbR16(R.screen_scroll_x_position) & 0xfff8) === dbR16(0x17ca)) return;
  const x = columnX();
  w16(0x32, (((x & 0xffe0) >> 4) + r16(R.level_tilemap)) & 0xffff);
  const r2 = (((dbR16(R.screen_scroll_y_position) - 0x100) & 0xffe0) << 1) & 0xffff;
  w16(0x32, (r2 + r16(0x32)) & 0xffff);
  columnTileOffsets(x);
  decodeChunks(COLUMN, COLUMN_FLIPS, 0x40);
  CODE_B5ADA9();
}

/** $B5B89A — vertical levels: build the level row entering the screen. */
export function CODE_B5B89A() {
  if ((dbR16(R.screen_scroll_y_position) & 0x00f8) === dbR16(0x17ce)) return;
  w16(0x32, rowColumnBase());
  const y = rowY();
  const s = (((y & 0xffe0) << 1) & 0xffff) + r16(0x32);
  w16(0x32, s & 0xffff);
  rowTileOffsets(y, s > 0xffff ? 1 : 0);
  decodeChunks(ROW, ROW_FLIPS, 2);
  CODE_B5AFB4();
}

/** $B5B9A5 — scroll handler of vertical levels. */
export function vertical_level_scroll_handler() {
  dbW16(0x17c8, 0);
  CODE_B5B788();
  CODE_B5B89A();
}

/** $B5B9B0 — scroll handler of horizontal levels (builders in part A). */
export function horizontal_level_scroll_handler() {
  dbW16(0x17c8, 0);
  CODE_B5AC9C();
  CODE_B5AEA7();
}

/**
 * $B5B9BB — scroll handler of ship deck levels with rigging on BG2: the rigging column and
 * row. (The code after its RTL, which would also stream a second copy of the level map from
 * $98 + $4B00 into the BG2 buffers, is unreachable.)
 */
export function ship_deck_rigging_scroll_handler() {
  CODE_B5A950();
  CODE_B5AAE6();
}

// =============================================================================================
// Level scroll initialisation
// =============================================================================================

/** $B5B9ED — JSL wrapper of CODE_B5B9F1. */
export function CODE_B5B9ED() {
  CODE_B5B9F1();
}

/**
 * $B5B9F1 — place the camera on the level start and draw the whole screen: the column builder
 * and column DMA run 64 times while the camera steps 4 pixels to the right each time, then
 * the camera is put back.
 */
export function CODE_B5B9F1() {
  CODE_B5E0E2();
  w16(0x10, 0xffff);
  w16(0x12, 0xffff);
  camera_handler();
  // the smoothed camera starts at its target
  dbW16(0x0ada, dbR16(0x0ae2));
  dbW16(0x0adc, dbR16(0x0ae4));
  dbW16(0x0ad6, dbR16(0x0ade));
  dbW16(0x0ad8, dbR16(0x0ae0));
  const sy = dbR16(0x0ae3);
  dbW16(R.screen_scroll_y_position, sy);
  dbW16(0x17c2, sy - 1);
  if (!(dbR16(level.effects) & C.no_tilemap_effect)) {
    dbW16(R.screen_scroll_x_position, dbR16(0x0adf) - 0x100);
    zeroCameraVelocity();
    dbW16(0x17ce, dbR16(R.screen_scroll_y_position) & 0x00f8);
    dbW16(0x17ca, (dbR16(R.screen_scroll_x_position) + 8) & 0x00f8);
    dbW16(0x17d2, 0);
    dbW16(0x17d6, 4);
    for (let n = 0x40; n !== 0; n--) {
      CODE_B5BA99();
      CODE_B5BADE();
      dbW16(0x17d6, 4);
      dbW16(R.screen_scroll_x_position, dbR16(R.screen_scroll_x_position) + 4);
    }
    dbW16(0x17d2, 0);
    dbW16(0x17d6, 0);
    CODE_B5BA99();
  }
  // CODE_B5BA83
  dbW16(0x17ce, dbR16(R.screen_scroll_y_position) & 0x00f8);
  zeroCameraVelocity();
}

function zeroCameraVelocity() {
  dbW16(0x0ace, 0);
  dbW16(0x0ad0, 0);
  dbW16(0x0ad2, 0);
  dbW16(0x0ad4, 0);
}

/** $B5BA99 — build one level column with the builder of the level's map layout ($0AB4). */
export function CODE_B5BA99() {
  if (dbR16(level.effects) & C.unknown_camera_effect) {
    CODE_80E522();
    CODE_B5A950();
  }
  const layout = dbR16(0x0ab4) & 0x000f;
  switch (layout) {
    case 0:
    case 8:
      CODE_B5AC9C();
      break;
    case 5:
      CODE_B5B0FC();
      break;
    case 4:
      CODE_B5B788();
      break;
    case 6:
      CODE_B5B555();
      break;
    default:
      CODE_B5B322();
  }
}

/** $B5BADE — upload the built column (and the rigging column when the level has rigging). */
export function CODE_B5BADE() {
  if (dbR16(level.effects) & C.unknown_camera_effect) dma_ship_deck_rigging_columns();
  dma_level_columns();
}

register({
  CODE_B5B43A,
  square_level_scroll_handler,
  CODE_B5B555,
  CODE_B5B66D,
  CODE_B5B77D,
  CODE_B5B788,
  CODE_B5B89A,
  vertical_level_scroll_handler,
  horizontal_level_scroll_handler,
  ship_deck_rigging_scroll_handler,
  CODE_B5B9ED,
  CODE_B5B9F1,
  CODE_B5BA99,
  CODE_B5BADE,
});
// CODE_B5B43A/B66D/B89A are entered with JML from the handlers and return with RTL
for (const n of ["CODE_B5B43A", "CODE_B5B66D", "CODE_B5B89A", "CODE_B5B555", "CODE_B5B788"]) setRetMode(L(n), RET_RTL);
for (const n of ["CODE_B5B9F1", "CODE_B5BA99", "CODE_B5BADE"]) setRetMode(L(n), RET_RTS);
