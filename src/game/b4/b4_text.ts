/**
 * Bank $B4 — text and HUD helpers of the Kong family screens: the text renderer (zero-terminated
 * lines of 32 characters into text_vram_buffer), the banana coin / Kremkoin counter sprites, the
 * text window HDMA, the screen-specific per-frame routines (Swanky's lights, Funky's plane), the
 * game's random number generator, divide_a_by_y, and the K. Rool note (CODE_B4AC65).
 */
import { r8, r16, w8, w16, io8, io16, ioR16, bus8, bus16 } from "../../core/mem";
import { reg, register } from "../../core/cpu";
import { setRetMode, RET_RTS } from "../../core/hybrid";
import { L, R, CPU, PPU, HDMA } from "../../core/sym";
import {
  CODE_BEC695,
  CODE_B59F40,
  interpolate_y_velocity_global,
  apply_position_from_velocity_global,
} from "../../gen/routines";
import { longW16, add16, dbW16 } from "./b4_util";

const lo16 = (a: number) => a & 0xffff;
const SWANKY_REFLECTION = L("swanky_lights_reflection_colors");
const SWANKY_LIGHTS = L("swanky_lights_colors");
const ROOL_NOTE_EN = lo16(L("DATA_B4AC84"));
const ROOL_NOTE_FR = lo16(L("DATA_B4AD3B"));

// ---------------------------------------------------------------------------------------------
// Text renderer

/** $B4ADDF — DB = $F7 (the dialogue text bank). */
export function CODE_B4ADDF() {
  reg.db = 0xf7;
}

/** $B4ADE5 — DB = $BA (the option menu text bank). */
export function CODE_B4ADE5() {
  reg.db = 0xba;
}

/** $B4ADEB — draw A lines of text from $F7:X at text_vram_buffer + Y. */
export function CODE_B4ADEB() {
  w8(0xd0, 0xf7);
  w8(0xcf, 0x00);
  CODE_B4AE08();
}

/** $B4ADF6 — draw A lines of text from $BA:X at text_vram_buffer + Y. */
export function CODE_B4ADF6() {
  w8(0xd0, 0xba);
  w8(0xcf, 0x00);
  CODE_B4AE08();
}

/** $B4AE01 — draw A lines of text from $B4:X at text_vram_buffer + Y. */
export function CODE_B4AE01() {
  w16(0xcf, 0xb4b4);
  CODE_B4AE08();
}

/**
 * $B4AE08 — the renderer: each zero-terminated line becomes 32 tilemap words (character - $20,
 * attribute $20), padded with zeroes. Leaves X past the text and DB = $B4.
 */
export function CODE_B4AE08() {
  reg.db = 0xb4;
  w16(0x0681, reg.a & 0xffff);
  w16(0xc9, 0x7e00);
  w16(0xc8, lo16(R.text_vram_buffer));
  w16(0xce, reg.x);
  let y = reg.y & 0xffff;
  do {
    w16(0x0685, 0x0020);
    for (;;) {
      const ch = bus8((r8(0xd0) << 16) | r16(0xce));
      if (ch === 0) break;
      longW16(0xc8, 0x2000 | ((ch - 0x20) & 0xff), y);
      y = (y + 2) & 0xffff;
      add16(0xce, 1);
      add16(0x0685, -1);
    }
    add16(0xce, 1);
    if (r16(0x0685) !== 0) {
      // pad the line (AND #$FF00 of the count: 0 for any real line)
      const pad = r16(0x0685) & 0xff00;
      do {
        longW16(0xc8, pad, y);
        y = (y + 2) & 0xffff;
      } while (add16(0x0685, -1) !== 0);
    }
  } while (add16(0x0681, -1) !== 0);
  reg.x = r16(0xce);
  reg.y = y;
}

/** $B4AC65 — graphics init $0A: K. Rool's note ("I've kidnapped that lumbering fool..."). */
export function CODE_B4AC65() {
  reg.db = 0xb4;
  w8(0xca, 0x7e);
  reg.x = r16(R.language_select) !== 0 ? ROOL_NOTE_FR : ROOL_NOTE_EN;
  reg.a = 0x0018;
  reg.y = 0;
  CODE_B4AE01();
}

