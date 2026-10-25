/**
 * Bank $B3 — Puftup ($B3CA1A), its spikes ($B3CB38), defeat_aquatic_sprite_using_anim and the
 * little movement-script interpreter CODE_B3CB55 shared by Puftup, Kloak and Kackle.
 */
import { r16, w16, rom16, bus8, bus16 } from "../../core/mem";
import { reg } from "../../core/cpu";
import { L, R, C, sprite } from "../../core/sym";
import {
  defeat_sprite_using_animation,
  check_throwable_collision_global,
  get_current_sprite_clipping,
  CODE_BEBE8B,
  process_current_movement,
  process_sprite_animation,
  force_sprite_submerged,
  delete_sprite_handle_deallocation,
  spawn_special_sprite_index,
  spawn_no_gfx_special_sprite_index,
  set_alt_sprite_animation,
  set_sprite_animation,
} from "../../gen/routines";
import {
  cur, sr, sw, sr8, sw8, neg, isNeg, facingLeft, spriteStateHandler, returnHandleDespawn,
  fallOffScreen, callPtrB3, registerSprite, registerRts, registerRtl,
} from "./b3c_common";
import { CODE_B3C6C0 } from "./b3c_kutlass_krook";

/**
 * $B3C9CB — defeat an underwater enemy (A = death animation): it faces the attacker and is
 * knocked away; harder when Enguarde charged it (kong state $52).
 */
export function defeat_aquatic_sprite_using_anim() {
  defeat_sprite_using_animation();
  const attacker = r16(R.colliding_sprite);
  reg.y = attacker;
  const attackerDir = sr(attacker, sprite.oam_property) & 0x4000;
  const x = cur();
  reg.x = x;
  const oam = sr(x, sprite.oam_property);
  sw(x, sprite.oam_property, (((attackerDir ^ oam) & 0x4000) ^ oam) ^ 0x4000);
  if (attacker === r16(R.active_kong_sprite) && sr(attacker, sprite.state) === C.kong_state_52) {
    reg.a = 0x0c00;
    reg.y = 0x0800;
    return CODE_B3C9FF();
  }
  CODE_B3C9F9();
}

/** $B3C9F9 */
export function CODE_B3C9F9() {
  reg.a = 0x0800;
  reg.y = 0x0400;
  CODE_B3C9FF();
}

/** $B3C9FF — A = x speed, Y = y speed - $C00 / max y speed. */
export function CODE_B3C9FF() {
  if (!facingLeft(reg.x)) reg.a = neg(reg.a);
  CODE_B3CA07();
}

/** $B3CA07 */
export function CODE_B3CA07() {
  const x = reg.x;
  const y = reg.y;
  sw(x, sprite.max_x_speed, reg.a);
  sw(x, sprite.x_speed, reg.a);
  reg.a = (y - 0x0c00) & 0xffff;
  sw(x, sprite.y_speed, reg.a);
  sw(x, sprite.max_y_speed, y);
  reg.a = 0x000f;
  sw(x, sprite.movement_state, 0x000f);
}

// =============================================================================================
// Puftup

const PUFTUP_TABLE = L("puftup_main") + 3;

/** $B3CA1A */
export function puftup_main() {
  spriteStateHandler(PUFTUP_TABLE);
}

/** $B3CA23 — state 0: swim along the movement script. */
export function CODE_B3CA23() {
  reg.a = 0x0118;
  check_throwable_collision_global();
  if (reg.c) return CODE_B3CA4D();
  get_current_sprite_clipping();
  reg.a = 0x1400;
  CODE_BEBE8B();
  if (reg.c) return CODE_B3CA4D();
  CODE_B3CA39();
}

/** $B3CA39 */
export function CODE_B3CA39() {
  CODE_B3CB55();
  if (reg.z) process_sprite_animation(); // the script did not change the animation
  CODE_B3CA43();
}

/** $B3CA43 */
export function CODE_B3CA43() {
  process_current_movement();
  force_sprite_submerged();
  returnHandleDespawn();
}

/** $B3CA4D — Z clear: it hurt the Kong (keep swimming); else defeated (state 2). */
export function CODE_B3CA4D() {
  if (!reg.z) return CODE_B3CA39();
  sw(reg.x, sprite.state, 0x0002);
  reg.a = C.puftup_death_anim_id;
  defeat_aquatic_sprite_using_anim();
  returnHandleDespawn();
}

