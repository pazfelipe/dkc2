/**
 * Bank $BC — sprite clipping (hitboxes) and collision detection.
 *
 * Hitboxes are ROM data in this bank: `sprite_hitbox_table` maps a sprite graphic to a box
 * (x offset, y offset, width, height), `special_hitboxes` holds extra boxes (pickup range,
 * animal attacks, ...). Each frame the boxes are turned into world-space clipping rectangles
 * (left, top, right, bottom) in the `sprite_clipping` slots at $09A3 (8 bytes each):
 *   0-2  active Kong: 0 = body, 1 = special box, 2 = union of 0 and 1 (broad phase),
 *   3-5  inactive Kong (same layout),
 *   6-8  current sprite (same layout),
 *   9    the dummy Kong riding an animal buddy.
 * A slot whose `right` is 0 is empty. Collision checks compare the current sprite's slots with
 * a Kong's slots and report which pairs touched in `sprite_collision_result`.
 *
 * Several routines here point the direct page at a clipping slot (TCD / PHY : PLD) and use
 * DP-relative operands (`rel_sprite_clipping`). The direct page is modelled by `dp` below;
 * the public (JSL) entry points save and restore it like their PHD/PLD pairs.
 */
import { r16, w16, rom16, bus8 } from "../../core/mem";
import { reg, register } from "../../core/cpu";
import { L, R, sprite, sprite_table, rel_sprite_clipping as rel } from "../../core/sym";

const BANK = 0xbc;
const SPRITE_HITBOX_TABLE = L("sprite_hitbox_table");
const SPECIAL_HITBOXES = L("special_hitboxes") & 0xffff;
const CHECK_ACTIVE_KONG_COLLISION = L("check_active_kong_collision");
const CHECK_INACTIVE_KONG_COLLISION = L("check_inactive_kong_collision");

const CLIP_SIZE = 8;
/** WRAM address of clipping slot n. */
const slot = (n: number) => R.sprite_clipping + n * CLIP_SIZE;
const SPRITE_SIZE = 0x5e;

/** temp_sprite_clipping[0/1] (direct page $D9 / $E1). */
const TEMP0 = R.temp_sprite_clipping;
const TEMP1 = R.temp_sprite_clipping + CLIP_SIZE;

/** Current direct page while the clipping helpers run (0 outside of them). */
let dp = 0;

/** Absolute indexed word read in a data bank (crosses into the next bank like the 65816). */
function absIndexed16(bank: number, addr: number): number {
  const full = ((bank & 0xff) << 16) + addr;
  return bus8(full & 0xffffff) | (bus8((full + 1) & 0xffffff) << 8);
}
/**
 * Special hitbox $1E is past the end of special_hitboxes ($0F entries): the original reads the
 * 8 bytes at $BCFAF0, which are instruction bytes of get_active_kong_clipping ($BCFAEA). They
 * act as a hitbox (seen in the Haunted Hall ride). The port has no code bytes, so these four
 * words (x offset, y offset, width, height as for every hitbox) are kept here as constants.
 */
const HITBOX_1E: Record<number, number> = { 0xfaf0: 0x0b2b, 0xfaf2: 0xa3a0, 0xfaf4: 0x2c09, 0xfaf6: 0x09a7 };
/** `LDA $xxxx,y` with DB = $BC (hitbox data; $0000-$1FFF would be WRAM). */
const hitbox16 = (addr: number) => HITBOX_1E[addr & 0xffff] ?? absIndexed16(BANK, addr);
/** `LDA.w $xxxx,y` through the caller's data bank. */
const dbRead16 = (addr: number) => absIndexed16(reg.db, addr);

/** Store a 24-bit collision routine pointer the way the original does (two 16-bit stores). */
function setCollisionRoutine(addr: number) {
  w16(R.sprite_collision_routine_addr_high, (addr >> 8) & 0xffff);
  w16(R.sprite_collision_routine_address, addr & 0xffff);
}

// ---------------------------------------------------------------------------------------------
// Building clipping slots
// ---------------------------------------------------------------------------------------------

/** $BCFA78 — start of the frame: clear the Kong clipping slots, default collision routine. */
export function init_player_clipping() {
  for (const n of [0, 1, 2, 3, 4, 5, 9]) w16(slot(n) + rel.right, 0);
  setCollisionRoutine(CHECK_ACTIVE_KONG_COLLISION);
}

