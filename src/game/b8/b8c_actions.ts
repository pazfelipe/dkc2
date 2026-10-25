/**
 * Bank $B8 (package B8c) — Kong/animal player actions: the routines listed in the per-button
 * action tables (left/right/A/B/X/Y/L/R/start/select and the "no button" tables), selected by
 * the player's current action ($92) every frame, plus the helpers they share (jumping, rolling,
 * picking up objects, web platforms, switching Kongs).
 *
 * Sprite fields used here: $26 max_x_speed (target x velocity), $20 x_speed, $24 y_speed,
 * $2A max_y_speed, $12 oam_property (bit 14 = facing left), $1E terrain_interaction
 * (bit0 = on ground), $40 animation flags, $3A animation speed.
 */
import { r16, w16, rom16 } from "../../core/mem";
import { reg, register } from "../../core/cpu";
import { L, R, C, sprite, kong_control, sprite_table } from "../../core/sym";
import {
  set_anim_handle_dixie,
  set_anim_handle_animal_and_dixie,
  get_player_x_move_speed,
  slow_rattly_if_on_ground,
  get_debug_fly_velocity,
  CODE_B8B77B,
  set_stuck_on_honey_floor_animation,
  CODE_B9DFB2,
  work_on_inactive_kong,
  work_on_active_kong,
  climb_up_single_rope_action,
  CODE_B5E43E,
  check_sprite_underwater,
  get_sprite_special_clipping_slot_0,
  check_for_sprite_collisions,
  spawn_special_sprite_index,
  set_alt_sprite_animation,
  spawn_special_sprite_address,
  set_swimming_state,
  start_player_faster_falling,
  set_player_interaction,
  set_player_jumping_gravity,
  set_player_normal_gravity,
  set_player_terminal_velocity,
  disable_bullet_time,
  CODE_B8D484,
} from "../../gen/routines";
import { neg, isNeg, cmpNeg, spriteConst, jslLabel } from "./b8c_util";

const QUEUE_SOUND_EFFECT = L("queue_sound_effect");
const GET_TERRAIN_INFO_DEFINE_X = L("get_sprite_terrain_info_define_x");
const KONG_STATE_FLAGS_TABLE = L("kong_state_flags_table");
const WEB_SHOT_SPAWN_DATA = L("DATA_FF1B06") & 0xffff;
const SPRITE_SIZE = 0x5e;

const cur = () => r16(R.current_sprite);
const ctlVars = () => r16(R.current_kong_control_variables);
const pressed = () => r16(R.player_action_pressed);
const held = () => r16(R.player_action_held);
const frame = () => r16(R.active_frame_counter);
const FACING_LEFT = 0x4000;

function anim(id: number) {
  reg.a = id;
  set_anim_handle_dixie();
}
function animalAnim(id: number) {
  reg.a = id;
  set_anim_handle_animal_and_dixie();
}
/** `%lda_sound(channel, sound) : JSL queue_sound_effect` */
function sound(channel: number, id: number) {
  reg.a = (channel << 8) | id;
  jslLabel(QUEUE_SOUND_EFFECT);
}
function interaction(id: number) {
  reg.a = id;
  set_player_interaction();
}
const setFacingLeft = (x: number) => w16(x + sprite.oam_property, r16(x + sprite.oam_property) | FACING_LEFT);
const setFacingRight = (x: number) => w16(x + sprite.oam_property, r16(x + sprite.oam_property) & ~FACING_LEFT & 0xffff);
const isFacingLeft = (x: number) => (r16(x + sprite.oam_property) & FACING_LEFT) !== 0;
const tsb = (addr: number, m: number) => w16(addr, r16(addr) | m);

/** Constant offset for the fast or normal version of a speed (fast flag bit 2). */
const fastConst = (normal: number, fast: number) => spriteConst(r16(ctlVars() + kong_control.fast_flag) & 0x0004 ? fast : normal);

/** The common "leave a rope/hook/water by jumping" tail. */
function startJumpOff(normalGravity: boolean) {
  set_player_terminal_velocity();
  if (normalGravity) set_player_normal_gravity();
  else set_player_jumping_gravity();
  CODE_B5E43E();
  tsb(R.game_state_flags_2, 0x0001);
}

// ---------------------------------------------------------------------------------------------
// Left
// ---------------------------------------------------------------------------------------------

/** $B8C32A */
export function horizontal_rope_climb_left_action() {
  const x = cur();
  w16(x + sprite.max_x_speed, neg(fastConst(0x64, 0x66)));
}

/** $B8C349 */
export function swim_left_action() {
  const x = cur();
  w16(x + sprite.max_x_speed, neg(fastConst(0x7c, 0x7e)));
}

/** $B8C368 — stuck in honey: each fresh left press wiggles. */
export function stuck_on_honey_floor_left_action() {
  if (!(pressed() & C.input_left)) return;
  set_stuck_on_honey_floor_animation();
  w16(cur() + sprite.animation_speed, 0x0080);
}

/** $B8C37E */
export function move_enguarde_left_action() {
  w16(cur() + sprite.max_x_speed, 0xfe00);
}

/** $B8C386 */
export function wind_float_move_left_action() {
  w16(cur() + sprite.max_x_speed, neg(spriteConst(0x6c)));
}

/** $B8C394 */
export function enguarde_on_land_move_left_action() {
  setFacingLeft(cur());
}

/** $B8C39E — pressing against the charge direction ends Rambi's charge. */
export function rambi_charge_move_left_action() {
  const x = cur();
  if (!isNeg(r16(x + sprite.x_speed))) w16(x + sprite.state, C.kong_state_09);
}

