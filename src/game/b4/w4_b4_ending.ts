/**
 * Bank $B4 — the ending: Cranky's talks around the credits and the "video game heroes" screen.
 *
 * All of these run as the NMI routine run_ending_monkey_museum, which calls CODE_B4BE60
 * (`JMP ($067D)`): $067D is the per-frame routine, $067F the routine to jump to once the screen
 * has faded out (`JMP ($067F)` from CODE_B48E6C).
 *
 * - After K. Rool's defeat in The Flying Krock (isle "krool fall" scene in bank $B5):
 *   CODE_B48DFA Cranky talks (6 pages) -> CODE_B49043 -> heroes screen (CODE_B4BEEF) ->
 *   CODE_B4C139 -> ending parade and credits (banks $80/$BA) -> CODE_BAB8FD -> CODE_B490D9 Cranky's
 *   last words (4 pages) -> CODE_B49122 restart from the Rareware logo.
 * - After Krocodile Kore (CODE_B4B208 in b4_map.ts): CODE_B49126 Cranky talks while the screen
 *   shakes (2 pages) -> CODE_B49188 -> heroes screen -> CODE_B491C5 -> init_secret_ending.
 * - From the map (L+R once seen, or beating the rival's DK coin record; b4_hero.ts): heroes
 *   screen -> CODE_B4C14E back to the map.
 *
 * The heroes screen shows Mario, Yoshi and Link on podiums ranked by DK coins (thresholds in
 * DATA_B4BED1 entries: x, y, podium animation, coin count), the Kong on the podium it earned,
 * and their DK coin counts as sprites (CODE_B4BC51).
 *
 * State: $0658 dialogue pages left, $065C dialogue table pointer (bank $F7), $064E frame timer,
 * $06A1 window flags (see b4_npc.ts), $06A5 bit 0 heroes text mode, bit 5 heroes screen, bit 11
 * screen shake (Kore), bit 3 shake phase; $0652 shake timer; $0660/$0676 saved active Kong and
 * game_state_flags; $0668/$066A/$066C Yoshi/Mario/Link sprites; $0670 the Kong's rank (1-4);
 * $07A8-$07AE OAM positions of the coin counts.
 */
import { r16, w16, io8, io16, rom16 } from "../../core/mem";
import { reg, register, callPtr } from "../../core/cpu";
import { frameEnded, setRetMode, RET_RTS, RET_RTL } from "../../core/hybrid";
import { L, R, C, CPU, PPU, HDMA } from "../../core/sym";
import {
  disable_screen,
  set_active_kong_global,
  set_fade_global,
  fade_screen_global,
  wait_for_next_nmi,
  set_nmi_and_wait,
  dma_queued_sprite_graphics,
  dma_queued_sprite_palette_global,
  CODE_BAC7C0,
  sprite_handler,
  sort_sprite_render_orders,
  restart_rareware_logo,
  CODE_BBC5AB,
  init_secret_ending,
  start_ending_parade,
  init_sprite_render_order_global,
  dma_palette,
  dma_sprite_palette_from_index,
  play_song,
  clear_vram_global,
  clear_wram_tables,
  vram_payload_handler_global,
  set_ppu_registers_global,
  init_npc_screen_kongs,
  spawn_special_sprite_index,
} from "../../gen/routines";
import { add16, dmaToVram, dbR16, longW16 } from "./b4_util";
import { CODE_B48C9D, CODE_B48D69, CODE_B48D8E, CODE_B48DB5, CODE_B49EF1 } from "./b4_npc";
import {
  CODE_B4ADDF,
  CODE_B4ADEB,
  CODE_B4BD57,
  CODE_B4BD8D,
  CODE_B4BDE7,
  CODE_B4BE0B,
  CODE_B4BDD6,
  reset_camera_and_bg_scroll,
  CODE_B4AE85,
} from "./b4_text";
import { CODE_B4AE58, CODE_B4AEAF } from "./b4_map";