/**
 * $BCFA9A — A = special hitbox index: give the current Kong a special box (attack/pickup range)
 * in its slot 1 (slot 4 and the inactive-Kong collision routine for the inactive Kong).
 */
export function init_special_player_clipping() {
  specialPlayerClipping(1, 4, populate_special_sprite_clipping);
}

/** $BCFAC2 — (unused) like init_special_player_clipping but in slot 0 (3), filling slot 2 (5). */
export function init_special_player_clipping_slot_0() {
  specialPlayerClipping(0, 3, CODE_BCFBCC);
}

function specialPlayerClipping(activeSlot: number, inactiveSlot: number, populate: () => void) {
  const savedDp = dp;
  let base = slot(activeSlot);
  const x = r16(R.current_sprite);
  reg.x = x;
  if (x !== r16(R.active_kong_sprite)) {
    setCollisionRoutine(CHECK_INACTIVE_KONG_COLLISION);
    w16(R.RAM_0D38, 0x0002);
    base = slot(inactiveSlot);
  }
  reg.y = base;
  get_special_hitbox_clipping();
  populate();
  dp = savedDp;
}

/** $BCFAEA — clipping of the active Kong (slot 0/1 -> 2), its skull cart or ridden animal (9). */
export function get_active_kong_clipping() {
  const x = r16(R.current_sprite);
  reg.x = x;
  reg.c = x >= r16(R.active_kong_sprite); // CPX
  if (x !== r16(R.active_kong_sprite)) return;
  const savedDp = dp;
  // BIT with whatever the caller left in A: slot 0 is taken when bits overlap
  reg.y = reg.a & r16(slot(0) + rel.right) ? slot(1) : slot(0);
  get_sprite_clipping();
  reg.a = slot(0);
  populate_main_sprite_clipping();
  dp = savedDp;
  const cart = r16(R.ridden_skull_cart_sprite);
  reg.x = cart;
  if (cart) {
    // .handle_skull_cart_clipping: the cart is the Kong's slot 1
    reg.y = slot(1);
    get_sprite_clipping();
    reg.a = slot(0);
    populate_main_sprite_clipping();
    dp = savedDp;
    return;
  }
  reg.a = r16(R.animal_type);
  if (!reg.a) return;
  const mount = r16(R.current_player_mount);
  reg.x = mount;
  if (!mount) return;
  reg.y = slot(9);
  get_sprite_clipping();
  dp = savedDp;
}

/** $BCFB2C — clipping of the inactive Kong (slots 3-5), and select its collision routine. */
export function CODE_BCFB2C() {
  const savedDp = dp;
  reg.x = r16(R.inactive_kong_sprite);
  reg.y = slot(3);
  if (r16(slot(3) + rel.right)) {
    w16(R.RAM_0D38, 0x0002);
    reg.y = slot(4);
  }
  CODE_BCFB41();
  dp = savedDp;
  setCollisionRoutine(CHECK_INACTIVE_KONG_COLLISION);
}

/** $BCFB41 — (inside CODE_BCFB2C) X = Kong, Y = slot: box, then union into slot 5. */
export function CODE_BCFB41() {
  get_sprite_clipping();
  reg.a = slot(3);
  populate_main_sprite_clipping();
}

/** $BCFB58 — clipping of the current sprite (slot 6 -> 8); no special box (slot 7 empty). */
export function get_current_sprite_clipping() {
  const savedDp = dp;
  reg.x = r16(R.current_sprite);
  reg.y = slot(6);
  get_sprite_clipping();
  CODE_BCFBCC();
  dp = savedDp;
  w16(slot(7) + rel.right, 0);
}

/** $BCFB69 — A = special hitbox: use it as the current sprite's clipping (slot 6 -> 8). */
export function get_sprite_special_clipping_slot_0() {
  const savedDp = dp;
  reg.x = r16(R.current_sprite);
  reg.y = slot(6);
  get_special_hitbox_clipping();
  CODE_BCFBCC();
  dp = savedDp;
  w16(slot(7) + rel.right, 0);
}