// ---------------------------------------------------------------------------------------------
// Coin counter

/** $B4BB62 — the coin counter digits at X (ones, tens, hundreds) as 8x16 sprites at [$C8]. */
export function CODE_B4BB62() {
  const x = reg.x;
  let y = r16(R.npc_screen_type) === 0x0008 ? 0x1128 : 0x0f28; // Klubba's counter is lower
  const digit = (d: number) => {
    longW16(0xc8, y);
    add16(0xc8, 2);
    longW16(0xc8, 0x3e00 | ((d + 0x20) & 0xff));
    add16(0xc8, -6);
    longW16(0xc8, (y + 0x0800) & 0xffff);
    add16(0xc8, 2);
    longW16(0xc8, 0x3e00 | ((d + 0x2a) & 0xff));
    add16(0xc8, -6);
  };
  if (r8(x + 2) !== 0) {
    digit(r8(x + 2));
    y = (y + 8) & 0xffff;
  }
  if (r16(x + 1) !== 0) {
    digit(r8(x + 1));
    y = (y + 8) & 0xffff;
  }
  digit(r8(x));
  reg.y = y;
}

/** $B4BD57 — split A (< 1000) into decimal digits at X (ones, tens, hundreds). */
export function CODE_B4BD57() {
  const x = reg.x;
  reg.y = 0x000a;
  divide_a_by_y();
  dbW16(x, ioR16(CPU.divide_remainder));
  reg.a = ioR16(CPU.divide_result);
  divide_a_by_y();
  w8(x + 1, ioR16(CPU.divide_remainder) & 0xff);
  w8(x + 2, ioR16(CPU.divide_result) & 0xff);
  reg.a = (reg.a & 0xff00) | (ioR16(CPU.divide_result) & 0xff);
}

/** $B4BD7C — start the hardware division A / Y (results in $4214 / $4216). */
export function divide_a_by_y() {
  io16(CPU.dividen, reg.a & 0xffff);
  io16(CPU.divisor, reg.y & 0xffff); // 16-bit STY: also writes $4207 (H-IRQ timer low)
}

// ---------------------------------------------------------------------------------------------
// Text window HDMA

/** $B4BD8D — set the window line (A) and enable HDMA channel 1 (text window gradient). */
export function CODE_B4BD8D() {
  CODE_B4BDA5();
  CODE_B4A11F();
  w16(0x06a1, r16(0x06a1) & 0xfffe);
}

/** $B4BD95 — set the window line (A) without the window HDMA. */
export function CODE_B4BD95() {
  CODE_B4BDA5();
  CODE_B4A0FD();
  w16(0x06a1, r16(0x06a1) & 0xfffe);
}

/** $B4BDA5 — HDMA channels 3/4 scroll tables for the text window (8-bit A = start line). */
export function CODE_B4BDA5() {
  const a = reg.a & 0xff;
  w8(0x0787, a);
  io16(HDMA.settings + 0x30, 0x2c00);
  io16(HDMA.source + 0x30, 0x0787);
  io8(HDMA.source_bank + 0x30, 0);
  io8(HDMA.indirect_source_bank + 0x30, 0);
  w8(0x06dc, a);
  io16(HDMA.settings + 0x40, 0x2103);
  io16(HDMA.source + 0x40, 0x06dc);
  io8(HDMA.source_bank + 0x40, 0);
  io8(HDMA.indirect_source_bank + 0x40, 0);
}

/** $B4A0FD — no HDMA (text window off), BG3 scrolled away. Carry = (screen type >= Funky). */
export function CODE_B4A0FD() {
  io8(CPU.enable_hdma, 0x00);
  io8(PPU.layer_3_scroll_y, 0xff);
  io8(PPU.layer_3_scroll_y, 0xff);
  reg.c = r16(R.npc_screen_type) >= 0x0002;
}

/** $B4A11F — HDMA channel 1 on (text window). Carry = (screen type >= Funky). */
export function CODE_B4A11F() {
  io8(CPU.enable_hdma, 0x02);
  reg.c = r16(R.npc_screen_type) >= 0x0002;
}

