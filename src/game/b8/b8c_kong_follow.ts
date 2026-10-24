/**
 * Bank $B8 (package B8c) — the follower Kong: a 32-entry ring buffer of waypoints
 * (x, y, animation, facing) recorded from the lead Kong and played back by the follower, the
 * mapping from the lead's animation to the follower's, and the "catch up" check that makes the
 * follower jump back next to the lead.
 *
 * Buffers ($7F bank): kong_follow_{x_position,y_position,animation,facing}_buffer, indexed by
 * kong_follow_buffer_{recording,playback}_index (byte offsets, wrapping at $40).
 * $092F/$0931 = animation/facing read from the buffer this frame; $0933 = follower flags
 * (bit0-1 one-shot requests, bit2 turn around, bit3 stopped).
 */
import { r8, w8, r16, w16, rom16, io8, io16, ioR16 } from "../../core/mem";
import { reg, register, callPtr } from "../../core/cpu";
import { L, R, C, CPU, sprite } from "../../core/sym";
import { set_anim_once_handle_dixie, CODE_B8D480, CODE_B8D497 } from "../../gen/routines";
import { neg, isNeg, cmpNeg } from "./b8c_util";

const FOLLOWER_ANIMATION_HANDLERS = L("DATA_B8DB36");
const FOLLOW_FLAGS = 0x0933;
const BUF_ANIM = 0x092f;
const BUF_FACING = 0x0931;

// ---------------------------------------------------------------------------------------------
// Waypoint recording
// ---------------------------------------------------------------------------------------------

/** $B8D8D1 — JSL entry of CODE_B8D8D5. */
export function CODE_B8D8D1() {
  CODE_B8D8D5();
}

/** $B8D8D5 — reset the trail with no y offset ($4A = 0); A/X/Y as for CODE_B8D8D7. */
export function CODE_B8D8D5() {
  w16(0x4a, 0);
  CODE_B8D8D7();
}

/**
 * $B8D8D7 — refill the follow buffer with A waypoints interpolated in a straight line from
 * the follower to the lead Kong (+$4A in y), all with animation X and facing Y.
 * Used when the Kongs are re-joined (team up / swap / level start).
 */
export function CODE_B8D8D7() {
  w16(0x3a, reg.a);
  w16(0x3c, reg.x);
  w16(0x3e, reg.y);
  let x = r16(R.inactive_kong_sprite);
  // 16.16 start position (follower) in $32/$34 (x) and $36/$38 (y)
  w16(0x32, 0);
  w16(0x34, r16(x + sprite.x_position));
  w16(0x36, 0);
  w16(0x38, r16(x + sprite.y_position));
  w16(0x40, 0);
  w16(0x42, 0);
  w16(0x44, 0);
  w16(0x46, 0);
  x = r16(R.active_kong_sprite);
  // per-step deltas as 8.8 values stored at $41 (x) and $45 (y), sign-extended into $43/$47
  let step = divideDistance((r16(x + sprite.x_position) - r16(0x34)) & 0xffff);
  w16(0x41, step);
  if (isNeg(step)) w8(0x43, r8(0x43) - 1);
  step = divideDistance((r16(x + sprite.y_position) + r16(0x4a) - r16(0x38)) & 0xffff);
  w16(0x45, step);
  if (isNeg(step)) w8(0x47, r8(0x47) - 1);

  let i = 0;
  do {
    w16(R.kong_follow_x_position_buffer + i, r16(0x34));
    w16(R.kong_follow_y_position_buffer + i, r16(0x38));
    w16(R.kong_follow_animation_buffer + i, r16(0x3c));
    w16(R.kong_follow_facing_buffer + i, r16(0x3e));
    let s = r16(0x32) + r16(0x40);
    w16(0x32, s & 0xffff);
    w16(0x34, (r16(0x34) + r16(0x42) + (s > 0xffff ? 1 : 0)) & 0xffff);
    s = r16(0x36) + r16(0x44);
    w16(0x36, s & 0xffff);
    w16(0x38, (r16(0x38) + r16(0x46) + (s > 0xffff ? 1 : 0)) & 0xffff);
    i = (i + 2) & 0x003f;
    w16(0x3a, r16(0x3a) - 1);
  } while (r16(0x3a));
  w16(R.kong_follow_buffer_recording_index, i);
  w16(R.kong_follow_buffer_playback_index, 0);
  reg.a = i;
  reg.x = i;
}

