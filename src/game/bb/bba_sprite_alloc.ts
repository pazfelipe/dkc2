/**
 * Bank $BB (part a) — sprite slot and sprite VRAM allocation, sprite deletion, and the
 * "special sprite" spawners (sprites spawned by code rather than by the level's placement data).
 *
 * - The sprite table has 25 slots of 0x5E bytes at $0D84; slot 0 is auxiliary and slots 1-2 are
 *   the Kongs, so allocation scans from slot 1 (the Kongs are always present) and the
 *   allocated slot is published in `alternate_sprite`.
 * - Sprite graphics live in 14 VRAM slots tracked by `sprite_vram_allocation_table` ($0B04, one
 *   word per slot holding the owner sprite). The slot number becomes the sprite's OAM tile base
 *   (bits 0-8 of `oam_property`, slot*16 tiles).
 * - Special sprites are described by spawn scripts in bank $FF ("init scripts", see
 *   bba_initscript.ts); `DATA_FF047E` maps a special sprite id to its script.
 */
import { r16, w16, rom16 } from "../../core/mem";
import { reg, register } from "../../core/cpu";
import { setRetMode, RET_RTS } from "../../core/hybrid";
import { L, R, C, sprite, sprite_table } from "../../core/sym";
import { throw_exception, dereference_sprite_palette, apply_spawn_script_to_slot } from "../../gen/routines";
import { mergeBits } from "./bba_util";

const SPRITE_SIZE = 0x5e;
const SPECIAL_SPRITE_SCRIPTS = L("DATA_FF047E");
const VRAM_TABLE = R.sprite_vram_allocation_table;

/** $BB826F — allocate a sprite slot and one VRAM slot. Carry set on failure, else X = new sprite. */
export function handle_sprite_allocation() {
  allocate_sprite_table_slot();
  if (reg.c) return;
  const y = reg.y;
  allocate_sprite_vram_slot();
  reg.y = y;
  if (reg.c) return;
  clearRenderState(reg.x);
}

function clearRenderState(x: number) {
  w16(x + sprite.last_rendered_graphic, 0);
  w16(x + sprite.display_mode, 0);
  w16(x + sprite.terrain_attributes, 0);
}

/** $BB8282 — A = number of consecutive VRAM slots wanted (big sprites). */
export function handle_multi_vram_sprite_allocation() {
  const count = reg.a;
  allocate_sprite_table_slot();
  reg.a = count;
  if (reg.c) return;
  const y = reg.y;
  allocate_sprite_vram_multi_slot();
  reg.y = y;
  if (reg.c) return;
  clearRenderState(reg.x);
}

/** $BB8297 — find a free sprite slot (type 0) from slot 1 on. Carry clear + X = slot when found. */
export function allocate_sprite_table_slot() {
  for (let x: number = sprite_table.slot_1; x !== sprite_table.end; x += SPRITE_SIZE) {
    if (r16(x + sprite.type) === 0) {
      w16(R.alternate_sprite, x);
      reg.x = x;
      reg.c = false;
      return;
    }
  }
  // sprite table full
  w16(R.alternate_sprite, 0);
  reg.a = 0x0007;
  throw_exception();
  reg.x = sprite_table.end;
  reg.c = true;
}

