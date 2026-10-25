/**
 * Bank $80 — WRAM clearing, OAM clearing, simple DMA helpers and the second RNG.
 *
 * The original clears memory with overlapping MVN block moves (STZ the first byte, then copy it
 * forward); here that is a plain fill plus the CPU time the MVN takes (cpuTime), because these
 * clears are long enough to change how many lag frames a screen init spans.
 */
import { r16, w16, io8, io16, wram, rom16 } from "../../core/mem";
import { reg, register } from "../../core/cpu";
import { L, R, DMA, CPU, wram_clear_table } from "../../core/sym";
import { cpuTime, MVN_BYTE } from "./b80a_util";

/** zero WRAM offsets [start, end) (0..$1FFFF), with the CPU time of the original MVN */
function zeroWram(start: number, end: number) {
  wram.fill(0, start, end);
  cpuTime((end - start) * MVN_BYTE);
}

/** $808E6A — clear the WRAM that is rebuilt by every game mode init. */
export function clear_noncritical_wram() {
  zeroWram(0x00d9, 0x00ff); // $D9-$FE
  zeroWram(0x0911, 0x19da); // $0911-$19D9
  zeroWram(0x5a12, 0x9528); // $7E5A12-$7E9527 (sprite spawn lists...)
  zeroWram(0x10000, 0x20000); // all of bank $7F
  // MVN leaves A = $FFFF, X = $0000, Y = $0001; DB restored by PLB
  reg.a = 0xffff;
  reg.x = 0x0000;
  reg.y = 0x0001;
}

/**
 * $808EAE — clear all of WRAM except $00-$33 (system variables / this routine's scratch) and
 * $0907-$0910 (anti-piracy string). The original pops its return address into temp_32 first,
 * resets the stack after the clear and returns with JMP (temp_32).
 * The stack page ($0100-$01FF) is left alone here: in the hybrid runtime the reference CPU may
 * have suspended frames there, and the original reset the stack anyway.
 */
export function clear_full_wram() {
  w16(R.temp_32, 0x85eb); // the only caller is restart_rareware_logo ($8085E8 + 3)
  zeroWram(0x10000, 0x20000); // bank $7F
  zeroWram(0x0911, 0x10000); // $7E0911-$7EFFFF
  // $0034-$0906 (except the stack page)
  zeroWram(0x0034, 0x0100);
  zeroWram(0x0200, 0x0907);
  reg.db = 0x80;
  reg.a = 0xffff;
}

const WRAM_TABLES = L("clear_wram_tables_wram_tables");

/** $8088D2 — zero the sprite table, Kong control variables and other per-level tables. */
export function clear_wram_tables() {
  for (let y = WRAM_TABLES; ; y += 4) {
    const addr = rom16(y + wram_clear_table.address);
    if (addr & 0x8000) break; // $FFFF terminator
    const words = rom16(y + wram_clear_table.size) >> 1;
    for (let i = 0; i < words; i++) w16((addr + i * 2) & 0xffff, 0);
  }
}

/** $8088AB — hide every OAM slot. */
export function set_all_oam_offscreen() {
  w16(0x70, R.oam_table);
  set_unused_oam_offscreen();
}

/** $8088B4 — long wrapper (DB preserved). */
export function set_unused_oam_offscreen_global() {
  const db = reg.db;
  set_unused_oam_offscreen();
  reg.db = db;
}

/** $8088BA — move the OAM slots from $70 (next free slot) to the end off screen (Y=$F0). */
export function set_unused_oam_offscreen() {
  reg.db = 0x80;
  let x = r16(0x70);
  if (x !== R.oam_attribute_table) {
    reg.a = 0xf0ff;
    do {
      w16(x, 0xf0ff);
      x = (x + 4) & 0xffff;
    } while (x !== R.oam_attribute_table);
  }
  reg.x = x;
}

/** $80895F */
export function dma_to_vram_global() {
  dma_to_vram();
}

/** $808963 — DMA Y bytes from X:A to VRAM (the VRAM address is already set). */
export function dma_to_vram() {
  io16(DMA.source, reg.a);
  io16(DMA.size, reg.y);
  io16(DMA.settings, 0x1801); // two registers ($2118/$2119), write once
  io8(DMA.source_bank, reg.x & 0xff);
  io8(CPU.enable_dma, 0x01);
  reg.a = (reg.a & 0xff00) | 0x01;
  reg.x &= 0xff;
  reg.y &= 0xff;
}

/** $808E4F */
export function get_random_number_2_global() {
  get_random_number_2();
}

/** $808E53 — second random number generator (shift/xor), returns A = rng_result. */
export function get_random_number_2() {
  const old = r16(R.rng_result);
  w16(R.temp_34, old);
  const mixed = (((r16(R.rng_seed_2) << 1) | (old >> 15)) & 0xffff) >>> 0;
  w16(R.temp_32, mixed);
  w16(R.rng_result, r16(R.rng_seed_1) ^ mixed);
  w16(R.rng_seed_2, r16(R.temp_34));
  reg.a = r16(R.rng_result);
}

register({
  clear_noncritical_wram,
  clear_full_wram,
  clear_wram_tables,
  set_all_oam_offscreen,
  set_unused_oam_offscreen_global,
  set_unused_oam_offscreen,
  dma_to_vram_global,
  dma_to_vram,
  get_random_number_2_global,
  get_random_number_2,
});
