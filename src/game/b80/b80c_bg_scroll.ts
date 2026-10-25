/**
 * Bank $80 (package b80c) — background effects computed every frame for the ship and ship-hold
 * levels: the parallax of the ship deck rigging, the scrolling sea/sky line tables, the
 * pseudo-3D background of the ship hold and the water surface effect (Lockjaw's Locker, Lava
 * Lagoon). They fill per-scanline tables in WRAM ($7E8000+) that HDMA channels feed to the PPU.
 *
 * These routines are written as straight translations: they keep their direct-page scratch in
 * WRAM exactly like the original, because several of them read back overlapping bytes of it
 * (e.g. `LDA $33` / `LDA $35`).
 */
import { r8, w8, r16, w16, bus8, busW8, busW16, io8, io16, ioR8, ioR16 } from "../../core/mem";
import { reg, register } from "../../core/cpu";
import { setRetMode, RET_RTS, RET_RTL } from "../../core/hybrid";
import { L, R, C, CPU, level } from "../../core/sym";
import { adc16, flags, xba } from "../../core/ops";

const W = 0x7e0000; // DB = $7E: absolute $8xxx operands are WRAM $7E8xxx

/** Absolute (DB-relative) 16-bit store. */
const absW16 = (a: number, v: number) => busW16((reg.db << 16) | a, v);
/** Absolute (DB-relative) 8-bit load / store. */
const absR8 = (a: number) => bus8((reg.db << 16) | a);
const absW8 = (a: number, v: number) => busW8((reg.db << 16) | a, v);

const inc16 = (a: number) => w16(a, (r16(a) + 1) & 0xffff);
const asr16 = (v: number) => ((v & 0x8000) | ((v & 0xffff) >> 1)) & 0xffff;

// ---------------------------------------------------------------------------------------------
// Ship deck

/** $80E522 — (from bank $B5) update the rigging parallax and copy its scroll to $B8. */
export function CODE_80E522() {
  handle_ship_deck_rigging_scroll();
  w16(0xb8, r16(R.layer_screen_scroll_x_position));
  reg.a = r16(R.layer_screen_scroll_x_position);
}

/**
 * $80E52B — the rigging layer scrolls at 1.25x the camera. $B8 is the layer's offset, moved by
 * at most 8 pixels per frame towards the target; $B7 then gets (offset / 256) mod 5.
 */
export function handle_ship_deck_rigging_scroll() {
  const scroll = r16(R.screen_scroll_x_position);
  const target = ((scroll >> 2) + scroll) & 0xffff;
  const layer = r16(R.layer_screen_scroll_x_position);
  let a: number;
  if (target >= layer) {
    // .CODE_80E550: moving right, at most +8 (7 + the carry of the CMP)
    const d = target - layer;
    a = d < 8 ? (d + r16(0xb8)) & 0xffff : (7 + r16(0xb8) + 1) & 0xffff;
  } else {
    let d = (target - layer) & 0xffff;
    if (d < 0xfff8) d = 0xfff8; // at most -8
    a = (d + r16(0xb8)) & 0xffff;
    if (a >= 0xff00) a = 0; // (the offset never goes negative)
  }
  w16(0xb8, a);
  w16(0xb6, a);
  w16(R.layer_screen_scroll_x_position, target);
  // hardware divide through the data bank (absolute STA CPU.dividen / divisor)
  absW16(CPU.dividen, r8(0xb7));
  absW8(CPU.divisor, 0x05);
  const rem = absR8(CPU.multiply_result);
  w8(0xb7, rem);
  reg.a = rem;
  reg.y = target;
}

/**
 * $80E580 — the sea and sky behind the ship: per-scanline horizontal scroll values that move
 * slower towards the horizon (written into the HDMA tables at $7E801F..$7E812D), plus a slow
 * ripple that nudges some lines by a pixel depending on the frame counter.
 */
