/**
 * Bank $B5 — the level camera (bank_B5.asm, `camera_handler` and the `CODE_B5E5..`-`CODE_B5F0..`
 * routines).
 *
 * The camera works on a block of variables at $0A90-$0AFF. The original points the direct page
 * at $0A00 while it runs, so `$DF` in the disassembly is $0ADF here. Main fields:
 *
 *   $0A98        sprite followed by the camera
 *   $0ABA        offset of the last camera region, $0ABC = offset of the current region
 *   $0ABE/$0AC0  target X (24-bit fixed point: $0ABF = pixel), $0AC2/$0AC4 target Y
 *   $0ADE/$0AE0  desired camera X after offsets/limits ($0ADF = pixel), $0AE2/$0AE4 desired Y
 *   $0AD6/$0AD8  smoothed camera X ($0AD7 = pixel), $0ADA/$0ADC smoothed camera Y
 *   $0ACE/$0AD0  camera X velocity, $0AD2/$0AD4 camera Y velocity
 *   $0AA8-$0AAE  scratch: current limits (left, right, top, bottom)
 *   $0AF6/$0AF8/$0AFA  screen shake amplitude X / Y and direction bits
 *   $0AFC/$0AFE  overall camera maximum X / Y
 *
 * Camera regions live in bank $7E: $8D28 left, $8E28 right, $8F28 top, $9028 bottom, $9128 flags
 * (low byte) and right neighbour (high byte), $9228 left neighbours (2 bytes), $9328 neighbours
 * above (2 bytes), $9428 neighbours below (2 bytes). A neighbour byte N refers to the region at
 * offset N*2; offset 0 is "no region".
 */
import { r8, r16, w16, rom16, bus16, io8, io16, ioR16 } from "../../core/mem";
import { reg, register, callPtr } from "../../core/cpu";
import { setRetMode, RET_RTS } from "../../core/hybrid";
import { L, R, CPU, C, level } from "../../core/sym";
import { get_level_number } from "../../gen/routines";

// ---- direct page $0A00 ----
const DP = 0x0a00;
const d = (o: number) => r16(DP + o);
const sd = (o: number, v: number) => w16(DP + o, v & 0xffff);
const d8 = (o: number) => r8(DP + o);

// ---- camera region tables (bank $7E) ----
const REG_LEFT = 0x7e8d28;
const REG_RIGHT = 0x7e8e28;
const REG_TOP = 0x7e8f28;
const REG_BOTTOM = 0x7e9028;
const REG_FLAGS = 0x7e9128; // low byte flags, high byte = right neighbour
const REG_LINK_LEFT = 0x7e9228;
const REG_LINK_UP = 0x7e9328;
const REG_LINK_DOWN = 0x7e9428;
const left = (i: number) => r16(REG_LEFT + i);
const right = (i: number) => r16(REG_RIGHT + i);
const top = (i: number) => r16(REG_TOP + i);
const bottom = (i: number) => r16(REG_BOTTOM + i);
const flags = (i: number) => r16(REG_FLAGS + i);

const SCROLL_X_ROUTINES = L("DATA_B5E5AE");
const SCROLL_Y_ROUTINES = L("DATA_B5E5B4");
const REGION_LIMIT_ROUTINES = L("DATA_B5E9F4");
const X_WOBBLE = L("DATA_B5E620");
const Y_WOBBLE = L("DATA_B5E779");
const RARE_STRING = L("rare_string");
const CAMERA_OFFSETS = L("DATA_FD470D");

const neg = (v: number) => (v & 0x8000) !== 0;

// =====================================================================================
// Per-frame entry
// =====================================================================================

/** $B5E50D — per-frame camera update: follow a sprite, apply regions/limits, smooth, scroll. */
export function camera_handler() {
  // remember last frame's targets (used by the smoothing code)
  w16(0x0a9e, r16(0x0ac3));
  w16(0x0aa0, r16(0x0ade));
  w16(0x0aa2, r16(0x0ae0));
  w16(0x0aa4, r16(0x0ae2));
  w16(0x0aa6, r16(0x0ae4));
  // follow $0AE8 when set, otherwise the active Kong
  let y = r16(0x0ae8);
  if (y === 0) y = r16(R.active_kong_sprite);
  reg.y = y;
  CODE_B5E560();
  reg.y = y;
  const mode = (r16(level.camera_control) & 0x000f) << 1;
  reg.c = false; // carry from the ASL
  callPtr(0xb5, rom16(SCROLL_X_ROUTINES + mode));
  reg.y = y;
  reg.c = false;
  callPtr(0xb5, rom16(SCROLL_Y_ROUTINES + mode));
  CODE_B5E7C5();
  CODE_B5ED70();
}

/** $B5E560 — Y = sprite. Take its position as the camera target when inside the level bounds. */
export function CODE_B5E560() {
  const y = reg.y;
  w16(0x0a98, y);
  w16(0x0abe, 0);
  w16(0x0ac0, 0);
  let a = r16(REG_LEFT);
  if (a < r16(y + 6)) {
    a = (r16(REG_RIGHT) - 1) & 0xffff;
    if (a >= r16(y + 6)) {
      w16(0x0abe, r16(y + 5));
      a = r16(y + 6);
    }
  }
  w16(0x0abf, a);
  w16(0x0ac2, 0);
  w16(0x0ac4, 0);
  a = r16(REG_TOP);
  if (a < r16(y + 0x0a)) {
    a = (r16(REG_BOTTOM) - 1) & 0xffff;
    if (a >= r16(y + 0x0a)) {
      w16(0x0ac2, r16(y + 9));
      a = r16(y + 0x0a);
    }
  }
  w16(0x0ac3, a);
  reg.a = a;
}

// =====================================================================================
// Horizontal target (camera_control modes)
// =====================================================================================

/** $B5E5BA — desired X = target X minus the look-ahead offset for the facing direction. */
export function CODE_B5E5BA() {
  const y = reg.y;
  let a = d(0xb8);
  if (!neg(a)) a = r16(y + 0x12);
  const facingLeft = (a & 0x4000) !== 0; // the second ASL's carry
  sd(0xb8, d(0xb8) & ~0x8000);
  sd(0x92, facingLeft ? d(0xea) : d(0xec));
  sd(0x94, 0);
  // add the signed extra offset $0AEE (sign-extended into $0A94)
  let off = d(0xee);
  if (neg(off)) sd(0x94, 0xffff);
  off = (off << 1) & 0xffff;
  const lo = off + d(0x92);
  sd(0x92, lo);
  sd(0x94, d(0x94) + (lo >> 16));
  const s = d(0xbe) - d(0x92);
  sd(0xde, s);
  const hi = (d(0xc0) - d(0x94) - (s < 0 ? 1 : 0)) & 0xffff;
  if (neg(hi)) {
    sd(0xde, 0);
    sd(0xe0, 0);
    return;
  }
  sd(0xe0, hi);
}

