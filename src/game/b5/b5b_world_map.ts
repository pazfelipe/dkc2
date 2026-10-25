/**
 * Bank $B5 (part B) — world maps: initialisation (`init_world_map` and the per-world init
 * table), the per-frame NMI routines of the world maps and of the Crocodile Isle overview map
 * (including the K. Rool "falling" ending cutscene), the map player spawn, and the first half of
 * the Crocodile Isle animation (boats, birds, waves, K. Rool climbing: CODE_B5DA3D/CODE_B5DCBB;
 * the second half is CODE_B5DD45 in b5c_isle.ts).
 *
 * The init routines and the NMI routines reset the stack (`LDX #stack : TXS`) and end in a WAI
 * loop: in TS they call `endFrame()` and return all the way up (see b80a_frame.ts).
 */
import { r16, w16, rom8, rom16, io8, io16, ioR8, ioR16, bus16, asr16 } from "../../core/mem";
import { reg, register, callPtr } from "../../core/cpu";
import { endFrame, frameEnded, setRetMode, RET_RTS } from "../../core/hybrid";
import { waitUntil } from "../../core/ops";
import { L, R, C, CPU, PPU, DMA, HDMA, joypad, sprite } from "../../core/sym";
import {
  disable_screen,
  clear_wram_tables,
  init_registers_global,
  clear_noncritical_wram,
  init_sprite_render_order_global,
  CODE_B480CD,
  CODE_B49C2A,
  CODE_B4B025,
  CODE_B489ED,
  CODE_B48368,
  CODE_B49BDC,
  CODE_BBC85B,
  CODE_BAC7C0,
  CODE_B59F40,
  CODE_B5DF4F,
  CODE_B5DE9D,
  CODE_B5DD45,
  CODE_8087E1,
  set_fade_global,
  prepare_oam_dma_channel_global,
  set_nmi_and_wait,
  dma_queued_sprite_graphics,
  input_and_pause_handler_global,
  sprite_handler,
  sort_sprite_render_orders,
  fade_screen_global,
  process_looping_sounds_global,
  process_sprite_animation,
  spawn_no_gfx_special_sprite_index,
  dma_palette,
  queue_sound_effect,
} from "../../gen/routines";
import { CODE_B5E0A1 } from "./b5c_isle";

const SPRITE_SIZE = 0x5e;
const lo16 = (a: number) => a & 0xffff;

const WORLD_MAP_INIT_TABLE = L("world_map_init_table");
const WORLD_ENTRANCE_NODES = L("world_entrance_node_ids");
const RUN_SIMPLE_WORLD_MAP = lo16(L("run_simple_world_map"));
const RUN_CROCODILE_ISLE = lo16(L("run_crocodile_isle"));
const RUN_KROOL_FALL = lo16(L("run_crocodile_isle_krool_fall"));
const RUN_MONKEY_MUSEUM = lo16(L("run_ending_monkey_museum"));
const RUN_SIMPLE_GAME_MODE = lo16(L("run_simple_game_mode"));
const GAME_MODE_8087D9 = lo16(L("CODE_8087D9"));
const CODE_B48DFA_PTR = lo16(L("CODE_B48DFA"));
const WATER_HDMA_TABLE = L("crocodile_isle_water_hdma_table");
const LOST_WORLD_BEAM_TILES = L("DATA_B5D31C");
const LOST_WORLD_HEAD_TILES = L("DATA_B5D32C");
const SINE = L("DATA_B5D9DE");
const ISLE_PALETTE = L("crocodile_isle_map_palette");
const KROOL_PAL_PTR = L("map_krool_sprite_pal_ptr");
const KROOL_SPLASH_PAL_PTR = L("map_krool_splash_sprite_pal_ptr");

// =============================================================================================
// Initialisation
// =============================================================================================

/** $B5CDFD — A = world number: reset the machine state and run the world's init routine. */
export function init_world_map() {
  w16(R.world_number, reg.a);
  disable_screen();
  clear_wram_tables();
  init_registers_global();
  clear_noncritical_wram();
  reg.db = 0xb5;
  const x = (r16(R.world_number) << 1) & 0xffff;
  reg.x = x;
  callPtr(0xb5, rom16(WORLD_MAP_INIT_TABLE + x));
}

/**
 * The world init table entries: `JSR setup` (which is `JSR CODE_B5E0A1` + 6 parameter bytes:
 * VRAM payload, PPU config, palette, NMI/game sub modes) then the common init.
 */
function worldInit(data: string) {
  const addr = L(data);
  return () => CODE_B5E0A1(addr);
}
/** $B5CE40 */ export const CODE_B5CE40 = worldInit("DATA_B5CE43");
/** $B5CE4F */ export const CODE_B5CE4F = worldInit("DATA_B5CE52");
/** $B5CE5E */ export const CODE_B5CE5E = worldInit("DATA_B5CE61");
/** $B5CE6D */ export const CODE_B5CE6D = worldInit("DATA_B5CE70");
/** $B5CE7C */ export const CODE_B5CE7C = worldInit("DATA_B5CE7F");
/** $B5CE8B */ export const CODE_B5CE8B = worldInit("DATA_B5CE8E");
/** $B5CE9A */ export const CODE_B5CE9A = worldInit("DATA_B5CE9D");
/** $B5CEA9 */ export const CODE_B5CEA9 = worldInit("DATA_B5CEAC");
/** $B5CEB8 */ export const CODE_B5CEB8 = worldInit("DATA_B5CEBB");
/** $B5CEC7 */ export const CODE_B5CEC7 = worldInit("DATA_B5CECA");
/** $B5CED6 */ export const CODE_B5CED6 = worldInit("DATA_B5CED9");

