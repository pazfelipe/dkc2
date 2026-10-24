/**
 * Bank $BB (part a) — level start: the big level setup routine (CODE_BB9210), level music
 * selection, and the per-theme "graphics init" routines selected by level[0].graphics_init_number.
 *
 * CODE_BB9210 runs with the screen off when a level (or sub-level) is entered: it reloads the
 * level config, uploads graphics/palettes/PPU settings, decompresses the 32x32 tilemap, runs the
 * level's slope and init routines (pointers kept in level[0]), sets up HDMA (dma_init_table) and
 * starts the music.
 */
import { r16, w8, w16, rom8, rom16, io8, io16 } from "../../core/mem";
import { reg, register, callPtr } from "../../core/cpu";
import { L, R, C, level, rel_level, DMA, PPU, CPU } from "../../core/sym";
import {
  calculate_completion_percentage,
  clear_noncritical_wram,
  set_active_kong_global,
  CODE_BBBDA1,
  init_registers_global,
  clear_wram_tables,
  init_sprite_render_order,
  clear_vram_global,
  CODE_BBAF0C,
  CODE_B5BCA8,
  CODE_BB886D,
  vram_payload_handler_global,
  CODE_BBB34D,
  decompress_data,
  CODE_BBB0FB,
  CODE_BBB1E3,
  CODE_B5B9ED,
  CODE_B5F109,
  set_ppu_registers_global,
  dma_palette,
  CODE_B4AC65,
  init_level_water_height,
  dma_to_vram_global,
  dma_level_columns,
  CODE_B5AC9C,
  CODE_B5B0FC,
  CODE_BBB104,
} from "../../gen/routines";
import { jslLabel } from "./bba_util";

const GRAPHICS_INIT_TABLE = L("graphics_init_table");
const DMA_INIT_TABLE = L("dma_init_table");
const LEVEL_SONG_OVERRIDES = L("DATA_BB94C4");
const lbl16 = (name: string) => L(name) & 0xffff;

const isStarsBonus = () =>
  r16(level.type) === C.bonus_level_type && (r16(level.bonus_type) & 0xff) === C.collect_the_stars_bonus_type;

/** JSR (level[0],x): the pointer is read in bank $BB, whose $0000-$1FFF mirrors WRAM. */
function callLevelRoutine(rel: number) {
  reg.x = rel;
  callPtr(0xbb, r16(level._base + rel));
}

/** $BB9210 — set up the level about to be played. */
export function CODE_BB9210() {
  calculate_completion_percentage();
  clear_noncritical_wram();
  w16(R.game_state_flags, r16(R.game_state_flags) & ~0x0144);
  w16(R.game_state_flags_2, r16(R.game_state_flags_2) & ~0x0012);
  reg.a = r16(R.active_kong_number);
  set_active_kong_global();
  w16(0x2f, r16(R.active_frame_counter) ^ r16(0x2f)); // stir the RNG seed
  CODE_BB938B();
  w16(R.water_y_position, 0x8000);
  w16(0x0d54, 0x8000);
  w16(R.life_display_timer, 0x0078);
  w16(R.banana_display_timer, 0x0078);
  w16(R.life_count_display, r16(R.life_count));
  reg.a = 0;
  reg.x = 0x03fe;
  CODE_BB9252();
}

/** $BB9252 — clear the sprite spawn table (X = last word offset, A = 0). */
export function CODE_BB9252() {
  let x = reg.x & 0xffff;
  do {
    w16(R.sprite_spawn_table + x, reg.a);
    x = (x - 2) & 0xffff;
  } while (!(x & 0x8000));
  reg.x = x;
  const flags = r16(R.game_state_flags);
  w16(R.game_state_flags, flags & ~0x0080);
  if (flags & 0x0080) CODE_BBBDA1();
  CODE_BB9265();
}

