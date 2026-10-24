/**
 * Bank $B5 — level bananas (bank_B5.asm $B5F0FD-$B5FA6B).
 *
 * Bananas placed in a level are not sprites: they are stored as bitmaps. Each banana group is a
 * 16-byte record in bank $7F starting at $7FA632 (offset X):
 *   +0 left X, +2 top Y, +4 columns*2, +6 width in pixels, +8 group enable bit (vs $0D30),
 *   +A pointer (bank $7F) to the bitmap: one word per column, one bit per row (bit 15 = top row),
 *   +C / +E links of two orderings used by the visibility cursor $0D2E.
 * Every frame the visible bananas are written straight into the OAM buffer through the WRAM port
 * ($2180), touched ones are cleared from the bitmap, and collected bananas fly to the counter
 * (up to 32 "flying bananas" at $7FD634/$7FD674 (X, X speed) and $7FD6B4/$7FD6F4 (Y, Y speed),
 * count*2-2 in $7FD632).
 */
import { r8, w8, r16, w16, rom8, rom16, bus16, busW16, io8, io16 } from "../../core/mem";
import { reg, register } from "../../core/cpu";
import { setRetMode, RET_RTS } from "../../core/hybrid";
import { L, R, C, WRAM } from "../../core/sym";
import { request_palette_direct_global } from "../../gen/routines";
import { queue_sound_effect } from "./b5c_common";

const GROUPS = 0x7fa632;
const g = (x: number, field: number) => r16((GROUPS + field + x) & 0xffffff);
const gw = (x: number, field: number, v: number) => w16((GROUPS + field + x) & 0xffffff, v & 0xffff);
const LEFT = 0;
const TOP = 2;
const COLS = 4;
const WIDTH = 6;
const ENABLE = 8;
const BITMAP = 0xa;
const LINK_A = 0xc; // $A63E
const LINK_B = 0xe; // $A640

const FLY_COUNT = 0x7fd632;
const FLY_X = 0x7fd634;
const FLY_DX = 0x7fd674;
const FLY_Y = 0x7fd6b4;
const FLY_DY = 0x7fd6f4;
const BANANA_DELTA = 0x7fd734; // BCD amount added per banana minus one

const HIGH_OAM = 0x03a0; // oam[$68].position: indexing with $38 = $60.. reaches the high table at $0400

const HIDE_ROWS_ABOVE = L("DATA_B5FAA2");
const HIDE_ROWS_BELOW = L("DATA_B5FAC4");
const ROWS_FROM_TOP = L("DATA_B5FAE4");
const ROWS_TO_BOTTOM = L("DATA_B5FB04");
const TILE_COLUMN = L("DATA_B5FB26");
const COLUMN_X = L("DATA_B5FB66");
const CLEAR_TOP_BIT = L("DATA_B5FBA8");
const ROW_Y_HIGH = L("DATA_B5FCA8");
const ROW_Y_LOW = L("DATA_B5FDA8");
const HIGH_OAM_KEEP = L("DATA_B5F538");
const HIGH_OAM_SENTINEL = L("DATA_B5F53C");
const BIT_TABLE = L("DATA_B5F38D");
const BANANA_SHAPES = L("DATA_B5F3AD");
const LEVEL_BANANAS = L("DATA_FDAC4B");
const BANANA_DATA_BASE = L("DATA_FDAC49");
const SHIFT_ROUTINE_END = L("CODE_B5F3E8") & 0xffff;
const GLOBAL_SPRITE_PALETTE = L("global_sprite_palette");

const neg = (v: number) => (v & 0x8000) !== 0;

/** 16-bit decimal-mode ADC, as the reference 65816 implements it. */
function adcBcd16(a: number, b: number, carry: number): number {
  let r = (b & 0xf) + (a & 0xf) + carry;
  if (r > 0x9) r = ((r + 0x6) & 0xf) + 0x10;
  r = (a & 0xf0) + (b & 0xf0) + r;
  if (r > 0x9f) r = ((r + 0x60) & 0xff) + 0x100;
  r = (a & 0xf00) + (b & 0xf00) + r;
  if (r > 0x9ff) r = ((r + 0x600) & 0xfff) + 0x1000;
  r = (a & 0xf000) + (b & 0xf000) + r;
  if (r > 0x9fff) r = r + 0x6000;
  return r & 0xffff;
}
/** `LDA $7FD734; SED; SEC; ADC counter; BPL +; LDA #0; + STA counter; CLD` */
function addBananaTo(counter: number) {
  let v = adcBcd16(r16(BANANA_DELTA), r16(counter), 1);
  if (neg(v)) v = 0;
  w16(counter, v);
}

