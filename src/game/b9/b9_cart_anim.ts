/**
 * Bank $B9 — skull cart animation callbacks ($B9E3D3-$B9E50F).
 *
 * While riding a skull cart the Kong's graphic is chosen from the cart's slope
 * (general_purpose_48, low byte = slope index) and from the cart status bits in
 * general_purpose_4A ($0008 crashing, $0010 idle, $0040 jumping, $0080/$0100 leaning,
 * $0200 ...). Command 83 callbacks here run with DB = $F9.
 */
import { r16, w16 } from "../../core/mem";
import { reg, register } from "../../core/cpu";
import { L, R, sprite, C } from "../../core/sym";
import { CODE_B4C175 } from "../../gen/routines";
import { process_anim_script, CODE_B9D12B } from "./b9_anim_core";
import { isNeg } from "./b9_anim_util";

const DIXIE_SKULL_CART = L("animation_dixie_skull_cart") & 0xffff;
const DIDDY_SKULL_CART = L("animation_diddy_skull_cart") & 0xffff;

/** Graphic for the cart slope: base + 4 * slope index. */
const slopeGraphic = (x: number, base: number) => (((r16(x + sprite.general_purpose_48) & 0xff) << 2) + base) & 0xffff;

/** Restart the riding animation and show the slope graphic (unless airborne, slope 9). */
function restartCartAnim(x: number, script: number, frameBase: number) {
  w16(x + sprite.animation_address, script);
  w16(x + sprite.animation_routine, 0);
  w16(x + sprite.animation_timer, 0);
  w16(x + sprite.current_graphic, slopeGraphic(x, frameBase));
}

// ---- Dixie ----

/** $B9E3D3 — (83) Dixie riding the cart: pick the graphic for this frame. */
export function CODE_B9E3D3() {
  reg.a = C.dixie_ride_cart_slope_frame1;
  CODE_B9E486();
}

/** $B9E3D9 — (84) leave the lean animation when status bit $01C0 is set. */
export function CODE_B9E3D9() {
  dixieLean(0x01c0);
}

/** $B9E3DE — (84) leave the lean animation when status bit $02C0 is set. */
export function CODE_B9E3DE() {
  dixieLean(0x02c0);
}

function dixieLean(mask: number) {
  const x = reg.x;
  if (mask & r16(x + sprite.general_purpose_4A)) return restartCartAnim(x, DIXIE_SKULL_CART, C.dixie_ride_cart_slope_frame1);
  CODE_B9E3E5();
}

/** $B9E3E5 — (84) back to the riding animation once the cart is on a slope again. */
export function CODE_B9E3E5() {
  const x = reg.x;
  if (r16(x + sprite.general_purpose_48) === 0x0009) return;
  restartCartAnim(x, DIXIE_SKULL_CART, C.dixie_ride_cart_slope_frame1);
}

/** $B9E402 — (84) back to the riding animation unless general_purpose_46 is $8005. */
export function CODE_B9E402() {
  const x = reg.x;
  if (r16(x + sprite.general_purpose_46) !== 0x8005) restartCartAnim(x, DIXIE_SKULL_CART, C.dixie_ride_cart_slope_frame1);
}

// ---- Diddy ----

/** $B9E40A — (83) Diddy riding the cart: pick the graphic for this frame. */
export function CODE_B9E40A() {
  reg.a = C.diddy_ride_cart_slope_frame1;
  CODE_B9E486();
}

/** $B9E410 — (84) */
export function CODE_B9E410() {
  diddyLean(0x01c0);
}

/** $B9E415 — (84) */
export function CODE_B9E415() {
  diddyLean(0x02c0);
}

function diddyLean(mask: number) {
  const x = reg.x;
  if (mask & r16(x + sprite.general_purpose_4A)) return restartCartAnim(x, DIDDY_SKULL_CART, C.diddy_ride_cart_slope_frame1);
  CODE_B9E41C();
}

/** $B9E41C — (84) */
export function CODE_B9E41C() {
  const x = reg.x;
  if (r16(x + sprite.general_purpose_48) === 0x0009) return;
  restartCartAnim(x, DIDDY_SKULL_CART, C.diddy_ride_cart_slope_frame1);
}

/** $B9E439 — (84) back to the riding animation when off the ground. */
export function CODE_B9E439() {
  const x = reg.x;
  if (r16(x + sprite.ground_distance)) restartCartAnim(x, DIDDY_SKULL_CART, C.diddy_ride_cart_slope_frame1);
}

