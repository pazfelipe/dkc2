/**
 * Bank $B3 — Click-Clack, the beetle: jumping on it flips it over (stunned); a stunned
 * Click-Clack can be carried and thrown at enemies; each time it recovers it walks faster.
 * Variables: $48 walk speed, $4E stun timer.
 */
import { r16, w16 } from "../../core/mem";
import { reg } from "../../core/cpu";
import { L, R, C, sprite } from "../../core/sym";
import {
  check_throwable_collision_global, get_current_sprite_clipping, CODE_BEBE8B, CODE_BEBD8E,
  process_current_movement, process_sprite_animation, process_alternate_movement, queue_sound_effect,
  set_sprite_animation, spawn_special_sprite_index,
} from "../../gen/routines";
import { cur, rd, wr, dec, spriteConst, isNeg, bit14, neg, asr1, despawnReturn, stateHandlerB3, registerSprite } from "./b3b_common";
import {
  sound, CODE_B3A604, CODE_B3A3EB, set_state_and_animation, defeat_click_clack_with_velocity,
  defeat_click_clack_no_flip_velocity, update_held_position_no_return, update_held_position_return_1,
  update_held_position_return_2, apply_thrown_x_velocity, make_sprite_fall_off_screen,
} from "./b3b_misc";

const STATE_TABLE = (L("click_clack_main") + 3) & 0xffff;
const CLIP6_BOTTOM = 0x09a3 + 6 * 8 + 6; // sprite_clipping[6].bottom
const CLIP8_BOTTOM = 0x09a3 + 8 * 8 + 6; // sprite_clipping[8].bottom

/** $B3A739 */
export function click_clack_main(): void {
  stateHandlerB3(STATE_TABLE, [
    initState, idleState, stunnedAirborneState, stunnedOnGroundState, carriedState, thrownState,
    thrownAirborneState, stunRecoverState, defeatedState,
  ]);
}

/** Defeat with the given velocities (X speed away from the attacker). */
function defeatWith(xSpeed: number, ySpeed: number) {
  reg.a = xSpeed;
  reg.y = ySpeed;
  defeat_click_clack_with_velocity();
}

/** Throwable collision (flags $0118), then Kong collision with `flags`; carry = collided. */
function checkCollisions(flags: number) {
  reg.a = 0x0118;
  check_throwable_collision_global();
  if (reg.c) return;
  get_current_sprite_clipping();
  reg.a = flags;
  CODE_BEBE8B();
}

/** Collision of the held/thrown Click-Clack with enemies (Y = extra flags). */
function checkHeldCollision(y: number) {
  get_current_sprite_clipping();
  reg.a = 0x1020;
  reg.y = y;
  CODE_BEBD8E();
}

/** .init_state */
function initState(): void {
  const x = reg.y;
  reg.x = x;
  wr(x, 0x48, rd(x, sprite.max_x_speed)); // walking speed
  wr(x, sprite.state, rd(x, sprite.state) + 1);
  idleState();
}

/** .idle_state: walk; a stomp stuns it, other attacks defeat it. */
function idleState(): void {
  checkCollisions(0x5438);
  if (!reg.c) return animateAndMove();
  if (reg.a === 0) return defeatWith(0x0100, 0xf800);
  if (reg.a === 0x0001) return animateAndMove();
  // stunned: knocked up and away from the attacker
  reg.a = sound(5, "click_clack_hit");
  queue_sound_effect();
  reg.x = r16(R.colliding_sprite);
  reg.a = bit14(rd(reg.x, sprite.oam_property)) ? 0xff00 : 0x0100;
  const x = cur();
  reg.x = x;
  wr(x, sprite.max_x_speed, 0);
  wr(x, sprite.x_speed, reg.a);
  wr(x, sprite.y_speed, 0xfa00);
  // knockback for the attacker; in this version A is overwritten ($001E then $FF00), so the
  // interaction id passed is $FF00 and Y keeps whatever the sound routine left
  reg.a = 0xff00;
  CODE_B3A604();
  reg.y = 0x0164;
  reg.a = 0x0002;
  set_state_and_animation();
}

function animateAndMove() {
  process_current_movement();
  process_sprite_animation();
  despawnReturn();
}

