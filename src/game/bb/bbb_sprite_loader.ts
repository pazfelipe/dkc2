/**
 * Bank $BB (part b) — the per-frame sprite loader: spawning of the sprites placed in the level
 * (placement data in bank $FE), spawn / despawn radius checks, spawn groups, and the despawn
 * handling sprites run when they leave the screen.
 *
 * Placement data (pointer per level in DATA_FE0000) is a list of 8-byte records:
 *   +0 parameter: bits 0-3 spawn kind (index into the radius-check and spawn tables below),
 *      bits 4-7 radius row (activation_radius_left_table, 16 bytes per row), bits 8-12 group id
 *   +2 x, +4 y, +6 sprite spawn id (index into DATA_FBE800 -> spawn script in bank $FF).
 * sprite_loader keeps $F3/$F5/$F7/$F9 pointing at the +0/+2/+4/+6 fields of record 0, so
 * `(RAM_F3),y` with Y = (placement number - 1) * 8 reads a record's field (DB = $FE).
 *
 * `sprite_spawn_table` ($7E7A12, one word per placement): bits 0-12 = the live sprite (its WRAM
 * address), bit 15 = defeated, bits 13-14 kept across despawns. The level is cut into screen-sized
 * regions; `sprite_spawn_list_table` ($0BA6) gives, per region, an offset into
 * `sprite_spawn_lists` ($7E5A12) where a zero-terminated list of placement numbers lives.
 */
import { r16, w16, w8, rom16, bus16 } from "../../core/mem";
import { reg, register, callPtr } from "../../core/cpu";
import { setRetMode, RET_RTS, RET_RTL, RET_SPRITE } from "../../core/hybrid";
import { L, R, C, sprite, sprite_table, sprite_dma, CPU } from "../../core/sym";
import { io16, ioR16 } from "../../core/mem";
import {
  allocate_sprite_table_slot,
  spawn_BB8462_special_sprite_index,
  apply_spawn_script_to_slot,
  handle_multi_vram_sprite_allocation,
  handle_sprite_allocation,
  request_sprite_palette,
  allocate_sprite_vram_slot,
  dereference_sprite_palette,
  delete_sprite_handle_deallocation,
  delete_sprite_no_deallocation,
} from "../../gen/routines";
import { read16x, mergeBits } from "./bba_util";
import { chargeOps } from "./bba_util";

const PLACEMENT_TABLE = L("DATA_FE0000");
const SPAWN_SCRIPTS = L("DATA_FBE800");
const SPRITE_DEFS = L("DATA_FF0000");
const RADIUS = L("activation_radius_left_table"); // rows: left, top-span, right... (see check)
const ACTIVATION_CHECKS = L("DATA_BBB9AC");
const DEACTIVATION_CHECKS = L("DATA_BBB9CC");
const RESPAWN_CHECKS = L("DATA_BBB9EC");
const SPAWNERS = L("DATA_BBBA0C");
const SPAWN_TABLE = R.sprite_spawn_table;
const SPAWN_LISTS = R.sprite_spawn_lists;
const SPRITE_SIZE = 0x5e;

/** `LDA (dp),y` with the current data bank (the placement data, DB = $FE). */
function ind(dp: number, y: number): number {
  return read16x((((reg.db & 0xff) << 16) | r16(dp)) + (y & 0xffff));
}
/** Same with an explicit bank. */
function indB(bank: number, dp: number, y: number): number {
  return read16x(((bank << 16) | r16(dp)) + (y & 0xffff));
}
const tbl = (x: number) => r16(SPAWN_TABLE + x);
const setTbl = (x: number, v: number) => w16(SPAWN_TABLE + x, v);
const dec2 = (n: number) => ((n - 1) << 1) & 0xffff;

// ---------------------------------------------------------------------------------------------
// The loader

/** $BBB5C4 — spawn the placed sprites of the camera's region (every frame). */
export function sprite_loader() {
  const savedDb = reg.db;
  const data = rom16(PLACEMENT_TABLE + ((r16(R.level_number) << 1) & 0xffff));
  reg.a = data;
  if (data === 0) {
    reg.db = savedDb;
    return;
  }
  w16(R.RAM_F3, data);
  w16(R.RAM_F5, (data + 2) & 0xffff);
  w16(R.RAM_F7, (data + 4) & 0xffff);
  w16(R.RAM_F9, (data + 6) & 0xffff);
  // the region one screen up-left of the camera (clamped at 0)
  let xs = ((r16(R.screen_scroll_x_position) >> 8) - 1) & 0xffff;
  if (xs & 0x8000) xs = (xs + 1) & 0xffff;
  w16(0x32, xs);
  let ys = ((r16(R.screen_scroll_y_position) & 0xff00) - 0x0100) & 0xffff;
  if (ys & 0x8000) ys = (ys + 0x0100) & 0xffff;
  io16(CPU.multiply_A, ys | r16(R.RAM_0B88)); // y screen * level width in screens
  const region = (ioR16(CPU.multiply_result) + xs) & 0xffff;
  let x = r16(R.sprite_spawn_list_table + ((region << 1) & 0xffff));
  reg.db = 0xfe;
  reg.a = x;
  if (x !== 0) {
    for (;;) {
      reg.a = r16(SPAWN_LISTS + x);
      if (reg.a === 0) break;
      CODE_BBB62F();
      x = (x + 2) & 0xffff;
    }
  }
  reg.x = x;
  reg.db = savedDb;
}