// =====================================================================================

/** $B5F0FD — per frame (from render_sprites): update the cursor, collect, draw. */
export function CODE_B5F0FD() {
  CODE_B5F3E9();
  CODE_B5F75D();
  CODE_B5F4C4();
}

/** $B5F3E9 — move the group cursor $0D2E to follow the camera. */
export function CODE_B5F3E9() {
  let a = r16(R.screen_scroll_x_position) - 0x107;
  if (a < 0 || neg(a)) a = 0;
  w16(0x0044, a);
  a = r16(0x17c2) - 0x8f;
  if (a < 0 || neg(a)) a = 0;
  w16(0x0046, a);
  const minX = r16(0x0044);
  const minY = r16(0x0046);
  const cur = r16(0x0d2e);
  let x = cur;
  const store = (v: number) => w16(0x0d2e, v);
  if (g(x, LEFT) < minX) {
    if (g(x, TOP) < minY) {
      x = g(x, LINK_B);
      if (g(x, LEFT) < minX) return store(x);
      x = (cur + 0x10) & 0xffff;
      const t = g(x, TOP);
      if (t < g(x, TOP - 0x10)) return;
      if (t < minY) store(x);
      return;
    }
    // $B5F43B
    x = g(x, LINK_B);
    if (g(x, LEFT) < minX) return store(x);
    const p = cur - 0x10;
    if (p < 0 || neg(p)) return;
    x = p;
    const t = g(x, TOP);
    if (t >= g(x, TOP + 0x10)) return;
    if (t < minY) return;
    return store(x);
  }
  // $B5F463
  if (g(x, LEFT) === 0xffff) return; // end marker
  if (g(x, TOP) < minY) {
    const l = g(x, LINK_A);
    if (!neg(l)) {
      x = l;
      if (g(x, LEFT) >= minX) return store(x);
      store(x);
    }
    // $B5F480
    x = (r16(0x0d2e) + 0x10) & 0xffff;
    const t = g(x, TOP);
    if (t < g(x, TOP - 0x10)) return;
    if (t < minY) store(x);
    return;
  }
  // $B5F496
  const l = g(x, LINK_A);
  if (!neg(l)) {
    x = l;
    if (g(x, LEFT) >= minX) return store(x);
    store(x);
  }
  // $B5F4A9
  const p = r16(0x0d2e) - 0x10;
  if (p < 0 || neg(p)) return;
  x = p;
  const t = g(x, TOP);
  if (t >= g(x, TOP + 0x10)) return;
  if (t < minY) return;
  store(x);
}

/** $B5F4C4 — write the visible bananas and the flying bananas into OAM (through the WRAM port). */
export function CODE_B5F4C4() {
  const slot = r16(R.next_oam_slot);
  if (slot >= 0x0400) return;
  io16(WRAM.address, slot);
  io16(WRAM.bank, 0);
  let a = ((slot - 0x0200) & 0xffff) >> 2; // OAM entry number
  // 8-bit from here
  w8(0x0032, a & 0xff);
  const y = a & 0x03;
  a = (((a & 0xff) ^ y) >> 2) + 0x60;
  w8(0x0038, a & 0xff);
  // the high-table byte, keeping the entries already used, with a sentinel bit above them
  let b = (r8(HIGH_OAM + (a & 0xff)) & rom8(HIGH_OAM_KEEP + y)) | rom8(HIGH_OAM_SENTINEL + y);
  let c = 1;
  do {
    for (let i = 0; i < 2; i++) {
      const nc = (b >> 7) & 1;
      b = ((b << 1) | c) & 0xff;
      c = nc;
    }
  } while (!c);
  w8(0x004a, b);
  w8(0x003b, 0x7f);
  CODE_B5F540();
  CODE_B5F9F5();
  const idx = r16(0x0038);
  if (idx & 0x0080) return; // OAM full
  // flush the partial high-table byte and point next_oam_slot after the last entry
  const yy = ((idx - 0x60) & 0xffff) & 0x001f;
  w16(R.next_oam_slot, (yy << 4) + 0x200);
  let x = 4;
  let v = r8(0x004a);
  let carry: number;
  do {
    x--;
    v >>= 1;
    carry = v & 1;
    v >>= 1;
  } while (!carry);
  w8(0x0400 + yy, v);
  w16(R.next_oam_slot, ((x << 2) + r16(R.next_oam_slot)) & 0xffff);
}

