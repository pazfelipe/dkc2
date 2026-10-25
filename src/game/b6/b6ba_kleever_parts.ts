/**
 * Bank $B6 — the sprites around Kleever: its fireballs, the dropping hooks of the hook
 * phases, the cannonball the Kongs throw at it (and the one falling from the ceiling), its
 * hand and the lava bubbles, the fire effect, and after the defeat the broken hilt, fire and
 * the falling pieces of Kleever and of the roof.
 */
import { r16, w16 } from "../../core/mem";
import { reg } from "../../core/cpu";
import { L, R, C, sprite } from "../../core/sym";
import {
  queue_sound_effect, queue_or_reset_looping_sound_effect, spawn_special_sprite_index, spawn_special_sprite_address,
  set_sprite_animation, delete_sprite_handle_deallocation, delete_sprite_if_offscreen, get_current_sprite_clipping,
  check_for_sprite_collisions, CODE_B3A600, process_sprite_animation, interpolate_x_velocity_global,
  interpolate_y_velocity_global, apply_position_from_velocity_global, get_sprite_position_in_level_data,
  CODE_B39982, CODE_B398A7, CODE_BBBB99, apply_sprite_gravity_global, CODE_B39EBA, process_terrain_interaction_global,
  update_held_sprite_position_global, check_throwable_collision_global, CODE_BCFB8B, process_current_movement,
  apply_spawn_script_to_slot_global, set_current_level_as_cleared,
} from "../../gen/routines";
import { cur, rd, wr, dec, inc, neg, isNeg, snd, spriteConst, spriteTail, BOSS, registerRts, registerSprite } from "./b6ba_common";
import { check_complex_player_collision_B6, CODE_B6D923, db16 } from "./b6ba_boss_commands";
import { CODE_B6D3C1, CODE_B6E275, CODE_B6EA83 } from "./b6ba_kleever";

const FIREBALL_PUFF = L("DATA_FF1528") & 0xffff;
const HOOK_STATES = L("DATA_B6E13D") & 0xffff;
const CANBALL_STATES = L("DATA_B6E4AE") & 0xffff;
const FALLING_CANBALL_STATES = L("DATA_B6E98E") & 0xffff;

/** DB pushed by the sprite codes that do `PHB : PHK : PLB`. */
let canballDB = 0xb6;
let hiltDB = 0xb6;

// ---------------------------------------------------------------------------------------
// Fireballs

/** $B6DE34 — a fireball flying along its line towards where the Kong was. */
export function kleever_fireballs_sprite_code(): void {
  delete_sprite_if_offscreen();
  if (!reg.c) return CODE_B6DE4C();
  reg.a = snd(6, "kleever_fireball");
  reg.c = false;
  queue_or_reset_looping_sound_effect();
  reg.a = snd(6, "kleever_fireball_2");
  queue_sound_effect();
  CODE_B6DF9C();
}

/** $B6DE4C — hits a Kong, or a held/thrown cannonball (which it knocks away). */
export function CODE_B6DE4C(): void {
  const x = cur();
  reg.x = x;
  reg.a = rd(x, 0x32);
  if (reg.a !== 0) return CODE_B6DE61();
  get_current_sprite_clipping();
  reg.a = 0x0000;
  check_complex_player_collision_B6();
  if (!reg.c) return CODE_B6DE66();
  reg.x = cur();
  CODE_B6DE61();
}

/** $B6DE61 */
export function CODE_B6DE61(): void {
  wr(reg.x, 0x32, 0);
  CODE_B6DF5C();
}

/** $B6DE66 */
export function CODE_B6DE66(): void {
  get_current_sprite_clipping();
  reg.a = 0x0010;
  check_for_sprite_collisions();
  if (!reg.c) return CODE_B6DE8E();
  const ball = r16(R.colliding_sprite);
  reg.x = ball;
  reg.a = rd(ball, sprite.type);
  if (reg.a !== C.sprite_kleever_canball) return CODE_B6DE8E();
  reg.a = rd(ball, 0x2e);
  if (reg.a === 0) return CODE_B6DE8E();
  if (reg.a < 0x0003) w16(R.current_held_sprite, 0);
  CODE_B6DE88();
}

/** $B6DE88 */
export function CODE_B6DE88(): void {
  CODE_B6E55F();
  CODE_B6DF5C();
}

/** $B6DE8E — move $2C pixels (Bresenham) this frame. */
export function CODE_B6DE8E(): void {
  const x = cur();
  reg.x = x;
  w16(BOSS.flag, rd(x, 0x2c));
  reg.a = r16(0x0769);
  if (reg.a === 0) w16(BOSS.flag, (r16(BOSS.flag) + 1) & 0xffff);
  CODE_B6DE9F();
}

/** $B6DE9F */
export function CODE_B6DE9F(): void {
  const x = reg.x;
  reg.a = rd(x, 0x24);
  if (reg.a === rd(x, 0x26)) return CODE_B6DF1D();
  CODE_B6DEA8();
}

/** $B6DEA8 */
export function CODE_B6DEA8(): void {
  if (rd(reg.x, 0x24) >= rd(reg.x, 0x26)) return CODE_B6DEAD();
  CODE_B6DEE5();
}

