/**
 * Bank $80 — tilemap uploads of the file select screen: the language and mono/stereo options,
 * and the three save file panels (Kong head sprites, play time, Kong count, completion %).
 *
 * A file select tilemap payload is: columns (byte), rows (byte), then columns x rows words.
 * Rows are written to VRAM $20 words apart (32x32 tilemap).
 */
import { r8, r16, w16, io8, io16, ioR16, bus8, bus16 } from "../../core/mem";
import { reg, register } from "../../core/cpu";
import { L, R, PPU } from "../../core/sym";
import { validate_save_file, CODE_80A82B, CODE_B3F42D } from "../../gen/routines";
import { cpuTime } from "./b80a_util";

const LANGUAGE_TILEMAPS = L("DATA_ED7447");
const CHANNEL_TILEMAPS = L("DATA_ED7893");
const EMPTY_FILE_TILEMAP = L("DATA_ED7717");
const KONG_COUNT_TILEMAPS = L("DATA_ED7639");
const DIGIT_TILES = L("DATA_ED783B");
const PERCENT_TILEMAP = L("DATA_ED7889");
const TWO_DIGITS = L("DATA_B3DE2C"); // 0..99 as (tens, ones) byte pairs

/** Master cycles of upload_fileselect_tilemap, measured on the original (per word / row / call). */
const TILEMAP_WORD_CYCLES = 139; // 16x3 payload: 7530 master cycles
const TILEMAP_ROW_CYCLES = 180;
const TILEMAP_CALL_CYCLES = 300;

/** Upload the payload at 24-bit `src` to VRAM word address `dest` (sets the DP temporaries). */
function tilemap(src: number, dest: number) {
  reg.x = src & 0xffff;
  reg.y = (src >> 16) & 0xff;
  reg.a = dest;
  upload_fileselect_tilemap();
}

/** $80AF83 — A = VRAM word address, X = payload address, Y = payload bank. */
export function upload_fileselect_tilemap() {
  w16(0x32, reg.a);
  w16(0x34, reg.x);
  w16(0x36, reg.y);
  const p = ((r8(0x36) << 16) | r16(0x34)) & 0xffffff;
  const at = (y: number) => (p + y) & 0xffffff;
  const cols = bus8(at(0));
  w16(0x38, cols);
  let rows = bus8(at(1));
  w16(0x3a, rows);
  let y = 2;
  let dest = r16(0x32);
  let words = 0;
  let rowCount = 0;
  do {
    io16(PPU.vram_address, dest);
    for (let x = cols || 0x10000; x > 0; x--) {
      io16(PPU.vram_write, bus16(at(y)));
      y = (y + 2) & 0xffff;
      words++;
    }
    dest = (dest + 0x20) & 0xffff;
    w16(0x32, dest);
    rows = (rows - 1) & 0xffff;
    w16(0x3a, rows);
    rowCount++;
  } while (rows !== 0);
  cpuTime(words * TILEMAP_WORD_CYCLES + rowCount * TILEMAP_ROW_CYCLES + TILEMAP_CALL_CYCLES);
  reg.a = dest;
  reg.x = 0;
  reg.y = y;
}

/** $80AC3C — the language option (English / French ...) tilemap. */
export function upload_language_tilemap() {
  const x = (r16(R.language_select) << 1) & 0xffff;
  tilemap((0xed << 16) | bus16(LANGUAGE_TILEMAPS + x), R.vram_menus_language_tilemap);
}

/** $80AC50 — the mono / stereo option tilemap. */
export function upload_channel_count_tilemap() {
  const x = (r16(R.stereo_select) << 1) & 0xffff;
  tilemap((0xed << 16) | bus16(CHANNEL_TILEMAPS + x), R.vram_menus_channel_count_tilemap);
}

