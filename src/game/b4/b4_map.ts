/**
 * Bank $B4 — world map logic: new-file map state (CODE_B48000), map init (CODE_B480CD), the
 * per-frame map logic (CODE_B48368: icon/text DMA, scrolling, node icons, path walking, START to
 * enter a level or a Kong family screen), the map unlock buffers (packing/unpacking the node icon
 * table at $7E3200 and the path table at $7E2A00), the level-return bookkeeping (CODE_B4B208) and
 * the level name text (CODE_B4B8C6).
 *
 * Map RAM used here: $06A1/$06A3/$06A5 state flags, $06AF current path segment pointer (bank $B4),
 * $06B5/$06B7 Kong position on the map, $06B9/$06BB step directions, $06BD-$06C3 line stepping
 * (Bresenham) state, $06C5 segments left, $069B/$069D camera, $0681/$0682 level name text DMA
 * request/size, $07A1/$07A3 ring buffer of positions for the follower Kong.
 */
import { r8, r16, w8, w16, io8, io16, rom8, rom16 } from "../../core/mem";
import { reg, register, callPtr } from "../../core/cpu";
import { frameEnded, setRetMode, RET_RTS, RET_RTL } from "../../core/hybrid";
import { L, R, C, DMA, HDMA, PPU, CPU } from "../../core/sym";
import {
  calculate_completion_percentage,
  play_song,
  dma_sprite_palette_from_index,
  spawn_no_gfx_special_sprite_index,
  CODE_BAC7C0,
  disable_screen,
  set_game_mode_and_return,
  fade_screen_global,
  set_fade_global,
  CODE_BB80B4,
  is_level_dk_coin_collected,
  set_nmi_and_wait,
  input_and_pause_handler_global,
} from "../../gen/routines";
import {
  dbR8,
  dbR16,
  dbW16,
  longR16,
  longR8,
  longW16,
  longW8,
  add16,
  add8,
  lsrM16,
  lsrM8,
  rorM16,
  aslM8,
  nextOamHighBit,
  dmaToVram,
} from "./b4_util";
import { CODE_B4BE63, CODE_B4BE96 } from "./b4_hero";

const lo16 = (a: number) => a & 0xffff;

const DATA_B4BEE7 = L("DATA_B4BEE7");
const DATA_B4BED7 = L("DATA_B4BED7");
const DATA_B4BEDF = L("DATA_B4BEDF");
const INITIAL_UNLOCKED_NODES = lo16(L("initial_unlocked_nodes"));
const WORLD_TABLE = lo16(L("DATA_B4C25E"));
const LOST_WORLD_SPRITES = lo16(L("DATA_B4CE1F"));
const CHEAT_CODES = lo16(L("DATA_B4CF21"));
const NODE_ICON_DATA = lo16(L("DATA_B4CF4B"));
const PATH_DATA = lo16(L("DATA_B4E6D8"));
const ICON_TILES = lo16(L("DATA_B4C491"));
const MARKER_OFFSETS = lo16(L("DATA_B4C4A3"));
const OAM_HIGH_BITS = lo16(L("DATA_B4B571"));
const KROC_KORE_NODES = L("DATA_B4C48C");
const LEVEL_TO_NODE = lo16(L("DATA_B4C18B"));
const WORLD0_LEVEL_LISTS = lo16(L("DATA_B4CE29"));
const YELLOW_FONT = lo16(L("yellow_font_tile_offsets"));
const KREMLAND_LOWER_PAL = L("kremland_lower_map_palette");
const KREMLAND_UPPER_PAL = L("kremland_upper_map_palette");
const ICON_GFX = lo16(L("world_map_icon_graphics"));
const ICON_GFX_BANK = L("world_map_icon_graphics") >> 16;
const WATER_DROP_GFX = lo16(L("water_drop_graphics"));
const BOSS_ICON_GFX = lo16(L("world_map_boss_icon_graphics"));
const BOSS_ICON_GFX_BANK = L("world_map_boss_icon_graphics") >> 16;
const DATA_FC14A0 = L("DATA_FC14A0");
const TEXT_VRAM_BUFFER = lo16(R.text_vram_buffer);
const MAP_ICON_UNLOCKS = R.map_icon_unlocks_buffer;
const MAP_PATH_UNLOCKS = R.map_path_unlocks_buffer;
const RUN_808D02 = lo16(L("run_808D02"));
const CODE_8087D9_PTR = lo16(L("CODE_8087D9"));
const RUN_SIMPLE_GAME_MODE = lo16(L("run_simple_game_mode"));
const RUN_ENDING_MONKEY_MUSEUM = lo16(L("run_ending_monkey_museum"));
const CODE_B49126_PTR = lo16(L("CODE_B49126"));

/** Sets world_map_events' "Lost World entrance opened" bits ($0004 | $0008). */
const LOST_WORLD_OPEN = 0x000c;

// ---------------------------------------------------------------------------------------------
// New file

/** $B48000 — map state of a new save file: clear progress, unlock the starting nodes. */
export function CODE_B48000() {
  const db = reg.db;
  reg.db = 0xb4;
  w8(0xca, 0x7e);
  w16(R.token_count, 0);
  w16(R.banana_coin_count, 0);
  w16(R.dk_coin_count, 0);
  w16(R.competitor_dk_coin_count, rom16(DATA_B4BEE7));
  w8(R.completed_lost_world_levels, 0);
  w8(R.world_map_events, 0);
  w8(R.klubba_payments, 0);
  w8(R.visited_kong_family_members, 0);
  w16(R.world_number, 0);
  w16(R.map_node_number, 0);
  w16(R.returning_map_node_number, 0);
  w16(R.RAM_064A, 0);
  w16(R.RAM_064B, 0); // 16-bit STZ: also clears the low byte of RAM_064C
  w16(0x067f, 0);
  w16(R.RAM_07B0, 0);
  // clear the $27 bytes of NPC dialogue flags
  for (let i = 0; i < 0x27; i++) w8(R.completed_npc_dialogue + i, 0);
  w16(0x0683, 0);
  w16(0x069d, 0);
  w16(R.RAM_064C, 0x0070);
  w16(0x069d, 0);
  w16(0x06af, 0);
  w16(0x06a1, 0);
  w16(0x06a3, 0);
  w16(0x06a5, 0);
  CODE_B4AED3();
  reg.y = lo16(MAP_ICON_UNLOCKS);
  reg.a = 0x0010;
  CODE_B480B2();
  reg.y = lo16(MAP_PATH_UNLOCKS);
  reg.a = 0x0008;
  CODE_B480B2();
  CODE_B4B3CD();
  reg.a = 0x006c;
  CODE_B4B18F();
  reg.a = 0x0078;
  CODE_B4B4D3();
  // unlock the 8 starting nodes
  w16(0x0650, 0x0008);
  let x = 0;
  do {
    reg.a = rom16(0xb40000 | (INITIAL_UNLOCKED_NODES + x));
    CODE_B4B3B8();
    x += 2;
  } while (add16(0x0650, -1) !== 0);
  reg.x = x;
  CODE_B4B0CF();
  reg.db = db;
}

/** $B480B2 — clear A words at $7E:Y (long pointer $CE). */
export function CODE_B480B2() {
  w16(0xce, reg.y);
  w16(0x0650, reg.a);
  w8(0xd0, 0x7e);
  let y = 0;
  do {
    longW16(0xce, 0, y);
    y += 2;
  } while (add16(0x0650, -1) !== 0);
  reg.a = 0;
  reg.y = y;
}

// ---------------------------------------------------------------------------------------------
// Map init

