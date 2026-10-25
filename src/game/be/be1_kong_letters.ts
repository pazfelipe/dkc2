/**
 * Bank $BE — KONG letter sprite ($BEBA99-$BEBD8D).
 *
 * A collected letter flies to the top of the screen. The letter sprite that reaches the HUD
 * first becomes the HUD's "KONG" display (collected_kong_letter_sprite): it loads the letter
 * tiles into VRAM once and keeps one screen position per letter in $42/$44/$46/$48 (low byte
 * x, high byte y, 0 = not collected), drawn by CODE_BEC8F8. Letters drop in from above, stay
 * a while and leave; when all four are collected they fly to the centre one by one with their
 * voice sample ("K", "O", "N", "G") and an extra life is given.
 *
 * Variables: $4A = offset of this letter's position slot, $4C = letter bit, $4E = sound,
 * $4F/$50 = HUD target, $51 = resting y, $52 = all four collected (0) or not, $5C = timer.
 */
import { r8, w8, r16, w16, rom8 } from "../../core/mem";
import { reg, register } from "../../core/cpu";
import { setRetMode, RET_RTS, RET_SPRITE } from "../../core/hybrid";
import { L, R, C, sprite as S } from "../../core/sym";
import {
  process_sprite_animation,
  get_current_sprite_clipping,
  delete_sprite_handle_deallocation,
  queue_sound_effect,
} from "../../gen/routines";
import { cur, spriteStateDispatch } from "./be1_util";
import { sprite_return_handle_despawn_BE } from "./be1_coins";
import { CODE_BEBE6D } from "./be1_collision";
import {
  set_sprite_target_hud_position,
  move_sprite_to_target_hud_position,
  CODE_BEC63E,
  CODE_BEC64C,
} from "./be1_hud";

const STATE_TABLE = L("DATA_BEBA9C");
const VARIABLE_OFFSETS = L("DATA_BEBD4C");
const LETTER_TOP_TILES = L("kong_letter_graphics");
const LETTER_BOTTOM_TILES = L("DATA_C02501");

// sprite DMA queue (offsets from the queue in X)
const DMA_SIZE = 0x1732;
const DMA_DESTINATION = 0x1734;
const DMA_SOURCE_WORD = 0x1736;
const DMA_SOURCE_BANK = 0x1738;
const DMA_ENTRY = 8;

const inc16 = (a: number) => w16(a, (r16(a) + 1) & 0xffff);

/** $BEBA99 — KONG letter sprite. */
export function kong_letter_sprite_code(): void {
  spriteStateDispatch(STATE_TABLE, [CODE_BEBAAA, CODE_BEBB1F, CODE_BEBB2A, CODE_BEBB6E, CODE_BEBBCA, CODE_BEBC07, CODE_BEBC9A]);
}

/** $BEBAAA — state 0: waiting to be collected (gone if collected before). */
export function CODE_BEBAAA(): void {
  if (r16(reg.y + S.general_purpose_4C) & r16(R.collected_kong_letters)) {
    delete_sprite_handle_deallocation();
    return;
  }
  // CODE_BEBAB9
  process_sprite_animation();
  get_current_sprite_clipping();
  CODE_BEBE6D();
  if (!reg.c) return sprite_return_handle_despawn_BE();
  // CODE_BEBACA: collected
  let x = reg.x;
  w16(x + S.oam_property, r16(x + S.oam_property) | 0x3000);
  const slot = r16((x + r16(x + S.general_purpose_4A)) & 0xffff);
  reg.y = (x + r16(x + S.general_purpose_4A)) & 0xffff;
  reg.a = (slot & 0x00ff) | (r16(x + 0x4f) & 0xff00);
  set_sprite_target_hud_position();
  x = reg.x;
  inc16(x + S.state);
  w16(R.collected_kong_letters, r16(R.collected_kong_letters) | r16(x + S.general_purpose_4C));
  const remaining = (r16(R.collected_kong_letters) + 1) & 0x000f;
  w16(x + S.movement_state, remaining);
  if (!remaining) {
    // all four letters: an extra life
    reg.a = 1;
    CODE_BEC64C();
  }
  // CODE_BEBAFD
  reg.a = r16(x + S.general_purpose_4E);
  queue_sound_effect();
  x = cur();
  // positions of letters not collected yet are cleared
  const got = r16(R.collected_kong_letters);
  if (!(got & 1)) w16(x + S.general_purpose_42, 0);
  if (!(got & 2)) w16(x + S.general_purpose_44, 0);
  if (!(got & 4)) w16(x + S.general_purpose_46, 0);
  if (!(got & 8)) w16(x + S.general_purpose_48, 0);
}

