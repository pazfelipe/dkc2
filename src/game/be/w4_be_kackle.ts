/**
 * Bank $BE (package w4_be) — Haunted Hall: Kackle (the ghost that chases the cart when the
 * time runs out) and the timer handler that shows / changes the countdown ($BEE07E-$BEE47E).
 *
 * Kackle: $1C = the timer handler sprite, $32 = hit flags (bit 15 = the cart left through the
 * exit door), $36 = time bonus on reset, $5C = distance to the cart (eases toward the target
 * computed from the timer in CODE_BEE284).
 * Timer handler: $42 seconds to add, $44 seconds to subtract (negative count), $46 timer
 * value, $48 low = frames per second, high = frame counter, $4A timer digit sprite,
 * $4C/$4D speed of the add/subtract animation.
 */
import { r8, w8, r16, w16, rom16, io8, ioR16 } from "../../core/mem";
import { reg, register } from "../../core/cpu";
import { setRetMode, RET_SPRITE } from "../../core/hybrid";
import { L, R, C, CPU } from "../../core/sym";
import {
  spawn_special_sprite_index,
  queue_sound_effect,
  CODE_B3A3B4,
  CODE_B3CB55,
  CODE_BBBB99,
  CODE_BEBE8B,
  process_current_movement,
  delete_sprite_handle_deallocation,
  get_sprite_special_clipping_slot_0,
  get_sprite_special_clipping_slot_1,
} from "../../gen/routines";
import { spriteStateDispatch } from "./be1_util";
import { g, s, inc, dec, neg, cur } from "./w4_be_util";

const KACKLE_TABLE = L("kackle_sprite_code_state_table");
const HAUNTED_HALL_PALETTE = L("haunted_hall_level_palette") & 0xffff;
const TIMER_DIGITS = L("DATA_B3DE2C");
const KACKLE_SPRITE = 0x0d5a;
const sound = (ch: number, id: number) => (ch << 8) | id;
const timeStopped = () => (r16(R.time_stop_flags) & 0x0004) !== 0;

/** $BEE07E — Kackle. */
export function kackle_sprite_code(): void {
  if (timeStopped() && (g(cur(), 0x2e) & 0xff) !== 6) return;
  spriteStateDispatch(KACKLE_TABLE, [
    kackleInit, kackleWaitAtDoor, kackleChase, kackleInch, kackleInchMore, kackleDamageInit,
    kackleDamage, kackleLeave,
  ]);
}

/** CODE_BEE0A9 — 00: init, set the palette for the room. */
function kackleInit(): void {
  const y = reg.y;
  w16(KACKLE_SPRITE, y);
  inc(y, 0x2e);
  s(y, 0x1c, 0);
  s(y, 0x32, 0);
  s(y, 0x36, 0);
  s(y, 0x52, 0);
  const p = g(y, 0x04);
  if (p) {
    reg.x = (p + HAUNTED_HALL_PALETTE) & 0xffff;
    reg.a = 0x20fd;
    CODE_B3A3B4();
  }
}

/** Common tail: move. */
function move(): void {
  CODE_B3CB55();
  process_current_movement();
}

/** CODE_BEE0CA — 01: wait at the door until the cart passes, then spawn the timer. */
function kackleWaitAtDoor(): void {
  const y = reg.y;
  if (g(y, 0x1c) === 0) return move();
  // CODE_BEE0DD
  reg.y = C.special_sprite_spawn_id_00E0;
  spawn_special_sprite_index();
  if (reg.c) return;
  const x = cur();
  const t = r16(R.alternate_sprite);
  const a = g(x, 0x1c);
  s(t, 0x46, a);
  s(t, 0x48, a & 0xff00);
  s(t, 0x47, a & 0xff00);
  s(t, 0x44, 0);
  s(x, 0x1c, t);
  inc(x, 0x2e);
}

/** CODE_BEE105 — 02: chase. */
function kackleChase(): void {
  const r = CODE_BEE24E();
  if (!neg(r) && r !== 0) return setState(3, 0x1502);
  CODE_BEE284();
  move();
}

/** CODE_BEE11D — 03 */
function kackleInch(): void {
  const r = CODE_BEE24E();
  if (!neg(r)) {
    if (r < 1) return setState(2, 0x1502);
    if (r > 1) return setState(4, 0);
    CODE_BEE284();
  }
  move();
}

/** CODE_BEE13C — 04 */
function kackleInchMore(): void {
  const r = CODE_BEE24E();
  if (!neg(r)) {
    if (r < 2) return setState(3, 0x1502);
    if (r > 2) return setState(5, 0x1702);
    // CODE_BEE14A: flicker
    if (r16(R.active_frame_counter) & 1) {
      const x = cur();
      s(x, 0x12, g(x, 0x12) ^ 0x0200);
    }
    CODE_BEE284();
  }
  move();
}

