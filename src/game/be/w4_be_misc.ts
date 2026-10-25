/**
 * Bank $BE (package w4_be) — double Zingers, the chasing King Zing (Bramble Scramble?), Screech
 * (Screech's Sprint race) and the giant tires ($BEEA7F-$BEEE37).
 */
import { r16, w16, bus16 } from "../../core/mem";
import { reg, register } from "../../core/cpu";
import { setRetMode, RET_SPRITE } from "../../core/hybrid";
import { L, R, C } from "../../core/sym";
import {
  get_current_sprite_clipping,
  CODE_BEBE8B,
  CODE_BEBE8E,
  CODE_B3C6AB,
  CODE_BBBB99,
  CODE_B59C00,
  CODE_B3D46C,
  process_sprite_animation,
  process_current_movement,
  delete_sprite_handle_deallocation,
  transition_song,
  spawn_special_sprite_index,
  spawn_BB83EF_special_sprite_address,
  set_player_interaction_global,
  get_kong_state_flags_if_one_kong,
  sprite_return_handle_despawn_BE,
  allocate_sprite_vram_multi_slot_global,
  check_if_sprite_offscreen_global,
  dereference_sprite_palette_global,
  queue_sound_effect,
  queue_or_reset_looping_sound_effect,
} from "../../gen/routines";
import { spriteStateDispatch } from "./be1_util";
import { g, s, inc, dec, neg, cur } from "./w4_be_util";

const DOUBLE_ZINGERS_TABLE = L("DATA_BEEA85");
const KING_ZING_TABLE = L("DATA_BEEA93");
const SCREECH_TABLE = L("DATA_BEEB50");
const TIRE_CLEANUP = L("CODE_BEEE09") & 0xffff;
const TIRE_VRAM = 0x19b2; // low byte = tires alive, bit 15 = roll sound on; $19B4.. = slots
const sound = (ch: number, id: number) => (ch << 8) | id;

function despawn(): void {
  sprite_return_handle_despawn_BE();
}

/** Animate, move. */
function animMove(): void {
  process_sprite_animation();
  process_current_movement();
}

// =============================================================================================
// Double Zingers / chasing King Zing
// =============================================================================================

/** $BEEA7F — two Zingers moving together on a script. */
export function double_zingers_sprite_code(): void {
  w16(R.zinger_loop_sound_enabler, r16(R.zinger_loop_sound_enabler) + 1);
  spriteStateDispatch(DOUBLE_ZINGERS_TABLE, [CODE_BEEA9B, CODE_BEEAAA, CODE_BEEAE0, CODE_BEEB34]);
}

/** $BEEA8D — King Zing chasing the Kongs. */
export function chasing_king_zing_sprite_code(): void {
  w16(R.zinger_loop_sound_enabler, r16(R.zinger_loop_sound_enabler) + 1);
  spriteStateDispatch(KING_ZING_TABLE, [CODE_BEEA9B, CODE_BEEAB0, CODE_BEEAF7, CODE_BEEB34]);
}

function CODE_BEEA9B(): void {
  const x = reg.y;
  s(x, 0x22, g(x, 0x12));
  s(x, 0x28, 0x0100);
  inc(x, 0x2e);
}

function CODE_BEEAAA(): void {
  CODE_BEEABF();
  despawn();
}

function CODE_BEEAB0(): void {
  CODE_BEEABF();
  if (reg.c) return;
  reg.a = 0x0005;
  transition_song();
}

/** $BEEABF — wait until the Kong is in front (CODE_B3C6AB), then start the script. */
function CODE_BEEABF(): void {
  CODE_BEEB42();
  animMove();
  const x = reg.x;
  reg.a = g(x, 0x5c);
  reg.y = g(x, 0x50);
  CODE_B3C6AB();
  if (reg.c) return;
  CODE_BEEC57(0x004e);
  inc(cur(), 0x2e);
  reg.c = false;
}

function CODE_BEEAE0(): void {
  CODE_BEEB1C();
  const x = cur();
  const d = (g(x, 0x06) - r16(R.screen_scroll_x_position) + 0x0010) & 0xffff;
  if (d < 0x0120) return;
  despawn();
}

