/**
 * Bank $80 — the secret ending (Crocodile Isle sinks, K. Rool escapes on a boat).
 *
 * The scene is built from five hand-placed sprites (no sprite mains: type 4 = plain graphic,
 * type 1 = explosion) animated here frame by frame; HDMA channels 1-7 do the sky gradients and
 * the window. A button press after frame $500 (or the end of the scene) returns to the intro.
 */
import { r8, r16, w16, io8, io16, ioR8, bus16 } from "../../core/mem";
import { reg, register } from "../../core/cpu";
import { endFrame, frameEnded } from "../../core/hybrid";
import { L, R, C, CPU, PPU, HDMA, sprite, sprite_table } from "../../core/sym";
import {
  disable_screen,
  init_sprite_render_order_global,
  decompress_data,
  dma_palette,
  set_fade,
  set_nmi_and_wait_2,
  dma_queued_sprite_graphics,
  fade_screen,
  get_random_number,
  sort_sprite_render_orders,
  CODE_B59F40,
} from "../../gen/routines";
import { init_registers_global, clear_vram, restart_rareware_logo } from "./b80a_boot";
import { clear_noncritical_wram, dma_to_vram_global, set_unused_oam_offscreen_global } from "./b80a_wram";
import { prepare_oam_dma_channel } from "./b80a_frame";
import { input_and_pause_handler } from "./b80a_input";
import { play_high_priority_sound, play_song } from "./b80a_util";

const SPRITE_SIZE = 0x5e;
const ISLE = sprite_table.slot_0; // the island (beam graphics)
const DIXIE_HAIR = 0x0e9e; // slot 3
const BOAT = 0x0efc; // slot 4

function playSounds(a: [number, number], b: [number, number]) {
  reg.a = (a[0] << 8) | a[1];
  play_high_priority_sound();
  reg.a = (b[0] << 8) | b[1];
  play_high_priority_sound();
}

function decompress(label: string) {
  const a = L(label);
  reg.x = a & 0xffff;
  reg.y = a >> 16;
  reg.a = 0;
  decompress_data();
}

function upload(vramWord: number, size: number) {
  io16(PPU.vram_address, vramWord);
  reg.x = 0x7f;
  reg.a = 0;
  reg.y = size;
  dma_to_vram_global();
}

function setupHdma(ch: number, settings: number, source: number) {
  const o = ch * 0x10;
  io16(HDMA.settings + o, settings);
  io16(HDMA.source + o, source & 0xffff);
  io8(HDMA.source_bank + o, (source >> 16) & 0xff);
  io8(HDMA.indirect_source_bank + o, 0);
}

