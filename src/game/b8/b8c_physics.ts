/**
 * Bank $B8 (package B8c) — per-frame Kong/sprite physics helpers: gravity and terminal velocity
 * from the sprite constants, applying velocity to the 24-bit (pixel + sub-pixel) position,
 * smooth velocity interpolation presets, invincibility flashing, bullet time, screen-edge
 * clamping and slope sliding.
 *
 * Sprite positions are 24-bit: `x_sub_position` (word at +4, only its high byte is the fraction)
 * and `x_position` (word at +6). Velocities are 8.8 fixed point, so the original adds the
 * velocity to the word at +5 (fraction byte + pixel low byte) and carries into the byte at +7.
 */
import { r16, w16, rom16 } from "../../core/mem";
import { reg, register, callPtr } from "../../core/cpu";
import { L, R, C, sprite, kong_control, level } from "../../core/sym";
import { neg, isNeg, cmpNeg, spriteConst, addVelocity24 } from "./b8c_util";

const INTERPOLATION_PRESETS = L("DATA_B8D059");

// ---------------------------------------------------------------------------------------------
// Gravity / terminal velocity (values come from the current sprite's constants block)
// ---------------------------------------------------------------------------------------------

/** $B8CE78 — gravity while the jump button is held (lighter: longer jumps). */
export function set_player_jumping_gravity() {
  const animal = r16(R.animal_type);
  // animals keep one constant per animal type, indexed by (type - $34) / 2
  const y = animal ? ((animal - 0x34) & 0xffff) >> 1 : 0x0004;
  const v = spriteConst(y);
  const ctl = r16(R.current_kong_control_variables);
  w16(ctl + kong_control.gravity_force, v);
  reg.a = v;
  reg.y = ctl;
}

/** $B8CE95 */
export function set_player_normal_gravity_global() {
  set_player_normal_gravity();
}

/** $B8CE99 — normal gravity (falling / jump button released). */
export function set_player_normal_gravity() {
  const animal = r16(R.animal_type);
  const y = animal ? ((animal - 0x5c) & 0xffff) >> 1 : 0x0000;
  const v = spriteConst(y);
  const ctl = r16(R.current_kong_control_variables);
  w16(ctl + kong_control.gravity_force, v);
  reg.a = v;
  reg.y = ctl;
}

/** $B8CEB6 */
export function set_player_terminal_velocity_global() {
  set_player_terminal_velocity();
}

/** $B8CEBA — maximum fall speed. Squawks without a rider uses its own constant. */
export function set_player_terminal_velocity() {
  const animal = r16(R.animal_type);
  let y: number;
  if (!animal) y = 0x0002;
  else if (animal === C.sprite_squawks && !r16(R.current_player_mount)) y = 0x0080;
  else y = ((animal - 0x48) & 0xffff) >> 1;
  const v = spriteConst(y);
  const ctl = r16(R.current_kong_control_variables);
  w16(ctl + kong_control.max_fall_speed, v);
  reg.a = v;
  reg.y = ctl;
}

/** $B8CEE7 — maximum fall speed while holding down (fast fall). */
export function set_player_terminal_velocity_down() {
  const animal = r16(R.animal_type);
  let y: number;
  if (!animal) y = 0x0006;
  else if (animal === C.sprite_squawks && !r16(R.current_player_mount)) y = 0x0082;
  else y = ((animal - 0x20) & 0xffff) >> 1;
  const v = spriteConst(y);
  const ctl = r16(R.current_kong_control_variables);
  w16(ctl + kong_control.max_fall_speed, v);
  reg.a = v;
  reg.y = ctl;
}

// ---------------------------------------------------------------------------------------------
// Facing / gravity / velocity application
// ---------------------------------------------------------------------------------------------