/** The chase ends when the Kong reaches the exit area. */
function CODE_BEEAF7(): void {
  CODE_BEEB1C();
  const k = r16(R.active_kong_sprite);
  if (g(k, 0x06) < 0x0970) return;
  if (g(k, 0x0a) >= 0x0918) return;
  if (g(k, 0x0a) < 0x0840) return;
  delete_sprite_handle_deallocation();
}

function CODE_BEEB1C(): void {
  CODE_BEEB42();
  animMove();
  const x = reg.x;
  if (g(x, 0x52) !== 0) return;
  inc(x, 0x2e);
  CODE_BEEC57(0x004e);
}

function CODE_BEEB34(): void {
  CODE_BEEB42();
  animMove();
  despawn();
}

/** $BEEB42 — hurt the Kong on contact. */
function CODE_BEEB42(): void {
  get_current_sprite_clipping();
  reg.a = 0;
  CODE_BEBE8B();
}

// =============================================================================================
// Screech ($BEEB4E)
// =============================================================================================

/** $BEEB4E — Screech racing the Kongs up the Flying Krock. */
export function screech_sprite_code(): void {
  spriteStateDispatch(SCREECH_TABLE, [
    CODE_BEEB63, CODE_BEEB6F, CODE_BEEB88, CODE_BEEBA4, CODE_BEEBC3, CODE_BEEBE7, CODE_BEEC05,
    CODE_BEEC10, CODE_BEEC2E,
  ]);
}

function CODE_BEEB63(): void {
  const x = reg.y;
  s(x, 0x22, g(x, 0x12));
  s(x, 0x28, 0x0100);
  inc(x, 0x2e);
  reg.x = x;
  CODE_BEEB6F();
}

/** 01: wait for the Kong to get in front of him. */
function CODE_BEEB6F(): void {
  animMove();
  const x = reg.x;
  reg.a = g(x, 0x5c);
  reg.y = g(x, 0x50);
  CODE_B3C6AB();
  if (!reg.c) inc(cur(), 0x2e);
}

/** 02: spawn the traffic light. */
function CODE_BEEB88(): void {
  animMove();
  reg.y = C.special_sprite_spawn_id_00F8;
  spawn_special_sprite_index();
  if (reg.c) return;
  const x = cur();
  s(x, 0x5c, r16(R.alternate_sprite));
  inc(x, 0x2e);
}

/** 03: wait for the green light. */
function CODE_BEEBA4(): void {
  animMove();
  const x = cur();
  if (g(g(x, 0x5c), 0x2e) < 0x0800) return;
  inc(x, 0x2e);
  CODE_BEEC57(0x004e);
}

/** 04: race (state 5 if the Kong reaches the goal first, 7 when Screech's script ends). */
function CODE_BEEBC3(): void {
  CODE_BEEC45();
  reg.x = cur();
  let a = 5;
  if (!reg.c) {
    animMove();
    if (g(reg.x, 0x52) !== 0) return;
    a = 7;
  }
  // CODE_BEEBDC
  s(reg.x, 0x2e, a);
  CODE_BEEC57(0x004e);
}

/** 05: the player won: race flag with place 1. */
function CODE_BEEBE7(): void {
  reg.y = C.special_sprite_spawn_id_00FA;
  spawn_special_sprite_index();
  if (!reg.c) {
    inc(cur(), 0x2e);
    w16(0x0d5c, 0x0101);
  }
  animMove();
}

function CODE_BEEC05(): void {
  animMove();
  despawn();
}

/** 07: the player lost: race flag with place 2. */
function CODE_BEEC10(): void {
  reg.y = C.special_sprite_spawn_id_00FA;
  spawn_special_sprite_index();
  if (!reg.c) {
    inc(cur(), 0x2e);
    w16(0x0d5c, 0x0202);
  }
  animMove();
}

/** 08: Screech won: the Kong loses (drop the partner). */
function CODE_BEEC2E(): void {
  get_kong_state_flags_if_one_kong();
  if (reg.c) {
    reg.a = C.player_interaction_22;
    set_player_interaction_global();
    if (reg.c) return CODE_BEEC05();
  }
  s(cur(), 0x2e, 6);
  CODE_BEEC05();
}

