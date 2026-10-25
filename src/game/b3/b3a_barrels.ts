/**
 * Bank $B3 — throwable objects: DK barrel, TNT barrel, wooden box, cannonball, chests, the
 * plain barrel, the animal crate and the invincibility barrel, plus their shared physics
 * (gravity from the constants block, held position, pickup/throw handling).
 *
 * Throwable states: 0 = resting, 1 = held, 2 = held (throw starting), 3 = thrown.
 * Constants block (`current_sprite_constants`): +0 gravity, +2 max falling speed,
 * +4 x acceleration, +6 throw speed.
 */
import { r16, w16, w8, rom16 } from "../../core/mem";
import { reg } from "../../core/cpu";
import { L, R, C, sprite } from "../../core/sym";
import {
  apply_position_from_velocity_global,
  interpolate_x_velocity_global,
  process_terrain_interaction_global,
  process_sprite_animation,
  process_alternate_movement,
  process_current_movement,
  delete_sprite_handle_deallocation,
  delete_sprite_if_offscreen,
  spawn_special_sprite_index,
  spawn_no_gfx_special_sprite_index,
  spawn_special_sprite_address,
  spawn_BB83EF_special_sprite_index,
  set_sprite_animation,
  set_anim_handle_throwable,
  get_current_sprite_clipping,
  check_active_kong_collision,
  check_if_sprite_offscreen_global,
  work_on_active_kong_global,
  disable_enemy_damage_global,
  dereference_sprite_palette_global,
  apply_spawn_script_to_slot_global,
  queue_sound_effect,
  CODE_BEBD8E,
  CODE_BEBE8B,
  CODE_BEBE6D,
  CODE_B8A98A,
  CODE_B8D246,
  CODE_B8D4AE,
  CODE_B3A364,
  CODE_BBBB44,
} from "../../gen/routines";
import { registerRts, registerRtl, registerSprite, spriteConst, useOwnConstants, mergeBits, mi, neg, asr1, snd, spriteTail } from "./b3a_common";
import { sprite_return_handle_despawn } from "./b3a_framework";
import { get_state_death_and_mounting_flags } from "./b3a_animals";

const cur = () => r16(R.current_sprite);
const ITEM_REWARD_INIT_SCRIPTS_TABLE = L("item_reward_init_scripts_table");
const DATA_FF18CE = L("DATA_FF18CE");
const DATA_B39DC7 = L("DATA_B39DC8") - 1;
const CODE_B3D249 = L("CODE_B3D249");

function sound(channel: number, name: string) {
  reg.a = snd(channel, name);
  queue_sound_effect();
}

/** `LDA #flags : LDY #y : JSL CODE_BEBD8E` after refreshing the clipping (carry = hit something). */
function throwableCollision(a: number, y: number) {
  get_current_sprite_clipping();
  reg.a = a;
  reg.y = y;
  CODE_BEBD8E();
}

/** Sprite state word of the current sprite, after `LDA sprite.constants_address : STA ...`. */
function throwableEntry(): number {
  const x = cur();
  useOwnConstants(x);
  return r16(x + sprite.state);
}

// ---------------------------------------------------------------------------------------------
// DK barrel
// ---------------------------------------------------------------------------------------------

/** $B39376 */
export function dk_barrel_main() {
  const state = throwableEntry();
  switch (state) {
    case 0:
      return dkBarrelGrounded();
    case 1:
      return CODE_B393D9();
    case 2:
      return CODE_B393ED();
    case 3:
      return CODE_B39401();
    case 4:
      return CODE_B3944D();
    case 5:
      return CODE_B39471();
    case 6:
      return CODE_B39473();
    case 7:
      return CODE_B3948B();
  }
}

/** $B39396 dk_barrel_main.grounded_state */
function dkBarrelGrounded() {
  if (r16(R.cheat_enable_flags) & 0x0001) return delete_sprite_handle_deallocation(); // Barrelax cheat
  if (r16(R.level_number) === C.level_castle_crush) {
    const x = cur();
    reg.x = x;
    if (r16(x + sprite.terrain_attributes) & 0x0100) {
      // breaks on Castle Crush's rising floor
      sound(5, "barrel_blast");
      spawn_barrel_parts_and_smoke_global();
      delete_sprite_handle_deallocation();
      return;
    }
  }
  CODE_B39F10();
  if (reg.c) return;
  apply_sprite_gravity();
  CODE_B39EBE();
  process_terrain_interaction_global();
  process_sprite_animation();
  sprite_return_handle_despawn();
}

/** $B393D9 — held. */
export function CODE_B393D9() {
  CODE_B39F56();
  if (reg.c) return;
  update_held_sprite_position();
  process_sprite_animation();
  CODE_B39E8D();
  if (reg.c) CODE_B39434();
}

/** $B393ED — held, being thrown. */
export function CODE_B393ED() {
  CODE_B39F56();
  if (reg.c) return;
  update_held_sprite_position();
  process_sprite_animation();
  CODE_B39E9C();
  if (reg.c) CODE_B39434();
}

/** $B39401 — thrown: breaks on landing, on hitting something, or offscreen. */
export function CODE_B39401() {
  apply_sprite_gravity();
  CODE_B39EBE();
  process_terrain_interaction_global();
  const x = cur();
  reg.x = x;
  if ((r16(x + sprite.terrain_interaction) & 0x0101) === 0x0101) return dkBarrelBreak();
  throwableCollision(0x0020, 0x0008);
  if (reg.c) return dkBarrelBreak();
  process_sprite_animation();
  check_if_sprite_offscreen_global();
  if (reg.c) return dkBarrelBreak();
}

/** $B39434 — broken while held. */
export function CODE_B39434() {
  w16(R.current_held_sprite, 0);
  dkBarrelBreak();
}

