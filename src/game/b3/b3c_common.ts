/**
 * Shared helpers for package B3c (bank $B3 sprite code: Mini-Necky, Kannon, cannonballs,
 * pickups, Kutlass, Krook, Puftup, platforms, Krockhead, ...), plus the small generic
 * routines of the range: the "thrown by an enemy" state handler (CODE_B3D249),
 * process_alternate_movement_B3, process_sprite_anim_preserve_flags, CODE_B3D8FD/CODE_B3D907,
 * CODE_B3D916 and bank_B3_sprite_main_handler.
 *
 * Most sprite mains begin with `JSR sprite_state_handler_B3` followed by a table of state
 * routines. sprite_state_handler_B3 pops that return address to find the table, so it cannot be
 * called as a routine; `spriteStateHandler(table)` below does the same dispatch in TS. State
 * routines leave through `JML [sprite_return_address]` (or a tail jump into code that does);
 * in TS they simply return, and they are registered with RET_SPRITE so that a trap from
 * original code resumes at the sprite return address.
 */
import { r8, r16, w8, w16, rom16, bus16 } from "../../core/mem";
import { reg, register, implAt, callAddr, type Routine } from "../../core/cpu";
import { runOriginal, setRetMode, KIND_JSR, KIND_JSL, RET_RTS, RET_RTL, RET_SPRITE } from "../../core/hybrid";
import { L, R, sprite } from "../../core/sym";
import {
  process_sprite_animation,
  process_current_movement,
  check_if_sprite_offscreen_global,
  get_current_sprite_clipping,
  process_alternate_movement,
  delete_sprite_handle_deallocation,
  spawn_no_gfx_special_sprite_index,
  CODE_BBBB99,
} from "../../gen/routines";
import { C } from "../../core/sym";

// ---------------------------------------------------------------------------------------------
// Small helpers

/** `LDX current_sprite` */
export const cur = () => r16(R.current_sprite);
/** Read a 16-bit sprite field. */
export const sr = (x: number, off: number) => r16((x + off) & 0xffff);
/** Write a 16-bit sprite field. */
export const sw = (x: number, off: number, v: number) => w16((x + off) & 0xffff, v & 0xffff);
/** Read an 8-bit sprite field. */
export const sr8 = (x: number, off: number) => r8((x + off) & 0xffff);
/** Write an 8-bit sprite field. */
export const sw8 = (x: number, off: number, v: number) => w8((x + off) & 0xffff, v & 0xff);
/** `INC field,x` (16-bit) */
export const sinc = (x: number, off: number) => sw(x, off, sr(x, off) + 1);
/** `DEC field,x` (16-bit); returns the new value. */
export const sdec = (x: number, off: number) => {
  const v = (sr(x, off) - 1) & 0xffff;
  sw(x, off, v);
  return v;
};
/** `EOR #$FFFF : INC A` */
export const neg = (v: number) => -v & 0xffff;
/** N flag of a 16-bit value. */
export const isNeg = (v: number) => (v & 0x8000) !== 0;
/** `CMP #$8000 : ROR A` — arithmetic shift right by one. */
export const asr1 = (v: number) => ((v & 0xffff) >> 1) | (v & 0x8000);
/** `BIT sprite.oam_property,x : BVS` — the sprite faces left (horizontal flip set). */
export const facingLeft = (x: number) => (sr(x, sprite.oam_property) & 0x4000) !== 0;

/** `%lda_sound(channel, name)` */
export const sound = (channel: number, name: string) =>
  ((channel << 8) | (C as Record<string, number>)["sound_" + name]) & 0xffff;

/** `LDA [current_sprite_constants],y` */
export function spriteConst(y: number): number {
  const base = (r8(R.current_sprite_constants_bank) << 16) | r16(R.current_sprite_constants);
  return bus16((base + (y & 0xffff)) & 0xffffff);
}

/** 65816 decimal-mode `ADC` (16-bit). Returns the result; the carry out goes to `bcdCarry`. */
export let bcdCarry = false;
export function bcdAdc16(a: number, b: number, carry: boolean): number {
  let c = carry ? 1 : 0;
  let r = 0;
  for (let i = 0; i < 16; i += 4) {
    let d = ((a >> i) & 0xf) + ((b >> i) & 0xf) + c;
    if (d > 9) d += 6;
    c = d > 0xf ? 1 : 0;
    r |= (d & 0xf) << i;
  }
  bcdCarry = c === 1;
  return r & 0xffff;
}
/** 65816 decimal-mode `SBC` (16-bit). */
export function bcdSbc16(a: number, b: number, carry: boolean): number {
  let c = carry ? 1 : 0;
  let r = 0;
  for (let i = 0; i < 16; i += 4) {
    let d = ((a >> i) & 0xf) + (0xf - ((b >> i) & 0xf)) + c;
    if (d <= 0xf) d -= 6;
    c = d > 0xf ? 1 : 0;
    r |= (d & 0xf) << i;
  }
  bcdCarry = c === 1;
  return r & 0xffff;
}

// ---------------------------------------------------------------------------------------------
// Registration

