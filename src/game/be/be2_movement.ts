/**
 * Bank $BE (package BE2) — the generic sprite movement system.
 *
 * Every enemy/object with a `movement_state` ($52 = routine index, $53 = sub state) gets moved
 * by `process_current_movement` each frame: it dispatches through `sprite_movement_routines`
 * with X = index*2, A = sub state*2 and Y = the current sprite. The routines combine a few
 * primitives: apply velocity to the 24-bit position, interpolate x/y speed towards the target
 * speed ($26/$2A) with the acceleration preset from the sprite constants, and gravity.
 *
 * The movement routines are transliterated with the real registers (`reg.x`/`reg.y`) because
 * several of them use whatever X/Y the previous helper left (e.g. `interpolate_x_velocity`
 * leaves Y = current sprite and sometimes X = preset index), exactly like the original.
 *
 * Common sprite fields used here: $06/$0A x/y position, $04/$08 sub-pixel, $20/$24 x/y speed,
 * $26/$2A target x/y speed, $1E terrain interaction (bit 1 = hit a wall, bit 0 = on ground),
 * $42..$50 per-movement variables (home position, ranges, patrol speeds...).
 */
import { r8, r16, w8, w16, rom16 } from "../../core/mem";
import { reg, register, callPtr } from "../../core/cpu";
import { setRetMode, RET_RTS, RET_RTL } from "../../core/hybrid";
import { L, R, sprite } from "../../core/sym";
import {
  interpolate_x_velocity_global,
  interpolate_y_velocity_global,
  process_terrain_interaction_global,
  CODE_B8D246,
} from "../../gen/routines";
import { neg, isNeg, spriteConst, setNZ, cur } from "./be2_util";

const MOVEMENT_ROUTINES = L("sprite_movement_routines");

// ---------------------------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------------------------

/** $BEF039 — run the current sprite's movement routine (from its movement_state word). */
export function process_current_movement() {
  reg.a = r16(cur() + sprite.movement_state);
  process_alternate_movement();
}

/** $BEF03D — run movement routine A (low byte = routine, high byte = sub state). */
export function process_alternate_movement() {
  const a = reg.a & 0xffff;
  reg.x = (a & 0xff) << 1;
  reg.a = ((a >> 8) & 0xff) << 1;
  reg.c = false; // from the ASL of a value below $200
  reg.y = cur();
  callPtr(0xbe, rom16(MOVEMENT_ROUTINES + reg.x));
  reg.x = cur();
  setNZ(reg.x);
}

/** $BEF0A7 — movement state 0 (and $1E/$1F): no movement. */
export function movement_return_state() {}

// ---------------------------------------------------------------------------------------------
// Velocity -> position. Positions are 24-bit: the word at +5 holds (sub-pixel, pixel low) and
// the byte at +7 the pixel high byte, so the 8.8 velocity is added to the word at +5 and the
// sign extension + carry to the byte at +7.
// ---------------------------------------------------------------------------------------------

function addVelocity(y: number, posLo: number, speed: number) {
  const v = r16(y + speed);
  const ext = isNeg(v) ? 0xffff : 0x0000;
  const sum = r16(y + posLo) + v;
  w16(y + posLo, sum & 0xffff);
  const hi = (ext & 0xff) + r8(y + posLo + 2) + (sum > 0xffff ? 1 : 0);
  w8(y + posLo + 2, hi & 0xff);
  // 8-bit ADC: B keeps the high byte of the word sum
  reg.a = (sum & 0xff00) | (hi & 0xff);
  reg.x = ext;
  reg.c = hi > 0xff;
}

/** $BEF0A8 — apply both velocities of sprite Y to its position. */
export function apply_x_y_position_from_velocity() {
  apply_y_position_from_velocity();
  apply_x_position_from_velocity();
}

/** $BEF0AB — x_position += x_speed (sprite Y). */
export function apply_x_position_from_velocity() {
  addVelocity(reg.y, 0x05, sprite.x_speed);
}