/** $BEEC45 — carry set when the Kong is past the finish (x >= $0AD8, y <= $01FF). */
function CODE_BEEC45(): void {
  const k = r16(R.active_kong_sprite);
  reg.y = k;
  if (g(k, 0x06) < 0x0ad8) {
    reg.c = false;
    return;
  }
  reg.c = 0x01ff >= g(k, 0x0a);
}

/**
 * $BEEC57 — A = sprite offset of a script pointer: run its (offset, value) pairs on the
 * sprite until a negative word, then store the pointer past it.
 */
function CODE_BEEC57(off: number): void {
  const me = cur();
  const at = (off + me) & 0xffff;
  w16(0x5e, r16(at));
  w16(0x60, r16(R.current_sprite_constants_bank));
  const base = r16(0x5e) | ((r16(0x60) & 0xff) << 16);
  let y = 0;
  for (;;) {
    const a = bus16((base + y) & 0xffffff);
    if (neg(a)) break;
    const dst = (a + cur()) & 0xffff;
    y += 2;
    const v = bus16((base + y) & 0xffffff);
    y += 2;
    w16(dst, v);
  }
  y++;
  w16(at, (y + r16(0x5e) + 1) & 0xffff);
  reg.x = at;
  reg.y = y;
}

// =============================================================================================
// Giant tire ($BEEC82): a spawner (state 1) that rolls tires down the slope (state 2).
// =============================================================================================

/** $BEEC82 — giant tire. */
export function giant_tire_sprite_code(): void {
  const y = cur();
  reg.y = y;
  const state = g(y, 0x2e) & 0xff;
  reg.a = g(y, 0x2f) & 0xff;
  reg.x = state << 1;
  if (state === 0) return CODE_BEEC9B();
  if (state === 1) return CODE_BEECD6();
  if (state === 2) return CODE_BEED3A();
}

/** Allocate the 3 shared VRAM slots of the tire graphics (once). */
function CODE_BEEC9B(): void {
  if ((r16(0x19b4) | r16(0x19b6)) === 0) {
    reg.x = reg.y;
    for (let y = 6; y !== 0; y -= 2) {
      reg.a = 2;
      allocate_sprite_vram_multi_slot_global();
      if (reg.c) {
        // CODE_BEECCA
        w16(0x19b8, 0);
        w16(0x19b6, 0);
        w16(0x19b4, 0);
        return;
      }
      w16(TIRE_VRAM + y, g(reg.x, 0x12) & 0x01e0);
    }
  }
  // CODE_BEECBE
  const x = cur();
  s(x, 0x2e, g(x, 0x2f) & 0xff);
}

/** Spawner: roll a tire when the Kong is on the right side, every $46 frames. */
function CODE_BEECD6(): void {
  let x = reg.y;
  if (((reg.a << 1) & 0xffff) === 0) {
    s(x, 0x50, g(x, 0x42));
    inc(x, 0x2f);
  }
  const k = r16(R.active_kong_sprite);
  const side = (g(k, 0x06) - g(x, 0x06) + g(x, 0x4a)) & 0xffff;
  if (neg(side ^ g(x, 0x26))) s(x, 0x44, g(x, 0x46));
  const t = (g(x, 0x44) - 1) & 0xffff;
  if (!neg(t)) s(x, 0x44, t);
  else if (g(x, 0x42) !== 0) {
    // CODE_BEECFD
    reg.y = g(x, 0x48);
    spawn_BB83EF_special_sprite_address();
    if (!reg.c) {
      x = cur();
      dec(x, 0x42);
      s(x, 0x44, g(x, 0x46));
      const tire = r16(R.alternate_sprite);
      s(tire, 0x50, x);
      s(tire, 0x20, g(x, 0x20));
      s(tire, 0x26, g(x, 0x26));
      s(tire, 0x24, g(x, 0x24));
      reg.a = sound(5, C.sound_tire_appear);
      queue_sound_effect();
    }
  }
  // CODE_BEED2B
  x = cur();
  if (g(x, 0x42) === g(x, 0x44)) CODE_BBBB99();
}