/** $B5F540 — walk the groups around the cursor and draw/collect the visible ones. */
export function CODE_B5F540() {
  w16(0x0044, r16(R.screen_scroll_x_position) + 0x100);
  w16(0x0046, r16(R.screen_scroll_y_position) + 0xe0);
  let a = r16(0x0046) - 0x167;
  if (a < 0 || neg(a)) a = 0;
  w16(0x0048, a);
  const maxX = r16(0x0044);
  const maxY = r16(0x0046);
  const minY = r16(0x0048);
  let x = r16(0x0d2e);
  // label-by-label state machine (the original jumps between these freely)
  let at: "F561" | "F57E" | "F5B6" | "F59A" | "F5AF" = "F561";
  for (;;) {
    switch (at) {
      case "F561": {
        const d = g(x, LEFT) - maxX;
        if (d >= 0) return; // past the right edge of the screen: done
        const e = (((d & 0xffff) + g(x, WIDTH)) & 0xffff) + 0x10f + (((d & 0xffff) + g(x, WIDTH)) > 0xffff ? 1 : 0);
        if (neg(e & 0xffff)) {
          at = "F59A";
          break;
        }
        const t = g(x, TOP);
        if (t >= maxY) {
          at = "F5AF";
          break;
        }
        at = t >= minY ? "F5B6" : "F57E";
        break;
      }
      case "F57E": {
        x = (x + 0x10) & 0xffff;
        const t = g(x, TOP);
        if (t < g(x, TOP - 0x10)) {
          // $B5F593
          x = g(x, LINK_B - 0x10);
          at = "F561";
          break;
        }
        at = t < minY ? "F57E" : "F561";
        break;
      }
      case "F59A": {
        const t = g(x, TOP);
        if (t >= g(x, TOP + 0x10) || t >= maxY) {
          at = "F5AF";
          break;
        }
        x = (x + 0x10) & 0xffff;
        at = "F561";
        break;
      }
      case "F5AF":
        x = g(x, LINK_B);
        at = "F561";
        break;
      case "F5B6": {
        if (g(x, ENABLE) & r16(0x0d30)) {
          reg.x = x;
          CODE_B5F5E1();
          reg.x = x;
          CODE_B5F79A();
        }
        // $B5F5C8
        x = (x + 0x10) & 0xffff;
        if (g(x, TOP) >= g(x, TOP - 0x10)) {
          at = "F561";
          break;
        }
        x = g(x, LINK_B - 0x10);
        at = "F561";
        break;
      }
    }
  }
}

/** $B5F5E1 — X = group: emit OAM entries for its bananas that are on screen. */
export function CODE_B5F5E1() {
  const x = reg.x;
  // vertical: screen Y and the mask of rows inside the screen
  let a = g(x, TOP) - r16(R.screen_scroll_y_position);
  w16(0x003e, a);
  let rows: number;
  if (a < 0) {
    a = ((a & 0xffff) + 0x8f) & 0xffff;
    rows = rom16(HIDE_ROWS_ABOVE + ((a >> 3) << 1));
  } else {
    let yi = 0;
    a -= 0x60;
    if (a >= 0) yi = ((a & 0xffff) >> 3) << 1;
    rows = rom16(HIDE_ROWS_BELOW + yi);
  }
  w16(0x0040, rows);
  // horizontal: first visible column and the number of columns
  a = g(x, LEFT) - r16(R.screen_scroll_x_position);
  w16(0x003c, a);
  let cols: number;
  if (a < 0 && (a & 0xffff) + 0x0f <= 0xffff) {
    // starts left of the screen: skip the hidden columns
    a = ((((a & 0xffff) + 0x0f) & 0xffff) + g(x, WIDTH)) & 0xffff;
    cols = (a >> 3) << 1;
    w16(0x0032, cols);
    const first = (g(x, COLS) - cols) & 0xffff;
    w16(0x0039, first + g(x, BITMAP));
    const s = ((first << 2) & 0xffff) + r16(0x003c) + ((first << 1) & 0x8000 ? 1 : 0);
    w16(0x003c, s);
  } else {
    // $B5F63F
    a = (((0x0107 - r16(0x003c)) & 0xffff) >> 3) << 1;
    if (a >= g(x, COLS)) a = g(x, COLS);
    w16(0x0032, a);
    w16(0x0039, g(x, BITMAP));
  }
  // $B5F65B: banana animation frame, offset per group so they don't spin in sync
  const f = r16(R.active_frame_counter);
  const v = (f >> 1) & 0xffff;
  let t = (((v << 2) & 0xffff) + g(x, LEFT) + ((v << 1) & 0x8000 ? 1 : 0)) & 0xffff;
  t = (t + g(x, TOP)) & 0xffff;
  t = ((t >> 2) + r16(0x0039)) & 0xffff;
  t = (t - g(x, BITMAP)) & 0x000e;
  w16(0x0042, t | r16(0x0d2c));
  // $B5F681: draw, column by column from the right
  let y = r8(0x0032);
  w16(0x003e, r16(0x003e) - 1);
  const ptr = (r8(0x003b) << 16) | r16(0x0039);
  for (;;) {
    y = (y - 2) & 0xff;
    if (y & 0x80) return;
    const m = bus16((ptr + y) & 0xffffff) & r16(0x0040);
    if (m === 0) continue;
    if (m >> 8 && !drawColumn(y, m >> 8, ROW_Y_HIGH)) return;
    if (m & 0xff && !drawColumn(y, m & 0xff, ROW_Y_LOW)) return;
  }
}