/** $B3CA5D — state 1: burst into spikes. */
export function CODE_B3CA5D() {
  CODE_B3CA85();
  const x = cur();
  reg.x = x;
  w16(R.contact_flash_x_position, sr(x, sprite.x_position));
  w16(R.contact_flash_y_position, sr(x, sprite.y_position));
  delete_sprite_handle_deallocation();
  reg.y = C.special_sprite_spawn_id_0034;
  spawn_special_sprite_index();
}

/** $B3CA7A — state 2: defeated. */
export function CODE_B3CA7A() {
  process_current_movement();
  process_sprite_animation();
  fallOffScreen();
}

const SPIKE_DATA = L("DATA_B3CB08");

/**
 * $B3CA85 — spawn 4 spikes (Y = the Puftup): speed = ground_y_position, set 0 or 1 of the
 * 6-byte spike table (x offset, y offset, flags: bit0 x speed, bit1 y speed, bits 14-15 flip).
 */
export function CODE_B3CA85() {
  reg.db = 0xb3;
  const y = reg.y;
  w16(0x0a92, sr(y, sprite.ground_y_position));
  const set = sr(y, sprite.ground_distance);
  w16(0x0a94, set);
  reg.x = set === 0 ? 0x0000 : 0x0018;
  CODE_B3CA9D();
}

/** $B3CA9A */
export function CODE_B3CA9A() {
  reg.x = 0x0018;
  CODE_B3CA9D();
}

/** $B3CA9D */
export function CODE_B3CA9D() {
  w16(0x0a96, reg.x);
  w16(0x0a9a, 0x0004);
  CODE_B3CAA6();
}

/** $B3CAA6 — spawn one spike, loop until $0A9A reaches 0. */
export function CODE_B3CAA6() {
  do {
    reg.y = C.special_sprite_spawn_id_0086;
    spawn_no_gfx_special_sprite_index();
    reg.a = C.puftup_spike_anim_id;
    set_alt_sprite_animation();
    const x = r16(R.alternate_sprite);
    reg.x = x;
    const i = r16(0x0a96);
    reg.y = i;
    w16(0x0a96, i + 6);
    sw(x, sprite.x_position, rom16(SPIKE_DATA + i) + sr(x, sprite.x_position));
    sw(x, sprite.y_position, rom16(SPIKE_DATA + 2 + i) + sr(x, sprite.y_position));
    let flags = rom16(SPIKE_DATA + 4 + i);
    sw(x, sprite.oam_property, (flags & 0xc000) ^ sr(x, sprite.oam_property));
    let carry = flags & 1;
    flags >>= 1;
    if (carry) {
      const v = r16(0x0a92);
      sw(x, sprite.x_speed, facingLeft(x) ? neg(v) : v);
    }
    carry = flags & 1;
    flags >>= 1;
    w16(0x0a9c, flags);
    if (carry) {
      const v = r16(0x0a92);
      sw(x, sprite.y_speed, isNeg(sr(x, sprite.oam_property)) ? v : neg(v));
    }
    w16(0x0a9a, r16(0x0a9a) - 1);
  } while (r16(0x0a9a) !== 0);
}

/** $B3CB38 — a spike: hurts on contact, flies off. */
export function puftup_spikes_main() {
  const y = cur();
  reg.y = y;
  w16(R.current_sprite_constants, sr(y, sprite.constants_address));
  get_current_sprite_clipping();
  reg.a = 0x0000;
  CODE_BEBE8B();
  process_current_movement();
  process_sprite_animation();
  returnHandleDespawn();
}

// =============================================================================================
// Movement scripts (CODE_B3CB55)

const SCRIPT_MODES = L("DATA_B3CB6C");
const SCRIPT_COMMANDS = L("DATA_B3CBB9");

/**
 * $B3CB55 — run the sprite's movement script for this frame. The low 3 bits of sub_state are
 * the current wait mode (0 = read commands, 1 = timer, 2 = Kong in range, 5 = pass the Kong's
 * position); bit 3 is preserved. Returns with the flags of comparing the animation id before
 * and after (Z set when the script did not change the animation).
 */
export function CODE_B3CB55() {
  const y = cur();
  reg.y = y;
  const index = (sr8(y, sprite.sub_state) * 2) & 0xffff;
  reg.x = index;
  const before = sr(y, sprite.animation_id);
  callPtrB3(rom16(SCRIPT_MODES + index));
  const x = cur();
  reg.x = x;
  const after = sr(x, sprite.animation_id);
  reg.a = before;
  reg.z = before === after;
  reg.c = before >= after;
  reg.n = isNeg(before - after);
}