/** $B39437 dk_barrel_main.break_dk_barrel — the barrel bursts and frees the other Kong. */
function dkBarrelBreak() {
  sound(5, "barrel_blast");
  spawn_barrel_parts_and_smoke_global();
  CODE_B8A98A();
  delete_sprite_handle_deallocation();
}

/** $B3944D — floating DK barrel (bonus/after losing a Kong): breaks when the lone Kong touches it. */
export function CODE_B3944D() {
  if (r16(R.cheat_enable_flags) & 0x0001) return delete_sprite_handle_deallocation();
  if (!(r16(R.game_state_flags) & 0x4000)) {
    get_current_sprite_clipping();
    reg.a = 0x0010;
    check_active_kong_collision();
    if (reg.c) return dkBarrelBreak();
  }
  CODE_B3946A();
}

/** $B3946A */
export function CODE_B3946A() {
  process_sprite_animation();
  sprite_return_handle_despawn();
}

/** $B39471 */
export function CODE_B39471() {
  dkBarrelBreak();
}

/** $B39473 — becomes a floating barrel unless both Kongs are already there. */
export function CODE_B39473() {
  if (r16(R.game_state_flags) & 0x4000) return delete_sprite_handle_deallocation();
  const x = cur();
  reg.x = x;
  w16(x + sprite.state, 0x0004);
  CODE_B3944D();
}

/** $B3948B — falling away (knocked off), deleted offscreen. */
export function CODE_B3948B() {
  apply_sprite_gravity();
  CODE_B39EBE();
  apply_position_from_velocity_global();
  process_sprite_animation();
  delete_sprite_if_offscreen();
}

/** $B394A0 — the "DK" letters on a DK barrel follow their barrel ($42). */
export function dk_barrel_letters_main() {
  const x = cur();
  reg.x = x;
  const y = r16(x + 0x42);
  reg.y = y;
  if (r16(y + sprite.type) !== C.sprite_dk_barrel || r16(y + 0x48) & 0x8000) {
    delete_sprite_handle_deallocation();
    return;
  }
  w16(x + sprite.x_position, r16(y + sprite.x_position));
  w16(x + sprite.y_position, r16(y + sprite.y_position));
  process_sprite_animation();
  sprite_return_handle_despawn();
}

// ---------------------------------------------------------------------------------------------
// TNT barrel ($4A = $3EAC marks the variant with the other explosion)
// ---------------------------------------------------------------------------------------------

/** $B394CA */
export function tnt_barrel_main() {
  const state = throwableEntry();
  switch (state) {
    case 0:
      return CODE_B394E6();
    case 1:
      return CODE_B39505();
    case 2:
      return CODE_B39519();
    case 3:
      return CODE_B3951B();
    case 4:
    case 5:
      return CODE_B3957E();
  }
}

/** $B394E3 */
export function CODE_B394E3() {}

/** $B394E6 — resting. */
export function CODE_B394E6() {
  CODE_B39F10();
  if (reg.c) return;
  apply_sprite_gravity();
  CODE_B39EBE();
  process_terrain_interaction_global();
  process_sprite_animation();
  const x = cur();
  reg.x = x;
  if (r16(x + 0x4a) === 0x3eac) return;
  sprite_return_handle_despawn();
}

/** $B39505 — held. */
export function CODE_B39505() {
  CODE_B39F56();
  if (reg.c) return;
  update_held_sprite_position();
  process_sprite_animation();
  CODE_B39EAB();
  if (reg.c) CODE_B3953A();
}

/** $B39519 */
export function CODE_B39519() {
  CODE_B39505();
}

/** $B3951B — thrown: explodes on any wall/floor contact or hit. */
export function CODE_B3951B() {
  apply_sprite_gravity();
  CODE_B39EBE();
  process_terrain_interaction_global();
  const x = cur();
  reg.x = x;
  if (r16(x + sprite.terrain_interaction) & 0x0003) return CODE_B3953D();
  CODE_B39EAB();
  if (reg.c) return CODE_B3953D();
  process_sprite_animation();
  sprite_return_handle_despawn();
}

/** $B3953A */
export function CODE_B3953A() {
  w16(R.current_held_sprite, 0);
  CODE_B3953D();
}

/** $B3953D — explode. */
export function CODE_B3953D() {
  sound(4, "boom");
  sound(6, "explosion");
  const x = cur();
  reg.x = x;
  if (r16(x + 0x4a) === 0x3eac) return CODE_B39569();
  reg.y = C.special_sprite_spawn_id_00D4;
  spawn_BB83EF_special_sprite_index();
  reg.y = C.special_sprite_spawn_id_00D2;
  spawn_BB83EF_special_sprite_index();
  delete_sprite_handle_deallocation();
}

/** $B39569 */
export function CODE_B39569() {
  reg.y = C.special_sprite_spawn_id_00D8;
  spawn_BB83EF_special_sprite_index();
  reg.y = C.special_sprite_spawn_id_00D6;
  spawn_BB83EF_special_sprite_index();
  delete_sprite_handle_deallocation();
}

/** $B3957E */
export function CODE_B3957E() {
  CODE_B3953D();
}

// ---------------------------------------------------------------------------------------------
// Wooden box
// ---------------------------------------------------------------------------------------------

/** $B39580 */
export function wooden_box_main() {
  const state = throwableEntry();
  switch (state) {
    case 0:
      return CODE_B39598();
    case 1:
      return CODE_B395AE();
    case 2:
      return CODE_B395C2();
    case 3:
      return CODE_B395C4();
  }
}

/** $B39595 */
export function CODE_B39595() {}

/** $B39598 */
export function CODE_B39598() {
  CODE_B39F10();
  if (reg.c) return;
  apply_sprite_gravity();
  CODE_B39EBE();
  process_terrain_interaction_global();
  process_sprite_animation();
  sprite_return_handle_despawn();
}

/** $B395AE */
export function CODE_B395AE() {
  CODE_B39F56();
  if (reg.c) return;
  update_held_sprite_position();
  process_sprite_animation();
  CODE_B39E9C();
  if (reg.c) CODE_B395E3();
}

