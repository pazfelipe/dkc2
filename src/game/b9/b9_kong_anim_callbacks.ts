/**
 * Bank $B9 — animation callbacks of the Kongs and the animal buddies ($B9D705-$B9E3AE).
 *
 * These are called from the Kong animation scripts through commands 81 (one-shot, RTS) and
 * 84 (continuous per-frame routine). They run with X = current sprite and DB = $B9. Most of
 * them pick the next animation/state from the Kong's situation: carrying a sprite, being an
 * animal, being the inactive (following) Kong, moving or standing.
 */
import { r16, w16 } from "../../core/mem";
import { reg, register } from "../../core/cpu";
import { R, sprite, level, kong_control, C } from "../../core/sym";
import {
  start_player_falling_global,
  set_level_end_fade_global,
  spawn_special_sprite_index,
  spawn_no_gfx_special_sprite_index,
  CODE_B8D4AE,
  CODE_B883D5,
  set_fade_global,
  enable_bullet_time_global,
  set_player_interaction_global,
  set_player_terminal_velocity_global,
  start_player_faster_falling_global,
  disable_enemy_damage_global,
  init_special_player_clipping,
} from "../../gen/routines";
import {
  set_anim_handle_dixie,
  set_anim_handle_animal_and_dixie,
  set_riding_kong_anim_handle_dixie,
  set_inactive_kong_anim_handle_dixie,
} from "./b9_anim_core";
import { abs16, negate, cmpN, isNeg, facesLeft, spriteConstant, dbRead16, dbWrite16, queue_sound_effect, transition_song } from "./b9_anim_util";

const sound = (channel: number, id: number) => ((channel << 8) | id) & 0xffff;

function setDixieAnim(id: number) {
  reg.a = id;
  set_anim_handle_dixie();
}
function setAnimalAnim(id: number) {
  reg.a = id;
  set_anim_handle_animal_and_dixie();
}
/** Negate when the sprite faces left (`BIT oam_property,x : BVC + : EOR #$FFFF : INC A`). */
function towardsFacing(x: number, v: number): number {
  return facesLeft(r16(x + sprite.oam_property)) ? negate(v) : v & 0xffff;
}
/** Facing differs from the direction of max_x_speed (`LSR : EOR oam : AND #$4000`). */
function facingAgainstTarget(x: number): boolean {
  return (((r16(x + sprite.max_x_speed) >> 1) ^ r16(x + sprite.oam_property)) & 0x4000) !== 0;
}
/** Turn the sprite to face the direction of its target speed. */
function faceTargetDirection(x: number) {
  const max = r16(x + sprite.max_x_speed);
  if (!max) return;
  const oam = r16(x + sprite.oam_property);
  w16(x + sprite.oam_property, (((max >> 1) ^ oam) & 0x4000) ^ oam);
}
const isInactiveKong = (x: number) => x === r16(R.inactive_kong_sprite);
/** State of a Kong riding an animal buddy: Squawks $10, Enguarde $50, others 9. */
function animalRideState(animal: number): number {
  if (animal === C.sprite_squawks) return 0x10;
  if (animal === C.sprite_enguarde) return 0x50;
  return 0x09;
}

/** $B9D705 — back to the idle animation that fits the Kong's situation. */
export function CODE_B9D705() {
  const x = r16(R.current_sprite);
  reg.x = x;
  if (isInactiveKong(x)) return setDixieAnim(0x01);
  const held = r16(R.current_held_sprite);
  if (held) {
    if (held === r16(R.inactive_kong_sprite)) {
      // carrying the partner (team-up)
      w16(x + sprite.state, 0x17);
      return setDixieAnim(0x1d);
    }
    w16(x + sprite.state, 0x0c);
    return setDixieAnim(0x10);
  }
  const animal = r16(R.animal_type);
  if (animal) {
    w16(x + sprite.state, animalRideState(animal));
    return setAnimalAnim(0x5e);
  }
  w16(x + sprite.state, isNeg(r16(R.game_state_flags)) ? C.kong_state_1D : 0);
  setDixieAnim(0x01);
}

/** Shared body of $B9D76D/$B9D7E6 for the active Kong: walk (3) or run (4) animation. */
function activeKongMove(x: number, anim: number) {
  const held = r16(R.current_held_sprite);
  if (held) {
    if (held === r16(R.inactive_kong_sprite)) {
      w16(x + sprite.state, 0x17);
      return setDixieAnim(0x1f);
    }
    w16(x + sprite.state, 0x0c);
    return setDixieAnim(0x11);
  }
  const animal = r16(R.animal_type);
  if (animal) {
    w16(x + sprite.state, animalRideState(animal));
    return setAnimalAnim(0x68);
  }
  w16(x + sprite.state, isNeg(r16(R.game_state_flags)) ? C.kong_state_1D : 0);
  setDixieAnim(anim);
}

/** $B9D76D — switch to the walking animation. */
export function CODE_B9D76D() {
  const x = r16(R.current_sprite);
  reg.x = x;
  if (isInactiveKong(x)) {
    w16(x + sprite.state, isNeg(r16(R.game_state_flags)) ? C.kong_state_1E : C.kong_state_22);
    return setDixieAnim(0x03);
  }
  activeKongMove(x, 0x03);
}

/** $B9D7E6 — switch to the running animation. */
export function CODE_B9D7E6() {
  const x = r16(R.current_sprite);
  reg.x = x;
  if (isInactiveKong(x)) {
    w16(x + sprite.state, C.kong_state_22);
    return setDixieAnim(0x04);
  }
  activeKongMove(x, 0x04);
}

/** $B9D853 — the active Kong starts falling. */
export function CODE_B9D853() {
  if (!isInactiveKong(reg.x)) start_player_falling_global();
}

/** $B9D85D — in boss levels, fade out to end the level. */
export function CODE_B9D85D() {
  if (r16(level.type) === C.boss_level_type) set_level_end_fade_global();
}

/** $B9D86B — Diddy's victory dance: spawn his boombox and hold it. */
export function spawn_diddy_boombox() {
  if (r16(R.current_held_sprite)) return;
  reg.y = C.special_sprite_spawn_id_0004;
  spawn_special_sprite_index();
  if (!reg.c) w16(R.current_held_sprite, r16(R.alternate_sprite));
}

/** $B9D880 — spawn the rain cloud (spawn animation). */
export function CODE_B9D880() {
  reg.y = C.special_sprite_spawn_id_001E;
  spawn_special_sprite_index();
}

/** $B9D888 */
export function CODE_B9D888() {
  w16(reg.x + sprite.general_purpose_42, 1);
}