const lo16 = (a: number) => a & 0xffff;
const ptr = (name: string) => lo16(L(name));
const lang = () => r16(R.language_select) !== 0;
const flags = () => r16(0x06a1);
const setFlags = (v: number) => w16(0x06a1, v & 0xffff);
const tsb = (a: number, v: number) => w16(a, r16(a) | v);
const trb = (a: number, v: number) => w16(a, r16(a) & ~v & 0xffff);

const P_B48E6C = ptr("CODE_B48E6C");
const P_B49043 = ptr("CODE_B49043");
const P_B49122 = ptr("CODE_B49122");
const P_B49188 = ptr("CODE_B49188");
const P_B491C5 = ptr("CODE_B491C5");
const P_B4BEEF = ptr("CODE_B4BEEF");
const P_B4C139 = ptr("CODE_B4C139");
const P_B4C14E = ptr("CODE_B4C14E");
const RUN_ENDING_MONKEY_MUSEUM = ptr("run_ending_monkey_museum");
const TEXT_VRAM_BUFFER = lo16(R.text_vram_buffer);
const TEXT_VRAM_BANK = R.text_vram_buffer >> 16;
const INPUT_ABXY_START = C.input_ABXY_start;
const HEROES_TABLE = ptr("DATA_B4BED1");
const RIVAL_COINS = [L("DATA_B4BED7"), L("DATA_B4BEDF"), L("DATA_B4BEE7")];
const INIT_DATA = ptr("npc_screen_init_data");

/** $B4BE60 — run_ending_monkey_museum's frame: `JMP ($067D)`. */
export function CODE_B4BE60() {
  callPtr(0xb4, r16(0x067d));
}

/** Kong family screen set up for Cranky with the given talk (CODE_B48C9D and the Kongs/props). */
function crankyScreen() {
  w16(R.npc_screen_type, 0);
  CODE_B48C9D();
  reg.x = 0;
  CODE_B48D69();
  reg.x = 0;
  CODE_B48D8E();
  CODE_B48DB5();
}

/** Start Cranky's talk: pages, first page, frame routine and what follows, fade in. */
function startTalk(pages: number, en: string, fr: string, next: number) {
  reg.x = pages;
  w16(0x0658, pages);
  w16(0x065c, ptr(lang() ? fr : en));
  CODE_B49080();
  w16(0x067d, P_B48E6C);
  w16(0x067f, next);
  reg.a = 0x0100;
  set_fade_global();
  w16(0x064e, 0x0001);
}

/** $B48DFA — The Flying Krock is down: Cranky's talk before the heroes screen and the credits. */
export function CODE_B48DFA() {
  disable_screen();
  tsb(R.visited_kong_family_members, 0x0040);
  trb(0x06a5, 0x0040);
  w16(0x0660, r16(R.active_kong_number));
  w16(0x0676, r16(R.game_state_flags));
  tsb(R.game_state_flags, 0x4000); // both Kongs on screen
  reg.a = 0;
  set_active_kong_global();
  crankyScreen();
  startTalk(0x0006, "DATA_F700B6", "DATA_F7FCCA", P_B49043);
  wait_for_next_nmi();
}

/**
 * $B48E6C — frame of Cranky's ending talks (and of the heroes screen text): show each page, open
 * and close the text window, the Kore screen shake, then fade out and `JMP ($067F)`.
 */