/** $B8C3AA */
export function enguarde_charge_move_left_action() {
  const x = cur();
  if (!isNeg(r16(x + sprite.x_speed))) w16(x + sprite.state, 0x0050);
}

// ---------------------------------------------------------------------------------------------
// Right
// ---------------------------------------------------------------------------------------------

/** $B8C3B6 */
export function walk_right_action() {
  reg.x = cur();
  get_player_x_move_speed();
  slow_rattly_if_on_ground();
  w16(reg.x + sprite.max_x_speed, reg.a);
}

/** $B8C3C1 — no action */
export function CODE_B8C3C1() {}

/** $B8C3C2 — rolling: turn right unless the roll is already committed on a steep slope. */
export function roll_right_action() {
  const x = cur();
  reg.x = x;
  if (!cmpNeg(r16(x + sprite.terrain_attributes) & 0x0007, r16(0x88)) && r16(x + sprite.terrain_interaction) & 0x0001) return;
  // CODE_B8C3D5
  setFacingRight(x);
  const v = r16(x + sprite.max_x_speed);
  if (isNeg(v)) w16(x + sprite.max_x_speed, neg(v));
}

/** $B8C3E7 */
export function debug_fly_right_action() {
  reg.x = cur();
  get_debug_fly_velocity();
  const x = reg.x;
  w16(x + sprite.x_speed, reg.a);
  setFacingRight(x);
}

/** $B8C3F6 */
export function shot_from_cannon_move_right_action() {
  reg.x = cur();
  get_player_x_move_speed();
  const x = reg.x;
  w16(x + sprite.max_x_speed, reg.a + r16(x + sprite.max_x_speed));
}

/** $B8C401 */
export function move_barrel_cannon_right_action() {
  const x = cur();
  w16(x + sprite.max_x_speed, spriteConst(0x4e));
  w16(x + sprite.unknown_28, spriteConst(0x52));
}

/** $B8C412 — climbing a single rope and pressing right: let go towards a ledge or turn around. */
export function single_rope_climb_right_action() {
  let x = cur();
  if (isFacingLeft(x)) {
    // facing left: is there a ledge $20 px to the right, near the Kong's feet?
    w16(0x34, r16(x + sprite.y_position) - 0x0008);
    reg.a = (r16(x + sprite.x_position) + 0x0020) & 0xffff;
    jslLabel(GET_TERRAIN_INFO_DEFINE_X);
    CODE_B8D484();
    x = reg.x;
    w16(0x5e, reg.a);
    if (r16(0xae) & 0x1000 && cmpNeg((r16(0x5e) + 0x27) & 0xffff, r16(x + sprite.y_position))) {
      // CODE_B8C464: switch to the other side of the rope
      if (r16(ctlVars() + kong_control.animation_id) === 0x0032) return;
      w16(cur() + sprite.state, C.kong_state_36);
      anim(0x0034);
      return;
    }
    // CODE_B8C443
    w16(0x34, r16(x + sprite.y_position) - 0x0028);
    reg.a = (r16(x + sprite.x_position) + 1) & 0xffff;
    jslLabel(GET_TERRAIN_INFO_DEFINE_X);
    CODE_B8D484();
    x = reg.x;
    w16(0x5e, reg.a);
    if (r16(0xae) & 0x0800) {
      // CODE_B8C47D: let go and step off the rope to the right
      x = cur();
      w16(x + sprite.x_position, r16(x + sprite.x_position) + 1);
      w16(x + sprite.x_speed, 0x0100);
      w16(x + sprite.max_x_speed, 0x0100);
      CODE_B8B77B();
      return;
    }
  }
  // CODE_B8C45E
  w16(x + sprite.max_x_speed, 0x0300);
}

/** $B8C491 — double rope: face right (moving over to the right rope). */
export function double_rope_climb_right_action() {
  const x = cur();
  w16(x + sprite.state, C.kong_state_36);
  if (isFacingLeft(x)) {
    w16(x + sprite.oam_property, r16(x + sprite.oam_property) ^ FACING_LEFT);
    w16(x + sprite.x_position, r16(x + sprite.x_position) + 0x0020);
  }
  anim(0x0035);
}

/** $B8C4B6 */
export function horizontal_rope_climb_right_action() {
  w16(cur() + sprite.max_x_speed, fastConst(0x64, 0x66));
}

/** $B8C4D1 */
export function swim_right_action() {
  w16(cur() + sprite.max_x_speed, fastConst(0x7c, 0x7e));
}

/** $B8C4EC */
export function stuck_on_honey_floor_right_action() {
  if (!(pressed() & C.input_right)) return;
  set_stuck_on_honey_floor_animation();
  w16(cur() + sprite.animation_speed, 0x0080);
}

/** $B8C502 */
export function move_enguarde_right_action() {
  w16(cur() + sprite.max_x_speed, 0x0200);
}

/** $B8C50A */
export function wind_float_move_right_action() {
  w16(cur() + sprite.max_x_speed, spriteConst(0x6c));
}

/** $B8C514 */
export function enguarde_on_land_move_right_action() {
  setFacingRight(cur());
}

/** $B8C51E */
export function rambi_charge_move_right_action() {
  const x = cur();
  if (isNeg(r16(x + sprite.x_speed) - 1)) w16(x + sprite.state, 0x0009);
}

/** $B8C52B */
export function enguarde_charge_move_right_action() {
  const x = cur();
  if (isNeg(r16(x + sprite.x_speed))) w16(x + sprite.state, 0x0050);
}

// ---------------------------------------------------------------------------------------------
// X / select: dismount, swap Kongs
// ---------------------------------------------------------------------------------------------

