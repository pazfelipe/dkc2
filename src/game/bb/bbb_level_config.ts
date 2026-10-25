/**
 * Bank $BB (part b) — level configuration parsing and the level-load steps that build the
 * level's tilemap copy and the sprite placement grid.
 *
 * Level configs live in bank $FD (pointer per level in DATA_FD0000):
 *   type (word); [bonus type (byte) for bonus levels]; tileset config pointer (word);
 *   layout number (byte); camera parameter pairs (word + byte) until a zero word;
 *   animal (byte); unknown_38 (word); camera control (byte);
 *   entrances: 5-byte records (direction byte, x, y) until $FF;
 *   then destinations (words until one with bit 15 set), extra unlock level (word),
 *   extra unlock list (word, its address is kept).
 * The tileset config (also bank $FD) gives graphics/DMA init numbers, song, slope/init
 * routines, NMI/game sub modes, PPU config / VRAM payload, tileset type and effects.
 *
 * The placement grid: the level is cut into 256x256 cells (`RAM_0B88` cells wide, `$0B8A` high);
 * every placement is added to every cell whose screen-sized neighbourhood (its activation
 * radius) can see it. The per-cell lists are built as linked lists in $7F0000 and then flattened
 * into `sprite_spawn_lists` ($7E5A12), whose offsets are stored per cell in
 * `sprite_spawn_list_table` ($0BA6). Spawn groups get their member lists after that.
 */
import { r8, r16, w8, w16, rom16, busW16, io8, ioR16 } from "../../core/mem";
import { reg, register, callPtr } from "../../core/cpu";
import { setRetMode, RET_RTS, RET_RTL } from "../../core/hybrid";
import { L, R, C, CPU, rel_level } from "../../core/sym";
import { throw_exception, decompress_data } from "../../gen/routines";
import { read16x, chargeOps } from "./bba_util";

const FD = 0xfd0000;
const LEVEL_CONFIGS = L("DATA_FD0000");
const LAYOUT_SIZES = L("DATA_BBB241"); // (width, height) in pixels per layout shape
const LAYOUT_COPY = L("DATA_BBB265");
const PLACEMENTS = L("DATA_FE0000");
const RADIUS = L("activation_radius_left_table");
const RADIUS_BOTTOM_ROW0 = RADIUS + 6;
const LAYOUTS = 0xb50000;

const fd16 = (y: number) => rom16(FD + (y & 0xffff));
const fe16 = (y: number) => rom16(0xfe0000 + (y & 0xffff));

// ---------------------------------------------------------------------------------------------
// Level config

/** $BBAF0C — A = entrance << 8 | level: load that level's config into level[0]. */
export function CODE_BBAF0C() {
  reg.x = 0x0515; // level[0]
  CODE_BBAF0F();
}

/** $BBAF0F — A = entrance << 8 | level, X = level record. Carry set for NPC/map levels. */
export function CODE_BBAF0F() {
  const x = reg.x;
  const a = reg.a & 0xffff;
  w16(0x34, a);
  w16(0x32, a >> 8);
  const savedDb = reg.db;
  reg.db = 0xfd;
  let y = rom16(LEVEL_CONFIGS + ((a & 0xff) << 1));
  const type = fd16(y);
  y = (y + 2) & 0xffff;
  w16(x + rel_level.type, type);
  reg.a = type;
  reg.y = y;
  switch (type) {
    case C.bonus_level_type:
      w8(x + rel_level.bonus_type, fd16(y) & 0xff);
      reg.y = (y + 1) & 0xffff;
      return handleNormal(x, savedDb);
    case C.normal_level_type:
    case C.small_level_type:
    case C.boss_level_type:
    case C.sub_level_type:
      return handleNormal(x, savedDb);
    case C.npc_level_type:
    case C.map_level_type:
      reg.db = savedDb;
      reg.c = true;
      return;
  }
  reg.db = savedDb;
  reg.c = false;
}