/** .stunned_airborne_state: fly until the stunned-in-air animation ends. */
function stunnedAirborneState(): void {
  reg.a = 0x0022;
  process_alternate_movement();
  process_sprite_animation();
  const x = cur();
  reg.x = x;
  if (rd(x, sprite.animation_id) !== C.click_clack_stunned_air_anim_id) {
    wr(x, sprite.state, rd(x, sprite.state) + 1);
    wr(x, sprite.interaction_flags, rd(x, sprite.interaction_flags) | 0x0001); // can be picked up
    reg.y = 0x0008;
    reg.a = spriteConst(0x0008);
    wr(x, 0x4e, reg.a); // stun time
  }
  despawnReturn();
}

/** .stunned_on_ground_state: lying on its back until picked up or the stun wears off. */
function stunnedOnGroundState(): void {
  let x = reg.y;
  reg.x = x;
  const carry = rd(x, sprite.carry_or_defeat_flags);
  if (carry) {
    wr(x, sprite.carry_or_defeat_flags, 0);
    if (carry & 0x0001) {
      wr(x, sprite.state, 0x0004); // carried
      wr(x, sprite.interaction_flags, rd(x, sprite.interaction_flags) & 0xfffc);
      reg.y = 0x000a;
      wr(x, 0x4e, spriteConst(0x000a)); // time until it breaks free
    }
  }
  checkCollisions(0x542c);
  if (reg.c) return defeatWith(0x0100, 0xf800);
  x = reg.x;
  if (isNeg(dec(x, 0x4e))) {
    // recover from stun
    x = cur();
    reg.x = x;
    wr(x, sprite.interaction_flags, (rd(x, sprite.interaction_flags) & 0xfffe) | 0x0002);
    wr(x, 0x4e, 0x000f);
    increaseWalkSpeed();
    reg.y = C.click_clack_recover_anim_id;
    reg.a = 0x0007;
    return set_state_and_animation();
  }
  process_sprite_animation();
  reg.a = 0x0022;
  process_alternate_movement();
  despawnReturn();
}

/** .carried_state: held by a Kong; breaks free when its timer runs out. */
function carriedState(): void {
  const x = reg.y;
  reg.x = x;
  if (dec(x, 0x4e) === 0) {
    reg.a = C.click_clack_recover_anim_id;
    set_sprite_animation();
    return notStunned();
  }
  const ySpeed = rd(x, sprite.y_speed);
  if (rd(x, sprite.animation_id) !== C.click_clack_recover_anim_id || !isNeg(ySpeed) || ySpeed >= 0xfc00) {
    return notStunned();
  }
  // jumped out of the Kong's hands
  w16(R.current_held_sprite, 0);
  wr(x, 0x4e, 0x000f);
  wr(x, sprite.state, 0x0007);
  reg.a = 0xfe80; // (the intended knockback interaction $001E is overwritten in this version)
  CODE_B3A604();
  despawnReturn();
}

function notStunned() {
  const x = cur();
  reg.x = x;
  const carry = rd(x, sprite.carry_or_defeat_flags);
  wr(x, sprite.carry_or_defeat_flags, 0);
  if (carry === 0x0002) {
    // thrown
    update_held_position_no_return();
    reg.a = 0x0005;
    reg.y = C.click_clack_stunned_anim_id;
    return set_state_and_animation();
  }
  if (carry === 0x0001 || carry === 0x0005) {
    // put down, or dropped because the Kong was hit
    w16(R.current_held_sprite, 0);
    wr(x, 0x4e, 0x000f);
    wr(x, sprite.x_speed, 0);
    wr(x, sprite.max_x_speed, 0);
    update_held_position_return_1();
    reg.a = 0x0003;
    reg.y = C.click_clack_stunned_anim_id;
    return set_state_and_animation();
  }
  // still held: it hurts enemies it touches
  update_held_position_no_return();
  get_current_sprite_clipping();
  const kong = r16(R.active_kong_sprite);
  reg.y = kong;
  if (rd(kong, sprite.type) === C.sprite_dixie_kong) {
    // Dixie holds it higher: shorter hitbox
    reg.a = (r16(CLIP6_BOTTOM) - 0x0008) & 0xffff;
    w16(CLIP6_BOTTOM, reg.a);
    w16(CLIP8_BOTTOM, reg.a);
  }
  reg.a = 0x1020;
  reg.y = 0x0010;
  CODE_BEBD8E();
  if (!reg.c) {
    process_sprite_animation();
    return despawnReturn();
  }
  w16(R.current_held_sprite, 0);
  // the original loads X speed $0000, then (this version) overwrites it with $FB00 instead of
  // loading the Y speed; Y keeps the collision routine's value
  reg.a = 0xfb00;
  defeat_click_clack_with_velocity();
}

