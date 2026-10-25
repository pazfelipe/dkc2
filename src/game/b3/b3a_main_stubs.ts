/**
 * Bank $B3 — the one-line sprite mains of `sprite_main_table`.
 *
 * Most sprite types keep their code in another bank. Their entry in the table points at a
 * two-instruction stub here that loads the sprite's index in that bank's own main table into A
 * and jumps to the bank's sprite main handler (`JML bank_XX_sprite_main_handler`), or jumps
 * straight to the sprite code (`JML xxx_sprite_code`). The target leaves through
 * `JML [sprite_return_address]`, so it is run as a sprite tail.
 * (Generated from the disassembly listing; the world 3-7 / boss / credits entries are not ported.)
 */
import { reg } from "../../core/cpu";
import { L } from "../../core/sym";
import { registerSprite, spriteTail } from "./b3a_common";

const BANK_B3_SPRITE_MAIN_HANDLER = L("bank_B3_sprite_main_handler");
const BANK_B6_SPRITE_MAIN_HANDLER_1 = L("bank_B6_sprite_main_handler_1");
const BANK_B6_SPRITE_MAIN_HANDLER_2 = L("bank_B6_sprite_main_handler_2");
const BANK_BA_SPRITE_MAIN_HANDLER_2 = L("bank_BA_sprite_main_handler_2");
const BANK_BE_SPRITE_MAIN_HANDLER = L("bank_BE_sprite_main_handler");
const DIDDY_KONG_SPRITE_CODE = L("diddy_kong_sprite_code");
const DIXIE_KONG_SPRITE_CODE = L("dixie_kong_sprite_code");
const RESPAWN_SUPPRESSOR_SPRITE_CODE = L("respawn_suppressor_sprite_code");