/** $BB82B8 — delete the current sprite, releasing its palette and VRAM slot(s) as its type requires. */
export function delete_sprite_handle_deallocation() {
  const x = r16(R.current_sprite);
  reg.x = x;
  const type = r16(x + sprite.type);
  if (type === 0) return;
  if (type >= C.normal_sprite_type_range_start) return delete_sprite_force_deallocation();
  // .handle_big_or_static
  if (type >= C.large_sprite_type_range_end) return delete_sprite_no_deallocation();
  if (type >= C.large_sprite_type_range_start) {
    // big sprites own two VRAM slots
    reg.a = r16(x + sprite.oam_property);
    dereference_sprite_palette();
    reg.x = r16(R.current_sprite);
    deallocate_big_sprite_vram_slot();
    return delete_sprite_no_deallocation_2();
  }
  // .dereference_static_sprite: static sprites share their VRAM slot with every sprite of the same
  // type; the slot is only released when the last one goes away
  w16(0x32, type);
  for (let s: number = sprite_table.slot_3; s !== sprite_table.end; s += SPRITE_SIZE) {
    if (r16(s + sprite.type) !== type) continue;
    if (s === r16(R.current_sprite)) continue;
    // another sprite still uses the graphics: only drop the palette reference
    const cur = r16(R.current_sprite);
    reg.x = cur;
    reg.a = r16(cur + sprite.oam_property);
    dereference_sprite_palette();
    return delete_sprite_no_deallocation_2();
  }
  reg.x = r16(R.current_sprite);
  delete_sprite_force_deallocation();
}

/** $BB82C3 — X = sprite. Release palette and VRAM slot, then clear the current sprite's type. */
export function delete_sprite_force_deallocation() {
  reg.a = r16(reg.x + sprite.oam_property);
  dereference_sprite_palette();
  reg.x = r16(R.current_sprite);
  deallocate_sprite_vram_slot();
  delete_sprite_no_deallocation_2();
}

/** $BB82CD */
export function delete_sprite_no_deallocation_2() {
  const x = r16(R.current_sprite);
  reg.x = x;
  w16(x + sprite.type, 0);
}

/** $BB82D2 — delete the current sprite without touching palette/VRAM bookkeeping. */
export function delete_sprite_no_deallocation() {
  const x = r16(R.current_sprite);
  reg.x = x;
  w16(x + sprite.type, 0);
}

/** $BB8318 — X = sprite. Take the highest free VRAM slot and point the sprite's tile base at it. */
export function allocate_sprite_vram_slot() {
  const x = reg.x;
  for (let y = 0x1a; y >= 0; y -= 2) {
    if (r16(VRAM_TABLE + y) !== 0) continue;
    w16(VRAM_TABLE + y, x);
    const oam = mergeBits(r16(x + sprite.oam_property), y << 4, 0x01ff);
    w16(x + sprite.oam_property, oam);
    reg.a = oam;
    reg.y = y;
    reg.c = false;
    return;
  }
  // no free VRAM slot
  reg.y = 0xfffe;
  reg.a = 0x0006;
  throw_exception();
  reg.c = true;
}

/** $BB8341 */
export function allocate_sprite_vram_multi_slot_global() {
  allocate_sprite_vram_multi_slot();
}

/**
 * $BB8345 — A = slot count, X = sprite. Find `count` consecutive free VRAM slots (scanning down
 * from slot $18/2) and assign them all to the sprite; its tile base is the lowest slot.
 */
export function allocate_sprite_vram_multi_slot() {
  const x = reg.x;
  const count = reg.a & 0xffff;
  w16(0x32, count);
  w16(0x34, count);
  const lowest = ((count << 1) + 0xfffe) & 0xffff;
  w16(0x36, lowest);
  let y = 0x0018;
  const tableAt = (i: number) => r16(VRAM_TABLE + (i & 0xffff));
  // .CODE_BB8353 / .CODE_BB8358: look for the first free slot of a run
  for (;;) {
    if (tableAt(y) === 0) {
      // .free_slot_found_2 / .CODE_BB836D: count the run downwards
      let found = false;
      for (;;) {
        const left = (r16(0x32) - 1) & 0xffff;
        w16(0x32, left);
        if (left === 0) {
          found = true;
          break;
        }
        y = (y - 2) & 0xffff;
        if (tableAt(y) !== 0) {
          // .CODE_BB8367: run broken, restart the count
          w16(0x32, r16(0x34));
          break;
        }
      }
      if (found) break;
    }
    y = (y - 2) & 0xffff;
    if (((y - r16(0x36)) & 0x8000) !== 0) {
      reg.y = y;
      reg.a = 0x0003;
      throw_exception();
      reg.c = true;
      return;
    }
  }
  // .CODE_BB837A: the run ends at Y (its lowest slot), claim it upwards
  const oam = mergeBits(r16(x + sprite.oam_property), (y << 4) & 0xffff, 0x01ff);
  w16(x + sprite.oam_property, oam);
  for (;;) {
    w16(VRAM_TABLE + y, x);
    const left = (r16(0x34) - 1) & 0xffff;
    w16(0x34, left);
    if (left === 0) break;
    y = (y + 2) & 0xffff;
  }
  reg.a = x;
  reg.y = y;
  reg.c = false;
}