/** $B4BDE7 — window opening: done at once (the line-by-line version is dead code). */
export function CODE_B4BDE7() {
  w16(0x06a1, r16(0x06a1) | 0x0001);
}

/** $B4BE0B — window closing: done at once. */
export function CODE_B4BE0B() {
  w16(0x06a1, r16(0x06a1) | 0x0001);
}

/** $B4BDD6 — copy the initial HDMA table ($B4:CE60, $C1 bytes) to $06CF. */
export function CODE_B4BDD6() {
  const src = L("DATA_B4CE60");
  for (let i = 0; i <= 0xc0; i++) w8(0x06cf + i, bus8(src + i));
  reg.a = 0xffff;
  reg.x = (lo16(src) + 0xc1) & 0xffff;
  reg.y = 0x06cf + 0xc1;
}

/** $B4BE2F — BG1-3 scroll to (0, -1), camera to 0. */
export function reset_camera_and_bg_scroll() {
  for (const r of [PPU.layer_3_scroll_x]) {
    io8(r, 0);
    io8(r, 0);
  }
  io8(PPU.layer_3_scroll_y, 0xff);
  io8(PPU.layer_3_scroll_y, 0xff);
  io8(PPU.layer_2_scroll_x, 0);
  io8(PPU.layer_2_scroll_x, 0);
  io8(PPU.layer_2_scroll_y, 0xff);
  io8(PPU.layer_2_scroll_y, 0xff);
  io8(PPU.layer_1_scroll_x, 0);
  io8(PPU.layer_1_scroll_x, 0);
  io8(PPU.layer_1_scroll_y, 0xff);
  io8(PPU.layer_1_scroll_y, 0xff);
  w16(R.screen_scroll_x_position, 0);
  w16(R.screen_scroll_y_position, 0);
  reg.a = (reg.a & 0xff00) | 0xff;
}

// ---------------------------------------------------------------------------------------------
// End of an NPC screen frame

/** $B4AE85 — OAM bookkeeping of the NPC screens, then the sprite renderer. */
export function CODE_B4AE85() {
  const db = reg.db;
  reg.db = 0xb4;
  w16(R.next_oam_slot, 0x0200);
  w16(R.oam_size_index, 0x0400);
  w16(R.sprite_dma_buffer_limit, 0x003c);
  if (r16(R.npc_screen_type) === 0x0004) {
    // Swanky: the banana counter stays hidden
    w16(R.banana_display_timer, 0);
    CODE_BEC695();
  }
  CODE_B59F40();
  w16(R.next_sprite_dma_buffer_slot, 0);
  reg.db = db;
}

// ---------------------------------------------------------------------------------------------
// Per-frame routines of the screens (npc_screen_init_data + $0E)

/** $B4B7CA — Swanky's "BONUS" sign: cycle its light colours every 8 frames. */
export function update_swanky_lights() {
  if (r16(R.active_frame_counter) & 0x0007) return;
  let i = r16(0x091d) + 1;
  reg.c = i >= 3;
  if (i >= 3) i = 0;
  w16(0x091d, i);
  io8(PPU.cgram_address, 0x46);
  for (let k = 0; k < 6; k++) io8(PPU.cgram_write, bus8(SWANKY_REFLECTION + i * 2 + k));
  io8(PPU.cgram_address, 0x11);
  for (let k = 0; k < 6; k++) io8(PPU.cgram_write, bus8(SWANKY_LIGHTS + i * 2 + k));
  reg.c = false; // ASL A
  reg.x = (i * 2 + 6) & 0xffff;
  reg.y = 0;
}

/** $B4B82A — no per-frame work (Cranky, Wrinkly, Klubba). */
export function CODE_B4B82A() {}

/**
 * $B4B82B — Funky: scroll BG2 (the sea) with the frame counter and bob his plane up and down;
 * both Kongs and BG1 follow it.
 */
