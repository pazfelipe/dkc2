/**
 * Bank $B5 (part B) — terrain collision: "where is the ground under this point?".
 *
 * `get_sprite_terrain_info*` take a point (sprite position or explicit X/Y) in $32 (x - $100)
 * and $34 (y), and jump through `$17B2` to the collision routine of the current tileset
 * (set up by CODE_B5BCA8 from DATA_B5BC00). The routine returns in A the Y coordinate of the
 * ground surface + $6200 (or $FFC0 = no ground found), and in $AC/$AE the terrain attribute
 * bits of the tile found (slippery, sticky, ... and slope class in the low bits).
 *
 * The level is a map of 32x32 "chunks" ([$98]), each chunk is described by 2 collision tiles
 * (left/right 16 pixels) in the collision map ([$9C]). A collision tile's low byte selects a
 * height function (DATA_B5CA58: flat, slopes of various steepness, half blocks...) that turns the
 * x offset inside the tile into a surface height (0..$1F, $1F = full, negative = empty here).
 * The 5 map layouts differ only by how a (column,row) pair is turned into a chunk map index:
 *
 *   CODE_B5C510  row stride $20 (32 chunks wide maps), CODE_B5C414 stride $40,
 *   CODE_B5C60B  stride $A0, CODE_B5C70C stride $C0, CODE_B5C82C column-major (16 rows tall).
 *
 * Starting at the chunk containing the point, the search looks down up to two more chunks for
 * ground, or one chunk up when the starting chunk is solid all the way to its top.
 *
 * Direct-page temporaries are written exactly like the original: callers read $AC/$AE, and some
 * read $32/$A2/$A4.
 */
import { r8, r16, w16, rom8, rom16, bus8 } from "../../core/mem";
import { reg, register, callPtr } from "../../core/cpu";
import { setRetMode, RET_RTS } from "../../core/hybrid";
import { L, R, C, sprite } from "../../core/sym";

const ATTR_SLOPE_CLASS = L("DATA_B5C9B5"); // per slope id: attribute bits merged into $AC
const HEIGHT_FUNCS = L("DATA_B5CA58");
const STEEP_SLOPE = L("DATA_B5CDBE");

const neg = (v: number) => (v & 0x8000) !== 0;

/** Sets A and the N/Z flags as a load of `a` would. */
function retA(a: number) {
  a &= 0xffff;
  reg.a = a;
  reg.n = neg(a);
  reg.z = a === 0;
}

/** `LDA [dp],y`: 16-bit read through a 24-bit pointer stored at `dp`, index added with carry. */
function longIndexed16(dp: number, y: number): number {
  const ea = ((r16(dp) | (r8(dp + 2) << 16)) + y) & 0xffffff;
  return bus8(ea) | (bus8((ea + 1) & 0xffffff) << 8);
}

// =============================================================================================
// Entry points
// =============================================================================================

/** $B5C3D5 — terrain under (A, sprite Y): A = x position. */
export function get_sprite_terrain_info_y_origin_0() {
  const x = reg.x;
  w16(0x32, reg.a - 0x100);
  w16(0x34, r16(x + sprite.y_position));
  getTerrainInfo();
}

/** $B5C3E1 — terrain under the sprite X's position. */
export function get_sprite_terrain_info() {
  reg.a = r16(reg.x + sprite.y_position);
  get_sprite_terrain_info_define_y();
}

/** $B5C3E3 — terrain under (sprite X, A): A = y position. */
export function get_sprite_terrain_info_define_y() {
  w16(0x34, reg.a);
  reg.a = r16(reg.x + sprite.x_position);
  get_sprite_terrain_info_define_x();
}

/** $B5C3E7 — terrain under (A, $34): A = x position, $34 = y position. */
export function get_sprite_terrain_info_define_x() {
  w16(0x32, reg.a - 0x100);
  getTerrainInfo();
}

/** .get_terrain_info: DB = $B5 (left so on return), remember X in $62, run the tileset routine. */
function getTerrainInfo() {
  reg.db = 0xb5;
  w16(0x62, reg.x);
  callPtr(0xb5, r16(0x17b2));
}