/** $B8C537 — X: get off the animal buddy (Squawks only when allowed by its flags). */
export function dismount_animal_action() {
  if (!(pressed() & C.input_X)) return;
  const animal = r16(R.animal_type);
  if (!animal) return;
  const mount = r16(R.current_player_mount);
  reg.x = mount;
  if (!mount) return;
  if (animal === C.sprite_squawks && !(r16(mount + sprite.general_purpose_4A) & 0x0001)) return;
  interaction(C.player_interaction_18);
}

/** $B8C559 — request the Kong swap interaction. */
export function CODE_B8C559() {
  interaction(C.player_interaction_02);
}

// ---------------------------------------------------------------------------------------------
// B: jumping
// ---------------------------------------------------------------------------------------------

/** $B8C55F — B: jump (a press up to 16 frames early is buffered until landing). */
export function jump_action() {
  const x = cur();
  const ctl = ctlVars();
  if (pressed() & C.input_B) {
    w16(ctl + kong_control.b_press_time, frame());
  } else if (!cmpNeg((frame() - r16(ctl + kong_control.b_press_time)) & 0xffff, 0x0010)) {
    return;
  }
  if (r16(x + sprite.animation_flags) & 0x0001) return;
  if (!(r16(x + sprite.terrain_interaction) & 0x1010)) {
    // on the ground: no jumping off slopes that are too steep
    if (!cmpNeg(r16(x + sprite.terrain_attributes) & 0x0007, r16(0x88))) return;
  }
  start_player_jumping();
}

/** $B8C59B */
export function start_player_jumping() {
  set_player_jumping_gravity();
  w16(ctlVars() + kong_control.jump_event_time, frame());
  const heldSprite = r16(R.current_held_sprite);
  if (heldSprite) {
    if (heldSprite === r16(R.inactive_kong_sprite)) {
      // .holding_kong: both Kongs get their team-up jump animation
      anim(0x0021);
      work_on_inactive_kong();
      anim(0x0020);
      work_on_active_kong();
      return;
    }
    anim(0x0015);
    return;
  }
  if (!r16(R.animal_type)) {
    anim(0x0005);
    return;
  }
  const x = cur();
  reg.x = x;
  if (r16(x + sprite.state) !== 0x004f) {
    animalAnim(0x006d);
    return;
  }
  // .rambi_charge: only jumps while touching the ground
  if (!(r16(x + sprite.terrain_interaction) & 0x0001)) return;
  CODE_B9DFB2();
  animalAnim(0x0072);
}

/** $B8C5FA */
export function update_b_press_event_action() {
  if (!(pressed() & C.input_B)) return;
  const ctl = ctlVars();
  reg.y = ctl;
  w16(ctl + kong_control.b_press_time, frame());
}

/** $B8C60A — B with Squawks: flap upwards (faster with up held). */
export function squawks_fly_up_action() {
  const x = cur();
  if (!(pressed() & C.input_B)) return;
  w16(0x32, 0);
  if (held() & C.input_up) w16(0x32, 0x0100);
  // .get_squawks_ascend_speed: slower when carrying a Kong ("mount") and in Castle Crush
  const speed = r16(R.current_player_mount) || r16(R.parent_level_number) === 0x0062 ? spriteConst(0x00c6) : spriteConst(0x0084);
  w16(x + sprite.y_speed, speed - r16(0x32));
  if (r16(x + sprite.animation_flags) & 0x0008) return;
  w16(x + sprite.animation_speed, r16(0x32) + 0x0340);
  sound(5, C.sound_squawks_flap_1);
}

/** $B8C65A */
export function jump_off_vertical_rope_action() {
  if (!(held() & (C.input_left | C.input_right))) {
    if (held() & (C.input_up | C.input_down)) return;
    climb_up_single_rope_action();
    return;
  }
  if (!(pressed() & C.input_B)) return;
  // .jump_from_rope
  set_player_terminal_velocity();
  CODE_B5E43E();
  start_player_jumping();
  w16(0x09a1, 0x0002);
  const x = cur();
  w16(x + sprite.x_speed, r16(x + sprite.max_x_speed));
  if (held() & C.input_right) setFacingRight(x);
  else setFacingLeft(x);
}

/** $B8C6A4 — no action */
export function vertical_double_rope_b_action() {}

/** $B8C6A5 — B on a horizontal rope: jump up, or drop down with down held. */
export function jump_off_horizontal_rope_action() {
  if (!(pressed() & C.input_B)) return;
  const x = cur();
  w16(x + sprite.x_speed, 0);
  if (!(held() & C.input_down)) {
    w16(x + sprite.y_speed, spriteConst(0x0008));
    w16(x + sprite.state, 0x006e);
    anim(0x0006);
    startJumpOff(false);
    return;
  }
  w16(x + sprite.y_speed, 0xfd00);
  w16(x + sprite.state, 0x006d);
  w16(x + sprite.general_purpose_42, 0x0010);
  anim(0x0006);
  startJumpOff(true);
}

/** $B8C705 — B on a hook: jump up, or drop down with down held. */
export function jump_off_hook_action() {
  if (!(pressed() & C.input_B)) return;
  w16(0x0d82, 0);
  let x = cur();
  w16(x + sprite.y_position, r16(x + sprite.y_position) + 0x0020);
  w16(x + sprite.x_speed, 0);
  x = cur();
  if (!(held() & C.input_down)) {
    w16(x + sprite.y_speed, spriteConst(0x0008));
    w16(x + sprite.state, 0x0006);
    anim(0x0006);
    startJumpOff(false);
    return;
  }
  w16(x + sprite.y_speed, 0xfd00);
  w16(x + sprite.state, 0x0039);
  anim(0x0006);
  startJumpOff(true);
}