/** $B6DEAD — x-major steps. */
export function CODE_B6DEAD(): void {
  const x = reg.x;
  for (;;) {
    reg.a = (rd(x, 0x28) - rd(x, 0x2a)) & 0xffff;
    if (isNeg(reg.a)) {
      reg.a = (reg.a + rd(x, 0x24)) & 0xffff;
      wr(x, 0x28, reg.a);
      wr(x, 0x0a, rd(x, 0x0a) + rd(x, 0x22));
    } else wr(x, 0x28, reg.a);
    reg.a = (rd(x, 0x06) + rd(x, 0x20)) & 0xffff;
    wr(x, 0x06, reg.a);
    if (dec(0, BOSS.flag) === 0) break;
  }
  CODE_B6DED3();
}

/** $B6DEC2 */
export function CODE_B6DEC2(): void {
  wr(reg.x, 0x28, reg.a);
  CODE_B6DEC4();
}

/** $B6DEC4 */
export function CODE_B6DEC4(): void {
  const x = reg.x;
  reg.a = (rd(x, 0x06) + rd(x, 0x20)) & 0xffff;
  wr(x, 0x06, reg.a);
  if (dec(0, BOSS.flag) !== 0) return CODE_B6DEAD();
  CODE_B6DED3();
}

/** $B6DED3 — wobble one pixel up/down every other frame. */
export function CODE_B6DED3(): void {
  const x = reg.x;
  reg.a = rd(x, 0x2e) ^ 0x0001;
  wr(x, 0x2e, reg.a);
  if (reg.a === 0) return CODE_B6DEE0();
  inc(x, 0x0a);
  CODE_B6DEE2();
}

/** $B6DEE0 */
export function CODE_B6DEE0(): void {
  dec(reg.x, 0x0a);
  CODE_B6DEE2();
}

/** $B6DEE2 */
export function CODE_B6DEE2(): void {
  CODE_B6DF42();
}

/** $B6DEE5 — y-major steps. */
export function CODE_B6DEE5(): void {
  const x = reg.x;
  for (;;) {
    reg.a = (rd(x, 0x28) - rd(x, 0x2a)) & 0xffff;
    if (isNeg(reg.a)) {
      reg.a = (reg.a + rd(x, 0x26)) & 0xffff;
      wr(x, 0x28, reg.a);
      wr(x, 0x06, rd(x, 0x06) + rd(x, 0x20));
    } else wr(x, 0x28, reg.a);
    reg.a = (rd(x, 0x0a) + rd(x, 0x22)) & 0xffff;
    wr(x, 0x0a, reg.a);
    if (dec(0, BOSS.flag) === 0) break;
  }
  CODE_B6DF0B();
}

/** $B6DEFA */
export function CODE_B6DEFA(): void {
  wr(reg.x, 0x28, reg.a);
  CODE_B6DEFC();
}

/** $B6DEFC */
export function CODE_B6DEFC(): void {
  const x = reg.x;
  reg.a = (rd(x, 0x0a) + rd(x, 0x22)) & 0xffff;
  wr(x, 0x0a, reg.a);
  if (dec(0, BOSS.flag) !== 0) return CODE_B6DEE5();
  CODE_B6DF0B();
}

/** $B6DF0B — wobble one pixel left/right. */
export function CODE_B6DF0B(): void {
  const x = reg.x;
  reg.a = rd(x, 0x2e) ^ 0x0001;
  wr(x, 0x2e, reg.a);
  if (reg.a === 0) return CODE_B6DF18();
  inc(x, 0x06);
  CODE_B6DF1A();
}

/** $B6DF18 */
export function CODE_B6DF18(): void {
  dec(reg.x, 0x06);
  CODE_B6DF1A();
}

/** $B6DF1A */
export function CODE_B6DF1A(): void {
  CODE_B6DF42();
}

/** $B6DF1D — diagonal steps. */
export function CODE_B6DF1D(): void {
  const x = reg.x;
  do {
    wr(x, 0x06, rd(x, 0x06) + rd(x, 0x20));
    reg.a = (rd(x, 0x0a) + rd(x, 0x22)) & 0xffff;
    wr(x, 0x0a, reg.a);
  } while (dec(0, BOSS.flag) !== 0);
  CODE_B6DF33();
}

/** $B6DF33 */
export function CODE_B6DF33(): void {
  const x = reg.x;
  reg.a = rd(x, 0x2e) ^ 0x0001;
  wr(x, 0x2e, reg.a);
  if (reg.a === 0) return CODE_B6DF40();
  inc(x, 0x06);
  CODE_B6DF42();
}

/** $B6DF40 */
export function CODE_B6DF40(): void {
  dec(reg.x, 0x06);
  CODE_B6DF42();
}

/** $B6DF42 — still inside the arena? */
export function CODE_B6DF42(): void {
  const x = cur();
  reg.x = x;
  reg.a = rd(x, 0x06);
  if (reg.a < 0x0357 || reg.a >= 0x06c0) return CODE_B6DF5C();
  reg.a = rd(x, 0x0a);
  if (reg.a < 0x0160) return CODE_B6DF5C();
  if (reg.a < 0x02ba) return CODE_B6DF90();
  CODE_B6DF5C();
}

/** $B6DF5C — the fireball ends in a puff that keeps half its speed. */
export function CODE_B6DF5C(): void {
  reg.a = snd(6, "kleever_fireball");
  reg.c = false;
  queue_or_reset_looping_sound_effect();
  reg.a = snd(6, "kleever_fireball_2");
  queue_sound_effect();
  reg.y = FIREBALL_PUFF;
  spawn_special_sprite_address();
  const x = cur();
  reg.x = x;
  reg.y = r16(R.alternate_sprite);
  wr(x, 0x2c, rd(x, 0x2c) >> 1);
  if (isNeg(rd(x, 0x20))) return CODE_B6DF80();
  reg.a = rd(x, 0x2c);
  CODE_B6DF86();
}