/** $80AC63 — draw the three save file panels. */
export function upload_file_tilemaps() {
  const files: [string, number][] = [
    ["save_file1", R.vram_menus_save_file1_tilemap],
    ["save_file2", R.vram_menus_save_file2_tilemap],
    ["save_file3", R.vram_menus_save_file3_tilemap],
  ];
  w16(0x56, (L("save_file1") >> 16) & 0xff);
  files.forEach(([label, vram], n) => {
    reg.a = n;
    get_file_status();
    w16(0x54, L(label) & 0xffff);
    reg.a = vram;
    reg.x = n;
    upload_file_tilemap();
  });
}

/** $80ACA5 — A = file number: $50 = 1 if the save file is valid (carry of validate_save_file). */
export function get_file_status() {
  const x = reg.x;
  const y = reg.y;
  validate_save_file();
  reg.a = reg.c ? 1 : 0;
  w16(0x50, reg.a);
  reg.x = x;
  reg.y = y;
}

/** The two Kong head sprites of a file panel (OAM entries at $3C * $10 and +$30). */
function kongHeads(tileDiddy: number, tileDixie: number) {
  const n = r16(0x3c);
  w16(0x34, tileDiddy);
  let pos = 0x3880;
  for (let i = n; i !== 0; i = (i - 1) & 0xffff) pos = (pos + 0x2800) & 0xffff;
  w16(0x36, pos);
  reg.x = (n << 4) & 0xffff;
  CODE_80A82B();
  reg.x = (reg.x + 0x0030) & 0xffff;
  w16(0x36, (r16(0x36) + 0x0028) & 0xffff);
  w16(0x34, tileDixie);
  CODE_80A82B();
}

/**
 * $80ACB6 — A = VRAM address of the panel, X = file number, $50 = file valid, $54/$56 = the
 * save file. An empty file shows "new game" with grey Kong heads; a used one the Kong count,
 * the play time and the completion % (two players: both halves of the file).
 */
export function upload_file_tilemap() {
  w16(0x32, reg.a);
  w16(0x3c, reg.x);
  if (!r16(0x50)) {
    kongHeads(0x3208, 0x3008);
    tilemap(EMPTY_FILE_TILEMAP, r16(0x32));
    return;
  }
  // CODE_80AD00
  kongHeads(0x3204, 0x3000);
  const file = () => ((r8(0x56) << 16) | r16(0x54)) & 0xffffff;
  const kongs = bus8((file() + 5) & 0xffffff);
  tilemap((0xed << 16) | bus16(KONG_COUNT_TILEMAPS + ((kongs << 1) & 0xffff)), r16(0x32));
  w16(0x32, (r16(0x32) - 0x0058) & 0xffff);
  if (kongs === 2) {
    w16(0x54, (r16(0x54) + 0x0006) & 0xffff);
    w16(0x32, (r16(0x32) - 0x0020) & 0xffff);
    CODE_80AD94();
    w16(0x32, (r16(0x32) - 0x0013) & 0xffff);
    w16(0x54, (r16(0x54) + 0x014e) & 0xffff);
    CODE_80AD94();
    return;
  }
  // CODE_80AD88
  w16(0x54, (r16(0x54) + 0x0006) & 0xffff);
  CODE_80AD94();
}

/** 32-bit $32:$34 / $36 on the original divider routine; quotient in $38:$3A. */
function divide(lo: number, hi: number) {
  w16(0x32, lo);
  w16(0x34, hi);
  w16(0x36, 0x003c);
  CODE_B3F42D();
}

const digitPair = (v: number, second: boolean) => bus16(TWO_DIGITS + ((((v << 1) | (second ? 1 : 0)) & 0xffff)));

/**
 * $80AD94 — draw a file's statistics at $32: play time h:mm (frames, capped at 99:59),
 * two 2-digit counters and the completion %. $54/$56 = the file's statistics.
 */