/** $B8C76F — B underwater: swim stroke; near the surface: jump out of the water. */
export function swim_up_action() {
  if (!(pressed() & C.input_B)) return;
  check_sprite_underwater();
  if (cmpNeg(reg.a & 0xffff, 0x0002)) {
    // .jump_out_of_water
    const x = cur();
    w16(x + sprite.y_speed, spriteConst(0x0008));
    w16(x + sprite.state, 0x0006);
    anim(0x0006);
    startJumpOff(false);
    return;
  }
  sound(5, C.sound_kong_swim);
  const x = cur();
  // .get_swim_constant_offset: stroke strength depends on up/down
  const ud = held() & (C.input_up | C.input_down);
  const y = !ud ? 0x0070 : ud & C.input_up ? 0x0072 : 0x0074;
  w16(x + sprite.y_speed, spriteConst(y));
  if (r16(R.current_player_mount)) return;
  w16(x + sprite.animation_speed, 0x0300);
}

/** $B8C7D9 — B on a honey wall: jump away from the wall. */
export function jump_off_honey_wall_action() {
  if (!(pressed() & C.input_B)) return;
  get_honey_wall_jump_direction();
  if (!(reg.a & 0xffff)) return;
  // .get_honey_wall_x_velocity
  let v = spriteConst(0x000e);
  let x = cur();
  if (!isFacingLeft(x)) v = neg(v);
  w16(x + sprite.max_x_speed, v);
  w16(x + sprite.x_speed, v);
  x = cur();
  w16(x + sprite.y_speed, spriteConst(0x0008));
  w16(x + sprite.state, 0x0042);
  w16(x + sprite.oam_property, r16(x + sprite.oam_property) ^ FACING_LEFT);
  anim(0x0006);
  startJumpOff(false);
}

/** $B8C82C — A = the held direction pointing away from the wall (0 if none). */
export function get_honey_wall_jump_direction() {
  const h = held();
  const x = cur();
  reg.x = x;
  reg.a = h & (isFacingLeft(x) ? 0x0100 : 0x0200);
  reg.z = reg.a === 0;
}

// ---------------------------------------------------------------------------------------------
// A: team up, animal specials
// ---------------------------------------------------------------------------------------------

/** $B8C83D — A: team up with the follower Kong (or throw request while holding it). */
export function team_up_action() {
  if (!(pressed() & C.input_A)) return;
  const heldSprite = r16(R.current_held_sprite);
  if (heldSprite) {
    if (heldSprite !== r16(R.inactive_kong_sprite)) return;
    if (r16(cur() + sprite.state) !== 0x0017) return;
    interaction(C.player_interaction_06);
    return;
  }
  // .not_teamed_yet: the follower must be following (state $2A or $22)
  const y = r16(R.inactive_kong_sprite);
  reg.y = y;
  const s = r16(y + sprite.state);
  if (s !== 0x002a && s !== 0x0022) return;
  check_if_player_has_both_kongs();
  if (reg.c) return;
  interaction(C.player_interaction_04);
}

/** $B8C87C — carry clear if both Kongs are present (and not in a single-Kong section). */
export function check_if_player_has_both_kongs() {
  reg.c = !(r16(R.game_state_flags) & 0x4000) || (r16(R.game_state_flags_2) & 0x0002) !== 0;
}

/** $B8C890 — A with an animal buddy: Rambi/Enguarde charge, Squitter platform, Rattly super jump. */
export function animal_special_action() {
  const animal = r16(R.animal_type);
  if (animal === C.sprite_rattly) {
    // .rattly: start charging the super jump (on the ground only)
    const x = cur();
    if (!(r16(x + sprite.terrain_interaction) & 0x0001)) return;
    if (r16(x + sprite.state) === 0x0061) return;
    w16(x + sprite.max_x_speed, 0);
    w16(x + sprite.x_speed, 0);
    w16(x + sprite.state, 0x0061);
    animalAnim(0x0086);
    return;
  }
  if (!(pressed() & C.input_A)) return;
  const x = cur();
  reg.x = x;
  if (animal === C.sprite_rambi) {
    w16(x + sprite.max_x_speed, 0);
    w16(x + sprite.x_speed, 0);
    if (!(r16(x + sprite.terrain_interaction) & 0x0001)) return;
    w16(x + sprite.state, 0x0053);
    animalAnim(0x0086);
  } else if (animal === C.sprite_enguarde) {
    w16(x + sprite.max_x_speed, 0);
    w16(x + sprite.x_speed, 0);
    w16(x + sprite.max_y_speed, 0);
    w16(x + sprite.y_speed, 0);
    w16(x + sprite.state, 0x0054);
    animalAnim(0x0086);
  } else if (animal === C.sprite_squitter) {
    shoot_web_platform();
  }
}

/** $B8C90D — X = Squitter: shoot a web platform (at most 3 exist; the oldest one despawns). */
export function shoot_web_platform() {
  let x = reg.x;
  w16(x + sprite.max_x_speed, 0);
  w16(x + sprite.x_speed, 0);
  reg.y = ctlVars();
  // TRB #$40: a pending "platform being shot" flag is consumed instead of shooting
  const flags = r16(R.RAM_0B02);
  w16(R.RAM_0B02, flags & ~0x0040 & 0xffff);
  if (flags & 0x0040) return;
  if (r16(R.RAM_0B02) & 0x0080) return;
  const since = (frame() - r16(R.last_squitter_platform_shot_time)) & 0xffff;
  w16(0x32, since);
  if (0x000c >= since) return;
  w16(R.last_squitter_platform_shot_time, frame());
  scan_for_web_platforms();
  if (!cmpNeg(reg.a, 0x0002)) {
    x = r16(0x36);
    w16(x + sprite.general_purpose_44, 0x0001);
  }
  reg.y = C.special_sprite_spawn_id_0098;
  spawn_special_sprite_index();
  if (reg.c) return;
  tsb(R.RAM_0B02, 0x0040);
  reg.a = 0x02d6;
  set_alt_sprite_animation();
  sound(5, C.sound_squitter_platform_web);
  // .set_platform_velocity
  let v = spriteConst(0x0092);
  if (isFacingLeft(cur())) v = neg(v);
  x = r16(R.alternate_sprite);
  w16(x + sprite.x_speed, v);
  const ud = held() & (C.input_up | C.input_down);
  if (!ud) return;
  w16(x + sprite.general_purpose_48, spriteConst(ud & C.input_up ? 0x0094 : 0x0096));
}

