/**
 * Bank $B3 — the animal buddies as free sprites (Rambi, Enguarde, Rattly, Squawks; Squitter
 * shares Rambi's code) and their helpers: mounting, the no-animal sign, the animal HUD icon.
 *
 * While a Kong rides an animal, the animal sprite only follows the Kong ("riding" states snap it
 * to the Kong's position plus the riding offset at $0D76/$0D78); the Kong sprite does the work.
 * Animal sprite variables: $42 = dismount timer (can't be remounted while nonzero),
 * $44 = flee speed, $4A = Enguarde's offscreen despawn timer.
 */
import { r16, w16, rom16 } from "../../core/mem";
import { reg } from "../../core/cpu";
import { L, R, C, sprite, sprite_table, level } from "../../core/sym";
import {
  apply_position_from_velocity_global,
  interpolate_x_velocity_global,
  process_terrain_interaction_global,
  process_sprite_animation,
  delete_sprite_handle_deallocation,
  spawn_special_sprite_index,
  spawn_special_sprite_address,
  set_anim_handle_animal,
  get_current_sprite_clipping,
  get_sprite_special_clipping_slot_1,
  check_active_kong_collision,
  set_player_interaction_global,
  check_if_sprite_offscreen_global,
  check_sprite_underwater_global,
  CODE_BBBB99,
} from "../../gen/routines";
import { registerRts, registerRtl, registerSprite, spriteConst, useOwnConstants, facingLeft, mergeBits, mi, pl, neg, SPRITE_SIZE } from "./b3a_common";
import { sprite_return_handle_despawn } from "./b3a_framework";

const KONG_STATE_FLAGS_TABLE = L("kong_state_flags_table");
const DATA_FF0D00 = L("DATA_FF0D00");

const cur = () => r16(R.current_sprite);

/** Common entry of the animal mains: use own constants, Y = X = sprite, return the state. */
function animalEntry(): number {
  const x = cur();
  useOwnConstants(x);
  reg.y = x;
  return r16(x + sprite.state); // the whole word indexes the state table
}

/** turn_if_touching_wall of the flee states: reverse direction (and the flee speed) at walls. */
function turnIfTouchingWall(fleeSpeed: (x: number) => number) {
  const x = cur();
  reg.x = x;
  if (!(r16(x + sprite.terrain_interaction) & 0x0002)) return false;
  w16(x + sprite.oam_property, r16(x + sprite.oam_property) ^ 0x4000);
  let speed = fleeSpeed(x);
  if (facingLeft(x)) speed = neg(speed);
  w16(x + sprite.x_speed, speed);
  w16(x + sprite.max_x_speed, speed);
  return true;
}
const fleeSpeedFromSprite = (x: number) => r16(x + sprite.general_purpose_44);

/** .bonus_handler_state: in a bonus level the Kong already brought an animal along. */
function bonusHandlerState(idleState: number) {
  if (r16(level.type) === C.bonus_level_type && r16(R.animal_type)) {
    delete_sprite_handle_deallocation();
    return;
  }
  w16(cur() + sprite.state, idleState);
}

/** $B38A38 — Rambi (also squitter_main). */
export function squitter_main() {
  const state = animalEntry();
  switch (state) {
    case 0: // idle, waiting for a Kong
      if (handleSignAndCrush()) return;
      handle_animal_mounting();
      apply_animal_gravity();
      process_terrain_interaction_global();
      process_sprite_animation();
      CODE_BBBB99();
      return;
    case 1: // ridden
    case 4:
    case 5:
    case 6:
      snap_riding_kong_to_animal();
      process_sprite_animation();
      return;
    case 2: // knocked off the Kong: run away
      if (handleSignAndCrush()) return;
      handle_animal_mounting();
      if (reg.c) return;
      apply_animal_gravity();
      reg.a = 0x0007;
      interpolate_x_velocity_global();
      process_terrain_interaction_global();
      turnIfTouchingWall(fleeSpeedFromSprite);
      process_sprite_animation();
      CODE_BBBB99();
      return;
    default: // 3, 7
      return;
  }
}

