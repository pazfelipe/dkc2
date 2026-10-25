/**
 * Bank $BE — sprite/Kong collision outcomes ($BEBD8E-$BEC5BB, plus $BED92E).
 *
 * Enemies call CODE_BEBE8B (or CODE_BEBE8E with an offset in Y) with A = their collision flags
 * (`sprite_collision_flags`, which attacks hurt them, whether they bounce Kongs, ...). After
 * the hitbox test (`sprite_collision_routine_address`) the outcome is chosen by a table indexed
 * by the colliding Kong's attack kind (animation flag bits 13-15) plus the offset:
 *   failed attack / stomp / roll / cartwheel / team throw / animal side / animal top / ...
 * Each handler ends in one of the outcomes, returning with carry set and A =
 *   0: the enemy is defeated (CODE_BEC508), 1: the Kong is hurt (CODE_BEC452),
 *   2: the Kong bounces off (CODE_BEC52D), 3: special (tire bounce / bonk, CODE_BEC420/442),
 * or with carry clear when nothing happened (CODE_BEBEA3 tries the animal buddy hitbox first).
 * X = the enemy and Y = the Kong on exit, as the callers expect.
 *
 * Direct-page $D9-$E7 holds the two rectangles of the hit (temp_sprite_clipping[0] = enemy,
 * [1] = Kong); $5E = the enemy's flags, $60 = table offset.
 */
import { r16, w16, rom16, bus16 } from "../../core/mem";
import { reg, register, callAddr } from "../../core/cpu";
import { setRetMode, RET_RTS } from "../../core/hybrid";
import { adc16, sbc16, flags } from "../../core/ops";
import { L, R, C, level, sprite as S, sprite_table } from "../../core/sym";
import {
  check_for_sprite_collisions,
  get_current_sprite_clipping,
  CODE_BCFEE0,
  CODE_BCFEC0,
  CODE_BCFED8,
  CODE_B3A334,
  CODE_BBBD6B,
  spawn_special_sprite_index,
  check_animal_collision,
  set_player_interaction_global,
  queue_sound_effect,
} from "../../gen/routines";
import { cur } from "./be1_util";

const KONG_STATE_FLAGS_TABLE = L("kong_state_flags_table");
const OUTCOME_TABLE = L("DATA_BEBF23");

// temp_sprite_clipping[0] (the sprite) and [1] (the Kong) in the direct page
const T0_LEFT = 0xd9;
const T0_TOP = 0xdb;
const T0_RIGHT = 0xdd;
const T0_BOTTOM = 0xdf;
const T1_LEFT = 0xe1;
const T1_TOP = 0xe3;
const T1_RIGHT = 0xe5;
const T1_BOTTOM = 0xe7;
const CLIP6 = R.sprite_clipping + 6 * 8; // current sprite body rectangle

const ANIM_FLAGS = S.animation_flags;
const result = () => r16(R.sprite_collision_result);
const flags5E = () => r16(0x5e);

/** Exit with carry set, A = outcome, X = sprite, Y = Kong (LDA #n after the loads). */
function outcome(a: number): void {
  reg.x = cur();
  reg.y = r16(R.colliding_sprite);
  reg.a = a;
  reg.c = true;
  reg.z = a === 0;
  reg.n = false;
}

/** Direction info for the Kong: bit 14 = sprite facing, bit 15 = moving left, + sprite index. */
function contactInfo(x: number): number {
  const prop = r16(x + S.oam_property);
  const xs = r16(x + S.x_speed);
  const v = (((prop ^ xs) & 0x4000) ^ xs) & 0xc000;
  return (v + r16(R.current_sprite) - sprite_table.slot_0) & 0xffff;
}

// ---------------------------------------------------------------------------------------------
// Sprite against sprite
// ---------------------------------------------------------------------------------------------

/** $BEBD8E — JSL entry of CODE_BEBD92. */
export function CODE_BEBD8E(): void {
  CODE_BEBD92();
}

/**
 * $BEBD92 — A = collision mask, Y = flags to give: does the current sprite touch another
 * sprite? If so, that sprite gets the flags (ORed into its $32) and contact info ($34).
 */
export function CODE_BEBD92(): void {
  w16(0x5e, reg.y);
  check_for_sprite_collisions();
  reg.x = cur();
  if (!reg.c) return;
  CODE_BEC5A4();
  const y = r16(R.colliding_sprite);
  reg.y = y;
  w16(y + S.carry_or_defeat_flags, r16(0x5e) | r16(y + S.carry_or_defeat_flags));
  const info = contactInfo(reg.x);
  w16(y + S.unknown_34, info);
  reg.a = info;
  reg.c = true;
}

/**
 * $BEBDC1 — Y = other sprite: clip both sprites and intersect them; carry set when they touch,
 * with the overlap in temp_sprite_clipping[1].
 */
