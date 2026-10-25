/**
 * Bank $B3 — Cat O' 9 Tails ($B3CCDC, spins the Kong around and throws him), Kloak ($B3D008,
 * the ghost that throws barrels, chests and cannonballs) and the objects Kloak throws
 * ($B3D2F9).
 */
import { r16, w16, rom16, bus16 } from "../../core/mem";
import { reg } from "../../core/cpu";
import { L, R, C, sprite } from "../../core/sym";
import {
  check_throwable_collision_global,
  check_if_sprite_offscreen_global,
  get_current_sprite_clipping,
  CODE_BEBE8B,
  CODE_BEBE8E,
  CODE_BBBB99,
  CODE_B3C6C0,
  CODE_B3B28E,
  CODE_B3CB55,
  CODE_B3A3EB,
  CODE_B39EBE,
  apply_sprite_gravity,
  defeat_sprite_using_animation,
  process_sprite_animation,
  process_current_movement,
  process_terrain_interaction_global,
  set_sprite_animation,
  set_player_interaction_global,
  get_random_number_2_global,
  delete_sprite_handle_deallocation,
  spawn_special_sprite_index,
  spawn_special_sprite_address,
  spawn_BB83EF_special_sprite_index,
  spawn_barrel_parts_and_smoke_global,
  queue_sound_effect,
} from "../../gen/routines";
import {
  cur, sr, sw, neg, isNeg, asr1, sound, spriteConst, spriteStateHandler, returnHandleDespawn,
  fallOffScreen, process_alternate_movement_B3, process_sprite_anim_preserve_flags,
  registerSprite, registerRts,
} from "./b3c_common";

const constBank = () => r16(R.current_sprite_constants_bank) & 0xff;
/** `LDA [current_sprite_constants]` */
const constWord0 = () => bus16(((constBank() << 16) | r16(R.current_sprite_constants)) & 0xffffff);

/** Shared "hit": face away from the attacker and get knocked up and away (movement 4). */
function knockAwayFromAttacker() {
  const attacker = r16(R.colliding_sprite);
  reg.x = attacker;
  const dir = sr(attacker, sprite.oam_property) & 0x4000;
  const x = cur();
  reg.x = x;
  const oam = sr(x, sprite.oam_property);
  const v = ((((dir ^ oam) & 0x4000) ^ oam) ^ 0x4000) & 0xffff;
  sw(x, sprite.oam_property, v);
  const speed = v & 0x4000 ? 0x0100 : 0xff00;
  sw(x, sprite.max_x_speed, speed);
  sw(x, sprite.x_speed, speed);
  sw(x, sprite.y_speed, 0xfa00);
  reg.a = 0x0004;
  sw(x, sprite.movement_state, 0x0004);
  reg.c = true;
}

// =============================================================================================
// Cat O' 9 Tails

const CAT_TABLE = L("cat_o9tails_main") + 3;

/** $B3CCDC — Cat O' 9 Tails. Display mode ($1C) is the timer before it starts/stops spinning. */
export function cat_o9tails_main() {
  spriteStateHandler(CAT_TABLE);
}

/** $B3CCF1 — state 0: wait out the timer, then go idle. */
export function cat_o9tails_main_state_0() {
  const x = reg.y;
  reg.x = x;
  const t = sr(x, sprite.display_mode);
  let advance = t === 0;
  if (!advance) {
    sw(x, sprite.display_mode, t - 1);
    advance = ((t - 1) & 0xffff) === 0;
  }
  if (advance) sw(x, sprite.state, sr(x, sprite.state) + 1);
  catMove();
}

/** $B3CCFC — the cat's normal frame: collisions, animation and movement. */
function catMove() {
  if (sr(reg.x, sprite.movement_state) === 0x018d) {
    CODE_B3CF60();
    if (reg.c) return;
  } else {
    reg.a = 0x5428;
    CODE_B3CF41();
    if (reg.c) return;
  }
  process_sprite_animation();
  reg.a = 0x0022;
  process_alternate_movement_B3();
  CODE_BBBB99();
}

