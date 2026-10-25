/**
 * Bank $B3 — Snapjaw (the lava-lagoon piranha that chases the Kong while he swims) and
 * Lockjaw (the piranha that circles around its home and lunges at the Kong).
 *
 * Shared variables: $42/$44 home position (x/y), $46 x/y chase acceleration (lo/hi byte),
 * $48 base speed, $4A/$4C vertical tuning, $4E/$50 lunge target (x/y) or a timer.
 * ground_y_position is used as a countdown timer by Lockjaw.
 */
import { r16, w16, io8, io16, ioR16 } from "../../core/mem";
import { reg } from "../../core/cpu";
import { L, R, C, CPU, sprite } from "../../core/sym";
import {
  delete_sprite_handle_deallocation, get_current_sprite_clipping, CODE_BEBE8B, process_sprite_animation,
  set_sprite_animation, process_alternate_movement, check_throwable_collision_global, process_current_movement,
  defeat_aquatic_sprite_using_anim,
} from "../../gen/routines";
import { cur, rd, wr, inc, dec, spriteConst, isNeg, neg, despawnReturn, stateHandlerB3, registerRts, registerSprite } from "./b3b_common";
import {
  CODE_B3A3CD, CODE_B3B007, CODE_B3B021, force_sprite_submerged, make_sprite_fall_off_screen, multiply_a_by_y,
} from "./b3b_misc";

const SNAPJAW_STATES = (L("snapjaw_main") + 0x0b) & 0xffff;
const LOCKJAW_STATES = (L("lockjaw_main") + 0x03) & 0xffff;

/** 16-bit read at temp_33 (high byte of temp_32, low byte of temp_34). */
const temp33 = () => r16(R.temp_33);

// ---------------------------------------------------------------------------------------------
// Snapjaw
// ---------------------------------------------------------------------------------------------

/** $B3B2F0 — Snapjaw: frozen while game_state_flags bit 8 is set. */
export function snapjaw_main(): void {
  if (r16(R.game_state_flags) & 0x0100) return CODE_B3B31E();
  stateHandlerB3(SNAPJAW_STATES, [CODE_B3B52F, CODE_B3B328, CODE_B3B41D, CODE_B3B73A, CODE_B3B305]);
}

/**
 * $B3B305 — state 4: dormant. $5C holds two level entrance numbers (lo/hi byte): from those
 * entrances the Snapjaw wakes up (state 0), from any other one it is deleted. Bit 15 = always.
 */
export function CODE_B3B305(): void {
  reg.x = reg.y;
  const x = reg.x;
  const v = rd(x, sprite.unknown_5C);
  if (isNeg(v)) return CODE_B3B321();
  const entrance = r16(R.level_entrance_number);
  reg.a = v & 0x00ff;
  if (reg.a === entrance) return CODE_B3B321();
  reg.a = (v >> 8) & 0x00ff; // EOR (clears the low byte) : XBA
  if (reg.a === entrance) return CODE_B3B321();
  delete_sprite_handle_deallocation();
  CODE_B3B31E();
}

/** $B3B31E */
export function CODE_B3B31E(): void {}

/** $B3B321 — wake up. */
export function CODE_B3B321(): void {
  wr(reg.x, sprite.unknown_5C, 0);
  wr(reg.x, sprite.state, 0);
}

/**
 * $B3B328 — state 1: chase the Kong. The chase speed comes from the sprite constants: +$12/+$14
 * normally, +$16/+$18 while the Kong is swimming below the surface.
 */
export function CODE_B3B328(): void {
  CODE_B3A3CD();
  const ky = rd(r16(R.active_kong_sprite), sprite.y_position);
  reg.a = ky;
  reg.y = 0x0012;
  if (reg.c && ky >= r16(R.water_y_position)) reg.y = 0x0016;
  CODE_B3B33E();
}

/** $B3B33E */
export function CODE_B3B33E(): void {
  reg.a = spriteConst(reg.y);
  reg.x = cur();
  const x = reg.x;
  wr(x, 0x46, reg.a);
  reg.y = (reg.y + 2) & 0xffff;
  reg.a = spriteConst(reg.y);
  if (isNeg(rd(x, 0x48))) reg.a = neg(reg.a); // keep the sign of the current base speed
  CODE_B3B350();
}

