/**
 * Bank $B3 — Rain cloud (Toxic Tower / Mudhole Marsh rain), Squitter's web shots and web
 * platforms, and Glimmer (the anglerfish lighting Glimmer's Galleon).
 */
import { r16, w16 } from "../../core/mem";
import { reg } from "../../core/cpu";
import { R, C, sprite } from "../../core/sym";
import {
  apply_position_from_velocity_global,
  process_sprite_animation,
  get_current_sprite_clipping,
  CODE_BEBD8E,
  delete_sprite_if_offscreen,
  delete_sprite_handle_deallocation,
  set_sprite_animation,
  interpolate_x_velocity_global,
  interpolate_y_velocity_global,
} from "../../gen/routines";
import { cur, sr, sw, neg, isNeg, registerSprite, registerRts, registerRtl } from "./b3c_common";
import { CODE_B3D46C, CODE_B3D485, CODE_B3D4AE } from "./b3c_platforms";
import { L } from "../../core/sym";

/** N flag of `CMP` (A - b). */
const cmpMi = (a: number, b: number) => ((a - b) & 0x8000) !== 0;

// =============================================================================================
// Rain cloud

/** $B3890E — the rain cloud drifts along with the Kong horizontally. */
export function rain_cloud_main() {
  const kong = r16(R.active_kong_sprite);
  const x = cur();
  reg.y = kong;
  reg.x = x;
  sw(x, sprite.x_speed, sr(kong, sprite.x_speed));
  sw(x, sprite.y_speed, 0);
  apply_position_from_velocity_global();
  process_sprite_animation();
}

// =============================================================================================
// Squitter's web shot (the attack) and web platform (the shot that becomes a platform)

/** $B38925 — Squitter's web shot: flies until it hits an enemy or leaves the screen. */
export function web_shot_main() {
  get_current_sprite_clipping();
  reg.a = 0x0020;
  reg.y = 0x0008;
  CODE_BEBD8E(); // hit an enemy?
  if (reg.c) {
    w16(R.squitter_web_shot_count, r16(R.squitter_web_shot_count) - 1);
    delete_sprite_handle_deallocation();
    return;
  }
  update_web_velocity();
  apply_position_from_velocity_global();
  process_sprite_animation();
  delete_sprite_if_offscreen();
  if (reg.c) w16(R.squitter_web_shot_count, r16(R.squitter_web_shot_count) - 1);
}

/** `TRB RAM_0B02` of the web bits (bit 6 = a platform web is moving, bit 7 = opening). */
const clearWebBits = (mask: number) => w16(R.RAM_0B02, r16(R.RAM_0B02) & ~mask);

const PLATFORM_COLLISION_LOGIC = L("web_platform_main_platform_collision_logic");

/**
 * $B38959 — the web platform. Sprite variables: $42 frames since a Kong stood on it,
 * $44 despawn state (1 = start, 2 = despawning), $46 frame it opened, $48 vertical trajectory,
 * $4E wiggle (set while stood on).
 */
export function web_platform_main() {
  const x = cur();
  switch (sr(x, sprite.state) & 0xffff) {
    case 0: {
      // flying web shot
      update_web_velocity();
      apply_position_from_velocity_global();
      delete_sprite_if_offscreen();
      if (reg.c) return clearWebBits(0x00c0); // gone: Squitter may shoot again
      process_sprite_animation();
      return;
    }
    case 1: {
      // just opened: the platform keeps its spawn position as its hitbox position
      sw(x, sprite.unknown_22, sr(x, sprite.x_position));
      sw(x, sprite.unknown_28, sr(x, sprite.y_position));
      sw(x, sprite.interaction_flags, 0);
      sw(x, sprite.general_purpose_4E, 0);
      sw(x, sprite.render_order, 0x00c4);
      sw(x, sprite.general_purpose_46, r16(R.active_frame_counter));
      sw(x, sprite.state, sr(x, sprite.state) + 1);
      reg.x = x;
      return;
    }
    case 2: {
      // idle platform: after about 7 seconds it starts to fade
      if (sr(x, sprite.general_purpose_44) === 0) {
        const age = (r16(R.active_frame_counter) - sr(x, sprite.general_purpose_46)) & 0xffff;
        if (!cmpMi(age, 0x01a4)) sw(x, sprite.general_purpose_44, sr(x, sprite.general_purpose_44) + 1);
      }
      if (((sr(x, sprite.general_purpose_44) - 1) & 0xffff) === 0) {
        clearWebBits(0x0080);
        sw(x, sprite.general_purpose_44, sr(x, sprite.general_purpose_44) + 1);
        reg.x = x;
        reg.a = C.web_platform_despawn_anim_id;
        set_sprite_animation();
      }
      process_sprite_animation();
      reg.a = PLATFORM_COLLISION_LOGIC & 0xffff;
      CODE_B3D46C(0xb3);
      return;
    }
    case 3: {
      // fading out
      delete_sprite_if_offscreen();
      if (reg.c) return clearWebBits(0x00c0);
      process_sprite_animation();
      return;
    }
    default:
      throw new Error(`web_platform_main: bad state ${sr(x, sprite.state)}`);
  }
}

