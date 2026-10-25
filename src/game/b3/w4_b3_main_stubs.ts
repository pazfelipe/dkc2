/**
 * Bank $B3 — the remaining one-line sprite mains of `sprite_main_table` (worlds 3-7, bosses,
 * credits). Each loads the sprite's index in another bank's main table into A and jumps to that
 * bank's sprite main handler, or jumps straight to the sprite code. The target leaves through
 * `JML [sprite_return_address]`, so it runs as a sprite tail.
 */
import { reg } from "../../core/cpu";
import { L } from "../../core/sym";
import { registerSprite, spriteTail } from "./b3c_common";

const BANK_B3_SPRITE_MAIN_HANDLER = L("bank_B3_sprite_main_handler");
const BANK_B6_SPRITE_MAIN_HANDLER_1 = L("bank_B6_sprite_main_handler_1");
const BANK_BA_SPRITE_MAIN_HANDLER_1 = L("bank_BA_sprite_main_handler_1");
const BANK_BA_SPRITE_MAIN_HANDLER_2 = L("bank_BA_sprite_main_handler_2");
const BANK_BE_SPRITE_MAIN_HANDLER = L("bank_BE_sprite_main_handler");
const CREDITS_DUMMY_SPRITE_CODE = L("credits_dummy_sprite_code");
const CREDITS_NPC_KONG_SPRITE_CODE = L("credits_npc_kong_sprite_code");

/** $B38668 */
export function kudgel_main() {
  reg.a = 0x0000;
  spriteTail(BANK_B6_SPRITE_MAIN_HANDLER_1);
}
/** $B3866F */
export function kudgels_club_main() {
  reg.a = 0x0002;
  spriteTail(BANK_B6_SPRITE_MAIN_HANDLER_1);
}
/** $B38676 */
export function krool_gun_main() {
  reg.a = 0x0004;
  spriteTail(BANK_B6_SPRITE_MAIN_HANDLER_1);
}
/** $B3867D */
export function shot_donkey_kong_main() {
  reg.a = 0x0006;
  spriteTail(BANK_B6_SPRITE_MAIN_HANDLER_1);
}
/** $B38684 */
export function krool_canball_main() {
  reg.a = 0x0008;
  spriteTail(BANK_B6_SPRITE_MAIN_HANDLER_1);
}
/** $B3868B */
export function spiked_canballs_main() {
  reg.a = 0x000A;
  spriteTail(BANK_B6_SPRITE_MAIN_HANDLER_1);
}
/** $B38692 */
export function krool_gun_fire_main() {
  reg.a = 0x000C;
  spriteTail(BANK_B6_SPRITE_MAIN_HANDLER_1);
}
/** $B38699 */
export function krool_gun_vacuum_effect_main() {
  reg.a = 0x000E;
  spriteTail(BANK_B6_SPRITE_MAIN_HANDLER_1);
}
/** $B386A0 */
export function krools_blinking_eyes_main() {
  reg.a = 0x0010;
  spriteTail(BANK_B6_SPRITE_MAIN_HANDLER_1);
}
/** $B386A7 */
export function krool_puddle_main() {
  reg.a = 0x0012;
  spriteTail(BANK_B6_SPRITE_MAIN_HANDLER_1);
}
/** $B386AE */
export function tied_up_donkey_spawner_main() {
  reg.a = 0x0014;
  spriteTail(BANK_B6_SPRITE_MAIN_HANDLER_1);
}
/** $B386B5 */
export function tied_up_donkey_kong_main() {
  reg.a = 0x0016;
  spriteTail(BANK_B6_SPRITE_MAIN_HANDLER_1);
}
/** $B386BC */
export function defeated_krool_main() {
  reg.a = 0x0018;
  spriteTail(BANK_B6_SPRITE_MAIN_HANDLER_1);
}
/** $B386C3 */
export function donkey_kongs_rope_main() {
  reg.a = 0x001A;
  spriteTail(BANK_B6_SPRITE_MAIN_HANDLER_1);
}
/** $B386CA */
export function donkey_kongs_bindings_main() {
  reg.a = 0x001C;
  spriteTail(BANK_B6_SPRITE_MAIN_HANDLER_1);
}
/** $B386E6 */
export function krool_main() {
  reg.a = 0x0024;
  spriteTail(BANK_B6_SPRITE_MAIN_HANDLER_1);
}
/** $B386ED */
export function kreepy_krow_sparkle_main() {
  reg.a = 0x0026;
  spriteTail(BANK_B6_SPRITE_MAIN_HANDLER_1);
}
/** $B38787 */
export function king_zing_main() {
  reg.a = 0x0000;
  spriteTail(BANK_BA_SPRITE_MAIN_HANDLER_1);
}
/** $B3878E */
export function king_zing_ring_zinger_main() {
  reg.a = 0x0002;
  spriteTail(BANK_BA_SPRITE_MAIN_HANDLER_1);
}
/** $B38795 */
export function king_zing_smoke_effect_main() {
  reg.a = 0x0004;
  spriteTail(BANK_BA_SPRITE_MAIN_HANDLER_1);
}
/** $B3879C */
export function king_zing_stinger_main() {
  reg.a = 0x0006;
  spriteTail(BANK_BA_SPRITE_MAIN_HANDLER_1);
}
/** $B387A3 */
export function king_zing_spikes_main() {
  reg.a = 0x0008;
  spriteTail(BANK_BA_SPRITE_MAIN_HANDLER_1);
}
/** $B387AA */
export function kreepy_krows_body_main() {
  reg.a = 0x000A;
  spriteTail(BANK_BA_SPRITE_MAIN_HANDLER_1);
}
/** $B387B1 */
export function kreepy_krows_eggs_main() {
  reg.a = 0x000C;
  spriteTail(BANK_BA_SPRITE_MAIN_HANDLER_1);
}
/** $B387B8 */
export function kreepy_krows_head_main() {
  reg.a = 0x000E;
  spriteTail(BANK_BA_SPRITE_MAIN_HANDLER_1);
}
/** $B387BF */
export function krool_water_drips_main() {
  reg.a = 0x0000;
  spriteTail(BANK_BA_SPRITE_MAIN_HANDLER_2);
}
/** $B387C6 */
export function krool_fish_main() {
  reg.a = 0x0002;
  spriteTail(BANK_BA_SPRITE_MAIN_HANDLER_2);
}
/** $B387CD */
export function kroc_kore_sparkle_spawner_main() {
  reg.a = 0x0004;
  spriteTail(BANK_BA_SPRITE_MAIN_HANDLER_2);
}
/** $B387F0 */
export function krocodile_kore_sparkle_main() {
  reg.a = 0x000E;
  spriteTail(BANK_BA_SPRITE_MAIN_HANDLER_2);
}
/** $B387FE */
export function vertical_wind_changer_main() {
  reg.a = 0x0002;
  spriteTail(BANK_B3_SPRITE_MAIN_HANDLER);
}
/** $B38805 */
export function horizontal_wind_changer_main() {
  reg.a = 0x0004;
  spriteTail(BANK_B3_SPRITE_MAIN_HANDLER);
}
/** $B38844 */
export function haunted_hall_door_main() {
  reg.a = 0x0000;
  spriteTail(BANK_BE_SPRITE_MAIN_HANDLER);
}
/** $B3884B */
export function gate_barrel_main() {
  reg.a = 0x0002;
  spriteTail(BANK_BE_SPRITE_MAIN_HANDLER);
}
/** $B38852 */
export function skull_cart_sparks_main() {
  reg.a = 0x0004;
  spriteTail(BANK_BE_SPRITE_MAIN_HANDLER);
}
/** $B38859 */
export function skull_cart_main() {
  reg.a = 0x0006;
  spriteTail(BANK_BE_SPRITE_MAIN_HANDLER);
}
/** $B38860 */
export function klank_main() {
  reg.a = 0x0008;
  spriteTail(BANK_BE_SPRITE_MAIN_HANDLER);
}
/** $B38867 */
export function kackle_main() {
  reg.a = 0x000A;
  spriteTail(BANK_BE_SPRITE_MAIN_HANDLER);
}
/** $B3886E */
export function haunted_hall_timer_handler_main() {
  reg.a = 0x000C;
  spriteTail(BANK_BE_SPRITE_MAIN_HANDLER);
}
/** $B38883 */
export function race_handler_main() {
  reg.a = 0x0012;
  spriteTail(BANK_BE_SPRITE_MAIN_HANDLER);
}
/** $B3888A */
export function racing_flag_main() {
  reg.a = 0x0014;
  spriteTail(BANK_BE_SPRITE_MAIN_HANDLER);
}
/** $B38891 */
export function chasing_king_zing_main() {
  reg.a = 0x0016;
  spriteTail(BANK_BE_SPRITE_MAIN_HANDLER);
}
/** $B38898 */
export function screech_main() {
  reg.a = 0x0018;
  spriteTail(BANK_BE_SPRITE_MAIN_HANDLER);
}
/** $B3889F */
export function giant_tire_main() {
  reg.a = 0x001A;
  spriteTail(BANK_BE_SPRITE_MAIN_HANDLER);
}
/** $B388BB */
export function double_zingers_main() {
  reg.a = 0x0022;
  spriteTail(BANK_BE_SPRITE_MAIN_HANDLER);
}
/** $B38906 */
export function credits_dummy_main() {
  spriteTail(CREDITS_DUMMY_SPRITE_CODE);
}
/** $B3890A */
export function credits_npc_kong_main() {
  spriteTail(CREDITS_NPC_KONG_SPRITE_CODE);
}