/**
 * $B8C99A — count the web platforms in the sprite table: A = count,
 * $34/$36 = largest lifetime and its sprite (the oldest, non-despawning one).
 */
export function scan_for_web_platforms() {
  w16(0x32, 0);
  w16(0x34, 0);
  w16(0x36, 0);
  for (let x: number = sprite_table.slot_1; x !== sprite_table.end; x += SPRITE_SIZE) {
    if (r16(x + sprite.type) !== C.sprite_web_platform) continue;
    w16(0x32, r16(0x32) + 1);
    if (r16(x + sprite.general_purpose_44)) continue;
    const life = r16(x + sprite.general_purpose_42);
    if (cmpNeg(life, r16(0x34))) continue;
    w16(0x34, life);
    w16(0x36, x);
  }
  reg.x = sprite_table.end;
  reg.a = r16(0x32);
}

// ---------------------------------------------------------------------------------------------
// Y: roll, pick up, glide, animal attacks
// ---------------------------------------------------------------------------------------------

/** $B8C9C8 — Y: pick up an object in reach, otherwise roll (buffered 12 frames). */
export function roll_or_pickup_object_action() {
  set_fast_move_if_left_right();
  update_object_pickup();
  if (reg.c) return;
  const x = cur();
  if (isNeg(r16(x + sprite.y_position) - r16(x + sprite.ground_y_position))) return;
  if (r16(x + sprite.animation_flags) & 0x0002) return;
  if (!(pressed() & C.input_Y)) {
    if (!cmpNeg((frame() - r16(ctlVars() + kong_control.y_press_time)) & 0xffff, 0x000c)) return;
  }
  // .start_roll
  start_player_roll();
  const ctl = ctlVars();
  w16(ctl + kong_control.roll_event_time, r16(ctl + kong_control.y_press_time));
  apply_roll_animation();
}

/** $B8CA07 */
export function apply_roll_animation() {
  w16(cur() + sprite.y_speed, 0x0001);
  anim(0x0009);
}

/** $B8CA16 — Y in the air with Dixie: start the helicopter spin when falling. */
export function glide_action() {
  set_fast_move_if_left_right();
  const x = cur();
  if (r16(x + sprite.animation_id) === 0x00ae) return;
  if (isNeg(r16(x + sprite.y_speed))) return;
  if (r16(x + sprite.state) !== 0x0006) return;
  const fromGround = (r16(x + sprite.ground_y_position) - r16(x + sprite.y_position)) & 0xffff;
  if (!isNeg(fromGround) && cmpNeg(fromGround, 0x0018)) return;
  const ctl = ctlVars();
  if (ctl !== R.dixie_control_variables) return;
  if (((frame() - r16(ctl + kong_control.y_press_time)) & 0xffff) >= 0x0010) return;
  // .start_glide
  w16(ctl + kong_control.max_fall_speed, spriteConst(0x002e));
  w16(x + sprite.y_speed, spriteConst(0x0030));
  anim(0x000b);
}

/** $B8CA68 — Y while rolling: a fresh press turns the roll into a fast roll. */
export function update_roll_action() {
  update_object_pickup();
  if (reg.c) return;
  if (pressed() & C.input_Y) {
    const x = cur();
    if (r16(x + sprite.state) !== 0x0019) w16(x + sprite.state, 0x0003);
  }
  set_fast_move_if_left_right();
}

/** $B8CA87 — Y with Rambi (attack) or Squitter (web shot). */
export function land_animal_attack_action() {
  set_fast_move_if_left_right();
  if (!(pressed() & C.input_Y)) return;
  const animal = r16(R.animal_type);
  if (animal === C.sprite_rambi) {
    start_rambi_attack();
    return;
  }
  if (animal !== C.sprite_squitter) return;
  reg.y = ctlVars();
  const since = (frame() - r16(R.last_squitter_web_shot_time)) & 0xffff;
  w16(0x32, since);
  if (spriteConst(0x0088) >= since) return;
  w16(R.last_squitter_web_shot_time, frame());
  if (cmpNeg((spriteConst(0x008a) - 1) & 0xffff, r16(R.squitter_web_shot_count))) return;
  reg.y = WEB_SHOT_SPAWN_DATA;
  spawn_special_sprite_address();
  if (reg.c) return;
  w16(R.squitter_web_shot_count, r16(R.squitter_web_shot_count) + 1);
  sound(5, C.sound_squitter_attack_web);
  let v = spriteConst(0x008c);
  if (isFacingLeft(cur())) v = neg(v);
  const x = r16(R.alternate_sprite);
  w16(x + sprite.x_speed, v);
  const ud = held() & (C.input_up | C.input_down);
  if (!ud) return;
  // (the original's labels are swapped: up uses $8E, down $90)
  w16(x + sprite.general_purpose_48, spriteConst(ud & C.input_up ? 0x008e : 0x0090));
}

