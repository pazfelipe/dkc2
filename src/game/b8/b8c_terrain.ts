/**
 * Bank $B8 (package B8c) — sprite/terrain collision.
 *
 * `process_terrain_interaction` moves a sprite by its velocity and resolves it against the
 * level's terrain (floors, slopes, walls, ceilings), every frame, for Kongs, animal buddies and
 * many enemies. Terrain is queried through the bank $B5 `get_sprite_terrain_info*` routines,
 * which return the floor height below a point (as "$6300 - y", or negative when there is no
 * ground) in A and the tile attributes in $AC (point itself) / $AE (point's column).
 *
 * Direct page used: $5E/$60 scratch, $74 floor y, $B0/$B2 saved x/x_sub (then y), $E5 pass
 * counter, $FD y before a platform-sprite snap, $AC/$AE terrain attributes.
 *
 * Sprite fields: `terrain_interaction` ($1E) low byte = contacts this frame (bit0 floor,
 * bit1 wall, bit2 ceiling, bit7 wall on the "other" side), high byte = last frame's contacts;
 * `ground_y_position` ($0C), `ground_distance` ($0E, $8050 = no ground), `terrain_attributes`
 * ($10: bits 0-2 slope steepness, bit 15 slope direction).
 */
import { r16, w16, rom16 } from "../../core/mem";
import { reg, register } from "../../core/cpu";
import { L, R, C, sprite, level } from "../../core/sym";
import { get_sprite_terrain_info_y_origin_0 } from "../../gen/routines";
import { neg, isNeg, cmpNeg, addVelocity24, jslLabel } from "./b8c_util";

// bank $B5 entry points declared with `#label:` inside get_sprite_terrain_info_y_origin_0
// (no generated stubs): A/X in, floor value in A, attributes in $AC/$AE, DB left = $B5
const GET_TERRAIN_INFO = L("get_sprite_terrain_info");
const GET_TERRAIN_INFO_DEFINE_X = L("get_sprite_terrain_info_define_x");
const GET_TERRAIN_INFO_DEFINE_Y = L("get_sprite_terrain_info_define_y");
const get_sprite_terrain_info = () => jslLabel(GET_TERRAIN_INFO);
const get_sprite_terrain_info_define_x = () => jslLabel(GET_TERRAIN_INFO_DEFINE_X);
const get_sprite_terrain_info_define_y = () => jslLabel(GET_TERRAIN_INFO_DEFINE_Y);

const LANDING_Y_SPEED = L("DATA_B8D7EE");
const AC = 0xac;
const AE = 0xae;
const NO_GROUND = 0x8050;

const orTI = (x: number, m: number) => w16(x + sprite.terrain_interaction, r16(x + sprite.terrain_interaction) | m);
const incE5 = () => w16(0xe5, r16(0xe5) + 1);

// ---------------------------------------------------------------------------------------------
// Terrain height helpers
// ---------------------------------------------------------------------------------------------

/**
 * $B8D484 — convert a terrain query result in A to a floor y position:
 * A >= 0: A = $6300 - A... exactly `~A + $6301`, carry clear; A < 0 (no floor): A = $7F00, carry set.
 */
export function CODE_B8D484() {
  const a = reg.a & 0xffff;
  if (isNeg(a)) {
    reg.a = 0x7f00;
    reg.c = true;
  } else {
    reg.a = ((a ^ 0xffff) + 0x6301) & 0xffff;
    reg.c = false;
  }
  reg.n = isNeg(reg.a);
  reg.z = reg.a === 0;
}

/** $B8D480 — floor y below sprite X (A, carry set = none). */
export function CODE_B8D480() {
  get_sprite_terrain_info();
  CODE_B8D484();
}

/** $B8D47C — JSL entry of CODE_B8D480. */
export function CODE_B8D47C() {
  CODE_B8D480();
}

/** $B8D497 — like CODE_B8D480 but with the query x in A (y origin 0 variant). */
export function CODE_B8D497() {
  get_sprite_terrain_info_y_origin_0();
  CODE_B8D484();
}