/** $BEF0C7 — y_position += y_speed (sprite Y). */
export function apply_y_position_from_velocity() {
  addVelocity(reg.y, 0x09, sprite.y_speed);
}

// ---------------------------------------------------------------------------------------------
// Velocity interpolation and gravity from the sprite constants
// ---------------------------------------------------------------------------------------------

/** $BEFB3B — accelerate y_speed towards the target y speed (preset = constants +4). */
export function handle_sprite_up_down() {
  reg.y = 0x0004;
  reg.a = spriteConst(0x0004);
  interpolate_y_velocity_global();
}

/** $BEFB45 — accelerate x_speed towards the target x speed (preset = constants +4). */
export function handle_sprite_left_right() {
  reg.y = 0x0004;
  reg.a = spriteConst(0x0004);
  interpolate_x_velocity_global();
}

/** $BEFB4F — add gravity (constants +0) to y_speed, capped at the max fall speed (+2). */
export function handle_sprite_gravity() {
  const x = cur();
  reg.x = x;
  reg.y = 0x0002;
  const sum = spriteConst(0x0000) + r16(x + sprite.y_speed);
  let v = sum & 0xffff;
  reg.c = sum > 0xffff;
  if (!isNeg(v)) {
    const max = spriteConst(0x0002);
    reg.c = v >= max;
    if (reg.c) v = max;
  }
  w16(x + sprite.y_speed, v);
  reg.a = v;
}

/** $BEF0E3 — state 04: move, accelerate horizontally, fall. */
export function handle_x_y_gravity_interpolate_x() {
  apply_x_y_position_from_velocity();
  handle_sprite_left_right();
  handle_sprite_gravity();
}

/** $BEF52D — state 0F: accelerate both ways, then move. */
export function handle_x_y_movement() {
  handle_sprite_left_right();
  handle_sprite_up_down();
  apply_x_y_position_from_velocity();
}

// ---------------------------------------------------------------------------------------------
// Pacing: turn around when leaving a range around the home position.
// x: home $42, range $46 (low = right, high = left), patrol speed $48 (target speed $26)
// y: home $44, range $4A (low = down, high = up),   patrol speed $4C (target speed $2A)
// ---------------------------------------------------------------------------------------------

/** Sub-state dispatch through a 2-entry `JSR (table,x)` indexed by $53. */
function subStateJsr(table: number) {
  reg.x = r8(reg.y + sprite.movement_sub_state) << 1;
  callPtr(0xbe, rom16(table + reg.x));
}

/** Shared tail of the pace checks: reverse the patrol speed and use it as target speed. */
function reverse(y: number, patrol: number, target: number) {
  const v = neg(r16(y + patrol));
  w16(y + patrol, v);
  w16(y + target, v);
  reg.a = v;
}

/**
 * Pace check for one axis (CODE_BEF10D / CODE_BEF164 / CODE_BEF687). `scale` multiplies the
 * range bytes (1, or 4 for CODE_BEF687's vertical range).
 */
function paceAxis(y: number, target: number, range: number, home: number, pos: number, patrol: number, scale: number) {
  let bound: number;
  if (isNeg(r16(y + target))) {
    // moving left/up: turn when the position is at or before home - high range byte
    const dist = ((r16(y + range) >> 8) & 0xff) * scale;
    bound = (r16(y + home) - dist) & 0xffff;
    reg.c = bound >= r16(y + pos);
    reg.a = bound;
    if (reg.c) reverse(y, patrol, target);
  } else {
    // moving right/down: turn when the position is past home + low range byte
    const dist = (r16(y + range) & 0xff) * scale;
    bound = (dist + r16(y + home)) & 0xffff;
    reg.c = bound >= r16(y + pos);
    reg.a = bound;
    if (!reg.c) reverse(y, patrol, target);
  }
}

const PACE_LR_TABLE = L("DATA_BEF0FD");
const PACE_UD_TABLE = L("DATA_BEF154");