/** $BB9265 */
export function CODE_BB9265() {
  w16(R.game_state_flags, r16(R.game_state_flags) & ~0xa002);
  w16(0x17c8, 0);
  init_registers_global();
  clear_wram_tables();
  init_sprite_render_order();
  clear_vram_global();
  const entrance = r16(R.level_entrance_number);
  reg.a = (((entrance << 8) | (entrance >> 8)) & 0xffff) | r16(R.level_number);
  CODE_BBAF0C(); // load the level config into level[0]
  // Barrel Kontrol cheat: both Kongs in normal levels
  if (r16(R.cheat_enable_flags) & 0x0001 && r16(level.type) === C.normal_level_type) {
    w16(R.game_state_flags, r16(R.game_state_flags) | 0x4000);
  }
  CODE_BB929D();
}

/** $BB929D — graphics, terrain and tilemap. */
export function CODE_BB929D() {
  reg.a = r16(level.tileset_type);
  CODE_B5BCA8();
  CODE_BB886D();
  reg.x = (r16(level.graphics_init_number) << 1) & 0xffff;
  callPtr(0xbb, rom16(GRAPHICS_INIT_TABLE + reg.x));
  if (isStarsBonus()) {
    reg.a = C.stars_only_vram_payload_id;
    vram_payload_handler_global();
  }
  callLevelRoutine(rel_level.slope_init_routine);
  CODE_BBB34D();
  if (r16(level.effects) & C.no_tilemap_effect) return CODE_BB9310();
  if (r16(0x0b86) & 0x0400) {
    // the 32x32 tilemap is compressed: decompress it to $7F1000 and point $98 there
    reg.x = r16(0x98);
    reg.y = r16(0x9a) & 0x00ff;
    reg.a = 0x1000;
    decompress_data();
    w16(0x98, 0x1000);
    w8(0x9a, 0x7f);
  }
  // .uncompressed_tilemap
  CODE_BB9493();
  CODE_BBB0FB();
  CODE_BBB1E3();
  CODE_BB94A4();
  CODE_BB948D();
  CODE_BB9313();
}

/** $BB9310 — level without a tilemap. */
export function CODE_BB9310() {
  w16(0x0ab4, 0);
  CODE_BB9313();
}

/** $BB9313 — level init routine, sprites, HDMA and music. */
export function CODE_BB9313() {
  callLevelRoutine(rel_level.init_routine);
  CODE_B5B9ED();
  CODE_BB93C0();
  CODE_B5F109();
  if (isStarsBonus()) w16(0x7fd734, 0x9998);
  // .done_handling_stars
  if (r16(R.level_number) === C.level_bramble_blast) w16(0x17b2, lbl16("CODE_B5C60B"));
  CODE_BB934B();
}

/** $BB934B */
export function CODE_BB934B() {
  if (r16(R.level_number) === C.level_kreepy_krow) w16(0x17b2, lbl16("CODE_B5C3F4"));
  CODE_BB9358();
}

/** $BB9358 */
export function CODE_BB9358() {
  reg.x = (r16(level.dma_init_number) << 1) & 0xffff;
  callPtr(0xbb, rom16(DMA_INIT_TABLE + reg.x));
  w16(0x0b00, 0x002c);
  w16(R.next_sprite_dma_buffer_slot, 0);
  CODE_BB93E7();
  // (the original then compares the level type against bonus/sub-level and returns either way)
  reg.a = r16(level.type);
  CODE_BB9379();
}

/** $BB9379 */
export function CODE_BB9379() {}

/** $BB938B — entering the checkpoint level from its start: restore the checkpoint state. */
export function CODE_BB938B() {
  const lvl = r16(R.level_number);
  if (lvl === C.level_animal_antics_rambi_area) {
    // Animal Antics' Rambi area continues from a Squitter area checkpoint
    reg.a = C.level_animal_antics_squitter_area;
    if (r16(R.checkpoint_level_number) === C.level_animal_antics_squitter_area) return CODE_BB93A2();
    return CODE_BB939A();
  }
  CODE_BB939B();
}

/** $BB939A */
export function CODE_BB939A() {}

/** $BB939B */
export function CODE_BB939B() {
  reg.a = r16(R.level_number);
  if (reg.a !== r16(R.checkpoint_level_number)) return CODE_BB939A();
  CODE_BB93A2();
}