/** CODE_BEE18D — A = state, Y = oam property (0 = keep). */
function setState(a: number, prop: number): void {
  const x = cur();
  w8(x + 0x2e, a);
  if (prop) s(x, 0x12, prop);
  move();
}

/** CODE_BEE1A6 — 05: reach the Kong: hurt him (or take the partner and laugh). */
function kackleDamageInit(): void {
  CODE_BEE284();
  get_sprite_special_clipping_slot_0();
  reg.a = 0x000e;
  get_sprite_special_clipping_slot_1();
  reg.a = 0;
  CODE_BEBE8B();
  if (!reg.c) return move();
  const x = cur();
  if (!(r16(R.game_state_flags) & 0x4000)) {
    s(x, 0x52, 7);
    s(x, 0x46, 0x0404);
    s(x, 0x26, 0x0040);
    return setState(6, 0x1702);
  }
  // CODE_BEE1D8: the time is reset
  const t = g(x, 0x1c);
  let a = g(x, 0x36);
  if (a < 5) a = 5;
  s(t, 0x46, a);
  s(t, 0x2e, 6);
  reg.a = sound(7, C.sound_kackle);
  queue_sound_effect();
  setState(6, 0x1702);
}

/** CODE_BEE206 — 06 */
function kackleDamage(): void {
  CODE_BEE284();
  if (reg.y !== 0) {
    CODE_BEE24E();
    return move();
  }
  if (r16(R.game_state_flags) & 0x2000) {
    reg.a = sound(7, C.sound_kackle);
    queue_sound_effect();
  }
  setState(2, 0x1502);
}

/** CODE_BEE231 — 07: the cart left: float away. */
function kackleLeave(): void {
  const x = reg.y;
  s(x, 0x1c, 0);
  CODE_BEE284();
  move();
  CODE_BBBB99();
  if (reg.c) w16(KACKLE_SPRITE, 0);
}

/**
 * $BEE24E — how close Kackle should be: $FFFF = the cart escaped (state 7), 3 = no timer,
 * 2 = timer < 3, 1 = timer < 6, 0 = more time.
 */
function CODE_BEE24E(): number {
  const x = cur();
  reg.x = x;
  const hit = g(x, 0x32);
  s(x, 0x32, 0);
  let r: number;
  if (neg(hit)) {
    s(x, 0x2e, 7);
    s(x, 0x1c, 0);
    r = 0xffff;
  } else {
    const y = g(x, 0x1c);
    reg.y = y;
    const t = y ? g(y, 0x46) : 0;
    if (!y || neg(t)) r = 3;
    else if (t < 3) r = 2;
    else if (t < 6) r = 1;
    else r = 0;
  }
  reg.a = r;
  return r;
}

/** $BEE284 — ease Kackle's distance ($5C) toward the one for the remaining time. Y = 0 when there. */
function CODE_BEE284(): void {
  const x = cur();
  const y = g(x, 0x1c);
  const t = r8(y + 0x46);
  let a8: number;
  if (t >= 0x0a) {
    io8(CPU.multiply_A, (t + 0x0a) & 0xff); // ADC #$09 with carry set
    io8(CPU.multiply_B, r8(y + 0x48));
    a8 = r8(y + 0x49);
  } else {
    io8(CPU.multiply_A, t);
    io8(CPU.multiply_B, (r8(y + 0x48) << 1) & 0xff);
    a8 = (r8(y + 0x49) << 1) & 0xff;
  }
  let a = ((a8 + ioR16(CPU.multiply_result)) & 0xffff) >> 4;
  a += 0x000c;
  if (a >= 0x0058) a = 0x0058;
  reg.a = a;
  reg.x = x;
  reg.y = y;
  const d = g(x, 0x5c);
  if (a === d) {
    reg.y = 0;
    return;
  }
  if (a > d) inc(x, 0x5c);
  else dec(x, 0x5c);
}

// =============================================================================================
// Haunted hall timer handler ($BEE2D9)
// =============================================================================================

/** $BEE2D9 — the countdown shown above the cart. */
export function haunted_hall_timer_handler_code(): void {
  if (timeStopped() && (g(cur(), 0x2e) & 0xff) !== 6) return;
  const y = cur();
  reg.y = y;
  const k = r16(KACKLE_SPRITE);
  if (k === 0 || g(k, 0x1c) === 0) return timerDelete(y);
  switch (g(y, 0x2e)) {
    case 0:
      return timerInit();
    case 1:
      return timerState1();
    case 4:
      return timerAdd(y);
    case 5:
      return timerSubtract(y);
    case 6:
      return timerState6();
    default:
      return; // 2, 3
  }
}

function timerDelete(y: number): void {
  w16(R.current_sprite, g(y, 0x4a));
  delete_sprite_handle_deallocation();
  w16(R.current_sprite, y);
  delete_sprite_handle_deallocation();
  w16(R.bonus_timer_sprite, 0);
}