/** $BEF0EC — state 05: pace left and right around the spawn point. */
export function pace_left_and_right() {
  subStateJsr(PACE_LR_TABLE);
  apply_x_y_position_from_velocity();
  handle_sprite_left_right();
}

/** $BEF101 — pace init: remember home x and patrol speed. */
export function CODE_BEF101() {
  const x = reg.y;
  reg.x = x;
  w16(x + 0x42, r16(x + sprite.x_position));
  reg.a = r16(x + sprite.max_x_speed);
  w16(x + 0x48, reg.a);
  incSubState(x);
}

/** $BEF10D — horizontal pace check (sprite Y). */
export function CODE_BEF10D() {
  paceAxis(reg.y, 0x26, 0x46, 0x42, 0x06, 0x48, 1);
}

/** $BEF143 — state 06: pace up and down around the spawn point. */
export function pace_up_and_down() {
  subStateJsr(PACE_UD_TABLE);
  apply_x_y_position_from_velocity();
  handle_sprite_up_down();
}

/** $BEF158 — vertical pace init: remember home y and patrol speed. */
export function CODE_BEF158() {
  const x = reg.y;
  reg.x = x;
  w16(x + 0x44, r16(x + sprite.y_position));
  reg.a = r16(x + sprite.max_y_speed);
  w16(x + 0x4c, reg.a);
  incSubState(x);
}

/** $BEF164 — vertical pace check (sprite Y). */
export function CODE_BEF164() {
  paceAxis(reg.y, 0x2a, 0x4a, 0x44, 0x0a, 0x4c, 1);
}

/** `INC $53,x` in 16-bit mode (increments the word $53/$54). */
function incSubState(x: number) {
  const v = (r16(x + sprite.movement_sub_state) + 1) & 0xffff;
  w16(x + sprite.movement_sub_state, v);
  setNZ(v);
}

/** Init shared by the 2D patrols (patrol_x_y_around_home, CODE_BEF673): home + both speeds. */
function initPatrolXY() {
  const x = reg.y;
  reg.x = x;
  w16(x + 0x42, r16(x + sprite.x_position));
  w16(x + 0x44, r16(x + sprite.y_position));
  w16(x + 0x48, r16(x + sprite.max_x_speed));
  reg.a = r16(x + sprite.max_y_speed);
  w16(x + 0x4c, reg.a);
  incSubState(x);
}

/** $BEF19A — state 07: pace in both axes around home (rectangular patrol). */
export function patrol_x_y_around_home() {
  const sub = r8(reg.y + sprite.movement_sub_state);
  reg.x = sub << 1;
  if (sub === 0) initPatrolXY();
  else if (sub === 1) {
    CODE_BEF10D();
    CODE_BEF164();
  } else callPtr(0xbe, rom16(L("patrol_x_y_around_home_movement_state_table") + reg.x));
  apply_x_y_position_from_velocity();
  handle_sprite_left_right();
  handle_sprite_up_down();
}

/** $BEF1CC — state 08: pace up and down while also accelerating horizontally. */
export function pace_up_down_handle_x() {
  handle_sprite_left_right();
  apply_x_position_from_velocity();
  pace_up_and_down();
}

/** $BEF5A4 — state 12: pace left/right while also accelerating vertically. */
export function pace_left_right_handle_y() {
  handle_sprite_up_down();
  apply_y_position_from_velocity();
  pace_left_and_right();
}

/** $BEF603 — state 17: pace left/right with gravity. */
export function pace_left_right_handle_y_and_gravity() {
  handle_sprite_gravity();
  reg.y = reg.x;
  apply_y_position_from_velocity();
  pace_left_and_right();
}

const PATROL2_TABLE = L("DATA_BEF66F");