/** $BEBB1F — state 1: flying to the HUD. */
export function CODE_BEBB1F(): void {
  process_sprite_animation();
  move_sprite_to_target_hud_position();
}

/** $BEBB2A — state 2: queue the letter tiles (top and bottom halves) for VRAM upload. */
export function CODE_BEBB2A(): void {
  move_sprite_to_target_hud_position();
  const y = cur();
  const vram = ((r16(y + S.oam_property) & 0x01ff) << 4) & 0xffff;
  reg.a = vram;
  reg.x = (LETTER_TOP_TILES >> 16) | 0x0800;
  reg.y = LETTER_TOP_TILES & 0xffff;
  CODE_BEBD5C();
  if (reg.c) return; // DMA queue full: try next frame
  reg.a = (vram + 0x0100) & 0xffff;
  reg.x = (LETTER_BOTTOM_TILES >> 16) | 0x0800;
  reg.y = LETTER_BOTTOM_TILES & 0xffff;
  CODE_BEBD5C();
  if (reg.c) {
    // no room for the second half: drop the first one too
    w16(R.next_sprite_dma_buffer_slot, (r16(R.next_sprite_dma_buffer_slot) - DMA_ENTRY) & 0xffff);
    return;
  }
  // CODE_BEBB61: this sprite now shows the KONG letters of the HUD
  const x = cur();
  w16(R.collected_kong_letter_sprite, x);
  w16(x + S.display_mode, 0xc000);
  inc16(x + S.state);
  reg.y = x;
  CODE_BEBB6E();
}

/** Move the y of every shown letter 2 pixels toward `target`; returns how many moved. */
function moveLetters(x: number, target: number, dir: number): number {
  let moved = 0;
  for (let i = 0; i < 4; i++, x += 2) {
    if (!r8(x + S.general_purpose_42)) continue;
    const y = r8(x + 0x43);
    if (y === target) continue;
    w8(x + 0x43, (y + 2 * dir) & 0xff);
    moved++;
  }
  return moved;
}

/** $BEBB6E — state 3: letters drop into place; once all four are there, the finale. */
export function CODE_BEBB6E(): void {
  let x = reg.y;
  w16(0x5e, 0);
  w16(0x60, r16(x + S.general_purpose_50));
  w8(0x5e, (r8(0x5e) + moveLetters(x, r8(0x60), 1)) & 0xff);
  move_sprite_to_target_hud_position();
  if (!reg.n) inc16(0x5e);
  // CODE_BEBB99: store the flying letter's screen position in its slot
  x = reg.x;
  const slot = (x + r16(x + S.general_purpose_4A)) & 0xffff;
  w16(slot, (r8(x + S.y_position) << 8) | r8(x + S.x_position));
  if (r16(0x5e)) return;
  inc16(x + S.state);
  if (r16(x + S.movement_state)) return;
  // all four letters: prepare them to fly to the centre (state 5)
  inc16(x + S.state);
  w16(x + S.unknown_5C, 0);
  for (let i = 3; i >= 0; i--) {
    reg.a = i;
    reg.c = true;
    reg.y = 0x20e8;
    CODE_BEBCB2();
  }
}

