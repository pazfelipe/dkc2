/**
 * Bank $B3 — helpers shared by the enemy mains of package B3b: contact-flash positioning,
 * castle crush floor check, held-sprite positioning, defeating a sprite, falling off screen
 * (with the water splash some levels show), and keeping aquatic sprites under the water line.
 */
import { r16, w16, rom16, io8, ioR16 } from "../../core/mem";
import { reg } from "../../core/cpu";
import { runOriginal, KIND_JSR } from "../../core/hybrid";
import { L, R, C, CPU, sprite, level, sprite_palette_dma } from "../../core/sym";
import {
  check_throwable_collision_global, check_if_sprite_offscreen_global, CODE_BBBD6B,
  delete_sprite_handle_deallocation, queue_sound_effect, set_player_interaction_global,
  update_held_sprite_position, set_sprite_animation, get_current_sprite_clipping, CODE_BCFEE0,
  spawn_special_sprite_index, process_sprite_animation, process_current_movement,
  get_sprite_position_in_level_data,
} from "../../gen/routines";
import { cur, rd, wr, neg, isNeg, bit14, despawnReturn, registerRts, registerRtl, registerSprite } from "./b3b_common";

/** `%lda_sound(channel, name)` */
export const sound = (channel: number, name: string) =>
  ((channel << 8) | (C as Record<string, number>)["sound_" + name]) & 0xffff;

const KONG_STATE_FLAGS = L("kong_state_flags_table");
const DATA_FF0224 = L("DATA_FF0224") & 0xffff;

// --- contact flash between two clipping boxes ($D9..$E7: left/top/right/bottom of two boxes) ---

/** $B3A334 */
export function CODE_B3A334(): void {
  CODE_B3A338();
}

/** $B3A338 — contact flash X = middle of the overlap of the two boxes, then Y likewise. */
export function CODE_B3A338(): void {
  if (r16(0xd9) >= r16(0xe1)) {
    reg.a = r16(0xd9);
    return CODE_B3A344();
  }
  reg.a = (r16(0xdd) + r16(0xe1)) & 0xffff;
  CODE_B3A347();
}

/** $B3A344 */
export function CODE_B3A344(): void {
  reg.a = (reg.a + r16(0xe5)) & 0xffff;
  CODE_B3A347();
}

/** $B3A347 */
export function CODE_B3A347(): void {
  w16(R.contact_flash_x_position, reg.a >> 1);
  if (r16(0xdb) >= r16(0xe3)) {
    reg.a = r16(0xdb);
    return CODE_B3A357();
  }
  reg.a = (r16(0xdf) + r16(0xe3)) & 0xffff;
  CODE_B3A35A();
}

/** $B3A357 */
export function CODE_B3A357(): void {
  reg.a = (reg.a + r16(0xe7)) & 0xffff;
  CODE_B3A35A();
}

/** $B3A35A */
export function CODE_B3A35A(): void {
  reg.a >>= 1;
  w16(R.contact_flash_y_position, reg.a);
}

/** $B3A364 */
export function CODE_B3A364(): void {
  check_throwable_collision_global();
}

/** $B3A3A3 — carry clear when the castle crush floor exists and is crushing the sprite. */
export function check_for_sprite_crush(): void {
  reg.c = true;
  if (isNeg(r16(0x0d54))) return;
  reg.x = cur();
  reg.a = rd(reg.x, sprite.terrain_attributes);
  if (!(reg.a & 0x0100)) return;
  reg.c = false;
}

/** $B3A3B4 — queue a palette upload: source = A:X, into the next of 16 buffer slots. */
export function CODE_B3A3B4(): void {
  w16(R.temp_5E, reg.a);
  const slot = r16(R.current_palette_buffer_slot);
  reg.y = (slot << 2) & 0xffff;
  w16(sprite_palette_dma.source_word + reg.y, reg.x);
  w16(sprite_palette_dma.source_bank + reg.y, r16(R.temp_5E));
  reg.a = (slot + 1) & 0x000f;
  w16(R.current_palette_buffer_slot, reg.a);
}

/** $B3A3CD — carry clear if the active Kong's state has flag bit 0 (and game flag $4000 is off). */
export function CODE_B3A3CD(): void {
  if (r16(R.game_state_flags) & 0x4000) return CODE_B3A3E9();
  reg.y = r16(R.active_kong_sprite);
  reg.x = (rd(reg.y, sprite.state) << 2) & 0xffff;
  reg.a = rom16(KONG_STATE_FLAGS + reg.x) & 0x0001;
  if (reg.a === 0) return CODE_B3A3E9();
  reg.c = false;
}