/** $B8CB05 — Rambi's horn attack (a press during the attack chains another one). */
export function start_rambi_attack() {
  const ctl = ctlVars();
  reg.y = ctl;
  if (r16(ctl + kong_control.animation_id) === 0x008e) {
    tsb(R.RAM_0B02, 0x0001);
    return;
  }
  w16(cur() + sprite.state, C.kong_state_57);
  animalAnim(0x008b);
  faceTargetDirection(cur());
}

/** Face the direction of the target x velocity, if any (`LSR : EOR : AND #$4000 : EOR`). */
function faceTargetDirection(x: number) {
  reg.x = x;
  const t = r16(x + sprite.max_x_speed);
  reg.a = t;
  if (!t) return;
  const f = r16(x + sprite.oam_property);
  reg.a = (((t >> 1) ^ f) & 0x4000) ^ f;
  w16(x + sprite.oam_property, reg.a);
}

/** $B8CB35 — Y with Squawks: spit an egg (a press during the animation queues another). */
export function squawks_shoot_action() {
  set_fast_move_if_left_right();
  if (!(pressed() & C.input_Y)) return;
  const id = r16(ctlVars() + kong_control.animation_id);
  if (id === 0x0088 || id === 0x008d) {
    w16(R.RAM_0B02, r16(R.RAM_0B02) | 0x0001);
    return;
  }
  animalAnim(0x0086);
}

/** $B8CB64 */
export function shot_from_cannon_move_faster_action() {
  set_fast_move_if_left_right();
}

/** $B8CB68 — Y while holding the other Kong: team throw. */
export function team_throw_action() {
  if (!(pressed() & C.input_Y)) return;
  w16(cur() + sprite.state, 0x0023);
  anim(0x0026);
}

/** $B8CB80 */
export function enable_fast_move_from_y_action() {
  const ctl = ctlVars();
  reg.y = ctl;
  w16(ctl + kong_control.fast_flag, r16(ctl + kong_control.fast_flag) | 0x0004);
}

/** $B8CB8C — pick up a carryable sprite in reach; carry set if one was picked up. */
export function update_object_pickup() {
  let x = cur();
  reg.x = x;
  reg.c = false;
  if (!(r16(x + sprite.terrain_interaction) & 0x0001)) return;
  const follower = r16(R.inactive_kong_sprite);
  const fs = r16(follower + sprite.state);
  if (fs === 0x001f || fs === 0x0040) {
    reg.c = false;
    return;
  }
  reg.a = 0;
  get_sprite_special_clipping_slot_0();
  reg.a = 1;
  check_for_sprite_collisions();
  if (!reg.c) return;
  x = r16(R.colliding_sprite);
  if (!(r16(x + sprite.terrain_interaction) & 0x1001)) {
    reg.c = false;
    return;
  }
  w16(R.current_held_sprite, x);
  w16(x + sprite.interaction_flags, r16(x + sprite.interaction_flags) & 0xfffe);
  w16(x + sprite.carry_or_defeat_flags, 0x0001);
  w16(x + sprite.terrain_interaction, 0);
  const y = cur();
  const off = isFacingLeft(y)
    ? r16(y + sprite.x_position) - r16(x + sprite.x_position)
    : r16(x + sprite.x_position) - r16(y + sprite.x_position);
  w16(R.held_sprite_x_offset, off);
  w16(R.held_sprite_y_offset, r16(x + sprite.y_position) - r16(y + sprite.y_position));
  w16(0x0d80, 0xffff);
  w16(cur() + sprite.state, 0x000c);
  anim(0x000f);
  // only left, right and start stay held while lifting
  w16(R.player_action_held, held() & 0x1300);
  reg.c = true;
}

/** $B8CC14 — fast flag (bit 2) on while left/right is held. */
export function set_fast_move_if_left_right() {
  const ctl = ctlVars();
  reg.y = ctl;
  const f = r16(ctl + kong_control.fast_flag);
  if (r16(ctl + kong_control.input_held) & 0x0300) w16(ctl + kong_control.fast_flag, f | 0x0004);
  else w16(ctl + kong_control.fast_flag, f & 0xfffb);
}

/**
 * $B8CC32 — start a roll: standing, walking, or (Y released and re-pressed quickly while
 * running) a fast roll.
 */
export function start_player_roll() {
  const s = cur();
  w16(s + sprite.state, 0x0002);
  const x = ctlVars();
  reg.x = x;
  let y = 0x001e;
  if (held() & (C.input_left | C.input_right)) {
    y = 0x0020;
    const sinceRelease = (frame() - r16(x + kong_control.y_release_time)) & 0xffff;
    if (!isNeg(sinceRelease) && cmpNeg(sinceRelease, 0x0014)) {
      const heldFor = (r16(x + kong_control.y_release_time) - r16(x + kong_control.y_old_press_time)) & 0xffff;
      if (heldFor >= 0x0020) {
        w16(cur() + sprite.state, 0x0003);
        y = 0x0022;
      }
    }
  }
  reg.y = y;
  reg.a = spriteConst(y);
  w16(x + kong_control.roll_speed, reg.a);
}

/** $B8CC70 */
export function set_fast_move_if_left_right_y_action() {
  set_fast_move_if_left_right();
}

/** $B8CC74 — B or Y with Enguarde: lunge (the press is consumed). */
export function enguarde_attack_action() {
  const p = pressed() & (C.input_B | C.input_Y);
  if (!p) return;
  w16(R.player_action_pressed, p ^ pressed());
  start_enguarde_attack();
}

/** $B8CC87 — Y from the second player in co-op: take control. */
export function coop_take_control_y_action() {
  if (pressed() & C.input_Y) transfer_control_of_player();
}