/** $809F85 — set up the secret ending scene. */
export function init_secret_ending() {
  disable_screen();
  reg.db = 0x80;
  clear_vram();
  init_registers_global();
  clear_noncritical_wram();
  init_sprite_render_order_global();
  w16(R.active_frame_counter, 0);
  reg.a = 0xcccc;
  reg.x = 0x0032;
  CODE_809FA2();
  reg.a = C.music_secret_ending;
  play_song();
  w16(R.rng_result, 0xaa55);
  w16(R.rng_seed_2, 0xffff);
  reg.x = 0x001e;
  reg.a = 0;
  CODE_809FC1();
  io16(PPU.layer_mode, 0x0009); // mode 1, BG3 priority
  io16(PPU.screens, 0x1013);
  io16(PPU.window_masks, 0x0010);
  io16(PPU.window_1, 0x4030);
  io16(PPU.window_2, 0xff80);
  io16(PPU.window_logic, 0x0100);
  io16(PPU.set_window_layer_3_4, 0x0f00);
  io16(PPU.color_addition_logic, 0x2202);
  io16(PPU.layer_all_tiledata_base, 0x0626);
  io16(PPU.layer_1_2_tilemap_base, 0x7c78);
  // 16-bit STZ of the X scroll registers also write the Y ones (then set to $FF)
  for (let i = 0; i < 2; i++) {
    io8(PPU.layer_1_scroll_x, 0);
    io8(PPU.layer_1_scroll_x + 1, 0);
  }
  for (let i = 0; i < 2; i++) {
    io8(PPU.layer_2_scroll_x, 0);
    io8(PPU.layer_2_scroll_x + 1, 0);
  }
  io8(PPU.layer_1_scroll_y, 0xff);
  io8(PPU.layer_1_scroll_y, 0xff);
  io8(PPU.layer_2_scroll_y, 0xff);
  io8(PPU.layer_2_scroll_y, 0xff);
  setupHdma(1, 0x0f02, 0x7e8012); // BG2 vertical scroll (waves)
  setupHdma(2, 0x2601, L("DATA_809F6C")); // window 1
  setupHdma(3, 0x2103, L("DATA_809E95")); // CGRAM gradients
  setupHdma(4, 0x2103, L("DATA_809EC0"));
  setupHdma(5, 0x2103, L("DATA_809EEB"));
  setupHdma(6, 0x2103, L("DATA_809F16"));
  setupHdma(7, 0x2103, L("DATA_809F41"));
  w16(0x7e8012, 0x0060);
  w16(0x7e8013, 0x0000);
  reg.x = 0;
  CODE_80A0C2();
  decompress("DATA_F99400");
  upload(0x2000, 0x8000);
  decompress("DATA_F661C1");
  upload(0x6000, 0x4000);
  decompress("DATA_F9C775");
  upload(0x7c20, 0x0700);
  upload(0x7c00, 0x0700);
  decompress("DATA_F67D1B");
  upload(0x7800, 0x0800);
  w16(R.screen_scroll_x_position, 0);
  w16(R.screen_scroll_y_position, 0);
  // the scene's sprites: [address, value] in the original order
  const init: [number, number][] = [
    [0x0d9e, 0x0000], [0x0d84, 0x0004], [0x0d8a, 0x0036], [0x0d86, 0x0100], [0x0d8e, 0x0030], [0x0d96, 0x0000], [0x0dfc, 0x351c],
    [0x0de2, 0x0004], [0x0de8, 0x0038], [0x0de4, 0x0101], [0x0dec, 0x0068], [0x0df4, 0x2280], [0x0e5a, 0x3520],
    [0x0e40, 0x0004], [0x0e46, 0x0038], [0x0e42, 0x0102], [0x0e4a, 0x0068], [0x0e52, 0x24a0], [0x0eb8, 0x3538],
    [0x0e9e, 0x0004], [0x0ea4, 0x00b8], [0x0ea0, 0x0101], [0x0ea8, 0x0060], [0x0eb0, 0x26c0], [0x0f16, 0x3558],
    [0x0efc, 0x0004], [0x0f02, 0x0040], [0x0efe, 0x00ff], [0x0f06, 0x0066], [0x0f0e, 0x2860],
  ];
  for (const [a, v] of init) w16(a, v);
  palette(L("secret_ending_screen_palette"), 0x0000, 0x0020);
  palette(L("secret_ending_beam_sprite_palette"), 0x0080, 0x0020);
  palette((bus16(L("kleever_hand_sprite_pal_ptr")) - 2) & 0xffff, 0x00d0, 0x0004);
  ioR8(CPU.irq_flag);
  io8(PPU.oam_address_high, 0x80);
  io8(CPU.rom_speed, 0x01);
  w16(R.active_frame_counter, 0);
  reg.a = 0x0300;
  set_fade();
  prepare_oam_dma_channel();
  reg.a = L("run_secret_ending") & 0xffff;
  set_nmi_and_wait_2();
}

function palette(a: number, y: number, x: number) {
  reg.a = a & 0xffff;
  reg.y = y;
  reg.x = x;
  dma_palette();
}

/** $809FA2 — fill direct page X..$D1 with A (overlapping 16-bit stores, X += 1): $CCCC. */
export function CODE_809FA2() {
  let x = reg.x;
  do {
    w16(x & 0xffff, reg.a);
    x = (x + 1) & 0xffff;
  } while (x !== 0x00d1);
  reg.x = x;
}