/** $B3CD23 — idle: wait for the Kong to come in range ($42/$44). */
export function cat_o9tails_main_idle() {
  const x = reg.y;
  reg.x = x;
  reg.a = sr(x, sprite.general_purpose_42);
  reg.y = sr(x, sprite.general_purpose_44);
  CODE_B3C6C0();
  if (reg.c) return catMove();
  sw(reg.x, sprite.state, sr(reg.x, sprite.state) + 1);
  cat_o9tails_main_state_2();
}

/** $B3CD2F — state 2: start chasing (movement state = chase animation) for $48 frames. */
export function cat_o9tails_main_state_2() {
  let x = cur();
  reg.x = x;
  const movement = sr(x, sprite.movement_state);
  if (movement === 0) return catMove();
  reg.a = movement;
  set_sprite_animation();
  x = reg.x;
  sw(x, sprite.unknown_22, 0);
  sw(x, sprite.max_x_speed, sr(x, sprite.general_purpose_46));
  sw(x, sprite.display_mode, sr(x, sprite.general_purpose_48));
  sw(x, sprite.state, sr(x, sprite.state) + 1);
  reg.x = x;
  returnHandleDespawn();
}

/** $B3CD48 — state 3: chase until the timer runs out. */
export function cat_o9tails_main_state_3() {
  if (sr(reg.y, sprite.animation_id) !== C.cat_o_9_tails_chase_anim_id) {
    reg.a = 0x5428;
    CODE_B3CF41();
    if (reg.c) return;
    reg.x = cur();
    process_sprite_animation();
    reg.a = 0x0022;
    process_alternate_movement_B3();
    return returnHandleDespawn();
  }
  let x = cur();
  reg.x = x;
  const t = sr(x, sprite.display_mode);
  if (t === 0) {
    sw(x, sprite.state, sr(x, sprite.state) + 1);
    process_sprite_animation();
    return;
  }
  sw(x, sprite.display_mode, t - 1);
  CODE_B3CF60();
  if (reg.c) return;
  x = cur();
  reg.x = x;
  reg.a = 0x0000;
  CODE_B3B28E();
  process_sprite_animation();
  reg.a = 0x0022;
  process_alternate_movement_B3();
  CODE_BBBB99();
}

/** $B3CD96 — state 4: stop and go back to waiting ($4A frames). */
export function cat_o9tails_main_state_4() {
  reg.a = 0x542c;
  CODE_B3CF41();
  if (!reg.c) {
    const x = cur();
    reg.x = x;
    sw(x, sprite.display_mode, sr(x, sprite.general_purpose_4A));
    sw(x, sprite.state, 0);
    sw(x, sprite.movement_state, 0);
    sw(x, sprite.max_x_speed, 0);
    sw(x, sprite.x_speed, 0);
    reg.a = C.cat_o_9_tails_idle_anim_id;
    if (reg.a !== sr(x, sprite.animation_id)) set_sprite_animation();
  }
  reg.a = 0x0022;
  process_alternate_movement_B3();
}

/** $B3CDC0 — state 5: spinning with the Kong held. */
export function cat_o9tails_main_state_5() {
  reg.a = 0x0118;
  check_throwable_collision_global();
  if (reg.c) {
    CODE_B3CF7F();
    w16(0x0ae8, 0);
    reg.a = C.player_interaction_1B;
    set_player_interaction_global();
    return;
  }
  check_if_sprite_offscreen_global();
  if (reg.c) {
    reg.a = C.player_interaction_29;
    set_player_interaction_global();
    delete_sprite_handle_deallocation();
    return;
  }
  reg.a = 0x0022;
  process_alternate_movement_B3();
  process_sprite_animation();
  spin_cat_o9_tails_with_kong();
}

