/**
 * Bank $BE (package BE2) — the more elaborate sprite movement routines: scripted paths
 * (state 09: Zingers, Screech...), orbits (0A/0B), homing on the Kong (1C), ground walkers with
 * terrain/level-edge/water handling (20-29), riding on another sprite (24).
 *
 * See be2_movement.ts for the dispatcher and the primitives. Same conventions: the original
 * register flow (reg.x / reg.y) is followed literally because callees depend on it.
 */
import { r8, r16, w8, w16, rom16, bus16, io8, io16, ioR16 } from "../../core/mem";
import { reg, register, callPtr } from "../../core/cpu";
import { setRetMode, RET_RTS } from "../../core/hybrid";
import { L, R, CPU, sprite } from "../../core/sym";
import {
  interpolate_x_velocity_global,
  interpolate_y_velocity_global,
  process_terrain_interaction_global,
  get_sprite_terrain_info_define_x,
  queue_sfx_if_on_screen_global,
  CODE_B8D246,
  CODE_B3F4B8,
  CODE_B3F4BC,
} from "../../gen/routines";
import { neg, isNeg, asr, spriteConst, setNZ, cur } from "./be2_util";
import {
  apply_x_y_position_from_velocity,
  handle_sprite_left_right,
  handle_sprite_up_down,
  handle_sprite_gravity,
  handle_sprite_on_level_x_boundary,
  process_terrain_handle_submerged,
  CODE_BEF158,
  CODE_BEF164,
  CODE_BEF10D,
} from "./be2_movement";

const PATH_TABLE = L("DATA_BEF1DC");
const ORBIT_FULL_TABLE = L("DATA_BEF3C7");
const ORBIT_PARTIAL_TABLE = L("DATA_BEF3EA");
const PATROL_X_TABLE = L("patrol_x_around_home_movement_state_table");
const RIDE_TABLE = L("DATA_BEF907");

const SFX_TIRE_WALL_BOUNCE = 0x0561; // sound(5, tire_wall_bounce)

// ---------------------------------------------------------------------------------------------
// State 09: follow a waypoint script read from the sprite's constants bank.
// $42 script offset, $44 speed (bit 15 = relative waypoints), $46/$48 waypoint x/y (0 = the
// other axis is the one being watched), $4A acceleration presets (x, y), $4C wave timer
// (high = countdown, low = reload), $50 wave delta added to the cross-axis speed.
// ---------------------------------------------------------------------------------------------

/** $BEF1D5 — state 09 dispatch (A = sub state * 2), then move. */
export function CODE_BEF1D5() {
  reg.x = reg.a & 0xffff;
  callPtr(0xbe, rom16(PATH_TABLE + reg.x));
  apply_x_y_position_from_velocity();
}

/** $BEF1E0 — path init: default acceleration presets, no wave, read the first waypoint. */
export function CODE_BEF1E0() {
  const x = reg.y;
  reg.x = x;
  const v = (r16(x + sprite.movement_sub_state) + 1) & 0xffff;
  w16(x + sprite.movement_sub_state, v);
  w16(x + 0x4a, 0x1919);
  w16(x + 0x4c, 0);
  w16(x + 0x50, 0);
  CODE_BEF266();
}

/**
 * The "reached or passed the waypoint" test of CODE_BEF1EE: equal, or the compare result
 * (target >= position) is the opposite of "moving negative".
 */
function waypointReached(x: number, target: number, pos: number, speed: number): boolean {
  const t = r16(x + target);
  const p = r16(x + pos);
  if (t === p) return true;
  const c = t >= p;
  const rored = ((t >> 1) | (c ? 0x8000 : 0)) & 0xffff;
  return !isNeg(rored ^ r16(x + speed));
}

/** $BEF1EE — path step: next waypoint once the watched axis reached it, else keep steering. */
export function CODE_BEF1EE() {
  const x = reg.y;
  reg.x = x;
  if (r16(x + 0x42) === 0) return CODE_BEF20F();
  if (r16(x + 0x46) !== 0) {
    if (waypointReached(x, 0x46, sprite.x_position, sprite.max_x_speed)) return CODE_BEF266();
    return CODE_BEF20F();
  }
  if (r16(x + 0x48) === 0) return CODE_BEF20F();
  if (waypointReached(x, 0x48, sprite.y_position, sprite.max_y_speed)) return CODE_BEF266();
  CODE_BEF20F();
}

/**
 * $BEF20F — steer: interpolate both speeds (preset bytes of $4A, swapped while watching x),
 * then run the wave: every $4C-high frames the wave delta $50 flips sign; it is added to the
 * speed of the axis that is not being watched.
 */
