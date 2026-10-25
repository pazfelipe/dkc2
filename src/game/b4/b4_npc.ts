/**
 * Bank $B4 — the Kong family screens (Cranky's Monkey Museum, Funky's Flights, Swanky's Bonus
 * Bonanza, Wrinkly's Kong Kollege) and Klubba's Kiosk.
 *
 * Each screen is a chain of NMI routines in bank $80 (run_808D02 init, run_808CF5 fade in,
 * run_npc_intro_dialogue, run_808D30 options text, run_npc_dialogue_selection menu,
 * run_808D3D/run_808D4E option actions through $079C, run_808D70/run_808D5F answers,
 * run_npc_exit), each calling one routine here. State: $06A1 flags (bit 0 window done,
 * $0200 text shown, $0400 options text pending, $0800 cursor moving, $1000 window closing),
 * $064E frame timer, $0654 cursor position, $0658 dialogue pages left, $065C dialogue table.
 *
 * The random dialogue picks (CODE_B4C175) rotate the carry flag into the seed, so reg.c is
 * kept like the original on the paths leading to them.
 */
import { r8, r16, w8, w16, io8, io16, ioR16, rom8, rom16, bus8, bus16 } from "../../core/mem";
import { reg, register, callPtr } from "../../core/cpu";
import { frameEnded, setRetMode, RET_RTS } from "../../core/hybrid";
import { L, R, C, CPU, PPU, HDMA } from "../../core/sym";
import {
  dma_queued_sprite_graphics,
  dma_queued_sprite_palette_global,
  init_sprite_render_order_global,
  disable_screen,
  clear_vram_global,
  CODE_BAC7C0,
  play_song,
  vram_payload_handler_global,
  set_ppu_registers_global,
  dma_palette,
  dma_sprite_palette_from_index,
  clear_wram_tables,
  init_npc_screen_kongs,
  spawn_BB83EF_special_sprite_address,
  spawn_special_sprite_address,
  spawn_special_sprite_index,
  spawn_big_special_sprite_index,
  set_fade_global,
  fade_screen_global,
  wait_for_next_nmi,
  set_nmi_and_wait,
  sprite_handler,
  sort_sprite_render_orders,
  queue_sound_effect,
  update_save_buffer,
  init_file_select,
} from "../../gen/routines";
import { add16, add8, dmaToVram, dmaOamBuffer, dbR16, longW16 } from "./b4_util";
import { CODE_B4AED3 } from "./b4_map";
import {
  CODE_B4ADDF,
  CODE_B4ADE5,
  CODE_B4ADEB,
  CODE_B4ADF6,
  CODE_B4BB62,
  CODE_B4BD57,
  CODE_B4BD8D,
  CODE_B4BD95,
  CODE_B4A0FD,
  CODE_B4A11F,
  CODE_B4BDE7,
  CODE_B4BE0B,
  CODE_B4BDD6,
  reset_camera_and_bg_scroll,
  CODE_B4AE85,
  CODE_B4C175,
} from "./b4_text";

const lo16 = (a: number) => a & 0xffff;
const B4 = (a: number) => 0xb40000 | (a & 0xffff);
/** Reads through DB = $F7 / $BA (after CODE_B4ADDF / CODE_B4ADE5). */
const f7 = (a: number) => bus16(0xf70000 | (a & 0xffff));
const ba = (a: number) => bus16(0xba0000 | (a & 0xffff));

const NPC_CRANKY = 0x0000;
const NPC_FUNKY = 0x0002;
const NPC_SWANKY = 0x0004;
const NPC_WRINKLY = 0x0006;
const NPC_KLUBBA = 0x0008;

const INIT_DATA = lo16(L("npc_screen_init_data"));
const MUSIC_IDS = lo16(L("npc_screen_music_ids"));
const HUD_COIN_SCRIPTS = lo16(L("DATA_B4CD47"));
const TEXT_VRAM_BUFFER = lo16(R.text_vram_buffer);
const TEXT_VRAM_BUFFER_2 = lo16(R.text_vram_buffer_2);
const ICON_GFX = lo16(L("world_map_icon_graphics"));
const ICON_GFX_BANK = L("world_map_icon_graphics") >> 16;
const WATER_DROP_GFX = lo16(L("water_drop_graphics"));
const ptr = (name: string) => lo16(L(name));

const SND_MENU_MOVE = 0x0600 | C.sound_menu_move;
const SND_MENU_SELECT = 0x0600 | C.sound_menu_select;
const SND_WRONG = 0x0600 | C.sound_wrong_answer;

const npc = () => r16(R.npc_screen_type);
const lang = () => r16(R.language_select) !== 0;
const world = () => r16(R.world_number);
const flags = () => r16(0x06a1);
const setFlags = (v: number) => w16(0x06a1, v & 0xffff);
/** npc_screen_init_data entry of the current screen. */
const initData = () => rom16(B4(INIT_DATA + npc()));

function sound(id: number) {
  reg.a = id;
  queue_sound_effect();
}
function fadeOut() {
  reg.a = 0x810f;
  set_fade_global();
}

// ---------------------------------------------------------------------------------------------
// Screen init

/** $B48B15 — enter a Kong family screen (run_808D02): load it, spawn everyone, start the fade in. */
export function CODE_B48B15() {
  w16(0x0d2c, TEXT_VRAM_BUFFER);
  io8(CPU.enable_interrupts, 0);
  init_sprite_render_order_global();
  w16(0x06a3, r16(0x06a3) & 0xefff);
  CODE_B48C9D();
  w8(0x067c, 0xb4);
  if (r16(R.file_select_action) & 0x0001) return CODE_B48C07();
  // CODE_B48B46: greeting
  w16(0x065c, rom16(B4((lang() ? L("DATA_B4C853") : L("DATA_B4C53D")) + npc())));
  w16(0x0658, 0x0004);
  CODE_B49266();
  // number of greeting pages
  let pages: number;
  if (npc() !== NPC_CRANKY) pages = 0x0001;
  else pages = world() >= C.world_lost_world_w2 ? 0x0004 : 0x0005;
  w16(0x0658, pages);
  get_player_coin_count_npc();
  reg.x = 0x07a5;
  CODE_B4BD57();
  reg.x = npc();
  CODE_B48D69();
  reg.x = npc();
  CODE_B48D8E();
  CODE_B48DB5();
  if (npc() === NPC_FUNKY) {
    // Funky's plane
    reg.y = ptr("DATA_FF12F4");
    spawn_BB83EF_special_sprite_address();
    const x = r16(R.alternate_sprite);
    w16(0x0798, x);
    w16(x + 0x20, 0xffe5);
    w16(x + 0x24, 0xffe0);
    w16(x + 0x1c, 0xc000);
    w16(0x079a, 0xff7f);
    w16(x + 0x06, 0xff7f);
    w16(x + 0x0a, 0x000a);
    w16(x + 0x26, 0x0050);
    w16(x + 0x2a, 0xffe0);
    w16(0x0794, 0x001e);
    w16(0x0796, 0x0032);
  }
  if (npc() === NPC_KLUBBA) {
    reg.y = ptr("DATA_FF286A");
    spawn_BB83EF_special_sprite_address();
  }
  spawn_npc_hud_coin();
  w16(R.nmi_pointer, ptr("run_808CF5"));
  reg.a = 0x0100;
  set_fade_global();
  w16(0x0676, 0x0005);
  wait_for_next_nmi();
}

/** $B48C07 — back from saving at Wrinkly's: straight to her menu. */
function CODE_B48C07() {
  get_player_coin_count_npc();
  reg.x = 0x07a5;
  CODE_B4BD57();
  reg.x = npc();
  CODE_B48D69();
  CODE_B48DB5();
  reg.x = r16(R.active_kong_sprite);
  CODE_B48C6B();
  reg.x = r16(R.inactive_kong_sprite);
  CODE_B48C6B();
  reg.x = npc();
  CODE_B48D8E();
  spawn_npc_hud_coin();
  w16(0x0654, 0x0001);
  setFlags(flags() | 0x0400);
  w16(0x0654, 0x0001);
  CODE_B4974F();
  setFlags(flags() | 0x0400);
  CODE_B49B47();
  w16(0x065c, 0);
  w16(0x079c, ptr("CODE_B4A2A4"));
  w16(R.nmi_pointer, ptr("run_808D4E"));
  reg.a = 0x0100;
  set_fade_global();
  wait_for_next_nmi();
}

/** $B48C6B — the Kong at X is already at its walk target. */
export function CODE_B48C6B() {
  const x = reg.x;
  w16(x + 0x06, r16(x + 0x44));
  w16(x + 0x42, 0);
  w16(x + 0x20, 0);
  w16(x + 0x26, 0);
}

/** $B48C76 — spawn the coin (banana coin, or Kremkoin at Klubba's) next to the counter. */
export function spawn_npc_hud_coin() {
  reg.y = rom16(B4(HUD_COIN_SCRIPTS + npc()));
  spawn_special_sprite_address();
  const x = r16(R.alternate_sprite);
  reg.x = x;
  w16(x + 0x06, 0x0014);
  w16(x + 0x0a, 0x0023);
  if (npc() !== NPC_KLUBBA) return;
  w16(x + 0x0a, (r16(x + 0x0a) + 0x000a) & 0xffff);
}

