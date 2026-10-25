/**
 * Bank $B6 (package final) — `bank_B6_sprite_main_handler_1` and the world 1-2 entries of its
 * table: Klubba and his club at Klubba's Kiosk. The other entries (Kudgel, K. Rool, the lava
 * splash / Krow sparkle) run through their table pointers (ported or original).
 */
import { r16, w16, rom16 } from "../../core/mem";
import { reg } from "../../core/cpu";
import { L, R, C } from "../../core/sym";
import {
  spawn_special_sprite_index,
  set_sprite_animation,
  set_alt_sprite_animation,
  process_sprite_animation,
} from "../../gen/routines";
import { cur, rd, wr, spriteTail, registerSprite, registerRtl } from "./b6ba_common";

const MAIN_TABLE = (L("bank_B6_sprite_main_handler_1") + 6) & 0xffff;

/** $B68025 — `TAX : PHK : PLB : JMP (.main_table,x)` with A = index into the bank's table. */
export function bank_B6_sprite_main_handler_1(): void {
  reg.x = reg.a & 0xffff;
  reg.db = 0xb6;
  spriteTail(0xb60000 | rom16(0xb60000 | ((MAIN_TABLE + reg.x) & 0xffff)));
}

/**
 * $B6D02E — Klubba: spawn his club once ($42 = its slot), then wait. Choosing "fight him" in
 * the kiosk menu sets $06A3 bit $0200: play the attack animation on both Klubba and the club.
 */
export function klubba_sprite_code(): void {
  const db = reg.db; // PHB : PHK : PLB ... PLB
  reg.db = 0xb6;
  let x = cur();
  reg.x = x;
  if (rd(x, 0x42) === 0) {
    reg.y = C.special_sprite_spawn_id_010C;
    spawn_special_sprite_index();
    reg.a = r16(R.alternate_sprite);
    x = cur();
    reg.x = x;
    wr(x, 0x42, reg.a);
  }
  const flags = r16(0x06a3);
  reg.a = flags;
  if (flags & 0x0200) {
    w16(0x06a3, flags & 0xfdff);
    reg.a = C.klubba_attack_anim_id;
    set_sprite_animation();
    // `LDA $42,x` with the X set_sprite_animation leaves
    reg.a = r16((reg.x + 0x42) & 0xffff);
    w16(R.alternate_sprite, reg.a);
    reg.a = C.klubba_club_attack_anim_id;
    set_alt_sprite_animation();
  }
  process_sprite_animation();
  reg.db = db;
}

/** $B6D06E — Klubba's club: just animate. */
export function klubbas_club_sprite_code(): void {
  const db = reg.db; // PHB : PHK : PLB ... PLB
  reg.db = 0xb6;
  process_sprite_animation();
  reg.db = db;
}

/** $B69493 — animation callback (seen in Swanky's screen): sprite field $1C = $C000. */
export function CODE_B69493(): void {
  reg.a = 0xc000;
  w16((reg.x + 0x1c) & 0xffff, reg.a);
}

/** $B69499 — animation callback: clear sprite field $1C. */
export function CODE_B69499(): void {
  w16((reg.x + 0x1c) & 0xffff, 0);
}

registerSprite({ bank_B6_sprite_main_handler_1, klubba_sprite_code, klubbas_club_sprite_code });
registerRtl({ CODE_B69493, CODE_B69499 });