/** $B5F696 / $B5F6F9 — one OAM entry per set bit (highest bit first). False when OAM is full. */
function drawColumn(y: number, bits: number, rowTable: number): boolean {
  let x = bits;
  while (x !== 0) {
    const sx = (r16(0x003c) + rom16(COLUMN_X + y)) & 0xffff;
    io8(WRAM.data, sx & 0xff);
    const ry = rom8(rowTable + x);
    io8(WRAM.data, (r8(0x003e) + ry + 1) & 0xff);
    io8(WRAM.data, ((((ry >> 2) + rom8(TILE_COLUMN + y)) & 0x0e) + r8(0x0042)) & 0xee);
    io8(WRAM.data, r8(0x0043));
    // two high-table bits: X bit 8 (sign of the screen X) and size
    let b = r8(0x004a);
    const c1 = (sx >> 15) & 1;
    let c = b & 1;
    b = (b >> 1) | (c1 << 7);
    const c2 = b & 1;
    b = (b >> 1) | 0x80;
    c = c2;
    if (c) {
      const i = r8(0x0038);
      w8(HIGH_OAM + i, b);
      const ni = (i + 1) & 0xff;
      w8(0x0038, ni);
      if (ni & 0x80) {
        w16(R.next_oam_slot, 0x0400);
        return false;
      }
      w8(0x004a, 0x80);
    } else {
      w8(0x004a, b);
    }
    x = rom8(CLEAR_TOP_BIT + x);
  }
  return true;
}

/** $B5F75D — collect the player clipping boxes the bananas are tested against. */
export function CODE_B5F75D() {
  w16(0x0d42, 0);
  w16(0x0d44, 0);
  reg.y = 0;
  reg.x = 0x09b3; // sprite_clipping[2]
  CODE_B5F77A();
  reg.x = 0x09eb; // sprite_clipping[9]
  CODE_B5F77A();
  if (reg.y >= 4) return;
  reg.x = 0x09cb; // sprite_clipping[5]
  CODE_B5F77A();
}

/** $B5F77A — X = clipping box: add it to the box list at $0D3A (Y = list offset). */
export function CODE_B5F77A() {
  const x = reg.x;
  const y = reg.y;
  const right = r16(x + 4);
  if (right === 0) return;
  w16(0x0d42 + y, right - r16(x));
  w16(0x0d3a + y, r16(x));
  w16(0x0d3e + y, r16(x + 2));
  w16(0x0d46 + y, r16(x + 6) - r16(x + 2));
  reg.y = y + 2;
}

/** $B5F79A — X = group: collect the bananas touching the player boxes. */
export function CODE_B5F79A() {
  const x = reg.x;
  w16(0x003e, g(x, TOP));
  w16(0x0032, g(x, COLS) - 2);
  if (r16(0x0d44) !== 0) {
    reg.x = x;
    reg.y = 2;
    CODE_B5F7BE();
  }
  if (r16(0x0d42) === 0) return;
  reg.x = x;
  reg.y = 0;
  CODE_B5F7BE();
}