/** $B5CE3A — world 0: Crocodile Isle. */
export function CODE_B5CE3A() { CODE_B5CE40(); crocodile_isle_init(); }
/** $B5CE49 — Gangplank Galleon. */
export function CODE_B5CE49() { CODE_B5CE4F(); generic_world_map_init(); }
/** $B5CE58 — Crocodile Cauldron. */
export function CODE_B5CE58() { CODE_B5CE5E(); generic_world_map_init(); }
/** $B5CE67 — Krem Quay. */
export function CODE_B5CE67() { CODE_B5CE6D(); generic_world_map_init(); }
/** $B5CE76 — Krazy Kremland (lower). */
export function CODE_B5CE76() { CODE_B5CE7C(); generic_world_map_init(); }
/** $B5CE85 — Gloomy Gulch. */
export function CODE_B5CE85() { CODE_B5CE8B(); generic_world_map_init(); }
/** $B5CE94 — K. Rool's Keep. */
export function CODE_B5CE94() { CODE_B5CE9A(); generic_world_map_init(); }
/** $B5CEA3 — The Flying Krock. */
export function CODE_B5CEA3() { CODE_B5CEA9(); generic_world_map_init(); }
/** $B5CEB2 — Lost World (unused entry). */
export function CODE_B5CEB2() { CODE_B5CEB8(); generic_world_map_init(); }
/** $B5CEC1 — Krazy Kremland (upper). */
export function CODE_B5CEC1() { CODE_B5CEC7(); generic_world_map_init(); }
/** $B5CED0 — Lost World (from worlds 2-6). */
export function CODE_B5CED0() { CODE_B5CED6(); generic_world_map_init(); }

/** $B5CEEB */
export function CODE_B5CEEB() {
  init_sprite_render_order_global();
}

/** Common end of the map inits: OAM priority, fast ROM, fade in, then wait for NMI. */
function finishMapInit(run: number) {
  ioR8(CPU.irq_flag);
  io8(PPU.oam_address_high, 0x80);
  io8(CPU.rom_speed, 0x01);
  reg.a = 0x0100;
  set_fade_global();
  prepare_oam_dma_channel_global();
  w16(0x06a3, r16(0x06a3) & 0xff9f);
  let x = run;
  if (r16(0x06a3) & 0x8000) x = RUN_MONKEY_MUSEUM; // the ending: monkey museum
  reg.x = x;
  reg.a = x;
  set_and_wait_for_nmi_B5();
}

/** $B5CEF0 — world maps 1-9: spawn the Kongs on their node and start the map. */
export function generic_world_map_init() {
  // CLC : XCE : SEI : REP #$30 : DP = 0 : stack reset
  CODE_B5CEEB();
  spawn_map_player();
  CODE_B480CD();
  if (!(r16(0x06a3) & 0x0020)) {
    // not arriving at the Lost World kiosk / Kremland transition node
    CODE_B49C2A();
    if (!(r16(0x06a3) & 0x0040)) CODE_B5D23F();
  }
  const x = r16(R.active_kong_sprite);
  w16(x + 0x12, r16(0x0790));
  finishMapInit(RUN_SIMPLE_WORLD_MAP);
}

/** $B5CF63 — Crocodile Isle map (or the K. Rool fall cutscene). */
export function crocodile_isle_init() {
  CODE_B5CEEB();
  CODE_B480CD();
  CODE_B49C2A();
  CODE_B5D580();
  if (r16(0x06a5) & 0x0040) {
    // CODE_B5CFD3: the K. Rool fall ending (16-bit A here: the stores also hit the next register)
    ioR16(CPU.irq_flag);
    io16(PPU.oam_address_high, 0x0080);
    io16(CPU.rom_speed, 0x0001);
    w16(R.screen_brightness, 0x000f);
    prepare_oam_dma_channel_global();
    w16(R.active_frame_counter, 0);
    reg.a = RUN_KROOL_FALL;
    set_and_wait_for_nmi_B5();
    return;
  }
  if (r16(0x06ad) !== 0 && !(r16(0x06a3) & 0x0040)) CODE_B5D23F();
  finishMapInit(RUN_CROCODILE_ISLE);
}

/** $B5CFF6 — A = NMI routine: install it, enable NMI + auto-joypad and wait (ends the frame). */
export function set_and_wait_for_nmi_B5() {
  w16(R.nmi_pointer, reg.a);
  ioR8(CPU.nmi_flag);
  waitUntil(() => (ioR8(CPU.nmi_flag) & 0x80) === 0);
  io8(CPU.enable_interrupts, 0x81);
  io8(joypad.port_0, 0);
  reg.a = (reg.a & 0xff00) | 0x81;
  endFrame(); // WAI
}

// =============================================================================================
// Crocodile Isle map, per frame
// =============================================================================================