// =============================================================================================
// Height of the ground inside one chunk
// =============================================================================================

/**
 * $B5C94D — chunk map index in Y, x offset in the chunk in $A6. Returns in A the surface height
 * in the chunk (0..$1F counted from the bottom, $FFFF/negative = no ground in this chunk), and
 * the collision tile's attributes in $AC. Y is preserved.
 */
export function CODE_B5C94D() {
  const yIn = reg.y;
  w16(0xa2, r16(0xa6));
  const chunk = longIndexed16(0x98, yIn);
  w16(0xa8, chunk);
  reg.x = yIn; // TYX
  if (chunk === 0) return noGround(yIn); // carry: left as the caller had it
  if (chunk & 0x4000) w16(0xa2, r16(0xa6) ^ 0x001f); // horizontally flipped chunk
  const id = chunk & 0x3fff;
  if (id >= r16(0xa0)) {
    reg.c = true; // CMP $A0; BCS
    return noGround(yIn); // outside the collision map: nothing solid
  }
  // 2 collision tiles per chunk: the right one for the right half
  let ti = (id << 2) & 0xffff;
  if (r16(0xa2) & 0x0010) ti += 2;
  let tile = longIndexed16(0x9c, ti);
  if (tile & 0x8000) w16(0xa2, r16(0xa2) ^ 0x000f); // mirrored collision tile
  reg.y = yIn;
  if (chunk & 0x4000) tile ^= 0x8000;
  w16(0xac, tile);
  const fn = tile & 0x00ff;
  if (fn === 0) {
    reg.c = false; // carry out of ASL ASL of the (14-bit) chunk id
    return noGround(yIn);
  }
  reg.x = fn << 1;
  const ptr = rom16(HEIGHT_FUNCS + (fn << 1));
  w16(0xaa, ptr);
  reg.a = r16(0xa2) & 0x000f;
  const f = heightFuncs.get(ptr);
  if (f) f();
  else callPtr(0xb5, ptr);
  let h = reg.a & 0xffff;
  reg.c = h >= 0x001f; // CMP #$001F
  if (!neg(h - 0x001f)) h = 0x001f;
  reg.a = h;
  reg.y = yIn;
}

function noGround(y: number) {
  reg.a = 0xffff;
  reg.x = y;
  reg.y = y;
}

// =============================================================================================
// Map layouts
// =============================================================================================

/** Chunk map index of (row, column), and the carry out of the last ADC computing it. */
type Index = (row: number, col: number) => [number, boolean];

/** Common prologue: $A6 = x in chunk, $A4 = row (negated y, chunk aligned), $32 = column * 2. */
function prologue() {
  w16(0xa6, r16(0x32) & 0x001f);
  w16(0xac, 0);
  w16(0xa4, (-(r16(0x34) - 0x100)) & 0xffe0);
  w16(0x32, (r16(0x32) & 0xffe0) >> 4);
}

/** Look up the chunk at index y, then copy $AC to $AE (the attributes of the first chunk). */
function firstChunk(y: number, carryIn: boolean): number {
  reg.y = y;
  reg.c = carryIn;
  CODE_B5C94D();
  w16(0xae, r16(0xac));
  return reg.a;
}

/** Look up the chunk at index y; the caller then does `CMP #$0000` (carry set). */
function chunkAt(y: number, carryIn: boolean): number {
  reg.y = y;
  reg.c = carryIn;
  CODE_B5C94D();
  reg.c = true;
  return reg.a;
}

/**
 * Row-major maps (CODE_B5C414/C510/C60B/C70C bodies): search the starting chunk, then up to two
 * chunks below (`stride` bytes further in the map), or the chunk above when the starting chunk
 * is full.
 */