/** $BBB62F — A = placement number: spawn that placement if it is not alive and in range. */
export function CODE_BBB62F() {
  const n = reg.a & 0xffff;
  w16(R.RAM_FB, n);
  const x = dec2(n);
  const y = (x << 2) & 0xffff;
  reg.x = x;
  reg.y = y;
  const param = ind(R.RAM_F3, y);
  if (param & 0x1f00) {
    w16(0x32, param & 0x1f00);
    if (!(tbl(x) & 0x8000)) return CODE_BBB668(); // member of a group that is not defeated
  }
  CODE_BBB62F_done_handling_group();
}

/** $BBB648 — X = table index, Y = record offset. */
export function CODE_BBB62F_done_handling_group() {
  const s = tbl(reg.x);
  w16(0x0b9c, s);
  reg.a = s & 0x3fff;
  if (reg.a !== 0) return; // already spawned (or suppressed)
  CODE_BBB62F_sprite_not_spawned_yet();
}

/** $BBB656 — run the activation check of the placement kind, then its spawner. */
export function CODE_BBB62F_sprite_not_spawned_yet() {
  const x = ((ind(R.RAM_F3, reg.y) & 0x000f) << 1) & 0xffff;
  reg.x = x;
  callPtr(0xbb, rom16(ACTIVATION_CHECKS + x));
  reg.x = x;
  if (!reg.c) return;
  CODE_BBB665();
}

/** $BBB665 — X = kind * 2: JMP to the spawner. */
export function CODE_BBB665() {
  callPtr(0xbb, rom16(SPAWNERS + reg.x));
}

/** $BBB668 — a grouped placement: spawn its group manager if the group has none yet. */
export function CODE_BBB668() {
  w16(0x0b9c, tbl(reg.x));
  const group = (r16(0x32) >> 8) & 0xff; // XBA (the low byte is 0)
  const x = dec2(group);
  reg.x = x;
  reg.a = r16(R.spawn_group_manager_table + x);
  if (reg.a !== 0) return;
  CODE_BBB67D();
}

/** $BBB67D */
export function CODE_BBB67D() {
  const x = ((ind(R.RAM_F3, reg.y) & 0x000f) << 1) & 0xffff;
  reg.x = x;
  callPtr(0xbb, rom16(ACTIVATION_CHECKS + x));
  if (!reg.c) return;
  CODE_BBB68A();
}

/** $BBB68A */
export function CODE_BBB68A() {
  reg.a = reg.y;
  w16(0x0b9e, reg.y);
  allocate_sprite_table_slot();
  if (reg.c) return;
  CODE_BBB695();
}

/** $BBB695 — spawn the group manager sprite. */
export function CODE_BBB695() {
  reg.y = C.special_sprite_spawn_id_0022;
  spawn_BB8462_special_sprite_index();
  if (r16(R.debug_flags) & 0x0040) {
    w16(r16(R.alternate_sprite) + sprite.type, C.sprite_debug_spawn_group_manager);
  }
  CODE_BBB6AC();
}

/** $BBB6AC — set the manager up, then spawn every member of the group. */
export function CODE_BBB6AC() {
  const mgr = r16(R.alternate_sprite);
  const y = r16(0x0b9e);
  reg.y = y;
  const param = ind(R.RAM_F3, y);
  w16(mgr + sprite.placement_parameter, param);
  const group = (param & 0x1f00) >> 8;
  w16(mgr + sprite.general_purpose_42, group);
  let x = dec2(group);
  w16(R.spawn_group_manager_table + x, mgr);
  x = (x + r16(0x0b9a)) & 0xffff;
  reg.x = r16(0x7e0000 + x); // the group's member list
  CODE_BBB6FB();
}

/** One member of a group (CODE_BBB6D4 body): A = placement number, X = list pointer. */
function spawnMember() {
  const listX = reg.x;
  const db = reg.db;
  const n = reg.a & 0xffff;
  w16(0xfb, n);
  const x = dec2(n);
  const y = (x << 2) & 0xffff;
  reg.x = x;
  reg.y = y;
  const s = tbl(x);
  w16(0x0b9c, s);
  if ((s & 0x3fff) === 0) {
    reg.x = ((ind(R.RAM_F3, y) & 0x000f) << 1) & 0xffff;
    callPtr(0xbb, rom16(SPAWNERS + reg.x));
  }
  reg.db = db;
  reg.x = (listX + 2) & 0xffff;
}

/** $BBB6D4 — A = member placement number, X = list pointer: spawn it unless alive, go on. */
export function CODE_BBB6D4() {
  spawnMember();
  CODE_BBB6FB();
}

/** $BBB6FB — X = pointer into the group member list (bank $7E). (CODE_BBB6F7 is the loop
 * tail inside CODE_BBB6D4, only reachable with its PHX/PHB on the stack.) */
export function CODE_BBB6FB() {
  for (;;) {
    reg.a = r16(0x7e0000 + reg.x);
    if (reg.a === 0) return;
    spawnMember();
  }
}

/** $BBB70A */
export function CODE_BBB70A() {
  reg.c = true;
}

// ---------------------------------------------------------------------------------------------
// Spawners (Y = record offset, $FB = placement number, DB = $FE)

/** Common tail: record the live sprite X in the placement's spawn table entry. */
function recordSpawn(spr: number) {
  const n = r16(0xfb);
  w16(spr + sprite.placement_number, n);
  const idx = dec2(n);
  w16(0x32, idx);
  setTbl(idx, mergeBits(tbl(idx), spr, 0x1fff));
  reg.x = idx;
}

/** Position, render order and placement parameter from the record. */
function initFromPlacement(spr: number, y: number) {
  w16(spr + sprite.x_position, ind(R.RAM_F5, y));
  w16(spr + sprite.y_position, ind(R.RAM_F7, y));
  w16(spr + sprite.render_order, 0x00ec);
  w16(spr + sprite.x_sub_position, 0x8000);
  w16(spr + sprite.y_sub_position, 0x8000);
}