export function CODE_B48E6C() {
  reg.db = 0xb4;
  dma_queued_sprite_graphics();
  dma_queued_sprite_palette_global();
  if (add16(0x064e, -1) === 0) {
    if (!(flags() & 0x0200)) {
      // CODE_B48EC2: upload the page and open the window
      dmaToVram(r16(0x0662), TEXT_VRAM_BUFFER, TEXT_VRAM_BANK, 0x0180);
      setFlags((flags() | 0x0200) & 0xefff);
      w16(0x064e, 0x0001);
      reg.a = 0x0001;
      CODE_B4BD8D();
    } else if (!(flags() & 0x1000)) {
      // the window is open: hold the page for 600 frames once it is fully open
      CODE_B4BDE7();
      add16(0x064e, 1);
      if (flags() & 0x0001) {
        setFlags((flags() | 0x1000) & 0xfffe);
        w16(0x064e, 0x0258);
      }
    } else {
      // CODE_B48EAE: closing the window; when closed, next page
      CODE_B4BE0B();
      add16(0x064e, 1);
      if (flags() & 0x0001) {
        // CODE_B48FE9
        reg.db = 0xb4;
        CODE_B49EF1();
        CODE_B48FF4();
        return frameTail();
      }
    }
  }
  // CODE_B48F07: on the heroes screen seen from the map, a button skips the text
  if (r16(0x06a5) & 0x0020 && r16(0x067f) === P_B4C14E && r16(R.player_active_pressed) & INPUT_ABXY_START) {
    w16(0x0658, 0x0001);
    CODE_B48FF4();
  }
  fade_screen_global();
  CODE_B49EF1();
  if (r16(0x06a5) & 0x0800 && add16(0x0652, -1) === 0) {
    // Krocodile Kore: shake BG1 by 3 lines every 3 frames
    w16(0x0652, 0x0003);
    w16(0x06a5, r16(0x06a5) ^ 0x0008);
    io8(PPU.layer_1_scroll_y, r16(0x06a5) & 0x0008 ? 0x03 : 0x00);
    io8(PPU.layer_1_scroll_y, 0x00);
  }
  // CODE_B48F68
  if (r16(R.screen_brightness) === 0) {
    w16(0x06a5, r16(0x06a5) & 0xf7df);
    callPtr(0xb4, r16(0x067f));
    return;
  }
  frameTail();
}

/** $B48F79 — end of the frame: sprites, and on the heroes screen the DK coin counts. */
function frameTail() {
  CODE_BAC7C0();
  w16(0xc8, 0x03fc);
  if (r16(0x06a5) & 0x0020) {
    coinCount(rom16(RIVAL_COINS[0]), r16(0x07a8));
    coinCount(rom16(RIVAL_COINS[1]), r16(0x07aa));
    if (r16(0x0670) === 0x0004) coinCount(rom16(RIVAL_COINS[2]), r16(0x07ac));
    coinCount(r16(R.dk_coin_count), r16(0x07ae));
  }
  sprite_handler();
  sort_sprite_render_orders();
  CODE_B4AE85();
}

function coinCount(count: number, pos: number) {
  reg.a = count;
  reg.x = 0x07a5;
  CODE_B4BD57();
  reg.x = 0x07a5;
  reg.y = pos;
  CODE_B4BC51();
}

/** $B48FF4 — the page was closed: next page, or (last page) fade out / show the screen. */
function CODE_B48FF4() {
  setFlags(flags() & 0xfdff);
  if (add16(0x0658, -1) !== 0) {
    w16(0x064e, 0x0001);
    setFlags(flags() & 0xeffe);
    add16(0x065c, 2);
    CODE_B49080();
    return;
  }
  // CODE_B4901B: last page. Seen from the map, the heroes stay until a button is pressed.
  if (r16(0x067f) === P_B4C14E && !(r16(R.player_active_pressed) & INPUT_ABXY_START)) {
    io16(PPU.screens, 0x0011);
    return;
  }
  if (r16(R.screen_brightness) === 0x000f) {
    reg.a = 0x810f;
    set_fade_global();
  }
}

/** $B49043 — after the Krock talk: the heroes screen, then the ending parade. */
export function CODE_B49043() {
  toHeroes(P_B4C139, 0x0001, 0x0004, "DATA_F7844E", "DATA_F7FCD6");
}

/** $B49188 — after the Kore talk: the heroes screen, then the secret ending. */
export function CODE_B49188() {
  toHeroes(P_B491C5, 0x0021, 0x0002, "DATA_F7845C", "DATA_F7FCE4");
}