/** $B395C2 */
export function CODE_B395C2() {
  CODE_B395AE();
}

/** $B395C4 */
export function CODE_B395C4() {
  apply_sprite_gravity();
  CODE_B39EBE();
  process_terrain_interaction_global();
  const x = cur();
  reg.x = x;
  if (r16(x + sprite.terrain_interaction) & 0x0003) return CODE_B395E6();
  CODE_B39E9C();
  if (reg.c) return CODE_B395E6();
  process_sprite_animation();
  sprite_return_handle_despawn();
}

/** $B395E3 */
export function CODE_B395E3() {
  w16(R.current_held_sprite, 0);
  CODE_B395E6();
}

/** $B395E6 — smash. */
export function CODE_B395E6() {
  sound(5, "barrel_blast");
  spawn_barrel_parts_and_smoke_global();
  delete_sprite_handle_deallocation();
}

// ---------------------------------------------------------------------------------------------
// Barrel pieces
// ---------------------------------------------------------------------------------------------

/** $B39739 — barrel_piece_main (and 0064/0240/0244): fall with gravity $40 up to $800. */
export function unknown_sprite_0244_main() {
  const x = cur();
  reg.x = x;
  let v = (0x0040 + r16(x + sprite.y_speed)) & 0xffff;
  if (!(v & 0x8000) && !mi(v, 0x0800)) v = 0x0800;
  w16(x + sprite.y_speed, v);
  apply_position_from_velocity_global();
  process_sprite_animation();
  delete_sprite_if_offscreen();
}

/** $B3975C */
export function spawn_barrel_parts_and_smoke_global() {
  spawn_barrel_parts_and_smoke();
}

/** $B39760 */
export function spawn_barrel_parts_global() {
  spawn_barrel_parts();
}

/** $B39764 — a smoke puff and the four barrel pieces. */
export function spawn_barrel_parts_and_smoke() {
  reg.y = C.special_sprite_spawn_id_004A;
  spawn_special_sprite_index();
  spawn_barrel_parts();
}

/** $B3976B */
export function spawn_barrel_parts() {
  reg.y = C.special_sprite_spawn_id_0060;
  spawn_no_gfx_special_sprite_index();
  reg.y = C.special_sprite_spawn_id_0062;
  spawn_no_gfx_special_sprite_index();
  CODE_B39779();
}

/** $B39779 — the last two barrel pieces. */
export function CODE_B39779() {
  reg.y = C.special_sprite_spawn_id_0064;
  spawn_no_gfx_special_sprite_index();
  reg.y = C.special_sprite_spawn_id_0066;
  spawn_no_gfx_special_sprite_index();
}

// ---------------------------------------------------------------------------------------------
// Animal crate
// ---------------------------------------------------------------------------------------------

/** $B39788 — the crate with an animal buddy; $42 keeps the animation that encodes the animal. */
export function animal_crate_main() {
  const x = cur();
  reg.x = x;
  const state = r16(x + sprite.state);
  switch (state) {
    case 0: // idle: broken by a thrown object or by the Kong
      animalCrateCheckCollision();
      process_terrain_interaction_global();
      sprite_return_handle_despawn();
      return;
    case 1:
    case 4: // breaking open (the animation spawns the animal)
      process_sprite_animation();
      return;
    case 2:
      process_sprite_animation();
      delete_sprite_if_offscreen();
      return;
    case 3:
      get_current_sprite_clipping();
      reg.a = 0x0008;
      callCollision();
      if (reg.c) {
        const s = cur();
        reg.x = s;
        w16(s + sprite.interaction_flags, 0);
        w16(s + sprite.carry_or_defeat_flags, 0);
        w16(s + sprite.state, 0x0001);
        w16(s + 0x42, r16(s + sprite.animation_id));
        reg.a = C.animal_crate_open_anim_id;
        set_sprite_animation();
        return;
      }
      process_terrain_interaction_global();
      sprite_return_handle_despawn();
      return;
  }
}

import { callSpriteCollisionRoutine as callCollision } from "./b3a_common";

/** $B3979B animal_crate_main.check_collision (carry always clear on exit). */
function animalCrateCheckCollision() {
  let x = cur();
  reg.x = x;
  let newState: number;
  if (r16(x + sprite.terrain_attributes) & 0x0100) newState = 0x0004;
  else {
    reg.a = 0x0118;
    CODE_B3A364();
    if (reg.c) newState = 0x0001;
    else {
      get_current_sprite_clipping();
      reg.a = 0x15cc;
      CODE_BEBE8B();
      if (!reg.c) {
        reg.c = false;
        return;
      }
      newState = 0x0001;
    }
  }
  x = reg.x;
  w16(x + sprite.state, newState);
  w16(x + sprite.interaction_flags, 0);
  w16(x + sprite.carry_or_defeat_flags, 0);
  w16(x + 0x42, r16(x + sprite.animation_id));
  reg.a = C.animal_crate_open_anim_id;
  set_sprite_animation();
  sound(4, "animal_crate_break_a");
  sound(5, "animal_crate_break_c");
  sound(6, "animal_crate_break_d");
  sound(7, "animal_crate_break_b");
  x = cur();
  reg.x = x;
  const camera = r16(x + sprite.unknown_5C);
  if (camera) {
    // lock the camera section given by the crate
    const i = (camera << 1) & 0xffff;
    w16(0x7e9128 + i, r16(0x7e9128 + i) | 0x0080);
  }
  reg.x = cur();
  reg.c = false;
}

// ---------------------------------------------------------------------------------------------
// Invincibility barrel
// ---------------------------------------------------------------------------------------------