/** Floor y at the given point (`$34` = y). Returns A/C like CODE_B8D484, X = reg.x after. */
function floorAtY(y: number): number {
  reg.a = y & 0xffff;
  get_sprite_terrain_info_define_y();
  CODE_B8D484();
  return reg.a;
}

/** $B8D5AF — A = x, Y = y: carry set and A = floor y if there is a floor at that point. */
export function CODE_B8D5AF() {
  w16(0x34, reg.y);
  get_sprite_terrain_info_define_x();
  const a = (reg.a ^ 0xffff) & 0xffff;
  if (!isNeg(a)) {
    reg.a = a;
    reg.c = false;
    return;
  }
  reg.a = (a + 0x6301) & 0xffff;
  reg.c = true;
}

// ---------------------------------------------------------------------------------------------
// Rope / ledge probes used by Kong states
// ---------------------------------------------------------------------------------------------

/**
 * $B8D3E2 — probe the terrain $28 and $08 pixels above the sprite. Returns A (0/1) and carry.
 * Used to decide whether a climbing Kong can pull up / has a wall in front.
 */
export function CODE_B8D3E2() {
  let x = r16(R.current_sprite);
  reg.x = x;
  w16(0x5e, floorAtY(r16(x + sprite.y_position) - 0x28));
  x = reg.x;
  const ae = r16(AE);
  w16(x + sprite.terrain_attributes, ae);
  const ret = (a: number, c: boolean) => {
    reg.a = a;
    reg.c = c;
    reg.z = a === 0;
    reg.n = false;
  };
  if (!(ae & 0x1800)) {
    // CODE_B8D455
    x = r16(R.current_sprite);
    reg.x = x;
    w16(0x5e, floorAtY(r16(x + sprite.y_position) - 0x08));
    x = reg.x;
    if (!(r16(AE) & 0x1000)) return ret(0, false);
    if (!cmpNeg((r16(0x5e) + 0x27) & 0xffff, r16(x + sprite.y_position))) return ret(0, false);
    return ret(0, true);
  }
  if (!(ae & 0x1000)) {
    // CODE_B8D432
    let d = (r16(x + sprite.y_position) - 0x28 - r16(0x5e)) & 0xffff;
    if (isNeg(d)) d = neg(d);
    if (!cmpNeg(d, 0x0005)) return ret(0, false);
    return ret(1, true);
  }
  if (!cmpNeg((r16(0x5e) + 0x27) & 0xffff, r16(x + sprite.y_position))) return ret(0, false);
  x = r16(R.current_sprite);
  reg.x = x;
  w16(0x5e, floorAtY(r16(x + sprite.y_position) - 0x08));
  x = reg.x;
  if (!(r16(AE) & 0x1000)) return ret(1, false);
  if (!cmpNeg((r16(0x5e) + 0x27) & 0xffff, r16(x + sprite.y_position))) return ret(1, false);
  return ret(0, true);
}

/** $B8D362 — carry set only when CODE_B8D3E2 returned carry with A = 0. */
export function CODE_B8D362() {
  CODE_B8D3E2();
  reg.c = reg.c && reg.z;
}

/** $B8D36D — carry set only when CODE_B8D3E2 returned carry with A = 1. */
export function CODE_B8D36D() {
  CODE_B8D3E2();
  reg.c = reg.c && !reg.z;
}

/**
 * $B8D378 — probe above the sprite ($08 up) and $20 pixels ahead: A bit0 = blocked above,
 * bit1 = blocked ahead. Also refreshes terrain_attributes.
 */
export function CODE_B8D378() {
  w16(0x60, 0);
  let x = r16(R.current_sprite);
  reg.x = x;
  let floor = floorAtY(r16(x + sprite.y_position) - 0x08);
  x = reg.x;
  if (cmpNeg((floor + 0x27) & 0xffff, r16(x + sprite.y_position)) && r16(AE) & 0x1000) {
    w16(0x60, r16(0x60) | 0x0001);
  }
  w16(0x34, r16(x + sprite.y_position) - 0x08);
  let probeX = r16(x + sprite.x_position);
  if (r16(x + sprite.oam_property) & 0x4000) probeX += 0x20;
  else probeX -= 0x20;
  reg.a = probeX & 0xffff;
  get_sprite_terrain_info_define_x();
  CODE_B8D484();
  floor = reg.a;
  x = reg.x;
  if (cmpNeg((floor + 0x27) & 0xffff, r16(x + sprite.y_position)) && r16(AE) & 0x1000) {
    w16(0x60, r16(0x60) | 0x0002);
  }
  storeTerrainAttributes(x);
  reg.a = r16(0x60);
}

