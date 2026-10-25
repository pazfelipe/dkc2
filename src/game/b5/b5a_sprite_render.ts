/**
 * Bank $B5 (part A) — sprite rendering into the OAM buffer, and sprite graphics DMA queueing.
 *
 * OAM buffer: 128 entries of 4 bytes at $0200 (x, y, tile, attributes) and the 32-byte high
 * table at $0400 (2 bits per entry: x bit 8, large size). `next_oam_slot` ($70) is the next free
 * low-table entry; `$56` points into the high table (its high byte is preset to $04 by the caller).
 *
 * A sprite graphic (`sprite_graphic_table`, 3-byte pointers indexed by graphic number) starts
 * with a header followed by one (x, y) byte pair per tile:
 *   $36 number of 16x16 tiles, $37/$38 count/first tile of 8x8 group A, $39/$3A of group B,
 *   and for "dynamic" graphics (number >= $2C4, uploaded to VRAM on demand) also
 *   $3B tiles in the first DMA payload, $3C/$3D VRAM offset/tiles of a second payload.
 * Static graphics have a 5-byte header, dynamic ones 8 bytes, then the tile data.
 * The tile number of each OAM entry comes from the sprite's OAM property word ($32/$34).
 */
import { r8, w8, r16, w16, rom8, rom16, bus8, busW8, io8 } from "../../core/mem";
import { reg, register } from "../../core/cpu";
import { L, R, C, PPU, sprite } from "../../core/sym";

const SPRITE_GRAPHIC_TABLE = L("sprite_graphic_table");
const SPRITE_GRAPHIC_TABLE_BANK = L("sprite_graphic_table_bank");
const OAM_SIZE_BIT_MASKS = L("oam_size_bit_masks");
const OAM_XHIGH_BITS = L("DATA_B5A194"); // $01,$04,$10,$40 repeated: x bit 8 of entry n
const SPRITE_DMA = R.sprite_dma; // 8-byte entries: size, VRAM destination, source word, bank|$FF00
const SPRITE_DMA_SIZE = 8;
const DYNAMIC_START = C.dynamic_graphic_range_start; // $2C4
const DB_B5 = 0xb50000; // the renderer runs with DB = $B5 (PHK : PLB)

/** 8-bit read of tile data through the long pointer at $40 (x) or $44 (y = $40 + 1). */
const tileByte = (dp: number, y: number) => bus8(((r16(dp) | (r8(dp + 2) << 16)) + y) & 0xffffff);
/** 16-bit read through the long pointer at $40 (header words). */
const headerWord = (y: number) => tileByte(0x40, y) | (tileByte(0x40, y + 1) << 8);

/** `ORA ($56) : STA ($56)` with DB = $B5 (the high table is reached through the WRAM mirror). */
function orHighTable(bits: number) {
  const a = DB_B5 | r16(0x56);
  busW8(a, bus8(a) | bits);
}

/** Copy the graphic header into $36-$3B (static) or $36-$3D (dynamic); returns the tile data offset. */
function loadHeader(dynamic: boolean): number {
  w16(0x36, headerWord(0));
  w16(0x38, headerWord(2));
  w16(0x3a, headerWord(4));
  if (!dynamic) return 5;
  w16(0x3c, headerWord(6));
  return 8;
}

/** Y register after a tile renderer: offset just past the graphic's tile data. */
let tileY = 0;

/**
 * The tile renderer shared by all variants (CODE_B59DE4, CODE_B5A24E, CODE_B5A3ED, CODE_B5A5A1,
 * CODE_B5A752 differ only in the flips): emits the 16x16 tiles, then the two 8x8 groups, at the
 * sprite's screen position $72/$74. Offscreen tiles are skipped but still consume tile numbers.
 * Returns false when OAM is (about to be) full: the caller then stops rendering sprites.
 */