/** $B48C9D — load the screen: graphics, palettes, music, Kongs, HDMA text window. */
export function CODE_B48C9D() {
  reg.db = 0xb4;
  w16(0xc9, 0x7e00);
  setFlags(flags() & 0xddff);
  disable_screen();
  clear_vram_global();
  CODE_BAC7C0();
  dmaOamBuffer();
  CODE_B4BDD6();
  reset_camera_and_bg_scroll();
  reg.a = rom16(B4(MUSIC_IDS + npc()));
  play_song();
  const x = initData();
  w16(0x0662, rom16(B4(x + 0x10)));
  w16(0x0664, rom16(B4(x + 0x12)));
  reg.a = rom8(B4(x));
  reg.x = x;
  vram_payload_handler_global();
  reg.a = rom8(B4(x + 1));
  reg.x = x;
  set_ppu_registers_global();
  reg.a = rom16(B4(x + 2));
  reg.y = 0;
  reg.x = 0x0020;
  dma_palette();
  reg.a = 0x00aa;
  reg.y = 0x00e0;
  reg.x = 0x0004;
  dma_sprite_palette_from_index();
  reg.a = ptr("global_sprite_palette");
  reg.y = 0x00f0;
  reg.x = 0x0004;
  dma_palette();
  clear_wram_tables();
  reg.x = clearWramTablesEndX(); // init_npc_screen_kongs uses the X it leaves
  init_npc_screen_kongs();
  w16(0x067a, 0);
  w16(0x065e, 0);
  io16(HDMA.settings + 0x10, 0x1202);
  io16(HDMA.source + 0x10, 0x06cf);
  io8(HDMA.source_bank + 0x10, 0);
  io8(HDMA.indirect_source_bank + 0x10, 0);
  w16(0x064e, 0x001e);
}

/**
 * X as clear_wram_tables leaves it (end of the last table it cleared); its port in bank $80
 * does not return it, and init_npc_screen_kongs sets interaction flags at that X.
 */
function clearWramTablesEndX(): number {
  let x = reg.x;
  for (let y = WRAM_TABLES; ; y += 4) {
    const addr = rom16(y);
    if (addr & 0x8000) break;
    x = (addr + ((rom16(y + 2) >> 1) << 1)) & 0xffff;
  }
  return x;
}
const WRAM_TABLES = L("clear_wram_tables_wram_tables");

/** $B48D69 — X = screen type: where the Kongs walk to, and how fast. */
export function CODE_B48D69() {
  const y = rom16(B4(INIT_DATA + reg.x));
  let x = r16(R.active_kong_sprite);
  w16(x + 0x44, rom16(B4(y + 0x16)));
  w16(x + 0x46, rom16(B4(y + 0x1a)));
  w16(x + 0x42, 0x0001);
  x = r16(R.inactive_kong_sprite);
  w16(x + 0x42, 0x0001);
  w16(x + 0x44, rom16(B4(y + 0x18)));
  w16(x + 0x46, rom16(B4(y + 0x1a)));
  reg.x = x;
  reg.y = y;
}

/** $B48D8E — X = screen type: spawn its sprites (the NPC, props) from the spawn list. */
export function CODE_B48D8E() {
  let x = rom16(B4(rom16(B4(INIT_DATA + reg.x)) + 0x14));
  for (;;) {
    const id = rom16(B4(x));
    if (id === 0) break;
    reg.y = id;
    if (rom8(B4(x + 2)) !== 0) spawn_big_special_sprite_index();
    else spawn_special_sprite_index();
    x = (x + 3) & 0xffff;
  }
  reg.a = x;
  reg.x = x;
  reg.y = 0;
}

/** $B48DB5 — place both Kongs at the screen's entry points (and face them). */
export function CODE_B48DB5() {
  const x = initData();
  let y = r16(R.active_kong_sprite);
  w16(y + 0x06, rom16(B4(x + 4)));
  w16(y + 0x0a, rom16(B4(x + 6)));
  y = r16(R.inactive_kong_sprite);
  w16(y + 0x06, rom16(B4(x + 8)));
  w16(y + 0x0a, rom16(B4(x + 0x0a)));
  if (rom16(B4(x + 0x0c)) & 0x0001) {
    y = r16(R.active_kong_sprite);
    w16(y + 0x12, r16(y + 0x12) ^ 0x4000);
    y = r16(R.inactive_kong_sprite);
    w16(y + 0x12, r16(y + 0x12) ^ 0x4000);
  }
  reg.x = x;
  reg.y = y;
}

// ---------------------------------------------------------------------------------------------
// Fade in and intro dialogue

/** $B491D7 — run_808CF5: fade in, then the greeting (or Klubba's open kiosk if already paid). */
export function CODE_B491D7() {
  reg.db = 0xb4;
  CODE_B4A11F();
  npcFrameStart();
  if (r16(R.screen_brightness) !== 0x000f) {
    if (r16(0x0676) === 0) fade_screen_global();
    else add16(0x0676, -1);
  } else {
    let paid = false;
    if (npc() === NPC_KLUBBA) {
      CODE_B49FFD();
      paid = (r16(R.klubba_payments) & r16(0x0666)) !== 0;
    }
    if (paid) {
      w16(R.nmi_pointer, ptr("run_808D3D"));
      w16(0x0654, 0x0001);
    } else {
      w16(R.nmi_pointer, ptr("run_npc_intro_dialogue"));
    }
  }
  dmaOamBuffer();
  io8(PPU.screen, r8(R.screen_brightness));
  frameEnd(false);
}

/** dma_queued_sprite_graphics / palette, then the screen's own per-frame routine (CODE_B4996E). */
function npcFrameStart() {
  dma_queued_sprite_graphics();
  dma_queued_sprite_palette_global();
  CODE_B4996E();
}

/** BAC7C0, coin counter, sprites (+ sort), OAM bookkeeping: the end of most NPC frames. */
function frameEnd(sort: boolean) {
  CODE_BAC7C0();
  w16(0xc8, 0x03fc);
  reg.x = 0x07a5;
  CODE_B4BB62();
  sprite_handler();
  if (sort) sort_sprite_render_orders();
  CODE_B4AE85();
}

/**
 * $B49266 — put the next greeting page in the text buffer: Cranky's Lost World tour pages,
 * the first-visit text of each Kong, or a random line of the screen's table ($065C).
 */
export function CODE_B49266() {
  reg.db = 0xb4;
  if (npc() === NPC_CRANKY && world() >= C.world_lost_world_w2 && !(r16(R.visited_kong_family_members) & 0x0020)) {
    const y = ((4 - r16(0x0658)) << 1) & 0xffff;
    CODE_B4ADDF();
    reg.x = lang() ? f7(lo16(L("DATA_F7FCC2")) + y) : f7(0x00ae + y);
    reg.db = 0xb4;
    reg.a = 0x0006;
    reg.y = 0;
    CODE_B4ADEB();
    if (r16(0x0658) === 0x0001) w16(R.visited_kong_family_members, r16(R.visited_kong_family_members) | 0x0020);
    return;
  }
  // CODE_B492B5: this Kong's "visited" bit
  const bit = 1 << (npc() >> 1);
  w16(0x0654, bit);
  reg.c = false; // ROL loop
  let v = r16(R.visited_kong_family_members) & 0x00ff;
  if (!(v & bit)) {
    // first visit: the introduction text (and its second page if it has one)
    v |= bit;
    w8(R.visited_kong_family_members, v);
    const table = lang() ? L("DATA_B4C849") : L("DATA_B4C533");
    const x = rom16(B4(table + npc()));
    reg.x = (x + 1) & 0xffff;
    reg.a = 0x0006;
    reg.y = 0;
    CODE_B4ADEB();
    CODE_B4ADDF();
    const pages = f7(x) & 0xff;
    reg.db = 0xb4;
    w16(0x0660, pages >= 2 ? reg.x : 0);
    return;
  }
  // CODE_B49315: a random line
  w16(0x0660, 0);
  pickRandomLine(0x0654, 0x0000);
}

/**
 * The random choice of CODE_B49315 / CODE_B49AFC / CODE_B49BE0: r = random; the table at $065C
 * (bank $F7) starts with its size n; line r (if r < n... the original compares n >= r) or r % n.
 * Draws the chosen line at text buffer offset Y. `tmp` = the scratch word the variant uses.
 */
function pickRandomLine(tmp: number, y: number) {
  CODE_B4C175();
  const rnd = reg.a & 0xffff;
  w16(tmp, rnd);
  io16(CPU.dividen, rnd);
  const tbl = r16(0x065c);
  CODE_B4ADDF();
  const n = f7(tbl);
  reg.db = 0xb4;
  let i: number;
  if (n >= rnd) {
    reg.c = true;
    i = rnd;
  } else {
    reg.c = false;
    io8(CPU.divisor, n & 0xff);
    i = ioR16(CPU.multiply_result);
  }
  const e = ((i << 1) + tbl) & 0xffff;
  CODE_B4ADDF();
  reg.x = f7(e + 2);
  reg.db = 0xb4;
  reg.a = 0x0006;
  reg.y = y;
  CODE_B4ADEB();
}

/** $B4935E — run_npc_intro_dialogue: show the greeting pages; A/B/X/Y/START next page. */
export function CODE_B4935E() {
  reg.db = 0xb4;
  npcFrameStart();
  if (add16(0x064e, -1) === 0) {
    if (flags() & 0x0200) {
      if (!(flags() & 0x1000)) {
        CODE_B4BDE7();
        add16(0x064e, 1);
        if (flags() & 0x0001) {
          setFlags((flags() | 0x1000) & 0xfffe);
          w16(0x064e, 0x0258); // auto-advance after 10 s
        }
      } else {
        CODE_B4BE0B();
        add16(0x064e, 1);
        if (flags() & 0x0001) return CODE_B4945F();
      }
    } else {
      // CODE_B493B7: show the page
      dmaToVram(r16(0x0662), TEXT_VRAM_BUFFER, 0x7e, 0x0180);
      setFlags((flags() | 0x0200) & 0xefff);
      w16(0x064e, 0x0001);
      reg.a = 0x0001;
      CODE_B4BD8D();
    }
  }
  // CODE_B493FC
  if (r16(R.player_active_pressed) & C.input_ABXY_start) {
    if (npc() !== NPC_CRANKY || world() < C.world_lost_world_w2 || r16(R.visited_kong_family_members) & 0x0020) {
      w16(0x064e, 0x0001);
      w16(0x0658, 0x0001);
    }
  }
  if (r16(R.player_active_pressed) & 0x0300 && r16(R.screen_brightness) === 0x000f) {
    // left/right: walk out
    w16(R.nmi_pointer, ptr("run_npc_exit"));
    fadeOut();
  }
  CODE_B49EF1();
  frameEnd(true);
}

