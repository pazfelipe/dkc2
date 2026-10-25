/**
 * Bank $80 (package w4_80) — the ending parade ("cast of characters"): its screen init, the
 * game mode that walks the parade script (ending_parade_table: display time, sprite to spawn,
 * caption), the caption renderer and the sprite codes of the parading characters.
 *
 * The parade script pointer is the long pointer at $7A/$7C, $84 = frames left for the current
 * entry, $80 = caption height animation, $7E = caption index (ending_parade_text_table).
 */
import { r8, r16, w16, io8, io16, rom8, rom16, bus8, bus16 } from "../../core/mem";
import { reg, register } from "../../core/cpu";
import { frameEnded, setRetMode, RET_RTS, RET_RTL, RET_SPRITE } from "../../core/hybrid";
import { L, R, C, CPU, PPU, sprite } from "../../core/sym";
import {
  disable_screen,
  clear_vram_global,
  init_registers_global,
  clear_noncritical_wram,
  set_all_oam_offscreen,
  init_sprite_render_order_global,
  play_song,
  set_ppu_registers_global,
  vram_payload_handler_global,
  dma_palette,
  set_fade_global,
  dma_sprite_palette_from_index,
  dma_queued_sprite_graphics,
  dma_queued_sprite_palette,
  update_kackle_graphics_global,
  input_and_pause_handler,
  set_active_kong_global,
  work_on_active_kong_global,
  spawn_special_sprite_index,
  spawn_big_special_sprite_index,
  set_nmi_and_wait,
  sprite_handler,
  sort_sprite_render_orders,
  set_unused_oam_offscreen,
  fade_screen,
  game_sub_mode_return,
  CODE_B59F40,
  process_sprite_animation,
  delete_sprite_if_offscreen,
  set_sprite_animation,
} from "../../gen/routines";

const PARADE_TABLE = L("ending_parade_table");
const TEXT_TABLE = L("ending_parade_text_table");
const FONT_TILES = L("yellow_font_tile_offsets");
const NPC_ANIM_BANK = (L("DATA_BAC259") >> 16) & 0xff;

/** `LDA [$7A]`: next word of the parade script. */
const script16 = () => bus16(((r8(0x7c) << 16) | r16(0x7a)) & 0xffffff);
const advance = () => w16(0x7a, (r16(0x7a) + 2) & 0xffff);

/** $80F3FB — set up the parade screen: credits music, Klubba's kiosk palette, script start. */
export function init_ending_parade() {
  disable_screen();
  reg.db = 0x80;
  clear_vram_global();
  init_registers_global();
  clear_noncritical_wram();
  set_all_oam_offscreen();
  init_sprite_render_order_global();
  reg.a = C.music_credits;
  play_song();
  w16(R.next_sprite_dma_buffer_slot, 0);
  reg.a = C.end_parade_ppu_config_id;
  set_ppu_registers_global();
  reg.a = C.end_parade_vram_payload_id;
  vram_payload_handler_global();
  reg.y = 0;
  reg.a = L("klubbas_kiosk_palette") & 0xffff;
  reg.x = 0x0020;
  dma_palette();
  reg.a = 0x0100;
  set_fade_global();
  w16(R.screen_scroll_x_position, 0x0100);
  w16(R.screen_scroll_y_position, 0x0100);
  w16(R.screen_scroll_x_sub_position_low, 0x00b0); // used as the scroll of the background
  w16(0x84, 0x0001);
  w16(0x7a, PARADE_TABLE & 0xffff);
  w16(0x7c, (PARADE_TABLE >> 16) & 0xff);
  w16(0x0654, 0x1654);
  w16(0x0656, 0x1654);
  w16(0x072b, 0x1654);
  reg.y = 0x00f0;
  reg.x = 0x0004;
  reg.a = C.map_p1_kong_and_text_spr_palette;
  dma_sprite_palette_from_index();
  w16(R.pending_dma_hdma_channels, 0x0001);
  reg.a = 0x0001;
}