/** $B8CF4B — turn the sprite to face the direction of its target x velocity. */
export function face_moving_direction() {
  const x = r16(R.current_sprite);
  reg.x = x;
  const target = r16(x + sprite.max_x_speed);
  reg.a = target;
  if (!target) return;
  // bit 15 of the velocity (moving left) shifted into bit 14 = the "facing left" OAM flag
  const flags = r16(x + sprite.oam_property);
  const diff = ((target >> 1) ^ flags) & 0x4000;
  reg.a = diff;
  if (!diff) return;
  const v = diff ^ flags;
  w16(x + sprite.oam_property, v);
  reg.a = v;
}

/** $B8CF5E — switch back to normal gravity once the sprite starts falling. */
export function set_normal_gravity_if_falling() {
  const x = r16(R.current_sprite);
  reg.x = x;
  const ys = r16(x + sprite.y_speed);
  reg.a = ys;
  if (isNeg(ys)) return;
  set_player_normal_gravity();
}

/** $B8CF68 — y_speed += gravity, clamped to the terminal velocity when moving down. */
export function apply_player_gravity() {
  const x = r16(R.current_sprite);
  const ctl = r16(R.current_kong_control_variables);
  let v = (r16(ctl + kong_control.gravity_force) + r16(x + sprite.y_speed)) & 0xffff;
  if (!isNeg(v)) {
    const max = r16(ctl + kong_control.max_fall_speed);
    if (v >= max) v = max; // unsigned compare (BCC)
  }
  w16(x + sprite.y_speed, v);
  reg.a = v;
  reg.x = x;
  reg.y = ctl;
}

/** $B8CF7F */
export function apply_position_from_velocity_global() {
  apply_position_from_velocity();
}

/** $B8CF83 — position += velocity (both axes, 8.8 fixed point with sign extension). */
export function apply_position_from_velocity() {
  const x = r16(R.current_sprite);
  addVelocity24(x + sprite.y_sub_position + 1, r16(x + sprite.y_speed));
  const r = addVelocity24(x + sprite.x_sub_position + 1, r16(x + sprite.x_speed));
  reg.a = r.a;
  reg.y = r.y;
  reg.x = x;
}

// ---------------------------------------------------------------------------------------------
// Velocity interpolation: speed approaches its target by a fraction of the remaining distance.
// A = preset index; the presets compute fractions of A with shifts (e.g. 1/32 + 1/128).
// ---------------------------------------------------------------------------------------------

/** Run preset `index` (`JSR (DATA_B8D059,x)`) on value `v`; returns the step. */
function interpolationStep(index2: number, v: number): number {
  reg.a = v;
  callPtr(0xb8, rom16(INTERPOLATION_PRESETS + index2));
  return reg.a & 0xffff;
}

/** $B8CFD4 */
export function interpolate_y_velocity_global() {
  interpolate_y_velocity();
}

/** $B8CFD8 — move y_speed towards max_y_speed (target) using preset A. */
export function interpolate_y_velocity() {
  const x = r16(R.current_sprite);
  const index2 = (reg.a << 1) & 0xffff;
  w16(0x26, index2);
  const diff = (r16(x + sprite.max_y_speed) - r16(x + sprite.y_speed)) & 0xffff;
  let step: number;
  if (isNeg(diff)) {
    step = interpolationStep(index2, neg(diff));
    if (step) step = neg(step);
  } else {
    step = interpolationStep(index2, diff);
  }
  reg.x = x;
  reg.y = x;
  if (step === 0) {
    // CODE_B8D009: too close to interpolate any further, snap to the target
    const v = r16(x + sprite.max_y_speed);
    w16(x + sprite.y_speed, v);
    reg.a = v;
    reg.x = index2;
    return;
  }
  const v = (step + r16(x + sprite.y_speed)) & 0xffff;
  w16(x + sprite.y_speed, v);
  reg.a = v;
}

/** $B8D010 */
export function interpolate_x_velocity_global() {
  interpolate_x_velocity();
}

/**
 * $B8D014 — move x_speed towards (max_x_speed + unknown_2C) using preset A.
 * unknown_2C is the slope slip velocity (see handle_slope_sliding_velocity).
 */
