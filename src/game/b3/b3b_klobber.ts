/**
 * Bank $B3 — Klobber, the Kremling hiding in a barrel (or TNT barrel when $4E = 0).
 *
 * `klobber_main` is the barrel: it sits still until a Kong comes near, then spawns the body
 * sprite (`klobber_body_main`) and follows it ($42 links the two sprites both ways, $44/$45
 * hold the barrel's Y/X offset from the body). The body charges at the Kong and knocks it
 * back; jumping on it while it is idle turns it back into a normal barrel the Kong can carry.
 * When it runs into a Kong it steals bananas ($4E = 2) or a life ($4E >= 3).
 */
import { r16, w16, rom16 } from "../../core/mem";
import { reg } from "../../core/cpu";
import { L, R, C, sprite } from "../../core/sym";
import {
  check_throwable_collision_global, CODE_B39F10, get_current_sprite_clipping, CODE_BEBE8B,
  process_current_movement, apply_sprite_gravity, CODE_B39EBE, process_terrain_interaction_global,
  process_sprite_animation, queue_sound_effect, spawn_BB83EF_special_sprite_index,
  delete_sprite_handle_deallocation, spawn_barrel_parts_and_smoke_global, spawn_special_sprite_index,
  set_alt_sprite_animation, set_sprite_animation, apply_sprite_gravity_2, interpolate_x_velocity_global,
  check_if_sprite_offscreen_global, CODE_BBBB7B, CODE_BBBB44, CODE_BEBE6D, CODE_BEC678,
} from "../../gen/routines";
import {
  cur, rd, wr, dec, spriteConst, isNeg, bit14, neg, asr1, despawnReturn, stateHandlerB3, subState,
  spriteTail, registerRts, registerSprite,
} from "./b3b_common";
import { sound, check_for_sprite_crush, queue_sfx_if_on_screen, CODE_B3AFD7 } from "./b3b_misc";

const KLOBBER_TABLE = (L("klobber_main") + 3) & 0xffff;
const BODY_TABLE = (L("klobber_body_main") + 3) & 0xffff;
const KONG_STATE_FLAGS = L("kong_state_flags_table");
const BARREL_MAIN = L("barrel_main");
const TNT_BARREL_MAIN = L("tnt_barrel_main");

/** 16-bit SBC in decimal mode with carry set (both operands valid BCD). */
function bcdSub16(a: number, b: number): number {
  let result = 0;
  let borrow = 0;
  for (let shift = 0; shift < 16; shift += 4) {
    let d = ((a >> shift) & 0xf) - ((b >> shift) & 0xf) - borrow;
    borrow = d < 0 ? 1 : 0;
    if (borrow) d += 10;
    result |= (d & 0xf) << shift;
  }
  return result & 0xffff;
}

// ======================= the barrel =======================

/** $B3AA92 */
export function klobber_main(): void {
  stateHandlerB3(KLOBBER_TABLE, [CODE_B3AA9F, CODE_B3ABA9, CODE_B3ABB6, CODE_B3ABB6, CODE_B3ABD8]);
}

/** $B3AA9F — state 0: the dormant barrel (sub states: init, init, wait for the Kong). */
export function CODE_B3AA9F(): void {
  subState([CODE_B3AAA9, CODE_B3AAB4, CODE_B3AAD6]);
}

/** $B3AAA9 */
export function CODE_B3AAA9(): void {
  const x = cur();
  reg.x = x;
  wr(x, sprite.x_sub_position, rd(x, sprite.unknown_22));
  wr(x, sprite.movement_state, 0x000c);
  CODE_B3AAB4();
}

/** $B3AAB4 — become a still, carryable barrel. */
export function CODE_B3AAB4(): void {
  const x = cur();
  reg.x = x;
  wr(x, sprite.x_speed, 0);
  wr(x, sprite.max_x_speed, 0);
  wr(x, sprite.unknown_2C, 0);
  wr(x, sprite.interaction_flags, rd(x, sprite.interaction_flags) | 0x0021);
  wr(x, 0x42, 0);
  wr(x, sprite.state, 0x0200); // state 0, sub state 2
  wr(x, sprite.max_x_speed, 0);
  reg.a = C.klobber_barrel_idle_anim_id;
  set_sprite_animation();
}

