/**
 * Bank $BB (part a) — sprite palette management.
 *
 * The 8 sprite palettes of CGRAM (colors $80-$FF) are shared by reference counting:
 * - `active_sprite_palettes_table` ($0B64): for each of the 8 slots, the ROM address (bank $FD) of
 *   the palette loaded there, 0 when free.
 * - `sprite_palette_reference_count` ($0B74): users of each slot. Negative = never shared.
 * A sprite's palette slot is stored in bits 9-11 of its `oam_property`. Uploads are queued in
 * `sprite_palette_dma` (16 entries of 4 bytes) and done by the NMI.
 *
 * The Kongs' palettes are special: the inactive Kong uses a darkened variant, and gas clouds or
 * invincibility tint them (CODE_BB8B66 picks the colors).
 */
import { r16, w16, rom16, io8, io16 } from "../../core/mem";
import { setRetMode, RET_RTS } from "../../core/hybrid";
import { reg, register } from "../../core/cpu";
import { L, R, C, sprite, sprite_palette_dma, level, DMA, PPU, CPU } from "../../core/sym";
import { throw_exception } from "../../gen/routines";
import { mergeBits, read16x } from "./bba_util";
import { cpuTime } from "../b80/b80a_util";

/**
 * Console cost per palette word of the two loops below, in master cycles (opcode fetches from
 * FastROM, WRAM data accesses, DRAM refresh included): LDA.l/STA,x/INX/INX/CPX/BNE = 140, plus
 * EOR #imm = 163. Together they match the 568,660 cycles CODE_BB886D takes on the original
 * (1876 words), which is about 417 scanlines: enough to move the end of a level load by a frame.
 */
const COPY_WORD_CYCLES = 140;
const INVERT_WORD_CYCLES = 163;

const SPRITE_PALETTE_TABLE = L("sprite_palette_table");
const PALETTE_BANK = (L("palette_data_bank") >> 16) & 0xff;
const GLOBAL_SPRITE_PALETTE = L("global_sprite_palette") & 0xffff;
const DIDDY_PALETTE = L("diddy_active_sprite_palette") & 0xffff;
const DIXIE_PALETTE = L("dixie_active_sprite_palette") & 0xffff;
const WRITABLE_PALETTE_START = L("writable_palette_data_start");
const WRITABLE_PALETTE_SIZE = L("writable_palette_data_end") - WRITABLE_PALETTE_START;
const UNUSED_WRITABLE_PALETTE_SIZE = L("unused_writable_palette_data_end") - WRITABLE_PALETTE_START;
const DOOR_PALETTES_SIZE = L("door_sprite_palettes_end") - L("door_sprite_palettes_start");
const WALL_SHIP_DECK_PALETTE = L("wall_ship_deck_sprite_palette");
const WALL_FOREST_LEFT_PALETTE = L("wall_forest_left_sprite_palette") & 0xffff;
const WRITABLE_PALETTE_RAM = R.writable_palette_ram;
const WRITABLE_PALETTE_ADDR_OFFSET = (WRITABLE_PALETTE_RAM - WRITABLE_PALETTE_START) & 0xffff;
const WRITABLE_PALETTE_RAM_BANK = (WRITABLE_PALETTE_RAM >> 16) & 0xff;

const PALETTES = R.active_sprite_palettes_table;
const REFCOUNT = R.sprite_palette_reference_count;

const RED = 0x001f;
const GREEN = 0x03e0;
const BLUE = 0x7c00;

/** $BB807F — A = palette id, X = color count / 4, Y = CGRAM color index. */
export function dma_sprite_palette_from_index() {
  w16(0x32, reg.x);
  reg.a = rom16(SPRITE_PALETTE_TABLE + ((reg.a << 1) & 0xffff));
  reg.x = r16(0x32);
  dma_palette();
}

/** $BB8089 — A = palette address in bank $FD, X = color count / 4, Y = CGRAM color index. DMA now. */
export function dma_palette() {
  io16(DMA.source, reg.a);
  io16(DMA.size, (reg.x << 3) & 0xffff); // 4 colors (8 bytes) per unit
  io16(DMA.settings, 0x2200); // to $2122 (CGRAM data), one register write once
  io8(DMA.source_bank, PALETTE_BANK);
  io8(PPU.cgram_address, reg.y & 0xff);
  io8(CPU.enable_dma, 0x01);
  reg.a = 0x2201; // B still holds the high byte of #$2200
}

