/**
 * Bank $B3 — sprite framework pieces around `sprite_handler`: the per-frame looping sounds,
 * the follower Kong's waypoint recording, the platform sprite pass, and a handful of trivial
 * sprite mains (debug dummies, animation-only effects, the invincibility controller, ...).
 */
import { r8, w8, r16, w16 } from "../../core/mem";
import { reg, register } from "../../core/cpu";
import { R, sprite, kong_control, level, C } from "../../core/sym";
import {
  CODE_BBBB99,
  CODE_BBBB44,
  CODE_BBBC8D,
  CODE_BBBCA3,
  CODE_BB8C2C,
  process_sprite_animation,
  delete_sprite_no_deallocation,
  delete_sprite_handle_deallocation,
  play_queued_sound_effect,
} from "../../gen/routines";
import { registerRts, registerRtl, registerSprite, mi, mergeBits, jslAddr } from "./b3a_common";

/** $B38000 — despawn the current sprite if it is too far offscreen, then leave the sprite. */
export function sprite_return_handle_despawn() {
  CODE_BBBB99();
}

// ---------------------------------------------------------------------------------------------
// Looping sounds. Each frame the sprites that make a continuous noise (Zingers, Flitters, the
// invincibility jingle, wind, rolling barrels, Flotsam) bump an "enabler" byte; this routine
// keeps the matching looping sound effect playing, or stops it once nobody asks for it.
// Only the first looping sound that changes state is handled per frame.
// ---------------------------------------------------------------------------------------------

/** $B380EC */
export function process_looping_sounds_global() {
  process_looping_sounds();
}

/** `%sound(channel, id)` */
const snd = (channel: number, name: string) => ((channel << 8) | (C as Record<string, number>)["sound_" + name]) & 0xffff;

/** $B380F0 */
export function process_looping_sounds() {
  const loops: [number, number][] = [
    [R.invincible_loop_sound_enabler, snd(4, "invincibility")],
    [R.zinger_loop_sound_enabler, snd(7, "zinger_drone")],
    [R.flitter_loop_sound_enabler, snd(7, "flitter_drone")],
    [R.barrel_roll_loop_sound_enabler, snd(4, "barrel_roll")],
  ];
  let done = false;
  for (const [enabler, sound] of loops) {
    // LDA enabler-1 : CMP #$0100 -> carry = enabler byte is nonzero
    reg.c = r8(enabler) !== 0;
    reg.a = sound;
    tryToQueueLoopingSound();
    if (reg.c) {
      done = true;
      break;
    }
  }
  if (!done) {
    if (r16(level.effects) & C.wind_sound_effect) {
      reg.c = r8(R.wind_loop_sound_enabler) !== 0;
      reg.a = snd(7, "wind");
    } else {
      // water levels use the slot for Flotsam's swimming sound
      reg.c = r8(R.flotsam_loop_sound_enabler) !== 0;
      reg.a = snd(6, "flotsam_move");
    }
    tryToQueueLoopingSound();
  }
  play_queued_sound_effect();
}

/**
 * $B38158 process_looping_sounds.try_to_queue_looping_sound
 * In: A = channel<<8 | sound id, carry = the loop is wanted this frame.
 * - wanted and not yet in the channel's buffer: queue it (looping, bit 15) and remember it;
 * - not wanted but still in the buffer: queue sound 0 on that channel to stop it;
 * - otherwise nothing changes.
 * Out: carry set when a command was queued (or the SPC queue was full), A = 0/1/slot value.
 */
function tryToQueueLoopingSound() {
  const wanted = reg.c;
  const channel = (reg.a >> 8) & 0xff;
  const id = reg.a & 0xff;
  reg.x = channel;
  const inBuffer = id === r8(R.sound_effect_buffer + channel);
  let command: number;
  if (!inBuffer) {
    if (!wanted) return noSoundQueued();
    command = reg.a & 0xffff;
  } else {
    if (wanted) return noSoundQueued();
    command = reg.a & 0xff00; // the EOR left 0 in the low byte: sound 0 stops the loop
  }
  reg.y = command;
  const slot = (r16(R.next_sound_effect_slot) + 2) & 0x000e;
  reg.x = slot;
  const pending = r16(R.spc_command_buffer + slot);
  if (pending) {
    // SPC command queue full
    reg.a = pending;
    reg.c = true;
    return;
  }
  const queued = command | 0x8000;
  w16(R.spc_command_buffer + slot, queued);
  w16(R.next_sound_effect_slot, slot);
  const ch = (queued >> 8) & 0x0f;
  reg.x = ch;
  w8(R.sound_effect_buffer + ch, queued & 0xff);
  reg.a = 0;
  reg.c = true;

  function noSoundQueued() {
    reg.a = 1;
    reg.c = wanted;
  }
}