export function handle_ship_deck_water_sky_scroll() {
  const frame = r16(R.active_frame_counter);
  w16(W + 0x8013, frame >> 1);
  w16(W + 0x8016, frame >> 2);
  w16(W + 0x8019, frame >> 4);
  const v36 = (r16(R.screen_scroll_x_position) + frame) & 0xffff;
  w16(0x36, v36);
  w16(0x32, v36 >> 1);
  let a = ((v36 >> 2) + r16(0x32)) & 0xffff;
  a = (a + r16(0x36)) & 0xffff;
  // SEC : SBC #$2000 — its carry feeds the first ADC of the loop
  let c = a >= 0x2000;
  a = (a - 0x2000) & 0xffff;
  w16(0x32, a ^ 0xffff);
  a = r16(0x35) & 0xff00;
  // 17 groups of 8 lines, from the bottom up; each line adds the (fixed point) step
  const step = r16(0x32);
  for (let x = 0x0100; ; ) {
    for (const off of [0x802d, 0x802b, 0x8029, 0x8027, 0x8025, 0x8023, 0x8021, 0x801f]) {
      w16(W + off + x, a);
      a = adc16(a, step, c);
      c = flags.c;
    }
    x -= 0x10;
    c = true; // CPX #$0000
    if (x < 0) break;
  }
  // ripple
  reg.db = 0x7e;
  let x = 0;
  for (let t = ((frame >> 1) & 0x000e) + 0x0090; t >= 0; t -= 0x10) {
    x = t;
    inc16(W + 0x807e + x);
    inc16(W + 0x8080 + x);
    inc16(W + 0x8082 + x);
    inc16(W + 0x8082 + x);
    inc16(W + 0x8084 + x);
    inc16(W + 0x8084 + x);
    inc16(W + 0x8086 + x);
    inc16(W + 0x8088 + x);
  }
  for (let t = x + 0x0050; t >= 0; t -= 0x10) {
    inc16(W + 0x801e + t);
    inc16(W + 0x8020 + t);
    inc16(W + 0x8022 + t);
    inc16(W + 0x8024 + t);
  }
  reg.db = 0x80;
}

// ---------------------------------------------------------------------------------------------
// Ship hold: water surface and pseudo-3D background

/** $80E646 — ship hold levels: water surface tables, then the 3D background. */
export function handle_water_and_3D_bg_scroll() {
  reg.db = 0x7e;
  handle_water_scroll();
  reg.db = 0x80;
  handle_3d_bg_scroll();
}

/** Hardware divide: dividend (16-bit, written with STA.l) / divisor (8-bit). */
function divide(dividend: number, divisor: number) {
  io16(CPU.dividen, dividend & 0xffff);
  io8(CPU.divisor, divisor & 0xff);
}
function multiply(a: number, b: number) {
  io8(CPU.multiply_A, a & 0xff);
  io8(CPU.multiply_B, b & 0xff);
}

/**
 * $80E64E — the ship hold's pseudo-3D background: the back wall's line scroll table (perspective
 * of the horizontal scroll, $7E8065..$7E8070 then copied byte-swapped to $7E7FF4..), and the
 * HDMA line tables at $7E8552 (scroll per band) / $7E8812 (window/colour per band) built from
 * the vertical position of the camera: ceiling band, wall, floor band.
 */
