/**
 * Bank $80 — main engine: reset/NMI, game modes, level sub-modes, scrolling effects, fades.
 * Ported from the DKC2 disassembly (bank_80.asm). Each routine keeps its original label.
 */
import { r8, w8, r16, w16 } from "../../core/mem";
import { reg, register } from "../../core/cpu";
import { R } from "../../core/sym";

/** $808C32 — A = brightness. Stop any fade and set the brightness directly. */
export function set_fade() {
  w16(R.screen_fade_speed, 0);
  w16(R.screen_brightness, reg.a);
}

/** $808C3D — advance the screen fade one step (called every frame by most game modes). */
export function fade_screen() {
  const speed = r8(R.screen_fade_speed);
  if (speed === 0) return;
  if (speed & 0x80) {
    // fading out
    const timer = (r8(R.screen_fade_timer) + 1) & 0xff;
    w8(R.screen_fade_timer, timer);
    if ((speed & 0x7f) !== timer) return;
    w8(R.screen_fade_timer, 0);
    const b = (r8(R.screen_brightness) - 1) & 0xff;
    w8(R.screen_brightness, b);
    if (b & 0x80 || b === 0) {
      w8(R.screen_fade_speed, 0);
      w8(R.screen_brightness, 0);
    }
    return;
  }
  // fading in
  const timer = (r8(R.screen_fade_timer) + 1) & 0xff;
  w8(R.screen_fade_timer, timer);
  if (speed !== timer) return;
  w8(R.screen_fade_timer, 0);
  const b = (r8(R.screen_brightness) + 1) & 0xff;
  w8(R.screen_brightness, b);
  if (b > 0x0f) {
    w8(R.screen_brightness, 0x0f);
    w8(R.screen_fade_speed, 0);
  }
}

register({ set_fade, fade_screen });