const script = () => (r16(R.temp_34) << 16) | r16(R.temp_32);
const scriptByte = (i: number) => bus8((script() + (i & 0xffff)) & 0xffffff);
const scriptWord = (i: number) => bus16((script() + (i & 0xffff)) & 0xffffff);
const setMode = (x: number, mode: number) => sw8(x, sprite.sub_state, (sr8(x, sprite.sub_state) & 0x08) | mode);

/**
 * $B3CB8C — mode 0: read the script at gp50 (bank = constants bank). Bytes below $80 are
 * "store the next word at this offset of the sprite"; $FF-$F6 are commands.
 */
export function CODE_B3CB8C() {
  const x = reg.y;
  reg.x = x;
  w16(R.temp_32, sr(x, sprite.general_purpose_50));
  w16(R.temp_34, r16(R.current_sprite_constants_bank));
  reg.y = 0;
  CODE_B3CB98();
}

/** $B3CB98 */
export function CODE_B3CB98() {
  let y = reg.y;
  for (;;) {
    const op = scriptByte(y);
    if (op >= 0x80) {
      reg.y = y;
      reg.a = op;
      return CODE_B3CBB1();
    }
    y++;
    // PHA : PLD : STA $00,x — the store goes to sprite + offset through the direct page
    sw(reg.x, op, scriptWord(y));
    y += 2;
  }
}

/** $B3CBB1 — dispatch command $FF - A. */
export function CODE_B3CBB1() {
  const index = ((reg.a ^ 0x00ff) << 1) & 0xffff;
  reg.x = index;
  callPtrB3(rom16(SCRIPT_COMMANDS + index));
}

/** $B3CBCD — $FF: stop (mode 3). */
export function CODE_B3CBCD() {
  const x = cur();
  reg.x = x;
  setMode(x, 0x03);
}

/** $B3CBDC — $FE: jump. */
export function CODE_B3CBDC() {
  const x = cur();
  reg.x = x;
  reg.y++;
  sw(x, sprite.general_purpose_50, scriptWord(reg.y));
}

/** $B3CBE4 — $FD: set animation, continue next frame. */
export function CODE_B3CBE4() {
  const y = reg.y + 1;
  reg.y = y;
  reg.a = scriptWord(y);
  set_sprite_animation();
  reg.y = y + 2;
  CODE_B3CC5B();
}

/** $B3CBF1 — $FC: wait n frames (mode 1). */
export function CODE_B3CBF1() {
  const x = cur();
  reg.x = x;
  const y = reg.y + 1;
  sw(x, sprite.unknown_22, scriptWord(y));
  setMode(x, 0x01);
  reg.y = y + 2;
  CODE_B3CC5B();
}

/** $B3CC08 — $FB: wait until the Kong is within the given x/y ranges (mode 2). */
export function CODE_B3CC08() {
  const x = cur();
  reg.x = x;
  let y = reg.y + 1;
  sw(x, sprite.unknown_22, scriptWord(y));
  y += 2;
  sw(x, sprite.unknown_28, scriptWord(y));
  setMode(x, 0x02);
  reg.y = y + 2;
  CODE_B3CC5B();
}

/** $B3CC25 — $FA: call a sub-script (the return point is kept in $4E). */
export function CODE_B3CC25() {
  const x = cur();
  reg.x = x;
  let y = reg.y + 1;
  sw(x, sprite.general_purpose_50, scriptWord(y));
  y++;
  reg.y = y;
  sw(x, 0x4e, y + r16(R.temp_32) + 1);
}

/** $B3CC34 — $F9: return from a sub-script. */
export function CODE_B3CC34() {
  const x = cur();
  reg.x = x;
  sw(x, sprite.general_purpose_50, sr(x, 0x4e));
}

/** $B3CC3B — $F8: wait for the end of the animation (mode 4). */
export function CODE_B3CC3B() {
  const x = cur();
  reg.x = x;
  setMode(x, 0x04);
  reg.y++;
  CODE_B3CC5B();
}

/** $B3CC4C — $F7: set bit 3 of the sub-state. */
export function CODE_B3CC4C() {
  const x = cur();
  reg.x = x;
  sw8(x, sprite.sub_state, sr8(x, sprite.sub_state) | 0x08);
  reg.y++;
  CODE_B3CC5B();
}

/** $B3CC5B — advance the script pointer by Y. */
export function CODE_B3CC5B() {
  const x = reg.x;
  reg.a = (reg.y + sr(x, sprite.general_purpose_50)) & 0xffff;
  sw(x, sprite.general_purpose_50, reg.a);
}