/** $B9D88E */
export function CODE_B9D88E() {
  w16(reg.x + sprite.general_purpose_42, 0);
}

/** $B9D891 — stop horizontal movement. */
export function CODE_B9D891() {
  w16(reg.x + sprite.x_speed, 0);
  w16(reg.x + sprite.max_x_speed, 0);
}

/** $B9D896 — let go of the held sprite (put down). */
export function CODE_B9D896() {
  const held = r16(R.current_held_sprite);
  if (held) dbWrite16(held + sprite.carry_or_defeat_flags, 1);
  reg.y = held;
  reg.x = held;
  CODE_B8D4AE();
  w16(R.current_held_sprite, 0);
}

/** $B9D8AA — the held sprite is being dropped. */
export function CODE_B9D8AA() {
  const held = r16(R.current_held_sprite);
  reg.x = held;
  if (!held) return;
  w16(held + sprite.carry_or_defeat_flags, 2);
  const x = r16(R.current_sprite);
  reg.x = x;
  w16(x + sprite.state, 0x0f);
}

/** Give the released held sprite its throw speeds (from constants xo/yo) and let go of it. */
function launchHeld(x: number, held: number, xConst: number, yConst: number, alsoMax: boolean) {
  const xs = towardsFacing(x, spriteConstant(xConst));
  dbWrite16(held + sprite.x_speed, xs);
  dbWrite16(held + sprite.max_x_speed, alsoMax ? xs : 0);
  dbWrite16(held + sprite.y_speed, spriteConstant(yConst));
  dbWrite16(held + sprite.terrain_interaction, 0);
  reg.x = held;
  reg.y = held;
  CODE_B8D4AE();
  w16(R.current_held_sprite, 0);
}

/** $B9D8BC — throw the held sprite: up (holding UP) or forward. */
export function CODE_B9D8BC() {
  const held = r16(R.current_held_sprite);
  reg.y = held;
  if (!held) return;
  const control = r16(R.current_kong_control_variables);
  const x = r16(R.current_sprite);
  if (!(r16(control + kong_control.input_held) & 0x0800)) {
    // CODE_B9D91C: forward throw
    w16(x + sprite.state, 0x20);
    dbWrite16(held + sprite.state, 0x1f);
    dbWrite16(held + sprite.interaction_flags, dbRead16(held + sprite.interaction_flags) | 0x0010);
    return launchHeld(x, held, 0x3c, 0x3e, false);
  }
  w16(x + sprite.state, 0x2c);
  dbWrite16(held + sprite.interaction_flags, dbRead16(held + sprite.interaction_flags) | 0x0010);
  dbWrite16(held + sprite.state, 0x2b);
  dbWrite16(held + sprite.interaction_flags, dbRead16(held + sprite.interaction_flags) | 0x0008);
  launchHeld(x, held, 0x40, 0x42, false);
}

/** $B9D965 — throw the held sprite with the "carry throw" speeds (up or sideways). */
export function CODE_B9D965() {
  w16(reg.x + sprite.state, 0x3f);
  const held = r16(R.current_held_sprite);
  reg.y = held;
  if (!held) return;
  const control = r16(R.current_kong_control_variables);
  const x = r16(R.current_sprite);
  if (r16(control + kong_control.input_held) & 0x0800) {
    dbWrite16(held + sprite.carry_or_defeat_flags, 6); // thrown upwards
    return launchHeld(x, held, 0x38, 0x3a, true);
  }
  // CODE_B9D9AF: thrown sideways
  dbWrite16(held + sprite.carry_or_defeat_flags, 4);
  launchHeld(x, held, 0x34, 0x36, true);
}

/** $B9D9E6 */
export function CODE_B9D9E6() {
  const x = reg.x;
  w16(x + sprite.max_x_speed, 0);
  w16(x + sprite.x_speed, 0);
  w16(x + sprite.general_purpose_4E, 0);
}

/** $B9D9ED — dash forward at $400. */
export function CODE_B9D9ED() {
  const x = reg.x;
  const v = towardsFacing(x, 0x0400);
  w16(x + sprite.max_x_speed, v);
  w16(x + sprite.general_purpose_4E, v);
}

/** $B9D9FD — (two NOPs then) CODE_B9D9FF. */
export function CODE_B9D9FD() {
  CODE_B9D9FF();
}

/** $B9D9FF — play the victory/death song transition, except in sub-levels and real bonus levels. */
export function CODE_B9D9FF() {
  const type = r16(level.type);
  if (type === C.small_level_type) return;
  if (type === C.bonus_level_type && r16(level.bonus_type) === 0) return;
  reg.a = 0x0001;
  transition_song();
}

/** $B9DA19 */
export function CODE_B9DA19() {
  const x = reg.x;
  w16(x + sprite.x_speed, 0);
  w16(x + sprite.max_x_speed, 0);
  w16(x + sprite.y_speed, 0);
  w16(x + sprite.general_purpose_44, r16(x + sprite.x_position));
  w16(x + sprite.state, C.kong_state_25);
  setDixieAnim(0x3d);
}

/** $B9DA30 — animation speed follows the horizontal speed (at least the default). */
export function CODE_B9DA30() {
  CODE_B9E06F();
  const x = r16(R.current_sprite);
  reg.x = x;
  const quarter = abs16(r16(x + sprite.x_speed)) >> 2;
  w16(0x5e, quarter);
  let v = ((quarter >> 1) + quarter) & 0xffff;
  if (v < C.default_animation_speed) v = C.default_animation_speed;
  w16(x + sprite.animation_speed, v);
}

/** $B9DA50 */
export function CODE_B9DA50() {
  w16(reg.x + sprite.y_speed, 0xf900);
  w16(reg.x + sprite.max_x_speed, 0x0400);
}

/** $B9DA5B */
export function CODE_B9DA5B() {}

/** $B9DA5C */
export function CODE_B9DA5C() {
  CODE_B883D5();
}

/** $B9DA61 — after the death animation: fade out and leave the level. */
export function exit_level_on_death() {
  reg.a = 0x810f;
  set_fade_global();
  w16(R.game_state_flags, r16(R.game_state_flags) | 0x0002);
  w16(R.level_destination_number, 0xffff);
}

/** $B9DA75 — slow motion (bullet time). */
export function CODE_B9DA75() {
  reg.a = 0x0003;
  reg.y = 0x0100;
  enable_bullet_time_global();
}

/** $B9DA80 */
export function CODE_B9DA80() {}

/** $B9DA81 — (unreferenced) exit the level, keeping the entrance and without fadeout. */
export function CODE_B9DA81() {
  w16(R.level_destination_number, r16(R.level_number));
  w16(R.destination_level_entrance_number, r16(R.level_entrance_number));
  reg.a = C.player_interaction_2D;
  set_player_interaction_global();
}