/** $BB886D — rebuild the writable (RAM) palettes as inverted copies, for the inverted-palette effect. */
export function CODE_BB886D() {
  reg.x = 0;
  copy_writable_palettes_to_RAM();
  CODE_BB896A();
  for (let x = 0; x !== WRITABLE_PALETTE_SIZE; x += 2) {
    w16(WRITABLE_PALETTE_RAM + x, r16(WRITABLE_PALETTE_RAM + x) ^ 0xffff);
  }
  cpuTime((WRITABLE_PALETTE_SIZE >> 1) * INVERT_WORD_CYCLES);
  reg.x = WRITABLE_PALETTE_SIZE;
}

const tsb = (addr: number, a: number) => w16(addr, r16(addr) | a);
const asl = (v: number, n: number) => (v << n) & 0xffff;

/** Shared loop shape of the unused palette filters: transform each color from X up to `end`. */
function filterPalettes(src: number, end: number, color: (c: number) => number) {
  let x = reg.x & 0xffff;
  do {
    const v = color(rom16(src + x)) & 0xffff;
    w16(WRITABLE_PALETTE_RAM + x, v);
    reg.a = v;
    x = (x + 2) & 0xffff;
  } while (x !== end);
  reg.x = x;
}

/** $BB888F — (unused) bluish darkened sprite palettes, from X on. */
export function CODE_BB888F() {
  filterPalettes(WRITABLE_PALETTE_START, UNUSED_WRITABLE_PALETTE_SIZE, (c) => {
    let r = c & RED;
    w16(0x32, r);
    w16(0x34, ((r >> 1) + r) >> 1);
    const g = c & GREEN;
    w16(0x32, g);
    tsb(0x34, (((g >> 2) + g) >> 1) & GREEN);
    const b = c & BLUE;
    w16(0x32, b);
    r = (b >> 2) + b;
    if (r >= BLUE) r = BLUE;
    return (r & BLUE) | r16(0x34);
  });
  copy_writable_palettes_to_RAM();
  CODE_BB896A();
}

/** $BB88E3 — (unused) darkened sprite palettes: door palettes first, from X on. */
export function CODE_BB88E3() {
  filterPalettes(WALL_SHIP_DECK_PALETTE, DOOR_PALETTES_SIZE, (c) => {
    let a = c & RED;
    a = asl(a, 8) >> 2; // XBA, LSR, LSR
    w16(0x34, a);
    a = ((a >> 2) + r16(0x34)) & 0xffff;
    a = ((a >> 8) | (a << 8)) & 0xffff; // XBA
    w16(0x32, a & RED);
    a = (c & GREEN) >> 1;
    w16(0x34, a);
    a = (((a >> 2) + r16(0x34)) & 0xffff) & 0x01e0;
    tsb(0x32, a);
    return asl(a, 5) | r16(0x32);
  });
  CODE_BB8920();
}

/** $BB8920 — (unused) darkened sprite palettes, second part. */
export function CODE_BB8920() {
  filterPalettes(WALL_SHIP_DECK_PALETTE, UNUSED_WRITABLE_PALETTE_SIZE, (c) => {
    w16(0x32, (c & RED) >> 1);
    let a = (c >> 1) & 0x01e0;
    tsb(0x32, a);
    a = asl(a, 5);
    w16(0x34, a);
    a = (((c >> 1) & 0x3c00) + r16(0x34)) & 0xffff;
    return a | r16(0x32);
  });
  copy_writable_palettes_to_RAM();
  CODE_BB896A();
}

/** $BB895A — copy the writable palettes from ROM to RAM, from X up to their end. */
export function copy_writable_palettes_to_RAM() {
  let x = reg.x & 0xffff;
  let words = 0;
  do {
    reg.a = rom16(WRITABLE_PALETTE_START + x);
    w16(WRITABLE_PALETTE_RAM + x, reg.a);
    x = (x + 2) & 0xffff;
    words++;
  } while (x !== WRITABLE_PALETTE_SIZE);
  cpuTime(words * COPY_WORD_CYCLES);
  reg.x = x;
}

/** $BB896A */
export function CODE_BB896A() {
  reg.a = WALL_FOREST_LEFT_PALETTE;
  w16(0x7f9814, reg.a);
  w16(0x7f9904, reg.a);
}