/** $10,x = $AC with bits 9-12 taken from $AE (`EOR/AND/EOR` merge). */
function storeTerrainAttributes(x: number) {
  const v = ((r16(AE) ^ r16(AC)) & 0x1e00) ^ r16(AC);
  w16(x + sprite.terrain_attributes, v);
  reg.a = v;
}

// ---------------------------------------------------------------------------------------------
// Follower placement
// ---------------------------------------------------------------------------------------------

/**
 * $B8D4AE — place sprite X on the terrain near the active Kong (e.g. a dropped object or a
 * Kong being re-attached): scan horizontally from the Kong towards the target x for solid floor.
 */
export function CODE_B8D4AE() {
  let x = reg.x;
  w16(0xe9, x);
  let y = r16(R.active_kong_sprite);
  // target x clamped to [$100, $100 + level width]
  let a = 0x0100;
  if (!(a >= r16(x + sprite.x_position))) {
    a = (a + r16(0x0afc)) & 0xffff;
    if (!(a < r16(x + sprite.x_position))) a = r16(x + sprite.x_position);
  }
  w16(0x19c6, a);
  // target y clamped to the Kong's height and to $0D54 + $C0
  a = r16(0x0d54);
  if (isNeg(a)) a = r16(x + sprite.y_position);
  else {
    a = (a + 0x00c0) & 0xffff;
    if (!(a < r16(x + sprite.y_position))) a = r16(x + sprite.y_position);
  }
  if (a >= r16(y + sprite.y_position)) a = r16(y + sprite.y_position);
  w16(0x19c8, a);

  reg.a = r16(0x19c6);
  reg.y = r16(0x19c8);
  CODE_B8D5AF();
  x = reg.x;
  y = reg.y;
  if (reg.c) {
    y = r16(R.active_kong_sprite);
    a = (reg.a - r16(y + sprite.y_position)) & 0xffff;
    if (isNeg(a) && a < 0xffe8) {
      // floor at the target is just above the Kong: snap onto the Kong
      x = r16(0xe9);
      w16(x + sprite.y_position, r16(y + sprite.y_position));
      w16(x + sprite.x_position, r16(y + sprite.x_position));
      reg.a = r16(y + sprite.x_position);
      reg.x = x;
      reg.y = y;
      return;
    }
  }

  // CODE_B8D508: walk from the Kong towards the target in steps of 8
  y = r16(R.active_kong_sprite);
  a = r16(y + sprite.x_position);
  w16(0xd9, a);
  w16(0xdd, a >= r16(0x19c6) ? 0xfff8 : 0x0008);
  w16(0xdb, 0);
  for (;;) {
    a = r16(0xdd);
    if (!a) {
      // CODE_B8D550
      if (!r16(0xdb)) {
        reg.a = r16(0xdb);
        reg.x = x;
        reg.y = y;
        return;
      }
      break;
    }
    a = stepTowardsTarget();
    reg.a = a;
    reg.y = r16(0x19c8);
    CODE_B8D5AF();
    x = reg.x;
    y = reg.y;
    if (!reg.c) continue;
    a = (reg.a - r16(0x19c8)) & 0xffff;
    y = a;
    if (!isNeg(a)) continue;
    w16(0xdb, r16(0xdb) + 1);
    if (y >= 0xfff8) continue;
    break;
  }

  // CODE_B8D555: found a ledge; walk back from it towards the Kong in steps of 2
  y = r16(R.active_kong_sprite);
  a = r16(y + sprite.x_position);
  w16(0x19c6, a);
  let c = a >= r16(0xd9);
  w16(0xdd, c ? 0x0002 : 0xfffe);
  for (;;) {
    a = r16(0xdd);
    if (!a) break;
    a = stepTowardsTarget();
    reg.a = a;
    reg.y = r16(0x19c8);
    CODE_B8D5AF();
    x = reg.x;
    y = reg.y;
    a = reg.a;
    c = reg.c;
    if (!c) break;
    a = (a - r16(0x19c8)) & 0xffff;
    y = a;
    c = y >= 0xfff8;
    if (!c) continue;
    x = r16(0xe9);
    a = y;
    c = a >= 0x0008;
    if (!c) break;
    c = a >= 0xfff8;
    if (c) break;
    a = 0;
    break;
  }
  // CODE_B8D5A5
  a = (a + r16(0x19c8) + (c ? 1 : 0)) & 0xffff;
  w16(x + sprite.y_position, a);
  a = r16(0xd9);
  w16(x + sprite.x_position, a);
  reg.a = a;
  reg.x = x;
  reg.y = y;
}

