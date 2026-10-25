/**
 * Bank $BE (package w4_be) — Haunted Hall and Rickety Race carts: haunted hall door, gate
 * barrel, skull cart sparks and the skull cart itself ($BECBA0-$BEE07D).
 *
 * Skull cart variables (sprite offsets):
 *   $42 rider Kong (bit 15 = jumped off, still owned), $44 second rider (team) or Klank's kart
 *   link, $46/$48 the two spark sprites, $4A/$4C real x/y (the sprite x/y hold the "drawn"
 *   position while the cart code runs, swapped in CODE_BEDE09), $4E bump timer (high byte) and
 *   x deceleration (low byte, active with $3E bit 15), $50 extra acceleration, $36 slope frame,
 *   $3A slope frame delay, $40 target slope frame, $5C pointer into the Klank race script,
 *   $38/$3C position when a Kong got on/off.
 * $0D5C = number of Klank karts still racing (bit 7 = race over), $0D5A = the race flag sprite.
 *
 * The cart routines track the carry exactly like the original (reg.c), because several of
 * them end in `SBC #$0020` without SEC and the RNG of the sparks rotates the carry in.
 */
import { r8, w8, r16, w16, rom8, rom16, io8, ioR16 } from "../../core/mem";
import { reg, register } from "../../core/cpu";
import { setRetMode, RET_SPRITE } from "../../core/hybrid";
import { L, R, C, CPU } from "../../core/sym";
import {
  spawn_special_sprite_address,
  spawn_special_sprite_index,
  spawn_no_gfx_special_sprite_index,
  get_current_sprite_clipping,
  queue_sound_effect,
  queue_sfx_if_on_screen_global,
  queue_or_reset_looping_sound_effect,
  CODE_BBBB7B,
  CODE_BBBB44,
  CODE_BBBD6B,
  CODE_B3A3B4,
  CODE_B58012,
  CODE_B5801B,
  CODE_BEBD92,
  CODE_BEBDC1,
  CODE_BEBE06,
  CODE_BEBE6D,
  CODE_BEC452,
  CODE_BEC4BA,
  get_kong_state_flags_if_one_kong,
  process_sprite_animation,
  process_current_movement,
  delete_sprite_handle_deallocation,
  delete_sprite_if_offscreen,
  set_player_interaction_global,
  sprite_return_handle_despawn_BE,
  get_sprite_terrain_info,
  get_sprite_terrain_info_define_y,
  get_sprite_terrain_info_y_origin_0,
  get_random_number_2_global,
} from "../../gen/routines";
import { spriteStateDispatch } from "./be1_util";
import {
  g, s, inc, dec, or, and, neg, negate, asr, spriteConst, ptr32, spriteCollisionRoutine, cur,
  sbcImm, cmp,
} from "./w4_be_util";
import { CODE_BEE691 } from "./w4_be_race";

const BANK_BE = 0xbe;
const DOOR_TABLE = L("DATA_BECBB8");
const GATE_BARREL_TABLE = L("gate_barrel_sprite_code_state_table");
const SPARKS_TABLE = L("skull_cart_sparks_sprite_code_state_table");
const CART_TABLE = L("DATA_BECF97");
const SPARK_DX = L("DATA_BECF27");
const SPARK_DY = L("DATA_BECF4D");
const KLANK_SPAWN_IDS = L("DATA_BED024");
const SLOPE_FRAMES = L("DATA_BED9EF");
const RIDER_DX = L("DATA_BEDAB8");
const RIDER_DY = L("DATA_BEDADE");
const PUSH_ACCEL = L("DATA_BEDC5A");
const SLOPE_SPEED = L("DATA_BEDDF1");
const SLOPE_STEP = L("DATA_BEDF6B");
const KLANK_KNOCK_SOUNDS = 0xfdd3ac; // DATA_FDD3AC
const KLANK_RACE_DATA_BANK = 0xfd;

const KART_RACE = 0x0d5c; // Klank karts still racing (& $7F), bit 7 = race finished
const RACE_FLAG_SPRITE = 0x0d5a;
const GATE_STATE = 0x0d58;
const CART_SOUND = 0x19b0;
const SPARK_SLOTS = 0x19ac; // high byte ($19AD) = free spark slots
const RACE_FLAGS = 0x0923;

const sound = (ch: number, id: number) => (ch << 8) | id;
const frame = () => r16(R.active_frame_counter);
const gsf = () => r16(R.game_state_flags);
const timeStopped = () => (r16(R.time_stop_flags) & 0x0004) !== 0;
/** BIT $0D5B: bit 7 of $0D5C (race finished). */
const raceOver = () => (r16(0x0d5b) & 0x8000) !== 0;

function despawn(): void {
  sprite_return_handle_despawn_BE();
}

/** Sub-state dispatch inside a state (`TAX : JMP (table,x)`), carry clear like the handler leaves it. */
function sub(handlers: (() => void)[]): void {
  reg.c = false;
  reg.x = reg.a; // TAX
  const y = reg.y;
  const fn = handlers[reg.a >> 1];
  reg.y = y;
  if (fn) fn();
}

// =============================================================================================
// Haunted hall door ($BECBA0): opens when a skull cart drives into it, then blocks its exit.
// =============================================================================================

/** $BECBA0 — haunted hall door. $42 = the partner door, $44 = cart / spawn script. */
export function haunted_hall_door_sprite_code(): void {
  if (timeStopped()) {
    if (g(cur(), 0x2e) !== 0x0402) return;
  }
  spriteStateDispatch(DOOR_TABLE, [doorState0, CODE_BECCCB, CODE_BECCF9]);
}

function doorState0(): void {
  sub([CODE_BECBD1, CODE_BECBE2, CODE_BECC54, CODE_BECC6D, CODE_BECC84, CODE_BECCB1]);
}

function CODE_BECBD1(): void {
  const x = reg.y;
  reg.y = g(x, 0x44);
  spawn_special_sprite_address();
  if (reg.c) return despawn();
  const me = cur();
  s(me, 0x42, r16(R.alternate_sprite));
  inc(me, 0x2f);
  CODE_BECBE2();
}

function CODE_BECBE2(): void {
  get_current_sprite_clipping();
  reg.a = 0x1000;
  reg.y = 0x0010;
  CODE_BEBD92();
  let x = reg.x;
  if (!reg.c) return CODE_BECCB1();
  inc(x, 0x2f);
  s(x, 0x44, r16(R.colliding_sprite));
  inc(x, 0x46);
  inc(g(x, 0x42), 0x46);
  reg.a = sound(7, C.sound_coaster_gate_open);
  queue_sound_effect();
  const flag = r16(RACE_FLAG_SPRITE);
  if (flag) {
    x = cur();
    if (g(x, 0x06) >= g(flag, 0x06)) or(flag, 0x32, 0x8000);
  }
  // CODE_BECC1C: the cart enters the door: put it behind and slow it down
  const y = cur();
  x = r16(R.colliding_sprite);
  s(x, 0x06, g(x, 0x06) + r16(0xd9) - r16(0xe5));
  if (neg(g(x, 0x24))) s(x, 0x24, 0);
  let a = g(x, 0x20);
  if (neg(a) || a >= 0x0120) a = 0x0120;
  s(x, 0x2c, a - g(x, 0x22));
  s(x, 0x26, g(x, 0x22));
  s(x, 0x2a, g(x, 0x22));
  s(x, 0x20, 0);
  s(x, 0x1c, g(y, 0x0a) + 0x10);
  CODE_BECCB1();
}

function CODE_BECC54(): void {
  const y = reg.y;
  const x = g(y, 0x44);
  const d = g(x, 0x06) - g(y, 0x06);
  if (d >= 0x10) {
    inc(y, 0x46);
    inc(g(y, 0x42), 0x46);
  }
  CODE_BECC9B();
}

function CODE_BECC6D(): void {
  const x = cur();
  inc(x, 0x2f);
  inc(g(x, 0x42), 0x2f);
  reg.a = sound(7, C.sound_coaster_gate_open);
  queue_sound_effect();
  const me = cur();
  CODE_BECCDD(me, g(me, 0x44));
  CODE_BECC84();
}

function CODE_BECC84(): void {
  const x = cur();
  const y = g(x, 0x44);
  let a = g(y, 0x20) - g(y, 0x26);
  if (a < 0) a += 0x100;
  if ((a & 0xffff) < 0x80) inc(x, 0x2f);
  CODE_BECC9B();
}

function CODE_BECC9B(): void {
  const x = cur();
  const y = g(x, 0x44);
  or(y, 0x3e, 0x2000);
  s(y, 0x1c, g(x, 0x0a) + 0x10);
  CODE_BECCB1();
}

function CODE_BECCB1(): void {
  CODE_BBBB7B();
  if (reg.c) {
    s(g(cur(), 0x42), 0x42, 0);
    CODE_BBBB44();
    return;
  }
  process_sprite_animation();
}

/** State 1: the partner door was deleted? Then go too. */
function CODE_BECCCB(): void {
  if (g(reg.y, 0x42) === 0) {
    delete_sprite_handle_deallocation();
    return;
  }
  process_sprite_animation();
}