/** Water wave HDMA scroll tables at $7E8051..: every line group follows the camera y. */
function crocIsleScrollTables() {
  const sy = r16(R.screen_scroll_y_position);
  w16(0x7e8051, sy);
  w16(0x7e8056, sy);
  let x = 0;
  for (let n = 6; n > 0; n--) {
    w16(0x7e805b + x, sy);
    w16(0x7e8060 + x, sy - 1);
    x += 0x0a;
  }
  for (let n = 8; n > 0; n--) {
    w16(0x7e805b + x, sy);
    w16(0x7e8060 + x, sy);
    w16(0x7e8065 + x, sy - 1);
    w16(0x7e806a + x, sy - 1);
    x += 0x14;
  }
}

/** $B5D13B — NMI routine of the Crocodile Isle map. */
export function run_crocodile_isle_hop() {
  reg.db = 0xb5;
  // LDX #stack : TXS
  io16(PPU.oam_address, 0);
  io16(CPU.enable_dma, 0x1e01); // OAM DMA + HDMA channels 1-4
  dma_queued_sprite_graphics();
  crocIsleScrollTables();
  CODE_B5DF4F();
  CODE_B48368();
  if (r16(0x06a3) & 0x0001) return crocIsleExit();
  crocIsleFrame();
}

/** CODE_B5D1A4: leaving a world for the Crocodile Isle map once the screen has faded out. */
function crocIsleExit() {
  if (r16(R.screen_brightness) === 0) return CODE_B5D2CA();
  crocIsleFrame();
}

/** CODE_B5D1AC.. — the rest of a Crocodile Isle map frame. */
function crocIsleFrame() {
  const dark = () => r16(R.screen_brightness) === 0;
  if (dark() && r16(0x06a5) & 0x0010) return CODE_B5D44A();
  if (r16(0x06a3) & 0x8000 && dark()) w16(R.nmi_pointer, RUN_MONKEY_MUSEUM);
  if (r16(0x06a5) & 0x2000 && dark()) {
    w16(0x06a5, r16(0x06a5) & 0xdfff);
    w16(R.game_mode_pointer, GAME_MODE_8087D9);
    reg.a = RUN_SIMPLE_GAME_MODE;
    set_nmi_and_wait();
    return;
  }
  input_and_pause_handler_global();
  if (frameEnded) return;
  w16(R.active_frame_counter, r16(R.active_frame_counter) + 1);
  const node = r16(R.map_node_number);
  const fromKlubba =
    node === C.map_node_w2_entrance_from_klubba ||
    node === C.map_node_w3_entrance_from_klubba ||
    node === C.map_node_w4_entrance_from_klubba ||
    node === C.map_node_w5_entrance_from_klubba ||
    node === C.map_node_w6_entrance_from_klubba;
  if (fromKlubba || r16(0x06a3) & 0x0020) {
    sprite_handler();
  } else {
    CODE_B5CDDE();
    CODE_B5DA3D();
  }
  sort_sprite_render_orders();
  CODE_B5D48E();
  fade_screen_global();
  prepare_oam_dma_channel_global();
  endFrame(); // WAI
}

/** $B5CDDE — animate the Kongs (they are not run by the sprite handler on this map). */
export function CODE_B5CDDE() {
  let x = r16(R.active_kong_sprite);
  reg.x = x;
  if (x === 0) return;
  CODE_B5CDEF();
  x = r16(R.inactive_kong_sprite);
  reg.x = x;
  if (x === 0) return;
  CODE_B5CDEF();
}

/** $B5CDEF — X = sprite: process its animation. */
export function CODE_B5CDEF() {
  w16(R.current_sprite, reg.x);
  process_sprite_animation();
}

/**
 * $B5D23F — place the Kongs on their map node: the node's path data gives the node reached
 * ($06AD or the path's destination) and the facing/flags of the active Kong.
 */
export function CODE_B5D23F() {
  reg.db = 0x7e;
  const nodeOff = (r16(R.map_node_number) << 2) & 0xffff;
  const x = r16(0x7e3202 + nodeOff);
  reg.db = 0xb4;
  const b4 = (a: number) => bus16(0xb40000 | (a & 0xffff));
  let a = r16(0x06ad) !== 0 ? r16(0x0792) : b4(x + 0x0d);
  // ASL A : ASL A : ADC #$2A00 (the carry from the second ASL is added)
  const y = (((a << 2) & 0xffff) + 0x2a00 + ((a >> 14) & 1)) & 0xffff;
  reg.db = 0x7e;
  const path = r16(0x7e0000 | ((y + 2) & 0xffff));
  reg.db = 0xb4;
  let node = r16(0x06ad);
  if (node === 0) node = b4(x + 0x0b);
  w16(R.map_node_number, node);
  w16(0x06af, path);
  w16(0x06c5, ((b4(path) & 0x00ff) + 1) & 0xffff);
  const kong = r16(R.active_kong_sprite);
  a = (0xcfff & r16(kong + 0x12)) | b4(path + 3);
  w16(kong + 0x12, a);
  w16(0x0790, a);
  const flags = r16(0x06a1) | 0x0100;
  w16(0x06a1, flags);
  reg.a = flags;
  if (flags & 0x0004) {
    reg.a = ((((r16(0x06c5) - 1) << 2) & 0xffff) + r16(0x06af)) & 0xffff;
    w16(0x06af, reg.a);
  }
  reg.x = path;
  reg.y = kong;
  CODE_B4B025();
  reg.db = 0xb4;
}