function handleNormal(x: number, savedDb: number) {
  CODE_BBAFE1();
  CODE_BBB05C();
  CODE_BBB066();
  let y = reg.y;
  w16(x + rel_level.entrances_address, y);
  w16(x + rel_level.destination_count, 0);
  // skip to the wanted entrance ($32 = entrance number), counting the ones skipped
  while ((fd16(y + 5) & 0xff) !== 0xff) {
    const n = (r16(0x32) - 1) & 0xffff;
    w16(0x32, n);
    if (n & 0x8000) break;
    w16(x + rel_level.destination_count, (r16(x + rel_level.destination_count) + 1) & 0xffff);
    y = (y + 5) & 0xffff;
  }
  w8(x + rel_level.entrance_direction, fd16(y) & 0xff);
  w16(x + rel_level.layout_number, r16(0x38) & 0xff);
  // the tileset config
  reg.y = r16(0x36);
  CODE_BBB015();
  CODE_BBB034();
  CODE_BBB002();
  CODE_BBB043();
  CODE_BBB052();
  CODE_BBB077();
  w16(x + rel_level.entrance_x, fd16(y + 1));
  w16(x + rel_level.entrance_y, fd16(y + 3));
  // count the entrances after the chosen one and skip the list
  for (;;) {
    y = (y + 5) & 0xffff;
    if ((fd16(y) & 0xff) === 0xff) break;
    w16(x + rel_level.destination_count, (r16(x + rel_level.destination_count) + 1) & 0xffff);
  }
  reg.y = (y + 1) & 0xffff;
  reg.x = x;
  CODE_BBB095();
  CODE_BBB07F();
  CODE_BBB08F();
  reg.db = savedDb;
  reg.c = false;
}

/** $BBAFE1 — Y = config index: tileset config pointer ($36), layout ($38), camera parameters. */
export function CODE_BBAFE1() {
  let y = reg.y;
  w16(0x36, fd16(y));
  y += 2;
  w16(0x38, fd16(y));
  y += 1;
  reg.y = y & 0xffff;
  CODE_BBAFEE();
}

/** $BBAFEE — camera parameter pairs until a zero word. */
export function CODE_BBAFEE() {
  let y = reg.y;
  for (;;) {
    const a = fd16(y);
    if (a === 0) break;
    y += 2;
    w16(0x39, a);
    w16(0x3b, fd16(y));
    y += 1;
  }
  reg.a = 0;
  reg.y = (y + 2) & 0xffff;
}

/** $BBAFFF */
export function CODE_BBAFFF() {
  reg.y = (reg.y + 2) & 0xffff;
}

const field = (off: number, a: number) => w16(reg.x + off, a);
function word(): number {
  const a = fd16(reg.y);
  reg.y = (reg.y + 2) & 0xffff;
  reg.a = a;
  return a;
}
function byte(): number {
  const a = fd16(reg.y) & 0xff;
  reg.y = (reg.y + 1) & 0xffff;
  reg.a = a;
  return a;
}

/** $BBB002 */
export function CODE_BBB002() {
  const a = word();
  field(rel_level.ppu_config_number, a & 0xff);
  field(rel_level.vram_payload_number, a >> 8);
  reg.a = a >> 8;
}
/** $BBB015 */
export function CODE_BBB015() {
  field(rel_level.graphics_init_number, word());
  field(rel_level.dma_init_number, word());
  field(rel_level.song, word());
  w16(0x0a8e, word());
}
/** $BBB034 */
export function CODE_BBB034() {
  field(rel_level.slope_init_routine, word());
  field(rel_level.init_routine, word());
}
/** $BBB043 */
export function CODE_BBB043() {
  field(rel_level.nmi_sub_mode, word());
  field(rel_level.game_sub_mode, word());
}
/** $BBB052 */
export function CODE_BBB052() {
  field(rel_level.tileset_type, byte());
}
/** $BBB05C */
export function CODE_BBB05C() {
  field(rel_level.animal, byte());
}
/** $BBB066 */
export function CODE_BBB066() {
  field(rel_level.unknown_38, word());
  field(rel_level.camera_control, byte());
}
/** $BBB077 */
export function CODE_BBB077() {
  field(rel_level.effects, word());
}
/** $BBB07F */
export function CODE_BBB07F() {
  field(rel_level.extra_unlock_lvl_tmp, word());
}
/** $BBB08F — remember where the extra unlock list is. */
export function CODE_BBB08F() {
  reg.a = reg.y;
  field(rel_level.extra_unlocks_ptr, reg.y);
  reg.y = (reg.y + 2) & 0xffff;
}
/** $BBB095 — the destinations (exit -> level), until a word with bit 15 set. */
export function CODE_BBB095() {
  const base = reg.x;
  for (let i = 0; i < 8; i++) w16(base + rel_level.destination_slot_1 + i * 2, 0);
  let x = base;
  for (;;) {
    const a = fd16(reg.y);
    reg.y = (reg.y + 2) & 0xffff;
    reg.a = a;
    if (a & 0x8000) break;
    w16(x + rel_level.destinations, a);
    x = (x + 2) & 0xffff;
  }
  reg.x = base;
}
// CODE_BBB0A8 / CODE_BBB0AE are the loop of CODE_BBB095 (they end with its PLX).