export function CODE_80AD94() {
  const vram = r16(0x32);
  const file = ((r8(0x56) << 16) | r16(0x54)) & 0xffffff;
  const fb = (o: number) => bus8((file + o) & 0xffffff);
  let lo = bus16(file);
  let hi = bus16((file + 2) & 0xffffff);
  w16(0x32, lo);
  w16(0x34, hi);
  if (hi > 0x0149 || (hi === 0x0149 && lo >= 0x88f0)) {
    hi = 0x0149;
    lo = 0x88f0;
    w16(0x34, hi);
    w16(0x32, lo);
  }
  // CODE_80ADBF: hours = frames / 60 / 60 / 60
  w16(0x3e, lo);
  w16(0x40, hi);
  divide(lo, hi);
  divide(r16(0x38), r16(0x3a));
  divide(r16(0x38), r16(0x3a));
  w16(0x32, vram);
  const hours = r16(0x38);
  reg.a = digitPair(hours, false) & 0xff;
  CODE_80AF53();
  reg.a = digitPair(hours, true) & 0xff;
  CODE_80AF53();
  reg.a = 0x000a; // ":"
  CODE_80AF53();
  const vram2 = r16(0x32);
  // frames of the full hours: hours * 27000 * 8 (PPU multiplier)
  io8(PPU.mode_7_B, r16(0x38) & 0xff);
  io8(PPU.mode_7_A, 0x78);
  io8(PPU.mode_7_A, 0x69);
  let pLo = ioR16(PPU.multiply_result_low);
  let pHi = ioR16(PPU.multiply_result_high) & 0x00ff;
  for (let i = 0; i < 3; i++) {
    pHi = ((pHi << 1) | (pLo >> 15)) & 0xffff;
    pLo = (pLo << 1) & 0xffff;
  }
  w16(0x32, pLo);
  w16(0x34, pHi);
  const remLo = r16(0x3e) - pLo;
  const borrow = remLo < 0 ? 1 : 0;
  const remHi = (r16(0x40) - pHi - borrow) & 0xffff;
  // minutes = remaining frames / 60 / 60
  divide(remLo & 0xffff, remHi);
  divide(r16(0x38), r16(0x3a));
  w16(0x32, vram2);
  const minutes = r16(0x38);
  reg.a = digitPair(minutes, false);
  CODE_80AF53();
  reg.a = digitPair(minutes, true) & 0xff;
  CODE_80AF53();
  w16(0x32, (r16(0x32) + 3) & 0xffff);
  for (const o of [5, 6]) {
    const v = fb(o);
    reg.a = digitPair(v, false);
    CODE_80AF53();
    reg.a = digitPair(v, true);
    CODE_80AF53();
    w16(0x32, (r16(0x32) + (o === 5 ? 3 : 1)) & 0xffff);
  }
  // completion %
  const pct = fb(4);
  let last: number;
  if (pct >= 100) {
    reg.a = 0x0001;
    CODE_80AF53();
    reg.a = digitPair(pct - 100, false);
    CODE_80AF53();
    last = digitPair(pct - 100, true);
  } else {
    // CODE_80AF19: a leading blank; the tens digit is blank only for 0% (16-bit test)
    reg.a = 0x000c;
    CODE_80AF53();
    let t = digitPair(pct, false);
    if (!t) t = 0x000c;
    reg.a = t;
    CODE_80AF53();
    last = digitPair(pct, true);
  }
  // CODE_80AF44
  reg.a = last;
  CODE_80AF53();
  tilemap(PERCENT_TILEMAP, r16(0x32));
}

/** $80AF53 — A = digit/glyph: write its 2 tiles (top, bottom) at $32, then $32++. */
export function CODE_80AF53() {
  const x = ((reg.a & 0xff) << 1) & 0xffff;
  w16(0x34, bus16(DIGIT_TILES + x));
  w16(0x36, 0x00ed);
  const p = (0xed << 16) | r16(0x34);
  const v = r16(0x32);
  io16(PPU.vram_address, v);
  io16(PPU.vram_write, bus16(p));
  io16(PPU.vram_address, (v + 0x20) & 0xffff);
  io16(PPU.vram_write, bus16((p + 2) & 0xffffff));
  w16(0x32, (v + 1) & 0xffff);
  reg.x = x;
  reg.y = 2;
}

register({
  upload_fileselect_tilemap,
  upload_language_tilemap,
  upload_channel_count_tilemap,
  upload_file_tilemaps,
  get_file_status,
  upload_file_tilemap,
  CODE_80AD94,
  CODE_80AF53,
});
