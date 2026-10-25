/**
 * Bank $BE (package BE1) — shared helpers: sprite-state dispatch of the bank's sprite codes,
 * jumps into sprite code that may still be original, and decimal-mode arithmetic.
 */
import { r16, w16, rom16 } from "../../core/mem";
import { reg, implAt, type Routine } from "../../core/cpu";
import { runOriginal, KIND_JSR } from "../../core/hybrid";
import { R, sprite as S } from "../../core/sym";

export const BANK_BE = 0xbe;

/** The sprite being processed (LDX current_sprite). */
export const cur = () => r16(R.current_sprite);

/**
 * `JMP (ptr)` into sprite code of bank $BE that ends with `JML [sprite_return_address]`.
 * A ported target simply returns; an original one runs until it reaches the sprite return.
 */
export function jumpSpriteCode(addr: number) {
  addr &= 0xffffff;
  const impl = implAt(addr);
  if (impl) return impl();
  const back = ((r16(R.sprite_return_bank) << 16) | r16(R.sprite_return_address)) & 0xffffff;
  runOriginal(addr, KIND_JSR, reg.db, 0, 0, [back]);
}

/**
 * `JSR sprite_state_handler_BE` followed by a state table: the original pops its own return
 * address to find the table, then jumps to the entry for the sprite's state (bits 0-6 of
 * sprite.state). On entry to the handler Y = the sprite, A = 2 * sub state, X = table entry
 * address and DB = $BE. `table` is the ROM address of the table; `handlers` are the TS ports
 * of its entries (an out-of-range state jumps through the ROM table like the original).
 */
export function spriteStateDispatch(table: number, handlers: Routine[]) {
  reg.db = BANK_BE;
  const y = cur();
  w16(R.current_sprite_constants, r16(y + S.constants_address));
  const state = r16(y + S.state) & 0x7f;
  reg.y = y;
  reg.x = (table + state * 2) & 0xffff;
  reg.a = ((r16(y + S.sub_state) & 0xff) << 1) & 0xffff;
  const fn = handlers[state];
  if (fn) return fn();
  jumpSpriteCode((BANK_BE << 16) | rom16(table + state * 2));
}

/** Carry out of the last decimal-mode helper. */
export const bcd = { c: false };

/** 16-bit ADC in decimal mode (SED), exactly as the reference 65816 computes it. */
export function adcBcd16(a: number, b: number, carry: boolean): number {
  a &= 0xffff;
  b &= 0xffff;
  let r = (a & 0xf) + (b & 0xf) + (carry ? 1 : 0);
  if (r > 0x9) r = ((r + 0x6) & 0xf) + 0x10;
  r = (a & 0xf0) + (b & 0xf0) + r;
  if (r > 0x9f) r = ((r + 0x60) & 0xff) + 0x100;
  r = (a & 0xf00) + (b & 0xf00) + r;
  if (r > 0x9ff) r = ((r + 0x600) & 0xfff) + 0x1000;
  r = (a & 0xf000) + (b & 0xf000) + r;
  if (r > 0x9fff) r += 0x6000;
  bcd.c = r > 0xffff;
  return r & 0xffff;
}

/** 16-bit SBC in decimal mode (SED), exactly as the reference 65816 computes it. */
export function sbcBcd16(a: number, b: number, carry: boolean): number {
  a &= 0xffff;
  const v = ~b & 0xffff;
  let r = (a & 0xf) + (v & 0xf) + (carry ? 1 : 0);
  if (r < 0x10) r = (r - 0x6) & (r - 0x6 < 0 ? 0xf : 0x1f);
  r = (a & 0xf0) + (v & 0xf0) + r;
  if (r < 0x100) r = (r - 0x60) & (r - 0x60 < 0 ? 0xff : 0x1ff);
  r = (a & 0xf00) + (v & 0xf00) + r;
  if (r < 0x1000) r = (r - 0x600) & (r - 0x600 < 0 ? 0xfff : 0x1fff);
  r = (a & 0xf000) + (v & 0xf000) + r;
  if (r < 0x10000) r -= 0x6000;
  bcd.c = r > 0xffff;
  return r & 0xffff;
}
