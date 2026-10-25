/**
 * Bank $B4 helpers shared by the b4_* files: data-bank relative accesses, long pointers held in
 * direct page, read-modify-write shifts with the carry chain, and the DMA idiom used everywhere
 * in this bank (one channel-0 transfer to VRAM data port $2118).
 *
 * Code in this bank switches the data bank constantly (PHK/PLB, `%pea_mask_dbr($7E....)`), and
 * the same absolute operand means ROM in bank $B4 or WRAM in bank $7E depending on it. The ports
 * keep `reg.db` exactly like the original (also because original routines they call inherit it)
 * and read through it with `dbR8/dbR16`.
 */
import { reg } from "../../core/cpu";
import { r8, r16, w8, w16, bus8, bus16, busW8, busW16, io8, io16 } from "../../core/mem";
import { DMA, CPU, PPU } from "../../core/sym";

/** `LDA abs` (8-bit) through the current data bank. */
export const dbR8 = (a: number) => bus8(((reg.db & 0xff) << 16) | (a & 0xffff));
/** `LDA abs` (16-bit) through the current data bank. */
export const dbR16 = (a: number) => bus16(((reg.db & 0xff) << 16) | (a & 0xffff));
/** `STA abs` (16-bit) through the current data bank. */
export const dbW16 = (a: number, v: number) => busW16(((reg.db & 0xff) << 16) | (a & 0xffff), v & 0xffff);
/** `STA abs` (8-bit) through the current data bank. */
export const dbW8 = (a: number, v: number) => busW8(((reg.db & 0xff) << 16) | (a & 0xffff), v & 0xff);

/** The 24-bit pointer `[$dp]` held in direct page. */
export const ptr24 = (dp: number) => r16(dp) | (r8(dp + 2) << 16);
/** `LDA [$dp],y` (16-bit). */
export const longR16 = (dp: number, y = 0) => bus16((ptr24(dp) + (y & 0xffff)) & 0xffffff);
/** `LDA [$dp],y` (8-bit). */
export const longR8 = (dp: number, y = 0) => bus8((ptr24(dp) + (y & 0xffff)) & 0xffffff);
/** `STA [$dp],y` (16-bit). */
export const longW16 = (dp: number, v: number, y = 0) => busW16((ptr24(dp) + (y & 0xffff)) & 0xffffff, v & 0xffff);
/** `STA [$dp],y` (8-bit). */
export const longW8 = (dp: number, v: number, y = 0) => busW8((ptr24(dp) + (y & 0xffff)) & 0xffffff, v & 0xff);

/** `INC abs` / `DEC abs` on a WRAM word. Returns the new value. */
export function add16(a: number, d: number): number {
  const v = (r16(a) + d) & 0xffff;
  w16(a, v);
  return v;
}
/** `INC abs` / `DEC abs` on a WRAM byte (8-bit A). Returns the new value. */
export function add8(a: number, d: number): number {
  const v = (r8(a) + d) & 0xff;
  w8(a, v);
  return v;
}

/** `LSR abs` (16-bit): returns the bit shifted out (carry). */
export function lsrM16(a: number): boolean {
  const v = r16(a);
  w16(a, v >> 1);
  return (v & 1) !== 0;
}
/** `LSR abs` (8-bit). */
export function lsrM8(a: number): boolean {
  const v = r8(a);
  w8(a, v >> 1);
  return (v & 1) !== 0;
}
/** `ROR abs` (16-bit) with carry in; returns carry out. */
export function rorM16(a: number, c: boolean): boolean {
  const v = r16(a);
  w16(a, (v >> 1) | (c ? 0x8000 : 0));
  return (v & 1) !== 0;
}
/** `ASL abs` (8-bit). */
export function aslM8(a: number) {
  w8(a, (r8(a) << 1) & 0xff);
}

/**
 * `CLC : ROR $0687 : ROR $0687 : BNE + : ROR $0687 : DEC $0685 : DEC $0685` — advance the
 * "large sprite" bit of the OAM high table cursor by one sprite ($0687 = bit mask, $0685 = the
 * high table byte address, filled from the end).
 */
export function nextOamHighBit() {
  let c = rorM16(0x0687, false);
  c = rorM16(0x0687, c);
  if (r16(0x0687) !== 0) return;
  rorM16(0x0687, c);
  add16(0x0685, -2);
}

/**
 * Channel 0 general DMA to the VRAM data port: `STA PPU.vram_address` (unless `vram` is null),
 * then settings $01, destination $18, source, bank, size, `STZ unused_1` and start.
 */
export function dmaToVram(vram: number | null, src: number, bank: number, size: number) {
  if (vram !== null) io16(PPU.vram_address, vram & 0xffff);
  io8(DMA.settings, 0x01);
  io8(DMA.destination, 0x18);
  io16(DMA.source, src & 0xffff);
  io8(DMA.source_bank, bank & 0xff);
  io16(DMA.size, size & 0xffff);
  io8(DMA.unused_1, 0);
  io8(CPU.enable_dma, 0x01);
}

/**
 * The OAM upload done by every NPC screen frame (and CODE_B48C9D): channel 0, source $00:0200,
 * $220 bytes to OAM data ($2104), written with the 16-bit stores of the original.
 */
export function dmaOamBuffer() {
  io16(DMA.source, 0x0200);
  io16(DMA.unused_2, 0x0200);
  io16(DMA.size, 0x0220);
  io16(DMA.settings, 0x0400);
  io8(DMA.source_bank, 0);
  io8(CPU.enable_dma, 0x01);
}