export function CODE_B4B82B() {
  io8(PPU.layer_2_scroll_x, r16(R.active_frame_counter) & 0xff);
  io8(PPU.layer_2_scroll_x, 0);
  const savedSprite = r16(R.current_sprite);
  const x = r16(0x0798);
  w16(R.current_sprite, x);
  const oldX = r16(x + 0x06);
  const oldY = r16(x + 0x0a);
  if (add16(0x0794, -1) === 0) {
    w16(0x0794, 0x001e);
    const v = (-r16(x + 0x26)) & 0xffff;
    w16(x + 0x26, v);
    if (v & 0x8000) w16(x + 0x06, 0xff7f);
  }
  if (add16(0x0796, -1) === 0) {
    w16(0x0796, 0x0032);
    const v = (-r16(x + 0x2a)) & 0xffff;
    w16(x + 0x2a, v);
    if (v & 0x8000) w16(x + 0x0a, 0x0004);
  }
  reg.a = 0x0004;
  reg.x = x;
  interpolate_y_velocity_global();
  apply_position_from_velocity_global();
  const px = r16(0x0798);
  // move both Kongs by the plane's Y movement
  const dy = (oldY - r16(px + 0x0a)) & 0xffff;
  w16(0x0666, dy);
  let k = r16(R.inactive_kong_sprite);
  w16(k + 0x0a, (r16(k + 0x0a) + dy) & 0xffff);
  k = r16(R.active_kong_sprite);
  w16(k + 0x0a, (r16(k + 0x0a) + dy) & 0xffff);
  w16(0x0666, (oldX - r16(px + 0x06)) & 0xffff);
  reg.c = r16(px + 0x06) + r16(0x079a) > 0xffff; // (unused sum)
  const s = r16(px + 0x0a);
  io8(PPU.layer_1_scroll_y, s & 0xff);
  io8(PPU.layer_1_scroll_y, s >> 8);
  w16(R.current_sprite, savedSprite);
  reg.a = savedSprite;
  reg.x = px;
  reg.y = k;
}

// ---------------------------------------------------------------------------------------------
// Random numbers

/** $B4C175 — next random number (carry in feeds the rotation of the second seed). */
export function CODE_B4C175() {
  const old = r16(R.rng_result);
  const s2 = r16(R.rng_seed_2);
  const rot = ((s2 << 1) | (reg.c ? 1 : 0)) & 0xffff;
  reg.c = (s2 & 0x8000) !== 0;
  const res = r16(R.rng_seed_1) ^ rot;
  w16(R.rng_result, res);
  w16(R.rng_seed_2, old);
  reg.a = res;
  const inc = (res + 1) & 0xffff;
  w16(R.rng_result, inc);
  reg.z = inc === 0;
  reg.n = (inc & 0x8000) !== 0;
}

void bus16;

register({
  CODE_B4ADDF,
  CODE_B4ADE5,
  CODE_B4ADEB,
  CODE_B4ADF6,
  CODE_B4AE01,
  CODE_B4AE08,
  CODE_B4AC65,
  CODE_B4BB62,
  CODE_B4BD57,
  divide_a_by_y,
  CODE_B4BD8D,
  CODE_B4BD95,
  CODE_B4BDA5,
  CODE_B4A0FD,
  CODE_B4A11F,
  CODE_B4BDE7,
  CODE_B4BE0B,
  CODE_B4BDD6,
  reset_camera_and_bg_scroll,
  CODE_B4AE85,
  update_swanky_lights,
  CODE_B4B82A,
  CODE_B4B82B,
  CODE_B4C175,
});
for (const n of [
  "CODE_B4ADDF", "CODE_B4ADE5", "CODE_B4ADEB", "CODE_B4ADF6", "CODE_B4AE01", "CODE_B4AE08",
  "CODE_B4BB62", "CODE_B4BD57", "CODE_B4BD8D", "CODE_B4BD95", "CODE_B4BDA5", "CODE_B4A0FD",
  "CODE_B4A11F", "CODE_B4BDE7", "CODE_B4BE0B", "CODE_B4BDD6", "CODE_B4AE85",
  "update_swanky_lights", "CODE_B4B82A", "CODE_B4B82B",
]) setRetMode(L(n), RET_RTS);
