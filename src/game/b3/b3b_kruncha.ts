/**
 * Bank $B3 — Kruncha, the muscular Kremling: jumping on him makes him angry (red palette
 * flashing, runs faster, chases the Kong) instead of defeating him; he calms down after a while.
 * Variables: $48 current walk speed, $4A normal walk speed, $4C angry delay, $4E walk animation
 * speed; display_mode counts down the palette flashing.
 */
import { r16, w16 } from "../../core/mem";
import { reg } from "../../core/cpu";
import { L, R, C, sprite } from "../../core/sym";
import {
  process_current_movement, process_sprite_animation, set_sprite_palette_direct_global,
  check_throwable_collision_global, get_current_sprite_clipping, CODE_BEBE8B, set_sprite_animation,
} from "../../gen/routines";
import {
  cur, rd, wr, dec, spriteConst, isNeg, bit14, neg, despawnReturn, stateHandlerB3, registerRts, registerSprite,
} from "./b3b_common";
import { check_for_sprite_crush, multiply_a_by_y, defeat_sprite_using_animation, make_sprite_fall_off_screen } from "./b3b_misc";

const STATE_TABLE = (L("kruncha_main") + 0x18) & 0xffff;

/** $B3B04D */
export function kruncha_main(): void {
  reg.y = cur();
  if (r16(R.time_stop_flags) & 0x0004) {
    reg.a = rd(reg.y, sprite.state);
    if (reg.a !== 0x0004) return; // frozen by a time stop unless being calmed
  }
  stateHandlerB3(STATE_TABLE, [CODE_B3B071, CODE_B3B082, CODE_B3B092, CODE_B3B0CF, CODE_B3B14D, CODE_B3B16E]);
}

/** $B3B071 — state 0: remember the walk speed. */
export function CODE_B3B071(): void {
  reg.x = reg.y;
  reg.a = rd(reg.x, sprite.max_x_speed);
  if (isNeg(reg.a)) reg.a = neg(reg.a);
  CODE_B3B07A();
}

/** $B3B07A */
export function CODE_B3B07A(): void {
  const x = reg.x;
  wr(x, 0x48, reg.a);
  wr(x, 0x4a, reg.a);
  wr(x, sprite.display_mode, 0);
  wr(x, sprite.state, rd(x, sprite.state) + 1);
  CODE_B3B082();
}

/** $B3B082 — state 1: walk. */
export function CODE_B3B082(): void {
  CODE_B3B194();
  if (!reg.c) {
    process_current_movement();
    process_sprite_animation();
  }
  CODE_B3B08F();
}

/** $B3B08F */
export function CODE_B3B08F(): void {
  despawnReturn();
}

/** $B3B092 — state 2: angry, waiting for the walk animation to start running. */
export function CODE_B3B092(): void {
  reg.a = r16(reg.y + sprite.animation_id);
  if (reg.a === C.kruncha_walk_anim_id) return CODE_B3B09D();
  CODE_B3B082();
}

/** $B3B09D — start running: speed = normal speed / 16 * constants +$08. */
export function CODE_B3B09D(): void {
  const x = reg.y;
  reg.x = x;
  reg.y = spriteConst(0x0008);
  reg.a = rd(x, 0x4a) >> 4;
  multiply_a_by_y();
  if (bit14(rd(x, sprite.oam_property))) reg.a = neg(reg.a);
  CODE_B3B0B5();
}

/** $B3B0B5 */
export function CODE_B3B0B5(): void {
  const x = reg.x;
  wr(x, 0x48, reg.a);
  wr(x, sprite.max_x_speed, reg.a);
  wr(x, 0x4c, spriteConst(0x000a));
  reg.y = 0x000c;
  wr(x, 0x4e, spriteConst(0x000c));
  reg.a = 0x0003;
  wr(x, sprite.state, reg.a);
  CODE_B3B082();
}

/** $B3B0CF — state 3: running angry; slows down back to normal, then calms. */
export function CODE_B3B0CF(): void {
  const x = cur();
  reg.x = x;
  if (rd(x, sprite.animation_id) === C.kruncha_walk_anim_id) {
    wr(x, sprite.animation_speed, rd(x, 0x4e));
  }
  CODE_B3B0DC();
}

/** $B3B0DC */
export function CODE_B3B0DC(): void {
  const x = reg.x;
  reg.a = rd(x, 0x4c);
  if (isNeg(reg.a)) return CODE_B3B0E4();
  dec(x, 0x4c);
  CODE_B3B12E();
}