/** $B3A3E9 */
export function CODE_B3A3E9(): void {
  reg.c = true;
}

/** $B3A3EB — delete the sprite (as defeated) once it is off screen; carry set if deleted. */
export function CODE_B3A3EB(): void {
  check_if_sprite_offscreen_global();
  if (reg.c) CODE_B3A3F2();
}

/** $B3A3F2 */
export function CODE_B3A3F2(): void {
  CODE_BBBD6B();
  delete_sprite_handle_deallocation();
  reg.c = true;
}

/** $B3A3FC */
export function queue_sfx_if_on_screen_global(): void {
  queue_sfx_if_on_screen();
}

/** $B3A400 — queue sound A only if the current sprite is on screen (A, X, Y preserved). */
export function queue_sfx_if_on_screen(): void {
  const { a, x, y } = reg;
  check_if_sprite_offscreen_global();
  reg.a = a;
  if (!reg.c) queue_sound_effect();
  reg.x = x;
  reg.y = y;
}

// --- held sprites ---

/** .copy_kong_facing_to_held_sprite: a held sprite faces the same way as the active Kong. */
function copyKongFacingToHeldSprite(): void {
  const y = cur();
  reg.y = y;
  if (y !== r16(R.current_held_sprite)) return;
  const kong = r16(R.active_kong_sprite);
  reg.x = kong;
  reg.a = (rd(y, sprite.oam_property) & 0xbfff) | (rd(kong, sprite.oam_property) & 0x4000);
  wr(y, sprite.oam_property, reg.a);
}

/** .update_held_position_if_held */
function updateHeldPositionIfHeld(): void {
  reg.x = cur();
  if (reg.x === r16(R.current_held_sprite)) update_held_sprite_position();
}

/** $B3A5B9 */
export function update_held_position_no_return(): void {
  copyKongFacingToHeldSprite();
  updateHeldPositionIfHeld();
}

/** $B3A5DA */
export function update_held_position_return_1(): void {
  copyKongFacingToHeldSprite();
  updateHeldPositionIfHeld();
}

/** $B3A5E1 */
export function update_held_position_return_2(): void {
  copyKongFacingToHeldSprite();
  updateHeldPositionIfHeld();
}

/** $B3A5E8 — target X speed A, in the direction the sprite is already moving. */
export function apply_thrown_x_velocity(): void {
  const x = cur();
  reg.x = x;
  if (isNeg(rd(x, sprite.max_x_speed))) reg.a = neg(reg.a);
  wr(x, sprite.max_x_speed, reg.a);
}

/** $B3A600 */
export function CODE_B3A600(): void {
  CODE_B3A604();
}

/**
 * $B3A604 — set player interaction A (unless already active), then store Y as its X speed,
 * mirrored when the colliding sprite faces left. Carry clear on success.
 */
export function CODE_B3A604(): void {
  if (reg.a !== r16(R.current_interaction)) {
    const y = reg.y;
    set_player_interaction_global();
    reg.y = y;
    if (reg.c) return;
  }
  reg.a = reg.y;
  if (bit14(rd(r16(R.colliding_sprite), sprite.oam_property))) reg.a = neg(reg.a);
  w16(R.interaction_RAM_0A86, reg.a);
  reg.c = false;
}

// --- defeat ---

/** $B3A623 */
export function defeat_sprite_using_anim_global(): void {
  defeat_sprite_using_animation();
}

/** $B3A627 — play defeat animation A, mark the sprite defeated and draw it in front. */
export function defeat_sprite_using_animation(): void {
  set_sprite_animation();
  w16(0x19ba, r16(0x19ba) + 1);
  CODE_BBBD6B();
  const x = cur();
  reg.x = x;
  wr(x, sprite.placement_number, 0);
  wr(x, sprite.placement_parameter, 0x000f); // spawn parameter $0F: dead
  if (!(r16(level.effects) & C.defeated_sprite_priority_effect)) {
    wr(x, sprite.oam_property, rd(x, sprite.oam_property) | 0x3000);
  }
  reg.a = 0x00f4;
  wr(x, sprite.render_order, reg.a);
  wr(x, sprite.interaction_flags, 0);
}