/** $B386D1 */
export function lava_splash_main() {
  reg.a = 0x001E;
  spriteTail(BANK_B6_SPRITE_MAIN_HANDLER_1);
}
/** $B386D8 */
export function klubba_main() {
  reg.a = 0x0020;
  spriteTail(BANK_B6_SPRITE_MAIN_HANDLER_1);
}
/** $B386DF */
export function klubbas_club_main() {
  reg.a = 0x0022;
  spriteTail(BANK_B6_SPRITE_MAIN_HANDLER_1);
}
/** $B386F4 */
export function kleever_main() {
  reg.a = 0x0000;
  spriteTail(BANK_B6_SPRITE_MAIN_HANDLER_2);
}
/** $B386FB */
export function kleever_fireball_main() {
  reg.a = 0x0002;
  spriteTail(BANK_B6_SPRITE_MAIN_HANDLER_2);
}
/** $B38702 */
export function kleever_dropping_hooks_main() {
  reg.a = 0x0004;
  spriteTail(BANK_B6_SPRITE_MAIN_HANDLER_2);
}
/** $B38709 */
export function kleever_canball_main() {
  reg.a = 0x0006;
  spriteTail(BANK_B6_SPRITE_MAIN_HANDLER_2);
}
/** $B38710 */
export function kleever_hand_bubbles_main() {
  reg.a = 0x0008;
  spriteTail(BANK_B6_SPRITE_MAIN_HANDLER_2);
}
/** $B38717 */
export function kleever_hand_main() {
  reg.a = 0x000A;
  spriteTail(BANK_B6_SPRITE_MAIN_HANDLER_2);
}
/** $B3871E */
export function kleever_falling_canball_main() {
  reg.a = 0x000C;
  spriteTail(BANK_B6_SPRITE_MAIN_HANDLER_2);
}
/** $B38725 */
export function kleever_attack_effect_main() {
  reg.a = 0x000E;
  spriteTail(BANK_B6_SPRITE_MAIN_HANDLER_2);
}
/** $B3872C */
export function kleever_broken_hilt_main() {
  reg.a = 0x0010;
  spriteTail(BANK_B6_SPRITE_MAIN_HANDLER_2);
}
/** $B38733 */
export function kleever_broken_fire_main() {
  reg.a = 0x0012;
  spriteTail(BANK_B6_SPRITE_MAIN_HANDLER_2);
}
/** $B3873A */
export function kleever_bone_pieces_main() {
  reg.a = 0x0014;
  spriteTail(BANK_B6_SPRITE_MAIN_HANDLER_2);
}
/** $B38741 */
export function unknown_sprite_0030_main() {
  reg.a = 0x0016;
  spriteTail(BANK_B6_SPRITE_MAIN_HANDLER_2);
}
/** $B38748 */
export function kleever_pieces1_main() {
  reg.a = 0x0018;
  spriteTail(BANK_B6_SPRITE_MAIN_HANDLER_2);
}
/** $B3874F */
export function kleever_pieces2_main() {
  reg.a = 0x001A;
  spriteTail(BANK_B6_SPRITE_MAIN_HANDLER_2);
}
/** $B38756 */
export function kleever_pieces3_main() {
  reg.a = 0x001C;
  spriteTail(BANK_B6_SPRITE_MAIN_HANDLER_2);
}
/** $B3875D */
export function unknown_sprite_0040_main() {
  reg.a = 0x001E;
  spriteTail(BANK_B6_SPRITE_MAIN_HANDLER_2);
}
/** $B38764 */
export function kleever_pieces4_main() {
  reg.a = 0x0020;
  spriteTail(BANK_B6_SPRITE_MAIN_HANDLER_2);
}
/** $B3876B */
export function kleever_pieces5_main() {
  reg.a = 0x0022;
  spriteTail(BANK_B6_SPRITE_MAIN_HANDLER_2);
}
/** $B38772 */
export function krows_egg_main() {
  reg.a = 0x0024;
  spriteTail(BANK_B6_SPRITE_MAIN_HANDLER_2);
}
/** $B38779 */
export function krows_body_main() {
  reg.a = 0x0026;
  spriteTail(BANK_B6_SPRITE_MAIN_HANDLER_2);
}
/** $B38780 */
export function krows_head_main() {
  reg.a = 0x0028;
  spriteTail(BANK_B6_SPRITE_MAIN_HANDLER_2);
}
/** $B387D4 */
export function scroll_and_float_barrel_main() {
  reg.a = 0x0006;
  spriteTail(BANK_BA_SPRITE_MAIN_HANDLER_2);
}
/** $B387DB */
export function kong_npc_main() {
  reg.a = 0x0008;
  spriteTail(BANK_BA_SPRITE_MAIN_HANDLER_2);
}
/** $B387E2 */
export function sparkle_spawner_main() {
  reg.a = 0x000A;
  spriteTail(BANK_BA_SPRITE_MAIN_HANDLER_2);
}
/** $B387E9 */
export function sparkle_main() {
  reg.a = 0x000C;
  spriteTail(BANK_BA_SPRITE_MAIN_HANDLER_2);
}
/** $B387F7 */
export function clapper_main() {
  reg.a = 0x0000;
  spriteTail(BANK_B3_SPRITE_MAIN_HANDLER);
}
/** $B3880C */
export function timer_main() {
  reg.a = 0x0006;
  spriteTail(BANK_B3_SPRITE_MAIN_HANDLER);
}
/** $B38813 */
export function breakable_wall_main() {
  reg.a = 0x0008;
  spriteTail(BANK_B3_SPRITE_MAIN_HANDLER);
}
/** $B3881A */
export function exit_door_main() {
  reg.a = 0x000A;
  spriteTail(BANK_B3_SPRITE_MAIN_HANDLER);
}
/** $B38821 */
export function unknown_sprite_0070_main() {
  reg.a = 0x000C;
  spriteTail(BANK_B3_SPRITE_MAIN_HANDLER);
}
/** $B38828 */
export function checkpoint_barrel_main() {
  reg.a = 0x000E;
  spriteTail(BANK_B3_SPRITE_MAIN_HANDLER);
}
/** $B3882F */
export function cannon_main() {
  reg.a = 0x0010;
  spriteTail(BANK_B3_SPRITE_MAIN_HANDLER);
}
/** $B38836 */
export function barrel_icons_main() {
  reg.a = 0x0012;
  spriteTail(BANK_B3_SPRITE_MAIN_HANDLER);
}
/** $B3883D */
export function barrel_cannon_main() {
  reg.a = 0x0014;
  spriteTail(BANK_B3_SPRITE_MAIN_HANDLER);
}
/** $B38875 */
export function coins_main() {
  reg.a = 0x000E;
  spriteTail(BANK_BE_SPRITE_MAIN_HANDLER);
}
/** $B3887C */
export function kong_letter_main() {
  reg.a = 0x0010;
  spriteTail(BANK_BE_SPRITE_MAIN_HANDLER);
}
/** $B388A6 */
export function camera_unlock_trigger_main() {
  reg.a = 0x001C;
  spriteTail(BANK_BE_SPRITE_MAIN_HANDLER);
}
/** $B388AD */
export function chest_spawner_main() {
  reg.a = 0x001E;
  spriteTail(BANK_BE_SPRITE_MAIN_HANDLER);
}
/** $B388B4 */
export function kremcoin_cheat_handler_main() {
  reg.a = 0x0020;
  spriteTail(BANK_BE_SPRITE_MAIN_HANDLER);
}
/** $B388C2 */
export function respawn_suppressor_main() {
  spriteTail(RESPAWN_SUPPRESSOR_SPRITE_CODE);
}
/** $B388C6 */
export function dixie_kong_main() {
  spriteTail(DIXIE_KONG_SPRITE_CODE);
}
/** $B388CA */
export function diddy_kong_main() {
  spriteTail(DIDDY_KONG_SPRITE_CODE);
}

registerSprite({
  lava_splash_main,
  klubba_main,
  klubbas_club_main,
  kleever_main,
  kleever_fireball_main,
  kleever_dropping_hooks_main,
  kleever_canball_main,
  kleever_hand_bubbles_main,
  kleever_hand_main,
  kleever_falling_canball_main,
  kleever_attack_effect_main,
  kleever_broken_hilt_main,
  kleever_broken_fire_main,
  kleever_bone_pieces_main,
  unknown_sprite_0030_main,
  kleever_pieces1_main,
  kleever_pieces2_main,
  kleever_pieces3_main,
  unknown_sprite_0040_main,
  kleever_pieces4_main,
  kleever_pieces5_main,
  krows_egg_main,
  krows_body_main,
  krows_head_main,
  scroll_and_float_barrel_main,
  kong_npc_main,
  sparkle_spawner_main,
  sparkle_main,
  clapper_main,
  timer_main,
  breakable_wall_main,
  exit_door_main,
  unknown_sprite_0070_main,
  checkpoint_barrel_main,
  cannon_main,
  barrel_icons_main,
  barrel_cannon_main,
  coins_main,
  kong_letter_main,
  camera_unlock_trigger_main,
  chest_spawner_main,
  kremcoin_cheat_handler_main,
  respawn_suppressor_main,
  dixie_kong_main,
  diddy_kong_main,
});