/** $BECCDD — X = door, Y = cart: the cart drives at the door's speed. */
function CODE_BECCDD(x: number, y: number): void {
  const a = g(x, 0x4c);
  s(y, 0x2a, a);
  s(y, 0x26, a);
  s(y, 0x20, a << 1);
  s(y, 0x2c, 0);
  s(y, 0x1c, g(x, 0x0a) + 0x10);
}

/** State 2: the exit door (moves up/down with the gate state in $0D58). */
function CODE_BECCF9(): void {
  sub([CODE_BECD09, CODE_BECD1B, CODE_BECD39, CODE_BECD58, CODE_BECDBD, CODE_BECDDF]);
}

function CODE_BECD09(): void {
  const y = reg.y;
  const a = g(y, 0x42);
  if (a !== r16(GATE_STATE)) return CODE_BECD58();
  inc(y, 0x2f);
  if (((a - 1) & 0xffff) === 0) return CODE_BECD1B();
  inc(y, 0x2f);
  CODE_BECD39();
}

function CODE_BECD1B(): void {
  const y = reg.y;
  s(y, 0x0a, g(y, 0x0a) - 4);
  const a = (g(y, 0x44) + 4) & 0xffff;
  s(y, 0x44, a);
  if (a !== g(y, 0x46)) return CODE_BECD58();
  CODE_BECD50(y);
}

function CODE_BECD39(): void {
  const y = reg.y;
  s(y, 0x0a, g(y, 0x0a) + 4);
  const a = (g(y, 0x44) - 4) & 0xffff;
  s(y, 0x44, a);
  if (a !== 0) return CODE_BECD58();
  CODE_BECD50(y);
}

function CODE_BECD50(x: number): void {
  inc(x, 0x2f);
  w16(GATE_STATE, r16(GATE_STATE) | 0x8000);
  CODE_BECD58();
}

function CODE_BECD58(): void {
  get_current_sprite_clipping();
  reg.a = 0x1000;
  reg.y = 0x0010;
  CODE_BEBD92();
  if (reg.c) return CODE_BECD7A();
  reg.a = 0x0010;
  spriteCollisionRoutine();
  // CODE_BECD71
  if (reg.c) return CODE_BECDAD();
  process_sprite_animation();
  despawn();
}

/** A cart crashed into the closed door: it bounces back and the Kong is thrown off. */
function CODE_BECD7A(): void {
  reg.a = sound(4, C.sound_barrel_blast);
  queue_sound_effect();
  const x = r16(R.colliding_sprite);
  s(x, 0x2c, 0xfe00 - g(x, 0x26));
  s(x, 0x26, 0);
  s(x, 0x20, 0);
  s(x, 0x4e, 0x0820);
  or(x, 0x3e, 0x8000);
  s(x, 0x42, 0);
  s(x, 0x38, g(x, 0x06));
  reg.a = C.player_interaction_21;
  set_player_interaction_global();
  if (reg.c) return despawn();
  CODE_BECDB3();
}

function CODE_BECDAD(): void {
  CODE_BEC452();
  if (!reg.c) return despawn();
  CODE_BECDB3();
}

function CODE_BECDB3(): void {
  s(cur(), 0x2e, 0x0402);
  despawn();
}

function CODE_BECDBD(): void {
  const y = reg.y;
  if (g(y, 0x44) === g(y, 0x46)) {
    inc(y, 0x2f);
    return despawn();
  }
  s(y, 0x0a, g(y, 0x0a) - 4);
  s(y, 0x44, g(y, 0x44) + 4);
  despawn();
}

function CODE_BECDDF(): void {
  despawn();
}

// =============================================================================================
// Gate barrel ($BECDE2): the +/- barrel that opens or closes the haunted hall gates.
// =============================================================================================

/** $BECDE2 — gate barrel. $4E = 1 opens / 0 closes, $42-$4C = palette fade targets. */
export function gate_barrel_sprite_code(): void {
  spriteStateDispatch(GATE_BARREL_TABLE, [gateBarrelInit, gateBarrelWait, gateBarrelFlash]);
}

function gateBarrelInit(): void {
  const y = reg.y;
  w16(GATE_STATE, g(y, 0x4e) ^ 0x8001);
  inc(y, 0x2e);
  reg.x = g(y, 0x42);
  reg.a = g(y, 0x44);
  CODE_B3A3B4();
  process_sprite_animation();
}

function gateBarrelWait(): void {
  get_current_sprite_clipping();
  reg.a = 0;
  CODE_BEBE6D();
  if (!reg.c) {
    process_sprite_animation();
    return despawn();
  }
  // ..collision_happened: the barrel vanishes, its effect starts
  let x = reg.x;
  inc(x, 0x2e);
  s(x, 0x42, 1);
  w16(GATE_STATE, g(x, 0x4e));
  const type = g(x, 0x00);
  delete_sprite_handle_deallocation();
  x = cur();
  s(x, 0x1a, 0);
  s(x, 0x18, 0);
  s(x, 0x16, 0);
  s(x, 0x00, type);
  CODE_BECE7E();
  x = cur();
  reg.a = g(x, 0x4e) ? sound(4, C.sound_barrel_good) : sound(4, C.sound_barrel_bad);
  queue_sound_effect();
  gateBarrelFlash();
}

/** Flash the palette between the two targets every 4 frames until $0D58 says done. */
function gateBarrelFlash(): void {
  const x = cur();
  dec(x, 0x42);
  const a = g(x, 0x42);
  if (a & 0x0003) return;
  const y = x;
  if (r16(GATE_STATE) & 0x8000) {
    s(x, 0x00, 0);
  } else if (!(a & 0x0004)) {
    reg.x = g(y, 0x4a);
    reg.a = g(y, 0x4c);
    CODE_B3A3B4();
    return;
  }
  reg.x = g(y, 0x46);
  reg.a = g(y, 0x48);
  CODE_B3A3B4();
}

/** $BECE7E — the two barrel-break effect sprites. */
export function CODE_BECE7E(): void {
  reg.y = C.special_sprite_spawn_id_0068;
  spawn_no_gfx_special_sprite_index();
  reg.y = C.special_sprite_spawn_id_006A;
  spawn_no_gfx_special_sprite_index();
}

// =============================================================================================
// Skull cart sparks ($BECE8D)
// =============================================================================================

/** $BECE8D — sparks under a skull cart's wheels. $42 = the cart, $44 = offset table index. */
export function skull_cart_sparks_sprite_code(): void {
  spriteStateDispatch(SPARKS_TABLE, [sparksSpawn, sparksRun]);
}

function sparksSpawn(): void {
  const y = reg.y;
  if (g(y, 0x46) !== 0) {
    const x = g(y, 0x42);
    reg.x = x;
    if (g(x, 0x36) !== g(x, 0x40) || g(x, 0x0e) !== 0) return sparksRun();
    s(y, 0x46, 0);
  }
  CODE_BEE010();
  if (reg.c) return sparksRun();
  const x = r16(R.alternate_sprite);
  const me = cur();
  const st = (g(me, 0x2e) + 1) & 0xffff;
  s(me, 0x2e, st);
  s(x, 0x2e, st);
  const cart = g(me, 0x42);
  s(x, 0x42, cart);
  s(cart, 0x48, x);
  s(x, 0x44, 0x13);
  reg.x = x;
  CODE_BECEE5();
  sparksRun();
}

function sparksRun(): void {
  process_sprite_animation();
  const x = reg.x;
  if (g(x, 0x00) !== 0) {
    if (g(x, 0x42) !== 0) return;
    delete_sprite_if_offscreen();
    if (!reg.c) return;
  }
  w16(R.RAM_19AD, r16(R.RAM_19AD) + 1); // one spark slot free again
}

/** $BECEE5 — X = spark: stick it to its cart's wheel for the current slope frame. */
export function CODE_BECEE5(): void {
  reg.db = BANK_BE;
  const x = reg.x;
  let y = g(x, 0x42);
  reg.y = y;
  if (g(x, 0x0e) !== 0) return;
  y = ((g(y, 0x36) & 0xff) + g(x, 0x44)) & 0xffff;
  const dx = sext(rom16(SPARK_DX + y));
  w16(0x32, dx);
  const dy = sext(rom16(SPARK_DY + y));
  w16(0x34, dy);
  reg.a = dy;
  y = g(x, 0x42);
  reg.y = y;
  s(x, 0x06, g(y, 0x06) + dx);
  s(x, 0x0a, g(y, 0x0a) + dy);
  reg.a = g(x, 0x0a);
}

/** CODE_BECF1A: sign-extend the low byte. */
const sext = (v: number) => (v & 0x80 ? v | 0xff00 : v & 0x00ff);

// =============================================================================================
// Skull cart ($BECF73)
// =============================================================================================

/** $BECF73 — skull cart (Haunted Hall) / Klank's kart (Rickety Race). */
export function skull_cart_sprite_code(): void {
  if (timeStopped()) {
    const x = cur();
    if (!(g(x, 0x3e) & 0x8000)) return;
    if (!(g(x, 0x4e) & 0xff00) && g(x, 0x06) >= g(x, 0x38)) return;
  }
  spriteStateDispatch(CART_TABLE, [
    cartState0, cartState1, cartState2, cartState3, cartState4, CODE_BED791,
  ]);
}

// --- state 0: placement / race start --------------------------------------------------------

function cartState0(): void {
  sub([CODE_BECFB8, CODE_BECFAF, CODE_BECFCD, CODE_BECFE2]);
}

