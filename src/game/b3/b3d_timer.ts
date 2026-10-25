/**
 * Bank $B3 — the bonus-level timer sprite ($B3DC21-$B3DF47).
 *
 * The timer is drawn as two digit sprites: the timer itself (tens) and a companion spawned at
 * +$100 x (units). Variables of the timer sprite:
 *   $42 bonus type (low 2 bits: 0 = collect stars, 1 = find the coin, 2 = bananas) / result
 *   $44 value restored at the end (banana count / $19BA)
 *   $46 seconds left (negative = stopped), $48 frame countdown (high byte) and reload (low byte)
 *   $4A companion digit sprite, $4C delay counter.
 * `bonus_timer_sprite` holds the sprite whose digits are visible: toggling it with the timer's
 * own address makes the digits blink when time is running out.
 */
import { r16, w16, rom16, or16, and16 } from "../../core/mem";
import { reg, callPtr } from "../../core/cpu";
import { L, R, C, sprite as S } from "../../core/sym";
import {
  spawn_special_sprite_index, enable_bullet_time_global, set_player_interaction_global,
  delete_sprite_handle_deallocation, queue_sound_effect,
} from "../../gen/routines";
import { cur, sr, sw, mi, merge, registerRts, registerRtl, registerSprite, spriteReturn } from "./b3d_common";

const STATE_TABLE = L("timer_sprite_code_state_table");
const DIGITS = L("DATA_B3DE2C");

/** $B3DC21 — timer sprite main: dispatch on the state. */
export function timer_sprite_code() {
  const y = cur();
  callPtr(0xb3, rom16(STATE_TABLE + ((sr(y, S.state) << 1) & 0xffff)));
}

/** $B3DC43 — state 0: spawn the units digit next to the timer and start it. */
export function CODE_B3DC43() {
  reg.y = C.special_sprite_spawn_id_00CC;
  spawn_special_sprite_index();
  if (reg.c) return CODE_B3DC74();
  const x = cur();
  const digit = r16(R.alternate_sprite);
  sw(x, 0x4a, digit);
  sw(digit, S.display_mode, 0xc000);
  sw(digit, S.x_position, sr(x, S.x_position) + 0x100);
  sw(digit, S.y_position, sr(x, S.y_position));
  sw(x, S.state, sr(x, S.state) + 1);
  w16(R.bonus_timer_sprite, x);
  sw(x, S.display_mode, 0xc000);
  CODE_B3DDA8();
  CODE_B3DC74();
}
/** $B3DC74 */
export function CODE_B3DC74() {
  spriteReturn();
}

/** $B3DC77 — state 1: counting down. */
export function CODE_B3DC77() {
  const x = cur();
  if ((sr(x, 0x42) & 3) === 2) w16(R.banana_display_timer, 0x77); // keep the banana counter shown
  CODE_B3DC89();
}
/** $B3DC89 */
export function CODE_B3DC89() {
  CODE_B3DD6D();
  CODE_B3DDA8();
  CODE_B3DEF4();
  if (reg.c) return CODE_B3DCA0();
  CODE_B3DF00();
  const x = cur();
  if (sr(x, 0x46) & 0x8000) return CODE_B3DCA0(); // time is up
  spriteReturn();
}
/** $B3DCA0 — bonus over: freeze the game briefly and go to state 8. */
export function CODE_B3DCA0() {
  reg.a = 0x1f;
  reg.y = 0x0004;
  enable_bullet_time_global();
  sw(cur(), S.state, 8);
  spriteReturn();
}

/** $B3DCB4 — states 2-5 do nothing. */
export function CODE_B3DCB4() {
  spriteReturn();
}
/** $B3DCB7 */
export function CODE_B3DCB7() {
  spriteReturn();
}
/** $B3DCBA */
export function CODE_B3DCBA() {
  spriteReturn();
}
/** $B3DCBD */
export function CODE_B3DCBD() {
  spriteReturn();
}

/** $B3DCC0 — state 6: end of a banana bonus, restore the banana count. */
export function CODE_B3DCC0() {
  and16(R.game_state_flags_2, ~0x0002);
  const x = cur();
  sw(x, 0x4c, 0x30);
  sw(x, S.state, sr(x, S.state) + 1);
  if ((sr(x, 0x42) & 3) !== 2) return CODE_B3DCFD();
  w16(0x19d8, r16(R.banana_count) | 0x8000);
  const count = sr(x, 0x44);
  w16(R.banana_count, count);
  w16(R.banana_counter_current, count);
  w16(R.banana_counter_final, count);
  spriteReturn();
}
/** $B3DCF0 — state 7: wait, then restore $19BA and restart at state 0. */
export function CODE_B3DCF0() {
  const x = cur();
  const t = (sr(x, 0x4c) - 1) & 0xffff;
  sw(x, 0x4c, t);
  if (t & 0x8000) {
    w16(0x19ba, sr(x, 0x44));
    sw(x, S.state, 0);
  }
  CODE_B3DCFD();
}
/** $B3DCFD */
export function CODE_B3DCFD() {
  spriteReturn();
}