/** $D9 += $DD; if that passes the target $19C6, stop exactly on it. Returns the new $D9. */
function stepTowardsTarget(): number {
  const dd = r16(0xdd);
  const a = (dd + r16(0xd9)) & 0xffff;
  w16(0xd9, a);
  // CMP $19C6 : ROR A : EOR $DD : BPL — "past the target" when (a >= target) matches the step sign
  const past = (a >= r16(0x19c6) ? 0x8000 : 0) ^ (dd & 0x8000);
  if (past) {
    w16(0xd9, r16(0x19c6));
    w16(0xdd, 0);
  }
  return r16(0xd9);
}

// ---------------------------------------------------------------------------------------------
// Main collision
// ---------------------------------------------------------------------------------------------

/** $B8D5C2 — undo the horizontal move (wall hit); on a platform sprite, keep above its floor. */
export function CODE_B8D5C2() {
  let x = reg.x;
  w16(x + sprite.x_position, r16(0xb0));
  reg.a = r16(0xb2);
  w16(x + sprite.x_sub_position, 0);
  const ti = r16(x + sprite.terrain_interaction) & 0x1000;
  reg.a = ti;
  if (!ti) return;
  CODE_B8D480();
  x = reg.x;
  w16(0x74, reg.a);
  const d = (reg.a - r16(x + sprite.y_position)) & 0xffff;
  reg.a = d;
  if (!isNeg(d)) return;
  reg.a = r16(0xfd);
  w16(x + sprite.y_position, reg.a);
}

/** $B8D5E0 — JSL entry; the terrain routines leave DB = $B5, so DB is restored here. */
export function process_terrain_interaction_global() {
  const db = reg.db;
  process_terrain_interaction();
  reg.db = db;
}

/** $B8D5E6 — move the current sprite by its velocity and resolve terrain collisions. */
export function process_terrain_interaction() {
  let x = r16(R.current_sprite);
  // this frame's contacts become last frame's (high byte); bits 4-7 shift down into bits 0-3
  const ti = r16(x + sprite.terrain_interaction);
  w16(R.temp_5E, (ti & 0x00ff) << 8);
  w16(x + sprite.terrain_interaction, ((ti >> 4) & 0x000f) | r16(R.temp_5E));
  w16(0xb0, r16(x + sprite.x_position));
  w16(0xb2, r16(x + sprite.x_sub_position));
  w16(0xe5, 0);

  if (r16(x + sprite.terrain_interaction) & 0x0400) {
    // CODE_B8D675: was touching a ceiling last frame
    CODE_B8D830();
    CODE_B8D480();
    x = reg.x;
    w16(0x74, reg.a);
    const d = (reg.a - r16(x + sprite.y_position)) & 0xffff;
    if (!isNeg(d)) return verticalPass(x);
    if (!cmpNeg(d, 0xfffd)) {
      // CODE_B8D6C0: small step up, follow the floor
      w16(x + sprite.y_position, r16(0x74));
      return verticalPass(x);
    }
    if (r16(AE) & 0x4000) return ceilingPass(x);
    // CODE_B8D6B0: wall
    reg.x = x;
    CODE_B8D5C2();
    x = reg.x;
    w16(x + sprite.max_x_speed, 0);
    w16(x + sprite.x_speed, 0);
    orTI(x, 0x0002);
    return ceilingPass(x);
  }

  CODE_B8D830();
  CODE_B8D480();
  x = reg.x;
  w16(0x74, reg.a);
  const d = (reg.a - r16(x + sprite.y_position)) & 0xffff;
  if (!isNeg(d)) return verticalPass(x);
  if (!cmpNeg(d, r16(R.RAM_0BA4))) {
    // CODE_B8D691: the floor rose by less than the step-up limit
    if (!cmpNeg(r16(AC) & 0x0007, r16(0x88))) return wallCheck(x);
    if (!(r16(AE) & 0x1800)) w16(x + sprite.y_position, r16(0x74));
    return verticalPass(x);
  }
  if (!(r16(AE) & 0x0400) && r16(AC) & 0x3800) return ceilingPass(x);
  return wallCheck(x);
}