function renderTiles(y: number, flipX: boolean, flipY: boolean): boolean {
  const flipXMask = flipX ? 0xff : 0;
  const flipYMask = flipY ? 0xff : 0;
  // enough OAM entries left for the 16x16 tiles? (entry index + count must stay below 128)
  const slot = r16(R.next_oam_slot);
  const q = slot >> 2;
  if (!(((q & 0xff) + r8(0x36) + ((slot >> 1) & 1)) & 0x80)) {
    tileY = y;
    return false;
  }
  w8(0x56, ((q & 0xff) >> 2) & 0x1f); // high-table byte of this entry
  w8(0x3e, rom8(OAM_SIZE_BIT_MASKS + ((q & 0xff00) | (q & 3)))); // its 2-bit field (x high + size)
  let x = r16(R.next_oam_slot);
  let c = 0;

  // 16x16 tiles: large size bit set, tile numbers advance by 2 (+16 at the end of a VRAM row)
  for (;;) {
    const n = (r8(0x36) - 1) & 0xff;
    w8(0x36, n);
    if (n & 0x80) break;
    let a = (tileByte(0x44, y) ^ flipYMask) + r16(0x74) + c;
    a &= 0xffff;
    if (a < 0xf0) {
      w16(x + 1, (a - 0x10) & 0xffff);
      const sx = ((tileByte(0x40, y) ^ flipXMask) + r16(0x72)) & 0xffff;
      w8(x, sx);
      const mask = r8(0x3e);
      orHighTable(sx >= 0x100 ? mask : mask & 0xaa); // x bit 8 only when offscreen left/right
      if (mask & 0x80) {
        w8(0x56, (r8(0x56) + 1) & 0xff);
        w8(0x3e, 0x03);
      } else {
        w8(0x3e, (mask << 2) & 0xff);
      }
      w16(x + 2, r16(0x34));
      x = (x + 4) & 0xffff;
    }
    let t = (r16(0x34) + 2) & 0xffff;
    c = 0;
    if (t & 0x0010) {
      t += 0x10;
      c = t > 0xffff ? 1 : 0;
      t &= 0xffff;
    }
    w16(0x34, t);
    y = (y + 2) & 0xffff;
  }

  // the two groups of 8x8 tiles: small size, x bit 8 set per entry when needed
  for (const group of [0, 1]) {
    const countAddr = group === 0 ? 0x37 : 0x39;
    if (!((((x >> 2) & 0xff) + r8(countAddr) + ((x >> 1) & 1)) & 0x80)) {
      w16(R.next_oam_slot, x);
      tileY = y;
      return false;
    }
    w8(0x34, (r8(countAddr + 1) + r8(0x32)) & 0xff); // first tile of the group
    if (group === 0) {
      // flipped 8x8 tiles are anchored on the other side of their 16x16 cell
      if (flipX) w16(0x72, (r16(0x72) + 8) & 0xffff);
      if (flipY) w16(0x74, (r16(0x74) + 8) & 0xffff);
    }
    for (;;) {
      const n = (r8(countAddr) - 1) & 0xff;
      w8(countAddr, n);
      if (n & 0x80) break;
      const a = ((tileByte(0x44, y) ^ flipYMask) + r16(0x74)) & 0xffff;
      if (a < 0xf0) {
        w16(x + 1, (a - 0x10) & 0xffff);
        const sx = ((tileByte(0x40, y) ^ flipXMask) + r16(0x72)) & 0xffff;
        w8(x, sx);
        if (sx & 0x0100) {
          w16(0x54, x);
          const entry = (x & 0x01fc) >> 2;
          w8(0x56, (entry >> 2) & 0xff);
          orHighTable(rom8(OAM_XHIGH_BITS + entry));
        }
        w16(x + 2, r16(0x34));
        x = (x + 4) & 0xffff;
      }
      w16(0x34, (r16(0x34) + 1) & 0xffff);
      y = (y + 2) & 0xffff;
    }
  }
  w16(R.next_oam_slot, x);
  tileY = y;
  return true;
}

/** Load the sprite_graphic_table entry X into the pointers $40 (x bytes) and $44 (y bytes). */
function loadGraphicPointers(graphic: number) {
  const addr = rom16(SPRITE_GRAPHIC_TABLE + graphic);
  w16(0x40, addr);
  w16(0x44, (addr + 1) & 0xffff);
  const bank = rom16(SPRITE_GRAPHIC_TABLE_BANK + graphic); // high byte = render order bonus
  w16(0x42, bank);
  w16(0x46, bank);
  return bank;
}

