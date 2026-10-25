/**
 * Helpers for package 80a: calls to routines that have no generated stub.
 *
 * Labels written `#name:` in the disassembly (e.g. the sound driver entry points in bank $B5,
 * `play_high_priority_sound`, `queue_song`) are global names for a JMP vector but get no stub in
 * src/gen/routines.ts. These helpers call them with the convention their callers use.
 */
import { reg, implAt } from "../../core/cpu";
import { runOriginal, KIND_JSL } from "../../core/hybrid";
import { L } from "../../core/sym";

/** JSL to a label: the port if registered, else the original on the reference CPU (16-bit A/X/Y). */
export function jslLabel(name: string) {
  const addr = L(name);
  const impl = implAt(addr);
  if (impl) impl();
  else runOriginal(addr, KIND_JSL, reg.db, 0, 0);
}

export const play_high_priority_sound = () => jslLabel("play_high_priority_sound");
export const queue_song = () => jslLabel("queue_song");
export const play_queued_song = () => jslLabel("play_queued_song");
export const play_song = () => jslLabel("play_song");
export const queue_sound_effect = () => jslLabel("queue_sound_effect");
export const play_song_with_transition = () => jslLabel("play_song_with_transition");
export const transition_song = () => jslLabel("transition_song");
export const play_queued_sound_effect = () => jslLabel("play_queued_sound_effect");

// ---- indirect jumps ----
import { callAddr, UnportedRoutine } from "../../core/cpu";
import { KIND_JSR } from "../../core/hybrid";

/**
 * JMP/JSR through a code pointer in `bank` (game mode / NMI / sub mode tables). Targets without
 * a generated stub (e.g. `#labels`) run on the reference CPU as a JSR.
 */
export function jumpPtr(bank: number, ptr16: number) {
  const addr = (bank << 16) | (ptr16 & 0xffff);
  try {
    callAddr(addr);
  } catch (e) {
    if (!(e instanceof UnportedRoutine) || e.addr !== addr) throw e;
    runOriginal(addr, KIND_JSR, reg.db, 0, 0);
  }
}

// ---- CPU time of heavy loops ----
import { hw } from "../../core/mem";

/**
 * Master cycles per byte of an MVN block move (the 3-byte instruction is refetched from FastROM
 * for every byte: 3x6 + read 8 + write 8 + 2 idle x6).
 */
export const MVN_BYTE = 46;

/**
 * Speed-up of the reference 65816 relative to a real SNES, as a shift (hw_set_overclock). Under
 * the test oracle the original code runs with DKC2_OVERCLOCK (default 6 = 64x); in the browser it
 * runs at real speed. There is no hardware getter for it, so it is read from the environment.
 */
const OVERCLOCK_SHIFT: number =
  typeof process !== "undefined" && process.env ? parseInt(process.env.DKC2_OVERCLOCK ?? "6") : 0;

/**
 * Let the emulated time pass that a heavy loop of the original (e.g. an MVN clear of 80 KiB)
 * takes on the CPU, so screen inits span the same number of (lag) frames as the original.
 * Ordinary short code is treated as instantaneous like all ported logic.
 */
let cpuTimeAcc = 0;
export function cpuTime(masterCycles: number) {
  // like the reference CPU's overclock accumulator: keep the fraction for the next call
  cpuTimeAcc += masterCycles;
  const c = Math.floor(cpuTimeAcc / 2 ** OVERCLOCK_SHIFT);
  cpuTimeAcc -= c * 2 ** OVERCLOCK_SHIFT;
  if (c > 0) hw.idle(c);
}

/**
 * JSR (table,x): the port if registered, else the original entered as a JSR (RTS return), no
 * matter which call kind the generated stub guessed (stubs of routines never seen in the traces
 * may guess JSL, which makes their RTS return to garbage).
 */
export function jsrPtr(bank: number, ptr16: number) {
  const addr = (bank << 16) | (ptr16 & 0xffff);
  const impl = implAt(addr);
  if (impl) impl();
  else runOriginal(addr, KIND_JSR, reg.db, 0, 0);
}