/** Body shared by CODE_BB8979 and CODE_BB89E4 (identical code). */
function reddishDoorColor(c: number): number {
  w16(0x32, (c & RED) >> 2);
  let a = (c >> 1) & 0x01e0;
  tsb(0x32, a);
  a = asl(a, 5);
  return a | r16(0x32);
}

/** $BB8979 — (unused) reddish darkened sprite palettes: door palettes. */
export function CODE_BB8979() {
  filterPalettes(WALL_SHIP_DECK_PALETTE, DOOR_PALETTES_SIZE, reddishDoorColor);
  CODE_BB89A0();
}

/** $BB89A0 — (unused) reddish darkened sprite palettes, second part. */
export function CODE_BB89A0() {
  filterPalettes(WALL_SHIP_DECK_PALETTE, UNUSED_WRITABLE_PALETTE_SIZE, (c) => {
    w16(0x32, (c & RED) >> 1);
    let a = (c & GREEN) >> 1;
    w16(0x34, a);
    a = ((((a >> 1) + r16(0x34)) & 0xffff) >> 1) & GREEN;
    tsb(0x32, a);
    a = c >> 1;
    w16(0x34, a);
    a = ((((a >> 1) + r16(0x34)) & 0xffff) >> 1) & 0x1c00;
    return a | r16(0x32);
  });
  copy_writable_palettes_to_RAM();
  CODE_BB896A();
}

/** $BB89E4 — (unused) grayish sprite palettes: door palettes. */
export function CODE_BB89E4() {
  filterPalettes(WALL_SHIP_DECK_PALETTE, DOOR_PALETTES_SIZE, reddishDoorColor);
  CODE_BB8A0B();
}

/** $BB8A0B — (unused) grayish sprite palettes, second part. */
export function CODE_BB8A0B() {
  filterPalettes(WALL_SHIP_DECK_PALETTE, UNUSED_WRITABLE_PALETTE_SIZE, (c) => {
    let a = (c & RED) >> 1;
    w16(0x32, a);
    a = (((a >> 2) + r16(0x32)) & 0xffff) + 0x0004; // ADC without CLC: carry is clear here
    w16(0x32, a & 0xffff);
    a = (c & GREEN) >> 1;
    w16(0x34, a);
    a = ((((a >> 2) + r16(0x34)) & 0xffff) + 0x0060) & GREEN;
    tsb(0x32, a);
    a = (c & BLUE) >> 1;
    w16(0x34, a);
    a = ((((a >> 2) + r16(0x34)) & 0xffff) + 0x0c00) & BLUE;
    return a | r16(0x32);
  });
  copy_writable_palettes_to_RAM();
  CODE_BB896A();
}

/** $BB8A61 */
export function request_sprite_palette_global() {
  request_sprite_palette();
}

/** $BB8A65 */
export function request_palette_direct_global() {
  request_palette_direct();
}

/** $BB8A69 — A = palette id. */
export function request_sprite_palette() {
  reg.x = (reg.a << 1) & 0xffff;
  reg.a = rom16(SPRITE_PALETTE_TABLE + reg.x);
  request_palette_direct();
}

/**
 * $BB8A6F — A = palette address. Get a palette slot holding that palette, sharing an existing
 * copy when possible, else loading it into the first free slot. Returns A = slot << 8 (OAM
 * palette bits), X = slot*2, carry set if all slots were taken (slot 0 is used instead).
 */
export function request_palette_direct() {
  const wanted = reg.a & 0xffff;
  w16(R.selected_palette_data_address, wanted);
  let x = 0;
  for (;;) {
    const p = r16(PALETTES + x);
    if (p === 0) {
      // .free_slot_found: remember it, but first look for a shareable copy further on
      w16(0x5e, x);
      for (;;) {
        x += 2;
        if (x === 0x10) {
          CODE_BB8AF6();
          return;
        }
        if (r16(PALETTES + x) === wanted && !(r16(REFCOUNT + x) & 0x8000)) return slotFound(x);
      }
    }
    if (p === wanted && !(r16(REFCOUNT + x) & 0x8000)) return slotFound(x);
    x += 2;
    if (x === 0x10) break;
  }
  // every slot is busy
  reg.a = 0x0002;
  throw_exception();
  w16(R.exception_palette_address, r16(R.selected_palette_data_address));
  w16(REFCOUNT, (r16(REFCOUNT) + 1) & 0xffff);
  reg.x = 0;
  reg.a = 0;
  reg.c = true;
}