/** $B480CD — world map init (also Crocodile Isle): unpack unlocks, process the returning level. */
export function CODE_B480CD() {
  const db = reg.db;
  reg.db = 0xb4;
  w8(0xca, 0x7e);
  w8(0xcd, 0xb4);
  reg.a = 0x006c;
  CODE_B4B18F();
  reg.a = 0x0078;
  CODE_B4B4D3();
  CODE_B4B208();
  if (frameEnded) return; // Krocodile Kore cleared: the ending started (set_nmi_and_wait)
  calculate_completion_percentage();
  if ((r16(R.completed_lost_world_levels) & 0xff) === 5 && !(r16(R.world_map_events) & LOST_WORLD_OPEN)) {
    // all 5 Lost World levels done: open Krocodile Kore from every kiosk (after a delay)
    w16(R.RAM_07B0, 0x001e);
    for (const node of [
      C.map_node_kroc_kore_w2_lost_world,
      C.map_node_kroc_kore_w3_lost_world,
      C.map_node_kroc_kore_w4_lost_world,
      C.map_node_kroc_kore_w5_lost_world,
      C.map_node_kroc_kore_w6_lost_world,
    ]) {
      reg.a = node;
      CODE_B4B3B8();
    }
    for (const a of [0x2b64, 0x2b70, 0x2b7c, 0x2b88, 0x2b94]) {
      reg.a = a;
      CODE_B48360();
    }
    CODE_B4B3AB();
  }
  // CODE_B48147
  CODE_B4AED3();
  CODE_B4B0CF();
  const dk = r16(R.dk_coin_count);
  if (dk !== 0 && dk - 1 >= r16(R.competitor_dk_coin_count)) {
    CODE_B4AE58(); // beat Cranky's rival's DK coin count: raise it
    if (r16(R.visited_kong_family_members) & 0x0040) {
      CODE_B4BE96(); // video game hero screen
      reg.db = db;
      return;
    }
  }
  // CODE_B48169
  if (r16(R.world_number) === 0) CODE_B4BB03();
  if (r16(R.world_number) >= C.world_lost_world_w2) lostWorldHdma();
  // CODE_B481C3
  if (r8(R.RAM_064B) !== 0) {
    w8(R.RAM_064A, 0);
    w8(R.RAM_064B, 0);
  }
  if (r16(0x06a5) & 0x4000) {
    w16(0x06a5, r16(0x06a5) & ~0x4000);
    w16(R.current_song, 0);
  }
  mapMusic();
  // CODE_B4821B: PHB : PHK : PLB
  w16(0x065e, 0);
  io16(PPU.vram_address, 0x0200);
  dmaToVram(null, DATA_FC14A0 & 0xffff, DATA_FC14A0 >> 16, 0x0040);
  w16(0x0681, 0);
  w16(0x0697, 0x0001);
  // map Kong palettes (the funky plane uses its own)
  let pal = r16(0x060f) ? 0x0080 : 0x00aa;
  if (r16(0x06a3) & 0x1000) pal = 0x0034;
  spritePalette(pal, 0x00f0);
  spritePalette(0x00ab, 0x00d0);
  spritePalette(r16(0x060f) ? 0x0080 : 0x00aa, 0x00e0);
  if (r16(R.world_number) !== 0) {
    spritePalette(0x00ad, 0x0080);
    spritePalette(0x00ae, 0x0090);
    spritePalette(0x00a5, 0x00a0);
    spritePalette(0x00a6, 0x00b0);
  }
  // CODE_B482D7
  w16(0x069f, 0x000a);
  reg.a = 0x006c;
  CODE_B4B18F();
  reg.a = 0x0078;
  CODE_B4B4D3();
  CODE_B489ED();
  if (r16(R.world_number) >= C.world_lost_world_w2) {
    let n = r16(R.completed_lost_world_levels) & 0xff;
    if (n !== 0) {
      // one beam sprite per completed Lost World level
      if (n >= 6) n = 5;
      w16(0x0666, n);
      let x = 0;
      do {
        reg.y = rom16(0xb40000 | (LOST_WORLD_SPRITES + x));
        reg.x = x;
        spawn_no_gfx_special_sprite_index();
        const y = r16(R.alternate_sprite);
        w16(y + 0x06, 0x0080);
        w16(y + 0x0a, 0x0080);
        w16(y + 0x1a, (x * 2 + r16(y + 0x1a)) & 0xffff);
        x += 2;
      } while (add16(0x0666, -1) !== 0);
    }
  }
  // CODE_B4832F: PLB (DB = $B4 again)
  reg.db = 0xb4;
  CODE_B4AEAF();
  w16(0x07a1, 0x0733);
  w16(0x07a3, 0x075b);
  w16(0x06a1, r16(0x06a1) & 0x022c);
  w16(0x06a3, r16(0x06a3) & 0x1060);
  w16(0x06a1, r16(0x06a1) | 0x0080);
  CODE_B4B8C6();
  reg.db = db;
}

function spritePalette(index: number, dest: number) {
  reg.a = index;
  reg.y = dest;
  reg.x = 0x0004;
  dma_sprite_palette_from_index();
}

/** $B48179 — Lost World maps: HDMA channel 2 gradient (the beam of light). */
function lostWorldHdma() {
  w16(R.world_map_event_step_counter, 0);
  w16(0x8012, 0x0040);
  w16(0x8013, 0x0112);
  w16(0x8015, 0x0001);
  w16(0x8018, 0x0000);
  const x = r16(R.world_map_events) & 0x0008 ? 0x0013 : 0x0012;
  w16(0x8016, x);
  io16(HDMA.settings + 0x20, 0x2c01);
  io16(HDMA.source + 0x20, 0x8012);
  io8(HDMA.source_bank + 0x20, 0x7e);
  io8(HDMA.indirect_source_bank + 0x20, 0);
}

/** $B481E3 — start the map song unless it is already playing (or the rescue song is). */
function mapMusic() {
  let song: number;
  if (r16(0x06a3) & 0x1000) {
    song = C.music_funky; // arriving with Funky's plane
  } else {
    if (r16(R.current_song) === C.music_rescue_kong) return;
    song = r16(R.world_number) >= C.world_lost_world_w2 ? C.music_lost_world : C.music_island_map;
  }
  if (r16(R.current_song) === song) return;
  reg.a = song;
  play_song();
}

/** $B48360 — set the word at $7E:A (long pointer $C8) to 1 (open a path). */
export function CODE_B48360() {
  w16(0xc8, reg.a);
  longW16(0xc8, 0x0001);
  reg.a = 0x0001;
}

// ---------------------------------------------------------------------------------------------
// Map frame

/** $B48368 — world map logic, once per frame. */
export function CODE_B48368() {
  const db = reg.db;
  reg.db = 0xb4;
  kremlandPaletteCycle();
  if (r16(0x06a1) & 0x0010) mapIconDma();
  // CODE_B484BC: level name text tiles
  if (r8(0x0681) !== 0) {
    io16(DMA.size, ((r8(0x0682) << 8) >> 3) & 0xffff);
    io16(PPU.vram_address, 0x02b0);
    io8(DMA.settings, 0x01);
    io8(DMA.destination, 0x18);
    io16(DMA.source, TEXT_VRAM_BUFFER);
    io8(DMA.source_bank, 0x7e);
    io8(DMA.unused_1, 0);
    io8(CPU.enable_dma, 0x01);
    w8(0x0681, 0);
  }
  // CODE_B484FB: scroll registers, then the camera of the next frame
  let s = r16(R.screen_scroll_x_position);
  io8(PPU.layer_1_scroll_x, s & 0xff);
  io8(PPU.layer_1_scroll_x, s >> 8);
  w16(R.screen_scroll_x_position, r16(0x069b));
  s = r16(R.screen_scroll_y_position);
  io8(PPU.layer_1_scroll_y, s & 0xff);
  io8(PPU.layer_1_scroll_y, s >> 8);
  w16(R.screen_scroll_y_position, r16(0x069d));
  w16(0x06a1, r16(0x06a1) & 0xffef);
  io8(PPU.screen, r8(R.screen_brightness));
  if (r16(0x06a3) & 0x0020) {
    // leaving through a world transition node: only fade
    tailFade(db);
    return;
  }
  // CODE_B48543
  CODE_BAC7C0();
  if (add16(0x069f, -1) === 0) {
    w16(0x069f, 0x000a);
    w16(0x06a1, r16(0x06a1) ^ 0x0020); // blink the current node's path markers
  }
  if (r16(0x0683) === 0 && (r16(R.player_active_held) & 0x2020) === 0x2020) {
    if (cheatCodeInput()) return;
  } else {
    CODE_B48611();
  }
  // CODE_B48620
  drawMapFrame(db);
}

/** $B48611 — reset the cheat code input buffer. */
function CODE_B48611() {
  w16(0x065e, 0);
  CODE_B4AED3();
  w16(0x06a1, r16(0x06a1) & 0xfff7);
}

/**
 * $B4856E — SELECT+L held: one button at a time is recorded at $06CF and compared with the cheat
 * codes; a complete code runs its routine. Returns true when the frame ended there.
 */
function cheatCodeInput(): boolean {
  let a = r16(R.player_active_held) & 0xdfdf;
  if (a === 0 || (a & (a - 1)) !== 0) return false; // none or more than one other button held
  a = r16(R.player_active_pressed) & 0xdfdf;
  if (a === 0) return false;
  const x = r16(0x065e);
  w16(0x06cf + x, a);
  if (x >= 0x0028) {
    CODE_B48611();
    return false;
  }
  add16(0x065e, 2);
  w16(0x065c, r16(0x065e) >> 1);
  w16(0xcb, CHEAT_CODES);
  for (;;) {
    let y = longR16(0xcb);
    if (y === 0) {
      CODE_B48611(); // no code starts like this
      return false;
    }
    let xi = 0;
    let matched = true;
    let partial = false;
    for (;;) {
      const want = dbR16(y + 2);
      if (want === 0) break; // end of this code
      if (want !== r16(0x06cf + xi)) {
        matched = false;
        break;
      }
      xi += 2;
      y += 2;
      if (add16(0x065c, -1) === 0) {
        // everything typed so far matches this code
        w16(0x06a1, r16(0x06a1) | 0x0008);
        if (dbR16(y + 2) !== 0) partial = true;
        break;
      }
    }
    if (partial) return false;
    if (!matched) {
      add16(0xcb, 2);
      continue;
    }
    // CODE_B485DE: the whole code typed?
    if (xi !== r16(0x065e)) return false;
    w8(R.RAM_064B, 0x01);
    const code = longR16(0xcb);
    w16(0x065a, dbR16(code));
    callPtr(0xb4, r16(0x065a));
    if (frameEnded) return true;
    disable_screen();
    reg.a = CODE_8087D9_PTR;
    set_game_mode_and_return();
    return true;
  }
}