/** $B3CDFD — state 6: throw the Kong (speeds from the constants block in $4C, randomised). */
export function cat_o9tails_main_state_6() {
  reg.a = C.player_interaction_14;
  set_player_interaction_global();
  if (!reg.c) {
    const x = cur();
    reg.x = x;
    w16(R.current_sprite_constants, sr(x, sprite.general_purpose_4C));
    const w0 = constWord0();
    w16(0x0a87, w0);
    w16(R.interaction_RAM_0A86, w0 & 0x00ff);
    w16(0x0a89, 0);
    get_random_number_2_global();
    const rnd = reg.a & 0xffff;
    w16(0x32, rnd >> 1);
    reg.y = 0x0004;
    let a = spriteConst(4);
    if (rnd & 1) a = asr1(a);
    const t = r16(0x32);
    w16(0x32, t >> 1);
    const carry = t & 1;
    if (carry) a ^= 0xffff;
    reg.y = 0x0002;
    a = (a + spriteConst(2) + carry) & 0xffff;
    w16(R.interaction_RAM_0A8A, a);
    reg.y = 0x0006;
    w16(R.interaction_RAM_0A8C, spriteConst(6));
    sw(x, sprite.state, sr(x, sprite.state) + 1);
    w16(0x0ae8, 0);
  }
  process_sprite_animation();
  w16(R.current_sprite_constants, sr(reg.x, sprite.constants_address));
  reg.a = 0x0022;
  process_alternate_movement_B3();
  returnHandleDespawn();
}

/** $B3CE59 — state 7: after the throw. */
export function cat_o9tails_main_state_7() {
  reg.a = 0x542c;
  CODE_B3CF41();
  if (!reg.c) process_sprite_animation();
  reg.a = 0x0022;
  process_alternate_movement_B3();
  returnHandleDespawn();
}

/** $B3CE6E — defeated: fall off the screen. */
export function cat_o9tails_main_defeated() {
  process_current_movement();
  process_sprite_animation();
  fallOffScreen();
}

const SPIN_X = L("spin_cat_o9_tails_with_kong_x_pos_offset_table");
const SPIN_Y = L("spin_cat_o9_tails_with_kong_y_pos_offset_table");
const SPIN_FLIP = L("spin_cat_o9_tails_with_kong_horizontal_flip_table");
const SPIN_ORDER = L("spin_cat_o9_tails_with_kong_render_order_table");

/** $B3CE80 — hold the Kong(s) at the cat's hands for the current spin frame. */
export function spin_cat_o9_tails_with_kong() {
  const x = cur();
  reg.x = x;
  reg.db = 0xb3; // PHK : PLB (not restored)
  const i = ((((sr(x, sprite.current_graphic) - C.cat_o_9_tails_spin_frame1) & 0xffff) >> 2) << 1) & 0xffff;
  let dx = rom16(SPIN_X + i);
  if (sr(x, sprite.oam_property) & 0x4000) dx = neg(dx);
  w16(0x32, dx);
  const dy = rom16(SPIN_Y + i);
  w16(0x34, dy);
  const flip = rom16(SPIN_FLIP + i);
  w16(0x36, flip);
  sw(x, sprite.render_order, rom16(SPIN_ORDER + i));
  const hold = (kong: number) => {
    reg.y = kong;
    sw(kong, sprite.x_position, sr(x, sprite.x_position) + dx);
    const ny = sr(x, sprite.y_position) + dy;
    reg.c = ny > 0xffff;
    sw(kong, sprite.y_position, ny);
    sw(kong, sprite.y_speed, 0);
    const oam = sr(kong, sprite.oam_property);
    reg.a = (((flip ^ oam) & 0x4000) ^ oam) & 0xffff;
    sw(kong, sprite.oam_property, reg.a);
  };
  hold(r16(R.active_kong_sprite));
  reg.a = r16(R.game_state_flags);
  if (!(reg.a & 0x4000)) return; // no second Kong
  hold(r16(R.inactive_kong_sprite));
}