/** $B3AAD6 — dormant: explode when hit, wake up when the Kong is close. */
export function CODE_B3AAD6(): void {
  reg.a = 0x0118;
  check_throwable_collision_global();
  if (reg.c && reg.a === 0) return CODE_B3AB28();
  CODE_B3AAE1();
}

/** $B3AAE1 */
export function CODE_B3AAE1(): void {
  // put back the carry flags the collision check consumed (it saved them in temp_5E)
  wr(reg.x, sprite.carry_or_defeat_flags, r16(R.temp_5E));
  CODE_B39F10();
  if (reg.c) return CODE_B3AB5E();
  const kong = r16(R.active_kong_sprite);
  reg.y = kong;
  reg.a = rd(kong, sprite.animation_flags) & 0xe000;
  if (reg.a === 0xe000) return CODE_B3AB17();
  if (reg.a === 0xa000) {
    get_current_sprite_clipping();
    reg.a = 0x5004;
    CODE_BEBE8B();
    if (reg.c) return CODE_B3AB28();
  }
  CODE_B3AB0A();
}

/** $B3AB0A */
export function CODE_B3AB0A(): void {
  process_current_movement();
  check_for_sprite_crush();
  if (!reg.c) return CODE_B3AB28();
  reg.a = rd(reg.x, sprite.movement_state);
  if (reg.a === 0) return CODE_B3AB61();
  CODE_B3AB17();
}

/** $B3AB17 — fall like a barrel. */
export function CODE_B3AB17(): void {
  apply_sprite_gravity();
  CODE_B39EBE();
  process_terrain_interaction_global();
  process_sprite_animation();
  despawnReturn();
}

/** $B3AB28 — destroyed: a TNT Klobber explodes, a normal one breaks. */
export function CODE_B3AB28(): void {
  if (rd(reg.x, 0x4e) !== 0) return CODE_B3AB4F();
  reg.a = sound(4, "boom");
  queue_sound_effect();
  reg.a = sound(6, "explosion");
  queue_sound_effect();
  reg.y = C.special_sprite_spawn_id_00E4;
  spawn_BB83EF_special_sprite_index();
  reg.y = C.special_sprite_spawn_id_00E6;
  spawn_BB83EF_special_sprite_index();
  delete_sprite_handle_deallocation();
}

/** $B3AB4F */
export function CODE_B3AB4F(): void {
  reg.a = sound(5, "barrel_blast");
  queue_sound_effect();
  spawn_barrel_parts_and_smoke_global();
  delete_sprite_handle_deallocation();
  CODE_B3AB5E();
}

/** $B3AB5E */
export function CODE_B3AB5E(): void {}

/** $B3AB61 — wake up: spawn the body and attach the barrel to it. */
export function CODE_B3AB61(): void {
  reg.y = rd(reg.x, 0x46);
  spawn_special_sprite_index();
  if (reg.c) return CODE_B3AB5E();
  const x = cur();
  const body = r16(R.alternate_sprite);
  reg.x = x;
  reg.y = body;
  wr(x, 0x42, body);
  w16(body + 0x42, x);
  wr(x, 0x44, 0);
  wr(x, sprite.state, 0x0004);
  wr(x, sprite.interaction_flags, 0);
  w16(body + sprite.constants_address, rd(x, sprite.constants_address));
  w16(body + sprite.oam_property, (r16(body + sprite.oam_property) & 0xbfff) | (rd(x, sprite.oam_property) & 0x4000));
  w16(body + 0x48, 0);
  w16(body + 0x4e, rd(x, 0x4e));
  reg.a = C.klobber_wake_anim_id;
  set_alt_sprite_animation();
}

/** $B3ABA9 — state 1: carried by a Kong, behaves as a (TNT) barrel. */
export function CODE_B3ABA9(): void {
  if (r16(reg.y + 0x4e) === 0) return CODE_B3ABB2();
  spriteTail(BARREL_MAIN);
}

/** $B3ABB2 */
export function CODE_B3ABB2(): void {
  spriteTail(TNT_BARREL_MAIN);
}

/** $B3ABB6 — states 2/3: turn into a real barrel sprite for good. */
export function CODE_B3ABB6(): void {
  const y = reg.y;
  w16(y + sprite.state, r16(y + sprite.state) | 0x8000);
  reg.a = r16(y + 0x4e);
  if (reg.a === 0) return CODE_B3ABCE();
  reg.a = C.sprite_barrel;
  w16(y + sprite.type, reg.a);
  spriteTail(BARREL_MAIN);
}