/** $B3814F — the looping-sound helper for other banks (A = sound, carry = wanted). */
export function queue_or_reset_looping_sound_effect() {
  const y = reg.y;
  tryToQueueLoopingSound();
  reg.y = y;
  reg.a &= 0xffff;
  reg.z = reg.a === 0;
  reg.n = (reg.a & 0x8000) !== 0;
}

// ---------------------------------------------------------------------------------------------
// Trivial sprite mains
// ---------------------------------------------------------------------------------------------

/**
 * $B3819B — also null_sprite_main and crocodile_isle_props_main. With the debug freeze flags
 * the sprite just stays; normally it deletes itself (and is marked defeated if level-spawned).
 */
export function hidden_debug_dummy_sprite_main() {
  if (r16(R.debug_flags) & 0x0060) CODE_BBBB99();
  else CODE_BBBB44();
}

/** $B381B1 */
export function debug_dummy_sprite_main() {
  if (r16(R.debug_flags) & 0x0060) {
    CODE_B381CE();
    CODE_BBBB99();
  } else CODE_BBBB44();
}

/** $B381CA */
export function CODE_B381CA() {
  CODE_B381CE();
}

/**
 * $B381CE — an empty routine. The debug code after its RTS (flashing a selected sprite) is
 * unreachable.
 */
export function CODE_B381CE() {}

/** $B381EB — also contact_flash_main: just animate. */
export function map_player_main() {
  process_sprite_animation();
}

/** $B381F2 */
export function debug_spawn_group_manager_main() {
  if (r16(R.debug_flags) & 0x0060) return spawn_group_manager_main();
  CODE_BBBC8D();
}

/** $B38201 */
export function spawn_group_manager_main() {
  CODE_BBBCA3();
}

/** $B38208 — also dixie_hurt_tears_main: just animate. */
export function water_surface_splash_main() {
  process_sprite_animation();
}

/**
 * $B3820F — runs while a Kong is invincible: keeps the invincibility jingle looping and,
 * near the end of the invincibility, toggles bit 7 of $091B (palette flashing) every two frames.
 */
export function invincibility_controller_main() {
  w16(R.invincibility_sprite, r16(R.current_sprite));
  w16(R.invincible_loop_sound_enabler, r16(R.invincible_loop_sound_enabler) + 1);
  const y = r16(R.active_kong_control_variables);
  reg.y = y;
  const timer = r16(y + kong_control.invincible_timer);
  if (mi(timer, 0x0010)) {
    w16(0x091b, r16(0x091b) & 0xff7f);
    CODE_BB8C2C();
    delete_sprite_no_deallocation();
    w16(R.invincibility_sprite, 0);
    return;
  }
  const frame = r16(R.active_frame_counter);
  if (frame & 0x0001) return;
  if (frame & 0x0002) w16(0x091b, r16(0x091b) | 0x0080);
  else w16(0x091b, r16(0x091b) & 0xff7f);
  CODE_BB8C2C();
}

/** $B38268 — the stars around a hurt Diddy: animate, delete when $42 counts down to 0. */
export function diddy_hurt_stars_main() {
  process_sprite_animation();
  const x = r16(R.current_sprite);
  const t = r16(x + 0x42);
  if (!t) return;
  w16(x + 0x42, t - 1);
  if (t - 1 === 0) delete_sprite_handle_deallocation();
}

// ---------------------------------------------------------------------------------------------
// Follower Kong
// ---------------------------------------------------------------------------------------------

/**
 * $B38280 — record the active Kong's movement into the 32-entry ring buffer the follower Kong
 * replays. A new waypoint is only written when the leader moved (or is touching a platform
 * sprite / something asked for it with game_state_flags bit 3).
 */
export function handle_kong_follow() {
  if (!(r16(R.game_state_flags) & 0x0001)) {
    const y = r16(R.active_kong_control_variables);
    w16(R.current_kong_control_variables, y);
    w16(R.kong_follow_last_rec_animation, r16(y + kong_control.animation_id));
    const x = r16(R.active_kong_sprite);
    w16(R.current_sprite, x);
    w16(R.kong_follow_last_rec_x_speed, r16(x + sprite.x_speed));
    w16(R.kong_follow_last_rec_max_x_speed, r16(x + sprite.max_x_speed));
    w16(R.kong_follow_last_rec_ground_dist, r16(x + sprite.ground_distance));
    const moved =
      r16(R.kong_follow_last_rec_x_position) !== r16(x + sprite.x_position) ||
      r16(R.kong_follow_last_rec_y_position) !== r16(x + sprite.y_position) ||
      (r16(x + sprite.terrain_interaction) & 0x1010) !== 0 ||
      (r16(R.game_state_flags) & 0x0008) !== 0;
    if (moved) updateFollowerWaypoint(x);
  }
  // .follow_waypoint_update_done
  reg.a = 0x0009;
  w16(R.game_state_flags, r16(R.game_state_flags) & ~0x0009);
}