function CODE_BECFAF(): void {
  const x = cur();
  if (r16(R.level_entrance_number) !== g(x, 0x42)) {
    delete_sprite_handle_deallocation();
    return;
  }
  CODE_BECFB8();
}

function CODE_BECFB8(): void {
  const x = cur();
  s(x, 0x42, 0);
  s(x, 0x44, 0);
  CODE_BED7C7(x, g(x, 0x46));
  CODE_BED794();
}

/** First race kart: spawn the first Klank. */
function CODE_BECFCD(): void {
  w16(KART_RACE, 0);
  reg.a = 0;
  CODE_BECFFD();
  if (reg.c) return;
  w16(0x19ba, r16(0x19ba) + 1);
  CODE_BBBD6B();
}

/** Other race karts: spawn a Klank with its place number. */
function CODE_BECFE2(): void {
  reg.a = ((r16(KART_RACE) & 0x7f) - 1) & 0xffff;
  CODE_BECFFD();
  if (reg.c) return;
  const y = r16(R.alternate_sprite);
  s(y, 0x4e, (r16(KART_RACE) & 0x7f) - 1);
}

/** $BECFFD — A = Klank index: spawn him (carry set if no slot) and seat him in the kart. */
function CODE_BECFFD(): void {
  reg.x = reg.a;
  reg.y = rom8((KLANK_SPAWN_IDS + reg.a) & 0xffffff);
  spawn_special_sprite_index();
  if (reg.c) return;
  const x = cur();
  const y = r16(R.alternate_sprite);
  s(x, 0x42, y);
  s(x, 0x44, 0);
  s(y, 0x42, x);
  s(y, 0x4e, 0);
  CODE_BED7C7(x, g(x, 0x46));
  s(x, 0x30, 0);
  reg.x = x;
  reg.y = y;
}

// --- state 1: Haunted Hall cart ---------------------------------------------------------------

function cartState1(): void {
  sub([CODE_BED03C, CODE_BED042, CODE_BED05C, CODE_BED08C, CODE_BED0CE]);
}

function CODE_BED03C(): void {
  inc(reg.y, 0x2f);
  CODE_BEDE09();
  CODE_BED042();
}

/** Empty cart: wait for a Kong to land in it. */
function CODE_BED042(): void {
  CODE_BEDB50();
  CODE_BED956();
  const a = CODE_BED7F9();
  if (reg.c && a === 0) {
    const x = cur();
    w16(R.ridden_skull_cart_sprite, x);
    inc(x, 0x2f);
    CODE_BED9FD();
  }
  CODE_BED794();
}

/** Ridden cart. */
function CODE_BED05C(): void {
  CODE_BEDB50();
  CODE_BED2CA();
  CODE_BED914();
  const a = CODE_BED8DA();
  if (reg.c) {
    CODE_BED94C(a + 1);
    return CODE_BED794();
  }
  CODE_BED071();
}

function CODE_BED071(): void {
  CODE_BEDCA5();
  CODE_BEDE09();
  CODE_BED956();
  CODE_BED7F9();
  CODE_BEE024();
  CODE_BED9FD();
  CODE_BEDBE2();
  CODE_BEDF8A();
  CODE_BED794();
}

/** The Kong jumped out of the cart. */
function CODE_BED08C(): void {
  CODE_BEDB50();
  CODE_BED2CA();
  CODE_BED914();
  let a = CODE_BED8DA();
  if (reg.c) {
    a = (4 - a) & 0xffff; // EOR #$FFFF : ADC #$0004 with carry set
    CODE_BED94C(a);
    if (a === 4) return CODE_BED0D4();
    return CODE_BED7A8();
  }
  CODE_BED0AB();
}

function CODE_BED0AB(): void {
  CODE_BEDCA5();
  CODE_BEDE09();
  CODE_BED956();
  const a = CODE_BED7F9();
  if (reg.c) {
    if (a !== 0) return CODE_BED7A8();
    const x = cur();
    w16(R.ridden_skull_cart_sprite, x);
    dec(x, 0x2f);
  }
  CODE_BEE024();
  CODE_BED9FD();
  CODE_BEDF8A();
  CODE_BED7A8();
}

function CODE_BED0CE(): void {
  CODE_BEDB50();
  CODE_BED2CA();
  CODE_BED0D4();
}

/** Put the Kong back in the cart (team swap / reentry). */
function CODE_BED0D4(): void {
  if (gsf() & 0x0100) return;
  const x = cur();
  const y = r16(R.active_kong_sprite);
  s(y, 0x42, x);
  s(x, 0x42, y | 0x8000);
  reg.a = C.player_interaction_16;
  set_player_interaction_global();
  if (!reg.c) dec(cur(), 0x2f);
}

// --- state 2: Haunted Hall cart with the ghost timer / level end ------------------------------

function cartState2(): void {
  sub([CODE_BED109, CODE_BED10F, CODE_BED129, CODE_BED172, CODE_BED1B1, CODE_BED1CE]);
}

function CODE_BED109(): void {
  inc(reg.y, 0x2f);
  CODE_BEDE09();
  CODE_BED10F();
}

function CODE_BED10F(): void {
  CODE_BEDB50();
  CODE_BED956();
  const a = CODE_BED7F9();
  if (reg.c && a === 0) {
    const x = cur();
    w16(R.ridden_skull_cart_sprite, x);
    inc(x, 0x2f);
  }
  CODE_BED9FD();
  CODE_BED794();
}

function CODE_BED129(): void {
  const y = reg.y;
  // BIT $0923 : BCS — never taken: the state handler leaves the carry clear
  if (g(y, 0x06) < 0x03f0) or(y, 0x3e, 0x0800);
  CODE_BED13F();
}

function CODE_BED13F(): void {
  CODE_BEDB50();
  CODE_BED2CA();
  CODE_BED914();
  const a = CODE_BED8DA();
  if (reg.c) {
    CODE_BED94C(a + 1);
    return CODE_BED794();
  }
  CODE_BED154();
}

function CODE_BED154(): void {
  CODE_BEDC2B();
  CODE_BEDCA5();
  CODE_BEDE09();
  CODE_BED956();
  CODE_BED7F9();
  CODE_BEE024();
  CODE_BED9FD();
  CODE_BEDB9C();
  CODE_BEDF8A();
  CODE_BED794();
}

/** Jumping cart. */
function CODE_BED172(): void {
  CODE_BEDB50();
  CODE_BED2CA();
  CODE_BED914();
  CODE_BED8DA();
  if (reg.c) {
    CODE_BED94C(4);
    return CODE_BED794();
  }
  CODE_BED189();
}

function CODE_BED189(): void {
  CODE_BEDC64();
  landingAndDrive();
}

/** CODE_BED18C / CODE_BED270: move, and land when the terrain is reached. */
function landingAndDrive(): void {
  CODE_BEDE09();
  if (reg.c) {
    const x = cur();
    dec(x, 0x2f);
    s(g(x, 0x42), 0x40, 0);
    reg.a = sound(6, C.sound_coaster_land);
    queue_sound_effect();
  }
  CODE_BED956();
  CODE_BEE024();
  CODE_BED9FD();
  CODE_BEDF8A();
  CODE_BED794();
}

function CODE_BED1B1(): void {
  CODE_BEDB50();
  CODE_BED956();
  const a = CODE_BED7F9();
  if (reg.c) {
    reg.c = (a & 1) !== 0;
    CODE_BED94C(reg.c ? 3 : 5);
  }
  CODE_BED9FD();
  CODE_BED794();
}

function CODE_BED1CE(): void {
  const y = reg.y;
  const v = g(y, 0x24);
  if (!neg(v) || v >= 0xfc00) s(y, 0x24, 0xfc00);
  CODE_BED94C(3);
  CODE_BED172();
}

// --- state 3: Rickety Race kart ---------------------------------------------------------------

function cartState3(): void {
  sub([CODE_BED1F6, CODE_BED1FC, CODE_BED226, CODE_BED256, CODE_BED295, CODE_BED2B2]);
}

function CODE_BED1F6(): void {
  inc(reg.y, 0x2f);
  CODE_BEDE09();
  CODE_BED1FC();
}

function CODE_BED1FC(): void {
  CODE_BEDB50();
  CODE_BED956();
  CODE_BED7F9();
  if (reg.c) {
    const x = cur();
    const both = gsf() & 0x4000;
    // with two Kongs, both must be aboard
    if (!both || (!neg(g(x, 0x42) - 1) && !neg(g(x, 0x44) - 1))) {
      w16(R.ridden_skull_cart_sprite, x);
      inc(x, 0x2f);
    }
  }
  CODE_BED9FD();
  CODE_BED794();
}

function CODE_BED226(): void {
  CODE_BEDB50();
  CODE_BED2CA();
  CODE_BED914();
  const a = CODE_BED8DA();
  if (reg.c) {
    CODE_BED94C(a + 1);
    return CODE_BED794();
  }
  CODE_BED23B();
}

function CODE_BED23B(): void {
  CODE_BEDCA5();
  CODE_BEDE09();
  CODE_BED956();
  CODE_BED7F9();
  CODE_BEE024();
  CODE_BED9FD();
  CODE_BEDB9C();
  CODE_BEDF8A();
  CODE_BED794();
}

