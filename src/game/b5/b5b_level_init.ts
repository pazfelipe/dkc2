/**
 * Bank $B5 (part B) — per-tileset level map setup.
 *
 * CODE_B5BCA8 is called by the level loader with the level's tileset type ("32x32 tilemap
 * index": forest, ship hold, wasp hive, ship deck, ship mast, carnival, lava, ...). It points
 * the direct-page map pointers at the tileset's data and selects its collision routine:
 *
 *   $98/$9A  32x32 chunk map (24-bit; $9B = bank of the 8x8 tilemap, used as data bank by the
 *            column/row builders when they finish)
 *   $9C/$9E  collision map (bank | $8000)
 *   $17B4    8x8 tilemap (tiles of the chunks)
 *   $A0      number of chunks that have collision tiles
 *   $17B2    terrain collision routine (DATA_B5BC00, see b5b_terrain.ts)
 *   $0B84    level dimensions table of the tileset, $0B86 compression flags
 */
import { r16, w16, rom8, rom16 } from "../../core/mem";
import { reg, register } from "../../core/cpu";
import { L, R } from "../../core/sym";

const CHUNK_MAPS = L("DATA_B5BAEF"); // 24-bit entries
const TILEMAPS = L("DATA_B5BB2E"); // 24-bit entries: 8x8 tilemaps
const VRAM_ADDRESSES = L("DATA_B5BB6D");
const COLLISION_MAPS = L("DATA_B5BB97"); // 24-bit entries
const COLLISION_TILE_COUNTS = L("DATA_B5BBD6");
const COLLISION_ROUTINES = L("DATA_B5BC00");
const PALETTES = L("DATA_B5BC2A");
const COMPRESSION_FLAGS = L("DATA_B5BC54");
const DIMENSIONS = L("level_dimensions_table");

/** $B5BCA8 — A = tileset type: set up the map, tile, collision and palette pointers. */
export function CODE_B5BCA8() {
  const t = reg.a & 0xffff;
  w16(0x32, t);
  const y = (t << 1) & 0xffff; // word tables
  const x = (y + t) & 0xffff; // 24-bit tables
  w16(R.level_tilemap, rom16(CHUNK_MAPS + x));
  // $9A = chunk map bank, $9B = 8x8 tilemap bank (SEP #$20 : LDA : XBA : LDA)
  w16(0x9a, (rom8(TILEMAPS + x + 2) << 8) | rom8(CHUNK_MAPS + x + 2));
  w16(0x9c, rom16(COLLISION_MAPS + x));
  w16(0x9e, (rom16(COLLISION_MAPS + x + 2) & 0x00ff) | 0x8000);
  w16(R.unknown_17B4, rom16(TILEMAPS + x));
  w16(R.level_tilemap_vram_address, rom16(VRAM_ADDRESSES + y));
  w16(0xa0, rom16(COLLISION_TILE_COUNTS + y));
  w16(0x17b2, rom16(COLLISION_ROUTINES + y));
  // a level may use its own palette, otherwise the tileset's default one
  if (r16(R.level_palette_address) === 0) w16(R.level_palette_address, rom16(PALETTES + y));
  w16(0x0b84, rom16(DIMENSIONS + y));
  const flags = rom16(COMPRESSION_FLAGS + y);
  w16(0x0b86, flags);
  reg.a = flags;
  reg.x = x;
  reg.y = y;
}

register({ CODE_B5BCA8 });