// ---------------------------------------------------------------------------------------------
// Layout and tilemap

/** $BBB0B9 — level size in 256-pixel cells ($0B88 wide, $0B8A high) from the layout. */
export function CODE_BBB0B9() {
  w16(0x38, r16(0x98));
  w16(0x3a, r16(0x9a) & 0xff);
  const x = (r16(0x0b84) + 4) & 0xffff;
  const ln = r16(0x0525); // level[0].layout_number
  w16(0x32, (ln << 1) & 0xffff);
  w16(0x34, x);
  const idx = ((ln * 10) + x) & 0xffff;
  const shape = ((rom16(LAYOUTS + 8 + idx) << 2) & 0xffff);
  reg.x = shape;
  w16(0x0b88, rom16(LAYOUT_SIZES + shape) >> 3);
  reg.a = rom16(LAYOUT_SIZES + 2 + shape) >> 3;
  w16(0x0b8a, reg.a);
}

/** $BBB0FB — copy the level's 32x32 tilemap into $7F0000. */
export function CODE_BBB0FB() {
  reg.a = r16(0x0525);
  reg.x = 0;
  reg.y = 0x007f;
  CODE_BBB104();
}

/** $BBB104 — A = layout number, X/Y = destination address/bank: copy the layout's tilemap. */
export function CODE_BBB104() {
  const layout = reg.a & 0xffff;
  w16(0xd9, reg.x);
  w16(0xdb, (reg.y << 8) & 0xffff);
  w16(0x38, r16(0x98));
  w16(0x3a, r16(0x9a) & 0xff);
  let x = r16(0x0b84);
  w16(0x46, rom16(LAYOUTS + x) >> 5);
  x = (x + 2) & 0xffff;
  w16(0x48, rom16(LAYOUTS + x) >> 5);
  x = (x + 2) & 0xffff;
  w16(0x32, (layout << 1) & 0xffff);
  w16(0x34, x);
  x = (layout * 10 + x) & 0xffff;
  const l0 = rom16(LAYOUTS + x);
  const l2 = rom16(LAYOUTS + 2 + x);
  const l4 = rom16(LAYOUTS + 4 + x);
  const l6 = rom16(LAYOUTS + 6 + x);
  w16(0x52, l0 >> 5);
  w16(0x54, l4 >> 5);
  w16(0x4e, ((l2 - l0) & 0xffff) >> 5);
  w16(0x50, ((l6 - l4) & 0xffff) >> 5);
  const shape = rom16(LAYOUTS + 8 + x);
  w16(0x0ab4, shape);
  const s4 = (shape << 2) & 0xffff;
  w16(0x4a, rom16(LAYOUT_SIZES + s4));
  w16(0x4c, rom16(LAYOUT_SIZES + 2 + s4));
  reg.x = (shape << 1) & 0xffff;
  callPtr(0xbb, rom16(LAYOUT_COPY + reg.x));
  // source += the offset of the layout's window
  const lo = r16(0x32) + r16(0x38);
  w16(0x38, lo & 0xffff);
  w16(0x3a, (r16(0x34) + r16(0x3a) + (lo > 0xffff ? 1 : 0)) & 0xffff);
  const savedDb = reg.db;
  reg.db = r8(0xdc);
  w16(0x3c, r16(0xd9));
  reg.x = r16(0xd9);
  reg.y = 0;
  let ops = 30;
  do {
    ops += CODE_BBB1B3() + 14;
    CODE_BBB1C6();
    CODE_BBB1D5();
    w16(0x44, (r16(0x44) - 1) & 0xffff);
  } while (r16(0x44) !== 0);
  chargeOps(ops);
  reg.db = savedDb;
}