export function handle_3d_bg_scroll() {
  reg.db = 0x7e;
  // --- horizontal perspective: 12 lines per group, 8 groups
  divide(r16(R.screen_scroll_x_position) >> 1, 0xb2);
  const rem = ioR16(CPU.divide_remainder);
  w16(0x34, rem);
  let a = ((rem & 0xff) << 8) >> 2;
  a = (a + r16(0x33)) & 0xffff;
  a = xba(a) & 0x00ff;
  let c = a >= 0x0074;
  a = ((a - 0x0074) & 0xffff) ^ 0xffff;
  w16(0x32, a);
  a = r16(0x33) & 0xff00;
  const step = r16(0x32);
  for (let x = 0x0060; x !== 0; x -= 0x000c) {
    for (let k = 0; k < 12; k++) {
      w16(W + 0x8070 - k + x, a);
      a = adc16(a, step, c);
      c = flags.c;
    }
    c = true; // CPX #$0000
  }
  // CODE_80E6DC: copy 48 words byte-swapped, reversing their order
  for (let x = 0x8072, y = 0x005e; y >= 0; x += 0x20, y -= 0x20) {
    for (let k = 0; k < 16; k++) w16(W + 0x8012 - 2 * k + y, xba(r16(W + x + 2 * k)));
  }
  // --- band offsets from the horizontal scroll (with 2 fraction bits)
  w16(0x36, r16(R.screen_scroll_x_sub_position_low));
  let sx = r16(R.screen_scroll_x_position);
  for (let i = 0; i < 2; i++) {
    const out = sx & 1;
    sx >>= 1;
    w16(0x36, ((r16(0x36) >> 1) | (out << 15)) & 0xffff);
  }
  divide(sx, 0xb2);
  a = (ioR8(CPU.divide_remainder_low) << 8) | r8(0x37);
  w16(0x34, a);
  w16(0x32, a >> 4);
  a = ((a >> 6) + r16(0x32)) & 0xffff;
  a = (a + r16(0x34)) & 0xffff;
  a = ((xba(a) & 0x00ff) + 4) & 0xffff;
  w16(0x3e, a);
  w16(0x40, a);
  // --- vertical: which part of the room is on screen
  divide(((r16(R.screen_scroll_y_position) + 0x0080) & 0xffff) >> 1, 0xd0);
  w16(0x74, (ioR16(CPU.divide_remainder) - 0x0075) & 0xffff);
  let x = (ioR16(CPU.divide_result_low) & 0x0001) << 1;
  w16(0x3e + x, (r16(0x3e + x) + 0x0030) & 0xffff);
  w16(0xb4, 0);
  w16(0x3c, 0);
  // double-buffered tables: odd frames build the second copy
  x = 0;
  let y = 0;
  if (r16(R.active_frame_counter) & 0x0001) {
    x = 0x0160;
    y = 0x0010;
  }
  w16(0x3c, y);
  const T = (o: number) => W + o + x; // $85xx,x
  const U = (o: number) => W + o + r16(0x3c); // $88xx,y with Y = $3C

  a = r16(0x74);
  if (a & 0x8000) {
    // the ceiling is visible
    a = (a ^ 0xffff) + 1;
    a &= 0xffff;
    if (a >= 0x0021) {
      a = (a - 0x0020) & 0xffff;
      w16(T(0x8552), a);
      w16(0xb4, a);
      w8(U(0x8812), a & 0xff);
      w8(U(0x8813), 0x79);
      w16(0x3c, (r16(0x3c) + 2) & 0xffff);
      w16(T(0x8553), r16(0x40));
      multiply(((r16(0x74) ^ 0xffff) + 1) & 0xff, 0x8b);
      const v = (0x3e - ioR8(CPU.multiply_result_high)) & 0xff;
      w16(T(0x8555), v);
      x += 5;
      a = 0x0020;
    }
    // CODE_80E846
    w16(T(0x8552), a);
    w16(0xb4, (a + r16(0xb4)) & 0xffff);
    const p = r8(W + 0x8012);
    w16(0x32, p);
    w16(T(0x8553), ((p >> 5) + p) & 0xffff);
    w16(T(0x8555), (r16(0x74) + 0x00df) & 0xffff);
    x += 5;
  }
  // CODE_80E86F: height of the back wall
  w16(0x3a, r16(0xb4));
  let a8 = r8(0x74);
  if (a8 & 0x80) {
    multiply((-a8) & 0xff, 0x76);
    a8 = (0x31 - ioR8(CPU.multiply_result_high)) & 0xff;
  } else {
    multiply(a8, 0x76);
    a8 = (0x32 + ioR8(CPU.multiply_result_high)) & 0xff;
  }
  a = a8 & 0x80 ? a8 | 0xff00 : a8;
  w16(0x7a, a);
  let skipWall = false;
  if (((a - 1) & 0xffff) >= 0x0080) {
    // the wall does not reach the screen: a single band
    w16(T(0x8552), (a + 0x0060) & 0xffff);
    w16(T(0x8553), r16(0x3e));
    w16(T(0x8555), ((r16(0xb4) + r16(0x7a)) & 0xffff) ^ 0xffff);
    x += 5;
    let b = (r8(0x74) - 0xe0) & 0xff;
    if (!(b & 0x80)) b = 0;
    b = (b + r8(0xb4)) & 0xff;
    w8(U(0x8812), b);
    w8(U(0x8813), 0x71);
    b = (r8(0x7a) + 0x60) & 0xff;
    w8(U(0x8814), b);
    w8(U(0x8815), 0x79);
    w16(0xb4, ((r16(T(0x854d)) & 0x00ff) + r16(0xb4)) & 0xffff);
    skipWall = true; // JMP CODE_80EA20
  }
  if (!skipWall) {
    // CODE_80E90C: upper wall, lines spaced by the perspective
    a = r16(0x74);
    if (a & 0x8000) a = 0;
    a = ((a ^ 0xffff) + 1 + r16(0x7a)) & 0xffff;
    w16(0x38, a);
    w16(T(0x8552), a | 0x0080);
    x += 1;
    w16(0xb4, ((a & 0x007f) + r16(0xb4)) & 0xffff);
    a = (0x005f - r16(0x7a)) & 0xffff;
    if (a & 0x8000) {
      // bug in the original: this STA CPU.dividen is absolute with DB = $7E, so it writes WRAM
      // $7E4204 and the divide uses whatever dividend the hardware still holds
      a = (a ^ 0xffff) + 1;
      w16(W + CPU.dividen, xba(a & 0xffff));
      io8(CPU.divisor, r8(0x7a));
      a = ((ioR16(CPU.divide_result) ^ 0xffff) + 1) & 0xffff;
    } else {
      divide(xba(a), r8(0x7a));
      a = ioR16(CPU.divide_result);
    }
    w16(0x32, a);
    a = r16(0x74);
    if (!(a & 0x8000)) {
      multiply(r8(0x74), r8(0x32));
      a = (r16(0x74) + ioR16(CPU.multiply_result_high) + 1) & 0xffff;
    }
    y = a;
    x = lineTable(x, y);
    a = (0x004f - r16(0x7a)) & 0xffff;
    if (a & 0x8000) {
      // the wall's bottom is below the screen
      w16(T(0x8552), (a + 0x0061) & 0xffff);
      w16(T(0x8553), r16(0x3e));
      w16(T(0x8555), r16(0xb4) ^ 0xffff);
      x += 5;
      w8(U(0x8812), r8(0xb4));
      w8(U(0x8813), 0x71);
      w8(U(0x8814), r8(T(0x854d)));
      w8(U(0x8815), 0x79);
      w16(0xb4, (r16(T(0x854d)) + r16(0xb4)) & 0xffff); // (no AND #$00FF here, unlike $80E8FE)
      w16(0x7a, (0x0050 - r16(0x7a)) & 0xffff);
      return floorBands(x);
    }
    // CODE_80E9DC
    w16(T(0x8552), 0x0060);
    w16(T(0x8553), r16(0x3e));
    w16(T(0x8555), r16(0xb4) ^ 0xffff);
    x += 5;
    let b = (r8(0x74) - 0xe0) & 0xff;
    if (!(b & 0x80)) b = 0;
    b = (b + r8(0xb4)) & 0xff;
    w8(U(0x8812), b);
    w8(U(0x8813), 0x71);
    w8(U(0x8814), 0x60);
    w8(U(0x8815), 0x79);
    w16(0xb4, (0x0060 + r16(0xb4)) & 0xffff);
  }
  // CODE_80EA20: lower wall
  a = (0x0050 - r16(0x7a)) & 0xffff;
  w16(0x7a, a);
  w16(0x38, a);
  w16(T(0x8552), a | 0x0080);
  x += 1;
  a = (0x0060 - r16(0x7a)) & 0xffff;
  if (a & 0x8000) {
    a = (a ^ 0xffff) + 1;
    divide(xba(a & 0xffff), r8(0x7a));
    a = ((ioR16(CPU.divide_result) ^ 0xffff) + 1) & 0xffff;
  } else {
    divide(xba(a), r8(0x7a));
    a = ioR16(CPU.divide_result);
  }
  w16(0x32, a);
  w16(0x3a, r16(0xb4));
  y = ((r16(0xb4) ^ 0xffff) + 0x0060 + 1) & 0xffff;
  a = (r16(0xb4) + r16(0x38)) & 0xffff;
  let draw = true;
  if (a >= 0x00e0) {
    a = (0x00e0 - r16(0xb4)) & 0xffff;
    if (a & 0x8000) draw = false;
    else w16(0x38, a);
  }
  if (draw) {
    w16(0xb4, (r16(0xb4) + r16(0x38)) & 0xffff);
    x = lineTable(x, y);
  }
  floorBands(x);
}

