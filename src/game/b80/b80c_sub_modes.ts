/**
 * Bank $80 (package b80c) — the per-level-type GAME sub modes used by worlds 1 and 2, and the
 * small per-frame effects they run: the mine glint (Kannon's Klaim, Squawks's Shaft), the
 * sunset palette fade (Gangplank Galley) and the lava geyser columns (Red-Hot Ride).
 *
 * A game sub mode is one gameplay frame: read the inputs (pause), run sprites / camera / level
 * scroll, render the sprites into OAM, fade, and end the frame through game_sub_mode_return
 * (its WAI is `endFrame()` in the port). They are entered by `JMP (game_sub_mode_table,x)`.
 */
import { w8, r16, w16, rom16, busW16, io8, io16 } from "../../core/mem";
import { reg, register } from "../../core/cpu";
import { frameEnded, setRetMode, RET_RTS } from "../../core/hybrid";
import { L, R, DMA, PPU, CPU } from "../../core/sym";
import { sbc16, flags } from "../../core/ops";
import {
  input_and_pause_handler,
  paused_game_sub_mode,
  sprite_loader,
  sprite_handler,
  camera_handler,
  vertical_level_scroll_handler,
  horizontal_level_scroll_handler,
  ship_deck_rigging_scroll_handler,
  set_unused_oam_offscreen,
  fade_screen,
  game_sub_mode_return,
  get_random_number,
  sort_sprite_render_orders,
  CODE_BEC695,
  CODE_B59F40,
  CODE_B5F0FD,
  CODE_B59C52,
  handle_ship_deck_rigging_scroll,
  handle_ship_deck_water_sky_scroll,
} from "../../gen/routines";

const MINE_GLINT_PALETTE = L("mine_glint_layer_3_palette");
const KANNONS_KLAIM_PALETTE = L("kannons_klaim_level_palette");
const SUNSET_STEP = L("DATA_FD364E");
const GEYSER_COLUMNS = L("DATA_B3D691");

const WORKING_PALETTE = 0x7e8928;
const PRIMARY_PALETTE = 0x7e8c28;

/**
 * Run a sequence of per-frame steps, stopping when one of them ends the frame (a level exit or
 * the demo ending can leave the frame from inside the sprite or input code).
 */
function steps(...fns: Array<() => void>): boolean {
  for (const f of fns) {
    f();
    if (frameEnded) return false;
  }
  return true;
}

