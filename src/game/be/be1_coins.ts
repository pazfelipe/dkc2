/**
 * Bank $BE — sprite main handler of the bank and the coin sprites ($BEB800-$BEBA98).
 *
 * The bank's sprite mains in $B3 put an index in A and jump to `bank_BE_sprite_main_handler`,
 * which dispatches through its table (haunted hall door, gate barrel, skull cart, klank,
 * kackle, coins, KONG letters, race, screech, giant tire, chest spawner, ...).
 *
 * Coins (banana coins, Kremkoins, DK coins) share one sprite. Variables:
 *   $42 coins still to add to the counter, $44 low = HUD target x / high = scroll timer,
 *   $46 displayed amount as two decimal digits (tens in the high byte, ones in the low byte),
 *   $48 low = HUD x target, $4A/$50 low bytes = HUD target position, $4C = RAM address of the
 *   coin counter (banana coins < $08CC, Kremkoins = $08CC, DK coins above), $4E = sound,
 *   $51 = final y in the HUD, $5C = time to stay in the HUD.
 */
import { r8, w8, r16, w16, rom16, bus16, io8, io16, ioR8 } from "../../core/mem";
import { reg, register } from "../../core/cpu";
import { setRetMode, RET_SPRITE } from "../../core/hybrid";
import { L, R, C, CPU, level, sprite as S } from "../../core/sym";
import {
  CODE_BBBB99,
  process_sprite_animation,
  get_current_sprite_clipping,
  set_current_level_dk_coin_collected,
  queue_sound_effect,
  delete_sprite_handle_deallocation,
  is_current_krem_coin_collected,
  set_sprite_animation,
  set_sprite_palette_global,
  spawn_special_sprite_index,
  set_this_level_krem_coin_collected,
  calculate_completion_percentage,
  is_current_level_dk_coin_collected,
} from "../../gen/routines";
import { BANK_BE, cur, jumpSpriteCode, spriteStateDispatch, adcBcd16 } from "./be1_util";
import { CODE_BEBE6D, check_kong_state_flags } from "./be1_collision";
import { set_sprite_target_hud_position, move_sprite_to_target_hud_position } from "./be1_hud";

const MAIN_TABLE = L("bank_BE_sprite_main_handler_main_table");
const COINS_STATE_TABLE = L("coins_sprite_code_state_table");
/** coin counters at or above this RAM address are not banana coins */
const KREMKOIN_COUNTER = 0x08cc;

/** $BEB800 — A = index of the sprite code (from the $B3 main): run it with DB = $BE. */
export function bank_BE_sprite_main_handler(): void {
  reg.x = reg.a;
  reg.db = BANK_BE;
  jumpSpriteCode((BANK_BE << 16) | rom16(MAIN_TABLE + reg.x));
}

/** $BEB849 — despawn the sprite if it went off screen too long, then back to the handler. */
export function sprite_return_handle_despawn_BE(): void {
  CODE_BBBB99();
}

/** $BEB850 — coin sprite (banana coin, Kremkoin, DK coin). */
export function coins_sprite_code(): void {
  spriteStateDispatch(COINS_STATE_TABLE, [
    coinIdle, //                00
    coinMovingToHud, //         01
    coinInHud, //               02
    coinSpawnInBonus, //        03
    coinIdleBonusOrBoss, //     04
    coinMovingToHud, //         05
    coinInHudBonusOrBoss, //    06
    () => {}, //                07 .return_state_no_despawn
    coinDkCoinSpawn, //         08
    sprite_return_handle_despawn_BE, // 09 .return_state
    coinSpawnFromKremcoinCheat, // 0A
    coinIdleKremcoinCheat, //   0B
  ]);
}

/** .idle — wait for a Kong to touch the coin. */
function coinIdle(): void {
  process_sprite_animation();
  get_current_sprite_clipping();
  CODE_BEBE6D();
  if (reg.c) return collectCoin();
  sprite_return_handle_despawn_BE();
}

