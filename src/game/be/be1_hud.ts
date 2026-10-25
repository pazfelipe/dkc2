/**
 * Bank $BE — HUD: items flying to the HUD, life/banana counters and the OAM-drawn HUD
 * ($BEC5BC-$BEC9AF).
 *
 * Collected coins and KONG letters become screen-space sprites that move to a target HUD
 * position (target kept in the high bytes of the x/y speed fields). The life counter (with the
 * Kong icon), banana counter, bonus timer, KONG letters and coin counter are drawn every frame
 * by CODE_BEC695 (called from render_sprites) straight into the OAM buffer: each digit is a
 * pair of 8x8 tiles (top/bottom) placed by CODE_BEC81F.
 */
import { r8, r16, w8, w16, rom16, io8, io16, ioR16 } from "../../core/mem";
import { reg, register } from "../../core/cpu";
import { setRetMode, RET_RTS } from "../../core/hybrid";
import { adc16, flags } from "../../core/ops";
import { L, R, C, CPU, sprite as S, sprite_table, oam_attribute } from "../../core/sym";
import { request_palette_direct_global, CODE_B59CAE, queue_sound_effect } from "../../gen/routines";
import { cur, adcBcd16, sbcBcd16 } from "./be1_util";

const OAM_SIZE_BITS = L("DATA_BEC985"); // "large" bit of an OAM entry in the high table
const DIDDY_PALETTE = L("diddy_active_sprite_palette") & 0xffff; // palette data address
const OAM_X9_BITS = L("DATA_BEC9B0"); // bit 8 of x of an OAM entry in the high table

// ---------------------------------------------------------------------------------------------
// Items flying to the HUD
// ---------------------------------------------------------------------------------------------

/**
 * $BEC5BC — A = HUD target (low byte x, high byte y): turn the current sprite into a
 * screen-space sprite at its on-screen position (clamped to 0-255) that will fly there.
 */
export function set_sprite_target_hud_position(): void {
  const x = cur();
  reg.x = x;
  const target = reg.a & 0xffff;
  // targets go in the high bytes of the x/y speeds (8.8 screen positions)
  w8(x + S.y_speed, 0);
  w8(x + S.y_speed + 1, target >> 8);
  w8(x + S.x_speed, 0);
  w8(x + S.x_speed + 1, target & 0xff);
  w16(x + S.display_mode, 0x8000);
  w16(x + S.x_position, toScreen(r16(x + S.x_position), r16(R.screen_scroll_x_position)));
  const y = toScreen(r16(x + S.y_position), r16(R.screen_scroll_y_position));
  w16(x + S.y_position, y);
  reg.a = y;
}

function toScreen(pos: number, scroll: number): number {
  if (pos < scroll) return 0;
  const d = pos - scroll;
  return d >= 0x100 ? 0xff : d;
}

/**
 * $BEC5FA — move the current sprite (8.8 fixed point, at $05/$09) toward its HUD target.
 * Y = 2 minus the number of axes already there, minus 1: N set (Y = $FFFF) once arrived.
 */
export function move_sprite_to_target_hud_position(): void {
  const x = cur();
  reg.x = x;
  reg.y = 2;
  let pos = r16(x + 0x05);
  w16(x + 0x05, (CODE_BEC61B_step(r16(x + S.x_speed), pos) + pos) & 0xffff);
  pos = r16(x + 0x09);
  const v = (CODE_BEC61B_step(r16(x + S.y_speed), pos) + pos) & 0xffff;
  w16(x + 0x09, v);
  reg.a = v;
  reg.y = (reg.y - 1) & 0xffff;
  reg.n = (reg.y & 0x8000) !== 0;
  reg.z = reg.y === 0;
}

/** `SEC : SBC pos` then CODE_BEC61B: the step toward the target (decrements reg.y if there). */
function CODE_BEC61B_step(target: number, pos: number): number {
  const d = (target - pos) & 0xffff;
  reg.a = d;
  reg.z = d === 0;
  reg.c = target >= pos;
  CODE_BEC61B();
  return reg.a;
}

/**
 * $BEC61B — A = distance (flags of the subtraction): 0 → Y-1; else a step of 1/8 of the
 * distance (at least $80 = half a pixel), or the whole distance when below one pixel.
 */