/** $B5E5FA — like CODE_B5E5BA, with the target X wobbling back and forth (frame based). */
export function CODE_B5E5FA() {
  const x = (r16(R.active_frame_counter) >> 2) & 0x3e;
  const savedLo = d(0xbe);
  const savedHi = d(0xc0);
  const s = savedLo - rom16(X_WOBBLE + x);
  sd(0xbe, s);
  sd(0xc0, savedHi - (s < 0 ? 1 : 0));
  CODE_B5E5BA();
  sd(0xc0, savedHi);
  sd(0xbe, savedLo);
}

// =====================================================================================
// Vertical target
// =====================================================================================

/** $B5E660 — Y = sprite. Vertical target: follows the sprite only on the ground (normal mode). */
export function CODE_B5E660() {
  const y = reg.y;
  const water = r16(R.water_y_position);
  if (!neg(water)) {
    // ADC with the caller's carry
    const a = (water + 0x10 + (reg.c ? 1 : 0)) & 0xffff;
    if (a < r16(y + 0x0a)) return CODE_B5E7B9(); // under water: follow freely
  }
  if (r16(R.animal_type) === C.sprite_squawks) return CODE_B5E7B9();
  if (r16(y + 0x0e) === 0) {
    sd(0xb8, d(0xb8) & ~0x2000);
  } else if (d(0xb8) & 0x2000) {
    return CODE_B5E7B9();
  }
  // $B5E68C
  sd(0x92, 0);
  sd(0x94, 0);
  const ground = r16(y + 0x0e);
  if (!neg(ground)) {
    w16(0x0a93, ground);
    CODE_B5E72F();
    // $B5E6F0
    const s = d(0xc2) - d(0x92);
    sd(0xe2, s);
    sd(0xe4, d(0xc4) - d(0x94) - (s < 0 ? 1 : 0));
    CODE_B5E705();
    sd(0xe6, r16(0x0ae3));
    return;
  }
  // $B5E69C
  w16(0x0a93, 0x0050);
  CODE_B5E72F();
  let s = d(0xc2) - 0x3800;
  sd(0x92, s);
  let hi = d(0xc4) - (s < 0 ? 1 : 0);
  if (hi < 0) return clearDesiredY();
  sd(0x94, hi);
  s = d(0x92) - d(0xf4);
  sd(0x92, s);
  hi = d(0x94) - (s < 0 ? 1 : 0);
  if (hi < 0) return clearDesiredY();
  sd(0x94, hi);
  if (r16(0x0a93) >= d(0xe6)) {
    s = d(0xc2) - 0xc800;
    sd(0x92, s);
    hi = d(0xc4) - (s < 0 ? 1 : 0);
    if (hi < 0) return clearDesiredY();
    sd(0x94, hi);
    if (r16(0x0a93) < d(0xe6)) return;
  }
  // $B5E6E2
  sd(0xe2, d(0x92));
  sd(0xe4, d(0x94));
}

/** $B5E6EB */
function clearDesiredY() {
  sd(0xe2, 0);
  sd(0xe4, 0);
}

/** $B5E705 — desired Y -= the signed offset $0AF0/$0AF2 (clamped at 0). */
export function CODE_B5E705() {
  sd(0x94, 0);
  let a = d(0xf2);
  if (neg(a)) sd(0x94, 0xffff);
  a = (a << 1) & 0xffff;
  const lo = a + d(0xf0);
  sd(0x92, lo);
  sd(0x94, d(0x94) + (lo >> 16));
  const s = d(0xe2) - d(0x92);
  sd(0xe2, s);
  const hi = (d(0xe4) - d(0x94) - (s < 0 ? 1 : 0)) & 0xffff;
  if (neg(hi)) return clearDesiredY();
  sd(0xe4, hi);
}

/** $B5E72F — negate the 32-bit value at $0A92/$0A94. */
export function CODE_B5E72F() {
  sd(0x94, d(0x94) ^ 0xffff);
  const lo = (d(0x92) ^ 0xffff) + 1;
  sd(0x92, lo);
  sd(0x94, d(0x94) + (lo >> 16));
}

/** $B5E749 — like CODE_B5E660, with the target Y wobbling up and down. */
export function CODE_B5E749() {
  const f = r16(R.active_frame_counter);
  const x = ((((f >> 1) + f + 0x1f) & 0xffff) >> 2) & 0x3e;
  const savedLo = d(0xc2);
  const savedHi = d(0xc4);
  const s = savedLo - rom16(Y_WOBBLE + x);
  sd(0xc2, s);
  const hi = savedHi - (s < 0 ? 1 : 0);
  sd(0xc4, hi);
  reg.c = hi >= 0;
  CODE_B5E660();
  sd(0xc4, savedHi);
  sd(0xc2, savedLo);
}

/** $B5E7B9 — desired Y = target Y (minus the vertical offset). */
export function CODE_B5E7B9() {
  sd(0xe2, d(0xc2));
  sd(0xe4, d(0xc4));
  CODE_B5E705();
}

// =====================================================================================
// Camera regions and limits
// =====================================================================================

/** $B5E7C5 — clamp the desired position to the level, track the current region, apply its limits. */
export function CODE_B5E7C5() {
  let a = r16(REG_LEFT);
  if (a >= r16(0x0adf) || ((a = d(0xfc)), a < r16(0x0adf))) {
    sd(0xde, 0);
    w16(0x0adf, a);
  }
  a = r16(REG_TOP);
  if (a >= r16(0x0ae3) || ((a = d(0xfe)), a < r16(0x0ae3))) {
    sd(0xe2, 0);
    w16(0x0ae3, a);
  }
  // $B5E7E9: is the target still inside the current region?
  let x = d(0xbc);
  if (x !== 0) {
    const tx = r16(0x0abf);
    const ty = r16(0x0ac3);
    const inside = ((tx >= left(x) ? 8 : 0) | (tx >= right(x) ? 4 : 0) | (ty >= top(x) ? 2 : 0) | (ty >= bottom(x) ? 1 : 0)) & 0xffff;
    sd(0x92, inside);
    if (inside !== 0x000a) {
      reg.x = x;
      reg.a = inside;
      CODE_B5EC63();
      x = reg.c ? reg.x : d(0xbc);
    }
  } else if (d(0xba) !== 0) {
    CODE_B5ED3A();
    x = reg.x;
  }
  // $B5E81E
  sd(0xbc, x);
  sd(0xa8, left(limitLeft(x)));
  sd(0xaa, right(limitRight(d(0xbc))));
  sd(0xac, top(limitTop(d(0xbc))));
  sd(0xae, bottom(limitBottom(d(0xbc))));
  // $B5E908: frame counter for the anti-piracy checksum
  const t = (d(0x90) + 1) & 0xffff;
  sd(0x90, neg(t) ? t - 1 : t);
  const kind = flags(d(0xbc)) & 0x0040 ? 2 : 0;
  callPtr(0xb5, rom16(REGION_LIMIT_ROUTINES + kind));
}

/**
 * $B5E81E-$B5E851 — region whose left edge is the left limit: walk left neighbours that are
 * tall enough on screen while the camera is left of the region's left edge.
 */