/** $B3B350 — horizontal: accelerate towards the Kong (dead zone = lo+hi byte of $46). */
export function CODE_B3B350(): void {
  const x = reg.x;
  wr(x, 0x48, reg.a);
  wr(x, sprite.max_x_speed, reg.a);
  reg.y = r16(R.active_kong_sprite);
  w16(R.temp_32, rd(x, 0x46));
  w16(R.temp_34, 0);
  w16(R.temp_32, ((rd(x, 0x46) & 0xff) + temp33()) & 0xffff);
  const kx = rd(reg.y, sprite.x_position);
  const sxp = rd(x, sprite.x_position);
  reg.a = (kx - sxp) & 0xffff;
  w16(R.temp_34, reg.a);
  if (kx >= sxp) return CODE_B3B375();
  reg.a = (reg.a + r16(R.temp_32)) & 0xffff; // carry clear
  if (isNeg(reg.a)) return CODE_B3B381();
  CODE_B3B379();
}

/** $B3B375 (entered with carry set) */
export function CODE_B3B375(): void {
  reg.a = (reg.a - r16(R.temp_32)) & 0xffff;
  if (!isNeg(reg.a)) return CODE_B3B381();
  CODE_B3B379();
}

/** $B3B379 — inside the dead zone: use how far the Kong moved since last frame instead. */
export function CODE_B3B379(): void {
  const x = reg.x;
  reg.a = (rd(reg.y, sprite.x_position) - rd(x, 0x42)) & 0xffff;
  w16(R.temp_34, reg.a);
  CODE_B3B381();
}

/** $B3B381 — max_x_speed = $48 + distance * 16, clamped to ±$0C00. */
export function CODE_B3B381(): void {
  const x = reg.x;
  reg.a = ((r16(R.temp_34) << 4) + rd(x, 0x48)) & 0xffff;
  if (!isNeg(reg.a)) return CODE_B3B396();
  if (reg.a >= 0xf400) return CODE_B3B39E();
  reg.a = 0xf400;
  CODE_B3B39E();
}

/** $B3B396 */
export function CODE_B3B396(): void {
  if (reg.a >= 0x0c00) reg.a = 0x0c00;
  CODE_B3B39E();
}

/** $B3B39E — vertical target: the Kong (or the surface if he is above it), plus 28 px. */
export function CODE_B3B39E(): void {
  const x = reg.x;
  wr(x, sprite.max_x_speed, reg.a);
  wr(x, 0x42, rd(reg.y, sprite.x_position));
  reg.a = r16(0x0915);
  if (reg.a !== 0) reg.a = 0x0010;
  CODE_B3B3AD();
}

/** $B3B3AD */
export function CODE_B3B3AD(): void {
  reg.a = (reg.a + r16(R.water_y_position)) & 0xffff;
  const ky = rd(reg.y, sprite.y_position);
  reg.c = reg.a >= ky;
  if (!reg.c) {
    reg.a = ky;
    reg.c = false;
  }
  CODE_B3B3BA();
}

/** $B3B3BA — (the carry left by the compare above adds one more pixel) clamp to constants +$1A..+$1C. */
export function CODE_B3B3BA(): void {
  const x = reg.x;
  reg.a = (reg.a + 0x001c + (reg.c ? 1 : 0)) & 0xffff;
  reg.y = 0x001a;
  if (reg.a >= spriteConst(reg.y)) return CODE_B3B3CA();
  reg.a = spriteConst(reg.y);
  inc(x, sprite.unknown_5C); // out of its range: allow despawning
  CODE_B3B3D5();
}

/** $B3B3CA */
export function CODE_B3B3CA(): void {
  reg.y = 0x001c;
  if (reg.a >= spriteConst(reg.y)) {
    reg.a = spriteConst(reg.y);
    inc(reg.x, sprite.unknown_5C);
  }
  CODE_B3B3D5();
}

/** $B3B3D5 — vertical: same dead-zone acceleration with $4A, base speed $4C. */
export function CODE_B3B3D5(): void {
  const x = reg.x;
  w16(R.temp_36, reg.a);
  w16(R.temp_32, rd(x, 0x4a));
  w16(R.temp_34, 0);
  w16(R.temp_32, ((rd(x, 0x4a) & 0xff) + temp33()) & 0xffff);
  const target = r16(R.temp_36);
  const syp = rd(x, sprite.y_position);
  reg.a = (target - syp) & 0xffff;
  w16(R.temp_34, reg.a);
  if (target >= syp) return CODE_B3B3F4();
  reg.a = (reg.a + r16(R.temp_32)) & 0xffff;
  if (isNeg(reg.a)) return CODE_B3B3FF();
  CODE_B3B3F8();
}

/** $B3B3F4 (entered with carry set) */
export function CODE_B3B3F4(): void {
  reg.a = (reg.a - r16(R.temp_32)) & 0xffff;
  if (!isNeg(reg.a)) return CODE_B3B3FF();
  CODE_B3B3F8();
}

/** $B3B3F8 */
export function CODE_B3B3F8(): void {
  reg.a = (r16(R.temp_36) - rd(reg.x, 0x44)) & 0xffff;
  w16(R.temp_34, reg.a);
  CODE_B3B3FF();
}