function handleSignAndCrush(): boolean {
  handle_animal_sign_deletion();
  if (reg.c) return true;
  handle_animal_crushing();
  return reg.c;
}

/** $B38B08 — Rattly. */
export function rattly_main() {
  const state = animalEntry();
  switch (state) {
    case 0:
      handle_animal_sign_deletion();
      if (reg.c) return;
      handle_animal_mounting();
      apply_animal_gravity();
      process_terrain_interaction_global();
      process_sprite_animation();
      CODE_BBBB99();
      return;
    case 1:
    case 4:
    case 5:
    case 6:
      snap_riding_kong_to_animal();
      return;
    case 2:
      handle_animal_sign_deletion();
      if (reg.c) return;
      handle_animal_mounting();
      if (reg.c) return;
      apply_animal_gravity();
      reg.a = 0x0007;
      interpolate_x_velocity_global();
      process_terrain_interaction_global();
      turnIfTouchingWall(fleeSpeedFromSprite);
      process_sprite_animation();
      CODE_BBBB99();
      return;
    case 8:
      bonusHandlerState(0);
      return;
    default: // 3, 7, 9
      return;
  }
}

/**
 * $B38BB4 — an animal that passed a no-animal sign without a Kong (carry_or_defeat_flags = 2)
 * vanishes in three smoke puffs. Carry set = deleted.
 */
export function handle_animal_sign_deletion() {
  let x = cur();
  reg.x = x;
  if (r16(x + sprite.carry_or_defeat_flags) !== 0x0002) {
    reg.c = false;
    return;
  }
  delete_sprite_handle_deallocation();
  x = cur();
  w16(x + sprite.y_position, r16(x + sprite.y_position) - 0x18);
  // briefly bring the slot back so the smoke spawns relative to it
  w16(x + sprite.type, r16(x + sprite.type) + 1);
  reg.y = C.special_sprite_spawn_id_0122;
  spawn_special_sprite_index();
  reg.y = C.special_sprite_spawn_id_0124;
  spawn_special_sprite_index();
  reg.y = C.special_sprite_spawn_id_0126;
  spawn_special_sprite_index();
  x = cur();
  reg.x = x;
  w16(x + sprite.type, 0);
  reg.c = true;
}

/**
 * $B38BEA — an animal crushed by terrain gets hurt and flies up (X = animal). Never happens in
 * the final game. Carry set = crushed.
 */
export function handle_animal_crushing() {
  const x = reg.x;
  if (!(r16(x + sprite.terrain_attributes) & 0x0100)) {
    reg.c = false;
    return;
  }
  w16(x + sprite.state, 0x0009);
  w16(x + sprite.y_speed, 0xfb00);
  reg.a = C.animal_hurt_anim_range_start;
  set_anim_handle_animal();
  reg.c = true;
}

/** $B38C06 — Squawks. */
export function squawks_main() {
  const state = animalEntry();
  let x: number;
  switch (state) {
    case 0x0a: // purple Squawks flying away after dropping the Kong
      x = cur();
      w16(x + sprite.y_speed, 0xfe70);
      w16(x + sprite.x_speed, 0);
      apply_position_from_velocity_global();
      process_sprite_animation();
      sprite_return_handle_despawn();
      return;
    case 0x09:
      apply_animal_gravity();
      apply_position_from_velocity_global();
      reg.a = 0x0007;
      interpolate_x_velocity_global();
      sprite_return_handle_despawn();
      return;
    case 0:
      if (handleSignAndCrush()) return;
      handle_animal_mounting();
      process_terrain_interaction_global();
      process_sprite_animation();
      if (r16(R.level_number) === C.level_squawks_shaft) return;
      CODE_BBBB99();
      return;
    case 1:
      snap_riding_kong_to_animal();
      snap_follower_kong_to_animal();
      process_sprite_animation();
      return;
    case 2:
      handle_animal_sign_deletion();
      if (reg.c) return;
      x = cur();
      w16(x + sprite.state, 0);
      return;
    case 8:
      bonusHandlerState(0);
      return;
    default: // 3-7
      return;
  }
}