export function CODE_BEF20F() {
  const x = cur();
  reg.x = x;
  let a = r16(x + 0x4a);
  reg.y = r16(x + 0x46);
  if (reg.y !== 0) a = ((a >> 8) | (a << 8)) & 0xffff;
  const pushed = a;
  reg.a = a & 0xff;
  interpolate_x_velocity_global();
  reg.a = (pushed >> 8) & 0xff;
  interpolate_y_velocity_global();
  const x2 = cur();
  reg.x = x2;
  const timer = r16(x2 + 0x4c);
  reg.a = timer;
  if (timer === 0) {
    reg.z = true;
    return;
  }
  const t = (timer - 0x0100) & 0xffff;
  w16(x2 + 0x4c, t);
  reg.c = timer >= 0x0100;
  if (!reg.c) {
    // countdown expired: reload it from the low byte, flip the wave
    w8(x2 + 0x4d, t & 0xff);
    w16(x2 + 0x50, neg(r16(x2 + 0x50)));
  }
  const field = r16(x2 + 0x46) !== 0 ? sprite.max_y_speed : sprite.max_x_speed;
  const sum = r16(x2 + field) + r16(x2 + 0x50);
  reg.a = sum & 0xffff;
  reg.c = sum > 0xffff;
  w16(x2 + field, reg.a);
}

/** $BEF259 — after a new waypoint: wave countdown = half its reload, then steer. */
export function CODE_BEF259() {
  const x = cur();
  reg.x = x;
  w8(x + 0x4d, r8(x + 0x4c) >> 1);
  CODE_BEF20F();
}

/** $BEF266 — read the next waypoint (the script lives in the sprite constants' bank). */
export function CODE_BEF266() {
  reg.db = 0xbe; // PHK : PLB (not restored)
  w16(0x5e, 0);
  w16(0x60, r16(R.current_sprite_constants_bank));
  CODE_BEF26E();
}

/**
 * $BEF26E — script interpreter. Entries are 4 bytes (x, y) or a command word $FFFA-$FFFF:
 *   $FFFA off,val  write the word val at sprite+off     $FFFB t,d  wave timer $4C / delta $50
 *   $FFFC p        acceleration presets $4A              $FFFD a    jump to script offset a
 *   $FFFE s        speed/mode $44                        $FFFF      stop (movement state 0)
 * (The original dispatches commands with PHX : JMP (table,x) and pulls X back in each
 * handler; here that is a plain switch.)
 */
export function CODE_BEF26E() {
  for (;;) {
    const x = reg.x;
    const base = (r8(0x60) << 16) | r16(0x5e);
    const rd = (yy: number) => bus16((base + yy) & 0xffffff);
    let y = r16(x + 0x42);
    w16(x + 0x42, (y + 4) & 0xffff);
    const a = rd(y);
    y = (y + 2) & 0xffff;
    reg.y = y;
    if (a >= 0xfffa) {
      switch (a - 0xfffa) {
        case 0: {
          // CODE_BEF2F8
          const addr = (x + rd(y)) & 0xffff;
          y = (y + 2) & 0xffff;
          reg.y = y;
          w16(addr, rd(y));
          reg.x = cur();
          w16(reg.x + 0x42, (r16(reg.x + 0x42) + 2) & 0xffff);
          break;
        }
        case 1: // CODE_BEF30C
          w16(x + 0x4c, rd(y));
          y = (y + 2) & 0xffff;
          reg.y = y;
          w16(x + 0x50, rd(y));
          w16(x + 0x42, (r16(x + 0x42) + 2) & 0xffff);
          break;
        case 2: // CODE_BEF31E
          w16(x + 0x4a, rd(y));
          break;
        case 3: // CODE_BEF326
          w16(x + 0x42, rd(y));
          break;
        case 4: // CODE_BEF32E
          w16(x + 0x44, rd(y));
          break;
        default: // CODE_BEF336
          w16(x + sprite.movement_state, 0);
          return CODE_BEF20F();
      }
      continue;
    }

    // a waypoint: target position and the offset to it ($32 = dx, $34 = dy)
    let dx: number, dy: number;
    if (!isNeg(r16(x + 0x44))) {
      w16(x + 0x46, a);
      dx = (a - r16(x + sprite.x_position)) & 0xffff;
      const ty = rd(y);
      w16(x + 0x48, ty);
      dy = (ty - r16(x + sprite.y_position)) & 0xffff;
    } else {
      dx = a;
      w16(x + 0x46, (a + r16(x + sprite.x_position)) & 0xffff);
      dy = rd(y);
      w16(x + 0x48, (dy + r16(x + sprite.y_position)) & 0xffff);
    }
    w16(0x32, dx);
    w16(0x34, dy);
    const ady = isNeg(dy) ? neg(dy) : dy;
    const adx = isNeg(dx) ? neg(dx) : dx;
    w16(0x38, ady);
    w16(0x36, adx);
    const speed = r16(x + 0x44) & 0x7fff;
    if (adx >= ady) {
      // CODE_BEF33C: mostly horizontal; watch x, full speed on x, proportional speed on y
      w16(x + 0x48, 0);
      w16(x + sprite.max_x_speed, isNeg(dx) ? neg(speed) : speed);
      reg.a = ady;
      reg.y = adx;
      CODE_BEF361();
      w16(x + sprite.max_y_speed, isNeg(dy) ? neg(reg.a) : reg.a);
    } else {
      // mostly vertical; watch y
      w16(x + 0x46, 0);
      w16(x + sprite.max_y_speed, isNeg(dy) ? neg(speed) : speed);
      reg.a = adx;
      reg.y = ady;
      CODE_BEF361();
      w16(x + sprite.max_x_speed, isNeg(dx) ? neg(reg.a) : reg.a);
    }
    return CODE_BEF259();
  }
}

