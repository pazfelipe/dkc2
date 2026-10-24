/**
 * Bank $BB (part a) — PPU register scripts, VRAM payload uploads, and small screen helpers.
 *
 * - `ppu_config_table` ($FD79E2): per config id, a relative pointer to a list of
 *   (register word, value byte(s)) entries; bit 15 of the register word means "two bytes"
 *   (e.g. scroll registers written twice). Terminated by a zero word.
 * - `vram_payload_table` ($FD819A): per payload id, a relative pointer to 7-byte records
 *   (source bank, source word, VRAM word address, size) terminated by a zero bank byte.
 *   Bit 15 of the VRAM address marks compressed data (decompressed to $7F0000 first);
 *   otherwise the data is copied to $7F0000 and DMAed from there.
 */
import { r8, r16, w8, w16, busW8, busW16, rom8, rom16, io8, io16 } from "../../core/mem";
import { reg, register } from "../../core/cpu";
import { L, R, DMA, PPU, CPU, sprite_table } from "../../core/sym";
import { decompress_data_default } from "../../gen/routines";
import { read16x } from "./bba_util";

const PPU_CONFIG_TABLE = L("ppu_config_table");
const VRAM_PAYLOAD_TABLE = L("vram_payload_table");
const SPRITE_SIZE = 0x5e;

/** $BB80AC */
export function set_ppu_registers_global() {
  set_ppu_registers();
}

/** $BB80B0 */
export function vram_payload_handler_global() {
  vram_payload_handler();
}

/** $BB8C7F — A = PPU config id: write its list of register values. */
export function set_ppu_registers() {
  const entryA = reg.a & 0xffff;
  w8(0x0d70, entryA & 0xff);
  // ASL in 8-bit mode, then TAY with 16-bit index copies B too
  let y = (entryA & 0xff00) | ((entryA << 1) & 0xff);
  const at = (i: number) => (PPU_CONFIG_TABLE + i) & 0xffffff;
  y = rom16(at(y));
  let a = (entryA & 0xff00) | ((entryA << 1) & 0xff);
  for (;;) {
    let x = rom16(at(y));
    if (x === 0) break;
    y = (y + 2) & 0xffff;
    w16(0x76, x);
    const hi = r8(0x77);
    w8(0x77, (hi << 1) & 0xff); // ASL $77: test the "two bytes" flag
    if (hi & 0x80) {
      w8(0x77, hi & 0x7f); // LSR $77 (the flag shifted back out)
      x = r16(0x76);
      a = (a & 0xff00) | rom8(at(y));
      busW8(x, a & 0xff); // STA $00,x: a PPU register
      x = (x + 1) & 0xffff;
      y = (y + 1) & 0xffff;
    }
    a = (a & 0xff00) | rom8(at(y));
    busW8(x, a & 0xff);
    y = (y + 1) & 0xffff;
    reg.x = x;
  }
  reg.a = a;
  reg.y = y;
}

/** $BB8CB5 — A = VRAM payload id: upload all its chunks to VRAM. */
export function vram_payload_handler() {
  const callerDb = reg.db;
  const rec = (x: number, i: number) => (VRAM_PAYLOAD_TABLE + i + x) & 0xffffff; // DB=$FD, .w,x
  let x = rom16((VRAM_PAYLOAD_TABLE + ((reg.a << 1) & 0xffff)) & 0xffffff);
  for (;;) {
    const bank = rom8(rec(x, 0));
    if (bank === 0) break;
    if (rom8(rec(x, 4)) & 0x80) {
      // .compressed_payload: decompress to $7F0000
      reg.x = rom16(rec(x, 1));
      reg.y = bank;
      reg.a = bank;
      reg.db = 0xbb;
      decompress_data_default();
      reg.db = callerDb;
      io8(PPU.vram_address, rom8(rec(x, 3)));
      io8(PPU.vram_address + 1, rom8(rec(x, 4)) & 0x7f);
      io8(DMA.source_bank, 0x7f);
      io16(DMA.source, 0x0000);
    } else {
      // .static_payload: copy to $7F0000 (whole words, one past the size), then DMA from there
      w8(0x28, bank);
      io8(DMA.source_bank, 0x7f);
      io16(DMA.source, 0x0000);
      w16(0x26, rom16(rec(x, 1)));
      io16(PPU.vram_address, rom16(rec(x, 3)));
      let y = (rom16(rec(x, 5)) + 1) & 0xfffe;
      const ptr = (r8(0x28) << 16) | r16(0x26);
      do {
        busW16(0x7f0000 + y, read16x(ptr + y)); // LDA [$26],y / STA $7F0000,x
        y = (y - 2) & 0xffff;
      } while (!(y & 0x8000));
      reg.y = y;
    }
    // .DMA_payload
    io8(DMA.size_low, rom8(rec(x, 5)));
    io8(DMA.size_high, rom8(rec(x, 6)));
    io8(DMA.destination, 0x18); // $2118 VRAM data
    io8(DMA.control, 0x01); // two registers, write once
    io8(CPU.enable_dma, 0x01);
    x = (x + 7) & 0xffff;
  }
  reg.x = x;
  reg.a = x & 0xff00;
}

/** $BB91D9 — forced blank, no HDMA, NMI + auto joypad on. */
export function disable_screen() {
  io8(CPU.enable_hdma, 0x00);
  io8(CPU.enable_interrupts, 0x01);
  io8(PPU.screen, 0x8f);
  w16(R.pending_dma_hdma_channels, 0);
  reg.a = 0;
}

/** $BB91F7 */
export function init_sprite_render_order_global() {
  init_sprite_render_order();
}

/** $BB91FB — render order = sprite table order. */
export function init_sprite_render_order() {
  let a: number = sprite_table.slot_0;
  for (let x = 0; x !== 0x32; x += 2) {
    w16(R.sprite_render_table + x, a);
    a += SPRITE_SIZE;
  }
  reg.a = a;
  reg.x = 0x32;
}

register({
  set_ppu_registers_global,
  vram_payload_handler_global,
  set_ppu_registers,
  vram_payload_handler,
  disable_screen,
  init_sprite_render_order_global,
  init_sprite_render_order,
});