export function CODE_BEC61B(): void {
  if (reg.z) {
    reg.y = (reg.y - 1) & 0xffff;
    return;
  }
  if (reg.c) return CODE_BEC62D();
  reg.a = (-reg.a) & 0xffff;
  CODE_BEC62D();
  reg.a = (-reg.a) & 0xffff;
}

/** $BEC62D — A = positive distance: the step to take. */
export function CODE_BEC62D(): void {
  const d = reg.a & 0xffff;
  if (d < 0x100) return;
  const step = d >> 3;
  reg.a = step < 0x80 ? 0x80 : step;
}

// ---------------------------------------------------------------------------------------------
// Lives and bananas
// ---------------------------------------------------------------------------------------------

/** $BEC63E — A = lives: take them back from the lives still to be shown as given. */
export function CODE_BEC63E(): void {
  const v = ((~reg.a & 0xff) + 1 + r8(R.lives_to_give_count)) & 0xff;
  w8(R.lives_to_give_count, v);
  reg.a = (reg.a & 0xff00) | v;
}

/** $BEC64C — A = lives: give extra lives (the HUD counts them up). */
export function CODE_BEC64C(): void {
  w8(R.lives_to_give_count, (reg.a + r8(R.lives_to_give_count)) & 0xff);
  CODE_BEC659();
}

/** $BEC659 — A = lives: add to the life count and show the life counter. */
export function CODE_BEC659(): void {
  w16(R.life_count, (reg.a + r16(R.life_count)) & 0xffff);
  if (!r16(R.life_display_timer)) w16(R.life_display_graphic_copy, 0);
  reg.a = 0x0078;
  w16(R.life_display_timer, reg.a);
}

/** $BEC66F — lose a life (only once: bit $2000 of game_state_flags marks it). */
export function CODE_BEC66F(): void {
  const flags0 = r16(R.game_state_flags);
  w16(R.game_state_flags, flags0 | 0x2000);
  reg.a = 0x2000;
  if (flags0 & 0x2000) return;
  CODE_BEC678();
}

/** $BEC678 — take a life and show the life counter. */
export function CODE_BEC678(): void {
  w16(R.life_count, (r16(R.life_count) - 1) & 0xffff);
  reg.a = 0x0078;
  w16(R.life_display_timer, 0x0078);
  w8(R.lives_to_take_count, (r8(R.lives_to_take_count) + 1) & 0xff);
}

/** $BEC689 — show the banana counter for at least 120 frames. */
export function CODE_BEC689(): void {
  reg.a = 0x0078;
  if (0x0078 >= r16(R.banana_display_timer)) w16(R.banana_display_timer, 0x0078);
}

// ---------------------------------------------------------------------------------------------
// HUD drawing
// ---------------------------------------------------------------------------------------------

/** $BEC695 — draw the HUD (called by render_sprites). */
export function CODE_BEC695(): void {
  reg.a = DIDDY_PALETTE;
  request_palette_direct_global();
  // only the palette slot number is wanted: undo the reference
  const ref = (R.sprite_palette_reference_count + reg.x) & 0xffff;
  w16(ref, (r16(ref) - 1) & 0xffff);
  w16(0x60, (reg.a & 0x0e00) | 0x3000); // attributes of the Kong icon
  w16(0x5e, (r16(0x0d2c) & 0x0e00) | 0x3000); // attributes of the digits
  CODE_BEC719();
  CODE_BEC84B();
  CODE_BEC6D6();
  // alternate the draw order so overlapping elements flicker instead of hiding each other
  if (!(r16(R.active_frame_counter) & 0x0010)) {
    CODE_BEC702();
    CODE_BEC8F8();
    CODE_BEC93A();
  } else {
    CODE_BEC6CC();
  }
}

/** $BEC6CC */
export function CODE_BEC6CC(): void {
  CODE_BEC93A();
  CODE_BEC702();
  CODE_BEC8F8();
}

/** $BEC6D6 — a number (1-10) in the high byte of $0D5C is drawn at the top of the screen. */
export function CODE_BEC6D6(): void {
  const v = r16(0x0d5c);
  if (!v || v & 0x8000 || !(v & 0xff00)) return;
  reg.x = 0x3000;
  w16(0x32, 0x3000);
  const n = v >> 8;
  if (n < 10) {
    reg.x = 0x007d;
    reg.a = n;
    return CODE_BEC81F();
  }
  reg.a = 1;
  reg.x = 0x0078;
  CODE_BEC81F();
  reg.a = 0;
  CODE_BEC81F();
}