/** $B6DF80 */
export function CODE_B6DF80(): void {
  reg.a = (0 - rd(reg.x, 0x2c)) & 0xffff;
  CODE_B6DF86();
}

/** $B6DF86 */
export function CODE_B6DF86(): void {
  reg.a = ((reg.a >> 8) | (reg.a << 8)) & 0xffff; // XBA
  wr(reg.y, 0x20, reg.a);
  delete_sprite_handle_deallocation();
  CODE_B6DF9C();
}

/** $B6DF90 */
export function CODE_B6DF90(): void {
  reg.a = snd(6, "kleever_fireball");
  reg.c = true;
  queue_or_reset_looping_sound_effect();
  process_sprite_animation();
  CODE_B6DF9C();
}

/** $B6DF9C — `JML [sprite_return_address]`. */
export function CODE_B6DF9C(): void {}

// ---------------------------------------------------------------------------------------
// Dropping hooks

/** $B6E0F3 — the hooks Kleever makes appear (states in DATA_B6E13D). */
export function dropping_hooks_sprite_code(): void {
  const x = cur();
  reg.x = x;
  reg.y = r16(BOSS.body);
  reg.a = r16(R.level_number);
  if (reg.a === C.level_kreepy_krow) {
    reg.a = rd(reg.y, 0x2e);
    if (reg.a & 0x2000) return CODE_B6E216();
  }
  CODE_B6E10A();
}

/** $B6E10A — first frame: remember the hook's resting y ($46). */
export function CODE_B6E10A(): void {
  let x = reg.x;
  reg.a = rd(x, 0x46);
  if (!isNeg(reg.a)) return CODE_B6E12A();
  get_sprite_position_in_level_data();
  x = cur();
  reg.x = x;
  wr(x, 0x46, r16(0x74));
  reg.a = r16(0x06a3);
  if (reg.a & 0x0008) {
    reg.a = r16(0x74);
    wr(x, 0x0a, reg.a);
    wr(x, 0x2e, 0);
    return CODE_B6E1C7();
  }
  CODE_B6E12A();
}

/** $B6E12A */
export function CODE_B6E12A(): void {
  const b = r16(BOSS.body);
  reg.x = b;
  wr(b, 0x2e, rd(b, 0x2e) | 0x0200);
  const x = cur();
  const st = rd(x, 0x2e);
  reg.x = (st << 1) & 0xffff;
  reg.a = reg.x;
  const states = [CODE_B6E1C7, CODE_B6E21D, CODE_B6E25B, CODE_B6E149, CODE_B6E198, CODE_B6E1F2];
  if (st < states.length) return states[st]();
  jmpTable(HOOK_STATES);
}

/** `JMP (table,x)` for an out-of-range state: run whatever the ROM table points at. */
function jmpTable(table: number) {
  spriteTail(0xb60000 | db16(table + reg.x));
}

/** $B6E149 — state 3: rising out of the lava to the resting y. */
export function CODE_B6E149(): void {
  let x = cur();
  reg.x = x;
  reg.a = rd(x, 0x0a);
  if (reg.a >= rd(x, 0x46)) {
    reg.a = snd(5, "hooks_appear");
    queue_sound_effect();
    x = cur();
    reg.x = x;
    wr(x, 0x0a, rd(x, 0x46));
    wr(x, 0x24, 0xfd00);
    wr(x, 0x2e, 0x0004);
    reg.a = r16(0x06a3);
    if (reg.a & 0x0004) {
      reg.a |= 0x0008;
      w16(0x06a3, reg.a);
    }
  }
  CODE_B6E178();
}

/** $B6E178 */
export function CODE_B6E178(): void {
  reg.a = 0x0003;
  interpolate_y_velocity_global();
  apply_position_from_velocity_global();
  reg.a = r16(0x06a3);
  if (reg.a & 0x0004 && reg.a & 0x0008) CODE_BBBB99();
  CODE_B6E195();
}

/** $B6E195 */
export function CODE_B6E195(): void {}

/** $B6E198 — state 4: bounce back down to the resting y. */
export function CODE_B6E198(): void {
  const x = cur();
  reg.x = x;
  reg.a = rd(x, 0x0a);
  if (reg.a < rd(x, 0x46)) return CODE_B6E1AC();
  wr(x, 0x24, 0);
  wr(x, 0x2a, 0);
  reg.a = rd(x, 0x46);
  wr(x, 0x0a, reg.a);
  wr(x, 0x2e, 0);
  CODE_B6E1B7();
}

/** $B6E1AC */
export function CODE_B6E1AC(): void {
  reg.a = 0x0005;
  interpolate_y_velocity_global();
  apply_position_from_velocity_global();
  CODE_B6E1B7();
}

/** $B6E1B7 */
export function CODE_B6E1B7(): void {
  reg.a = r16(0x06a3);
  if (reg.a & 0x0004) CODE_BBBB99();
  CODE_B6E1C4();
}

/** $B6E1C4 */
export function CODE_B6E1C4(): void {}

/** $B6E1C7 — state 0: a normal hook (B3 hook code); sinks when Kleever's phase ends. */
export function CODE_B6E1C7(): void {
  reg.x = cur();
  reg.y = r16(BOSS.body);
  reg.a = rd(reg.y, 0x2e);
  if (reg.a & 0x0400) return CODE_B6E1E8();
  CODE_B39982();
  reg.a = r16(0x06a3);
  if (reg.a & 0x0004) CODE_BBBB99();
  CODE_B6E1E5();
}

/** $B6E1E5 */
export function CODE_B6E1E5(): void {}

