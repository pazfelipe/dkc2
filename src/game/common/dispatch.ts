/**
 * Dispatch helpers for the original game's code-pointer tables and RAM-held code pointers.
 */
import { r16, rom16 } from "../../core/mem";
import { reg, implAt } from "../../core/cpu";
import { runOriginal, KIND_JSR } from "../../core/hybrid";
import { L, R } from "../../core/sym";

const SPRITE_MAIN_TABLE = L("sprite_main_table");

/**
 * `JMP (sprite_main_table,x)` with X = sprite type. Sprite main routines end with
 * `JML [sprite_return_address]`; a ported main simply returns.
 */
export function jumpToSpriteMain(type: number) {
  const addr = 0xb30000 | rom16(SPRITE_MAIN_TABLE + type);
  reg.x = type;
  reg.a = type;
  const impl = implAt(addr);
  if (impl) return impl();
  const ret = (r16(R.sprite_return_bank) << 16) | r16(R.sprite_return_address);
  runOriginal(addr, KIND_JSR, reg.db, 0, 0, [ret & 0xffffff]);
}