export function CODE_BEBDC1(): void {
  const self = cur();
  const other = reg.y;
  w16(R.current_sprite, other);
  w16(R.colliding_sprite, other);
  get_current_sprite_clipping();
  CODE_BCFEE0();
  w16(R.current_sprite, self);
  get_current_sprite_clipping();
  reg.c = intersect();
  reg.x = cur();
  reg.y = r16(R.colliding_sprite);
}

function intersect(): boolean {
  if (r16(T0_RIGHT) < r16(CLIP6 + 0)) return false;
  const right = r16(CLIP6 + 4);
  if (right < r16(T0_LEFT)) return false;
  w16(T1_RIGHT, right);
  const bottom = r16(CLIP6 + 6);
  if (bottom < r16(T0_TOP)) return false;
  w16(T1_BOTTOM, bottom);
  if (r16(T0_BOTTOM) < r16(CLIP6 + 2)) return false;
  w16(T1_LEFT, r16(CLIP6 + 0));
  w16(T1_TOP, r16(CLIP6 + 2));
  return true;
}

/** $BEBE06 — contact flash at the hit. */
export function CODE_BEBE06(): void {
  CODE_B3A334();
  reg.y = C.special_sprite_spawn_id_0034;
  spawn_special_sprite_index();
  reg.x = cur();
}

/** $BEBE14 — JSL entry of check_throwable_collision. */
export function check_throwable_collision_global(): void {
  check_throwable_collision();
}

/**
 * $BEBE18 — A = flags that defeat this sprite: was it hit by a thrown sprite (flags left in
 * $32 by CODE_BEBD92)? Carry set if hit; A = 0 when defeated (CODE_BBBD6B), 1 otherwise.
 */
export function check_throwable_collision(): void {
  w16(0x60, reg.a);
  const x = cur();
  reg.x = x;
  const hit = r16(x + S.carry_or_defeat_flags);
  w16(0x5e, hit);
  reg.a = hit;
  if (!hit) {
    reg.c = false;
    return;
  }
  w16(x + S.carry_or_defeat_flags, 0);
  w16(R.colliding_sprite, ((r16(x + S.unknown_34) & 0x3fff) + sprite_table.slot_0) & 0xffff);
  if (hit & r16(0x60)) {
    CODE_BBBD6B();
    reg.x = cur();
    reg.y = 0;
    reg.a = 0;
  } else {
    reg.y = 0;
    reg.a = 1;
  }
  reg.c = true;
}

/**
 * $BEBE4D — A = kong_state_flags to query: carry set and A = the ones the colliding Kong's
 * current state has. X is preserved.
 */
export function check_kong_state_flags(): void {
  const keepX = reg.x;
  const query = reg.a;
  const kong = r16(R.colliding_sprite);
  if (kong !== r16(R.active_kong_sprite) && kong !== r16(R.inactive_kong_sprite)) {
    // Original bug: this path pulls the query into X and returns through the pushed X.
    // It is never reached (the colliding sprite is always a Kong); keep the visible part.
    reg.c = false;
    reg.x = query;
    return;
  }
  const a = query & rom16(KONG_STATE_FLAGS_TABLE + ((r16(kong + S.state) << 2) & 0xffff));
  reg.a = a;
  reg.c = a !== 0;
  reg.x = keepX;
  reg.z = keepX === 0;
  reg.n = (keepX & 0x8000) !== 0;
}

/** JML [sprite_collision_routine_address] (returns with RTL to the pushed address). */
function runCollisionRoutine(): void {
  callAddr(r16(R.sprite_collision_routine_address) | (r16(R.sprite_collision_routine_addr_high) & 0xff00) << 8);
}

/**
 * $BEBE6D — simple player collision (pickups): carry set if a Kong touched the sprite, which
 * is then marked collected (CODE_BBBD6B).
 */
export function CODE_BEBE6D(): void {
  w16(0x5e, reg.a);
  reg.a = 0x0010;
  runCollisionRoutine();
  if (reg.c) {
    CODE_BBBD6B();
    reg.x = cur();
    reg.y = r16(R.colliding_sprite);
    reg.a = 0;
    // no SEC: the carry is whatever CODE_BBBD6B left (its ASL clears it for grouped sprites)
    reg.z = true;
    reg.n = false;
    return;
  }
  noContact();
}

/** .return_handler without contact: X = Y = current sprite, carry clear. */
function noContact(): void {
  reg.x = cur();
  reg.y = reg.x;
  reg.c = false;
  reg.z = reg.y === 0;
  reg.n = (reg.y & 0x8000) !== 0;
}

/** $BEBE8B — enemy vs Kong collision, A = sprite_collision_flags (see file header). */
export function CODE_BEBE8B(): void {
  reg.y = 0;
  CODE_BEBE8E();
}

/** $BEBE8E — like CODE_BEBE8B with Y = offset into the outcome table. */
export function CODE_BEBE8E(): void {
  w16(R.sprite_collision_flags, reg.a);
  w16(0x60, reg.y);
  reg.a = 0x0010;
  runCollisionRoutine();
  // CODE_BEBE9D
  if (reg.c) return CODE_BEBEAD();
  noContact();
}