/** $B6E1E8 */
export function CODE_B6E1E8(): void {
  wr(reg.x, 0x2e, 0x0005);
  reg.a = 0x0a00;
  wr(reg.x, 0x2a, 0x0a00);
  CODE_B6E1F2();
}

/** $B6E1F2 — state 5: sink into the lava. */
export function CODE_B6E1F2(): void {
  const x = cur();
  reg.x = x;
  reg.a = rd(x, 0x0a);
  if (reg.a >= 0x02e5) return CODE_B6E216();
  reg.a = 0x0003;
  interpolate_y_velocity_global();
  apply_position_from_velocity_global();
  reg.a = r16(0x06a3);
  if (reg.a & 0x0004) CODE_BBBB99();
  CODE_B6E213();
}

/** $B6E213 */
export function CODE_B6E213(): void {}

/** $B6E216 */
export function CODE_B6E216(): void {
  delete_sprite_handle_deallocation();
}

/** $B6E21D — state 1: held by the Kong. */
export function CODE_B6E21D(): void {
  const x = cur();
  reg.x = x;
  reg.a = r16(0x0d82);
  if (reg.a !== cur()) return CODE_B6E23E();
  reg.a = rd(x, 0x4e);
  if (reg.a !== 0) CODE_B398A7();
  CODE_B6E22E();
}

/** $B6E22E */
export function CODE_B6E22E(): void {
  reg.a = r16(0x06a3);
  if (reg.a & 0x0004) CODE_BBBB99();
  CODE_B6E23B();
}

/** $B6E23B */
export function CODE_B6E23B(): void {}

/** $B6E23E — let go. */
export function CODE_B6E23E(): void {
  const x = reg.x;
  w16(0x0aee, 0);
  w16(0x0af2, 0);
  wr(x, 0x42, 0x001e);
  inc(x, 0x2e);
  reg.a = r16(0x06a3);
  if (reg.a & 0x0004) CODE_BBBB99();
  CODE_B6E258();
}

/** $B6E258 */
export function CODE_B6E258(): void {}

/** $B6E25B — state 2: can't be grabbed again for $42 frames. */
export function CODE_B6E25B(): void {
  const x = cur();
  reg.x = x;
  if (dec(x, 0x42) === 0) return CODE_B6E271();
  CODE_B6E261();
}

/** $B6E261 */
export function CODE_B6E261(): void {
  reg.a = r16(0x06a3);
  if (reg.a & 0x0004) CODE_BBBB99();
  CODE_B6E26E();
}

/** $B6E26E */
export function CODE_B6E26E(): void {}

/** $B6E271 */
export function CODE_B6E271(): void {
  wr(reg.x, 0x2e, 0);
  CODE_B6E261();
}

// ---------------------------------------------------------------------------------------
// Cannonball

/** $B6E49E — the cannonball (states in DATA_B6E4AE). */
export function kleever_canball_sprite_code(): void {
  canballDB = reg.db;
  reg.db = 0xb6;
  const x = cur();
  reg.x = x;
  w16(R.current_sprite_constants, rd(x, 0x54));
  const st = rd(x, 0x2e);
  reg.x = (st << 1) & 0xffff;
  reg.a = reg.x;
  const states = [CODE_B6E523, CODE_B6E53C, CODE_B6E53C, CODE_B6E604, CODE_B6E4BC, CODE_B6E4BC, CODE_B6E4C4];
  if (st < states.length) return states[st]();
  jmpTable(CANBALL_STATES);
}

/** $B6E4BC — states 4/5: gone. */
export function CODE_B6E4BC(): void {
  delete_sprite_handle_deallocation();
  reg.db = canballDB;
}

/** $B6E4C4 — state 6: knocked away (by a fireball / the blade); sinks into the lava. */
export function CODE_B6E4C4(): void {
  delete_sprite_if_offscreen();
  if (!reg.c) return CODE_B6E4CF();
  CODE_B6D3C1();
  CODE_B6E500();
}

/** $B6E4CF */
export function CODE_B6E4CF(): void {
  reg.a = 0x0002;
  interpolate_x_velocity_global();
  reg.a = 0x0004;
  interpolate_y_velocity_global();
  apply_position_from_velocity_global();
  process_sprite_animation();
  const x = cur();
  reg.x = x;
  reg.a = rd(x, 0x0a);
  if (reg.a >= 0x02c7) {
    delete_sprite_handle_deallocation();
    reg.y = C.special_sprite_spawn_id_0152; // lava splash
    spawn_special_sprite_index();
    reg.a = snd(7, "lava_bubble_4");
    queue_sound_effect();
  }
  CODE_B6E500();
}

/** $B6E500 */
export function CODE_B6E500(): void {
  reg.db = canballDB;
}

/** $B6E504 — picked up? (interaction $32 = 1). Carry = handled. */
export function CODE_B6E504(): void {
  const x = cur();
  reg.x = x;
  reg.a = rd(x, 0x32);
  if (reg.a !== 0) return CODE_B6E50C();
  CODE_B6E50A();
}

/** $B6E50A */
export function CODE_B6E50A(): void {
  reg.c = false;
}

/** $B6E50C */
export function CODE_B6E50C(): void {
  wr(reg.x, 0x32, 0);
  if (reg.a === 0x0001) return CODE_B6E515();
  CODE_B6E50A();
}

/** $B6E515 */
export function CODE_B6E515(): void {
  wr(reg.x, 0x2e, 0x0001);
  reg.a = 0xfffc & rd(reg.x, 0x30);
  wr(reg.x, 0x30, reg.a);
  reg.c = true;
}