/** $809FC1 — store A at $32+X down to $32 (X -= 2): clears $32-$51. */
export function CODE_809FC1() {
  let x = reg.x;
  do {
    w16((0x32 + x) & 0xffff, reg.a);
    x = (x - 2) & 0xffff;
  } while (!(x & 0x8000));
  reg.x = x;
}

/** $80A0C2 — BG2 vertical scroll HDMA table at $7E8012: 7 short bands then 10 wave bands. */
export function CODE_80A0C2() {
  let x = reg.x;
  do {
    w16(0x7e8015 + x, 0x0004);
    w16(0x7e8016 + x, 0x0001);
    w16(0x7e8018 + x, 0x0004);
    w16(0x7e8019 + x, 0x0000);
    x = (x + 0x0a) & 0xffff;
  } while (x !== 0x46);
  reg.x = x;
  CODE_80A0E9();
}

/** $80A0E9 */
export function CODE_80A0E9() {
  let x = reg.x;
  do {
    w16(0x7e8015 + x, 0x0002);
    w16(0x7e8016 + x, 0x0002);
    w16(0x7e8018 + x, 0x0002);
    w16(0x7e8019 + x, 0x0001);
    w16(0x7e801b + x, 0x0002);
    w16(0x7e801c + x, 0x0000);
    w16(0x7e801e + x, 0x0002);
    w16(0x7e801f + x, 0x0001);
    x = (x + 0x0c) & 0xffff;
  } while (x !== 0xba);
  w16(0x7e8015 + x, 0x0000);
  reg.x = x;
  reg.a = 0;
}

/** $80A2CF — NMI routine of the secret ending. */
export function run_secret_ending() {
  io16(PPU.oam_address, 0);
  io16(CPU.enable_dma, 0xfe01); // OAM DMA + HDMA 1-7
  w16(0x7e8012, (((r16(R.active_frame_counter) >> 2) & 0x0007) + 0x0062) & 0xffff);
  palette(L("secret_ending_isle_sprite_palette"), 0x0090, 0x0004);
  dma_queued_sprite_graphics();
  io8(PPU.layer_2_scroll_y, r8(R.screen_scroll_y_position));
  io8(PPU.layer_2_scroll_y, 0);
  io8(PPU.screen, r8(R.screen_brightness));
  w16(R.nmi_pointer, L("run_incomplete_frame") & 0xffff);
  fade_screen();
  input_and_pause_handler();
  if (frameEnded) return;
  const f0 = (r16(R.active_frame_counter) + 1) & 0xffff;
  w16(R.active_frame_counter, f0);
  // bug: LDA $1000 instead of LDA #$1000 when the counter wraps
  if (f0 === 0) w16(R.active_frame_counter, r16(0x1000));
  CODE_80A327();
}

/** $80A327 — the scene's logic for this frame. */
export function CODE_80A327() {
  reg.x = ISLE;
  CODE_80A545();
  reg.x = DIXIE_HAIR;
  CODE_80A518();
  reg.x = BOAT;
  CODE_80A4B7();
  if (r16(R.active_frame_counter) >= 0x0500 && !(r16(R.screen_brightness) & 0x8000) && r16(R.player_active_pressed))
    w16(R.screen_brightness, 0x820f);
  // CODE_80A350
  if (r16(R.screen_brightness) === 0x8201) {
    restart_rareware_logo();
    return;
  }
  CODE_80A35B();
}