/** $BCFB7A — A = special hitbox: add it as the current sprite's slot 7 (union into slot 8). */
export function get_sprite_special_clipping_slot_1() {
  const savedDp = dp;
  reg.x = r16(R.current_sprite);
  reg.y = slot(7);
  get_special_hitbox_clipping();
  reg.a = slot(6);
  populate_main_sprite_clipping();
  dp = savedDp;
}

/**
 * $BCFB8B — A = special hitbox: the box replaces the current sprite's slot 6, the previous
 * union (slot 8) moves to slot 7, and slot 8 becomes the union of both.
 */
export function CODE_BCFB8B() {
  const savedDp = dp;
  reg.x = r16(R.current_sprite);
  reg.y = slot(6);
  get_special_hitbox_clipping();
  dp = slot(6);
  const s0 = dp;
  const s1 = dp + CLIP_SIZE;
  const s2 = dp + 2 * CLIP_SIZE;
  // slot 1 = old slot 2; slot 2 grows to include slot 0 (min left/top, max right/bottom)
  let v = r16(s2 + rel.left);
  w16(s1 + rel.left, v);
  if (v >= r16(s0 + rel.left)) w16(s2 + rel.left, r16(s0 + rel.left));
  v = r16(slot(8) + rel.right);
  w16(slot(7) + rel.right, v);
  if (v < r16(s0 + rel.right)) w16(s2 + rel.right, r16(s0 + rel.right));
  v = r16(s2 + rel.top);
  w16(s1 + rel.top, v);
  if (v >= r16(s0 + rel.top)) w16(s2 + rel.top, r16(s0 + rel.top));
  v = r16(s2 + rel.bottom);
  w16(s1 + rel.bottom, v);
  reg.c = v >= r16(s0 + rel.bottom);
  if (!reg.c) w16(s2 + rel.bottom, r16(s0 + rel.bottom));
  dp = savedDp;
}

/** Copy a clipping rectangle (left, right, bottom, top — the original's order). */
function copyRect(from: number, to: number) {
  w16(to + rel.left, r16(from + rel.left));
  w16(to + rel.right, r16(from + rel.right));
  w16(to + rel.bottom, r16(from + rel.bottom));
  w16(to + rel.top, r16(from + rel.top));
  reg.a = r16(from + rel.top);
}

/** $BCFBCC — (DP = slot base) the union slot 2 is just slot 0. */
export function CODE_BCFBCC() {
  copyRect(dp, dp + 2 * CLIP_SIZE);
}

/** $BCFBDD — (DP = slot base) the special slot 1 gets the box just computed in slot 0. */
export function populate_special_sprite_clipping() {
  copyRect(dp, dp + CLIP_SIZE);
}

/** $BCFBEE — A = slot base: slot 2 = union of slots 0 and 1 (either may be empty). */
export function populate_main_sprite_clipping() {
  dp = reg.a & 0xffff;
  const s0 = dp;
  const s1 = dp + CLIP_SIZE;
  const s2 = dp + 2 * CLIP_SIZE;
  if (!r16(s1 + rel.right)) return copyRect(s0, s2);
  if (!r16(s0 + rel.right)) return copyRect(s1, s2);
  const right0 = r16(s0 + rel.right);
  const right1 = r16(s1 + rel.right);
  w16(s2 + rel.right, right0 >= right1 ? right0 : right1);
  const left0 = r16(s0 + rel.left);
  const left1 = r16(s1 + rel.left);
  w16(s2 + rel.left, left0 < left1 ? left0 : left1);
  const top0 = r16(s0 + rel.top);
  const top1 = r16(s1 + rel.top);
  w16(s2 + rel.top, top0 < top1 ? top0 : top1);
  const bottom0 = r16(s0 + rel.bottom);
  const bottom1 = r16(s1 + rel.bottom);
  reg.c = bottom0 >= bottom1;
  const bottom = reg.c ? bottom0 : bottom1;
  w16(s2 + rel.bottom, bottom);
  reg.a = bottom;
}

/** $BCFC40 — A = special hitbox index, X = sprite, Y = slot: place that box. */
export function get_special_hitbox_clipping() {
  reg.a = ((reg.a << 3) + SPECIAL_HITBOXES) & 0xffff;
  get_box_clipping();
}

/** $BCFC48 — (graphic 0) the slot is empty; DP = slot. */
export function no_sprite_clipping() {
  dp = reg.y & 0xffff;
  w16(dp + rel.right, reg.a);
}