/** $B3B3FF — max_y_speed = $4C + distance * 16; then move and check for touching the Kong. */
export function CODE_B3B3FF(): void {
  const x = reg.x;
  reg.a = ((r16(R.temp_34) << 4) + rd(x, 0x4c)) & 0xffff;
  wr(x, sprite.max_y_speed, reg.a);
  reg.a = r16(R.temp_36);
  wr(x, 0x44, reg.a);
  CODE_B3B557();
  reg.x = cur();
  reg.a = rd(reg.x, sprite.unknown_5C);
  if (reg.a !== 0) return CODE_B3B41A();
}

/** $B3B41A */
export function CODE_B3B41A(): void {
  despawnReturn();
}

const SNAPJAW_STATE2 = [CODE_B3B45D, CODE_B3B47A, CODE_B3B490, CODE_B3B4E8];

/**
 * $B3B41D — state 2: attack sequence (sub states from DATA_B3B455), kept 16 px deeper than
 * other aquatic sprites. Touching the Kong while not hurt sets display_mode bit 0.
 */
export function CODE_B3B41D(): void {
  reg.y = cur();
  reg.a = (r16(reg.y + sprite.sub_state) & 0x00ff) << 1;
  reg.x = reg.a;
  SNAPJAW_STATE2[reg.x >> 1]();
  const water = r16(R.water_y_position);
  w16(R.water_y_position, (water + 0x0010) & 0xffff);
  force_sprite_submerged();
  w16(R.water_y_position, water);
  reg.a = r16(0x0915);
  if (reg.a !== 0) return CODE_B3B452();
  get_current_sprite_clipping();
  reg.a = 0x0000;
  CODE_BEBE8B();
  if (reg.c) {
    reg.x = cur();
    inc(reg.x, sprite.display_mode);
  }
  CODE_B3B452();
}

/** $B3B452 */
export function CODE_B3B452(): void {}

/** $B3B45D — sub state 0: wait for the swim animation, then start chomping. */
export function CODE_B3B45D(): void {
  force_sprite_submerged();
  reg.x = cur();
  reg.a = rd(reg.x, sprite.animation_id);
  if (reg.a === C.lockjaw_swim_anim_id) return CODE_B3B46E();
  process_sprite_animation();
}

/** $B3B46E */
export function CODE_B3B46E(): void {
  const x = reg.x;
  inc(x, sprite.sub_state);
  wr(x, sprite.display_mode, 0);
  reg.a = C.lockjaw_chomp_right_anim_id;
  set_sprite_animation();
}

/** $B3B47A — sub state 1 */
export function CODE_B3B47A(): void {
  reg.a = 0x0008;
  process_alternate_movement();
  reg.a = 0x001d;
  process_alternate_movement();
  force_sprite_submerged();
  process_sprite_animation();
}

/** $B3B490 — sub state 2: lunge at the Kong's position (display_mode bit 0: touched him). */
export function CODE_B3B490(): void {
  reg.x = reg.y;
  const x = reg.x;
  const k = r16(R.active_kong_sprite);
  reg.y = k;
  wr(x, 0x4e, rd(k, sprite.x_position));
  wr(x, sprite.general_purpose_50, rd(k, sprite.y_position));
  const mode = rd(x, sprite.display_mode);
  if (!(mode & 1)) return CODE_B3B4AF();
  reg.a = 0x0008;
  if (!(mode & 2)) return CODE_B3B4C4();
  wr(x, sprite.max_x_speed, 0);
  wr(x, sprite.max_y_speed, 0);
  CODE_B3B4D2();
}

/** $B3B4AF */
export function CODE_B3B4AF(): void {
  reg.y = r16(R.active_kong_sprite);
  reg.a = rd(reg.y, sprite.y_position);
  if (reg.a >= r16(R.water_y_position)) return CODE_B3B4BF();
  reg.a = 0x000c;
  CODE_B3B4C4();
}

/** $B3B4BF */
export function CODE_B3B4BF(): void {
  reg.y = 0x000e;
  reg.a = spriteConst(reg.y);
  CODE_B3B4C4();
}

/** $B3B4C4 — aim at the target at speed A; stop if that would turn around. */
export function CODE_B3B4C4(): void {
  CODE_B3B753();
  const x = reg.x;
  reg.a = ((rd(x, sprite.oam_property) << 1) ^ rd(x, sprite.max_x_speed)) & 0xffff;
  if (isNeg(reg.a)) {
    wr(x, sprite.max_x_speed, 0);
    wr(x, sprite.x_speed, 0);
  }
  CODE_B3B4D2();
}

