/**
 * Bank $80 (package final) — the "Ship Hold (Dark)" game sub mode of Glimmer's Galleon and
 * Glimmer's light.
 *
 * The level is dark except for a cone of light that Glimmer (the anglerfish) shines ahead of
 * itself. The cone is drawn by an HDMA channel whose indirect table is double buffered at
 * $7E80F2 / $7E81F2 (the buffer is picked by the frame parity): each 3-byte entry is a line
 * count (bit 7 = repeat mode) and a pointer into one of the gradient tables DATA_80E175 /
 * DATA_80E1F4 (wide beam) or DATA_80E273 / DATA_80E372 (narrow beam, while Glimmer turns).
 */
import { r16, w16, romS16 } from "../../core/mem";
import { reg, register } from "../../core/cpu";
import { frameEnded, setRetMode, RET_RTS } from "../../core/hybrid";
import { L, R } from "../../core/sym";
import {
  handle_3d_bg_scroll,
  input_and_pause_handler,
  paused_game_sub_mode,
  handle_water_velocities,
  sprite_loader,
  sprite_handler,
  camera_handler,
  square_level_scroll_handler,
  render_sprites,
  CODE_BEC9C0,
  set_unused_oam_offscreen,
  fade_screen,
  game_sub_mode_return,
} from "../../gen/routines";

const lo = (a: number) => a & 0xffff;
const WIDE_TOP = lo(L("DATA_80E175"));
const WIDE_BOTTOM = lo(L("DATA_80E1F4"));
const NARROW_TOP = lo(L("DATA_80E273"));
const NARROW_BOTTOM = lo(L("DATA_80E372"));
const LIGHT_OFFSETS = L("DATA_80DF34"); // per Glimmer frame: x offset, y offset (DATA_80DF36)

const HDMA_TABLE = 0x80f2; // WRAM $7E80F2 (+ $100 on odd frames)

// ---------------------------------------------------------------------------------------------
// Game sub mode

/** Run per-frame steps in order, stopping when one of them ends the frame. */
function steps(...fns: Array<() => void>): boolean {
  for (const f of fns) {
    f();
    if (frameEnded) return false;
  }
  return true;
}

/** $80D886 — 10 Ship Hold (Dark): Glimmer's Galleon. Like Ship Hold, plus Glimmer's light. */
export function ship_hold_dark_game_sub_mode() {
  handle_3d_bg_scroll();
  if (frameEnded) return;
  input_and_pause_handler();
  if (frameEnded) return;
  if (!reg.z) {
    // .paused
    paused_game_sub_mode();
    return;
  }
  if (
    !steps(
      handle_water_velocities,
      sprite_loader,
      sprite_handler,
      camera_handler,
      handle_glimmer_light,
      square_level_scroll_handler,
      render_sprites,
      CODE_BEC9C0,
      set_unused_oam_offscreen,
      fade_screen,
    )
  )
    return;
  game_sub_mode_return();
}

// ---------------------------------------------------------------------------------------------
// Glimmer's light

/** Write one HDMA indirect entry (two overlapping 16-bit stores, like the original). */
function entry(x: number, count: number, ptr: number): number {
  w16(HDMA_TABLE + x, count & 0xffff);
  w16(HDMA_TABLE + x + 1, ptr & 0xffff);
  return x + 3;
}

/** A table of one entry (1 line of `ptr`) and the terminator: no visible cone. */
function singleEntry(ptr: number) {
  const x = (r16(R.active_frame_counter) & 1) << 8;
  reg.x = x;
  w16(HDMA_TABLE + x, 0x0001);
  w16(HDMA_TABLE + x + 1, ptr);
  reg.a = 0;
  w16(HDMA_TABLE + x + 3, 0x0000);
}

/**
 * $80DF94 — build this frame's light cone table from Glimmer's position, facing and animation
 * frame. The cone is a triangle opening from Glimmer's lamp ($32 = lamp x on screen, $34 = lamp
 * y): above the lamp the top gradient is stepped through, below it the bottom one.
 */