/** $BBB1B3 — copy one row ($42 bytes) from [$38] to DB:$3C. Returns the instruction count. */
export function CODE_BBB1B3(): number {
  let y = 0;
  let x = r16(0x3c);
  const src = r16(0x38) | (r8(0x3a) << 16);
  const end = r16(0x42);
  const bank = (reg.db & 0xff) << 16;
  let ops = 2;
  do {
    const v = read16x(src + y);
    busW16(bank | x, v);
    x = (x + 2) & 0xffff;
    y = (y + 2) & 0xffff;
    ops += 7;
  } while (y !== end);
  reg.x = x;
  reg.y = y;
  return ops;
}

/** $BBB1C6 — next source row. */
export function CODE_BBB1C6() {
  const lo = r16(0x3e) + r16(0x38);
  w16(0x38, lo & 0xffff);
  reg.a = (r16(0x3a) + (lo > 0xffff ? 1 : 0)) & 0xffff;
  w16(0x3a, reg.a);
}

/** $BBB1D5 — next destination row. */
export function CODE_BBB1D5() {
  reg.a = (r16(0x40) + r16(0x3c)) & 0xffff;
  w16(0x3c, reg.a);
}

/** $BBB1DD — A >>= 5 (pixels to 32-pixel tiles). */
export function CODE_BBB1DD() {
  reg.a = (reg.a & 0xffff) >> 5;
}

/** $BBB1E3 — copy (or decompress) the level's 32x32 tile definitions to $7F:($3C). */
export function CODE_BBB1E3() {
  const savedDb = reg.db;
  w16(0x38, r16(0x17b4));
  w16(0x3a, r8(0x9b));
  w8(0x9b, 0x80);
  let x = r16(0x3c);
  w16(0x17b4, x);
  if (r16(0x0b86) & 0x0020) {
    reg.db = 0xbb;
    reg.x = r16(0x38);
    reg.y = r16(0x3a);
    reg.a = r16(0x17b4);
    decompress_data();
    reg.db = savedDb;
    return;
  }
  const src = r16(0x38) | (r8(0x3a) << 16);
  let y = 0;
  let ops = 20;
  do {
    busW16(0x7f0000 | x, read16x(src + y));
    y = (y + 2) & 0xffff;
    x = (x + 2) & 0xffff;
    ops += 7;
  } while (x !== 0x9600);
  reg.x = x;
  reg.y = y;
  chargeOps(ops);
  reg.db = savedDb;
}

/** Layout window, horizontal layouts: start offset $32/$34 and row sizes. */
export function CODE_BBB277() {
  reg.a = r16(0x52);
  reg.x = r16(0x48);
  CODE_BBB2D5();
  windowCommon(0x54, 0x50, 0x4e, 0x48, 0x4c);
}
/** Same for vertical layouts. */
export function CODE_BBB2A4() {
  reg.a = r16(0x54);
  reg.x = r16(0x46);
  CODE_BBB2D5();
  windowCommon(0x52, 0x4e, 0x50, 0x46, 0x4a);
}
function windowCommon(add: number, len: number, count: number, srcRow: number, dstRow: number) {
  const lo = r16(add) + r16(0x32);
  w16(0x32, lo & 0xffff);
  w16(0x34, (r16(0x34) + (lo > 0xffff ? 1 : 0)) & 0xffff);
  // ASL $32 / ROL $34
  const v32 = r16(0x32);
  w16(0x32, (v32 << 1) & 0xffff);
  w16(0x34, ((r16(0x34) << 1) | (v32 >> 15)) & 0xffff);
  w16(0x42, (r16(len) << 1) & 0xffff);
  w16(0x44, r16(count));
  w16(0x3e, (r16(srcRow) << 1) & 0xffff);
  reg.a = (r16(dstRow) << 1) & 0xffff;
  w16(0x40, reg.a);
}

/** $BBB2D1 */
export function CODE_BBB2D1() {
  CODE_BBB2D5();
}