function CODE_BED256(): void {
  CODE_BEDB50();
  CODE_BED2CA();
  CODE_BED914();
  CODE_BED8DA();
  if (reg.c) {
    CODE_BED94C(4);
    return CODE_BED794();
  }
  CODE_BED26D();
}

function CODE_BED26D(): void {
  CODE_BEDC64();
  landingAndDrive();
}

function CODE_BED295(): void {
  CODE_BED1B1();
}

function CODE_BED2B2(): void {
  const y = reg.y;
  const v = g(y, 0x24);
  if (!neg(v) || v >= 0xfc00) s(y, 0x24, 0xfc00);
  CODE_BED94C(3);
  CODE_BED256();
}

/** $BED2CA — the cart's rolling sound: start it, switch echo on landing, pitch by speed. */
function CODE_BED2CA(): void {
  if (raceOver()) return;
  const x = cur();
  const y = (g(x, 0x0e) ? 1 : 0) | 0x8000;
  reg.y = y;
  const playing = r16(CART_SOUND);
  if (playing === 0) {
    // CODE_BED307
    reg.a = sound(5, C.sound_coaster_move);
    reg.c = true;
    queue_or_reset_looping_sound_effect();
    if (!reg.c || !reg.z) return;
    w16(CART_SOUND, reg.y);
    w16(R.last_spc_command_transfer_time, frame());
    return;
  }
  w16(CART_SOUND, y);
  if (y !== playing) {
    // airborne (bit 0) or back on the rails: change the echo
    reg.a = y & 1 ? 0x0032 : 0x00c8;
    CODE_B58012();
    w16(R.last_spc_command_transfer_time, frame());
    return;
  }
  // CODE_BED31C: pitch follows the speed every 4 frames
  if (frame() & 0x0003) return;
  let v = g(cur(), 0x20);
  if (neg(v)) v = negate(v);
  if (v >= 0x0780) v = 0x0780;
  let c = v >= 0x02c0;
  if (!c) v = 0x02c0;
  c = ((v >> 2) & 1) !== 0; // the last LSR's carry
  reg.a = ((v >> 3) - 0x80 - (c ? 0 : 1)) & 0xffff;
  CODE_B5801B();
  w16(R.last_spc_command_transfer_time, frame());
}

// --- state 4: Klank's kart (driven by the race script) ----------------------------------------

function cartState4(): void {
  sub([CODE_BED357, CODE_BED377, CODE_BED3A6]);
}

function CODE_BED357(): void {
  CODE_BED6A9();
  CODE_BED44C();
  if (!reg.c) {
    CODE_BED671();
    CODE_BEDE09();
    CODE_BED3CB();
    CODE_BED956();
    CODE_BED9FD();
    CODE_BED639();
    CODE_BEDF8A();
  }
  CODE_BED604();
}

function CODE_BED377(): void {
  CODE_BED6A9();
  CODE_BED44C();
  if (!reg.c) {
    CODE_BED67F();
    CODE_BEDE09();
    if (reg.c) {
      const x = cur();
      dec(x, 0x2f);
      and(x, 0x3e, 0xfdff);
      reg.a = sound(6, C.sound_coaster_land);
      queue_sfx_if_on_screen_global();
    }
    CODE_BED3CB();
    CODE_BED956();
    CODE_BED9FD();
    CODE_BEDF8A();
  }
  CODE_BED604();
}

/** Knocked-out kart: falls with the slope frame winding down. */
function CODE_BED3A6(): void {
  process_current_movement();
  const x = reg.x;
  if (!neg(g(x, 0x24))) {
    dec(x, 0x3a);
    if (neg(g(x, 0x3a))) {
      s(x, 0x3a, 2);
      const a = g(x, 0x36);
      if (a !== 0) {
        dec(x, 0x36);
        s(x, 0x1a, (a << 2) + C.cart_slope_frame1 + ((a >> 14) & 1));
      }
    }
  }
  delete_sprite_if_offscreen();
}

/** $BED3CB — rubber band: Klank's kart keeps up with the player's cart. */
function CODE_BED3CB(): void {
  let ridden = r16(R.ridden_skull_cart_sprite);
  if (ridden === 0 || neg(g(ridden, 0x0e))) return;
  const x = cur();
  let y = g(x, 0x42);
  if (g(y, 0x4e) === 0) return;
  let a: number;
  if ((r16(KART_RACE) & 0x7f) >= g(y, 0x4e)) {
    a = 0;
    if (neg(g(x, 0x0e))) {
      a = (g(y, 0x4c) + 1) & 0xffff;
      if (a >= 0x1e) {
        CODE_BED425();
        a = 0x1e;
      }
    }
    s(y, 0x4c, a);
    ridden = r16(R.ridden_skull_cart_sprite);
    if (g(x, 0x06) >= g(ridden, 0x06)) return;
    CODE_BED425();
  }
  // CODE_BED40F
  ridden = r16(R.ridden_skull_cart_sprite);
  a = ridden ? (g(ridden, 0x20) - 0x0100) & 0xffff : 0;
  s(x, 0x22, a);
  s(x, 0x28, a);
  s(x, 0x2a, a);
  s(x, 0x2c, 0);
  void y;
}

/** $BED425 — the player passed this Klank: he loses his place. */
function CODE_BED425(): void {
  if (r16(RACE_FLAGS) & 0x4000) return;
  const x = cur();
  const y = g(x, 0x42);
  const a = r16(KART_RACE) & 0x7f;
  if (a <= g(y, 0x4e)) return;
  s(y, 0x4e, a);
  w16(KART_RACE, r16(KART_RACE) - 1);
  w16(RACE_FLAGS, r16(RACE_FLAGS) | 0x8003);
}

/** $BED44C — Klank's kart against the player's cart: bump, knock or jump on. Carry = handled. */
function CODE_BED44C(): void {
  const ridden = r16(R.ridden_skull_cart_sprite);
  if (ridden === 0) {
    reg.c = false;
    return;
  }
  reg.y = ridden;
  CODE_BEBDC1();
  if (!reg.c) {
    reg.c = false;
    return;
  }
  const x = r16(R.colliding_sprite);
  const y = cur();
  if (!neg(g(x, 0x24)) && !(g(x, 0x1e) & 0x0001)) {
    // the player's cart lands on the kart from above
    if (((g(x, 0x0a) - 0x10) & 0xffff) >= g(y, 0x0a)) {
      reg.c = false;
      return;
    }
    s(x, 0x24, 0xf900);
    let a = g(x, 0x40);
    if (a < 0x0e) a = 0x0e;
    s(x, 0x40, a);
    s(y, 0x20, 0x0200);
    return CODE_BED511();
  }
  // CODE_BED48F
  if (r16(RACE_FLAGS) & 0x4000) {
    const a = (g(x, 0x20) + 0x0100) & 0xffff;
    s(y, 0x22, a);
    s(y, 0x28, a);
    s(y, 0x2a, a);
    s(y, 0x20, a);
    reg.c = false;
    return;
  }
  if (g(x, 0x06) >= g(y, 0x06)) return CODE_BED511();
  let a = g(y, 0x20);
  if (neg(a) || a < 0x0100) a = 0x0100;
  if (a >= 0x0800) a = 0x0800;
  a = ((0x1800 - a) & 0xffff) >> 2;
  w16(0x5e, a);
  const d = (g(x, 0x20) - g(y, 0x20)) & 0xffff;
  if (neg(d)) {
    reg.c = false;
    return;
  }
  if (((d << 1) & 0xffff) >= r16(0x5e)) return CODE_BED4DF();
  CODE_BED569();
}

/** The player rams Klank from behind fast enough: Klank's kart is knocked out. */
function CODE_BED4DF(): void {
  CODE_BEBE06();
  const x = r16(R.colliding_sprite);
  const y = cur();
  s(y, 0x20, ((g(x, 0x20) + g(y, 0x20)) & 0xffff) >> 1);
  s(x, 0x1c, g(x, 0x0a));
  const a = (g(x, 0x20) - 0x0100) & 0xffff;
  s(x, 0x2a, a);
  s(x, 0x26, a);
  s(x, 0x20, a);
  s(x, 0x2c, 0xfe80);
  s(x, 0x4e, 0x0810);
  or(x, 0x3e, 0x8000);
  CODE_BED511();
}

/** Klank is defeated: he flies off, the kart falls. Carry set. */
function CODE_BED511(): void {
  const y = cur();
  const x = g(y, 0x42);
  s(x, 0x42, 0);
  inc(x, 0x2e);
  CODE_BED425();
  s(y, 0x54, g(x, 0x54));
  s(y, 0x42, 0);
  s(y, 0x2e, 0x0204);
  s(y, 0x52, 4);
  s(y, 0x3a, 4);
  let a = g(y, 0x20);
  const c = a >= 0x0500;
  if (c) a = 0x0500;
  s(y, 0x20, a);
  s(y, 0x26, a);
  s(y, 0x2c, 0);
  a = ((a ^ 0xffff) - 0x0300 - (c ? 0 : 1)) & 0xffff;
  if (a >= 0xfb00) a = 0xfb00;
  s(y, 0x24, a);
  const left = r16(KART_RACE) & 0x7f;
  if (left) {
    reg.a = rom8(KLANK_KNOCK_SOUNDS + left);
    CODE_BEE691();
  }
  CODE_BBBD6B();
  reg.c = true;
}