export function handle_glimmer_light() {
  const g = r16(R.glimmer_sprite);
  reg.y = g;
  if (g === 0) return singleEntry(WIDE_TOP);

  w16(0x56, 0); // 1 = narrow beam (turning frames)
  w16(0x3e, WIDE_TOP);
  w16(0x40, WIDE_BOTTOM);
  let top = WIDE_TOP;
  let bottom = WIDE_BOTTOM;
  const gfx = r16(g + 0x1a);
  if (gfx === 0x1c1c) return singleEntry(WIDE_BOTTOM); // last turning frame: lamp hidden
  if (lo(gfx - 0x1c14) < 0x0010) {
    top = NARROW_TOP;
    bottom = NARROW_BOTTOM;
    w16(0x56, 1);
  }
  const narrow = r16(0x56) !== 0;

  // lamp x on screen, clamped to 0..$FF
  const fi = lo(gfx - 0x1bcc);
  const flipped = (r16(g + 0x12) & 0x4000) !== 0;
  let dx = romS16(LIGHT_OFFSETS + fi) & 0xffff;
  if (flipped) dx = lo(-dx);
  let lx = lo(dx + r16(g + 0x06) - r16(R.screen_scroll_x_position));
  if (lx & 0x8000) lx = 0;
  if (lx >= 0x00fe) lx = 0x00ff;
  w16(0x32, lx);

  // the beam points the way Glimmer faces (the turning frames past $1C1C face the other way)
  if (gfx >= 0x1c1c ? !flipped : flipped) {
    const t = top;
    top = bottom;
    bottom = t;
    w16(0x32, r16(0x32) ^ 0x00ff);
  }
  w16(0x3e, top);
  w16(0x40, bottom);

  // lamp y on screen, clamped to 0..$FC, plus 2 on odd frames (alternating buffers)
  let ly = lo(r16(g + 0x0a) - r16(R.screen_scroll_y_position) + romS16(LIGHT_OFFSETS + 2 + fi));
  if (ly & 0x8000) ly = 0;
  if (ly >= 0x00fc) ly = 0x00fc;
  const parity = r16(R.active_frame_counter) & 1;
  ly = lo(ly + parity * 2);
  w16(0x34, ly);
  let x = parity << 8;

  // first line of the cone ($36): the wide beam opens at half the slope
  let a = lo(r16(0x32) - 0x00ff);
  reg.y = r16(0x56);
  if (!narrow) a = ((a >> 1) | (a & 0x8000)) & 0xffff; // CMP #$8000 : ROR A
  a = lo(a + ly);
  w16(0x36, a);

  // dark lines above the cone
  if (a === 0 || a & 0x8000) {
    w16(0x3a, a);
    w16(0x38, 0);
  } else {
    w16(0x38, a);
    w16(0x3a, 0);
    let n = a;
    if (n >= 0x0080) {
      w16(0x3c, n);
      x = entry(x, 0x007f, top);
      n = lo(r16(0x3c) - 0x007f);
    }
    x = entry(x, n, top);
  }

  // upper half of the cone: from the first cone line down to the lamp, two repeat entries
  a = lo(ly - r16(0x38));
  if (a !== 0) {
    w16(0x54, 0);
    const half = a >> 1;
    const odd = a & 1;
    const start = lo(top - r16(0x3a));
    if (half !== 0) {
      w16(0x54, half);
      x = entry(x, half | 0x0080, start);
    }
    x = entry(x, lo(half + odd) | 0x0080, lo(start + r16(0x54)));
  }

  // lower half: from the lamp down (at most $FE lines), then the terminator
  if (!narrow) w16(0x32, r16(0x32) >> 1);
  a = lo(ly - r16(0x36));
  if (a >= 0x00fe) a = 0x00fe;
  const half = a >> 1;
  const odd = a & 1;
  w16(0x54, half);
  const start = lo(r16(0x32) + bottom);
  x = entry(x, half | 0x0080, start);
  w16(HDMA_TABLE + x, lo(half + odd) | 0x0080);
  w16(HDMA_TABLE + x + 1, lo(start + half));
  w16(HDMA_TABLE + x + 3, 0x0001);
  w16(HDMA_TABLE + x + 4, top);
  reg.a = 0;
  w16(HDMA_TABLE + x + 6, 0x0000);
  reg.x = x;
}

setRetMode(L("handle_glimmer_light"), RET_RTS);

register({ ship_hold_dark_game_sub_mode, handle_glimmer_light });