function toHeroes(next: number, heroesFlags: number, pages: number, en: string, fr: string) {
  w16(R.game_state_flags, r16(0x0676));
  w16(R.active_kong_number, r16(0x0660));
  w16(R.nmi_pointer, RUN_ENDING_MONKEY_MUSEUM);
  w16(0x067d, P_B4BEEF);
  w16(0x067f, next);
  w16(0x06a5, r16(0x06a5) | heroesFlags);
  w16(0x0658, pages);
  reg.a = ptr(lang() ? fr : en);
  w16(0x0672, reg.a);
  frameTail();
}

/**
 * $B49080 — render the current page ($065C) into the text buffer. On the heroes screen the
 * comment page depends on the Kong's rank ($0670), and after the Krock the last pages come from
 * DATA_F78456.
 */
export function CODE_B49080() {
  let y: number;
  const pages = r16(0x0658);
  const toParade = r16(0x067f) === P_B4C139;
  if ((pages === 0x0003 || (!toParade && pages === 0x0001)) && r16(0x06a5) & 0x0001) {
    // CODE_B49098: the rank comment
    y = ((((r16(0x0670) - 1) << 1) & 0xffff) + r16(0x065c)) & 0xffff;
    if (toParade) w16(0x065c, ptr(lang() ? "DATA_F7FCDE" : "DATA_F78456"));
  } else {
    y = r16(0x065c);
  }
  CODE_B4ADDF();
  reg.x = dbR16(y);
  reg.db = 0xb4;
  reg.a = 0x0006;
  reg.y = 0x0000;
  CODE_B4ADEB();
}

/** $B490D9 — after the credits: Cranky's last words, then the game restarts. */
export function CODE_B490D9() {
  crankyScreen();
  startTalk(0x0004, "DATA_F700C2", "DATA_F7FCF0", P_B49122);
  wait_for_next_nmi();
}

/** $B49122 */
export function CODE_B49122() {
  restart_rareware_logo();
}

/** $B49126 — Krocodile Kore is beaten: Cranky talks while the island shakes. */
export function CODE_B49126() {
  tsb(R.game_state_flags, 0x4000);
  reg.a = 0;
  set_active_kong_global();
  crankyScreen();
  startTalk(0x0002, "DATA_F700CA", "DATA_F7FCF8", P_B49188);
  w16(0x0652, 0x0001);
  w16(0x06a5, r16(0x06a5) | 0x0800);
  wait_for_next_nmi();
}

/** $B491C5 — after the Kore heroes screen: record the rival's DK coins, then the secret ending. */
export function CODE_B491C5() {
  CODE_B4AE58();
  w16(R.world_map_event_step_counter, 0);
  disable_screen();
  CODE_BBC5AB();
  init_secret_ending();
}

/** $B4BC51 — a DK coin count at OAM position Y: the coin icon (16x16), then tens and ones. */
export function CODE_B4BC51() {
  const x = reg.x;
  const tens = r16(x + 1) & 0xff;
  let y = (reg.y - 0x000c) & 0xffff;
  if (tens !== 0) y = (y - 0x0008) & 0xffff;
  // CODE_B4BC65: two columns of two 8x8 tiles each (character $00-$03, palette 6)
  const tile = (pos: number, attr: number) => {
    longW16(0xc8, pos);
    add16(0xc8, 2);
    longW16(0xc8, attr);
    add16(0xc8, -6);
  };
  tile(y, 0x3c00);
  tile((y + 0x0800) & 0xffff, 0x3c01);
  y = (y + 8) & 0xffff;
  tile(y, 0x3c02);
  tile((y + 0x0800) & 0xffff, 0x3c03);
  y = (y + 8) & 0xffff;
  const digit = (d: number) => {
    tile(y, 0x3e00 | ((d + 0x20) & 0xff));
    tile((y + 0x0800) & 0xffff, 0x3e00 | ((d + 0x2a) & 0xff));
  };
  if (tens !== 0) {
    digit(tens);
    y = (y + 8) & 0xffff;
  }
  // CODE_B4BD16
  digit(r16(x) & 0xff);
  reg.y = y;
  reg.a = r16(0xc8);
}