/** $B5F7BE — X = group, Y = box: clear and collect the bananas inside the box. */
export function CODE_B5F7BE() {
  const x = reg.x;
  const y = reg.y;
  const gx = g(x, LEFT);
  w16(0x003c, gx);
  let a = r16(0x0d3a + y) - gx;
  w16(0x0034, a);
  let count: number;
  const lastCol = r16(0x0032);
  const clampCol = (v: number) => (v > lastCol ? lastCol : v);
  if (a < 0 || a - 8 < 0) {
    // the box starts left of the group (or in its first column)
    if (a >= 0) a = r16(0x0034);
    a = (a - 1 + r16(0x0d42 + y)) & 0xffff;
    if (neg(a)) return;
    count = clampCol((a >> 3) << 1);
    w16(0x0039, g(x, BITMAP));
  } else {
    // $B5F7F1
    a = ((a - 8) >> 3) << 1;
    if (a > lastCol) return;
    w16(0x0039, a);
    const c = (a << 1) & 0x8000 ? 1 : 0;
    w16(0x003c, ((a << 2) & 0xffff) + r16(0x003c) + c);
    w16(0x0034, r16(0x0034) - 1);
    a = clampCol((((r16(0x0034) + r16(0x0d42 + y)) & 0xffff) >> 3) << 1);
    count = (a - r16(0x0039)) & 0xffff;
    w16(0x0039, r16(0x0039) + g(x, BITMAP));
  }
  // $B5F824: rows covered by the box
  a = (r16(0x0d3e + y) - r16(0x003e)) & 0xffff;
  w16(0x0036, a);
  let mask: number;
  if (neg(a) || a < 8) {
    a = (a - 1 + r16(0x0d46 + y)) & 0xffff;
    if (neg(a)) return;
    mask = rom16(ROWS_FROM_TOP + ((a >> 3) << 1));
  } else {
    a -= 8;
    if (a >= 0x80) return;
    mask = rom16(ROWS_TO_BOTTOM + ((a >> 3) << 1));
    a = (r16(0x0036) - 1 + r16(0x0d46 + y)) & 0xffff;
    mask &= rom16(ROWS_FROM_TOP + ((a >> 3) << 1));
  }
  w16(0x0040, mask);
  // $B5F86D
  const ptr = (r8(0x003b) << 16) | r16(0x0039);
  let col = count;
  for (;;) {
    const addr = (ptr + col) & 0xffffff;
    const hit = bus16(addr) & mask;
    if (hit) {
      busW16(addr, hit ^ bus16(addr));
      const cy = col & 0xff;
      for (let b = hit & 0xff; b; b = rom8(CLEAR_TOP_BIT + b)) {
        reg.a = rom16(ROW_Y_LOW + b);
        reg.x = b;
        reg.y = cy;
        CODE_B5F8A4();
      }
      for (let b = hit >> 8; b; b = rom8(CLEAR_TOP_BIT + b)) {
        reg.a = rom16(ROW_Y_HIGH + b);
        reg.x = b;
        reg.y = cy;
        CODE_B5F8A4();
      }
      col = cy;
    }
    col = (col - 2) & 0xffff;
    if (neg(col)) return;
  }
}

/** $B5F8A4 — A = row Y offset, Y = column: count a banana and launch a flying banana. */
export function CODE_B5F8A4() {
  const x = reg.x & 0xff;
  const row = reg.a & 0xffff;
  const y = reg.y & 0xff;
  reg.a = (6 << 8) | C.sound_banana;
  queue_sound_effect();
  addBananaTo(R.banana_count);
  w16(R.banana_display_timer, 0x003c);
  const n = (r16(FLY_COUNT) + 2) & 0xffff;
  if (n >= 0x0040) {
    // no free flying banana: count it directly
    addBananaTo(R.banana_counter_final);
    reg.x = x;
    reg.y = y;
    return;
  }
  w16(FLY_COUNT, n);
  const i = n & 0xff;
  let sy = (((row & 0xff) + r16(0x003e)) & 0xffff) - r16(R.screen_scroll_y_position);
  if (sy < 0) sy = 0;
  else if (sy >= 0xe0) sy = 0xe0;
  let sx = ((rom16(COLUMN_X + y) + r16(0x003c)) & 0xffff) - r16(R.screen_scroll_x_position);
  if (sx < 0) sx = 0;
  else if (sx >= 0xf0) sx = 0xf0;
  launch(i, sy, sx);
  reg.x = x;
  reg.y = y;
}

/** Start flying banana I from screen position (sx, sy) towards the banana counter. */
function launch(i: number, sy: number, sx: number) {
  let v = sy << 8;
  w16(FLY_Y + i, v);
  w16(FLY_DY + i, (0x40 - (v >> 5)) & 0xffff);
  v = sx << 8;
  w16(FLY_X + i, v);
  w16(FLY_DX + i, (0x40 - (v >> 5)) & 0xffff);
}