/** .collect_coin — add the coin to its counter and start flying to the HUD. */
function collectCoin(): void {
  let max = 100; // the HUD counter holds 99
  let x = cur();
  const counter = r16(x + S.general_purpose_4C);
  reg.y = counter;
  if (counter >= KREMKOIN_COUNTER) {
    if (counter === KREMKOIN_COUNTER) max = 76; // 75 Kremkoins
    else {
      set_current_level_dk_coin_collected();
      x = cur();
      max = 100;
    }
  }
  w16(0x32, max);
  const count = r16(counter);
  io16(CPU.dividen, count);
  let total = (count + r16(x + S.general_purpose_42)) & 0xffff;
  if (total >= max) {
    // counter full: give only what fits
    w16(x + S.general_purpose_42, (max - 1 - count) & 0xffff);
    total = max - 1;
  }
  w16(counter, total);
  io8(CPU.divisor, 10);
  // HUD position: low byte of $4A, high byte of $50
  reg.a = (r16(x + S.general_purpose_4A) & 0x00ff) | (r16(x + 0x4f) & 0xff00);
  set_sprite_target_hud_position();
  // previous count as decimal digits (tens:ones)
  const digits = (ioR8(CPU.divide_result) << 8) | ioR8(CPU.divide_remainder);
  x = cur();
  w16(x + S.general_purpose_46, digits);
  w16(x + S.general_purpose_44, (r16(x + S.general_purpose_48) & 0x00ff) | 0xf000);
  w16(x + S.state, (r16(x + S.state) + 1) & 0xffff);
  reg.a = r16(x + S.general_purpose_4E);
  queue_sound_effect();
}

/** .moving_to_hud — fly to the counter, then count the coins in one by one. */
function coinMovingToHud(): void {
  process_sprite_animation();
  let x = cur();
  if (!r16(R.collected_coin_sprite)) w16(R.collected_coin_sprite, x);
  // the counter slides in from the side ($44 high byte counts up to $48)
  let slide = (r16(x + S.general_purpose_44) + 0x0200) & 0xffff;
  if (!(slide & 0x8000) && slide >= r16(x + S.general_purpose_48)) slide = r16(x + S.general_purpose_48);
  w16(x + S.general_purpose_44, slide);
  move_sprite_to_target_hud_position();
  if (!reg.n) return; // not at the HUD yet
  x = cur();
  w16(R.collected_coin_sprite, x);
  if (r16(x + S.general_purpose_48) !== r16(x + S.general_purpose_44)) return;
  if (r16(R.active_frame_counter) & 0x0007) return;
  const left = (r16(x + S.general_purpose_42) - 1) & 0xffff;
  w16(x + S.general_purpose_42, left);
  if (left & 0x8000) return nextState(x);
  if (left !== 0) {
    reg.a = r16(x + S.general_purpose_4E);
    queue_sound_effect();
    x = cur();
  }
  const digits = r16(x + S.general_purpose_46);
  if (digits === 0x0909) return nextState(x);
  // count up one: tens/ones digits in separate bytes, added in decimal mode
  w16(x + S.general_purpose_46, adcBcd16(digits, 0x0091, false) & 0x0f0f);
}

function nextState(x: number): void {
  w16(x + S.state, (r16(x + S.state) + 1) & 0xffff);
}

/** .in_hud — stay a while, then slide out of the HUD and delete the coin. */
function coinInHud(): void {
  const x = reg.y;
  const timer = (r16(x + S.unknown_5C) - 1) & 0xffff;
  w16(x + S.unknown_5C, timer);
  if (!(timer & 0x8000)) return inHudWait();
  w16(x + S.y_position, (r16(x + S.y_position) - 2) & 0xffff);
  // the slide position (high byte of $44) moves back by 2, stopping at $F0
  let carry = false;
  let slide = r8(x + 0x45);
  slide = (slide - 2) & 0xff;
  if (slide & 0x80) {
    carry = 0xf0 >= slide;
    if (carry) slide = 0xf0;
  }
  w8(x + 0x45, slide);
  if (!carry) return inHudWait();
  if (r8(x + 0x51) !== r8(x + S.y_position)) return inHudWait();
  if (x === r16(R.collected_coin_sprite)) w16(R.collected_coin_sprite, 0);
  delete_sprite_handle_deallocation();
}

/** ..CODE_BEB984 — only the coin shown in the HUD keeps animating; others are deleted. */
function inHudWait(): void {
  const x = cur();
  if (x !== r16(R.collected_coin_sprite)) {
    delete_sprite_handle_deallocation();
    return;
  }
  process_sprite_animation();
}