/** $B4945F — the page has closed: second page of the text, next page, or the options. */
function CODE_B4945F() {
  reg.db = 0xb4;
  setFlags(flags() & 0xfdff);
  if (r16(0x0660) !== 0) {
    // the second page of a first-visit text
    CODE_B49EF1();
    CODE_BAC7C0();
    w16(0xc8, 0x03fc);
    reg.x = 0x07a5;
    CODE_B4BB62();
    sprite_handler();
    reg.db = 0xb4;
    CODE_B4AE85();
    w16(0x0699, 0);
    reg.x = r16(0x0660);
    reg.a = 0x0006;
    reg.y = 0;
    CODE_B4ADEB();
    setFlags(flags() & 0xedfe);
    w16(0x0660, 0);
    w16(0x064e, 0x0001);
    return;
  }
  // CODE_B494AC
  CODE_B49EF1();
  if (add16(0x0658, -1) !== 0) {
    w16(0x064e, 0x0001);
    setFlags(flags() & 0xeffe);
    w16(0x065c, rom16(B4((lang() ? L("DATA_B4C853") : L("DATA_B4C53D")) + npc())));
    CODE_B49266();
    return frameEnd(true);
  }
  if (npc() === NPC_CRANKY && !(flags() & 0x2000)) {
    // CODE_B494DB: one more random Cranky line
    setFlags(flags() | 0x2000);
    w16(0x064e, 0x0001);
    w16(0x0658, 0x0001);
    setFlags(flags() & 0xeffe);
    reg.x = npc();
    w16(0x065c, lang() ? ptr("DATA_F7FC84") : ptr("DATA_F70056"));
    reg.y = 0;
    CODE_B49BE0();
    return frameEnd(true);
  }
  // CODE_B4951B: the option menu
  w16(0x0654, 0x0001);
  CODE_B4974F();
  w16(R.nmi_pointer, ptr("run_808D30"));
  w16(0x065e, ptr("run_npc_dialogue_selection"));
  setFlags(flags() | 0x0400);
  CODE_B49B47();
  w16(0x065c, 0);
  frameEnd(true);
}

// ---------------------------------------------------------------------------------------------
// Option menu text

/** $B49541 — Swanky: overwrite the quizzes already won with "** Game Complete **". */
export function CODE_B49541() {
  const x = world() - 1;
  w16(0x0666, x);
  const done = r16(R.completed_swanky_dialogue + x);
  if (done & 0x0001) {
    reg.y = TEXT_VRAM_BUFFER;
    CODE_B49704();
  }
  if (r16(R.completed_swanky_dialogue + r16(0x0666)) & 0x0002) {
    reg.y = 0x3e80;
    CODE_B49704();
  }
  if (r16(R.completed_swanky_dialogue + r16(0x0666)) & 0x0004) {
    reg.y = 0x3f00;
    CODE_B49704();
  }
}

/** $B49579 — Cranky: "FREE" next to the hints already bought. */
export function CODE_B49579() {
  reg.y = lo16(lang() ? L("DATA_B4C80D") : L("DATA_B4C4F7"));
  CODE_B49875();
  CODE_B4ADE5();
  const n = ba(reg.a);
  reg.db = 0xb4;
  w16(0x0666, n >> 1);
  reg.y = 0x3e14;
  w16(0x0672, r16(R.completed_cranky_dialogue + world() - 1));
  reg.a = 0x0001;
  CODE_B49620();
}

/** $B495A8 — Funky: "FREE" next to the options already bought. */
export function CODE_B495A8() {
  const x = lo16(lang() ? L("DATA_BAEF04") : L("DATA_BAD5AA"));
  CODE_B4ADE5();
  const n = ba(x);
  reg.db = 0xb4;
  w16(0x0666, n >> 1);
  reg.y = 0x3e14;
  w16(0x0672, r16(R.completed_funky_dialogue + world() - 1));
  reg.a = 0x0001;
  CODE_B49620();
}

/** $B495D3 — Wrinkly: the save price (free once paid) and "FREE" next to bought hints. */
export function CODE_B495D3() {
  w16(0x0666, ((world() - 1) << 1) & 0xffff);
  if (r16(R.completed_wrinkly_dialogue + world() - 1) & 0x0001) {
    reg.y = TEXT_VRAM_BUFFER;
    reg.x = r16(0x0666);
    CODE_B496BB();
  }
  reg.y = lo16(lang() ? L("DATA_B4C829") : L("DATA_B4C513"));
  CODE_B49875();
  CODE_B4ADE5();
  const n = ba(reg.a);
  reg.db = 0xb4;
  w16(0x0666, ((n >> 1) - 1) & 0xffff);
  reg.y = 0x3e90;
  w16(0x0672, r16(R.completed_wrinkly_dialogue + world() - 1));
  reg.a = 0x0002;
  CODE_B49620();
}

/** $B49620 — for each option line (Y, +$80 each): if bit A of $0672 is set, write "FREE". */
export function CODE_B49620() {
  w16(0x0660, reg.a & 0xffff);
  add16(0x0666, -1);
  let y = reg.y;
  const x = lo16(L("DATA_B49647"));
  do {
    if (r16(0x0660) & r16(0x0672)) {
      reg.x = x;
      reg.y = y;
      CODE_B496C8();
    }
    w16(0x0660, (r16(0x0660) << 1) & 0xffff);
    y = (y + 0x0080) & 0xffff;
  } while (add16(0x0666, -1) !== 0);
  reg.y = y;
  reg.x = x;
}

/** $B496BB — X = world*2: Wrinkly's save price text ("1 COIN"/"2 COINS") on the first line. */
export function CODE_B496BB() {
  reg.x = rom16(B4(lo16(L("DATA_B49665")) + reg.x));
  reg.y = TEXT_VRAM_BUFFER;
  CODE_B496C8();
}

/**
 * $B496C8 — Y = a line of text_vram_buffer: find its "-" (tile $200D), skip 2 tiles and
 * write the text described at X (length, pointer; French at +5) followed by blanks.
 */
export function CODE_B496C8() {
  reg.db = 0x7e;
  let y = reg.y;
  while (r16(y) !== 0x200d) y = (y + 2) & 0xffff;
  reg.db = 0xb4;
  y = (y + 4) & 0xffff;
  const x = reg.x;
  let len: number;
  let src: number;
  if (lang()) {
    len = rom8(B4(x + 5));
    src = rom16(B4(x + 6));
  } else {
    len = rom8(B4(x));
    src = rom16(B4(x + 1));
  }
  reg.x = src;
  reg.y = y;
  reg.a = len;
  CODE_B49726();
  reg.db = 0xb4;
}

/** $B49704 — Y = a line of text_vram_buffer: "** Game Complete **" and a blank line after it. */
export function CODE_B49704() {
  const src = lo16(lang() ? L("DATA_B49835") : L("DATA_B497F5"));
  let y = reg.y;
  for (let i = 0; i < 0x40; i++) w8((y + i) & 0xffff, rom8(B4(src + i)));
  y = (y + 0x40) & 0xffff;
  for (let i = 0; i < 0x20; i++) {
    w16(y, 0x2000);
    y = (y + 2) & 0xffff;
  }
  reg.y = y;
  reg.x = 0;
  reg.a = 0x2000;
}

/** $B49726 — copy A+1 bytes from $B4:X to $7E:Y, then clear the rest of the 64-byte line. */
export function CODE_B49726() {
  const n = (reg.a & 0xffff) + 1;
  let y = reg.y;
  let x = reg.x;
  for (let i = 0; i < n; i++) {
    w8(y, rom8(B4(x)));
    x = (x + 1) & 0xffff;
    y = (y + 1) & 0xffff;
  }
  let cnt = ((0x40 - (y & 0x3f)) & 0xffff) >> 1;
  w16(0x0650, cnt);
  reg.db = 0x7e;
  do {
    w16(y, 0);
    y = (y + 2) & 0xffff;
  } while (add16(0x0650, -1) !== 0);
  void cnt;
  reg.x = x;
  reg.y = y;
  reg.a = 0;
}

/** $B4974F — build the option menu text of the screen into text_vram_buffer. */
export function CODE_B4974F() {
  const t = npc();
  let a: number;
  if (t === NPC_CRANKY) {
    reg.y = lo16(lang() ? L("DATA_B4C80D") : L("DATA_B4C4F7"));
    CODE_B49875();
    a = reg.a;
  } else if (t === NPC_WRINKLY) {
    reg.y = lo16(lang() ? L("DATA_B4C829") : L("DATA_B4C513"));
    CODE_B49875();
    a = reg.a;
  } else if (t === NPC_SWANKY) {
    reg.y = lo16(lang() ? L("DATA_B4C837") : L("DATA_B4C521"));
    CODE_B49875();
    a = reg.a;
  } else {
    a = rom16(B4((lang() ? L("DATA_B4C803") : L("DATA_B4C4ED")) + t));
  }
  // CODE_B4979C: the table starts with 2 * number of options
  let x = a & 0xffff;
  CODE_B4ADE5();
  const n2 = ba(x);
  reg.db = 0xb4;
  w16(0x0652, n2 >> 1); // last option
  w16(0x065a, ((n2 >> 1) - 2) & 0xffff); // where scrolling stops
  CODE_B4ADE5();
  let lines = ba(x);
  reg.db = 0xb4;
  if (lines < 6) lines = 6;
  w16(0x0658, ((lines << 8) >> 2) & 0xffff); // bytes to DMA
  x = (x + 2) & 0xffff;
  reg.x = x;
  reg.a = lines;
  reg.y = 0;
  CODE_B4ADF6();
  if (t === NPC_CRANKY) CODE_B49579();
  else if (t === NPC_FUNKY) CODE_B495A8();
  else if (t === NPC_SWANKY) CODE_B49541();
  else if (t === NPC_WRINKLY) CODE_B495D3();
}