function limitLeft(x: number): number {
  sd(0x92, x);
  let y = x;
  if (x === 0) return 0;
  reg.a = r16(REG_LINK_LEFT + x);
  CODE_B5E922();
  y = reg.y;
  if (!reg.c) {
    reg.a = r16(REG_LINK_LEFT + 1 + x);
    CODE_B5E922();
    y = reg.y;
    if (!reg.c) return d(0x92);
  }
  // $B5E835
  if (r16(0x0adf) >= left(y)) return y;
  x = y;
  sd(0x92, x);
  reg.a = r16(REG_LINK_LEFT + x);
  CODE_B5E922();
  y = reg.y;
  if (reg.c) return y;
  reg.a = r16(REG_LINK_LEFT + 1 + x);
  CODE_B5E922();
  y = reg.y;
  if (reg.c) return y;
  return d(0x92);
}

/** $B5E856-$B5E890 — same for the right limit (through the right neighbour). */
function limitRight(x: number): number {
  sd(0x92, x);
  let y = x;
  if (x === 0) return 0;
  reg.x = x;
  reg.y = y;
  reg.a = r16(REG_FLAGS + 1 + x);
  CODE_B5E954();
  y = reg.y;
  if (!reg.c) {
    reg.x = x;
    CODE_B5ED1E();
    y = reg.y;
    if (!reg.z) return d(0x92);
    reg.y = y;
    CODE_B5E95B();
    y = reg.y;
    if (!reg.c) return d(0x92);
  }
  // $B5E86F
  if (((right(y) - 0x100) & 0xffff) >= r16(0x0adf)) return y;
  x = y;
  sd(0x92, x);
  reg.a = r16(REG_FLAGS + 1 + x);
  CODE_B5E954();
  y = reg.y;
  if (reg.c) return y;
  reg.x = x;
  CODE_B5ED1E();
  y = reg.y;
  if (!reg.z) return d(0x92);
  reg.y = y;
  CODE_B5E95B();
  y = reg.y;
  if (reg.c) return y;
  return d(0x92);
}

/** $B5E895-$B5E8C8 — same for the top limit (neighbours above). */
function limitTop(x: number): number {
  sd(0x92, x);
  let y = x;
  if (x === 0) return 0;
  reg.y = y;
  reg.a = r16(REG_LINK_UP + x);
  CODE_B5E98C();
  y = reg.y;
  if (!reg.c) {
    reg.a = r16(REG_LINK_UP + 1 + x);
    CODE_B5E98C();
    y = reg.y;
    if (!reg.c) return d(0x92);
  }
  // $B5E8AC
  if (r16(0x0ae3) >= top(y)) return y;
  x = y;
  sd(0x92, x);
  reg.a = r16(REG_LINK_UP + x);
  CODE_B5E98C();
  y = reg.y;
  if (reg.c) return y;
  reg.a = r16(REG_LINK_UP + 1 + x);
  CODE_B5E98C();
  y = reg.y;
  if (reg.c) return y;
  return d(0x92);
}

/** $B5E8CD-$B5E903 — same for the bottom limit (neighbours below). */
function limitBottom(x: number): number {
  sd(0x92, x);
  let y = x;
  if (x === 0) return 0;
  reg.y = y;
  reg.a = r16(REG_LINK_DOWN + x);
  CODE_B5E9BE();
  y = reg.y;
  if (!reg.c) {
    reg.a = r16(REG_LINK_DOWN + 1 + x);
    CODE_B5E9BE();
    y = reg.y;
    if (!reg.c) return d(0x92);
  }
  // $B5E8E4
  if (((bottom(y) - 0xe0) & 0xffff) >= r16(0x0ae3)) return y;
  x = y;
  sd(0x92, x);
  reg.a = r16(REG_LINK_DOWN + x);
  CODE_B5E9BE();
  y = reg.y;
  if (reg.c) return y;
  reg.a = r16(REG_LINK_DOWN + 1 + x);
  CODE_B5E9BE();
  y = reg.y;
  if (reg.c) return y;
  return d(0x92);
}

/**
 * Vertical overlap of region Y with the screen (camera Y .. Y+$E0), as the original computes it:
 * returns -1 when there is none.
 */
function screenOverlapY(y: number): number {
  const a = r16(0x0ae3) + 0xe0;
  const b = bottom(y);
  if ((a & 0xffff) >= b) return b - r16(0x0ae3);
  return (a & 0xffff) - top(y);
}
/** Horizontal overlap of region Y with the screen (camera X .. X+$100). */
function screenOverlapX(y: number): number {
  const a = (r16(0x0adf) + 0x100) & 0xffff;
  const r = right(y);
  if (a >= r) return r - r16(0x0adf);
  return a - left(y);
}

/** $B5E922 — A = left neighbour byte. Carry set if it is usable and at least $38 lines are on screen. */
export function CODE_B5E922() {
  const n = reg.a & 0xff;
  reg.c = false;
  if (n === 0) return;
  const y = n << 1;
  reg.y = y;
  if (flags(y) & 0x00a0) return;
  if (right(y) < r16(0x0adf)) return;
  const ov = screenOverlapY(y);
  reg.c = ov >= 0x38;
  reg.a = ov & 0xffff;
}

/** $B5E954 — A = right neighbour byte; like CODE_B5E922 for the region on the right. */
export function CODE_B5E954() {
  const n = reg.a & 0xff;
  reg.c = false;
  if (n === 0) return;
  reg.y = n << 1;
  CODE_B5E95B();
}

/** $B5E95B — Y = region offset: is it usable, reachable on the right, and tall enough on screen? */
export function CODE_B5E95B() {
  const y = reg.y;
  reg.c = false;
  if (flags(y) & 0x00a0) return;
  if (((r16(0x0adf) + 0x100) & 0xffff) < left(y)) return;
  const ov = screenOverlapY(y);
  reg.c = ov >= 0x38;
  reg.a = ov & 0xffff;
}

/** $B5E98C — A = neighbour-above byte: usable and at least $40 pixels wide on screen? */
export function CODE_B5E98C() {
  const n = reg.a & 0xff;
  reg.c = false;
  if (n === 0) return;
  const y = n << 1;
  reg.y = y;
  if (flags(y) & 0x00a0) return;
  if (bottom(y) < r16(0x0ae3)) return;
  const ov = screenOverlapX(y);
  reg.c = ov >= 0x40;
  reg.a = ov & 0xffff;
}

/** $B5E9BE — A = neighbour-below byte: usable and at least $40 pixels wide on screen? */
export function CODE_B5E9BE() {
  const n = reg.a & 0xff;
  reg.c = false;
  if (n === 0) return;
  const y = n << 1;
  reg.y = y;
  if (flags(y) & 0x00a0) return;
  if (((r16(0x0ae3) + 0xe0) & 0xffff) < top(y)) return;
  const ov = screenOverlapX(y);
  reg.c = ov >= 0x40;
  reg.a = ov & 0xffff;
}

/** $B5E9F8 — normal region: clamp the desired X and Y to the limits $0AA8-$0AAE. */
export function CODE_B5E9F8() {
  clampX();
  clampY();
}