/** $B3CF41 — collisions with throwables, then with the Kong (A = Kong collision flags). */
export function CODE_B3CF41() {
  w16(0x0dc6, reg.a);
  reg.a = 0x0118;
  check_throwable_collision_global();
  if (reg.c) return CODE_B3CF7F();
  CODE_B3CFE6();
  if (!reg.c) return;
  get_current_sprite_clipping();
  reg.a = r16(0x0dc6);
  CODE_BEBE8B();
  if (reg.c) CODE_B3CF7F();
}

/** $B3CF60 — the same while chasing: the Kong may grab the cat. */
export function CODE_B3CF60() {
  reg.a = 0x0118;
  check_throwable_collision_global();
  if (reg.c) return CODE_B3CF7F();
  CODE_B3CFE6();
  if (!reg.c) return;
  get_current_sprite_clipping();
  reg.a = 0x5c00;
  reg.y = 0x0010;
  CODE_BEBE8E();
  if (reg.c) CODE_B3CF7F();
}

/**
 * $B3CF7F — react to a collision (Z / A from the collision check): defeated (Z), stunned
 * (1 -> state 4) or grabbed the Kong (3 -> spin, state 5). Carry set when handled.
 */
export function CODE_B3CF7F() {
  const x = reg.x;
  if (reg.z) {
    sw(x, sprite.state, 0x0008);
    reg.a = C.cat_o_9_tails_death_anim_id;
    defeat_sprite_using_animation();
    return knockAwayFromAttacker();
  }
  const a = reg.a & 0xffff;
  if (a === 1) {
    reg.a = 0x0004;
    sw(x, sprite.state, 0x0004);
    reg.c = true;
    return;
  }
  if (a === 3) {
    sw(x, sprite.state, 0x0005);
    sw(x, sprite.max_x_speed, 0);
    reg.a = C.cat_o_9_tails_spin_anim_id;
    set_sprite_animation();
    sw(reg.x, sprite.animation_speed, 0x0055);
    w16(0x0ae8, reg.x);
    reg.c = true;
    return;
  }
  reg.c = false;
}

/** $B3CFE6 — carry clear when the Kong cannot be hurt/grabbed now (in a special state). */
export function CODE_B3CFE6() {
  reg.c = false;
  reg.a = r16(R.current_interaction);
  if (reg.a === C.player_interaction_13) return;
  const kong = r16(R.active_kong_sprite);
  reg.y = kong;
  const st = sr(kong, sprite.state);
  reg.a = st;
  if (st === C.kong_state_48) return;
  if (st === C.kong_state_12) {
    reg.a = (sr(kong, sprite.y_speed) - 1) & 0xffff;
    if (isNeg(reg.a)) return;
  }
  reg.c = true;
}

// =============================================================================================
// Kloak

const KLOAK_TABLE = L("kloak_main") + 3;

/**
 * $B3D008 — Kloak. $10 holds the constants of what it throws, $1E the thrown sprite while it
 * is held.
 */
export function kloak_main() {
  spriteStateHandler(KLOAK_TABLE);
}

/** $B3D019 — state 0: float along the movement script. */
export function CODE_B3D019() {
  CODE_B3D184();
  if (!reg.c) {
    CODE_B3CB55();
    if (reg.z) process_sprite_animation();
  }
  process_current_movement();
  const x = cur();
  reg.x = x;
  if (sr(x, sprite.state) & 0x0800) {
    CODE_B3A3EB();
    return;
  }
  returnHandleDespawn();
}

/** $B3D03E — state 1: a puff of smoke, then pick up the object (state 2). */
export function CODE_B3D03E() {
  reg.y = C.special_sprite_spawn_id_0008;
  spawn_special_sprite_index();
  if (reg.c) return kloakAnimate();
  const x = cur();
  reg.x = x;
  sw(x, sprite.state, sr(x, sprite.state) + 1);
  CODE_B3D04B();
}