export function interpolate_x_velocity() {
  const x = r16(R.current_sprite);
  const index2 = (reg.a << 1) & 0xffff;
  w16(0x26, index2);
  const diff = (r16(x + sprite.max_x_speed) + r16(x + sprite.unknown_2C) - r16(x + sprite.x_speed)) & 0xffff;
  let step: number;
  if (isNeg(diff)) {
    step = interpolationStep(index2, neg(diff));
    if (step) step = neg(step);
  } else {
    step = interpolationStep(index2, diff);
  }
  reg.x = x;
  reg.y = x;
  if (step === 0) {
    // CODE_B8D048: snap to the target
    const v = (r16(x + sprite.max_x_speed) + r16(x + sprite.unknown_2C)) & 0xffff;
    w16(x + sprite.x_speed, v);
    reg.a = v;
    reg.x = index2;
    return;
  }
  const v = (step + r16(x + sprite.x_speed)) & 0xffff;
  w16(x + sprite.x_speed, v);
  reg.a = v;
}

// Interpolation presets ($B8D0AF-$B8D198). Each takes A and returns a fraction of it in A,
// using $26/$28 as scratch exactly like the original. Z (used by the callers) = (A == 0).
function presetDone(v: number) {
  reg.a = v & 0xffff;
  reg.z = reg.a === 0;
  reg.n = isNeg(reg.a);
}
/** A >> n, then A >> m more; result = sum of the two partial values. */
function shiftSum(a: number, n: number, m: number): number {
  const p = a >> n;
  w16(0x26, p);
  return (p + (p >> m)) & 0xffff;
}
/** Three partial values: a>>n (saved in $26), >>m more (saved in $28), >>k more. */
function shiftSum3(a: number, n: number, m: number, k: number): number {
  const p1 = a >> n;
  w16(0x26, p1);
  const p2 = p1 >> m;
  w16(0x28, p2);
  const p3 = p2 >> k;
  return (p3 + p1 + p2) & 0xffff;
}