/** $B5E9F8 / $B5EB56 — clamp desired X between left ($0AA8) and right-$100 ($0AAA). */
function clampX() {
  const max = d(0xaa) - 0x100;
  if (max < 0) return w16(0x0adf, 0);
  if (max < d(0xa8)) return w16(0x0adf, ((max + d(0xa8)) & 0xffff) >> 1); // region narrower than the screen: centre
  if (max < r16(0x0adf)) return w16(0x0adf, max);
  if (d(0xa8) >= r16(0x0adf)) w16(0x0adf, d(0xa8));
}
/** $B5EA1A / $B5EB78 — clamp desired Y between top ($0AAC) and bottom-$E0 ($0AAE). */
function clampY() {
  const max = d(0xae) - 0xe0;
  if (max < 0) return w16(0x0ae3, 0);
  if (max < d(0xac)) return w16(0x0ae3, ((max + d(0xac)) & 0xffff) >> 1);
  if (max < r16(0x0ae3)) return w16(0x0ae3, max);
  if (d(0xac) >= r16(0x0ae3)) w16(0x0ae3, d(0xac));
}

/**
 * $B5EA3C — transition region (flag $40): interpolate the limits between the regions it joins,
 * according to how far the camera has crossed it.
 */
export function CODE_B5EA3C() {
  let y = r16(0x0abc);
  if (r16(REG_LINK_LEFT + y) !== 0) {
    let x = (r16(REG_LINK_LEFT + y) & 0xff) << 1;
    const sameBottom = bottom(x) === bottom(y);
    // $B5EA66 / $B5EAA5: horizontal passage, interpolate the vertical limits
    x = (r16(REG_LINK_LEFT + y) & 0xff) << 1;
    y = (r16(REG_FLAGS + 1 + y) & 0xff) << 1;
    reg.x = x;
    reg.y = y;
    if (sameBottom) {
      w16(0x0d26, top(x) - top(y));
      CODE_B5EBBB();
      sd(0xac, top(x) - reg.a);
      w16(0x0d26, bottom(x) - bottom(y));
      CODE_B5EBBB();
      sd(0xae, bottom(x) - reg.a);
    } else {
      w16(0x0d26, top(y) - top(x));
      CODE_B5EBBB();
      sd(0xac, reg.a + top(x));
      w16(0x0d26, bottom(y) - bottom(x));
      CODE_B5EBBB();
      sd(0xae, reg.a + bottom(x));
    }
    clampY();
    return;
  }
  let x = (r16(REG_LINK_UP + y) & 0xff) << 1;
  const sameRight = right(x) === right(y);
  // $B5EADE / $B5EB1D: vertical passage, interpolate the horizontal limits
  x = (r16(REG_LINK_UP + y) & 0xff) << 1;
  y = (r16(REG_LINK_DOWN + y) & 0xff) << 1;
  reg.x = x;
  reg.y = y;
  if (sameRight) {
    w16(0x0d26, left(x) - left(y));
    CODE_B5EB9A();
    sd(0xa8, left(x) - reg.a);
    w16(0x0d26, right(x) - right(y));
    CODE_B5EB9A();
    sd(0xaa, right(x) - reg.a);
  } else {
    w16(0x0d26, left(y) - left(x));
    CODE_B5EB9A();
    sd(0xa8, reg.a + left(x));
    w16(0x0d26, right(y) - right(x));
    CODE_B5EB9A();
    sd(0xaa, reg.a + right(x));
  }
  clampX();
}

/** $B5EB9A — X = upper region, Y = lower region: A = $0D26 scaled by how far down the camera is. */
export function CODE_B5EB9A() {
  const x = reg.x;
  const y = reg.y;
  w16(0x0d2a, top(y) - bottom(x) - 0xe0);
  const p = r16(0x0ae3) - bottom(x);
  if (p < 0) {
    reg.a = 0;
    return;
  }
  if (p >= r16(0x0d2a)) {
    reg.a = r16(0x0d26);
    return;
  }
  w16(0x0d28, p);
  scaleDelta();
}

/** $B5EBBB — X = left region, Y = right region: A = $0D26 scaled by how far right the camera is. */
export function CODE_B5EBBB() {
  const x = reg.x;
  const y = reg.y;
  w16(0x0d2a, left(y) - right(x) - 0x100);
  const p = r16(0x0adf) - right(x);
  if (p < 0) {
    reg.a = 0;
    return;
  }
  if (p >= r16(0x0d2a)) {
    reg.a = r16(0x0d26);
    return;
  }
  w16(0x0d28, p);
  scaleDelta();
}

/**
 * $B5EBE4 — A = $0D26 * $0D28 / $0D2A using the hardware multiplier/divider, keeping 8 bits of
 * precision on each operand and correcting with shifts afterwards.
 */
function scaleDelta() {
  let shift = 0;
  let a = r16(0x0d26);
  if (a === 0) return void (reg.a = 0);
  while (a >= 0x100) {
    a >>= 1;
    shift++;
  }
  io8(CPU.multiply_A, a);
  a = r16(0x0d28);
  if (a === 0) return void (reg.a = 0);
  while (a >= 0x100) {
    a >>= 1;
    shift++;
  }
  io8(CPU.multiply_B, a);
  a = ioR16(CPU.multiply_result);
  if (!neg(a)) {
    // normalise the product up to bit 15 while there are shifts left to absorb
    for (;;) {
      shift--;
      if (shift < 0) {
        shift = 0;
        break;
      }
      a = (a << 1) & 0xffff;
      if (neg(a)) break;
    }
  }
  io16(CPU.dividen, a);
  a = r16(0x0d2a);
  if (a === 0) return void (reg.a = 0);
  while (a >= 0x100) {
    a >>= 1;
    shift--;
  }
  io8(CPU.divisor, a);
  a = ioR16(CPU.divide_result);
  if (shift > 0) {
    do {
      a = (a << 1) & 0xffff;
      shift--;
    } while (shift !== 0);
  } else if (shift < 0) {
    do {
      a >>= 1;
      shift++;
    } while (shift < 0);
  }
  reg.a = a;
}

/**
 * $B5EC63 — the target left the current region X; A = side bits (%LRTB compare results).
 * Look for the neighbour it moved into. Carry set (X = new region) if found; also clamps
 * the target Y ($0AC3) to the region when it left through the top/bottom with no neighbour.
 */
export function CODE_B5EC63() {
  const x = reg.x;
  const v = reg.a & 0x0003;
  if (v === 0) {
    // above the region
    reg.a = r16(REG_LINK_UP + x);
    CODE_B5ECDE();
    if (reg.c) return void (reg.a = 3);
    reg.a = r16(REG_LINK_UP + 1 + x);
    CODE_B5ECDE();
    if (reg.c) return void (reg.a = 3);
    w16(0x0ac3, top(x));
  } else if (v === 3) {
    // below the region
    reg.a = r16(REG_LINK_DOWN + x);
    CODE_B5ECDE();
    if (reg.c) return void (reg.a = 4);
    reg.a = r16(REG_LINK_DOWN + 1 + x);
    CODE_B5ECDE();
    if (reg.c) return void (reg.a = 4);
    w16(0x0ac3, bottom(x));
  }
  // $B5ECA3: horizontal
  const h = d(0x92) & 0x000c;
  if (h === 0) {
    // left of the region
    reg.x = x;
    reg.a = r16(REG_LINK_LEFT + x);
    CODE_B5ECFD();
    if (reg.c) return void (reg.a = 1);
    reg.a = r16(REG_LINK_LEFT + 1 + x);
    CODE_B5ECFD();
    if (reg.c) return void (reg.a = 1);
  } else if (h === 0x000c) {
    // right of the region
    reg.x = x;
    reg.a = r16(REG_FLAGS + 1 + x);
    CODE_B5ECFD();
    if (reg.c) return void (reg.a = 2);
    reg.x = x;
    CODE_B5ED1E();
    if (reg.z) {
      CODE_B5ED04();
      if (reg.c) return void (reg.a = 2);
    }
  }
  reg.x = x;
  reg.c = false;
  reg.a = 0;
}

