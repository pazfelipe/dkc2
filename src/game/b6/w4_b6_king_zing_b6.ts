/**
 * Bank $B6 — King Zing's routines that live in bank $B6: his chase speed for the current HP,
 * the start of the hurt flight, and the return code of the big King Zing's hurt shake
 * (CODE_B6AF3E: shake along big_king_zing_damage_pos_offsets, then shrink at 3 HP or turn red).
 * Also release_held_sprite_from_kong (K. Rool / Kudgel make the Kongs drop what they hold).
 */
import { r16, w16, w8, bus16, rom16 } from "../../core/mem";
import { reg } from "../../core/cpu";
import { R } from "../../core/sym";
import {
  CODE_B6D923, CODE_BA92F2, interpolate_x_velocity_global, interpolate_y_velocity_global,
  set_sprite_palette_direct_global,
} from "../../gen/routines";
import { cur, rd, wr, dec, registerRtl, registerRts } from "./b6ba_common";
import { lda, lo, ge, add, sub } from "./w4_b6_util";

const PATTERNS = lo("king_zing_pattern_table");
const RED = lo("zinger_red_sprite_palette");
/** Frames before the stinger goes once King Zing shrinks (an operand that differs by revision). */
const SHRINK_DELAY_OPERAND = 0xb6afb4;

/** $B6AD9B — the Kong lets go of what he holds (unless it is the other Kong): carry = released. */
export function release_held_sprite_from_kong(): void {
  reg.a = r16(R.current_held_sprite);
  if (reg.a === r16(R.inactive_kong_sprite)) {
    reg.c = false;
    return;
  }
  w16(R.current_held_sprite, 0);
  reg.c = true;
}

/** King Zing's pattern for the current HP (DB = the table's bank while reading). */
function pattern(): number {
  reg.y = (r16(0x0652) << 1) & 0xffff;
  CODE_B6D923();
  reg.y = lda(PATTERNS + reg.y);
  return reg.y;
}

/** $B6ADC6 — chase speed: slow while a ring zinger lives, else from the HP's pattern. */
export function CODE_B6ADC6(): void {
  const db = reg.db;
  reg.db = 0xb6;
  reg.x = cur();
  reg.a = r16(0x071f);
  if (reg.a !== 0) {
    reg.a = 0x00b0;
    return CODE_B6ADE8(db);
  }
  CODE_B6ADD6(db);
}

/** $B6ADD6 */
export function CODE_B6ADD6(db = reg.db): void {
  const y = pattern();
  reg.a = lda(y + 4);
  reg.db = 0xb6;
  CODE_B6ADE8(db);
}

/** $B6ADE8 */
export function CODE_B6ADE8(db = reg.db): void {
  wr(reg.x, 0x28, reg.a);
  reg.a = 0x0005;
  wr(reg.x, 0x22, 0x0005);
  reg.db = db;
}

/** $B6ADF1 — start chasing after the hurt flight: speeds, hover wobble, spike shots. */
export function CODE_B6ADF1(): void {
  const db = reg.db;
  reg.db = 0xb6;
  const x = cur();
  reg.x = x;
  w16(0x070b, 0x0002);
  const y = pattern();
  wr(x, 0x28, lda(y + 4));
  wr(x, 0x22, 0x0005);
  wr(x, 0x2e, rd(x, 0x2e) & 0xfffb);
  w16(0x06e5, 0x0100);
  w16(0x06e7, 0x0100);
  w16(0x06e1, 0x001e);
  w16(0x06e3, 0x001b);
  reg.a = r16(0x0652);
  if (ge(reg.a, 0x0004)) {
    w16(0x06e9, lda(y + 6));
    w16(0x070d, 0x003c);
    reg.a = lda(y + 8);
    w16(0x070f, reg.a);
  }
  CODE_B6AE55(db);
}

/** $B6AE55 */
export function CODE_B6AE55(db = reg.db): void {
  reg.db = 0xb6;
  CODE_BA92F2();
  const x = reg.x;
  wr(x, 0x26, 0);
  wr(x, 0x2a, 0);
  wr(x, 0x20, 0);
  wr(x, 0x24, 0);
  reg.a = 0x0005;
  interpolate_x_velocity_global();
  reg.a = 0x0005;
  interpolate_y_velocity_global();
  reg.db = db;
}