/** Bump from behind (too slow) or the side: both carts bounce. Carry set. */
function CODE_BED569(): void {
  CODE_BEBE06();
  const y = r16(R.colliding_sprite);
  const x = cur();
  let a = (g(y, 0x20) - g(x, 0x20)) & 0xffff;
  if (a < 0x0200) a = 0x0200;
  w16(0x32, a);
  a = ((a >> 2) - r16(0x32)) & 0xffff;
  w16(0x32, a);
  if ((g(x, 0x2f) & 0xff) === 0 && g(x, 0x1e) & 0x0001) {
    s(x, 0x1e, g(x, 0x1e) ^ 0x0001);
    s(x, 0x24, r16(0x32) << 1);
    or(x, 0x3e, 0x0200);
    inc(x, 0x2f);
  }
  // CODE_BED5A7
  s(x, 0x2c, g(x, 0x2c) - r16(0x32));
  s(x, 0x4e, 0x1e08);
  or(x, 0x3e, 0x8000);
  w16(0x34, g(x, 0x20));
  s(x, 0x20, g(y, 0x20));
  a = (g(y, 0x2c) + r16(0x32)) & 0xffff;
  s(y, 0x2c, a);
  a = (a + g(y, 0x2a)) & 0xffff;
  w16(0x32, a);
  a = (a - g(y, 0x22)) & 0xffff;
  if (neg(a)) {
    s(y, 0x2c, a);
    s(y, 0x2a, g(y, 0x22));
  }
  s(y, 0x4e, 0x1e08);
  or(y, 0x3e, 0x8000);
  s(y, 0x20, r16(0x34));
  reg.a = sound(7, C.sound_knock);
  queue_sound_effect();
  reg.a = 0x0019;
  CODE_BEE691();
  reg.c = true;
}

/** $BED604 — Klank's kart: despawn when off screen (always once the race is lost/over). */
function CODE_BED604(): void {
  const x = cur();
  if (!(g(x, 0x3e) & 0x1000)) {
    const race = r16(KART_RACE);
    if (race === 0) return;
    if ((race & 0x7f) >= g(g(x, 0x42), 0x4e)) return;
  }
  CODE_BBBB7B();
  if (!reg.c) return;
  const me = cur();
  s(g(me, 0x42), 0x42, 0);
  CODE_BBBB44();
  w16(RACE_FLAGS, r16(RACE_FLAGS) & ~0x0002);
}

/** $BED639 — scripted jump of Klank's kart. */
function CODE_BED639(): void {
  const x = cur();
  if (!(g(x, 0x3e) & 0x0400)) return;
  const a = g(x, 0x1e);
  if (!(a & 0x0101)) return;
  s(x, 0x1e, a & 0xfffe);
  inc(x, 0x2f);
  s(x, 0x24, spriteConst(0));
  let f = g(x, 0x40);
  if (f < 0x0e) f = 0x0e;
  s(x, 0x40, f);
  and(x, 0x3e, 0xfbff);
  reg.a = sound(6, C.sound_coaster_jump);
  queue_sfx_if_on_screen_global();
}

function CODE_BED671(): void {
  const x = cur();
  const keep = g(x, 0x50);
  CODE_BEDCA5();
  s(cur(), 0x50, keep);
}

function CODE_BED67F(): void {
  let x = cur();
  if (!neg(g(x, 0x24))) {
    const keep = g(x, 0x50);
    CODE_BEDCD8(5);
    s(cur(), 0x50, keep);
  }
  x = cur();
  if (neg(g(x, 0x24)) && g(x, 0x3e) & 0x0220) return CODE_BEDCC3(2);
  CODE_BEDCC0();
}

/** $BED6A9 — Klank's kart: run the race script entries the kart has reached. */
function CODE_BED6A9(): void {
  const x = cur();
  if (raceOver() && !(frame() & 0x007f)) or(x, 0x3e, 0x0100);
  if (g(x, 0x4a) < g(x, 0x06)) return;
  w16(0x32, g(x, 0x5c));
  let bank = r16(R.current_sprite_constants_bank);
  if (r16(R.level_number) === C.level_rickety_race) bank = KLANK_RACE_DATA_BANK;
  w16(0x34, bank);
  if (ptr32(0) >= g(x, 0x4a)) return;
  let y = 2;
  const a = ptr32(2);
  if (a & 0x0800) {
    // add to the acceleration
    y = 4;
    let v = ptr32(4);
    if (v) v = (v + g(x, 0x50)) & 0xffff;
    s(x, 0x50, v);
  } else if (a & 0x0080) {
    // Klank's animation
    s(x, 0x3e, a ^ g(x, 0x3e));
    y = 4;
    const k = g(x, 0x42);
    s(k, 0x10, ptr32(4));
    s(k, 0x04, ptr32(0) + 0x0200);
  } else if (a & 0x0040) {
    // new speed with a deceleration
    y = 4;
    s(x, 0x2a, ptr32(4));
    s(x, 0x1c, g(x, 0x0a));
    s(x, 0x2c, g(x, 0x20) - g(x, 0x2a));
    y = 6;
    s(x, 0x4e, ptr32(6));
    or(x, 0x3e, 0x8000);
  } else if (a & 0x0020) {
    // jump to another script position
    s(x, 0x5c, ptr32(4));
    return;
  } else {
    s(x, 0x3e, a ^ g(x, 0x3e));
  }
  // CODE_BED6F9
  y++;
  s(x, 0x5c, y + g(x, 0x5c) + 1);
}

/** $BED74E — X = Klank's kart: find its spawn entry in the race script and set its speed. */
export function set_klank_race_kart_velocity(): void {
  const x = reg.x;
  w16(0x32, g(x, 0x5c));
  w16(0x34, KLANK_RACE_DATA_BANK);
  let y = 0;
  for (;;) {
    if (ptr32(y) >= g(x, 0x06)) break;
    y += 2;
    const action = ptr32(y);
    y += 2;
    if (!(action & 0x08e0)) continue;
    y += 2;
    if (!(action & 0x0040)) continue;
    y += 2;
  }
  y += 4;
  s(x, 0x2a, ptr32(y));
  s(x, 0x1c, g(x, 0x0a));
  s(x, 0x20, g(x, 0x0a));
  s(x, 0x2c, 0);
  const a = (y + 4 + g(x, 0x5c)) & 0xffff;
  s(x, 0x5c, a);
  reg.a = a;
  reg.y = y;
}

function CODE_BED791(): void {}

// --- common exits -----------------------------------------------------------------------------

/** $BED794 — clear the per-frame flags; despawn if not the ridden cart. */
function CODE_BED794(): void {
  const x = cur();
  and(x, 0x3e, 0xd7ff);
  if (x === r16(R.ridden_skull_cart_sprite)) return;
  despawn();
}

/** $BED7A8 — same while a Kong that jumped out still owns the cart. */
function CODE_BED7A8(): void {
  const x = cur();
  and(x, 0x3e, 0xd7ff);
  const a = g(x, 0x42);
  if (a !== 0) {
    if (!neg(a)) return;
    if (x === g(a & 0x7fff, 0x42)) return;
  }
  despawn();
}

/** $BED7C7 — X = cart, A = state: initialise the cart. */
export function CODE_BED7C7(x: number, a: number): void {
  s(x, 0x2e, a);
  s(x, 0x46, 0);
  s(x, 0x48, 0);
  s(x, 0x30, 0x1000);
  s(x, 0x3e, (gsf() & 0x4000) | g(x, 0x3e));
  s(x, 0x36, 0x8000);
  s(x, 0x1c, g(x, 0x0a));
  s(x, 0x20, 0);
  s(x, 0x26, 0);
  s(x, 0x50, 0);
  s(x, 0x24, 0x0100);
  s(x, 0x4a, g(x, 0x06));
  s(x, 0x4c, g(x, 0x0a));
}

/**
 * $BED7F9 — does a Kong land in the cart? Carry set when one got in: A = 0 the active Kong
 * ($42), A = 1 the other Kong ($44).
 */
function CODE_BED7F9(): number {
  if (timeStopped()) {
    reg.c = false;
    return 0;
  }
  const x = cur();
  if (!neg(g(x, 0x42) - 1)) return CODE_BED889(x);
  get_current_sprite_clipping();
  reg.a = 0x0010;
  spriteCollisionRoutine();
  if (!reg.c) return fail();
  let y = r16(R.colliding_sprite);
  if (neg(g(y, 0x24))) return fail();
  if (g(x, 0x0a) < g(y, 0x0a)) return fail();
  y = r16(R.colliding_sprite);
  if (y === r16(R.active_kong_sprite)) {
    // CODE_BED859
    reg.x = x;
    reg.a = C.player_interaction_15;
    set_player_interaction_global();
    if (reg.c) return fail();
    w16(R.interaction_RAM_0A86, reg.x);
    w16(R.interaction_RAM_0A88, r16(R.colliding_sprite));
    s(reg.x, 0x42, r16(R.colliding_sprite));
    const kcv = r16(R.active_kong_control_variables);
    reg.c = true;
    s(kcv, 0x22, sbcImm(frame(), 0x0020));
    const me = cur();
    s(me, 0x38, g(me, 0x06));
    s(me, 0x3c, g(me, 0x0a));
    reg.c = true;
    return 0;
  }
  const st = g(y, 0x2e);
  if (st === 0x1f || st === 0x21) return fail();
  reg.x = x;
  reg.a = C.player_interaction_15;
  set_player_interaction_global();
  if (reg.c) return fail();
  w16(R.interaction_RAM_0A86, reg.x);
  w16(R.interaction_RAM_0A88, r16(R.colliding_sprite));
  s(reg.x, 0x44, r16(R.colliding_sprite));
  reg.c = true;
  return 1;
}