// ---- shared waits / conditions ----

/** $B9E43E — (83) hold while general_purpose_46 is $8005 and status bit $0040 is set. */
export function CODE_B9E43E() {
  const x = reg.x;
  if (r16(x + sprite.general_purpose_46) !== 0x8005) return process_anim_script();
  reg.a = 0x0040;
  if (0x0040 & r16(x + sprite.general_purpose_4A)) return CODE_B9D12B();
  process_anim_script();
}

/** $B9E44F — (8F) carry set (and animation reset) when crashing or bit $0200 is clear. */
export function CODE_B9E44F() {
  const x = reg.x;
  const status = r16(x + sprite.general_purpose_4A);
  reg.a = status;
  if (!(status & 0x0008) && status & 0x0200) {
    reg.a = status & 0x0200;
    reg.c = false;
    return;
  }
  w16(x + sprite.animation_routine, 0);
  w16(x + sprite.animation_timer, 0);
  reg.c = true;
}

/** $B9E463 — (83) lean wait, left variant (carry clear going in). */
export function CODE_B9E463() {
  leanWait(false, 0x0080);
}

/** $B9E469 — (83) lean wait, right variant (carry set going in). */
export function CODE_B9E469() {
  leanWait(true, 0x0100);
}

function leanWait(carry: boolean, mask: number) {
  const x = reg.x;
  const status = r16(x + sprite.general_purpose_4A);
  if (mask & status) return CODE_B9D12B();
  if (!(0x0008 & status)) return process_anim_script();
  // ROL A : EOR $0D58 : LSR — compare the variant with bit 0 of $0D58
  const v = ((0x0008 << 1) | (carry ? 1 : 0)) ^ r16(0x0d58);
  if (!(v & 1)) return CODE_B9D12B();
  process_anim_script();
}

/**
 * $B9E486 — (83 tail) A = first slope graphic of the Kong: choose the riding graphic, or let
 * the script continue into one of the special sequences that follow the command
 * (+0 idle, +3 lean, +6 other lean, +9 jump).
 */
export function CODE_B9E486() {
  const x = reg.x;
  w16(x + sprite.animation_routine, 0);
  w16(0x32, reg.a);
  const status = r16(x + sprite.general_purpose_4A);
  reg.a = status;
  if (status & 0x0040) return cartJump(x);
  if (status & 0x0008) {
    // crashing: the side follows bit 0 of $0D58
    return r16(0x0d58) & 1 ? skipTo(3) : skipTo(6);
  }
  if (status & 0x0100) return skipTo(3);
  if (status & 0x0080) return skipTo(6);
  if (status & 0x0200 && x === r16(R.active_kong_sprite)) return process_anim_script();
  cartIdle(x);
}

/** $B9E4A5: idle on the cart; sometimes play the idle sequence (+0). */
function cartIdle(x: number) {
  if (r16(x + sprite.general_purpose_4A) & 0x0010) {
    if (!(r16(R.active_frame_counter) & 0x000f)) {
      CODE_B4C175();
      if ((reg.a & 0x000f) < 0x0005) return process_anim_script();
    }
  }
  showSlope(x);
}

/** $B9E4AC: show the slope graphic and hold the script. */
function showSlope(x: number) {
  w16(x + sprite.current_graphic, slopeGraphic(x, r16(0x32)));
  CODE_B9D12B();
}

/** $B9E4D0: jumping; once the cart has landed play the jump-landing sequence (+9). */
function cartJump(x: number) {
  if (r16(x + sprite.general_purpose_44) !== 0x8005) return showSlope(x);
  if (r16(x + sprite.general_purpose_46) !== 0x8005) return showSlope(x);
  if (r16(x + sprite.ground_distance)) return showSlope(x);
  if (isNeg(r16(x + sprite.y_speed))) return showSlope(x);
  skipTo(9);
}

function skipTo(bytes: number) {
  reg.y = (reg.y + bytes) & 0xffff;
  process_anim_script();
}

register({
  CODE_B9E3D3,
  CODE_B9E3D9,
  CODE_B9E3DE,
  CODE_B9E3E5,
  CODE_B9E402,
  CODE_B9E40A,
  CODE_B9E410,
  CODE_B9E415,
  CODE_B9E41C,
  CODE_B9E439,
  CODE_B9E43E,
  CODE_B9E44F,
  CODE_B9E463,
  CODE_B9E469,
  CODE_B9E486,
});