/** $B3B4D2 */
export function CODE_B3B4D2(): void {
  reg.a = 0x000f;
  process_alternate_movement();
  reg.a = 0x001d;
  process_alternate_movement();
  force_sprite_submerged();
  process_sprite_animation();
}

/** $B3B4E8 — sub state 3: coast for $4E frames, then go back to chasing (state 1). */
export function CODE_B3B4E8(): void {
  if (r16(R.time_stop_flags) & 0x0004) return CODE_B3B506();
  reg.x = reg.y;
  if (isNeg(dec(reg.x, 0x4e))) return CODE_B3B50B();
  reg.a = 0x0008;
  process_alternate_movement();
  reg.a = 0x001d;
  process_alternate_movement();
  force_sprite_submerged();
  CODE_B3B506();
}

/** $B3B506 */
export function CODE_B3B506(): void {
  process_sprite_animation();
}

/** $B3B50B */
export function CODE_B3B50B(): void {
  const x = reg.x;
  wr(x, sprite.state, 0x0001);
  wr(x, sprite.max_y_speed, rd(x, 0x4c));
  wr(x, sprite.y_speed, 0);
  CODE_B3B822();
  force_sprite_submerged();
  reg.a = C.lockjaw_swim_anim_id;
  set_sprite_animation();
}

// ---------------------------------------------------------------------------------------------
// Lockjaw
// ---------------------------------------------------------------------------------------------

/** $B3B524 */
export function lockjaw_main(): void {
  stateHandlerB3(LOCKJAW_STATES, [CODE_B3B52F, CODE_B3B536, CODE_B3B5B4, CODE_B3B73A]);
}

/** $B3B52F — state 0: remember the patrol speed. */
export function CODE_B3B52F(): void {
  reg.x = reg.y;
  const x = reg.x;
  wr(x, 0x48, rd(x, sprite.max_x_speed));
  inc(x, sprite.state);
  CODE_B3B536();
}

/**
 * Throwable-object and Kong collision checks shared by the aquatic enemies: true when the
 * sprite was defeated (collision with result 0).
 */
function aquaticHit(): boolean {
  reg.a = 0x0118;
  check_throwable_collision_global();
  if (!reg.c) {
    get_current_sprite_clipping();
    reg.a = 0x1400;
    CODE_BEBE8B();
    if (!reg.c) return false;
  }
  return (reg.a & 0xffff) === 0;
}

/** $B3B536 — state 1: patrol around the home; lunge when the Kong comes close. */
export function CODE_B3B536(): void {
  if (aquaticHit()) return CODE_B3B745();
  CODE_B3B551();
}

/** $B3B54C — collision happened: A = 0 means defeated. */
export function CODE_B3B54C(): void {
  if ((reg.a & 0xffff) !== 0) return CODE_B3B551();
  CODE_B3B745();
}

/** $B3B551 */
export function CODE_B3B551(): void {
  CODE_B3B579();
  despawnReturn();
}

/** $B3B557 — Snapjaw: touching a vulnerable Kong (not when $0915 or invincible). */
export function CODE_B3B557(): void {
  if (r16(0x0915) !== 0) return CODE_B3B5A8();
  reg.y = r16(R.active_kong_sprite);
  reg.a = r16(reg.y + 0x0030);
  if (reg.a === 0 || (reg.a & 0x0080)) return CODE_B3B5A8();
  reg.a = r16(R.invincibility_sprite);
  if (reg.a !== 0) return CODE_B3B5A8();
  get_current_sprite_clipping();
  reg.a = 0x0000;
  CODE_BEBE8B();
  CODE_B3B579();
}

/**
 * $B3B579 — when the Kong swims (state flag) at least 4 px below the surface and within the
 * horizontal/vertical ranges of constants +$08/+$09, switch to the attack state; then move.
 */
export function CODE_B3B579(): void {
  CODE_B3A3CD();
  if (reg.c) {
    reg.y = r16(R.active_kong_sprite);
    reg.a = (rd(reg.y, sprite.y_position) - 0x0004) & 0xffff; // carry set by BCC not taken
    if (reg.a >= r16(R.water_y_position)) {
      reg.y = 0x0008;
      reg.a = spriteConst(reg.y) & 0x00ff;
      CODE_B3B007();
      if (!reg.c) {
        reg.y = 0x0009;
        reg.a = spriteConst(reg.y) & 0x00ff;
        CODE_B3B021();
        if (!reg.c) inc(reg.x, sprite.state);
      }
    }
  }
  CODE_B3B5A8();
}

/** $B3B5A8 */
export function CODE_B3B5A8(): void {
  process_current_movement();
  force_sprite_submerged();
  process_sprite_animation();
}