/** CODE_80EAA1..CODE_80EBB0: the floor bands below the wall (and a second wall copy). */
function floorBands(x: number) {
  const T = (o: number) => W + o + x;
  const U = (o: number) => W + o + r16(0x3c);
  w16(T(0x8552), 0x0020);
  w16(0xb4, (0x0020 + r16(0xb4)) & 0xffff);
  const p = r8(W + 0x8012);
  w16(0x32, p);
  w16(T(0x8553), ((p >> 5) + p) & 0xffff);
  w16(T(0x8555), (r16(0x74) + 0x000f) & 0xffff);
  let a = r16(0x7a);
  if (!(a & 0x8000)) a = 0;
  a = (((a ^ 0x00ff) + 1) + 0x0050) & 0xffff;
  w16(T(0x8557), a);
  w16(T(0x8558), r16(0x40));
  w16(T(0x855a), (r16(0x7a) - r16(0xb4) + 0x000f) & 0xffff);
  let b = r8(0x7a);
  if (b & 0x80) b = 0;
  w8(U(0x8816), (b + 0x20) & 0xff);
  w8(U(0x8817), 0x71);
  b = r8(0x7a);
  if (!(b & 0x80)) b = 0;
  w8(U(0x8818), (((b ^ 0xff) + 1) + 0x50) & 0xff);
  w8(U(0x8819), 0x79);
  w8(U(0x881a), 0x01);
  w8(U(0x881b), 0x71);
  w8(U(0x881c), 0x00);
  a = (r16(U(0x8818)) + r16(0xb4)) & 0x00ff;
  w16(0xb4, a);
  if (a >= 0x00e0) return done();
  if (((r16(0x74) - 0x0040) & 0xffff) >= 0x001c) return done();
  // CODE_80EB45: the far wall is visible again below the floor
  w16(0xb4, r16(0xb4) & 0x00ff);
  x += 0x0a;
  a = (0x005f + r16(0x7a)) & 0xffff;
  w16(0x7a, a);
  w16(0x38, a);
  w16(W + 0x8552 + x, a | 0x0080);
  x += 1;
  divide(xba((0x0060 - r16(0x7a)) & 0xffff), r8(0x7a));
  w16(0x32, ioR16(CPU.divide_result));
  w16(0x3a, r16(0xb4));
  const y = ((r16(0xb4) ^ 0xffff) + 0x0060 + 1) & 0xffff;
  a = (r16(0xb4) + r16(0x38)) & 0xffff;
  if (a >= 0x00e0) w16(0x38, (0x00e0 - r16(0xb4)) & 0xffff);
  w16(0xb4, ((r16(0xb4) & 0x00ff) + r16(0x38)) & 0xffff);
  lineTable(x, y);
  done();
}