/** $BCFC4D — X = sprite, Y = slot: place the hitbox of the sprite's current graphic. */
export function get_sprite_clipping() {
  const graphic = r16(reg.x + sprite.current_graphic);
  reg.a = graphic;
  if (!graphic) return no_sprite_clipping();
  reg.a = rom16(SPRITE_HITBOX_TABLE + (graphic >> 1));
  get_box_clipping();
}

/**
 * $BCFC59 — A = hitbox address (bank $BC), X = sprite, Y = slot: world-space rectangle of the
 * box, mirrored when the sprite is flipped. Leaves DP = slot, Y = hitbox address.
 */
export function get_box_clipping() {
  const box = reg.a & 0xffff;
  const x = reg.x;
  dp = reg.y & 0xffff;
  reg.y = box;
  const oam = r16(x + sprite.oam_property);
  const px = r16(x + sprite.x_position);
  if (oam & 0x4000) {
    const right = (px - hitbox16(box)) & 0xffff;
    w16(dp + rel.right, right);
    w16(dp + rel.left, (right - hitbox16(box + 4)) & 0xffff);
  } else {
    const left = (px + hitbox16(box)) & 0xffff;
    w16(dp + rel.left, left);
    w16(dp + rel.right, (left + hitbox16(box + 4)) & 0xffff);
  }
  const py = r16(x + sprite.y_position);
  if (oam & 0x8000) {
    const bottom = (py - hitbox16(box + 2)) & 0xffff;
    w16(dp + rel.bottom, bottom);
    const h = hitbox16(box + 6);
    reg.a = (bottom - h) & 0xffff;
    reg.c = bottom >= h; // carry of the final SBC
    w16(dp + rel.top, reg.a);
  } else {
    const top = (py + hitbox16(box + 2)) & 0xffff;
    w16(dp + rel.top, top);
    const sum = top + hitbox16(box + 6);
    reg.a = sum & 0xffff;
    reg.c = sum > 0xffff; // carry of the final ADC
    w16(dp + rel.bottom, reg.a);
  }
}

// ---------------------------------------------------------------------------------------------
// Kong <-> current sprite collisions
// ---------------------------------------------------------------------------------------------

/** Rectangles a and b overlap (edges touching count), in the original's comparison order. */
function overlap(aRight: number, bLeft: number, bRight: number, aLeft: number, bBottom: number, aTop: number, aBottom: number, bTop: number): boolean {
  return aRight >= bLeft && bRight >= aLeft && bBottom >= aTop && aBottom >= bTop;
}

/** Set bits in sprite_collision_result (TSB). */
function flagCollision(bits: number) {
  w16(R.sprite_collision_result, r16(R.sprite_collision_result) | bits);
}

/**
 * $BCFCA5 — A = collision mask: does the current sprite touch the inactive Kong (then the
 * active Kong, then the ridden animal)? Carry set on contact, colliding_sprite = who.
 */
export function check_inactive_kong_collision() {
  w16(R.collision_mask_result, reg.a);
  const kong = r16(R.inactive_kong_sprite);
  reg.x = kong;
  w16(R.colliding_sprite, kong);
  reg.y = 3 * CLIP_SIZE;
  check_for_collision();
  if (!reg.c) check_animal_collision();
}

/** $BCFCB5 — A = collision mask: does the current sprite touch the active Kong (or its mount)? */
export function check_active_kong_collision() {
  w16(R.collision_mask_result, reg.a);
  const kong = r16(R.active_kong_sprite);
  reg.x = kong;
  w16(R.colliding_sprite, kong);
  reg.y = 0;
  check_for_collision();
  if (!reg.c) check_animal_collision();
}

/** $BCFCC5 — try the active Kong (if not done yet), then the dummy Kong on the animal. */
export function check_animal_collision() {
  reg.a = r16(R.collision_mask_result);
  if (!reg.a) {
    reg.c = false;
    return;
  }
  const kong = r16(R.active_kong_sprite);
  reg.x = kong;
  if (kong === r16(R.colliding_sprite)) return check_for_kong_mount_collision();
  w16(R.colliding_sprite, kong);
  reg.y = 0;
  check_for_collision();
  if (!reg.c) check_for_kong_mount_collision();
}