/** $BB839C — (unused) count free VRAM slots from Y down to slot 4; X = running count. */
export function CODE_BB839C() {
  let y = reg.y & 0xffff;
  let x = reg.x & 0xffff;
  for (;;) {
    if (r16(VRAM_TABLE + y) === 0) x = (x + 1) & 0xffff;
    // CODE_BB83A2
    y = (y - 2) & 0xffff;
    if (((y - 0x0008) & 0x8000) !== 0) break;
  }
  reg.x = x;
  reg.y = y;
  reg.a = x;
  if (x === 0) return CODE_BB83AE();
  reg.c = false;
}

/** $BB83A2 — (unused) loop tail of CODE_BB839C. */
export function CODE_BB83A2() {
  reg.y = (reg.y - 2) & 0xffff;
  if (((reg.y - 0x0008) & 0x8000) === 0) return CODE_BB839C();
  reg.a = reg.x;
  if (reg.x === 0) return CODE_BB83AE();
  reg.c = false;
}

/** $BB83AE — no free VRAM slot. */
export function CODE_BB83AE() {
  reg.c = true;
}

/** $BB83B4 — X = sprite. Free its VRAM slot. */
export function deallocate_sprite_vram_slot() {
  const y = (r16(reg.x + sprite.oam_property) & 0x01e0) >> 4;
  w16(VRAM_TABLE + y, 0);
  reg.y = y;
  reg.a = 0;
}

/** $BB83C5 — X = sprite. Free the two VRAM slots of a big sprite. */
export function deallocate_big_sprite_vram_slot() {
  const y = (r16(reg.x + sprite.oam_property) & 0x01e0) >> 4;
  reg.y = y;
  if (r16(VRAM_TABLE + y) === r16(VRAM_TABLE + y + 2)) {
    w16(VRAM_TABLE + y, 0);
    w16(VRAM_TABLE + y + 2, 0);
    reg.a = 0;
    return;
  }
  // .slot_mismatch: the second slot belongs to someone else
  w16(VRAM_TABLE + y, 0);
  reg.a = 0x0004;
  throw_exception();
}

/** Y = special sprite id -> Y = its spawn script (LDA.l DATA_FF047E,x). */
function scriptForSpecialSprite() {
  reg.x = reg.y;
  reg.y = rom16(SPECIAL_SPRITE_SCRIPTS + reg.y);
  reg.a = reg.y;
}

/** $BB83EF — Y = special sprite id. Spawns a sprite whose graphics are set up by its script. */
export function spawn_BB83EF_special_sprite_index() {
  scriptForSpecialSprite();
  spawn_BB83EF_special_sprite_address();
}

/** $BB83F5 — Y = spawn script. Sprite slot only (no VRAM slot), display mode $C000. */
export function spawn_BB83EF_special_sprite_address() {
  const y = reg.y;
  allocate_sprite_table_slot();
  reg.y = y;
  if (reg.c) return;
  const x = reg.x;
  w16(x + sprite.placement_number, 0);
  w16(x + sprite.placement_parameter, 0x000f);
  w16(x + sprite.display_mode, 0xc000);
  w16(x + sprite.current_graphic, 0);
  w16(x + sprite.last_rendered_graphic, 0);
  w16(x + sprite.animation_flags, 0);
  reg.a = 0xc000;
  spawn_BB8462_special_sprite_address();
}