/** $BB93A2 */
export function CODE_BB93A2() {
  reg.a = r16(R.level_entrance_number);
  if (reg.a !== 0) return CODE_BB939A();
  w16(R.level_number, r16(R.checkpoint_level_number));
  w16(R.level_entrance_number, r16(R.checkpoint_level_entrance_number));
  w16(R.animal_type, r16(R.checkpoint_animal_type));
  w16(R.current_player_mount, 0);
  reg.a = r16(R.checkpoint_collected_kong_letters);
  w16(R.collected_kong_letters, reg.a);
}

/** $BB93C0 — $19CA = $3F - (lowest of the $7E8F28 table entries, capped at $200). */
export function CODE_BB93C0() {
  w16(0x19ca, 0x0200);
  reg.x = r16(0x0aba);
  CODE_BB93C9();
}

/** $BB93C9 — loop over the table from X down to 2. */
export function CODE_BB93C9() {
  let x = reg.x & 0xffff;
  do {
    const v = r16(0x7e8f28 + x);
    if (v < r16(0x19ca)) w16(0x19ca, v);
    x = (x - 2) & 0xffff;
  } while (x !== 0);
  reg.x = x;
  reg.a = (((r16(0x19ca) ^ 0xffff) + 0x003f + 1) & 0xffff);
  w16(0x19ca, reg.a);
}

/** $BB93E7 — start the level's music. */
export function CODE_BB93E7() {
  if (r16(R.level_number) === C.level_stronghold_showdown && r16(R.world_map_events) & 0x0003) {
    reg.a = C.music_castle;
    jslLabel("play_song");
    return;
  }
  CODE_BB93FE();
}

/** $BB93FE */
export function CODE_BB93FE() {
  reg.a = r16(level.type);
  if (reg.a === C.bonus_level_type && r16(level.bonus_type) === 0) return;
  CODE_BB940C();
}

/** $BB940C — some levels override the theme's song (bonus songs, boss themes...). */
export function CODE_BB940C() {
  reg.x = r16(R.level_number);
  const song = rom8(LEVEL_SONG_OVERRIDES + reg.x);
  if (song === 0) return CODE_BB9424();
  reg.a = song;
  reg.x = r16(level.type);
  if (reg.x !== C.bonus_level_type) return CODE_BB943E();
  reg.a = song | 0x0300;
  CODE_BB9441();
}

/** $BB9424 */
export function CODE_BB9424() {
  const type = r16(level.type);
  reg.a = type;
  if (type === C.bonus_level_type) return CODE_BB9446();
  if (type === C.boss_level_type) return CODE_BB9457();
  if (type === C.small_level_type) return CODE_BB9445();
  reg.a = r16(R.exiting_sub_level_flag);
  if (reg.a & 0x8000) return CODE_BB9473();
  CODE_BB943B();
}

/** $BB943B */
export function CODE_BB943B() {
  reg.a = r16(level.song);
  CODE_BB943E();
}

/** $BB943E */
export function CODE_BB943E() {
  reg.a &= 0x00ff;
  CODE_BB9441();
}

/** $BB9441 */
export function CODE_BB9441() {
  jslLabel("play_song_with_transition");
  CODE_BB9445();
}

/** $BB9445 */
export function CODE_BB9445() {}

/** $BB9446 — bonus level: keep the music unless it has a bonus type. */
export function CODE_BB9446() {
  reg.a = r16(level.bonus_type) & 0x00ff;
  if (reg.a === 0) return;
  CODE_BB944F();
}

/** $BB944F */
export function CODE_BB944F() {
  reg.a = 0x0003;
  jslLabel("transition_song");
}

/** $BB9457 — boss level. */
export function CODE_BB9457() {
  const lvl = r16(R.level_number);
  if (lvl === C.level_krool_duel || lvl === C.level_krocodile_kore) return CODE_BB946B();
  reg.a = C.music_big_boss;
  jslLabel("play_song_with_transition");
}

/** $BB946B */
export function CODE_BB946B() {
  reg.a = C.music_krool;
  jslLabel("play_song_with_transition");
}

/** $BB9473 — back from a sub-level: only restart the song if it changed. */
export function CODE_BB9473() {
  reg.a = r16(level.song) & 0x00ff;
  if (reg.a === r16(R.current_song)) return CODE_BB9445();
  CODE_BB943B();
}

/** $BB948D — run the level's optional routine at $DF. */
export function CODE_BB948D() {
  reg.a = r16(0xdf);
  CODE_BB9497();
}