/** $BEF65B — state 1B: 2D patrol with the vertical range bytes counted in 4-pixel units. */
export function CODE_BEF65B() {
  subStateJsr(PATROL2_TABLE);
  apply_x_y_position_from_velocity();
  handle_sprite_left_right();
  handle_sprite_up_down();
}

/** $BEF673 — init of state 1B. */
export function CODE_BEF673() {
  initPatrolXY();
}

/** $BEF687 — state 1B patrol step: horizontal pace, then vertical pace with range*4. */
export function CODE_BEF687() {
  CODE_BEF10D();
  paceAxis(reg.y, 0x2a, 0x4a, 0x44, 0x0a, 0x4c, 4);
}

// ---------------------------------------------------------------------------------------------
// Small timers / proximity triggers
// ---------------------------------------------------------------------------------------------

/** $BEF4A5 — state 0C: count down $04 (Klobber wake-up); on expiry switch to state A/2. */
export function countdown_klobber_wakeup_timer() {
  const x = reg.y;
  reg.x = x;
  const t = (r16(x + 0x04) - 1) & 0xffff;
  w16(x + 0x04, t);
  if (isNeg(t)) {
    const c = reg.a & 1;
    reg.a = (reg.a & 0xffff) >> 1;
    reg.c = c !== 0;
    w16(x + sprite.movement_state, reg.a);
  }
}

/**
 * `CMP #$8000 : ROR A : ROR $5E` of a signed offset, the add to the position and the
 * "has it been reached or passed" test (CODE_BEF4AE/CODE_BEF4C8). Returns true when the
 * triggering position was NOT reached yet (the original's BPL to the RTS).
 */
function offsetNotReached(x: number, kong: number, offs: number, pos: number): boolean {
  const o = r16(x + offs);
  const c1 = (o & 0x8000) !== 0; // CMP #$8000: C = negative
  const half = ((o >> 1) | (c1 ? 0x8000 : 0)) & 0xffff;
  const dp = r16(0x5e);
  w16(0x5e, ((dp >> 1) | ((o & 1) << 15)) & 0xffff);
  const sum = half + r16(x + pos);
  // carry out of the ADC is irrelevant: CMP sets it again
  const a = sum & 0xffff;
  const k = r16(kong + pos);
  if (a === k) return false;
  const c = a >= k;
  const ror = ((a >> 1) | (c ? 0x8000 : 0)) & 0xffff;
  reg.a = ror ^ r16(0x5e);
  reg.c = (a & 1) !== 0;
  return !isNeg(reg.a);
}

/**
 * $BEF4AE — state 0D: wait until the Kong reaches the trigger offset ($04 = x offset,
 * $08 = y offset, 0 = ignore), then switch to movement state $53. X must hold the sprite
 * (the dispatcher passes the table index in X, so this is only meaningful when called with
 * X = sprite, like the original).
 */
export function CODE_BEF4AE() {
  const x = reg.x;
  const kong = r16(R.active_kong_sprite);
  reg.y = kong;
  if (r16(x + 0x04) && offsetNotReached(x, kong, 0x04, 0x06)) return;
  if (r16(x + 0x08) && offsetNotReached(x, kong, 0x08, 0x0a)) return;
  reg.a = r8(x + sprite.movement_sub_state);
  w16(x + sprite.movement_state, reg.a);
  reg.c = false;
}

/**
 * $BEF4E8 — state 0E: wait until the Kong is within a box around the sprite ($05 = half width,
 * $04 = half height); then switch to movement state $53 (with $04 = $53 and state $0C), or
 * stop moving when $53 is 0.
 */
export function CODE_BEF4E8() {
  const x = reg.y;
  reg.x = x;
  const kong = r16(R.active_kong_sprite);
  reg.y = kong;
  const within = (half: number, pos: number) => {
    w16(0x5e, half);
    const d = r16(x + pos) - r16(kong + pos);
    if (d >= 0) {
      reg.a = d;
      reg.c = d >= half;
      return !reg.c;
    }
    const s = (d & 0xffff) + half;
    reg.a = s & 0xffff;
    reg.c = s > 0xffff;
    return reg.c;
  };
  if (!within(r8(x + 0x05), 0x06)) return;
  if (!within(r8(x + 0x04), 0x0a)) return;
  let a = r8(x + sprite.movement_sub_state);
  if (a !== 0) {
    w16(x + 0x04, a);
    a = 0x000c;
  }
  reg.a = a;
  w16(x + sprite.movement_state, a);
}