/** $BBB70C — Kleever's hooks: share the VRAM graphics of an existing hook of the same type. */
export function kleever_hook_sprite_spawn() {
  const y = reg.y;
  const db = reg.db;
  reg.db = 0x80;
  allocate_sprite_table_slot();
  reg.db = db;
  reg.y = y;
  if (reg.c) return CODE_BBB70A();
  w16(0x3a, ((db & 0xff) << 8) | (db & 0xff));
  const id = ind(R.RAM_F9, y);
  const def = rom16(SPAWN_SCRIPTS + id);
  reg.x = def;
  // the sprite's graphics description: type, palette, DMA source and size
  w16(0x32, rom16(SPRITE_DEFS + 2 + def));
  w16(0x34, rom16(SPRITE_DEFS + 4 + def));
  w16(0x36, rom16(SPRITE_DEFS + 6 + def));
  w16(0x38, rom16(SPRITE_DEFS + 8 + def));
  reg.db = 0xbb;
  reg.a = r16(0x34);
  request_sprite_palette();
  reg.y = y;
  if (reg.c) return CODE_BBB790();
  const alt = r16(R.alternate_sprite);
  w16(alt + sprite.oam_property, mergeBits(r16(alt + sprite.oam_property), reg.a, 0x0e00));
  reg.x = sprite_table.slot_3;
  CODE_BBB75D();
}

/** $BBB75D — X = sprite: look for a live sprite of the same type to share graphics with. */
export function CODE_BBB75D() {
  for (let x = reg.x; x !== sprite_table.end; x = (x + SPRITE_SIZE) & 0xffff) {
    if (r16(0x32) === r16(x + sprite.type)) {
      reg.x = x;
      return CODE_BBB797();
    }
  }
  reg.x = sprite_table.end;
  const slot = r16(R.next_sprite_dma_buffer_slot);
  if (!((slot - 0x18) & 0x8000)) return CODE_BBB77F(); // DMA queue full
  reg.x = r16(R.alternate_sprite);
  const y = reg.y;
  allocate_sprite_vram_slot();
  reg.y = y;
  if (!reg.c) return CODE_BBB7A6();
  CODE_BBB77F();
}

/** $BBB77F — give the palette back and fail. */
export function CODE_BBB77F() {
  reg.x = r16(R.alternate_sprite);
  reg.a = r16(reg.x + sprite.oam_property);
  dereference_sprite_palette();
  if (!reg.c) w16(R.current_palette_buffer_slot, (r16(R.current_palette_buffer_slot) - 1) & 0x000f);
  CODE_BBB790();
}

/** $BBB790 */
export function CODE_BBB790() {
  reg.a = r16(0x3a);
  reg.db = (reg.a >> 8) & 0xff;
  reg.c = true;
}

/** $BBB797 — X = existing hook: reuse its VRAM slot. */
export function CODE_BBB797() {
  const oam = r16(reg.x + sprite.oam_property);
  const alt = r16(R.alternate_sprite);
  reg.x = alt;
  w16(alt + sprite.oam_property, oam & 0xffe0);
  w16(alt + sprite.type, r16(0x32));
  CODE_BBB7DD();
}

/** $BBB7A6 — queue the DMA of the new hook's graphics into its fresh VRAM slot. */
export function CODE_BBB7A6() {
  const x = r16(R.next_sprite_dma_buffer_slot);
  w16(sprite_dma.source_word + x, r16(0x36));
  w16(sprite_dma.source_bank + x, (r16(0x38) & 0x00ff) | 0x8000);
  w16(sprite_dma.size + x, (r16(0x38) & 0xff00) >> 3);
  const alt = r16(R.alternate_sprite);
  w16(sprite_dma.destination + x, ((r16(alt + sprite.oam_property) & 0x01ff) << 4) & 0xffff);
  w16(R.next_sprite_dma_buffer_slot, (x + 8) & 0xffff);
  reg.x = x;
  CODE_BBB7DD();
}

/** $BBB7DD — finish the hook like a normal placed sprite. */
export function CODE_BBB7DD() {
  reg.db = (r16(0x3a) >> 8) & 0xff;
  const alt = r16(R.alternate_sprite);
  const y = reg.y;
  w16(alt + sprite.type, r16(0x32));
  initFromPlacement(alt, y);
  w16(alt + sprite.unknown_2C, 0);
  w16(alt + sprite.carry_or_defeat_flags, 0);
  w16(alt + sprite.interaction_flags, 0);
  w16(alt + sprite.terrain_interaction, 0);
  w16(alt + sprite.despawn_time, 0);
  w16(alt + sprite.placement_parameter, ind(R.RAM_F3, y));
  w16(alt + sprite.last_rendered_graphic, 0);
  w16(alt + sprite.display_mode, 0);
  w16(alt + sprite.terrain_attributes, 0);
  const id = ind(R.RAM_F9, y);
  reg.y = (rom16(SPAWN_SCRIPTS + id) + 0x000a) & 0xffff; // skip the graphics header
  reg.x = alt;
  apply_spawn_script_to_slot();
  const spr = r16(R.alternate_sprite);
  recordSpawn(spr);
  reg.a = r16(0x3a);
  reg.db = (reg.a >> 8) & 0xff;
  reg.c = false;
}