/**
 * $80F482 — one frame of the parade: VBlank uploads, background scroll (stops at the last
 * caption $1D), caption height animation, the next script entries when the current one's time
 * is up (an entry time with bit 15 = fade out), then the credits screen once faded out.
 */
export function ending_parade_game_mode_hop() {
  io16(CPU.enable_dma, r16(R.pending_dma_hdma_channels));
  dma_queued_sprite_graphics();
  dma_queued_sprite_palette();
  update_kackle_graphics_global();
  const sub = r16(R.screen_scroll_x_sub_position_low);
  io8(PPU.sprite_select, 0);
  io8(PPU.layer_2_scroll_x, sub & 0xff);
  io8(PPU.layer_2_scroll_x, (sub >> 8) & 0xff);
  io8(PPU.layer_2_scroll_y, 0xc0);
  io8(PPU.layer_2_scroll_y, 0xc0);
  io8(PPU.screen, r8(R.screen_brightness));
  input_and_pause_handler();
  if (frameEnded) return;
  if (r16(0x7e) === 0x001d) w16(R.screen_scroll_x_sub_position_low, (r16(R.screen_scroll_x_sub_position_low) - 1) & 0xffff);
  // the caption rises in during the entry and drops out in its last 16 frames
  if (r16(0x84) < 0x0010) {
    w16(0x80, (r16(0x80) + 0x0200) & 0xffff);
  } else if (r16(0x80)) {
    w16(0x80, (r16(0x80) - 0x0200) & 0xffff);
  }
  const left = (r16(0x84) - 1) & 0xffff;
  w16(0x84, left);
  if (!left) {
    w16(0x80, 0x2000);
    do {
      let time = script16();
      if (time & 0x8000) {
        // end of the script: fade out (and the fade value doubles as the entry time)
        time = 0x820f;
        w16(R.screen_brightness, time);
      }
      w16(0x84, time);
      advance();
      const spawn = script16();
      if (spawn) {
        reg.y = spawn;
        if (spawn === 0x01ce || spawn === 0x01da) {
          spawn_big_special_sprite_index();
        } else {
          if (spawn === 0x020e || spawn === 0x020c) {
            // the playable Kongs walk in the parade: make them the active Kong first
            reg.a = spawn === 0x020e ? 0 : 1;
            set_active_kong_global();
            work_on_active_kong_global();
            const ctl = r16(R.active_kong_control_variables);
            w16((ctl + 6) & 0xffff, r16((ctl + 6) & 0xffff) | 0x0004);
            reg.y = spawn;
          }
          spawn_special_sprite_index();
        }
        reg.a = r16(R.alternate_sprite);
      }
      advance();
      w16(0x7e, script16());
      advance();
    } while (!r16(0x84));
  }
  // CODE_80F551
  if (r16(R.screen_brightness) === 0x8201) {
    w16(0x067d, L("init_credits_screen") & 0xffff);
    reg.a = L("run_bonus_and_credits_screen") & 0xffff;
    set_nmi_and_wait();
    return;
  }
  sprite_handler();
  if (frameEnded) return;
  sort_sprite_render_orders();
  update_ending_parade_text();
  set_unused_oam_offscreen();
  fade_screen();
  game_sub_mode_return();
}

/**
 * $80F946 — draw the caption ($7E) centred at the top of OAM (16x8 letters, two 8x8 sprites
 * each, the height animated by $80), then the parade sprites with a large sprite DMA budget.
 */