/** $B38CAB — with two Kongs, the follower rides along at the animal's position. */
export function snap_follower_kong_to_animal() {
  if (!(r16(R.game_state_flags) & 0x4000)) return;
  const y = r16(R.inactive_kong_sprite);
  reg.y = y;
  const x = r16(R.current_player_mount);
  reg.x = x;
  if (!x) return;
  w16(y + sprite.x_position, r16(x + sprite.x_position));
  w16(y + sprite.y_position, r16(x + sprite.y_position));
}

/** $B38CC5 — place the ridden animal under the Kong (riding offset $0D76/$0D78) facing the same way. */
export function snap_riding_kong_to_animal() {
  const x = cur();
  const y = r16(R.active_kong_sprite);
  reg.x = x;
  reg.y = y;
  const dx = r16(0x0d76);
  const kx = r16(y + sprite.x_position);
  w16(x + sprite.x_position, facingLeft(x) ? kx - dx : kx + dx);
  w16(x + sprite.y_position, r16(y + sprite.y_position) + r16(0x0d78));
  w16(x + sprite.oam_property, mergeBits(r16(x + sprite.oam_property), r16(y + sprite.oam_property), 0xc000));
}

/** $B38CF8 — gravity from constants +0, capped at the falling speed in constants +2. */
export function apply_animal_gravity() {
  const x = cur();
  reg.x = x;
  reg.y = 0x0002;
  let v = (spriteConst(0) + r16(x + sprite.y_speed)) & 0xffff;
  if (!(v & 0x8000) && v >= spriteConst(2)) v = spriteConst(2);
  w16(x + sprite.y_speed, v);
  reg.a = v;
}

/** $B38D10 — A = kong_state_flags_table entry of the active Kong's state (X = state*4). */
export function get_state_death_and_mounting_flags() {
  const x = (r16(r16(R.active_kong_sprite) + sprite.state) << 2) & 0xffff;
  reg.x = x;
  reg.a = rom16(KONG_STATE_FLAGS_TABLE + x);
}

/**
 * $B38D1D — let the active Kong mount this animal when he lands on it (Enguarde: touches it,
 * Squawks: touches it in the air). Carry set = the mount interaction was started.
 */
export function handle_animal_mounting() {
  let x = cur();
  reg.x = x;
  const timer = r16(x + sprite.general_purpose_42);
  if (timer) {
    w16(x + sprite.general_purpose_42, timer - 1);
    reg.c = false;
    return;
  }
  if (pl(r16(x + sprite.y_position) - r16(R.screen_scroll_y_position), 0x0110)) {
    reg.c = false;
    return;
  }
  get_current_sprite_clipping();
  x = reg.x;
  reg.a = ((((r16(x + sprite.type) - C.animal_sprite_type_range_start) & 0xffff) >> 2) + 1) & 0xffff;
  get_sprite_special_clipping_slot_1();
  reg.a = 0x0004;
  check_active_kong_collision();
  if (!reg.c) return; // carry already clear
  reg.c = false;
  if (r16(R.animal_type)) return;
  if (r16(R.current_held_sprite)) return;
  const y = r16(R.colliding_sprite);
  reg.y = y;
  if (y !== r16(R.active_kong_sprite)) return;
  get_state_death_and_mounting_flags();
  if (reg.a & 0x0009) {
    reg.c = false;
    return;
  }
  x = cur();
  reg.x = x;
  const type = r16(x + sprite.type);
  if (type === C.sprite_squawks) {
    if (r16(y + sprite.terrain_interaction) & 0x1001) {
      reg.c = false;
      return;
    }
  } else {
    if (type !== C.sprite_enguarde && r16(y + sprite.y_speed) & 0x8000) {
      reg.c = false;
      return; // still rising
    }
    if ((r16(x + sprite.y_position) - r16(y + sprite.y_position)) & 0x8000) {
      reg.c = false;
      return; // the Kong is below the animal
    }
    if (r16(y + sprite.terrain_interaction) & 0x0100) {
      reg.c = false;
      return; // grounded last frame
    }
  }
  reg.a = C.player_interaction_17;
  set_player_interaction_global();
  reg.c = true;
}