/** $B39A6F — touching it makes the Kong invincible for $42 frames. */
export function invincibility_barrel_main() {
  get_current_sprite_clipping();
  reg.a = 0x0010;
  callCollision();
  if (!reg.c) {
    process_sprite_animation();
    sprite_return_handle_despawn();
    return;
  }
  const self = r16(R.current_sprite);
  w16(R.invincibility_barrel_sprite, self);
  reg.x = self;
  work_on_active_kong_global();
  const b = r16(R.invincibility_barrel_sprite);
  reg.x = b;
  reg.a = r16(b + 0x42);
  disable_enemy_damage_global();
  if (!r16(R.invincibility_sprite)) {
    reg.y = C.special_sprite_spawn_id_0000;
    spawn_BB83EF_special_sprite_index();
    w16(R.invincibility_sprite, r16(R.alternate_sprite));
  }
  w16(R.current_sprite, self);
  delete_sprite_handle_deallocation();
  let x = cur();
  w16(x + sprite.type, r16(x + sprite.type) + 1); // revive the slot so the pieces spawn from it
  spawn_barrel_parts_and_smoke();
  x = cur();
  reg.x = x;
  w16(x + sprite.type, 0);
}

/** $B39AC0 */
export function unknown_sprite_01C8_main() {
  sprite_return_handle_despawn();
}

// ---------------------------------------------------------------------------------------------
// Cannonball
// ---------------------------------------------------------------------------------------------

/** $B39AC3 */
export function canball_main() {
  const state = throwableEntry();
  switch (state) {
    case 0:
      return CODE_B39ADB();
    case 1:
      return CODE_B39AFC();
    case 2:
      return CODE_B39B0F();
    case 3:
      return CODE_B39B11();
  }
}

/** $B39AD8 */
export function CODE_B39AD8() {}

/** $B39ADB — resting (rolls on slopes). */
export function CODE_B39ADB() {
  CODE_B39F10();
  if (reg.c) return;
  apply_sprite_gravity();
  CODE_B39EBE();
  CODE_B8D246();
  process_terrain_interaction_global();
  reg.a = 0x001d;
  process_alternate_movement();
  process_sprite_animation();
  sprite_return_handle_despawn();
}

/** $B39AFC — held. */
export function CODE_B39AFC() {
  CODE_B39F56();
  if (reg.c) return;
  update_held_sprite_position();
  process_sprite_animation();
  CODE_B39BA5();
  if (reg.c) CODE_B39B5F();
}

/** $B39B0F */
export function CODE_B39B0F() {
  CODE_B39AFC();
}

/** $B39B11 — thrown: rolls to a stop, or bounces off what it hits. */
export function CODE_B39B11() {
  let x = cur();
  w16(x + sprite.max_x_speed, 0);
  apply_sprite_gravity();
  CODE_B39EBE();
  process_terrain_interaction_global();
  reg.a = 0x001d;
  process_alternate_movement();
  x = reg.x;
  if (!(r16(x + sprite.x_speed) & 0xfff0) && (r16(x + sprite.terrain_interaction) & 0x0101) === 0x0101) return CODE_B39B43();
  CODE_B39B37();
}

/** $B39B37 */
export function CODE_B39B37() {
  CODE_B39BA5();
  if (reg.c) return CODE_B39B66();
  process_sprite_animation();
  sprite_return_handle_despawn();
}

/** $B39B43 — came to rest: back to a pick-up-able cannonball. */
export function CODE_B39B43() {
  sound(6, "cannonball_drop");
  const x = cur();
  reg.x = x;
  w16(x + sprite.state, 0);
  w16(x + sprite.interaction_flags, r16(x + sprite.interaction_flags) | 0x0001);
  reg.a = C.barrel_idle_anim_id;
  set_anim_handle_throwable();
  sprite_return_handle_despawn();
}

/** $B39B5F */
export function CODE_B39B5F() {
  w16(R.current_held_sprite, 0);
  CODE_B8D4AE();
  CODE_B39B66();
}

/** $B39B66 — hit something: a cannon swallows it, anything else makes it bounce back. */
export function CODE_B39B66() {
  let x = r16(R.colliding_sprite);
  if (r16(x + sprite.type) === C.sprite_cannon) return CODE_B39B9E();
  sound(6, "barrel_blast");
  x = cur();
  reg.x = x;
  w16(x + sprite.x_speed, asr1(asr1(r16(x + sprite.x_speed))));
  w16(x + sprite.max_x_speed, 0);
  w16(x + sprite.state, 0);
  w16(x + sprite.y_speed, 0xfa00);
  w16(x + sprite.interaction_flags, r16(x + sprite.interaction_flags) | 0x0001);
  reg.a = C.barrel_idle_anim_id;
  set_anim_handle_throwable();
}

/** $B39B9E */
export function CODE_B39B9E() {
  CODE_BBBB44();
}

/** $B39BA5 */
export function CODE_B39BA5() {
  throwableCollision(0x0420, 0x0008);
}

// ---------------------------------------------------------------------------------------------
// Chest / Swanky prize (the item that pops out of a chest)
// ---------------------------------------------------------------------------------------------

/** $B39BB4 — also unknown_sprite_00CC_main. $42 = reward item id. */
export function chest_or_swanky_prize() {
  const state = throwableEntry();
  switch (state) {
    case 0:
      return CODE_B39C0A();
    case 1:
      return CODE_B39C0E();
    case 2:
      return CODE_B39C33();
    case 3:
      return CODE_B39C6C();
    case 4:
      return CODE_B39C79();
  }
}

/** $B39BCB — terrain for the popping prize (some items land on an invisible floor at $4E). */
export function CODE_B39BCB() {
  const x = cur();
  reg.x = x;
  const item = r16(x + 0x42);
  if (item === 0x001b) return CODE_B39BF0();
  if (item >= 0x0008 && item < 0x000c) {
    // carry is clear here (after the failed BCS), so this subtracts $101
    const v = (r16(x + sprite.y_speed) - 0x0101) & 0xffff;
    if (!(v & 0x8000) && r16(x + sprite.y_position) >= r16(x + 0x4e)) return CODE_B39C02();
  }
  CODE_B39BEB();
}

