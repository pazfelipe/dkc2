/**
 * Bank $B6 — `bank_B6_sprite_main_handler_2`: the sprite mains of Kleever, Krow and their
 * parts (entries of `sprite_main_table` in bank $B3 load A = index and jump here).
 */
import { rom16 } from "../../core/mem";
import { reg } from "../../core/cpu";
import { L } from "../../core/sym";
import { spriteTail, registerSprite } from "./b6ba_common";

const MAIN_TABLE = (L("bank_B6_sprite_main_handler_2") + 6) & 0xffff;

/** $B6D171 — `TAX : PHK : PLB : JMP (.main_table,x)`. */
export function bank_B6_sprite_main_handler_2(): void {
  reg.x = reg.a & 0xffff;
  reg.db = 0xb6;
  spriteTail(0xb60000 | rom16(0xb60000 | ((MAIN_TABLE + reg.x) & 0xffff)));
}

registerSprite({ bank_B6_sprite_main_handler_2 });