/** $B9DA94 — Diddy is hurt: dizzy sound and stars. */
export function spawn_diddy_hurt_stars() {
  reg.a = sound(5, C.sound_diddy_dizzy);
  queue_sound_effect();
  reg.y = C.special_sprite_spawn_id_0016;
  spawn_special_sprite_index();
}

/** $B9DAA3 — when mounted, the ridden animal takes animation $54. */
export function CODE_B9DAA3() {
  const mount = r16(R.current_player_mount);
  reg.x = mount;
  if (!mount) return;
  reg.a = 0x0054;
  set_riding_kong_anim_handle_dixie();
}

/** $B9DAAF */
export function CODE_B9DAAF() {
  setDixieAnim(0x2c);
}

/** $B9DAB7 — climbing speed follows the vertical speed (at least $70). */
export function CODE_B9DAB7() {
  const x = reg.x;
  if (isInactiveKong(x)) return;
  const ys = r16(x + sprite.y_speed);
  let v: number;
  if (isNeg(ys)) {
    const half = negate(ys) >> 1;
    w16(0x32, half);
    v = ((half >> 1) + half) & 0xffff;
  } else {
    const quarter = ys >> 2;
    w16(0x32, quarter);
    v = ((quarter >> 1) + quarter) & 0xffff;
  }
  if (cmpN(v, 0x0070)) v = 0x0070;
  w16(x + sprite.animation_speed, v);
}

/** $B9DAE0 — rope: turn or climb up/down depending on the input. */
export function CODE_B9DAE0() {
  const x = reg.x;
  if (isInactiveKong(x)) return;
  const max = r16(x + sprite.max_x_speed);
  if (max && isNeg(((r16(x + sprite.oam_property) << 1) ^ 0xffff ^ max) & 0xffff)) return setDixieAnim(0x32);
  const maxY = r16(x + sprite.max_y_speed);
  if (!maxY) return;
  setDixieAnim(isNeg(maxY) ? 0x30 : 0x31);
}

/** $B9DB11 */
export function CODE_B9DB11() {
  setDixieAnim(0x2f);
}

/** $B9DB19 — rope: idle, or climb up/down (without restarting the current one). */
export function CODE_B9DB19() {
  const x = reg.x;
  if (isInactiveKong(x)) return;
  const maxY = r16(x + sprite.max_y_speed);
  if (!maxY) return CODE_B9DB11();
  const anim = isNeg(maxY) ? 0x30 : 0x31;
  const control = r16(R.current_kong_control_variables);
  reg.y = control;
  if (anim === dbRead16(control + kong_control.animation_id)) return;
  setDixieAnim(anim);
}

/** $B9DB45 — rope climbing: speed from vertical speed, turn if needed. */
export function CODE_B9DB45() {
  const x = reg.x;
  if (isInactiveKong(x)) return;
  CODE_B9DAB7();
  const max = r16(x + sprite.max_x_speed);
  if (!max) return;
  if (isNeg(((r16(x + sprite.oam_property) << 1) ^ 0xffff ^ max) & 0xffff)) setDixieAnim(0x32);
}

/** $B9DB64 */
export function CODE_B9DB64() {
  setDixieAnim(0x43);
}

/** $B9DB6C — swimming: slow the animation down, turn if needed. */
export function CODE_B9DB6C() {
  if (isInactiveKong(reg.x)) return;
  CODE_B9DB88();
  const x = reg.x;
  if (!r16(x + sprite.max_x_speed)) return;
  if (facingAgainstTarget(x)) setDixieAnim(0x44);
}

/** $B9DB88 — decay the animation speed by $10 down to the default. */
export function CODE_B9DB88() {
  const x = r16(R.current_sprite);
  reg.x = x;
  let v = (r16(x + sprite.animation_speed) - 0x10) & 0xffff;
  if (cmpN(v, C.default_animation_speed)) v = C.default_animation_speed;
  w16(x + sprite.animation_speed, v);
}

/** $B9DB9B — speed from horizontal speed (at least $140), then turn check. */
export function CODE_B9DB9B() {
  const x = reg.x;
  let v = abs16(r16(x + sprite.x_speed));
  if (v < 0x0140) v = 0x0140;
  w16(x + sprite.animation_speed, v);
  CODE_B9E06C();
}

/** $B9DBB0 — speed up the animation close to the ground. */
export function CODE_B9DBB0() {
  const x = reg.x;
  const ground = r16(x + sprite.ground_y_position);
  if (isNeg(ground)) return;
  const dist = (ground - r16(x + sprite.y_position)) & 0xffff;
  if (isNeg(dist)) return;
  if (cmpN(dist, 0x0010)) w16(x + sprite.animation_speed, 0x0200);
}

/** $B9DBC5 */
export function CODE_B9DBC5() {
  w16(reg.x + sprite.x_speed, 0);
}

/** $B9DBC8 — jump: initial speed (higher when running) and gravity from the constants. */
export function CODE_B9DBC8() {
  const control = r16(R.current_kong_control_variables);
  const x = r16(R.current_sprite);
  const fast = (dbRead16(control + kong_control.fast_flag) & 0x0004) !== 0;
  w16(x + sprite.y_speed, fast ? 0xfb00 : 0xfb80);
  const gravity = spriteConstant(0x9c);
  reg.y = 0x9c;
  reg.x = control;
  w16(control + kong_control.gravity_force, gravity);
}

/** $B9DBF4 */
export function CODE_B9DBF4() {
  w16(reg.x + sprite.y_speed, 0xfec0);
  CODE_B9DBF9();
}

/** $B9DBF9 */
export function CODE_B9DBF9() {
  setAnimalAnim(0x5e);
}

/** $B9DC01 — face the direction of the target speed. */
export function CODE_B9DC01() {
  faceTargetDirection(reg.x);
}

/** $B9DC10 */
export function CODE_B9DC10() {
  w16(R.RAM_0B02, r16(R.RAM_0B02) & ~0x0001);
}

/** $B9DC17 — face the target direction; animation $8B when flag $0B02.0 was set. */
export function CODE_B9DC17() {
  faceTargetDirection(reg.x);
  const flags = r16(R.RAM_0B02);
  w16(R.RAM_0B02, flags & ~0x0001);
  if (flags & 0x0001) setAnimalAnim(0x8b);
}

/** Squawks egg spit: spawn and add the parrot's speed to the egg. */
function spitEgg(id: number) {
  reg.y = id;
  spawn_no_gfx_special_sprite_index();
  if (reg.c) return;
  CODE_B9DC54();
}