/** $B5F94C — X = offset (high byte Y, low byte X, signed) from current_sprite: a banana collected by a sprite (bunch). */
export function CODE_B5F94C() {
  w16(0x0032, reg.x);
  reg.a = (6 << 8) | C.sound_banana;
  queue_sound_effect();
  w16(R.banana_display_timer, 0x003c);
  const n = (r16(FLY_COUNT) + 2) & 0xffff;
  if (n >= 0x0040) {
    addBananaTo(R.banana_counter_final);
    return;
  }
  w16(FLY_COUNT, n);
  const sp = r16(R.current_sprite);
  const off = r16(0x0032);
  const dy = (off >> 8) & 0xff;
  const dx = off & 0xff;
  const sext = (b: number) => (b & 0x80 ? b | 0xff00 : b);
  let sy = ((sext(dy) + r16(sp + 0x0a)) & 0xffff) - r16(R.screen_scroll_y_position);
  if (sy < 0) sy = 0;
  else if (sy >= 0xe0) sy = 0xe0;
  let sx = ((sext(dx) + r16(sp + 6)) & 0xffff) - r16(R.screen_scroll_x_position);
  if (sx < 0) sx = 0;
  else if (sx >= 0xf0) sx = 0xf0;
  launch(n, sy, sx);
  reg.x = n;
  reg.y = sp;
}

/** $B5F9F5 — move and draw the flying bananas; those reaching the counter are added to it. */
export function CODE_B5F9F5() {
  let x = r16(FLY_COUNT);
  if (neg(x)) return;
  for (;;) {
    w16(FLY_X + x, r16(FLY_X + x) + r16(FLY_DX + x));
    const ny = (r16(FLY_Y + x) + r16(FLY_DY + x)) & 0xffff;
    w16(FLY_Y + x, ny);
    const t = ((ny >> 1) | (ny >= 0x0800 ? 0x8000 : 0)) ^ r16(FLY_DY + x);
    if (neg(t)) {
      // arrived: count it and replace it by the last flying banana
      addBananaTo(R.banana_counter_final);
      const last = r16(FLY_COUNT);
      w16(FLY_X + x, r16(FLY_X + last));
      w16(FLY_DX + x, r16(FLY_DX + last));
      w16(FLY_Y + x, r16(FLY_Y + last));
      w16(FLY_DY + x, r16(FLY_DY + last));
      w16(FLY_COUNT, last - 2);
    } else {
      x &= 0xff;
      io8(WRAM.data, r8(FLY_X + 1 + x));
      io8(WRAM.data, r8(FLY_Y + 1 + x));
      io8(WRAM.data, ((r8(R.active_frame_counter) & 0x0e) + r8(0x0d2c)) & 0xff);
      io8(WRAM.data, r8(0x0d2d) | 0x30);
      const b0 = r8(0x004a);
      let b = b0 >> 1;
      const c = b & 1;
      b = (b >> 1) | 0x80;
      if (c) {
        w8(HIGH_OAM + r8(0x0038), b);
        const ni = (r8(0x0038) + 1) & 0xff;
        w8(0x0038, ni);
        if (ni & 0x80) {
          w16(R.next_oam_slot, 0x0400);
          return;
        }
        w8(0x004a, 0x80);
      } else {
        w8(0x004a, b);
      }
    }
    // $B5FA4F
    x = (x - 2) & 0xffff;
    if (neg(x)) return;
  }
}

// =====================================================================================
// Level load
// =====================================================================================

/**
 * $B5F109 — level load: unpack the level's banana groups into bank $7F and build the two
 * orderings used by the visibility cursor; reset the counters and flying bananas.
 */