/** $B49875 — A = the word at Y + (world - 1) * 2 in bank $B4. */
export function CODE_B49875() {
  const a = ((world() - 1) << 1) & 0xffff;
  w16(0x0666, reg.y);
  const y = (a + reg.y) & 0xffff;
  reg.c = a + reg.y > 0xffff;
  reg.y = y;
  reg.a = dbR16(y);
}

/** $B49886 — run_808D30: upload the options text and open the window. */
export function CODE_B49886() {
  const db = reg.db;
  reg.db = 0xb4;
  npcFrameStart();
  if (flags() & 0x0400) {
    dmaToVram(r16(0x0662), TEXT_VRAM_BUFFER, 0x7e, r16(0x0658));
    setFlags(flags() & 0xfbff);
    reg.a = 0x0001;
    CODE_B4BD8D();
  }
  CODE_B4BDE7();
  if (flags() & 0x0001) {
    setFlags(flags() & 0xefff);
    w16(R.nmi_pointer, r16(0x065e));
  }
  CODE_B49EF1();
  frameEnd(false);
  reg.db = db;
}

/** $B4990F — run_808D70: close the answer window, then go on with $065E. */
export function CODE_B4990F() {
  const db = reg.db;
  reg.db = 0xb4;
  npcFrameStart();
  if (!(flags() & 0x1000)) {
    reg.a = 0x003d;
    CODE_B4BD8D();
    setFlags(flags() | 0x1000);
  }
  CODE_B4BE0B();
  if (flags() & 0x0001) {
    setFlags(flags() & 0xefff);
    w16(0x064e, 0x0001);
    w16(R.nmi_pointer, r16(0x065e));
  }
  CODE_B49EF1();
  frameEnd(false);
  reg.db = db;
}

/** $B4996E — the screen's per-frame routine (npc_screen_init_data + $0E). */
export function CODE_B4996E() {
  callPtr(0xb4, rom16(B4(initData() + 0x0e)));
}

// ---------------------------------------------------------------------------------------------
// Option menu

/** $B49978 — run_npc_dialogue_selection: the Kong cursor on the option list. */
export function CODE_B49978() {
  reg.db = 0xb4;
  npcFrameStart();
  if (r16(0x067a) !== 0) {
    callPtr(0xb4, r16(0x067a)); // JMP ($067A): CODE_B49E48
    return;
  }
  if (!(r16(0x06a3) & 0x0400)) {
    // the Kong head icons (map icon graphics) for the cursor
    w16(0x06a3, r16(0x06a3) | 0x0400);
    dmaToVram(0x0000, ICON_GFX, ICON_GFX_BANK, 0x0400);
  }
  dmaOamBuffer();
  io8(PPU.screen, 0x0f);
  if (flags() & 0x0800) return cursorMoving();
  // CODE_B49A76: input
  const held = r16(R.player_active_held);
  if (held & 0x0800) {
    if (r16(0x0654) !== 0x0001) {
      setFlags(flags() | 0x0800);
      w16(0x06bb, 0xffff);
      w16(0x0650, 0x0010);
      return cursorMoving();
    }
  } else if (held & 0x0400) {
    if (r16(0x0654) !== r16(0x0652)) {
      setFlags(flags() | 0x0800);
      w16(0x06bb, 0x0001);
      w16(0x0650, 0x0010);
      return cursorMoving();
    }
  } else if (r16(R.player_active_pressed) & C.input_ABXY_start) {
    w16(0x0670, r16(0x06b5));
    w16(0x06a3, r16(0x06a3) & 0xfbff);
    return CODE_B49C71();
  }
  CODE_B49ADD();
}

/** $B499FA — move the cursor (or scroll the list) by one pixel; 16 frames per option. */
function cursorMoving() {
  w16(0x065c, 0);
  const step = r16(0x06bb);
  let scroll: boolean;
  if (step & 0x8000) scroll = ((r16(0x0654) - 1) & 0xffff) < r16(0x065a);
  else scroll = r16(0x0654) < r16(0x065a);
  if (scroll) {
    // CODE_B49A48: scroll the text
    w16(0x06d6, (r16(0x06d6) + step) & 0xffff);
  } else {
    // CODE_B49A0A: move the Kong head
    w8(0x06b6, (r8(0x06b6) + step) & 0xff);
  }
  if (add16(0x0650, -1) === 0) {
    setFlags(flags() & 0xf7ff);
    sound(SND_MENU_MOVE);
    w16(0x0654, (r16(0x0654) + r16(0x06bb)) & 0xffff);
  }
  CODE_B49ADD();
}

/** $B49ADD — end of the menu frame. */
function CODE_B49ADD() {
  CODE_BAC7C0();
  w16(0xc8, 0x03fc);
  if (r16(0x067a) === 0) CODE_B49C4D();
  CODE_B49AEE();
}

/** $B49AEE */
function CODE_B49AEE() {
  reg.x = 0x07a5;
  CODE_B4BB62();
  sprite_handler();
  CODE_B4AE85();
}

/** $B49AFC — a random "you can't afford it" line at text offset $0800. */
export function CODE_B49AFC() {
  reg.db = 0xb4;
  pickRandomLine(0x0656, 0x0800);
  reg.db = 0xb4;
}

/** $B49B47 — the cursor (Kong head) at the first option. */
export function CODE_B49B47() {
  w16(0xc8, 0x03fc);
  w16(0x06b5, 0xa314);
  CODE_B49C4D();
}

/** $B49B55 — same as CODE_B49B47. */
export function CODE_B49B55() {
  w16(0xc8, 0x03fc);
  w16(0x06b5, 0xa314);
  CODE_B49C4D();
}

/** $B49B63 — run_npc_exit: fade out, then back to the map. */
export function CODE_B49B63() {
  reg.db = 0xb4;
  npcFrameStart();
  if (r16(R.screen_brightness) !== 0) {
    fade_screen_global();
    dmaOamBuffer();
    io8(PPU.screen, r8(R.screen_brightness));
    frameEnd(false);
    return;
  }
  // CODE_B49BBB
  CODE_B4AED3();
  w16(0x06a3, r16(0x06a3) | 0x0040);
  w16(0x06af, 0);
  w16(0x06ad, 0);
  w16(R.file_select_action, r16(R.file_select_action) & 0xfffe);
  w16(R.game_mode_pointer, ptr("CODE_8087D9"));
  reg.a = ptr("run_simple_game_mode");
  set_nmi_and_wait();
}

/** $B49BDC */
export function CODE_B49BDC() {
  CODE_B4AED3();
}

/** $B49BE0 — a random line of the table at $065C, drawn at text offset Y. */
export function CODE_B49BE0() {
  reg.db = 0xb4;
  pickRandomLine(0x0666, reg.y);
  reg.db = 0xb4;
}

/** $B49C4D — the Kong head cursor sprite at [$C8] (OAM entry $1E is 16x16). */
export function CODE_B49C4D() {
  longW16(0xc8, r16(0x06b5));
  add16(0xc8, 2);
  longW16(0xc8, ((r16(R.active_kong_number) << 1) | 0x3c00) & 0xffff);
  add16(0xc8, -6);
  w16(0x041e, r16(0x041e) | 0x8000);
}

/** $B49C71 — an option was chosen: is it already bought (free), affordable, or not? */
function CODE_B49C71() {
  const t = npc();
  if (t === NPC_SWANKY) {
    checkBought();
    if (reg.c) return CODE_B49D40(); // quiz already won: nothing
    return payPrice();
  }
  if (t === NPC_WRINKLY && r16(0x0654) - 1 === 0) {
    // saving the game
    checkBought();
    if (!reg.c) return payPrice();
    const x = rom16(B4(lo16(L("DATA_B49665")) + (((world() - 1) << 1) & 0xffff)));
    get_player_coin_count_npc();
    const left = (reg.a - rom16(B4(x + 3))) & 0xffff;
    reg.a = left;
    if (left & 0x8000) return cantAfford();
    return CODE_B49D4F(left);
  }
  checkBought();
  if (!reg.c) return payPrice();
  get_player_coin_count_npc();
  CODE_B49D4F(reg.a); // bought before: free
}

/** JSR (DATA_B49DE0,x): carry set if this option was bought already. */
function checkBought() {
  callPtr(0xb4, rom16(B4(lo16(L("DATA_B49DE0")) + npc())));
}

/** $B49CB4 — look up the price of the option and pay it if possible. */
function payPrice() {
  const t = npc();
  let table: number;
  if (t === NPC_CRANKY) {
    reg.y = ptr("cranky_prices_table");
    CODE_B49875();
    table = reg.a;
  } else if (t === NPC_WRINKLY) {
    reg.y = ptr("wrinkly_prices_table");
    CODE_B49875();
    table = reg.a;
  } else if (t === NPC_SWANKY) {
    reg.y = ptr("swanky_prices_table");
    CODE_B49875();
    table = reg.a;
  } else {
    table = rom16(B4(lo16(L("funky_and_klubba_prices_table")) + t));
  }
  w16(0x0666, table);
  const x = ((((r16(0x0654) - 1) << 1) & 0xffff) + table) & 0xffff;
  get_player_coin_count_npc();
  const left = (reg.a - rom16(B4(x))) & 0xffff;
  reg.a = left;
  if (!(left & 0x8000)) return CODE_B49D4F(left);
  cantAfford();
}

/** $B49CF7 — not enough coins: Wrinkly/Cranky... say so (once), else just stay. */
function cantAfford() {
  const a = r16(0x065c) & 0x00ff;
  reg.c = true; // CMP #$0000
  if (a !== 0) {
    add16(0x065c, 1);
    return CODE_B49D40();
  }
  w16(R.nmi_pointer, ptr("run_808D70"));
  w16(0x065e, ptr("run_808D5F"));
  w16(0x065c, rom16(B4((lang() ? L("DATA_B4C85D") : L("DATA_B4C547")) + npc())));
  CODE_B49AFC();
  sound(SND_WRONG);
  setFlags(flags() & 0xfdff);
  w16(0x064e, 0x0001);
  w16(0x065c, 0);
  CODE_B49D40();
}