/** $B4BEEF — the video game heroes screen: load it, place the heroes on their podiums. */
export function CODE_B4BEEF() {
  io8(CPU.enable_interrupts, 0);
  init_sprite_render_order_global();
  trb(0x06a3, 0x8000);
  tsb(0x06a5, 0x0020);
  reg.a = ptr("global_sprite_palette");
  reg.y = 0x00f0;
  reg.x = 0x0004;
  dma_palette();
  reg.a = 0x00aa;
  reg.y = 0x00e0;
  reg.x = 0x0004;
  dma_sprite_palette_from_index();
  w16(0x065c, r16(0x0672));
  const next = r16(0x067f);
  if (next !== P_B4C139 && next !== P_B491C5) {
    reg.a = C.music_cranky;
    play_song();
  }
  CODE_B4BF3A();
}

/** $B4BF3A */
function CODE_B4BF3A() {
  disable_screen();
  clear_vram_global();
  CODE_BAC7C0();
  clear_wram_tables();
  reg.db = 0xb4;
  reset_camera_and_bg_scroll();
  CODE_B4BDD6();
  // HDMA channel 1: the text window
  io16(HDMA.settings + 0x10, 0x1202);
  io16(HDMA.source + 0x10, 0x06cf);
  io8(HDMA.source_bank + 0x10, 0);
  io8(HDMA.indirect_source_bank + 0x10, 0);
  reg.y = 0;
  const init = rom16(0xb40000 | INIT_DATA);
  reg.x = init;
  w16(0x0662, rom16(0xb40000 | (init + 0x10)));
  w16(0x0664, rom16(0xb40000 | (init + 0x12)));
  io16(PPU.oam_address, 0);
  io16(PPU.screen, 0x0080);
  w16(0xcc, 0xb4b4);
  reg.a = C.video_game_heros_vram_payload_id;
  vram_payload_handler_global();
  reg.a = C.video_game_heros_ppu_config_id;
  set_ppu_registers_global();
  reg.a = ptr("video_game_hero_screen_palette");
  reg.y = 0;
  reg.x = 0x0020;
  dma_palette();
  reg.a = 0x0100;
  set_fade_global();
  w16(0x0660, r16(R.active_kong_number));
  w16(R.active_kong_number, 0);
  init_npc_screen_kongs();
  w16(r16(R.inactive_kong_sprite) + 0x1c, 0xc000);
  reg.x = 0;
  CODE_B48D8E();
  let s = r16(R.alternate_sprite);
  w16(s + 0x12, r16(s + 0x12) & 0xbfff);
  w16(s + 0x06, 0x001c);
  w16(s + 0x0a, 0x00c3);
  const spawn = (id: number) => {
    reg.y = id;
    spawn_special_sprite_index();
    return r16(R.alternate_sprite);
  };
  w16(0x0668, spawn(C.special_sprite_spawn_id_0168)); // Yoshi
  w16(0x066a, spawn(C.special_sprite_spawn_id_0166)); // Mario
  w16(0x066c, spawn(C.special_sprite_spawn_id_016C)); // Link

  // rank the Kong: each hero whose coin count (entry +6) the Kong's DK coins do not reach
  // stays on a podium ahead of him
  let x = HEROES_TABLE;
  const tbl = (o: number) => dbR16(x + o);
  let coins = r16(R.dk_coin_count);
  if (coins !== 0) coins = (coins - 1) & 0xffff;
  /** CODE_B4C0E9 — sprite Y to the entry's position. */
  const place = (y: number) => {
    w16(y + 0x06, tbl(0));
    w16(y + 0x0a, tbl(2));
  };
  /** CODE_B4C0FD — the OAM position of the sprite's coin count. */
  const countPos = (y: number) => ((((r16(y + 0x0a) + 9) & 0xff) << 8) | (r16(y + 0x06) & 0xff));
  /** Put hero Y on the current podium; `own` = keep its own animation (it was beaten). */
  const hero = (y: number, own: boolean, out: number) => {
    place(y);
    w16(y + 0x42, own ? r16(y + 0x04) : tbl(4));
    w16(out, countPos(y));
    x = (x + 8) & 0xffff;
  };
  const kong = (rank: number) => {
    const y = r16(R.active_kong_sprite);
    place(y);
    w16(0x07ae, countPos(y));
    x = (x + 8) & 0xffff;
    w16(0x0670, rank);
  };
  if (coins >= tbl(6)) {
    // CODE_B4C09B: first place
    kong(1);
    hero(r16(0x066a), true, 0x07a8);
    hero(r16(0x0668), true, 0x07aa);
    hideLink();
  } else {
    hero(r16(0x066a), false, 0x07a8);
    if (coins >= tbl(6)) {
      // CODE_B4C0B2: second place
      kong(2);
      hero(r16(0x0668), true, 0x07aa);
      hideLink();
    } else {
      hero(r16(0x0668), false, 0x07aa);
      if (coins >= tbl(6)) {
        // CODE_B4C0C9: third place
        kong(3);
        hideLink();
      } else {
        // CODE_B4C04E: last
        hero(r16(0x066c), false, 0x07ac);
        const y = r16(R.active_kong_sprite);
        place(y);
        w16(0x066e, tbl(4));
        w16(0x07ae, countPos(y));
        w16(0x0670, 0x0004);
      }
    }
  }
  // CODE_B4C07B
  trb(0x06a1, 0x0200);
  CODE_B49080();
  w16(0x064e, 0x0064);
  w16(0x067d, P_B48E6C);
  reg.a = r16(0x0660);
  set_active_kong_global();
  wait_for_next_nmi();
}