function fail(): number {
  reg.c = false;
  return 0;
}

/** CODE_BED889 — the active Kong rides: carry the team-up partner along and let it board. */
function CODE_BED889(x: number): number {
  if (!(gsf() & 0x4000)) return fail();
  if (!neg(g(x, 0x44) - 1)) return fail();
  if (!neg(g(x, 0x44))) {
    const y = r16(R.inactive_kong_sprite);
    s(y, 0x06, g(x, 0x06) - g(x, 0x38) + g(y, 0x06));
    s(y, 0x0a, g(x, 0x0a) - g(x, 0x3c) + g(y, 0x0a));
  }
  reg.y = r16(R.inactive_kong_sprite);
  CODE_BEBDC1();
  if (!reg.c) return fail();
  reg.a = C.player_interaction_15;
  set_player_interaction_global();
  if (reg.c) return fail();
  w16(R.interaction_RAM_0A86, reg.x);
  w16(R.interaction_RAM_0A88, r16(R.inactive_kong_sprite));
  s(reg.x, 0x44, r16(R.inactive_kong_sprite));
  reg.c = true;
  return 1;
}

/**
 * $BED8DA — the team changed (one/two Kongs): carry set when it did, A = 0 lost the partner,
 * 1 got one. Entered with the carry of CODE_BED914 (its SBC has no SEC).
 */
function CODE_BED8DA(): number {
  const x = cur();
  const diff = (g(x, 0x3e) ^ gsf()) & 0x4000;
  if (!diff) {
    reg.c = false;
    return 0;
  }
  const v = diff ^ g(x, 0x3e);
  s(x, 0x3e, v);
  if (!(v & 0x4000)) {
    s(x, 0x42, 0);
    s(x, 0x44, 0);
    const t = sbcImm(frame(), 0x0020);
    s(r16(R.active_kong_control_variables), 0x22, t);
    reg.c = true;
    return 0;
  }
  s(x, 0x38, g(x, 0x06));
  s(x, 0x3c, g(x, 0x0a));
  reg.c = true;
  return 1;
}

/** $BED914 — the Kong left the cart by itself (his state no longer rides). */
function CODE_BED914(): void {
  get_kong_state_flags_if_one_kong();
  if (reg.c) return;
  const x = cur();
  s(x, 0x42, 0);
  s(r16(R.active_kong_control_variables), 0x22, sbcImm(frame(), 0x0020));
  s(x, 0x30, 0);
  reg.a = 1;
}

/** $BED94C — set the sub state (8-bit store). */
function CODE_BED94C(a: number): void {
  w8(cur() + 0x2f, a & 0xff);
  reg.a = a & 0xffff;
}

/** $BED956 — ease the slope graphic toward the terrain's slope. */
function CODE_BED956(): void {
  reg.db = BANK_BE;
  const x = cur();
  const t = g(x, 0x10) & 0x8007;
  const idx = ((t << 1) | (t >= 0x8000 ? 1 : 0)) & 0xffff;
  const target = rom16(SLOPE_FRAMES + idx) & 0xff;
  let set36 = false;
  if (neg(g(x, 0x36))) {
    s(x, 0x36, target); // first frame: snap
    set36 = true;
  } else {
    w16(0x32, target);
    let step = true;
    if (g(x, 0x0e) !== 0) {
      // in the air
      s(x, 0x3a, 0);
      if (!neg(g(x, 0x24))) {
        if (g(x, 0x0e) >= 0x20) step = false;
        else {
          s(x, 0x40, r16(0x32));
          if (((r16(0x32) - g(x, 0x36)) & 0xffff) >= 0xfffc) step = false;
        }
        if (step) {
          approach(x);
          approach(x);
        }
        return finish(x);
      }
      approach(x);
      approach(x);
      return finish(x);
    }
    // CODE_BED992: on the ground
    s(x, 0x40, r16(0x32));
    const d = (r16(0x32) - g(x, 0x36)) & 0xffff;
    if (d < 0x0003 || d >= 0xfffd) {
      dec(x, 0x3a);
      if (!neg(g(x, 0x3a))) return finish(x);
    }
    // CODE_BED9A7
    if (g(x, 0x36) === 0x0009 && (g(x, 0x52) & 7) < 2 && (g(x, 0x10) & 7) < 2) return finish(x);
    approach(x);
    return finish(x);
  }
  if (set36) delay(x);
  finish(x);
}

/** CODE_BED9C2: one step of $36 toward $40, then the delay. */
function approach(x: number): void {
  const a = g(x, 0x36);
  const t = g(x, 0x40);
  if (a === t) return;
  if (a >= t) dec(x, 0x36);
  else inc(x, 0x36);
  delay(x);
}

/** CODE_BED9D4 */
function delay(x: number): void {
  s(x, 0x3a, g(x, 0x0e) >= 0x30 ? 8 : 3);
}

/** CODE_BED9E3 */
function finish(x0: number): void {
  void x0;
  const x = cur();
  const a = g(x, 0x36);
  s(x, 0x1a, ((a << 2) & 0xffff) + C.cart_slope_frame1 + ((a >> 14) & 1));
}

/** $BED9FD — move the riders (and sparks) with the cart. */
function CODE_BED9FD(): void {
  const x = cur();
  let y = g(x, 0x42);
  if (y !== 0 && !neg(y)) {
    CODE_BEDA4E(x, y);
    CODE_BEDA90(y);
  }
  y = g(x, 0x44);
  if (y !== 0 && !neg(y)) {
    CODE_BEDA4E(x, y);
    let a = (g(y, 0x00) - C.sprite_diddy_kong) & 0xffff;
    if (a !== 0) a = 0x26;
    const i = ((a + g(x, 0x36)) << 1) & 0xffff;
    s(y, 0x06, rom16(RIDER_DX + i) + g(y, 0x06));
    s(y, 0x0a, rom16(RIDER_DX + i + (RIDER_DY - RIDER_DX)) + g(y, 0x0a));
  }
  // CODE_BEDA3B
  let sp = g(cur(), 0x46);
  if (sp) {
    reg.x = sp;
    CODE_BECEE5();
  }
  sp = g(cur(), 0x48);
  if (sp) {
    reg.x = sp;
    CODE_BECEE5();
  }
}

/** $BEDA4E — X = cart, Y = Kong: copy the cart's position, facing and terrain info. */
function CODE_BEDA4E(x: number, y: number): void {
  s(y, 0x06, g(x, 0x06));
  s(y, 0x0a, g(x, 0x0a));
  s(y, 0x12, (((g(x, 0x12) ^ g(y, 0x12)) & 0x4000) ^ g(y, 0x12)));
  s(y, 0x0c, g(x, 0x0c));
  s(y, 0x0e, g(x, 0x0e));
  s(y, 0x44, g(x, 0x10) & 0x8007);
  s(y, 0x46, g(x, 0x52) & 0x8007);
  s(y, 0x48, g(x, 0x36));
  s(y, 0x4a, g(x, 0x3e));
}

/** $BEDA90 — the active rider: camera lead on steep down slopes. */
function CODE_BEDA90(y: number): void {
  if (y !== r16(R.active_kong_sprite)) return;
  let a = 0;
  if (g(y, 0x48) === 0x0009) {
    a = (((g(y, 0x09) - 0x0200) & 0x0f00) - 0x0b00) & 0xffff;
    a = asr(a);
  }
  w16(0x0af2, a);
}

/** $BEDB50 — fell into a pit / keep the Kong's input timer while riding. */
function CODE_BEDB50(): void {
  if (!raceOver()) {
    const x = cur();
    reg.c = g(x, 0x0a) >= 0x0120;
    const a = (g(x, 0x0a) - 0x0120) & 0xffff;
    if (reg.c) {
      reg.c = a >= r16(R.screen_scroll_y_position);
      if (reg.c && !neg(g(x, 0x42) - 1)) {
        reg.y = C.player_interaction_29;
        CODE_BEC4BA();
        if (!reg.c) s(cur(), 0x2e, 5);
      }
    }
    // CODE_BEDB78
    const kcv = r16(R.active_kong_control_variables);
    if (!(g(cur(), 0x3e) & 0x0c00)) {
      if (g(kcv, 0x02) & 0x8000) s(kcv, 0x22, frame());
      return;
    }
  }
  // CODE_BEDB90
  s(r16(R.active_kong_control_variables), 0x22, sbcImm(frame(), 0x0020));
}

/** $BEDB9C — jump button pressed recently while on the ground: the cart jumps. */
function CODE_BEDB9C(): void {
  const kcv = r16(R.active_kong_control_variables);
  const t = (frame() - g(kcv, 0x22)) & 0xffff;
  reg.c = t >= 0x10;
  if (!neg(t - 0x10)) return;
  const x = cur();
  const a = g(x, 0x1e);
  if (!(a & 0x0101)) return;
  s(x, 0x1e, a & 0xfffe);
  inc(x, 0x2f);
  s(x, 0x24, spriteConst(0));
  let f = g(x, 0x40);
  reg.c = f >= 0x0e;
  if (!reg.c) f = 0x0e;
  s(x, 0x40, f);
  const y = g(x, 0x42);
  s(y, 0x40, 0x3000);
  s(y, 0x22, sbcImm(frame(), 0x0020));
  reg.a = sound(6, C.sound_coaster_jump);
  queue_sound_effect();
}

