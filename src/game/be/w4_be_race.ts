/**
 * Bank $BE (package w4_be) — Rickety Race: Klank (riding his kart), the race handler, the
 * traffic light / race flag sprite (also used in Screech's Sprint) ($BEE47F-$BEEA7E).
 *
 * Race state: $0D5C = player's place (low 7 bits; bit 7 = race not started), $0D5D = place
 * shown on the flag, $0923 = race flags (bit 15 race running / flag shown, bit 14 race over,
 * bit 1 a Klank kart is alive, bit 0 spawn the next Klank kart).
 * Race handler variables: $42 race timer, $4C place shown, $4E traffic light / flag sprite,
 * $06 = pointer to the current kart's entry in klank_race_kart_data_table, $36 kart script.
 */
import { r8, w8, r16, w16, rom16 } from "../../core/mem";
import { reg, register } from "../../core/cpu";
import { setRetMode, RET_SPRITE, RET_RTS } from "../../core/hybrid";
import { L, R, C } from "../../core/sym";
import {
  spawn_special_sprite_address,
  spawn_special_sprite_index,
  queue_sound_effect,
  process_sprite_animation,
  process_current_movement,
  delete_sprite_handle_deallocation,
  delete_sprite_if_offscreen,
  defeat_sprite_using_anim_global,
  is_current_level_dk_coin_collected,
  CODE_B39DB0,
  transition_song,
  set_sprite_palette_direct_global,
  request_palette_direct_global,
  CODE_BB8AE4,
} from "../../gen/routines";
import { g, s, inc, dec, or, and, neg, spriteConst, ptr32, cur } from "./w4_be_util";
import { set_klank_race_kart_velocity } from "./w4_be_skull_cart";

const BANK_BE = 0xbe;
const KLANK_CART_OFFSETS = L("DATA_BEE664");
const KLANK_ITEM_SCRIPTS = L("DATA_FF18CE");
const KART_DATA_TABLE = L("klank_race_kart_data_table") & 0xffff;
const SPRITE_PALETTES = L("sprite_palette_table");
const DIXIE_PALETTE = L("dixie_active_sprite_palette") & 0xffff;
const KLANK_RACE_DATA_BANK = 0xfd;

const KART_RACE = 0x0d5c;
const RACE_FLAGS = 0x0923;
const sound = (ch: number, id: number) => (ch << 8) | id;
const csc = R.current_sprite_constants;

// =============================================================================================
// Klank ($BEE47F): rides a kart in Rickety Race, throws barrels.
// =============================================================================================

/** $BEE47F — Klank. $42 = his kart, $1E = barrel being thrown, $10 = attack constants. */
export function klank_sprite_code(): void {
  const y = cur();
  w16(csc, g(y, 0x54));
  const state = g(y, 0x2e) & 0xff;
  const subIdx = g(y, 0x2f) & 0xff;
  reg.y = y;
  reg.a = (subIdx << 1) & 0xffff;
  reg.x = reg.a;
  const subs0 = [CODE_BEE4AC, CODE_BEE51A, CODE_BEE54D, CODE_BEE56E, CODE_BEE584];
  const subs1 = [CODE_BEE4C6, CODE_BEE51A, CODE_BEE54D, CODE_BEE56E, CODE_BEE584];
  if (state === 0) return subs0[subIdx]?.();
  if (state === 1) return subs1[subIdx]?.();
  if (state === 2) return CODE_BEE5A1();
}

function CODE_BEE4AC(): void {
  if (g(reg.y, 0x42) === 0) {
    delete_sprite_handle_deallocation();
    return;
  }
  // CODE_BEE4F4
  process_sprite_animation();
  const x = cur();
  if ((g(x, 0x2f) & 0xff) === 0) return;
  reg.y = C.special_sprite_spawn_id_00E8;
  spawn_special_sprite_index();
  if (reg.c) return;
  const kart = g(cur(), 0x42);
  const b = r16(R.alternate_sprite);
  s(b, 0x20, g(kart, 0x20));
  s(b, 0x26, g(kart, 0x20));
  CODE_BEE51A();
}

/** Klank defeated: falls off. */
function CODE_BEE4C6(): void {
  const y = reg.y;
  s(y, 0x52, 4);
  s(y, 0x26, 0x0100);
  s(y, 0x20, 0x0100);
  s(y, 0x24, 0xf900);
  s(y, 0x0a, g(y, 0x0a) - 0x18);
  reg.a = 0x01b0;
  defeat_sprite_using_anim_global();
  s(reg.x, 0x2e, 2);
}