/** $B39BEB */
export function CODE_B39BEB() {
  process_terrain_interaction_global();
}

/** $B39BF0 — this item lands at the Kong's height. */
export function CODE_B39BF0() {
  apply_position_from_velocity_global();
  const x = cur();
  reg.x = x;
  const y = r16(R.active_kong_sprite);
  reg.y = y;
  if (!((r16(x + sprite.y_position) - r16(y + sprite.y_position)) & 0x8000)) CODE_B39C02();
}

/** $B39C02 — landed. */
export function CODE_B39C02() {
  const x = reg.x;
  w16(x + sprite.terrain_interaction, 0x0101);
  w16(x + sprite.y_speed, 0);
}

/** $B39C0A */
export function CODE_B39C0A() {
  const x = cur();
  w16(x + sprite.state, r16(x + sprite.state) + 1);
  CODE_B39C0E();
}

/** $B39C0E — falling until landed. */
export function CODE_B39C0E() {
  apply_sprite_gravity();
  CODE_B39BCB();
  const x = cur();
  reg.x = x;
  if ((r16(x + sprite.terrain_interaction) & 0x0101) === 0x0101) return CODE_B39C2E();
  if (r16(x + 0x42) !== 0x0010) delete_sprite_if_offscreen();
}

/** $B39C2B */
export function CODE_B39C2B() {}

/** $B39C2E */
export function CODE_B39C2E() {
  const x = reg.x;
  w16(x + sprite.state, r16(x + sprite.state) + 1);
}

/** $B39C33 */
export function CODE_B39C33() {
  CODE_B39C39();
}

/** $B39C39 — turn this slot into the actual reward sprite (its init script). */
export function CODE_B39C39() {
  let x = cur();
  w16(R.alternate_sprite, x);
  reg.x = x;
  reg.a = r16(x + sprite.oam_property);
  dereference_sprite_palette_global();
  x = cur();
  const item = r16(x + 0x42);
  reg.y = rom16(ITEM_REWARD_INIT_SCRIPTS_TABLE + ((item << 1) & 0xffff));
  reg.x = x;
  apply_spawn_script_to_slot_global();
  if (item === 0x0013) {
    x = r16(R.alternate_sprite);
    const n = (r16(x + 0x44) - 1) & 0xffff;
    w16(x + 0x44, n);
    if (!n) w16(x + 0x42, r16(x + 0x46));
  }
  x = r16(R.alternate_sprite);
  reg.x = x;
  w16(x + sprite.unknown_2C, 0);
  w16(x + sprite.placement_number, 0);
}

/** $B39C6C — rising out of the chest. */
export function CODE_B39C6C() {
  process_current_movement();
  const x = reg.x;
  if (r16(x + sprite.y_speed) & 0x8000) return;
  w16(x + sprite.state, r16(x + sprite.state) + 1);
}

/** $B39C79 — collectable once the Kong touches it. */
export function CODE_B39C79() {
  process_sprite_animation();
  process_current_movement();
  reg.a = r16(reg.x + sprite.movement_state);
  get_current_sprite_clipping();
  CODE_BEBE6D();
  if (!reg.c) return;
  CODE_B39C39();
  // the slot now holds a new sprite: step current_sprite back so the handler runs it this frame
  w16(R.current_sprite, (reg.x - 0x5e) & 0xffff);
}

/** $B39C97 */
export function CODE_B39C97() {}

// ---------------------------------------------------------------------------------------------
// Chest
// ---------------------------------------------------------------------------------------------

/** $B39C9A */
export function chest_main() {
  const state = throwableEntry();
  switch (state) {
    case 0:
      return CODE_B39CB2();
    case 1:
      return CODE_B39CEA();
    case 2:
      return CODE_B39CFD();
    case 3:
      return CODE_B39CFF();
  }
}

/** $B39CAF */
export function CODE_B39CAF() {}

/** $B39CB2 — resting. */
export function CODE_B39CB2() {
  CODE_B39F10();
  if (reg.c) return;
  apply_sprite_gravity();
  CODE_B39EBE();
  CODE_B8D246();
  process_terrain_interaction_global();
  reg.a = 0x001d;
  process_alternate_movement();
  process_sprite_animation();
  CODE_B39CD0();
}

/** $B39CD0 */
export function CODE_B39CD0() {
  sprite_return_handle_despawn();
}

/** $B39CE7 */
export function CODE_B39CE7() {
  sprite_return_handle_despawn();
}

/** $B39CEA — held. */
export function CODE_B39CEA() {
  CODE_B39F56();
  if (reg.c) return;
  update_held_sprite_position();
  process_sprite_animation();
  CODE_B39E9C();
  if (reg.c) CODE_B39D3F();
}

/** $B39CFD */
export function CODE_B39CFD() {
  CODE_B39CEA();
}

/** $B39CFF — thrown. */
export function CODE_B39CFF() {
  let x = cur();
  w16(x + sprite.max_x_speed, 0);
  apply_sprite_gravity();
  CODE_B39EBE();
  process_terrain_interaction_global();
  reg.a = 0x001d;
  process_alternate_movement();
  x = cur();
  reg.x = x;
  if (!(r16(x + sprite.x_speed) & 0xfff0) && (r16(x + sprite.terrain_interaction) & 0x0101) === 0x0101) return CODE_B39D33();
  CODE_B39D27();
}

/** $B39D27 */
export function CODE_B39D27() {
  CODE_B39E9C();
  if (reg.c) return CODE_B39D42();
  process_sprite_animation();
  CODE_B39CD0();
}

/** $B39D33 — stopped without breaking: can be picked up again. */
export function CODE_B39D33() {
  const x = reg.x;
  w16(x + sprite.state, 0);
  w16(x + sprite.interaction_flags, r16(x + sprite.interaction_flags) | 0x0001);
  CODE_B39CD0();
}