/** $B38DA6 — Enguarde. */
export function enguarde_main() {
  const state = animalEntry();
  let x: number;
  switch (state) {
    case 0:
    case 9:
      handle_animal_sign_deletion();
      if (reg.c) return;
      handle_animal_mounting();
      apply_animal_gravity();
      process_terrain_interaction_global();
      process_sprite_animation();
      CODE_BBBB99();
      return;
    case 1:
      snap_riding_kong_to_animal();
      process_sprite_animation();
      return;
    case 4: // free, in water (or stranded)
      handle_animal_mounting();
      enguardeOnLand();
      process_terrain_interaction_global();
      process_sprite_animation();
      if (r16(R.level_number) === C.level_clappers_cavern && r16(0x0915)) {
        // the water froze over: Enguarde can't survive there
        delete_sprite_handle_deallocation();
        return;
      }
      CODE_BBBB99();
      return;
    case 6: // knocked off the Kong: swim away
      handle_animal_sign_deletion();
      if (reg.c) return;
      handle_animal_mounting();
      if (reg.c) return;
      enguardeDespawnTimer();
      if (reg.c) {
        delete_sprite_handle_deallocation();
        return;
      }
      turnIfTouchingWall(() => 0x0200);
      enguardeOnLand();
      process_terrain_interaction_global();
      process_sprite_animation();
      return;
    case 8:
      bonusHandlerState(4);
      return;
    default: // 2, 3, 5, 7
      return;
  }
}

/** $B38E81 enguarde_main.handle_enguarde_despawn_timer — carry set once offscreen for 300 frames. */
function enguardeDespawnTimer() {
  check_if_sprite_offscreen_global();
  const x = cur();
  reg.x = x;
  if (!reg.c) {
    w16(x + sprite.general_purpose_4A, 0x012c);
    reg.c = false;
    return;
  }
  const t = (r16(x + sprite.general_purpose_4A) - 1) & 0xffff;
  w16(x + sprite.general_purpose_4A, t);
  reg.c = (t & 0x8000) !== 0;
}

/** $B38E9A enguarde_main.handle_enguarde_on_land — float in water, sink out of it. */
function enguardeOnLand() {
  const x = cur();
  reg.x = x;
  w16(x + sprite.y_speed, 0);
  check_sprite_underwater_global();
  if (reg.a === 0x0001) w16(reg.x + sprite.y_speed, 0x0400);
}

// ---------------------------------------------------------------------------------------------
// Animal icon (HUD)
// ---------------------------------------------------------------------------------------------

/**
 * $B38FC0 — the animal icon shown in the corner when the follower Kong is lost while riding:
 * it glides from the animal's screen position to its HUD spot ($42/$44), stays while the
 * player keeps that animal ($46), and flashes away once the second Kong is gone.
 */