/** $B5D2CA — enter the world selected on the Crocodile Isle map (or go to a world's map). */
export function CODE_B5D2CA() {
  const db = reg.db;
  const f = r16(0x06a3) & 0xfffe;
  w16(0x06a3, f);
  if (f & 0x0020) {
    CODE_B49C2A();
    CODE_B5D23F();
  } else {
    const node = r16(R.map_node_number);
    w16(0x06a9, node);
    w16(R.world_number, node + 1);
    const x = (r16(R.world_number) << 1) & 0xffff;
    reg.db = 0xb4;
    w16(R.map_node_number, rom16(WORLD_ENTRANCE_NODES + x));
    CODE_B49C2A();
    w16(R.world_number, r16(0x06a9) + 1);
  }
  CODE_B489ED();
  reg.a = r16(R.world_number);
  reg.db = db;
  init_world_map();
}

// =============================================================================================
// World maps 1-9, per frame
// =============================================================================================

/** DMA channel 1: `size` bytes from bank $FA to the current VRAM address. */
function dmaFromFA(source: number, size: number) {
  io16(DMA.source + 0x10, source);
  io16(DMA.unused_2 + 0x10, source);
  io16(DMA.size + 0x10, size);
  io16(DMA.settings + 0x10, 0x1801);
  io8(DMA.source_bank + 0x10, 0xfa);
  io8(CPU.enable_dma, 0x02);
}

/** $B5D334 — NMI routine of the world maps. */
export function run_simple_world_map_hop() {
  reg.db = 0xb5;
  // LDX #stack : TXS
  io16(PPU.oam_address, 0);
  let dmaHdma = 0x0001;
  if (r16(R.world_number) >= C.world_lost_world_w2) {
    // CODE_B5D349: animate the Lost World beam, and the crocodile head when it opens
    io16(PPU.vram_address, 0x6390);
    const frame = r16(R.active_frame_counter);
    if ((frame & 0x0007) === 0) dmaFromFA(rom16(LOST_WORLD_BEAM_TILES + ((frame >> 2) & 0x000e)), 0x0380);
    if (r16(R.world_map_events) & 0x0004 && (r16(R.active_frame_counter) & 0x0007) === 0) {
      w16(0x7e8016, 0x0013);
      const step = r16(R.world_map_event_step_counter);
      if (step === 0x0008) {
        w16(R.world_map_events, r16(R.world_map_events) & ~0x0004);
      } else {
        w16(R.world_map_event_step_counter, step + 2);
        io16(PPU.vram_address, 0x6010);
        dmaFromFA(rom16(LOST_WORLD_HEAD_TILES + step), 0x0700);
      }
    }
    dmaHdma = 0x0401;
  }
  io16(CPU.enable_dma, dmaHdma);
  dma_queued_sprite_graphics();
  CODE_B48368();
  const f = r16(0x06a3);
  if (f & 0x0020) return crocIsleExit();
  if (f & 0x0001 && r16(R.screen_brightness) === 0) return CODE_B5D47A();
  if (r16(R.screen_brightness) === 0 && r16(0x06a5) & 0x0010) return CODE_B5D44A();
  if (r16(0x06a3) & 0x8000 && r16(R.screen_brightness) === 0) w16(R.nmi_pointer, RUN_MONKEY_MUSEUM);
  io8(PPU.screen, r16(R.screen_brightness) & 0xff);
  input_and_pause_handler_global();
  if (frameEnded) return;
  w16(R.active_frame_counter, r16(R.active_frame_counter) + 1);
  sprite_handler();
  sort_sprite_render_orders();
  CODE_B5D48E();
  fade_screen_global();
  prepare_oam_dma_channel_global();
  endFrame(); // WAI
}

/** $B5D44A — leave the map for a game mode (Klubba's kiosk / Kremland transition). */
function CODE_B5D44A() {
  CODE_B49BDC();
  CODE_BBC85B();
  w16(0x06a5, (r16(0x06a5) & 0xffef) | 0x4000);
  w16(0x06a3, r16(0x06a3) | 0x0040);
  w16(0x06af, 0);
  w16(R.game_mode_pointer, GAME_MODE_8087D9);
  reg.a = RUN_SIMPLE_GAME_MODE;
  set_nmi_and_wait();
}

/** $B5D47A — enter the selected level. */
export function CODE_B5D47A() {
  w16(R.parent_level_number, r16(R.level_number));
  w16(0x06a3, r16(0x06a3) & 0xfffe);
  CODE_8087E1();
}

/** $B5D48E — upload the sprite graphics the map sprites need this frame. */
export function CODE_B5D48E() {
  const db = reg.db;
  w16(0x70, 0x0300);
  w16(0x56, 0x0404);
  w16(R.sprite_dma_buffer_limit, 0x0054);
  CODE_B59F40();
  w16(R.next_sprite_dma_buffer_slot, 0);
  reg.db = db;
}

// =============================================================================================
// Crocodile Isle: K. Rool fall cutscene
// =============================================================================================