/**
 * $BEF361 — A * ($44,x & $7FFF) / Y with the hardware multiplier/divider, keeping 8-bit
 * operands by shifting and correcting the result by the net shift count afterwards.
 */
export function CODE_BEF361() {
  const x = reg.x;
  const divisor = reg.y & 0xffff;
  let a = reg.a & 0xffff;
  let s = 0;
  while (a >= 0x100) {
    a >>= 1;
    s++;
  }
  io8(CPU.multiply_A, a);
  let b = r16(x + 0x44) & 0x7fff;
  while (b >= 0x100) {
    b >>= 1;
    s++;
  }
  io8(CPU.multiply_B, b);
  io16(CPU.dividen, ioR16(CPU.multiply_result));
  reg.c = false;
  if (divisor === 0) {
    reg.a = 0;
    reg.y = s;
    reg.z = true;
    return;
  }
  let d = divisor;
  while (d >= 0x100) {
    d >>= 1;
    s--;
  }
  io8(CPU.divisor, d);
  let q = ioR16(CPU.divide_result);
  if (s > 0) {
    for (; s > 0; s--) {
      reg.c = (q & 0x8000) !== 0;
      q = (q << 1) & 0xffff;
    }
  } else {
    for (; s < 0; s++) {
      reg.c = (q & 1) !== 0;
      q >>= 1;
    }
  }
  reg.a = q;
  reg.y = 0;
  setNZ(q);
}

// ---------------------------------------------------------------------------------------------
// States 0A/0B: orbit around the spawn point. $42/$44 centre, $46 angle (8.8, high byte =
// angle), $48 high byte = radius, $20 angular speed (interpolated towards $26 for 0B),
// $4A = the two angle limits of the partial orbit.
// ---------------------------------------------------------------------------------------------

/** $BEF3C3 — state 0A: full orbit. */
export function orbit_full() {
  reg.x = reg.a & 0xffff;
  callPtr(0xbe, rom16(ORBIT_FULL_TABLE + reg.x));
}

/** Init shared by both orbits: centre = spawn point, angular speed = target speed. */
function orbitInit(x: number) {
  w16(x + 0x42, r16(x + sprite.x_position));
  w16(x + 0x44, r16(x + sprite.y_position));
  const v = r16(x + sprite.max_x_speed);
  w16(x + sprite.x_speed, v);
  return v;
}

/** $BEF3CB — full orbit init. */
export function CODE_BEF3CB() {
  const x = reg.y;
  reg.x = x;
  orbitInit(x);
  const v = (r16(x + sprite.movement_sub_state) + 1) & 0xffff;
  w16(x + sprite.movement_sub_state, v);
  CODE_BEF3DA();
}

/** $BEF3DA — full orbit step: advance the angle, place the sprite on the circle. */
export function CODE_BEF3DA() {
  const x = cur();
  reg.x = x;
  w16(x + 0x46, (r16(x + 0x46) + r16(x + sprite.x_speed)) & 0xffff);
  CODE_BEF449();
}

/** $BEF3E6 — state 0B: swing back and forth between two angles. */
export function orbit_partial() {
  reg.x = reg.a & 0xffff;
  callPtr(0xbe, rom16(ORBIT_PARTIAL_TABLE + reg.x));
}

/** $BEF3EE — partial orbit init (limits swapped when starting in the negative direction). */
export function CODE_BEF3EE() {
  const x = reg.y;
  reg.x = x;
  const v = orbitInit(x);
  if (isNeg(v)) {
    const l = r16(x + 0x4a);
    w16(x + 0x4a, ((l >> 8) | (l << 8)) & 0xffff);
  }
  const s = (r16(x + sprite.movement_sub_state) + 1) & 0xffff;
  w16(x + sprite.movement_sub_state, s);
  CODE_BEF404();
}