/** $B6E523 — state 0: lying around. */
export function CODE_B6E523(): void {
  CODE_B6E504();
  if (reg.c) return CODE_B6E559();
  apply_sprite_gravity_global();
  CODE_B39EBA();
  process_terrain_interaction_global();
  process_sprite_animation();
  reg.db = canballDB;
}

/** $B6E53C — states 1/2: held by a Kong. */
export function CODE_B6E53C(): void {
  reg.a = r16(R.current_held_sprite);
  if (reg.a === 0) {
    const x = cur();
    reg.x = x;
    reg.a = rd(x, 0x32);
    if (reg.a === 0) {
      reg.a = 0x0005;
      wr(x, 0x32, 0x0005);
    }
  }
  CODE_B6E54C();
}

/** $B6E54C */
export function CODE_B6E54C(): void {
  CODE_B6E591();
  if (!reg.c) {
    update_held_sprite_position_global();
    process_sprite_animation();
  }
  CODE_B6E559();
}

/** $B6E559 */
export function CODE_B6E559(): void {
  reg.db = canballDB;
}

/** $B6E55D — knocked away: fly up and away (state 6). */
export function CODE_B6E55D(): void {
  reg.x = cur();
  CODE_B6E55F();
}

/** $B6E55F */
export function CODE_B6E55F(): void {
  const x = reg.x;
  reg.a = rd(x, 0x2e);
  if (reg.a < 0x0003) return CODE_B6E56F();
  reg.a = rd(x, 0x20);
  if (!isNeg(reg.a)) return CODE_B6E57A();
  CODE_B6E56A();
}

/** $B6E56A */
export function CODE_B6E56A(): void {
  reg.a = 0x0400;
  CODE_B6E57D();
}

/** $B6E56F */
export function CODE_B6E56F(): void {
  reg.y = r16(R.active_kong_sprite);
  reg.a = rd(reg.y, 0x12);
  if (reg.a & 0x4000) return CODE_B6E56A();
  CODE_B6E57A();
}

/** $B6E57A */
export function CODE_B6E57A(): void {
  reg.a = 0xfc00;
  CODE_B6E57D();
}

/** $B6E57D */
export function CODE_B6E57D(): void {
  const x = reg.x;
  wr(x, 0x20, reg.a);
  wr(x, 0x24, 0xf610);
  wr(x, 0x26, 0);
  wr(x, 0x2a, 0x1000);
  reg.a = 0x0006;
  wr(x, 0x2e, 0x0006);
}

/** $B6E591 — the Kong's interaction code ($32): drop, put down, throw. Carry = handled. */
export function CODE_B6E591(): void {
  const x = cur();
  reg.x = x;
  reg.a = rd(x, 0x32);
  if (reg.a !== 0) return CODE_B6E599();
  CODE_B6E597();
}

/** $B6E597 */
export function CODE_B6E597(): void {
  reg.c = false;
}

/** $B6E599 */
export function CODE_B6E599(): void {
  wr(reg.x, 0x32, 0);
  switch (reg.a) {
    case 0x0001: return CODE_B6E5F4();
    case 0x0002: return CODE_B6E5C1();
    case 0x0004: case 0x0006: return CODE_B6E5C8();
    case 0x0005: case 0x0200: return CODE_B6E5B9();
  }
  CODE_B6E597();
}

/** $B6E5B9 — knocked out of the hands. */
export function CODE_B6E5B9(): void {
  w16(R.current_held_sprite, 0);
  CODE_B6E55D();
  reg.c = true;
}

/** $B6E5C1 */
export function CODE_B6E5C1(): void {
  reg.a = 0x0002;
  wr(reg.x, 0x2e, 0x0002);
  reg.c = true;
}

/** $B6E5C8 — thrown: roll along the ground (speed from the constants). */
export function CODE_B6E5C8(): void {
  const x = reg.x;
  wr(x, 0x2e, 0x0003);
  wr(x, 0x02, 0x00c8);
  reg.y = 0x0006;
  reg.a = spriteConst(0x0006);
  if (isNeg(rd(x, 0x20))) reg.a = neg(reg.a);
  CODE_B6E5DF();
}

/** $B6E5DF */
export function CODE_B6E5DF(): void {
  const x = reg.x;
  wr(x, 0x26, reg.a);
  const f = rd(x, 0x12);
  reg.a = (((reg.a >> 1) ^ f) & 0x4000) ^ f;
  wr(x, 0x12, reg.a);
  reg.a = C.cannon_ball_anim_id;
  set_sprite_animation();
  reg.c = true;
}

/** $B6E5F4 — put down. */
export function CODE_B6E5F4(): void {
  const x = reg.x;
  wr(x, 0x2e, 0);
  wr(x, 0x30, 0x0003 | rd(x, 0x30));
  reg.a = 0x00c8;
  wr(x, 0x02, 0x00c8);
  reg.c = true;
}

/** $B6E604 — state 3: rolling. */
export function CODE_B6E604(): void {
  let x = cur();
  reg.x = x;
  wr(x, 0x26, 0);
  apply_sprite_gravity_global();
  CODE_B39EBA();
  process_terrain_interaction_global();
  x = cur();
  reg.x = x;
  reg.a = rd(x, 0x0a);
  if (reg.a < 0x02c7) return CODE_B6E62A();
  delete_sprite_handle_deallocation();
  reg.y = C.special_sprite_spawn_id_0152;
  spawn_special_sprite_index();
  CODE_B6E630();
}