function regWith(mode: number, fns: Record<string, Routine>) {
  register(fns);
  for (const k of Object.keys(fns)) setRetMode(L(k), mode);
}
/** Register routines that end with RTS. */
export const registerRts = (fns: Record<string, Routine>) => regWith(RET_RTS, fns);
/** Register routines that end with RTL. */
export const registerRtl = (fns: Record<string, Routine>) => regWith(RET_RTL, fns);
/** Register routines that leave through `JML [sprite_return_address]`. */
export const registerSprite = (fns: Record<string, Routine>) => regWith(RET_SPRITE, fns);

// ---------------------------------------------------------------------------------------------
// Sprite-return tails

const spriteReturnTarget = () => ((r16(R.sprite_return_bank) << 16) | r16(R.sprite_return_address)) & 0xffffff;

/**
 * Jump to code that leaves through `JML [sprite_return_address]`: a ported target just returns;
 * an original one runs until it reaches the sprite return point.
 */
export function spriteTail(addr: number) {
  addr &= 0xffffff;
  const impl = implAt(addr);
  if (impl) return impl();
  runOriginal(addr, KIND_JSR, reg.db, 0, 0, [spriteReturnTarget()]);
}

const SPRITE_RETURN_HANDLE_DESPAWN = L("sprite_return_handle_despawn");
const MAKE_SPRITE_FALL_OFF_SCREEN = L("make_sprite_fall_off_screen");
/** `JMP sprite_return_handle_despawn`: despawn the sprite if it went far offscreen, then leave. */
export const returnHandleDespawn = () => spriteTail(SPRITE_RETURN_HANDLE_DESPAWN);
/** `JMP make_sprite_fall_off_screen`: a defeated sprite falls until it leaves the screen. */
export const fallOffScreen = () => spriteTail(MAKE_SPRITE_FALL_OFF_SCREEN);

/** `JSL [ptr]` / `JML [ptr]` with a pushed return: call a 24-bit code address like a JSL. */
export function jslAddr(addr: number) {
  addr &= 0xffffff;
  const impl = implAt(addr);
  if (impl) return impl();
  runOriginal(addr, KIND_JSL, reg.db, 0, 0);
}

// ---------------------------------------------------------------------------------------------
// sprite_state_handler_B3 (as used by every `JSR sprite_state_handler_B3` main in this range)

/**
 * The dispatch of sprite_state_handler_B3 ($B3A369) for a main whose state table starts at
 * `table` (the address right after its `JSR sprite_state_handler_B3`). DB = $B3, Y = the sprite,
 * X = address of the table entry, A = sub_state * 2. A sprite thrown by an enemy (bit 7 of the
 * state byte) is handled by CODE_B3D249 first.
 */
export function spriteStateHandler(table: number) {
  reg.db = 0xb3;
  const y = cur();
  w16(R.current_sprite_constants, sr(y, sprite.constants_address));
  const state = sr8(y, sprite.state);
  if (state & 0x80) return CODE_B3D249(table);
  const entry = ((table & 0xffff) + (state & 0x7f) * 2) & 0xffff;
  reg.y = y;
  reg.x = entry;
  reg.a = (sr8(y, sprite.sub_state) * 2) & 0xffff;
  spriteTail(0xb30000 | rom16(0xb30000 | entry));
}

/** `JMP (table,x)` inside a state routine (A = sub_state * 2 from the state handler). */
export function jumpTable(table: number, index: number) {
  reg.x = index & 0xffff;
  spriteTail(0xb30000 | rom16(0xb30000 | ((table + index) & 0xffff)));
}

// ---------------------------------------------------------------------------------------------
// Thrown-by-enemy handling ($B3D249)

const DATA_B3D2CE = L("DATA_B3D2CE");

/**
 * $B3D249 — a sprite flagged as thrown by another enemy (bit 7 of its state). It flies with its
 * thrown movement until it collides, then its saved movement is restored and the normal state
 * table runs. The original is entered with `JMP` from sprite_state_handler_B3 while the address
 * of the state table is still on the stack (it drops it with PLA, or re-enters the handler with
 * it), so it cannot be a trap target: it is not registered and takes the table address instead.
 */
export function CODE_B3D249(table: number) {
  const y = cur();
  const index = (sr(y, sprite.animation_flags) & 0x7f) * 2;
  reg.y = y;
  reg.x = index;
  callPtrB3(rom16(DATA_B3D2CE + index)); // JSR (DATA_B3D2CE,x)
  if (reg.c) return CODE_B3D295(table);
  const x = cur();
  const word = sr(x, sprite.movement_state - 1);
  if (word & 0x8000) return; // CODE_B3D291: PLA, JML [sprite_return_address]
  const movement = word & 0xff00;
  // movement states $13-$15 and $26 are the "thrown" movements; anything else ends the throw
  const thrown = (movement >= 0x1300 && movement < 0x1601) || (movement >= 0x2600 && movement < 0x2701);
  if (!thrown) return CODE_B3D295(table);
  CODE_B3D273(table);
}