/** $BEBEA3 — no outcome with the Kong: try the animal buddy's hitbox. */
export function CODE_BEBEA3(): void {
  check_animal_collision();
  if (reg.c) return CODE_BEBEAD();
  noContact();
}

/** $BEBEAD — a Kong (or animal) touched the sprite: pick the outcome. */
export function CODE_BEBEAD(): void {
  w16(0x5e, r16(R.sprite_collision_flags));
  reg.a = 0x0020;
  check_kong_state_flags();
  if (reg.c) return CODE_BEBEA3(); // this Kong state ignores enemies (CODE_BEBF20)
  CODE_BCFEC0();
  CODE_BCFED8();
  let a = result();
  if (r16(R.ridden_skull_cart_sprite)) {
    a = ((a & 0x0001) << 2) | result();
    w16(R.sprite_collision_result, a);
  }
  // copy the low byte of the result flags into the high byte
  w16(R.sprite_collision_result, result() | (((a >> 8) | (a << 8)) & 0xffff));
  const kong = r16(R.colliding_sprite);
  const kind = ((r16(kong + 0x41) & 0x00e0) >> 4) + r16(0x60);
  reg.a = kind & 0xffff;
  if (r16(R.invincibility_sprite)) return CODE_BEBEF0();
  reg.x = reg.a;
  CODE_BEBEED();
}

/** $BEBEED — X = outcome table index: run the outcome handler. */
export function CODE_BEBEED(): void {
  const ptr = rom16(OUTCOME_TABLE + reg.x);
  const fn = OUTCOMES.get(ptr);
  if (fn) return fn();
  callAddr(0xbe0000 | ptr);
}

/** $BEBEF0 — invincible (Rambi/star barrel): most contacts defeat the enemy. */
export function CODE_BEBEF0(): void {
  let a = reg.a;
  if (a < 0x0030) {
    a &= 0x000e;
    if (a >= 0x0006) return CODE_BEC410();
  }
  CODE_BEBF00(a);
}

/** $BEBF00 — run the handler as if the Kong's animation allowed both attack kinds. */
function CODE_BEBF00(index: number): void {
  reg.x = index;
  const kong = r16(R.colliding_sprite);
  reg.y = kong;
  w16(R.sprite_collision_result, result() | 0x0005);
  const saved = r16(kong + ANIM_FLAGS);
  w16(kong + ANIM_FLAGS, saved | 0x1800);
  CODE_BEBEED();
  const a = reg.a;
  w16(0x5e, a);
  // restored through the Y the handler returned (the sprite itself when nothing happened)
  w16(reg.y + ANIM_FLAGS, saved);
  reg.a = a;
  reg.z = (a & 0xffff) === 0;
  reg.n = (a & 0x8000) !== 0;
}

// ---------------------------------------------------------------------------------------------
// Outcome handlers (DATA_BEBF23)
// ---------------------------------------------------------------------------------------------

/** $BEBF63 — bouncy enemies (tires, Krochead...): the Kong bounces or is pushed away. */
export function CODE_BEBF63(): void {
  const x = r16(R.colliding_sprite);
  const y = cur();
  if (!(r16(x + S.terrain_interaction) & 0x0101)) {
    const middle = ((r16(T0_BOTTOM) + r16(T0_TOP)) & 0xffff) >> 1;
    if (middle >= r16(T1_BOTTOM)) {
      // Kong above the middle
      if ((r16(x + S.y_speed) - 0x0180) & 0x8000) return pushKongAside(x, y);
      return CODE_BEC420();
    }
  }
  // CODE_BEBF83
  if (r16(y + S.terrain_interaction) & 0x0101) {
    // CODE_BEBFC4: sprite in the air
    if (!(r16(x + S.terrain_interaction) & 0x0002)) return pushKongAside(x, y);
    const c = r16(x + S.x_position) >= r16(y + S.x_position);
    const v = ((c ? 0x8000 : 0) ^ r16(y + S.max_x_speed)) & 0x8000;
    if (!v) return pushKongAside(x, y);
    return CODE_BEC452();
  }
  let dx = (r16(y + S.x_position) - r16(x + S.x_position)) & 0xffff;
  if (r16(y + S.x_position) < r16(x + S.x_position)) dx = (-dx) & 0xffff;
  if (dx >= 0x0018) return pushKongAside(x, y);
  const diff = (r16(T0_BOTTOM) - r16(T1_TOP)) & 0xffff;
  w16(x + S.y_speed, ((diff >> 8) | (diff << 8)) & 0xffff);
  const ground = r16(x + S.ground_distance);
  if (ground & 0x8000 || diff < ground) return CODE_BEBEA3();
  w16(R.contact_flash_x_position, r16(x + S.x_position));
  w16(R.contact_flash_y_position, r16(x + S.ground_y_position));
  reg.y = C.special_sprite_spawn_id_0034;
  spawn_special_sprite_index();
  w16(0x09e7, 0);
  CODE_BEC452();
}