/** .thrown_state: just thrown (upward or forward). */
function thrownState(): void {
  process_sprite_animation();
  const x = cur();
  reg.x = x;
  const carry = rd(x, sprite.carry_or_defeat_flags);
  wr(x, sprite.carry_or_defeat_flags, 0);
  if (carry === 0x0005) {
    w16(R.current_held_sprite, 0);
    wr(x, 0x4e, 0x000f);
    wr(x, sprite.x_speed, 0);
    wr(x, sprite.max_x_speed, 0);
    wr(x, sprite.state, 0x0003);
    update_held_position_no_return();
    return despawnReturn();
  }
  if (carry & 0x0006) {
    // thrown forward
    wr(x, sprite.state, 0x0006);
    update_held_position_return_2();
    reg.a = 0x0200;
    apply_thrown_x_velocity();
    return despawnReturn();
  }
  // thrown upward
  reg.a = 0x0118;
  check_throwable_collision_global();
  if (!reg.c) checkHeldCollision(0x0010);
  if (reg.c) return defeatWith(0x0040, 0xfb00);
  update_held_position_no_return();
  despawnReturn();
}

/** .thrown_airborne_state: flying forward; wakes up when it lands. */
function thrownAirborneState(): void {
  reg.a = 0x0118;
  check_throwable_collision_global();
  if (!reg.c) checkHeldCollision(0x0008);
  if (reg.c) {
    const x = cur();
    reg.x = x;
    reg.a = asr1(asr1(rd(x, sprite.x_speed)));
    reg.y = 0xfb00;
    return defeat_click_clack_no_flip_velocity();
  }
  reg.a = 0x0022;
  process_alternate_movement();
  let x = reg.x;
  if (rd(x, sprite.terrain_interaction) & 0x0003) {
    // hit the ground: hit star, then recover (faster)
    w16(R.contact_flash_x_position, rd(x, sprite.x_position));
    w16(R.contact_flash_y_position, (rd(x, sprite.y_position) - 0x0008 - (reg.c ? 0 : 1)) & 0xffff);
    reg.y = C.special_sprite_spawn_id_0034;
    spawn_special_sprite_index();
    x = cur();
    reg.x = x;
    wr(x, sprite.x_speed, 0);
    wr(x, sprite.max_x_speed, 0);
    wr(x, 0x4e, 0);
    increaseWalkSpeed();
    reg.a = sound(5, "click_clack_hit");
    queue_sound_effect();
    reg.y = 0x0167;
    reg.a = 0x0007;
    return set_state_and_animation();
  }
  process_sprite_animation();
  CODE_B3A3EB();
}

/** .stun_recover_state: after a short delay, walk again. */
function stunRecoverState(): void {
  const x = reg.y;
  reg.x = x;
  const t = (rd(x, 0x4e) - 1) & 0xffff;
  if (!isNeg(t)) {
    wr(x, 0x4e, t);
    return recover();
  }
  checkCollisions(0x542b);
  if (reg.c) {
    if (reg.a === 0) return defeatWith(0x0040, 0xfb00);
    reg.x = cur();
    wr(reg.x, 0x4e, 0x003c);
    reg.a = 0xff00; // (the intended interaction $001E is overwritten in this version)
    CODE_B3A604();
  }
  recover();
}

function recover() {
  reg.a = 0x0022;
  process_alternate_movement();
  process_sprite_animation();
  const x = cur();
  reg.x = x;
  if (rd(x, sprite.animation_id) === C.click_clack_walk_anim_id) {
    reg.a = rd(x, 0x48);
    if (bit14(rd(x, sprite.oam_property))) reg.a = neg(reg.a);
    wr(x, sprite.max_x_speed, reg.a);
    wr(x, sprite.state, 0x0001);
  }
  despawnReturn();
}

/** .defeated_state */
function defeatedState(): void {
  process_current_movement();
  process_sprite_animation();
  make_sprite_fall_off_screen();
}

/** .increase_walk_speed: double the walking speed, up to $0600. */
function increaseWalkSpeed() {
  const x = cur();
  reg.x = x;
  let speed = rd(x, 0x48);
  if (isNeg(speed)) {
    speed = neg(speed);
    wr(x, 0x48, speed);
  }
  speed = (speed * 2) & 0xffff;
  if (speed >= 0x0600) speed = 0x0600;
  reg.a = speed;
  wr(x, 0x48, speed);
}

registerSprite({ click_clack_main });