/** $B3ABCE */
export function CODE_B3ABCE(): void {
  reg.a = C.sprite_tnt_barrel;
  w16(reg.y + sprite.type, reg.a);
  spriteTail(TNT_BARREL_MAIN);
}

/** $B3ABD8 — state 4: follow the body. */
export function CODE_B3ABD8(): void {
  reg.x = cur();
  reg.y = rd(reg.x, 0x42);
  CODE_B3ABE2();
}

/** $B3ABE2 — place sprite X at sprite Y + the signed offsets in $44 (Y) / $45 (X), same facing. */
export function CODE_B3ABE2(): void {
  const x = reg.x;
  const y = reg.y;
  reg.a = rd(x, 0x44);
  CODE_B3AC08();
  wr(x, sprite.y_position, reg.a + r16(y + sprite.y_position));
  reg.a = rd(x, 0x45);
  CODE_B3AC08();
  wr(x, sprite.x_position, reg.a + r16(y + sprite.x_position));
  reg.a = (rd(x, sprite.oam_property) & 0xbfff) | (r16(y + sprite.oam_property) & 0x4000);
  wr(x, sprite.oam_property, reg.a);
}

/** $B3AC08 — sign-extend the low byte of A. */
export function CODE_B3AC08(): void {
  if (reg.a & 0x0080) return CODE_B3AC11();
  reg.a &= 0x00ff;
}

/** $B3AC11 */
export function CODE_B3AC11(): void {
  reg.a = (reg.a | 0xff00) & 0xffff;
}

// ======================= the body =======================

// Body variables: $42 barrel slot, $46 hits counter, $48 hit cooldown, $4A next animation
// speed, $4C turn timer, $4E what it steals (0 explodes, 2 bananas, 3+ a life).

/** $B3AC15 */
export function klobber_body_main(): void {
  stateHandlerB3(BODY_TABLE, [CODE_B3AC22, CODE_B3AC77, CODE_B3ACF1, CODE_B3AD3E, CODE_B3ADAF]);
}

/** Common start of the body states: crushed / knocked away unless standing on solid ground. */
function crushCheck(): boolean {
  CODE_B3AF78();
  if (reg.c) return true;
  CODE_B3AF8F();
  return false;
}

/** $B3AC22 — state 0: waking up. */
export function CODE_B3AC22(): void {
  if (!crushCheck()) return;
  CODE_B3AC2D();
}

/** $B3AC2D */
export function CODE_B3AC2D(): void {
  CODE_B3AE03();
  if (isNeg(reg.a)) return CODE_B3AC41();
  if (reg.a === 0) return CODE_B3AC3E();
  const x = reg.x;
  wr(x, sprite.animation_speed, (rd(x, sprite.animation_speed) >> 1) + rd(x, sprite.animation_speed));
  CODE_B3AC74();
}

/** $B3AC3E */
export function CODE_B3AC3E(): void {
  CODE_B3AE85();
  CODE_B3AC41();
}

/** $B3AC41 — when the run animation starts, turn towards the Kong if needed. */
export function CODE_B3AC41(): void {
  apply_sprite_gravity_2();
  process_terrain_interaction_global();
  process_sprite_animation();
  const x = cur();
  reg.x = x;
  if (rd(x, sprite.animation_id) === C.klobber_run_anim_id) {
    wr(x, 0x46, 0);
    wr(x, sprite.state, rd(x, sprite.state) + 1);
    const kong = r16(R.active_kong_sprite);
    reg.y = kong;
    const kongIsLeft = rd(x, sprite.x_position) >= r16(kong + sprite.x_position);
    if (((kongIsLeft ? 0x4000 : 0) ^ rd(x, sprite.oam_property)) & 0x4000) {
      wr(x, sprite.max_x_speed, 0);
      reg.a = C.klobber_turn_anim_id;
      set_sprite_animation();
    }
  }
  CODE_B3AC74();
}

/** $B3AC74 */
export function CODE_B3AC74(): void {
  CODE_B3ADA2();
}

/** $B3AC77 — state 1: running at the Kong. */
export function CODE_B3AC77(): void {
  if (!crushCheck()) return;
  CODE_B3AC82();
}