registerSprite({
  kudgel_main,
  kudgels_club_main,
  krool_gun_main,
  shot_donkey_kong_main,
  krool_canball_main,
  spiked_canballs_main,
  krool_gun_fire_main,
  krool_gun_vacuum_effect_main,
  krools_blinking_eyes_main,
  krool_puddle_main,
  tied_up_donkey_spawner_main,
  tied_up_donkey_kong_main,
  defeated_krool_main,
  donkey_kongs_rope_main,
  donkey_kongs_bindings_main,
  krool_main,
  kreepy_krow_sparkle_main,
  king_zing_main,
  king_zing_ring_zinger_main,
  king_zing_smoke_effect_main,
  king_zing_stinger_main,
  king_zing_spikes_main,
  kreepy_krows_body_main,
  kreepy_krows_eggs_main,
  kreepy_krows_head_main,
  krool_water_drips_main,
  krool_fish_main,
  kroc_kore_sparkle_spawner_main,
  krocodile_kore_sparkle_main,
  vertical_wind_changer_main,
  horizontal_wind_changer_main,
  haunted_hall_door_main,
  gate_barrel_main,
  skull_cart_sparks_main,
  skull_cart_main,
  klank_main,
  kackle_main,
  haunted_hall_timer_handler_main,
  race_handler_main,
  racing_flag_main,
  chasing_king_zing_main,
  screech_main,
  giant_tire_main,
  double_zingers_main,
  credits_dummy_main,
  credits_npc_kong_main,
});