export function animal_icon_main() {
  const x = cur();
  reg.x = x;
  const state = r16(x + sprite.state);
  switch (state) {
    case 0: // init
      w16(x + sprite.state, 0x0004);
      w16(x + 0x46, r16(R.animal_type));
      w16(x + 0x48, 0x0004);
      return;
    case 1: {
      // move to the screen position (1/16 of the remaining distance per frame)
      w16(R.temp_32, r16(x + sprite.x_sub_position));
      w16(R.temp_34, r16(x + sprite.x_position));
      w16(R.temp_36, 0x8000);
      w16(R.temp_38, r16(x + 0x42));
      approachTarget();
      w16(R.temp_5E, reg.a);
      w16(x + sprite.x_sub_position, r16(R.temp_32));
      w16(x + sprite.x_position, r16(R.temp_34));
      w16(R.temp_32, r16(x + sprite.y_sub_position));
      w16(R.temp_34, r16(x + sprite.y_position));
      w16(R.temp_36, 0x8000);
      w16(R.temp_38, r16(x + 0x44));
      approachTarget();
      w16(R.temp_60, reg.a);
      w16(x + sprite.y_sub_position, r16(R.temp_32));
      w16(x + sprite.y_position, r16(R.temp_34));
      reg.a = r16(R.temp_5E) | r16(R.temp_60);
      if (reg.a) return;
      w16(x + sprite.x_position, r16(x + 0x42));
      w16(x + sprite.y_position, r16(x + 0x44));
      w16(x + sprite.state, r16(x + sprite.state) + 1);
      return;
    }
    case 2: // idle
      if (r16(R.game_state_flags) & 0x4000) {
        if (r16(x + 0x46) !== r16(R.animal_type)) delete_sprite_handle_deallocation();
        return;
      }
      w16(x + sprite.state, r16(x + sprite.state) + 1);
      w16(x + 0x42, 0x0040);
      return;
    case 3: {
      // flash, faster towards the end, then disappear
      const t = (r16(x + 0x42) - 1) & 0xffff;
      w16(x + 0x42, t);
      if (t & 0x8000) {
        delete_sprite_handle_deallocation();
        return;
      }
      const frame = r16(R.active_frame_counter);
      let flash: boolean;
      if (mi(t, 0x000a)) flash = true;
      else if (mi(t, 0x0020)) flash = (frame & 0x0001) === 0;
      else flash = (frame & 0x0003) === 0;
      if (flash) w16(x + sprite.display_mode, r16(x + sprite.display_mode) ^ 0x4000);
      return;
    }
    case 4: {
      // wait a few frames after init
      const t = (r16(x + 0x48) - 1) & 0xffff;
      w16(x + 0x48, t);
      if (!(t & 0x8000)) return;
      w16(x + sprite.state, 0x0001);
      return;
    }
    case 5: // init straight at the HUD position
      w16(x + sprite.x_position, r16(x + 0x42));
      w16(x + sprite.y_position, r16(x + 0x44));
      w16(x + 0x46, r16(R.animal_type));
      w16(x + sprite.state, 0x0002);
      return;
  }
}

/**
 * $B390B4 animal_icon_main.CODE_B390B4 — 32-bit position $32:$34 moves 1/16 of the way to
 * $36:$38. Returns A = the step's integer part rounded to 16ths (0 once arrived).
 */
function approachTarget() {
  const pos = (r16(R.temp_32) + r16(R.temp_34) * 0x10000) >>> 0;
  const target = (r16(R.temp_36) + r16(R.temp_38) * 0x10000) >>> 0;
  let delta = (target - pos) >>> 0;
  // CODE_B390D7: arithmetic-ish shift by 4 (negate, logical shift, negate for negative deltas);
  // $3E:$40 receive the shifted magnitude
  let shifted: number;
  if (delta & 0x80000000) {
    const mag = (-delta >>> 0) >>> 4;
    shifted = mag;
    delta = -mag >>> 0;
  } else {
    shifted = delta >>> 4;
    delta = shifted;
  }
  w16(R.temp_3A, delta & 0xffff);
  w16(R.temp_3C, delta >>> 16);
  w16(R.temp_3E, shifted & 0xffff);
  w16(R.temp_40, shifted >>> 16);
  const np = (pos + delta) >>> 0;
  w16(R.temp_32, np & 0xffff);
  w16(R.temp_34, np >>> 16);
  reg.a = r16(R.temp_3F) & 0xfff0;
}

/** $B39118 — spawn the HUD icon of the current animal at the calling sprite's screen position. */
export function spawn_follower_animal_icon() {
  const animal = r16(R.animal_type);
  reg.a = animal;
  if (!animal) return;
  const i = (((animal - C.animal_sprite_type_range_start) & 0xffff) >> 1) & 0xffff;
  reg.x = i;
  reg.y = rom16(DATA_FF0D00 + i);
  spawn_special_sprite_address();
  if (reg.c) return;
  const x = cur();
  const y = r16(R.alternate_sprite);
  reg.x = x;
  reg.y = y;
  if (r16(R.parent_level_number) === C.level_castle_crush) w16(y + 0x44, 0x00b6); // keep it above the floor
  w16(y + sprite.x_position, r16(x + sprite.x_position) - r16(R.screen_scroll_x_position));
  w16(y + sprite.y_position, r16(x + sprite.y_position) - r16(R.screen_scroll_y_position));
  w16(y + sprite.x_sub_position, 0x8000);
  w16(y + sprite.y_sub_position, 0x8000);
  reg.a = (r16(R.animal_type) + 0x1908) & 0xffff;
  w16(y + sprite.current_graphic, reg.a);
}