/** $B8D0AF — A/32 + A/128 */
export function CODE_B8D0AF() { presetDone(shiftSum(reg.a & 0xffff, 5, 2)); }
/** $B8D0BC — A/32 + A/64 */
export function CODE_B8D0BC() { presetDone(shiftSum(reg.a & 0xffff, 5, 1)); }
/** $B8D0C8 — A/32 + A/64 + A/128 */
export function CODE_B8D0C8() { presetDone(shiftSum3(reg.a & 0xffff, 5, 1, 1)); }
/** $B8D0DA — A/16 + A/64 */
export function CODE_B8D0DA() { presetDone(shiftSum(reg.a & 0xffff, 4, 2)); }
/** $B8D0E6 — A/16 + A/32 */
export function CODE_B8D0E6() { presetDone(shiftSum(reg.a & 0xffff, 4, 1)); }
/** $B8D0F1 — A/16 + A/32 + A/64 */
export function CODE_B8D0F1() { presetDone(shiftSum3(reg.a & 0xffff, 4, 1, 1)); }
/** $B8D102 — no movement */
export function CODE_B8D102() { presetDone(0); }
/** $B8D106 — A/256 */
export function CODE_B8D106() { presetDone((reg.a & 0xffff) >> 8); }
/** $B8D107 — A/128 */
export function CODE_B8D107() { presetDone((reg.a & 0xffff) >> 7); }
/** $B8D108 — A/64 */
export function CODE_B8D108() { presetDone((reg.a & 0xffff) >> 6); }
/** $B8D109 — A/32 */
export function CODE_B8D109() { presetDone((reg.a & 0xffff) >> 5); }
/** $B8D10A — A/16 */
export function CODE_B8D10A() { presetDone((reg.a & 0xffff) >> 4); }
/** $B8D10F — A/8 */
export function CODE_B8D10F() { presetDone((reg.a & 0xffff) >> 3); }
/** $B8D113 — A/8 + A/16 */
export function CODE_B8D113() { presetDone(shiftSum(reg.a & 0xffff, 3, 1)); }
/** $B8D11D — A/4 */
export function CODE_B8D11D() { presetDone((reg.a & 0xffff) >> 2); }
/** $B8D120 — A/4 + A/16 */
export function CODE_B8D120() { presetDone(shiftSum(reg.a & 0xffff, 2, 2)); }
/** $B8D12A — A/4 + A/8 */
export function CODE_B8D12A() { presetDone(shiftSum(reg.a & 0xffff, 2, 1)); }
/** $B8D133 — A/4 + A/8 + A/16 */
export function CODE_B8D133() { presetDone(shiftSum3(reg.a & 0xffff, 2, 1, 1)); }
/** $B8D142 — A/2 */
export function CODE_B8D142() { presetDone((reg.a & 0xffff) >> 1); }
/** $B8D144 — A/2 + A/16 */
export function CODE_B8D144() { presetDone(shiftSum(reg.a & 0xffff, 1, 3)); }
/** $B8D14E — A/2 + A/8 */
export function CODE_B8D14E() { presetDone(shiftSum(reg.a & 0xffff, 1, 2)); }
/** $B8D157 — A/2 + A/8 + A/16 */
export function CODE_B8D157() { presetDone(shiftSum3(reg.a & 0xffff, 1, 2, 1)); }
/** $B8D166 — A/2 + A/4 */
export function CODE_B8D166() { presetDone(shiftSum(reg.a & 0xffff, 1, 1)); }
/** $B8D16E — A/2 + A/4 + A/16 */
export function CODE_B8D16E() { presetDone(shiftSum3(reg.a & 0xffff, 1, 1, 2)); }
/** $B8D17D — A/2 + A/4 + A/8 */
export function CODE_B8D17D() { presetDone(shiftSum3(reg.a & 0xffff, 1, 1, 1)); }
/** $B8D18B — A - A/16 */
export function CODE_B8D18B() {
  const a = reg.a & 0xffff;
  w16(0x26, a);
  presetDone(neg(a >> 4) + a);
}
/** $B8D198 — the whole remaining distance in one step */
export function CODE_B8D198() { presetDone(reg.a & 0xffff); }

// ---------------------------------------------------------------------------------------------
// Invincibility / bullet time
// ---------------------------------------------------------------------------------------------

/** $B8D199 — count down the invincibility timer; interaction flags $9E while it runs. */
export function update_invincibility() {
  const x = r16(R.current_sprite);
  const ctl = r16(R.current_kong_control_variables);
  reg.x = x;
  reg.y = ctl;
  let t = r16(ctl + kong_control.invincible_timer);
  reg.a = t;
  if (!t) return;
  t = (t - 1) & 0xffff;
  w16(ctl + kong_control.invincible_timer, t);
  reg.a = t ? 0x009e : 0x001e;
  w16(x + sprite.interaction_flags, reg.a);
}

/** $B8D1B5 — invincibility plus the damage flashing (sprite hidden every other 2 frames). */
export function update_damaged_invincibility() {
  update_invincibility();
  const x = reg.x;
  const ctl = reg.y;
  let t = r16(ctl + kong_control.flash_timer);
  reg.a = t;
  if (!t) return;
  t = (t - 1) & 0xffff;
  w16(ctl + kong_control.flash_timer, t);
  const mode = r16(x + sprite.display_mode);
  let v: number;
  if (t && !(r16(R.active_frame_counter) & 0x0002)) v = mode | 0xc000; // hide
  else v = mode & 0x3fff; // show (or flashing finished)
  w16(x + sprite.display_mode, v);
  reg.a = v;
}

/** $B8D1E4 */
export function enable_bullet_time_global() {
  enable_bullet_time();
}