/** $BEC702 — the bonus timer sprite and its second sprite are drawn here. */
export function CODE_BEC702(): void {
  const timer = r16(R.bonus_timer_sprite);
  reg.y = timer;
  if (!timer) return;
  CODE_BEC70F();
  reg.x = r16(R.bonus_timer_sprite);
  reg.y = r16(reg.x + S.general_purpose_4A);
  CODE_BEC70F();
}

/** $BEC70F — Y = sprite: render it at its (screen) position. */
export function CODE_BEC70F(): void {
  reg.x = r16(reg.y + S.x_position);
  reg.a = r16(reg.y + S.y_position);
  CODE_B59CAE();
}

/** $BEC719 — life counter: slide in, stay, slide out; count lives up/down one at a time. */
export function CODE_BEC719(): void {
  const timer = r16(R.life_display_timer);
  if (!timer) return;
  if (timer - 1 === 0) {
    // last frame: slide back out
    let y = r16(R.life_display_y_position) - 0x30;
    if (y < 0) {
      y = 0;
      w16(R.life_display_timer, 0);
    }
    w16(R.life_display_y_position, y);
  } else {
    const y = r16(R.life_display_y_position);
    if (y >= 0x0200) w16(R.life_display_timer, (r16(R.life_display_timer) - 1) & 0xffff);
    else w16(R.life_display_y_position, y + 0x30); // still sliding in: the timer waits
  }
  CODE_BEC748();
}

/** $BEC748 — draw the Kong icon and the life count. */
export function CODE_BEC748(): void {
  w16(R.life_display_graphic, C.diddy_icon_graphic);
  reg.x = 0x1d40;
  reg.y = (r16(R.life_display_y_position) + 0x1000) & 0xffff;
  reg.a = r16(0x60);
  CODE_BEC7FB();
  if (r16(R.active_frame_counter) & 0x000f) return CODE_BEC7B9();
  const give = r16(R.lives_to_give_count) & 0x00ff;
  const take = r16(R.lives_to_take_count) & 0x00ff;
  w16(0x32, give);
  w16(0x34, take);
  const target = (take - give + r16(R.life_count)) & 0xffff;
  const shown = r16(R.life_count_display);
  if (target > shown) return CODE_BEC7A9();
  // CODE_BEC783
  if (!take) return CODE_BEC7B9();
  CODE_BEC7B9();
  if (r16(R.life_display_timer) >= 0x005a) return;
  w16(R.lives_to_take_count, (r16(R.lives_to_take_count) - 1) & 0xffff);
  w16(R.life_count_display, (r16(R.life_count_display) - 1) & 0xffff);
  reg.a = (5 << 8) | C.sound_lose_life;
  queue_sound_effect();
  w16(R.life_display_y_position, 0);
  w16(R.life_display_timer, 0x005a);
}

/** $BEC7A9 — one more life shown. */
export function CODE_BEC7A9(): void {
  w16(R.life_count_display, (r16(R.life_count_display) + 1) & 0xffff);
  w16(R.life_display_timer, 0x003c);
  reg.a = (5 << 8) | C.sound_gain_life;
  queue_sound_effect();
  CODE_BEC7B9();
}

/** $BEC7B9 — draw the life count (at most 99) next to the icon. */
export function CODE_BEC7B9(): void {
  let n = r16(R.life_count_display);
  if (n & 0x8000) return;
  if (n >= 0x0063) n = 0x0063;
  io16(CPU.dividen, n);
  io8(CPU.divisor, 10);
  const yy = r16(R.life_display_y_position);
  const shifted = (yy << 4) & 0xffff;
  const carry = (yy & 0x1000) !== 0; // out of the last ASL
  w16(0x32, adc16(shifted, 0xf000, carry) & 0xff00);
  const tens = ioR16(CPU.divide_result);
  if (!tens) {
    reg.a = ioR16(CPU.divide_remainder);
    reg.x = 0x00e4;
    return CODE_BEC81F();
  }
  reg.a = tens;
  reg.x = 0x00df;
  CODE_BEC81F();
  reg.a = ioR16(CPU.divide_remainder);
  CODE_BEC81F();
}