const LOCKJAW_ATTACK = [CODE_B3B5E8, CODE_B3B622, CODE_B3B65C, CODE_B3B681, CODE_B3B6D5, CODE_B3B709];

/** $B3B5B4 — state 2: the lunge, in sub states. */
export function CODE_B3B5B4(): void {
  if (aquaticHit()) return CODE_B3B745();
  CODE_B3B5CF();
}

/** $B3B5CA */
export function CODE_B3B5CA(): void {
  CODE_B3B54C();
}

/** $B3B5CF */
export function CODE_B3B5CF(): void {
  reg.y = cur();
  reg.a = (r16(reg.y + sprite.sub_state) & 0x00ff) << 1;
  reg.x = reg.a;
  LOCKJAW_ATTACK[reg.x >> 1]();
}

/** $B3B5E8 — sub state 0: wait for the swim animation to come round. */
export function CODE_B3B5E8(): void {
  force_sprite_submerged();
  reg.y = cur();
  reg.a = rd(reg.y, sprite.animation_id);
  if (reg.a === C.lockjaw_swim_anim_id) return CODE_B3B5FC();
  process_sprite_animation();
  despawnReturn();
}

/** $B3B5FC — back off from the Kong for constants +$0A frames, chomping. */
export function CODE_B3B5FC(): void {
  reg.x = reg.y;
  const x = reg.x;
  inc(x, sprite.sub_state);
  reg.y = r16(R.active_kong_sprite);
  reg.a = rd(reg.y, sprite.x_position) < rd(x, sprite.x_position) ? 0x0500 : 0xfb00;
  CODE_B3B60F();
}

/** $B3B60F */
export function CODE_B3B60F(): void {
  const x = reg.x;
  wr(x, sprite.max_x_speed, reg.a);
  reg.y = 0x000a;
  wr(x, sprite.ground_y_position, spriteConst(reg.y));
  reg.a = C.lockjaw_chomp_left_anim_id;
  set_sprite_animation();
  despawnReturn();
}

/** $B3B622 — sub state 1: count down, then lock on to the Kong's position. */
export function CODE_B3B622(): void {
  reg.x = reg.y;
  const x = reg.x;
  if (!isNeg(dec(x, sprite.ground_y_position))) return CODE_B3B64B();
  inc(x, sprite.sub_state);
  reg.y = 0x000c;
  wr(x, sprite.ground_y_position, spriteConst(reg.y));
  wr(x, sprite.max_x_speed, 0);
  reg.y = r16(R.active_kong_sprite);
  wr(x, 0x4e, rd(reg.y, sprite.x_position));
  reg.a = (r16(R.water_y_position) + 0x0018) & 0xffff;
  if (reg.a < rd(reg.y, sprite.y_position)) reg.a = rd(reg.y, sprite.y_position);
  CODE_B3B649();
}

/** $B3B649 */
export function CODE_B3B649(): void {
  wr(reg.x, sprite.general_purpose_50, reg.a);
  CODE_B3B64B();
}

/** $B3B64B */
export function CODE_B3B64B(): void {
  reg.a = 0x0008;
  process_alternate_movement();
  force_sprite_submerged();
  process_sprite_animation();
  despawnReturn();
}

/** $B3B65C — sub state 2: count down again, then lunge at constants +$0E speed. */
export function CODE_B3B65C(): void {
  reg.x = reg.y;
  const x = reg.x;
  if (!isNeg(dec(x, sprite.ground_y_position))) return CODE_B3B670();
  inc(x, sprite.sub_state);
  reg.y = 0x000e;
  reg.a = spriteConst(reg.y);
  CODE_B3B753();
  reg.a = 0x000f;
  CODE_B3B673();
}

/** $B3B670 */
export function CODE_B3B670(): void {
  reg.a = 0x0008;
  CODE_B3B673();
}

/** $B3B673 */
export function CODE_B3B673(): void {
  process_alternate_movement();
  force_sprite_submerged();
  process_sprite_animation();
  despawnReturn();
}

/** $B3B681 — sub state 3: lunge until the next frame's step would pass the target. */
export function CODE_B3B681(): void {
  reg.a = 0x000f;
  process_alternate_movement();
  force_sprite_submerged();
  process_sprite_animation();
  reg.x = cur();
  const x = reg.x;
  reg.a = rd(x, sprite.max_y_speed);
  if (isNeg(reg.a)) reg.a = neg(reg.a);
  CODE_B3B699();
}

/** $B3B699 */
export function CODE_B3B699(): void {
  w16(R.temp_32, reg.a);
  reg.a = rd(reg.x, sprite.max_x_speed);
  if (isNeg(reg.a)) reg.a = neg(reg.a);
  CODE_B3B6A3();
}