/** $B8D1E8 — A = time stop flags, Y = duration. */
export function enable_bullet_time() {
  w16(R.time_stop_flags, reg.a);
  reg.a = reg.y;
  w16(R.time_stop_timer, reg.a);
}

/** $B8D1F0 */
export function disable_bullet_time_global() {
  disable_bullet_time();
}

/** $B8D1F4 */
export function disable_bullet_time() {
  w16(R.time_stop_flags, 0);
  w16(R.time_stop_timer, 0);
}

/** $B8D1FB */
export function disable_enemy_damage_global() {
  disable_enemy_damage();
}

/** $B8D1FF — A = invincibility time; only ever extends the current invincibility. X = sprite. */
export function disable_enemy_damage() {
  const ctl = r16(R.current_kong_control_variables);
  reg.y = ctl;
  const a = reg.a & 0xffff;
  if (cmpNeg(a, r16(ctl + kong_control.invincible_timer))) return;
  w16(ctl + kong_control.invincible_timer, a);
  reg.a = 0x009e;
  w16(reg.x + sprite.interaction_flags, 0x009e);
}

/** $B8D20F — after taking a hit: flash for $60 frames, invincible for $70. */
export function start_damaged_invincibility() {
  const x = r16(R.current_sprite);
  const ctl = r16(R.current_kong_control_variables);
  w16(x + sprite.interaction_flags, 0x009e);
  w16(ctl + kong_control.flash_timer, 0x0060);
  w16(ctl + kong_control.invincible_timer, 0x0070);
  reg.a = 0x0070;
  reg.x = x;
  reg.y = ctl;
}

/** $B8D225 — keep the sprite between screen x+$10 and x+$F0. Leaves DB = $B8 (PHK/PLB). */
export function prevent_sprite_from_leaving_level_x() {
  reg.db = 0xb8;
  const x = r16(R.current_sprite);
  reg.x = x;
  const pos = r16(x + sprite.x_position);
  let d = (pos - 0x10 - r16(R.screen_scroll_x_position)) & 0xffff;
  if (!isNeg(d)) {
    d = (d - 0xe0) & 0xffff;
    reg.a = d;
    if (!isNeg(d)) {
      clampBack(x, d);
      return;
    }
    return;
  }
  clampBack(x, d);
}
/** CODE_B8D235: position -= overshoot */
function clampBack(x: number, overshoot: number) {
  const v = (neg(overshoot) + r16(x + sprite.x_position)) & 0xffff;
  w16(x + sprite.x_position, v);
  reg.a = v;
}

// ---------------------------------------------------------------------------------------------
// Slope sliding
// ---------------------------------------------------------------------------------------------

const SLIP_TABLE_STEEP = L("DATA_B8D2D2") & 0xffff; // used when $88 == 6
const SLIP_TABLE_NORMAL = L("DATA_B8D302") & 0xffff;
const SLIP_TABLE_SLIPPERY = L("DATA_B8D332") & 0xffff; // ice levels (level effects $3000)

/** $B8D246 — JSL entry of CODE_B8D25A (used by other banks for non-Kong sprites). */
export function CODE_B8D246() {
  CODE_B8D25A();
}

/** $B8D24A — slip velocity on slopes, from the level's slope table. */
export function handle_slope_sliding_velocity() {
  if ((r16(level.effects) & 0x3000) === 0x3000) {
    slopeSlide(SLIP_TABLE_SLIPPERY);
    return;
  }
  CODE_B8D25A();
}

/** $B8D25A — slope slide with the normal table ($88 = 6 selects the steep variant). */
export function CODE_B8D25A() {
  slopeSlide(r16(0x88) === 0x0006 ? SLIP_TABLE_STEEP : SLIP_TABLE_NORMAL);
}

/**
 * CODE_B8D269: each table entry (6 bytes per slope steepness) holds the slip velocity,
 * then a lower and an upper clamp for the current x speed while sliding.
 */
