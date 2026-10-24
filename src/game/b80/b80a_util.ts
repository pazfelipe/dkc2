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

// ---- emulated time spent by long loops of the original (master cycles) ----
import { hw } from "../../core/mem";

/** Master cycles per byte of an MVN block move (refetches its 3 bytes from FastROM each time). */
export const MVN_BYTE = 46;

/** Let `masterCycles` of emulated time pass, as the original's loop would have taken. */
export function spend(masterCycles: number) {
  if (masterCycles > 0) hw.idle(masterCycles);
}