// ---------------------------------------------------------------------------------------------
// Sprite DMA queue
// ---------------------------------------------------------------------------------------------

/**
 * $B59D3E — queue the VRAM upload of the dynamic graphic at $40/$42 (Y = offset of its tile
 * graphics after the header and tile list) into the sprite DMA buffer: one payload of $3B tiles
 * at the sprite's VRAM tile ($32), plus an optional second one ($3D tiles at +$3C).
 */
export function CODE_B59D3E() {
  const x = r16(R.next_sprite_dma_buffer_slot);
  const source = (reg.y + r16(0x40)) & 0xffff;
  w16(SPRITE_DMA + 4 + x, source);
  const size = ((r16(0x3b) & 0xff) << 5) & 0xffff;
  w16(SPRITE_DMA + x, size);
  const second = (size + source) & 0xffff;
  const dest = ((r16(0x32) & 0x01ff) << 4) & 0xffff;
  w16(SPRITE_DMA + 2 + x, dest);
  w16(SPRITE_DMA + 6 + x, r16(0x42) | 0xff00);
  const tilesB = r16(0x3d) & 0x000f;
  if (tilesB === 0) {
    w16(R.next_sprite_dma_buffer_slot, (x + SPRITE_DMA_SIZE) & 0xffff);
    w16(SPRITE_DMA + SPRITE_DMA_SIZE + 6 + x, 0); // terminator
    reg.y = second;
    return;
  }
  // .handle_dma_group_b
  w16(SPRITE_DMA + SPRITE_DMA_SIZE + x, (tilesB << 5) & 0xffff);
  w16(R.next_sprite_dma_buffer_slot, (x + 2 * SPRITE_DMA_SIZE) & 0xffff);
  w16(SPRITE_DMA + 2 * SPRITE_DMA_SIZE + 6 + x, 0);
  w16(SPRITE_DMA + SPRITE_DMA_SIZE + 2 + x, ((((r16(0x3c) & 0xff) << 4) + r16(SPRITE_DMA + 2 + x)) & 0xffff));
  w16(SPRITE_DMA + SPRITE_DMA_SIZE + 4 + x, second);
  w16(SPRITE_DMA + SPRITE_DMA_SIZE + 6 + x, r16(SPRITE_DMA + 6 + x));
  reg.y = second;
}

/**
 * $B59C00 — queue the current sprite's graphic for DMA without rendering it.
 * Carry set = DMA buffer full, nothing queued.
 */
export function CODE_B59C00() {
  const spr = r16(R.current_sprite);
  const graphic = r16(spr + sprite.current_graphic);
  reg.y = spr;
  reg.x = graphic;
  if (r16(R.next_sprite_dma_buffer_slot) >= r16(R.sprite_dma_buffer_limit)) {
    reg.c = true;
    return;
  }
  // .free_slot_in_buffer: remember it as uploaded
  w16(spr + 0x18, graphic);
  w16(spr + 0x16, graphic);
  w16(0x32, r16(spr + sprite.oam_property));
  w16(0x40, rom16(SPRITE_GRAPHIC_TABLE + graphic));
  w16(0x42, rom16(SPRITE_GRAPHIC_TABLE_BANK + graphic));
  w16(0x36, headerWord(0));
  w16(0x38, headerWord(2));
  w16(0x3a, headerWord(4));
  w16(0x3c, headerWord(6));
  // header size = (4 + tile counts) * 2: skip the header words and the tile list
  let c = 0;
  let a = 4;
  for (const n of [r8(0x36), r8(0x37), r8(0x39)]) {
    a += n + c;
    c = a > 0xff ? 1 : 0;
    a &= 0xff;
  }
  reg.y = a << 1;
  CODE_B59D3E();
  reg.c = false;
}

// ---------------------------------------------------------------------------------------------
// Rendering a sprite at an explicit position (fireworks, CODE_B59CAE)
// ---------------------------------------------------------------------------------------------