/**
 * $BCFCDD — X = active Kong: slot 9 (Kong riding the animal) against the current sprite's
 * slots 8 (broad), 7 (bit $0200) and 6 (bit $0400; vertical test uses slot 0 — original bug).
 */
export function check_for_kong_mount_collision() {
  w16(R.sprite_collision_result, 0);
  const x = reg.x;
  const c6 = slot(6);
  const c7 = slot(7);
  const c8 = slot(8);
  const c9 = slot(9);
  const done = () => {
    w16(R.collision_mask_result, 0);
    reg.a = r16(R.sprite_collision_result);
    reg.c = reg.a >= 0x0001;
  };
  if (!(r16(R.collision_mask_result) & r16(x + sprite.interaction_flags))) return done();
  if (!r16(c9 + rel.right)) return done();
  if (!overlap(r16(c9 + rel.right), r16(c8 + rel.left), r16(c8 + rel.right), r16(c9 + rel.left), r16(c8 + rel.bottom), r16(c9 + rel.top), r16(c9 + rel.bottom), r16(c8 + rel.top))) return done();
  if (!r16(c7 + rel.right)) {
    flagCollision(0x0400);
    return done();
  }
  if (overlap(r16(c7 + rel.right), r16(c9 + rel.left), r16(c9 + rel.right), r16(c7 + rel.left), r16(c7 + rel.bottom), r16(c9 + rel.top), r16(c9 + rel.bottom), r16(c7 + rel.top))) flagCollision(0x0200);
  // .check_slots_9_6
  const c0 = slot(0);
  if (!overlap(r16(c9 + rel.right), r16(c6 + rel.left), r16(c6 + rel.right), r16(c9 + rel.left), r16(c6 + rel.bottom), r16(c0 + rel.top), r16(c0 + rel.bottom), r16(c6 + rel.top))) return done();
  flagCollision(0x0400);
  done();
}

/** $BCFD5F */
export function no_contact_return() {
  reg.c = false;
}

/**
 * $BCFD61 — X = Kong, Y = offset of its slots (0 or 24): Kong slot 2 vs sprite slot 8 is the
 * broad phase; then Kong 1 vs sprite 6 (bit 0), sprite 7 vs Kong 0 (bit 1), Kong 0 vs sprite 6
 * (bit 2). Carry set when any pair touched.
 */
export function check_for_collision() {
  w16(R.sprite_collision_result, 0);
  const x = reg.x;
  const y = reg.y & 0xffff;
  const k0 = slot(0) + y;
  const k1 = slot(1) + y;
  const k2 = slot(2) + y;
  const c6 = slot(6);
  const c7 = slot(7);
  const c8 = slot(8);
  if (!(r16(R.collision_mask_result) & r16(x + sprite.interaction_flags))) return no_contact_return();
  if (!overlap(r16(k2 + rel.right), r16(c8 + rel.left), r16(c8 + rel.right), r16(k2 + rel.left), r16(c8 + rel.bottom), r16(k2 + rel.top), r16(k2 + rel.bottom), r16(c8 + rel.top))) return no_contact_return();
  if (r16(k1 + rel.right) && overlap(r16(k1 + rel.right), r16(c6 + rel.left), r16(c6 + rel.right), r16(k1 + rel.left), r16(c6 + rel.bottom), r16(k1 + rel.top), r16(k1 + rel.bottom), r16(c6 + rel.top))) flagCollision(0x0001);
  if (r16(c7 + rel.right) && overlap(r16(c7 + rel.right), r16(k0 + rel.left), r16(k0 + rel.right), r16(c7 + rel.left), r16(k0 + rel.bottom), r16(c7 + rel.top), r16(c7 + rel.bottom), r16(k0 + rel.top))) flagCollision(0x0002);
  if (overlap(r16(k0 + rel.right), r16(c6 + rel.left), r16(c6 + rel.right), r16(k0 + rel.left), r16(c6 + rel.bottom), r16(k0 + rel.top), r16(k0 + rel.bottom), r16(c6 + rel.top))) flagCollision(0x0004);
  reg.a = r16(R.sprite_collision_result);
  reg.c = reg.a >= 0x0001;
}

// ---------------------------------------------------------------------------------------------
// Current sprite <-> other sprites
// ---------------------------------------------------------------------------------------------