/** $B6E62A */
export function CODE_B6E62A(): void {
  delete_sprite_if_offscreen();
  if (!reg.c) return CODE_B6E635();
  CODE_B6E630();
}

/** $B6E630 */
export function CODE_B6E630(): void {
  CODE_B6D3C1();
  CODE_B6E69B();
}

/** $B6E635 — stop when slow on the ground; bounce off walls; hit things. */
export function CODE_B6E635(): void {
  const x = cur();
  reg.x = x;
  reg.a = rd(x, 0x1e);
  if (reg.a & 0x0001) {
    if (reg.a & 0x0002) return CODE_B6E671();
    reg.a = rd(x, 0x06);
    if (reg.a >= 0x06c9) return CODE_B6E671();
    reg.a = rd(x, 0x20);
    if (reg.a < 0x0020) {
      wr(x, 0x26, 0);
      wr(x, 0x20, 0);
      wr(x, 0x2e, 0);
      wr(x, 0x30, 0x0211);
      reg.a = C.cannon_ball_down_anim_id;
      set_sprite_animation();
      return CODE_B6E697();
    }
  }
  CODE_B6E665();
}

/** $B6E665 */
export function CODE_B6E665(): void {
  reg.a = rd(reg.x, 0x1e) & 0x0202;
  if (reg.a === 0) return CODE_B6E688();
  if (reg.a !== 0x0202) return CODE_B6E677();
  CODE_B6E671();
}

/** $B6E671 */
export function CODE_B6E671(): void {
  CODE_B6E55D();
  CODE_B6E559();
}

/** $B6E677 — hit a wall: roll back. */
export function CODE_B6E677(): void {
  const x = reg.x;
  reg.y = 0x0006;
  reg.a = spriteConst(0x0006);
  if (rd(x, 0x12) & 0x4000) reg.a = neg(reg.a);
  CODE_B6E684();
}

/** $B6E684 */
export function CODE_B6E684(): void {
  wr(reg.x, 0x20, reg.a);
  wr(reg.x, 0x26, reg.a);
  CODE_B6E688();
}

/** $B6E688 */
export function CODE_B6E688(): void {
  reg.a = 0x0200;
  check_throwable_collision_global();
  if (reg.c) {
    CODE_B6E55D();
    return CODE_B6E559();
  }
  CODE_B6E697();
}

/** $B6E697 */
export function CODE_B6E697(): void {
  process_sprite_animation();
  CODE_B6E69B();
}

/** $B6E69B */
export function CODE_B6E69B(): void {
  reg.db = canballDB;
}

// ---------------------------------------------------------------------------------------
// Hand, bubbles, falling cannonball, effects

/** $B6E79E */
export function kleever_hand_bubbles_sprite_code(): void {
  process_sprite_animation();
}

/** $B6E7A5 — Kleever's hand: hurts the Kongs (while Kleever is hurt), can be hit. */
export function kleever_hand_sprite_code(): void {
  const db = reg.db;
  reg.db = 0xb6;
  process_sprite_animation();
  handMain();
  reg.db = db;
}

function handMain(): void {
  reg.y = r16(R.active_kong_sprite);
  reg.a = rd(reg.y, 0x2e);
  if (reg.a === 0x0005) return;
  reg.a = r16(BOSS.hp);
  if (reg.a === 0) return;
  const x = reg.x;
  reg.a = rd(x, 0x2e);
  if (reg.a & 0x0001) {
    reg.a = rd(x, 0x54);
    if (reg.a !== 0) return;
    get_current_sprite_clipping();
    reg.a = 0x0c7b;
    check_complex_player_collision_B6();
    if (!reg.c) return;
    reg.a = 0x001e;
    reg.y = 0xfe00;
    CODE_B3A600();
    const x2 = cur();
    reg.x = x2;
    reg.a = 0x0014;
    wr(x2, 0x54, 0x0014);
    return;
  }
  reg.a = rd(x, 0x32);
  if (reg.a !== 0) {
    CODE_B6E275();
    return;
  }
  get_current_sprite_clipping();
  reg.a = 0x000b;
  CODE_BCFB8B();
  reg.a = 0x0000;
  check_complex_player_collision_B6();
}

/** $B6E97C — a cannonball falling from the ceiling (states in DATA_B6E98E). */
export function kleever_falling_canball_sprite_code(): void {
  const y = cur();
  reg.y = y;
  w16(R.current_sprite_constants, rd(y, 0x54));
  const st = rd(y, 0x2e) & 0x00ff;
  reg.x = (st << 1) & 0xffff;
  reg.a = reg.x;
  if (st === 0) return CODE_B6E994();
  if (st === 1) return CODE_B6E9B6();
  if (st === 2) return CODE_B6E9D3();
  jmpTable(FALLING_CANBALL_STATES);
}

/** $B6E994 — falling: on the first ground contact bounce. */
export function CODE_B6E994(): void {
  process_current_movement();
  const x = cur();
  reg.x = x;
  reg.a = rd(x, 0x1e);
  if (reg.a & 0x0001) {
    wr(x, 0x24, 0xfe00);
    inc(x, 0x2e);
    reg.a = snd(6, "cannonball_drop");
    queue_sound_effect();
  }
  CODE_B6E9AF();
}

/** $B6E9AF */
export function CODE_B6E9AF(): void {
  process_sprite_animation();
}

/** $B6E9B6 — bouncing: on the second contact become a normal cannonball. */
export function CODE_B6E9B6(): void {
  process_current_movement();
  const x = cur();
  reg.x = x;
  reg.a = rd(x, 0x1e);
  if (reg.a & 0x0001) {
    inc(x, 0x2e);
    reg.a = snd(6, "cannonball_drop");
    queue_sound_effect();
  }
  CODE_B6E9CC();
}