/** $B39D3F */
export function CODE_B39D3F() {
  w16(R.current_held_sprite, 0);
  CODE_B39D42();
}

/** $B39D42 — the chest breaks open and releases its prize. */
export function CODE_B39D42() {
  sound(6, "barrel_blast");
  reg.x = cur();
  CODE_B8D4AE();
  delete_sprite_handle_deallocation();
  let x = cur();
  reg.x = x;
  w16(x + sprite.type, 0x0001); // keep the slot alive while spawning from it
  reg.a = r16(x + 0x42);
  CODE_B39DB0();
  w16(x + 0x42, reg.a);
  reg.x = (reg.a << 1) & 0xffff;
  reg.y = rom16(DATA_FF18CE + reg.x);
  spawn_special_sprite_address();
  if (reg.c) return;
  x = r16(R.alternate_sprite);
  let y = cur();
  reg.x = x;
  w16(x + 0x42, r16(y + 0x42));
  w16(x + 0x44, r16(y + 0x44));
  w16(x + 0x46, r16(y + 0x46));
  w16(x + sprite.placement_parameter, 0x0022);
  y = r16(R.active_kong_sprite);
  // the prize stops halfway between the chest and the Kong, but not below the screen middle
  const floor = ((r16(y + sprite.y_position) + r16(x + sprite.y_position)) & 0xffff) >> 1;
  y = r16(R.alternate_sprite);
  w16(y + 0x4e, floor);
  const limit = (r16(R.screen_scroll_y_position) + 0x0070) & 0xffff;
  if (limit >= floor) w16(y + 0x4e, limit);
  CODE_B39DA5();
}

/** $B39DA5 */
export function CODE_B39DA5() {
  spawn_barrel_parts_and_smoke_global();
  const x = cur();
  reg.x = x;
  w16(x + sprite.type, 0);
}

/** $B39DAD */
export function CODE_B39DAD() {}

/**
 * $B39DB0 — A = chest prize; prizes 1-4 are KONG letters: a letter already collected becomes
 * prize 0 instead. X is preserved.
 */
export function CODE_B39DB0() {
  const a = reg.a & 0xffff;
  reg.z = a === 0;
  if (a === 0 || a >= 0x0005) return;
  const bits = r16(R.collected_kong_letters) & rom16(DATA_B39DC7 + a);
  reg.a = bits ? 0 : a;
  reg.z = reg.a === 0;
}

// ---------------------------------------------------------------------------------------------
// Plain barrel (state handler with sub states)
// ---------------------------------------------------------------------------------------------

/**
 * $B39DCC — `JSR sprite_state_handler_B3` uses the return address as the state table. Here that
 * dispatch is done directly: DB = $B3, sprite constants loaded, state byte bit 7 = special
 * (CODE_B3D249), else state & $7F indexes the table; A = sub_state * 2.
 */
export function barrel_main() {
  reg.db = 0xb3;
  const y = cur();
  reg.y = y;
  useOwnConstants(y);
  const stateByte = r16(y + sprite.state) & 0xff;
  if (stateByte & 0x80) return spriteTail(CODE_B3D249);
  const i = stateByte & 0x7f;
  reg.x = (L("barrel_main") + 3 + i * 2) & 0xffff;
  reg.a = ((r16(y + sprite.sub_state) & 0xff) << 1) & 0xffff;
  switch (i) {
    case 0:
      return CODE_B39DDA();
    case 1:
      return CODE_B39DFC();
    case 2:
      return CODE_B39E10();
    case 3:
      return CODE_B39E24();
    default:
      throw new Error(`barrel_main: state ${i} outside its table`);
  }
}

/** $B39DD7 */
export function CODE_B39DD7() {}

/** $B39DDA — resting. */
export function CODE_B39DDA() {
  const x = cur();
  reg.x = x;
  if (r16(x + sprite.terrain_attributes) & 0x0100) return CODE_B39DF9();
  CODE_B39F10();
  if (reg.c) return;
  apply_sprite_gravity();
  CODE_B39EBE();
  process_terrain_interaction_global();
  process_sprite_animation();
  sprite_return_handle_despawn();
}

/** $B39DF9 */
export function CODE_B39DF9() {
  CODE_B39E74();
}

/** $B39DFC — held. */
export function CODE_B39DFC() {
  CODE_B39F56();
  if (reg.c) return;
  update_held_sprite_position();
  process_sprite_animation();
  CODE_B39E8D();
  if (reg.c) CODE_B39E71();
}

/** $B39E10 — held, being thrown. */
export function CODE_B39E10() {
  CODE_B39F56();
  if (reg.c) return;
  update_held_sprite_position();
  process_sprite_animation();
  CODE_B39E9C();
  if (reg.c) CODE_B39E71();
}

/** $B39E24 — thrown: rolls, turns at a wall once, breaks at a second wall or on a hit. */
export function CODE_B39E24() {
  apply_sprite_gravity();
  CODE_B39EBE();
  process_terrain_interaction_global();
  const x = cur();
  reg.x = x;
  const walls = r16(x + sprite.terrain_interaction) & 0x0202;
  if (walls) {
    if (walls === 0x0202) return CODE_B39E74();
    reg.y = 0x0006;
    let v = spriteConst(6);
    if (r16(x + sprite.oam_property) & 0x4000) v = neg(v);
    CODE_B39E49_store(x, v);
  }
  CODE_B39E4D();
}

function CODE_B39E49_store(x: number, v: number) {
  reg.a = v;
  w16(x + sprite.x_speed, v);
  w16(x + sprite.max_x_speed, v);
}

/** $B39E49 (A = speed, X = barrel) */
export function CODE_B39E49() {
  CODE_B39E49_store(reg.x, reg.a);
  CODE_B39E4D();
}

/** $B39E4D */
export function CODE_B39E4D() {
  CODE_B39E9C();
  if (reg.c) {
    if (r16(R.level_number) === C.level_kreepy_krow) return CODE_B39E74();
    if (r16(reg.y + sprite.type) === C.sprite_klobber_body) return CODE_B39E74();
  }
  CODE_B39E61();
}