/** $B48374 — Krazy Kremland maps: cycle the colours of the swamp/lights. */
function kremlandPaletteCycle() {
  const world = r16(R.world_number);
  if (world === C.world_krazy_kremland_lower && !(r16(R.screen_brightness) & 0x8000) && !(r16(R.active_frame_counter) & 7)) {
    let a = (r8(0x84) + 1) & 0xff;
    w8(0x84, a);
    if (a >= 3) {
      a = 0;
      w8(0x84, 0);
    }
    let x = (a << 1) & 0xff; // ASL A : TAX (8-bit A, high byte of X stays 0)
    io8(PPU.cgram_address, 0x5d);
    for (let y = 6; y > 0; y--) {
      io8(PPU.cgram_write, rom8(KREMLAND_LOWER_PAL + 0xba + x));
      x++;
      if (x === 6) x = 0;
    }
    reg.x = x;
  }
  if (r16(R.world_number) === C.world_krazy_kremland_upper && !(r16(R.screen_brightness) & 0x8000)) {
    const t = (r8(R.active_frame_counter) >> 2) & 0xff;
    w8(0x32, t);
    // TAX with 8-bit A copies the hidden high byte too: that of screen_brightness
    const hi = r16(R.screen_brightness) & 0xff00;
    let x = hi | (t & 0x02);
    io8(PPU.cgram_address, 0x78);
    for (let y = 4; y > 0; y--) {
      io8(PPU.cgram_write, rom8(KREMLAND_UPPER_PAL + 0xf0 + x));
      x = hi | ((x + 1) & 0x03);
    }
    for (let y = 4; y > 0; y--) {
      io8(PPU.cgram_write, rom8(KREMLAND_UPPER_PAL + 0xf4 + x));
      x = hi | ((x + 1) & 0x03);
    }
    x = hi | (r8(0x32) & 0x06);
    for (let y = 8; y > 0; y--) {
      io8(PPU.cgram_write, rom8(KREMLAND_UPPER_PAL + 0xf8 + x));
      x = hi | ((x + 1) & 0x07);
    }
    reg.x = x;
  }
}

/** $B48423 — every 4th frame: next frame of the animated map icons (and of the boss icon). */
function mapIconDma() {
  io16(PPU.vram_address, 0);
  let src = (r16(0x0699) + 0x0400) & 0xffff;
  if (src === WATER_DROP_GFX) src = ICON_GFX;
  w16(0x0699, src);
  dmaToVram(null, src, ICON_GFX_BANK, 0x0400);
  if (r16(R.world_number) === 0) return;
  io16(PPU.vram_address, 0x0800);
  io16(DMA.source, (((r16(0x0699) - ICON_GFX) & 0xffff) >> 3) + BOSS_ICON_GFX);
  io8(DMA.settings, 0x01);
  io8(DMA.destination, 0x18);
  io8(DMA.source_bank, BOSS_ICON_GFX_BANK);
  io16(DMA.size, 0x0040);
  io8(DMA.unused_1, 0);
  io8(CPU.enable_dma, 0x01);
  // second half of the boss icon: the DMA source continues where the first transfer stopped
  io16(PPU.vram_address, 0x0900);
  io8(DMA.settings, 0x01);
  io8(DMA.destination, 0x18);
  io16(DMA.size, 0x0040);
  io8(DMA.unused_1, 0);
  io8(CPU.enable_dma, 0x01);
}

/** $B48620 — node icons, Kongs, input on the map, path walking. */
function drawMapFrame(db: number) {
  w16(0xc8, 0x03fc);
  w16(0x0678, 0x03fc);
  w16(0x06a7, 0x007f);
  w16(0x0685, 0x041e);
  w16(0x0687, 0x8000);
  reg.db = 0xb4;
  const x = (rom16(0xb40000 | (WORLD_TABLE + r16(R.world_number) * 2)) + 8) & 0xffff;
  w16(0x065c, rom16(0xb40000 | x));
  w16(0x065a, rom16(0xb40000 | (x + 2)));
  w16(0xcb, x + 6); // node list of this world (bank $CD = $B4)
  reg.y = 0x2a00;
  reg.db = 0x7e;
  w16(0x0678, r16(0xc8));
  const busy =
    (r16(R.RAM_064A) & 0xff) !== 0 ||
    r16(R.RAM_07B0) !== 0 ||
    (r16(R.world_map_events) & 0x0005) !== 0 ||
    (r16(0x06a5) & 0x2000) !== 0;
  if (!busy) {
    // node icons
    do {
      const y = (longR16(0xcb) << 2) & 0xffff;
      if (r8(0x3200 + y) !== 0) {
        reg.a = r8(0x3201 + y);
        reg.x = r16(0x3202 + y);
        reg.y = y;
        CODE_B4B64F();
      }
      add16(0xcb, 2);
    } while (add16(0x065a, -1) !== 0);
    if (r16(0x06a1) & 0x0020) {
      // blinking markers of the paths leaving the current node
      const node = r16(R.map_node_number);
      if (
        node !== C.map_node_w4_lower_to_upper_right &&
        node !== C.map_node_w4_upper_to_lower_left &&
        node !== C.map_node_w4_upper_to_lower_right
      ) {
        const y = (node << 2) & 0xffff;
        if (r8(0x3200 + y) !== 0) {
          reg.x = r16(0x3202 + y);
          reg.y = y;
          CODE_B4B6F9();
        }
      }
    }
  }
  // CODE_B486D5: Kongs on the map; the follower replays the leader's positions
  let kx = r16(R.active_kong_sprite);
  let y = r16(0x07a3);
  let a = (r16(0x06b5) + 9) & 0xffff;
  w16(kx + 0x06, a);
  dbW16(y, a);
  a = (r16(0x06b7) + 9) & 0xffff;
  w16(kx + 0x0a, a);
  dbW16(y + 2, a);
  a = (y + 4) & 0xffff;
  if (a >= 0x075f) a = 0x0733;
  w16(0x07a3, a);
  kx = r16(R.inactive_kong_sprite);
  if (kx !== 0) {
    y = r16(0x07a1);
    w16(kx + 0x06, dbR16(y));
    w16(kx + 0x0a, dbR16(y + 2));
    a = (y + 4) & 0xffff;
    if (a >= 0x075f) a = 0x0733;
    w16(0x07a1, a);
  }
  // CODE_B48725: face the walking direction
  const flip = (r16(0x06b9) & 0x8000) !== 0;
  kx = r16(R.inactive_kong_sprite);
  if (kx !== 0) w16(kx + 0x12, flip ? r16(kx + 0x12) | 0x4000 : r16(kx + 0x12) & 0xbfff);
  kx = r16(R.active_kong_sprite);
  w16(kx + 0x12, flip ? r16(kx + 0x12) | 0x4000 : r16(kx + 0x12) & 0xbfff);
  if (!(r16(0x06a3) & 0x0003)) {
    if (r16(0x06af) !== 0) {
      walkPath(); // CODE_B48888
    } else if (CODE_B48769()) {
      return; // video game hero / START handled and finished the frame
    }
  }
  CODE_B48927(db);
}

/**
 * $B48769 — standing on a node: START (and A/B/X/Y) selects it, the D-pad starts walking along
 * an open path. Returns true if a jump target already ran the frame tail.
 */
function CODE_B48769(): boolean {
  if ((r16(R.RAM_064A) & 0xff) !== 0 && r16(R.RAM_07B0) !== 0) return false;
  if ((r16(R.screen_brightness) & 0x000f) !== 0x000f) return false;
  if (r16(0x0683) !== 0) return false;
  if (r16(R.visited_kong_family_members) & 0x0040 && r16(R.player_active_held) === 0x0030) {
    CODE_B4BE63(); // L+R: the video game hero screen
    return false;
  }
  if (r16(R.RAM_07B0) !== 0 || r16(R.world_map_events) & 0x0005 || r16(R.RAM_064A) !== 0) return false;
  if (r16(R.player_active_pressed) & C.input_ABXY_start) {
    CODE_B48A46();
    return false;
  }
  // CODE_B487C2: try the four directions; a path exists if bit set in the node's direction mask
  let x = r16(0x3202 + ((r16(R.map_node_number) << 2) & 0xffff));
  reg.db = 0xb4;
  w16(0x065c, 0x0004);
  const held = r16(R.player_active_held);
  w16(0x065a, ((held >> 8) | (held << 8)) & 0xffff);
  const mask = dbR16(x + 5);
  w8(0x0650, mask >> 8); // "reverse direction" bits of the paths
  let dirs = mask & 0xff;
  for (;;) {
    const has = (dirs & 1) !== 0;
    dirs >>= 1;
    if (has) {
      if (lsrM8(0x065a)) {
        startWalking(x);
        return false;
      }
      x = (x + 4) & 0xffff;
    } else {
      lsrM8(0x065a);
    }
    lsrM8(0x0650);
    if (add8(0x065c, -1) === 0) break;
  }
  reg.x = x;
  return false;
}