/** $BEF404 — partial orbit step: reverse the target angular speed past the limit angle. */
export function CODE_BEF404() {
  const x = cur();
  reg.x = x;
  let lim = r16(x + 0x4a);
  if (!isNeg(r16(x + sprite.max_x_speed))) lim = ((lim >> 8) | (lim << 8)) & 0xffff;
  lim &= 0xff00;
  w16(0x5e, lim);
  const old = r16(x + 0x46);
  w16(0x60, old);
  const spd = r16(x + sprite.x_speed);
  w16(x + 0x46, (old + spd) & 0xffff);
  let flip: boolean;
  if (isNeg(spd)) {
    flip = ((lim - old) & 0xffff) >= spd;
  } else {
    // CLC : SBC $60 = lim - old - 1, then + speed: carry = crossed the limit
    flip = ((lim - old - 1) & 0xffff) + spd > 0xffff;
  }
  if (flip) w16(x + sprite.max_x_speed, neg(r16(x + sprite.max_x_speed)));
  reg.a = 0x000a;
  interpolate_x_velocity_global();
  reg.x = cur();
  CODE_BEF449();
}

/** $BEF449 — place the sprite at centre + radius * (sin, cos)(angle). */
export function CODE_BEF449() {
  reg.db = 0xbe; // PHK : PLB (not restored)
  const x = reg.x;
  w16(0x5e, r16(x + 0x48) & 0xff00);
  const angle = r8(x + 0x47);
  w16(0x60, angle);
  reg.a = angle;
  CODE_B3F4B8();
  reg.n = isNeg(reg.a);
  CODE_BEF47B();
  let x2 = cur();
  reg.x = x2;
  w16(x2 + sprite.x_position, (reg.a + r16(x2 + 0x42)) & 0xffff);
  reg.a = r16(0x60);
  CODE_B3F4BC();
  reg.n = isNeg(reg.a);
  CODE_BEF47B();
  x2 = cur();
  reg.x = x2;
  const sum = (reg.a ^ 0xffff) + 1 + r16(x2 + 0x44);
  reg.a = sum & 0xffff;
  reg.c = sum > 0xffff;
  w16(x2 + sprite.y_position, reg.a);
}

/** $BEF47B — signed (A * radius) / 256 via the multiplier; the result has A's opposite sign. */
export function CODE_BEF47B() {
  const a = reg.a & 0xffff;
  const negative = isNeg(a);
  const mag = negative ? neg(a) : a;
  io16(CPU.multiply_A, mag | r16(0x5e));
  const p = (ioR16(CPU.multiply_result) >> 8) & 0xff;
  reg.a = negative ? p : neg(p);
  setNZ(reg.a);
}

// ---------------------------------------------------------------------------------------------
// State 1C: home in on the Kong. Sub state 0 aims: speed = distance * 256 / $48 (frames);
// afterwards the sprite also follows the Kong's own movement ($48/$4A = last Kong position)
// and accelerates downwards by $4C, up to $800.
// ---------------------------------------------------------------------------------------------

/** Distance (Kong - sprite) as a speed: (|d| swapped into 8.8) / frames, with d's sign. */
function aimSpeed(y: number, kongPos: number, pos: number, signTemp: number, saveTo: number) {
  w16(signTemp, 0);
  let d = (kongPos - r16(y + pos)) & 0xffff;
  if (isNeg(d)) {
    d = neg(d);
    w16(signTemp, 0xffff);
  }
  io16(CPU.dividen, ((d >> 8) | (d << 8)) & 0xffff);
  io8(CPU.divisor, r8(y + 0x48));
  w16(y + saveTo, kongPos);
  const q = ioR16(CPU.divide_result);
  return isNeg(r16(signTemp)) ? neg(q) : q;
}

