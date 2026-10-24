/**
 * Bank $B9 — animation script conditions.
 *
 * Two kinds of small callbacks used by the animation scripts of the Kongs and enemies:
 *   - command 83 "wait" callbacks ($B9D4EF-$B9D5F0): run with DB = $F9 every frame while the
 *     script sits on the command; they either let the script continue (`process_anim_script`)
 *     or hold it for this frame (`CODE_B9D12B`),
 *   - command 8F conditions ($B9D5F3-$B9D704): return carry set to take the script jump.
 */
import { r16 } from "../../core/mem";
import { reg, register } from "../../core/cpu";
import { R, sprite, level, kong_control, C } from "../../core/sym";
import { process_anim_script, CODE_B9D12B } from "./b9_anim_core";
import { abs16, cmpN, isNeg, dbRead16 } from "./b9_anim_util";

/** Continue the script (true) or hold it this frame (false). */
function continueIf(go: boolean) {
  if (go) process_anim_script();
  else CODE_B9D12B();
}

// ---- command 83 wait callbacks (X = current sprite, Y = next entry) ----

/** $B9D4EF — hold while in a boss level. */
export function CODE_B9D4EF() {
  continueIf(r16(level.type) !== C.boss_level_type);
}

/** $B9D4FE — wait until both low bits of general_purpose_4E are set. */
export function CODE_B9D4FE() {
  continueIf((r16(reg.x + sprite.general_purpose_4E) & 3) === 3);
}

/** $B9D50E — (unreferenced) wait until the active Kong stops rising. */
export function CODE_B9D50E() {
  const rising = isNeg(r16(r16(R.active_kong_sprite) + sprite.y_speed));
  reg.x = r16(R.current_sprite);
  continueIf(!rising);
}

/** $B9D521 — hold while the sprite is in Kong state 2C. */
export function CODE_B9D521() {
  continueIf(r16(reg.x + sprite.state) !== C.kong_state_2C);
}

/** $B9D52E — (unreferenced) wait until the active Kong is rising. */
export function CODE_B9D52E() {
  const rising = isNeg(r16(r16(R.active_kong_sprite) + sprite.y_speed));
  reg.x = r16(R.current_sprite);
  continueIf(rising);
}

/** $B9D541 — wait until touching ground/wall, or until the sprite is 240px below the screen top. */
export function CODE_B9D541() {
  const x = reg.x;
  if (r16(x + sprite.terrain_interaction) & 0x0101) return process_anim_script();
  const screenY = (r16(x + sprite.y_position) - r16(R.screen_scroll_y_position)) & 0xffff;
  continueIf(!cmpN(screenY, 0x00f0));
}

/** $B9D55A — wait until the sprite is rising... (holds while y_speed is negative). */
export function CODE_B9D55A() {
  continueIf(!isNeg(r16(reg.x + sprite.y_speed)));
}

/** $B9D564 — (unreferenced) holds while y_speed is positive or zero. */
export function CODE_B9D564() {
  continueIf(isNeg(r16(reg.x + sprite.y_speed)));
}

/** Shared by $B9D56E/$B9D589: continue when grounded-ish, else hold if far above the ground. */
function waitNearGround(limit: number) {
  const x = reg.x;
  if (r16(x + sprite.terrain_interaction) & 0x1000) return process_anim_script();
  const ground = r16(x + sprite.ground_y_position);
  if (isNeg(ground)) return CODE_B9D12B();
  const dist = (ground - r16(x + sprite.y_position)) & 0xffff;
  if (isNeg(dist)) return process_anim_script();
  continueIf(cmpN(dist, limit));
}

/** $B9D56E — wait until less than $48 pixels above the ground. */
export function CODE_B9D56E() {
  waitNearGround(0x0048);
}

/** $B9D589 — wait until less than $10 pixels above the ground. */
export function CODE_B9D589() {
  waitNearGround(0x0010);
}

/** $B9D5A4 — wait until the sprite stands on the ground. */
export function stall_animation_until_grounded() {
  continueIf((r16(reg.x + sprite.terrain_interaction) & 0x0001) !== 0);
}

/** $B9D5B1 — wait until grounded on terrain whose type differs from $88. */
export function CODE_B9D5B1() {
  const x = reg.x;
  if (!(r16(x + sprite.terrain_interaction) & 0x0001)) return CODE_B9D12B();
  continueIf((r16(x + sprite.terrain_attributes) & 7) !== r16(0x0088));
}

/** $B9D5C9 — (unreferenced) wait until the sprite has stopped. */
export function CODE_B9D5C9() {
  continueIf(r16(reg.x + sprite.x_speed) === 0);
}

/** $B9D5D3 — wait until the active Kong moves at $180 or faster towards a target speed. */
export function CODE_B9D5D3() {
  const kong = r16(R.active_kong_sprite);
  let go = false;
  if (r16(kong + sprite.max_x_speed)) go = !cmpN(abs16(r16(kong + sprite.x_speed)), 0x0180);
  reg.x = r16(R.current_sprite);
  continueIf(go);
}

// ---- command 8F conditions: carry set = take the jump ----

/** $B9D5F3 — carry set if NOT in a boss level (despite the name). */
export function check_if_boss_level() {
  reg.c = r16(level.type) !== C.boss_level_type;
}