function done() {
  reg.db = 0x80; // PLB (the code bank pushed by %pea_use_dbr)
}

/**
 * CODE_80EBB2 — write $38 HDMA entries of 4 bytes at $7E8552,x: [texture line, 0, scroll, 0].
 * The original keeps a 8.8 fixed-point position in the stack pointer (TCS), starting at Y
 * byte-swapped and advancing by $32 per line; the texture line is read from the table at
 * $7E8012 indexed by (position + $3A), $3A counting up. Returns the new X.
 */
function lineTable(x: number, y: number): number {
  let sp = xba(y & 0xffff);
  let count = r16(0x38);
  let c: boolean;
  const entry = (dst: number, src: number, hi: number) => {
    w16(W + dst + x, hi);
    let t = adc16(hi, r16(0x3a), c);
    c = flags.c;
    t &= 0x00ff;
    w16(W + src + x, r8(W + 0x8012 + t));
    w16(0x3a, (r16(0x3a) + 1) & 0xffff);
    sp = adc16(sp, r16(0x32), c);
    c = flags.c;
  };
  let a: number;
  if (count < 8) {
    // JMP CODE_80ECBD with A = $38: the first entry uses the high byte of $38 (0), not the SP
    c = false;
    a = count;
  } else {
    c = true;
    for (;;) {
      // CODE_80EBC2: 8 entries per iteration
      entry(0x8554, 0x8552, sp >> 8);
      entry(0x8558, 0x8556, sp >> 8);
      entry(0x855c, 0x855a, sp >> 8);
      entry(0x8560, 0x855e, sp >> 8);
      entry(0x8564, 0x8562, sp >> 8);
      entry(0x8568, 0x8566, sp >> 8);
      entry(0x856c, 0x856a, sp >> 8);
      entry(0x8570, 0x856e, sp >> 8);
      x = (x + 0x20) & 0xffff;
      count = (r16(0x38) - 8) & 0xffff;
      w16(0x38, count);
      if (count === 0) return x;
      if (count < 8) {
        c = false;
        a = sp;
        break;
      }
      c = true;
    }
  }
  // CODE_80ECBD: one entry at a time
  for (;;) {
    entry(0x8554, 0x8552, (a >> 8) & 0xff);
    x = (x + 4) & 0xffff;
    const n = (r16(0x38) - 1) & 0xffff;
    w16(0x38, n);
    if (n === 0) break;
    a = sp;
  }
  return x;
}