/** $B6E9CC */
export function CODE_B6E9CC(): void {
  process_sprite_animation();
}

/** $B6E9D3 — turn into the cannonball sprite (spawn script $4E). */
export function CODE_B6E9D3(): void {
  reg.x = reg.y;
  reg.y = rd(reg.x, 0x4e);
  apply_spawn_script_to_slot_global();
}

/** $B6E9DD */
export function kleever_attack_effect_sprite_code(): void {
  process_sprite_animation();
}

// ---------------------------------------------------------------------------------------
// After the defeat

/** $B6E9E4 — the broken hilt flies along its movement list, then sinks: level cleared. */
export function broken_kleever_hilt_sprite_code(): void {
  reg.a = r16(0x06a3);
  if (!(reg.a & 0x0010)) return;
  hiltDB = reg.db;
  reg.db = 0xb6;
  let x = cur();
  reg.x = x;
  wr(x, 0x1c, 0);
  process_sprite_animation();
  x = cur();
  reg.x = x;
  if (dec(x, 0x44) === 0) {
    CODE_B6D923();
    reg.y = rd(x, 0x42);
    reg.a = db16(reg.y);
    if (reg.a === 0x0063) {
      set_current_level_as_cleared();
      delete_sprite_handle_deallocation();
      reg.db = hiltDB;
      return;
    }
    CODE_B6EA83();
  }
  reg.db = 0xb6;
  reg.a = rd(reg.x, 0x46);
  interpolate_x_velocity_global();
  x = cur();
  reg.x = x;
  reg.a = rd(x, 0x48);
  interpolate_y_velocity_global();
  apply_position_from_velocity_global();
  x = cur();
  reg.x = x;
  reg.y = r16(BOSS.head);
  wr(reg.y, 0x06, rd(x, 0x06));
  wr(reg.y, 0x0a, rd(x, 0x0a));
  reg.a = rd(x, 0x0a);
  if (reg.a >= 0x02f0) {
    delete_sprite_handle_deallocation();
    reg.y = r16(BOSS.head);
    w16(R.current_sprite, reg.y);
    delete_sprite_handle_deallocation();
    reg.x = x;
    w16(R.current_sprite, x);
    reg.y = C.special_sprite_spawn_id_0152;
    spawn_special_sprite_index();
    reg.y = C.special_sprite_spawn_id_0154;
    spawn_special_sprite_index();
    reg.y = C.special_sprite_spawn_id_0156;
    spawn_special_sprite_index();
    reg.a = snd(7, "lava_bubble_2");
    queue_sound_effect();
    x = cur();
    reg.x = x;
    wr(x, 0x0a, 0);
    reg.a = 0x000f;
    wr(x, 0x44, 0x000f);
  }
  reg.db = hiltDB;
}

/** $B6EAA4 */
export function broken_kleever_fire_sprite_code(): void {
  reg.a = r16(0x06a3);
  if (!(reg.a & 0x0010)) return;
  const x = cur();
  reg.x = x;
  wr(x, 0x1c, 0);
  process_sprite_animation();
}

/**
 * $B6EAB8 — pieces of Kleever and of the roof: fall, bounce off the floor and the right wall
 * (Kleever's Kiln) or the floor/walls (K. Rool Duel), slowing their animation.
 */
export function kleever_and_roof_pieces_sprite_code(): void {
  reg.a = r16(0x06a3);
  if (!(reg.a & 0x0010)) return;
  const x = cur();
  reg.x = x;
  reg.a = rd(x, 0x48);
  if (reg.a !== 0) return;
  wr(x, 0x1c, 0);
  reg.a = r16(R.level_number);
  if (reg.a === C.level_krool_duel && r16(0x06a3) & 0x0010) return piecesDuel();
  piecesKiln();
}

/** Bounce: A = -speed, settle when slower than `min`. Returns true when it settled. */
function bounceY(min: number): boolean {
  const x = reg.x;
  wr(x, 0x46, 0x0001);
  reg.a = rd(x, 0x24);
  if (!isNeg(reg.a) && reg.a !== 0) {
    reg.a = neg(reg.a);
    if (reg.a < min) {
      wr(x, 0x24, reg.a);
      reg.a = snd(5, "debris_fall");
      queue_sound_effect();
      reg.x = cur();
      return false;
    }
  }
  inc(x, 0x48);
  reg.a = snd(5, "debris_fall");
  queue_sound_effect();
  reg.x = cur();
  return true;
}

function piecesKiln(): void {
  let x = reg.x;
  reg.a = rd(x, 0x0a);
  if (reg.a >= 0x0287 && reg.a < 0x0296 && rd(x, 0x06) >= 0x060f) {
    if (bounceY(0xff00)) return;
    x = reg.x;
    wr(x, 0x0a, 0x0287);
  }
  x = reg.x;
  reg.a = rd(x, 0x06);
  if (reg.a >= 0x06cc) {
    reg.a = rd(x, 0x0a);
    if (reg.a < 0x0296 && reg.a >= 0x0250) {
      x = cur();
      reg.x = x;
      wr(x, 0x06, 0x06cc);
      wr(x, 0x46, 0x0001);
      reg.a = neg(rd(x, 0x20));
      if (reg.a >= 0xffc0) {
        inc(x, 0x48);
        reg.a = snd(5, "debris_fall");
        queue_sound_effect();
        return;
      }
      wr(x, 0x20, reg.a);
      wr(x, 0x26, 0);
      wr(x, 0x42, 0x0001);
    }
  }
  x = reg.x;
  reg.a = rd(x, 0x46);
  if (reg.a !== 0) {
    reg.a = rd(x, 0x3a);
    if (reg.a !== 0) {
      reg.a = (reg.a - 2) & 0xffff;
      if (!isNeg(reg.a)) wr(x, 0x3a, reg.a);
    }
  }
  reg.a = rd(x, 0x0a);
  if (reg.a >= 0x0297) {
    reg.a = 0x0500;
    wr(x, 0x2a, 0x0500);
  }
  piecesMove();
}