/** Pick up a barrel to throw. */
function CODE_BEE51A(): void {
  let x = cur();
  if (g(x, 0x42) === 0) {
    w8(x + 0x2e, 0);
    return;
  }
  // CODE_BEE529
  x = cur();
  w16(csc, g(x, 0x10));
  reg.y = spriteConst(0);
  spawn_special_sprite_address();
  if (reg.c) return;
  CODE_BEE5B8();
  x = cur();
  w16(csc, g(x, 0x54));
  inc(x, 0x2f);
  CODE_BEE61C();
  CODE_BEE680();
}

function CODE_BEE54D(): void {
  const y0 = reg.y;
  if (g(y0, 0x42) !== 0) {
    CODE_BEE680();
    CODE_BEE61C();
    return;
  }
  // CODE_BEE55C: the kart is gone: drop the barrel and fall
  const y = cur();
  const b = g(y, 0x1e);
  if (b) {
    and(b, 0x52, 0xff7f);
    s(b, 0x1e, 0);
  }
  reg.y = y;
  CODE_BEE4C6();
}

/** Throw the barrel. */
function CODE_BEE56E(): void {
  const y = reg.y;
  s(y, 0x10, 0);
  inc(y, 0x2f);
  const b = g(y, 0x1e);
  if (b) {
    and(b, 0x52, 0xff7f);
    if (!neg(g(b, 0x3f))) s(b, 0x1e, 0);
  }
  CODE_BEE584();
}

function CODE_BEE584(): void {
  const y = cur();
  if (g(y, 0x1e) !== 0) return CODE_BEE680();
  w8(y + 0x2f, 0);
  process_sprite_animation();
}

/** Defeated: fall until off screen. */
function CODE_BEE5A1(): void {
  process_current_movement();
  process_sprite_animation();
  delete_sprite_if_offscreen();
  if (reg.c) w16(RACE_FLAGS, r16(RACE_FLAGS) & ~0x0002);
}

/** $BEE5B8 — link the barrel just spawned to Klank and set it up from his attack constants. */
function CODE_BEE5B8(): void {
  const y = cur();
  const x = r16(R.alternate_sprite);
  s(y, 0x1e, x);
  s(x, 0x56, y);
  s(x, 0x5a, 0x3c3c);
  s(x, 0x32, 0);
  s(x, 0x02, g(y, 0x02) - 1);
  s(y, 0x0c, g(x, 0x04));
  s(y, 0x0e, g(x, 0x20));
  s(y, 0x40, g(x, 0x08));
  s(y, 0x5c, g(x, 0x24));
  s(y, 0x1c, g(x, 0x53) & 0xff);
  const c8 = spriteConst(8);
  s(x, 0x52, ((((g(x, 0x51) ^ c8) & 0xff00) ^ c8) | 0x0080) & 0xffff);
  or(x, 0x2e, 0x0080);
  s(x, 0x40, spriteConst(9) & 0xff);
  s(x, 0x1e, spriteConst(10));
  s(x, 0x20, spriteConst(2));
  s(x, 0x24, spriteConst(4));
}

/** $BEE61C — hold the barrel at the hand position of the current attack frame. */
function CODE_BEE61C(): void {
  reg.db = BANK_BE;
  const x = cur();
  w16(csc, g(x, 0x10));
  w16(0x34, spriteConst(6));
  const f = (g(x, 0x1a) - C.klank_ride_cart_attack_frame1) & 0xffff;
  if (f >= 0x7d) return;
  const dx = ((r16(0x34) & 0xff) - rom16(KLANK_CART_OFFSETS + f)) & 0xffff;
  w16(0x32, dx);
  const dy = ((r16(0x35) & 0xff) - rom16(KLANK_CART_OFFSETS + 2 + f)) & 0xffff;
  const b = g(x, 0x1e);
  s(b, 0x0a, dy + g(x, 0x0a));
  let a = r16(0x32);
  if (g(x, 0x12) & 0x4000) a = -a & 0xffff;
  s(b, 0x06, a + g(x, 0x06));
}

/** $BEE680 — animate Klank, keeping $40. */
export function CODE_BEE680(): void {
  const x = cur();
  const keep = g(x, 0x40);
  reg.x = x;
  process_sprite_animation();
  s(reg.x, 0x40, keep);
}

