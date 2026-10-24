/**
 * Top-level driver. The original game runs entirely inside its NMI handler:
 *
 *   reset:  RESET_start initializes hardware/WRAM, then waits for the first NMI.
 *   frame:  VBlank -> NMI_start -> JMP (nmi_pointer) -> run_simple_game_mode
 *           -> JMP (game_mode_pointer) -> uploads (DMA) + game logic -> WAI
 *
 * The port reproduces that: `boot()` once, then `frame(pad)` per video frame.
 */
import { hw, r16, w16 } from "../core/mem";
import { reg, implAt } from "../core/cpu";
import { runOriginal, KIND_INT, KIND_JSL, clearFrameEnded, enableTraps } from "../core/hybrid";
import { L, R } from "../core/sym";
import "../gen/routines"; // all stubs: fallback dispatch + return modes
import "./index";

export function boot() {
  enableTraps(true);
  reg.a = reg.x = reg.y = 0;
  reg.c = false;
  const reset = implAt(L("RESET_start"));
  if (reset) reset();
  else runOriginal(L("RESET_start"), KIND_JSL, 0x00, 0, 3);
}

/**
 * One video frame: the NMI handler (all game logic) then the scanlines up to the next VBlank.
 *
 * Lag frames: the ported logic itself takes no time, but waiting for the sound CPU (APU
 * handshakes, e.g. uploading samples on a room change) and DMA take real (emulated) time,
 * exactly as on the console. When that pushes the logic past one or more VBlanks, the
 * original takes "incomplete frame" NMIs (each only bumps the global frame counter) and
 * finishes its logic later. We reproduce that: the extra VBlanks are counted, and the
 * following calls to frame() just let those already-rendered frames pass.
 * Returns false for frames where no game logic ran.
 */
let pendingLag = 0;
export let lagFrames = 0;
export function frame(pad: number, pad2 = 0): boolean {
  hw.setInput(0, pad);
  hw.setInput(1, pad2);
  if (pendingLag > 0) {
    // this VBlank already passed while the logic ran; the original still read the pad at it
    pendingLag--;
    (hw.ex as unknown as { hw_force_autojoy(a: number, b: number): void }).hw_force_autojoy(pad, pad2);
    return false;
  }
  clearFrameEnded();
  enableTraps(true);
  const v0 = hw.ex.hw_vblank_count();
  const nmi = implAt(L("NMI_start"));
  if (nmi) nmi();
  else runOriginal(L("NMI_start"), KIND_INT, 0x80, 0, 0);
  const extra = (hw.ex.hw_vblank_count() - v0) >>> 0;
  if (extra > 0) {
    // NMIs that fired while the logic was still running: run_incomplete_frame each
    w16(R.global_frame_counter, (r16(R.global_frame_counter) + extra) & 0xffff);
    lagFrames += extra;
    pendingLag = extra;
    // we are inside (or past) the VBlank of the last incomplete frame: render up to the next one
    hw.runToVblank();
    return true;
  }
  hw.runToVblank();
  return true;
}