/** $B3AC82 */
export function CODE_B3AC82(): void {
  // $47 counts up every frame; its low byte ($46, hits) decays by one each wrap
  const y = reg.y;
  const sum = r16(y + 0x46) + 0x0400;
  reg.a = sum & 0xffff;
  if (sum > 0xffff) {
    reg.a &= 0x00ff;
    if (reg.a !== 0) reg.a--;
  }
  CODE_B3AC91();
}

/** $B3AC91 */
export function CODE_B3AC91(): void {
  w16(reg.y + 0x46, reg.a);
  CODE_B3AE03();
  if (isNeg(reg.a)) return CODE_B3ACA9();
  if (reg.a === 0) return CODE_B3AC9E();
  CODE_B3AD71();
}

/** $B3AC9E */
export function CODE_B3AC9E(): void {
  CODE_B3AE85();
  if (reg.c) return CODE_B3ACA6();
  CODE_B3AD71();
}

/** $B3ACA6 */
export function CODE_B3ACA6(): void {}

/** $B3ACA9 — speed up the run animation towards normal. */
export function CODE_B3ACA9(): void {
  const x = reg.x;
  reg.a = rd(x, 0x4a);
  if (reg.a !== 0) return CODE_B3ACB7();
  reg.a = rd(x, sprite.animation_speed);
  if (reg.a < 0x0101) return CODE_B3ACBB();
  reg.a = (reg.a - 0x0006) & 0xffff;
  CODE_B3ACB7();
}

/** $B3ACB7 */
export function CODE_B3ACB7(): void {
  wr(reg.x, sprite.animation_speed, reg.a);
  wr(reg.x, 0x4a, 0);
  CODE_B3ACBB();
}

/** $B3ACBB — turn around once the Kong is more than 16 px behind. */
export function CODE_B3ACBB(): void {
  const x = reg.x;
  const kong = r16(R.active_kong_sprite);
  reg.y = kong;
  reg.a = (r16(kong + sprite.x_position) - rd(x, sprite.x_position)) & 0xffff;
  if (reg.a >= 0x0010 && reg.a < 0xfff0 && isNeg(reg.a ^ rd(x, sprite.max_x_speed))) {
    wr(x, sprite.max_x_speed, neg(rd(x, sprite.max_x_speed)));
  }
  CODE_B3ACDA();
}

/** $B3ACDA — accelerate (constants +$08: low byte when speeding up, high byte when turning). */
export function CODE_B3ACDA(): void {
  const x = reg.x;
  const turning = isNeg(rd(x, sprite.max_x_speed) ^ rd(x, sprite.x_speed));
  reg.y = 0x0008;
  reg.a = spriteConst(0x0008);
  if (turning) reg.a = ((reg.a >> 8) | (reg.a << 8)) & 0xffff;
  reg.c = turning;
  CODE_B3ACE7();
}

/** $B3ACE7 */
export function CODE_B3ACE7(): void {
  reg.a &= 0x00ff;
  interpolate_x_velocity_global();
  CODE_B3AD71();
}

/** $B3ACF1 — state 2: knocked back after bumping into the Kong. */
export function CODE_B3ACF1(): void {
  if (!crushCheck()) return;
  CODE_B3ACFC();
}

/** $B3ACFC */
export function CODE_B3ACFC(): void {
  CODE_B3AE03();
  if (isNeg(reg.a)) return CODE_B3AD0E();
  if (reg.a === 0) return CODE_B3AD06();
  CODE_B3AD71();
}

/** $B3AD06 */
export function CODE_B3AD06(): void {
  CODE_B3AE85();
  if (!reg.c) return CODE_B3AD71();
}

/** $B3AD0E */
export function CODE_B3AD0E(): void {
  const x = reg.y;
  reg.x = x;
  if (isNeg(dec(x, 0x4c))) {
    CODE_B3AE72();
    if (reg.a === 0) return CODE_B3AD22();
  }
  CODE_B3AD18();
}

/** $B3AD18 */
export function CODE_B3AD18(): void {
  reg.a = 0x0008;
  interpolate_x_velocity_global();
  CODE_B3AD71();
}

