/**
 * Bank $80 — reset: hardware init, anti-piracy checks, WRAM clear and engine start.
 *
 * The anti-piracy checks look for signs of a copier/game-genie style device: a JSR/JMP to the
 * reset vector left in RAM, missing SRAM, a PAL console, or the "A thief!" marker left in SRAM
 * by a previous failed check. On failure an error screen is shown and the CPU stops (STP).
 *
 * The original builds its call chain by pushing return addresses (%return) and falling into
 * init_registers; here that becomes ordinary calls in the same order.
 */
import { r8, r16, w16, io8, io16, ioR8, bus16, busW16, hw, wram } from "../../core/mem";
import { reg, register } from "../../core/cpu";
import { endFrame } from "../../core/hybrid";
import { L, R, C, CPU, PPU, DMA } from "../../core/sym";
import { cpuTime, MVN_BYTE } from "./b80a_util";
import {
  vram_payload_handler_global,
  dma_palette,
  set_ppu_registers_global,
  upload_spc_engine,
  disable_screen,
  init_rareware_logo,
  set_nmi_and_wait_keep_bank,
  clear_full_wram,
} from "../../gen/routines";

const RARE_STRING = L("rare_string");
const PIRACY_STRING = L("piracy_string");
const SRAM_BASE = 0xb06000;
const RESET_VECTOR = L("RESET_start") & 0xffff;

const MSG_IRREGULARITY = 0x3b;
const MSG_PIRACY = 0x3c;
const MSG_WRONG_CONSOLE = 0x3d;

/** $8083D0 — Y = message id: show the error screen and stop the CPU. */
export function display_error_message() {
  reg.a = reg.y;
  vram_payload_handler_global();
  reg.a = L("gameover_screen_palette") & 0xffff;
  reg.y = 0;
  reg.x = 0x20;
  dma_palette();
  reg.a = L("error_screen_text_layer_3_palette") & 0xffff;
  reg.y = 0;
  reg.x = 0x01;
  dma_palette();
  reg.a = C.error_generic_ppu_config_id;
  set_ppu_registers_global();
  // STP: the CPU halts for good (NMIs are disabled by init_registers)
  endFrame();
}

/** $8083F7 — power-on / reset. */
export function RESET_start() {
  io8(PPU.screen, 0x80);
  io8(CPU.enable_interrupts, 0x01);
  io8(CPU.rom_speed, 0x01);
  io8(CPU.enable_hdma, 0x00);
  // (CLC : XCE — native mode. TDC + $FFFF + C checks D = 0 and that we came from emulation
  // mode; both hold after a reset.)
  const msg = antiPiracyChecks();
  if (msg !== null) {
    // .prepare_message: DP = 0, stack reset, then init_registers -> clear_vram -> message
    init_registers();
    clear_vram();
    reg.y = msg;
    display_error_message();
    return;
  }
  // .prepare_logo
  busW16(SRAM_BASE, 0x0000);
  init_registers();
  clear_vram();
  start_engine();
}

/** Returns null when the game may boot, else the id of the error message to show. */
function antiPiracyChecks(): number | null {
  // .anti_piracy_test: was RESET_start reached through a JSR (its return address on the stack)?
  const sp = (hw.ex as unknown as { hw_cpu_live_reg(i: number): number }).hw_cpu_live_reg(3) & 0xffff;
  if (bus16((0xffff + sp) & 0xffffff) === ((RESET_VECTOR - 1) & 0xffff)) return checkForFalsePositive();
  // scan low RAM for code that would jump to the reset vector
  for (let y = 0x1ffd; y >= 0; y--) {
    const b = r8(y);
    if (b === 0x4c) {
      // JMP RESET_start
      if (r16(y + 1) === RESET_VECTOR) return checkForFalsePositive();
    } else if (b === 0x6c) {
      // JMP (ptr) with ptr in ROM or low RAM pointing at the reset vector
      const p = r16(y + 1);
      if ((p & 0x8000 || p < 0x2000) && bus16(p) === RESET_VECTOR) return checkForFalsePositive();
    } else if (b === 0x60) {
      // the sequence $60, $61, ... $7F (a copier's RAM signature)
      let x = y;
      let a = 0x60;
      while (r8(x) === a) {
        x++;
        a++;
        if (a & 0x80) return checkForFalsePositive();
      }
    }
  }
  cpuTime(0x1ffe * 134); // the scan loop (LDA abs,y / 3x CMP+BEQ / DEY / BPL per byte)
  // SRAM must be present (writable)
  const s = bus16(SRAM_BASE);
  busW16(SRAM_BASE, (s + 1) & 0xffff);
  if (bus16(SRAM_BASE) !== ((s + 1) & 0xffff)) return MSG_PIRACY;
  busW16(SRAM_BASE, s);
  // NTSC only (16-bit read of $213F/$2140, bit 4 = PAL)
  const ppu2 = ioR8(PPU.status_ppu2);
  ioR8(PPU.status_ppu2 + 1);
  if (ppu2 & 0x10) return MSG_WRONG_CONSOLE;
  // .final_piracy_test: "A thief!" left in RAM by an earlier failed check
  for (let x = 6; x >= 0; x -= 2) {
    if (r16(R.piracy_string_result + x) !== bus16(PIRACY_STRING + x)) return null;
  }
  return MSG_PIRACY;
}