/** $B49D40 */
function CODE_B49D40() {
  CODE_BAC7C0();
  w16(0xc8, 0x03fc);
  CODE_B49C4D();
  CODE_B49AEE();
}

/** $B49D4F — pay (A = coins left) and mark the option bought; the icons animation follows. */
function CODE_B49D4F(left: number) {
  sound(SND_MENU_SELECT);
  if (npc() === NPC_KLUBBA) w8(R.token_count, left & 0xff);
  else w8(R.banana_coin_count, left & 0xff);
  w16(0x067a, ptr("CODE_B49E48"));
  w16(0x0699, ICON_GFX);
  w16(0x0650, 0x0001);
  const t = npc();
  let base = -1;
  if (t === NPC_CRANKY) base = R.completed_cranky_dialogue;
  else if (t === NPC_FUNKY) base = R.completed_funky_dialogue;
  else if (t === NPC_WRINKLY) base = R.completed_wrinkly_dialogue;
  if (base >= 0) {
    w16(0x0666, base);
    const x = (world() - 1 + base) & 0xffff;
    CODE_B49E3A();
    w8(x, r8(x) | r8(0x0666));
    if (t === NPC_CRANKY && world() >= C.world_lost_world_w2) {
      const v = r8(x) | r8(0x0666);
      for (const n of [
        R.completed_cranky_lost_2_dialogue,
        R.completed_cranky_lost_3_dialogue,
        R.completed_cranky_lost_4_dialogue,
        R.completed_cranky_lost_5_dialogue,
        R.completed_cranky_lost_6_dialogue,
      ]) w8(n, v);
    }
  }
  CODE_B49D40();
}

/** $B49DEA — Cranky: carry = this hint was bought. */
export function CODE_B49DEA() {
  CODE_B49E3A();
  reg.c = (r16(R.completed_cranky_dialogue + world() - 1) & r16(0x0666)) !== 0;
}
/** $B49DFE — Swanky: carry = this quiz was won. */
export function CODE_B49DFE() {
  CODE_B49E3A();
  reg.c = (r16(R.completed_swanky_dialogue + world() - 1) & r16(0x0666)) !== 0;
}
/** $B49E12 — Klubba: never bought (the price is paid each time... the kiosk opens for good). */
export function CODE_B49E12() {
  reg.c = false;
}
/** $B49E14 — Funky: carry = this option was bought. */
export function CODE_B49E14() {
  CODE_B49E3A();
  reg.c = (r16(R.completed_funky_dialogue + world() - 1) & r16(0x0666)) !== 0;
}
/** $B49E26 — Wrinkly: carry = this option was bought. */
export function CODE_B49E26() {
  CODE_B49E3A();
  reg.c = (r16(R.completed_wrinkly_dialogue + world() - 1) & r16(0x0666)) !== 0;
}

/** $B49E3A — $0666 = 1 << (cursor - 1). */
export function CODE_B49E3A() {
  let m = 0;
  let c = true;
  let a = r16(0x0654);
  do {
    m = ((m << 1) | (c ? 1 : 0)) & 0xffff;
    c = false;
    a = (a - 1) & 0xffff;
  } while (a !== 0);
  w16(0x0666, m);
  reg.a = 0;
}

/**
 * $B49E48 — after a purchase: animate the map icons (every other frame, 1 KiB per step) until
 * all are shown, then the answer (run_808D70 then run_808D3D).
 */
export function CODE_B49E48() {
  if (add16(0x0650, -1) === 0) {
    w16(0x0650, 0x0002);
    const x = r16(0x0699);
    dmaToVram(0x0000, x, 0xfc, 0x0400);
    const next = (x + 0x0400) & 0xffff;
    if (next === WATER_DROP_GFX) {
      w16(0x0699, 0);
      w16(R.nmi_pointer, ptr("run_808D70"));
      w16(0x065e, ptr("run_808D3D"));
      return CODE_B49EBF();
    }
    w16(0x0699, next);
  }
  dmaOamBuffer();
  CODE_B49EBF();
}

/** $B49EBF */
function CODE_B49EBF() {
  io8(PPU.screen, 0x0f);
  CODE_BAC7C0();
  w16(0xc8, 0x03fc);
  CODE_B49C4D();
  CODE_B49AEE();
}

// ---------------------------------------------------------------------------------------------
// Option actions

let skipFrameTail = false;

/** $B49ED7 — run_808D4E: the current action ($079C). */
export function CODE_B49ED7() {
  reg.db = 0xb4;
  npcFrameStart();
  CODE_B49EF1();
  skipFrameTail = false;
  callPtr(0xb4, r16(0x079c));
  if (frameEnded) return;
  if (skipFrameTail) {
    // the action left with PLA : RTL (CODE_B4A5CC)
    skipFrameTail = false;
    return;
  }
  CODE_B4A815();
}

/** $B49EF1 — OAM upload and screen brightness. */
export function CODE_B49EF1() {
  dmaOamBuffer();
  io8(PPU.screen, r8(R.screen_brightness));
}

/** $B49F1D — run_808D3D: run the routine of the chosen option. */
export function CODE_B49F1D() {
  reg.db = 0xb4;
  npcFrameStart();
  CODE_B49EF1();
  const t = npc();
  let table: number;
  if (t === NPC_CRANKY) {
    reg.y = ptr("DATA_B4CC57");
    CODE_B49875();
    table = reg.a;
  } else if (t === NPC_WRINKLY) {
    reg.y = ptr("DATA_B4CCDF");
    CODE_B49875();
    table = reg.a;
  } else {
    table = rom16(B4(lo16(L("DATA_B4CC4D")) + t));
  }
  w16(0x0666, table);
  const off = ((r16(0x0654) - 1) << 1) & 0xffff;
  reg.c = off + table > 0xffff;
  const x = (off + table) & 0xffff;
  reg.x = x;
  callPtr(0xb4, rom16(B4(x)));
  if (frameEnded) return;
  CODE_B4A815();
}

/** $B49F61 — Klubba: pay and enter the Lost World through his barrel. */
export function CODE_B49F61() {
  reg.x = r16(R.active_kong_sprite);
  move_kong_to_golden_barrel();
  reg.x = r16(R.inactive_kong_sprite);
  move_kong_to_golden_barrel();
  w16(0x079c, ptr("CODE_B4A00D"));
  w16(R.nmi_pointer, ptr("run_808D4E"));
  CODE_B49FFD();
  w16(R.klubba_payments, r16(R.klubba_payments) | r16(0x0666));
  w16(R.kiosk_returning_world_number, world());
  const node = r16(R.map_node_number);
  let w: number;
  let ret: number;
  // the CMP chain leaves the carry of the last comparison
  reg.c = node >= C.map_node_klubbas_kiosk_w2;
  if (node === C.map_node_klubbas_kiosk_w2) {
    w = C.world_lost_world_w2;
    ret = C.map_node_return_to_w2;
  } else {
    reg.c = node >= C.map_node_klubbas_kiosk_w3;
    if (node === C.map_node_klubbas_kiosk_w3) {
      w = C.world_lost_world_w3;
      ret = C.map_node_return_to_w3;
    } else {
      reg.c = node >= C.map_node_klubbas_kiosk_w4_lower;
      if (node === C.map_node_klubbas_kiosk_w4_lower) {
        w = C.world_lost_world_w4;
        ret = C.map_node_return_to_w4;
      } else {
        reg.c = node >= C.map_node_klubbas_kiosk_w5;
        if (node === C.map_node_klubbas_kiosk_w5) {
          w = C.world_lost_world_w5;
          ret = C.map_node_return_to_w5;
        } else {
          w = C.world_lost_world_w6;
          ret = C.map_node_return_to_w6;
        }
      }
    }
  }
  w16(R.world_number, w);
  w16(R.map_node_number, ret);
  setFlags(flags() & 0xfdff);
  w16(0x064e, 0x0001);
  w16(0x065c, lang() ? ptr("DATA_F7FDC2") : 0x01d4);
  reg.y = 0x0c00;
  CODE_B49BE0();
}

/** $B49FFD — $0666 = 1 << world (Klubba's payment bit of this world). */
export function CODE_B49FFD() {
  let a = world();
  let m = 0x0001;
  let c = false;
  do {
    c = (m & 0x8000) !== 0;
    m = (m << 1) & 0xffff;
    a = (a - 1) & 0xffff;
  } while (a !== 0);
  w16(0x0666, m);
  reg.c = c;
  reg.a = 0;
}

/** $B4A00D — Kongs walk to the barrel; when the follower arrives both jump in. */
export function CODE_B4A00D() {
  CODE_B4A1E6();
  CODE_B4A0FD();
  CODE_B4A051();
  const x = r16(R.inactive_kong_sprite);
  if (r16(x + 0x42) !== 0) return;
  reg.x = x;
  make_kong_jump_on_golden_barrel();
  reg.x = r16(R.active_kong_sprite);
  make_kong_jump_on_golden_barrel();
  w16(0x079c, ptr("CODE_B4A02D"));
}

/** $B4A02D — wait for the jump (state 5), then the barrel blasts off. */
export function CODE_B4A02D() {
  CODE_B4A0FD();
  CODE_B4A051();
  const x = r16(R.inactive_kong_sprite);
  if (r16(x + 0x42) !== 0x0005) return;
  w16(0x079c, ptr("CODE_B4A088"));
  reg.y = C.special_sprite_spawn_id_018E;
  spawn_special_sprite_index();
  w16(0x064e, 0x003c);
}

/** $B4A051 — any button (not the D-pad): leave now. */
export function CODE_B4A051() {
  if (!(r16(R.player_active_pressed) & 0xf0c0)) return;
  if (r16(R.screen_brightness) !== 0x000f) return;
  w16(R.nmi_pointer, ptr("run_npc_exit"));
  fadeOut();
}

/** $B4A06E — jump into the golden barrel (Kong at X). */
export function make_kong_jump_on_golden_barrel() {
  const x = reg.x;
  w16(x + 0x42, 0x0003);
  w16(x + 0x44, 0x00c8);
  w16(x + 0x46, 0x0180);
  w16(x + 0x48, 0xf600);
  w16(x + 0x4a, 0x0058);
}