/** Pixel step of a speed: high byte of speed*2, sign-extended (`ASL : XBA : JSR CODE_B3B815`). */
function stepOf(speed: number): number {
  const v = (speed << 1) & 0xffff;
  reg.a = ((v >> 8) | (v << 8)) & 0xffff;
  CODE_B3B815();
  return reg.a;
}

/** $B3B6A3 — check along the faster axis. */
export function CODE_B3B6A3(): void {
  const x = reg.x;
  if (reg.a >= r16(R.temp_32)) return CODE_B3B6BA();
  const vy = rd(x, sprite.max_y_speed);
  reg.a = ((stepOf(vy) + rd(x, sprite.y_position) - rd(x, sprite.general_purpose_50)) ^ vy) & 0xffff;
  if (isNeg(reg.a)) return CODE_B3B6D2();
  CODE_B3B6CB();
}

/** $B3B6BA */
export function CODE_B3B6BA(): void {
  const x = reg.x;
  const vx = rd(x, sprite.max_x_speed);
  reg.a = ((stepOf(vx) + rd(x, sprite.x_position) - rd(x, 0x4e)) ^ vx) & 0xffff;
  if (isNeg(reg.a)) return CODE_B3B6D2();
  CODE_B3B6CB();
}

/** $B3B6CB — reached the target: brake for 2 frames. */
export function CODE_B3B6CB(): void {
  inc(reg.x, sprite.sub_state);
  reg.a = 0x0002;
  wr(reg.x, 0x4e, reg.a);
  CODE_B3B6D2();
}

/** $B3B6D2 */
export function CODE_B3B6D2(): void {
  despawnReturn();
}

/**
 * `LDA v : ASL A : ROR mem : ASL A : ROR mem` — halves the speed twice, shifting in bits 15 and
 * 14 of the original value (an arithmetic /4 for small speeds).
 */
function quarter(x: number, off: number) {
  const v = rd(x, off);
  let m = (v >> 1) | (v & 0x8000);
  m = (m >> 1) | ((v << 1) & 0x8000);
  wr(x, off, m);
  reg.a = (v << 2) & 0xffff;
}

/** $B3B6D5 — sub state 4: brake, then drift slowly for constants +$10 frames. */
export function CODE_B3B6D5(): void {
  reg.a = 0x000f;
  process_alternate_movement();
  force_sprite_submerged();
  process_sprite_animation();
  reg.x = cur();
  const x = reg.x;
  if (!isNeg(dec(x, 0x4e))) return CODE_B3B706();
  wr(x, sprite.max_x_speed, 0);
  wr(x, sprite.max_y_speed, 0);
  quarter(x, sprite.x_speed);
  quarter(x, sprite.y_speed);
  reg.y = 0x0010;
  reg.a = spriteConst(reg.y);
  wr(x, 0x4e, reg.a);
  inc(x, sprite.sub_state);
  CODE_B3B706();
}

/** $B3B706 */
export function CODE_B3B706(): void {
  despawnReturn();
}

/** $B3B709 — sub state 5: drift, then return to patrolling (state 1). */
export function CODE_B3B709(): void {
  reg.x = reg.y;
  if (isNeg(dec(reg.x, 0x4e))) return CODE_B3B71F();
  reg.a = 0x0008;
  process_alternate_movement();
  force_sprite_submerged();
  process_sprite_animation();
  despawnReturn();
}

/** $B3B71F */
export function CODE_B3B71F(): void {
  const x = reg.x;
  wr(x, sprite.state, 0x0001);
  wr(x, sprite.max_y_speed, rd(x, 0x4c));
  wr(x, sprite.y_speed, 0);
  CODE_B3B822();
  force_sprite_submerged();
  reg.a = C.lockjaw_swim_anim_id;
  set_sprite_animation();
  despawnReturn();
}

/** $B3B73A — defeated state (Snapjaw and Lockjaw): fall off screen. */
export function CODE_B3B73A(): void {
  process_current_movement();
  process_sprite_animation();
  make_sprite_fall_off_screen();
}

/** $B3B745 — defeated: X = the sprite (as left by the collision check). */
export function CODE_B3B745(): void {
  wr(reg.x, sprite.state, 0x0003);
  reg.a = C.lockjaw_death_anim_id;
  defeat_aquatic_sprite_using_anim();
  despawnReturn();
}

/**
 * $B3B753 — aim at the target ($4E, $50). A = 0: speed = distance * 16 on each axis. Otherwise
 * the speed along the longer axis is |$48|/16 * A, and the other axis gets the proportional
 * part (hardware multiply/divide).
 */