/** `[$CE]` with $CE/$CF = Y and $D0 = $B6 (set by CODE_B6AF3E). */
const ce = () => bus16(0xb60000 | r16(0xce));

/** $B6AF2F — shaking to the left (not past x $01D0). */
export function CODE_B6AF2F(): void {
  reg.a = sub(rd(reg.x, 0x06), ce());
  if (!ge(reg.a, 0x01d0)) reg.a = 0x01d0;
  CODE_B6AF6A();
}

/**
 * $B6AF3E — return code after the big King Zing is hit: shake along the offsets table
 * ($20 up to $22, every $26 frames), then (hurt flag clear) go on with the script.
 */
export function CODE_B6AF3E(): void {
  const x = cur();
  reg.x = x;
  reg.a = rd(x, 0x20);
  if (reg.a === rd(x, 0x22)) return CODE_B6AF85();
  if (dec(x, 0x24) !== 0) return CODE_B6AF85();
  wr(x, 0x24, rd(x, 0x26));
  const y = rd(x, 0x20);
  w8(0xcf, 0xb6);
  w8(0xd0, 0xb6);
  w16(0xce, y);
  reg.y = rd(x, 0x42);
  reg.a = rd(x, 0x28);
  if (reg.a & 0x8000) return CODE_B6AF2F();
  reg.a = add(rd(x, 0x06), ce());
  if (ge(reg.a, 0x02b6)) reg.a = 0x02b6;
  CODE_B6AF6A();
}

/** $B6AF6A */
export function CODE_B6AF6A(): void {
  const x = reg.x;
  const y = reg.y;
  wr(x, 0x06, reg.a);
  wr(y, 0x06, reg.a);
  w16(0xce, r16(0xce) + 2);
  reg.a = add(rd(x, 0x0a), ce());
  wr(x, 0x0a, reg.a);
  wr(y, 0x0a, reg.a);
  reg.a = add(rd(x, 0x20), 0x0004);
  wr(x, 0x20, reg.a);
  CODE_B6AF85();
}

/** $B6AF85 */
export function CODE_B6AF85(): void {
  reg.a = rd(reg.x, 0x2e);
  if (reg.a & 0x1000) return CODE_B6AF8C();
  CODE_B6AF8D();
}

/** $B6AF8C */
export function CODE_B6AF8C(): void {}

/** $B6AF8D — shake over: at 3 HP shrink (bit 14, stinger goes), else turn red and chase. */
export function CODE_B6AF8D(): void {
  reg.x = (r16(0x0652) << 1) & 0xffff;
  CODE_B6D923();
  reg.y = lda(PATTERNS + reg.x);
  reg.db = 0xb6;
  const x = r16(0x0654);
  reg.x = x;
  w16(R.current_sprite, x);
  reg.a = r16(0x0652);
  if (reg.a !== 0x0003) return CODE_B6AFBC();
  wr(x, 0x2e, rd(x, 0x2e) | 0x4005);
  reg.a = rom16(SHRINK_DELAY_OPERAND);
  w16(0x071d, reg.a);
  CODE_B6AFDA();
}

/** $B6AFBC */
export function CODE_B6AFBC(): void {
  reg.a = r16(0x070b);
  if (reg.a === 0) {
    reg.a = RED;
    set_sprite_palette_direct_global();
    w16(0x0709, 0);
    const x = reg.x;
    wr(x, 0x2e, rd(x, 0x2e) | 0x0005);
    reg.a = rd(x, 0x2e) & 0xfdff;
    wr(x, 0x2e, reg.a);
  }
  CODE_B6AFDA();
}

/** $B6AFDA — resume the script at the command before the interrupted one. */
export function CODE_B6AFDA(): void {
  const x = reg.x;
  reg.a = sub(rd(x, 0x46), 0x0008);
  wr(x, 0x46, reg.a);
  wr(x, 0x44, 0);
  CODE_B6AF8C();
}

registerRts({
  release_held_sprite_from_kong, CODE_B6AF2F, CODE_B6AF3E, CODE_B6AF6A, CODE_B6AF85, CODE_B6AF8C,
  CODE_B6AF8D, CODE_B6AFBC, CODE_B6AFDA,
});
registerRtl({ CODE_B6ADC6, CODE_B6ADD6, CODE_B6ADE8, CODE_B6ADF1, CODE_B6AE55 });