/** $B3D04B — state 2: spawn the object to throw and hold it. */
export function CODE_B3D04B() {
  CODE_B3D184();
  if (reg.c) return;
  const x = cur();
  reg.x = x;
  w16(R.current_sprite_constants, sr(x, sprite.terrain_attributes));
  reg.a = constWord0();
  reg.y = reg.a;
  spawn_special_sprite_address();
  if (!reg.c) {
    CODE_B3D0F1();
    const x2 = cur();
    reg.x = x2;
    sw(x2, sprite.state, sr(x2, sprite.state) + 1);
    CODE_B3D1D9();
  }
  kloakAnimate();
}

/** $B3D069 */
function kloakAnimate() {
  const y = cur();
  reg.y = y;
  w16(R.current_sprite_constants, sr(y, sprite.constants_address));
  process_sprite_anim_preserve_flags();
}

/** $B3D077 — Kloak was hit while holding: release the held object. */
function kloakReleaseHeld() {
  const y = cur();
  reg.y = y;
  const held = sr(y, sprite.terrain_interaction);
  reg.x = held;
  if (held === 0) return;
  sw(held, sprite.movement_state, sr(held, sprite.movement_state) & 0xff7f);
  sw(held, sprite.terrain_interaction, 0);
}

/** $B3D089 — state 3: hold the object up during the throw animation. */
export function CODE_B3D089() {
  CODE_B3D184();
  if (reg.c) return kloakReleaseHeld();
  process_sprite_anim_preserve_flags();
  CODE_B3D1D9();
}

/** $B3D098 — state 4: let go of the object (it flies with its thrown movement). */
export function CODE_B3D098() {
  const y = reg.y;
  reg.x = y;
  sw(y, sprite.terrain_attributes, 0);
  sw(y, sprite.state, sr(y, sprite.state) + 1);
  const held = sr(y, sprite.terrain_interaction);
  reg.x = held;
  if (held !== 0) {
    sw(held, sprite.movement_state, sr(held, sprite.movement_state) & 0xff7f);
    if (!isNeg(sr(held, 0x3f))) sw(held, sprite.terrain_interaction, 0);
  }
  CODE_B3D0AE();
}

/** $B3D0AE — state 5: finish the throw animation, then back to state 0. */
export function CODE_B3D0AE() {
  CODE_B3D184();
  if (reg.c) return;
  const y = reg.y;
  const held = sr(y, sprite.terrain_interaction);
  reg.x = held;
  if (held !== 0) {
    process_current_movement();
    process_sprite_anim_preserve_flags();
    return;
  }
  // CODE_B3D0C2 (8-bit): state = 0; restart the script when it waits in mode 4
  w16(y + sprite.state, r16(y + sprite.state) & 0xff00);
  const sub = r16(y + sprite.sub_state) & 0xff;
  if ((sub & 0x07) === 0x04) w16(y + sprite.sub_state, (r16(y + sprite.sub_state) & 0xff00) | (sub & 0x08));
  CODE_B3D019();
}

/** $B3D0DF — state 6: defeated. */
export function CODE_B3D0DF() {
  process_current_movement();
  process_sprite_animation();
  if (sr(reg.x, sprite.terrain_interaction) !== 0) return;
  fallOffScreen();
}

/**
 * $B3D0F1 — the object just spawned (alternate_sprite) is held by Kloak: it is set up as
 * "thrown by an enemy" (bit 7 of its state; see CODE_B3D249) with the throw movement from the
 * Kloak's constants, its own movement saved in the Kloak's record.
 */