/** $B39E61 */
export function CODE_B39E61() {
  process_sprite_animation();
  const x = cur();
  reg.x = x;
  if (r16(x + sprite.state) & 0xff00) return CODE_B39E86();
  sprite_return_handle_despawn();
}

/** $B39E71 */
export function CODE_B39E71() {
  w16(R.current_held_sprite, 0);
  CODE_B39E74();
}

/** $B39E74 — smash. */
export function CODE_B39E74() {
  sound(5, "barrel_blast");
  spawn_barrel_parts_and_smoke_global();
  delete_sprite_handle_deallocation();
}

/** $B39E86 */
export function CODE_B39E86() {
  delete_sprite_if_offscreen();
}

/** $B39E8D — held object collision (big range). */
export function CODE_B39E8D() {
  throwableCollision(0x1020, 0x0010);
}

/** $B39E9C — thrown object collision. */
export function CODE_B39E9C() {
  throwableCollision(0x1020, 0x0008);
}

/** $B39EAB — TNT collision. */
export function CODE_B39EAB() {
  throwableCollision(0x1020, 0x0108);
}

/** $B39EBA */
export function CODE_B39EBA() {
  CODE_B39EBE();
}

/** $B39EBE — approach max_x_speed with the acceleration from constants +4. */
export function CODE_B39EBE() {
  reg.y = 0x0004;
  reg.a = spriteConst(4);
  interpolate_x_velocity_global();
}

/** $B39EC8 */
export function apply_sprite_gravity_global() {
  apply_sprite_gravity();
}

/** $B39ECC — gravity from constants +0, capped at constants +2 while falling. */
export function apply_sprite_gravity() {
  const x = cur();
  reg.x = x;
  reg.y = 0x0002;
  let v = (spriteConst(0) + r16(x + sprite.y_speed)) & 0xffff;
  if (!(v & 0x8000) && v >= spriteConst(2)) v = spriteConst(2);
  w16(x + sprite.y_speed, v);
  reg.a = v;
}

/** $B39EEE */
export function apply_x_acceleration() {
  CODE_B39EBE();
}

/** $B39EF8 — same as apply_sprite_gravity. */
export function apply_sprite_gravity_2() {
  apply_sprite_gravity();
}

// ---------------------------------------------------------------------------------------------
// Pickup / throw handling (carry_or_defeat_flags is set by the Kong code)
// ---------------------------------------------------------------------------------------------

/** $B39F10 — resting object: picked up (1) or destroyed (0200)? Carry set = handled. */
export function CODE_B39F10() {
  const x = cur();
  reg.x = x;
  const f = r16(x + sprite.carry_or_defeat_flags);
  if (!f) {
    reg.c = false;
    return;
  }
  w16(x + sprite.carry_or_defeat_flags, 0);
  if (f === 0x0001) return CODE_B39F26();
  if (f === 0x0200) return CODE_B39F42();
  reg.c = false;
}

/** $B39F26 — picked up. */
export function CODE_B39F26() {
  const x = reg.x;
  w16(x + sprite.state, 0x0001);
  w16(x + sprite.interaction_flags, r16(x + sprite.interaction_flags) & 0xfffc);
  w16(x + sprite.x_speed, 0);
  w16(x + 0x48, 0xffff);
  reg.a = C.barrel_carry_anim_id;
  set_anim_handle_throwable();
  reg.c = true;
}

/** $B39F42 — destroyed. */
export function CODE_B39F42() {
  w16(R.current_held_sprite, 0);
  sound(5, "barrel_blast");
  spawn_barrel_parts_and_smoke_global();
  delete_sprite_handle_deallocation();
  reg.c = true;
}

/**
 * $B39F56 — held object: 1 = put down, 2 = throw starts, 4/6 = thrown, 5 = dropped,
 * 0200 = destroyed; with no flags, a Kong that lost hold of it (current_held_sprite = 0)
 * drops it. Carry set = state changed.
 */
export function CODE_B39F56() {
  const x = cur();
  reg.x = x;
  const f = r16(x + sprite.carry_or_defeat_flags);
  if (!f) {
    if (r16(R.current_held_sprite)) {
      reg.c = false;
      return;
    }
    return CODE_B39F8F();
  }
  CODE_B39F63();
}

/** $B39F61 */
export function CODE_B39F61() {
  reg.c = false;
}

/** $B39F63 (A = flags, X = sprite) */
export function CODE_B39F63() {
  const x = reg.x;
  const f = r16(x + sprite.carry_or_defeat_flags);
  w16(x + sprite.carry_or_defeat_flags, 0);
  switch (f) {
    case 0x0001:
      return CODE_B39FBD();
    case 0x0002:
      return CODE_B39F88();
    case 0x0004:
    case 0x0006:
      return CODE_B39FD4();
    case 0x0005:
      return CODE_B39F8F();
    case 0x0200:
      return CODE_B39F85();
    default:
      return CODE_B39F61();
  }
}

/** $B39F85 */
export function CODE_B39F85() {
  CODE_B39F42();
}

/** $B39F88 */
export function CODE_B39F88() {
  w16(reg.x + sprite.state, 0x0002);
  reg.c = true;
}

/** $B39F8F — dropped: a DK barrel dropped by a hurt Kong flies off (state 7), others are thrown. */
export function CODE_B39F8F() {
  const x = reg.x;
  if (r16(x + sprite.type) !== C.sprite_dk_barrel) return CODE_B39FD4();
  get_state_death_and_mounting_flags();
  reg.x = x;
  if (!(reg.a & 0x0001)) return CODE_B39FD4();
  w8(x + sprite.state, 0x07);
  w16(x + sprite.max_x_speed, 0);
  w16(x + sprite.y_speed, 0xfd00);
  w16(x + sprite.x_speed, 0x0100);
  w16(x + sprite.oam_property, r16(x + sprite.oam_property) | 0x3000);
  CODE_B39FDC();
}