/**
 * $B59CCB — Y = sprite. Render it unflipped at screen position $72/$74 (already relative to
 * the sprite origin). Dynamic graphics are (re)queued for DMA when they changed.
 */
export function CODE_B59CCB() {
  const spr = reg.y;
  w16(0x32, r16(spr + sprite.oam_property));
  w16(0x34, r16(spr + sprite.oam_property));
  w8(0x56, (r8(R.next_oam_slot) >> 4) & 0x1f);
  let graphic = r16(spr + sprite.current_graphic);
  if (graphic === 0) return;
  if (graphic < 0x02c5) {
    // CODE_B59DAB: static graphic
    w16(spr + 0x18, graphic);
    loadGraphicPointers(graphic);
    renderTiles(loadHeader(false), false, false);
    reg.y = tileY;
    return;
  }
  // CODE_B59D14: dynamic graphic
  if (graphic !== r16(spr + 0x18)) {
    if (r16(R.next_sprite_dma_buffer_slot) < r16(R.sprite_dma_buffer_limit)) {
      // CODE_B59D26: upload the new graphic, then render it
      w16(spr + 0x18, graphic);
      w16(spr + 0x16, graphic);
      loadGraphicPointers(graphic);
      renderTiles(loadHeader(true), false, false);
      reg.y = tileY;
      CODE_B59D3E();
      return;
    }
    // no DMA room: keep showing the graphic that is in VRAM, if any
    graphic = r16(spr + 0x16);
    if (graphic === 0) return;
  }
  // CODE_B59D00
  loadGraphicPointers(graphic);
  renderTiles(loadHeader(true), false, false);
  reg.y = tileY;
}

/** $B59C52 — render the sprites queued in firework_sprite_buffer (after the main sprite pass). */
export function CODE_B59C52() {
  for (let x = r16(R.next_firework_sprite_buffer_slot); x !== 0; x = (x - 2) & 0xffff) {
    const spr = r16(R.next_firework_sprite_buffer_slot + x);
    if (r16(spr + sprite.display_mode) & 0x1000) {
      // world coordinates: cull against the screen
      const a = (r16(spr + sprite.y_position) - r16(R.screen_scroll_y_position) - 0x70) & 0xffff;
      w16(0x74, a);
      if (((a + 0x80) & 0xffff) >= 0x130) continue;
      const b = (r16(spr + sprite.x_position) - r16(R.screen_scroll_x_position) - 0x80) & 0xffff;
      w16(0x72, b);
      if (((b + 0xb0) & 0xffff) >= 0x160) continue;
    } else {
      // CODE_B59C91: screen coordinates
      w16(0x74, (r16(spr + sprite.y_position) - 0x70) & 0xffff);
      w16(0x72, (r16(spr + sprite.x_position) - 0x80) & 0xffff);
    }
    reg.y = spr;
    CODE_B59CCB();
  }
}

/** $B59CAE — A = y, X = x (12.4 fixed point), Y = sprite: render the sprite at that position. */
export function CODE_B59CAE() {
  w16(0x74, (((reg.a & 0xffff) >> 4) - 0x170) & 0xffff);
  w16(0x72, (((reg.x & 0xffff) >> 4) - 0x180) & 0xffff);
  CODE_B59CCB();
}

// ---------------------------------------------------------------------------------------------
// The world-sprite renderer
// ---------------------------------------------------------------------------------------------

/**
 * $B5A0E4 — after rendering a dynamic graphic: queue its VRAM upload if the graphic changed since
 * the last upload (one or two payloads, see CODE_B59D3E; same computation, written inline).
 */