function searchRowMajor(index: Index, stride: number) {
  prologue();
  let [y, cy] = index(r16(0xa4) ^ 0xffe0, r16(0x32));
  let h = firstChunk(y, cy);
  if (!neg(h)) {
    if (h !== 0x001f) return finish(h, h | r16(0xa4));
    // full chunk: maybe the ground continues in the chunk above
    const borrow = y < stride;
    y = (y - stride) & 0xffff;
    w16(0x32, r16(0xac));
    h = chunkAt(y, !borrow);
    if (neg(h)) {
      w16(0xac, r16(0x32)); // nothing above: keep this chunk's attributes, surface at its top
      return finish(0x001f, 0x001f | r16(0xa4));
    }
    return finish(h, ((h | 0x0020) + r16(0xa4)) & 0xffff);
  }
  for (let i = 0; i < 2; i++) {
    y = (y + stride) & 0xffff;
    const cy2 = r16(0xa4) >= 0x20;
    w16(0xa4, r16(0xa4) - 0x20);
    h = chunkAt(y, cy2);
    if (!neg(h)) return finish(h, h | r16(0xa4));
  }
  // no ground in 3 chunks
  w16(0xac, 0);
  reg.x = r16(0x62);
  reg.a = 0xffc0;
  reg.n = neg(reg.x);
  reg.z = reg.x === 0;
  reg.c = true;
}

/** Bit $2000 for the attribute classes $4001/$4004/$4005 (ignoring bit 15). */
function markSpecial(dp: number) {
  const t = r16(dp) & 0x7fff;
  if (t === 0x4004 || t === 0x4005 || t === 0x4001) w16(dp, r16(dp) | 0x2000);
}

/**
 * Shared tail ($B5C488 and copies): finalise $AC/$AE and turn the surface (row | height) in `a`
 * into the return value. `h` is the height inside the chunk (left in Y).
 */
function finishAttrs(h: number) {
  markSpecial(0xac);
  const ac = r16(0xac);
  w16(0x32, ac);
  const cls = ac & 0x003f;
  w16(0xac, ac & ~cls);
  let v = rom16(ATTR_SLOPE_CLASS + (cls << 1)) & 0x801f;
  if (neg(v)) {
    // classes only applied below the top of the tile
    if (h !== 0x000f) w16(0xac, r16(0xac) | (v & 0x001f));
  } else {
    w16(0xac, r16(0xac) | v);
  }
  markSpecial(0xae);
  reg.x = r16(0x62);
  reg.y = h;
}

function finish(h: number, a: number) {
  finishAttrs(h);
  const r = a + 0x6200;
  reg.c = r > 0xffff;
  reg.v = (~(a ^ 0x6200) & (a ^ r) & 0x8000) !== 0;
  retA(r);
}

function add16(a: number, b: number, c: boolean): [number, boolean] {
  const s = a + b + (c ? 1 : 0);
  return [s & 0xffff, s > 0xffff];
}

/** $B5C414 — maps with $40 bytes (32 chunks) per row. */
export function CODE_B5C414() {
  searchRowMajor((row, col) => add16((row << 1) & 0xffff, col, false), 0x40);
}

/** $B5C510 — maps with $20 bytes (16 chunks) per row. */
export function CODE_B5C510() {
  searchRowMajor((row, col) => add16(row, col, false), 0x20);
}

/** $B5C60B — maps with $A0 bytes per row (row * 5). */
export function CODE_B5C60B() {
  searchRowMajor((row, col) => {
    w16(0x36, row);
    const s = ((row << 2) & 0xffff) + row; // ASL ASL CLC ADC $36: its carry goes into the next ADC
    return add16(s & 0xffff, col, s > 0xffff);
  }, 0xa0);
}

/** $B5C70C — maps with $C0 bytes per row (row * 6). */
export function CODE_B5C70C() {
  searchRowMajor((row, col) => {
    const r2 = (row << 1) & 0xffff;
    w16(0x36, r2);
    const s = ((r2 << 1) & 0xffff) + r2;
    return add16(s & 0xffff, col, s > 0xffff);
  }, 0xc0);
}

/**
 * $B5C82C — column-major maps, 16 chunks ($20 bytes) per column, y clamped to the map: the
 * chunks below are the next words of the column, until the column ends.
 */