/** $B3B0E4 — ease the speed back towards normal. */
export function CODE_B3B0E4(): void {
  const x = reg.x;
  reg.y = rd(x, 0x4a);
  reg.a = rd(x, sprite.max_x_speed);
  if (reg.a === 0) return CODE_B3B12E();
  if (!isNeg(reg.a)) return CODE_B3B0F9();
  reg.a = neg(reg.a);
  CODE_B3B2BC();
  reg.a = neg(reg.a);
  CODE_B3B0FC();
}

/** $B3B0F9 */
export function CODE_B3B0F9(): void {
  CODE_B3B2BC();
  CODE_B3B0FC();
}

/** $B3B0FC */
export function CODE_B3B0FC(): void {
  const x = reg.x;
  wr(x, sprite.max_x_speed, reg.a);
  wr(x, 0x48, reg.a);
  if (reg.c) return CODE_B3B116();
  reg.y = 0x0100;
  reg.a = rd(x, 0x4e);
  CODE_B3B2BC();
  wr(x, 0x4e, reg.a);
  if (reg.a < 0x0180) CODE_B3B179();
  CODE_B3B12E();
}

/** $B3B116 — back to normal speed: calm again. */
export function CODE_B3B116(): void {
  const x = reg.x;
  wr(x, sprite.animation_speed, 0x0100);
  wr(x, sprite.display_mode, 0x0001);
  CODE_B3B179();
  reg.y = cur();
  reg.a = 0x0001;
  w16(reg.y + sprite.state, reg.a);
  CODE_B3B082();
}

/** $B3B12E */
export function CODE_B3B12E(): void {
  CODE_B3B194();
  if (reg.c) return CODE_B3B14A();
  const x = cur();
  reg.x = x;
  reg.a = rd(x, sprite.movement_state);
  if (reg.a === 0x0022) {
    reg.a = C.kruncha_turn_anim_id;
    CODE_B3B28E();
  }
  CODE_B3B142();
}

/** $B3B142 */
export function CODE_B3B142(): void {
  process_current_movement();
  process_sprite_animation();
  CODE_B3B14A();
}

/** $B3B14A */
export function CODE_B3B14A(): void {
  despawnReturn();
}

/** $B3B14D — state 4: being calmed (after a stomp while flashing); resume walking. */
export function CODE_B3B14D(): void {
  const x = reg.y;
  reg.x = x;
  CODE_B3B179();
  reg.a = rd(x, sprite.animation_id);
  if (reg.a === C.kruncha_walk_anim_id) {
    reg.a = rd(x, 0x4a);
    if (bit14(rd(x, sprite.oam_property))) reg.a = neg(reg.a);
    CODE_B3B162();
    return;
  }
  CODE_B3B16B();
}

/** $B3B162 */
export function CODE_B3B162(): void {
  const x = reg.x;
  wr(x, 0x48, reg.a);
  wr(x, sprite.max_x_speed, reg.a);
  reg.a = 0x0001;
  wr(x, sprite.state, reg.a);
  CODE_B3B16B();
}

/** $B3B16B */
export function CODE_B3B16B(): void {
  CODE_B3B082();
}

/** $B3B16E — state 5: defeated. */
export function CODE_B3B16E(): void {
  process_current_movement();
  process_sprite_animation();
  make_sprite_fall_off_screen();
}

/** $B3B179 — palette flashing: every 4 frames alternate the palettes at constants +$0E/+$10. */
export function CODE_B3B179(): void {
  const x = reg.x;
  reg.a = rd(x, sprite.display_mode);
  if (reg.a === 0) return CODE_B3B193();
  reg.a = (reg.a - 1) & 0xffff;
  wr(x, sprite.display_mode, reg.a);
  if (reg.a & 0x0003) return CODE_B3B193();
  reg.y = ((reg.a & 0x0004) >> 1) + 0x000e;
  reg.a = spriteConst(reg.y);
  set_sprite_palette_direct_global();
  CODE_B3B193();
}

/** $B3B193 */
export function CODE_B3B193(): void {}

/**
 * $B3B194 — collisions. Carry set when something happened (defeated, angry or calmed),
 * clear when Kruncha just keeps walking.
 */
export function CODE_B3B194(): void {
  check_for_sprite_crush();
  if (!reg.c) return CODE_B3B1E2();
  reg.x = cur();
  reg.a = 0x0118;
  check_throwable_collision_global();
  if (reg.c) return CODE_B3B1C2();
  get_current_sprite_clipping();
  reg.a = 0x577b;
  reg.y = rd(reg.x, sprite.display_mode);
  if (reg.y !== 0) {
    reg.y = rd(reg.x, sprite.state);
    if (reg.y === 0x0002) return CODE_B3B1C0();
    reg.a = 0x4400; // while flashing he cannot be made angry again
  }
  CODE_B3B1B9();
}