/** Common start of a sub mode: inputs and pause. Returns false when the frame is over. */
function inputsUnpaused(): boolean {
  input_and_pause_handler();
  if (frameEnded) return false;
  if (!reg.z) {
    // .paused: the game is frozen (paused_game_sub_mode undoes the frame counter increment)
    paused_game_sub_mode();
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------------------------
// Game sub modes

/** $80D5E7 — 08 Ship Mast (Mainbrace Mayhem, Topsail Trouble, Krow's Nest). */
export function ship_mast_game_sub_mode() {
  if (!inputsUnpaused()) return;
  // $78: every 8th frame the vertical scroll handler uses $1C instead of $2C
  w16(0x78, ((r16(R.active_frame_counter) + 1) & 0x0007) === 0 ? 0x001c : 0x002c);
  if (!steps(sprite_loader, sprite_handler, camera_handler, vertical_level_scroll_handler, render_sprites, set_unused_oam_offscreen, fade_screen)) return;
  game_sub_mode_return();
}

/** $80D642 — 0A Ship Deck (Cabin): the cabin rooms of the ship levels. */
export function ship_deck_cabin_game_sub_mode() {
  if (!inputsUnpaused()) return;
  if (!steps(sprite_loader, sprite_handler, camera_handler, render_sprites, set_unused_oam_offscreen, handle_ship_deck_water_sky_scroll, fade_screen)) return;
  game_sub_mode_return();
}

/** $80D66E — 0C Mine (Kannon's Klaim, Squawks's Shaft). */
export function mine_game_sub_mode() {
  if (!inputsUnpaused()) return;
  if (!steps(sprite_loader, sprite_handler, camera_handler, handle_mine_glint, vertical_level_scroll_handler, render_sprites, set_unused_oam_offscreen, fade_screen)) return;
  game_sub_mode_return();
}

/** $80D8B7 — 12 Lava (Geyser): Red-Hot Ride. */
export function lava_geyser_game_sub_mode() {
  if (!inputsUnpaused()) return;
  if (!steps(sprite_loader, sprite_handler, camera_handler, horizontal_level_scroll_handler, render_sprites, set_unused_oam_offscreen, handle_lava_geyser_positioning, fade_screen)) return;
  game_sub_mode_return();
}

/** $80DA9A — 18 Ship Deck (Sunset): Gangplank Galley. */
export function ship_deck_sunset_game_sub_mode() {
  if (!inputsUnpaused()) return;
  if (
    !steps(
      sprite_loader,
      sprite_handler,
      camera_handler,
      handle_ship_deck_rigging_scroll,
      ship_deck_rigging_scroll_handler,
      horizontal_level_scroll_handler,
      render_sprites,
      set_unused_oam_offscreen,
      handle_ship_deck_water_sky_scroll,
      handle_ship_deck_sunset,
      fade_screen,
    )
  )
    return;
  game_sub_mode_return();
}

// ---------------------------------------------------------------------------------------------
// Mine glint

/** .CODE_80D77A: A * (1/8 + 1/32), rounded like the original LSR/ADC chain. */
function glintScale(v: number): number {
  const t = v >> 3;
  w16(0x38, t);
  // the carry into the ADC is the bit shifted out by the second LSR
  return ((t >> 2) + t + ((t >> 1) & 1)) & 0xffff;
}

/** $80D695 — pulse the layer 3 glint palette, and sometimes flash the level palette too. */
export function handle_mine_glint() {
  const frame = r16(R.active_frame_counter);
  // triangle wave 0..$1F..0 with a period of 32 frames
  let level = (frame << 1) & 0x003f;
  if (level & 0x0020) level ^= 0x003f;
  if (level >= 0x0020) level = 0x0020;
  w16(0x32, level); // red step
  w16(0x36, ((level << 2) & 0xff) << 8); // blue step (XBA of level*4)
  w16(0x34, (level << 5) & 0xffff); // green step
  for (let x = 0; x !== 0x1e; x += 2) {
    const color = rom16(MINE_GLINT_PALETTE + x);
    // darken each component by 4 steps (the SBC chain keeps its borrow), clamped at 0
    let red = color & 0x001f;
    let c = true;
    for (let i = 0; i < 4; i++) {
      red = sbc16(red, r16(0x32), c);
      c = flags.c;
    }
    if (red & 0x8000) red = 0;
    w16(0x38, red);
    let green = color & 0x03e0;
    c = true;
    for (let i = 0; i < 4; i++) {
      green = sbc16(green, r16(0x34), c);
      c = flags.c;
    }
    if (green & 0x8000) green = 0;
    w16(0x38, r16(0x38) | green);
    let blue = ((color & 0x7c00) - r16(0x36)) & 0xffff;
    if (blue & 0x8000) blue = 0;
    w16(0x7e8014 + x, blue | r16(0x38));
  }
  // during the bright half of each 64-frame cycle, randomly decide whether the level flashes
  if (frame & 0x0020) {
    get_random_number();
    w16(0x7e8012, reg.a & 0x0001);
  }
  if (r16(0x7e8012)) return;
  // .CODE_80D71D: darken 6 colours of the level palette by a fraction of the glint
  w16(0x32, glintScale(r16(0x32)));
  w16(0x34, glintScale(r16(0x34)) & 0x03e0);
  w16(0x36, glintScale(r16(0x36)) & 0x7c00);
  for (let x = 0; x !== 0x0c; x += 2) {
    const color = rom16(KANNONS_KLAIM_PALETTE + 0x42 + x);
    let red = ((color & 0x001f) - r16(0x32)) & 0xffff;
    if (red & 0x8000) red = 0;
    w16(0x38, red);
    let green = ((color & 0x03e0) - r16(0x34)) & 0xffff;
    if (green & 0x8000) green = 0;
    w16(0x38, r16(0x38) | green);
    let blue = ((color & 0x7c00) - r16(0x36)) & 0xffff;
    if (blue & 0x8000) blue = 0;
    w16(0x7e8032 + x, blue | r16(0x38));
  }
}

// ---------------------------------------------------------------------------------------------
// Sunset

/** $80DD63 — long wrapper of handle_ship_deck_sunset. */
export function handle_ship_deck_sunset_global() {
  handle_ship_deck_sunset();
}

/**
 * $80DD67 — as the screen scrolls right, step the colours of the level palette towards the
 * sunset: each colour index is advanced once per 2 pixels of new scroll, and $0911 remembers
 * how far the palette has been stepped (in 2-pixel units, one colour per unit).
 */
export function handle_ship_deck_sunset() {
  const scroll = r16(R.screen_scroll_x_position);
  const done = r16(0x0911);
  const ahead = ((scroll & 0xfffe) - done) & 0xffff;
  if (ahead & 0x8000 || ahead === 0) return;
  let target: number;
  if ((scroll ^ done) & 0xff00) {
    // crossed into a new 256-pixel page: finish the current one first
    w16(0x0913, (r16(0x0913) + 1) & 0xffff);
    target = ((done & 0xff00) + 0x0100) & 0xffff;
  } else {
    target = scroll & 0xfffe;
  }
  w16(0x32, target);
  const end = target & 0x00fe ? target & 0x00fe : 0x0100;
  w16(0x36, end);
  let y = done & 0x00fe;
  w16(0x38, y);
  // the working palette holds 3 words (R, G, B in 5.x fixed point) per colour
  let x = (y * 3) & 0xffff;
  do {
    let v = (r16(WORKING_PALETTE + x) - rom16(SUNSET_STEP + x)) & 0xffff;
    w16(WORKING_PALETTE + x, v);
    w16(0x34, (((v & 0xff) << 8) | (v >> 8)) & 0x001f);
    v = (r16(WORKING_PALETTE + 2 + x) - rom16(SUNSET_STEP + 2 + x)) & 0xffff;
    w16(WORKING_PALETTE + 2 + x, v);
    w16(0x34, r16(0x34) | (v & 0x03e0));
    v = (r16(WORKING_PALETTE + 4 + x) - rom16(SUNSET_STEP + 4 + x)) & 0xffff;
    w16(WORKING_PALETTE + 4 + x, v);
    w16(PRIMARY_PALETTE + y, (v & 0x7c00) | r16(0x34));
    y = (y + 2) & 0xffff;
    x = (x + 6) & 0xffff;
  } while (y !== r16(0x36));
  w16(0x0911, r16(0x32));
  reg.db = 0x80; // the second PLB of the %pea_use_dbr pair
}

// ---------------------------------------------------------------------------------------------
// Lava geysers

/** Absolute,Y store as the 65816 does it: an index past $FFFF carries into the next bank. */
function storeAbsY(base: number, y: number, v: number) {
  const ea = ((reg.db << 16) + base + y) & 0xffffff;
  busW16(ea, v);
}

/**
 * $80DE01 — Red-Hot Ride's lava geysers are drawn as up to 4 columns of a background layer
 * (visual position only). DATA_B3D691 lists the geysers' x positions (bit 0 = flipped, 0 /
 * negative terminators at both ends). Slots $0963,y hold the table index of each shown geyser,
 * $095B,y its column value (bit 14 = scrolled off screen, to be freed). $84/$85 clip the layer
 * window at the left/right screen edge when a geyser has no neighbour on that side.
 */
export function handle_lava_geyser_positioning() {
  const scroll = r16(R.screen_scroll_x_position);
  // free slots marked off-screen last frame
  for (let x = 6; x >= 0; x -= 2) {
    if (r16(0x095b + x) & 0x4000) {
      w16(0x095b + x, 0);
      w16(0x0963 + x, 0);
    }
  }
  // mark geysers that left the visible area
  for (let y = 6; y >= 0; y -= 2) {
    const idx = r16(0x0963 + y);
    if (!idx) continue;
    const sx = (rom16(GEYSER_COLUMNS + idx) - scroll + 0x000c) & 0xffff;
    if (sx >= 0x0118) w16(0x095b + y, 0x4000 | r16(0x095b + y));
  }
  // find the first geyser at or right of the screen's left edge that has no slot yet
  w16(0x32, (scroll - 0x000a) & 0xffff);
  let x = r16(0x0959);
  for (;;) {
    let gx = rom16(GEYSER_COLUMNS + x);
    if (gx & 0x8000) break;
    gx &= 0xfffe;
    if (gx < r16(0x32)) {
      x = (x + 2) & 0xffff;
      continue;
    }
    // .CODE_80DE5A
    if (((gx - r16(0x32)) & 0xffff) >= 0x0114) break; // beyond the right edge
    let shown = false;
    for (let y = 6; y >= 0; y -= 2) {
      if (x === r16(0x0963 + y)) {
        shown = true;
        break;
      }
    }
    if (shown) {
      x = (x + 2) & 0xffff;
      continue;
    }
    // take the highest free slot (Y = -2 when all are busy, as in the original)
    let y = 6;
    while (y >= 0 && r16(0x0963 + y) !== 0) y -= 2;
    const yi = y & 0xffff;
    storeAbsY(0x0963, yi, x);
    const pos = rom16(GEYSER_COLUMNS + x);
    let col = ((((pos - 8) & 0xffff) >> 3) & 0x001f) + 0x01c0;
    if (pos & 0x0001) col = (col + 0x7f00) & 0xffff;
    storeAbsY(0x095b, yi, col);
    break;
  }
  // .CODE_80DE9F: free slots that duplicate another slot's column
  for (let y = 6; y >= 0; y -= 2) {
    let a = r16(0x095b + y);
    if (!(a & 0x4000)) continue;
    a ^= 0x4000;
    w16(0x32, y);
    for (let x2 = 6; x2 >= 0; x2 -= 2) {
      if (x2 === r16(0x32)) continue;
      if (a !== r16(0x095b + x2)) continue;
      a = 0; // (A stays 0 for the remaining compares)
      w16(0x095b + y, 0);
      w16(0x0963 + y, 0);
    }
  }
  // window edges: $84 = left clip, $85 = right clip
  w16(0x84, 0xff00);
  for (let y = 6; y >= 0; y -= 2) {
    let idx = r16(0x0963 + y);
    if (!idx) continue;
    const rel = (rom16(GEYSER_COLUMNS + idx) - scroll - 0x000c) & 0xffff;
    if (rel & 0x8000) {
      // .CODE_80DF0F: geyser at the left edge; clip unless the next one (256 px right) exists
      w16(0x32, (rom16(GEYSER_COLUMNS + idx) + 0x0100) & 0xffff);
      for (;;) {
        idx = (idx + 2) & 0xffff;
        const v = rom16(GEYSER_COLUMNS + idx);
        if (v & 0x8000) {
          w8(0x85, 0xe8);
          break;
        }
        if (v === r16(0x32)) break;
      }
    } else if (rel >= 0x00e8) {
      // geyser at the right edge; clip unless the previous one (256 px left) exists
      w16(0x32, (rom16(GEYSER_COLUMNS + idx) - 0x0100) & 0xffff);
      for (;;) {
        idx = (idx - 2) & 0xffff;
        const v = rom16(GEYSER_COLUMNS + idx);
        if (v === 0) {
          w8(0x84, 0x18);
          break;
        }
        if (v === r16(0x32)) break;
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Sprite rendering and sprite palette DMA

/** $80F320 — long wrapper of dma_queued_sprite_palette. */
export function dma_queued_sprite_palette_global() {
  dma_queued_sprite_palette();
}

/**
 * $80F324 — during NMI: upload the next queued sprite palette (15 colours) to CGRAM. The queue
 * is a ring of 16 entries (source address, bank, CGRAM index) at sprite_palette_dma.
 */
export function dma_queued_sprite_palette() {
  const slot = r16(R.previous_palette_buffer_slot);
  if (slot === r16(R.current_palette_buffer_slot)) {
    reg.a = slot;
    return;
  }
  const x = (slot << 2) & 0xffff;
  w16(R.previous_palette_buffer_slot, (slot + 1) & 0x000f);
  io16(DMA.settings, 0x2200); // DMA 0: CPU -> $2122 (CGRAM data), one register, write twice
  io16(DMA.size, 0x001e); // 15 colours
  io16(DMA.source, r16(R.sprite_palette_dma + x));
  const bankAndIndex = r16(R.sprite_palette_dma + 2 + x);
  io8(DMA.source_bank, bankAndIndex & 0xff);
  io8(PPU.cgram_address, bankAndIndex >> 8);
  io8(CPU.enable_dma, 0x01);
  reg.a = (bankAndIndex & 0xff00) | 0x01;
}

/** $80F35B — build this frame's OAM: HUD, sprites, bananas and fireworks. */
export function render_sprites() {
  reg.db = 0x80;
  sort_sprite_render_orders();
  w16(R.next_oam_slot, R.oam_table);
  w16(0x56, 0x0400);
  // clear the OAM high table (size / x bit 8 of all 128 sprites)
  for (let i = 0; i <= 0x1e; i += 2) w16(R.oam_attribute_table + i, 0);
  CODE_BEC695(); // HUD elements
  CODE_B59F40(); // sprites
  CODE_B5F0FD(); // bananas
  if (r16(R.next_firework_sprite_buffer_slot)) CODE_B59C52();
  w16(R.next_sprite_dma_buffer_slot, 0);
}

// these are entered with JSR: the generated stubs may guess otherwise
for (const t of [
  "handle_mine_glint",
  "handle_ship_deck_sunset",
  "handle_lava_geyser_positioning",
  "dma_queued_sprite_palette",
  "render_sprites",
])
  setRetMode(L(t), RET_RTS);

register({
  ship_mast_game_sub_mode,
  ship_deck_cabin_game_sub_mode,
  mine_game_sub_mode,
  lava_geyser_game_sub_mode,
  ship_deck_sunset_game_sub_mode,
  handle_mine_glint,
  handle_ship_deck_sunset_global,
  handle_ship_deck_sunset,
  handle_lava_geyser_positioning,
  dma_queued_sprite_palette_global,
  dma_queued_sprite_palette,
  render_sprites,
});