/** $B9DC36 */
export function CODE_B9DC36() {
  spitEgg(C.special_sprite_spawn_id_002A);
}

/** $B9DC40 */
export function CODE_B9DC40() {
  spitEgg(C.special_sprite_spawn_id_0028);
}

/** $B9DC4A */
export function CODE_B9DC4A() {
  spitEgg(C.special_sprite_spawn_id_002C);
}

/** $B9DC54 — the spawned egg inherits the current sprite's horizontal speed; spit sound. */
export function CODE_B9DC54() {
  const egg = r16(R.alternate_sprite);
  const me = r16(R.current_sprite);
  w16(egg + sprite.x_speed, (dbRead16(me + sprite.x_speed) + r16(egg + sprite.x_speed)) & 0xffff);
  reg.x = egg;
  reg.y = me;
  reg.a = sound(5, C.sound_squawks_spit);
  queue_sound_effect();
}

/** $B9DC68 — spawn a speed effect when moving at $600 or more. */
export function CODE_B9DC68() {
  if (cmpN(abs16(r16(reg.x + sprite.x_speed)), 0x0600)) return;
  reg.y = C.special_sprite_spawn_id_0054;
  spawn_no_gfx_special_sprite_index();
}

/** $B9DC7D — speed from horizontal speed (at least $140), then turn check. */
export function CODE_B9DC7D() {
  CODE_B9DB9B();
}

/** $B9DC92 */
export function CODE_B9DC92() {}

/** $B9DC93 */
export function CODE_B9DC93() {}

/** $B9DC94 */
export function CODE_B9DC94() {
  w16(R.current_held_sprite, 0);
}

/** $B9DC98 — Dixie's victory dance: spawn her guitar and hold it. */
export function spawn_dixie_guitar() {
  if (r16(R.current_held_sprite)) return;
  reg.y = C.special_sprite_spawn_id_0006;
  spawn_special_sprite_index();
  if (!reg.c) w16(R.current_held_sprite, r16(R.alternate_sprite));
}

/** $B9DCAD — (unreferenced) spawn the unused Dixie hurt tears. */
export function CODE_B9DCAD() {
  reg.y = C.special_sprite_spawn_id_0020;
  spawn_special_sprite_index();
}

/** $B9DCB5 — speed from horizontal speed (at least $E0), then walk/run checks. */
export function CODE_B9DCB5() {
  const x = reg.x;
  let v = abs16(r16(x + sprite.x_speed));
  if (v < 0x00e0) v = 0x00e0;
  w16(x + sprite.animation_speed, v);
  CODE_B9E101();
}

/** $B9DCCA — turn check, then speed from horizontal speed (at least $140). */
export function CODE_B9DCCA() {
  CODE_B9E06F();
  const x = r16(R.current_sprite);
  reg.x = x;
  let v = abs16(r16(x + sprite.x_speed));
  if (v < 0x0140) v = 0x0140;
  w16(x + sprite.animation_speed, v);
}

/** $B9DCE2 */
export function CODE_B9DCE2() {
  w16(reg.x + sprite.animation_speed, C.default_animation_speed);
}

/** $B9DCE8 */
export function CODE_B9DCE8() {
  reg.a = 0x0027;
  set_inactive_kong_anim_handle_dixie();
}

/** $B9DCF0 */
export function CODE_B9DCF0() {
  w16(0x0d80, 0x0001);
}

/** $B9DCF7 */
export function CODE_B9DCF7() {
  w16(0x0d80, 0xffff);
}

/** $B9DCFE — speed 1.5x the horizontal speed (at least $140), then turn check. */
export function CODE_B9DCFE() {
  const x = reg.x;
  const s = abs16(r16(x + sprite.x_speed));
  w16(0x32, s);
  let v = ((s >> 1) + s) & 0xffff;
  if (cmpN(v, 0x0140)) v = 0x0140;
  w16(x + sprite.animation_speed, v);
  CODE_B9E021();
}

/** $B9DD19 */
export function CODE_B9DD19() {}

/** $B9DD1A */
export function CODE_B9DD1A() {
  w16(0x0d80, 0x0001);
}

/** $B9DD21 */
export function CODE_B9DD21() {
  const x = reg.x;
  reg.y = 0x28;
  w16(x + sprite.y_speed, spriteConstant(0x28));
  w16(x + sprite.max_x_speed, 0);
}

/** $B9DD2B — Dixie is hurt: crying sound and tears. */
export function spawn_dixie_hurt_tears() {
  reg.a = sound(5, C.sound_dixie_cry);
  queue_sound_effect();
  reg.y = C.special_sprite_spawn_id_0014;
  spawn_special_sprite_index();
}

/** $B9DD3A — roll: on contact go back to walking/idle, in the air fall unless Y is held. */
export function CODE_B9DD3A() {
  const x = reg.x;
  if (r16(x + sprite.terrain_interaction) & 0x1001) return CODE_B9DFE1();
  const control = r16(R.current_kong_control_variables);
  reg.y = control;
  if (dbRead16(control + kong_control.input_held) & 0x4000) return;
  w16(x + sprite.state, 0x0001);
  set_player_terminal_velocity_global();
  setDixieAnim(0x07);
}

/** $B9DD61 — animation speed: faster while running. */
export function CODE_B9DD61() {
  const x = reg.x;
  if (isInactiveKong(x)) return;
  const control = r16(R.current_kong_control_variables);
  reg.y = control;
  const fast = (dbRead16(control + kong_control.fast_flag) & 0x0004) !== 0;
  w16(x + sprite.animation_speed, fast ? 0x0200 : C.default_animation_speed);
}

/** $B9DD7C */
export function CODE_B9DD7C() {
  const x = reg.x;
  if (isInactiveKong(x)) return;
  w16(x + sprite.state, 0x37);
  setDixieAnim(0x36);
}

/** $B9DD8E */
export function CODE_B9DD8E() {
  const x = reg.x;
  if (isInactiveKong(x)) return;
  w16(x + sprite.state, 0x35);
  CODE_B9DB11();
}

/** $B9DD9C — double rope: climb up/down animations. */
export function CODE_B9DD9C() {
  const x = reg.x;
  if (isInactiveKong(x)) return;
  const maxY = r16(x + sprite.max_y_speed);
  if (!maxY) return;
  setDixieAnim(isNeg(maxY) ? 0x37 : 0x38);
}

/** $B9DDB7 — horizontal rope: start moving. */
export function CODE_B9DDB7() {
  const x = reg.x;
  if (isInactiveKong(x)) return;
  if (r16(x + sprite.max_x_speed)) setDixieAnim(0x3a);
}