/** .divide_distance: signed distance (clamped to 255 px) / $3A, as 8.8, via the hardware divider. */
function divideDistance(d: number): number {
  if (!isNeg(d)) return divide(d);
  return neg(divide(neg(d)));
}
function divide(d: number): number {
  if (!cmpNeg(d, 0x0100)) d = 0x00ff;
  io16(CPU.dividen, (d & 0x00ff) << 8);
  io8(CPU.divisor, r8(0x3a));
  return ioR16(CPU.divide_result);
}

// ---------------------------------------------------------------------------------------------
// Waypoint playback
// ---------------------------------------------------------------------------------------------

/** $B8D99E — move the follower (current sprite) to the next recorded waypoint. */
export function CODE_B8D99E() {
  const idx = r16(R.kong_follow_buffer_playback_index) & 0x003f;
  const y = r16(R.current_sprite);
  w16(y + sprite.x_position, r16(R.kong_follow_x_position_buffer + idx));
  w16(y + sprite.y_position, r16(R.kong_follow_y_position_buffer + idx));
  w16(BUF_ANIM, r16(R.kong_follow_animation_buffer + idx));
  w16(BUF_FACING, r16(R.kong_follow_facing_buffer + idx));
  // how far behind the newest waypoint the follower is
  const newest = (r16(R.kong_follow_buffer_recording_index) - 2) & 0x003f;
  const behind = (r16(R.kong_follow_x_position_buffer + newest) - r16(y + sprite.x_position)) & 0xffff;
  w16(0x5e, behind);
  if (behind) CODE_B8DA65();

  // CODE_B8D9DD
  const requests = r16(FOLLOW_FLAGS) & 0x0003;
  if (requests) {
    // CODE_B8DA23: one-shot requests: consume them; bit1 = skip ahead
    w16(FOLLOW_FLAGS, requests ^ r16(FOLLOW_FLAGS));
    if (requests & 0x0002) advancePlayback();
    advancePlayback();
    return;
  }
  reg.x = r16(R.current_sprite);
  CODE_B8D480();
  if (reg.c) return advancePlayback();
  const x = r16(R.current_sprite);
  const dist = (reg.a - r16(x + sprite.y_position)) & 0xffff;
  w16(x + sprite.ground_distance, dist);
  if (dist) return advancePlayback();
  if ((r16(0xac) & 0x0007) === 0x0006) return advancePlayback();
  let d = r16(0x5e);
  if (isNeg(d)) d = neg(d);
  if (!cmpNeg(d, 0x001c)) {
    // CODE_B8DA32: far behind on the ground: keep advancing
    advancePlayback();
    return;
  }
  // close to the lead: stop and wait while the lead stands still
  const lead = r16(R.active_kong_sprite);
  if (r16(lead + sprite.max_x_speed) || r16(lead + sprite.x_speed)) return;
  w16(FOLLOW_FLAGS, r16(FOLLOW_FLAGS) | 0x0008);
}

/** Advance the playback index by one waypoint unless it would catch up with the recording. */
function advancePlayback() {
  const next = (r16(R.kong_follow_buffer_playback_index) + 2) & 0x003f;
  reg.a = next;
  if (next === r16(R.kong_follow_buffer_recording_index)) return;
  w16(R.kong_follow_buffer_playback_index, next);
}

/** $B8DA65 — flag a turn-around when the follower faces away from the lead Kong. */
export function CODE_B8DA65() {
  const x = r16(R.inactive_kong_sprite);
  const y = r16(R.active_kong_sprite);
  reg.x = x;
  reg.y = y;
  const away = ((((r16(y + sprite.x_position) - r16(x + sprite.x_position)) & 0xffff) >> 1) ^ r16(x + sprite.oam_property)) & 0x4000;
  reg.a = away;
  if (!away) return;
  w16(FOLLOW_FLAGS, r16(FOLLOW_FLAGS) | 0x0004);
}