/** `.CODE_B6EB7F`: move, animate, delete when far below the screen. */
function piecesMove(): void {
  reg.a = rd(reg.x, 0x42);
  interpolate_x_velocity_global();
  const x = cur();
  reg.x = x;
  reg.a = rd(x, 0x44);
  interpolate_y_velocity_global();
  apply_position_from_velocity_global();
  process_sprite_animation();
  reg.x = cur();
  reg.a = rd(reg.x, 0x24);
  if (isNeg(reg.a)) return;
  reg.a = (rd(reg.x, 0x0a) - r16(0x17c2)) & 0xffff;
  if (isNeg(reg.a)) return;
  if (isNeg((reg.a - 0x00e0) & 0xffff)) return;
  delete_sprite_handle_deallocation();
}

function piecesDuel(): void {
  let x = reg.x;
  reg.a = 0x01c1;
  if (reg.a < rd(x, 0x0a)) {
    wr(x, 0x0a, 0x01c1);
    x = cur();
    reg.x = x;
    if (bounceY(0xfec0)) return piecesMove();
  }
  x = reg.x;
  reg.a = rd(x, 0x06);
  if (reg.a < 0x0100) {
    CODE_B6EC0A();
    reg.a = rd(x, 0x06);
  }
  if (reg.a >= 0x029f) CODE_B6EC0A();
  reg.a = rd(x, 0x46);
  if (reg.a !== 0) {
    reg.a = rd(x, 0x3a);
    if (reg.a !== 0) {
      reg.a = (reg.a - 1) & 0xffff;
      if (!isNeg(reg.a)) wr(x, 0x3a, reg.a);
    }
  }
  piecesMove();
}

/** $B6EC0A — bounce off a wall: reverse the x speed. */
export function CODE_B6EC0A(): void {
  const x = reg.x;
  wr(x, 0x20, neg(rd(x, 0x20)));
  wr(x, 0x26, 0);
  reg.a = 0x0003;
  wr(x, 0x42, 0x0003);
}

registerSprite({
  kleever_fireballs_sprite_code, CODE_B6DE4C, CODE_B6DE61, CODE_B6DE66, CODE_B6DE88, CODE_B6DE8E,
  CODE_B6DE9F, CODE_B6DEA8, CODE_B6DEAD, CODE_B6DEC2, CODE_B6DEC4, CODE_B6DED3, CODE_B6DEE0,
  CODE_B6DEE2, CODE_B6DEE5, CODE_B6DEFA, CODE_B6DEFC, CODE_B6DF0B, CODE_B6DF18, CODE_B6DF1A,
  CODE_B6DF1D, CODE_B6DF33, CODE_B6DF40, CODE_B6DF42, CODE_B6DF5C, CODE_B6DF80, CODE_B6DF86,
  CODE_B6DF90, CODE_B6DF9C, dropping_hooks_sprite_code, CODE_B6E10A, CODE_B6E12A, CODE_B6E149,
  CODE_B6E178, CODE_B6E195, CODE_B6E198, CODE_B6E1AC, CODE_B6E1B7, CODE_B6E1C4, CODE_B6E1C7,
  CODE_B6E1E5, CODE_B6E1E8, CODE_B6E1F2, CODE_B6E213, CODE_B6E216, CODE_B6E21D, CODE_B6E22E,
  CODE_B6E23B, CODE_B6E23E, CODE_B6E258, CODE_B6E25B, CODE_B6E261, CODE_B6E26E, CODE_B6E271,
  kleever_canball_sprite_code, CODE_B6E4BC, CODE_B6E4C4, CODE_B6E4CF, CODE_B6E500, CODE_B6E523,
  CODE_B6E53C, CODE_B6E54C, CODE_B6E559, CODE_B6E604, CODE_B6E62A, CODE_B6E630, CODE_B6E635,
  CODE_B6E665, CODE_B6E671, CODE_B6E677, CODE_B6E684, CODE_B6E688, CODE_B6E697, CODE_B6E69B,
  kleever_hand_bubbles_sprite_code, kleever_hand_sprite_code, kleever_falling_canball_sprite_code,
  CODE_B6E994, CODE_B6E9AF, CODE_B6E9B6, CODE_B6E9CC, CODE_B6E9D3,
  kleever_attack_effect_sprite_code, broken_kleever_hilt_sprite_code,
  broken_kleever_fire_sprite_code, kleever_and_roof_pieces_sprite_code,
});
registerRts({
  CODE_B6E504, CODE_B6E50A, CODE_B6E50C, CODE_B6E515, CODE_B6E55D, CODE_B6E55F, CODE_B6E56A,
  CODE_B6E56F, CODE_B6E57A, CODE_B6E57D, CODE_B6E591, CODE_B6E597, CODE_B6E599, CODE_B6E5B9,
  CODE_B6E5C1, CODE_B6E5C8, CODE_B6E5DF, CODE_B6E5F4, CODE_B6EC0A,
});