/** $BBB2D5 — 16x16 multiply with the hardware multiplier: $32-$35 = X * A (via $5E/$60). */
export function CODE_BBB2D5() {
  w16(0x5e, reg.x);
  w16(0x60, reg.a);
  const mul = (a: number, b: number) => {
    io8(CPU.multiply_A, a);
    io8(CPU.multiply_B, b);
    return ioR16(CPU.multiply_result);
  };
  w16(0x32, mul(r8(0x5e), r8(0x60)));
  w16(0x34, 0);
  let t = mul(r8(0x5f), r8(0x60)) + r16(0x33);
  w16(0x33, t & 0xffff);
  w16(0x35, t > 0xffff ? 1 : 0);
  t = mul(r8(0x5e), r8(0x61)) + r16(0x33);
  w16(0x33, t & 0xffff);
  w16(0x35, t > 0xffff ? 1 : 0);
  reg.a = (mul(r8(0x5f), r8(0x61)) + r16(0x34)) & 0xffff;
  w16(0x34, reg.a);
}

// ---------------------------------------------------------------------------------------------
// Placement grid

/** $BBB34D — build the placement grid and the spawn lists of the level. */
export function CODE_BBB34D() {
  CODE_BBB0B9();
  reg.x = 0x95fe;
  reg.a = 0;
  CODE_BBB356();
}

/** $BBB356 — X = offset: (continuation of CODE_BBB34D) clear $7F0000-$7F95FF and go on. */
export function CODE_BBB356() {
  let ops = 0;
  for (let x = reg.x; x > 0; x -= 2) {
    w16(0x7f0000 + x, 0);
    ops += 4;
  }
  w16(0x7f0000, 0);
  reg.x = 0x017e;
  chargeOps(ops + 3);
  CODE_BBB368();
}

/** $BBB368 — X = offset: (continuation) clear the cell table and the group lists, then build. */
export function CODE_BBB368() {
  let ops = 0;
  for (let x = reg.x; !(x & 0x8000); x = (x - 2) & 0xffff) {
    w16(0x0ba6 + x, 0);
    ops += 4;
  }
  for (let x = 0x01fe; x >= 0; x -= 2) {
    w16(0x7e7e12 + x, 0);
    ops += 4;
  }
  w16(0x7f0000, 0x0004); // next free list node
  w16(0x0b98, 0x0001); // placement number
  const savedDb = reg.db;
  reg.db = 0xfe;
  let y = rom16(PLACEMENTS + ((r16(R.level_number) << 1) & 0xffff));
  ops += 20;
  chargeOps(ops);
  if (y === 0) {
    reg.a = 0x0001;
    throw_exception();
    reg.db = savedDb;
    return;
  }
  for (;;) {
    const p = fe16(y) & 0xff;
    reg.a = p;
    if (p === 0) break;
    w16(0x32, p & 0x00f0);
    w16(0x0b8c, (fe16(y + 2) - 0x0100) & 0xffff);
    w16(0x0b92, (fe16(y + 4) - 0x0100) & 0xffff);
    reg.y = y;
    CODE_BBB3F7();
    reg.db = 0xfe;
    const g = fe16(y) & 0x1f00;
    if (g) {
      reg.a = g;
      CODE_BBB4FE();
      reg.db = 0xfe;
    }
    w16(0x0b98, (r16(0x0b98) + 1) & 0xffff);
    y = (y + 8) & 0xffff;
    chargeOps(28);
  }
  reg.y = y;
  CODE_BBB581();
  CODE_BBB518();
  reg.db = savedDb;
}

/** $BBB3F6 */
export function CODE_BBB3F6() {}

/** $BBB3F7 — $32 = radius row, $0B8C/$0B92 = position - 256: add the placement to every cell it can be seen from. */
export function CODE_BBB3F7() {
  reg.db = 0xbb;
  const x = r16(0x32);
  reg.x = x;
  const w = r16(0x0b88);
  const h = r16(0x0b8a);
  w16(0x0b8e, 0);
  let a = (r16(0x0b8c) - 0x0100 - rom16(RADIUS + x)) & 0xffff;
  if (a & 0x8000) a = 0;
  w16(0x36, a);
  let c = a >> 8;
  reg.a = c;
  if (c >= w) return;
  w16(0x0b8e, c);
  c = ((r16(0x36) + rom16(RADIUS + 2 + x)) & 0xffff) >> 8;
  if (c >= w) c = (w - 1) & 0xffff;
  w16(0x0b90, c);
  w16(0x0b94, 0);
  a = (r16(0x0b92) - 0x00e0 - rom16(RADIUS + 4 + x)) & 0xffff;
  if (a & 0x8000) a = 0;
  w16(0x36, a);
  c = a >> 8;
  reg.a = c;
  if (c >= h) return;
  w16(0x0b94, c);
  // (the original adds row 0's bottom value whatever the row: no ,x)
  c = ((r16(0x36) + rom16(RADIUS_BOTTOM_ROW0)) & 0xffff) >> 8;
  if (c >= h) c = (h - 1) & 0xffff;
  w16(0x0b96, c);
  w16(0x0b8c, r16(0x0b8e));
  w16(0x0b92, r16(0x0b94));
  CODE_BBB48C();
}