/** $BEF6C3 — state 1C. */
export function home_in_on_kong() {
  const y = reg.y;
  const kong = r16(R.active_kong_sprite);
  if ((reg.a & 0xffff) === 0) {
    reg.x = kong;
    // vertical: added to the current y speed
    const vy = aimSpeed(y, r16(kong + sprite.y_position), sprite.y_position, 0x32, 0x4a);
    w16(0x34, 0);
    w16(y + sprite.y_speed, (vy + r16(y + sprite.y_speed)) & 0xffff);
    // horizontal (the divisor byte $48 is read before it is overwritten with the Kong x)
    const vx = aimSpeedX(y, kong);
    reg.x = y;
    const s = (r16(y + sprite.movement_sub_state) + 1) & 0xffff;
    w16(y + sprite.movement_sub_state, s);
    w16(y + sprite.x_speed, vx);
  } else {
    // CODE_BEF734: carry the sprite along with the Kong's movement since last frame
    reg.x = kong;
    const kx = r16(kong + sprite.x_position);
    w16(y + sprite.x_position, (kx - r16(y + 0x48) + r16(y + sprite.x_position)) & 0xffff);
    w16(y + 0x48, kx);
    const ky = r16(kong + sprite.y_position);
    w16(y + sprite.y_position, (ky - r16(y + 0x4a) + r16(y + sprite.y_position)) & 0xffff);
    w16(y + 0x4a, ky);
  }
  // CODE_BEF75B
  apply_x_y_position_from_velocity();
  const x = cur();
  reg.x = x;
  let v = (r16(x + 0x4c) + r16(x + sprite.y_speed)) & 0xffff;
  if (!isNeg(v) && v >= 0x0800) v = 0x0800;
  w16(x + sprite.y_speed, v);
  reg.c = isNeg(v);
  reg.a = (v << 1) & 0xffff;
  if (reg.c) return;
  // falling: take the priority bits (12-13) from $4E
  const p = r16(x + sprite.oam_property);
  reg.a = ((p ^ r16(x + 0x4e)) & 0x3000) ^ p;
  w16(x + sprite.oam_property, reg.a);
}

function aimSpeedX(y: number, kong: number) {
  w16(0x34, 0);
  let d = (r16(kong + sprite.x_position) - r16(y + sprite.x_position)) & 0xffff;
  if (isNeg(d)) {
    d = neg(d);
    w16(0x34, 0xffff);
  }
  io16(CPU.dividen, ((d >> 8) | (d << 8)) & 0xffff);
  io8(CPU.divisor, r8(y + 0x48));
  w16(y + 0x48, r16(kong + sprite.x_position));
  const q = ioR16(CPU.divide_result);
  return isNeg(r16(0x34)) ? neg(q) : q;
}

// ---------------------------------------------------------------------------------------------
// Ground walkers (states 20-29)
// ---------------------------------------------------------------------------------------------

/** $BEF7AB — state 20: walk with terrain, level edges, gravity. */
export function CODE_BEF7AB() {
  process_terrain_handle_submerged();
  handle_sprite_on_level_x_boundary();
  handle_sprite_left_right();
  handle_sprite_gravity();
  CODE_B8D246();
}

/** $BEF7EF — state 22: walk, turning around when hitting a wall. */
export function CODE_BEF7EF() {
  const target = r16(reg.y + sprite.max_x_speed);
  CODE_BEF7AB();
  reg.y = target;
  const x = cur();
  reg.x = x;
  reg.a = 0x0002 & r16(x + sprite.terrain_interaction);
  if (reg.a) {
    reg.a = neg(target);
    w16(x + sprite.max_x_speed, reg.a);
  }
}

/** $BEF808 — state 23: walk back and forth around home, turning at walls and range ends. */
export function patrol_x_around_home() {
  reg.x = reg.a & 0xffff;
  callPtr(0xbe, rom16(PATROL_X_TABLE + reg.x));
  CODE_BEF7AB();
}

/** $BEF815 */
export function patrol_x_around_home_init_state() {
  const x = reg.y;
  reg.x = x;
  w16(x + 0x42, r16(x + sprite.x_position));
  w16(x + 0x44, r16(x + sprite.y_position));
  w16(x + 0x48, r16(x + sprite.max_x_speed));
  const s = (r16(x + sprite.movement_sub_state) + 1) & 0xffff;
  w16(x + sprite.movement_sub_state, s);
}

/** $BEF825 */
export function patrol_x_around_home_patrol_state() {
  const y = reg.y;
  if ((r16(y + sprite.terrain_attributes) & 0x0007) === 0x0006) {
    // CODE_BEF86E: steep terrain, go to sub state 2
    reg.x = y;
    w16(y + sprite.movement_sub_state, (r16(y + sprite.movement_sub_state) + 1) & 0xffff);
    return;
  }
  if (r16(y + sprite.terrain_interaction) & 0x0002) return CODE_BEF892();
  // the pace check (an inline copy of CODE_BEF10D in the original)
  CODE_BEF10D();
}

/**
 * $BEF892 — hit a wall: move home so that the wall is the end of the range and turn around
 * (the left end is clamped to x = $100).
 */