/** $BCFE07 — no sprite collided. */
export function no_collision_detected() {
  reg.c = false;
}

/**
 * $BCFE0A — A = collision mask: find a sprite (not a Kong, not itself) whose hitbox touches the
 * current sprite's slot 8, scanning from the last slot. Carry set on contact; colliding_sprite
 * and X = that sprite, temp_sprite_clipping[1] = its rectangle.
 */
export function check_for_sprite_collisions() {
  w16(R.collision_mask_result, reg.a);
  w16(R.colliding_sprite, sprite_table.end);
  copyBroadClipping();
  const mask = r16(R.collision_mask_result);
  const current = r16(R.current_sprite);
  const t0Left = r16(TEMP0 + rel.left);
  const t0Right = r16(TEMP0 + rel.right);
  const t0Top = r16(TEMP0 + rel.top);
  const t0Bottom = r16(TEMP0 + rel.bottom);
  for (;;) {
    const other = (r16(R.colliding_sprite) - SPRITE_SIZE) & 0xffff;
    w16(R.colliding_sprite, other);
    reg.a = other;
    if (other === sprite_table.slot_2) return no_collision_detected();
    if (other === current) continue;
    reg.x = other;
    if (!r16(other + sprite.type)) continue;
    if (!(r16(other + sprite.interaction_flags) & mask)) continue;
    const box = hitbox16(SPRITE_HITBOX_TABLE_LO + (r16(other + sprite.current_graphic) >> 1));
    reg.y = box;
    const oam = r16(other + sprite.oam_property);

    // vertical extent
    const py = r16(other + sprite.y_position);
    if (oam & 0x8000) {
      const bottom = (py - hitbox16(box + 2)) & 0xffff;
      if (bottom < t0Top) continue;
      w16(TEMP1 + rel.bottom, bottom);
      const top = (bottom - hitbox16(box + 6)) & 0xffff;
      if (top >= t0Bottom && top !== t0Bottom) continue;
      w16(TEMP1 + rel.top, top);
    } else {
      const top = (py + hitbox16(box + 2)) & 0xffff;
      if (top > t0Bottom) continue;
      w16(TEMP1 + rel.top, top);
      const bottom = (top + hitbox16(box + 6)) & 0xffff;
      if (bottom < t0Top) continue;
      w16(TEMP1 + rel.bottom, bottom);
    }

    // horizontal extent
    const px = r16(other + sprite.x_position);
    if (oam & 0x4000) {
      const right = (px - hitbox16(box)) & 0xffff;
      if (right < t0Left) continue;
      w16(TEMP1 + rel.right, right);
      const left = (right - hitbox16(box + 4)) & 0xffff;
      if (left >= t0Right && left !== t0Right) continue;
      w16(TEMP1 + rel.left, left);
    } else {
      const left = (px + hitbox16(box)) & 0xffff;
      if (left > t0Right) continue;
      w16(TEMP1 + rel.left, left);
      const right = (left + hitbox16(box + 4)) & 0xffff;
      if (right < t0Left) continue;
      w16(TEMP1 + rel.right, right);
    }
    reg.c = true;
    return;
  }
}

/** The hitbox table read `LDA sprite_hitbox_table,y` with DB = $BC (16-bit address). */
const SPRITE_HITBOX_TABLE_LO = SPRITE_HITBOX_TABLE & 0xffff;

/** temp_sprite_clipping[0] = current sprite's broad clipping (slot 8). */
function copyBroadClipping() {
  const c8 = slot(8);
  w16(TEMP0 + rel.left, r16(c8 + rel.left));
  w16(TEMP0 + rel.right, r16(c8 + rel.right));
  w16(TEMP0 + rel.bottom, r16(c8 + rel.bottom));
  w16(TEMP0 + rel.top, r16(c8 + rel.top));
}

/**
 * Copy clipping slot Y into rectangle X (direct page), after check_for_sprite_collisions.
 * Carry clear when copied, set when the source slot is empty.
 */
function copyClippingSlot(to: number, from: number) {
  const right = dbRead16(from + rel.right);
  reg.a = right;
  if (!right) {
    reg.c = true;
    return;
  }
  w16(to + rel.right, right);
  w16(to + rel.left, dbRead16(from + rel.left));
  w16(to + rel.bottom, dbRead16(from + rel.bottom));
  reg.a = dbRead16(from + rel.top);
  w16(to + rel.top, reg.a);
  reg.c = false;
}

