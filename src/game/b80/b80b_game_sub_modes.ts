/**
 * Bank $80 — game sub modes of the level types (game_sub_mode_table, first part) and the water
 * helpers of the ship hold levels.
 *
 * A game sub mode is the logic half of a level frame (after the NMI sub mode): input and pause,
 * sprite loader, sprites, camera, layer scrolling, OAM, screen fade, then `game_sub_mode_return`
 * ends the frame. While paused the frame counter is held (paused_game_sub_mode).
 */
import { r16, w16, w8, r8 } from "../../core/mem";
import { reg, register } from "../../core/cpu";
import { frameEnded } from "../../core/hybrid";
import { R, C } from "../../core/sym";
import {
  input_and_pause_handler,
  fade_screen,
  game_sub_mode_return,
  sprite_loader,
  sprite_handler,
  camera_handler,
  horizontal_level_scroll_handler,
  square_level_scroll_handler,
  render_sprites,
  set_unused_oam_offscreen,
  handle_water_and_3D_bg_scroll,
  CODE_BEC9C0,
  handle_ship_deck_rigging_scroll,
  ship_deck_rigging_scroll_handler,
  handle_ship_deck_water_sky_scroll,
  spawn_special_sprite_index,
  interpolate_y_velocity_global,
  CODE_B5B317,
} from "../../gen/routines";
import { queue_sound_effect } from "./b80a_util";

/** Run each step in order; stop as soon as one of them ended the frame. */
function steps(...fns: (() => void)[]): boolean {
  for (const f of fns) {
    f();
    if (frameEnded) return false;
  }
  return true;
}

/** input_and_pause_handler; returns true when the frame goes on unpaused. */
function inputNotPaused(): boolean {
  input_and_pause_handler();
  if (frameEnded) return false;
  if (!reg.z) {
    paused_game_sub_mode();
    return false;
  }
  return true;
}

/** $80D451 — input, fade, end of frame. */
export function simple_game_sub_mode_05() {
  if (!steps(input_and_pause_handler, fade_screen)) return;
  game_sub_mode_return();
}

/** $80D58C — same as simple_game_sub_mode_05. */
export function simple_game_sub_mode_04() {
  if (!steps(input_and_pause_handler, fade_screen)) return;
  game_sub_mode_return();
}

/** $80D45A — nothing this frame. */
export function null_game_sub_mode() {
  game_sub_mode_return();
}

/** $80D45D — paused: undo the frame counter increment and end the frame. */
export function paused_game_sub_mode() {
  w16(R.active_frame_counter, (r16(R.active_frame_counter) - 1) & 0xffff);
  game_sub_mode_return();
}

/** $80D462 — Forest (unused): horizontal level. */
export function forest_unused_game_sub_mode() {
  if (!inputNotPaused()) return;
  if (!steps(sprite_loader, sprite_handler, camera_handler, horizontal_level_scroll_handler, render_sprites, set_unused_oam_offscreen, fade_screen)) return;
  game_sub_mode_return();
}

/** $80D486 — Ship Hold (Lockjaw's Locker, Lava Lagoon): rising/sinking water, splashes. */
export function ship_hold_game_sub_mode() {
  handle_water_and_3D_bg_scroll();
  if (frameEnded) return;
  if (!inputNotPaused()) return;
  if (
    !steps(
      handle_water_velocities,
      sprite_loader,
      sprite_handler,
      camera_handler,
      square_level_scroll_handler,
      render_sprites,
      CODE_BEC9C0,
      set_unused_oam_offscreen,
      handle_kong_water_splash,
      fade_screen,
    )
  )
    return;
  game_sub_mode_return();
}

/** Spawn a water splash at the active Kong and play the splash sound. */
function splash(spawnId: number) {
  w16(R.current_sprite, r16(R.active_kong_sprite));
  reg.x = r16(R.active_kong_sprite);
  reg.y = spawnId;
  spawn_special_sprite_index();
  reg.a = (6 << 8) | C.sound_kong_enter_water;
  queue_sound_effect();
}

/**
 * $80D4B7 — game_state_flags bit 2 = the active Kong is below the water line. Entering or
 * leaving the water spawns a splash (special sprite $18 in, $1A out).
 */