/** $B3D273 — move the thrown sprite and count down its offscreen despawn timer. */
function CODE_B3D273(table: number) {
  process_current_movement();
  process_sprite_anim_preserve_flags();
  check_if_sprite_offscreen_global();
  const x = cur();
  let a = sr(x, sprite.despawn_time);
  if (reg.c) {
    // offscreen: SBC #$0100 with carry set
    if (a < 0x0100) return CODE_B3D295(table);
    a = (a - 0x0100) & 0xffff;
    a = ((a >> 8) | (a << 8)) & 0xffff; // XBA
  }
  sw8(x, 0x5b, a); // CODE_B3D28B: SEP #$20 : STA $5B,x
  // CODE_B3D291: PLA, JML [sprite_return_address]
}

/**
 * $B3D295 — end of the throw: clear the thrown flag, restore the movement saved in the
 * thrower's record (placement_number points to it), then run the normal state handler.
 */
function CODE_B3D295(table: number) {
  const x = cur();
  sw(x, sprite.state, sr(x, sprite.state) & 0xff7f);
  const y = sr(x, sprite.placement_number);
  sw(x, sprite.x_sub_position, sr(y, sprite.ground_y_position));
  sw(x, sprite.x_speed, sr(y, sprite.ground_distance));
  sw(x, sprite.y_sub_position, sr(y, sprite.animation_flags));
  sw(x, sprite.y_speed, sr(y, sprite.unknown_5C));
  const display = sr(y, sprite.display_mode);
  const a = ((((display >> 8) | (display << 8)) & 0xffff) | sr(x, sprite.movement_state)) & 0xff7f;
  sw(x, sprite.movement_state, a); // CODE_B3D2C2
  sw(x, sprite.placement_number, 0);
  sw(x, sprite.despawn_time, 0);
  sw(y, 0x1e, 0);
  reg.x = y;
  spriteStateHandler(table); // JMP sprite_state_handler_B3 (table still on the stack)
}

/** `JSR (table,x)` / `JMP (table,x)` to a 16-bit pointer in bank $B3. */
export function callPtrB3(ptr: number) {
  const addr = 0xb30000 | ptr;
  const impl = implAt(addr);
  if (impl) return impl();
  callAddr(addr);
}

/** $B3D2D4 — collision mode 2: a defeated thrown sprite counts as having hit something. */
export function CODE_B3D2D4() {
  if (r16((reg.y + sprite.carry_or_defeat_flags) & 0xffff) === 0) return CODE_B3D2DD();
  reg.c = true;
}

/** $B3D2DB — collision mode 0: never collides. */
export function CODE_B3D2DB() {
  reg.c = false;
}

/** $B3D2DD — collision mode 1: run the sprite's own collision routine (JML [ptr] with a return). */
export function CODE_B3D2DD() {
  get_current_sprite_clipping();
  reg.a = 0x0010;
  const ptr = r16(R.sprite_collision_routine_address) | (r8(R.sprite_collision_routine_address + 2) << 16);
  reg.db = 0xb3; // PHK is pushed for the return; the callee sees the caller's DB = $B3
  jslAddr(ptr);
  CODE_B3D2EB();
}

/** $B3D2EB */
export function CODE_B3D2EB() {}

/** $B3D2EC — process_sprite_animation without changing the sprite's animation flags. */
export function process_sprite_anim_preserve_flags() {
  const x = cur();
  reg.x = x;
  const flags = sr(x, sprite.animation_flags);
  process_sprite_animation();
  sw(reg.x, sprite.animation_flags, flags);
}

/** $B3CE79 — process_alternate_movement (A = movement id) for the current sprite. */
export function process_alternate_movement_B3() {
  reg.x = cur();
  process_alternate_movement();
}

// ---------------------------------------------------------------------------------------------
// Barrel break and the bank $B3 code table

/** $B3D8FD — delete the sprite and spawn two barrel break particles. */
export function CODE_B3D8FD() {
  delete_sprite_handle_deallocation();
  CODE_B3D907();
}

/** $B3D907 — spawn the two barrel break particles. */
export function CODE_B3D907() {
  reg.y = C.special_sprite_spawn_id_0068;
  spawn_no_gfx_special_sprite_index();
  reg.y = C.special_sprite_spawn_id_006A;
  spawn_no_gfx_special_sprite_index();
}

/** $B3D916 — CODE_BBBB99 (despawn when far offscreen), then leave. */
export function CODE_B3D916() {
  CODE_BBBB99();
}

const MAIN_TABLE = L("bank_B3_sprite_main_handler_main_table");

/** $B3D91D — run the sprite code selected by A (clapper, wind changers, timer, barrels, ...). */
export function bank_B3_sprite_main_handler() {
  const x = reg.a & 0xffff;
  reg.x = x;
  reg.db = 0xb3;
  spriteTail(0xb30000 | rom16(MAIN_TABLE + x));
}

registerSprite({ CODE_B3D8FD, CODE_B3D916, bank_B3_sprite_main_handler });
registerRts({ CODE_B3D907, CODE_B3D2D4, CODE_B3D2DB, CODE_B3D2DD, CODE_B3D2EB, process_alternate_movement_B3 });
registerRtl({ process_sprite_anim_preserve_flags });