/** $BBB847 — a sprite without graphics of its own (hidden/controller sprites). */
export function hidden_sprite_spawn() {
  const y = reg.y;
  const db = reg.db;
  reg.db = 0x80;
  allocate_sprite_table_slot();
  reg.db = db;
  reg.y = y;
  if (reg.c) return;
  const spr = reg.x;
  initFromPlacement(spr, y);
  for (const f of [sprite.current_graphic, sprite.last_rendered_graphic, sprite.unknown_2C, sprite.carry_or_defeat_flags, sprite.interaction_flags, sprite.terrain_interaction, sprite.despawn_time, sprite.display_mode]) {
    w16(spr + f, 0);
  }
  w16(spr + sprite.placement_parameter, ind(R.RAM_F3, y));
  reg.y = rom16(SPAWN_SCRIPTS + ind(R.RAM_F9, y));
  reg.x = r16(R.alternate_sprite);
  apply_spawn_script_to_slot();
  const alt = r16(R.alternate_sprite);
  recordSpawn(alt);
  reg.a = r16(R.debug_flags) & 0x0040;
  if (reg.a) {
    reg.x = alt;
    reg.a = C.sprite_hidden_debug_dummy_sprite;
    w16(alt + sprite.type, reg.a);
  }
  reg.c = false;
}

/** $BBB8BD — a sprite using two consecutive VRAM slots. */
export function big_sprite_spawn() {
  const y = reg.y;
  const db = reg.db;
  reg.db = 0x80;
  reg.a = 0x0002;
  handle_multi_vram_sprite_allocation();
  big_sprite_spawn_sprite_spawn_start_(y, db);
}

/** $BBB8CC — the usual placed sprite: a sprite slot and one VRAM slot. */
export function normal_sprite_spawn() {
  const y = reg.y;
  const db = reg.db;
  reg.db = 0x80;
  handle_sprite_allocation();
  big_sprite_spawn_sprite_spawn_start_(y, db);
}

function big_sprite_spawn_sprite_spawn_start_(y: number, db: number) {
  reg.db = db;
  reg.y = y;
  if (reg.c) return;
  const spr = reg.x;
  initFromPlacement(spr, y);
  for (const f of [sprite.unknown_2C, sprite.carry_or_defeat_flags, sprite.interaction_flags, sprite.terrain_interaction, sprite.despawn_time]) {
    w16(spr + f, 0);
  }
  w16(spr + sprite.placement_parameter, ind(R.RAM_F3, y));
  reg.y = rom16(SPAWN_SCRIPTS + ind(R.RAM_F9, y));
  reg.x = r16(R.alternate_sprite);
  apply_spawn_script_to_slot();
  const alt = r16(R.alternate_sprite);
  recordSpawn(alt);
  reg.a = r16(R.debug_flags) & 0x0040;
  if (reg.a) {
    reg.x = alt;
    reg.a = C.sprite_debug_dummy_sprite;
    w16(alt + sprite.type, reg.a);
  }
  reg.c = false;
}

// ---------------------------------------------------------------------------------------------
// Radius checks: carry set = inside. Placement checks take Y = record offset; the
// (de)activation checks of live sprites take Y = sprite.

/** $BBBA2C */
export function return_sprite_loader_false() {
  reg.c = false;
}

/** $BBBA2E — the default check plus a checksum of the reset code (anti-piracy). */
export function anti_piracy_activation_radius_check() {
  default_activation_radius_check();
  if (!reg.c) return;
  // The original folds two code words of the anti-piracy routine at $80840D (EOR/INC ten times,
  // EOR #$9684) and returns C = (result == $FFFF). On a genuine cartridge the result is $FFFF;
  // the port runs without the original code, so it returns that outcome directly.
  reg.a = 0xffff;
  reg.x = 0x840d;
  reg.c = true;
}

function conditional(bit: number) {
  reg.a = r16(0x0923) & bit;
  if (reg.a) return default_activation_radius_check();
  reg.c = false;
}
/** $BBBA53 */
export function conditional_spawn_1_radius_check() {
  conditional(0x0001);
}
/** $BBBA5E */
export function conditional_spawn_1_radius_check_2() {
  conditional(0x0001);
}
/** $BBBA69 */
export function conditional_spawn_2_radius_check() {
  conditional(0x0002);
}
/** $BBBA74 */
export function conditional_spawn_3_radius_check() {
  conditional(0x0004);
}

/** $BBBA7F — Y = record offset: is the placement inside its activation radius? */
export function default_activation_radius_check() {
  const y = reg.y;
  w16(0x72, ind(R.RAM_F5, y));
  w16(0x74, ind(R.RAM_F7, y));
  reg.x = ind(R.RAM_F3, y) & 0x00f0;
  check_placement_spawning_radius();
}

/** $BBBA90 */
export function return_sprite_loader_false_2() {
  reg.c = false;
}

function spritePos(spr: number) {
  w16(0x72, r16(spr + sprite.x_position));
  w16(0x74, r16(spr + sprite.y_position));
}

/** $BBBA92 — Y = sprite: fixed radius row 5. */
export function CODE_BBBA92() {
  reg.x = reg.y;
  spritePos(reg.y);
  reg.a = 0x0050;
  reg.x = 0x0050;
  check_placement_spawning_radius();
}

/** $BBBAA2 — Y = sprite: inside its deactivation radius (the row's second half)? */
export function default_deactivation_radius_check() {
  const spr = reg.y;
  spritePos(spr);
  reg.x = ((r16(spr + sprite.placement_parameter) & 0x00f0) + 0x0008) & 0xffff;
  check_placement_spawning_radius();
}

/** $BBBAB8 — Y = sprite: inside its deactivation radius, or its placement inside the activation one. */
export function CODE_BBBAB8() {
  const spr = reg.y;
  spritePos(spr);
  reg.x = ((r16(spr + sprite.placement_parameter) & 0x00f0) + 0x0008) & 0xffff;
  check_placement_spawning_radius();
  if (reg.c) return;
  reg.x = spr;
  CODE_BBBAD1();
}