/** $BB9493 — run the level's optional routine at $DD. */
export function CODE_BB9493() {
  reg.a = r16(0xdd);
  CODE_BB9497();
}

/** $BB9497 — A = routine in bank $BB, or 0 for none. */
export function CODE_BB9497() {
  if (reg.a === 0) return CODE_BB94A3();
  reg.db = 0xbb; // PHK / PLB (not restored)
  w16(0x26, reg.a);
  reg.x = 0;
  callPtr(0xbb, r16(0x26)); // JSR ($0026,x)
}

/** $BB94A3 */
export function CODE_BB94A3() {}

/** $BB94A4 — point the 32x32 tilemap pointer at $7F0000. */
export function CODE_BB94A4() {
  w16(0x98, 0);
  reg.a = (r16(0x9a) & 0xff00) | 0x7f;
  w16(0x9a, reg.a);
}

/** $BB94B6 — upload the level palette (all 128 background colors). */
export function CODE_BB94B6() {
  reg.y = 0;
  reg.a = r16(R.level_palette_address);
  reg.x = 0x0020;
  dma_palette();
}

// ---- graphics init routines (graphics_init_table) ----

/** HUD graphics + the level's VRAM payload. */
function uploadLevelGraphics() {
  reg.a = C.hud_only_vram_payload_id;
  vram_payload_handler_global();
  reg.a = r16(level.vram_payload_number);
  vram_payload_handler_global();
}
function setLevelPpuRegisters() {
  reg.a = r16(level.ppu_config_number);
  set_ppu_registers_global();
}
function palette(name: string, cgram: number, count: number) {
  reg.y = cgram;
  reg.a = lbl16(name);
  reg.x = count;
  dma_palette();
}

/** $BB95F2 — default: graphics, level palette, PPU settings. */
export function graphics_init_11() {
  uploadLevelGraphics();
  CODE_BB94B6();
  setLevelPpuRegisters();
}

/** $BB960B — Topsail Trouble: extra background palette. */
export function graphics_init_07() {
  uploadLevelGraphics();
  CODE_BB94B6();
  palette("topsail_trouble_bg_layer_2_palette", 0x70, 0x0004);
  setLevelPpuRegisters();
}

/** $BB9631 */
export function graphics_init_03() {
  uploadLevelGraphics();
  w16(R.level_palette_address, lbl16("screechs_sprint_level_palette"));
  CODE_BB94B6();
  setLevelPpuRegisters();
}

/** $BB9650 */
export function graphics_init_02() {
  uploadLevelGraphics();
  w16(R.level_palette_address, lbl16("bramble_scramble_level_palette"));
  CODE_BB94B6();
  setLevelPpuRegisters();
}

/** $BB966F — falling leaves layer: its 8x8 tilemap is decompressed and uploaded to VRAM $6000. */
export function graphics_init_01() {
  uploadLevelGraphics();
  CODE_BB94B6();
  palette("falling_leaves_layer_1_palette", 0x10, 0x0004);
  setLevelPpuRegisters();
  const map = L("falling_leaves_8x8_tilemap");
  reg.x = map & 0xffff;
  reg.y = (map >> 16) & 0xff;
  reg.a = 0xf800;
  decompress_data();
  io16(PPU.vram_address, 0x6000);
  reg.x = 0;
  CODE_BB96AA();
}

/** $BB96AA — copy $7FF800.. to VRAM (X = start offset), clearing the priority/palette bit 3-4 of each entry. */
export function CODE_BB96AA() {
  let x = reg.x & 0xffff;
  do {
    reg.a = r16(0x7ff800 + x) & 0xe7ff;
    io16(PPU.vram_write, reg.a);
    x = (x + 2) & 0xffff;
  } while (x !== 0x0800);
  reg.x = x;
}

/** $BB96BC */
export function graphics_init_0F() {
  uploadLevelGraphics();
  CODE_BB94B6();
  setLevelPpuRegisters();
}

/** $BB96D5 */
export function graphics_init_10() {
  uploadLevelGraphics();
  setLevelPpuRegisters();
  palette("web_woods_level_palette", 0, 0x0020);
}