/** $B8CC93 — Enguarde's lunge (a press during the attack chains another one). */
export function start_enguarde_attack() {
  const ctl = ctlVars();
  reg.y = ctl;
  if (r16(ctl + kong_control.animation_id) === 0x008f) {
    tsb(R.RAM_0B02, 0x0001);
    return;
  }
  animalAnim(0x008b);
  const x = cur();
  w16(x + sprite.y_speed, 0);
  faceTargetDirection(x);
}

// ---------------------------------------------------------------------------------------------
// L / R / start / select
// ---------------------------------------------------------------------------------------------

/** $B8CCBE */
export function shoot_web_platform_l_action() {
  if (pressed() & C.input_L) shoot_web_platform_lr();
}

/** $B8CCC7 */
export function shoot_web_platform_r_action() {
  if (pressed() & C.input_R) shoot_web_platform_lr();
}

/** $B8CCD0 */
export function shoot_web_platform_lr() {
  reg.x = cur();
  if (r16(R.animal_type) === C.sprite_squitter) shoot_web_platform();
}

/** $B8CCDD — start: request pause (Rev 1 sets a flag handled by the game loop). */
export function pause_game_action() {
  if (!(pressed() & C.input_start)) return;
  if (!r16(R.screen_brightness)) return;
  if (r16(R.game_state_flags) & 0x2000) return;
  const x = r16(R.active_kong_sprite);
  reg.x = x;
  if (r16(x + sprite.state) === 0x0005) return;
  tsb(R.game_state_flags_2, 0x0010);
}

/** $B8CD07 — start while debug flying: back to normal. */
export function stop_debug_fly_action() {
  if (!(pressed() & C.input_start)) return;
  w16(cur() + sprite.state, 0);
  w16(R.debug_flags, r16(R.debug_flags) & 0xfffe);
}

/** $B8CD21 */
export function coop_take_control_start_action() {
  if (pressed() & C.input_start) transfer_control_of_player();
}

/** $B8CD2A — co-op: hand control of the Kong to the other player. */
export function transfer_control_of_player() {
  const x = cur();
  reg.x = x;
  if (cmpNeg(r16(x + sprite.general_purpose_4A), 0x0020)) return;
  // CODE_B8CD34
  tsb(R.game_state_flags_2, 0x0001);
  w16(R.game_state_flags, r16(R.game_state_flags) & ~0x0100 & 0xffff);
  disable_bullet_time();
  check_sprite_underwater();
  if ((reg.a & 0xffff) === 0x0002) {
    // CODE_B8CD57
    const s = cur();
    w16(s + sprite.y_speed, 0);
    w16(s + sprite.max_y_speed, 0);
    reg.x = s;
    set_swimming_state();
    return;
  }
  const animal = r16(R.animal_type);
  if (!animal) {
    w16(cur() + sprite.state, 0x0001);
    return;
  }
  // CODE_B8CD60
  if (animal === C.sprite_squawks) {
    w16(reg.x + sprite.state, 0x0010);
    return;
  }
  start_player_faster_falling();
}

/** Whether the follower Kong's current state allows swapping (kong_state_flags_table bit 4). */
function followerCanSwap(): boolean {
  const y = r16(R.inactive_kong_sprite);
  reg.y = y;
  const idx = (r16(y + sprite.state) << 2) & 0xffff;
  reg.x = idx;
  return (rom16(KONG_STATE_FLAGS_TABLE + idx) & 0x0010) !== 0;
}

/** $B8CD6F — select: swap the lead Kong. */
export function swap_to_other_kong_action() {
  reg.x = cur();
  if (!(pressed() & C.input_select)) return;
  if (!followerCanSwap()) return;
  if (!(r16(R.game_state_flags) & 0x4000)) return;
  CODE_B8C559();
}

/**
 * $B8CD97 — walk along the floor from ($72, $74) for |$7C| steps of 1 pixel in the sign of $7C,
 * following slopes; carry set if the floor is missing or changes by 8 pixels or more.
 */
export function CODE_B8CD97() {
  const n = r16(0x7c);
  if (isNeg(n)) {
    w16(0x7c, neg(n));
    w16(0x7e, 0xffff);
  } else {
    w16(0x7e, 0x0001);
  }
  for (;;) {
    w16(0x34, r16(0x74));
    reg.a = r16(0x72);
    jslLabel(GET_TERRAIN_INFO_DEFINE_X);
    let a = reg.a & 0xffff;
    if (isNeg(a)) {
      reg.c = true;
      return;
    }
    a = ((a ^ 0xffff) + 0x6301) & 0xffff;
    w16(0x34, a);
    let d = (a - r16(0x74)) & 0xffff;
    if (isNeg(d)) d = neg(d);
    if (!cmpNeg(d, 0x0008)) {
      reg.c = true;
      return;
    }
    w16(0x74, r16(0x34));
    const left = (r16(0x7c) - 1) & 0xffff;
    w16(0x7c, left);
    if (!left) {
      reg.c = false;
      return;
    }
    w16(0x72, r16(0x72) + r16(0x7e));
  }
}

/** $B8CDE8 — select while swimming: swap Kongs through the swap interaction. */
export function swap_to_other_kong_swimming_action() {
  if (!(r16(R.game_state_flags) & 0x4000)) return;
  if (!followerCanSwap()) return;
  interaction(C.player_interaction_01);
}

// ---------------------------------------------------------------------------------------------
// "No button" actions
// ---------------------------------------------------------------------------------------------

/** $B8CE09 */
export function stop_walk_action() {
  w16(cur() + sprite.max_x_speed, 0);
}