/** $BBBAD1 — X = Y = sprite: is its placement position inside the activation radius? */
export function CODE_BBBAD1() {
  CODE_BBBAF3();
}

/** $BBBAF3 — Y = sprite (X too): same check as CODE_BBBAD1. */
export function CODE_BBBAF3() {
  const spr = reg.y;
  reg.x = spr;
  const y = (((r16(spr + sprite.placement_number) - 1) << 3) & 0xffff);
  w16(0x72, indB(0xfe, R.RAM_F5, y));
  w16(0x74, indB(0xfe, R.RAM_F7, y));
  reg.y = spr;
  reg.x = r16(spr + sprite.placement_parameter) & 0x00f0;
  check_placement_spawning_radius();
}

/** $BBBB14 — X = radius row offset, $72/$74 = position: carry set when inside the box around the camera. */
export function check_placement_spawning_radius() {
  const x = reg.x;
  const px = r16(0x72);
  const py = r16(0x74);
  reg.c = false;
  let a = (r16(R.screen_scroll_x_position) - rom16(RADIUS + x)) & 0xffff;
  reg.a = a;
  if (a >= px) return;
  a = (a + rom16(RADIUS + 2 + x)) & 0xffff;
  reg.a = a;
  if (a < px) return;
  a = (r16(R.screen_scroll_y_position) - rom16(RADIUS + 4 + x)) & 0xffff;
  reg.a = a;
  if (a >= py) return;
  a = (a + rom16(RADIUS + 6 + x)) & 0xffff;
  reg.a = a;
  if (a < py) return;
  reg.c = true;
}

/** $BBBB42 */
export function check_placement_spawning_radius_out_of_spawn_range() {
  reg.c = false;
}

// ---------------------------------------------------------------------------------------------
// Despawning

/** $BBBB44 — delete the current sprite; a placed, ungrouped one may respawn later. Carry set = deleted. */
export function CODE_BBBB44() {
  const x = r16(R.current_sprite);
  reg.x = x;
  reg.a = r16(x + sprite.placement_number);
  if (reg.a === 0) return CODE_BBBB63();
  reg.a = r16(x + sprite.placement_parameter) & 0x1f00;
  if (reg.a !== 0) {
    reg.c = false;
    return;
  }
  CODE_BBBB53();
}

/** $BBBB53 — X = sprite: free its spawn table entry so it can respawn. */
export function CODE_BBBB53() {
  const idx = dec2(r16(reg.x + sprite.placement_number));
  reg.x = idx;
  setTbl(idx, tbl(idx) & 0xe000);
  CODE_BBBB63();
}

/** $BBBB63 */
export function CODE_BBBB63() {
  delete_sprite_handle_deallocation();
  reg.c = true;
}

/** $BBBB69 */
export function check_if_sprite_offscreen_global() {
  check_if_sprite_offscreen();
}

/** $BBBB6D — carry set when the current sprite is outside its deactivation radius. */
export function check_if_sprite_offscreen() {
  reg.y = r16(R.current_sprite);
  reg.x = 0x001e;
  callPtr(0xbb, rom16(DEACTIVATION_CHECKS + 0x1e));
  reg.c = !reg.c;
}

/** $BBBB79 */
export function check_if_sprite_offscreen_offscreen() {
  reg.c = true;
}

/** $BBBB7B */
export function CODE_BBBB7B() {
  CODE_BBBB7F();
}

/** $BBBB7F — carry set when the current sprite (and its placement) are out of range. */
export function CODE_BBBB7F() {
  reg.y = r16(R.current_sprite);
  reg.x = 0x0002;
  callPtr(0xbb, rom16(DEACTIVATION_CHECKS + 2));
  reg.c = !reg.c;
}

/** $BBBB8B */
export function CODE_BBBB7F_despawn() {
  reg.c = true;
}

/** $BBBB8D — delete the current sprite when offscreen (carry set if deleted). */
export function delete_sprite_if_offscreen() {
  check_if_sprite_offscreen();
  if (!reg.c) return;
  delete_sprite_if_offscreen_despawn();
}

/** $BBBB93 */
export function delete_sprite_if_offscreen_despawn() {
  delete_sprite_handle_deallocation();
  reg.c = true;
}

/** Despawn timer reload while visible: copy the low byte of despawn_time into the countdown. */
function resetDespawnCountdown(spr: number, a: number) {
  w8(spr + sprite.despawn_countdown, a & 0xff);
  reg.c = false;
}

/** $BBBB99 — per-frame despawn handling of the current sprite. Carry set = it was deleted. */
export function CODE_BBBB99() {
  const spr = r16(R.current_sprite);
  reg.x = spr;
  reg.y = spr;
  const pn = r16(spr + sprite.placement_number);
  if (pn === 0) {
    // spawned by code: its kind still decides the despawn check
    reg.x = ((r16(spr + sprite.placement_parameter) & 0x000f) << 1) & 0xffff;
    callPtr(0xbb, rom16(DEACTIVATION_CHECKS + reg.x));
    reg.x = spr;
    reg.y = spr;
    if (reg.c) {
      reg.a = r16(spr + sprite.despawn_time);
      if (reg.a !== 0) return resetDespawnCountdown(spr, reg.a);
      reg.c = false;
      return;
    }
    // .offscreen
    const t = r16(spr + sprite.despawn_time);
    reg.a = (t - 0x0100) & 0xffff;
    if (t < 0x0100) {
      delete_sprite_handle_deallocation();
      reg.c = true;
      return;
    }
    w16(spr + sprite.despawn_time, reg.a);
    reg.c = false;
    return;
  }
  CODE_BBBB99_placed_by_level();
}