export function CODE_B3D0F1() {
  const y = cur();
  const x = r16(R.alternate_sprite);
  reg.y = y;
  reg.x = x;
  sw(y, sprite.terrain_interaction, x);
  sw(x, sprite.placement_number, y);
  sw(x, sprite.despawn_time, 0x3c3c);
  sw(x, sprite.carry_or_defeat_flags, 0);
  sw(x, sprite.render_order, sr(y, sprite.render_order) - 1);
  const kloakOam = sr(y, sprite.oam_property);
  w16(0x32, kloakOam);
  let oam = (((kloakOam ^ sr(x, sprite.oam_property)) & 0xb000) ^ sr(x, sprite.oam_property)) & 0xffff;
  sw(x, sprite.oam_property, oam);
  if (!(kloakOam & 0x4000)) {
    oam ^= 0x4000;
    sw(x, sprite.oam_property, oam);
    sw(x, sprite.x_speed, neg(sr(x, sprite.x_speed)));
    sw(x, sprite.max_x_speed, neg(sr(x, sprite.max_x_speed)));
  }
  // save the object's own movement in the Kloak (restored by CODE_B3D295)
  sw(y, sprite.ground_y_position, sr(x, sprite.x_sub_position));
  sw(y, sprite.ground_distance, sr(x, sprite.x_speed));
  sw(y, sprite.animation_flags, sr(x, sprite.y_sub_position));
  sw(y, sprite.unknown_5C, sr(x, sprite.y_speed));
  sw(y, sprite.display_mode, sr(x, sprite.movement_sub_state) & 0x00ff);
  const c8 = spriteConst(8);
  sw(x, sprite.movement_state, ((((sr(x, sprite.movement_state - 1) ^ c8) & 0xff00) ^ c8) | 0x0080) & 0xffff);
  sw(x, sprite.state, sr(x, sprite.state) | 0x0080);
  sw(x, sprite.animation_flags, spriteConst(9) & 0x00ff);
  sw(x, sprite.terrain_interaction, spriteConst(10));
  let vx = spriteConst(2);
  if (kloakOam & 0x4000) vx = neg(vx);
  sw(x, sprite.x_speed, vx);
  reg.y = 0x0004;
  reg.a = spriteConst(4);
  sw(x, sprite.y_speed, reg.a);
}

/**
 * $B3D184 — collisions: carry set when Kloak was defeated (state 6), clear otherwise
 * (also when it hurt the Kong).
 */
export function CODE_B3D184() {
  reg.a = 0x0118;
  check_throwable_collision_global();
  if (!reg.c) {
    get_current_sprite_clipping();
    reg.a = 0x5428;
    CODE_BEBE8B();
    if (!reg.c) return;
  }
  if (!reg.z) {
    reg.c = false;
    return;
  }
  sw(reg.x, sprite.state, 0x0006);
  reg.a = C.kloak_death_anim_id;
  defeat_sprite_using_animation();
  knockAwayFromAttacker();
}

const KLOAK_HOLD_OFFSETS = L("DATA_B3D221");

/** $B3D1D9 — keep the held object at Kloak's hands for the current throw frame. */
export function CODE_B3D1D9() {
  reg.db = 0xb3; // PHK : PLB (not restored)
  const x = cur();
  reg.x = x;
  w16(R.current_sprite_constants, sr(x, sprite.terrain_attributes));
  reg.y = 0x0006;
  w16(0x34, spriteConst(6));
  const frame = (sr(x, sprite.current_graphic) - C.kloak_throw_frame4) & 0xffff;
  reg.a = frame;
  if (frame >= 0x0031) {
    reg.c = true;
    return;
  }
  reg.y = frame;
  const dx = ((r16(0x34) & 0xff) - rom16(KLOAK_HOLD_OFFSETS + frame)) & 0xffff;
  w16(0x32, dx);
  const dy = ((r16(0x35) & 0xff) - rom16(KLOAK_HOLD_OFFSETS + 2 + frame)) & 0xffff;
  const held = sr(x, sprite.terrain_interaction);
  reg.y = held;
  sw(held, sprite.y_position, dy + sr(x, sprite.y_position));
  let ox = dx;
  if (sr(x, sprite.oam_property) & 0x4000) ox = neg(ox);
  const sum = ox + sr(x, sprite.x_position);
  reg.c = sum > 0xffff;
  reg.a = sum & 0xffff;
  sw(held, sprite.x_position, reg.a);
}