/** $B5ECDE — A = neighbour byte: carry set and X = region if the target X lies within it. */
export function CODE_B5ECDE() {
  const n = reg.a & 0xff;
  reg.c = false;
  if (n === 0) return;
  const y = n << 1;
  reg.y = y;
  if (flags(y) & 0x0020) return;
  const tx = r16(0x0abf);
  if (tx < left(y)) return;
  if (right(y) < tx) return;
  reg.c = true;
  reg.x = y;
}

/** $B5ECFD — A = neighbour byte: carry set and X = region if the target Y lies within it. */
export function CODE_B5ECFD() {
  const n = reg.a & 0xff;
  reg.c = false;
  if (n === 0) return;
  reg.y = n << 1;
  CODE_B5ED04();
}

/** $B5ED04 — Y = region offset: carry set and X = Y if the target Y lies within it. */
export function CODE_B5ED04() {
  const y = reg.y;
  reg.c = false;
  if (flags(y) & 0x0020) return;
  const ty = r16(0x0ac3);
  if (ty < top(y)) return;
  if (bottom(y) < ty) return;
  reg.c = true;
  reg.x = y;
}

/**
 * $B5ED1E — X = region. Y = the region after its right neighbour; Z set if that region lists X
 * as one of its left neighbours (Z clear when there is no right neighbour).
 */
export function CODE_B5ED1E() {
  const x = reg.x;
  const n = r16(REG_FLAGS + 1 + x) & 0xff;
  if (n === 0) {
    reg.a = 1;
    reg.z = false;
    return;
  }
  const y = ((n + 1) << 1) & 0xffff;
  reg.y = y;
  const me = (x & 0xff) >> 1;
  reg.z = me === r8(REG_LINK_LEFT + y) || me === r8(REG_LINK_LEFT + 1 + y);
  reg.a = (reg.a & 0xff00) | me;
}

/** $B5ED3A — X = the region containing the target, searching down from the last region ($0ABA). */
export function CODE_B5ED3A() {
  let x = (d(0xba) + 2) & 0xffff;
  const tx = r16(0x0abf);
  const ty = r16(0x0ac3);
  for (;;) {
    do x = (x - 2) & 0xffff;
    while (tx < left(x));
    if (tx >= right(x)) {
      do x = (x - 2) & 0xffff;
      while (tx >= right(x));
    }
    // $B5ED53
    if (ty < top(x)) {
      do x = (x - 2) & 0xffff;
      while (ty < top(x));
    }
    // $B5ED61
    for (;;) {
      if (ty < bottom(x) && tx < right(x)) {
        reg.x = x;
        reg.a = ty;
        reg.c = false;
        return;
      }
      // $B5ED5A
      do x = (x - 2) & 0xffff;
      while (ty < top(x));
    }
  }
}

// =====================================================================================
// Scrolling
// =====================================================================================

/**
 * $B5ED70 — anti-piracy checksum (one word per frame), then smooth and scroll the camera.
 *
 * The original adds up, one word per frame, the $220 bytes from `rare_string` ($8083C0): the
 * "Rareware" string and the reset/anti-piracy code after it. On a genuine cartridge the total
 * is $78D5 and nothing happens; a patched ROM loses camera range ($0AFD). The port has no
 * original code to add up (it runs without the ROM), so it keeps the window and its frame
 * counter exactly, does not accumulate during it, and stores the genuine total when it ends.
 * Only the accumulator word $0AB2 differs from the original, and only while the window runs.
 */
const GENUINE_CAMERA_CHECKSUM = (0x9bea - 0x2315) & 0xffff; // = $78D5
export function CODE_B5ED70() {
  const x = d(0x90);
  if (!neg(x)) {
    sd(0x92, RARE_STRING >> 16);
    if (x >= 0x021f) {
      sd(0x90, (d(0x90) >> 1) | 0x8000); // ROR with carry set: checksum finished
      sd(0xb2, GENUINE_CAMERA_CHECKSUM);
    }
  }
  sd(0x92, 0);
  if (r16(R.time_stop_flags) & 0x0080) return;
  CODE_B5EDA0();
}

/** Velocity + 32-bit position add with the speed clamped to +-$0800 per frame ($B5EDB4 / $B5EE1B). */
function clampedStep(shake: number, velLo: number, velHi: number): [number, number] {
  let y = shake + velLo;
  const c = y > 0xffff ? 1 : 0;
  y &= 0xffff;
  let x = ((neg(shake) ? 0xffff : 0) + velHi + c) & 0xffff;
  if (neg(x)) {
    if (x !== 0xffff || y < 0xf800) {
      x = 0xffff;
      y = 0xf800;
    }
  } else if (x !== 0 || y >= 0x0801) {
    x = 0;
    y = 0x0800;
  }
  return [x, y];
}

/** $B5EDA0 */
function CODE_B5EDA0() {
  CODE_B5EE79();
  if (!(r16(R.time_stop_flags) & 0x0002)) {
    CODE_B5EF97();
    const [x, y] = clampedStep(d(0x9c), d(0xd2), d(0xd4));
    const lo = y + d(0xda);
    sd(0xda, lo);
    sd(0xdc, x + d(0xdc) + (lo >> 16));
    let a = 0x0100;
    if (a < r16(0x0adb)) {
      a = d(0xfe);
      if (a >= r16(0x0adb)) a = -1;
    }
    if (a >= 0) w16(0x0adb, a);
    // $B5EDF8
    w16(0x17d2, r16(0x0adb) - r16(R.screen_scroll_y_position));
    w16(R.screen_scroll_y_position, r16(0x0adb));
    w16(0x17c2, r16(0x0adb) - 1);
  }
  // $B5EE0A
  if (r16(R.time_stop_flags) & 0x0001) return;
  CODE_B5EEBF();
  const [x, y] = clampedStep(d(0x9a), d(0xce), d(0xd0));
  const lo = y + d(0xd6);
  sd(0xd6, lo);
  const hi = (x + d(0xd8) + (lo >> 16)) & 0xffff;
  sd(0xd8, hi);
  if (neg(hi)) {
    sd(0xd6, 0);
    sd(0xd8, 0);
  }
  let a = 0x0100;
  if (a < r16(0x0ad7)) {
    a = d(0xfc);
    if (a >= r16(0x0ad7)) a = -1;
  }
  if (a >= 0) w16(0x0ad7, a);
  // $B5EE65
  w16(0x17d6, r16(0x0ad7) - r16(R.screen_scroll_x_position));
  w16(R.screen_scroll_x_position, r16(0x0ad7));
  w16(R.screen_scroll_x_sub_position, d(0xd6));
}