/** $BBBBC6 — X = sprite placed by the level. */
export function CODE_BBBB99_placed_by_level() {
  const spr = reg.x;
  reg.y = spr;
  const param = r16(spr + sprite.placement_parameter);
  if (param & 0x1f00) {
    // .grouped_sprite: a live member of a living group is handled by its group manager
    const pn = r16(spr + sprite.placement_number);
    if (pn & 0x8000 || !(tbl(dec2(pn)) & 0x8000)) {
      reg.x = spr;
      reg.c = false;
      return;
    }
    reg.x = spr;
  }
  CODE_BBBB99_CODE_BBBBCE();
}

/** $BBBBCE — X = Y = sprite. */
export function CODE_BBBB99_CODE_BBBBCE() {
  const spr = reg.y;
  reg.a = r16(R.debug_flags);
  if (reg.a & 0x0040) {
    // debug freeze: anything but the dummies is removed for good
    const t = r16(spr + sprite.type);
    if (t !== C.sprite_hidden_debug_dummy_sprite && t !== C.sprite_debug_dummy_sprite) return CODE_BBBB99_CODE_BBBC2B();
  }
  CODE_BBBB99_CODE_BBBBD6();
}

/** $BBBBD6 — X = Y = sprite. */
export function CODE_BBBB99_CODE_BBBBD6() {
  const spr = reg.y;
  reg.x = ((r16(spr + sprite.placement_parameter) & 0x000f) << 1) & 0xffff;
  callPtr(0xbb, rom16(DEACTIVATION_CHECKS + reg.x));
  if (!reg.c) {
    reg.y = spr;
    return CODE_BBBB99_offscreen_placed_by_level();
  }
  reg.x = spr;
  reg.a = r16(spr + sprite.despawn_time);
  if (reg.a !== 0) return resetDespawnCountdown(spr, reg.a);
  reg.c = false;
}

/** $BBBC12 — Y = sprite: count the despawn timer down, then despawn. */
export function CODE_BBBB99_offscreen_placed_by_level() {
  const spr = reg.y;
  reg.x = spr;
  const t = r16(spr + sprite.despawn_time);
  reg.a = (t - 0x0100) & 0xffff;
  if (t < 0x0100) return CODE_BBBB99_CODE_BBBC1F();
  w16(spr + sprite.despawn_time, reg.a);
  reg.c = false;
}

/** $BBBC1F — X = Y = sprite: despawn, leaving a respawn suppressor when the kind asks for one. */
export function CODE_BBBB99_CODE_BBBC1F() {
  const spr = reg.y;
  reg.x = ((r16(spr + sprite.placement_parameter) & 0x000f) << 1) & 0xffff;
  callPtr(0xbb, rom16(RESPAWN_CHECKS + reg.x));
  if (reg.c) return CODE_BBBB99_CODE_BBBC42();
  CODE_BBBB99_CODE_BBBC2B();
}

/** $BBBC2B — Y = sprite: free the spawn entry (allow respawn) and delete. */
export function CODE_BBBB99_CODE_BBBC2B() {
  const spr = reg.y;
  const idx = dec2(r16(spr + sprite.placement_number));
  reg.x = idx;
  setTbl(idx, tbl(idx) & 0xe000);
  delete_sprite_handle_deallocation();
  reg.c = true;
}

/** $BBBC42 — replace the sprite by a respawn suppressor (keeps the spawn entry busy). */
export function CODE_BBBB99_CODE_BBBC42() {
  delete_sprite_handle_deallocation();
  const x = r16(R.current_sprite);
  reg.x = x;
  reg.a = C.sprite_respawn_suppressor;
  w16(x + sprite.type, reg.a);
  for (const f of [sprite.current_graphic, sprite.last_rendered_graphic, sprite.x_position, sprite.y_position, sprite.state]) w16(x + f, 0);
  reg.c = true;
}

/** $BBBC59 — respawn suppressor: once its placement is out of range, free the spawn entry. */
export function respawn_suppressor_sprite_code() {
  const spr = r16(R.current_sprite);
  reg.y = spr;
  if (r16(spr + sprite.state) !== 0) {
    reg.x = spr;
    const t = (r16(spr + sprite.general_purpose_42) - 1) & 0xffff;
    w16(spr + sprite.general_purpose_42, t);
    if (t !== 0) return;
    w16(spr + sprite.state, 0);
  }
  CODE_BBBC67();
}

/** $BBBC67 — Y = suppressor sprite. */
export function CODE_BBBC67() {
  const spr = reg.y;
  reg.x = ((r16(spr + sprite.placement_parameter) & 0x000f) << 1) & 0xffff;
  callPtr(0xbb, rom16(RESPAWN_CHECKS + reg.x));
  if (reg.c) return;
  const x = r16(R.current_sprite);
  const idx = dec2(r16(x + sprite.placement_number));
  reg.x = idx;
  setTbl(idx, tbl(idx) & 0xe000);
  delete_sprite_no_deallocation();
}

/** $BBBC8A — JML [sprite_return_address]. */
export function CODE_BBBC8A() {}

// ---------------------------------------------------------------------------------------------
// Spawn group manager

/** The manager's member list: X = pointer, $0B9C = pointer. */
function memberList(): number {
  const mgr = r16(R.current_sprite);
  const x = (dec2(r16(mgr + sprite.general_purpose_42)) + r16(0x0b9a)) & 0xffff;
  const list = r16(0x7e0000 + x);
  w16(0x0b9c, list);
  reg.x = list;
  return list;
}

/** $BBBC8D — debug group manager: delete the whole group. */
export function CODE_BBBC8D() {
  memberList();
  CODE_BBBD21();
}

