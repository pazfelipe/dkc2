/**
 * Bank $B3 — the generic enemy main shared by Klinger, Klomp, Neek, Spiny, Zinger, Flitter and
 * Klampon. Its behaviour is data driven by the sprite constants:
 *   +$08 collision flags ($6000 = invulnerable red Zinger), +$0A/+$0C defeat animation/state,
 *   +$0E/+$10 animation/state when an attack failed, +$12/+$14 animation/state for other hits.
 */
import { r16, w16 } from "../../core/mem";
import { reg } from "../../core/cpu";
import { L, R, C, sprite } from "../../core/sym";
import {
  check_throwable_collision_global, queue_sound_effect, get_current_sprite_clipping, CODE_BEBE8B,
  process_current_movement, set_sprite_animation,
} from "../../gen/routines";
import {
  cur, rd, wr, spriteConst, isNeg, bit14, neg, despawnReturn, stateHandlerB3, subState, registerSprite,
} from "./b3b_common";
import {
  sound, process_animation_handle_submerged, check_for_sprite_crush, defeat_sprite_using_animation,
  make_sprite_fall_off_screen,
} from "./b3b_misc";

const GENERIC_STATE_TABLE = (L("generic_sprite_main") + 3) & 0xffff;

/** $B3A411 — Klampon: frozen by a time stop unless it is in the middle of a bite. */
export function klampon_main(): void {
  if (!(r16(R.time_stop_flags) & 0x0004)) return generic_sprite_main();
  reg.y = cur();
  reg.a = rd(reg.y, sprite.animation_id);
  if (reg.a === C.klampon_bite_anim_id) return generic_sprite_main();
}

/** $B3A426 — Zinger: buzzing loop sound while alive. */
export function zinger_main(): void {
  reg.y = cur();
  if (rd(reg.y, sprite.state) !== 0x0001) incLoopSound(R.zinger_loop_sound_enabler);
  castleCrushFloorCheck();
}

/** $B3A435 — Flitter: same as Zinger with its own loop sound. */
export function flitter_main(): void {
  reg.y = cur();
  if (rd(reg.y, sprite.state) !== 0x0001) incLoopSound(R.flitter_loop_sound_enabler);
  castleCrushFloorCheck();
}

/** `INC loop_sound_enabler` runs with a 16-bit accumulator: the carry goes into the next byte. */
function incLoopSound(addr: number) {
  w16(addr, r16(addr) + 1);
}

/** .castle_crush_floor_check: an idle flyer 192 px below the crush floor gets crushed. */
function castleCrushFloorCheck(): void {
  const floor = r16(0x0d54);
  reg.a = floor;
  if (isNeg(floor)) return generic_sprite_main();
  reg.a = (floor + 0x00c0) & 0xffff;
  const y = cur();
  reg.y = y;
  if (reg.a >= rd(y, sprite.y_position)) return generic_sprite_main();
  reg.a = rd(y, sprite.state);
  if (reg.a !== 0) return generic_sprite_main();
  crushFlyingSprite();
}

/** $B3A45A — klinger_main / klomp_main / neek_main / spiny_main / unknown_sprite_01F4_main. */
export function generic_sprite_main(): void {
  stateHandlerB3(GENERIC_STATE_TABLE, [idleState, defeatedState, resetState, resetState]);
}

/** .idle_state: collisions, then animation and movement. */
function idleState(): void {
  if (spriteConst(0x0008) === 0x6000) {
    // Red Zinger. The original also ORs $0080 into "interaction_flags,x", but X holds the
    // state table address there (DB = $B3), so that write goes to ROM and has no effect.
    reg.a = 0x0100;
    check_throwable_collision_global();
    if (reg.c) {
      reg.a = sound(5, "zinger_flitter_hit");
      queue_sound_effect();
    }
  } else {
    reg.a = 0x0118;
    check_throwable_collision_global();
    if (reg.c) return spriteCollided();
  }
  get_current_sprite_clipping();
  reg.y = 0x0008;
  reg.a = spriteConst(0x0008);
  CODE_BEBE8B();
  if (reg.c) return spriteCollided();
  animationAndMovementUpdate();
}

/** ..animation_and_movement_update */
function animationAndMovementUpdate(): void {
  process_animation_handle_submerged();
  const x = reg.x;
  reg.a = rd(x, sprite.type);
  if (reg.a === C.sprite_klinger && rd(x, 0x48) !== 0) {
    // a Klinger waiting at the end of its rope
    wr(x, 0x48, rd(x, 0x48) - 1);
    return despawnReturn();
  }
  process_current_movement();
  check_for_sprite_crush();
  if (!reg.c) return defeatSprite();
  despawnReturn();
}