/** $B3B1B9 */
export function CODE_B3B1B9(): void {
  CODE_BEBE8B();
  if (reg.c) return CODE_B3B1C2();
}

/** $B3B1C0 */
export function CODE_B3B1C0(): void {
  reg.c = false;
}

/** $B3B1C2 — A = collision result: 0 defeated, 1 calmed, 2+ angry. */
export function CODE_B3B1C2(): void {
  if (reg.a < 0x0001) return CODE_B3B1E2();
  if (reg.a === 0x0001) return CODE_B3B1CB();
  CODE_B3B219();
}

/** $B3B1CB */
export function CODE_B3B1CB(): void {
  const x = reg.x;
  reg.a = 0x001e;
  if (reg.a < rd(x, sprite.display_mode)) wr(x, sprite.display_mode, reg.a);
  CODE_B3B1D4();
}

/** $B3B1D4 */
export function CODE_B3B1D4(): void {
  wr(reg.x, sprite.state, 0x0004);
  reg.a = C.kruncha_calm_anim_id;
  set_sprite_animation();
  reg.c = true;
}

/** $B3B1E2 — defeated: knocked away from sprite Y (if any). */
export function CODE_B3B1E2(): void {
  const x = reg.x;
  reg.a = reg.y;
  if (reg.a !== 0) {
    reg.a = (((r16(reg.y + sprite.oam_property) ^ rd(x, sprite.oam_property)) & 0x4000) ^ rd(x, sprite.oam_property)) ^ 0x4000;
    wr(x, sprite.oam_property, reg.a);
  }
  CODE_B3B1F4();
}

/** $B3B1F4 */
export function CODE_B3B1F4(): void {
  const x = reg.x;
  reg.a = bit14(rd(x, sprite.oam_property)) ? 0x0100 : 0xff00;
  CODE_B3B1FE();
}

/** $B3B1FE */
export function CODE_B3B1FE(): void {
  const x = reg.x;
  wr(x, sprite.max_x_speed, reg.a);
  wr(x, sprite.x_speed, reg.a);
  wr(x, sprite.y_speed, 0xf800);
  wr(x, sprite.movement_state, 0x0004);
  reg.a = C.kruncha_death_anim_id;
  defeat_sprite_using_animation();
  wr(reg.x, sprite.state, 0x0005);
  reg.a = 0x0005;
  reg.c = true;
}

/** $B3B219 — get angry: knock the Kong back and turn to face it. */
export function CODE_B3B219(): void {
  reg.a = C.player_interaction_1E;
  reg.c = false;
  if (reg.a === r16(R.current_interaction)) {
    // already being knocked back: set a fixed knockback speed in its direction
    reg.a = isNeg(r16(R.interaction_RAM_0A86)) ? 0xfe00 : 0x0200;
    CODE_B3B22D();
    return;
  }
  CODE_B3B231();
}

/** $B3B22D */
export function CODE_B3B22D(): void {
  w16(R.interaction_RAM_0A86, reg.a);
  reg.c = true;
  CODE_B3B231();
}

/** $B3B231 — constants +$06 negative: face the walking direction; else face the attacker. */
export function CODE_B3B231(): void {
  const x = cur();
  reg.x = x;
  reg.y = 0x0006;
  reg.a = spriteConst(0x0006);
  if (!isNeg(reg.a)) return CODE_B3B248();
  reg.a = rd(x, sprite.max_x_speed) >> 1;
  reg.a = ((reg.a ^ rd(x, sprite.oam_property)) & 0x4000) ^ rd(x, sprite.oam_property);
  wr(x, sprite.oam_property, reg.a);
  CODE_B3B26B();
}

/** $B3B248 */
export function CODE_B3B248(): void {
  reg.y = r16(R.colliding_sprite);
  if (reg.c) return CODE_B3B253();
  reg.a = r16(R.interaction_RAM_0A86);
  if (!isNeg(reg.a)) return CODE_B3B260();
  CODE_B3B25A();
}

/** $B3B253 */
export function CODE_B3B253(): void {
  reg.a = rd(reg.x, sprite.x_position);
  if (reg.a < r16(reg.y + sprite.x_position)) return CODE_B3B260();
  CODE_B3B25A();
}

/** $B3B25A */
export function CODE_B3B25A(): void {
  if (bit14(rd(reg.x, sprite.oam_property))) return CODE_B3B26B();
  CODE_B3B264();
}

/** $B3B260 */
export function CODE_B3B260(): void {
  if (!bit14(rd(reg.x, sprite.oam_property))) return CODE_B3B26B();
  CODE_B3B264();
}