/** CODE_B8D630: the sprite moved into something higher than it can step onto. */
function wallCheck(x: number) {
  let a = (r16(x + sprite.x_speed) & 0x8000) ^ r16(AE);
  if (!isNeg(a) && ((a - 1) & 0x80fe) === 0x003c) return ceilingPass(x);
  // CODE_B8D642: probe one pixel higher
  reg.a = (r16(x + sprite.y_position) - 1) & 0xffff;
  get_sprite_terrain_info_define_y();
  x = reg.x;
  a = (r16(x + sprite.x_speed) & 0x8000) ^ r16(AE);
  if (!isNeg(a) && ((a - 1) & 0x00fe) === 0x003c) return ceilingPass(x);
  // CODE_B8D65B: blocked by a wall
  w16(x + sprite.max_x_speed, 0);
  w16(x + sprite.x_speed, 0);
  reg.x = x;
  CODE_B8D5C2();
  x = reg.x;
  const ae = r16(AE);
  if (!(ae & 0x4000) && ae & 0x0100) orTI(x, 0x0082); // CODE_B8D6A7
  else orTI(x, 0x0002); // CODE_B8D66C
  verticalPass(x);
}

/** CODE_B8D6C4: apply the vertical move and land on / fall off the floor. */
function verticalPass(x: number) {
  incE5();
  if (isNeg(r16(x + sprite.y_speed))) return movingUpPass(x);
  // CODE_B8D6CD: moving down
  CODE_B8D817();
  CODE_B8D480();
  x = reg.x;
  const floor = reg.a;
  let y = floor;
  if (reg.c) {
    // CODE_B8D70B: no floor below
    w16(x + sprite.ground_distance, NO_GROUND);
    return airborne(x, y);
  }
  const d = (floor - r16(x + sprite.y_position)) & 0xffff;
  if (!isNeg(d)) {
    // CODE_B8D712: above the floor; land if within the snap distance (1, or 4 on slopes)
    w16(0x5e, d);
    const snap = (r16(AC) & 0x0007 ? 0x0003 : 0x0000) + 1;
    w16(0x60, snap);
    if (!cmpNeg(r16(0x5e), snap)) {
      w16(x + sprite.ground_distance, r16(0x5e));
      return airborne(x, y);
    }
  }
  // CODE_B8D6DB: at or below the floor
  const ae = r16(AE);
  if (!(ae & 0x0400) && ae & 0x1800) {
    w16(x + sprite.ground_distance, NO_GROUND);
    return airborne(x, y);
  }
  // CODE_B8D6E9: land
  w16(x + sprite.y_position, y);
  w16(x + sprite.ground_y_position, y);
  const idx = (r16(AC) & 0x0007) << 1;
  y = x;
  w16(x + sprite.y_speed, rom16(LANDING_Y_SPEED + idx));
  w16(x + sprite.y_sub_position, 0);
  w16(x + sprite.ground_distance, 0);
  orTI(x, 0x0001);
  finish(x, y);
}