export function CODE_B5C82C() {
  w16(0xa6, r16(0x32) & 0x001f);
  w16(0xac, 0);
  let t = (r16(0x34) - 0x100) & 0xffff;
  if (neg(t)) t = 0;
  if (t >= 0x01ff) t = 0x01ff;
  w16(0xa4, (-t) & 0x01e0);
  w16(0x32, r16(0x32) & 0xffe0);
  const [y0, cy] = add16((r16(0xa4) ^ 0x01e0) >> 4, r16(0x32), false);
  let y = y0;
  let h = firstChunk(y, cy);
  if (!neg(h)) {
    if (h !== 0x001f) return finish82C(h, h | r16(0xa4));
    // full chunk: look at the chunk above (unless at the top of the column)
    if ((y & 0x001e) === 0) return finish82C(0x001f, 0x01ff);
    y = (y - 2) & 0xffff;
    w16(0x32, r16(0xac));
    h = chunkAt(y, true); // carry still set by the CMP #$001F that found the full chunk
    if (neg(h)) {
      w16(0xac, r16(0x32));
      return finish82C(0x001f, 0x001f | r16(0xa4));
    }
    return finish82C(h, ((h | 0x0020) + r16(0xa4)) & 0xffff);
  }
  for (let i = 0; i < 2; i++) {
    y = (y + 2) & 0xffff;
    if ((y & 0x001e) === 0) break; // bottom of the column (carry: from the last chunk lookup)
    const cy2 = r16(0xa4) >= 0x20;
    w16(0xa4, r16(0xa4) - 0x20);
    h = chunkAt(y, cy2);
    if (!neg(h)) return finish82C(h, h | r16(0xa4));
  }
  w16(0xac, 0);
  reg.y = y;
  reg.x = r16(0x62);
  reg.a = 0xffc0;
  reg.n = neg(reg.x);
  reg.z = reg.x === 0;
}

function finish82C(h: number, a: number) {
  finishAttrs(h);
  if (a === 0x01ff) a = 0x0800; // top of the map: report a surface far above
  const r = a + 0x6000;
  reg.c = r > 0xffff;
  reg.v = (~(a ^ 0x6000) & (a ^ r) & 0x8000) !== 0;
  retA(r);
}

/** $B5C80D — column-major maps where the Kongs (sprite slots up to $0E40) ignore $0100 tiles. */
export function CODE_B5C80D() {
  if (r16(R.current_sprite) > 0x0e40) return CODE_B5C82C();
  CODE_B5C82C();
  const a = reg.a;
  w16(0x32, a);
  const ac = r16(0xac);
  w16(0xac, ac & ~0x0100);
  if (ac & 0x0100) {
    w16(0xac, 0);
    retA(0xffc0);
    return;
  }
  retA(a);
}

// =============================================================================================
// Tileset specific wrappers
// =============================================================================================

/**
 * $B5C2DB — tileset $14: rising water/lava surface. $3A = surface from $0D54, $3C = 0x6300 - y.
 * A Kong (not Squawks) pushed up by the current never collides; otherwise the ground of the
 * 16-wide map is used, clipped against the surface.
 */
export function CODE_B5C2DB() {
  w16(0x3a, 0x6240 - r16(0x0d54));
  w16(0x3c, 0x6300 - r16(0x34));
  const vy = r16(R.water_current_y_velocity);
  if (!neg(vy) && vy !== 0) {
    const x = r16(R.current_sprite);
    reg.x = x;
    if (r16(x) < C.sprite_dixie_kong + 1 && r16(R.animal_type) !== C.sprite_squawks) {
      if (neg(r16(x + 0x24))) w16(x + 0x24, 0);
      w16(0xac, 0);
      w16(0xae, 0);
      return c2dbFloor();
    }
  }
  CODE_B5C510();
  const a = reg.a;
  w16(0xa2, a);
  if (neg(a)) return c2dbFloor(); // EOR #$FFFF; BPL
  const s3c = r16(0x3c);
  // SEC; ADC $3C with ~a: carry set when $3C >= a
  if (!(s3c >= a) && r16(0xae) === 0x0001) {
    if ((r16(0xe5) & 0xfeff) === 0) return c2dbRet(r16(0xa2));
    const d = s3c - r16(0x3a);
    if (d < 4) {
      w16(0xac, r16(0xac) | 0x0100);
      w16(0xae, r16(0xae) | 0x0100);
      w16(0xe5, r16(0xe5) | 0x0100);
      return c2dbRet(r16(0x3a));
    }
  }
  // CODE_B5C341
  const m = r16(0xe5) & 0x0100;
  w16(0xac, r16(0xac) | m);
  w16(0xae, r16(0xae) | m);
  const a2 = r16(0xa2);
  if (a2 >= 0x8000) return c2dbFloor();
  if (a2 < r16(0x3a)) return c2dbFloor();
  if (a2 >= s3c) {
    // returns with the flags of CMP $3C
    reg.a = a2;
    reg.n = neg(a2 - s3c);
    reg.z = a2 === s3c;
    reg.c = true;
    return;
  }
  if (neg((s3c - r16(0x3a)) - 0x50)) return c2dbRet(r16(0x3a));
  c2dbRet(a2);
}