/** CODE_BEBFD9 — push the Kong out horizontally (speed from the overlap, at most 4 px). */
function pushKongAside(x: number, y: number): void {
  if (r16(x + S.state) !== 0x0056) {
    const d =
      r16(x + S.x_position) >= r16(y + S.x_position)
        ? (r16(T0_RIGHT) - r16(T1_LEFT)) & 0xffff // CODE_BEBFEE
        : (r16(T0_LEFT) - r16(T1_RIGHT)) & 0xffff;
    let speed = (d << 8) & 0xff00;
    w16(x + S.unknown_2C, speed);
    if (!(speed & 0x8000)) {
      if (speed >= 0x0400) speed = 0x0400;
    } else if (speed < 0xfc00) speed = 0xfc00;
    w16(x + S.x_speed, speed);
    w16(x + S.max_x_speed, 0);
  }
  CODE_BEBEA3(); // CODE_BEC011
}

/** $BEC014 */
export function CODE_BEC014(): void {
  reg.x = r16(R.colliding_sprite);
  CODE_BEC141();
  if (reg.c) return CODE_BEC452();
  CODE_BEC01E();
}

/** $BEC01E — the Kong lands on top (bottom of the Kong above the sprite's bottom). */
export function CODE_BEC01E(): void {
  if (r16(T1_BOTTOM) >= r16(T0_BOTTOM)) return CODE_BEC452();
  CODE_BEC442();
}

/** Common tail: no attack flags matched — hurt the Kong only on plain body contact. */
function bodyContact(mask: number): void {
  if (!(result() & mask)) return CODE_BEBEA3();
  if (flags5E() === 0) return CODE_BEC452();
  CODE_BEBEA3();
}

/** $BEC02A — failed attack (walking into the sprite). */
export function CODE_BEC02A(): void {
  const x = r16(R.colliding_sprite);
  reg.x = x;
  const m = flags5E() & 0x0007;
  w16(0x5e, m);
  if (result() & 0x0005) {
    if (m === 4) return CODE_BEBEA3();
    if (r16(R.invincibility_sprite)) return CODE_BEC500();
    if (m === 3) return bonkOrTeamThrow(x);
    if (m === 1) return CODE_BEC500();
    if (m === 2) {
      if (!(r16(x + ANIM_FLAGS) & 0x1800)) return bonkOrTeamThrow(x);
      return CODE_BEC500();
    }
  }
  bodyContact(0x0006); // CODE_BEC05D
}

/** CODE_BEC075 — bonk (active Kong) or defeated by a team throw (inactive Kong). */
function bonkOrTeamThrow(x: number): void {
  reg.a = x === r16(R.active_kong_sprite) ? C.player_interaction_1E : C.player_interaction_1D;
  CODE_BEC52D();
}

/** $BEC085 — roll into the sprite. */
export function CODE_BEC085(): void {
  const x = r16(R.colliding_sprite);
  reg.x = x;
  CODE_BEC141();
  if (!reg.c) return CODE_BEC104(x);
  if (r16(R.invincibility_sprite)) return defeatBounce1C();
  const m = flags5E() & 0x00e0;
  w16(0x5e, m);
  if (result() & 0x0005) {
    switch (m) {
      case 0x00c0:
        return CODE_BEBEA3();
      case 0x0080:
        return facingCheck(x, 0x4000);
      case 0x00a0:
        return facingCheck(x, 0x0000);
      case 0x0020:
        return defeatBounce1C();
      case 0x0060:
        return bonk1E();
      case 0x0040:
        if (!(r16(x + ANIM_FLAGS) & 0x0800)) return bonk1E();
        return defeatBounce1C();
    }
  }
  // CODE_BEC0C7
  if (!(result() & 0x0006)) return CODE_BEBEA3();
  if (flags5E() === 0) return CODE_BEC452();
  CODE_BEBEA3();
}

/** CODE_BEC0D8/CODE_BEC0DD — rolled into from the front (or back): defeat, else hurt. */
function facingCheck(x: number, a: number): void {
  if ((a ^ r16(x + S.oam_property) ^ r16(cur() + S.oam_property)) & 0x4000) return CODE_BEC452();
  defeatBounce1C();
}

/** CODE_BEC0EC / CODE_BEC0F2 */
function defeatBounce1C(): void {
  reg.a = C.player_interaction_1C;
  CODE_BEC4F2();
}

/** CODE_BEC0F8 */
function bonk1E(): void {
  reg.a = C.player_interaction_1E;
  CODE_BEC52D();
}