/** $B48800 — the D-pad matched a path of the node: start walking it if it is unlocked. */
function startWalking(x: number) {
  const reverse = lsrM16(0x0650);
  w16(0x06a1, reverse ? r16(0x06a1) | 0x0004 : r16(0x06a1) & 0xfffb);
  const pathIdx = rom16(0xb40000 | (x + 0x0d));
  let y = (pathIdx << 2) & 0xffff;
  y = (y + 0x2a00 + ((pathIdx & 0x4000) ? 1 : 0)) & 0xffff;
  reg.db = 0x7e;
  if (r16(y) === 0) {
    reg.x = x;
    return; // path still locked
  }
  // CODE_B4882E
  const seg = r16(y + 2);
  reg.db = 0xb4;
  w16(R.map_node_number, rom16(0xb40000 | (x + 0x0b)));
  w16(0x06af, seg);
  w16(0x06c5, ((rom8(0xb40000 | seg)) + 1) & 0xffff);
  const props = rom16(0xb40000 | (seg + 3));
  let k = r16(R.active_kong_sprite);
  const v = (r16(k + 0x12) & 0xcfff) | props;
  w16(k + 0x12, v);
  w16(0x0790, v);
  k = r16(R.inactive_kong_sprite);
  if (k !== 0) w16(k + 0x12, (r16(k + 0x12) & 0xcfff) | props);
  const f = r16(0x06a1) | 0x0100;
  w16(0x06a1, f);
  if (f & 0x0004) {
    // walking the path backwards: start at its last segment
    w16(0x06af, (((r16(0x06c5) - 1) << 2) + r16(0x06af)) & 0xffff);
  }
  CODE_B4B029();
  walkPath();
}

/** $B48888 — advance the Kong along the current path segment by $06B3 steps. */
function walkPath() {
  reg.db = 0xb4;
  while (r16(0x06a1) & 0x0002) {
    // reached a corner last frame: set up the next segment
    CODE_B4B029();
    reg.db = 0xb4;
  }
  w16(0x0650, r16(0x06b3));
  const dx = r16(0x06c1);
  const dy = r16(0x06c3);
  if (dx === dy) {
    // CODE_B4890B: diagonal
    do {
      w16(0x06b5, (r16(0x06b5) + r16(0x06b9)) & 0xffff);
      w16(0x06b7, (r16(0x06b7) + r16(0x06bb)) & 0xffff);
      CODE_B4AEE3();
    } while (add16(0x0650, -1) !== 0);
  } else if (dx > dy) {
    // CODE_B488A5: mostly horizontal
    do {
      let e = (r16(0x06bd) - r16(0x06bf)) & 0xffff;
      if (e & 0x8000) {
        e = (e + r16(0x06c1)) & 0xffff;
        w16(0x06b7, (r16(0x06b7) + r16(0x06bb)) & 0xffff);
      }
      w16(0x06bd, e);
      w16(0x06b5, (r16(0x06b5) + r16(0x06b9)) & 0xffff);
      CODE_B4AEE3();
    } while (add16(0x0650, -1) !== 0);
  } else {
    // CODE_B488D8: mostly vertical
    do {
      let e = (r16(0x06bd) - r16(0x06bf)) & 0xffff;
      if (e & 0x8000) {
        e = (e + r16(0x06c3)) & 0xffff;
        w16(0x06b5, (r16(0x06b5) + r16(0x06b9)) & 0xffff);
      }
      w16(0x06bd, e);
      w16(0x06b7, (r16(0x06b7) + r16(0x06bb)) & 0xffff);
      CODE_B4AEE3();
    } while (add16(0x0650, -1) !== 0);
  }
}

/** $B48927 — common end of the map frame: camera, OAM copy, fades, level name, timers. */
function CODE_B48927(db: number) {
  CODE_B4AFC3();
  let skipOam =
    r16(0x06af) !== 0 ||
    (r16(R.RAM_064A) & 0xff) !== 0 ||
    r16(R.RAM_07B0) !== 0 ||
    (r16(R.world_map_events) & 0x0005) !== 0 ||
    (r16(0x06a5) & 0x2000) !== 0;
  if (r16(0x06af) === 0 && r16(0x06a3) & 0x0020) return tailFade(db);
  if (!skipOam) {
    // the level name sprites built at $7E3A00 go to the start of the OAM buffer
    const n = ((r8(0x0682) << 2) - 1) & 0xffff;
    for (let i = 0; i <= n; i++) w8(0x0200 + i, r8(0x3a00 + i));
    reg.a = 0xffff;
    reg.x = (0x3a00 + n + 1) & 0xffff;
    reg.y = (0x0200 + n + 1) & 0xffff;
  }
  // CODE_B4896A
  if (r16(0x06a3) & 0x0002) {
    // fading out to a Kong family screen
    if (r16(R.screen_brightness) === 0) {
      w16(R.nmi_pointer, RUN_808D02);
      w16(0x06a3, r16(0x06a3) & 0xfffd);
    }
    return tailFade(db);
  }
  tailAfterFade(db);
}

/** $B48985 — fade, then the rest of the tail. */
function tailFade(db: number) {
  fade_screen_global();
  tailAfterFade(db);
}

/** $B48989 */
function tailAfterFade(db: number) {
  const f = r16(0x06a1);
  if (f & 0x0040 || f & 0x0100) {
    CODE_B4B8C6(); // (continue) drawing the node's name
    w16(0x06a1, r16(0x06a1) & 0xfeff);
  }
  // CODE_B489A2: PLB
  reg.db = db;
  if (add16(0x0697, -1) === 0) {
    w16(0x06a1, r16(0x06a1) | 0x0010);
    w16(0x0697, 0x0004);
  }
  if (!(r16(R.world_map_events) & 0x0005) && r16(0x0683) !== 0) {
    if (add16(0x0683, -1) === 0) {
      if (r16(R.world_number) === 0) w16(R.returning_map_node_number, r16(R.map_node_number));
      reg.a = 0x810f;
      set_fade_global();
    }
  }
  if (r16(R.RAM_07B0) !== 0) {
    if (add16(R.RAM_07B0, -1) === 0) w16(R.world_map_events, r16(R.world_map_events) | LOST_WORLD_OPEN);
  }
  reg.db = db;
}

/** $B48A46 — START/A/B/X/Y on a node: enter the world, kiosk exit, Kong family or level. */
function CODE_B48A46() {
  w8(R.RAM_064B, 0x01);
  const world = r16(R.world_number);
  if (world === 0) {
    // Crocodile Isle: enter the selected world
    w16(0x06a3, r16(0x06a3) | 0x0001);
    reg.a = 0x810f;
    set_fade_global();
    return;
  }
  if (world >= C.world_lost_world_w2) {
    const exits: Record<number, number> = {
      [C.map_node_return_to_w2]: C.map_node_w2_entrance_from_klubba,
      [C.map_node_return_to_w3]: C.map_node_w3_entrance_from_klubba,
      [C.map_node_return_to_w4]: C.map_node_w4_entrance_from_klubba,
      [C.map_node_return_to_w5]: C.map_node_w5_entrance_from_klubba,
      [C.map_node_return_to_w6]: C.map_node_w6_entrance_from_klubba,
    };
    const to = exits[r16(R.map_node_number)];
    if (to !== undefined) {
      // back from the Lost World to the kiosk's world
      w16(R.map_node_number, to);
      w16(R.world_number, r16(R.kiosk_returning_world_number));
      w16(0x06a3, r16(0x06a3) | 0x0020);
      reg.a = 0x810f;
      set_fade_global();
      return;
    }
  }
  // CODE_B48ABB
  reg.db = 0x7e;
  const nx = (r16(R.map_node_number) << 2) & 0xffff;
  const t = ((r16(0x3201 + nx) & 0xff) - 4) & 0xffff;
  if (t < 0x0a) {
    // icon types 4..13: Cranky, Funky, Swanky, Wrinkly, Klubba
    w16(R.npc_screen_type, t);
    reg.a = 0x810f;
    set_fade_global();
    w16(0x06a3, r16(0x06a3) | 0x0002);
    reg.db = 0xb4;
    return;
  }
  // CODE_B48AEF: a level
  const x = r16(0x3202 + nx);
  reg.db = 0xb4;
  w16(R.level_number, rom16(0xb40000 | (x + 9)));
  w16(0x06a3, (r16(0x06a3) | 0x0001) & 0xefff);
  reg.a = 0x810f;
  set_fade_global();
}

/** $B489ED — per-world camera limits and walking speed (also called by map init in bank $B5). */
export function CODE_B489ED() {
  const db = reg.db;
  w16(0x0699, ICON_GFX);
  w16(0x06a1, r16(0x06a1) & 0x022c);
  const x = (r16(R.world_number) << 1) & 0xffff;
  reg.db = 0xb4;
  if (x === 0) w16(R.map_node_number, r16(R.returning_map_node_number));
  // CODE_B48A14
  const y = rom16(0xb40000 | (WORLD_TABLE + x));
  w16(0x06c7, rom16(0xb40000 | y));
  w16(0x06c9, rom16(0xb40000 | (y + 2)));
  w16(0x06cb, rom16(0xb40000 | (y + 4)));
  w16(0x06cd, rom16(0xb40000 | (y + 6)));
  CODE_B4AFC3();
  w16(0x06b3, r16(0x06a3) & 0x1000 ? 0x0005 : 0x0003);
  reg.x = r16(0x06b3);
  reg.y = y;
  reg.db = db;
}