/** $BEC7FB — draw the life icon through the auxiliary sprite slot 0 (X = x, Y = y). */
export function CODE_BEC7FB(): void {
  const s0 = sprite_table.slot_0;
  w16(s0 + S.oam_property, reg.a | 0x01c0);
  w16(s0 + S.last_rendered_graphic, r16(R.life_display_graphic_copy));
  w16(s0 + S.current_graphic, r16(R.life_display_graphic));
  w16(s0 + S.display_mode, 0);
  reg.a = reg.y;
  reg.y = s0;
  CODE_B59CAE();
  w16(R.life_display_graphic_copy, r16(s0 + S.current_graphic_mirror));
}

/**
 * $BEC81F — A = digit, X = screen x (low byte; $32 high byte = y), $5E = attributes: put the
 * digit's two 8x8 tiles (top and bottom) in the OAM buffer. X advances by 8.
 */
export function CODE_BEC81F(): void {
  const y = r16(R.next_oam_slot);
  reg.y = y;
  let a = adc16(reg.a, 0x01cc, false) | r16(0x5e);
  w16(y + 2, a);
  a = adc16(a, 0x000a, flags.c);
  w16(y + 6, a);
  const pos = reg.x | r16(0x32);
  w16(y + 0, pos);
  w16(y + 4, (pos + 0x0800) & 0xffff);
  w16(R.next_oam_slot, (y + 8) & 0xffff);
  reg.x = (reg.x + 8) & 0xffff;
  reg.a = reg.x;
}

/** $BEC84B — banana counter: count up to the real total, give a life every 100. */
export function CODE_BEC84B(): void {
  const final = r16(R.banana_counter_final);
  const current = r16(R.banana_counter_current);
  if (final === current) {
    if (r16(R.banana_display_timer)) CODE_BEC8A7();
    return;
  }
  // CODE_BEC87B
  if (!(r16(R.banana_display_timer) & 0x8000)) w16(R.banana_display_timer, 0x003c);
  if (final >= current) {
    // CODE_BEC894
    if (current >= 0x0099) return CODE_BEC859();
    w16(R.banana_counter_current, adcBcd16(0x0001, current, false));
  } else {
    if (r16(R.active_frame_counter) & 0x0003) return CODE_BEC8A7();
    w16(R.banana_counter_current, adcBcd16(0x9999, current, false)); // -1
  }
  CODE_BEC8A7();
}

/** $BEC859 — 100 bananas: back to 0 and an extra life. */
export function CODE_BEC859(): void {
  w16(R.banana_count, sbcBcd16(r16(R.banana_count), 0x0099, false));
  w16(R.banana_counter_final, sbcBcd16(r16(R.banana_counter_final), 0x0099, false));
  w16(R.banana_counter_current, 0);
  reg.a = 1;
  CODE_BEC659();
  CODE_BEC8A7();
}

/** $BEC8A7 — draw the banana icon (animated) and the banana count. */
export function CODE_BEC8A7(): void {
  w16(R.banana_display_timer, (r16(R.banana_display_timer) - 1) & 0xffff);
  let y = r16(R.next_oam_slot);
  w16(y, 0x0808);
  const frame = (r16(R.active_frame_counter) & 0x001c) >> 1;
  w16(y + 2, ((frame + r16(0x0d2c)) & 0xffff) | 0x3000);
  reg.y = y;
  CODE_BEC96A();
  y = (y + 4) & 0xffff;
  w16(R.next_oam_slot, y);
  reg.y = y;
  reg.x = 0x0018;
  w16(0x32, 0x0800);
  const hundreds = r16(R.RAM_096C) & 0x000f;
  if (hundreds) {
    reg.a = hundreds;
    CODE_BEC81F();
  }
  CODE_BEC8DD();
}

/** $BEC8DD — tens (unless 0) and ones of the banana count. */
export function CODE_BEC8DD(): void {
  const count = r16(R.banana_counter_current);
  if (count & 0x0ff0) {
    reg.a = ((count & 0x0ff0) >> 4) & 0x000f;
    CODE_BEC81F();
  }
  CODE_BEC8EF();
}