/** $BBB48C — walk the cell rectangle ($0B8E..$0B90 x $0B94..$0B96) row by row. */
export function CODE_BBB48C() {
  let ops = 0;
  for (;;) {
    ops += CODE_BBB4A0() + 6;
    if (r16(0x0b8c) !== r16(0x0b90)) {
      w16(0x0b8c, (r16(0x0b8c) + 1) & 0xffff);
      continue;
    }
    if (r16(0x0b92) === r16(0x0b96)) break;
    w16(0x0b92, (r16(0x0b92) + 1) & 0xffff);
    w16(0x0b8c, r16(0x0b8e));
    ops += 3;
  }
  reg.a = r16(0x0b92);
  chargeOps(ops);
}

/** $BBB4A0 — append placement $0B98 to the list of cell ($0B8C, $0B92). Returns instruction count. */
export function CODE_BBB4A0(): number {
  const row = r16(0x0b92);
  const m = ((((row & 0xff) << 8) | (row >> 8)) | r16(0x0b88)) & 0xffff;
  io8(CPU.multiply_A, m & 0xff);
  io8(CPU.multiply_B, m >> 8);
  const cell = ((ioR16(CPU.multiply_result) + r16(0x0b8c)) << 1) & 0xffff;
  reg.x = cell;
  const head = r16(0x0ba6 + cell);
  let ops = 13;
  if (head !== 0) {
    // CODE_BBB4BE: follow the list to its empty last node and fill it in
    let x = head;
    for (;;) {
      const n = r16(0x7f0000 + x);
      ops += 3;
      if (n === 0) break;
      x = n;
    }
    const free = r16(0x7f0000);
    w16(0x7f0000 + x, free);
    w16(0x7f0000, (free + 4) & 0xffff);
    reg.a = r16(0x0b98);
    w16(0x7f0002 + x, reg.a);
    reg.x = x;
    return ops + 9;
  }
  // CODE_BBB4DD: a new list: one node plus an empty last node
  const x = r16(0x7f0000);
  w16(0x0ba6 + cell, x);
  w16(0x7f0002 + x, r16(0x0b98));
  w16(0x7f0000 + x, (x + 4) & 0xffff);
  reg.a = (x + 8) & 0xffff;
  w16(0x7f0000, reg.a);
  reg.x = x;
  return ops + 11;
}

/** $BBB4FE — A = group id << 8: add placement $0B98 to the group's member slots ($7E7E12). */
export function CODE_BBB4FE() {
  let x = ((((reg.a >> 8) | (reg.a << 8)) & 0xffff) - 1) & 0xffff;
  x = (x << 4) & 0xffff;
  while (r16(0x7e7e12 + x) !== 0) x = (x + 2) & 0xffff;
  reg.a = r16(0x0b98);
  w16(0x7e7e12 + x, reg.a);
  reg.x = x;
}

/** $BBB518 — append the 32 group member lists after the cell lists; $0B9A = their index. */
export function CODE_BBB518() {
  const savedDb = reg.db;
  reg.db = 0x7e;
  const base = (r16(R.sprite_spawn_lists) + (R.sprite_spawn_lists & 0xffff)) & 0xffff;
  w16(0x0b9a, base);
  w16(0x32, base);
  w16(0x34, (base + 0x40) & 0xffff);
  let ops = 12;
  for (let g = 0; g < 0x20; g++) {
    let x = g << 4;
    if (r16(0x7e7e12 + x) === 0) {
      w16(0x7e0000 | r16(0x32), 0);
    } else {
      w16(0x7e0000 | r16(0x32), r16(0x34));
      for (let n = 8; n > 0; n--) {
        const a = r16(0x7e7e12 + x);
        if (a === 0) break;
        w16(0x7e0000 | r16(0x34), a);
        w16(0x34, (r16(0x34) + 2) & 0xffff);
        x += 2;
        ops += 9;
      }
      w16(0x7e0000 | r16(0x34), 0);
      w16(0x34, (r16(0x34) + 2) & 0xffff);
      ops += 8;
    }
    w16(0x32, (r16(0x32) + 2) & 0xffff);
    ops += 14;
    reg.x = g + 1;
  }
  reg.a = (r16(0x34) - (R.sprite_spawn_lists & 0xffff)) & 0xffff;
  w16(R.sprite_spawn_lists, reg.a);
  chargeOps(ops);
  reg.db = savedDb;
}

