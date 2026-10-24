/**
 * Helpers shared by the b5c_* files: JSL entry points that have no generated stub
 * (the `#label` thunks at the start of bank $B5).
 */
import { reg, implAt } from "../../core/cpu";
import { runOriginal, KIND_JSL } from "../../core/hybrid";
import { L } from "../../core/sym";

/** JSL to a ROM label (ported implementation if registered, otherwise the original). */
export function jslLabel(name: string) {
  const addr = L(name);
  const impl = implAt(addr);
  if (impl) impl();
  else runOriginal(addr, KIND_JSL, reg.db, 0, 0);
}

/** $B58003 — A = (channel << 8) | sound id. */
export const queue_sound_effect = () => jslLabel("queue_sound_effect");
/** $B58021 — A = (channel << 8) | sound id. */
export const play_high_priority_sound = () => jslLabel("play_high_priority_sound");