/** $80A35B — sounds, screen shake, explosions; then the frame's sprite/OAM work and WAI. */
export function CODE_80A35B() {
  let f = r16(R.active_frame_counter);
  if (f === 0x0040 || f === 0x0080) playSounds([5, C.sound_ending_boom], [6, C.sound_ending_boom_shake]);
  // CODE_80A375: shake while the island is hit
  let a: number;
  if (((f - 0x0040) & 0xffff) < 0x0010) a = (f - 0x0040) & 0xffff;
  else if (((f - 0x0080) & 0xffff) < 0x0020) a = (f - 0x0080) & 0xffff;
  else if (((f - 0x00b0) & 0xffff) < 0x0060) a = (f - 0x00b0) & 0xffff;
  else a = 0;
  w16(R.screen_scroll_y_position, ((a & 0x0003) - 1) & 0xffff);
  f = r16(R.active_frame_counter);
  if (f === 0x00b0 || f === 0x00f0) playSounds([5, C.sound_explosion], [6, C.sound_wall_break]);
  if (f === 0x00b2) playSounds([7, C.sound_ending_beam], [4, C.sound_ending_fire]);
  // CODE_80A3CF: an explosion every 16 frames from $B0 to $117
  f = r16(R.active_frame_counter);
  if (!(f & 0x000f) && ((f - 0x00b0) & 0xffff) < 0x0068) {
    CODE_80A4A1();
    if (reg.a === 0) {
      const x = reg.x;
      w16(x + sprite.render_order, 0x0103);
      w16(x + sprite.current_graphic, C.tnt_explosion_frame1);
      get_random_number();
      w16(x + sprite.y_position, ((reg.a & 0x001f) + r16(0x0dec) - 0x0030) & 0xffff);
      get_random_number();
      w16(x + sprite.x_position, ((reg.a & 0x001f) + r16(0x0de8) - 0x0010) & 0xffff);
      w16(x + sprite.type, 0x0001);
      w16(x + sprite.oam_property, (((r16(R.active_frame_counter) << 1) & 0x00e0) + 0x2ae0) & 0xffff);
    }
  }
  // CODE_80A41F: animate the explosions every 4 frames
  if (!(r16(R.active_frame_counter) & 0x0003)) {
    for (let x: number = sprite_table.slot_0; x !== sprite_table.end; x += SPRITE_SIZE) {
      if (r16(x + sprite.type) !== 0x0001) continue;
      let g = (r16(x + sprite.current_graphic) + 4) & 0xffff;
      if (g >= C.tnt_explosion_frame15 + 4) {
        g = 0;
        w16(x + sprite.type, 0);
      }
      w16(x + sprite.current_graphic, g);
    }
  }
  // CODE_80A44D
  sort_sprite_render_orders();
  w16(0x70, 0x0200);
  for (let i = 0; i <= 0x1e; i += 2) w16(R.oam_attribute_table + i, 0);
  w16(R.sprite_dma_buffer_limit, 0x0044);
  CODE_B59F40(); // draw the sprites
  w16(R.next_sprite_dma_buffer_slot, 0);
  set_unused_oam_offscreen_global();
  prepare_oam_dma_channel();
  w16(R.nmi_pointer, L("run_secret_ending") & 0xffff);
  endFrame(); // WAI
}

/** $80A4A1 — X = first free sprite slot (A = 0), or A = 1 if the table is full. */
export function CODE_80A4A1() {
  let x: number = sprite_table.slot_0;
  do {
    if (r16(x + sprite.type) === 0) {
      reg.x = x;
      reg.a = 0;
      reg.z = true;
      return;
    }
    x = (x + SPRITE_SIZE) & 0xffff;
  } while (x !== sprite_table.slot_0);
  reg.x = x;
  reg.a = 1;
  reg.z = false;
}

/** $80A4B7 — X = K. Rool's boat: laugh, sail right, then sink into the distance. */
export function CODE_80A4B7() {
  const x = reg.x;
  const f = r16(R.active_frame_counter);
  if (f === 0x0340) playSounds([6, C.sound_ending_krool_laugh], [7, C.sound_ending_krool_laugh_echo]);
  let a = (f - 0x0120) & 0xffff;
  if (!(a & 0x8000)) {
    const moving = a < 0x02e0 ? !(a & 0x000f) : !(a & 0x001f);
    if (moving) w16(x + sprite.x_position, (r16(x + sprite.x_position) + 1) & 0xffff);
  }
  // CODE_80A4E5
  a = (f - 0x03e0) & 0xffff;
  if (a & 0x8000) return;
  a >>= 2;
  if (a >= 0x0048) {
    // the scene is over: remove the island, Diddy, Dixie and the boat
    a = 0;
    w16(sprite_table.slot_0, 0);
    w16(sprite_table.slot_1, 0);
    w16(sprite_table.slot_2, 0);
    w16(sprite_table.slot_4, 0);
  } else a = ((a & 0xfffc) + C.secret_ending_boat_frame1) & 0xffff;
  // CODE_80A50C
  w16(x + sprite.current_graphic, a);
  if (!(r16(R.active_frame_counter) & 0x003f)) w16(x + sprite.y_position, (r16(x + sprite.y_position) - 1) & 0xffff);
}