/** $B3AD22 — back to running. */
export function CODE_B3AD22(): void {
  const x = reg.x;
  wr(x, sprite.state, 0x0001);
  reg.y = 0x0006;
  reg.a = spriteConst(0x0006);
  if (bit14(rd(x, sprite.oam_property))) reg.a = neg(reg.a);
  wr(x, sprite.max_x_speed, reg.a);
  wr(x, sprite.animation_speed, 0x0200);
  CODE_B3AD71();
}

/** $B3AD3E — state 3: defeated (jumped on), turns back into its barrel. */
export function CODE_B3AD3E(): void {
  if (!crushCheck()) return;
  CODE_B3AD49();
}

/** $B3AD49 */
export function CODE_B3AD49(): void {
  apply_sprite_gravity_2();
  process_terrain_interaction_global();
  process_sprite_animation();
  const body = cur();
  reg.y = body;
  reg.x = rd(body, 0x42);
  CODE_B3ABE2();
  if (r16(body + sprite.current_graphic) !== 0) return CODE_B3AD6E();
  // the animation ended: the barrel becomes a dormant barrel again, the body goes away
  wr(reg.x, sprite.state, 0);
  wr(reg.x, sprite.interaction_flags, r16(body + sprite.interaction_flags) & 0x0002);
  delete_sprite_handle_deallocation();
  CODE_B3AD6E();
}

/** $B3AD6E */
export function CODE_B3AD6E(): void {}

/** $B3AD71 — move; bumping into a wall turns the body around (with a thud). */
export function CODE_B3AD71(): void {
  apply_sprite_gravity_2();
  let x = reg.x;
  const maxSpeed = rd(x, sprite.max_x_speed);
  const speed = rd(x, sprite.x_speed);
  process_terrain_interaction_global();
  x = reg.x;
  reg.a = maxSpeed;
  reg.y = speed;
  if (maxSpeed !== rd(x, sprite.max_x_speed)) {
    wr(x, sprite.max_x_speed, maxSpeed);
    wr(x, sprite.x_speed, speed);
    if (!isNeg(maxSpeed ^ speed)) return CODE_B3AD95();
    reg.a = asr1(speed);
    wr(x, sprite.x_speed, reg.a);
  }
  CODE_B3AD9E();
}

/** $B3AD95 */
export function CODE_B3AD95(): void {
  reg.a = sound(5, "barrel_blast");
  queue_sfx_if_on_screen();
  CODE_B3AF28();
  CODE_B3AD9E();
}

/** $B3AD9E */
export function CODE_B3AD9E(): void {
  process_sprite_animation();
  CODE_B3ADA2();
}

/** $B3ADA2 — keep the barrel on the body; despawn both when far away. */
export function CODE_B3ADA2(): void {
  reg.y = cur();
  reg.x = rd(reg.y, 0x42);
  CODE_B3ABE2();
  CODE_B3ADD9();
}

/** $B3ADAF — state 4: knocked off screen (with its barrel). */
export function CODE_B3ADAF(): void {
  process_current_movement();
  process_sprite_animation();
  reg.y = cur();
  reg.x = rd(reg.y, 0x42);
  CODE_B3ABE2();
  check_if_sprite_offscreen_global();
  if (!reg.c) return CODE_B3ADD6();
  const x = cur();
  reg.x = x;
  w16(R.current_sprite, rd(x, 0x42));
  delete_sprite_handle_deallocation();
  reg.x = x;
  w16(R.current_sprite, x);
  delete_sprite_handle_deallocation();
  CODE_B3ADD6();
}

/** $B3ADD6 */
export function CODE_B3ADD6(): void {}

/** $B3ADD9 — far from the Kong (> $200 x / $100 y) and allowed to despawn: delete the body. */
export function CODE_B3ADD9(): void {
  reg.x = 0x0200;
  reg.y = 0x0100;
  CODE_B3AFD7();
  if (!reg.c) return CODE_B3AE02();
  const x = cur();
  reg.x = x;
  w16(R.current_sprite, rd(x, 0x42));
  CODE_BBBB7B();
  if (!reg.c) return CODE_B3ADFF(x);
  CODE_BBBB44();
  if (!reg.c) return CODE_B3ADFF(x);
  reg.x = x;
  w16(R.current_sprite, x);
  delete_sprite_handle_deallocation();
}

/**
 * $B3ADFF (PLX : STX current_sprite) — `saved` is the slot pushed by CODE_B3ADD9. Not registered:
 * it pulls a value from the stack, so it can only be entered from CODE_B3ADD9.
 */