/** CODE_BEC104 — rolling Kong below the sprite's middle. */
function CODE_BEC104(x: number): void {
  if (r16(R.invincibility_sprite)) return defeatBounce1C();
  const m = flags5E() & 0x0018;
  w16(0x5e, m);
  if (result() & 0x0005) {
    if (m === 0x0008) return defeatBounce1C();
    if (m === 0x0018) return bonk1E();
    if (m === 0x0010) {
      if (!(r16(x + ANIM_FLAGS) & 0x1000)) return bonk1E();
      return defeatBounce1C();
    }
  }
  // CODE_BEC130
  if (!(result() & 0x0006)) return CODE_BEBEA3();
  if (flags5E() === 0) return CODE_BEC452();
  CODE_BEBEA3();
}

/**
 * $BEC141 — X = Kong: carry set when the Kong counts as coming from the side (in the air, moving
 * up, or below the sprite's middle with enough horizontal overlap).
 */
export function CODE_BEC141(): void {
  const x = reg.x;
  if (r16(x + S.terrain_interaction) & 0x0101 || r16(x + S.y_speed) & 0x8000) {
    reg.c = true;
    return;
  }
  const middle = ((r16(T0_BOTTOM) + r16(T0_TOP)) & 0xffff) >> 1;
  if (middle >= r16(T1_BOTTOM)) {
    reg.c = false;
    return;
  }
  let a = sbc16(r16(T0_LEFT), r16(T1_RIGHT), true);
  if (flags.c) a = sbc16(r16(T1_LEFT), r16(T0_RIGHT), true);
  reg.a = a;
  reg.c = a >= 0xfff4;
}

/** $BEC169 — stomp: jumping on the sprite. */
export function CODE_BEC169(): void {
  const x = r16(R.colliding_sprite);
  reg.x = x;
  const below = (r16(T1_BOTTOM) - r16(T0_TOP) - 0x0020) & 0xffff;
  if (!(below & 0x8000) || (r16(x + S.y_speed) + 0x0140) & 0x8000) return CODE_BEC02A(); // from below / moving up
  // .attacked_from_above
  if (r16(R.invincibility_sprite)) return stompDefeat();
  const m = flags5E() & 0x0018;
  w16(0x5e, m);
  if (result() & 0x0005) {
    if (m === 0x0008) return stompDefeat();
    if (m === 0x0018) return bonk1E();
    if (m === 0x0010) {
      if (!(r16(x + ANIM_FLAGS) & 0x1000)) return bonk1E();
      return stompDefeat();
    }
  }
  // .CODE_BEC1AD
  if (!(result() & 0x0006)) return CODE_BEBEA3();
  if (flags5E() === 0) return CODE_BEC452();
  CODE_BEBEA3();
}

/** .CODE_BEC1C2 — stomped: bounce (or the skull cart flies up). */
function stompDefeat(): void {
  if (r16(R.ridden_skull_cart_sprite)) return CODE_BEC58D();
  reg.a = C.player_interaction_1B;
  CODE_BEC4F2();
}

/** $BEC1D6 — cartwheel/hand slap kind of attack (bits $0300 of the sprite's flags). */
export function CODE_BEC1D6(): void {
  const x = r16(R.colliding_sprite);
  reg.x = x;
  const m = flags5E() & 0x0300;
  w16(0x5e, m);
  if (result() & 0x0005) {
    if (m === 0x0100) return CODE_BEC500();
    if (m === 0x0300) return bonk1E();
    if (m === 0x0200) {
      if (!(r16(x + ANIM_FLAGS) & 0x1800)) return bonk1E();
      return CODE_BEC500();
    }
  }
  bodyContact(0x0006);
}

/** $BEC21D — team throw (Kong thrown at the sprite), variant. */
export function CODE_BEC21D(): void {
  const x = r16(R.colliding_sprite);
  reg.x = x;
  const m = flags5E() & 0x0c00;
  w16(0x5e, m);
  if (result() & 0x0005) {
    if (m === 0x0400) return teamThrowDefeat();
    if (m === 0x0c00) return teamThrowBonk();
    if (m === 0x0800) {
      if (!(r16(x + ANIM_FLAGS) & 0x1800)) return CODE_BEC452();
      return teamThrowBonk();
    }
  }
  bodyContact(0x0006);
}

/** $BEC267 — team throw collide. */
export function CODE_BEC267(): void {
  const x = r16(R.colliding_sprite);
  reg.x = x;
  const m = flags5E() & 0x0c00;
  w16(0x5e, m);
  if (result() & 0x0005) {
    if (m === 0x0400) return teamThrowDefeat();
    if (m === 0x0c00) return teamThrowBonk();
    if (m === 0x0800) {
      if (!(r16(x + ANIM_FLAGS) & 0x1800)) return teamThrowBonk();
      return teamThrowDefeat();
    }
  }
  bodyContact(0x0006);
}

function teamThrowDefeat(): void {
  reg.a = C.player_interaction_1D;
  CODE_BEC4F2();
}
function teamThrowBonk(): void {
  reg.a = C.player_interaction_1D;
  CODE_BEC52D();
}