/** $B3CC62 — $F6: move towards a point past the Kong (mode 5). */
export function CODE_B3CC62() {
  const x = cur();
  reg.x = x;
  let y = reg.y + 1;
  sw(x, sprite.unknown_22, scriptWord(y));
  y += 2;
  sw(x, sprite.unknown_28, scriptWord(y));
  setMode(x, 0x05);
  y += 2;
  CODE_B3CCA8();
  CODE_B3CCA8();
  reg.y = y;
  CODE_B3CC5B();
}

/** $B3CC87 — mode 1: count down the wait. */
export function CODE_B3CC87() {
  const x = reg.y;
  reg.x = x;
  const t = (sr(x, sprite.unknown_22) - 1) & 0xffff;
  sw(x, sprite.unknown_22, t);
  if (t === 0) CODE_B3CC98();
}

/** $B3CC8D — mode 2: wait until the Kong is within range. */
export function CODE_B3CC8D() {
  const x = reg.y;
  reg.x = x;
  reg.a = sr(x, sprite.unknown_22);
  reg.y = sr(x, sprite.unknown_28);
  CODE_B3C6C0();
  if (!reg.c) CODE_B3CC98();
}

/** $B3CC98 — back to mode 0 (read commands). */
export function CODE_B3CC98() {
  const x = reg.x;
  sw(x, sprite.state, sr(x, sprite.state) & 0x08ff);
}

/** $B3CCA0 — modes 3 and 4: nothing to do. */
export function CODE_B3CCA0() {}

/** $B3CCA1 — mode 5: done once the Kong is passed. */
export function CODE_B3CCA1() {
  reg.x = reg.y;
  CODE_B3CCA8();
  if (reg.c) CODE_B3CC98();
}

/**
 * $B3CCA8 — u22/u28 hold target x/y (15 bits) with bit 15 = which side of the Kong it is on;
 * refresh that bit. Carry set when the side changed (the Kong passed the target).
 */
export function CODE_B3CCA8() {
  const x = reg.x;
  const kong = r16(R.active_kong_sprite);
  reg.y = kong;
  const tx = sr(x, sprite.unknown_22);
  if (tx !== 0) {
    if (refreshSide(x, sprite.unknown_22, sr(kong, sprite.x_position))) {
      reg.c = true;
      return;
    }
  }
  CODE_B3CCC3();
}

/** `ASL : STA temp_32 : LSR : CMP pos : ROR temp_32 : LDA f : EOR temp_32 : ASL : LDA temp_32 : STA f` */
function refreshSide(x: number, field: number, pos: number): boolean {
  const old = sr(x, field);
  const target = old & 0x7fff;
  const v = (target >= pos ? 0x8000 : 0) | target;
  w16(R.temp_32, v);
  sw(x, field, v);
  reg.a = v;
  return ((old ^ v) & 0x8000) !== 0;
}

/** $B3CCC3 */
export function CODE_B3CCC3() {
  const x = reg.x;
  if (sr(x, sprite.unknown_28) === 0) return CODE_B3CCDA();
  reg.c = refreshSide(x, sprite.unknown_28, sr(reg.y, sprite.y_position));
}

/** $B3CCDA */
export function CODE_B3CCDA() {
  reg.c = false;
}

/** $B3CCDB */
export function CODE_B3CCDB() {}

registerSprite({
  puftup_main, CODE_B3CA23, CODE_B3CA39, CODE_B3CA43, CODE_B3CA4D, CODE_B3CA5D, CODE_B3CA7A,
  puftup_spikes_main,
});
registerRts({
  defeat_aquatic_sprite_using_anim, CODE_B3C9F9, CODE_B3C9FF, CODE_B3CA07, CODE_B3CA85,
  CODE_B3CA9A, CODE_B3CA9D, CODE_B3CAA6, CODE_B3CB8C, CODE_B3CB98, CODE_B3CBB1, CODE_B3CBCD,
  CODE_B3CBDC, CODE_B3CBE4, CODE_B3CBF1, CODE_B3CC08, CODE_B3CC25, CODE_B3CC34, CODE_B3CC3B,
  CODE_B3CC4C, CODE_B3CC5B, CODE_B3CC62, CODE_B3CC87, CODE_B3CC8D, CODE_B3CC98, CODE_B3CCA0,
  CODE_B3CCA1, CODE_B3CCA8, CODE_B3CCC3, CODE_B3CCDA, CODE_B3CCDB,
});
registerRtl({ CODE_B3CB55 });