/** $B9D600 — carry set in normal levels, clear in sub-levels and bonus levels. */
export function check_if_not_bonus_or_sub_level() {
  const type = r16(level.type);
  if (type === C.small_level_type) reg.c = false;
  else if (type !== C.bonus_level_type) reg.c = true;
  else reg.c = r16(level.bonus_type) === 0;
}

/** $B9D618 — carry set when no web platform is being shot ($0B02 bit 6 clear). */
export function check_if_no_web_platforms_are_shooting() {
  reg.c = !(r16(0x0b02) & 0x0040);
}

/** $B9D625 — carry set when the player isn't riding an animal. */
export function check_if_player_not_mounted() {
  reg.c = r16(R.current_player_mount) === 0;
}

/** $B9D62F — carry set when the active Kong is Diddy. */
export function check_if_current_kong_is_diddy() {
  reg.c = r16(R.active_kong_number) === 0;
}

/** $B9D639 — carry set when the active Kong has no target x speed. */
export function check_if_active_kong_has_no_max_x_speed() {
  const kong = r16(R.active_kong_sprite);
  reg.x = kong;
  reg.c = r16(kong + sprite.max_x_speed) === 0;
}

/** $B9D658 — carry set when Y has been held for at least $15 frames. */
export function CODE_B9D658() {
  const control = r16(R.current_kong_control_variables);
  let held = false;
  if (dbRead16(control + kong_control.input_held) & 0x4000) {
    const since = (r16(R.active_frame_counter) - dbRead16(control + kong_control.y_press_time)) & 0xffff;
    held = !cmpN(since, 0x0015);
  }
  reg.c = held;
}

/** $B9D674 — carry set when on the ground or touching a wall/ceiling (rolling animations). */
export function CODE_B9D674() {
  reg.c = (r16(reg.x + sprite.terrain_interaction) & 0x1001) !== 0;
}

/** $B9D67F — carry set when the wind sprite ($19C4) has no vertical wind. */
export function check_for_vertical_wind_stop() {
  const wind = r16(0x19c4);
  reg.x = wind;
  reg.c = r16(wind + sprite.general_purpose_46) === 0;
}

/** $B9D68C — (unused) carry clear when far above the ground. */
export function CODE_B9D68C() {
  const x = reg.x;
  if (r16(x + sprite.terrain_interaction) & 0x1000) {
    reg.c = true;
    return;
  }
  const ground = r16(x + sprite.ground_y_position);
  if (isNeg(ground)) {
    reg.c = false;
    return;
  }
  const dist = (ground - r16(x + sprite.y_position)) & 0xffff;
  reg.c = isNeg(dist) || cmpN(dist, 0x0048);
}

/** $B9D6A5 — carry set when airborne (Dixie rolling animation). */
export function CODE_B9D6A5() {
  reg.c = (r16(reg.x + sprite.terrain_interaction) & 0x1001) === 0;
}

/** $B9D6B0 — carry set when the sprite is moving down (or not moving vertically). */
export function check_if_moving_down() {
  const x = r16(R.current_sprite);
  reg.x = x;
  reg.c = !isNeg(r16(x + sprite.y_speed));
}

/** $B9D6BA — carry set when the sprite has a target speed or moves at least $40. */
export function CODE_B9D6BA() {
  const x = r16(R.current_sprite);
  reg.x = x;
  if (r16(x + sprite.max_x_speed)) {
    reg.c = true;
    return;
  }
  reg.c = (abs16(r16(x + sprite.x_speed)) & 0xffc0) !== 0;
}

/** $B9D6D1 — carry set when bit 0 of kong_control.unknown_0C is clear. */
export function CODE_B9D6D1() {
  const control = r16(R.current_kong_control_variables);
  reg.y = control;
  reg.c = !(dbRead16(control + kong_control.unknown_0C) & 0x0001);
}

/** $B9D6DF — carry set when moving faster than $200. */
export function CODE_B9D6DF() {
  const x = r16(R.current_sprite);
  reg.x = x;
  reg.c = !cmpN(abs16(r16(x + sprite.x_speed)), 0x0201);
}

/** $B9D6F2 — carry set when moving at $C0 or faster. */
export function CODE_B9D6F2() {
  const x = r16(R.current_sprite);
  reg.x = x;
  reg.c = !cmpN(abs16(r16(x + sprite.x_speed)), 0x00c0);
}

register({
  CODE_B9D4EF,
  CODE_B9D4FE,
  CODE_B9D50E,
  CODE_B9D521,
  CODE_B9D52E,
  CODE_B9D541,
  CODE_B9D55A,
  CODE_B9D564,
  CODE_B9D56E,
  CODE_B9D589,
  stall_animation_until_grounded,
  CODE_B9D5B1,
  CODE_B9D5C9,
  CODE_B9D5D3,
  check_if_boss_level,
  check_if_not_bonus_or_sub_level,
  check_if_no_web_platforms_are_shooting,
  check_if_player_not_mounted,
  check_if_current_kong_is_diddy,
  check_if_active_kong_has_no_max_x_speed,
  CODE_B9D658,
  CODE_B9D674,
  check_for_vertical_wind_stop,
  CODE_B9D68C,
  CODE_B9D6A5,
  check_if_moving_down,
  CODE_B9D6BA,
  CODE_B9D6D1,
  CODE_B9D6DF,
  CODE_B9D6F2,
});