/** $B9DDC9 — horizontal rope: back to idle when slow. */
export function CODE_B9DDC9() {
  const x = reg.x;
  if (isInactiveKong(x)) return;
  if (r16(x + sprite.max_x_speed)) return;
  if (!cmpN(abs16(r16(x + sprite.x_speed)), 0x0080)) return;
  setDixieAnim(0x39);
}

/** $B9DDE8 — horizontal rope: face movement, speed from horizontal speed. */
export function CODE_B9DDE8() {
  const x = reg.x;
  if (isInactiveKong(x)) return;
  faceTargetDirection(x);
  let v = abs16(r16(x + sprite.x_speed)) >> 1;
  if (cmpN(v, 0x0070)) v = 0x0070;
  w16(x + sprite.animation_speed, v);
}

/** $B9DE0F */
export function CODE_B9DE0F() {
  setDixieAnim(0x36);
}

/** $B9DE17 — double rope: idle, or climb up/down (without restarting the current one). */
export function CODE_B9DE17() {
  const x = reg.x;
  if (isInactiveKong(x)) return;
  const maxY = r16(x + sprite.max_y_speed);
  if (!maxY) return CODE_B9DE0F();
  const anim = isNeg(maxY) ? 0x37 : 0x38;
  const control = r16(R.current_kong_control_variables);
  reg.y = control;
  if (anim === dbRead16(control + kong_control.animation_id)) return;
  setDixieAnim(anim);
}

/** Roll chaining: still rolling when Y was re-pressed at the roll event while moving. */
function keepsRolling(x: number): boolean {
  const state = r16(x + sprite.state);
  if (state === 0x19) return true;
  if (state !== 0x02) return false;
  const control = r16(R.current_kong_control_variables);
  reg.y = control;
  if (!(dbRead16(control + kong_control.input_held) & 0x4000)) return false;
  if (dbRead16(control + kong_control.roll_event_time) !== dbRead16(control + kong_control.y_press_time)) return false;
  return r16(r16(R.current_sprite) + sprite.max_x_speed) !== 0;
}

/** $B9DE43 — end of a roll: chain into the next one or stop (and clear animation flags). */
export function CODE_B9DE43() {
  if (keepsRolling(reg.x)) return CODE_B9DFE5();
  const x = reg.x;
  w16(x + sprite.x_speed, 0);
  w16(x + sprite.max_x_speed, 0);
  w16(x + sprite.state, 0x0004);
  w16(x + sprite.animation_flags, r16(x + sprite.animation_flags) & 0xb7ff);
}

/** $B9DE7C — end of a roll: chain into the next one or stop. */
export function CODE_B9DE7C() {
  if (keepsRolling(reg.x)) return CODE_B9DFE5();
  const x = reg.x;
  w16(x + sprite.x_speed, 0);
  w16(x + sprite.max_x_speed, 0);
  w16(x + sprite.state, 0x0004);
}

/** $B9DEAE — roll speed in the facing direction. */
export function CODE_B9DEAE() {
  const control = r16(R.current_kong_control_variables);
  reg.y = control;
  w16(reg.x + sprite.max_x_speed, towardsFacing(reg.x, dbRead16(control + kong_control.roll_speed)));
}

/** $B9DEBE */
export function CODE_B9DEBE() {
  w16(reg.x + sprite.x_speed, 0);
}

/** $B9DEC1 — faster animation while falling. */
export function CODE_B9DEC1() {
  if (!isNeg(r16(reg.x + sprite.y_speed))) w16(reg.x + sprite.animation_speed, 0x0200);
}

/** $B9DECC — faster animation close to (or below) the ground. */
export function CODE_B9DECC() {
  const x = reg.x;
  const ground = r16(x + sprite.ground_y_position);
  if (isNeg(ground)) return;
  const dist = (ground - r16(x + sprite.y_position)) & 0xffff;
  if (isNeg(dist)) return w16(x + sprite.animation_speed, 0x0300);
  if (cmpN(dist, 0x0010)) w16(x + sprite.animation_speed, 0x0200);
}

/** $B9DEE7 */
export function CODE_B9DEE7() {
  setDixieAnim(0x0d);
}

/** $B9DEEF — landing: the landing animation that fits the Kong's situation. */
export function CODE_B9DEEF() {
  const x = reg.x;
  const held = r16(R.current_held_sprite);
  if (held) {
    if (held === r16(R.inactive_kong_sprite)) {
      w16(x + sprite.state, 0x17);
      return setDixieAnim(0x24);
    }
    w16(x + sprite.state, 0x0c);
    return setDixieAnim(0x18);
  }
  const animal = r16(R.animal_type);
  if (animal) {
    if (r16(x + sprite.state) === C.kong_state_4F) {
      setAnimalAnim(0x68);
      return CODE_B9DAA3();
    }
    w16(x + sprite.state, C.kong_state_09);
    return setAnimalAnim(0x7c);
  }
  w16(x + sprite.state, 0);
  setDixieAnim(0x08);
  const control = r16(R.current_kong_control_variables);
  reg.y = control;
  if (dbRead16(control + kong_control.fast_flag) & 0x0004) {
    const sx = r16(R.current_sprite);
    reg.x = sx;
    w16(sx + sprite.animation_speed, 0x0200);
  }
}

/** $B9DF51 — jump: the jump animation/state that fits the Kong's situation. */
export function CODE_B9DF51() {
  const held = r16(R.current_held_sprite);
  if (held) {
    const x = reg.x;
    const jumpSpeed = spriteConstant(0x08);
    reg.y = 0x08;
    if (held === r16(R.inactive_kong_sprite)) {
      w16(x + sprite.y_speed, jumpSpeed);
      w16(x + sprite.state, 0x1b);
      return setDixieAnim(0x22);
    }
    if (r16(R.active_kong_number)) w16(0x0d80, 0x0001);
    w16(x + sprite.y_speed, jumpSpeed);
    w16(x + sprite.state, 0x0e);
    return setDixieAnim(0x16);
  }
  if (r16(R.animal_type)) {
    CODE_B9DFB6();
    w16(reg.x + sprite.state, 0x0b);
    return setAnimalAnim(0x72);
  }
  CODE_B9DFB6();
  w16(reg.x + sprite.state, 0x06);
  setDixieAnim(0x06);
}

/** $B9DFB2 — JSL wrapper of CODE_B9DFB6. */
export function CODE_B9DFB2() {
  CODE_B9DFB6();
}

