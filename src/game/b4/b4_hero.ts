/**
 * Bank $B4 — the hooks of the map into Cranky's "video game heroes" screen: once the player has
 * seen it (visited_kong_family_members bit 6), passing the rival's DK coin count or pressing L+R
 * on the map fades to it. The screen itself (CODE_B4BEEF onwards, run through $067D/$067F by
 * run_ending_monkey_museum) is end-game content and keeps running the original code.
 */
import { r16, w16 } from "../../core/mem";
import { reg, register } from "../../core/cpu";
import { setRetMode, RET_RTS } from "../../core/hybrid";
import { L, R } from "../../core/sym";
import { set_fade_global } from "../../gen/routines";

const lo16 = (a: number) => a & 0xffff;
const DATA_B4BED7 = L("DATA_B4BED7");

/** $B4BE63 — L+R on the map: show the video game heroes (then the map frame tail runs). */
export function CODE_B4BE63() {
  CODE_B4BEB4();
  w16(0x06a5, (r16(0x06a5) & 0xfffe) | 0x0020);
  w16(0x0658, 0x0001);
  let a = lo16(L("DATA_F7844A"));
  if (r16(R.dk_coin_count) >= r16(DATA_B4BED7)) a = lo16(L("DATA_F7844C"));
  if (r16(R.language_select) !== 0) a = lo16(L("DATA_F7FCEE"));
  w16(0x0672, a);
}

/** $B4BE96 — map init after beating the rival's DK coin record: go to the heroes screen. */
export function CODE_B4BE96() {
  CODE_B4BEB4();
  w16(0x06a5, r16(0x06a5) | 0x0021);
  w16(0x0658, 0x0002);
  w16(0x0672, lo16(L(r16(R.language_select) !== 0 ? "DATA_F7FCE4" : "DATA_F7845C")));
}

/** $B4BEB4 — fade out; the NPC frame runs CODE_B4BEEF next, then CODE_B4C14E. */
export function CODE_B4BEB4() {
  reg.a = 0x810f;
  set_fade_global();
  w16(0x06a3, r16(0x06a3) | 0x8000);
  w16(0x067d, lo16(L("CODE_B4BEEF")));
  w16(0x067f, lo16(L("CODE_B4C14E")));
}

register({ CODE_B4BE96, CODE_B4BEB4 });
for (const n of ["CODE_B4BE96", "CODE_B4BEB4"]) setRetMode(L(n), RET_RTS);