/** Kong slot n of the colliding Kong (inactive Kong: n + 3, ridden animal: 9) -> rectangle X. */
function copyKongClippingSlot(to: number, n: number) {
  const colliding = r16(R.colliding_sprite);
  reg.x = to;
  if (colliding === r16(R.active_kong_sprite)) return copyClippingSlot(to, slot(n));
  if (colliding === r16(R.inactive_kong_sprite)) return copyClippingSlot(to, slot(n + 3));
  if (colliding !== r16(R.current_player_mount)) {
    reg.c = true;
    return;
  }
  copyClippingSlot(to, slot(9));
}

/** $BCFEC0 — temp_sprite_clipping[1] = colliding Kong's union slot (2). */
export function CODE_BCFEC0() {
  copyKongClippingSlot(TEMP1, 2);
}

/** $BCFEC8 — temp_sprite_clipping[1] = colliding Kong's body slot (0). */
export function CODE_BCFEC8() {
  copyKongClippingSlot(TEMP1, 0);
}

/** $BCFED8 — temp_sprite_clipping[0] = current sprite's union slot (8). */
export function CODE_BCFED8() {
  reg.x = TEMP0;
  copyClippingSlot(TEMP0, slot(8));
}

/** $BCFEE0 — temp_sprite_clipping[0] = current sprite's body slot (6). */
export function CODE_BCFEE0() {
  reg.x = TEMP0;
  copyClippingSlot(TEMP0, slot(6));
}

/**
 * $BCFF1D — A = collision mask (platforms): find a sprite whose origin point lies inside the
 * current sprite's slot 8. Carry set on contact, colliding_sprite = that sprite.
 */
export function check_for_sprite_point_collisions() {
  w16(R.collision_mask_result, reg.a);
  w16(R.colliding_sprite, sprite_table.end);
  copyBroadClipping();
  check_for_point_collisions();
}

/**
 * $BCFF38 — continue the point scan below colliding_sprite with rectangle temp_sprite_clipping[0]
 * (also scans the auxiliary slot 0 — an original quirk).
 */
export function check_for_point_collisions() {
  const mask = r16(R.collision_mask_result);
  const current = r16(R.current_sprite);
  for (;;) {
    let other = r16(R.colliding_sprite);
    if (other < sprite_table.slot_0 + 1) {
      reg.a = other;
      reg.c = false;
      return;
    }
    other = (other - SPRITE_SIZE) & 0xffff;
    w16(R.colliding_sprite, other);
    if (other === current) continue;
    reg.x = other;
    if (!r16(other + sprite.type)) continue;
    if (!(r16(other + sprite.interaction_flags) & mask)) continue;
    const py = r16(other + sprite.y_position);
    if (py < r16(TEMP0 + rel.top)) continue;
    if (py >= r16(TEMP0 + rel.bottom)) continue;
    const px = r16(other + sprite.x_position);
    if (px < r16(TEMP0 + rel.left)) continue;
    reg.a = (px - 1) & 0xffff;
    if (reg.a >= r16(TEMP0 + rel.right)) continue;
    reg.c = true;
    return;
  }
}

register({
  init_player_clipping,
  init_special_player_clipping,
  init_special_player_clipping_slot_0,
  get_active_kong_clipping,
  CODE_BCFB2C,
  CODE_BCFB41,
  get_current_sprite_clipping,
  get_sprite_special_clipping_slot_0,
  get_sprite_special_clipping_slot_1,
  CODE_BCFB8B,
  CODE_BCFBCC,
  populate_special_sprite_clipping,
  populate_main_sprite_clipping,
  get_special_hitbox_clipping,
  no_sprite_clipping,
  get_sprite_clipping,
  get_box_clipping,
  check_inactive_kong_collision,
  check_active_kong_collision,
  check_animal_collision,
  check_for_kong_mount_collision,
  no_contact_return,
  check_for_collision,
  no_collision_detected,
  check_for_sprite_collisions,
  CODE_BCFEC0,
  CODE_BCFEC8,
  CODE_BCFED8,
  CODE_BCFEE0,
  check_for_sprite_point_collisions,
  check_for_point_collisions,
});