/** $BEDBE2 — jump button: jump out of the cart. */
function CODE_BEDBE2(): void {
  const kcv = r16(R.active_kong_control_variables);
  const t = (frame() - g(kcv, 0x22)) & 0xffff;
  reg.c = t >= 0x10;
  if (!neg(t - 0x10)) return;
  reg.a = C.player_interaction_16;
  set_player_interaction_global();
  if (reg.c) return;
  w16(R.ridden_skull_cart_sprite, 0);
  const x = cur();
  s(x, 0x38, g(x, 0x06));
  s(x, 0x3c, g(x, 0x0a));
  let y = g(x, 0x42);
  s(y, 0x0a, g(y, 0x0a) - 0x10);
  s(x, 0x42, y | 0x8000);
  y = g(x, 0x44);
  if (y) {
    s(y, 0x0a, g(y, 0x0a) - 0x10);
    s(x, 0x44, 0);
  }
  inc(x, 0x2f);
}

/** $BEDC2B — d-pad: speed up / brake. */
function CODE_BEDC2B(): void {
  if (raceOver()) return;
  const y = cur();
  const a = g(r16(R.active_kong_control_variables), 0x04);
  let i = 0;
  if (a & 0x0300) {
    i = a & 0x4000 ? 6 : 2;
    if (a & 0x0200) i += 2;
  }
  s(y, 0x50, rom16(PUSH_ACCEL + i));
}

/** $BEDC64 — airborne cart: gravity (lighter while the button is held). */
function CODE_BEDC64(): void {
  let x = cur();
  if (g(x, 0x3e) & 0x2000) {
    CODE_BEDCD8(1);
    return CODE_BEDCC0();
  }
  if (!neg(g(x, 0x24))) CODE_BEDCD8(5);
  x = cur();
  if (g(x, 0x3e) & 0x0020) {
    if (g(x, 0x4e) === 0) return CODE_BEDCC3(2);
    return CODE_BEDCC0();
  }
  if (!neg(g(x, 0x24))) return CODE_BEDCC0();
  if (!(g(r16(R.active_kong_control_variables), 0x04) & 0x8000)) return CODE_BEDCC0();
  CODE_BEDCC3(2);
}

/** $BEDCA5 — on the rails: drive (no speed once the race is over). */
function CODE_BEDCA5(): void {
  if (raceOver()) {
    s(cur(), 0x20, 0);
    return CODE_BEDCC0();
  }
  CODE_BEDCD8(2);
  if (g(cur(), 0x1f) & 0x0001) return;
  CODE_BEDCC0();
}

/** $BEDCC0 — gravity with constant #4. */
function CODE_BEDCC0(): void {
  CODE_BEDCC3(4);
}

/** CODE_BEDCC3 — Y = offset of the gravity in the constants; capped at constant #6. */
function CODE_BEDCC3(yoff: number): void {
  const x = cur();
  const sum = g(x, 0x24) + spriteConst(yoff);
  let a = sum & 0xffff;
  reg.c = sum > 0xffff;
  if (!neg(a)) {
    const max = spriteConst(6);
    reg.c = a >= max;
    if (reg.c) a = max;
  }
  s(x, 0x24, a);
}

/**
 * $BEDCD8 — Y = smoothing shift: horizontal speed on the slope. $2A = base speed, $2C = bump
 * offset (decays by the low byte of $4E while $3E bit 15), $50 = acceleration this frame.
 */
function CODE_BEDCD8(yshift: number): void {
  reg.db = BANK_BE;
  w16(0x36, yshift);
  let x = cur();
  if (g(x, 0x3e) & 0x8000) {
    const t = g(x, 0x4e);
    if (t >= 0x0100) {
      s(x, 0x4e, t - 0x0100);
      s(x, 0x50, 0);
    } else {
      const dec32 = t & 0xff;
      w16(0x32, dec32);
      const b = g(x, 0x2c);
      let done = false;
      let v: number;
      if (!neg(b)) {
        v = b - dec32;
        done = v < 0;
      } else {
        v = b + dec32;
        done = v > 0xffff;
      }
      if (done) {
        s(x, 0x2c, 0);
        s(x, 0x4e, 0);
        and(x, 0x3e, 0x7fff);
      } else s(x, 0x2c, v);
    }
  }
  // CODE_BEDD17: vertical distance from the reference y, times 3
  x = cur();
  let a = (g(x, 0x0a) - g(x, 0x1c)) & 0xffff;
  w16(0x32, a);
  a = ((a << 1) + r16(0x32)) & 0xffff;
  w16(0x32, a);
  const bump = g(x, 0x2c);
  if (bump !== 0 && neg(bump ^ g(x, 0x50))) {
    s(x, 0x2c, bump + g(x, 0x50));
    a = g(x, 0x2a);
  } else {
    a = (g(x, 0x2a) + g(x, 0x50)) & 0xffff;
    s(x, 0x2a, a);
  }
  // CODE_BEDD40
  a = (a + g(x, 0x2c)) & 0xffff;
  a = neg(a) ? (a - r16(0x32)) & 0xffff : (a + r16(0x32)) & 0xffff;
  w16(0x34, a);
  let gotoDD76 = !(a < 0x0080 || a >= 0xff80);
  if (!gotoDD76) {
    // CODE_BEDD59: small speed: the slope pulls the cart
    const t = g(x, 0x10) & 0x8007;
    const idx = ((((t << 1) | (t >= 0x8000 ? 1 : 0)) & 0xffff) << 1) & 0xffff;
    a = (rom16(SLOPE_SPEED + idx) + g(x, 0x26) + g(x, 0x50)) & 0xffff;
    w16(0x34, a);
    gotoDD76 = (g(x, 0x3e) & 0x8000) !== 0;
  }
  let skipToDDD1 = false;
  if (gotoDD76) {
    // CODE_BEDD76: limit to the min/max speeds $22/$28 (offset by the bump)
    const t34 = r16(0x34);
    let toDDAC = false;
    let v: number;
    if (!neg(t34)) {
      v = (g(x, 0x22) + g(x, 0x2c)) & 0xffff;
      if (neg(v) || v < t34) {
        v = (g(x, 0x28) + g(x, 0x2c)) & 0xffff;
        if (!neg(v) && v >= t34) toDDAC = true;
      }
    } else {
      v = (g(x, 0x22) + g(x, 0x2c)) & 0xffff;
      if (neg(v) && v < t34) {
        v = (g(x, 0x28) + g(x, 0x2c)) & 0xffff;
        if (!neg(v) || v >= t34) toDDAC = true;
      }
    }
    if (!toDDAC) {
      // CODE_BEDDA8
      w16(0x34, v);
    } else {
      // CODE_BEDDAC
      a = r16(0x34);
      if (!neg(a ^ g(x, 0x26))) skipToDDD1 = true;
      else {
        w16(0x32, (r16(0x32) << 1) & 0xffff);
        a = r16(0x34);
        a = neg(a) ? (a + r16(0x32)) & 0xffff : (a - r16(0x32)) & 0xffff;
        w16(0x34, a);
      }
    }
  }
  // CODE_BEDDC2
  if (!skipToDDD1 && g(x, 0x0e) === 0) {
    s(x, 0x2a, r16(0x34) - g(x, 0x2c));
    s(x, 0x1c, g(x, 0x0a));
  }
  // CODE_BEDDD1
  s(x, 0x50, 0);
  a = r16(0x34);
  s(x, 0x26, a);
  let y = r16(0x36);
  if (y !== 0) {
    a = (a - g(x, 0x20)) & 0xffff;
    while (y--) a = asr(a);
    a = (a + g(x, 0x20)) & 0xffff;
    if (a === g(x, 0x20)) a = r16(0x34);
  }
  s(x, 0x20, a);
}

/**
 * $BEDE09 — move the cart along the terrain (using the real position $4A/$4C). Carry set when
 * it is on the ground after the move.
 */
function CODE_BEDE09(): void {
  const x = cur();
  s(x, 0x06, g(x, 0x4a));
  s(x, 0x0a, g(x, 0x4c));
  const f = r8(x + 0x1e);
  w8(x + 0x1f, f);
  w8(x + 0x1e, f >> 4);
  let landed: boolean;
  if (!neg(g(x, 0x24))) {
    const z = CODE_BEDEA8(x);
    if (!reg.c) {
      CODE_BEDF72(x);
      landed = inAir(x);
    } else if (!z) landed = onGround(x);
    else {
      const a = CODE_BEDF72(x);
      const d = a - g(x, 0x0c);
      if (d < 0 || neg(g(x, 0x0e))) landed = fallBelow(x, d & 0xffff);
      else landed = onGround(x);
    }
  } else {
    // CODE_BEDE3F: rising
    CODE_BEDF72(x);
    const z = CODE_BEDEA8(x);
    if (!reg.c) landed = inAir(x);
    else if (!z) landed = onGround(x);
    else landed = fallBelow(x, (g(x, 0x0a) - g(x, 0x0c)) & 0xffff);
  }
  // CODE_BEDE97: swap the drawn and the real position
  let a = g(x, 0x4a);
  let y = g(x, 0x06);
  s(x, 0x06, a);
  s(x, 0x4a, y);
  a = g(x, 0x4c);
  y = g(x, 0x0a);
  s(x, 0x0a, a);
  s(x, 0x4c, y);
  reg.c = landed;
  reg.x = x;
}