/** $BEBBCA — state 4: after a while the letters leave the screen, then the sprite is deleted. */
export function CODE_BEBBCA(): void {
  const x = reg.y;
  const t = (r16(x + S.unknown_5C) - 1) & 0xffff;
  w16(x + S.unknown_5C, t);
  if (!(t & 0x8000)) return;
  w16(0x5e, 0);
  w16(0x60, r16(x + 0x51));
  const moved = moveLetters(x, r8(0x60), -1);
  w8(0x5e, (r8(0x5e) + moved) & 0xff);
  if (r16(0x5e)) return;
  if (r16(R.current_sprite) === r16(R.collected_kong_letter_sprite)) w16(R.collected_kong_letter_sprite, 0);
  delete_sprite_handle_deallocation();
}

/** $BEBC07 — state 5: K, O, N, G fly to the centre in turn, each with its voice. */
export function CODE_BEBC07(): void {
  w16(R.life_display_timer, 0x0078);
  const x = cur();
  const t = (r16(x + S.unknown_5C) + 1) & 0xffff;
  w16(x + S.unknown_5C, t);
  if (t < 0x002f) {
    // blink
    const prop = r16(x + S.oam_property);
    w16(x + S.oam_property, t & 0x0008 ? prop & 0x7fff : prop | 0x8000);
    return;
  }
  const voice = (sound: number) => {
    reg.a = sound;
    queue_sound_effect();
  };
  // the later letters start later; each frame the letters from the newest down move
  let first: number;
  if (t === 0x002f) {
    voice((7 << 8) | C.sound_letter_k);
    first = 0;
  } else if (t < 0x004b) first = 0;
  else if (t === 0x004b) {
    voice((6 << 8) | C.sound_letter_o);
    first = 1;
  } else if (t < 0x0067) first = 1;
  else if (t === 0x0067) {
    voice((5 << 8) | C.sound_letter_n);
    first = 2;
  } else if (t < 0x0083) first = 2;
  else {
    if (t === 0x0083) voice((4 << 8) | C.sound_letter_g);
    first = 3;
  }
  for (let i = first; i >= 0; i--) {
    reg.a = i;
    reg.c = false;
    CODE_BEBCB2();
    if (!reg.n) continue; // not there yet: the next letter moves too
    if (i === 3) inc16(cur() + S.state); // G arrived: done
    // CODE_BEBC92: the letter that arrived disappears from the HUD
    w16(r16(0x32), 0);
    return;
  }
}

/** $BEBC9A — state 6: done (the extra life was already counted). */
export function CODE_BEBC9A(): void {
  delete_sprite_handle_deallocation();
  reg.a = 1;
  CODE_BEC63E();
  const x = cur();
  if (x === r16(R.collected_kong_letter_sprite)) w16(R.collected_kong_letter_sprite, 0);
}

/**
 * $BEBCB2 — A = letter (0-3). Carry set: start a flight (Y = target, low byte x, high byte y)
 * from the letter's HUD position, in 8.8 fixed point. Carry clear: one step of the flight;
 * N set on arrival (Y = $FFFF).
 */
export function CODE_BEBCB2(): void {
  if (!reg.c) return CODE_BEBCCE();
  const target = reg.y;
  CODE_BEBD0F();
  const pos = r16(r16(0x32));
  w16(r16(0x34), (pos & 0x00ff) << 8);
  w16(r16(0x36), pos & 0xff00);
  w16(r16(0x38), target);
  reg.y = 1;
  reg.n = false;
}

/** $BEBCCE — one step of a letter's flight to its target. */
export function CODE_BEBCCE(): void {
  CODE_BEBD0F();
  const pPos = r16(0x32);
  const pX = r16(0x34);
  const pY = r16(0x36);
  const pTarget = r16(0x38);
  if (!r16(pPos)) {
    // letter not shown
    reg.n = false;
    return;
  }
  w16(0x5e, 0x0200); // minimum x step
  const target = r16(pTarget);
  let fx = r16(pX);
  fx = (step((((target << 8) & 0xff00) - fx) & 0xffff, ((target << 8) & 0xff00) >= fx) + fx) & 0xffff;
  w16(pX, fx);
  w16(pPos, (fx & 0xff00) >> 8);
  w16(0x5e, 0x0040); // minimum y step
  let fy = r16(pY);
  fy = (step(((target & 0xff00) - fy) & 0xffff, (target & 0xff00) >= fy) + fy) & 0xffff;
  w16(pY, fy);
  w16(pPos, (fy & 0xff00) | r16(pPos));
  reg.y = (reg.y - 1) & 0xffff;
  reg.n = (reg.y & 0x8000) !== 0;
}