/** $BEE691 — A = item index: Klank drops an item (KONG letter, DK coin, ...) as he falls. */
export function CODE_BEE691(): void {
  let a = reg.a;
  if (a === 0x0011) {
    // a DK coin only if not collected yet
    is_current_level_dk_coin_collected();
    a = reg.c ? 0x001a : 0x0011;
  }
  reg.a = a;
  reg.z = false;
  reg.n = false;
  CODE_B39DB0();
  const item = reg.a;
  reg.y = rom16((KLANK_ITEM_SCRIPTS + ((item << 1) & 0xffff)) & 0xffffff);
  spawn_special_sprite_address();
  reg.a = item;
  if (reg.c) return;
  const y = r16(R.alternate_sprite);
  s(y, 0x42, item);
  s(y, 0x52, 0x001c);
  s(y, 0x2e, 0x0003);
  const x = cur();
  s(y, 0x06, g(x, 0x06));
  s(y, 0x0a, g(x, 0x0a));
  s(y, 0x24, 0xfa00);
  s(y, 0x48, 0x0026);
  s(y, 0x4c, 0x0050);
  s(y, 0x4e, 0x2000);
  reg.a = 0x2000;
  reg.x = x;
  reg.y = y;
}

// =============================================================================================
// Race handler ($BEE6EB)
// =============================================================================================

/** $BEE6EB — Rickety Race handler. */
export function race_handler_sprite_code(): void {
  const y = cur();
  reg.y = y;
  switch (g(y, 0x2e)) {
    case 0:
      return raceInit(y);
    case 1:
      return raceWaitForPlayer();
    case 2:
      return raceWaitForGreenLight(y);
    case 3:
      return raceInProgress(y);
    default:
      return; // 4: race finished
  }
}

function raceInit(y: number): void {
  w16(KART_RACE, g(y, 0x44) | 0x0080);
  spawn_and_setup_klank_kart();
  if (!reg.c) inc(cur(), 0x2e);
}

function raceWaitForPlayer(): void {
  if (r16(R.ridden_skull_cart_sprite) === 0) return;
  reg.y = C.special_sprite_spawn_id_00F4;
  spawn_special_sprite_index();
  if (reg.c) return;
  const y = r16(R.alternate_sprite);
  const x = cur();
  s(y, 0x4e, x);
  s(x, 0x4e, y);
  inc(x, 0x2e);
  w16(RACE_FLAGS, r16(RACE_FLAGS) | 0x8000);
}

function raceWaitForGreenLight(y: number): void {
  if (g(y, 0x4e) !== 0) return;
  inc(y, 0x2e);
  w16(KART_RACE, r16(KART_RACE) & ~0x0080);
  update_race_flag();
}

function raceInProgress(y: number): void {
  let x = y;
  if (r16(R.screen_scroll_x_position) >= 0x5c80) {
    // the finish line
    w16(RACE_FLAGS, r16(RACE_FLAGS) | 0x8000);
    update_race_flag();
    x = cur();
    if (!reg.c) {
      inc(x, 0x2e);
      w16(RACE_FLAGS, r16(RACE_FLAGS) | 0x4000);
      return;
    }
  }
  inc(x, 0x42);
  updatePlayerKartMinMaxSpeed(x);
  x = cur();
  if ((r16(KART_RACE) & 0x7f) !== g(x, 0x4c)) {
    update_race_flag();
    if (!reg.c) {
      reg.a = sound(7, C.sound_coaster_race_rank_up);
      queue_sound_effect();
    }
  }
  if ((r16(RACE_FLAGS) & 0x0003) !== 0x0001) return;
  spawn_and_setup_klank_kart();
  if (!reg.c) w16(RACE_FLAGS, r16(RACE_FLAGS) & ~0x0001);
}

/** .update_player_kart_min_max_speed — X = handler: after 300 frames the cart can't stop. */
function updatePlayerKartMinMaxSpeed(x: number): void {
  const y = r16(R.ridden_skull_cart_sprite);
  let a = g(y, 0x22);
  if (!neg(a) && a >= 0x0200) return;
  if (neg(g(y, 0x26))) {
    s(y, 0x22, 0xfc00);
    s(y, 0x28, 0xff00);
    or(y, 0x3e, 0x8000);
    s(y, 0x4e, 0);
    return;
  }
  if (g(x, 0x42) < 0x012c) return;
  a = (g(y, 0x22) + 4) & 0xffff;
  if (!neg(a) && a >= 0x0200) a = 0x0200;
  s(y, 0x22, a);
}

/** $BEE7ED — show the player's place on the flag (spawn it first). Carry set = not yet. */
export function update_race_flag(): void {
  reg.c = true;
  if (r16(0x092e) & 0x00ff) return; // fireworks on screen
  const y = cur();
  const x = g(y, 0x4e);
  if (x) {
    w8(x + 0x2f, 0);
    s(y, 0x4c, r16(KART_RACE) & 0x7f);
    reg.c = false;
    return;
  }
  reg.y = C.special_sprite_spawn_id_00F2;
  spawn_special_sprite_index();
  if (reg.c) return;
  const flag = r16(R.alternate_sprite);
  const h = cur();
  s(flag, 0x4e, h);
  s(h, 0x4e, flag);
  s(h, 0x4c, r16(KART_RACE) & 0x7f);
}