/** $B5D4A7 — NMI routine of the K. Rool fall cutscene: the camera follows K. Rool down. */
export function run_crocodile_isle_krool_fall_hop() {
  // LDX #stack : TXS
  reg.db = 0xb5;
  io16(PPU.oam_address, 0);
  io16(CPU.enable_dma, 0x1e01);
  dma_queued_sprite_graphics();
  crocIsleScrollTables();
  CODE_B5DF4F();
  io8(PPU.screen, r16(R.screen_brightness) & 0xff);
  w16(R.active_frame_counter, r16(R.active_frame_counter) + 1);
  CODE_BAC7C0();
  CODE_B5DA3D();
  // target = K. Rool's y - $40, clamped to 0..$106; the camera eases towards it
  let t = (r16(0x1364 + sprite.y_position) - 0x40) & 0xffff;
  if (t & 0x8000) t = 0;
  if (t >= 0x0106) t = 0x0106;
  let a = asr16(asr16(asr16((t - r16(R.screen_scroll_y_position)) & 0xffff)));
  a = asr16(asr16(asr16((a - r16(0xd2)) & 0xffff)));
  a = (a + r16(0xd2)) & 0xffff;
  w16(0xd2, a);
  w16(R.screen_scroll_y_position, a + r16(R.screen_scroll_y_position));
  sort_sprite_render_orders();
  process_looping_sounds_global();
  CODE_B5D48E();
  fade_screen_global();
  prepare_oam_dma_channel_global();
  if (r16(R.screen_brightness) === 0) {
    w16(0x067d, CODE_B48DFA_PTR);
    reg.a = RUN_MONKEY_MUSEUM;
    set_nmi_and_wait();
    return;
  }
  endFrame(); // WAI
}

/** Sets sprite fields given as [offset, value] pairs (absolute WRAM addresses). */
function poke(list: [number, number][]) {
  for (const [a, v] of list) w16(a, v);
}

/**
 * $B5D580 — set up the Crocodile Isle map sprites by hand (boats, birds, waves, the island,
 * K. Rool), depending on the progress of the ending (world_map_events bits), then the map player
 * and the water HDMA.
 */