export function CODE_B3B753(): void {
  const x = reg.x;
  w16(R.temp_5E, reg.a);
  reg.a = (rd(x, 0x4e) - rd(x, sprite.x_position)) & 0xffff;
  w16(R.temp_32, reg.a);
  if (isNeg(reg.a)) reg.a = neg(reg.a);
  CODE_B3B762();
}

/** $B3B762 */
export function CODE_B3B762(): void {
  const x = reg.x;
  w16(R.temp_34, reg.a);
  reg.a = (rd(x, sprite.general_purpose_50) - rd(x, sprite.y_position)) & 0xffff;
  w16(R.temp_36, reg.a);
  if (isNeg(reg.a)) reg.a = neg(reg.a);
  CODE_B3B771();
}

/** $B3B771 */
export function CODE_B3B771(): void {
  const x = reg.x;
  w16(R.temp_38, reg.a);
  reg.a = r16(R.temp_5E);
  if (reg.a !== 0) return CODE_B3B78C();
  reg.a = (r16(R.temp_32) << 4) & 0xffff;
  wr(x, sprite.max_x_speed, reg.a);
  wr(x, sprite.x_speed, reg.a);
  reg.a = (r16(R.temp_36) << 4) & 0xffff;
  wr(x, sprite.max_y_speed, reg.a);
  wr(x, sprite.y_speed, reg.a);
}

/** $B3B78C */
export function CODE_B3B78C(): void {
  reg.y = reg.a;
  reg.a = rd(reg.x, 0x48);
  if (isNeg(reg.a)) reg.a = neg(reg.a);
  CODE_B3B795();
}

/** $B3B795 */
export function CODE_B3B795(): void {
  reg.a >>= 4;
  multiply_a_by_y();
  w16(R.temp_5E, reg.a);
  reg.a >>= 4;
  // SEP #$20: 8-bit A, the high byte (B) keeps the high byte of temp_5E >> 4
  io8(CPU.multiply_A, reg.a & 0xff);
  const t34 = r16(R.temp_34);
  const t38 = r16(R.temp_38);
  reg.a = (reg.a & 0xff00) | (t34 & 0xff);
  reg.y = t38;
  if ((t34 & 0xff) >= (t38 & 0xff)) {
    reg.y = reg.a; // TAY moves all 16 bits (B:A)
    reg.a = (reg.a & 0xff00) | (t38 & 0xff);
  }
  CODE_B3B7B2();
}

/** $B3B7B2 */
export function CODE_B3B7B2(): void {
  io8(CPU.multiply_B, reg.a & 0xff);
  reg.a = ioR16(CPU.multiply_result);
  io16(CPU.dividen, reg.a);
  reg.a = reg.y;
  io8(CPU.divisor, reg.a & 0xff);
  reg.a = ioR16(CPU.divide_result);
  reg.y = (reg.a << 4) & 0xffff;
  reg.a = r16(R.temp_34);
  if (reg.a >= r16(R.temp_38)) return CODE_B3B7F9();
  reg.a = r16(R.temp_5E);
  if (isNeg(r16(R.temp_36))) reg.a = neg(reg.a);
  CODE_B3B7E7();
}

/** $B3B7E7 */
export function CODE_B3B7E7(): void {
  const x = reg.x;
  wr(x, sprite.max_y_speed, reg.a);
  wr(x, sprite.y_speed, reg.a);
  reg.a = reg.y;
  if (isNeg(r16(R.temp_32))) reg.a = neg(reg.a);
  CODE_B3B7F4();
}

/** $B3B7F4 */
export function CODE_B3B7F4(): void {
  wr(reg.x, sprite.max_x_speed, reg.a);
  wr(reg.x, sprite.x_speed, reg.a);
}

/** $B3B7F9 */
export function CODE_B3B7F9(): void {
  reg.a = r16(R.temp_5E);
  if (isNeg(r16(R.temp_32))) reg.a = neg(reg.a);
  CODE_B3B803();
}

/** $B3B803 */
export function CODE_B3B803(): void {
  const x = reg.x;
  wr(x, sprite.max_x_speed, reg.a);
  wr(x, sprite.x_speed, reg.a);
  reg.a = reg.y;
  if (isNeg(r16(R.temp_36))) reg.a = neg(reg.a);
  CODE_B3B810();
}

/** $B3B810 */
export function CODE_B3B810(): void {
  wr(reg.x, sprite.max_y_speed, reg.a);
  wr(reg.x, sprite.y_speed, reg.a);
}

/** $B3B815 — sign-extend the low byte of A. */
export function CODE_B3B815(): void {
  if (reg.a & 0x0080) return CODE_B3B81E();
  reg.a &= 0x00ff;
}

/** $B3B81E */
export function CODE_B3B81E(): void {
  reg.a = (reg.a | 0xff00) & 0xffff;
}

