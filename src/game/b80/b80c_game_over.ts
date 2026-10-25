/**
 * Bank $80 (package b80c) — the GAME OVER screen: Diddy and Dixie's names wobble on layer 1,
 * the screen is tinted red, and after a while (or a button press) it fades out to the logo /
 * world map.
 */
import { r8, r16, w16, rom16, io8, io16 } from "../../core/mem";
import { reg, register } from "../../core/cpu";
import { frameEnded } from "../../core/hybrid";
import { L, R, C, CPU, PPU } from "../../core/sym";
import { play_song } from "./b80a_util";
import {
  disable_screen,
  clear_vram_global,
  init_registers_global,
  vram_payload_handler_global,
  set_ppu_registers_global,
  set_fade,
  dma_palette,
  set_game_mode_and_return,
  input_and_pause_handler,
  fade_screen,
  game_sub_mode_return,
  restart_logo_or_world_map,
} from "../../gen/routines";

const WAVE = L("DATA_B3F4D8"); // sine table (256 words)
const asr = (v: number) => ((v & 0x8000) | ((v & 0xffff) >> 1)) & 0xffff;

/** $80FA7C — game mode init: load the GAME OVER screen and start its music. */
export function init_game_over_screen() {
  disable_screen();
  reg.db = 0x80;
  clear_vram_global();
  init_registers_global();
  reg.a = C.gameover_vram_payload_id;
  vram_payload_handler_global();
  reg.a = C.gameover_ppu_config_id;
  set_ppu_registers_global();
  reg.a = C.music_game_over;
  play_song();
  reg.a = 0x0100;
  set_fade();
  reg.a = L("gameover_screen_palette") & 0xffff;
  reg.y = 0x0000;
  reg.x = 0x0020;
  dma_palette();
  w16(R.active_frame_counter, 0);
  w16(R.pending_dma_hdma_channels, 0x0001);
  reg.a = L("run_game_over_screen") & 0xffff;
  set_game_mode_and_return();
}

/** $80FAC0 — one frame of the GAME OVER screen. */
export function run_game_over_screen() {
  io16(CPU.enable_dma, r16(R.pending_dma_hdma_channels)); // (also writes the HDMA enable)
  let frame = r16(R.active_frame_counter);
  // from frame $300 the red tint fades out
  const tint = ((frame - 0x0300) & 0xffff) >> 2;
  if (tint < 0x001f) io8(PPU.fixed_color, (tint | 0xc0) & 0xff);
  // the text slides in from below during the first $200 frames, wobbling
  const rise = (0x0200 - frame) & 0xffff;
  if (rise < 0x0200) {
    w16(0x32, (rise + 0x0010) & 0xffff);
    let x = (((frame << 1) + 0x0040) & 0x00ff) << 1;
    let v = asr(asr(asr(rom16(WAVE + x))));
    v = (v + r16(0x32)) & 0xffff;
    v >>= 1; // (CMP #$8000 : LSR — the LSR ignores the carry)
    io8(PPU.layer_1_scroll_y, v & 0xff);
    io8(PPU.layer_1_scroll_y, v >> 8);
    x = (frame & 0x00ff) << 1;
    v = asr(asr(asr(rom16(WAVE + x))));
    io8(PPU.layer_1_scroll_x, v & 0xff);
    io8(PPU.layer_1_scroll_x, v >> 8);
  }
  // frames $100-$1FF: layer 2 scrolls in while the colour goes from black to red
  const t2 = (frame - 0x0100) & 0xffff;
  if (t2 < 0x0100) {
    io8(PPU.layer_2_scroll_y, t2 & 0xff);
    io8(PPU.layer_2_scroll_y, 0);
    io8(PPU.fixed_color, (((t2 ^ 0x00ff) >> 3) | 0x00e0) & 0xff);
  }
  input_and_pause_handler();
  if (frameEnded) return;
  io8(PPU.screen, r8(R.screen_brightness));
  frame = r16(R.active_frame_counter);
  if (frame >= 0x00f0 && !(r16(R.screen_fade_speed) & 0x00ff)) {
    // A, B, Y, X or START skips; otherwise leave after $480 frames
    if (r16(R.player_active_held) & 0xd080 || frame === 0x0480) {
      reg.a = 0x820f;
      set_fade();
    }
  }
  fade_screen();
  if (r16(R.screen_brightness)) {
    game_sub_mode_return();
    return;
  }
  restart_logo_or_world_map();
}

register({
  init_game_over_screen,
  run_game_over_screen,
});