function slotFound(x: number) {
  w16(REFCOUNT + x, (r16(REFCOUNT + x) + 1) & 0xffff);
  reg.x = x;
  reg.a = (x << 8) & 0xffff;
  reg.c = false;
}

/** $BB8AE4 — A = palette address, X = sprite. Reload the sprite's palette slot with another palette. */
export function CODE_BB8AE4() {
  w16(R.selected_palette_data_address, reg.a);
  const slot = (r16(reg.x + sprite.oam_property) >> 8) & 0x000e;
  w16(0x5e, slot);
  reg.a = slot;
  CODE_BB8AF6();
  const x = reg.x;
  w16(REFCOUNT + x, (r16(REFCOUNT + x) - 1) & 0xffff);
}

/** $BB8AF6 — load `selected_palette_data_address` into palette slot $5E (queue the CGRAM upload). */
export function CODE_BB8AF6() {
  const inverted = (r16(level.effects) & C.inverted_sprite_palette_effect) !== 0;
  let x = (r16(R.current_palette_buffer_slot) << 2) & 0xffff;
  reg.x = x;
  CODE_BB8B66();
  let src = reg.a;
  if (inverted) src = (src + WRITABLE_PALETTE_ADDR_OFFSET) & 0xffff; // read the RAM copy instead
  w16(sprite_palette_dma.source_word + x, src);
  const color = ((r16(0x5e) << 3) + 0x0081) & 0xffff;
  const bank = inverted ? WRITABLE_PALETTE_RAM_BANK : PALETTE_BANK;
  w16(sprite_palette_dma.source_bank + x, (((color << 8) | (color >> 8)) & 0xffff) | bank);
  w16(R.current_palette_buffer_slot, (r16(R.current_palette_buffer_slot) + 1) & 0x000f);
  x = r16(0x5e);
  w16(REFCOUNT + x, (r16(REFCOUNT + x) + 1) & 0xffff);
  w16(PALETTES + x, r16(R.selected_palette_data_address));
  reg.x = x;
  reg.a = (((x << 8) | (x >> 8)) & 0xffff);
  reg.c = false;
}

/** $BB8B66 — A = the colors to upload for `selected_palette_data_address` (Kong tints applied). */
export function CODE_BB8B66() {
  w16(0x60, 0);
  // in a 2 player contest, player 2's Kongs use the palettes $3C bytes further
  if (r16(0x060d) === C.gamemode_2_player_contest && ((C.gamemode_2_player_contest - r16(0x060f) - 1) & 0xffff) === 0) {
    w16(0x60, 0x003c);
  }
  const sel = r16(R.selected_palette_data_address);
  const plus = (n: number) => {
    reg.a = (n + sel) & 0xffff;
  };
  const gasOrNormal = (normal: () => void) => {
    switch (r16(0x091c) & 0x0003) {
      case 0:
        return normal();
      case 1:
        return plus(0x0078); // blue gas
      case 2:
        return plus(0x0096); // red gas
      default:
        return plus(0x00b4); // purple gas
    }
  };
  // the inactive Kong: darkened palette (or gas tint)
  const inactive = () => gasOrNormal(() => (reg.a = (0x001e + sel + r16(0x60)) & 0xffff));
  // the active Kong: invincibility flash, gas tint or the normal palette
  const active = () => {
    if (r16(0x091a) & 0x8000) return plus(0x00d2);
    gasOrNormal(() => (reg.a = (sel + r16(0x60)) & 0xffff));
  };
  if (sel === DIDDY_PALETTE) return r16(R.active_kong_number) === 0 ? active() : inactive();
  if (sel === DIXIE_PALETTE) return r16(R.active_kong_number) === 0 ? inactive() : active();
  reg.a = sel;
}

/** $BB8BE9 — $72/$74 = the current sprite's spawn position from the level's placement data. */
export function get_sprite_position_in_level_data() {
  const x = r16(R.current_sprite);
  reg.x = x;
  const y = (((r16(x + sprite.placement_number) - 1) & 0xffff) << 3) & 0xffff;
  reg.y = y;
  // LDA ($F5),y / LDA ($F7),y with DB = $FE
  w16(0x72, read16x(0xfe0000 + r16(0xf5) + y));
  reg.a = read16x(0xfe0000 + r16(0xf7) + y);
  w16(0x74, reg.a);
}

/** $BB8C02 */
export function dereference_sprite_palette_global() {
  dereference_sprite_palette();
}