/** $BBB581 — flatten the cell lists into sprite_spawn_lists (word 0 = size). */
export function CODE_BBB581() {
  const savedDb = reg.db;
  reg.db = 0x7e;
  const LISTS = R.sprite_spawn_lists;
  let ops = 8;
  for (let x = 0x1ffe; x >= 0; x -= 2) {
    w16(LISTS + x, 0);
    ops += 4;
  }
  let y = 2;
  for (let x = 0x017e; x >= 0; x -= 2) {
    const head = r16(0x0ba6 + x);
    ops += 5;
    if (head === 0) continue;
    w16(0x0ba6 + x, y);
    let n = head;
    ops += 6;
    for (;;) {
      w16(LISTS + y, r16(0x7f0002 + n));
      y = (y + 2) & 0xffff;
      n = r16(0x7f0000 + n);
      ops += 7;
      if (n === 0) break;
    }
  }
  reg.a = y;
  reg.y = y;
  w16(LISTS, y);
  chargeOps(ops);
  reg.db = savedDb;
}

// JSR routines whose stubs were guessed as RTL, plus the RTS ones (traps need the right kind).
for (const n of [
  "CODE_BBAFE1", "CODE_BBAFEE", "CODE_BBAFFF", "CODE_BBB002", "CODE_BBB015", "CODE_BBB034", "CODE_BBB043", "CODE_BBB052",
  "CODE_BBB05C", "CODE_BBB066", "CODE_BBB077", "CODE_BBB07F", "CODE_BBB08F", "CODE_BBB095", "CODE_BBB0B9", "CODE_BBB0FB",
  "CODE_BBB104", "CODE_BBB1B3", "CODE_BBB1C6", "CODE_BBB1D5", "CODE_BBB1DD", "CODE_BBB1E3", "CODE_BBB277", "CODE_BBB2A4",
  "CODE_BBB2D5", "CODE_BBB34D", "CODE_BBB356", "CODE_BBB368", "CODE_BBB3F6", "CODE_BBB3F7", "CODE_BBB48C",
  "CODE_BBB4A0", "CODE_BBB4FE", "CODE_BBB518", "CODE_BBB581",
]) setRetMode(L(n), RET_RTS);
for (const n of ["CODE_BBAF0C", "CODE_BBAF0F", "CODE_BBB2D1"]) setRetMode(L(n), RET_RTL);

register({
  CODE_BBAF0C,
  CODE_BBAF0F,
  CODE_BBAFE1,
  CODE_BBAFEE,
  CODE_BBAFFF,
  CODE_BBB002,
  CODE_BBB015,
  CODE_BBB034,
  CODE_BBB043,
  CODE_BBB052,
  CODE_BBB05C,
  CODE_BBB066,
  CODE_BBB077,
  CODE_BBB07F,
  CODE_BBB08F,
  CODE_BBB095,
  CODE_BBB0B9,
  CODE_BBB0FB,
  CODE_BBB104,
  CODE_BBB1B3: () => void CODE_BBB1B3(),
  CODE_BBB1C6,
  CODE_BBB1D5,
  CODE_BBB1DD,
  CODE_BBB1E3,
  CODE_BBB277,
  CODE_BBB2A4,
  CODE_BBB2D1,
  CODE_BBB2D5,
  CODE_BBB34D,
  CODE_BBB356,
  CODE_BBB368,
  CODE_BBB3F6,
  CODE_BBB3F7,
  CODE_BBB48C,
  CODE_BBB4A0: () => void CODE_BBB4A0(),
  CODE_BBB4FE,
  CODE_BBB518,
  CODE_BBB581,
});
