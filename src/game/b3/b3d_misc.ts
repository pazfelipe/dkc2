/**
 * Bank $B3 — small engine helpers used by boss code ($B3E3AF-$B3E4D8): the "vacuum" slip
 * velocity applied to the kong (K. Rool) and the $0919/$091B effect toggles (bank $B6).
 */
import { r16, w16, or16, and16 } from "../../core/mem";
import { reg } from "../../core/cpu";
import { R, C, sprite as S } from "../../core/sym";
import { CODE_BB8C19, set_player_interaction_global } from "../../gen/routines";
import { cur, sr, sw, mi, neg, merge, registerRts, registerRtl } from "./b3d_common";

/** $B3E3AF — JSL entry of CODE_B3E3B3 (also sprite main $0C of bank $B3). */
export function CODE_B3E3AF() {
  CODE_B3E3B3();
}
/**
 * $B3E3B3 — A = slip speed: push the active kong away from (or towards) the current sprite
 * via its slip velocity ($2C), adding a little upward pull when non-zero.
 */
export function CODE_B3E3B3() {
  const x = r16(R.active_kong_sprite);
  reg.x = x;
  w16(R.temp_32, reg.a);
  const f = sr(x, S.interaction_flags);
  if (f === 0 || f & 0x0080) return CODE_B3E3E2();
  if (r16(R.temp_32) !== 0) sw(x, S.y_speed, sr(x, S.y_speed) + 0x34);
  CODE_B3E3CD();
}
/** $B3E3CD */
export function CODE_B3E3CD() {
  const y = cur();
  reg.y = y;
  if (mi(sr(y, S.x_position), sr(reg.x, S.x_position))) w16(R.temp_32, neg(r16(R.temp_32)));
  CODE_B3E3DE();
}
/** $B3E3DE */
export function CODE_B3E3DE() {
  reg.a = r16(R.temp_32);
  sw(reg.x, S.unknown_2C, reg.a); // slip velocity
  CODE_B3E3E2();
}
/** $B3E3E2 */
export function CODE_B3E3E2() {}

/** $B3E3E3 — JSL entry of CODE_B3E3E7. */
export function CODE_B3E3E3() {
  CODE_B3E3E7();
}
/** $B3E3E7 — apply changes of the requested effect bits ($0919) to the active ones ($091B). */
export function CODE_B3E3E7() {
  CODE_B3E489();
  const changed = r16(0x0919) ^ r16(0x091b);
  if (changed & 1) return CODE_B3E3F7();
  if (changed & 2) return CODE_B3E43E();
}
/** $B3E3F7 — effect bit 0 (RAM_0B02 bit 4). */
export function CODE_B3E3F7() {
  const v = merge(r16(0x091b), r16(0x0919), 0x0001);
  w16(0x091b, v);
  if (v & 1) return CODE_B3E413();
  and16(R.RAM_0B02, ~0x0010);
  CODE_B3E4C1();
}
/** $B3E413 */
export function CODE_B3E413() {
  or16(R.RAM_0B02, 0x0010);
  w16(0x091b, (r16(0x091b) & 0xfcff) | 0x0300);
  CODE_BB8C19();
  reg.a = C.player_interaction_25;
  set_player_interaction_global();
  if (reg.c) return CODE_B3E43D();
  reg.x = r16(R.active_kong_sprite);
  reg.a = sr(reg.x, S.oam_property) & 0x4000;
  w16(R.interaction_RAM_0A86, reg.a);
  CODE_B3E43D();
}
/** $B3E43D */
export function CODE_B3E43D() {}
/** $B3E43E — effect bit 1 (RAM_0B02 bit 5). */
export function CODE_B3E43E() {
  const v = merge(r16(0x091b), r16(0x0919), 0x0002);
  w16(0x091b, v);
  if (v & 2) return CODE_B3E45B();
  and16(R.RAM_0B02, ~0x0020);
  CODE_B3E4C1();
}
/** $B3E45B */
export function CODE_B3E45B() {
  or16(R.RAM_0B02, 0x0020);
  w16(0x0927, 0);
  w16(0x091b, (r16(0x091b) & 0xfcff) | 0x0200);
  CODE_BB8C19();
  reg.a = C.player_interaction_25;
  set_player_interaction_global();
  if (reg.c) return CODE_B3E488();
  reg.x = r16(R.active_kong_sprite);
  reg.a = sr(reg.x, S.oam_property) & 0x4000;
  w16(R.interaction_RAM_0A86, reg.a);
  CODE_B3E488();
}
/** $B3E488 */
export function CODE_B3E488() {}
/** $B3E489 — count down the fade timer in the top nibble of $091B (every 4 frames). */
export function CODE_B3E489() {
  if (!(r16(0x091b) & 0xf000)) return;
  CODE_B3E492();
}
/** $B3E492 */
export function CODE_B3E492() {
  if (r16(R.active_frame_counter) & 3) return;
  CODE_B3E49A();
}
/** $B3E49A */
export function CODE_B3E49A() {
  const old = r16(0x091b);
  const v = (old - 0x1000) & 0xffff;
  w16(0x091b, v);
  if (old < 0x1000) return CODE_B3E4B9();
  w16(0x091b, ((v >> 2) & 0x0300) ^ v);
  CODE_BB8C19();
}
/** $B3E4B9 */
export function CODE_B3E4B9() {
  w16(0x091b, 0);
  CODE_BB8C19();
}
/** $B3E4C1 — start the fade timer, keeping the previous level bits (bits 8-9 -> 10-11). */
export function CODE_B3E4C1() {
  const v = r16(0x091b);
  reg.a = ((merge(v, v << 2, 0x0c00) & 0x0fff) | 0xf000) & 0xffff;
  w16(0x091b, reg.a);
}

registerRtl({ CODE_B3E3AF, CODE_B3E3E3 });
registerRts({
  CODE_B3E3B3, CODE_B3E3CD, CODE_B3E3DE, CODE_B3E3E2, CODE_B3E3E7, CODE_B3E3F7, CODE_B3E413,
  CODE_B3E43D, CODE_B3E43E, CODE_B3E45B, CODE_B3E488, CODE_B3E489, CODE_B3E492, CODE_B3E49A,
  CODE_B3E4B9, CODE_B3E4C1,
});
