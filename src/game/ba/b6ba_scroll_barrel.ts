/**
 * Bank $BA — pieces of the bank used in worlds 1-2: the second sprite main handler (its only
 * world 1-2 entry is the scroll-and-float barrel), the floating scroll barrel itself (bobs
 * around; in Krool's Cabin touching it shows the bg3 text), an OAM clear used by many
 * screens, and Krow's frame counter.
 */
import { r16, w16, io8 } from "../../core/mem";
import { reg } from "../../core/cpu";
import { L, R, C, PPU } from "../../core/sym";
import {
  interpolate_x_velocity_global, interpolate_y_velocity_global, apply_position_from_velocity_global,
  process_sprite_animation, get_current_sprite_clipping, check_active_kong_collision, CODE_BBBB99,
  queue_sound_effect,
} from "../../gen/routines";
import { cur, rd, wr, dec, inc, neg, snd, spriteTail, registerSprite, registerRtl, registerRts } from "../b6/b6ba_common";

const MAIN_TABLE = (L("bank_BA_sprite_main_handler_2") + 6) & 0xffff;

/** $BAB078 — `TAX : PHK : PLB : JMP (.main_table,x)` with A = index into the bank's table. */
export function bank_BA_sprite_main_handler_2(): void {
  reg.x = reg.a & 0xffff;
  reg.db = 0xba;
  if (reg.x === 0x0006) return scroll_and_float_barrel_sprite_code();
  // the other entries (K. Rool, Kong family NPCs, sparkles) are not part of worlds 1-2
  spriteTail(0xba0000 | r16(0xba0000 | ((MAIN_TABLE + reg.x) & 0xffff)));
}

/** $BAC303 — floating barrel: swing its velocities back and forth, move, animate. */
export function scroll_and_float_barrel_sprite_code(): void {
  const x = cur();
  w16(0x0674, x);
  // Every $4A frames reverse the target x velocity, every $4C frames the target y velocity.
  if (dec(x, 0x46) === 0) {
    wr(x, 0x46, rd(x, 0x4a));
    wr(x, 0x26, neg(rd(x, 0x26)));
  }
  if (dec(x, 0x48) === 0) {
    wr(x, 0x48, rd(x, 0x4c));
    wr(x, 0x2a, neg(rd(x, 0x2a)));
  }
  reg.x = x;
  const preset = rd(x, 0x44); // velocity interpolation preset
  reg.a = preset;
  interpolate_x_velocity_global();
  reg.a = preset;
  interpolate_y_velocity_global();
  apply_position_from_velocity_global();
  process_sprite_animation();
  reg.a = r16(R.level_number);
  if (reg.a !== C.level_pirate_panic_krools_cabin) return;
  // In Krool's Cabin the barrel carries the text scroll: state machine in $2E.
  const y = cur();
  reg.y = y;
  const state = r16(y + 0x2e);
  reg.x = (state * 2) & 0xffff;
  if (state === 0) return waitForCollision();
  if (state === 1) return displayText();
  // state 2: idle
}

/** State 0: wait until the Kong touches the barrel, then show bg3 (the text) for $258 frames. */
function waitForCollision(): void {
  get_current_sprite_clipping();
  reg.a = 0x0008;
  check_active_kong_collision();
  if (!reg.c) {
    CODE_BBBB99(); // despawn when off screen
    return;
  }
  io8(PPU.screens, 0x17); // enable bg3
  const x = cur();
  reg.x = x;
  inc(x, 0x2e);
  wr(x, 0x4e, 0x0258);
  reg.a = snd(6, "krool_note");
  queue_sound_effect();
}

/** State 1: count the text timer down; when it runs out hide bg3 again and go idle. */
function displayText(): void {
  const x = cur();
  reg.x = x;
  if (dec(x, 0x4e) & 0x8000) {
    io8(PPU.screens, 0x13); // disable bg3
    inc(x, 0x2e);
  }
}

/** $BAC7C0 — JSL wrapper of CODE_BAC7C4. */
export function CODE_BAC7C0(): void {
  CODE_BAC7C4();
}

/** $BAC7C4 — clear the OAM buffer: all size bits 0 and every sprite moved off screen (y=$F0). */
export function CODE_BAC7C4(): void {
  for (let i = 0; i < 0x20; i += 2) w16(0x0400 + i, 0);
  reg.x = 0x0004;
  reg.y = 0x0000;
  CODE_BAC7FD();
}

/** $BAC7FD — loop body: 32 OAM entries ($80 bytes) per pass, X passes. */
export function CODE_BAC7FD(): void {
  do {
    reg.a = 0xf000;
    for (let i = 0; i < 0x20; i++) w16((0x0200 + reg.y + i * 4) & 0xffff, 0xf000);
    reg.a = (reg.y + 0x0080) & 0xffff;
    reg.y = reg.a;
    reg.x = (reg.x - 1) & 0xffff;
  } while (reg.x !== 0);
}

/** $BAC949 — Krow's frame counter $0769: counts 0..4 (rev 1 only). */
export function CODE_BAC949(): void {
  reg.a = (r16(0x0769) + 1) & 0xffff;
  w16(0x0769, reg.a);
  if (reg.a === 0x0005) {
    w16(0x0769, 0);
  }
  CODE_BAC958();
}

/** $BAC958 */
export function CODE_BAC958(): void {}

registerSprite({ bank_BA_sprite_main_handler_2, scroll_and_float_barrel_sprite_code });
registerRtl({ CODE_BAC7C0, CODE_BAC949, CODE_BAC958 });
registerRts({ CODE_BAC7C4, CODE_BAC7FD });