/**
 * .check_for_false_positive: a previous boot that passed left "Rareware" in RAM (a soft reset),
 * so the suspicious RAM content is ours. Otherwise write "A thief!" to RAM and SRAM; if SRAM
 * already held it, this is a repeat offence (piracy message), else "irregularity detected".
 */
function checkForFalsePositive(): number | null {
  let match = true;
  for (let x = 6; x >= 0; x -= 2) {
    if (r16(R.piracy_string_result + x) !== bus16(RARE_STRING + x)) {
      match = false;
      break;
    }
  }
  if (match) return null;
  let y = 4;
  for (let x = 6; x >= 0; x -= 2) {
    const v = bus16(PIRACY_STRING + x);
    w16(R.piracy_string_result + x, v);
    if (v === bus16(SRAM_BASE + x)) y--;
    busW16(SRAM_BASE + x, v);
  }
  return y === 0 ? MSG_PIRACY : MSG_IRREGULARITY;
}

/** $8084F8 — put every PPU / CPU / DMA register in a known state. */
export function init_registers() {
  for (let x = 0; x < 0x34; x++) {
    io8(0x2101 + x, 0);
    io8(0x2101 + x, 0); // twice for the write-twice registers
  }
  for (let x = 0; x < 0x0b; x++) io8(0x4202 + x, 0);
  io8(PPU.screen, 0x8f);
  io8(PPU.vram_control, 0x80);
  io8(PPU.set_mode_7, 0x80);
  io8(CPU.rom_speed, 0x01);
  io8(PPU.set_color_math, 0);
  io8(PPU.video_mode, 0);
  io8(CPU.enable_interrupts, 0);
  io8(CPU.output_port, 0xff);
  io8(PPU.fixed_color, 0xe0);
  io8(PPU.color_addition_logic, 0x30);
  io8(PPU.mosaic, 0x00);
  for (const r of [PPU.layer_1_scroll_x, PPU.layer_2_scroll_x, PPU.layer_3_scroll_x]) {
    io8(r, 0);
    io8(r, 0);
  }
  for (const r of [PPU.layer_1_scroll_y, PPU.layer_2_scroll_y, PPU.layer_3_scroll_y]) {
    io8(r, 0xff);
    io8(r, 0xff);
  }
  for (let x = 0x0a; x >= 0; x--) {
    for (let ch = 0; ch < 8; ch++) io8(DMA.settings + ch * 0x10 + x, 0);
  }
  cpuTime(0x34 * 108 + 0x0b * 48 + 11 * 8 * 34 + 600); // the three clear loops + the rest
  // SEP #$30 zeroed the high bytes of X/Y; the DMA loop leaves X = $FFFF
  reg.x = 0xffff;
  reg.y &= 0xff;
  reg.a = 0xff;
}

/** $80858B */
export function init_registers_global() {
  init_registers();
}

/** $808591 — zero all 64 KiB of VRAM with a fixed-source DMA from vram_zero_fill. */
export function clear_vram() {
  const zero = L("vram_zero_fill");
  io16(PPU.vram_address, 0);
  io16(DMA.source, zero & 0xffff);
  io16(DMA.unused_2, zero & 0xffff);
  io16(DMA.size, 0); // 0 = 64 KiB
  io16(DMA.settings, 0x1809); // fixed source, two registers ($2118/$2119)
  io8(DMA.source_bank, zero >> 16);
  io8(CPU.enable_dma, 0x01);
  reg.a = 0x0001;
}

/** $8085B5 */
export function clear_vram_global() {
  clear_vram();
}

/** $8085B9 — zero WRAM, mark the anti-piracy check passed, start the sound CPU and the intro. */
export function start_engine() {
  // STZ $00 + MVN: zero bank $7E, then copy it over bank $7F
  wram.fill(0, 0, 0x20000);
  cpuTime(2 * 0x10000 * MVN_BYTE);
  reg.db = 0x80;
  for (let x = 6; x >= 0; x -= 2) w16(R.piracy_string_result + x, bus16(RARE_STRING + x));
  reg.x = 0xfffe;
  upload_spc_engine();
  restart_rareware_logo();
}

/** $8085E4 — (re)start from the Rareware / Nintendo intro (also after the 3rd demo). */
export function restart_rareware_logo() {
  disable_screen();
  clear_full_wram();
  init_rareware_logo();
}

/** $8085EF — go to the title screen (and allow skipping the intro from now on). */
export function setup_title_screen_transition() {
  w16(R.enable_intro_bypass, 0xffff);
  disable_screen();
  w16(R.game_mode_pointer, L("init_title_screen") & 0xffff);
  io16(PPU.oam_address, 0);
  reg.a = L("run_simple_game_mode") & 0xffff;
  set_nmi_and_wait_keep_bank();
}


register({
  display_error_message,
  RESET_start,
  init_registers,
  init_registers_global,
  clear_vram,
  clear_vram_global,
  start_engine,
  restart_rareware_logo,
  setup_title_screen_transition,
});