/** $B9DFB6 — jump speed from the constants (per animal type when transformed). */
export function CODE_B9DFB6() {
  const x = r16(R.current_sprite);
  reg.x = x;
  const animal = r16(R.animal_type);
  const offset = animal ? ((animal - 0x000c) & 0xffff) >> 1 : 0x08;
  reg.y = offset;
  w16(x + sprite.y_speed, spriteConstant(offset));
}

/** $B9DFCF — JSL wrapper of CODE_B9DFD3. */
export function CODE_B9DFCF() {
  CODE_B9DFD3();
}

/** $B9DFD3 — on the ground: walk/idle; in the air: fall faster. */
export function CODE_B9DFD3() {
  const x = r16(R.current_sprite);
  reg.x = x;
  if (r16(x + sprite.terrain_interaction) & 0x0001) return CODE_B9DFE5();
  start_player_faster_falling_global();
}

/** $B9DFE1 — terminal velocity, then CODE_B9DFE5. */
export function CODE_B9DFE1() {
  set_player_terminal_velocity_global();
  CODE_B9DFE5();
}

/** $B9DFE5 — back to idle, walk or run depending on the horizontal movement. */
export function CODE_B9DFE5() {
  const x = r16(R.current_sprite);
  reg.x = x;
  if (isInactiveKong(x)) return CODE_B9E000();
  CODE_B9E128();
  const cls = reg.a;
  reg.y = x;
  reg.x = cls;
  // JMP (DATA_B9DFF4,x)
  if (cls === 0) CODE_B9E000();
  else CODE_B9E003();
}

/** $B9E000 */
export function CODE_B9E000() {
  CODE_B9D705();
}

/** $B9E003 — walking or running (fast flag). */
export function CODE_B9E003() {
  const control = r16(R.current_kong_control_variables);
  reg.y = control;
  if (dbRead16(control + kong_control.fast_flag) & 0x0004) return CODE_B9E010();
  CODE_B9D76D();
}

/** $B9E010 */
export function CODE_B9E010() {
  CODE_B9D7E6();
}

/** $B9E013 — turn around (active Kong only). */
export function CODE_B9E013() {
  if (isInactiveKong(reg.x)) return;
  CODE_B9E019();
}

/** $B9E019 — flip the sprite horizontally. */
export function CODE_B9E019() {
  const x = reg.x;
  w16(x + sprite.oam_property, r16(x + sprite.oam_property) ^ 0x4000);
}

/**
 * $B9E021 — when the target direction differs from the facing, start the turn animation that
 * fits the situation. Carry set when a turn was started.
 */
export function CODE_B9E021() {
  const x = r16(R.current_sprite);
  reg.x = x;
  if (!r16(x + sprite.max_x_speed) || !facingAgainstTarget(x)) {
    reg.c = false;
    return;
  }
  const held = r16(R.current_held_sprite);
  if (held) {
    setDixieAnim(held === r16(R.inactive_kong_sprite) ? 0x1e : 0x12);
    reg.c = true;
    return;
  }
  const animal = r16(R.animal_type);
  if (animal) {
    if (animal === C.sprite_rattly) {
      // Rattly turns instantly
      CODE_B9E019();
      reg.c = true;
      return;
    }
    setAnimalAnim(0x63);
    reg.c = true;
    return;
  }
  setDixieAnim(0x02);
  reg.c = true;
}

/** $B9E06C */
export function CODE_B9E06C() {
  CODE_B9E021();
}

/** $B9E06F — turn check; a started turn plays at speed $180. */
export function CODE_B9E06F() {
  CODE_B9E021();
  if (reg.c) w16(reg.x + sprite.animation_speed, 0x0180);
}

/** $B9E07A — at the end of a turn: idle when still, walk unless running. */
export function CODE_B9E07A() {
  const control = r16(R.current_kong_control_variables);
  const fast = dbRead16(control + kong_control.fast_flag) & 0x0004;
  w16(0x5e, fast);
  CODE_B9E128();
  const cls = reg.a;
  reg.y = reg.x;
  reg.x = cls;
  // JMP (DATA_B9E08C,x)
  if (cls === 0) return CODE_B9D705();
  if (cls === 2) {
    CODE_B9E0F3();
    if (reg.a === 0) CODE_B9D705();
    return;
  }
  if (r16(0x5e)) return;
  CODE_B9D76D();
}

/** $B9E0A8 — while idle: start walking/running when the Kong accelerates. */
export function CODE_B9E0A8() {
  const x = r16(R.current_sprite);
  reg.x = x;
  // (for the inactive Kong the original tests a constant that always matches)
  CODE_B9E128();
  const cls = reg.a;
  reg.y = x;
  reg.x = cls;
  // JMP (DATA_B9E0B7,x)
  if (cls < 4) return;
  const control = r16(R.current_kong_control_variables);
  reg.y = control;
  if (dbRead16(control + kong_control.fast_flag) & 0x0004) return CODE_B9D7E6();
  CODE_B9D76D();
}

/** $B9E0E0 — walking: back to idle when the Kong stops. */
export function CODE_B9E0E0() {
  CODE_B9E128();
  const cls = reg.a;
  if (cls === 0) return CODE_B9D705();
  if (cls !== 2) return;
  CODE_B9E0F3();
  if (reg.a === 0) CODE_B9D705();
}

/** $B9E0F3 — A = |x speed| rounded down to $20 (zero when nearly stopped). */
export function CODE_B9E0F3() {
  const x = r16(R.current_sprite);
  reg.x = x;
  reg.a = abs16(r16(x + sprite.x_speed)) & 0xffe0;
}

/** $B9E101 — walking: turn check, then switch to running when the fast flag is set. */
export function CODE_B9E101() {
  CODE_B9E021();
  if (reg.c) return;
  CODE_B9E128();
  const cls = reg.a;
  reg.y = reg.x;
  reg.x = cls;
  // JMP (DATA_B9E10E,x)
  if (cls < 4) return;
  const control = r16(R.current_kong_control_variables);
  reg.y = control;
  if (dbRead16(control + kong_control.fast_flag) & 0x0004) CODE_B9D7E6();
}

/**
 * $B9E128 — classify the horizontal movement of sprite X, A =
 *   0 still, 2 coasting (no target), 4 starting, 6 decelerating, 8 accelerating, $A at speed.
 */
export function CODE_B9E128() {
  const x = reg.x;
  const max = r16(x + sprite.max_x_speed);
  const speed = r16(x + sprite.x_speed);
  if (!max) {
    reg.a = speed ? 0x0002 : 0x0000;
    return;
  }
  if (!speed) {
    reg.a = 0x0004;
    return;
  }
  const s = abs16(speed);
  w16(0x32, s);
  const m = abs16(max);
  if (m === s) reg.a = 0x000a;
  else reg.a = m > s ? 0x0008 : 0x0006;
}