/** $BB96F8 */
export function graphics_init_04() {
  uploadLevelGraphics();
  setLevelPpuRegisters();
  palette("rattle_battle_level_palette", 0, 0x0020);
}

/** $BB971B */
export function graphics_init_05() {
  uploadLevelGraphics();
  setLevelPpuRegisters();
  palette("slime_climb_level_palette", 0, 0x0020);
}

/** $BB973E */
export function graphics_init_0D() {
  uploadLevelGraphics();
  setLevelPpuRegisters();
  palette("lava_lagoon_level_palette", 0, 0x0020);
}

/** $BB9761 */
export function graphics_init_06() {
  uploadLevelGraphics();
  CODE_BB94B6();
  setLevelPpuRegisters();
  palette("haunted_hall_level_palette", 0, 0x0020);
  CODE_BB9798();
}

/** $BB9788 — carnival levels. */
export function graphics_init_00() {
  graphics_init_11();
  palette("carnival_level_palette", 0, 0x0020);
  CODE_BB9798();
}

/** $BB9798 — roller coaster settings ($19AD, $092D); Rickety Race's bonus differs. */
export function CODE_BB9798() {
  let a = 0x03;
  let x = 0x0002;
  reg.y = r16(R.level_number);
  if (reg.y === C.level_rickety_race_bonus_1) {
    a = 0x01;
    x = 0x0001;
  }
  reg.a = (reg.a & 0xff00) | a;
  reg.x = x;
  CODE_BB97AB();
}

/** $BB97AB — A (8-bit) -> $19AD, X -> $092D. */
export function CODE_BB97AB() {
  w8(R.RAM_19AD, reg.a & 0xff);
  w16(0x092d, reg.x);
}

/** $BB97B4 */
export function graphics_init_0C() {
  uploadLevelGraphics();
  CODE_BB94B6();
  setLevelPpuRegisters();
  palette("glimmers_galleon_level_palette", 0, 0x0020);
}

/** $BB97DA */
export function graphics_init_14() {
  uploadLevelGraphics();
  w16(R.level_palette_address, lbl16("mainbrace_mayhem_level_palette"));
  CODE_BB94B6();
  setLevelPpuRegisters();
}

/** $BB97F9 */
export function graphics_init_0E() {
  uploadLevelGraphics();
  CODE_BB94B6();
  palette("falling_leaves_layer_1_palette", 0x70, 0x0004);
  setLevelPpuRegisters();
  w16(0x19be, 0x0300);
  w16(0x19c2, 0);
}

/** $BB9828 — text layer: build the text tilemap and DMA it to VRAM $7400. */
export function graphics_init_0A() {
  graphics_init_11();
  const db = reg.db;
  CODE_B4AC65();
  reg.db = db;
  io16(PPU.vram_address, 0x7400);
  io8(DMA.settings, 0x01);
  io8(DMA.destination, 0x18);
  io16(DMA.source, R.text_vram_buffer & 0xffff);
  io8(DMA.source_bank, (R.text_vram_buffer >> 16) & 0xff);
  io16(DMA.size, 0x0600);
  io8(DMA.unused_1, 0x00);
  io8(CPU.enable_dma, 0x01);
  reg.x = 0x0600;
  reg.a = r16(R.level_number);
  if (reg.a === C.level_rattle_battle_rattly_room) CODE_BB9866();
}

/** $BB9866 */
export function CODE_BB9866() {
  reg.y = 0x0010;
  reg.a = (L("rattle_battle_level_palette") + 0x20) & 0xffff;
  reg.x = 0x0004;
  dma_palette();
}

/** $BB9874 — Red Hot Ride: like 09 plus the smoke layer palette. */
export function graphics_init_08() {
  graphics_init_09();
  palette("red_hot_ride_smoke_layer_3_palette", 0, 0x0004);
}

/** $BB9885 — Castle Crush: floor tilemap. */
export function graphics_init_13() {
  graphics_init_11();
  io16(PPU.vram_address, 0x6700);
  reg.x = 0;
  CODE_BB9891();
}