/** CODE_B8D729: still in the air (Y = floor y). */
function airborne(x: number, y: number) {
  w16(x + sprite.ground_y_position, y);
  if ((r16(x + sprite.terrain_interaction) & 0x0101) === 0x0100) {
    // just walked off a ledge: start falling slowly
    w16(x + sprite.y_speed, 1);
  }
  finish(x, y);
}

/** CODE_B8D73C: vertical move after a ceiling / wall-top hit. */
function ceilingPass(x: number) {
  w16(0xb0, r16(x + sprite.y_position));
  incE5();
  CODE_B8D817();
  CODE_B8D480();
  x = reg.x;
  const y = reg.y;
  w16(x + sprite.ground_y_position, reg.a);
  const d = (reg.a - r16(x + sprite.y_position)) & 0xffff;
  w16(x + sprite.ground_distance, d);
  if (!isNeg(d)) return finish(x, y);
  if (!(r16(AE) & 0x4000)) {
    if (!isNeg(r16(x + sprite.y_speed))) {
      // moving down into a solid tile: land on the tile's 32-pixel grid line
      w16(x + sprite.y_speed, 0x0200);
      w16(x + sprite.y_sub_position, 0);
      const v = r16(x + sprite.y_position) & 0xffe0;
      w16(x + sprite.y_position, v);
      w16(x + sprite.ground_y_position, v);
      w16(x + sprite.ground_distance, 0);
      orTI(x, 0x0001);
    } else {
      // CODE_B8D777: moving up: bump the head
      const v = (r16(x + sprite.y_position) + 0x1f) & 0xffe0;
      w16(x + sprite.y_position, v);
      w16(x + sprite.ground_y_position, v);
      w16(x + sprite.ground_distance, 0);
      w16(x + sprite.y_position, r16(0xb0));
      w16(x + sprite.y_speed, 0);
      w16(x + sprite.max_y_speed, 0);
    }
  }
  // CODE_B8D78E
  orTI(x, 0x0004);
  finish(x, y);
}

/** CODE_B8D7A1: moving up. */
function movingUpPass(x: number) {
  w16(0xb0, r16(x + sprite.y_position));
  incE5();
  CODE_B8D817();
  CODE_B8D480();
  x = reg.x;
  let y = reg.a;
  if (reg.c) {
    // CODE_B8D7E4
    w16(x + sprite.ground_distance, NO_GROUND);
    w16(x + sprite.ground_y_position, y);
    return finish(x, y);
  }
  const d = (reg.a - r16(x + sprite.y_position)) & 0xffff;
  if (!isNeg(d)) {
    // CODE_B8D7E7
    w16(x + sprite.ground_distance, d);
    w16(x + sprite.ground_y_position, y);
    return finish(x, y);
  }
  if (r16(AC) & 0x4000) {
    // CODE_B8D7D6: inside a one-way (pass-through) tile: keep going up
    w16(x + sprite.ground_distance, d);
    w16(x + sprite.ground_y_position, y);
    orTI(x, 0x0004);
    return finish(x, y);
  }
  // hit a ceiling: undo the vertical move
  w16(x + sprite.y_position, r16(0xb0));
  w16(x + sprite.y_speed, 0);
  w16(x + sprite.max_y_speed, 0);
  CODE_B8D480();
  x = reg.x;
  y = reg.y;
  w16(x + sprite.ground_y_position, reg.a);
  if (reg.c) w16(x + sprite.ground_distance, NO_GROUND); // CODE_B8D7CF
  else w16(x + sprite.ground_distance, (reg.a - r16(x + sprite.y_position)) & 0xffff);
  finish(x, y);
}

/** CODE_B8D795: store the merged terrain attributes. */
function finish(x: number, y: number) {
  storeTerrainAttributes(x);
  reg.x = x;
  reg.y = y;
}

// ---------------------------------------------------------------------------------------------
// Velocity application used by the collision passes
// ---------------------------------------------------------------------------------------------

/** Add the 8.8 velocity to the 24-bit position whose middle word is at `mid`. */
function addVel(mid: number, vel: number) {
  const r = addVelocity24(mid, vel);
  reg.a = r.a;
  reg.y = r.y;
}