const c2dbRet = retA;

/** CODE_B5C36A: under the surface: the surface is the ground when close enough. */
function c2dbFloor() {
  const m = r16(0xe5) & 0x0100;
  w16(0xac, r16(0xac) | m);
  w16(0xae, r16(0xae) | m);
  if (neg((r16(0x3c) - r16(0x3a)) - 0x50)) return retA(r16(0x3a));
  retA(0xffc0);
}


/** $B5C384 — tileset $0D (K. Rool duel): flat floor, lower beyond x = $2A0. */
export function CODE_B5C384() {
  w16(0xac, 0);
  w16(0xae, 0);
  retA(neg(r16(reg.x + sprite.x_position) - 0x02a0) ? 0x613f : 0x6300);
}

/** $B5C397 — tileset $10 (ship cabin): flat floor. */
export function CODE_B5C397() {
  w16(0xac, 0);
  w16(0xae, 0);
  retA(0x6140);
}

/** $B5C39F — tileset $0E (ice): with water ($0915), the frozen surface is solid ground. */
export function CODE_B5C39F() {
  if (r16(0x0915) === 0) return CODE_B5C60B();
  const wy = r16(R.water_y_position);
  if (!neg(wy - r16(0x34))) {
    w16(0x3a, ((wy ^ 0xffff) + 0x6301) & 0xffff);
    CODE_B5C60B();
    const a = reg.a;
    if (!neg(a) && !neg(a - r16(0x3a))) {
      reg.n = false;
      reg.z = a === r16(0x3a);
      reg.c = a >= r16(0x3a);
      return;
    }
  }
  // CODE_B5C3C5/C3C8: the water surface
  const r = ((wy ^ 0xffff) + 0x6301) & 0xffff;
  w16(0xac, 0);
  w16(0xae, 0);
  retA(r);
  reg.c = false;
}

/** $B5C3F4 — Kreepy Krow: no terrain on the upper floor until the fight gets there. */
export function CODE_B5C3F4() {
  const x = reg.x;
  if (neg(r16(x + 0x0a) - 0x0b50)) {
    const other = r16(0x0654);
    if (other === 0 || !neg(r16(other + 0x0a) - 0x0b50)) {
      reg.x = x;
      w16(0xac, 0);
      w16(0xae, 0);
      retA(0xffc0);
      return;
    }
  }
  reg.x = x;
  CODE_B5C414();
}

// =============================================================================================
// Height functions (DATA_B5CA58): A = x offset in the 16-pixel tile (0..15) -> surface height.
// =============================================================================================

const tsbAC = (m: number) => w16(0xac, r16(0xac) | m);
/** ($34 - 1) & $1F: y offset of the point inside the chunk. */
const yInChunk = () => (r16(0x34) - 1) & 0x001f;
const ret = (v: number) => {
  reg.a = v & 0xffff;
};
const FULL = 0x001f;
const NONE = 0xffff;

/** Solid only above the line height = 31 - $36 (diagonal walls/ceilings). */
function underCeiling(limit: number) {
  w16(0x36, limit);
  ret((yInChunk() ^ 0x001f) >= limit ? FULL : NONE);
}