function slopeSlide(table: number) {
  w16(0x34, table);
  const x = r16(R.current_sprite);
  reg.x = x;
  const contact = r16(x + sprite.terrain_interaction) & 0x0011;
  reg.c = contact >= 0x0001;
  if (contact !== 0x0001) {
    // .standing_on_sprite: not standing on actual terrain, no slip
    w16(x + sprite.unknown_2C, 0);
    return;
  }
  const steep = r16(x + sprite.terrain_attributes) & 0x0007;
  w16(0x32, steep << 1);
  const entry = ((steep << 2) + (steep << 1) + table) & 0xffff;
  w16(0x32, rom16(0xb80002 + entry));
  w16(0x34, rom16(0xb80004 + entry));
  const slip = rom16(0xb80000 + entry);
  reg.y = x;
  if (r16(x + sprite.terrain_attributes) & 0x8000) {
    // .slope_right (carry here is from the table index ADC, always clear)
    reg.c = false;
    w16(x + sprite.unknown_2C, slip);
    const v = CODE_B8D2C1_value(r16(x + sprite.x_speed));
    w16(x + sprite.x_speed, v);
    reg.a = v;
    return;
  }
  // slope going left: work on mirrored values
  reg.c = false;
  w16(x + sprite.unknown_2C, neg(slip));
  const v = neg(CODE_B8D2C1_value(neg(r16(x + sprite.x_speed))));
  w16(x + sprite.x_speed, v);
  reg.a = v;
  reg.c = false;
}

/** $B8D2C1 — clamp A between $32 and $34 (only when A has bits in common with $32). */
export function CODE_B8D2C1() {
  reg.a = CODE_B8D2C1_value(reg.a & 0xffff);
}
function CODE_B8D2C1_value(a: number): number {
  const lo = r16(0x32);
  const hi = r16(0x34);
  // carry of the last CMP is visible to callers on the right-slope path
  if (!(a & lo)) return a; // BIT $32 : BEQ
  reg.c = a >= lo;
  if (cmpNeg(a, lo)) a = lo;
  reg.c = a >= hi;
  if (!cmpNeg(a, hi)) a = hi;
  return a;
}

register({
  set_player_jumping_gravity,
  set_player_normal_gravity_global,
  set_player_normal_gravity,
  set_player_terminal_velocity_global,
  set_player_terminal_velocity,
  set_player_terminal_velocity_down,
  face_moving_direction,
  set_normal_gravity_if_falling,
  apply_player_gravity,
  apply_position_from_velocity_global,
  apply_position_from_velocity,
  interpolate_y_velocity_global,
  interpolate_y_velocity,
  interpolate_x_velocity_global,
  interpolate_x_velocity,
  CODE_B8D0AF,
  CODE_B8D0BC,
  CODE_B8D0C8,
  CODE_B8D0DA,
  CODE_B8D0E6,
  CODE_B8D0F1,
  CODE_B8D102,
  CODE_B8D106,
  CODE_B8D107,
  CODE_B8D108,
  CODE_B8D109,
  CODE_B8D10A,
  CODE_B8D10F,
  CODE_B8D113,
  CODE_B8D11D,
  CODE_B8D120,
  CODE_B8D12A,
  CODE_B8D133,
  CODE_B8D142,
  CODE_B8D144,
  CODE_B8D14E,
  CODE_B8D157,
  CODE_B8D166,
  CODE_B8D16E,
  CODE_B8D17D,
  CODE_B8D18B,
  CODE_B8D198,
  update_invincibility,
  update_damaged_invincibility,
  enable_bullet_time_global,
  enable_bullet_time,
  disable_bullet_time_global,
  disable_bullet_time,
  disable_enemy_damage_global,
  disable_enemy_damage,
  start_damaged_invincibility,
  prevent_sprite_from_leaving_level_x,
  CODE_B8D246,
  handle_slope_sliding_velocity,
  CODE_B8D25A,
  CODE_B8D2C1,
});