export function CODE_B3ADFF(saved = cur()): void {
  reg.x = saved;
  w16(R.current_sprite, saved);
  CODE_B3AE02();
}

/** $B3AE02 */
export function CODE_B3AE02(): void {}

/**
 * $B3AE03 — collisions of the body. A = $FFFF nothing happened, 0 the Kong was bumped
 * (or the body is invincible-hit), 1 the body was defeated (state 3).
 */
export function CODE_B3AE03(): void {
  reg.a = 0x0118;
  check_throwable_collision_global();
  if (reg.c) return CODE_B3AE5C();
  const x = reg.x;
  if (rd(x, 0x48) !== 0) {
    wr(x, 0x48, rd(x, 0x48) - 1);
    return CODE_B3AE12();
  }
  CODE_B3AE16();
}

/** $B3AE12 */
export function CODE_B3AE12(): void {
  reg.a = 0xffff;
}

/** $B3AE16 */
export function CODE_B3AE16(): void {
  get_current_sprite_clipping();
  reg.x = cur();
  reg.a = r16(R.invincibility_sprite);
  if (reg.a === 0) return CODE_B3AE2B();
  CODE_BEBE6D();
  if (!reg.c) return CODE_B3AE12();
  reg.a = 0;
}

/** $B3AE2B — collision flags depend on the Kong's state and the body's state. */
export function CODE_B3AE2B(): void {
  CODE_B3AE72();
  if (reg.a !== 0) return CODE_B3AE38();
  reg.a = r16(reg.y + sprite.interaction_flags) & 0x0080;
  if (reg.a === 0) return CODE_B3AE3D();
  CODE_B3AE38();
}

/** $B3AE38 */
export function CODE_B3AE38(): void {
  reg.a = 0x5429;
  CODE_B3AE4B();
}

/** $B3AE3D */
export function CODE_B3AE3D(): void {
  reg.a = 0x746b;
  const x = reg.x;
  reg.y = rd(x, 0x4e);
  if (reg.y === 0) return CODE_B3AE4B();
  reg.y = rd(x, sprite.state);
  if (reg.y === 0) return CODE_B3AE4B();
  reg.a = 0x4408;
  CODE_B3AE4B();
}

/** $B3AE4B */
export function CODE_B3AE4B(): void {
  CODE_BEBE8B();
  if (!reg.c) return CODE_B3AE12();
  if (reg.a === 0) return CODE_B3AE5C();
  wr(reg.x, 0x48, 0x000f);
  reg.a = 0;
}

/** $B3AE5C — defeated: state 3, stop. */
export function CODE_B3AE5C(): void {
  const x = reg.x;
  wr(x, sprite.state, 0x0003);
  wr(x, sprite.max_x_speed, 0);
  wr(x, sprite.x_speed, 0);
  wr(x, sprite.unknown_2C, 0);
  wr(x, sprite.interaction_flags, rd(x, sprite.interaction_flags) & 0x0002);
  reg.a = 0x0001;
}

/** $B3AE72 — A = active Kong state flag $0040; X = current sprite, Y = active Kong. */
export function CODE_B3AE72(): void {
  reg.y = r16(R.active_kong_sprite);
  reg.x = (r16(reg.y + sprite.state) << 2) & 0xffff;
  reg.a = rom16(KONG_STATE_FLAGS + reg.x);
  reg.x = cur();
  reg.a &= 0x0040;
}

/** $B3AE85 — the body bumped into the Kong. Carry set if the body exploded. */
export function CODE_B3AE85(): void {
  if (r16(R.invincibility_sprite) !== 0) {
    CODE_B3AF8F();
    reg.c = true;
    return;
  }
  CODE_B3AE8F();
}

/** $B3AE8F — steal something ($4E: 0 explode, 1 nothing, 2 bananas, 3+ a life). */
export function CODE_B3AE8F(): void {
  const x = cur();
  reg.x = x;
  if (rd(x, sprite.state) === 0) return CODE_B3AEF7();
  reg.a = rd(x, 0x4e);
  if (reg.a === 0) return CODE_B3AEFA();
  if (reg.a < 0x0002) return CODE_B3AEF7();
  if (reg.a === 0x0002) return CODE_B3AEC6();
  reg.a = r16(R.life_count);
  if (reg.a === 0) return CODE_B3AEF7();
  if (reg.a !== r16(R.life_count_display)) return CODE_B3AF28();
  reg.a = r16(0x19bc);
  if (reg.a >= 0x0003) return CODE_B3AEF7();
  reg.y = C.special_sprite_spawn_id_0040; // life balloon
  CODE_B3AFC2();
  CODE_BEC678();
  reg.x = cur();
  wr(reg.x, 0x46, 0x0003);
  CODE_B3AF28();
}