/**
 * $B39164 — a sprite attached to the active Kong at offset ($44, $46), facing with him.
 * Note: it works on the sprite in Y as left by the previous code (not current_sprite).
 */
export function unknown_sprite_0114_main() {
  const x = r16(R.active_kong_sprite);
  const y = reg.y;
  reg.x = x;
  w16(y + sprite.oam_property, mergeBits(r16(y + sprite.oam_property), r16(x + sprite.oam_property), 0x4000));
  let dx = r16(y + 0x44);
  if (facingLeft(x)) dx = neg(dx);
  w16(y + sprite.x_position, dx + r16(x + sprite.x_position));
  w16(y + sprite.y_position, r16(y + 0x46) + r16(x + sprite.y_position));
  process_sprite_animation();
}

/** $B3A037 */
export function animal_despawn_smoke_main() {
  process_sprite_animation();
}

/**
 * $B3A03E — the no-animal sign: an animal (ridden, or a lone one in the sprite table) that
 * reaches it is turned into the sign's reward item ($42), or a lone animal vanishes.
 */
export function no_animal_sign_main() {
  if (r16(R.parent_level_number) === C.level_toxic_tower) {
    w16(level.effects, r16(level.effects) | C.climbable_ropes_effect);
  }
  // (rev 1 calls an empty routine here)
  // The ridden animal is the active Kong himself (A = animal_type); otherwise scan the table
  // from slot 3 for the first standalone animal.
  let x = r16(R.active_kong_sprite);
  let a = r16(R.animal_type);
  let candidate = a !== 0;
  if (!candidate) x = sprite_table.slot_3;
  for (;;) {
    if (!candidate) {
      a = r16(x + sprite.type);
      candidate = a !== 0;
    }
    if (candidate && isAnimal(a)) break;
    candidate = false;
    x += SPRITE_SIZE;
    if (x === sprite_table.end) {
      reg.x = x;
      sprite_return_handle_despawn();
      return;
    }
  }
  reg.x = x;
  w16(R.temp_32, a);
  const y = cur();
  reg.y = y;
  if (mi((r16(y + sprite.y_position) + 8) & 0xffff, r16(x + sprite.y_position))) return sprite_return_handle_despawn();
  let dist = (r16(y + sprite.x_position) - r16(x + sprite.x_position)) & 0xffff;
  if (dist & 0x8000) dist = neg(dist);
  if (pl(dist, 0x0010)) return sprite_return_handle_despawn();
  if (!r16(R.animal_type)) {
    w16(x + sprite.carry_or_defeat_flags, 0x0002);
    return sprite_return_handle_despawn();
  }
  reg.a = C.player_interaction_19;
  set_player_interaction_global();
  if (!reg.c) {
    const s = cur();
    reg.x = s;
    w16(R.interaction_RAM_0A86, r16(s + 0x42));
    w16(R.interaction_RAM_0A88, r16(s + sprite.y_position) - 0x20);
    reg.a = ((r16(s + sprite.oam_property) & 0x4000) << 1) & 0xffff;
    w16(R.interaction_RAM_0A88, r16(R.interaction_RAM_0A88) | reg.a);
  }
  sprite_return_handle_despawn();
}

const isAnimal = (type: number) => type >= C.animal_sprite_type_range_start && type < C.animal_sprite_type_range_end + 1;

registerSprite({
  squitter_main,
  rattly_main,
  squawks_main,
  enguarde_main,
  animal_icon_main,
  unknown_sprite_0114_main,
  animal_despawn_smoke_main,
  no_animal_sign_main,
});
registerRts({
  handle_animal_sign_deletion,
  handle_animal_crushing,
  snap_follower_kong_to_animal,
  snap_riding_kong_to_animal,
  apply_animal_gravity,
  get_state_death_and_mounting_flags,
  handle_animal_mounting,
});
registerRtl({ spawn_follower_animal_icon });