/** $B9E162 — throw the partner Kong up from the team-up. */
export function CODE_B9E162() {
  w16(R.current_held_sprite, 0);
  const partner = r16(R.inactive_kong_sprite);
  const kong = r16(R.active_kong_sprite);
  reg.x = partner;
  reg.y = kong;
  w16(partner + sprite.y_position, (dbRead16(kong + sprite.y_position) - 0x38) & 0xffff);
  w16(partner + sprite.x_position, dbRead16(kong + sprite.x_position));
  w16(partner + sprite.y_speed, 0xfd40);
  w16(partner + sprite.x_speed, towardsFacing(partner, 0xfff0));
  w16(partner + sprite.state, 0x4d);
  reg.a = 0x004b;
  set_inactive_kong_anim_handle_dixie();
}

/** $B9E198 — fly towards the point ($0D66, $0D6A). */
export function CODE_B9E198() {
  const x = reg.x;
  reg.a = (r16(0x0d66) - r16(x + sprite.x_position)) & 0xffff;
  CODE_B9E1B4();
  w16(x + sprite.x_speed, reg.a);
  reg.a = (r16(0x0d6a) - r16(x + sprite.y_position)) & 0xffff;
  CODE_B9E1B4();
  w16(x + sprite.y_speed, reg.a);
  w16(x + sprite.state, 0x4b);
}

/** $B9E1B4 — A = signed distance: speed 16x the distance, at least 4 in magnitude. */
export function CODE_B9E1B4() {
  const a = reg.a & 0xffff;
  if (!isNeg(a)) return CODE_B9E1C2();
  reg.a = negate(a);
  CODE_B9E1C2();
  reg.a = negate(reg.a);
}

/** $B9E1C2 */
export function CODE_B9E1C2() {
  const v = (reg.a << 4) & 0xffff;
  reg.a = cmpN(v, 0x0004) ? 0x0004 : v;
}

/** $B9E1CF — step 16px forward, then fly towards the point. */
export function CODE_B9E1CF() {
  const x = reg.x;
  w16(x + sprite.x_position, (towardsFacing(x, 0x0010) + r16(x + sprite.x_position)) & 0xffff);
  CODE_B9E198();
}

/** $B9E1E2 — release the partner from the team-up (small hop). */
export function CODE_B9E1E2() {
  w16(R.current_held_sprite, 0);
  const partner = r16(R.inactive_kong_sprite);
  reg.x = partner;
  w16(partner + sprite.y_position, (r16(partner + sprite.y_position) - 0x1d) & 0xffff);
  w16(partner + sprite.y_speed, 0xfb00);
  w16(partner + sprite.x_speed, towardsFacing(partner, 0xff40));
  w16(partner + sprite.state, 0x4d);
  reg.a = 0x0019;
  set_inactive_kong_anim_handle_dixie();
}

/** $B9E20F */
export function CODE_B9E20F() {
  reg.x = r16(R.current_sprite);
  reg.a = 0x000c;
  disable_enemy_damage_global();
}

/** $B9E219 — Rambi attack hitbox (special hitbox 8). */
export function CODE_B9E219() {
  reg.a = 0x0008;
  init_special_player_clipping();
}

/** $B9E221 — bounce up when landing (and not touching a wall). */
export function CODE_B9E221() {
  const x = reg.x;
  if ((r16(x + sprite.terrain_interaction) & 0x1001) !== 0x0001) return;
  w16(x + sprite.y_speed, 0xfc00);
  w16(x + sprite.state, 0x0a);
}

/** $B9E237 */
export function CODE_B9E237() {
  reg.y = C.special_sprite_spawn_id_0054;
  spawn_no_gfx_special_sprite_index();
}

/** Input bit $0080 held by the active Kong. */
function activeHolds0080(): boolean {
  const control = r16(R.active_kong_control_variables);
  reg.y = control;
  return (dbRead16(control + kong_control.input_held) & 0x0080) !== 0;
}

/** $B9E23F — back to idle when moving or when the button is released. */
export function CODE_B9E23F() {
  if (!r16(reg.x + sprite.max_x_speed) && activeHolds0080()) return;
  CODE_B9D705();
}

/** $B9E252 — animal charge: start the dash when the button is released. */
export function CODE_B9E252() {
  const x = reg.x;
  if (r16(x + sprite.max_x_speed)) return setAnimalAnim(0x5e);
  if (activeHolds0080()) return;
  const v = towardsFacing(x, 0x0700);
  w16(x + sprite.general_purpose_42, v);
  w16(x + sprite.x_speed, v);
  w16(x + sprite.max_x_speed, v);
  if (r16(R.animal_type) !== C.sprite_enguarde) {
    w16(x + sprite.state, C.kong_state_4F);
    return setAnimalAnim(0x68);
  }
  w16(x + sprite.state, 0x52);
  setAnimalAnim(0x68);
  const sx = r16(R.current_sprite);
  reg.x = sx;
  w16(sx + sprite.animation_flags, r16(sx + sprite.animation_flags) | 0xa000);
}

/** $B9E2B6 — swimming animal: speed from movement, turn when needed. */
export function CODE_B9E2B6() {
  CODE_B9E2D0();
  const x = r16(R.current_sprite);
  reg.x = x;
  if (!r16(x + sprite.max_x_speed)) return;
  if (facingAgainstTarget(x)) setAnimalAnim(0x63);
}

/** $B9E2D0 — animation speed = max(|x speed|, |y speed|), at least $C0. */
export function CODE_B9E2D0() {
  const x = r16(R.current_sprite);
  reg.x = x;
  const ys = abs16(r16(x + sprite.y_speed));
  w16(0x34, ys);
  let v = abs16(r16(x + sprite.x_speed));
  if (cmpN(v, ys)) v = ys;
  if (cmpN(v, 0x00c0)) v = 0x00c0;
  w16(x + sprite.animation_speed, v);
}

/** $B9E2F5 */
export function CODE_B9E2F5() {
  setAnimalAnim(0x5e);
}

/** $B9E2FD */
export function CODE_B9E2FD() {
  const x = reg.x;
  w16(x + sprite.state, 0x51);
  w16(x + sprite.animation_flags, r16(x + sprite.animation_flags) | 0xa000);
}

/** $B9E30A — when flag $0B02.0 is set: clear it, face the target direction, animation $8B. */
export function CODE_B9E30A() {
  const flags = r16(R.RAM_0B02);
  if (!(flags & 0x0001)) return;
  w16(R.RAM_0B02, flags ^ 0x0001);
  const x = r16(R.current_sprite);
  reg.x = x;
  faceTargetDirection(x);
  setAnimalAnim(0x8b);
}