/** .spawn_in_bonus — a bonus room's Kremkoin (or a boss's DK coin) appears. */
function coinSpawnInBonus(): void {
  // Rev 1: only "find the token" bonuses play the appearing sound
  if ((r16(level.bonus_type) & 0xff) === C.find_the_token_bonus_type) kremkoinAppearSounds();
  is_current_krem_coin_collected();
  if (reg.c) {
    // already collected: show the "collected" look
    const x = cur();
    reg.a = r16(x + S.animation_id) === C.dk_coin_idle_anim_id ? C.dk_coin_collected_anim_id : C.krem_coin_collected_anim_id;
    set_sprite_animation();
    reg.x = cur();
    reg.a = C.coins_2_sprite_palette;
    set_sprite_palette_global();
  }
  reg.y = C.special_sprite_spawn_id_00CE;
  spawn_special_sprite_index();
  nextState(cur());
}

function kremkoinAppearSounds(): void {
  reg.a = (6 << 8) | C.sound_kremkoin_appear_fizz;
  queue_sound_effect();
  reg.a = (5 << 8) | C.sound_kremkoin_appear_echo;
  queue_sound_effect();
  reg.a = (7 << 8) | C.sound_kremkoin_appear;
  queue_sound_effect();
}

/** .idle_bonus_or_boss — the Kremkoin of a bonus room (or a boss DK coin) waiting to be taken. */
function coinIdleBonusOrBoss(): void {
  process_sprite_animation();
  get_current_sprite_clipping();
  CODE_BEBE6D();
  if (!reg.c) return;
  if (r16(R.colliding_sprite) === r16(R.inactive_kong_sprite)) return;
  reg.x = r16(R.colliding_sprite);
  reg.a = 0x0200;
  check_kong_state_flags();
  if (reg.c) return;
  set_this_level_krem_coin_collected();
  calculate_completion_percentage();
  w16(R.game_state_flags_2, r16(R.game_state_flags_2) | 0x0002);
  const x = cur();
  const anim = r16(x + S.animation_id);
  if (anim === C.krem_coin_collected_anim_id || anim === C.dk_coin_collected_anim_id) {
    // a coin collected before: no counting, just leave
    w16(x + S.state, 0x0007);
    return;
  }
  reg.x = x;
  collectCoin();
}

/** .in_hud_bonus_or_boss — like .in_hud, and tells the bonus/boss it may end once done. */
function coinInHudBonusOrBoss(): void {
  // Original bug: X still holds the state-table entry address here, so `LDA $5C,x` reads the
  // byte pair at $00:(entry+$5C) (ROM), not the sprite's timer. Reproduced as is.
  if (bus16((reg.x + S.unknown_5C) & 0xffff) & 0x8000) w16(R.game_state_flags_2, r16(R.game_state_flags_2) | 0x0002);
  coinInHud();
}

/** .dk_coin_spawn — a DK coin that was already collected shows the "collected" look. */
function coinDkCoinSpawn(): void {
  is_current_level_dk_coin_collected();
  if (reg.c) {
    reg.a = C.dk_coin_collected_anim_id;
    set_sprite_animation();
    nextState(cur());
    return;
  }
  w16(cur() + S.state, 0);
}

/** .spawn_from_kremcoin_cheat */
function coinSpawnFromKremcoinCheat(): void {
  kremkoinAppearSounds();
  reg.y = C.special_sprite_spawn_id_00CE;
  spawn_special_sprite_index();
  nextState(cur());
}

/** .idle_kremcoin_cheat — taking it sets the Kremkoin count to 75. */
function coinIdleKremcoinCheat(): void {
  process_sprite_animation();
  get_current_sprite_clipping();
  CODE_BEBE6D();
  if (!reg.c) return;
  w16(R.cheated_token_count, 0x004b);
  w16(cur() + S.state, 0);
  collectCoin();
}

register({
  bank_BE_sprite_main_handler,
  sprite_return_handle_despawn_BE,
  coins_sprite_code,
});
for (const n of ["bank_BE_sprite_main_handler", "sprite_return_handle_despawn_BE", "coins_sprite_code"]) setRetMode(L(n), RET_SPRITE);