// ---------------------------------------------------------------------------------------------
// One-shot moves
// ---------------------------------------------------------------------------------------------

const STATE10_TABLE = L("DATA_BEF53A");
const STATE11_TABLE = L("DATA_BEF56B");

/** $BEF536 — state 10 (life balloon): rise/fall with gravity until back at the start height. */
export function CODE_BEF536() {
  reg.x = reg.a & 0xffff;
  callPtr(0xbe, rom16(STATE10_TABLE + reg.x));
}

/** $BEF540 — state 10 init: remember the start height, clear sub-pixel. */
export function CODE_BEF540() {
  const x = reg.y;
  reg.x = x;
  incSubState(x);
  reg.a = r16(x + sprite.y_position);
  w16(x + sprite.ground_y_position, reg.a);
  w16(x + sprite.y_sub_position, 0);
  apply_y_position_from_velocity();
  handle_sprite_gravity();
}

/** $BEF54F — state 10: fall back; when below the start height, stop at it (state $0010). */
export function CODE_BEF54F() {
  apply_y_position_from_velocity();
  handle_sprite_gravity();
  const x = cur();
  reg.x = x;
  const home = r16(x + sprite.ground_y_position);
  reg.a = home;
  reg.c = home >= r16(x + sprite.y_position);
  if (reg.c) return;
  w16(x + sprite.y_position, home);
  reg.a = 0x0010;
  w16(x + sprite.movement_state, 0x0010);
  w16(x + sprite.y_speed, 0);
}

/** $BEF567 — state 11 (Kannon recoil): 0 = idle, 1 = start, 2 = move until back home. */
export function CODE_BEF567() {
  reg.x = reg.a & 0xffff;
  callPtr(0xbe, rom16(STATE11_TABLE + reg.x));
}

/** $BEF571 — state 11 start: remember the x position, clear sub-pixel, start moving. */
export function CODE_BEF571() {
  const x = reg.y;
  reg.x = x;
  incSubState(x);
  w16(x + sprite.ground_y_position, r16(x + sprite.x_position));
  w16(x + sprite.x_sub_position, 0);
  handle_sprite_left_right();
  apply_x_position_from_velocity();
}

/**
 * $BEF580 — state 11 move: when the sprite crossed back over its saved x position (in the
 * direction it faces, from the OAM x-flip bit), snap to it and go back to idle state $0011.
 */
export function CODE_BEF580() {
  handle_sprite_left_right();
  apply_x_position_from_velocity();
  const x = reg.y;
  reg.x = x;
  const saved = r16(x + 0x0c);
  const pos = r16(x + sprite.x_position);
  if (saved !== pos) {
    const c = saved >= pos;
    const dp = ((r16(0x5e) >> 1) | (c ? 0x8000 : 0)) & 0xffff;
    w16(0x5e, dp);
    const t = ((r16(x + sprite.oam_property) << 1) & 0xffff) ^ dp;
    reg.c = (t & 0x8000) !== 0;
    reg.a = saved;
    if (reg.c) return;
  } else reg.a = saved;
  w16(x + sprite.x_position, reg.a);
  reg.a = 0x0011;
  w16(x + sprite.movement_state, 0x0011);
  w16(x + sprite.x_speed, 0);
}

// ---------------------------------------------------------------------------------------------
// Timed moves using $1E as a countdown (for sprites that do not need terrain flags)
// ---------------------------------------------------------------------------------------------