/** $B4A088 — a second after the blast: fade out to the Lost World. */
export function CODE_B4A088() {
  CODE_B4A0FD();
  CODE_B4A051();
  if (add16(0x064e, -1) !== 0) return;
  if (r16(R.screen_brightness) !== 0x000f) return;
  fadeOut();
  w16(R.nmi_pointer, ptr("run_npc_exit"));
}

/** $B4A0A8 — Cranky's hint for the chosen level. */
export function CODE_B4A0A8() {
  hint(lo16(lang() ? L("DATA_B4CAAB") : L("DATA_B4C795")));
}

/** $B4A0B5 — Wrinkly's hint for the chosen level. */
export function CODE_B4A0B5() {
  hint(lo16(lang() ? L("DATA_B4CA57") : L("DATA_B4C741")));
}

/** $B4A0C0 */
function hint(table: number) {
  w16(0x0666, table);
  const w2 = ((world() - 1) << 1) & 0xffff;
  const c = ((world() - 1) & 0x8000) !== 0; // carry of ASL feeds the ADC
  const x = (w2 + table + (c ? 1 : 0)) & 0xffff;
  const list = rom16(B4(x));
  w16(0x0666, list);
  const y = ((((r16(0x0654) - 1) << 1) & 0xffff) + list) & 0xffff;
  reg.x = rom16(B4(y));
  reg.a = 0x0006;
  reg.y = 0x0800;
  CODE_B4ADEB();
  w16(0x079c, ptr("CODE_B4A135"));
  w16(R.nmi_pointer, ptr("run_808D4E"));
  w16(0x064e, 0x0001);
  CODE_B4974F();
}

/** $B4A135 — show the answer text (response window), then back to the menu. */
export function CODE_B4A135() {
  CODE_B4A0FD();
  if (add16(0x064e, -1) !== 0) return CODE_B4A7D8();
  if (flags() & 0x0200) {
    if (!(flags() & 0x1000)) {
      CODE_B4BDE7();
      add16(0x064e, 1);
      if (flags() & 0x0001) {
        setFlags((flags() | 0x1000) & 0xfffe);
        w16(0x064e, 0xffff);
      }
      return CODE_B4A7D8();
    }
    CODE_B4BE0B();
    add16(0x064e, 1);
    if (!(flags() & 0x0001)) return CODE_B4A7D8();
    setFlags(flags() & 0xfdff);
    CODE_B4A11F();
    backToMenu();
    return;
  }
  // CODE_B4A1A7
  CODE_B4A7E7();
  CODE_B4A0FD();
  reg.db = 0xb4;
  get_player_coin_count_npc();
  reg.x = 0x07a5;
  CODE_B4BD57();
  setFlags((flags() | 0x0200) & 0xefff);
  w16(0x064e, 0x0001);
  reg.a = 0x0001;
  CODE_B4BD95();
  CODE_B4A7D8();
}

/** Back to the option menu (run_808D30 shows the options, then run_npc_dialogue_selection). */
function backToMenu() {
  w16(R.nmi_pointer, ptr("run_808D30"));
  w16(0x065e, ptr("run_npc_dialogue_selection"));
  w16(0x067a, 0);
  setFlags(flags() | 0x0400);
}

/** $B4A1D4 — A = banana coins (or Kremkoins at Klubba's). */
export function get_player_coin_count_npc() {
  reg.y = npc();
  const a = npc() === NPC_KLUBBA ? r16(R.token_count) : r16(R.banana_coin_count);
  reg.a = a & 0x00ff;
}

/** $B4A1E6 — Klubba/Funky: the answer text while the Kongs walk. */
export function CODE_B4A1E6() {
  if (r16(0x064e) === 0) return;
  if (add16(0x064e, -1) !== 0) return;
  if (flags() & 0x0200) {
    CODE_B4BDE7();
    add16(0x064e, 1);
    if (flags() & 0x0001) {
      setFlags((flags() | 0x1000) & 0xfffe);
      w16(0x064e, 0x012c);
      return;
    }
  } else {
    // CODE_B4A21B
    dmaToVram(r16(0x0664), TEXT_VRAM_BUFFER_2, 0x7e, 0x0180);
    CODE_B4A0FD();
    reg.db = 0xb4;
    get_player_coin_count_npc();
    reg.x = 0x07a5;
    CODE_B4BD57();
  }
  // CODE_B4A256
  setFlags((flags() | 0x0200) & 0xefff);
  w16(0x064e, 0x0001);
  reg.a = 0x0001;
  CODE_B4BD95();
}

/** $B4A26F — Wrinkly: save the game (fade out to the file select screen). */
export function CODE_B4A26F() {
  w16(R.file_select_action, 0x0001);
  w16(0x079c, ptr("CODE_B4A288"));
  w16(R.nmi_pointer, ptr("run_808D4E"));
  fadeOut();
}

/** $B4A288 */
export function CODE_B4A288() {
  fade_screen_global();
  if (r16(R.screen_brightness) !== 0) return;
  // CODE_B4A292
  disable_screen();
  update_save_buffer();
  w16(R.file_select_action, 0x0001);
  init_file_select();
}

/** $B4A2A4 — back from saving: fade in, then the menu. */
export function CODE_B4A2A4() {
  fade_screen_global();
  if (r16(R.screen_brightness) !== 0x000f) return;
  w16(R.nmi_pointer, ptr("run_808D30"));
  w16(0x065e, ptr("run_npc_dialogue_selection"));
}

/** $B4A2BC — Funky: fly back to Crocodile Isle. */
export function move_kong_to_funky_plane() {
  for (const k of [r16(R.active_kong_sprite), r16(R.inactive_kong_sprite)]) {
    w16(k + 0x42, 0x0001);
    w16(k + 0x44, 0x0050);
    w16(k + 0x46, 0x0180);
  }
  w16(R.nmi_pointer, ptr("run_808D4E"));
  w16(0x079c, ptr("CODE_B4A313"));
  w16(0x06a3, r16(0x06a3) | 0x1000); // "in Funky's plane"
  w16(R.world_number, 0);
  w16(0x064e, 0x0001);
  setFlags(flags() & 0xfdff);
  w16(0x065c, lang() ? ptr("DATA_F7FD6E") : ptr("DATA_F70168"));
  reg.y = 0x0c00;
  CODE_B49BE0();
}

/** $B4A313 — Kongs walk to the plane, then jump in. */
export function CODE_B4A313() {
  CODE_B4A1E6();
  CODE_B4A0FD();
  CODE_B4A051();
  const x = r16(R.inactive_kong_sprite);
  if (r16(x + 0x42) !== 0) return;
  reg.x = x;
  make_kong_jump_on_funky_plane();
  reg.x = r16(R.active_kong_sprite);
  make_kong_jump_on_funky_plane();
  w16(0x079c, ptr("CODE_B4A333"));
}

/** $B4A333 */
export function CODE_B4A333() {
  CODE_B4A0FD();
  CODE_B4A051();
  const x = r16(R.inactive_kong_sprite);
  if (r16(x + 0x42) !== 0x0005) return;
  w16(0x079c, ptr("CODE_B4A371"));
  reg.y = C.special_sprite_spawn_id_018E;
  spawn_special_sprite_index();
  w16(0x064e, 0x003c);
}

/** $B4A357 — jump into Funky's plane (Kong at X). */
export function make_kong_jump_on_funky_plane() {
  const x = reg.x;
  w16(x + 0x42, 0x0003);
  w16(x + 0x44, 0x0028);
  w16(x + 0x46, 0x0110);
  w16(x + 0x48, 0xf500);
  w16(x + 0x4a, 0x0068);
}

/** $B4A371 */
export function CODE_B4A371() {
  CODE_B4A0FD();
  CODE_B4A051();
  if (add16(0x064e, -1) !== 0) return;
  if (r16(R.screen_brightness) !== 0x000f) return;
  fadeOut();
  w16(R.nmi_pointer, ptr("run_npc_exit"));
}

// ---------------------------------------------------------------------------------------------
// Swanky's quizzes

/** $B4A391 — Swanky: start the chosen quiz (3 questions, $079E). */
export function CODE_B4A391() {
  w16(R.nmi_pointer, ptr("run_808D4E"));
  w16(0x079c, ptr("CODE_B4A3EE"));
  setFlags(flags() & 0xfdff);
  const x = ((world() - 1) << 1) & 0xffff;
  const quizzes = rom16(B4((lang() ? L("DATA_B4C871") : L("DATA_B4C55B")) + x));
  w16(0x0666, quizzes);
  const q = rom16(B4(((((r16(0x0654) - 1) << 1) & 0xffff) + quizzes) & 0xffff));
  w16(0x079f, q);
  w8(0x079e, 0x03);
  reg.x = rom16(B4(q));
  reg.a = 0x0006;
  reg.y = 0x0800;
  CODE_B4ADEB();
  w16(0x064e, 0x0001);
  get_player_coin_count_npc();
  reg.x = 0x07a5;
  CODE_B4BD57();
}

/** $B4A3EE — show the question, then the answers. */
export function CODE_B4A3EE() {
  CODE_B4A0FD();
  if (add16(0x064e, -1) !== 0) return CODE_B4A7D8();
  if (flags() & 0x0200) {
    if (!(flags() & 0x1000)) {
      CODE_B4BDE7();
      add16(0x064e, 1);
      if (flags() & 0x0001) {
        setFlags((flags() | 0x1000) & 0xfffe);
        w16(0x064e, 0x0001);
      }
      return CODE_B4A7D8();
    }
    CODE_B4BE0B();
    add16(0x064e, 1);
    if (!(flags() & 0x0001)) return CODE_B4A7D8();
    // the answers
    setFlags(flags() & 0xfdff);
    reg.x = rom16(B4(r16(0x079f) + 4));
    reg.a = 0x0006;
    reg.y = 0x0800;
    CODE_B4ADEB();
    w16(0x079c, ptr("CODE_B4A483"));
    w16(0x064e, 0x0001);
    return;
  }
  // CODE_B4A461
  CODE_B4A7E7();
  setFlags((flags() | 0x0200) & 0xefff);
  w16(0x064e, rom16(B4(r16(0x079f) + 2)));
  reg.a = 0x0001;
  CODE_B4BD95();
  CODE_B4A7D8();
}