/** ..sprite_collided: A = collision result (0 defeated, 1 failed attack, 2+ other). */
function spriteCollided(): void {
  if (reg.a === 0) return defeatSprite();
  if (reg.a < 0x0002) return applyAnimationAndState(0x000e, 0x0010);
  applyAnimationAndState(0x0012, 0x0014);
}

/** ..defeat_sprite */
function defeatSprite(): void {
  reg.y = 0x000a;
  reg.a = spriteConst(0x000a);
  if (reg.a === 0) return animationAndMovementUpdate();
  defeat_sprite_using_animation();
  applyState(0x000c);
}

/** Play the constants' animation at `animOff` (if any), then apply the state at `stateOff`. */
function applyAnimationAndState(animOff: number, stateOff: number) {
  reg.y = animOff;
  reg.a = spriteConst(animOff);
  if (reg.a === 0) return animationAndMovementUpdate();
  set_sprite_animation();
  applyState(stateOff);
}

/** A new state restarts the main through the state handler; no state just moves. */
function applyState(stateOff: number) {
  const x = cur();
  reg.x = x;
  reg.y = stateOff;
  reg.a = spriteConst(stateOff);
  if (reg.a !== 0) {
    wr(x, sprite.state, reg.a);
    return generic_sprite_main();
  }
  process_current_movement();
  despawnReturn();
}

/** .defeated_state */
function defeatedState(): void {
  subState([passiveState, fallOffscreenAliveState, fallOffscreenDeadState]);
}

/** .passive_state */
function passiveState(): void {
  process_current_movement();
  process_animation_handle_submerged();
  make_sprite_fall_off_screen();
}

/** .fall_offscreen_alive_state: knocked away from the attacker. */
function fallOffscreenAliveState(): void {
  reg.x = r16(R.colliding_sprite);
  reg.a = bit14(rd(reg.x, sprite.oam_property)) ? 0xff00 : 0x0100;
  const x = cur();
  reg.x = x;
  wr(x, sprite.max_x_speed, reg.a);
  wr(x, sprite.x_speed, reg.a);
  wr(x, sprite.y_speed, 0xf800);
  wr(x, sprite.movement_state, 0x0004);
  reg.a = 0x0001;
  wr(x, sprite.state, reg.a);
  despawnReturn();
}

/** .fall_offscreen_dead_state: face away from the attacker and fall. */
function fallOffscreenDeadState(): void {
  const facing = rd(r16(R.colliding_sprite), sprite.oam_property) & 0x4000;
  const x = cur();
  reg.x = x;
  wr(x, sprite.oam_property, ((rd(x, sprite.oam_property) & 0xbfff) | facing) ^ 0x4000);
  reg.a = 0x0100;
  reg.y = 0xf800;
  applyDeadSpriteVelocity();
}

/** .crush_flying_sprite */
function crushFlyingSprite(): void {
  reg.x = r16(R.colliding_sprite);
  reg.a = 0x0080;
  reg.y = 0xfc00;
  applyDeadSpriteVelocity();
}

/** .apply_dead_sprite_velocity: X speed A (mirrored if sprite X is flipped), Y speed Y. */
function applyDeadSpriteVelocity(): void {
  if (bit14(rd(reg.x, sprite.oam_property))) reg.a = neg(reg.a);
  const x = cur();
  reg.x = x;
  wr(x, sprite.max_x_speed, reg.a);
  wr(x, sprite.x_speed, reg.a);
  wr(x, sprite.y_speed, reg.y);
  wr(x, sprite.movement_state, 0x0004);
  wr(x, sprite.state, 0x0001);
  w16(R.current_sprite_constants, rd(x, sprite.constants_address));
  reg.y = 0x000a;
  reg.a = spriteConst(0x000a);
  if (reg.a !== 0) defeat_sprite_using_animation();
  despawnReturn();
}

/** .state_2 / .state_3: back to idle. */
function resetState(): void {
  reg.x = reg.y;
  wr(reg.x, sprite.state, 0);
  despawnReturn();
}

registerSprite({
  klampon_main, zinger_main, flitter_main, generic_sprite_main, klinger_main: generic_sprite_main,
  klomp_main: generic_sprite_main, neek_main: generic_sprite_main, spiny_main: generic_sprite_main,
  unknown_sprite_01F4_main: generic_sprite_main,
});