/** $B5EE79 — screen shake: every 4th frame, a decaying offset whose sign alternates. */
export function CODE_B5EE79() {
  if (r16(R.active_frame_counter) & 0x0003) {
    sd(0x9a, 0);
    sd(0x9c, 0);
    return;
  }
  let a = d(0xf6);
  sd(0xf6, a >> 1);
  if (a < 0x40) a = 0;
  else if (d(0xfa) & 0x4000) a = (-a) & 0xffff;
  sd(0x9a, a);
  a = d(0xf8);
  sd(0xf8, a >> 1);
  if (a < 0x40) a = 0;
  else if (d(0xfa) & 0x8000) a = (-a) & 0xffff;
  sd(0x9c, a);
  sd(0xfa, d(0xfa) ^ 0xc000);
}

/**
 * Shared smoothing step ($B5EEBF X / $B5EFF9 Y). Moves the camera velocity towards what is needed
 * to reach the desired position: `shiftV`/`shiftA` (8-bit counters) set how strongly, `maxAccel`
 * limits the change per frame.
 *   prevLo/Hi: last desired position, posLo/Hi: camera, desLo/Hi: desired, velLo/Hi: velocity.
 */
function smooth(shiftV: number, shiftA: number, maxAccel: number, prev: number, pos: number, des: number, vel: number) {
  // $0AAC/$0AAE = previous desired - camera position, $0AA8/$0AAA = desired - previous desired
  let s = d(prev) - d(pos);
  sd(0xac, s);
  sd(0xae, d(prev + 2) - d(pos + 2) - (s < 0 ? 1 : 0));
  s = d(des) - d(prev);
  sd(0xa8, s);
  sd(0xaa, d(des + 2) - d(prev + 2) - (s < 0 ? 1 : 0));
  let lo = d(0xa8) + d(0xac);
  sd(0x92, lo);
  let a = (d(0xaa) + d(0xae) + (lo >> 16)) & 0xffff;
  // arithmetic shift of the 32-bit sum, shiftV+1... times (X counts down to negative)
  let x = (shiftV - 1) & 0xff;
  while (!(x & 0x80)) {
    const c = a & 1;
    a = (a >> 1) | (a & 0x8000);
    sd(0x92, (d(0x92) >> 1) | (c << 15));
    x = (x - 1) & 0xff;
  }
  sd(0x94, a);
  // TAX with 8-bit index registers: the sign test looks at bit 7 of the low byte
  if (a & 0x80) {
    sd(0x94, 0xffff);
    const lim = ((0xffff ^ maxAccel) + 1) & 0xffff;
    if (lim >= d(0x92)) sd(0x92, lim);
  } else {
    sd(0x94, 0);
    if (maxAccel < d(0x92)) sd(0x92, maxAccel);
  }
  // $B5EF13: damp the remaining distance
  let y = (shiftA - 1) & 0xff;
  if (!(y & 0x80)) {
    a = d(0xac);
    if (neg(d(0xae))) {
      if (a < 0xffe0) {
        do {
          const c = d(0xae) & 1;
          sd(0xae, (d(0xae) >> 1) | 0x8000);
          a = (a >> 1) | (c << 15);
          y = (y - 1) & 0xff;
        } while (!(y & 0x80));
        if (a >= 0xfff8) a = 0xfff8;
      }
    } else if (a >= 0x20) {
      do {
        const c = d(0xae) & 1;
        sd(0xae, d(0xae) >> 1);
        a = (a >> 1) | (c << 15);
        y = (y - 1) & 0xff;
      } while (!(y & 0x80));
      if (a < 0x0008) a = 0x0008;
    }
    sd(0xac, a);
  }
  // $B5EF47: target velocity = desired change + damped distance
  lo = d(0xa8) + d(0xac);
  sd(0xac, lo);
  sd(0xae, d(0xaa) + d(0xae) + (lo >> 16));
  if ((d(0xae) | d(0xac)) === 0) {
    sd(vel, d(0xac));
    sd(vel + 2, d(0xae));
    return;
  }
  lo = d(vel) + d(0x92);
  sd(vel, lo);
  const nv = (d(vel + 2) + d(0x94) + (lo >> 16)) & 0xffff;
  sd(vel + 2, nv);
  if (neg(nv ^ d(0xae))) {
    // overshoot direction: halve the velocity
    const c = d(vel + 2) & 1;
    sd(vel + 2, (d(vel + 2) >> 1) | (d(vel + 2) & 0x8000));
    sd(vel, (d(vel) >> 1) | (c << 15));
    return;
  }
  const t = d(0xae);
  let carry: boolean;
  if (neg(t)) {
    carry = t !== d(vel + 2) ? t >= d(vel + 2) : d(0xac) >= d(vel);
    if (!carry) return;
  } else {
    carry = t !== d(vel + 2) ? t >= d(vel + 2) : d(0xac) >= d(vel);
    if (carry) return;
  }
  // $B5EF83: do not overshoot the target velocity
  sd(vel, d(0xac));
  sd(vel + 2, d(0xae));
}

/** $B5EEBF — horizontal camera smoothing. */
export function CODE_B5EEBF() {
  smooth(d8(0xc8), d8(0xc9), d(0xc6), 0xa0, 0xd6, 0xde, 0xce);
}

/** $B5EF97 — vertical camera smoothing; faster catch-up when the target is far off screen. */
export function CODE_B5EF97() {
  const dy = (d(0xc3) - d(0x9e)) & 0xff; // target Y change this frame (8-bit)
  let sx: number;
  let sy: number;
  let accel: number;
  const fast = () => {
    sx = 3;
    sy = 3;
    accel = 0x00c0;
  };
  const medium = () => {
    sx = 2;
    sy = 2;
    accel = 0x0240;
  };
  const normal = () => {
    sx = d8(0xcc);
    sy = d8(0xcd);
    accel = d(0xca);
  };
  const ty = r16(0x0ae3);
  if (ty < r16(0x0aa5) && ty < r16(0x0adb)) {
    // moving up
    let a = d(0xc3) - 0x20;
    if (a < 0 || neg(a)) a = 0;
    if (a >= r16(0x0adb) || dy >= 0xfd) normal();
    else if (dy < 0xfa) medium();
    else fast();
  } else {
    // $B5EFC9: moving down
    let a = (d(0xc3) - 0xc0) & 0xffff;
    if (neg(a)) a = 0;
    const below = a - r16(0x0adb);
    if (below < 0) normal();
    else if (below >= 0x18) medium();
    else if (dy < 3) normal();
    else if (dy < 8) fast();
    else if (dy >= 0x80) normal();
    else medium();
  }
  sd(0x96, accel!);
  smooth(sx!, sy!, accel!, 0xa4, 0xda, 0xe2, 0xd2);
}