export function CODE_B5D580() {
  poke([
    [0x0d84, 0x0004], [0x0de2, 0x0004],
    [0x0d8a, 0x002c], [0x0de8, 0x002c],
    [0x0d86, 0x0101], [0x0de4, 0x0101],
    [0x0d8e, 0x0180], [0x0dec, 0x01a0],
    [0x0d9e, 0x0c68], [0x0dfc, 0x0c88],
    [0x0d96, 0x4280], [0x0df4, 0x02a0],
    [0x0e40, 0x0004], [0x0e9e, 0x0004],
    [0x0e46, 0x000c], [0x0ea4, 0x000c],
    [0x0e42, 0x0101], [0x0ea0, 0x0101],
    [0x0e4a, 0x0180], [0x0ea8, 0x0160],
    [0x0e5a, 0x0c68], [0x0eb8, 0x0c88],
    [0x0e52, 0x8280], [0x0eb0, 0xc2a0],
    [0x0efc, 0x0004], [0x0f02, 0x00d0], [0x0f06, 0x01c8], [0x0efe, 0x0100], [0x0f0e, 0x62e0],
  ]);
  // a row of 8 sprites (birds/waves) from slot offset $1D6
  let y = 0;
  for (let x = 0x01d6; x !== 0x02f0; x += SPRITE_SIZE) {
    w16(0x0d84 + x, 0x0004);
    w16(0x0d8a + x, 0x00c0);
    w16(0x0d8e + x, 0x0180);
    w16(0x0d86 + x, 0x0100);
    w16(0x0d96 + x, (y < 3 ? y : y + 0x0c) + 0x32c0); // CMP #3 : BCC : ADC #$0B (C=1)
    w16(0x0d9e + x, 0x0bb8);
    w16(0x0e9e + x, 0x0004);
    w16(0x0ea4 + x, 0x0080);
    w16(0x0ea8 + x, 0x0040);
    w16(0x0ea0 + x, 0x0101);
    w16(0x0eb0 + x, ((y << 1) + 0x26c4) & 0xffff);
    y += 2;
  }
  w16(0x0fca, r16(0x0fca) ^ 0x4000);
  poke([
    [0x118e, 0x0004], [0x1194, 0x0089], [0x1190, 0x0100], [0x1198, 0x0038], [0x11a0, 0x20e0], [0x11a8, 0x0c38],
    [0x11ec, 0x0004], [0x11f2, 0x0095], [0x11ee, 0x0101], [0x11f6, 0x009d], [0x11fe, 0x30d2], [0x1206, 0x0b98],
    [0x124a, 0x0004], [0x1250, 0x007c], [0x124c, 0x0101], [0x1254, 0x009c], [0x125c, 0x30d2], [0x1264, 0x0b98],
    [0x12a8, 0x0004], [0x12ae, 0x00c8], [0x12aa, 0x0101], [0x12b2, 0x018c], [0x12ba, 0x30d2], [0x12c2, 0x0b98],
    [0x1306, 0x0004], [0x130c, 0x00a8], [0x1308, 0x0101], [0x1310, 0x0190], [0x1318, 0x30d2], [0x1320, 0x0b98],
    [0x1364, 0x0004], [0x136a, 0x0010], [0x1366, 0x0110], [0x136e, 0x01a0], [0x1376, 0x3822], [0x137e, 0x0f50],
  ]);
  const events = r16(R.world_map_events);
  if (events & 0x0002) {
    // CODE_B5D76E: the island and K. Rool's boat of the ending
    poke([
      [0x13c2, 0x0004], [0x13c8, 0x0160], [0x13c4, 0x0110], [0x13cc, 0x000c], [0x13d4, 0x2489], [0x13dc, 0x3128],
      [0x1406, 0x0000],
      [0x1420, 0x0004], [0x1426, 0x009a], [0x1422, 0x010e], [0x142a, 0x003f], [0x1432, 0x24a9], [0x143a, 0x0000],
    ]);
    const ev = r16(R.world_map_events);
    if (ev & 0x0010) {
      // CODE_B5D7C4: K. Rool sinking with the island
      poke([
        [0x147e, 0x0004], [0x14dc, 0x0004], [0x153a, 0x0004], [0x1598, 0x0004], [0x1364, 0x0004],
        [0x1484, 0x0240], [0x1488, 0x01cc],
        [0x153c, 0x0100], [0x1480, 0x0100], [0x14de, 0x0100],
        [0x1490, 0x72e0],
        [0x14f6, 0x0ca8], [0x1498, 0x0ca8], [0x1554, 0x0ca8],
        [0x149e, 0xfe00], [0x14e2, 0xfec0], [0x14e6, 0x01d0],
        [0x14ee, 0x32e0], [0x154c, 0x32e0],
        [0x14fc, 0x0200], [0x1540, 0xfe40], [0x1544, 0x01b0], [0x155a, 0x0280], [0x155e, 0x0020],
        [0x15a2, 0x01d0], [0x159a, 0x0110], [0x15aa, 0x3f00], [0x15b2, 0x0000], [0x159e, 0x008a],
        [0x0efc, 0x0000], [0x1388, 0x0000],
        [0x1384, 0xffe0], [0x136e, 0x0020], [0x1366, 0x010f], [0x1376, 0x38e6], [0x137e, 0x315c], [0x136a, 0x008f],
      ]);
      kroolPalette(0x00c0, KROOL_PAL_PTR);
      kroolPalette(0x00f0, KROOL_SPLASH_PAL_PTR);
      w16(R.screen_scroll_y_position, 0);
      w16(0xd2, 0);
      islandFlags();
    } else if (ev & 0x0001) {
      // CODE_B5D8AE: K. Rool climbing the island
      poke([[0x136e, 0x0050], [0x1366, 0x010f], [0x1376, 0x28e6], [0x137e, 0x315c], [0x1364, 0x0004], [0x136a, 0x008f]]);
      kroolPalette(0x00c0, KROOL_PAL_PTR);
    } else {
      islandFlags();
    }
  }
  // CODE_B5D8FB
  if (!(r16(0x06a5) & 0x0040)) spawn_map_player();
  // CODE_B5D907: copy the water HDMA tables to $7E8012 and start HDMA channels 1-4
  for (let x = 0; x < 0x012a; x += 2) w16(0x7e8012 + x, rom16(WATER_HDMA_TABLE + x));
  hdmaChannel(1, 0x2c01, 0x8012);
  hdmaChannel(2, 0x2103, 0x801c);
  hdmaChannel(3, 0x0f03, 0x804e);
  hdmaChannel(4, 0x1102, 0x8135);
}

/** CODE_B5D8E9 */
function islandFlags() {
  w16(0x1406, 0x0001);
  w16(0x13cc, 0x002d);
  w16(0x143a, 0x3140);
}

function kroolPalette(cgram: number, ptr: number) {
  reg.x = 0x0004;
  reg.y = cgram;
  reg.a = (rom16(ptr) - 2) & 0xffff;
  dma_palette();
}

function hdmaChannel(n: number, settings: number, source: number) {
  const o = n * 0x10;
  io16(HDMA.settings + o, settings);
  io16(HDMA.source + o, source);
  io8(HDMA.source_bank + o, 0x7e);
  io8(HDMA.indirect_source_bank + o, 0x00);
}

/** $B5D96E — spawn the Kongs (or Funky's plane) on the map. */
export function spawn_map_player() {
  if (r16(0x06a3) & 0x1000) {
    // in Funky's plane
    reg.y = C.special_sprite_spawn_id_011A;
    spawn_no_gfx_special_sprite_index();
    const x = r16(R.alternate_sprite);
    w16(R.active_kong_sprite, x);
    w16(R.inactive_kong_sprite, 0);
    reg.x = x;
    return;
  }
  const spawn = (id: number) => {
    reg.y = id;
    spawn_no_gfx_special_sprite_index();
    const x = r16(R.alternate_sprite);
    w16(0x0790, r16(x + 0x12));
    reg.x = x;
    return x;
  };
  const DIXIE = C.special_sprite_spawn_id_0144;
  const DIDDY = C.special_sprite_spawn_id_0146;
  const [follower, leader] = r16(R.active_kong_number) !== 0 ? [DIDDY, DIXIE] : [DIXIE, DIDDY];
  w16(R.inactive_kong_sprite, spawn(follower));
  const x = spawn(leader);
  w16(x + 2, r16(x + 2) + 2); // render order: in front of the other Kong
  w16(R.active_kong_sprite, x);
  if (!(r16(R.game_state_flags) & 0x4000)) {
    // only one Kong: hide the other
    const y = r16(R.inactive_kong_sprite);
    w16(y + 0x1c, 0xc000);
    reg.y = y;
  }
}