/** End of a timed move: clear $1E and switch to movement state $53. */
function timedMoveDone(x: number) {
  w16(x + sprite.terrain_interaction, 0);
  reg.a = r8(x + sprite.movement_sub_state);
  w16(x + sprite.movement_state, reg.a);
}

/** $BEF5AD — state 13: fall and move for $1E frames. */
export function CODE_BEF5AD() {
  handle_sprite_gravity();
  reg.y = reg.x;
  CODE_BEF5B1();
}

/** $BEF5B1 — state 14: move for $1E frames, then switch to state $53. */
export function CODE_BEF5B1() {
  apply_x_y_position_from_velocity();
  const x = reg.y;
  reg.x = x;
  const t = (r16(x + sprite.terrain_interaction) - 1) & 0xffff;
  w16(x + sprite.terrain_interaction, t);
  if (isNeg(t)) timedMoveDone(x);
}

/** $BEF5C3 — state 15: fall for $1E frames, then hop (half x speed, y speed -$180). */
export function CODE_BEF5C3() {
  const x = reg.y;
  reg.x = x;
  const t = (r16(x + sprite.terrain_interaction) - 1) & 0xffff;
  w16(x + sprite.terrain_interaction, t);
  if (!isNeg(t)) {
    handle_sprite_gravity();
    reg.y = reg.x;
    apply_x_y_position_from_velocity();
    return;
  }
  // remember the take-off height in $1E for state 16
  w16(x + sprite.terrain_interaction, r16(x + sprite.y_position));
  const s = r16(x + sprite.x_speed);
  const q = quarter(s);
  w16(x + sprite.x_speed, q.v);
  reg.c = q.c;
  w16(x + sprite.y_speed, 0xfe80);
  reg.a = 0xfe80;
  const v = (r16(x + sprite.movement_state) + 1) & 0xffff;
  w16(x + sprite.movement_state, v);
  setNZ(v);
}

/** Two `CMP #$8000 : ROR A`: signed divide by 4 (returns the last shifted-out bit as C). */
function quarter(s: number) {
  const sign = s & 0x8000;
  const h = ((s >> 1) | sign) & 0xffff;
  const q = ((h >> 1) | sign) & 0xffff;
  return { v: q, c: (h & 1) !== 0 };
}

/** $BEF5E7 — state 16: fall until landing back at the take-off height ($1E), then state $53. */
export function CODE_BEF5E7() {
  handle_sprite_gravity();
  reg.y = reg.x;
  apply_x_y_position_from_velocity();
  const x = reg.y;
  reg.x = x;
  const takeoff = r16(x + sprite.terrain_interaction);
  reg.a = takeoff;
  reg.c = takeoff >= r16(x + sprite.y_position);
  if (reg.c) return;
  if (isNeg(r16(x + sprite.y_speed))) return;
  timedMoveDone(x);
}

// ---------------------------------------------------------------------------------------------
// Approach the Kong (states 18/19)
// ---------------------------------------------------------------------------------------------

/** $BEF60D — state 18: halve the approach offset ($04, mirrored by facing), then state 19. */
export function CODE_BEF60D() {
  const x = reg.y;
  reg.x = x;
  let a = r16(x + 0x04);
  if (r16(x + sprite.oam_property) & 0x4000) a = neg(a); // BIT $12,x : BVC (x-flipped)
  w16(x + 0x04, ((a >> 1) | (a & 0x8000)) & 0xffff);
  CODE_BEF632();
  const v = (r16(x + sprite.movement_state) + 1) & 0xffff;
  w16(x + sprite.movement_state, v);
  setNZ(v);
}

/** $BEF624 — state 19: when the Kong reached the offset, switch to state $53. */
export function CODE_BEF624() {
  const x = reg.y;
  reg.x = x;
  CODE_BEF632();
  if (reg.n) {
    reg.a = r8(x + sprite.movement_sub_state);
    w16(x + sprite.movement_state, reg.a);
  }
}