/**
 * $B3B822 — resume patrolling: set max_x_speed to ±$48, heading back towards the home ($42)
 * unless still within 3/4 of the patrol half-width (lo/hi byte of $46) in the current direction.
 */
export function CODE_B3B822(): void {
  reg.x = cur();
  const x = reg.x;
  reg.a = rd(x, sprite.max_x_speed);
  if (reg.a === 0) reg.a = (rd(x, sprite.oam_property) << 1) & 0xffff;
  CODE_B3B82B();
}

/** $B3B82B */
export function CODE_B3B82B(): void {
  const x = reg.x;
  w16(R.temp_32, reg.a);
  const dir = reg.a;
  if (rd(x, sprite.movement_state) === 0x0008) return CODE_B3B875();
  const off = (rd(x, sprite.x_position) - rd(x, 0x42)) & 0xffff;
  if (isNeg(off ^ dir)) return CODE_B3B875();
  w16(R.temp_34, off);
  if (isNeg(off)) {
    const half = rd(x, 0x46) >> 8;
    w16(R.temp_36, half);
    let a = half * 3; // ASL : ADC (carry from the ASL is 0: half < $100)
    a = a >> 1;
    a = a >> 1;
    // the last LSR left its carry for the ADC
    const sum = a + off + ((half * 3 >> 1) & 1);
    reg.a = sum & 0xffff;
    if (sum <= 0xffff) return CODE_B3B866();
    return CODE_B3B875();
  }
  CODE_B3B856();
}

/** $B3B856 */
export function CODE_B3B856(): void {
  const x = reg.x;
  const half = rd(x, 0x46) & 0x00ff;
  w16(R.temp_36, half);
  reg.a = ((half * 3) >> 2) & 0xffff;
  if (reg.a >= r16(R.temp_34)) return CODE_B3B875();
  CODE_B3B866();
}

/** $B3B866 — keep going in the current direction. */
export function CODE_B3B866(): void {
  const x = reg.x;
  const base = rd(x, 0x48);
  reg.a = isNeg(base ^ r16(R.temp_32)) ? base : neg(base);
  CODE_B3B882();
}

/** $B3B875 — turn around. */
export function CODE_B3B875(): void {
  const x = reg.x;
  const base = rd(x, 0x48);
  reg.a = isNeg(base ^ r16(R.temp_32)) ? neg(base) : base;
  CODE_B3B882();
}

/** $B3B882 */
export function CODE_B3B882(): void {
  wr(reg.x, sprite.max_x_speed, reg.a);
  wr(reg.x, sprite.x_speed, 0);
}

registerSprite({
  snapjaw_main, CODE_B3B305, CODE_B3B31E, CODE_B3B321, CODE_B3B328, CODE_B3B33E, CODE_B3B350,
  CODE_B3B375, CODE_B3B379, CODE_B3B381, CODE_B3B396, CODE_B3B39E, CODE_B3B3AD, CODE_B3B3BA,
  CODE_B3B3CA, CODE_B3B3D5, CODE_B3B3F4, CODE_B3B3F8, CODE_B3B3FF, CODE_B3B41A, CODE_B3B41D,
  CODE_B3B452, lockjaw_main, CODE_B3B52F, CODE_B3B536, CODE_B3B54C, CODE_B3B551, CODE_B3B5B4,
  CODE_B3B5CA, CODE_B3B5CF, CODE_B3B5E8, CODE_B3B5FC, CODE_B3B60F, CODE_B3B622, CODE_B3B649,
  CODE_B3B64B, CODE_B3B65C, CODE_B3B670, CODE_B3B673, CODE_B3B681, CODE_B3B699, CODE_B3B6A3,
  CODE_B3B6BA, CODE_B3B6CB, CODE_B3B6D2, CODE_B3B6D5, CODE_B3B706, CODE_B3B709, CODE_B3B71F,
  CODE_B3B73A, CODE_B3B745,
});
registerRts({
  CODE_B3B45D, CODE_B3B46E, CODE_B3B47A, CODE_B3B490, CODE_B3B4AF, CODE_B3B4BF, CODE_B3B4C4,
  CODE_B3B4D2, CODE_B3B4E8, CODE_B3B506, CODE_B3B50B, CODE_B3B557, CODE_B3B579, CODE_B3B5A8,
  CODE_B3B753, CODE_B3B762, CODE_B3B771, CODE_B3B78C, CODE_B3B795, CODE_B3B7B2, CODE_B3B7E7,
  CODE_B3B7F4, CODE_B3B7F9, CODE_B3B803, CODE_B3B810, CODE_B3B815, CODE_B3B81E, CODE_B3B822,
  CODE_B3B82B, CODE_B3B856, CODE_B3B866, CODE_B3B875, CODE_B3B882,
});