/** $B4A483 — show the answers, then the choice. */
export function CODE_B4A483() {
  CODE_B4A0FD();
  if (flags() & 0x0200) {
    CODE_B4BDE7();
    add16(0x064e, 1);
    if (flags() & 0x0001) {
      setFlags((flags() | 0x1000) & 0xfffe);
      w16(0x079c, ptr("CODE_B4A4D9"));
      CODE_B49B55();
    }
    return CODE_B4A7D8();
  }
  CODE_B4A7E7();
  CODE_B4A0FD();
  setFlags((flags() | 0x0200) & 0xefff);
  w16(0x064e, rom16(B4(r16(0x079f) + 2)));
  reg.a = 0x0001;
  CODE_B4BD95();
  CODE_B4A7D8();
}

/**
 * $B4A4D9 — choose an answer (1-3) with the cursor. Leaves like the original's PLA : RTL,
 * skipping the frame tail of CODE_B49ED7.
 */
export function CODE_B4A4D9() {
  CODE_B4A0FD();
  if (!(r16(0x06a3) & 0x0400)) {
    w16(0x06a3, r16(0x06a3) | 0x0400);
    dmaToVram(0x0000, ICON_GFX, ICON_GFX_BANK, 0x0400);
    w16(0x066a, 0x0003);
    w16(0x066c, 0x0001);
    w16(0x066e, 0x0001);
  }
  let moving = (flags() & 0x0800) !== 0;
  if (!moving) {
    const held = r16(R.player_active_held);
    if (held & 0x0800) {
      if (r16(0x066c) !== 0x0001) {
        setFlags(flags() | 0x0800);
        w16(0x06bb, 0xffff);
        w16(0x0668, 0x0010);
        moving = true;
      }
    } else if (held & 0x0400) {
      if (r16(0x066c) !== r16(0x066a)) {
        setFlags(flags() | 0x0800);
        w16(0x06bb, 0x0001);
        w16(0x0668, 0x0010);
        moving = true;
      }
    } else if (r16(R.player_active_pressed) & C.input_ABXY_start) {
      w16(0x06a3, r16(0x06a3) & 0xfbff);
      w16(0x079c, ptr("CODE_B4A5E7"));
    }
  }
  if (moving) {
    // CODE_B4A533
    w8(0x06b6, (r8(0x06b6) + r16(0x06bb)) & 0xff);
    if (add16(0x0668, -1) === 0) {
      sound(SND_MENU_MOVE);
      setFlags(flags() & 0xf7ff);
      w16(0x066c, (r16(0x066c) + r16(0x06bb)) & 0xffff);
    }
  }
  // CODE_B4A5CC
  CODE_BAC7C0();
  w16(0xc8, 0x03fc);
  CODE_B49C4D();
  reg.x = 0x07a5;
  CODE_B4BB62();
  sprite_handler();
  CODE_B4AE85();
  skipFrameTail = true;
}

/** $B4A5E7 — the answer: right (next question or prize) or wrong. */
export function CODE_B4A5E7() {
  CODE_B4A0FD();
  CODE_B4BE0B();
  if (!(flags() & 0x0001)) return CODE_B4A7D8();
  setFlags(flags() & 0xfdff);
  const q = r16(0x079f);
  let text: number;
  const right = rom16(B4(q + 6)) === r16(0x066c);
  reg.c = rom16(B4(q + 6)) >= r16(0x066c);
  if (right) {
    sound(SND_MENU_SELECT);
    if ((r8(0x079e) - 1) & 0xffff) text = lang() ? ptr("DATA_F7FD38") : ptr("DATA_F70124");
    else text = lang() ? ptr("DATA_F7FD2C") : ptr("DATA_F70112");
    w16(0x06a3, r16(0x06a3) | 0x0800);
  } else {
    sound(SND_WRONG);
    text = lang() ? ptr("DATA_F7FD20") : ptr("DATA_F70100");
    w16(0x06a3, r16(0x06a3) & 0xf7ff);
  }
  w16(0x065c, text);
  reg.y = 0x0800;
  CODE_B49BE0();
  w16(0x079c, ptr("CODE_B4A673"));
  w16(0x064e, 0x0001);
}

/** $B4A673 — show the verdict; after the last right answer, the prize. */
export function CODE_B4A673() {
  CODE_B4A0FD();
  if (add16(0x064e, -1) !== 0) return CODE_B4A7D8();
  if (!(flags() & 0x0200)) {
    // CODE_B4A741
    CODE_B4A7E7();
    CODE_B4A0FD();
    setFlags((flags() | 0x0200) & 0xefff);
    w16(0x064e, 0x01f4);
    reg.a = 0x0001;
    CODE_B4BD95();
    if (r16(0x06a3) & 0x0800 && (r16(0x079e) & 0xff) === 0x0001) {
      // won: the prize flies to the Kong
      reg.a = (r16(0x0654) + 0x0007) & 0xffff;
      spawn_swanky_prize();
      const x = r16(R.alternate_sprite);
      const y = (((r16(0x0654) - 1) << 2) & 0xffff) >>> 0;
      w16(x + 0x06, rom16(B4(lo16(L("prize_spawn_x_positions")) + y)));
      w16(x + 0x0a, rom16(B4(lo16(L("prize_spawn_x_positions")) + 2 + y)));
    }
    return CODE_B4A7D8();
  }
  CODE_B4BDE7();
  add16(0x064e, 1);
  if (!(flags() & 0x0001)) return CODE_B4A7D8();
  setFlags((flags() | 0x1000) & 0xfffe);
  if (!(r16(0x06a3) & 0x0800)) {
    // wrong: back to the menu
    CODE_B4A11F();
    backToMenu();
    w16(0x06b5, r16(0x0670));
    return;
  }
  // CODE_B4A6CE
  const left = (r8(0x079e) - 1) & 0xff;
  w8(0x079e, left);
  if (left === 0) {
    // quiz won
    CODE_B49E3A();
    const x = world() - 1;
    w16(R.completed_swanky_dialogue + x, r16(R.completed_swanky_dialogue + x) | r16(0x0666));
    CODE_B4A11F();
    w16(0x06b5, r16(0x0670));
    backToMenu();
    CODE_B4974F();
    return;
  }
  // CODE_B4A70D: next question
  const q = (r16(0x079f) + 0x0008) & 0xffff;
  w16(0x079f, q);
  reg.x = rom16(B4(q));
  reg.a = 0x0006;
  reg.y = 0x0800;
  CODE_B4ADEB();
  w16(0x079c, ptr("CODE_B4A3EE"));
  w16(0x064e, 0x0001);
  setFlags(flags() & 0xfdff);
}

/** $B4A79F — spawn Swanky's prize A (game number index). Carry set if no slot. */
export function spawn_swanky_prize() {
  const idx = reg.a & 0xffff;
  reg.y = bus16(L("DATA_FF18CE") + ((idx << 1) & 0xffff));
  spawn_special_sprite_address();
  reg.a = idx;
  if (reg.c) return;
  const y = r16(R.alternate_sprite);
  w16(y + 0x42, idx);
  w16(y + 0x52, 0x001c);
  w16(y + 0x2e, 0x0003);
  w16(y + 0x24, 0xf900);
  w16(y + 0x48, 0x002a);
  w16(y + 0x4c, 0x0050);
  w16(y + 0x4e, 0x3000);
  reg.y = y;
  reg.a = 0x3000;
}

/** $B4A7D8 — A/B/X/Y/START: skip the wait. */
export function CODE_B4A7D8() {
  if (r16(R.player_active_pressed) & C.input_ABXY_start) w16(0x064e, 0x0001);
}

/** $B4A7E7 — upload the answer text ($7E4600) to the response window. */
export function CODE_B4A7E7() {
  dmaToVram(r16(0x0664), 0x4600, 0x7e, 0x0180);
}

/** $B4A815 — end of an action frame. */
export function CODE_B4A815() {
  frameEnd(true);
}

/** $B4A830 — walk to the golden barrel (Kong at X). */
export function move_kong_to_golden_barrel() {
  const x = reg.x;
  w16(x + 0x42, 0x0001);
  w16(x + 0x44, 0x0098);
  w16(x + 0x46, 0x0120);
}

// ---------------------------------------------------------------------------------------------
// Leaving

/** $B4A87F — the Kongs walk out with the goodbye text; then fade to the map. */
export function CODE_B4A87F() {
  walkOut(0xffff);
}

/** $B4AA79 — Klubba: same as CODE_B4A87F with a shorter first wait. */
export function CODE_B4AA79() {
  walkOut(0x012c);
}

function walkOut(firstWait: number) {
  const x = r16(R.inactive_kong_sprite);
  if (r16(x + 0x42) === 0) {
    w16(R.nmi_pointer, ptr("run_npc_exit"));
    if (r16(R.screen_brightness) === 0x000f) fadeOut();
    return;
  }
  if (add16(0x064e, -1) === 0) {
    if (flags() & 0x0200) {
      if (!(flags() & 0x1000)) {
        CODE_B4BDE7();
        add16(0x064e, 1);
        if (flags() & 0x0001) {
          setFlags((flags() | 0x1000) & 0xfffe);
          w16(0x064e, firstWait);
        }
      } else {
        CODE_B4BE0B();
        add16(0x064e, 1);
        if (flags() & 0x0001) {
          setFlags(flags() & 0xfdff);
          if (r16(R.nmi_pointer) !== ptr("run_npc_exit")) {
            w16(R.nmi_pointer, ptr("run_npc_exit"));
            if (firstWait === 0xffff) {
              if (r16(R.screen_brightness) === 0x000f) fadeOut();
            } else fadeOut();
          }
          return;
        }
      }
    } else {
      dmaToVram(r16(0x0662), TEXT_VRAM_BUFFER, 0x7e, 0x0180);
      w16(0x06d6, 0x0041);
      setFlags((flags() | 0x0200) & 0xefff);
      w16(0x064e, 0x0001);
      reg.a = 0x0001;
      CODE_B4BD8D();
    }
  }
  // CODE_B4A959
  if (r16(R.player_active_pressed) & C.input_ABXY_start && r16(R.screen_brightness) === 0x000f) {
    w16(0x064e, 0x0001);
    w16(R.nmi_pointer, ptr("run_npc_exit"));
    fadeOut();
  }
}