/** $BEC2B1 — X = Kong: Z clear when the Kong faces the sprite. */
export function CODE_BEC2B1(): void {
  const x = reg.x;
  const y = cur();
  reg.y = y;
  const c = r16(y + S.x_position) >= r16(x + S.x_position);
  const v = ((r16(y + S.x_position) >> 1) | (c ? 0x8000 : 0)) >> 1;
  reg.a = (v ^ r16(x + S.oam_property)) & 0x4000;
  reg.z = reg.a === 0;
}

const facesSprite = (x: number) => {
  reg.x = x;
  CODE_BEC2B1();
  return !reg.z;
};

/** $BEC2C0 — animal buddy hitting the sprite from the side (Rambi charge, Enguarde). */
export function CODE_BEC2C0(): void {
  reg.x = r16(R.colliding_sprite);
  if (r16(R.animal_type) !== C.sprite_enguarde) {
    CODE_BEC141();
    if (!reg.c) return CODE_BEC359();
  }
  // CODE_BEC2D1
  const x = r16(R.colliding_sprite);
  reg.x = x;
  const m = flags5E() & 0x3000;
  w16(0x5e, m);
  if (result() & 0x0001) {
    if (m === 0x1000) return animalDefeat();
    if (m === 0x3000) {
      if (r16(x + ANIM_FLAGS) & 0x0800) return animalDefeat();
      if (!(r16(x + S.interaction_flags) & 0x0080) && facesSprite(x)) return animalDefeat();
    }
  }
  // CODE_BEC2FF
  if (result() & 0x0004) {
    if (m === 0x3000) {
      // CODE_BEC31C
      if (!(r16(x + ANIM_FLAGS) & 0x0800)) {
        if (r16(x + S.interaction_flags) & 0x0080) return bonk1E();
        if (facesSprite(x)) return animalDefeat();
        return bonk1E();
      }
    } else if (m === 0x2000) {
      if (!(r16(x + ANIM_FLAGS) & 0x0800)) return CODE_BEC452();
      return bonk1E();
    }
  }
  // CODE_BEC331
  if (result() & 0x0006) return CODE_BEC452();
  CODE_BEBEA3();
}

/** CODE_BEC345 — defeated by the animal (Enguarde's stab has its own sound). */
function animalDefeat(): void {
  if (r16(R.animal_type) === C.sprite_enguarde) {
    reg.a = (2 << 8) | C.sound_neek_hit;
    queue_sound_effect();
  }
  CODE_BEC500();
}

/** $BEC359 — animal buddy landing on the sprite. */
export function CODE_BEC359(): void {
  const x = r16(R.colliding_sprite);
  reg.x = x;
  const res = result();
  if (res & 0x0001) {
    const m = flags5E() & 0xc000;
    if (m === 0x4000) return animalStomp();
    if (m !== 0x8000) return CODE_BEC3B2();
    if (r16(x + ANIM_FLAGS) & 0x1000) return animalStomp();
  }
  // CODE_BEC37C
  if (!(res & 0x0004)) return CODE_BEC3B2();
  const fall = (r16(x + S.y_speed) + 0x0140) & 0xffff;
  if (!(fall & 0x8000)) return CODE_BEC3CE(x, fall);
  const y = cur();
  reg.y = y;
  const d = (r16(y + S.x_position) - r16(x + S.x_position)) & 0xffff;
  w16(0x76, d);
  const xs = r16(x + S.x_speed);
  if (!((d ^ xs) & 0x8000)) return CODE_BEC02A(); // CODE_BEC3AF
  if (((r16(x + S.oam_property) << 1) ^ xs) & 0x8000) return CODE_BEBEA3();
  const reach = xs & 0x8000 ? 0xfff4 : 0x000c;
  if (!((((reach + d) & 0xffff) ^ d) & 0x8000)) return CODE_BEBEA3();
  CODE_BEC02A();
}

/** CODE_BEC3B2 */
function CODE_BEC3B2(): void {
  if (result() & 0x0006) return CODE_BEC452();
  CODE_BEBEA3();
}

/** CODE_BEC3BC */
function animalStomp(): void {
  reg.a = C.player_interaction_1B;
  CODE_BEC4F2();
}

/** CODE_BEC3CE — the animal is falling onto the sprite. */
function CODE_BEC3CE(x: number, fall: number): void {
  const a = ((fall >> 8) - r16(T1_BOTTOM) + r16(T0_TOP) + 0x0020) & 0xffff;
  if (a & 0x8000) {
    if (!(r16(x + ANIM_FLAGS) & 0x0800)) return CODE_BEC02A();
    if (!facesSprite(x)) return CODE_BEC02A();
  }
  // CODE_BEC3EA
  const m = flags5E() & 0xc000;
  if (m === 0x4000) return animalStomp();
  if (m === 0xc000) {
    // CODE_BEC407
    if (r16(x + ANIM_FLAGS) & 0x0800) return bonk1E();
    return CODE_BEC452();
  }
  if (m === 0x8000) {
    if (!(r16(x + ANIM_FLAGS) & 0x1000)) return bonk1E();
    return animalStomp();
  }
  CODE_BEC3B2();
}