/** $B3B264 */
export function CODE_B3B264(): void {
  reg.a = rd(reg.x, sprite.oam_property) ^ 0x4000;
  wr(reg.x, sprite.oam_property, reg.a);
  CODE_B3B26B();
}

/** $B3B26B — angry: flash the palette for 60 frames. */
export function CODE_B3B26B(): void {
  const x = reg.x;
  wr(x, sprite.state, 0x0002);
  wr(x, sprite.display_mode, 0x003c);
  reg.y = 0x0010;
  reg.a = spriteConst(0x0010);
  set_sprite_palette_direct_global();
  reg.y = 0x0006;
  wr(x, sprite.unknown_28, spriteConst(0x0006));
  reg.a = C.kruncha_angry_anim_id;
  set_sprite_animation();
  reg.c = true;
}

/** $B3B28E — while turning (animation A), chase the Kong when it is more than unknown_28 away. */
export function CODE_B3B28E(): void {
  const x = reg.x;
  if (reg.a === rd(x, sprite.animation_id)) return CODE_B3B2B6();
  reg.a = rd(x, sprite.unknown_22);
  if (reg.a !== 0) {
    dec(x, sprite.unknown_22);
    return;
  }
  CODE_B3B299();
}

/** $B3B299 */
export function CODE_B3B299(): void {
  const x = reg.x;
  reg.y = r16(R.active_kong_sprite);
  reg.a = (r16(reg.y + sprite.x_position) - rd(x, sprite.x_position)) & 0xffff;
  const range = rd(x, sprite.unknown_28);
  if (reg.a < range) return CODE_B3B2BB();
  const sum = reg.a + range + 1; // ADC with carry set by the CMP
  reg.a = sum & 0xffff;
  if (sum > 0xffff) return CODE_B3B2BB();
  reg.a ^= rd(x, sprite.max_x_speed);
  if (!isNeg(reg.a)) return CODE_B3B2BB();
  reg.a = neg(rd(x, sprite.max_x_speed));
  wr(x, sprite.max_x_speed, reg.a);
  CODE_B3B2B6();
}

/** $B3B2B6 */
export function CODE_B3B2B6(): void {
  reg.a = 0x0014;
  wr(reg.x, sprite.unknown_22, reg.a);
  CODE_B3B2BB();
}

/** $B3B2BB */
export function CODE_B3B2BB(): void {}

/**
 * $B3B2BC — move A 1/32 of the way down towards Y. Carry set (and A = Y) once it got there or
 * A was already below Y.
 */
export function CODE_B3B2BC(): void {
  w16(R.temp_32, reg.y);
  const target = reg.y & 0xffff;
  if (reg.a < target) return CODE_B3B2DB();
  const diff = (reg.a - target) & 0xffff;
  w16(R.temp_34, diff);
  const step = diff >> 5;
  if (step === 0) return CODE_B3B2DB();
  reg.a = (diff - step + target) & 0xffff;
  if (reg.a === target) return CODE_B3B2DE();
  reg.c = false;
}

/** $B3B2DB */
export function CODE_B3B2DB(): void {
  reg.a = r16(R.temp_32);
  reg.c = true;
  CODE_B3B2DE();
}

/** $B3B2DE */
export function CODE_B3B2DE(): void {
  reg.c = true;
}

registerSprite({
  kruncha_main, CODE_B3B071, CODE_B3B07A, CODE_B3B082, CODE_B3B08F, CODE_B3B092, CODE_B3B09D,
  CODE_B3B0B5, CODE_B3B0CF, CODE_B3B0DC, CODE_B3B0E4, CODE_B3B0F9, CODE_B3B0FC, CODE_B3B116,
  CODE_B3B12E, CODE_B3B142, CODE_B3B14A, CODE_B3B14D, CODE_B3B162, CODE_B3B16B, CODE_B3B16E,
});
registerRts({
  CODE_B3B179, CODE_B3B193, CODE_B3B194, CODE_B3B1B9, CODE_B3B1C0, CODE_B3B1C2, CODE_B3B1CB,
  CODE_B3B1D4, CODE_B3B1E2, CODE_B3B1F4, CODE_B3B1FE, CODE_B3B219, CODE_B3B22D, CODE_B3B231,
  CODE_B3B248, CODE_B3B253, CODE_B3B25A, CODE_B3B260, CODE_B3B264, CODE_B3B26B, CODE_B3B28E,
  CODE_B3B299, CODE_B3B2B6, CODE_B3B2BB, CODE_B3B2BC, CODE_B3B2DB, CODE_B3B2DE,
});