/** $B4A97C — (dead code) walk left. */
export function CODE_B4A97C() {
  const x = reg.x;
  w16(x + 0x42, 0x0001);
  w16(x + 0x44, 0xffd8);
  w16(x + 0x46, 0x0100);
}

/** $B4A98C — "leave" option: walk out to the right with a goodbye line. */
export function leave_npc_screen() {
  reg.x = r16(R.active_kong_sprite);
  CODE_B4A9CB();
  reg.x = r16(R.inactive_kong_sprite);
  CODE_B4A9CB();
  goodbye(lo16(lang() ? L("DATA_B4C867") : L("DATA_B4C551")));
}

function goodbye(table: number) {
  w16(0x079c, ptr("CODE_B4A87F"));
  w16(R.nmi_pointer, ptr("run_808D4E"));
  w16(0x064e, 0x0001);
  setFlags(flags() & 0xfdff);
  reg.x = npc();
  w16(0x065c, rom16(B4(table + npc())));
  reg.y = 0;
  CODE_B49BE0();
}

/** $B4A9CB */
export function CODE_B4A9CB() {
  const x = reg.x;
  w16(x + 0x42, 0x0001);
  w16(x + 0x44, 0x01c0);
  w16(x + 0x46, 0x0100);
}

/** $B4A9DB — Cranky's "leave": walk out to the left. */
export function CODE_B4A9DB() {
  reg.x = r16(R.active_kong_sprite);
  CODE_B4AA1A();
  reg.x = r16(R.inactive_kong_sprite);
  CODE_B4AA1A();
  goodbye(lo16(lang() ? L("DATA_B4C867") : L("DATA_B4C551")));
}

/** $B4AA1A */
export function CODE_B4AA1A() {
  const x = reg.x;
  w16(x + 0x42, 0x0001);
  w16(x + 0x44, 0xff40);
  w16(x + 0x46, 0x0100);
}

/** $B4AA2A — Klubba's "leave". */
export function CODE_B4AA2A() {
  reg.x = r16(R.active_kong_sprite);
  CODE_B4AA69();
  reg.x = r16(R.inactive_kong_sprite);
  CODE_B4AA69();
  w16(0x079c, ptr("CODE_B4AA79"));
  w16(R.nmi_pointer, ptr("run_808D4E"));
  w16(0x064e, 0x0001);
  reg.x = npc();
  w16(0x065c, rom16(B4((lang() ? L("DATA_B4C85D") : L("DATA_B4C547")) + npc())));
  reg.y = 0;
  CODE_B49BE0();
  w16(0x06a3, r16(0x06a3) | 0x0200);
}

/** $B4AA69 */
export function CODE_B4AA69() {
  const x = reg.x;
  w16(x + 0x42, 0x0001);
  w16(x + 0x44, 0x0070);
  w16(x + 0x46, 0x0050);
}

/** $B4AB6E — run_808D5F: the "not enough coins" answer, then the menu. */
export function CODE_B4AB6E() {
  reg.db = 0xb4;
  npcFrameStart();
  if (add16(0x064e, -1) === 0) {
    if (flags() & 0x0200) {
      if (!(flags() & 0x1000)) {
        CODE_B4BDE7();
        add16(0x064e, 1);
        if (flags() & 0x0001) {
          setFlags((flags() | 0x1000) & 0xfffe);
          w16(0x064e, 0x0208);
        }
      } else {
        CODE_B4BE0B();
        add16(0x064e, 1);
        if (flags() & 0x0001) {
          setFlags(flags() & 0xfdff);
          CODE_B4A11F();
          backToMenu();
          return actionFrameEnd();
        }
      }
    } else {
      // CODE_B4ABEA
      dmaToVram(r16(0x0664), 0x4600, 0x7e, 0x0180);
      reg.db = 0xb4;
      get_player_coin_count_npc();
      reg.x = 0x07a5;
      CODE_B4BD57();
      setFlags((flags() | 0x0200) & 0xefff);
      w16(0x064e, 0x0001);
      reg.a = 0x0001;
      CODE_B4BD8D();
    }
  }
  // CODE_B4AC3A
  if (r16(R.player_active_pressed) & C.input_ABXY_start) w16(0x064e, 0x0001);
  actionFrameEnd();
}

/** $B4AC48 */
function actionFrameEnd() {
  CODE_B4A0FD();
  CODE_B49EF1();
  frameEnd(false);
}

void ioR16;
void HDMA;
void add8;

register({
  CODE_B48B15,
  CODE_B48C6B,
  spawn_npc_hud_coin,
  CODE_B48C9D,
  CODE_B48D69,
  CODE_B48D8E,
  CODE_B48DB5,
  CODE_B491D7,
  CODE_B49266,
  CODE_B4935E,
  CODE_B49541,
  CODE_B49579,
  CODE_B495A8,
  CODE_B495D3,
  CODE_B49620,
  CODE_B496BB,
  CODE_B496C8,
  CODE_B49704,
  CODE_B49726,
  CODE_B4974F,
  CODE_B49875,
  CODE_B49886,
  CODE_B4990F,
  CODE_B4996E,
  CODE_B49978,
  CODE_B49AFC,
  CODE_B49B47,
  CODE_B49B55,
  CODE_B49B63,
  CODE_B49BDC,
  CODE_B49BE0,
  CODE_B49C4D,
  CODE_B49DEA,
  CODE_B49DFE,
  CODE_B49E12,
  CODE_B49E14,
  CODE_B49E26,
  CODE_B49E3A,
  CODE_B49E48,
  CODE_B49ED7,
  CODE_B49EF1,
  CODE_B49F1D,
  CODE_B49F61,
  CODE_B49FFD,
  CODE_B4A00D,
  CODE_B4A02D,
  CODE_B4A051,
  make_kong_jump_on_golden_barrel,
  CODE_B4A088,
  CODE_B4A0A8,
  CODE_B4A0B5,
  CODE_B4A135,
  get_player_coin_count_npc,
  CODE_B4A1E6,
  CODE_B4A26F,
  CODE_B4A288,
  CODE_B4A2A4,
  move_kong_to_funky_plane,
  CODE_B4A313,
  CODE_B4A333,
  make_kong_jump_on_funky_plane,
  CODE_B4A371,
  CODE_B4A391,
  CODE_B4A3EE,
  CODE_B4A483,
  CODE_B4A4D9,
  CODE_B4A5E7,
  CODE_B4A673,
  spawn_swanky_prize,
  CODE_B4A7D8,
  CODE_B4A7E7,
  CODE_B4A815,
  move_kong_to_golden_barrel,
  CODE_B4A87F,
  CODE_B4A97C,
  leave_npc_screen,
  CODE_B4A9CB,
  CODE_B4A9DB,
  CODE_B4AA1A,
  CODE_B4AA2A,
  CODE_B4AA69,
  CODE_B4AA79,
  CODE_B4AB6E,
});
// everything except the JSL entry points (run_8xxx frame routines, $B49BDC) returns with RTS
const JSL_ENTRIES = new Set([
  "CODE_B48B15", "CODE_B491D7", "CODE_B4935E", "CODE_B49886", "CODE_B4990F", "CODE_B49978",
  "CODE_B49B63", "CODE_B49BDC", "CODE_B49ED7", "CODE_B49F1D", "CODE_B4AB6E", "CODE_B49E48",
]);
for (const n of [
  "CODE_B48C6B", "spawn_npc_hud_coin", "CODE_B48C9D", "CODE_B48D69", "CODE_B48D8E", "CODE_B48DB5",
  "CODE_B49266", "CODE_B49541", "CODE_B49579", "CODE_B495A8", "CODE_B495D3", "CODE_B49620",
  "CODE_B496BB", "CODE_B496C8", "CODE_B49704", "CODE_B49726", "CODE_B4974F", "CODE_B49875",
  "CODE_B4996E", "CODE_B49AFC", "CODE_B49B47", "CODE_B49B55", "CODE_B49BE0", "CODE_B49C4D",
  "CODE_B49DEA", "CODE_B49DFE", "CODE_B49E12", "CODE_B49E14", "CODE_B49E26", "CODE_B49E3A",
  "CODE_B49EF1", "CODE_B49F61", "CODE_B49FFD", "CODE_B4A00D", "CODE_B4A02D", "CODE_B4A051",
  "make_kong_jump_on_golden_barrel", "CODE_B4A088", "CODE_B4A0A8", "CODE_B4A0B5", "CODE_B4A135",
  "get_player_coin_count_npc", "CODE_B4A1E6", "CODE_B4A26F", "CODE_B4A288", "CODE_B4A2A4",
  "move_kong_to_funky_plane", "CODE_B4A313", "CODE_B4A333", "make_kong_jump_on_funky_plane",
  "CODE_B4A371", "CODE_B4A391", "CODE_B4A3EE", "CODE_B4A483", "CODE_B4A4D9", "CODE_B4A5E7",
  "CODE_B4A673", "spawn_swanky_prize", "CODE_B4A7D8", "CODE_B4A7E7", "CODE_B4A815",
  "move_kong_to_golden_barrel", "CODE_B4A87F", "CODE_B4A97C", "leave_npc_screen", "CODE_B4A9CB",
  "CODE_B4A9DB", "CODE_B4AA1A", "CODE_B4AA2A", "CODE_B4AA69", "CODE_B4AA79",
]) if (!JSL_ENTRIES.has(n)) setRetMode(L(n), RET_RTS);