/** $BEC410 — any attack defeats the sprite. */
export function CODE_BEC410(): void {
  reg.x = r16(R.colliding_sprite);
  if (result() & 0x0005) return CODE_BEC500();
  CODE_BEBEA3();
}

// ---------------------------------------------------------------------------------------------
// Outcomes
// ---------------------------------------------------------------------------------------------

/** $BEC420 — bounce the Kong like a tire (outcome 3). */
export function CODE_BEC420(): void {
  reg.a = C.player_interaction_0E;
  set_player_interaction_global();
  if (reg.c) return CODE_BEBEA3();
  reg.a = (5 << 8) | C.sound_kong_tire_bounce;
  queue_sound_effect();
  w16(R.interaction_RAM_0A86, 0);
  w16(R.interaction_RAM_0A88, cur());
  outcome(3);
}

/** $BEC442 — the Kong stands on the sprite (outcome 3). */
export function CODE_BEC442(): void {
  reg.a = C.player_interaction_13;
  set_player_interaction_global();
  outcome(3);
}

/** $BEC452 — the Kong is hurt (outcome 1). */
export function CODE_BEC452(): void {
  const kong = r16(R.colliding_sprite);
  reg.x = kong;
  if (r16(kong + S.interaction_flags) & 0x0080) return CODE_BEBEA3();
  const self = cur();
  reg.y = self;
  // an explosive Klobber only hurts when its barrel is touched
  if (r16(self + S.type) === C.sprite_klobber && r16(R.sprite_collision_flags) === 0x5004) return CODE_BEBEA3();
  if (kong !== r16(R.inactive_kong_sprite)) {
    reg.y = C.player_interaction_23;
    if (!(r16(R.game_state_flags) & 0x4000)) {
      CODE_BEC4BA();
      return hurtTail();
    }
  } else reg.y = C.player_interaction_20;
  // CODE_BEC485
  reg.a = reg.y;
  set_player_interaction_global();
  if (reg.c) return CODE_BEBEA3();
  hurtTail();
}

/** CODE_BEC48C */
function hurtTail(): void {
  CODE_BEC5A4();
  const x = cur();
  const y = r16(R.colliding_sprite);
  w16(y + S.unknown_34, contactInfo(x));
  w16(y + S.interaction_flags, r16(y + S.interaction_flags) & 0xfffd);
  outcome(1);
}

/** $BEC4BA — Y = interaction: hurt the Kong (in a bonus room, the bonus is failed instead). */
export function CODE_BEC4BA(): void {
  if (r16(level.type) === C.bonus_level_type) {
    reg.a = C.player_interaction_28;
    set_player_interaction_global();
    reg.a = 0x0003;
    w16(R.time_stop_flags, 0x0003);
    return;
  }
  reg.a = reg.y;
  set_player_interaction_global();
}

/**
 * $BEC4D6 — A = interaction: a Kong that is carrying something (interaction flag $0800) and hit
 * with its body box only damages the carried object (carry set).
 */
export function CODE_BEC4D6(): void {
  const a = reg.a;
  reg.y = a;
  const x = r16(R.colliding_sprite);
  reg.x = x;
  if (r16(x + S.interaction_flags) & 0x0800 && result() & 0x0001) {
    reg.a = 0x0002;
    w16(x + S.carry_or_defeat_flags, 0x0002);
    reg.c = true;
    return;
  }
  reg.a = a;
  reg.c = false;
}

/** $BEC4F2 — A = interaction: give it to the Kong and defeat the sprite. */
export function CODE_BEC4F2(): void {
  CODE_BEC4D6();
  if (reg.c) return CODE_BEBEA3();
  set_player_interaction_global();
  CODE_BEC508();
}

/** $BEC500 — defeat the sprite. */
export function CODE_BEC500(): void {
  CODE_BEC4D6();
  if (reg.c) return CODE_BEBEA3();
  CODE_BEC508();
}

/** $BEC508 — the sprite is defeated (outcome 0). */
export function CODE_BEC508(): void {
  CODE_BEC5A4();
  CODE_BBBD6B();
  const x = cur();
  // Anti-piracy: the reset vector at $80FFFC must hold $8404, or animal crates stop breaking.
  w16(0x32, 0x01a0);
  w16(0x33, 0x80d0); // pointer $80D0A0 at $32
  let a = adc16(0x80d0, bus16(0x80d0a0 + 0x2f5c), false);
  a = sbc16(a, 0x04c7, flags.c);
  if (a !== 0) w16(x + S.placement_parameter, 0);
  outcome(0);
}