/** $B5CAF8 */ export function CODE_B5CAF8() { underCeiling(reg.a & 0xffff); }
/** $B5CB0F */ export function CODE_B5CB0F() { underCeiling((reg.a + 0x10) & 0xffff); }
/** $B5CB2A */ export function CODE_B5CB2A() { ret(yInChunk() < 0x0f ? FULL : NONE); }
/** $B5CB3D */ export function CODE_B5CB3D() { underCeiling((reg.a << 2) & 0xffff); }
/** $B5CB56 */ export function CODE_B5CB56() { ret((reg.a & 0xffff) < 8 ? FULL : NONE); }
/** $B5CB63 */ export function CODE_B5CB63() { tsbAC(0x0200); ret(FULL); }
/** $B5CB6C */ export function CODE_B5CB6C() { tsbAC(0x0200); ret(0x000f); }
function narrowPost(limit: number) {
  if ((reg.a & 0xffff) < 4 && yInChunk() < limit) { tsbAC(0x1000); ret(FULL); }
  else ret(NONE);
}
/** $B5CB75 */ export function CODE_B5CB75() { narrowPost(0x18); }
/** $B5CB89 */ export function CODE_B5CB89() { narrowPost(0x10); }
/** $B5CB9D */ export function CODE_B5CB9D() { narrowPost(0x08); }
/** $B5CBBA */ export function CODE_B5CBBA() {
  if ((reg.a & 0xffff) < 4) { tsbAC(0x1000); ret(FULL); } else ret(0x0013);
}
/** $B5CBCC */ export function CODE_B5CBCC() {
  if ((reg.a & 0xffff) < 4) tsbAC(0x1400);
  ret(0x0013);
}
/** $B5CBDA */ export function CODE_B5CBDA() { tsbAC(0x0800); ret(0x000f); }
/** $B5CBE3 */ export function CODE_B5CBE3() {
  if ((reg.a & 0xffff) < 4) { tsbAC(0x1000); ret(FULL); } else ret(NONE);
}
/** $B5CBF5 */ export function CODE_B5CBF5() {
  if ((reg.a & 0xffff) < 4) { tsbAC(0x1000); ret(FULL); } else { tsbAC(0x0800); ret(0x000f); }
}
// flat heights
/** $B5CC0C */ export function CODE_B5CC0C() { ret(NONE); }
/** $B5CC10 */ export function CODE_B5CC10() { ret(0x1f); }
/** $B5CC14 */ export function CODE_B5CC14() { ret(0x1b); }
/** $B5CC18 */ export function CODE_B5CC18() { ret(0x17); }
/** $B5CC1C */ export function CODE_B5CC1C() { ret(0x13); }
/** $B5CC20 */ export function CODE_B5CC20() { ret(0x0f); }
/** $B5CC24 */ export function CODE_B5CC24() { ret(0x0b); }
/** $B5CC28 */ export function CODE_B5CC28() { ret(0x07); }
/** $B5CC2C */ export function CODE_B5CC2C() { ret(0x03); }
// slopes of 4 pixels per pixel (steep)
const x4 = () => (reg.a << 2) & 0xffff;
/** $B5CC30 */ export function CODE_B5CC30() { ret(x4() + 0x10); }
/** $B5CC37 */ export function CODE_B5CC37() { ret(x4()); }
/** $B5CC3A */ export function CODE_B5CC3A() { ret(x4() - 0x10); }
/** $B5CC41 */ export function CODE_B5CC41() { ret(x4() - 0x20); }
/** $B5CC48 */ export function CODE_B5CC48() { ret(x4() - 0x30); }
/** $B5CC4F */ export function CODE_B5CC4F() {
  const v = (x4() - 0x10) & 0xffff;
  ret(neg(v - 0x0f) ? v : 0x0f);
}
/** $B5CC5E */ export function CODE_B5CC5E() {
  const v = (x4() - 0x10) & 0xffff;
  ret(neg(v - 0x0f) ? 0x0f : v);
}
const x2 = () => (reg.a << 1) & 0xffff;
/** $B5CC6D */ export function CODE_B5CC6D() { const v = x2(); ret(neg(v - 0x0f) ? v : 0x0f); }
/** $B5CC77 */ export function CODE_B5CC77() { const v = x2(); ret(neg(v - 0x0f) ? 0x0f : v); }
// slopes of 2 pixels per pixel
/** $B5CC81 */ export function CODE_B5CC81() { ret(x2() + 0x18); }
/** $B5CC87 */ export function CODE_B5CC87() { ret(x2() + 0x10); }
/** $B5CC8D */ export function CODE_B5CC8D() { ret(x2() + 0x08); }
/** $B5CC93 */ export function CODE_B5CC93() { ret(x2()); }
/** $B5CC95 */ export function CODE_B5CC95() { ret(x2() - 0x08); }
/** $B5CC9B */ export function CODE_B5CC9B() { ret(x2() - 0x10); }
/** $B5CCA1 */ export function CODE_B5CCA1() { ret(x2() - 0x18); }
// 45 degree slopes
/** $B5CCA7 */ export function CODE_B5CCA7() { ret(reg.a - 0x0c); }
/** $B5CCAC */ export function CODE_B5CCAC() { ret(reg.a - 0x08); }
/** $B5CCB1 */ export function CODE_B5CCB1() { ret(reg.a - 0x04); }
/** $B5CCB6 */ export function CODE_B5CCB6() { ret(reg.a); }
/** $B5CCB7 */ export function CODE_B5CCB7() { ret(reg.a + 0x04); }
/** $B5CCBC */ export function CODE_B5CCBC() { ret(reg.a + 0x08); }
/** $B5CCC1 */ export function CODE_B5CCC1() { ret(reg.a + 0x0c); }
/** $B5CCC6 */ export function CODE_B5CCC6() { ret(reg.a + 0x10); }
/** $B5CCCB */ export function CODE_B5CCCB() { ret(reg.a + 0x14); }
/** $B5CCD0 */ export function CODE_B5CCD0() { ret(reg.a + 0x18); }
/** $B5CCD5 */ export function CODE_B5CCD5() { ret(reg.a + 0x1c); }
// 1.33 pixel per pixel slopes from DATA_B5CDBE (index in X)
function steep(add: number) {
  reg.x = reg.a & 0xffff;
  ret(rom8(STEEP_SLOPE + reg.x) + add);
}
/** $B5CCDA */ export function CODE_B5CCDA() { steep(0x1c); }
/** $B5CCE7 */ export function CODE_B5CCE7() { steep(0x18); }
/** $B5CCF4 */ export function CODE_B5CCF4() { steep(0x14); }
/** $B5CD01 */ export function CODE_B5CD01() { steep(0x10); }
/** $B5CD0E */ export function CODE_B5CD0E() { steep(0x0c); }
/** $B5CD1B */ export function CODE_B5CD1B() { steep(0x08); }
/** $B5CD28 */ export function CODE_B5CD28() { steep(0x04); }
/** $B5CD35 */ export function CODE_B5CD35() { steep(0); }
/** $B5CD3E */ export function CODE_B5CD3E() { steep(-0x04); }
/** $B5CD4B */ export function CODE_B5CD4B() { steep(-0x08); }
// gentle slopes: 1 pixel per 4
const d4 = () => (reg.a & 0xffff) >> 2;
/** $B5CD58 */ export function CODE_B5CD58() { ret(d4() + 0x1c); }
/** $B5CD5F */ export function CODE_B5CD5F() { ret(d4() + 0x18); }
/** $B5CD66 */ export function CODE_B5CD66() { ret(d4() + 0x14); }
/** $B5CD6D */ export function CODE_B5CD6D() { ret(d4() + 0x10); }
/** $B5CD74 */ export function CODE_B5CD74() { ret(d4() + 0x0c); }
/** $B5CD7B */ export function CODE_B5CD7B() { ret(d4() + 0x08); }
/** $B5CD82 */ export function CODE_B5CD82() { ret(d4() + 0x04); }
/** $B5CD89 */ export function CODE_B5CD89() { ret(d4()); }
// 1 pixel per 2
const d2 = () => (reg.a & 0xffff) >> 1;
/** $B5CD8C */ export function CODE_B5CD8C() { ret(d2() - 0x04); }
/** $B5CD92 */ export function CODE_B5CD92() { ret(d2()); }
/** $B5CD94 */ export function CODE_B5CD94() { ret(d2() + 0x04); }
/** $B5CD9A */ export function CODE_B5CD9A() { ret(d2() + 0x08); }
/** $B5CDA0 */ export function CODE_B5CDA0() { ret(d2() + 0x0c); }
/** $B5CDA6 */ export function CODE_B5CDA6() { ret(d2() + 0x10); }
/** $B5CDAC */ export function CODE_B5CDAC() { ret(d2() + 0x14); }
/** $B5CDB2 */ export function CODE_B5CDB2() { ret(d2() + 0x18); }
/** $B5CDB8 */ export function CODE_B5CDB8() { ret(d2() + 0x1c); }

