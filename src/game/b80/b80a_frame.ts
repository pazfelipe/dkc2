/**
 * Bank $80 — the frame skeleton.
 *
 * DKC2 runs all of its game logic inside the NMI handler:
 *
 *   NMI_start -> JMP (nmi_pointer) -> run_simple_game_mode -> JMP (game_mode_pointer)
 *             -> game mode / sub mode logic -> game_sub_mode_return -> CODE_80862A
 *             -> CODE_808636 -> WAI (the frame ends, the stack is thrown away)
 *
 * While the logic of a frame runs, nmi_pointer points to run_incomplete_frame, so an NMI that
 * fires before the logic is done ("lag frame") only refreshes the brightness and returns.
 *
 * In the port the `WAI` that ends a frame is `endFrame()`: every routine on that path calls it
 * and simply returns all the way up. The stack resets (`TXS`/`TCS`) have no TS equivalent.
 */
import { r8, r16, w16, io8, io16, ioR8, inc16 } from "../../core/mem";
import { reg, register, callPtr } from "../../core/cpu";
import { endFrame } from "../../core/hybrid";
import { waitUntil } from "../../core/ops";
import { L, R, CPU, PPU, DMA, joypad } from "../../core/sym";

const RUN_INCOMPLETE_FRAME = L("run_incomplete_frame") & 0xffff;
const RUN_SIMPLE_GAME_MODE = L("run_simple_game_mode") & 0xffff;

// ---------------------------------------------------------------------------------------------
// NMI entry

/** $80F3BD — VBlank NMI: force blank, count the frame and run the current NMI routine. */
export function NMI_start() {
  // (JML .fast_rom_hop; registers are preserved on the stack; DP = 0)
  ioR8(CPU.nmi_flag); // acknowledge the NMI
  io8(PPU.screen, 0x8f); // F-blank while the frame's uploads run
  inc16(R.global_frame_counter);
  callPtr(0x80, r16(R.nmi_pointer));
}

/** $80F3E6 — NMI routine used while a frame's logic is still running (lag frame). */
export function run_incomplete_frame() {
  io8(PPU.screen, r8(R.screen_brightness));
  nmi_return();
}

/** $80F3F2 — restore the interrupted registers and RTI (nothing to do in TS). */
export function nmi_return() {}

// ---------------------------------------------------------------------------------------------
// Game mode dispatch

/** $808608 — the NMI routine of most game modes: run the game mode pointer. */
export function run_simple_game_mode() {
  // LDA #stack : TCS — drop the interrupt frame
  CODE_80860C();
}

/** $80860C — arm the lag-frame NMI handler, count the frame and run the game mode. */
export function CODE_80860C() {
  w16(R.nmi_pointer, RUN_INCOMPLETE_FRAME);
  inc16(R.active_frame_counter);
  callPtr(0x80, r16(R.game_mode_pointer));
}

/** $808616 — frame end variant that also advances RAM_0985 and writes the brightness. */
export function CODE_808616() {
  w16(R.RAM_0985, (r16(R.RAM_0985) + 0x0100) & 0xffff);
  io8(PPU.screen, r8(R.screen_brightness));
  CODE_80862A();
}

/**
 * $80862A — anti-tamper check, then end the frame. If the data bank is $C0 or above the
 * original falls into the bytes at DATA_808633 ($00 = BRK) and crashes.
 */
export function CODE_80862A() {
  if ((reg.db & 0xff) >= 0xc0) throw new Error("CODE_80862A: BRK (data bank >= $C0)");
  CODE_808636();
}

/** $808636 — count the gameplay frame, re-arm the game mode NMI and wait for it (WAI). */
export function CODE_808636() {
  // 32-bit gameplay frame counter that saturates at $FFFFxxxx
  const lo = (r16(R.gameplay_frame_counter) + 1) & 0xffff;
  w16(R.gameplay_frame_counter, lo);
  if (lo === 0) {
    const hi = (r16(R.gameplay_frame_counter_high) + 1) & 0xffff;
    w16(R.gameplay_frame_counter_high, hi === 0 ? 0xffff : hi);
  }
  w16(R.nmi_pointer, RUN_SIMPLE_GAME_MODE);
  ioR8(CPU.nmi_flag);
  io8(CPU.enable_interrupts, 0x81); // NMI + auto-joypad
  io8(joypad.port_0, 0);
  endFrame(); // WAI
}