/** $BEE827 — spawn the next Klank kart at a free spot ahead of the camera. Carry set = not now. */
export function spawn_and_setup_klank_kart(): void {
  const x = cur();
  let a = ((r16(KART_RACE) & 0x7f) - 2) & 0xffff;
  if (neg(a)) {
    reg.c = true;
    return;
  }
  const c = ((a >> 13) & 1) === 1; // carry of the last ASL
  a = ((a << 3) + KART_DATA_TABLE + (c ? 1 : 0)) & 0xffff;
  s(x, 0x06, a);
  w16(0x32, a);
  w16(0x34, KLANK_RACE_DATA_BANK);
  w16(0x32, ptr32(0));
  let y = 0;
  let checkTime = g(x, 0x42) === 0;
  for (;;) {
    if (!checkTime) {
      // .check_valid_spawn_position
      a = ptr32(y);
      if (neg(a)) {
        reg.c = true;
        return;
      }
      const d = a - r16(R.screen_scroll_x_position);
      if (d >= 0) {
        if (d >= 0x0120) {
          reg.c = true;
          return;
        }
        if (d >= 0x0100) checkTime = true;
      }
      if (!checkTime) {
        y += 6;
        continue;
      }
    }
    // .check_spawn_time_limit
    checkTime = false;
    y += 4;
    if (g(x, 0x42) < ptr32(y)) break;
    y += 2;
  }
  // ..spawn_kart
  y -= 4;
  const data = r16(0x32);
  reg.y = g(x, 0x36);
  spawn_special_sprite_address();
  w16(0x32, data);
  w16(0x34, KLANK_RACE_DATA_BANK);
  if (reg.c) {
    reg.c = true;
    return;
  }
  const k = r16(R.alternate_sprite);
  s(k, 0x06, ptr32(y));
  s(k, 0x0a, ptr32(y + 2));
  w16(0x32, g(cur(), 0x06));
  s(k, 0x28, ptr32(6));
  s(k, 0x22, ptr32(4));
  s(k, 0x5c, ptr32(2));
  reg.x = k;
  set_klank_race_kart_velocity();
  reg.c = false;
}

// =============================================================================================
// Traffic light / race flag ($BEE8BD)
// =============================================================================================

/** $BEE8BD — state 0 = traffic light, state 1 = race flag (place shown, blinking). */
export function racing_flag_sprite_code(): void {
  const y = cur();
  reg.y = y;
  const state = g(y, 0x2e) & 0xff;
  const subIdx = g(y, 0x2f) & 0xff;
  reg.a = (subIdx << 1) & 0xffff;
  reg.x = reg.a;
  if (state === 0) {
    const subs = [
      lightInitRickety, lightLowerDown, lightCountdownRickety, lightWait, lightRiseUp,
      lightInitScreech, lightLowerDown, lightCountdownScreech, lightWait, lightRiseUp,
    ];
    return subs[subIdx]?.();
  }
  if (state === 1) {
    const subs = [flagInit, flagSub1, flagEnableVisibility, flagSub3, flagSub4];
    return subs[subIdx]?.();
  }
}

function lightInitScreech(): void {
  w16(R.time_stop_flags, r16(R.time_stop_flags) | 0x0003);
  lightInitRickety();
}

function lightInitRickety(): void {
  const y = cur();
  s(y, 0x44, rom16((SPRITE_PALETTES + ((g(y, 0x44) << 1) & 0xffff)) & 0xffffff));
  inc(y, 0x2f);
  lightLowerDown();
}

function lightLowerDown(): void {
  const x = cur();
  let a = (g(x, 0x0a) + 4) & 0xffff;
  if (!neg(a) && a >= 0x0040) {
    a = 0x0040;
    inc(x, 0x2f);
  }
  s(x, 0x0a, a);
}

function lightCountdownRickety(): void {
  if (r16(R.ridden_skull_cart_sprite) === 0) return;
  lightCountdownScreech();
}