function queueDynamicGraphic(y: number) {
  if (r16(R.next_sprite_dma_buffer_slot) >= r16(R.sprite_dma_buffer_limit)) return;
  const spr = r16(R.sprite_render_table + r16(0x62));
  const graphic = r16(spr + sprite.current_graphic);
  if (graphic === r16(spr + sprite.last_rendered_graphic)) return;
  w16(spr + sprite.last_rendered_graphic, graphic);
  let x = r16(R.next_sprite_dma_buffer_slot);
  y = (y + r16(0x40)) & 0xffff;
  w16(SPRITE_DMA + 4 + x, y);
  const size = ((r16(0x3b) & 0xff) << 5) & 0xffff;
  w16(SPRITE_DMA + x, size);
  w16(0x54, size);
  y = (y + size) & 0xffff;
  w16(SPRITE_DMA + 2 + x, ((r16(0x32) & 0x01ff) << 4) & 0xffff);
  w16(SPRITE_DMA + 6 + x, r16(0x42) | 0xff00);
  x = (x + SPRITE_DMA_SIZE) & 0xffff;
  w16(SPRITE_DMA + 6 + x, 0);
  const tilesB = r16(0x3d) & 0x000f;
  if (tilesB !== 0) {
    w16(SPRITE_DMA + x, (tilesB << 5) & 0xffff);
    w16(0x54, ((r16(0x3c) & 0xff) << 4) & 0xffff);
    w16(SPRITE_DMA + 2 + x, ((((r16(0x32) & 0x01ff) << 4) + r16(0x54)) & 0xffff));
    w16(SPRITE_DMA + 4 + x, y);
    w16(SPRITE_DMA + 6 + x, r16(0x42) | 0xff00);
    x = (x + SPRITE_DMA_SIZE) & 0xffff;
  }
  w16(R.next_sprite_dma_buffer_slot, x);
  w16(SPRITE_DMA + 6 + x, 0);
}

/** Sign-extended high byte of a sprite word (`LDA $xx,y : BMI : ORA #$FF / AND #$FF00 : XBA`). */
const highByteS = (v: number) => (v & 0x8000 ? 0xff00 : 0) | (v >> 8);

/**
 * Compute the sprite's screen position into $72/$74 and render it.
 * Returns false when OAM ran full (the whole sprite pass then ends).
 */
function renderOneSprite(spr: number): boolean {
  let graphic: number;
  if (r16(R.next_sprite_dma_buffer_slot) < r16(R.sprite_dma_buffer_limit)) {
    graphic = r16(spr + sprite.current_graphic);
  } else {
    // DMA buffer full: a new dynamic graphic cannot be uploaded, keep the old one
    graphic = r16(spr + sprite.current_graphic);
    if (graphic >= DYNAMIC_START + 1) graphic = r16(spr + sprite.last_rendered_graphic);
  }
  // .handle_positioning
  w16(spr + sprite.current_graphic_mirror, graphic);
  if (graphic === 0) return true;
  const bank = loadGraphicPointers(graphic);
  w16(spr + sprite.render_order_mirror, ((bank >> 8) + r16(spr + sprite.render_order)) & 0xffff);
  const mode = r16(spr + sprite.display_mode);
  if (!(mode & 0x8000)) {
    // world sprite: relative to the camera, culled when off screen
    const yy = ((r16(spr + sprite.y_position) - 0x80) & 0xffff) - r16(R.screen_scroll_y_position);
    const t = yy & 0xffff;
    w16(0x74, t);
    // ADC #$0090 still carries the "no borrow" of the subtraction
    if (((t + 0x90 + (yy >= 0 ? 1 : 0)) & 0xffff) >= 0x130) return true;
    // SBC with the carry clear from the compare above: one pixel less
    const sx = (r16(spr + sprite.x_position) - r16(R.screen_scroll_x_position) - 1) & 0xffff;
    w16(0x72, sx);
    if (((sx + 0x30) & 0xffff) >= 0x160) return true;
  } else if (mode & 0x4000) {
    // CODE_B5A068: not drawn by this pass (fireworks are queued for CODE_B59C52)
    if (mode & 0x2000) {
      const slot = r16(R.next_firework_sprite_buffer_slot);
      if (slot < 0x0010) {
        w16(R.firework_sprite_buffer + slot, spr);
        w16(R.next_firework_sprite_buffer_slot, slot + 2);
      }
    }
    w16(spr + sprite.current_graphic_mirror, r16(spr + sprite.last_rendered_graphic));
    return true;
  } else if (mode & 0x000f) {
    // CODE_B59FDD: world sprite with a signed pixel offset in bytes $50 (x) / $51 (y)
    const yy = ((highByteS(r16(spr + 0x50)) + r16(spr + sprite.y_position)) & 0xffff) - 0x80;
    const yy2 = (yy & 0xffff) - r16(R.screen_scroll_y_position);
    const t = yy2 & 0xffff;
    w16(0x74, t);
    if (((t + 0x90 + (yy2 >= 0 ? 1 : 0)) & 0xffff) >= 0x130) return true;
    const s = highByteS(r16(spr + 0x4f)) + r16(spr + sprite.x_position);
    const carry = s > 0xffff ? 1 : 0;
    const sx = ((s & 0xffff) - r16(R.screen_scroll_x_position) - (1 - carry)) & 0xffff;
    w16(0x72, sx);
    if (((sx + 0x30) & 0xffff) >= 0x160) return true;
  } else {
    // HUD sprite: already in screen coordinates
    w16(0x72, r16(spr + sprite.x_position));
    w16(0x74, (r16(spr + sprite.y_position) - 0x80) & 0xffff);
  }

  // .handle_flipping
  const prop = r16(spr + sprite.oam_property);
  w16(0x32, prop);
  w16(0x34, prop);
  const flipY = (prop & 0x8000) !== 0;
  const flipX = (prop & 0x4000) !== 0;
  w16(0x72, (r16(0x72) - (flipX ? 0x8f : 0x80)) & 0xffff);
  w16(0x74, (r16(0x74) + (flipY ? 1 : 0x10)) & 0xffff);
  const dynamic = graphic >= DYNAMIC_START;
  if (!renderTiles(loadHeader(dynamic), flipX, flipY)) return false;
  if (dynamic) queueDynamicGraphic(tileY);
  return true;
}