/** $80866C — (dead code) store RAM_0987 and run the game mode. A = value. */
export function CODE_80866C() {
  w16(R.RAM_0987, reg.a);
  CODE_80860C();
}

/** $808672 — (dead code) decrease RAM_0987 by $10, clamped at 0, then run the game mode. */
export function CODE_808672() {
  let a = (r16(R.RAM_0987) - 0x10) & 0xffff;
  if (a & 0x8000) a = 0;
  reg.a = a;
  CODE_80867E();
}

/** $80867E — (dead code) store RAM_0987 and run the game mode. */
export function CODE_80867E() {
  w16(R.RAM_0987, reg.a);
  CODE_80860C();
}

// ---------------------------------------------------------------------------------------------
// NMI pointer / game mode pointer helpers

/** $808C80 — A = new NMI routine. DB = $80, then wait for the next NMI. */
export function set_nmi_and_wait() {
  reg.db = 0x80;
  set_nmi_and_wait_keep_bank();
}

/** $808C82 — A = new NMI routine; wait for the next NMI. */
export function set_nmi_and_wait_keep_bank() {
  w16(R.nmi_pointer, reg.a);
  wait_for_next_nmi();
}

/** $808C84 — acknowledge pending interrupts, enable NMI + auto-joypad and WAI. */
export function wait_for_next_nmi() {
  ioR8(CPU.irq_flag);
  ioR8(CPU.nmi_flag);
  waitUntil(() => (ioR8(CPU.nmi_flag) & 0x80) === 0);
  io8(CPU.enable_interrupts, 0x81);
  io8(joypad.port_0, 0);
  reg.a = (reg.a & 0xff00) | 0x81;
  endFrame(); // WAI
}

/** $808C9E — A = new game mode routine. Install it and end the frame. */
export function set_game_mode_and_return() {
  reg.db = 0x80;
  w16(R.game_mode_pointer, reg.a);
  game_sub_mode_return();
}

/** $808CA2 — common end of a game (sub) mode frame: prepare the OAM DMA and wait for NMI. */
export function game_sub_mode_return() {
  prepare_oam_dma_channel();
  CODE_80862A();
}

/** $808CA8 */
export function prepare_oam_dma_channel_global() {
  prepare_oam_dma_channel();
}

/** $808CAC — set DMA channel 0 up to copy the OAM buffer ($0200, $220 bytes) to OAM. */
export function prepare_oam_dma_channel() {
  io16(DMA.source, R.oam_table);
  io16(DMA.unused_2, R.oam_table);
  io16(DMA.size, 0x0220);
  io16(DMA.settings, 0x0400); // one register, write once, to $2104
  io8(DMA.source_bank, 0);
  reg.a = 0x0400;
}

// ---------------------------------------------------------------------------------------------
// Exceptions (debug leftovers)

/** $808C13 — exception reporting is disabled in the release: RTL immediately. */
export function throw_exception() {}

/** $808C21 — (unreferenced) PLA restores the exception id pushed by the caller, then CODE_808C22. */
export function CODE_808C21() {
  CODE_808C22();
}

/** $808C22 — (unreferenced) A = exception id: record it. */
export function CODE_808C22() {
  w16(R.exception_number, reg.a);
  w16(R.exception_unknown, 0x00b4);
  reg.a = 0x00b4;
}

register({
  NMI_start,
  run_incomplete_frame,
  nmi_return,
  run_simple_game_mode,
  CODE_80860C,
  CODE_808616,
  CODE_80862A,
  CODE_808636,
  CODE_80866C,
  CODE_808672,
  CODE_80867E,
  set_nmi_and_wait,
  set_nmi_and_wait_keep_bank,
  wait_for_next_nmi,
  set_game_mode_and_return,
  game_sub_mode_return,
  prepare_oam_dma_channel_global,
  prepare_oam_dma_channel,
  throw_exception,
  CODE_808C21,
  CODE_808C22,
});