/** $B3AEC6 — steal up to 10 bananas (BCD), carried away by a banana bunch sprite. */
export function CODE_B3AEC6(): void {
  if (r16(R.banana_counter_final) === 0) return CODE_B3AF28();
  reg.y = C.special_sprite_spawn_id_0042; // banana bunch
  CODE_B3AFC2();
  if (reg.c) return CODE_B3AEF7();
  // SED
  reg.a = r16(R.banana_counter_final);
  if (reg.a >= 0x0010) reg.a = 0x0010;
  CODE_B3AEDF();
}

/** $B3AEDF (runs in decimal mode) */
export function CODE_B3AEDF(): void {
  const y = reg.y;
  w16(y + 0x4e, reg.a);
  w16(R.banana_counter_final, bcdSub16(r16(R.banana_counter_final), r16(y + 0x4e)));
  reg.a = bcdSub16(r16(R.banana_count), r16(y + 0x4e));
  w16(R.banana_count, reg.a);
  // CLD
  CODE_B3AEF7();
}

/** $B3AEF7 */
export function CODE_B3AEF7(): void {
  CODE_B3AF28();
}

/** $B3AEFA — a TNT Klobber explodes on contact (deleting its barrel too). */
export function CODE_B3AEFA(): void {
  const x = reg.x;
  w16(R.current_sprite, rd(x, 0x42));
  delete_sprite_handle_deallocation();
  reg.x = x;
  w16(R.current_sprite, x);
  reg.a = sound(4, "boom");
  queue_sound_effect();
  reg.a = sound(6, "explosion");
  queue_sound_effect();
  reg.y = C.special_sprite_spawn_id_00E4; // explosion (kills enemies)
  spawn_BB83EF_special_sprite_index();
  reg.y = C.special_sprite_spawn_id_00E6;
  spawn_BB83EF_special_sprite_index();
  delete_sprite_handle_deallocation();
  reg.c = true;
}

/** $B3AF28 — bounce back from the Kong (state 2); every 3rd bump waits longer. */
export function CODE_B3AF28(): void {
  const x = cur();
  reg.x = x;
  const speed = rd(x, sprite.x_speed);
  if (bit14(rd(x, sprite.oam_property))) {
    reg.a = 0xfe00;
    if (speed === 0 || speed > 0xfe00) return CODE_B3AF45();
    return CODE_B3AF47();
  }
  reg.a = 0x0200;
  if (speed <= 0x0200) return CODE_B3AF45();
  CODE_B3AF47();
}

/** $B3AF37 */
export function CODE_B3AF37(): void {
  const speed = rd(reg.x, sprite.x_speed);
  reg.a = 0xfe00;
  if (speed === 0 || speed > 0xfe00) return CODE_B3AF45();
  CODE_B3AF47();
}

/** $B3AF45 */
export function CODE_B3AF45(): void {
  wr(reg.x, sprite.x_speed, reg.a);
  CODE_B3AF47();
}

/** $B3AF47 */
export function CODE_B3AF47(): void {
  const x = reg.x;
  wr(x, sprite.state, 0x0002);
  wr(x, sprite.x_speed, neg(rd(x, sprite.x_speed)));
  wr(x, sprite.max_x_speed, 0);
  wr(x, 0x46, rd(x, 0x46) + 1);
  if ((rd(x, 0x46) & 0x00ff) < 0x0003) {
    reg.a = 0x001e;
  } else {
    wr(x, 0x46, 0);
    reg.a = 0x005a;
  }
  CODE_B3AF6A();
}

/** $B3AF6A */
export function CODE_B3AF6A(): void {
  const x = reg.x;
  wr(x, 0x4c, reg.a);
  wr(x, 0x50, 0x0001);
  reg.a = 0xfc00;
  wr(x, sprite.y_speed, reg.a);
  reg.c = false;
}