/** $B9E331 — Diddy only: the ridden animal takes animation $59. */
export function CODE_B9E331() {
  if (r16(R.active_kong_number)) return;
  reg.a = 0x0059;
  set_riding_kong_anim_handle_dixie();
}

/** $B9E33E — (unreferenced) back to idle unless Y is held for $14 frames. */
export function CODE_B9E33E() {
  const control = r16(R.current_kong_control_variables);
  reg.y = control;
  if (dbRead16(control + kong_control.input_held) & 0x4000) {
    const since = (r16(R.active_frame_counter) - dbRead16(control + kong_control.y_press_time)) & 0xffff;
    if (!cmpN(since, 0x0014)) return;
  }
  CODE_B9D705();
}

/** $B9E357 */
export function CODE_B9E357() {
  reg.a = 0x0011;
  disable_enemy_damage_global();
}

/** $B9E35F — Enguarde's charge: sound and dash speed (slower in state 6C). */
export function CODE_B9E35F() {
  reg.a = sound(5, C.sound_enguarde_charge);
  queue_sound_effect();
  const x = r16(R.current_sprite);
  reg.x = x;
  let v = r16(x + sprite.state) === C.kong_state_6C ? 0x0180 : 0x0400;
  if (facesLeft(r16(x + sprite.oam_property))) v = negate(v);
  reg.y = v;
  w16(x + sprite.x_speed, v);
  w16(x + sprite.max_x_speed, v);
}

/** $B9E385 — Rattly's charged jump: wind up the animation, leap when released fully charged. */
export function CODE_B9E385() {
  const x = reg.x;
  let charged = 0;
  let v = (r16(x + sprite.animation_speed) + 0x000c) & 0xffff;
  if (!cmpN(v, 0x0480)) {
    charged = 1;
    v = 0x0480;
  }
  w16(x + sprite.animation_speed, v);
  w16(0x32, charged);
  if (activeHolds0080()) return;
  if (!charged) return CODE_B9D705();
  // CODE_B9E3AF: the super jump
  const sx = r16(R.current_sprite);
  reg.x = sx;
  w16(sx + sprite.y_speed, spriteConstant(0x98));
  w16(sx + sprite.state, 0x62);
  const control = r16(R.current_kong_control_variables);
  dbWrite16(control + kong_control.jump_event_time, r16(R.active_frame_counter));
  setAnimalAnim(0x72);
  reg.a = sound(5, C.sound_rattly_leap);
  queue_sound_effect();
}

/** $B9E3AE */
export function CODE_B9E3AE() {}


register({
  CODE_B9D705,
  CODE_B9D76D,
  CODE_B9D7E6,
  CODE_B9D853,
  CODE_B9D85D,
  spawn_diddy_boombox,
  CODE_B9D880,
  CODE_B9D888,
  CODE_B9D88E,
  CODE_B9D891,
  CODE_B9D896,
  CODE_B9D8AA,
  CODE_B9D8BC,
  CODE_B9D965,
  CODE_B9D9E6,
  CODE_B9D9ED,
  CODE_B9D9FD,
  CODE_B9D9FF,
  CODE_B9DA19,
  CODE_B9DA30,
  CODE_B9DA50,
  CODE_B9DA5B,
  CODE_B9DA5C,
  exit_level_on_death,
  CODE_B9DA75,
  CODE_B9DA80,
  CODE_B9DA81,
  spawn_diddy_hurt_stars,
  CODE_B9DAA3,
  CODE_B9DAAF,
  CODE_B9DAB7,
  CODE_B9DAE0,
  CODE_B9DB11,
  CODE_B9DB19,
  CODE_B9DB45,
  CODE_B9DB64,
  CODE_B9DB6C,
  CODE_B9DB88,
  CODE_B9DB9B,
  CODE_B9DBB0,
  CODE_B9DBC5,
  CODE_B9DBC8,
  CODE_B9DBF4,
  CODE_B9DBF9,
  CODE_B9DC01,
  CODE_B9DC10,
  CODE_B9DC17,
  CODE_B9DC36,
  CODE_B9DC40,
  CODE_B9DC4A,
  CODE_B9DC54,
  CODE_B9DC68,
  CODE_B9DC7D,
  CODE_B9DC92,
  CODE_B9DC93,
  CODE_B9DC94,
  spawn_dixie_guitar,
  CODE_B9DCAD,
  CODE_B9DCB5,
  CODE_B9DCCA,
  CODE_B9DCE2,
  CODE_B9DCE8,
  CODE_B9DCF0,
  CODE_B9DCF7,
  CODE_B9DCFE,
  CODE_B9DD19,
  CODE_B9DD1A,
  CODE_B9DD21,
  spawn_dixie_hurt_tears,
  CODE_B9DD3A,
  CODE_B9DD61,
  CODE_B9DD7C,
  CODE_B9DD8E,
  CODE_B9DD9C,
  CODE_B9DDB7,
  CODE_B9DDC9,
  CODE_B9DDE8,
  CODE_B9DE0F,
  CODE_B9DE17,
  CODE_B9DE43,
  CODE_B9DE7C,
  CODE_B9DEAE,
  CODE_B9DEBE,
  CODE_B9DEC1,
  CODE_B9DECC,
  CODE_B9DEE7,
  CODE_B9DEEF,
  CODE_B9DF51,
  CODE_B9DFB2,
  CODE_B9DFB6,
  CODE_B9DFCF,
  CODE_B9DFD3,
  CODE_B9DFE1,
  CODE_B9DFE5,
  CODE_B9E000,
  CODE_B9E003,
  CODE_B9E010,
  CODE_B9E013,
  CODE_B9E019,
  CODE_B9E021,
  CODE_B9E06C,
  CODE_B9E06F,
  CODE_B9E07A,
  CODE_B9E0A8,
  CODE_B9E0E0,
  CODE_B9E0F3,
  CODE_B9E101,
  CODE_B9E128,
  CODE_B9E162,
  CODE_B9E198,
  CODE_B9E1B4,
  CODE_B9E1C2,
  CODE_B9E1CF,
  CODE_B9E1E2,
  CODE_B9E20F,
  CODE_B9E219,
  CODE_B9E221,
  CODE_B9E237,
  CODE_B9E23F,
  CODE_B9E252,
  CODE_B9E2B6,
  CODE_B9E2D0,
  CODE_B9E2F5,
  CODE_B9E2FD,
  CODE_B9E30A,
  CODE_B9E331,
  CODE_B9E33E,
  CODE_B9E357,
  CODE_B9E35F,
  CODE_B9E385,
  CODE_B9E3AE,
});