/** $B382CD handle_kong_follow.update_follower_waypoint */
function updateFollowerWaypoint(kong: number) {
  let i = r16(R.kong_follow_buffer_recording_index);
  const xPos = r16(kong + sprite.x_position);
  w16(R.kong_follow_last_rec_x_position, xPos);
  w16(R.kong_follow_x_position_buffer + i, xPos);
  const yPos = r16(kong + sprite.y_position);
  w16(R.kong_follow_last_rec_y_position, yPos);
  w16(R.kong_follow_y_position_buffer + i, yPos);
  w16(R.kong_follow_facing_buffer + i, r16(kong + sprite.oam_property) & 0x4000);
  w16(R.temp_32, (r16(kong + sprite.terrain_interaction) << 8) & 0xff00);
  const ctl = r16(R.current_kong_control_variables);
  reg.y = ctl;
  w16(R.kong_follow_animation_buffer + i, r16(ctl + kong_control.animation_id));
  i = (i + 2) & 0x003f;
  reg.x = i;
  w16(R.kong_follow_buffer_recording_index, i);
  if (i === r16(R.kong_follow_buffer_playback_index)) {
    // the recorder caught up with the playback: drop the oldest waypoint
    w16(R.kong_follow_buffer_playback_index, (r16(R.kong_follow_buffer_playback_index) + 2) & 0x003f);
  }
}

// ---------------------------------------------------------------------------------------------
// Platform sprites
// ---------------------------------------------------------------------------------------------

/**
 * $B38324 — run the logic of the last registered platform sprite (entered with A = slot end),
 * then go on with the remaining ones. Sprites register a 24-bit logic pointer in
 * `platform_sprite_table` (5 bytes per entry) during their main; the logic RTLs back here
 * (the original pushed process_platform_sprites as its return address).
 */
export function process_platform_sprite() {
  runPlatformLogic();
  process_platform_sprites();
}

/** $B38342 — process every platform sprite registered this frame, last first. */
export function process_platform_sprites() {
  for (;;) {
    const slot = r16(R.next_platform_sprite_slot);
    reg.a = slot;
    if (!slot) return;
    runPlatformLogic();
  }
}

/** The body of process_platform_sprite: pop one entry and call its logic (it RTLs back). */
function runPlatformLogic() {
  const slot = (reg.a - 5) & 0xffff;
  w16(R.next_platform_sprite_slot, slot);
  reg.y = slot;
  const ptr = r16(R.platform_sprite_table + slot);
  w16(R.temp_32, ptr);
  const bankWord = r16(R.platform_sprite_table + 2 + slot);
  w16(R.temp_34, bankWord);
  const x = r16(R.platform_sprite_table + 3 + slot);
  reg.x = x;
  w16(R.current_sprite, x);
  reg.a = bankWord;
  jslAddr(((bankWord & 0xff) << 16) | ptr);
}

// ---------------------------------------------------------------------------------------------

/** $B388CE */
export function unknown_sprite_00EC_main() {}

/**
 * $B388D1 — a foreground occluder: the Kongs (and the ridden animal) get OAM priority 3 while
 * above its y position and 2 below it, so they pass behind foreground scenery.
 */
export function sprite_fg_occluder_main() {
  const x = r16(R.current_sprite);
  setPriorityAgainstOccluder(x, r16(R.active_kong_sprite));
  setPriorityAgainstOccluder(x, r16(R.inactive_kong_sprite));
  const mount = r16(R.current_player_mount);
  if (mount) setPriorityAgainstOccluder(x, mount);
  sprite_return_handle_despawn();
}

/** $B388EA sprite_fg_occluder_main.CODE_B388EA */
function setPriorityAgainstOccluder(x: number, y: number) {
  reg.y = y;
  const prio = mi(r16(x + sprite.y_position), r16(y + sprite.y_position)) ? 0x2000 : 0x3000;
  w16(y + sprite.oam_property, mergeBits(r16(y + sprite.oam_property), prio, 0x3000));
}

/** $B38A2C — the prop a Kong holds while celebrating: deleted once it is no longer held. */
export function kong_celebrate_prop_main() {
  if (!r16(R.current_held_sprite)) delete_sprite_handle_deallocation();
}

registerSprite({
  hidden_debug_dummy_sprite_main,
  debug_dummy_sprite_main,
  map_player_main,
  debug_spawn_group_manager_main,
  spawn_group_manager_main,
  water_surface_splash_main,
  invincibility_controller_main,
  diddy_hurt_stars_main,
  unknown_sprite_00EC_main,
  sprite_fg_occluder_main,
  kong_celebrate_prop_main,
});
registerSprite({ sprite_return_handle_despawn });
registerRtl({ process_looping_sounds_global, queue_or_reset_looping_sound_effect, CODE_B381CA });
registerRts({ process_looping_sounds, handle_kong_follow, process_platform_sprite, process_platform_sprites, CODE_B381CE });