/** $B5F0CD — A = signed amplitude: start a horizontal screen shake. */
export function CODE_B5F0CD() {
  let a = reg.a & 0xffff;
  if (neg(a)) a = (-a) & 0xffff;
  w16(0x0af6, a);
  w16(0x0afa, r16(0x0afa) & ~0x4000);
  reg.a = 0x4000;
}

/** $B5F0ED — A = signed amplitude: start a vertical screen shake. */
export function CODE_B5F0ED() {
  let a = reg.a & 0xffff;
  if (neg(a)) a = (-a) & 0xffff;
  w16(0x0af8, a);
  w16(0x0afa, r16(0x0afa) | 0x8000);
  reg.a = 0x8000;
}

// =====================================================================================
// Camera setup at level load
// =====================================================================================

/** $B5E43E — load the camera behaviour parameters (offsets, smoothing) for the current preset. */
export function CODE_B5E43E() {
  const riding = (r16(R.current_player_mount) | r16(R.animal_type)) >= 1;
  let a = r16(0x0ab6);
  if (riding) a = ((a >> 8) | (a << 8)) & 0xffff; // animal buddies use the high byte's preset
  const x = (a & 0xff) << 3;
  const t = CAMERA_OFFSETS + x;
  w16(0x0aea, rom16(t) & 0xff00);
  w16(0x0aec, rom16(t + 1) & 0xff00);
  w16(0x0af0, rom16(t + 2) & 0xff00);
  w16(0x0af4, rom16(t + 3) & 0xff00);
  const sh = rom16(t + 5);
  w16(0x0ac8, sh & 0x0f0f);
  w16(0x0acc, ((sh & 0x0f0f) ^ sh) >> 4);
  w16(0x0ac6, (rom16(t + 7) & 0xff) << 3);
  w16(0x0aca, (rom16(t + 8) & 0xff) << 3);
  reg.a = r16(0x0aca);
}

/** $B5E4AA — place the camera on the active Kong at level start (with the entrance offset). */
export function CODE_B5E4AA() {
  const x = r16(R.active_kong_sprite);
  reg.x = x;
  const dir = r16(level.entrance_direction);
  let off = 0;
  if (dir & 0x0030) off = dir & 0x0010 ? 0x0080 : 0xff80;
  // a fake sprite in slot 0 holds the initial camera target
  w16(0x0d88, 0);
  w16(0x0d8a, off + r16(x + 6));
  off = 0;
  if (dir & 0x00c0) off = dir & 0x0040 ? 0x0080 : 0xff80;
  w16(0x0d8c, 0);
  w16(0x0d8e, off + r16(x + 0x0a));
  reg.y = 0x0d84;
  CODE_B5E560();
  CODE_B5ED3A();
  w16(0x0abc, reg.x);
}

const REGION_FORMATS = L("DATA_B5E389"); // 8 bytes per format: max X, max Y, mask, shift routine
const LEVEL_REGIONS_START = L("DATA_FD934D");
const LEVEL_REGIONS_END = L("DATA_FD934F");
const ZERO_FILL = L("zero_fill");
const SHIFT_ROUTINE_END = L("CODE_B5E3D6") & 0xffff;

/** $B5E3D1-$B5E3D6: shift helpers dispatched through DATA_B5E389 (A >>= n, AND #$1FFC, ASL). */
const shiftHelper = (n: number) => () => {
  let a = reg.a & 0xffff;
  for (let i = 0; i < n; i++) a >>= 1;
  reg.a = ((a & 0x1ffc) << 1) & 0xffff;
};
export const CODE_B5E3D1 = shiftHelper(5);
export const CODE_B5E3D2 = shiftHelper(4);
export const CODE_B5E3D3 = shiftHelper(3);
export const CODE_B5E3D4 = shiftHelper(2);
export const CODE_B5E3D5 = shiftHelper(1);
export const CODE_B5E3D6 = shiftHelper(0);

/** $B5E3D1-$B5E3D6 (JMP ($0034)): A >>= (5..0), then AND #$1FFC and ASL. */
function regionShift(a: number): number {
  const n = SHIFT_ROUTINE_END - r16(0x0034);
  for (let i = 0; i < n; i++) a >>= 1;
  return ((a & 0x1ffc) << 1) & 0xffff;
}

/**
 * $B5E0E2 — level load: decode the level's camera regions from ROM ($FD934D table), link
 * neighbouring regions together, reset the camera state and place it on the Kong.
 */