/**
 * $BEF632 — has the Kong reached position + offset? Uses $04 (x offset) or, when that is 0,
 * $08 (y offset); the offsets are stored doubled-and-restored with ROR so that their sign
 * survives. Returns N set when reached (A = comparison result).
 */
export function CODE_BEF632() {
  const x = reg.x;
  const kong = r16(R.active_kong_sprite);
  reg.y = kong;
  // ASL $04,x: a zero x offset means "use the y offset" (CODE_BEF649)
  let offs = 0x04;
  let pos: number = sprite.x_position;
  let o = r16(x + 0x04);
  w16(x + 0x04, (o << 1) & 0xffff);
  if (((o << 1) & 0xffff) === 0) {
    offs = 0x08;
    pos = sprite.y_position;
    o = r16(x + 0x08);
    w16(x + 0x08, (o << 1) & 0xffff);
  }
  const shifted = (o << 1) & 0xffff;
  const sign = (o & 0x8000) !== 0; // saved with PHP
  const a = (shifted + r16(x + pos)) & 0xffff;
  const reached = a >= r16(kong + pos);
  // ROR $offs,x restores the offset, but with the compare result in bit 15
  w16(x + offs, ((shifted >> 1) | (reached ? 0x8000 : 0)) & 0xffff);
  // PLP : ROR A : EOR $04,x (also $04 for the y case, which is 0 there)
  const ra = ((a >> 1) | (sign ? 0x8000 : 0)) & 0xffff;
  reg.c = (a & 1) !== 0;
  reg.a = ra ^ r16(x + 0x04);
  setNZ(reg.a);
}

// ---------------------------------------------------------------------------------------------
// Ground walkers: terrain, level edges, water
// ---------------------------------------------------------------------------------------------

/** $BEF780 — keep the sprite inside the level; turn it around at the edges. */
export function handle_sprite_on_level_x_boundary() {
  const x = cur();
  reg.x = x;
  const pos = r16(x + sprite.x_position);
  let edge = 0x0108;
  if (edge < pos) {
    // left edge is fine; C = 0 here, so the ADC adds exactly $F8
    edge = (r16(0x0afc) + 0x00f8) & 0xffff;
    if (edge >= pos) {
      reg.a = edge;
      reg.c = true;
      reg.z = edge === pos;
      return;
    }
  }
  reg.a = edge;
  reg.c = edge >= pos;
  if (edge === pos) {
    reg.z = true;
    return;
  }
  w16(x + sprite.x_position, edge);
  const t = (r16(x + sprite.max_x_speed) ^ r16(x + sprite.x_speed)) & 0xffff;
  reg.a = (t << 1) & 0xffff;
  reg.c = (t & 0x8000) !== 0;
  w16(x + sprite.x_speed, 0);
  if (reg.c) return; // speed and target differ in sign: already heading back in
  w16(x + sprite.max_x_speed, 0);
  reg.a = r16(x + sprite.terrain_interaction) | 0x0002; // tell the sprite it hit a wall
  w16(x + sprite.terrain_interaction, reg.a);
}

/**
 * `LDA v : ASL A : ROR m : ASL A : ROR m` — the original's way of slowing a speed down under
 * water: bits 15 and 14 of the old value become the new top two bits, the rest shifts right
 * by 2 (a signed divide by 4 for speeds below $4000).
 */
function slowDown(v: number) {
  const b15 = v & 0x8000;
  const b14 = (v & 0x4000) << 1;
  const m = ((v >> 1) | b15) & 0xffff;
  return ((m >> 1) | b14) & 0xffff;
}

/**
 * $BEF7BC — terrain interaction. Under water (below water_y_position + 16) the speeds are
 * slowed down for the terrain move and multiplied by 4 again afterwards (low bits are lost).
 */