// =============================================================================================
// Crocodile Isle animation
// =============================================================================================

/** $B5DA1E — signed sine: A = angle (0..$FF, 6-bit quarter table) -> -$FF..$FF. X = index. */
export function CODE_B5DA1E() {
  let a = reg.a & 0xffff;
  const negative = (a & 0x0080) !== 0;
  if (a & 0x0040) a ^= 0x003f;
  const x = a & 0x003f;
  reg.x = x;
  a = rom8(SINE + x);
  if (negative) a = -a & 0xffff;
  reg.a = a;
}

function sine(a: number): number {
  reg.a = a & 0xffff;
  CODE_B5DA1E();
  return reg.a;
}

/** Arithmetic shift right n times (`CMP #$8000 : ROR A`). */
function asr(a: number, n: number): number {
  for (let i = 0; i < n; i++) a = asr16(a);
  return a;
}

/** Replace the `mask` bits of the word at `addr` with those of `v`. */
function setBits(addr: number, v: number, mask: number) {
  const m = r16(addr);
  w16(addr, ((v ^ m) & mask) ^ m);
}

/** $B5DA3D — per frame animation of the Crocodile Isle map sprites. */
export function CODE_B5DA3D() {
  if (r16(R.world_map_events) & 0x0002) CODE_B5DCBB();
  const frame = () => r16(R.active_frame_counter);
  // the flags on the island: 8 frames of waving
  const flag = ((frame() & 0x001c) + 0x0b98) & 0xffff;
  for (const a of [0x1206, 0x1264, 0x1260, 0x12c2, 0x1320, 0x131c]) w16(a, flag);
  // the boats (slots from $0F5A): bobbing and drifting
  w16(0x34, 0x000a);
  for (let y = 0x0f5a; y !== 0x1074; y += SPRITE_SIZE) {
    let t: number;
    if (y === 0x0f5a) t = frame();
    else if (y === 0x0fb8) t = ((frame() >> 2) - frame() + 0x20) & 0xffff;
    else t = ((frame() >> 3) + frame()) & 0xffff;
    w16(0x54, t);
    const g = ((r16(0x54) & 0x007c) + 0x0bb8) & 0xffff;
    w16(y + 0x1a, g);
    setBits(y + 0x12, ((g - 0x0bd8) & 0xffff) < 0x40 ? 0x2000 : 0x3000, 0x3000);
    // (the original also computes a $4000 bit from the graphic here but never stores it)
    let a = asr(sine((r16(0x54) << 1) & 0xffff), 2);
    w16(0x32, (a + 0x0068) & 0xffff);
    w16(y + 0x06, ((((r16(0x34) & 0x0006) << 2) + r16(0x32)) & 0xffff));
    a = (((r16(0x54) >> 2) + frame() + 0x20) << 1) & 0xffff;
    a = asr(sine(a), 3);
    w16(0x32, a);
    // EOR #$FFFF : CLC : ADC #$0080 : ADC $32 (carry chained)
    const u = (((((r16(0x34) - 0x0a) << 4) & 0xffff) ^ 0xffff) + 0x0080);
    w16(y + 0x0a, ((u & 0xffff) + (u > 0xffff ? 1 : 0) + r16(0x32)) & 0xffff);
    w16(0x34, r16(0x34) + 2);
  }
  // CODE_B5DB43: the bird circling
  if (frame() & 0x0001) {
    let a = (r16(0x11a8) - 4) & 0xffff;
    if ((a - 0x0c38) & 0x8000) a = 0x0c64;
    w16(0x11a8, a);
  }
  // the waves (slots from $1074)
  w16(0x36, 0x0010);
  for (let y = 0x1074; y !== 0x118e; y += SPRITE_SIZE) {
    w16(0x32, r16(0x36));
    const p = (((r16(0x36) << 3) & 0xffff) + r16(0x32) + frame()) & 0xffff;
    w16(0x32, p);
    w16(y + 0x1a, ((((p << 1) & 0x001c) + 0x0ce8) & 0xffff));
    w16(0x34, (asr(sine((p << 1) & 0xffff), 4) + 0x0080) & 0xffff);
    w16(y + 0x06, ((((r16(0x36) - 0x10) << 4) & 0xffff) + r16(0x34)) & 0xffff);
    const xb = (p + 0x3c) & 0xffff;
    setBits(y + 0x12, ((xb >> 8) | (xb << 8)) & 0xffff, 0x4000);
    const phase = r16(0x32) & 0x003c;
    if (phase <= 0x0008) w16(y + 0x1a, ((phase === 0x0008 ? 0 : phase) + 0x3120) & 0xffff);
    w16(y + 0x0a, (asr(sine((r16(0x32) - 0x40) & 0xffff), 5) + 0x0140) & 0xffff);
    w16(0x36, r16(0x36) + 2);
  }
  // CODE_B5DC0B: the clouds: animate every 8 frames, drift left
  for (let x = 0; x !== 0x0178; x += SPRITE_SIZE) {
    if ((frame() & 0x0007) === 0) {
      let g = (r16(0x0d9e + x) + 4) & 0xffff;
      if (g === 0x0ca8) {
        w16(0x0d8e + x, x < 4 ? 0x0190 : 0x0184);
        g = 0x0c68;
      }
      if (x >= 0x00bb) w16(0x0d9a + x, g);
      w16(0x0d9e + x, g);
    }
    // speed = (x - $130) * 4 / 256, subtracted from the 16.16 x position at $0D8C/$0D8E
    const d = (r16(0x0d8e + x) - 0x0130) & 0xffff;
    const sw = ((d >> 8) | (d << 8)) & 0xffff;
    const hi = (sw >> 14) & 1; // carry out of the second ASL
    const frac = (sw << 2) & 0xffff;
    w16(0x34, hi);
    w16(0x32, frac);
    const lo = r16(0x0d8c + x) - frac;
    w16(0x0d8c + x, lo & 0xffff);
    w16(0x0d8e + x, (r16(0x0d8e + x) - hi - (lo < 0 ? 1 : 0)) & 0xffff);
  }
  // CODE_B5DC69: the sea shimmer: darken 7 palette colours by a triangle wave
  const tri = (v: number) => {
    v &= 7;
    return v & 4 ? v ^ 7 : v;
  };
  let s = tri((((frame() >> 1) + frame()) & 0xffff) >> 3);
  w16(0x32, s);
  s = tri(frame() >> 3) + r16(0x32);
  if (s === 6) s = 5;
  w16(0x32, s);
  for (let x = 0, y = 0; x !== 0x000e; x += 2, y += 4) {
    w16(0x7e8029 + y, (rom16(ISLE_PALETTE + 0x62 + x) - r16(0x32)) & 0xffff);
  }
}