export function CODE_BEF892() {
  const y = reg.y;
  reg.x = y;
  const range = r16(y + 0x46);
  let v: number;
  if (isNeg(r16(y + 0x48))) {
    let home = ((range >> 8) & 0xff) + r16(y + sprite.x_position);
    home &= 0xffff;
    if (home < 0x0100) home = 0x0100;
    w16(y + 0x42, home);
    v = r16(y + 0x48);
    v = isNeg(v) ? neg(v) : v;
  } else {
    w16(y + 0x42, (r16(y + sprite.x_position) - (range & 0xff)) & 0xffff);
    v = r16(y + 0x48);
    v = isNeg(v) ? v : neg(v);
  }
  w16(y + sprite.max_x_speed, v);
  w16(y + 0x48, v);
  reg.a = v;
}

/** $BEF8D0 — sub state 2: once off the steep terrain, turn around as if hitting a wall. */
export function CODE_BEF8D0() {
  const y = reg.y;
  if ((r16(y + sprite.terrain_attributes) & 0x0007) === 0x0006) return;
  reg.x = y;
  w16(y + 0x48, neg(r16(y + 0x48)));
  w16(y + sprite.terrain_interaction, r16(y + sprite.terrain_interaction) | 0x0002);
  w16(y + sprite.movement_sub_state, (r16(y + sprite.movement_sub_state) - 1) & 0xffff);
}

/** $BEFA15 — state 25: walk with gravity from $22 instead of the constants. */
export function CODE_BEFA15() {
  process_terrain_handle_submerged();
  handle_sprite_on_level_x_boundary();
  const x = cur();
  reg.x = x;
  const sum = r16(x + sprite.unknown_22) + r16(x + sprite.y_speed);
  let v = sum & 0xffff;
  reg.c = sum > 0xffff;
  if (!isNeg(v)) {
    reg.y = 0x0002;
    const max = spriteConst(0x0002);
    reg.c = v >= max;
    if (reg.c) v = max;
  }
  w16(x + sprite.y_speed, v);
  handle_sprite_left_right();
  CODE_B8D246();
}

/** ($1E & $0101) == $0101: on the ground after a fall (landed this frame). */
function landed(x: number) {
  return (r16(x + sprite.terrain_interaction) & 0x0101) === 0x0101;
}

/** $BEFA37 — state 26: fall without steering; on landing switch to state $53. */
export function CODE_BEFA37() {
  process_terrain_handle_submerged();
  handle_sprite_on_level_x_boundary();
  handle_sprite_gravity();
  CODE_B8D246();
  const x = cur();
  reg.x = x;
  if (landed(x)) {
    reg.a = r8(x + sprite.movement_sub_state);
    w16(x + sprite.movement_state, reg.a);
  }
}

/** $BEFA58 — state 27: bounce: on landing invert the y speed, quarter x speed, state 26. */
export function CODE_BEFA58() {
  process_terrain_handle_submerged();
  handle_sprite_on_level_x_boundary();
  handle_sprite_gravity();
  CODE_B8D246();
  const x = cur();
  reg.x = x;
  if (!landed(x)) return;
  w16(x + sprite.y_speed, neg(r16(x + sprite.y_speed)));
  const h = asr(r16(x + sprite.x_speed));
  reg.c = (h & 1) !== 0;
  reg.a = asr(h);
  w16(x + sprite.x_speed, reg.a);
  w16(x + sprite.movement_state, (r16(x + sprite.movement_state) - 1) & 0xffff);
}

/**
 * $BEFA88 — state 28 (rolling tire style): walk; at a wall, hop up if the wall top is within
 * $42 pixels (speed halved, y speed from $44), else bounce back with a sound.
 */
export function CODE_BEFA88() {
  const target = r16(reg.y + sprite.max_x_speed);
  CODE_BEF7AB();
  const x = cur();
  reg.x = x;
  reg.a = 0x0002 & r16(x + sprite.terrain_interaction);
  if (!reg.a) {
    reg.a = target;
    return;
  }
  w16(0x34, (r16(x + sprite.y_position) - r16(x + 0x42)) & 0xffff);
  reg.y = isNeg(target) ? 0xfff1 : 0x000f;
  reg.a = (reg.y + r16(x + sprite.x_position)) & 0xffff;
  get_sprite_terrain_info_define_x();
  let climb = false;
  const inv = (reg.a ^ 0xffff) & 0xffff;
  if (isNeg(inv)) {
    const top = (inv + 0x6301) & 0xffff;
    const d = top - r16(x + sprite.y_position);
    if (d >= 0) climb = true;
    else climb = (d & 0xffff) + r16(x + 0x42) > 0xffff;
  }
  if (climb) {
    // CODE_BEFAC5
    w16(x + sprite.max_x_speed, target);
    w16(x + sprite.x_speed, asr(target));
    reg.a = r16(x + 0x44);
    w16(x + sprite.y_speed, reg.a);
    return;
  }
  // CODE_BEFAD3
  w16(x + sprite.max_x_speed, neg(target));
  w16(x + sprite.x_speed, 0);
  w16(x + sprite.x_sub_position, 0);
  reg.a = SFX_TIRE_WALL_BOUNCE;
  queue_sfx_if_on_screen_global();
}