/** CODE_B4C0DE — Link is off the podiums. */
function hideLink() {
  w16(r16(0x066c) + 0x1c, 0xc000);
}

/** $B4C139 — after the Krock's heroes screen: the ending parade (credits). */
export function CODE_B4C139() {
  disable_screen();
  trb(R.world_map_events, 0x0010);
  w16(R.world_map_event_step_counter, 0);
  CODE_BBC5AB();
  start_ending_parade();
}

/** $B4C14E — heroes screen seen from the map: back to the map. */
export function CODE_B4C14E() {
  tsb(0x06a3, 0x0040);
  w16(0x06af, 0);
  w16(0x06ad, 0);
  if (r16(R.world_number) === 0) w16(R.returning_map_node_number, r16(R.map_node_number));
  CODE_B4AEAF();
  w16(R.game_mode_pointer, ptr("CODE_8087D9"));
  reg.a = ptr("run_simple_game_mode");
  set_nmi_and_wait();
}

void frameEnded;
register({
  CODE_B4BE60,
  CODE_B48DFA,
  CODE_B48E6C,
  CODE_B49043,
  CODE_B49080,
  CODE_B490D9,
  CODE_B49122,
  CODE_B49126,
  CODE_B49188,
  CODE_B491C5,
  CODE_B4BC51,
  CODE_B4BEEF,
  CODE_B4C139,
  CODE_B4C14E,
});
for (const n of ["CODE_B49080", "CODE_B4BC51"]) setRetMode(L(n), RET_RTS);
for (const n of [
  "CODE_B4BE60", "CODE_B48DFA", "CODE_B48E6C", "CODE_B49043", "CODE_B490D9", "CODE_B49122",
  "CODE_B49126", "CODE_B49188", "CODE_B491C5", "CODE_B4BEEF", "CODE_B4C139", "CODE_B4C14E",
]) setRetMode(L(n), RET_RTL);