/** $B8CE0E — no action */
export function roll_no_left_right_action() {}

/** $B8CE0F */
export function stop_debug_x_move_action() {
  w16(cur() + sprite.x_speed, 0);
}

/** $B8CE14 */
export function stop_barrel_cannon_x_move_action() {
  w16(cur() + sprite.max_x_speed, 0);
}

/** $B8CE19 */
export function return_sprite_no_up_down_no_action() {
  reg.x = cur();
}

/** $B8CE1C — down released: stand up. */
export function stop_crouch_action() {
  const x = cur();
  reg.x = x;
  if (held() & C.input_down) return;
  w16(x + sprite.state, 0);
  anim(0x000e);
}

/** $B8CE34 */
export function stop_debug_y_move_action() {
  w16(cur() + sprite.y_speed, 0);
}

/** $B8CE39 */
export function CODE_B8CE39() {
  reg.x = cur();
  set_player_terminal_velocity();
  set_player_normal_gravity();
}

/** $B8CE42 */
export function stop_barrel_cannon_y_move_action() {
  w16(cur() + sprite.max_y_speed, 0);
}

/** $B8CE47 */
export function stop_vertical_rope_climb_action() {
  w16(cur() + sprite.max_y_speed, 0);
}

/** $B8CE4C */
export function CODE_B8CE4C() {
  const v = spriteConst(0x0078);
  w16(ctlVars() + kong_control.max_fall_speed, v);
}

/** $B8CE57 — Quawks (Squawks' purple cousin) slow descent. */
export function quawks_normal_descent_action() {
  reg.x = cur();
  set_player_normal_gravity();
  set_player_terminal_velocity();
  w16(ctlVars() + kong_control.max_fall_speed, 0x0100);
}

/** $B8CE68 */
export function clear_target_y_velocity_action() {
  w16(cur() + sprite.max_y_speed, 0);
}

/** $B8CE6D — B released during a jump: normal (heavier) gravity. */
export function stop_holding_jump_action() {
  reg.x = cur();
  set_player_normal_gravity();
}

/** $B8CE73 — no action */
export function CODE_B8CE73() {}

/** $B8CF14 — no action */
export function no_b_action() {}

/** $B8CF15 */
export function clear_fast_move_y_action() {
  const ctl = ctlVars();
  w16(ctl + kong_control.fast_flag, r16(ctl + kong_control.fast_flag) & 0xfffb);
}

/** $B8CF23 — Y released while carrying: throw (or put down with down held on the ground). */
export function stop_carrying_sprite_action() {
  const x = cur();
  if (r16(x + sprite.animation_flags) & 0x0004) return;
  if (held() & C.input_down && r16(x + sprite.terrain_interaction) & 0x0001) anim(0x0013);
  else anim(0x0014);
}

register({
  horizontal_rope_climb_left_action,
  swim_left_action,
  stuck_on_honey_floor_left_action,
  move_enguarde_left_action,
  wind_float_move_left_action,
  enguarde_on_land_move_left_action,
  rambi_charge_move_left_action,
  enguarde_charge_move_left_action,
  walk_right_action,
  CODE_B8C3C1,
  roll_right_action,
  debug_fly_right_action,
  shot_from_cannon_move_right_action,
  move_barrel_cannon_right_action,
  single_rope_climb_right_action,
  double_rope_climb_right_action,
  horizontal_rope_climb_right_action,
  swim_right_action,
  stuck_on_honey_floor_right_action,
  move_enguarde_right_action,
  wind_float_move_right_action,
  enguarde_on_land_move_right_action,
  rambi_charge_move_right_action,
  enguarde_charge_move_right_action,
  dismount_animal_action,
  CODE_B8C559,
  jump_action,
  start_player_jumping,
  update_b_press_event_action,
  squawks_fly_up_action,
  jump_off_vertical_rope_action,
  vertical_double_rope_b_action,
  jump_off_horizontal_rope_action,
  jump_off_hook_action,
  swim_up_action,
  jump_off_honey_wall_action,
  get_honey_wall_jump_direction,
  team_up_action,
  check_if_player_has_both_kongs,
  animal_special_action,
  shoot_web_platform,
  scan_for_web_platforms,
  roll_or_pickup_object_action,
  apply_roll_animation,
  glide_action,
  update_roll_action,
  land_animal_attack_action,
  start_rambi_attack,
  squawks_shoot_action,
  shot_from_cannon_move_faster_action,
  team_throw_action,
  enable_fast_move_from_y_action,
  update_object_pickup,
  set_fast_move_if_left_right,
  start_player_roll,
  set_fast_move_if_left_right_y_action,
  enguarde_attack_action,
  coop_take_control_y_action,
  start_enguarde_attack,
  shoot_web_platform_l_action,
  shoot_web_platform_r_action,
  shoot_web_platform_lr,
  pause_game_action,
  stop_debug_fly_action,
  coop_take_control_start_action,
  transfer_control_of_player,
  swap_to_other_kong_action,
  CODE_B8CD97,
  swap_to_other_kong_swimming_action,
  stop_walk_action,
  roll_no_left_right_action,
  stop_debug_x_move_action,
  stop_barrel_cannon_x_move_action,
  return_sprite_no_up_down_no_action,
  stop_crouch_action,
  stop_debug_y_move_action,
  CODE_B8CE39,
  stop_barrel_cannon_y_move_action,
  stop_vertical_rope_climb_action,
  CODE_B8CE4C,
  quawks_normal_descent_action,
  clear_target_y_velocity_action,
  stop_holding_jump_action,
  CODE_B8CE73,
  no_b_action,
  clear_fast_move_y_action,
  stop_carrying_sprite_action,
});