/**
 * $BEFAE6 — state 29: fly with terrain collisions; a stopped x target becomes the reversed
 * old one (bounce off walls), and the y target reverses on landing or when it was stopped.
 */
export function CODE_BEFAE6() {
  const y = reg.y;
  w16(0x0daa, r16(y + sprite.max_x_speed));
  w16(0x0dae, r16(y + sprite.max_y_speed));
  handle_sprite_left_right();
  handle_sprite_up_down();
  process_terrain_interaction_global();
  const x = cur();
  reg.x = x;
  reg.a = r16(x + sprite.max_x_speed);
  if (reg.a === 0) {
    reg.a = neg(r16(0x0daa));
    reg.c = r16(0x0daa) === 0;
    w16(x + sprite.max_x_speed, reg.a);
  }
  reg.a = r16(x + sprite.max_y_speed);
  if (reg.a !== 0) {
    reg.a = r16(x + sprite.terrain_interaction) & 0x0101;
    reg.c = reg.a >= 0x0001;
    if (reg.a !== 0x0001) return;
  }
  reg.a = neg(r16(0x0dae));
  w16(x + sprite.max_y_speed, reg.a);
  w16(x + sprite.y_speed, 0);
}

/** $BEFB22 — state 2A: vertical movement with terrain, horizontal speed kept out of it. */
export function CODE_BEFB22() {
  const x = reg.y;
  reg.x = x;
  const target = r16(x + sprite.max_x_speed);
  const speed = r16(x + sprite.x_speed);
  w16(x + sprite.x_speed, 0);
  handle_sprite_up_down();
  process_terrain_interaction_global();
  const x2 = cur();
  reg.x = x2;
  w16(x2 + sprite.x_speed, speed);
  w16(x2 + sprite.max_x_speed, target);
  reg.a = target;
}

// ---------------------------------------------------------------------------------------------
// State 24: ride on another sprite (the Kong's $42 = the sprite it stands on) while pacing
// vertically and following the ground below.
// ---------------------------------------------------------------------------------------------

/** $BEF8EE — state 24. */
export function CODE_BEF8EE() {
  const y = reg.y;
  reg.x = r8(y + sprite.movement_sub_state) << 1;
  callPtr(0xbe, rom16(RIDE_TABLE + reg.x));
  reg.y = cur();
  apply_x_y_position_from_velocity();
  const s = reg.y;
  reg.a = r16(s + sprite.x_position);
  w16(s + 0x42, reg.a);
  handle_sprite_up_down();
}

/** $BEF90B — init: vertical pace setup, remember the ground height, pick the carrier. */
export function CODE_BEF90B() {
  CODE_BEF158();
  const x = reg.x;
  w16(x + sprite.ground_y_position, r16(x + sprite.y_position));
  const y = cur();
  reg.y = y;
  const kong = r16(R.active_kong_sprite);
  reg.x = kong;
  w16(y + sprite.render_order, r16(kong + 0x42));
  CODE_BEF91C();
}

/**
 * $BEF91C — $10 = carrier x - $5C ($32 = the old value). The carrier is the sprite whose
 * address is in $02; sprites before this one in the table have already moved this frame, so
 * their previous x ($4A) is used instead.
 */
export function CODE_BEF91C() {
  const y = cur();
  reg.y = y;
  const carrier = r16(y + 0x02);
  reg.x = carrier;
  w16(0x32, r16(y + sprite.terrain_attributes));
  const a = carrier >= y ? r16(carrier + sprite.x_position) : r16(carrier + 0x4a);
  const d = a - r16(y + sprite.unknown_5C);
  reg.a = d & 0xffff;
  reg.c = d >= 0;
  w16(y + sprite.terrain_attributes, reg.a);
}

/**
 * $BEF9F2 — probe the terrain at (x + X + $5C, ground + A). Returns A = ground height found
 * (non-zero) or 0.
 */
export function CODE_BEF9F2() {
  const y = cur();
  reg.y = y;
  w16(0x34, (reg.a + r16(y + sprite.ground_y_position)) & 0xffff);
  reg.a = (reg.x + r16(y + sprite.x_position) + r16(y + sprite.unknown_5C)) & 0xffff;
  get_sprite_terrain_info_define_x();
  const inv = (reg.a ^ 0xffff) & 0xffff;
  if (!isNeg(inv)) {
    reg.a = 0;
    reg.z = true;
    return;
  }
  const s = inv + 0x6301;
  reg.a = s & 0xffff;
  reg.c = s > 0xffff;
  reg.z = reg.a === 0;
}