export function handle_kong_water_splash() {
  const kong = r16(R.active_kong_sprite);
  const below = !((r16(kong + 0x0a) - r16(R.water_y_position)) & 0x8000); // CMP / BMI
  const flags = r16(R.game_state_flags);
  if (below) {
    w16(R.game_state_flags, flags | 0x0004);
    if (flags & 0x0004) return;
    splash(C.special_sprite_spawn_id_0018);
  } else {
    w16(R.game_state_flags, flags & ~0x0004);
    if (!(flags & 0x0004)) return;
    splash(C.special_sprite_spawn_id_001A);
  }
}

/**
 * $80D4FA — move the water level towards its target ($0D52) with the velocity interpolated
 * towards water_target_y_velocity; stop when it reaches (or passes) the target.
 * water_current_y_velocity = $8000 means "jump to the target now".
 */
export function handle_water_velocities() {
  if (r16(R.game_state_flags) & 0x0140) return;
  if (!(r16(R.water_target_y_velocity) | r16(R.water_current_y_velocity))) return;
  if (r16(R.water_current_y_velocity) !== 0x8000) {
    // the dummy sprite at $0D26 holds the water's velocity in its y speed fields
    w16(R.current_sprite, R.dummy_level_sprite_table);
    reg.a = 0x0007;
    interpolate_y_velocity_global();
    // 24-bit add of the sign-extended velocity to the water position ($0D4D-$0D4F)
    const v = r16(R.water_current_y_velocity);
    const sum = r16(0x0d4d) + v;
    w16(0x0d4d, sum & 0xffff);
    w8(0x0d4f, (r8(0x0d4f) + (v & 0x8000 ? 0xff : 0) + (sum > 0xffff ? 1 : 0)) & 0xff);
    const d = (r16(0x0d52) - r16(R.water_y_position)) & 0xffff;
    // not there yet while the distance still has the direction of the velocity
    if (d !== 0 && !((d ^ r16(R.water_current_y_velocity)) & 0x8000)) return;
  }
  // .CODE_80D547: arrived
  w16(R.water_y_position, r16(0x0d52));
  w16(R.water_target_y_velocity, 0);
  w16(R.water_current_y_velocity, 0);
  w16(0x0d4c, 0);
}

/** $80D557 — Wasp Hive: square or vertical scrolling depending on the camera mode. */
export function wasp_hive_game_sub_mode() {
  if (!inputNotPaused()) return;
  if (!steps(sprite_loader, sprite_handler, camera_handler)) return;
  if ((r16(0x0ab4) & 0x000f) === 0x0005) CODE_B5B317();
  else square_level_scroll_handler();
  if (frameEnded) return;
  if (!steps(render_sprites, set_unused_oam_offscreen, fade_screen)) return;
  game_sub_mode_return();
}

/** $80D595 — Ship Deck (Pirate Panic, Gangplank Galley): rigging layer and water/sky scroll. */
export function ship_deck_game_sub_mode() {
  if (!inputNotPaused()) return;
  if (
    !steps(
      sprite_loader,
      sprite_handler,
      camera_handler,
      handle_ship_deck_rigging_scroll,
      ship_deck_rigging_scroll_handler,
      horizontal_level_scroll_handler,
      render_sprites,
      set_unused_oam_offscreen,
      handle_ship_deck_water_sky_scroll,
      fade_screen,
    )
  )
    return;
  game_sub_mode_return();
}

/** $80D5C3 — Lava: horizontal level. */
export function lava_game_sub_mode() {
  if (!inputNotPaused()) return;
  if (!steps(sprite_loader, sprite_handler, camera_handler, horizontal_level_scroll_handler, render_sprites, set_unused_oam_offscreen, fade_screen)) return;
  game_sub_mode_return();
}

register({
  simple_game_sub_mode_05,
  simple_game_sub_mode_04,
  null_game_sub_mode,
  paused_game_sub_mode,
  forest_unused_game_sub_mode,
  ship_hold_game_sub_mode,
  handle_kong_water_splash,
  handle_water_velocities,
  wasp_hive_game_sub_mode,
  ship_deck_game_sub_mode,
  lava_game_sub_mode,
});