/** $B3AF78 — carry clear if crushed by the castle floor or standing on a crushing tile. */
export function CODE_B3AF78(): void {
  check_for_sprite_crush();
  if (!reg.c) return CODE_B3AF8E();
  const x = cur();
  reg.x = x;
  reg.a = rd(x, sprite.terrain_interaction) & 0x0001;
  if (reg.a === 0) return CODE_B3AF8E();
  reg.a = rd(x, sprite.terrain_attributes);
  if (!(reg.a & 0x0100)) return CODE_B3AF8E();
  reg.c = false;
  CODE_B3AF8E();
}

/** $B3AF8E */
export function CODE_B3AF8E(): void {}

/** $B3AF8F — knocked away from the colliding sprite (state 4). */
export function CODE_B3AF8F(): void {
  const facing = rd(r16(R.colliding_sprite), sprite.oam_property) & 0x4000;
  const x = cur();
  reg.x = x;
  wr(x, sprite.oam_property, ((rd(x, sprite.oam_property) & 0xbfff) | facing) ^ 0x4000);
  reg.a = bit14(rd(x, sprite.oam_property)) ? 0x0100 : 0xff00;
  CODE_B3AFAE();
}

/** $B3AFAE */
export function CODE_B3AFAE(): void {
  const x = reg.x;
  wr(x, sprite.max_x_speed, reg.a);
  wr(x, sprite.x_speed, reg.a);
  wr(x, sprite.y_speed, 0xfa00);
  wr(x, sprite.movement_state, 0x0004);
  reg.a = 0x0004;
  wr(x, sprite.state, reg.a);
}

/** $B3AFC2 — delete the alternate sprite, then spawn special sprite Y (returned in Y). */
export function CODE_B3AFC2(): void {
  const x = reg.x;
  const id = reg.y;
  reg.x = r16(R.alternate_sprite);
  w16(R.current_sprite, reg.x);
  delete_sprite_handle_deallocation();
  reg.y = id;
  reg.x = x;
  w16(R.current_sprite, x);
  spawn_special_sprite_index();
  reg.y = r16(R.alternate_sprite);
}

registerSprite({
  klobber_main, CODE_B3AA9F, CODE_B3AAA9, CODE_B3AAB4, CODE_B3AAD6, CODE_B3AAE1, CODE_B3AB0A,
  CODE_B3AB17, CODE_B3AB28, CODE_B3AB4F, CODE_B3AB5E, CODE_B3AB61, CODE_B3ABA9, CODE_B3ABB2,
  CODE_B3ABB6, CODE_B3ABCE, CODE_B3ABD8, klobber_body_main, CODE_B3AC22, CODE_B3AC2D, CODE_B3AC3E,
  CODE_B3AC41, CODE_B3AC74, CODE_B3AC77, CODE_B3AC82, CODE_B3AC91, CODE_B3AC9E, CODE_B3ACA6,
  CODE_B3ACA9, CODE_B3ACB7, CODE_B3ACBB, CODE_B3ACDA, CODE_B3ACE7, CODE_B3ACF1, CODE_B3ACFC,
  CODE_B3AD06, CODE_B3AD0E, CODE_B3AD18, CODE_B3AD22, CODE_B3AD3E, CODE_B3AD49, CODE_B3AD6E,
  CODE_B3AD71, CODE_B3AD95, CODE_B3AD9E, CODE_B3ADA2, CODE_B3ADAF, CODE_B3ADD6,
});
registerRts({
  CODE_B3ABE2, CODE_B3AC08, CODE_B3AC11, CODE_B3ADD9, CODE_B3AE02,
  CODE_B3AE03, CODE_B3AE12, CODE_B3AE16, CODE_B3AE2B, CODE_B3AE38, CODE_B3AE3D, CODE_B3AE4B,
  CODE_B3AE5C, CODE_B3AE72, CODE_B3AE85, CODE_B3AE8F, CODE_B3AEC6, CODE_B3AEDF, CODE_B3AEF7,
  CODE_B3AEFA, CODE_B3AF28, CODE_B3AF37, CODE_B3AF45, CODE_B3AF47, CODE_B3AF6A, CODE_B3AF78,
  CODE_B3AF8E, CODE_B3AF8F, CODE_B3AFAE, CODE_B3AFC2,
});