export function update_ending_parade_text() {
  let y = 0;
  const idx = r16(0x7e);
  if (idx) {
    w16(0x3a, rom16(TEXT_TABLE + ((idx << 1) & 0xffff)));
    w16(0x3c, (TEXT_TABLE >> 16) & 0xff);
    const ptr = () => ((r8(0x3c) << 16) | r16(0x3a)) & 0xffffff;
    let len = 0;
    while (bus8((ptr() + len) & 0xffffff)) len++;
    w16(0x32, ((((len << 2) & 0xffff) ^ 0x00ff) + 0xc080 + r16(0x80)) & 0xffff);
    for (;;) {
      const ch = bus8(ptr());
      if (!ch) break;
      if (ch !== 0x20) {
        const tile = (((rom8((FONT_TILES + ch - 0x21) & 0xffffff)) << 1) + 0x3e02) & 0xffff;
        w16(0x34, tile);
        w16(0x0200 + y, r16(0x32));
        w16(0x0202 + y, tile);
        w16(0x0204 + y, (r16(0x32) + 0x0800) & 0xffff);
        w16(0x34, (tile + 1) & 0xffff);
        w16(0x0206 + y, (tile + 1) & 0xffff);
        y = (y + 8) & 0xffff;
      }
      w16(0x3a, (r16(0x3a) + 1) & 0xffff);
      w16(0x32, (r16(0x32) + 8) & 0xffff);
    }
  }
  // .CODE_80F9C7
  w16(R.next_oam_slot, (y + 0x0200) & 0xffff);
  w16(0x56, 0x0400);
  for (let i = 0; i < 0x20; i += 2) w16(0x0400 + i, 0);
  w16(R.sprite_dma_buffer_limit, 0x0054);
  const db = reg.db;
  reg.db = 0x80;
  CODE_B59F40();
  w16(R.next_sprite_dma_buffer_slot, 0);
  reg.db = db;
}

/**
 * $80FA11 — parade enemies: walk right 1 px per frame and animate (not the skull cart), the
 * Zingers / King Zing / Flitters keep the buzzing sound on; despawn when off screen.
 */
export function credits_dummy_sprite_code() {
  const x = r16(R.current_sprite);
  reg.x = x;
  w16(x + sprite.x_position, (r16(x + sprite.x_position) + 1) & 0xffff);
  if (r16(x + sprite.current_graphic) !== C.cart_slope_frame10) {
    process_sprite_animation();
    const anim = r16(reg.x + sprite.animation_id);
    reg.a = anim;
    if (anim === C.zinger_horizontal_anim_id || anim === C.king_zing_idle_anim_id || anim === C.flitter_horizontal_anim_id) {
      w16(R.zinger_loop_sound_enabler, (r16(R.zinger_loop_sound_enabler) + 1) & 0xffff);
    }
  }
  delete_sprite_if_offscreen();
}

/**
 * $80FA40 — parade Kong NPCs (Cranky, Funky, Swanky, Wrinkly, ...): walk right, and once
 * ($42) start the next animation of their sequence ($44 = sequence pointer, $63 = loop back
 * to the address in the next word).
 */
export function credits_npc_kong_sprite_code() {
  const db = reg.db;
  reg.db = 0x80;
  const x = r16(R.current_sprite);
  reg.x = x;
  w16(x + sprite.x_position, (r16(x + sprite.x_position) + 1) & 0xffff);
  if (!r16(x + 0x42)) {
    w16(x + 0x42, (r16(x + 0x42) + 1) & 0xffff);
    let y = r16(x + 0x44);
    let a = bus16((NPC_ANIM_BANK << 16) | y);
    if (a === 0x0063) {
      // the loop-back reads run with DB = $80 again (after the PLB)
      a = bus16(0x800000 | ((y + 2) & 0xffff));
      w16(x + 0x44, a);
      y = a;
      a = bus16(0x800000 | y);
    }
    y = (y + 2) & 0xffff;
    w16(x + 0x44, y);
    reg.y = y;
    reg.a = a;
    set_sprite_animation();
  }
  process_sprite_animation();
  delete_sprite_if_offscreen();
  reg.db = db;
}

setRetMode(L("init_ending_parade"), RET_RTL);
setRetMode(L("update_ending_parade_text"), RET_RTS);
setRetMode(L("credits_dummy_sprite_code"), RET_SPRITE);
setRetMode(L("credits_npc_kong_sprite_code"), RET_SPRITE);

register({
  init_ending_parade,
  ending_parade_game_mode_hop,
  update_ending_parade_text,
  credits_dummy_sprite_code,
  credits_npc_kong_sprite_code,
});