/**
 * $80ECE5 — the water surface (DB = $7E): from the water's screen height, build the HDMA
 * tables that split the screen into the area above the water, the surface wave lines and the
 * area below (indirect tables at $7E80E2 / $7E8832 / $7E884B, wave scroll values at $7E80F2..).
 */
export function handle_water_scroll() {
  const scrollX = r16(R.screen_scroll_x_position);
  const frame = r16(R.active_frame_counter);
  let a = (r16(R.water_y_position) - r16(R.screen_scroll_y_position)) & 0xffff;
  w16(0x32, a);
  a = (a - 0x0078) & 0xffff;
  w16(0x34, a);
  a = asr16(asr16(a));
  a = (a + r16(0x34) + 0x0078) & 0xffff;
  w16(0x34, a); // 1.25x perspective of the surface around the screen centre
  a = (asr16(asr16((r16(0x32) - 0x0078) & 0xffff)) + 0x0078) & 0xffff;
  w16(0x36, a);
  const d = (a - 0x0078) & 0xffff;
  if (d === 0) {
    // CODE_80ED24: surface exactly at the centre line
    const s = r8(0x34);
    w8(W + 0x80e2, s);
    w8(W + 0x8832, s);
    w8(W + 0x884b, s | 0x80);
    w8(W + 0x80e3, 0x13);
    for (const o of [0x80e4, 0x80e5, 0x80e6, 0x8835, 0x884e]) w8(W + o, 0x04);
    for (const o of [0x80e7, 0x80e8, 0x883b, 0x8854]) w8(W + o, 0x00);
    w8(W + 0x8833, 0x60);
    w8(W + 0x8836, (0x5c - s) & 0xff);
    w8(W + 0x8838, 0x01);
    w8(W + 0x8839, 0x80);
    w8(W + 0x8852, 0x80);
    w8(W + 0x8851, 0x81);
    w16(W + 0x884c, 0x80f2);
    w16(W + 0x884f, 0x80f3);
    w16(W + 0x80f3, xba(((((frame + scrollX) & 0xffff) >> 2) + scrollX) & 0x00ff));
    return surfaceWaves(frame, scrollX);
  }
  if (!(d & 0x8000)) return belowCentre(frame, scrollX);
  // CODE_80ED99: the surface is in the upper half (or above the screen)
  if (r16(0x32) & 0x8000) {
    w16(0x32, 0);
    w16(0x34, 0);
    w16(0x36, 0);
  }
  const s = r8(0x34);
  if (s === 0 || s & 0x80) {
    // CODE_80EDAE: the screen is (nearly) all under water
    w8(W + 0x8864, 0x00);
    w8(W + 0x80e2, r8(0x32));
    w8(W + 0x80e3, 0x04);
    w8(W + 0x80e4, 0x04);
    w8(W + 0x80e5, 0x00);
    w8(W + 0x80e6, 0x00);
    w16(W + 0x8832, (r16(0x32) + 0x0004) & 0xffff);
    w16(W + 0x8833, (0x0020 - r16(0x34)) & 0xffff);
    w16(W + 0x8835, 0x0001);
    w16(W + 0x8836, 0x0080);
    w16(W + 0x8838, 0x0000);
    w16(W + 0x884b, (r16(0x32) + 0x0084) & 0xffff);
    w16(W + 0x884c, ((((r16(0x34) ^ 0xffff) + 1) << 1) + 0x80fb) & 0xffff);
    w16(W + 0x884e, 0x0081);
    w16(W + 0x884f, 0x0080);
    w16(W + 0x8851, 0x0000);
    return surfaceWaves(frame, scrollX);
  }
  // CODE_80EE18
  w8(W + 0x8864, s | 0x80);
  w8(W + 0x80e3, 0x13);
  w8(W + 0x80e5, 0x04);
  w8(W + 0x80e6, 0x04);
  w8(W + 0x80e7, 0x00);
  w8(W + 0x80e8, 0x00);
  w8(W + 0x80e2, r8(0x34));
  w8(W + 0x80e4, (r8(0x32) - r8(0x34)) & 0xff);
  w16(W + 0x8832, r16(0x34));
  w16(W + 0x8833, 0x0060);
  w16(W + 0x8835, 0x0004);
  w16(W + 0x8836, (0x005c - r16(0x34)) & 0xffff);
  w16(W + 0x8838, (r16(0x32) - r16(0x34)) & 0xffff);
  w16(W + 0x8839, (0x0020 - r16(0x34)) & 0xffff);
  w16(W + 0x883b, 0x0001);
  w16(W + 0x883c, 0x0080);
  w16(W + 0x883e, 0x0000);
  w16(W + 0x884b, r16(0x34) | 0x0080);
  w16(W + 0x884c, 0x80f2);
  w16(W + 0x884e, 0x0084);
  w16(W + 0x884f, 0x80f3);
  w16(W + 0x8851, ((r16(0x32) - r16(0x34)) & 0xffff) | 0x0080);
  w16(W + 0x8852, 0x8103);
  w16(W + 0x8854, 0x0081);
  w16(W + 0x8855, 0x0080);
  w16(W + 0x8857, 0x0000);
  surfaceWaves(frame, scrollX);
}