/** Rolling tire. */
function CODE_BEED3A(): void {
  w16(R.current_sprite_constants, g(reg.y, 0x54));
  CODE_BEEDEE();
  process_current_movement();
  get_current_sprite_clipping();
  reg.y = 0x0030;
  CODE_BEBE8E();
  CODE_BEED5A();
  CODE_BEED98();
}

/** $BEED5A — animate; the frames share 3 VRAM slots, upload a frame only when needed. */
function CODE_BEED5A(): void {
  process_sprite_animation();
  const x = cur();
  const f = g(x, 0x1a);
  if (f === 0 || f === g(x, 0x18)) return;
  const y = ((f - C.giant_tire_roll_frame1) & 0xffff) >> 1;
  const slot = r16(0x19b4 + y);
  const loaded = slot >= 0x8000;
  const a = ((slot ^ g(x, 0x12)) & 0x01e0) ^ g(x, 0x12);
  s(x, 0x12, a);
  if (loaded) {
    s(x, 0x18, f);
    s(x, 0x16, f);
    reg.y = f;
    return;
  }
  // CODE_BEED86
  reg.a = a;
  reg.x = x;
  reg.y = y;
  CODE_B59C00();
  if (reg.c) return;
  w16(0x19b4 + y, r16(0x19b4 + y) | 0x8000);
}

/** $BEED98 — gone (fell below / rolled off screen): free it, and the VRAM once all are gone. */
function CODE_BEED98(): void {
  let x = cur();
  const d = g(x, 0x0a) - 0x0220;
  if (d < 0) return;
  if ((d & 0xffff) < r16(R.screen_scroll_y_position)) {
    const dx = g(x, 0x06) - r16(R.screen_scroll_x_position);
    if (neg(g(x, 0x26))) {
      if (dx >= 0) return;
    } else if (neg(((dx & 0xffff) - 0x0100) & 0xffff)) return;
  }
  // CODE_BEEDBA
  check_if_sprite_offscreen_global();
  if (!reg.c) return;
  const y = cur();
  const spawner = g(y, 0x50);
  if (spawner) {
    inc(spawner, 0x42);
    s(y, 0x00, 0);
  } else {
    CODE_BBBB99();
    if (!reg.c) return;
  }
  // CODE_BEEDD3
  x = cur();
  reg.a = g(x, 0x12);
  dereference_sprite_palette_global();
  w16(TIRE_VRAM, r16(TIRE_VRAM) - 1);
  if (r16(TIRE_VRAM) & 0x00ff) return;
  reg.a = TIRE_CLEANUP;
  CODE_B3D46C();
}

/** $BEEDEE — count the tire; start the rolling sound with the first one. */
function CODE_BEEDEE(): void {
  w16(TIRE_VRAM, r16(TIRE_VRAM) + 1);
  const a = r16(TIRE_VRAM);
  if (neg(a) || a < 0x0100) return;
  w16(TIRE_VRAM, a | 0x8000);
  reg.a = sound(4, C.sound_tire_roll);
  reg.c = true;
  queue_or_reset_looping_sound_effect();
}

/** $BEEE09 — (deferred) no tire left: free the VRAM slots and stop the rolling sound. */
export function CODE_BEEE09(): void {
  if (r16(TIRE_VRAM) & 0x00ff) return;
  for (let y = 6; y !== 0; y -= 2) {
    const x = (r16(TIRE_VRAM + y) & 0x01e0) >> 4;
    w16(R.sprite_vram_allocation_table + x, 0);
    w16(R.sprite_vram_allocation_table + 2 + x, 0);
    w16(TIRE_VRAM + y, 0);
  }
  reg.c = false;
  reg.a = sound(4, C.sound_tire_roll);
  queue_or_reset_looping_sound_effect();
}

register({
  double_zingers_sprite_code,
  chasing_king_zing_sprite_code,
  screech_sprite_code,
  giant_tire_sprite_code,
  CODE_BEEE09,
});
for (const n of ["double_zingers_sprite_code", "chasing_king_zing_sprite_code", "screech_sprite_code", "giant_tire_sprite_code"]) {
  setRetMode(L(n), RET_SPRITE);
}