/** $B3A652 — a defeated sprite falls; once off screen it is deleted (with a splash in water levels). */
export function make_sprite_fall_off_screen(): void {
  const x = cur();
  reg.x = x;
  wr(x, sprite.constants_address, DATA_FF0224);
  check_if_sprite_offscreen_global();
  if (!reg.c) return;
  if (!(r16(level.effects) & C.offscreen_water_splash_effect)) {
    delete_sprite_handle_deallocation();
    return;
  }
  get_current_sprite_clipping();
  CODE_BCFEE0();
  const h = (r16(0xdf) - r16(0xdb)) & 0xffff;
  reg.a = ((h << 1) | (h >= 0x0020 ? 1 : 0)) & 0xffff; // CMP #$0020 : ROL A
  w16(R.contact_flash_y_position, reg.a);
  reg.x = cur();
  w16(R.contact_flash_x_position, rd(reg.x, sprite.x_position));
  delete_sprite_handle_deallocation();
  CODE_B3A6DC();
}

// --- water splash ---

/** $B3A693 — the splash left by a sprite that fell into the water. */
export function ship_water_splash_main(): void {
  const x = cur();
  reg.x = x;
  const screenX = (rd(x, sprite.x_position) - r16(R.screen_scroll_x_position) + 0x0020) & 0xffff;
  if (screenX >= 0x0140) return CODE_B3A6C4();
  if (rd(x, 0x42) !== 0) {
    wr(x, 0x42, rd(x, 0x42) - 1);
    return;
  }
  CODE_B3A6AD();
}

/** $B3A6AD */
export function CODE_B3A6AD(): void {
  reg.a = (r16(0x0adb) + rd(reg.x, 0x44)) & 0xffff;
  if (reg.a >= 0x0300) reg.a = 0x0300;
  CODE_B3A6BB();
}

/** $B3A6BB */
export function CODE_B3A6BB(): void {
  wr(reg.x, sprite.y_position, reg.a);
  process_sprite_animation();
}

/** $B3A6C4 — off screen: play the splash sound (if $46 >= 0) and delete. */
export function CODE_B3A6C4(): void {
  reg.a = rd(reg.x, 0x46);
  if (isNeg(reg.a)) return CODE_B3A6D5();
  reg.a = reg.a & 1 ? sound(5, "splash_2") : sound(5, "splash_1");
  CODE_B3A6D1();
}

/** $B3A6D1 */
export function CODE_B3A6D1(): void {
  queue_sound_effect();
  CODE_B3A6D5();
}

/** $B3A6D5 */
export function CODE_B3A6D5(): void {
  delete_sprite_handle_deallocation();
}

/** $B3A6DC — spawn a splash at the contact flash position (or just play the sound). */
export function CODE_B3A6DC(): void {
  const screenX = (r16(R.contact_flash_x_position) - r16(R.screen_scroll_x_position) + 0x0020) & 0xffff;
  reg.a = sound(5, "splash_1");
  if (screenX >= 0x0140) return CODE_B3A734();
  reg.y = r16(R.current_song);
  reg.a = sound(7, "splash_1_copy");
  if (reg.y === C.music_swamp) return CODE_B3A734();
  reg.y = 0x004c;
  reg.a = r16(level.tileset_type);
  if (reg.a !== C.ship_deck_layout_id) reg.y = C.special_sprite_spawn_id_000C; // lava/water splash
  CODE_B3A707();
}

/** $B3A707 */
export function CODE_B3A707(): void {
  spawn_special_sprite_index();
  reg.x = r16(R.alternate_sprite);
  reg.a = (0x0220 - r16(R.screen_scroll_y_position)) & 0xffff;
  if (isNeg(reg.a)) reg.a = 0;
  CODE_B3A719();
}

/** $B3A719 — splash timing from the distance to the bottom of the screen. */
export function CODE_B3A719(): void {
  const x = reg.x;
  const d = reg.a >> 3;
  wr(x, 0x42, d);
  const sum = (d >> 1) + d + (d & 1); // LSR A : ADC $42,x (carry = bit shifted out)
  reg.a = sum & 0xffff;
  reg.c = false;
  if (reg.a >= 0x0030) {
    reg.a = 0x002f;
    reg.c = true;
  }
  CODE_B3A729();
}

/** $B3A729 */
export function CODE_B3A729(): void {
  reg.a = (reg.a + 0x00e0 + (reg.c ? 1 : 0)) & 0xffff;
  wr(reg.x, 0x44, reg.a);
  reg.a = r16(R.contact_flash_y_position);
  wr(reg.x, 0x46, reg.a);
}

/** $B3A734 */
export function CODE_B3A734(): void {
  queue_sound_effect();
}

/** $B3AA58 — set state A and animation Y, then leave. */
export function set_state_and_animation(): void {
  const x = cur();
  reg.x = x;
  wr(x, sprite.state, reg.a);
  reg.a = reg.y;
  set_sprite_animation();
  despawnReturn();
}