/** $BB8412 */
export function spawn_no_gfx_special_sprite_index() {
  scriptForSpecialSprite();
  spawn_no_gfx_special_sprite_address();
}

/** $BB8418 — Y = spawn script. Sprite slot only, nothing displayed. */
export function spawn_no_gfx_special_sprite_address() {
  const y = reg.y;
  allocate_sprite_table_slot();
  reg.y = y;
  if (reg.c) return;
  const x = reg.x;
  w16(x + sprite.placement_number, 0);
  w16(x + sprite.placement_parameter, 0x000f);
  w16(x + sprite.display_mode, 0);
  reg.a = 0x000f;
  spawn_BB8462_special_sprite_address();
}

/** $BB842C */
export function spawn_special_sprite_index() {
  scriptForSpecialSprite();
  spawn_special_sprite_address();
}

/** $BB8432 — Y = spawn script. Sprite slot plus one VRAM slot. */
export function spawn_special_sprite_address() {
  const y = reg.y;
  handle_sprite_allocation();
  reg.y = y;
  if (reg.c) return;
  const x = reg.x;
  w16(x + sprite.placement_number, 0);
  w16(x + sprite.placement_parameter, 0x000f);
  reg.a = 0x000f;
  spawn_BB8462_special_sprite_address();
}

/** $BB8443 — Y = special sprite id. Sprite slot plus two VRAM slots. */
export function spawn_big_special_sprite_index() {
  scriptForSpecialSprite();
  reg.a = 0x0002;
  const y = reg.y;
  handle_multi_vram_sprite_allocation();
  reg.y = y;
  if (reg.c) return;
  const x = reg.x;
  w16(x + sprite.placement_number, 0);
  w16(x + sprite.placement_parameter, 0x000f);
  reg.a = 0x000f;
  spawn_BB8462_special_sprite_address();
}

/** $BB845D */
export function apply_spawn_script_to_slot_global() {
  apply_spawn_script_to_slot();
}

/** $BB8462 — Y = special sprite id (used once, for the group manager sprite). */
export function spawn_BB8462_special_sprite_index() {
  scriptForSpecialSprite();
  spawn_BB8462_special_sprite_address();
}

/** $BB8468 — Y = spawn script. Clear the new sprite's interaction state and run its script. */
export function spawn_BB8462_special_sprite_address() {
  const x = r16(R.alternate_sprite);
  reg.x = x;
  w16(x + sprite.terrain_interaction, 0);
  w16(x + sprite.interaction_flags, 0);
  w16(x + sprite.unknown_2C, 0);
  w16(x + sprite.placement_number, 0);
  w16(x + sprite.carry_or_defeat_flags, 0);
  apply_spawn_script_to_slot();
}

// static labels (`#name:`) have no generated stub, so give their return kind explicitly
setRetMode(L("allocate_sprite_vram_multi_slot"), RET_RTS);

register({
  handle_sprite_allocation,
  handle_multi_vram_sprite_allocation,
  allocate_sprite_table_slot,
  delete_sprite_handle_deallocation,
  delete_sprite_force_deallocation,
  delete_sprite_no_deallocation_2,
  delete_sprite_no_deallocation,
  allocate_sprite_vram_slot,
  allocate_sprite_vram_multi_slot_global,
  allocate_sprite_vram_multi_slot,
  CODE_BB839C,
  CODE_BB83A2,
  CODE_BB83AE,
  deallocate_sprite_vram_slot,
  deallocate_big_sprite_vram_slot,
  spawn_BB83EF_special_sprite_index,
  spawn_BB83EF_special_sprite_address,
  spawn_no_gfx_special_sprite_index,
  spawn_no_gfx_special_sprite_address,
  spawn_special_sprite_index,
  spawn_special_sprite_address,
  spawn_big_special_sprite_index,
  apply_spawn_script_to_slot_global,
  spawn_BB8462_special_sprite_index,
  spawn_BB8462_special_sprite_address,
});