function lightCountdownScreech(): void {
  const y = cur();
  const a = (g(y, 0x42) - 0x0100) & 0xffff;
  s(y, 0x42, a);
  if (!neg(a)) return;
  w8(y + 0x43, a & 0xff);
  dec(y, 0x46);
  if (neg(g(y, 0x46))) {
    inc(y, 0x2f);
    return;
  }
  // ..update_light_step
  const pal = (g(y, 0x44) + 0x001e) & 0xffff;
  s(y, 0x44, pal);
  reg.a = pal;
  reg.x = y;
  set_sprite_palette_direct_global();
  const x = cur();
  if (g(x, 0x46) !== 0) {
    reg.a = sound(6, C.sound_starting_light_1);
    queue_sound_effect();
    return;
  }
  // ..green_light
  const h = g(x, 0x4e);
  if (h) s(h, 0x4e, 0);
  w16(R.time_stop_flags, r16(R.time_stop_flags) & ~0x0003);
  inc(x, 0x2f);
  reg.a = sound(6, C.sound_starting_light_2);
  queue_sound_effect();
}

function lightWait(): void {
  const y = cur();
  const t = g(y, 0x42);
  s(y, 0x42, t - 0x0100);
  if (t >= 0x0100) return;
  inc(y, 0x2f);
  if (g(y, 0x2e) === 0x0400) return; // Rickety Race: no song change
  reg.a = 0x0005;
  transition_song();
}

function lightRiseUp(): void {
  const y = cur();
  const a = (g(y, 0x0a) - 6) & 0xffff;
  s(y, 0x0a, a);
  if (!neg(a)) return;
  if (a >= 0xfff8) return;
  delete_sprite_handle_deallocation();
}

function flagInit(): void {
  const x = cur();
  s(x, 0x42, g(x, 0x44));
  inc(x, 0x2f);
  flagSub1();
}

function flagSub1(): void {
  const x = cur();
  s(x, 0x1c, 0xc000);
  w8(0x0d5d, 0);
  dec(x, 0x42);
  if (neg(g(x, 0x42))) {
    // ..despawn_flag
    delete_sprite_handle_deallocation();
    w16(RACE_FLAGS, r16(RACE_FLAGS) & ~0x8000);
    s(g(cur(), 0x4e), 0x4e, 0);
    return;
  }
  if ((g(x, 0x42) & 0x1f) < 0x14) flagEnableVisibility();
}

function flagEnableVisibility(): void {
  const x = cur();
  s(x, 0x1c, 0x8000);
  w8(0x0d5d, r8(KART_RACE));
}

/** Screech's Sprint: borrow Dixie's palette slot for the flag. */
function flagSub3(): void {
  reg.a = DIXIE_PALETTE;
  request_palette_direct_global();
  const slot = reg.x;
  w16(R.sprite_palette_reference_count + slot, r16(R.sprite_palette_reference_count + slot) - 1);
  let x = cur();
  const a = reg.a;
  s(x, 0x12, ((a ^ g(x, 0x12)) & 0x0e00) ^ g(x, 0x12));
  reg.a = rom16((SPRITE_PALETTES + ((g(x, 0x46) << 1) & 0xffff)) & 0xffffff);
  reg.x = cur();
  CODE_BB8AE4();
  x = cur();
  s(x, 0x1c, 0x8000);
  inc(x, 0x2f);
  s(x, 0x42, g(x, 0x44));
}

function flagSub4(): void {
  const x = cur();
  s(x, 0x1c, 0xc000);
  w8(0x0d5d, 0);
  const k = r16(R.active_kong_sprite);
  let despawn = false;
  if (g(x, 0x0a) < 0x01ff && g(k, 0x06) >= g(x, 0x4e)) despawn = true;
  if (!despawn) {
    dec(x, 0x42);
    if (!neg(g(x, 0x42))) {
      if ((g(x, 0x42) & 0x1f) < 0x14) flagEnableVisibility();
      return;
    }
  }
  // ..despawn_flag: give Dixie's palette back
  const slot = g(x, 0x13) & 0x000e;
  w16(R.sprite_palette_reference_count + slot, r16(R.sprite_palette_reference_count + slot) + 1);
  reg.a = DIXIE_PALETTE;
  reg.x = cur();
  CODE_BB8AE4();
  delete_sprite_handle_deallocation();
}

register({
  klank_sprite_code,
  CODE_BEE680,
  CODE_BEE691,
  race_handler_sprite_code,
  update_race_flag,
  spawn_and_setup_klank_kart,
  racing_flag_sprite_code,
});
for (const n of ["klank_sprite_code", "race_handler_sprite_code", "racing_flag_sprite_code"]) setRetMode(L(n), RET_SPRITE);
for (const n of ["CODE_BEE691", "update_race_flag", "spawn_and_setup_klank_kart"]) setRetMode(L(n), RET_RTS);