/** $B389D9 — platform callback: let Kongs stand on the web and wiggle it when stood on. */
export function web_platform_main_platform_collision_logic() {
  let x = cur();
  w16(R.current_sprite_constants, sr(x, sprite.constants_address));
  sw(x, sprite.movement_state, 0);
  CODE_B3D485();
  CODE_B3D4AE();
  const standing = reg.c;
  x = cur();
  reg.x = x;
  sw(x, sprite.general_purpose_4E, ((reg.a << 1) | (standing ? 1 : 0)) & 0xffff); // ROL A
  if (standing) sw(x, sprite.general_purpose_42, 0);
  let t = (sr(x, sprite.general_purpose_42) + 1) & 0xffff;
  if (isNeg(t)) t = (t - 1) & 0xffff; // saturate at $7FFF
  sw(x, sprite.general_purpose_42, t);
  reg.a = t;
  reg.c = standing;
}

/** $B38A0A — accelerate the web along its vertical trajectory ($48), capped at +-$600. */
export function update_web_velocity() {
  const x = cur();
  reg.x = x;
  const trajectory = sr(x, sprite.general_purpose_48);
  let v = (trajectory + sr(x, sprite.y_speed)) & 0xffff;
  if (isNeg(trajectory)) {
    if (cmpMi(v, 0xfa00)) v = 0xfa00;
  } else if (!cmpMi(v, 0x0600)) v = 0x0600;
  sw(x, sprite.y_speed, v);
  reg.a = v;
}

// =============================================================================================
// Glimmer

/** $B38EAD — Glimmer follows the Kong to light the way. */
export function glimmer_main() {
  const x = cur();
  switch (sr(x, sprite.state) & 0xffff) {
    case 0:
      return glimmerFollowKong();
    case 1:
      return;
    case 2:
      // re-enter from the left edge of the screen
      sw(x, sprite.x_position, r16(R.screen_scroll_x_position) + 0x0080);
      sw(x, sprite.state, 0);
      reg.x = x;
      return;
    case 3:
      // init: only one Glimmer at a time
      if (r16(R.glimmer_sprite) !== 0) {
        delete_sprite_handle_deallocation();
        return;
      }
      sw(x, sprite.state, 0);
      return glimmerFollowKong();
    default:
      throw new Error(`glimmer_main: bad state ${sr(x, sprite.state)}`);
  }
}

function glimmerFollowKong() {
  w16(R.glimmer_sprite, cur());
  glimmerUpdateMovement();
  reg.a = 0x0007;
  interpolate_x_velocity_global();
  reg.a = 0x0007;
  interpolate_y_velocity_global();
  apply_position_from_velocity_global();
  const x = cur();
  reg.x = x;
  // never fall behind the left edge of the screen
  const left = (r16(R.screen_scroll_x_position) + 0x0014) & 0xffff;
  if (!cmpMi(left, sr(x, sprite.x_position))) sw(x, sprite.x_position, left);
  glimmerUpdateAnimationSpeed(x);
  process_sprite_animation();
}

/** Animate faster the faster Glimmer swims (1.5 * max(|vx|, |vy|) / 2, at least $160). */
function glimmerUpdateAnimationSpeed(x: number) {
  let vx = sr(x, sprite.x_speed);
  if (isNeg(vx)) vx = neg(vx);
  w16(0x32, vx);
  let vy = sr(x, sprite.y_speed);
  if (isNeg(vy)) vy = neg(vy);
  let a = cmpMi(vy, vx) ? vx : vy;
  a >>= 1;
  w16(0x5e, a);
  a = ((a >> 1) + a) & 0xffff;
  if (cmpMi(a, 0x0160)) a = 0x0160;
  sw(x, sprite.animation_speed, a);
  reg.a = a;
}

/** Target: $40 pixels behind the Kong, $10 above. */
function glimmerUpdateMovement() {
  const kong = r16(R.active_kong_sprite);
  reg.x = kong;
  const ahead = sr(kong, sprite.oam_property) & 0x4000 ? 0x0040 : 0xffc0;
  w16(0x5e, ahead + sr(kong, sprite.x_position));
  w16(0x60, sr(kong, sprite.y_position) + 0xfff0);
  const x = cur();
  reg.x = x;
  sw(x, sprite.max_x_speed, glimmerTargetSpeed((r16(0x5e) - sr(x, sprite.x_position)) & 0xffff));
  sw(x, sprite.max_y_speed, (reg.a = glimmerTargetSpeed((r16(0x60) - sr(x, sprite.y_position)) & 0xffff)));
}

/** Distance * 16, clamped to +-$800 (computed on the magnitude, like the original). */
function glimmerTargetSpeed(d: number): number {
  if (!isNeg(d)) {
    const a = (d << 4) & 0xffff;
    return cmpMi(a, 0x0800) ? a : 0x0800;
  }
  const a = neg((neg(d) << 4) & 0xffff);
  return cmpMi(a, 0xf800) ? 0xf800 : a;
}

registerSprite({ rain_cloud_main, web_shot_main, web_platform_main, glimmer_main });
registerRts({ update_web_velocity });
registerRtl({ web_platform_main_platform_collision_logic });