/** $BB9891 — X = start offset of the crush floor tilemap copy. */
export function CODE_BB9891() {
  const floor = L("DATA_E9A805");
  let x = reg.x & 0xffff;
  do {
    reg.a = rom16(floor + x) | 0x2000;
    io16(PPU.vram_write, reg.a);
    x = (x + 2) & 0xffff;
  } while (x !== 0x0100);
  reg.x = x;
  w16(0xdd, lbl16("CODE_BB98E2"));
  w16(0xdf, lbl16("CODE_BB98E8"));
  init_level_water_height();
}

/** $BB98B4 — toxic water levels. */
export function graphics_init_12() {
  w16(R.level_tilemap_vram_address, 0x6000);
  graphics_init_11();
  palette("water_toxic_layer_3_palette", 0, 0x0004);
  w16(R.water_y_position, 0x2700);
  init_level_water_height();
  w16(0xdd, lbl16("CODE_BB98E2"));
  w16(0xdf, lbl16("CODE_BB98E8"));
}

/** $BB98E2 */
export function CODE_BB98E2() {
  reg.x = 0x0001;
  CODE_BB9A88();
}

/** Save/restore around drawing the extra layers: $98/$9A and the tilemap VRAM address. */
function withSavedTilemap(fn: () => void) {
  const p98 = r16(0x98);
  const p9a = r16(0x9a);
  const vram = r16(R.level_tilemap_vram_address);
  fn();
  w16(R.level_tilemap_vram_address, vram);
  w16(0x9a, p9a);
  w16(0x98, p98);
  reg.a = p98;
}

/**
 * Decompress a tilemap to $7FF800 and write its $7FFB00 part mirrored (X flip) to VRAM, then DMA
 * the same part unmirrored next to it. (The loops are the CODE_BB9926 / CODE_BB9962 labels;
 * they are not separate entry points because the code after them pops CODE_BB98E8's saved values.)
 */
function mirroredTilemap(data: string, vram: number, dmaVram: number) {
  const src = L(data);
  reg.x = src & 0xffff;
  reg.y = (src >> 16) & 0xff;
  reg.a = 0xf800;
  decompress_data();
  io16(PPU.vram_address, vram);
  let y = 0x02fe;
  do {
    const x = y ^ 0x003e;
    reg.x = x;
    reg.a = r16(0x7ffb00 + x) ^ 0x8000;
    io16(PPU.vram_write, reg.a);
    y = (y - 2) & 0xffff;
  } while (!(y & 0x8000));
  io16(PPU.vram_address, dmaVram);
  reg.a = 0xfb00;
  reg.x = 0x007f;
  reg.y = 0x0300;
  dma_to_vram_global();
}

/** $BB98E8 — draw the two extra background tilemaps (toxic water / crush levels). */
export function CODE_BB98E8() {
  withSavedTilemap(() => {
    w16(R.screen_scroll_y_position, 0x0100);
    w16(R.level_tilemap_vram_address, 0x7800);
    CODE_BB9A23();
    w16(R.screen_scroll_y_position, 0x0100);
    w16(R.level_tilemap_vram_address, 0x7000);
    CODE_BB9A23();
    mirroredTilemap("DATA_C2FAC9", 0x7000, 0x7180);
    mirroredTilemap("DATA_C6FC11", 0x7400, 0x7580);
  });
}

/** $BB9993 */
export function graphics_init_0B() {
  graphics_init_11();
  w16(0xdd, lbl16("CODE_BB99A5"));
  w16(0xdf, lbl16("CODE_BB99AB"));
}

/** $BB99A5 */
export function CODE_BB99A5() {
  reg.x = 0x0001;
  CODE_BB9A88();
}

/** $BB99AB */
export function CODE_BB99AB() {
  withSavedTilemap(() => {
    w16(R.screen_scroll_y_position, 0x0100);
    w16(R.level_tilemap_vram_address, 0x7000);
    CODE_BB9A23();
    w16(R.screen_scroll_y_position, 0);
    w16(R.level_tilemap_vram_address, 0x7800);
    CODE_BB9A23();
  });
}

/** $BB99DB */
export function graphics_init_09() {
  graphics_init_11();
  w16(0xdd, lbl16("CODE_BB99ED"));
  w16(0xdf, lbl16("CODE_BB99F3"));
}

/** $BB99ED */
export function CODE_BB99ED() {
  reg.x = 0x0004;
  CODE_BB9A88();
}