/** $B3DD00 — state 8: once the freeze is over, either win (state 9) or lose (state $0A). */
export function CODE_B3DD00() {
  CODE_B3DDA8();
  CODE_B3DEF4();
  if (reg.c) return CODE_B3DD21();
  reg.a = 0x1f;
  reg.y = 0x0400;
  enable_bullet_time_global();
  const x = cur();
  sw(x, S.state, 0x0a);
  sw(x, 0x42, 0x0a);
  spriteReturn();
}
/** $B3DD21 — bonus won: player interaction $27 (celebrate). */
export function CODE_B3DD21() {
  const x = cur();
  sw(x, S.state, sr(x, S.state) + 1);
  reg.a = C.player_interaction_27;
  set_player_interaction_global();
  if (!reg.c) w16(R.interaction_RAM_0A86, sr(cur(), 0x42));
  CODE_B3DD35();
}
/** $B3DD35 */
export function CODE_B3DD35() {
  spriteReturn();
}

/** $B3DD38 — state 9: show the digits one last time and delete the timer. */
export function CODE_B3DD38() {
  CODE_B3DDA8();
  CODE_B3DE26();
  CODE_B3DE0A();
  delete_sprite_handle_deallocation();
  spriteReturn();
}

/** $B3DD48 — state $0A: bonus lost; after $42 frames, player interaction $28 (leave). */
export function CODE_B3DD48() {
  const x = cur();
  const t = (sr(x, 0x42) - 1) & 0xffff;
  sw(x, 0x42, t);
  if (t === 0) return CODE_B3DD54();
  CODE_B3DDA8();
  spriteReturn();
}
/** $B3DD54 */
export function CODE_B3DD54() {
  const x = cur();
  sw(x, S.state, sr(x, S.state) + 1);
  reg.a = C.player_interaction_28;
  set_player_interaction_global();
  CODE_B3DE26();
  CODE_B3DE0A();
  delete_sprite_handle_deallocation();
  spriteReturn();
}

/** $B3DD6A — state $0B: nothing. */
export function CODE_B3DD6A() {
  spriteReturn();
}

/**
 * $B3DD6D — count one frame. The high byte of $48 counts down frames; when it underflows it
 * is reloaded from the low byte and one second is taken off $46, with a tick sound (and the
 * "hurry up" tempo below 11 seconds).
 */
export function CODE_B3DD6D() {
  const x = cur();
  let v = (sr(x, 0x48) - 0x100) & 0xffff;
  sw(x, 0x48, v);
  if (!(v & 0x8000)) return CODE_B3DDA7();
  const swapped = ((v >> 8) | (v << 8)) & 0xffff;
  v = merge(v, swapped, 0xff00);
  sw(x, 0x48, v);
  const secs = sr(x, 0x46);
  if (secs & 0x8000) return CODE_B3DDA7();
  const left = (secs - 1) & 0xffff;
  sw(x, 0x46, left);
  if (left & 0x8000) return CODE_B3DDA7();
  if (!mi(secs, 0x0b)) return CODE_B3DDA0();
  reg.a = (6 << 8) | C.sound_clock_tick;
  queue_sound_effect();
  reg.a = (4 << 8) | C.sound_tempo_up;
  queue_sound_effect();
  CODE_B3DDA7();
}
/** $B3DDA0 */
export function CODE_B3DDA0() {
  reg.a = (6 << 8) | C.sound_clock_tick;
  queue_sound_effect();
  CODE_B3DDA7();
}
/** $B3DDA7 */
export function CODE_B3DDA7() {}