/** $B39FBD — put down. */
export function CODE_B39FBD() {
  const x = reg.x;
  w16(x + sprite.state, 0);
  w16(x + sprite.interaction_flags, r16(x + sprite.interaction_flags) | 0x0003);
  w16(x + sprite.render_order, 0x00c8);
  reg.a = C.barrel_idle_placed_anim_id;
  set_anim_handle_throwable();
  reg.c = true;
}

/** $B39FD4 — thrown (state 3). */
export function CODE_B39FD4() {
  w8(reg.x + sprite.state, 0x03);
  CODE_B39FDC();
}

/** $B39FDC — throw speed from constants +6 in the direction of x_speed. */
export function CODE_B39FDC() {
  const x = reg.x;
  w16(x + sprite.render_order, 0x00c8);
  reg.y = 0x0006;
  let v = spriteConst(6);
  if (r16(x + sprite.x_speed) & 0x8000) v = neg(v);
  CODE_B39FEE_store(x, v);
}

function CODE_B39FEE_store(x: number, v: number) {
  w16(x + sprite.max_x_speed, v);
  w16(x + sprite.oam_property, mergeBits(r16(x + sprite.oam_property), v >> 1, 0x4000));
  reg.a = C.barrel_thrown_anim_id;
  set_anim_handle_throwable();
  reg.c = true;
}

/** $B39FEE (A = speed, X = sprite) */
export function CODE_B39FEE() {
  CODE_B39FEE_store(reg.x, reg.a & 0xffff);
}

/** $B3A003 */
export function update_held_sprite_position_global() {
  update_held_sprite_position();
}

/** $B3A007 — keep the held object at the Kong's hands (held_sprite_x/y_offset) and in front of him. */
export function update_held_sprite_position() {
  const x = r16(R.active_kong_sprite);
  const y = cur();
  reg.x = x;
  reg.y = y;
  const dx = r16(R.held_sprite_x_offset);
  const kx = r16(x + sprite.x_position);
  w16(y + sprite.x_position, r16(x + sprite.oam_property) & 0x4000 ? kx - dx : kx + dx);
  w16(y + sprite.y_position, r16(x + sprite.y_position) + r16(R.held_sprite_y_offset));
  reg.a = (r16(x + sprite.render_order) + r16(0x0d80)) & 0xffff;
  w16(y + sprite.render_order, reg.a);
}

registerSprite({
  dk_barrel_main,
  CODE_B393D9,
  CODE_B393ED,
  CODE_B39401,
  CODE_B39434,
  CODE_B3944D,
  CODE_B3946A,
  CODE_B39471,
  CODE_B39473,
  CODE_B3948B,
  dk_barrel_letters_main,
  tnt_barrel_main,
  CODE_B394E3,
  CODE_B394E6,
  CODE_B39505,
  CODE_B39519,
  CODE_B3951B,
  CODE_B3953A,
  CODE_B3953D,
  CODE_B39569,
  CODE_B3957E,
  wooden_box_main,
  CODE_B39595,
  CODE_B39598,
  CODE_B395AE,
  CODE_B395C2,
  CODE_B395C4,
  CODE_B395E3,
  CODE_B395E6,
  unknown_sprite_0244_main,
  animal_crate_main,
  invincibility_barrel_main,
  unknown_sprite_01C8_main,
  canball_main,
  CODE_B39AD8,
  CODE_B39ADB,
  CODE_B39AFC,
  CODE_B39B0F,
  CODE_B39B11,
  CODE_B39B37,
  CODE_B39B43,
  CODE_B39B5F,
  CODE_B39B66,
  CODE_B39B9E,
  chest_or_swanky_prize,
  CODE_B39C0A,
  CODE_B39C0E,
  CODE_B39C2B,
  CODE_B39C2E,
  CODE_B39C33,
  CODE_B39C6C,
  CODE_B39C79,
  CODE_B39C97,
  chest_main,
  CODE_B39CAF,
  CODE_B39CB2,
  CODE_B39CD0,
  CODE_B39CE7,
  CODE_B39CEA,
  CODE_B39CFD,
  CODE_B39CFF,
  CODE_B39D27,
  CODE_B39D33,
  CODE_B39D3F,
  CODE_B39D42,
  CODE_B39DA5,
  CODE_B39DAD,
  barrel_main,
  CODE_B39DD7,
  CODE_B39DDA,
  CODE_B39DF9,
  CODE_B39DFC,
  CODE_B39E10,
  CODE_B39E24,
  CODE_B39E49,
  CODE_B39E4D,
  CODE_B39E61,
  CODE_B39E71,
  CODE_B39E74,
  CODE_B39E86,
});
registerRtl({
  spawn_barrel_parts_and_smoke_global,
  spawn_barrel_parts_global,
  CODE_B39DB0,
  CODE_B39EBA,
  apply_sprite_gravity_global,
  update_held_sprite_position_global,
});
registerRts({
  spawn_barrel_parts_and_smoke,
  spawn_barrel_parts,
  CODE_B39779,
  CODE_B39BA5,
  CODE_B39BCB,
  CODE_B39BEB,
  CODE_B39BF0,
  CODE_B39C02,
  CODE_B39C39,
  CODE_B39E8D,
  CODE_B39E9C,
  CODE_B39EAB,
  CODE_B39EBE,
  apply_sprite_gravity,
  apply_x_acceleration,
  apply_sprite_gravity_2,
  CODE_B39F10,
  CODE_B39F26,
  CODE_B39F42,
  CODE_B39F56,
  CODE_B39F61,
  CODE_B39F63,
  CODE_B39F85,
  CODE_B39F88,
  CODE_B39F8F,
  CODE_B39FBD,
  CODE_B39FD4,
  CODE_B39FDC,
  CODE_B39FEE,
  update_held_sprite_position,
});