/** $B49C2A — put the Kong on the current node's position. */
export function CODE_B49C2A() {
  const node = r16(R.map_node_number);
  const y = r16(0x3202 + ((node << 2) & 0xffff));
  w16(0x06b5, rom16(0xb40000 | y));
  w16(0x06b7, rom16(0xb40000 | (y + 2)));
  reg.x = (node << 2) & 0xffff;
  reg.y = y;
  reg.a = r16(0x06b7);
}

// ---------------------------------------------------------------------------------------------
// Small helpers

/** $B4AEAF — clear the map/NPC scratch ($06CF-$078F and $064E-$0671). */
export function CODE_B4AEAF() {
  CODE_B4AEC3();
  for (let i = 0; i < 0x12; i++) dbW16(0x064e + i * 2, 0);
  reg.a = 0;
}

/** $B4AEC3 — clear $06CF..$0790 (byte stride of word stores). */
export function CODE_B4AEC3() {
  for (let i = 0; i < 0xc0; i++) dbW16(0x06cf + i, 0);
  reg.a = 0;
}

/** $B4AED3 — clear $06CF..$0732 (the level-return event table / cheat buffer). */
export function CODE_B4AED3() {
  for (let i = 0; i < 0x62; i++) dbW16(0x06cf + i, 0);
  reg.a = 0;
}

/**
 * $B4AEE3 — after each step: has the Kong reached the end of the segment? Then go to the next
 * segment (flag $0002) or, at the end of the path, stop on the node (handles the Krazy Kremland
 * upper/lower transitions).
 */
export function CODE_B4AEE3() {
  const x = r16(0x06af);
  reg.x = x;
  let arrived: boolean;
  if (r16(0x06a1) & 0x0004) {
    arrived = r16(0x06b5) === dbR16(x + 5) && r16(0x06b7) === dbR16(x + 7);
    if (!arrived) return;
    if (add16(0x06c5, -1) !== 0) {
      w16(0x06af, (r16(0x06af) - 4) & 0xffff);
      return nextSegment();
    }
  } else {
    arrived = r16(0x06b5) === dbR16(x + 9) && r16(0x06b7) === dbR16(x + 0x0b);
    if (!arrived) return;
    if (add16(0x06c5, -1) !== 0) {
      w16(0x06af, (r16(0x06af) + 4) & 0xffff);
      return nextSegment();
    }
  }
  // CODE_B4AF40: end of the path
  w16(0x06af, 0);
  w16(0x06ad, 0);
  w16(0x06a1, r16(0x06a1) & 0xfffb);
  const node = r16(R.map_node_number);
  let to = -1;
  let world = 0;
  if (node === C.map_node_w4_lower_to_upper_left) {
    to = C.map_node_w4_upper_to_lower_left;
    world = C.world_krazy_kremland_upper;
  } else if (node === C.map_node_w4_lower_to_upper_right) {
    to = C.map_node_w4_upper_to_lower_right;
    world = C.world_krazy_kremland_upper;
  } else if (node === C.map_node_w4_upper_to_lower_left) {
    to = C.map_node_w4_lower_to_upper_left;
    world = C.world_krazy_kremland_lower;
  } else if (node === C.map_node_w4_upper_to_lower_right) {
    to = C.map_node_w4_lower_to_upper_right;
    world = C.world_krazy_kremland_lower;
  }
  if (to < 0) {
    w16(0x06a3, r16(0x06a3) & 0xffdf);
  } else {
    w16(R.map_node_number, to);
    w16(R.world_number, world);
    w16(0x06a3, r16(0x06a3) | 0x0020);
    reg.a = 0x810f;
    set_fade_global();
  }
  w16(0x0650, 0x0001); // stop stepping this frame
}

function nextSegment() {
  w16(0x06a1, r16(0x06a1) | 0x0002);
  w16(0x0650, 0x0001);
}

/** $B4AFAD — K. Rool's boat intro on the isle: scroll the camera from the top. */
export function CODE_B4AFAD() {
  w16(0x069d, 0);
  w8(R.RAM_064A, 0x01);
  w8(R.RAM_064B, 0);
  w16(R.RAM_064C, 0x0172);
}

/** $B4AFC3 — camera: follow the Kong inside the world's limits (or the intro scroll). */
export function CODE_B4AFC3() {
  if (r8(R.RAM_064A) !== 0) {
    if (r16(R.RAM_064C) !== 0) {
      add16(R.RAM_064C, -1);
      return;
    }
    const v = add16(0x069d, 1);
    if (((v + 0x70) & 0xffff) !== r16(0x06b7)) return;
    w8(R.RAM_064A, 0);
  }
  // CODE_B4AFEC
  let a = r16(0x06b5);
  if (a < r16(0x06c7)) a = r16(0x06c7);
  else if (a >= r16(0x06c9)) a = r16(0x06c9);
  w16(0x069b, (a - 0x80) & 0xffff);
  a = r16(0x06b7);
  if (a < r16(0x06cb)) a = r16(0x06cb);
  else if (a >= r16(0x06cd)) a = r16(0x06cd);
  w16(0x069d, (a - 0x70) & 0xffff);
  reg.a = r16(0x069d);
}

/** $B4B025 */
export function CODE_B4B025() {
  CODE_B4B029();
}

/** $B4B029 — set up stepping along the segment at $06AF: |dx|, |dy|, signs and error term. */
export function CODE_B4B029() {
  const x = r16(0x06af);
  reg.x = x;
  const f = r16(0x06a1) & 0xfffd;
  w16(0x06a1, f);
  const back = (f & 0x0004) !== 0;
  let d = (back ? dbR16(x + 5) - dbR16(x + 9) : dbR16(x + 9) - dbR16(x + 5)) & 0xffff;
  if (d & 0x8000) {
    w16(0x06c1, (-d) & 0xffff);
    w16(0x06b9, 0xffff);
  } else {
    w16(0x06c1, d);
    w16(0x06b9, 0x0001);
  }
  d = (back ? dbR16(x + 7) - dbR16(x + 0x0b) : dbR16(x + 0x0b) - dbR16(x + 7)) & 0xffff;
  if (d & 0x8000) {
    w16(0x06c3, (-d) & 0xffff);
    w16(0x06bb, 0xffff);
  } else {
    w16(0x06c3, d);
    w16(0x06bb, 0x0001);
  }
  const dx = r16(0x06c1);
  const dy = r16(0x06c3);
  if (dx === dy) {
    w16(0x06bd, 0x0001);
    w16(0x06bf, 0);
    reg.a = 0;
  } else if (dx > dy) {
    w16(0x06bd, dx >> 1);
    w16(0x06bf, dy);
    reg.a = dy;
  } else {
    w16(0x06bd, dy >> 1);
    w16(0x06bf, dx);
    reg.a = dx;
  }
}

// ---------------------------------------------------------------------------------------------
// Unlock buffers

/** $B4B0CF — pack the path table ($7E2A00) and node icon table ($7E3200) into the save buffers. */
export function CODE_B4B0CF() {
  w16(0x0652, 0);
  w16(0x0656, 0x006c);
  w16(0x0650, 0x0010);
  w8(0xd0, 0x7e);
  w16(0xce, lo16(MAP_PATH_UNLOCKS));
  let x = 0x2a00;
  let y = 0;
  let c = false;
  // 1 bit per path (ROR A puts the "open" bit in carry, ROR $0652 shifts it in from the top)
  do {
    c = rorM16(0x0652, (r16(x) & 1) !== 0);
    if (add16(0x0650, -1) === 0) {
      w16(0x0650, 0x0010);
      longW16(0xce, r16(0x0652), y);
      y += 2;
    }
    x += 4;
  } while (add16(0x0656, -1) !== 0);
  if (r16(0x0650) & 0x000f) {
    // align the last partial word (the carry chain continues through the rotations)
    do c = rorM16(0x0652, c);
    while (add16(0x0650, -1) !== 0);
    longW16(0xce, r16(0x0652), y);
    y += 2;
  }
  // 2 bits per node icon
  w16(0x0652, 0);
  w16(0x0656, 0x0078);
  w16(0x0650, 0x0008);
  x = 0;
  w16(0xce, lo16(MAP_ICON_UNLOCKS));
  y = 0;
  do {
    const v = r16(0x3200 + x);
    c = rorM16(0x0652, (v & 1) !== 0);
    c = rorM16(0x0652, (v & 2) !== 0);
    if (add16(0x0650, -1) === 0) {
      w16(0x0650, 0x0008);
      longW16(0xce, r16(0x0652), y);
      y += 2;
    }
    x += 4;
  } while (add16(0x0656, -1) !== 0);
  if (r16(0x0650) & 0x0007) {
    do {
      c = rorM16(0x0652, c);
      c = rorM16(0x0652, c);
    } while (add16(0x0650, -1) !== 0);
    longW16(0xce, r16(0x0652), y);
  }
  reg.x = x;
  reg.y = y;
}