export function CODE_B5F109() {
  const db = reg.db;
  reg.a = GLOBAL_SPRITE_PALETTE & 0xffff;
  reg.db = 0xb5;
  request_palette_direct_global();
  reg.db = db;
  w16(0x0d2c, (((reg.a + 0x01e0) & 0xffff) | 0x2000) & 0xffff);
  w16(BANANA_DELTA, 0);
  let a = r16(R.banana_count);
  if (a >= 0x0109) a = 0x0109;
  w16(R.banana_counter_final, a);
  if (a >= 0x0099) a = 0x0099;
  w16(R.banana_counter_current, a);
  w16(0x0d30, 0x0001);
  w16(0x0d2e, 0);
  w16(0x004e, 0);
  w16(0x0050, 0);
  w16(0x0044, 0x00fd);
  const ab4 = r16(0x0ab4);
  const shape = BANANA_SHAPES + ((((ab4 << 1) & 0xffff) + ab4 + (ab4 & 0x8000 ? 1 : 0)) << 1 & 0xffff);
  w16(0x003c, rom16(shape));
  w16(0x003e, rom16(shape + 2));
  w16(0x0036, rom16(shape + 4));
  const lvl = (r16(R.level_number) << 1) & 0xffff;
  w16(0x0034, ((rom16(LEVEL_BANANAS + 2 + lvl) - rom16(LEVEL_BANANAS + lvl)) & 0xffff) >> 2);
  let x = rom16(LEVEL_BANANAS + lvl);
  let y = 0;
  w16(0x0039, 0xb232);
  const ent = (o: number) => rom16(((LEVEL_BANANAS & 0xff0000) | ((LEVEL_BANANAS + o) & 0xffff)) + x);
  for (;;) {
    // $B5F18A
    const cnt = (r16(0x0034) - 1) & 0xffff;
    w16(0x0034, cnt);
    if (neg(cnt)) break;
    gw(y, ENABLE, rom16(BIT_TABLE + ((ent(0) & 0x000f) << 1)));
    gw(y, LEFT, ((ent(0) >> 1) & r16(0x003c)) + 0x100);
    // JMP ($0036): shift the Y field right (by 0-5) for this shape
    let v = ent(1);
    const n = SHIFT_ROUTINE_END - r16(0x0036);
    for (let i = 0; i < n; i++) v >>= 1;
    gw(y, TOP, (v & r16(0x003e)) + 0x100);
    gw(y, BITMAP, r16(0x0039));
    // banana shape data (two levels of offsets from $FDAC49)
    const base = rom16(BANANA_DATA_BASE);
    w16(0x0042, (((ent(3) & 0xff) << 1) + base) & 0xffff);
    const p1 = 0xfd0000 | r16(0x0042);
    w16(0x0042, (bus16(p1) + base) & 0xffff);
    const p = 0xfd0000 | r16(0x0042);
    const cols = bus16(p) & 0xff;
    w16(0x0040, cols);
    gw(y, COLS, cols << 1);
    gw(y, WIDTH, cols << 3);
    // build the list in decreasing-Y runs (link A goes back, link B forward)
    a = g(y, TOP) - r16(0x0050) - 1;
    if (a < 0 || neg(a)) {
      gw(y, LINK_A, r16(0x004e));
      gw(r16(0x004e), LINK_B, y);
      w16(0x004e, y);
    }
    w16(0x0050, g(y, TOP));
    // $B5F209: unpack the bitmap, one word per column
    const rowBit = rom16(BIT_TABLE - 2 + ((bus16(p + 1) << 1) & 0x7f));
    w16(0x004c, rowBit);
    w16(0x004a, rowBit);
    let dst = r16(0x0039);
    let yy = 2;
    let acc = 0;
    let c = 0;
    let colsLeft = cols;
    let reload = true;
    for (;;) {
      if (reload) {
        acc = bus16(p + yy);
        yy += 2;
        c = 1;
      }
      // $B5F228: ROR A
      const nc = acc & 1;
      acc = (acc >> 1) | (c << 15);
      c = nc;
      if (acc === 0) {
        reload = true;
        continue;
      }
      reload = false;
      // ROR $4A
      const bits = r16(0x004a);
      const out = bits & 1;
      w16(0x004a, (bits >> 1) | (c << 15));
      c = out;
      if (!c) continue;
      // a column is complete
      w16(0x7f0000 | dst, r16(0x004a));
      w16(0x004a, r16(0x004c));
      dst = (dst + 2) & 0xffff;
      colsLeft = (colsLeft - 1) & 0xffff;
      w16(0x0040, colsLeft);
      c = 0;
      if (colsLeft === 0) break;
    }
    w16(0x0032, acc);
    w16(0x0039, dst);
    x = (x + 4) & 0xffff;
    y = (y + 0x10) & 0xffff;
  }
  // $B5F255: terminator record
  x = y;
  w16(0x0044, x);
  gw(x, TOP, 0);
  gw(x, BITMAP, 0);
  gw(x, LINK_B, 0);
  gw(x, LEFT, 0xffff);
  gw(x, LINK_A, r16(0x004e));
  gw(r16(0x004e), LINK_B, x);
  if (x !== 0) sortLinks();
  // $B5F36F
  w16(FLY_COUNT, 0xfffe);
  w16(0x0d36, 0x0001);
  // `LDA active_kong_sprite` runs with DB=$7F here, so it actually reads $7F0593
  w16(0x0d32, r16(0x7f0000 | R.active_kong_sprite));
  w16(0x0d38, 0);
}