export function CODE_B5E0E2() {
  // clear the region tables $7E8D28-$7E9527 with a fixed-source DMA
  io16(0x4302, ZERO_FILL & 0xffff);
  io16(0x4304, ZERO_FILL >> 16);
  io16(0x4305, 0x0800);
  io16(0x2181, 0x8d28);
  io8(0x2183, 0x7e);
  io8(0x4301, 0x80);
  io8(0x4300, 0x08);
  io8(CPU.enable_dma, 0x01);
  w16(0x0afc, 0);
  w16(0x0afe, 0);
  get_level_number();
  const lvl = (reg.a << 1) & 0xffff;
  w16(0x0036, rom16(LEVEL_REGIONS_END + lvl));
  let src = rom16(LEVEL_REGIONS_START + lvl);
  const fmt = REGION_FORMATS + ((r16(0x0ab4) & 0x000f) << 3);
  // region 0 = the whole level
  w16(REG_RIGHT, rom16(fmt));
  w16(REG_BOTTOM, rom16(fmt + 2));
  w16(REG_LEFT, 0x0100);
  w16(REG_TOP, 0x0100);
  w16(0x0032, rom16(fmt + 4));
  w16(0x0034, rom16(fmt + 6));
  const end = r16(0x0036);
  let x = 0;
  const T = (o: number) => rom16(0xfd0000 | ((0x934d + src + o) & 0xffff));
  const maxX = (v: number) => {
    if (v >= r16(0x0afc)) w16(0x0afc, v);
  };
  const maxY = (v: number) => {
    if (v >= r16(0x0afe)) w16(0x0afe, v);
  };
  if (src >= end) {
    w16(0x0afc, r16(REG_RIGHT));
    w16(0x0afe, r16(REG_BOTTOM));
  } else if (r16(0x0032) !== 0) {
    // $B5E274: packed format with a per-level mask and shift routine
    const mask = r16(0x0032);
    do {
      x += 2;
      w16(REG_FLAGS + x, (T(0) & 0x000f) | (T(4) & 0x00c0));
      w16(REG_LEFT + x, ((T(0) & mask) >> 1) + 0x100);
      const r = ((((T(2) >> 1) & mask) >> 1) + 0x108) & 0xffff;
      w16(REG_RIGHT + x, r);
      maxX(r);
      w16(REG_TOP + x, regionShift(T(1) & 0x1ffc) + 0x100);
      const b = (regionShift((T(3) >> 1) & 0x1ffc) + 0x108) & 0xffff;
      w16(REG_BOTTOM + x, b);
      maxY(b);
      src = (src + 5) & 0xffff;
    } while (src < end);
  } else if (r16(0x0034) === 0) {
    // $B5E184
    do {
      x += 2;
      w16(REG_FLAGS + x, (T(0) & 0x000f) | (T(2) & 0x00c0));
      w16(REG_LEFT + x, ((T(0) & 0x1ff0) >> 1) + 0x100);
      w16(REG_TOP + x, (((T(1) >> 1) & 0x1ff0) >> 1) + 0x100);
      const r = ((((((T(3) & 0xff) << 1) + 0x20) << 2) & 0xffff) + r16(REG_LEFT + x)) & 0xffff;
      w16(REG_RIGHT + x, r);
      maxX(r);
      const b = ((((((T(4) & 0xff) << 1) + 0x1c) << 2) & 0xffff) + r16(REG_TOP + x)) & 0xffff;
      w16(REG_BOTTOM + x, b);
      maxY(b);
      src = (src + 5) & 0xffff;
    } while (src < end);
  } else {
    // $B5E1FF
    do {
      x += 2;
      w16(REG_FLAGS + x, (T(0) & 0x000f) | (T(2) & 0x00c0));
      w16(REG_LEFT + x, ((T(0) & 0xfff0) >> 1) + 0x100);
      w16(REG_TOP + x, ((T(2) & 0x003f) << 3) + 0x100);
      const r = ((((((T(3) & 0x03ff) << 1) + 0x20) << 2) & 0xffff) + r16(REG_LEFT + x)) & 0xffff;
      w16(REG_RIGHT + x, r);
      maxX(r);
      const b = (((T(4) & 0x00fc) << 1) + 0x108) & 0xffff;
      w16(REG_BOTTOM + x, b);
      maxY(b);
      src = (src + 5) & 0xffff;
    } while (src < end);
  }
  // $B5E2E9: link neighbouring regions
  w16(0x0aba, x);
  const last = x;
  x = 0;
  let y = 0;
  let state: "top" | "body" | "vert" = "top";
  for (;;) {
    if (state === "top") {
      // $B5E2F4
      if (x >= last) break;
      x += 2;
      state = "body";
    }
    if (state === "body") {
      // $B5E2FB
      y = x;
      const f = flags(x) & 0x000f;
      if (f === 0) {
        state = "top";
        continue;
      }
      const h = f & 0x000c;
      if (h === 0) {
        // $B5E32C: skip the regions starting before this one ends
        const a = (right(x) - 1) & 0xffff;
        do y += 2;
        while (a >= left(y));
      } else if (h === 0x0004) {
        reg.x = x;
        reg.y = y;
        CODE_B5E3DB();
        y = reg.y;
      } else {
        reg.x = x;
        reg.y = y;
        CODE_B5E3DB();
        y = reg.y;
        const v = (x >> 1) & 0xffff;
        if (r16(REG_LINK_LEFT + 2 + y) === 0) w16(REG_LINK_LEFT + 2 + y, v);
        else w16(REG_LINK_LEFT + 3 + y, v | r16(REG_LINK_LEFT + 3 + y));
      }
      state = "vert";
    }
    // $B5E339: links to the regions below
    let n = flags(x) & 0x0003;
    if (n !== 0) {
      reg.x = x;
      reg.y = y;
      if (n - 1 !== 0) {
        CODE_B5E411();
        n = 0;
      }
      CODE_B5E411();
      y = reg.y;
    }
    x += 2;
    y = x;
    if (x < last) {
      state = "body";
      continue;
    }
    if (x === last) {
      state = "vert";
      continue;
    }
    break;
  }
  // $B5E354: reset the camera
  w16(0x0a90, 0);
  w16(0x0ab2, 0);
  w16(0x0abc, 0);
  w16(0x0ae8, 0);
  w16(0x0aee, 0);
  w16(0x0af2, 0);
  w16(0x0ab6, r16(level.unknown_38));
  w16(0x0afc, r16(0x0afc) - 0x100);
  w16(0x0afe, r16(0x0afe) - 0xe0);
  CODE_B5E43E();
  CODE_B5E4AA();
}

/** $B5E3DB — X = region with a right neighbour: find it (left edge = our right edge, overlapping) and link both ways. */
export function CODE_B5E3DB() {
  const x = reg.x;
  let y = reg.y;
  for (;;) {
    const a = right(x);
    do y = (y + 2) & 0xffff;
    while (a !== left(y));
    if (top(x) >= bottom(y)) continue;
    if (top(y) >= bottom(x)) continue;
    break;
  }
  reg.y = y;
  w16(REG_FLAGS + 1 + x, (y >> 1) | r16(REG_FLAGS + 1 + x));
  if (r16(REG_LINK_LEFT + y) === 0) w16(REG_LINK_LEFT + y, x >> 1);
  else w16(REG_LINK_LEFT + 1 + y, (x >> 1) | r16(REG_LINK_LEFT + 1 + y));
}

/** $B5E411 — X = region: find the region Y below it (searching back from Y) and link both ways. */
export function CODE_B5E411() {
  const x = reg.x;
  let y = reg.y;
  const a = bottom(x);
  do y = (y - 2) & 0xffff;
  while (a !== top(y));
  reg.y = y;
  let v = r16(REG_LINK_DOWN + x);
  if (v !== 0) {
    v = ((v >> 8) | (v << 8)) & 0xffff;
    w16(REG_LINK_DOWN + x, v);
  }
  w16(REG_LINK_DOWN + x, (y >> 1) | r16(REG_LINK_DOWN + x));
  v = r16(REG_LINK_UP + y);
  if (v !== 0) {
    v = ((v >> 8) | (v << 8)) & 0xffff;
    w16(REG_LINK_UP + y, v);
  }
  w16(REG_LINK_UP + y, (x >> 1) | r16(REG_LINK_UP + y));
}

register({
  CODE_B5E3D1,
  CODE_B5E3D2,
  CODE_B5E3D3,
  CODE_B5E3D4,
  CODE_B5E3D5,
  CODE_B5E3D6,
  CODE_B5E0E2,
  CODE_B5E3DB,
  CODE_B5E411,
  camera_handler,
  CODE_B5E560,
  CODE_B5E5BA,
  CODE_B5E5FA,
  CODE_B5E660,
  CODE_B5E705,
  CODE_B5E72F,
  CODE_B5E749,
  CODE_B5E7B9,
  CODE_B5E7C5,
  CODE_B5E922,
  CODE_B5E954,
  CODE_B5E95B,
  CODE_B5E98C,
  CODE_B5E9BE,
  CODE_B5E9F8,
  CODE_B5EA3C,
  CODE_B5EB9A,
  CODE_B5EBBB,
  CODE_B5EC63,
  CODE_B5ECDE,
  CODE_B5ECFD,
  CODE_B5ED04,
  CODE_B5ED1E,
  CODE_B5ED3A,
  CODE_B5ED70,
  CODE_B5EE79,
  CODE_B5EEBF,
  CODE_B5EF97,
  CODE_B5F0CD,
  CODE_B5F0ED,
  CODE_B5E43E,
  CODE_B5E4AA,
});


// the generated stubs guess RTL for these; they return with RTS
for (const n of ["CODE_B5E3D1", "CODE_B5E3D2", "CODE_B5E3D3", "CODE_B5E3D4", "CODE_B5E3D5", "CODE_B5EA3C"]) setRetMode(L(n), RET_RTS);