const heightEntries: Record<string, () => void> = {
  CODE_B5CAF8, CODE_B5CB0F, CODE_B5CB2A, CODE_B5CB3D, CODE_B5CB56, CODE_B5CB63, CODE_B5CB6C,
  CODE_B5CB75, CODE_B5CB89, CODE_B5CB9D, CODE_B5CBBA, CODE_B5CBCC, CODE_B5CBDA, CODE_B5CBE3,
  CODE_B5CBF5, CODE_B5CC0C, CODE_B5CC10, CODE_B5CC14, CODE_B5CC18, CODE_B5CC1C, CODE_B5CC20,
  CODE_B5CC24, CODE_B5CC28, CODE_B5CC2C, CODE_B5CC30, CODE_B5CC37, CODE_B5CC3A, CODE_B5CC41,
  CODE_B5CC48, CODE_B5CC4F, CODE_B5CC5E, CODE_B5CC6D, CODE_B5CC77, CODE_B5CC81, CODE_B5CC87,
  CODE_B5CC8D, CODE_B5CC93, CODE_B5CC95, CODE_B5CC9B, CODE_B5CCA1, CODE_B5CCA7, CODE_B5CCAC,
  CODE_B5CCB1, CODE_B5CCB6, CODE_B5CCB7, CODE_B5CCBC, CODE_B5CCC1, CODE_B5CCC6, CODE_B5CCCB,
  CODE_B5CCD0, CODE_B5CCD5, CODE_B5CCDA, CODE_B5CCE7, CODE_B5CCF4, CODE_B5CD01, CODE_B5CD0E,
  CODE_B5CD1B, CODE_B5CD28, CODE_B5CD35, CODE_B5CD3E, CODE_B5CD4B, CODE_B5CD58, CODE_B5CD5F,
  CODE_B5CD66, CODE_B5CD6D, CODE_B5CD74, CODE_B5CD7B, CODE_B5CD82, CODE_B5CD89, CODE_B5CD8C,
  CODE_B5CD92, CODE_B5CD94, CODE_B5CD9A, CODE_B5CDA0, CODE_B5CDA6, CODE_B5CDAC, CODE_B5CDB2,
  CODE_B5CDB8,
};
/** Direct dispatch by the 16-bit pointer stored in DATA_B5CA58 (hot path). */
const heightFuncs = new Map<number, () => void>();
for (const [name, fn] of Object.entries(heightEntries)) heightFuncs.set(L(name) & 0xffff, fn);

register({
  get_sprite_terrain_info_y_origin_0,
  get_sprite_terrain_info,
  get_sprite_terrain_info_define_y,
  get_sprite_terrain_info_define_x,
  CODE_B5C2DB,
  CODE_B5C384,
  CODE_B5C397,
  CODE_B5C39F,
  CODE_B5C3F4,
  CODE_B5C414,
  CODE_B5C510,
  CODE_B5C60B,
  CODE_B5C70C,
  CODE_B5C80D,
  CODE_B5C82C,
  CODE_B5C94D,
  ...heightEntries,
});
for (const name of ["CODE_B5C94D", ...Object.keys(heightEntries)]) setRetMode(L(name), RET_RTS);