/** $B5F27F-$B5F36C — fill in the two link orderings over all records (transcribed literally). */
function sortLinks() {
  const LA = (x: number) => g(x, LINK_A);
  const sub10 = (v: number, carry: boolean) => (v - 0x10 - (carry ? 0 : 1)) & 0xffff;
  // ---- first pass: link A ----
  let x: number;
  let carry = true;
  for (;;) {
    // $B5F27F
    x = r16(0x0044);
    carry = x >= 0x10;
    w16(0x0042, (x - 0x10) & 0xffff);
    const a = LA(x);
    if (a === 0) break; // $B5F2EB
    w16(0x0044, a);
    if (a === r16(0x0042)) continue;
    x = a;
    w16(0x0046, (a - 0x10) & 0xffff);
    w16(0x0048, LA(x));
    x = r16(0x0046);
    w16(0x0036, g(x, TOP));
    x = r16(0x0042);
    // $B5F2AB
    let at = "F2AB";
    for (;;) {
      if (at === "F2AB") {
        if (g(x, TOP) < r16(0x0036)) {
          // $B5F2C4
          const v = r16(0x0046);
          if (v === r16(0x0048)) {
            at = "F2DA";
            continue;
          }
          const nv = sub10(v, v >= r16(0x0048));
          w16(0x0046, nv);
          w16(0x0036, g(nv, TOP));
          continue;
        }
        gw(x, LINK_A, r16(0x0046));
        x = (x - 0x10) & 0xffff;
        if (x !== r16(0x0044)) continue;
        break;
      } else {
        // $B5F2DA
        gw(x, LINK_A, r16(0x0046));
        if (x === r16(0x0044)) break;
        x = sub10(x, x >= r16(0x0044));
      }
    }
  }
  // $B5F2EB
  x = r16(0x0042);
  for (;;) {
    gw(x, LINK_A, 0xffff);
    const nx = x - 0x10 - (carry ? 0 : 1);
    carry = nx >= 0;
    x = nx & 0xffff;
    if (!carry) break;
  }
  w16(0x0044, 0);
  // ---- second pass: link B ----
  for (;;) {
    // $B5F2FD
    x = r16(0x0044);
    w16(0x0042, (x + 0x10) & 0xffff);
    const a = g(x, LINK_B);
    if (a === 0) return;
    w16(0x0044, a);
    if (a === r16(0x0042)) continue;
    w16(0x0046, a);
    x = a;
    w16(0x0048, g(x, LINK_B));
    w16(0x0036, (g(x, TOP) + 0x167) & 0xffff);
    x = r16(0x0042);
    // $B5F327
    for (;;) {
      if (g(x, TOP - 0x10) >= r16(0x0036)) {
        // $B5F340
        const v = (r16(0x0046) + 0x10) & 0xffff;
        if (v >= r16(0x0048)) {
          // $B5F35C
          do {
            gw(x, LINK_B, r16(0x0046));
            x = (x + 0x10) & 0xffff;
          } while (x < r16(0x0044));
          break;
        }
        w16(0x0046, v);
        w16(0x0042, x);
        w16(0x0036, (g(v, TOP) + 0x167) & 0xffff);
        x = r16(0x0042);
        continue;
      }
      gw(x, LINK_B, r16(0x0046));
      x = (x + 0x10) & 0xffff;
      if (x < r16(0x0044)) continue;
      break;
    }
  }
}

/** $B5F3E3-$B5F3E8: shift helpers dispatched through DATA_B5F3AD (A >>= 5..0). */
const shiftHelper = (n: number) => () => {
  reg.a = (reg.a & 0xffff) >> n;
};
export const CODE_B5F3E3 = shiftHelper(5);
export const CODE_B5F3E4 = shiftHelper(4);
export const CODE_B5F3E5 = shiftHelper(3);
export const CODE_B5F3E6 = shiftHelper(2);
export const CODE_B5F3E7 = shiftHelper(1);
export const CODE_B5F3E8 = shiftHelper(0);

register({
  CODE_B5F3E3,
  CODE_B5F3E4,
  CODE_B5F3E5,
  CODE_B5F3E6,
  CODE_B5F3E7,
  CODE_B5F3E8,
  CODE_B5F77A,
  CODE_B5F0FD,
  CODE_B5F3E9,
  CODE_B5F4C4,
  CODE_B5F540,
  CODE_B5F5E1,
  CODE_B5F75D,
  CODE_B5F79A,
  CODE_B5F7BE,
  CODE_B5F8A4,
  CODE_B5F94C,
  CODE_B5F9F5,
  CODE_B5F109,
});

// the generated stubs guess RTL for these; they return with RTS
for (const n of ["CODE_B5F3E3", "CODE_B5F3E4", "CODE_B5F3E5", "CODE_B5F3E6", "CODE_B5F3E7"]) setRetMode(L(n), RET_RTS);