// ---------------------------------------------------------------------------------------------
// Follower animation
// ---------------------------------------------------------------------------------------------

/** $B8DA84 — pick the follower's animation from the lead's recorded animation. */
export function CODE_B8DA84() {
  reg.a = r16(BUF_ANIM);
  CODE_B8DB58();
  const idx = (reg.a << 1) & 0xffff;
  reg.x = idx;
  callPtr(0xb8, rom16(FOLLOWER_ANIMATION_HANDLERS + idx));
}

/** $B8DA8F */
export function CODE_B8DA8F() {
  set_anim_once_handle_dixie();
}
function animOnce(id: number) {
  reg.a = id;
  set_anim_once_handle_dixie();
}

/** $B8DA94 — play a pending turn-around ($41) or stop ($01) animation; carry set if one played. */
export function CODE_B8DA94() {
  if (r16(FOLLOW_FLAGS) & 0x0004) {
    w16(FOLLOW_FLAGS, r16(FOLLOW_FLAGS) ^ 0x0004);
    animOnce(0x0041);
    reg.c = true;
    return;
  }
  if (r16(FOLLOW_FLAGS) & 0x0008) {
    w16(FOLLOW_FLAGS, r16(FOLLOW_FLAGS) ^ 0x0008);
    animOnce(0x0001);
    reg.c = true;
    return;
  }
  reg.c = false;
}

/** $B8DAC2 — idle-like animations: pending turn/stop, otherwise $3B. */
export function CODE_B8DAC2() {
  CODE_B8DA94();
  if (reg.c) return;
  animOnce(0x003b);
}

/** $B8DACE — walking: pending turn/stop, otherwise $3D. */
export function CODE_B8DACE() {
  CODE_B8DA94();
  if (reg.c) return;
  animOnce(0x003d);
}

/** $B8DAD9 — jumping/falling ($3E) when off the ground, else like CODE_B8DAC2. */
export function CODE_B8DAD9() {
  if (!r16(r16(R.current_sprite) + sprite.ground_distance)) {
    CODE_B8DAC2();
    return;
  }
  CODE_B8DB27();
  animOnce(0x003e);
}

/** $B8DAE8 */
export function CODE_B8DAE8() {
  animOnce(0x003f);
}

/** $B8DAEE */
export function CODE_B8DAEE() {
  animOnce(0x0001);
}

/** $B8DAF4 */
export function CODE_B8DAF4() {
  animOnce(0x0040);
}

/** $B8DAFA — same animation as the lead, with the lead's facing. */
export function CODE_B8DAFA() {
  CODE_B8DB27();
  animOnce(r16(BUF_ANIM));
}

/** $B8DB03 */
export function CODE_B8DB03() {
  CODE_B8DB27();
  animOnce(0x0043);
}

/** $B8DB0C */
export function CODE_B8DB0C() {
  CODE_B8DB27();
  animOnce(0x0051);
}

/** $B8DB15 */
export function CODE_B8DB15() {
  CODE_B8DB27();
  animOnce(r16(BUF_ANIM));
}

/** $B8DB1E */
export function CODE_B8DB1E() {
  CODE_B8DB27();
  animOnce(r16(BUF_ANIM));
}

/** $B8DB27 — take the recorded facing (bit 14 of $0931). */
export function CODE_B8DB27() {
  const x = r16(R.current_sprite);
  reg.x = x;
  const f = r16(x + sprite.oam_property);
  reg.a = ((r16(BUF_FACING) ^ f) & 0x4000) ^ f;
  w16(x + sprite.oam_property, reg.a);
}

/**
 * Lead animation id -> follower animation class (index into DATA_B8DB36), from the
 * CMP/BNE chain at $B8DB58-$B8DDAC. Unlisted ids map to 0.
 */
const ANIMATION_CLASS = new Map<number, number>();
for (const [cls, ids] of [
  [1, [0x04, 0xa1]],
  [2, [0x05, 0x06, 0x15, 0x16, 0x21, 0x22]],
  [3, [0x07, 0x0b, 0x17, 0x1a, 0x1b, 0x23]],
  [4, [0x19, 0x1c, 0x25, 0x27]],
  [5, [0x2f, 0x30, 0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a]],
  [6, [0x43, 0x62, 0x6c, 0x8f, 0x85, 0x128]],
  [7, [0x60, 0x83, 0x88, 0x8d, 0x65]],
  [8, [0x42]],
  [9, [0xa2]],
  [10, [0x2b]],
  [11, [0x45]],
] as [number, number[]][]) {
  for (const id of ids) ANIMATION_CLASS.set(id, cls);
}