/** CODE_BEDE4E: above the ground by -A. */
function fallBelow(x: number, a: number): boolean {
  s(x, 0x0e, negate(a));
  s(x, 0x10, r16(0xac));
  s(x, 0x52, 0);
  return false;
}

/** CODE_BEDE5D: no ground under the cart. */
function inAir(x: number): boolean {
  s(x, 0x0c, 0);
  s(x, 0x0e, 0x8090);
  s(x, 0x10, 0);
  s(x, 0x52, 0);
  return false;
}

/** CODE_BEDE6B: snap to the ground, read the slope ahead. */
function onGround(x: number): boolean {
  s(x, 0x0a, r16(0x74));
  s(x, 0x0e, 0);
  or(x, 0x1e, 0x0001);
  s(x, 0x24, 0x0100);
  s(x, 0x10, r16(0xac));
  reg.a = ((neg(g(x, 0x2c)) ? 0xfff0 : 0x0010) + g(x, 0x06)) & 0xffff;
  reg.x = x;
  get_sprite_terrain_info_y_origin_0();
  s(x, 0x52, r16(0xac));
  return true;
}

/**
 * $BEDEA8 — horizontal move along the slope ($20 scaled by the slope steepness), clamped to the
 * level, then the terrain test. Carry clear = no terrain near; carry set with the return
 * value true (A = 0) = ground below, false (A = 1) = at/under the ground.
 */
function CODE_BEDEA8(x: number): boolean {
  w16(0x60, 0);
  let a = g(x, 0x20);
  let c: boolean;
  if (neg(a)) {
    a = negate(a);
    if (a >= 0x10) w16(0x60, 0xffff);
  }
  const notNeg = !neg(g(x, 0x20));
  void notNeg;
  // CODE_BEDEB9
  a >>= 4;
  w16(0x5e, a);
  let k = g(x, 0x10) & 0x0007;
  if (k === 0) {
    // CODE_BEDEF3: flat ground: full speed
    w16(0x60, 0);
    a = g(x, 0x20);
    c = false;
    if (neg(a)) w16(0x60, 0xffff);
  } else {
    if (k === 5 && neg(g(x, 0x24)) && !neg(g(x, 0x10))) k++;
    reg.db = BANK_BE;
    io8(CPU.multiply_A, rom8(SLOPE_STEP + k));
    io8(CPU.multiply_B, r8(0x5e));
    c = (r8(0x60) & 0x80) !== 0;
    a = ioR16(CPU.multiply_result);
    if (c) a ^= 0xffff;
  }
  // CODE_BEDEFC: add to the 24-bit x position
  let sum = a + g(x, 0x05) + (c ? 1 : 0);
  s(x, 0x05, sum);
  sum = r8(0x60) + r8(x + 0x07) + (sum > 0xffff ? 1 : 0);
  w8(x + 0x07, sum & 0xff);
  // keep inside the level
  const px = g(x, 0x06);
  let lim = 0x0100;
  let clamp = lim >= px;
  if (!clamp) {
    lim = (r16(0x0afc) + 0x00ff) & 0xffff;
    clamp = !(lim >= px);
  }
  if (clamp) {
    s(x, 0x04, 0);
    s(x, 0x06, lim);
  }
  // CODE_BEDF1F
  reg.x = x;
  get_sprite_terrain_info();
  a = reg.a ^ 0xffff;
  if (!neg(a)) {
    reg.a = (g(x, 0x0a) + 0x0040) & 0xffff;
    reg.x = x;
    get_sprite_terrain_info_define_y();
    a = reg.a ^ 0xffff;
    if (!neg(a)) {
      reg.c = false;
      return false;
    }
  }
  // CODE_BEDF37
  a = (a + 0x6301) & 0xffff;
  w16(0x74, a);
  s(x, 0x0c, a);
  const d = (a - g(x, 0x0a)) & 0xffff;
  reg.c = true;
  if (d === 0) return false;
  if (neg(d)) {
    if (g(x, 0x0e) < 0x11) return false;
    s(x, 0x0e, d);
    return true;
  }
  s(x, 0x0e, d);
  if (d >= 0x11) return true;
  if (g(x, 0x1f) & 0x0001) return false;
  return true;
}

/** $BEDF72 — y += y speed ($24, 8.8); returns the new pixel y (XBA). */
function CODE_BEDF72(x: number): number {
  const sum = g(x, 0x24) + g(x, 0x09);
  s(x, 0x09, sum);
  const hi = (neg(g(x, 0x24)) ? 0xff : 0x00) + r8(x + 0x0b) + (sum > 0xffff ? 1 : 0);
  w8(x + 0x0b, hi & 0xff);
  // XBA of A = (B:A) where B = $0A's low byte... A after the 8-bit ADC = hi, B = high byte of sum
  const a = ((hi & 0xff) << 8) | ((sum >> 8) & 0xff);
  reg.a = a;
  return a;
}

/** $BEDF8A — sparks when the cart rolls fast on flat or gentle slopes. */
function CODE_BEDF8A(): void {
  if (timeStopped()) return;
  const x = cur();
  if (g(x, 0x20) === 0) return;
  const f = g(x, 0x1e) & 0x0101;
  if (f === 0x0001) {
    // CODE_BEDFF5: just landed
    if (g(x, 0x46) !== 0) return;
    CODE_BEE010();
    if (reg.c) return;
    const sp = r16(R.alternate_sprite);
    const me = cur();
    s(sp, 0x42, me);
    s(me, 0x46, sp);
    s(sp, 0x44, 0);
    s(sp, 0x46, 0x000a);
    reg.x = sp;
    return CODE_BECEE5();
  }
  if (f !== 0x0101) return;
  if ((g(x, 0x10) & 7) >= 4) return;
  reg.c = false;
  if (neg(g(x, 0x20))) return;
  get_random_number_2_global();
  let a = reg.a >> 1;
  if (a >= g(x, 0x20)) return;
  const bit = a & 1;
  a >>= 1;
  void a;
  if (bit) {
    if (g(x, 0x48) !== 0) return;
    CODE_BEE010();
    if (reg.c) return;
    const sp = r16(R.alternate_sprite);
    const me = cur();
    s(sp, 0x42, me);
    s(me, 0x48, sp);
    s(sp, 0x44, 0x0013);
    inc(sp, 0x2e);
    reg.x = sp;
    return CODE_BECEE5();
  }
  // CODE_BEDFDD
  if (g(x, 0x46) !== 0) return;
  CODE_BEE010();
  if (reg.c) return;
  const sp = r16(R.alternate_sprite);
  const me = cur();
  s(sp, 0x42, me);
  s(me, 0x46, sp);
  s(sp, 0x44, 0);
  inc(sp, 0x2e);
  reg.x = sp;
  CODE_BECEE5();
}

/** $BEE010 — spawn a spark if a slot is free (carry set if not). */
function CODE_BEE010(): void {
  const a = (r16(SPARK_SLOTS) - 1) & 0xffff;
  reg.c = neg(a);
  if (reg.c) return;
  reg.y = C.special_sprite_spawn_id_009A;
  spawn_special_sprite_index();
  if (reg.c) return;
  w16(R.RAM_19AD, r16(R.RAM_19AD) - 1);
}

/** $BEE024 — the player's cart: run the level's track script (flags, speed changes). */
function CODE_BEE024(): void {
  const x = cur();
  if (g(x, 0x4a) < g(x, 0x06)) return;
  w16(0x32, g(x, 0x5c));
  w16(0x34, r16(R.current_sprite_constants_bank));
  const at = ptr32(0);
  if (at >= g(x, 0x4a)) return;
  if (at >= g(x, 0x06)) {
    const h = ptr32(2);
    let ok = h === 0;
    if (!ok) ok = ((h - g(x, 0x0c) + 0x0008) & 0xffff) < 0x0010;
    if (ok) {
      const a = ptr32(4);
      if (a & 0x1000) {
        // CODE_BEE071: new top speed
        s(x, 0x22, ptr32(6));
        s(x, 0x5c, g(x, 0x5c) + 2);
      } else {
        if (a & 0x0020) s(x, 0x4e, g(x, 0x0e));
        s(x, 0x3e, a ^ g(x, 0x3e));
      }
    }
  }
  // CODE_BEE068
  s(x, 0x5c, g(x, 0x5c) + 6);
}

register({
  haunted_hall_door_sprite_code,
  gate_barrel_sprite_code,
  CODE_BECE7E,
  skull_cart_sparks_sprite_code,
  CODE_BECEE5,
  skull_cart_sprite_code,
  set_klank_race_kart_velocity,
});
for (const n of ["haunted_hall_door_sprite_code", "gate_barrel_sprite_code", "skull_cart_sparks_sprite_code", "skull_cart_sprite_code"]) {
  setRetMode(L(n), RET_SPRITE);
}