/** $B5DCBB — the ending: K. Rool climbing the island, then the island sinking (with sounds). */
export function CODE_B5DCBB() {
  const events = r16(R.world_map_events);
  if ((events & 0x0003) === 0x0003 && r16(0x13c2 + 0x44) !== 0) {
    const x = 0x1364;
    let a = r16(R.active_frame_counter) & 0x001c;
    if (a & 0x0010) a ^= 0x001c;
    w16(x + sprite.current_graphic, a + C.isle_krool_climb_frame1);
    if (!(r16(R.active_frame_counter) & 0x0001)) {
      const yPos = (r16(x + sprite.y_position) - 1) & 0xffff;
      w16(x + sprite.y_position, yPos);
      if (yPos === 0) w16(R.world_map_events, r16(R.world_map_events) & ~0x0001);
    }
  }
  if (!(r16(R.world_map_events) & 0x0010)) {
    CODE_B5DE9D();
    return;
  }
  CODE_B5DCFF();
}

/** $B5DCFF — the island sinking: Lockjaw-bite sounds at fixed frames, then CODE_B5DD45. */
export function CODE_B5DCFF() {
  for (const t of [0x00f0, 0x0100, 0x0125, 0x0130, 0x0160]) {
    if (r16(R.active_frame_counter) === t) {
      reg.a = (7 << 8) | C.sound_klampon_lockjaw_bite;
      queue_sound_effect();
    }
  }
  CODE_B5DD45();
}

register({
  init_world_map,
  CODE_B5CE3A, CODE_B5CE40, CODE_B5CE49, CODE_B5CE4F, CODE_B5CE58, CODE_B5CE5E, CODE_B5CE67,
  CODE_B5CE6D, CODE_B5CE76, CODE_B5CE7C, CODE_B5CE85, CODE_B5CE8B, CODE_B5CE94, CODE_B5CE9A,
  CODE_B5CEA3, CODE_B5CEA9, CODE_B5CEB2, CODE_B5CEB8, CODE_B5CEC1, CODE_B5CEC7, CODE_B5CED0,
  CODE_B5CED6,
  CODE_B5CEEB,
  generic_world_map_init,
  crocodile_isle_init,
  set_and_wait_for_nmi_B5,
  run_crocodile_isle_hop,
  CODE_B5CDDE,
  CODE_B5CDEF,
  CODE_B5D23F,
  CODE_B5D2CA,
  run_simple_world_map_hop,
  CODE_B5D47A,
  CODE_B5D48E,
  run_crocodile_isle_krool_fall_hop,
  CODE_B5D580,
  spawn_map_player,
  CODE_B5DA1E,
  CODE_B5DA3D,
  CODE_B5DCBB,
  CODE_B5DCFF,
});
for (const n of [
  "CODE_B5CE40", "CODE_B5CE4F", "CODE_B5CE5E", "CODE_B5CE6D", "CODE_B5CE7C", "CODE_B5CE8B",
  "CODE_B5CE9A", "CODE_B5CEA9", "CODE_B5CEB8", "CODE_B5CEC7", "CODE_B5CED6", "CODE_B5CEEB",
  "CODE_B5CDDE", "CODE_B5CDEF", "CODE_B5D23F", "CODE_B5D48E", "CODE_B5D580", "spawn_map_player",
  "CODE_B5DA1E", "CODE_B5DA3D", "CODE_B5DCBB", "CODE_B5DCFF",
]) setRetMode(L(n), RET_RTS);