/** $BBBCA3 — group manager: keep the group while a member is in range, else delete it. */
export function CODE_BBBCA3() {
  memberList();
  reg.a = r16(R.debug_flags) & 0x0040;
  if (reg.a) return CODE_BBBCC1();
  CODE_BBBCBF();
}

/** $BBBCBF */
export function CODE_BBBCBF() {
  CODE_BBBCEE();
}

/** $BBBCC1 */
export function CODE_BBBCC1() {
  const mgr = r16(R.current_sprite);
  reg.y = mgr;
  reg.a = r16(mgr + sprite.type);
  if (reg.a !== C.sprite_debug_spawn_group_manager) return CODE_BBBD21();
  CODE_BBBCBF();
}

/** One pass over the members with a check table; true when a live member is in range. */
function anyMemberInRange(list: number, checks: number): boolean {
  let x = list;
  for (;;) {
    const n = r16(0x7e0000 + x);
    reg.a = n;
    if (n === 0) {
      reg.x = x;
      return false;
    }
    const idx = dec2(n);
    reg.x = idx;
    reg.y = (idx << 2) & 0xffff;
    const s = tbl(idx);
    if (!(s & 0x8000)) {
      const spr = s & 0x1fff;
      reg.y = spr;
      reg.x = ((r16(spr + sprite.placement_parameter) & 0x000f) << 1) & 0xffff;
      callPtr(0xbb, rom16(checks + reg.x));
      if (reg.c) {
        reg.x = x; // CODE_BBBD69: PLX
        return true;
      }
    }
    x = (x + 2) & 0xffff;
  }
}

/** $BBBCCD — A = member, X = list pointer (deactivation-check loop). */
export function CODE_BBBCCD() {
  CODE_BBBCEE();
}
/** $BBBCEE — X = list pointer: first pass, deactivation radius of the live members. */
export function CODE_BBBCEE() {
  if (anyMemberInRange(reg.x, DEACTIVATION_CHECKS)) return;
  reg.x = r16(0x0b9c);
  CODE_BBBD1B();
}
/** $BBBCFA — A = member, X = list pointer (respawn-check loop). */
export function CODE_BBBCFA() {
  CODE_BBBD1B();
}
/** $BBBD1B — X = list pointer: second pass with the respawn checks. */
export function CODE_BBBD1B() {
  if (anyMemberInRange(reg.x, RESPAWN_CHECKS)) return;
  CODE_BBBD21();
}

/** $BBBD21 — delete every live member, then the manager itself. */
export function CODE_BBBD21() {
  reg.x = r16(0x0b9c);
  const mgr = r16(R.current_sprite);
  deleteMembers(reg.x, mgr);
}

function deleteMembers(list: number, mgr: number) {
  let x = list;
  for (;;) {
    const n = r16(0x7e0000 + x);
    reg.a = n;
    if (n === 0) break;
    const idx = dec2(n);
    reg.x = idx;
    reg.y = (idx << 2) & 0xffff;
    const s = tbl(idx);
    if (!(s & 0x8000)) {
      const spr = s & 0x1fff;
      w16(R.current_sprite, spr);
      if (spr !== 0) {
        setTbl(idx, tbl(idx) & 0xe000);
        delete_sprite_handle_deallocation();
      }
    }
    x = (x + 2) & 0xffff;
  }
  reg.x = mgr;
  w16(R.current_sprite, mgr);
  const gi = dec2(r16(mgr + sprite.general_purpose_42));
  reg.x = gi;
  reg.a = 0;
  w16(R.spawn_group_manager_table + gi, 0);
  delete_sprite_no_deallocation();
}

// CODE_BBBCEB, CODE_BBBD18, CODE_BBBD2A, CODE_BBBD4D, CODE_BBBD50 and CODE_BBBD69 are loop pieces
// of the member loops above, only reachable with the loop's PHX (and the manager) on the stack.

/** $BBBD6B — a sprite was defeated: one enemy less; a group member is flagged defeated. */
export function CODE_BBBD6B() {
  w16(0x19ba, (r16(0x19ba) - 1) & 0xffff);
  const x = r16(R.current_sprite);
  reg.x = x;
  let a = r16(x + sprite.placement_parameter) & 0x1f00;
  reg.a = a;
  if (a === 0) return;
  a ^= r16(x + sprite.placement_parameter);
  w16(x + sprite.placement_parameter, a);
  reg.a = r16(x + sprite.placement_number);
  if (reg.a === 0) return;
  const idx = dec2(reg.a);
  reg.x = idx;
  reg.a = tbl(idx) | 0x8000;
  setTbl(idx, reg.a);
}

/** $BBBD8E — save the persistent bits of the spawn table (entering a bonus level). */
export function CODE_BBBD8E() {
  reg.x = 0x03fe;
  CODE_BBBD91();
}
/** $BBBD91 — X = last word offset. */
export function CODE_BBBD91() {
  let x = reg.x;
  let ops = 0;
  do {
    reg.a = tbl(x) & 0xe000;
    w16(0x7e4c00 + x, reg.a);
    x = (x - 2) & 0xffff;
    ops += 6;
  } while (!(x & 0x8000));
  reg.x = x;
  chargeOps(ops);
}

/** $BBBDA1 — restore the spawn table saved by CODE_BBBD8E (back from a bonus level). */
export function CODE_BBBDA1() {
  reg.x = 0x03fe;
  CODE_BBBDA4();
}
/** $BBBDA4 — X = last word offset. */
export function CODE_BBBDA4() {
  let x = reg.x;
  let ops = 0;
  do {
    reg.a = r16(0x7e4c00 + x);
    setTbl(x, reg.a);
    x = (x - 2) & 0xffff;
    ops += 5;
  } while (!(x & 0x8000));
  reg.x = x;
  chargeOps(ops);
}