/** $BB8C06 — A = OAM property. Drop one reference to its palette slot; carry clear if now free. */
export function dereference_sprite_palette() {
  const x = (((reg.a >> 8) | (reg.a << 8)) & 0x000e);
  reg.x = x;
  reg.a = x;
  const n = (r16(REFCOUNT + x) - 1) & 0xffff;
  w16(REFCOUNT + x, n);
  if (n !== 0 && !(n & 0x8000)) {
    reg.c = true;
    return;
  }
  w16(PALETTES + x, 0);
  reg.c = false;
}

/** $BB8C19 — after a Kong swap, reapply both Kongs' palettes (normal vs darkened). */
export function CODE_BB8C19() {
  const x = r16(R.inactive_kong_sprite);
  reg.a = r16(PALETTES + ((r16(x + sprite.oam_property) >> 8) & 0x000e));
  reg.x = x;
  set_sprite_palette_direct();
  CODE_BB8C2C();
}

/** $BB8C2C */
export function CODE_BB8C2C() {
  const x = r16(R.active_kong_sprite);
  reg.a = r16(PALETTES + ((r16(x + sprite.oam_property) >> 8) & 0x000e));
  reg.x = x;
  set_sprite_palette_direct();
}

/** $BB8C40 */
export function set_sprite_palette_direct_global() {
  set_sprite_palette_direct();
}

/** $BB8C44 */
export function set_sprite_palette_global() {
  set_sprite_palette();
}

/** $BB8C48 — A = palette id, X = sprite. */
export function set_sprite_palette() {
  const spr = reg.x;
  reg.y = spr;
  reg.a = rom16(SPRITE_PALETTE_TABLE + ((reg.a << 1) & 0xffff));
  reg.x = spr;
  set_sprite_palette_direct();
}

/** $BB8C50 — A = palette address, X = sprite. Swap the sprite's palette for another one. */
export function set_sprite_palette_direct() {
  const spr = reg.x;
  reg.y = spr;
  w16(R.selected_palette_data_address, reg.a);
  const x = (r16(spr + sprite.oam_property) >> 8) & 0x000e;
  reg.x = x;
  if (r16(PALETTES + x) === GLOBAL_SPRITE_PALETTE) {
    // the global palette is never released
    w16(REFCOUNT + x, (r16(REFCOUNT + x) - 1) & 0xffff);
    return CODE_BB8C6E();
  }
  CODE_BB8C68();
}

/** $BB8C68 — Y = sprite. */
export function CODE_BB8C68() {
  // LDA.w sprite.oam_property,y: absolute, so it goes through the data bank
  reg.a = read16x((reg.db << 16) + ((reg.y + sprite.oam_property) & 0xffff));
  dereference_sprite_palette();
  CODE_BB8C6E();
}

/** $BB8C6E — Y = sprite. */
export function CODE_BB8C6E() {
  reg.a = r16(R.selected_palette_data_address);
  request_palette_direct();
  const spr = reg.y;
  reg.x = spr;
  reg.a = mergeBits(r16(spr + sprite.oam_property), reg.a, 0x0e00);
  w16(spr + sprite.oam_property, reg.a);
}

// These end with RTS (reached by JSR or by falling through from a JSR'd routine), but their
// generated stubs assume RTL: give the hybrid layer the right return kind for traps.
for (const name of ["CODE_BB888F", "CODE_BB88E3", "CODE_BB8979", "CODE_BB89E4", "CODE_BB8C68"]) setRetMode(L(name), RET_RTS);

register({
  dma_sprite_palette_from_index,
  dma_palette,
  CODE_BB886D,
  CODE_BB888F,
  CODE_BB88E3,
  CODE_BB8920,
  copy_writable_palettes_to_RAM,
  CODE_BB896A,
  CODE_BB8979,
  CODE_BB89A0,
  CODE_BB89E4,
  CODE_BB8A0B,
  request_sprite_palette_global,
  request_palette_direct_global,
  request_sprite_palette,
  request_palette_direct,
  CODE_BB8AE4,
  CODE_BB8AF6,
  CODE_BB8B66,
  get_sprite_position_in_level_data,
  dereference_sprite_palette_global,
  dereference_sprite_palette,
  CODE_BB8C19,
  CODE_BB8C2C,
  set_sprite_palette_direct_global,
  set_sprite_palette_global,
  set_sprite_palette,
  set_sprite_palette_direct,
  CODE_BB8C68,
  CODE_BB8C6E,
});