/** $80A518 — X = Dixie's hair (blowing in the wind). */
export function CODE_80A518() {
  reg.a = ((r16(R.active_frame_counter) & 0x001c) + C.secret_ending_dixie_hair_frame1) & 0xffff;
  w16(reg.x + sprite.current_graphic, reg.a);
}

/** $80A542 — (dead code tail) store the explosion frame. */
export function CODE_80A542() {
  w16(reg.x + sprite.current_graphic, reg.a);
}

/** $80A544 — (dead code tail) */
export function CODE_80A544() {}

/** $80A545 — X = the island: the beam animation, the island sinking and its sounds. */
export function CODE_80A545() {
  const x = reg.x;
  w16(0x32, r16(x + sprite.current_graphic));
  const f = r16(R.active_frame_counter);
  if (f < 0x00c0) return;
  if (f === 0x00c0) w16(sprite_table.slot_2, 0); // Dixie is gone
  // CODE_80A55A
  if (!(f & 0x0003)) {
    let g = r16(x + sprite.current_graphic);
    if (g === 0) g = C.secret_ending_isle_top_graphic;
    g = (g + 4) & 0xffff;
    if (g === C.secret_ending_dixie_hair_frame1) g = C.secret_ending_isle_beam_frame1;
    w16(x + sprite.current_graphic, g);
  }
  // CODE_80A574: sink slowly
  if (!(r16(R.active_frame_counter) & 0x000f)) {
    w16(x + sprite.y_position, (r16(x + sprite.y_position) + 1) & 0xffff);
    const y1 = x + SPRITE_SIZE + sprite.y_position;
    w16(y1, (r16(y1) + 1) & 0xffff);
  }
  // CODE_80A57F
  get_random_number();
  if ((((reg.a & 0x000f) + r16(x + sprite.y_position)) & 0xffff) >= 0x0058) {
    w16(x + sprite.current_graphic, 0);
    if (r16(0x32) !== 0) playSounds([7, C.sound_nothing], [4, C.sound_nothing]);
    return;
  }
  // CODE_80A5A6
  if (r16(x + sprite.y_position) >= 0x0032 && r16(0x32) === 0)
    playSounds([7, C.sound_ending_beam_die], [4, C.sound_ending_fire_die]);
}

/**
 * $80A5D1 — (unused, from DKC1) Y = sign extension of A: add (Y:A) << 6 to the 32-bit value at
 * X+$08 (DP-relative to the sprite).
 */
export function CODE_80A5D1() {
  const x = reg.x;
  w16(0x54, reg.y);
  let lo = reg.a & 0xffff;
  let hi = reg.y & 0xffff;
  for (let i = 0; i < 6; i++) {
    hi = ((hi << 1) | (lo >> 15)) & 0xffff;
    lo = (lo << 1) & 0xffff;
  }
  w16(0x54, hi);
  const sum = lo + r16((x + 0x08) & 0xffff);
  w16((x + 0x08) & 0xffff, sum & 0xffff);
  reg.a = (r16((x + 0x0a) & 0xffff) + hi + (sum > 0xffff ? 1 : 0)) & 0xffff;
  w16((x + 0x0a) & 0xffff, reg.a);
}

register({
  init_secret_ending,
  CODE_809FA2,
  CODE_809FC1,
  CODE_80A0C2,
  CODE_80A0E9,
  run_secret_ending,
  CODE_80A327,
  CODE_80A35B,
  CODE_80A4A1,
  CODE_80A4B7,
  CODE_80A518,
  CODE_80A542,
  CODE_80A544,
  CODE_80A545,
  CODE_80A5D1,
});