/** Three probes at y offsets 0, -$40, +$40 for one x offset; first hit wins. */
function probeColumn(dx: number) {
  for (const dy of [0x0000, 0xffc0, 0x0040]) {
    reg.a = dy;
    reg.x = dx;
    CODE_BEF9F2();
    if (reg.a !== 0) return reg.a;
  }
  return 0;
}

/** $BEF937 — ride step: follow the ground, steer vertically towards it, follow the carrier. */
export function CODE_BEF937() {
  w16(0x0a92, 0);
  w16(0x0a92, probeColumn(0x0000));
  w16(0x0a94, r16(0xac));
  w16(0x0a96, 0);
  w16(0x0a96, probeColumn(0x0040));
  const y = cur();
  reg.y = y;
  let g = r16(0x0a92);
  if (!g) g = r16(0x0a96);
  if (!g) g = r16(y + sprite.ground_y_position);
  w16(y + sprite.ground_y_position, g);
  const home = (g - r16(y + sprite.ground_distance)) & 0xffff;
  w16(y + 0x44, home);
  const d = (home - r16(y + sprite.y_position)) & 0xffff;
  w16(0x32, d);
  if (!isNeg(d ^ r16(y + sprite.max_y_speed))) {
    const range = r16(y + 0x4a);
    let a: number;
    let past: boolean;
    if (isNeg(d)) {
      a = (((range >> 8) & 0xff) + d) & 0xffff;
      past = isNeg(a);
    } else {
      a = (d - (range & 0xff)) & 0xffff;
      past = !isNeg(a);
    }
    if (past) {
      // CODE_BEF9C7: push the vertical target speed towards the ground line
      w16(y + sprite.max_y_speed, (((a << 5) & 0xffff) + r16(y + 0x4c)) & 0xffff);
    }
  }
  // CODE_BEF9D3
  CODE_BEF164();
  CODE_BEF91C();
  const s = reg.y;
  const nx = (reg.a - r16(0x32) + r16(s + sprite.x_position)) & 0xffff;
  w16(s + sprite.x_position, nx);
  const v = (neg((nx - r16(s + sprite.terrain_attributes)) & 0xffff) << 3) & 0xffff;
  reg.a = v;
  w16(s + sprite.x_speed, v);
}

// ---------------------------------------------------------------------------------------------

register({
  CODE_BEF1D5,
  CODE_BEF1E0,
  CODE_BEF1EE,
  CODE_BEF20F,
  CODE_BEF259,
  CODE_BEF266,
  CODE_BEF26E,
  CODE_BEF361,
  orbit_full,
  CODE_BEF3CB,
  CODE_BEF3DA,
  orbit_partial,
  CODE_BEF3EE,
  CODE_BEF404,
  CODE_BEF449,
  CODE_BEF47B,
  home_in_on_kong,
  CODE_BEF7AB,
  CODE_BEF7EF,
  patrol_x_around_home,
  patrol_x_around_home_init_state,
  patrol_x_around_home_patrol_state,
  CODE_BEF892,
  CODE_BEF8D0,
  CODE_BEFA15,
  CODE_BEFA37,
  CODE_BEFA58,
  CODE_BEFA88,
  CODE_BEFAE6,
  CODE_BEFB22,
  CODE_BEF8EE,
  CODE_BEF90B,
  CODE_BEF91C,
  CODE_BEF9F2,
  CODE_BEF937,
});
for (const n of [
  "CODE_BEF1D5", "CODE_BEF1E0", "CODE_BEF1EE", "CODE_BEF20F", "CODE_BEF259", "CODE_BEF266",
  "CODE_BEF26E", "CODE_BEF361", "orbit_full", "CODE_BEF3CB", "CODE_BEF3DA", "orbit_partial",
  "CODE_BEF3EE", "CODE_BEF404", "CODE_BEF449", "CODE_BEF47B", "home_in_on_kong", "CODE_BEF7AB",
  "CODE_BEF7EF", "patrol_x_around_home", "patrol_x_around_home_init_state",
  "patrol_x_around_home_patrol_state", "CODE_BEF892", "CODE_BEF8D0", "CODE_BEFA15",
  "CODE_BEFA37", "CODE_BEFA58", "CODE_BEFA88", "CODE_BEFAE6", "CODE_BEFB22", "CODE_BEF8EE",
  "CODE_BEF90B", "CODE_BEF91C", "CODE_BEF9F2", "CODE_BEF937",
])
  setRetMode(L(n), RET_RTS);