/** $B3AA64 — defeat Click-Clack: X speed A (away from the attacker), Y speed Y. */
export function defeat_click_clack_with_velocity(): void {
  reg.x = r16(R.colliding_sprite);
  if (bit14(rd(reg.x, sprite.oam_property))) reg.a = neg(reg.a);
  defeat_click_clack_no_flip_velocity();
}

/** $B3AA6E */
export function defeat_click_clack_no_flip_velocity(): void {
  const x = cur();
  reg.x = x;
  wr(x, sprite.max_x_speed, reg.a);
  wr(x, sprite.x_speed, 0);
  wr(x, sprite.y_speed, reg.y);
  wr(x, sprite.movement_state, 0x0004);
  wr(x, sprite.interaction_flags, 0);
  wr(x, sprite.state, 0x0008);
  reg.a = C.click_clack_stunned_air_anim_id;
  defeat_sprite_using_animation();
  reg.a = sound(5, "click_clack_hit");
  queue_sound_effect();
  despawnReturn();
}

/** $B3B03B — large smoke puff: move and animate. */
export function large_smoke_puff_timestop_main(): void {
  const y = cur();
  reg.y = y;
  w16(R.current_sprite_constants, rd(y, sprite.constants_address));
  process_current_movement();
  process_sprite_animation();
}

/** $B3B2DF — A = (A & $FF) * (Y & $FF) with the hardware multiplier (Y's high byte is lost). */
export function multiply_a_by_y(): void {
  io8(CPU.multiply_A, reg.a & 0xff);
  io8(CPU.multiply_B, reg.y & 0xff);
  reg.y &= 0xff; // SEP #$10 clears the index high bytes; X is restored by PLX
  reg.a = ioR16(CPU.multiply_result);
}

// --- distance checks against the active Kong (carry set = out of range) ---

/** $B3AFD7 — carry clear if the Kong is within X px horizontally and Y px vertically. */
export function CODE_B3AFD7(): void {
  w16(R.temp_5E, reg.x);
  w16(R.temp_60, reg.y);
  reg.x = cur();
  reg.y = r16(R.active_kong_sprite);
  const sx = rd(reg.x, sprite.x_position);
  const kx = rd(reg.y, sprite.x_position);
  reg.a = (sx - kx) & 0xffff;
  if (sx >= kx) return CODE_B3AFEE();
  const sum = reg.a + r16(R.temp_5E);
  reg.a = sum & 0xffff;
  if (sum <= 0xffff) return CODE_B3B005();
  CODE_B3AFF2();
}

/** $B3AFEE */
export function CODE_B3AFEE(): void {
  if (reg.a >= r16(R.temp_5E)) return CODE_B3B005();
  CODE_B3AFF2();
}

/** $B3AFF2 */
export function CODE_B3AFF2(): void {
  const sy = rd(reg.x, sprite.y_position);
  const ky = rd(reg.y, sprite.y_position);
  reg.a = (sy - ky) & 0xffff;
  if (sy >= ky) return CODE_B3B000();
  const sum = reg.a + r16(R.temp_5E); // (the original adds the X range here too)
  reg.a = sum & 0xffff;
  if (sum <= 0xffff) return CODE_B3B005();
  CODE_B3B003();
}

/** $B3B000 */
export function CODE_B3B000(): void {
  reg.c = reg.a >= r16(R.temp_60);
}

/** $B3B003 */
export function CODE_B3B003(): void {
  reg.c = false;
}

/** $B3B005 */
export function CODE_B3B005(): void {
  reg.c = true;
}

/** $B3B007 — carry clear if the Kong is within A px horizontally. */
export function CODE_B3B007(): void {
  reg.x = cur();
  reg.y = r16(R.active_kong_sprite);
  w16(R.temp_5E, reg.a);
  const sx = rd(reg.x, sprite.x_position);
  const kx = rd(reg.y, sprite.x_position);
  reg.a = (sx - kx) & 0xffff;
  if (sx >= kx) return CODE_B3B01C();
  const sum = reg.a + r16(R.temp_5E);
  reg.a = sum & 0xffff;
  if (sum <= 0xffff) return CODE_B3B01F();
  reg.c = false;
}

/** $B3B01C */
export function CODE_B3B01C(): void {
  reg.c = reg.a >= r16(R.temp_5E);
}

/** $B3B01F */
export function CODE_B3B01F(): void {
  reg.c = true;
}

/** $B3B021 — carry clear if the Kong is within A px vertically. */
export function CODE_B3B021(): void {
  reg.x = cur();
  reg.y = r16(R.active_kong_sprite);
  w16(R.temp_5E, reg.a);
  const sy = rd(reg.x, sprite.y_position);
  const ky = rd(reg.y, sprite.y_position);
  reg.a = (sy - ky) & 0xffff;
  if (sy >= ky) return CODE_B3B036();
  const sum = reg.a + r16(R.temp_5E);
  reg.a = sum & 0xffff;
  if (sum <= 0xffff) return CODE_B3B039();
  reg.c = false;
}