/** Wave line scroll values: 1.25x scroll + time, spread per line. Returns the start value. */
function waveSetup(t: number, scrollX: number): number {
  const v34 = ((((t + scrollX) & 0xffff) >> 2) + scrollX) & 0xffff;
  w16(0x34, v34);
  w16(0x36, v34 >> 2);
  const ns = ((v34 ^ 0xffff) << 1) & 0xffff;
  w16(0x32, (ns - r16(0x36)) & 0xffff);
  return xba(v34 & 0x00ff);
}

/** CODE_80EEBC: the 40 wave lines at $7E80F2, and their ripple. */
function surfaceWaves(frame: number, scrollX: number) {
  let y = waveSetup(frame, scrollX);
  // carry left by the SBC $36 (no borrow unless the step wrapped)
  let c = ((((r16(0x34) ^ 0xffff) << 1) & 0xffff) - r16(0x36)) >= 0;
  const step = r16(0x32);
  for (let x = 0; x < 0x50; x += 0x10) {
    let a = y;
    for (let k = 0; k < 8; k++) {
      w16(W + 0x80f2 + 2 * k + x, a);
      a = adc16(a, step, c);
      c = flags.c;
    }
    y = a;
    c = false; // CPX #$0050 (BCC taken)
  }
  for (let t = ((frame >> 1) & 0x000e) + 0x0070; t >= 0; t -= 0x10) {
    inc16(W + 0x80f3 + t);
    inc16(W + 0x80f5 + t);
    inc16(W + 0x80f7 + t);
    inc16(W + 0x80f9 + t);
  }
}