// Return kinds of everything in this file that original code may enter.
const RTS_NAMES = [
  "CODE_BBB62F", "CODE_BBB62F_done_handling_group", "CODE_BBB62F_sprite_not_spawned_yet", "CODE_BBB665", "CODE_BBB668",
  "CODE_BBB67D", "CODE_BBB68A", "CODE_BBB695", "CODE_BBB6AC", "CODE_BBB6D4", "CODE_BBB6FB", "CODE_BBB70A",
  "kleever_hook_sprite_spawn", "CODE_BBB75D", "CODE_BBB77F", "CODE_BBB790", "CODE_BBB797", "CODE_BBB7A6", "CODE_BBB7DD",
  "hidden_sprite_spawn", "big_sprite_spawn", "normal_sprite_spawn", "return_sprite_loader_false",
  "anti_piracy_activation_radius_check", "conditional_spawn_1_radius_check", "conditional_spawn_1_radius_check_2",
  "conditional_spawn_2_radius_check", "conditional_spawn_3_radius_check", "default_activation_radius_check",
  "return_sprite_loader_false_2", "CODE_BBBA92", "default_deactivation_radius_check", "CODE_BBBAB8", "CODE_BBBAD1",
  "CODE_BBBAF3", "check_placement_spawning_radius", "check_placement_spawning_radius_out_of_spawn_range",
  "check_if_sprite_offscreen", "check_if_sprite_offscreen_offscreen", "CODE_BBBB7F", "CODE_BBBB7F_despawn",
  "CODE_BBBD8E", "CODE_BBBD91", "CODE_BBBDA1", "CODE_BBBDA4",
];
for (const n of RTS_NAMES) setRetMode(L(n), RET_RTS);
const RTL_NAMES = [
  "sprite_loader", "CODE_BBBB44", "CODE_BBBB53", "CODE_BBBB63", "check_if_sprite_offscreen_global", "CODE_BBBB7B",
  "delete_sprite_if_offscreen", "delete_sprite_if_offscreen_despawn", "CODE_BBBB99", "CODE_BBBB99_placed_by_level",
  "CODE_BBBB99_CODE_BBBBCE", "CODE_BBBB99_CODE_BBBBD6", "CODE_BBBB99_offscreen_placed_by_level", "CODE_BBBB99_CODE_BBBC1F",
  "CODE_BBBB99_CODE_BBBC2B", "CODE_BBBB99_CODE_BBBC42", "CODE_BBBC8D", "CODE_BBBCA3", "CODE_BBBCBF", "CODE_BBBCC1",
  "CODE_BBBCCD", "CODE_BBBCEE", "CODE_BBBCFA", "CODE_BBBD1B", "CODE_BBBD21", "CODE_BBBD6B",
];
for (const n of RTL_NAMES) setRetMode(L(n), RET_RTL);
for (const n of ["respawn_suppressor_sprite_code", "CODE_BBBC67", "CODE_BBBC8A"]) setRetMode(L(n), RET_SPRITE);

register({
  sprite_loader,
  CODE_BBB62F,
  CODE_BBB62F_done_handling_group,
  CODE_BBB62F_sprite_not_spawned_yet,
  CODE_BBB665,
  CODE_BBB668,
  CODE_BBB67D,
  CODE_BBB68A,
  CODE_BBB695,
  CODE_BBB6AC,
  CODE_BBB6D4,
  CODE_BBB6FB,
  CODE_BBB70A,
  kleever_hook_sprite_spawn,
  CODE_BBB75D,
  CODE_BBB77F,
  CODE_BBB790,
  CODE_BBB797,
  CODE_BBB7A6,
  CODE_BBB7DD,
  hidden_sprite_spawn,
  big_sprite_spawn,
  normal_sprite_spawn,
  return_sprite_loader_false,
  anti_piracy_activation_radius_check,
  conditional_spawn_1_radius_check,
  conditional_spawn_1_radius_check_2,
  conditional_spawn_2_radius_check,
  conditional_spawn_3_radius_check,
  default_activation_radius_check,
  return_sprite_loader_false_2,
  CODE_BBBA92,
  default_deactivation_radius_check,
  CODE_BBBAB8,
  CODE_BBBAD1,
  CODE_BBBAF3,
  check_placement_spawning_radius,
  check_placement_spawning_radius_out_of_spawn_range,
  CODE_BBBB44,
  CODE_BBBB53,
  CODE_BBBB63,
  check_if_sprite_offscreen_global,
  check_if_sprite_offscreen,
  check_if_sprite_offscreen_offscreen,
  CODE_BBBB7B,
  CODE_BBBB7F,
  CODE_BBBB7F_despawn,
  delete_sprite_if_offscreen,
  delete_sprite_if_offscreen_despawn,
  CODE_BBBB99,
  CODE_BBBB99_placed_by_level,
  CODE_BBBB99_CODE_BBBBCE,
  CODE_BBBB99_CODE_BBBBD6,
  CODE_BBBB99_offscreen_placed_by_level,
  CODE_BBBB99_CODE_BBBC1F,
  CODE_BBBB99_CODE_BBBC2B,
  CODE_BBBB99_CODE_BBBC42,
  respawn_suppressor_sprite_code,
  CODE_BBBC67,
  CODE_BBBC8A,
  CODE_BBBC8D,
  CODE_BBBCA3,
  CODE_BBBCBF,
  CODE_BBBCC1,
  CODE_BBBCCD,
  CODE_BBBCEE,
  CODE_BBBCFA,
  CODE_BBBD1B,
  CODE_BBBD21,
  CODE_BBBD6B,
  CODE_BBBD8E,
  CODE_BBBD91,
  CODE_BBBDA1,
  CODE_BBBDA4,
});