function step(d: number, noBorrow: boolean): number {
  reg.a = d;
  reg.z = d === 0;
  reg.c = noBorrow;
  CODE_BEBD2A();
  return reg.a;
}

/**
 * $BEBD0F — A = letter: point $32/$34/$36/$38 at its HUD position, x and y (8.8) and target
 * (sprite variables listed in DATA_BEBD4C).
 */
export function CODE_BEBD0F(): void {
  let x = (reg.a << 2) & 0xffff;
  const sprite = cur();
  for (let i = 0; i < 4; i++, x++) w16(0x32 + 2 * i, (rom8(VARIABLE_OFFSETS + x) + sprite) & 0xffff);
  reg.x = x;
  reg.y = 2;
}


/** $BEBD2A — A = distance (flags of the subtraction): the step, or Y-1 if there. */
export function CODE_BEBD2A(): void {
  if (reg.z) {
    reg.y = (reg.y - 1) & 0xffff;
    return;
  }
  if (reg.c) return CODE_BEBD3C();
  reg.a = -reg.a & 0xffff;
  CODE_BEBD3C();
  reg.a = -reg.a & 0xffff;
}

/** $BEBD3C — A = positive distance: 1/16 of it, at least $5E (the whole of it below a pixel). */
export function CODE_BEBD3C(): void {
  const d = reg.a & 0xffff;
  if (d < 0x0100) return;
  const s = d >> 4;
  reg.a = s < r16(0x5e) ? r16(0x5e) : s;
}

/**
 * $BEBD5C — queue a DMA to VRAM: A = destination, Y = source address, X = source bank (low
 * byte) | size/8 (high byte). Carry set when the queue is full.
 */
export function CODE_BEBD5C(): void {
  w16(0x32, reg.x);
  const x = r16(R.next_sprite_dma_buffer_slot);
  reg.x = x;
  if (x >= r16(0x78)) {
    reg.c = true;
    return;
  }
  w16(DMA_DESTINATION + x, reg.a);
  w16(DMA_SOURCE_WORD + x, reg.y);
  w16(DMA_SOURCE_BANK + x, (r16(0x32) & 0x00ff) | 0x8000);
  w16(DMA_SIZE + x, (r16(0x32) & 0xff00) >> 3);
  const next = x + DMA_ENTRY;
  w16(R.next_sprite_dma_buffer_slot, next & 0xffff);
  w16(DMA_SOURCE_BANK + DMA_ENTRY + x, 0); // terminator
  reg.a = next & 0xffff;
  reg.c = next > 0xffff;
}

register({
  kong_letter_sprite_code,
  CODE_BEBAAA,
  CODE_BEBB1F,
  CODE_BEBB2A,
  CODE_BEBB6E,
  CODE_BEBBCA,
  CODE_BEBC07,
  CODE_BEBC9A,
  CODE_BEBCB2,
  CODE_BEBCCE,
  CODE_BEBD0F,
  CODE_BEBD2A,
  CODE_BEBD3C,
  CODE_BEBD5C,
});
for (const n of ["kong_letter_sprite_code", "CODE_BEBAAA", "CODE_BEBB1F", "CODE_BEBB2A", "CODE_BEBB6E", "CODE_BEBBCA", "CODE_BEBC07", "CODE_BEBC9A"]) {
  setRetMode(L(n), RET_SPRITE);
}
for (const n of ["CODE_BEBCB2", "CODE_BEBCCE", "CODE_BEBD0F", "CODE_BEBD2A", "CODE_BEBD3C", "CODE_BEBD5C"]) setRetMode(L(n), RET_RTS);