export function process_terrain_handle_submerged() {
  const water = r16(R.water_y_position);
  if (!isNeg(water)) {
    const x = cur();
    reg.x = x;
    const surface = (water + 0x0010) & 0xffff;
    if (surface < r16(x + sprite.y_position)) {
      w16(x + sprite.x_speed, slowDown(r16(x + sprite.x_speed)));
      const yv = r16(x + sprite.y_speed);
      w16(x + sprite.y_speed, slowDown(yv));
      reg.a = (yv << 2) & 0xffff;
      process_terrain_interaction_global();
      const x2 = cur();
      reg.x = x2;
      w16(x2 + sprite.x_speed, (r16(x2 + sprite.x_speed) << 2) & 0xffff);
      const v = r16(x2 + sprite.y_speed);
      w16(x2 + sprite.y_speed, (v << 2) & 0xffff);
      reg.c = (v & 0x4000) !== 0; // carry of the last ASL
      return;
    }
  }
  process_terrain_interaction_global();
}

// ---------------------------------------------------------------------------------------------

register({
  process_current_movement,
  process_alternate_movement,
  movement_return_state,
  apply_x_y_position_from_velocity,
  apply_x_position_from_velocity,
  apply_y_position_from_velocity,
  handle_sprite_up_down,
  handle_sprite_left_right,
  handle_sprite_gravity,
  handle_x_y_gravity_interpolate_x,
  handle_x_y_movement,
  pace_left_and_right,
  CODE_BEF101,
  CODE_BEF10D,
  pace_up_and_down,
  CODE_BEF158,
  CODE_BEF164,
  patrol_x_y_around_home,
  pace_up_down_handle_x,
  pace_left_right_handle_y,
  pace_left_right_handle_y_and_gravity,
  CODE_BEF65B,
  CODE_BEF673,
  CODE_BEF687,
  countdown_klobber_wakeup_timer,
  CODE_BEF4AE,
  CODE_BEF4E8,
  CODE_BEF536,
  CODE_BEF540,
  CODE_BEF54F,
  CODE_BEF567,
  CODE_BEF571,
  CODE_BEF580,
  CODE_BEF5AD,
  CODE_BEF5B1,
  CODE_BEF5C3,
  CODE_BEF5E7,
  CODE_BEF60D,
  CODE_BEF624,
  CODE_BEF632,
  handle_sprite_on_level_x_boundary,
  process_terrain_handle_submerged,
});
// everything except the two JSL entry points returns with RTS (several stubs guess RTL)
for (const n of [
  "movement_return_state",
  "apply_x_y_position_from_velocity",
  "apply_x_position_from_velocity",
  "apply_y_position_from_velocity",
  "handle_sprite_up_down",
  "handle_sprite_left_right",
  "handle_sprite_gravity",
  "handle_x_y_gravity_interpolate_x",
  "handle_x_y_movement",
  "pace_left_and_right",
  "CODE_BEF101",
  "CODE_BEF10D",
  "pace_up_and_down",
  "CODE_BEF158",
  "CODE_BEF164",
  "patrol_x_y_around_home",
  "pace_up_down_handle_x",
  "pace_left_right_handle_y",
  "pace_left_right_handle_y_and_gravity",
  "CODE_BEF65B",
  "CODE_BEF673",
  "CODE_BEF687",
  "countdown_klobber_wakeup_timer",
  "CODE_BEF4AE",
  "CODE_BEF4E8",
  "CODE_BEF536",
  "CODE_BEF540",
  "CODE_BEF54F",
  "CODE_BEF567",
  "CODE_BEF571",
  "CODE_BEF580",
  "CODE_BEF5AD",
  "CODE_BEF5B1",
  "CODE_BEF5C3",
  "CODE_BEF5E7",
  "CODE_BEF60D",
  "CODE_BEF624",
  "CODE_BEF632",
  "handle_sprite_on_level_x_boundary",
  "process_terrain_handle_submerged",
])
  setRetMode(L(n), RET_RTS);
setRetMode(L("process_current_movement"), RET_RTL);
setRetMode(L("process_alternate_movement"), RET_RTL);