/** $B3DDA8 — update both digit graphics, blinking faster as the time runs out. */
export function CODE_B3DDA8() {
  const x = cur();
  reg.x = x;
  const secs = sr(x, 0x46);
  if (secs & 0x8000) return CODE_B3DDE5();
  if (mi(secs, 1)) return CODE_B3DDED();
  if (mi(secs, 6)) return CODE_B3DDF2();
  if (mi(secs, 0x0b)) return CODE_B3DDFE();
  CODE_B3DDBD();
}
/** $B3DDBD */
export function CODE_B3DDBD() {
  reg.a = sr(reg.x, 0x46);
  CODE_B3DDBF();
}
/** $B3DDBF — A = seconds: look up its two decimal digits and set both graphics. */
export function CODE_B3DDBF() {
  const digits = rom16(DIGITS + ((reg.a << 1) & 0xffff));
  w16(R.temp_32, digits);
  const x = cur();
  reg.x = x;
  sw(x, S.current_graphic, (digits & 0xff) * 4 + C.timer_0_graphic);
  const y = sr(x, 0x4a);
  reg.y = y;
  reg.a = ((r16(R.temp_33) & 0xff) * 4 + C.timer_0_graphic) & 0xffff;
  sw(y, S.current_graphic, reg.a);
}
/** $B3DDE5 — stopped: show "00", digits visible. */
export function CODE_B3DDE5() {
  CODE_B3DE26();
  reg.a = 0;
  CODE_B3DDBF();
}
/** $B3DDED — 0 seconds: blink every frame. */
export function CODE_B3DDED() {
  CODE_B3DE0A();
  CODE_B3DDBD();
}
/** $B3DDF2 — 1-5 seconds: blink every 4 frames. */
export function CODE_B3DDF2() {
  if ((r16(R.active_frame_counter) & 3) === 0) CODE_B3DE0A();
  CODE_B3DDBD();
}
/** $B3DDFE — 6-10 seconds: blink every 8 frames. */
export function CODE_B3DDFE() {
  if ((r16(R.active_frame_counter) & 7) === 0) CODE_B3DE0A();
  CODE_B3DDBD();
}
/** $B3DE0A — toggle the digits' visibility. */
export function CODE_B3DE0A() {
  reg.a = r16(R.bonus_timer_sprite) ^ r16(R.current_sprite);
  w16(R.bonus_timer_sprite, reg.a);
}
/** $B3DE26 — make the digits visible. */
export function CODE_B3DE26() {
  reg.a = r16(R.current_sprite);
  w16(R.bonus_timer_sprite, reg.a);
}

/** $B3DEF4 — carry set when the bonus goal has been reached (game_state_flags_2 bit 1). */
export function CODE_B3DEF4() {
  if (r16(R.game_state_flags_2) & 0x0002) return CODE_B3DEFE();
  reg.c = false;
}
/** $B3DEFE */
export function CODE_B3DEFE() {
  reg.c = true;
}

/** $B3DF00 — once per bonus: when the goal is complete, flag it ($0923 bit 0) with the coin jingle. */
export function CODE_B3DF00() {
  if (r16(0x0923) & 0x0001) return CODE_B3DF17();
  const kind = sr(reg.x, 0x42) & 3;
  if (kind === 0) return CODE_B3DF1E();
  if (kind === 1) return CODE_B3DF18();
  if (r16(R.banana_counter_current) === 0) return CODE_B3DF25();
  CODE_B3DF17();
}
/** $B3DF17 */
export function CODE_B3DF17() {}
/** $B3DF18 */
export function CODE_B3DF18() {
  if (r16(0x19ba) === 0) return CODE_B3DF25();
}
/** $B3DF1E */
export function CODE_B3DF1E() {
  or16(0x0923, 0x0001);
  CODE_B3DF24();
}
/** $B3DF24 */
export function CODE_B3DF24() {}
/** $B3DF25 — the Kremkoin appear sound (three channels). */
export function CODE_B3DF25() {
  reg.a = (6 << 8) | C.sound_kremkoin_appear_fizz;
  queue_sound_effect();
  reg.a = (5 << 8) | C.sound_kremkoin_appear_echo;
  queue_sound_effect();
  reg.a = (7 << 8) | C.sound_kremkoin_appear;
  queue_sound_effect();
  CODE_B3DF1E();
}

/** $B3DF3C — clear the "hidden" display mode ($C000) of the current sprite. */
export function CODE_B3DF3C() {
  const x = cur();
  reg.x = x;
  reg.a = sr(x, S.display_mode);
  if (reg.a === 0xc000) sw(x, S.display_mode, 0);
  CODE_B3DF47();
}
/** $B3DF47 */
export function CODE_B3DF47() {}

registerSprite({
  timer_sprite_code, CODE_B3DC43, CODE_B3DC74, CODE_B3DC77, CODE_B3DC89, CODE_B3DCA0, CODE_B3DCB4,
  CODE_B3DCB7, CODE_B3DCBA, CODE_B3DCBD, CODE_B3DCC0, CODE_B3DCF0, CODE_B3DCFD, CODE_B3DD00,
  CODE_B3DD21, CODE_B3DD35, CODE_B3DD38, CODE_B3DD48, CODE_B3DD54, CODE_B3DD6A,
});
registerRts({
  CODE_B3DD6D, CODE_B3DDA0, CODE_B3DDA7, CODE_B3DDA8, CODE_B3DDBD, CODE_B3DDBF, CODE_B3DDE5,
  CODE_B3DDED, CODE_B3DDF2, CODE_B3DDFE, CODE_B3DE0A, CODE_B3DE26, CODE_B3DEF4, CODE_B3DEFE,
  CODE_B3DF00, CODE_B3DF17, CODE_B3DF18, CODE_B3DF1E, CODE_B3DF24, CODE_B3DF25,
});
registerRtl({ CODE_B3DF3C, CODE_B3DF47 });