/** $B4B18F — unpack A paths from the save buffer into the path table at $7E2A00. */
export function CODE_B4B18F() {
  const count = reg.a & 0xffff;
  w16(0x0650, count);
  w8(0xd0, 0x7e);
  w16(0xce, lo16(MAP_PATH_UNLOCKS));
  w16(0x0652, longR16(0xce, 0));
  w16(0x064e, 0);
  let y = PATH_DATA;
  w16(0x0656, 0);
  w16(0x0658, 0x7eb4);
  let x = 0x2a00;
  let first = true;
  do {
    if (!first && (r16(0x0656) & 0x000f) === 0) {
      w16(0x0656, 0);
      const o = (r16(0x064e) + 2) & 0xffff;
      w16(0x064e, o);
      w16(0x0652, longR16(0xce, o));
    }
    first = false;
    w16(x, lsrM16(0x0652) ? 1 : 0); // path open?
    w16(x + 2, rom16(0xb40000 | y)); // its segment list
    x += 4;
    y += 2;
    add16(0x0656, 1);
  } while (add16(0x0650, -1) !== 0);
  reg.a = r16(0x0658);
  reg.x = x;
  reg.y = y;
}

/** $B4B4D3 — unpack A node icons (2 bits each) into the node table at $7E3200. */
export function CODE_B4B4D3() {
  w16(0x0650, reg.a & 0xffff);
  w8(0xd0, 0x7e);
  w16(0xce, lo16(MAP_ICON_UNLOCKS));
  w16(0x0656, 0);
  w16(0x0652, longR16(0xce, 0));
  w16(0x064e, 0);
  let y = NODE_ICON_DATA;
  w16(0x0658, 0x7eb4);
  let x = 0x3200;
  let first = true;
  do {
    if (!first && (r16(0x0656) & 0x0007) === 0) {
      w16(0x0656, 0);
      const o = (r16(0x064e) + 2) & 0xffff;
      w16(0x064e, o);
      w16(0x0652, longR16(0xce, o));
    }
    first = false;
    // node state: 0 hidden, 1 visible, 2 cleared, 3 cleared (shown as icon 2)
    const st = r16(0x0652) & 3;
    let entry: number;
    if (st === 3) entry = 0x0203;
    else if (st === 2) entry = 0x0002;
    else entry = st | (rom8(0xb40000 | y) << 8);
    y++;
    w16(x, entry);
    lsrM16(0x0652);
    lsrM16(0x0652);
    w16(x + 2, rom16(0xb40000 | y)); // node data pointer
    x += 4;
    y += 2;
    add16(0x0656, 1);
  } while (add16(0x0650, -1) !== 0);
  reg.a = r16(0x0658);
  reg.x = x;
  reg.y = y;
}

/**
 * $B4B208 — back on the map after a level: apply the level's result recorded at $06CF
 * (0/1 = nothing, else the node icon state), open the paths listed at $06D7, and handle the
 * special exits (Krocodile Kore, Lost World levels, warps).
 */
export function CODE_B4B208() {
  const db = reg.db;
  reg.db = 0xb4;
  if (r16(0x06d1) & 0x0008) {
    CODE_B4B3AB();
    reg.db = db;
    return;
  }
  const result = r16(0x06cf);
  if (result !== 0 && result !== 0x0001) {
    // CODE_B4B229
    w16(0xc8, ((r16(R.map_node_number) << 2) + 0x3200) & 0xffff);
    const icon = longR16(0xc8);
    if (icon === 0x0e01 || icon === 0x1001) {
      // CODE_B4B242: Lost World / Kong family style node
      const st = r8(0x06cf);
      if (st !== 0) {
        longW8(0xc8, st);
        if (st >= 2) {
          if (r16(R.level_number) === C.level_krocodile_kore) return krocKoreCleared(db);
          // CODE_B4B29C
          const lv = r16(R.level_number);
          if (lv >= C.ret_from_k_kore_lvl_range_start && lv < C.ret_from_k_kore_lvl_range_end) {
            w8(R.completed_lost_world_levels, r8(R.completed_lost_world_levels) + 1);
          }
          returningNodeState();
        }
      }
    } else if (r16(R.level_number) === C.level_krocodile_kore) {
      return krocKoreCleared(db);
    }
    // CODE_B4B2C3: paths opened by the level
    const y = 0x06d7;
    if (r16(y) === 0) {
      w16(0x0792, 0);
      w16(0x06ad, 0);
      w16(0x06a1, r16(0x06a1) & 0xfffb);
    } else {
      openPaths(y);
    }
  } else {
    w16(0x06a1, r16(0x06a1) & 0xfffb);
  }
  // CODE_B4B36B
  if (r16(0x06d1) & 0x0001) w16(R.world_number, 0);
  if (r16(0x06d1) & 0x0002 || r16(R.world_map_events) & 0x0001) {
    w16(0x06a3, r16(0x06a3) | 0x0040);
    w16(0x06af, 0);
    w16(0x06ad, 0);
  }
  if (r16(0x06d1) & 0x0004) {
    w16(0x06a5, r16(0x06a5) | 0x0010);
    w16(0x0683, 0x00c8);
  }
  reg.db = db;
}

/** $B4B2A9 — the level was exited to Crocodile Isle: mark the returning node too. */
function returningNodeState() {
  if (!(r16(0x06d1) & 0x0001)) return;
  w16(0xc8, ((r16(R.returning_map_node_number) << 2) + 0x3200) & 0xffff);
  longW8(0xc8, r8(0x06cf));
}

/** $B4B258 — Krocodile Kore beaten: open all Lost World kiosk nodes and start the ending. */
function krocKoreCleared(db: number) {
  const y = 0x06cf;
  for (let x = 0; x < 5; x++) {
    w16(0xc8, (((rom8(KROC_KORE_NODES + x)) << 2) + 0x3200) & 0xffff);
    if (longR16(0xc8) === 0x1001) longW16(0xc8, r16(y));
  }
  w16(0x0650, 0);
  CODE_B4B0CF();
  w16(0x067d, CODE_B49126_PTR);
  reg.a = RUN_ENDING_MONKEY_MUSEUM;
  void db;
  set_nmi_and_wait();
}

/** $B4B2D6 — open the paths between the node pairs listed at $06D7 (count, then pairs). */
function openPaths(y: number) {
  const n = r16(y);
  w16(0x0656, n);
  if (n !== 0x0001) CODE_B4B3AB();
  for (;;) {
    // CODE_B4B2E1: from node (level +4) and to node (level +2)
    const toNode = rom8(0xb40000 | (LEVEL_TO_NODE + r16(y + 4)));
    w16(0x0652, toNode);
    reg.a = toNode;
    CODE_B4B3B8();
    const fromNode = rom8(0xb40000 | (LEVEL_TO_NODE + r16(y + 2)));
    w16(0x0650, fromNode);
    reg.a = fromNode;
    CODE_B4B3B8();
    // find the path of the from-node that leads to the to-node
    w16(0xc8, (r16(0xc8) + 2) & 0xffff);
    let x = longR16(0xc8);
    w16(0x0658, 0x0004);
    let mask = dbR16(x + 5);
    let found = -1;
    for (;;) {
      const has = (mask & 1) !== 0;
      mask >>= 1;
      if (has) {
        const to = dbR16(x + 0x0b);
        if (to === r16(0x0652)) {
          found = to;
          break;
        }
        x = (x + 4) & 0xffff;
      }
      if (add16(0x0658, -1) === 0) throw new Error("CODE_B4B2E1: STP (path not found)");
    }
    // CODE_B4B329 (A = the remaining direction bits, bit 7 = reverse)
    w16(0x06a1, mask & (0x0080 >> 0) ? r16(0x06a1) | 0x0004 : r16(0x06a1) & 0xfffb);
    w16(0x06ad, found);
    const path = dbR16(x + 0x0d);
    w16(0x0792, path);
    w16(0xc8, ((path << 2) + 0x2a00) & 0xffff);
    longW16(0xc8, 0x0001);
    y += 4;
    if (add16(0x0656, -1) === 0) break;
  }
}

/** $B4B3AB — skip the walk-in animation on the next map init. */
export function CODE_B4B3AB() {
  w16(0x06a3, r16(0x06a3) | 0x0040);
  w16(0x06af, 0);
  w16(0x06ad, 0);
}

/** $B4B3B8 — make node A visible (icon state 0 -> 1). $C8 = its entry. */
export function CODE_B4B3B8() {
  w16(0xc8, (((reg.a << 2) & 0xffff) + 0x3200) & 0xffff);
  if (longR8(0xc8) === 0) longW8(0xc8, 0x01);
}