/** $B3B036 */
export function CODE_B3B036(): void {
  reg.c = reg.a >= r16(R.temp_5E);
}

/** $B3B039 */
export function CODE_B3B039(): void {
  reg.c = true;
}

// --- water ---

/**
 * $B3B887 — keep an aquatic sprite (and its home position $44) under the water surface:
 * the home is kept at least 24 px below the surface, the sprite at least 20 px below.
 */
export function force_sprite_submerged(): void {
  let x = cur();
  reg.x = x;
  const limit = (r16(R.water_y_position) + 0x0018) & 0xffff;
  w16(R.temp_32, limit);
  if (limit < rd(x, 0x44)) {
    // .home_submerged: the home must also stay below the spawn position
    get_sprite_position_in_level_data();
    x = reg.x;
    let a = r16(R.temp_32);
    if (a < r16(0x74)) a = r16(0x74);
    if (a < rd(x, 0x44)) wr(x, 0x44, a);
  } else {
    const oldHome = rd(x, 0x44);
    reg.y = oldHome;
    wr(x, 0x44, limit);
    if (limit >= rd(x, sprite.y_position)) {
      // move the sprite up by as much as the home moved down
      wr(x, sprite.y_position, rd(x, sprite.y_position) - ((oldHome - limit) & 0xffff));
    }
  }
  // .sprite_submerged
  reg.a = (r16(R.water_y_position) + 0x0014) & 0xffff;
  if (reg.a >= rd(x, sprite.y_position)) wr(x, sprite.y_position, reg.a);
}

/** $B3B8CB — animate; under water the animation runs at half speed. */
export function process_animation_handle_submerged(): void {
  const water = r16(R.water_y_position);
  reg.a = water;
  if (isNeg(water)) {
    process_sprite_animation();
    return;
  }
  const x = cur();
  reg.x = x;
  reg.a = (water + 0x0010) & 0xffff;
  if (reg.a >= rd(x, sprite.y_position)) {
    process_sprite_animation();
    return;
  }
  wr(x, sprite.animation_speed, rd(x, sprite.animation_speed) >> 1);
  const halved = rd(x, sprite.animation_speed);
  process_sprite_animation();
  reg.a = halved;
  // unless the animation set a new speed, restore the normal one
  if (halved === rd(reg.x, sprite.animation_speed)) {
    wr(reg.x, sprite.animation_speed, rd(reg.x, sprite.animation_speed) << 1);
  }
}

/** JSR to `CODE_B3F265+1` (a glitch in sprite $00A8's code: jumps into the middle of an instruction). */
export function glitchJsrB3F266(): void {
  runOriginal(0xb3f266, KIND_JSR, reg.db, 0, 0);
}

registerRtl({ CODE_B3A334, CODE_B3A3B4, queue_sfx_if_on_screen_global, CODE_B3A600, defeat_sprite_using_anim_global });
registerRts({
  CODE_B3A338, CODE_B3A344, CODE_B3A347, CODE_B3A357, CODE_B3A35A, CODE_B3A364,
  check_for_sprite_crush, CODE_B3A3CD, CODE_B3A3E9, CODE_B3A3EB, CODE_B3A3F2, queue_sfx_if_on_screen,
  update_held_position_no_return, update_held_position_return_1, update_held_position_return_2,
  apply_thrown_x_velocity, CODE_B3A604, defeat_sprite_using_animation, CODE_B3A6DC, CODE_B3A707,
  CODE_B3A719, CODE_B3A729, CODE_B3A734, multiply_a_by_y, CODE_B3AFD7, CODE_B3AFEE, CODE_B3AFF2,
  CODE_B3B000, CODE_B3B003, CODE_B3B005, CODE_B3B007, CODE_B3B01C, CODE_B3B01F, CODE_B3B021,
  CODE_B3B036, CODE_B3B039, force_sprite_submerged, process_animation_handle_submerged,
});
registerSprite({
  make_sprite_fall_off_screen, ship_water_splash_main, CODE_B3A6AD, CODE_B3A6BB, CODE_B3A6C4,
  CODE_B3A6D1, CODE_B3A6D5, set_state_and_animation, defeat_click_clack_with_velocity,
  defeat_click_clack_no_flip_velocity, large_smoke_puff_timestop_main,
  large_smoke_puff_main: large_smoke_puff_timestop_main,
});