/** $B8DB58 — A = animation class of animation A. */
export function CODE_B8DB58() {
  reg.a = ANIMATION_CLASS.get(reg.a & 0xffff) ?? 0;
  reg.z = reg.a === 0;
  reg.n = false;
}

// ---------------------------------------------------------------------------------------------
// Catch up
// ---------------------------------------------------------------------------------------------

/**
 * $B8DDB1 — when the follower stands on the ground at about the lead's height but not next to
 * it, while the lead stands still, look for floor $1C pixels in front of / behind the lead and
 * make the follower hop there (state $2A, target x in $0D66).
 */
export function CODE_B8DDB1() {
  let x = r16(R.current_sprite);
  reg.x = x;
  if (!isNeg(r16(x + sprite.ground_distance) - 1)) return;
  let y = r16(R.active_kong_sprite);
  reg.y = y;
  let dy = (r16(y + sprite.y_position) - r16(x + sprite.y_position)) & 0xffff;
  if (isNeg(dy)) dy = neg(dy);
  if (!cmpNeg(dy, 0x0008)) return;
  const dx = (r16(y + sprite.x_position) - r16(x + sprite.x_position)) & 0xffff;
  w16(0x5e, dx);
  const adx = isNeg(dx) ? neg(dx) : dx;
  w16(0x60, adx);
  let off = (adx - 0x001c) & 0xffff;
  if (isNeg(off)) off = neg(off);
  if (cmpNeg(off, 0x0002)) return; // already about $1C px away
  if (r16(y + sprite.max_x_speed) || r16(y + sprite.x_speed) || r16(y + sprite.ground_distance)) return;

  // try the side the lead is facing first, then the other one
  const side = r16(y + sprite.oam_property) & 0x4000 ? 0x001c : neg(0x001c);
  w16(0x5e, side);
  w16(0x60, (side + r16(y + sprite.x_position)) & 0xffff);
  if (!floorNear(r16(0x60))) {
    // CODE_B8DE32
    w16(0x60, (r16(y + sprite.x_position) - r16(0x5e)) & 0xffff);
    if (!floorNear(r16(0x60))) return;
  }
  // CODE_B8DE56
  x = reg.x;
  w16(0x0d66, r16(0x60));
  reg.y = r16(R.current_kong_control_variables);
  w16(x + sprite.max_x_speed, 0);
  w16(x + sprite.x_speed, 0);
  w16(x + sprite.y_speed, 0);
  w16(x + sprite.state, C.kong_state_2A);
  w16(0x0d6e, r16(R.kong_follow_buffer_recording_index));
  animOnce(0x003b);

  /** Floor within $1C px of the follower's height at column `px`? (PHY/PLY keep Y.) */
  function floorNear(px: number): boolean {
    reg.a = px;
    CODE_B8D497();
    reg.y = y;
    if (reg.c) return false;
    let d = (reg.a - r16(reg.x + sprite.y_position)) & 0xffff;
    if (isNeg(d)) d = neg(d);
    return cmpNeg(d, 0x001c);
  }
}

register({
  CODE_B8D8D1,
  CODE_B8D8D5,
  CODE_B8D8D7,
  CODE_B8D99E,
  CODE_B8DA65,
  CODE_B8DA84,
  CODE_B8DA8F,
  CODE_B8DA94,
  CODE_B8DAC2,
  CODE_B8DACE,
  CODE_B8DAD9,
  CODE_B8DAE8,
  CODE_B8DAEE,
  CODE_B8DAF4,
  CODE_B8DAFA,
  CODE_B8DB03,
  CODE_B8DB0C,
  CODE_B8DB15,
  CODE_B8DB1E,
  CODE_B8DB27,
  CODE_B8DB58,
  CODE_B8DDB1,
});