/** CODE_80EF39: the surface is in the lower half of the screen. */
function belowCentre(frame: number, scrollX: number) {
  if (r16(0x36) >= 0x00e0) {
    w16(0x32, 0x0180);
    w16(0x34, 0x0180);
    w16(0x36, 0x0180);
  }
  w8(W + 0x8864, 0xf8);
  w8(W + 0x80e2, 0x76);
  w8(W + 0x80e3, 0x17);
  w8(W + 0x80e5, 0x17);
  w8(W + 0x80e4, 0x08);
  w8(W + 0x80e6, 0x30);
  w8(W + 0x80e7, 0x15);
  w8(W + 0x80e8, 0x01);
  w8(W + 0x80e9, 0x04);
  w8(W + 0x80ea, 0x00);
  let a = ((r16(0x32) - 0x0076) & 0xffff) >> 1;
  if (a >= 0x0080) a = 0x007f;
  w8(W + 0x80e4, a);
  w8(W + 0x80e6, a);
  w16(W + 0x8832, 0x0070);
  w16(W + 0x8833, 0x0060);
  w16(W + 0x8835, (r16(0x36) - 0x0070) & 0xffff);
  w16(W + 0x8836, 0x0000);
  // the band between the surface and its reflection, split in quarters (rounded halves)
  const quarters = (v: number, o1: number, o2: number, o3: number, o4: number) => {
    const c1 = v & 1;
    const a1 = v >> 1;
    const c2 = a1 & 1;
    const a2 = a1 >> 1;
    w16(W + o1, a2);
    w16(W + o2, a2 + c2);
    const a3 = a1 + c1;
    const c4 = a3 & 1;
    const a4 = a3 >> 1;
    w16(W + o3, a4);
    w16(W + o4, a4 + c4);
  };
  a = (r16(0x34) - r16(0x36)) & 0xffff;
  w16(0x38, a);
  quarters(a, 0x8838, 0x883b, 0x883e, 0x8841);
  const s34 = r16(0x34);
  const s36 = r16(0x36);
  w16(W + 0x8839, s36 ^ 0xffff);
  w16(W + 0x883c, (-((((s36 << 1) + s36 + s34) & 0xffff) >> 2)) & 0xffff);
  w16(W + 0x883f, (-(((((s34 + s36) & 0xffff) >> 1) - 0x0020) & 0xffff)) & 0xffff);
  w16(W + 0x8842, ((-((((s34 << 1) + s34 + s36) & 0xffff) >> 2)) + 0x0048) & 0xffff);
  w16(W + 0x8844, 0x0001);
  w16(W + 0x8845, ((-s34) + 0x005c) & 0xffff);
  w16(W + 0x8847, 0x0000);
  w16(W + 0x884b, (s36 - 0x00f0) & 0xffff);
  w16(W + 0x884c, 0x0080);
  w16(W + 0x884e, 0x00f0);
  w16(W + 0x884f, 0x80f2);
  a = (s34 - s36) & 0xffff;
  w16(0x38, a);
  quarters(a | 0x0200, 0x8851, 0x8854, 0x8857, 0x885a);
  w16(W + 0x8852, 0x80f2);
  w16(W + 0x8855, 0x8132);
  w16(W + 0x8858, 0x8172);
  w16(W + 0x885b, 0x8192);
  w16(W + 0x885d, 0x0081);
  w16(W + 0x885e, 0x81b2);
  w16(W + 0x8860, 0x0000);
  // frozen water (ice levels with $0915 set) does not move
  const frozen = r16(level.tileset_type) === C.ice_1_layout_id && r16(0x0915) !== 0;
  let y = waveSetup(frozen ? 0 : frame, scrollX);
  let c = ((((r16(0x34) ^ 0xffff) << 1) & 0xffff) - r16(0x36)) >= 0;
  const step = r16(0x32);
  for (let x = 0x00c0; x >= 0; x -= 0x10) {
    let v = y;
    for (let k = 0; k < 8; k++) {
      w16(W + 0x810d - 2 * k + x, v);
      v = adc16(v, step, c);
      c = flags.c;
    }
    y = v;
    c = true; // SEC : SBC #$0010 (no borrow while looping)
  }
  if (frozen) return;
  let x = 0;
  for (let t = ((frame >> 1) & 0x000e) + 0x0040; t >= 0; t -= 0x10) {
    x = t;
    inc16(W + 0x817e + x);
    inc16(W + 0x8180 + x);
    inc16(W + 0x8182 + x);
    inc16(W + 0x8182 + x);
    inc16(W + 0x8184 + x);
    inc16(W + 0x8184 + x);
    inc16(W + 0x8186 + x);
    inc16(W + 0x8188 + x);
  }
  for (let t = x + 0x0070; t >= 0; t -= 0x10) {
    inc16(W + 0x80fe + t);
    inc16(W + 0x8100 + t);
    inc16(W + 0x8102 + t);
    inc16(W + 0x8104 + t);
  }
}

for (const t of ["handle_ship_deck_rigging_scroll", "handle_ship_deck_water_sky_scroll", "handle_water_and_3D_bg_scroll", "handle_3d_bg_scroll", "handle_water_scroll"])
  setRetMode(L(t), RET_RTS);
setRetMode(L("CODE_80E522"), RET_RTL);

register({
  CODE_80E522,
  handle_ship_deck_rigging_scroll,
  handle_ship_deck_water_sky_scroll,
  handle_water_and_3D_bg_scroll,
  handle_3d_bg_scroll,
  handle_water_scroll,
});