/** $BEC52D — A = interaction: the Kong bounces off the sprite (outcome 2). */
export function CODE_BEC52D(): void {
  set_player_interaction_global();
  if (!reg.c) {
    const x = r16(R.colliding_sprite);
    const y = cur();
    const dx = (r16(x + S.x_position) - r16(y + S.x_position)) & 0xffff;
    w16(R.interaction_RAM_0A88, dx);
    const abs = (v: number) => (v & 0x8000 ? -v & 0xffff : v);
    const kongSpeed = abs(r16(x + S.x_speed));
    w16(R.interaction_RAM_0A86, kongSpeed);
    let push = (abs(r16(y + S.x_speed)) + kongSpeed) & 0xffff;
    if (push < 0x0180) push = 0x0180;
    push >>= 1;
    if (dx & 0x8000) push = -push & 0xffff;
    w16(R.interaction_RAM_0A86, push);
    // the sprite turns to face the way the Kong is pushed
    const prop = r16(y + S.oam_property);
    w16(y + S.oam_property, (((push >> 1) ^ prop) & 0x4000) ^ prop);
  }
  // CODE_BEC57A
  CODE_BEC5A4();
  reg.a = (5 << 8) | C.sound_knock;
  queue_sound_effect();
  outcome(2);
}

/** $BEC58D — stomped while riding the skull cart: the cart hops. */
export function CODE_BEC58D(): void {
  const x = r16(R.ridden_skull_cart_sprite);
  w16(x + S.y_speed, 0xfa00);
  let a = r16(x + ANIM_FLAGS);
  if (a < 0x000e) a = 0x000e;
  w16(x + ANIM_FLAGS, a);
  CODE_BEC508();
}

/** $BEC5A4 — contact flash between the two hitboxes (unless CODE_BCFED8 says no). */
export function CODE_BEC5A4(): void {
  CODE_BCFED8();
  if (!reg.c) {
    CODE_BCFEC0();
    CODE_B3A334();
    reg.y = C.special_sprite_spawn_id_0034;
    spawn_special_sprite_index();
  }
  reg.x = cur();
}

/** $BED92E — carry clear when there is one Kong and its state has kong_state_flags bit 0. */
export function get_kong_state_flags_if_one_kong(): void {
  if (r16(R.game_state_flags) & 0x4000) {
    reg.c = true;
    return;
  }
  const y = r16(R.active_kong_sprite);
  reg.y = y;
  reg.x = (r16(y + S.state) << 2) & 0xffff;
  reg.a = rom16(KONG_STATE_FLAGS_TABLE + reg.x) & 0x0001;
  reg.c = reg.a === 0;
}

const OUTCOMES = new Map<number, () => void>(
  (
    [
      ["CODE_BEC02A", CODE_BEC02A],
      ["CODE_BEC169", CODE_BEC169],
      ["CODE_BEC085", CODE_BEC085],
      ["CODE_BEC1D6", CODE_BEC1D6],
      ["CODE_BEC267", CODE_BEC267],
      ["CODE_BEC2C0", CODE_BEC2C0],
      ["CODE_BEC359", CODE_BEC359],
      ["CODE_BEC410", CODE_BEC410],
      ["CODE_BEC01E", CODE_BEC01E],
      ["CODE_BEC014", CODE_BEC014],
      ["CODE_BEC21D", CODE_BEC21D],
      ["CODE_BEBF63", CODE_BEBF63],
    ] as const
  ).map(([n, f]) => [L(n) & 0xffff, f]),
);

register({
  CODE_BEBD8E,
  CODE_BEBD92,
  CODE_BEBDC1,
  CODE_BEBE06,
  check_throwable_collision_global,
  check_throwable_collision,
  check_kong_state_flags,
  CODE_BEBE6D,
  CODE_BEBE8B,
  CODE_BEBE8E,
  CODE_BEBEA3,
  CODE_BEBEAD,
  CODE_BEBEED,
  CODE_BEBEF0,
  CODE_BEBF63,
  CODE_BEC014,
  CODE_BEC01E,
  CODE_BEC02A,
  CODE_BEC085,
  CODE_BEC141,
  CODE_BEC169,
  CODE_BEC1D6,
  CODE_BEC21D,
  CODE_BEC267,
  CODE_BEC2B1,
  CODE_BEC2C0,
  CODE_BEC359,
  CODE_BEC410,
  CODE_BEC420,
  CODE_BEC442,
  CODE_BEC452,
  CODE_BEC4BA,
  CODE_BEC4D6,
  CODE_BEC4F2,
  CODE_BEC500,
  CODE_BEC508,
  CODE_BEC52D,
  CODE_BEC58D,
  CODE_BEC5A4,
  get_kong_state_flags_if_one_kong,
});
for (const n of [
  "CODE_BEBD92", "CODE_BEBE06", "check_throwable_collision", "CODE_BEC141", "CODE_BEC2B1",
  "CODE_BEC4BA", "CODE_BEC4D6", "CODE_BEC5A4", "get_kong_state_flags_if_one_kong",
]) setRetMode(L(n), RET_RTS);