/** $BEC8EF */
export function CODE_BEC8EF(): void {
  reg.a = r16(R.banana_counter_current) & 0x000f;
  CODE_BEC81F();
}

/** $BEC8F8 — the collected KONG letters, drawn where the letter sprite keeps them. */
export function CODE_BEC8F8(): void {
  const x = r16(R.collected_kong_letter_sprite);
  reg.x = x;
  if (!x) return;
  const prop = r16(x + S.oam_property);
  if (prop & 0x8000) return;
  w16(0x32, prop);
  for (let i = 0; i < 4; i++) CODE_BEC90C();
}

/** $BEC90C — X = letter slot (positions at $42,x): draw one letter if it has a position. */
export function CODE_BEC90C(): void {
  const x = reg.x;
  const pos = r16(x + S.general_purpose_42);
  if (pos) {
    const y = r16(R.next_oam_slot);
    w8(y, ((pos & 0xff) - 8) & 0xff);
    w8(y + 1, ((pos >> 8) - 0x10) & 0xff);
    w16(y + 2, r16(0x32));
    reg.y = y;
    CODE_BEC96A();
    reg.x = x;
    w16(R.next_oam_slot, (y + 4) & 0xffff);
    reg.y = (y + 4) & 0xffff;
  }
  w16(0x32, (r16(0x32) + 2) & 0xffff);
  reg.x = (x + 2) & 0xffff;
}

/** $BEC93A — the coin counter of a coin flying to/staying in the HUD. */
export function CODE_BEC93A(): void {
  const y = r16(R.collected_coin_sprite);
  reg.y = y;
  if (!y) return;
  CODE_BEC940();
}

/** $BEC940 */
export function CODE_BEC940(): void {
  const y = reg.y;
  const p = r16(y + S.general_purpose_44);
  reg.x = p & 0x00ff;
  w16(0x32, p & 0xff00);
  const digits = r16(y + S.general_purpose_46);
  if (digits < 0x0100) {
    // one digit: centred under the coin
    reg.x = (reg.x + 4) & 0xffff;
    reg.a = digits;
    return CODE_BEC81F();
  }
  reg.a = digits >> 8;
  CODE_BEC81F();
  reg.a = digits & 0x00ff;
  CODE_BEC81F();
}

function oamHighBits(table: number): void {
  const y = reg.y;
  const x = y & 0x000c;
  const i = (y >> 4) & 0x001f;
  const a = oam_attribute.size + i;
  w16(a, r16(a) | rom16(table + x));
  reg.x = x;
  reg.a = r16(a);
}

/** $BEC96A — Y = OAM buffer entry: mark it as a large (16x16) sprite. */
export function CODE_BEC96A(): void {
  oamHighBits(OAM_SIZE_BITS);
}

/** $BEC995 — Y = OAM buffer entry: set bit 8 of its x position. */
export function CODE_BEC995(): void {
  oamHighBits(OAM_X9_BITS);
}

register({
  set_sprite_target_hud_position,
  move_sprite_to_target_hud_position,
  CODE_BEC61B,
  CODE_BEC62D,
  CODE_BEC63E,
  CODE_BEC64C,
  CODE_BEC659,
  CODE_BEC66F,
  CODE_BEC678,
  CODE_BEC689,
  CODE_BEC695,
  CODE_BEC6D6,
  CODE_BEC702,
  CODE_BEC70F,
  CODE_BEC719,
  CODE_BEC7B9,
  CODE_BEC7FB,
  CODE_BEC81F,
  CODE_BEC84B,
  CODE_BEC8F8,
  CODE_BEC90C,
  CODE_BEC93A,
  CODE_BEC96A,
  CODE_BEC995,
});
for (const n of [
  "CODE_BEC61B", "CODE_BEC62D", "CODE_BEC6D6", "CODE_BEC702", "CODE_BEC70F", "CODE_BEC719",
  "CODE_BEC7B9", "CODE_BEC7FB", "CODE_BEC81F", "CODE_BEC84B", "CODE_BEC8F8", "CODE_BEC90C",
  "CODE_BEC93A", "CODE_BEC96A", "CODE_BEC995",
]) setRetMode(L(n), RET_RTS);