/** $B4B3CD — clear both unlock buffers and put the Kongs on Crocodile Isle's first node. */
export function CODE_B4B3CD() {
  w8(0xd0, 0x7e);
  w16(0xce, lo16(MAP_ICON_UNLOCKS));
  w16(0x0650, 0x0010);
  w16(0x0652, 0x0010);
  for (let y = 0; y < 0x20; y += 2) longW16(0xce, 0, y);
  w16(0x0650, 0);
  w16(0xce, lo16(MAP_PATH_UNLOCKS));
  for (let y = 0; y < 0x20; y += 2) longW16(0xce, 0, y);
  w16(0x0652, 0);
  w16(0xce, lo16(MAP_ICON_UNLOCKS));
  longW16(0xce, 0);
  w16(0xce, lo16(MAP_PATH_UNLOCKS));
  longW16(0xce, 0);
  CODE_B4AED3();
  w16(R.world_number, C.world_crocodile_isle);
  w16(R.map_node_number, C.map_node_w1);
  CODE_B4B42D();
  reg.y = 0x20;
}

/** $B4B42D */
export function CODE_B4B42D() {
  w16(0x06af, 0);
  w16(0x0792, 0);
  w16(0x06a3, r16(0x06a3) & 0x1060);
}

/** $B4B43D — cheat: unlock every node and path. */
export function CODE_B4B43D() {
  w8(0xd0, 0x7e);
  w16(0xce, lo16(MAP_ICON_UNLOCKS));
  w16(0x0650, 0x0010);
  w16(0x0652, 0x0010);
  for (let y = 0; y < 0x20; y += 2) longW16(0xce, 0x5555, y);
  w16(0x0650, 0);
  w16(0xce, lo16(MAP_PATH_UNLOCKS));
  for (let y = 0; y < 0x20; y += 2) longW16(0xce, 0xffff, y);
  w16(0x0652, 0);
  cheatExit();
}

/** $B4B48D — cheat: 50 lives and 99 banana coins. */
export function CODE_B4B48D() {
  CODE_B4AED3();
  w16(R.life_count, 0x0032);
  w16(R.banana_coin_count, 0x0063);
  w16(R.game_mode_pointer, CODE_8087D9_PTR);
  CODE_B4B42D();
  input_and_pause_handler_global();
  CODE_B4AEAF();
  reg.a = RUN_SIMPLE_GAME_MODE;
  set_nmi_and_wait();
}

/** $B4B4B3 — cheat: back to Crocodile Isle. */
export function CODE_B4B4B3() {
  w16(R.world_number, 0);
  w16(R.returning_map_node_number, 0);
  w16(R.map_node_number, 0);
  input_and_pause_handler_global();
  CODE_B4B42D();
  CODE_B4AEAF();
  w16(R.game_mode_pointer, CODE_8087D9_PTR);
  reg.a = RUN_SIMPLE_GAME_MODE;
  set_nmi_and_wait();
}

function cheatExit() {
  CODE_B4B42D();
  input_and_pause_handler_global();
  CODE_B4AEAF();
  w16(R.game_mode_pointer, CODE_8087D9_PTR);
  reg.a = RUN_SIMPLE_GAME_MODE;
  set_nmi_and_wait();
}

// ---------------------------------------------------------------------------------------------
// Map sprites

/**
 * Off-screen-left sprites (X in $FFF1-$FFFF): set the X high bit of the sprite being written in
 * the OAM high table (byte index from $C8, see CODE_B4B62D).
 */
function setOamXHigh() {
  CODE_B4B62D();
  const bit = rom16(0xb40000 | (OAM_HIGH_BITS + reg.a));
  const y = reg.y;
  w16(0x0400 + y, bit | r16(0x0654));
}

/** $B4B62D — OAM high table word for the sprite at $C8: $0654 = its value, Y = offset, A = bit pair*2. */
export function CODE_B4B62D() {
  const i = ((r16(0xc8) - 0x0200) & 0xffff) >> 2;
  reg.y = (i >> 2) & 0x00fe;
  w16(0x0654, r16(0x0400 + reg.y));
  reg.a = (i & 7) << 1;
}

/** $B4B64F — draw a node icon: A = icon type, X = node data (position). OAM written down from $C8. */
export function CODE_B4B64F() {
  const db = reg.db;
  const saveY = reg.y;
  reg.db = 0xb4;
  w16(0x064e, reg.a & 0xffff);
  let x = reg.x;
  const sy = (dbR16(x + 2) - r16(0x069d)) & 0xffff;
  if (sy >= 0x00e0 && sy < 0xfff1) return done();
  w16(0x0652, sy);
  const sx = (dbR16(x) - r16(0x069b)) & 0xffff;
  if (sx >= 0x0100 && sx < 0xfff1) return done();
  w16(0x0650, sx);
  if (sx & 0x8000) setOamXHigh();
  // CODE_B4B69F
  longW16(0xc8, (r8(0x0652) << 8) | r8(0x0650));
  w16(0xc8, (r16(0xc8) + 2) & 0xffff);
  w16(0x0650, dbR16(x + 3) & 0x3000); // priority bits of the node
  x = r16(0x064e);
  longW16(0xc8, (dbR16(ICON_TILES + x) & 0xcfff) | r16(0x0650));
  w16(0xc8, (r16(0xc8) - 6) & 0xffff);
  add16(0x06a7, -1);
  // mark the sprite large in the OAM high table
  const hy = r16(0x0685);
  w16(hy, r16(0x0687) | r16(hy));
  nextOamHighBit();
  reg.x = x;
  done();
  function done() {
    reg.y = saveY;
    reg.db = db;
  }
}

/** $B4B6F9 — blinking markers on the open paths leaving the node at X. */
export function CODE_B4B6F9() {
  const saveY = reg.y;
  const db = reg.db;
  reg.db = 0xb4;
  const saveC8 = r16(0xc8);
  w16(0xc8, 0x02ec);
  let x = reg.x;
  const finish = () => {
    w16(0xc8, saveC8);
    reg.db = db;
    reg.y = saveY;
    reg.x = x;
  };
  const sy = (dbR16(x + 2) - r16(0x069d)) & 0xffff;
  if (sy >= 0x00e0 && sy < 0xfff1) return finish();
  w16(0x0656, sy);
  const sx = (dbR16(x) - r16(0x069b)) & 0xffff;
  if (sx >= 0x0100 && sx < 0xfff1) return finish();
  w16(0x0650, sx);
  if (sx & 0x8000) setOamXHigh();
  // CODE_B4B748: up to 4 directions
  w16(0x0652, 0x0004);
  w16(0x064e, dbR16(x + 5));
  for (;;) {
    if (lsrM16(0x064e)) {
      // CODE_B4B76E: a path in this direction; show its marker if it is open
      const y = (dbR16(x + 0x0d) << 2) & 0xffff;
      reg.db = 0x7e;
      if (r16(0x2a00 + y) !== 0) {
        const o = ((r16(0x0652) - 1) << 2) & 0xffff;
        reg.db = 0xb4;
        const px = (rom8(0xb40000 | (MARKER_OFFSETS + o)) + r8(0x0650)) & 0xff;
        w8(0x0654, px);
        const py = (rom8(0xb40000 | (MARKER_OFFSETS + 1 + o)) + r8(0x0656)) & 0xff;
        longW16(0xc8, (py << 8) | px);
        w16(0xc8, (r16(0xc8) + 2) & 0xffff);
        longW16(0xc8, rom16(0xb40000 | (MARKER_OFFSETS + 2 + o)));
        w16(0xc8, (r16(0xc8) - 6) & 0xffff);
        nextOamHighBit();
        add16(0x06a7, -1);
        reg.y = o;
      }
      reg.db = 0xb4;
      x = (x + 4) & 0xffff;
    }
    if (add16(0x0652, -1) === 0) break;
  }
  finish();
}

// ---------------------------------------------------------------------------------------------
// Level name text

/** $B4B8C6 — (continue to) draw the name of the current node. */
export function CODE_B4B8C6() {
  reg.db = 0x7e;
  const y = r16(0x3202 + ((r16(R.map_node_number) << 2) & 0xffff));
  reg.db = 0xb4;
  reg.x = rom16(0xb40000 | (y + 7));
  reg.a = rom16(0xb40000 | (y + 9));
  CODE_B4B8E0();
}

/**
 * $B4B8E0 — draw a level name with the yellow font as sprites: X = text (length-prefixed,
 * English then French), A = level number. Writes the tiles to text_vram_buffer and the OAM
 * entries to $7E3A00, at most 5 letters per frame (all at once on map init); then appends the
 * Kremkoin (!), the DK coin and the "all bonus" marks.
 */