// =============================================================================================
// Objects thrown by Kloak (and by Target Terror's Klanks)

const THROWN_TABLE = L("thrown_kloak_projectile_main") + 3;

/**
 * $B3D2F9 — a barrel / chest / cannonball / TNT thrown by Kloak. State 0: barrel, 1: TNT,
 * 2: rolling barrel, 3: chest, 4: cannonball. A chest or cannonball that lands turns into the
 * real item (sprite type change).
 */
export function thrown_kloak_projectile_main() {
  spriteStateHandler(THROWN_TABLE);
}

/** $B3D306 — state 0: a barrel; it breaks on walls and floors. */
export function CODE_B3D306() {
  CODE_B3D3F9();
  if (!reg.c) process_sprite_animation();
  returnHandleDespawn();
}

/** $B3D312 — state 1: TNT barrel, explodes on any contact. */
export function CODE_B3D312() {
  apply_sprite_gravity();
  CODE_B39EBE();
  process_terrain_interaction_global();
  const x = cur();
  reg.x = x;
  let boom = (sr(x, sprite.terrain_interaction) & 0x0003) !== 0;
  if (!boom) {
    reg.a = 0x0000;
    CODE_B3D44A();
    boom = reg.c;
  }
  if (!boom) {
    process_sprite_animation();
    return returnHandleDespawn();
  }
  reg.a = sound(4, "boom");
  queue_sound_effect();
  reg.a = sound(6, "explosion");
  queue_sound_effect();
  reg.y = C.special_sprite_spawn_id_00D4;
  spawn_BB83EF_special_sprite_index();
  reg.y = C.special_sprite_spawn_id_00D2;
  spawn_BB83EF_special_sprite_index();
  delete_sprite_handle_deallocation();
  CODE_B3D354(); // falls through (on the deleted sprite)
}

/** $B3D354 — state 2: a barrel that breaks when it lands. */
export function CODE_B3D354() {
  CODE_B3D3F9();
  if (reg.c) return returnHandleDespawn();
  if ((sr(reg.x, sprite.terrain_interaction) & 0x0101) === 0) {
    process_sprite_animation();
    return returnHandleDespawn();
  }
  barrelBreak();
}

/** $B3D367 / $B3D425 — break into barrel pieces. */
function barrelBreak() {
  reg.a = sound(5, "barrel_blast");
  queue_sound_effect();
  spawn_barrel_parts_and_smoke_global();
  delete_sprite_handle_deallocation();
}

/** $B3D379 — state 3: a chest; bounces off the Kong, becomes a real chest when it lands. */
export function CODE_B3D379() {
  apply_sprite_gravity();
  CODE_B39EBE();
  process_terrain_interaction_global();
  const x = cur();
  reg.x = x;
  reg.a = 0xff7b;
  CODE_B3D44A();
  if (reg.c) {
    const x = reg.x;
    sw(x, sprite.x_speed, neg(sr(x, sprite.x_speed)));
    sw(x, sprite.max_x_speed, 0);
    sw(x, sprite.y_speed, 0);
    reg.a = 0x1003;
    sw(x, sprite.state, 0x1003);
    return;
  }
  if ((sr(reg.x, sprite.terrain_interaction) & 0x0101) === 0) {
    process_sprite_animation();
    return returnHandleDespawn();
  }
  reg.a = C.sprite_chest;
  reg.y = 0x0000;
  CODE_B3D435();
}