/** $BB99F3 */
export function CODE_BB99F3() {
  withSavedTilemap(() => {
    w16(R.screen_scroll_y_position, 0x0100);
    w16(R.level_tilemap_vram_address, 0x6c00);
    CODE_BB9A23();
    w16(R.screen_scroll_y_position, 0);
    w16(R.level_tilemap_vram_address, 0x6400);
    CODE_BB9A23();
  });
}

/** $BB9A23 — draw a whole 512-pixel-wide tilemap from the decompressed map at $7FF800, column by column. */
export function CODE_BB9A23() {
  w16(0x98, 0xf800);
  w16(0x9a, 0x007f);
  w16(0x17c8, 0);
  w8(0x9b, 0x80);
  w16(0x17d2, 0);
  w16(0x17d6, 0);
  w16(R.screen_scroll_x_sub_position_low, 0);
  w16(R.screen_scroll_x_position, 0);
  w16(0x17ca, 0x00f8);
  w16(0x17c2, 0);
  w16(0x17ce, 0);
  w16(0x17d6, 0x0008);
  reg.a = 0x0040;
  CODE_BB9A59();
}

/** $BB9A59 — A = columns left. */
export function CODE_BB9A59() {
  let n = reg.a & 0xffff;
  do {
    CODE_BB9A73();
    dma_level_columns();
    w16(0x17d6, 0x0008);
    w16(R.screen_scroll_x_position, (0x0008 + r16(R.screen_scroll_x_position)) & 0xffff);
    n = (n - 1) & 0xffff;
  } while (n !== 0);
  reg.a = 0;
}

/** $BB9A73 — build the next tile column (two layouts depending on the level's map type). */
export function CODE_BB9A73() {
  reg.a = r16(0x0ab4) & 0x000f;
  if (reg.a === 0x0005) return CODE_BB9A83();
  CODE_B5AC9C();
}

/** $BB9A83 */
export function CODE_BB9A83() {
  CODE_B5B0FC();
}

/** $BB9A88 — X = layer: CODE_BBB104 with the map at $7FF800. */
export function CODE_BB9A88() {
  reg.a = reg.x;
  reg.x = 0xf800;
  reg.y = 0x007f;
  CODE_BBB104();
}

register({
  CODE_BB9210,
  CODE_BB9252,
  CODE_BB9265,
  CODE_BB929D,
  CODE_BB9310,
  CODE_BB9313,
  CODE_BB934B,
  CODE_BB9358,
  CODE_BB9379,
  CODE_BB938B,
  CODE_BB939A,
  CODE_BB939B,
  CODE_BB93A2,
  CODE_BB93C0,
  CODE_BB93C9,
  CODE_BB93E7,
  CODE_BB93FE,
  CODE_BB940C,
  CODE_BB9424,
  CODE_BB943B,
  CODE_BB943E,
  CODE_BB9441,
  CODE_BB9445,
  CODE_BB9446,
  CODE_BB944F,
  CODE_BB9457,
  CODE_BB946B,
  CODE_BB9473,
  CODE_BB948D,
  CODE_BB9493,
  CODE_BB9497,
  CODE_BB94A3,
  CODE_BB94A4,
  CODE_BB94B6,
  graphics_init_11,
  graphics_init_07,
  graphics_init_03,
  graphics_init_02,
  graphics_init_01,
  CODE_BB96AA,
  graphics_init_0F,
  graphics_init_10,
  graphics_init_04,
  graphics_init_05,
  graphics_init_0D,
  graphics_init_06,
  graphics_init_00,
  CODE_BB9798,
  CODE_BB97AB,
  graphics_init_0C,
  graphics_init_14,
  graphics_init_0E,
  graphics_init_0A,
  CODE_BB9866,
  graphics_init_08,
  graphics_init_13,
  CODE_BB9891,
  graphics_init_12,
  CODE_BB98E2,
  CODE_BB98E8,
  graphics_init_0B,
  CODE_BB99A5,
  CODE_BB99AB,
  graphics_init_09,
  CODE_BB99ED,
  CODE_BB99F3,
  CODE_BB9A23,
  CODE_BB9A59,
  CODE_BB9A73,
  CODE_BB9A83,
  CODE_BB9A88,
});