export function CODE_B4B8E0() {
  const db = reg.db;
  reg.db = 0xb4;
  w16(0x066e, reg.a & 0xffff);
  let y: number;
  if (r16(0x06a1) & 0x0040) {
    // resume where the last frame stopped
    w16(0xcb, r16(0x068b));
    w16(0x0650, r16(0x068d));
    w16(0xce, r16(0x068f));
    w16(0x0654, r16(0x0691));
    w16(0x0652, r16(0x0693));
    y = r16(0x0695);
  } else {
    w16(0x06a1, r16(0x06a1) | 0x0040);
    w16(0x0654, 0x002b);
    const wt = rom16(0xb40000 | (WORLD_TABLE + ((r16(R.world_number) << 1) & 0xffff)));
    const ypos = rom16(0xb40000 | (wt + 0x0c));
    let x = reg.x;
    if (r16(R.language_select) !== 0) {
      // skip the English text
      w16(0x066c, rom8(0xb40000 | x));
      x = (x + r16(0x066c) + 2) & 0xffff;
    }
    const len = rom8(0xb40000 | x);
    w8(0x0650, len);
    w8(0x0682, len);
    w8(0x0652, len);
    // Kremkoin collected in all bonus levels?
    let a: number;
    if (r16(R.world_number) === 0) a = r16(R.RAM_07B2 + ((r16(R.map_node_number) << 1) & 0xffff));
    else {
      reg.a = r16(0x066e);
      CODE_BB80B4();
      a = reg.a & 0xffff;
    }
    if (a !== 0 && (a & 0xff) === 0) {
      w8(0x0652, (r8(0x0652) + 1) & 0xff);
      w8(0x0682, (r8(0x0682) + 1) & 0xff);
      w8(0x06a5, r8(0x06a5) | 0x80);
    }
    // DK coin?
    let dk: number;
    if (r16(R.world_number) === 0) dk = CODE_B4BB40();
    else {
      reg.a = r16(0x066e);
      is_level_dk_coin_collected();
      dk = reg.a & 0xffff;
    }
    if (dk !== 0) {
      w8(0x0652, (r8(0x0652) + 3) & 0xff);
      w8(0x0682, (r8(0x0682) + 2) & 0xff);
      w16(0x06a5, r16(0x06a5) | 0x0500);
    }
    // CODE_B4B9B6: center the text: X = (255 - 8 * letters) / 2, Y from the world table
    aslM8(0x0682);
    aslM8(0x0652);
    aslM8(0x0652);
    aslM8(0x0652);
    const cx = ((0xff - r8(0x0652)) & 0xff) >> 1;
    w16(0x0652, ((ypos & 0xff) << 8) | cx);
    w16(0xcb, (x + 2) & 0xffff); // the letters follow the length byte and one more byte
    w16(0xce, 0x3a00);
    y = TEXT_VRAM_BUFFER;
  }
  // CODE_B4B9E0
  let perFrame: number;
  if (r16(0x06a1) & 0x0080) {
    w16(0x06a1, r16(0x06a1) & 0xff7f);
    perFrame = 0x03e7;
  } else perFrame = 0x0005;
  w16(0x0656, perFrame);
  w8(0xd0, 0x7e);
  let ch = longR16(0xcb);
  for (;;) {
    // CODE_B4BA06
    y = drawChar(ch, y);
    // CODE_B4BA7C
    add16(0xcb, 1);
    if (add16(0x0650, -1) === 0) {
      // CODE_B4BAAC: end of the name: the extra marks
      const f = r16(0x06a5);
      if (f & 0x0080) {
        w16(0x06a5, f & 0xff7f);
        add16(0x0650, 1);
        ch = 0x21; // Kremkoin
        continue;
      }
      if (f & 0x0100) {
        w16(0x06a5, f & 0xfeff);
        w16(0x0652, (r16(0x0652) + 8) & 0xffff);
        add16(0x0650, 1);
        ch = 0x22; // DK coin
        continue;
      }
      if (f & 0x0400) {
        w16(0x06a5, f & 0xfbff);
        add16(0x0650, 1);
        ch = 0x40;
        continue;
      }
      // CODE_B4BAF5: request the tile DMA
      add16(0x0681, 1);
      w16(0x06a1, r16(0x06a1) & 0xffbf);
      break;
    }
    if (add16(0x0656, -1) === 0) {
      // CODE_B4BA8B: continue next frame
      w16(0x068b, r16(0xcb));
      w16(0x068d, r16(0x0650));
      w16(0x068f, r16(0xce));
      w16(0x0691, r16(0x0654));
      w16(0x0693, r16(0x0652));
      w16(0x0695, y);
      break;
    }
    ch = longR16(0xcb);
  }
  reg.y = y;
  reg.db = db;
}

/** One letter: copy its 2 tiles (8x16) from bank $FC and add 2 OAM entries. Returns the new Y. */
function drawChar(ch: number, y: number): number {
  let c = ((ch & 0xff) - 0x21) & 0xffff;
  if (c & 0x8000) {
    // space
    w8(0x0682, (r8(0x0682) - 2) & 0xff);
    w16(0x0652, (r16(0x0652) + 8) & 0xffff);
    return y;
  }
  const tile = rom8(0xb40000 | (YELLOW_FONT + c));
  const src = (((tile << 8) >> 2) + 0x0660) & 0xffff;
  // MVN $7E,$FC: 64 bytes
  for (let i = 0; i < 0x40; i++) w8((y + i) & 0xffff, rom8(0xfc0000 | ((src + i) & 0xffff)));
  y = (y + 0x40) & 0xffff;
  reg.x = (src + 0x40) & 0xffff;
  const pos = r16(0x0652);
  longW16(0xce, pos);
  add16(0xce, 2);
  longW16(0xce, 0x3c00 | r16(0x0654));
  add16(0xce, 2);
  add16(0x0654, 1);
  longW16(0xce, (pos + 0x0800) & 0xffff);
  add16(0xce, 2);
  longW16(0xce, 0x3c00 | r16(0x0654));
  add16(0xce, 2);
  add16(0x0654, 1);
  w16(0x0652, (r16(0x0652) + 8) & 0xffff);
  void c;
  return y;
}

/** $B4BB03 — Crocodile Isle: per world, the "all Kremkoins" flags of its levels ($07B2). */
export function CODE_B4BB03() {
  w16(0x0650, 0x0007);
  let y = 0;
  do {
    let x = rom16(0xb40000 | (WORLD0_LEVEL_LISTS + ((7 - r16(0x0650)) << 1)));
    w16(0x0674, 0);
    for (;;) {
      const lv = rom8(0xb40000 | x);
      if (lv === 0) break;
      reg.a = lv;
      CODE_BB80B4();
      w16(0x0674, r16(0x0674) | (reg.a & 0xffff));
      x++;
    }
    w16(R.RAM_07B2 + y, r16(0x0674));
    y += 2;
  } while (add16(0x0650, -1) !== 0);
  reg.y = y;
}

/** $B4BB40 — Crocodile Isle: 1 if all DK coins of the world of the current node are collected. */
export function CODE_B4BB40(): number {
  let x = rom16(0xb40000 | (WORLD0_LEVEL_LISTS + ((r16(R.map_node_number) << 1) & 0xffff)));
  for (;;) {
    const lv = rom8(0xb40000 | x);
    if (lv === 0) {
      reg.a = 1;
      return 1;
    }
    reg.a = lv;
    is_level_dk_coin_collected();
    if ((reg.a & 0xffff) === 0) {
      reg.a = 0;
      return 0;
    }
    x++;
  }
}

/** $B4AE58 — the player passed Cranky's rival: raise the rival's DK coin record. */
export function CODE_B4AE58() {
  const dk = r16(R.dk_coin_count);
  if (dk === 0 || dk - 1 < r16(R.competitor_dk_coin_count)) return;
  const c = r16(R.competitor_dk_coin_count);
  let a: number;
  if (c === rom16(DATA_B4BED7)) a = 0x0063;
  else if (c === rom16(DATA_B4BEDF)) a = rom16(DATA_B4BED7);
  else a = rom16(DATA_B4BEDF);
  w16(R.competitor_dk_coin_count, a);
}

void dbW16;
void lsrM16;
void RET_RTL;

register({
  CODE_B48000,
  CODE_B480B2,
  CODE_B480CD,
  CODE_B48360,
  CODE_B48368,
  CODE_B489ED,
  CODE_B49C2A,
  CODE_B4AEAF,
  CODE_B4AEC3,
  CODE_B4AED3,
  CODE_B4AEE3,
  CODE_B4AFAD,
  CODE_B4AFC3,
  CODE_B4B025,
  CODE_B4B029,
  CODE_B4B0CF,
  CODE_B4B18F,
  CODE_B4B208,
  CODE_B4B3AB,
  CODE_B4B3B8,
  CODE_B4B3CD,
  CODE_B4B42D,
  CODE_B4B43D,
  CODE_B4B48D,
  CODE_B4B4B3,
  CODE_B4B4D3,
  CODE_B4B62D,
  CODE_B4B64F,
  CODE_B4B6F9,
  CODE_B4B8C6,
  CODE_B4B8E0,
  CODE_B4BB03,
  CODE_B4BB40,
  CODE_B4AE58,
});
for (const n of [
  "CODE_B480B2", "CODE_B48360", "CODE_B4AEC3", "CODE_B4AED3", "CODE_B4AEE3", "CODE_B4AFC3",
  "CODE_B4B029", "CODE_B4B0CF", "CODE_B4B18F", "CODE_B4B208", "CODE_B4B3AB", "CODE_B4B3B8",
  "CODE_B4B3CD", "CODE_B4B42D", "CODE_B4B4D3", "CODE_B4B62D", "CODE_B4B64F", "CODE_B4B6F9",
  "CODE_B4B8C6", "CODE_B4B8E0", "CODE_B4BB03", "CODE_B4BB40", "CODE_B4AE58",
]) setRetMode(L(n), RET_RTS);