function timerInit(): void {
  reg.y = C.special_sprite_spawn_id_00CC;
  spawn_special_sprite_index();
  if (reg.c) return;
  const x = cur();
  const d = r16(R.alternate_sprite);
  s(x, 0x4a, d);
  s(d, 0x06, g(x, 0x06) + 0x0100);
  s(d, 0x0a, g(x, 0x0a));
  inc(x, 0x2e);
  s(x, 0x1c, 0xc000);
  w16(R.bonus_timer_sprite, x);
  s(x, 0x42, 0);
  s(x, 0x44, 0);
  CODE_BEE405();
}

function timerState1(): void {
  CODE_BEE45B();
  CODE_BEE3E8();
  CODE_BEE405();
  const x = cur();
  if (neg(g(x, 0x46))) s(x, 0x2e, 3);
}

/** State 4: add the bonus seconds one by one. */
function timerAdd(x: number): void {
  const speed = r8(x + 0x4c);
  const c = (r8(x + 0x4d) - 1) & 0xff;
  w8(x + 0x4d, c);
  if (c !== 0) return CODE_BEE405();
  w8(x + 0x4d, speed);
  inc(x, 0x46);
  dec(x, 0x42);
  if (g(x, 0x42) === 0) s(x, 0x2e, 1);
  CODE_BEE405();
}

/** State 5: take seconds away one by one. */
function timerSubtract(x: number): void {
  const speed = r8(x + 0x4c);
  const c = (r8(x + 0x4d) - 1) & 0xff;
  w8(x + 0x4d, c);
  if (c !== 0) return CODE_BEE405();
  w8(x + 0x4d, speed);
  dec(x, 0x46);
  if (neg(g(x, 0x46))) {
    s(x, 0x46, 0);
    s(x, 0x44, 0);
    s(x, 0x2e, 1);
  } else {
    inc(x, 0x44);
    if (g(x, 0x44) === 0) s(x, 0x2e, 1);
  }
  CODE_BEE405();
}

/** State 6: Kackle is resetting the time: blink every frame. */
function timerState6(): void {
  CODE_BEE41D(1);
  const x = cur();
  const k = r16(KACKLE_SPRITE);
  if ((g(k, 0x2e) & 0xff) === 6) return;
  s(x, 0x2e, 1);
}

/** $BEE3E8 — count the frames of a second; at 0 a second passes. */
function CODE_BEE3E8(): void {
  const x = cur();
  const a = (g(x, 0x48) - 0x0100) & 0xffff;
  s(x, 0x48, a);
  if (!neg(a)) return;
  s(x, 0x48, ((a & 0xff) << 8) | (a & 0xff)); // reload the counter from the low byte
  if (!neg(g(x, 0x46))) dec(x, 0x46);
}

/** $BEE405 — blink the timer when low, and show the digits. */
function CODE_BEE405(): void {
  const x = cur();
  const t = g(x, 0x46);
  if (neg(t) || t >= 6) {
    w16(R.bonus_timer_sprite, x);
    return showDigits();
  }
  if (t === 0) return CODE_BEE41D(0);
  CODE_BEE41D(t < 3 ? 3 : 7);
}

/** CODE_BEE41D — A = blink mask. */
function CODE_BEE41D(mask: number): void {
  if ((mask & r16(R.active_frame_counter)) === 0) {
    w16(R.bonus_timer_sprite, r16(R.bonus_timer_sprite) ^ cur());
  }
  showDigits();
}

/** CODE_BEE42E — the two digit graphics. */
function showDigits(): void {
  let x = cur();
  let t = g(x, 0x46);
  if (neg(t)) t = 0;
  const digits = rom16((TIMER_DIGITS + ((t << 1) & 0xffff)) & 0xffffff);
  w16(0x32, digits);
  x = cur();
  s(x, 0x1a, ((digits & 0xff) << 2) + C.timer_0_graphic);
  const y = g(x, 0x4a);
  s(y, 0x1a, ((r16(0x33) & 0xff) << 2) + C.timer_0_graphic);
  reg.x = x;
  reg.y = y;
}

/** $BEE45B — seconds to add or subtract pending: go to state 4/5 (carry set). */
function CODE_BEE45B(): void {
  const x = cur();
  let st = 4;
  if (g(x, 0x42) === 0) {
    if (g(x, 0x44) === 0) {
      reg.c = false;
      return;
    }
    st = 5;
  }
  s(x, 0x2e, st);
  s(x, 0x4c, 0x0404);
  w8(x + 0x49, r8(x + 0x48));
  w16(R.bonus_timer_sprite, x);
  reg.c = true;
}

register({ kackle_sprite_code, haunted_hall_timer_handler_code });
for (const n of ["kackle_sprite_code", "haunted_hall_timer_handler_code"]) setRetMode(L(n), RET_SPRITE);