/** $B8D7FE — x position += x_speed. */
export function CODE_B8D7FE() {
  const x = r16(R.current_sprite);
  reg.x = x;
  addVel(x + sprite.x_sub_position + 1, r16(x + sprite.x_speed));
}

/** $B8D817 — y position += y_speed. */
export function CODE_B8D817() {
  const x = r16(R.current_sprite);
  reg.x = x;
  addVel(x + sprite.y_sub_position + 1, r16(x + sprite.y_speed));
}

/**
 * $B8D830 — x position += x_speed. A sprite standing on a platform sprite (bit 12 of
 * terrain_interaction) and not moving up is first carried along: it snaps to the platform's
 * surface ($0C), gets the platform's x movement (unknown_5C), and for Kongs the level may keep
 * them from walking off the platform's edges.
 */
export function CODE_B8D830() {
  const x = r16(R.current_sprite);
  reg.x = x;
  if (!(r16(x + sprite.terrain_interaction) & 0x1000) || isNeg(r16(x + sprite.y_speed))) {
    addVel(x + sprite.x_sub_position + 1, r16(x + sprite.x_speed));
    return;
  }
  // .on_platform_sprite
  w16(0xfd, r16(x + sprite.y_position));
  w16(x + sprite.y_position, r16(x + sprite.ground_y_position));
  w16(x + sprite.y_sub_position, 0xffff);
  w16(x + sprite.x_position, r16(x + sprite.unknown_5C) + r16(x + sprite.x_position));
  w16(x + sprite.unknown_5C, 0);
  addVel(x + sprite.x_sub_position + 1, r16(x + sprite.x_speed));
  if (x !== r16(R.inactive_kong_sprite) && x !== r16(R.active_kong_sprite)) return;
  // CODE_B8D88A
  const guard = r16(level.effects) & C.platform_sprite_edge_guard_effect;
  reg.a = guard;
  if (!guard) return;
  let a = (r16(R.platform_sprite_right_edge_position) - 1) & 0xffff;
  reg.a = a;
  if (cmpNeg(a, r16(x + sprite.x_position))) {
    w16(x + sprite.x_position, a);
    reg.a = 0xffff;
    w16(x + sprite.x_sub_position, 0xffff);
    w16(x + sprite.max_x_speed, 0);
    w16(x + sprite.x_speed, 0);
    return;
  }
  // CODE_B8D8A6
  a = r16(R.platform_sprite_left_edge_position);
  reg.a = a;
  if (cmpNeg(a, r16(x + sprite.x_position))) return;
  w16(x + sprite.x_position, (a + 1) & 0xffff);
  reg.a = 0;
  w16(x + sprite.x_sub_position, 0);
  w16(x + sprite.max_x_speed, 0);
  w16(x + sprite.x_speed, 0);
}

// ---------------------------------------------------------------------------------------------
// Player interactions
// ---------------------------------------------------------------------------------------------

/** $B8D8BA */
export function set_player_interaction_global() {
  set_player_interaction();
}

/**
 * $B8D8BE — request player interaction A (from the current sprite). Only a higher-priority
 * (larger) interaction replaces the pending one; carry set = rejected.
 */
export function set_player_interaction() {
  const a = reg.a & 0xffff;
  const cur = r16(R.current_interaction);
  if (a === cur || cmpNeg(a, cur)) {
    reg.c = true;
    return;
  }
  w16(R.current_interaction, a);
  reg.a = r16(R.current_sprite);
  w16(R.current_interacting_sprite, reg.a);
  reg.c = false;
}

register({
  CODE_B8D362,
  CODE_B8D36D,
  CODE_B8D378,
  CODE_B8D3E2,
  CODE_B8D47C,
  CODE_B8D480,
  CODE_B8D484,
  CODE_B8D497,
  CODE_B8D4AE,
  CODE_B8D5AF,
  CODE_B8D5C2,
  process_terrain_interaction_global,
  process_terrain_interaction,
  CODE_B8D7FE,
  CODE_B8D817,
  CODE_B8D830,
  set_player_interaction_global,
  set_player_interaction,
});