/** $B59F40 — render every sprite of sprite_render_table (in sorted order) into OAM. */
export function CODE_B59F40() {
  w8(0x56, (r8(R.next_oam_slot) >> 4) & 0x1f);
  w16(0x62, 0);
  w16(R.next_firework_sprite_buffer_slot, 0);
  // CODE_B59F53: one iteration per render table slot
  for (;;) {
    if (r16(R.next_oam_slot) === 0x0400) {
      // OAM completely full on entry to a slot
      io8(PPU.screen, 0x07);
      break;
    }
    const spr = r16(R.sprite_render_table + r16(0x62));
    if (r16(spr + sprite.type) !== 0) {
      if (!renderOneSprite(spr)) break; // OAM full: PLA : JMP CODE_B5A18A in the original
    }
    // .CODE_B5A17C
    w16(0x62, (r16(0x62) + 2) & 0xffff);
    if (r16(0x62) === 0x0032) break;
  }
  // CODE_B5A18A: %pea_engine_dbr : PLB : PLB
  reg.db = 0x80;
}

/**
 * $B5A8DA — one bubble pass forward and one backward over sprite_render_table (25 sprite
 * pointers), moving higher render_order_mirror values towards the front: earlier OAM entries are
 * drawn on top. The table is only partially sorted per frame; repeated frames converge.
 */
export function sort_sprite_render_orders() {
  const table = R.sprite_render_table;
  const end = R.sprite_render_table_end;
  let prev = r16(r16(table) + sprite.render_order_mirror);
  let x = table - 2;
  // .sort_forward_slot
  do {
    const next = r16(x + 4);
    const order = r16(next + sprite.render_order_mirror);
    const swap = order > prev;
    prev = order;
    if (swap) {
      w16(x + 4, r16(x + 2));
      w16(x + 2, next);
    }
    x += 2;
  } while (x !== end - 2);
  // .sort_backward_slot
  do {
    const before = r16(x);
    const order = r16(before + sprite.render_order_mirror);
    const keep = order >= prev;
    prev = order;
    if (!keep) {
      w16(x, r16(x + 2));
      w16(x + 2, before);
    }
    x -= 2;
  } while (x !== table - 2);
  w16(0x54, prev);
}

register({
  CODE_B59C00,
  CODE_B59C52,
  CODE_B59CAE,
  CODE_B59CCB,
  CODE_B59D3E,
  CODE_B59F40,
  sort_sprite_render_orders,
});