/** $B3D3B7 — state 4: a cannonball; becomes a real cannonball when it lands. */
export function CODE_B3D3B7() {
  apply_sprite_gravity();
  CODE_B39EBE();
  process_terrain_interaction_global();
  const x = cur();
  reg.x = x;
  reg.a = 0x0000;
  CODE_B3D44A();
  if (reg.c) {
    const x = reg.x;
    sw(x, sprite.x_speed, neg(asr1(sr(x, sprite.x_speed))));
    sw(x, sprite.max_x_speed, 0);
    sw(x, sprite.y_speed, 0);
    reg.a = 0x1004;
    sw(x, sprite.state, 0x1004);
    return;
  }
  if ((sr(reg.x, sprite.terrain_interaction) & 0x0101) === 0) {
    process_sprite_animation();
    return returnHandleDespawn();
  }
  reg.a = C.sprite_canball;
  reg.y = 0x0003;
  CODE_B3D435();
}

/**
 * $B3D3F9 — barrel flight: gravity and terrain; it breaks on a wall (both sides) or when it
 * hits the Kong (carry set when it broke).
 */
export function CODE_B3D3F9() {
  apply_sprite_gravity();
  CODE_B39EBE();
  let x = cur();
  reg.x = x;
  const speed = sr(x, sprite.max_x_speed);
  process_terrain_interaction_global();
  reg.y = speed;
  x = cur();
  reg.x = x;
  const walls = sr(x, sprite.terrain_interaction) & 0x0202;
  if (walls === 0x0202) return CODE_B3D425();
  if (walls !== 0) {
    // keep flying after touching one wall
    sw(x, sprite.max_x_speed, speed);
    sw(x, sprite.x_speed, speed);
  }
  reg.a = 0x4008;
  CODE_B3D44A();
  if (reg.c) CODE_B3D425();
}

/** $B3D425 */
function CODE_B3D425() {
  barrelBreak();
}

/** $B3D435 — turn into the real item: A = new sprite type, Y = its state. */
export function CODE_B3D435() {
  const x = reg.x;
  sw(x, sprite.type, reg.a);
  sw(x, sprite.state, reg.y);
  sw(x, sprite.max_x_speed, 0);
  sw(x, sprite.x_speed, asr1(sr(x, sprite.x_speed)));
  reg.a = 0x0001;
  sw(x, sprite.interaction_flags, 0x0001);
}

/**
 * $B3D44A — collision with throwables, then (unless the sub-state delay is running) with the
 * Kong using flags A. Carry set on a hit.
 */
export function CODE_B3D44A() {
  w16(0x0dc6, reg.a);
  reg.a = 0x0118;
  check_throwable_collision_global();
  if (reg.c) return;
  const x = reg.x;
  if ((sr(x, sprite.sub_state) & 0x00ff) !== 0) {
    // the thrower's own collision is ignored for a few frames (16-bit DEC, carry unchanged)
    const v = (r16(x + sprite.sub_state) - 1) & 0xffff;
    w16(x + sprite.sub_state, v);
    reg.z = v === 0;
    reg.n = isNeg(v);
    return;
  }
  get_current_sprite_clipping();
  reg.a = r16(0x0dc6);
  CODE_BEBE8B();
}

registerSprite({
  cat_o9tails_main, cat_o9tails_main_state_0, cat_o9tails_main_idle, cat_o9tails_main_state_2,
  cat_o9tails_main_state_3, cat_o9tails_main_state_4, cat_o9tails_main_state_5, cat_o9tails_main_state_6,
  cat_o9tails_main_state_7, cat_o9tails_main_defeated,
  kloak_main, CODE_B3D019, CODE_B3D03E, CODE_B3D04B, CODE_B3D089, CODE_B3D098, CODE_B3D0AE, CODE_B3D0DF,
  thrown_kloak_projectile_main, CODE_B3D306, CODE_B3D312, CODE_B3D354, CODE_B3D379, CODE_B3D3B7, CODE_B3D435,
});
registerRts({
  spin_cat_o9_tails_with_kong, CODE_B3CF41, CODE_B3CF60, CODE_B3CF7F, CODE_B3CFE6,
  CODE_B3D0F1, CODE_B3D184, CODE_B3D1D9, CODE_B3D3F9, CODE_B3D44A,
});
