/**
 * Bank $BA (package final) — the Kong family NPCs (Cranky, Funky, Swanky, Wrinkly) standing in
 * their screens, and the sparkles around Klubba's kiosk.
 *
 * Both are entered through `bank_BA_sprite_main_handler_2` (table entries 8, $A, $C) with
 * DB = $BA and leave through `JML [sprite_return_address]`.
 */
import { r16, w16, rom16, ioR16 } from "../../core/mem";
import { reg } from "../../core/cpu";
import { R, C, CPU } from "../../core/sym";
import {
  set_sprite_animation,
  process_sprite_animation,
  spawn_no_gfx_special_sprite_index,
  CODE_B4C175,
  divide_a_by_y,
} from "../../gen/routines";
import { cur, rd, wr, inc, dec, registerSprite, registerRtl } from "../b6/b6ba_common";

/** Animation sequences live in bank $BA (`LDA $0000,y` with DB = $BA). */
const seq = (y: number) => rom16(0xba0000 | (y & 0xffff));

/**
 * $BAC1D9 — a Kong family member. $44 walks an animation sequence (a list of animation ids,
 * `$0063, address` loops back); $42 = 0 means "start the next animation of the list" (the
 * animation's end callback, CODE_BAC256, clears it). While the Kongs ride an elevator-like
 * move ($06A5 bit $0800 with $0652 = 3) the NPC and both Kongs move 3 pixels a frame, up or
 * down ($06A5 bit 3).
 */
export function kong_npc_sprite_code(): void {
  const db = reg.db; // PHB : PHK : PLB ... PLB
  reg.db = 0xba;
  let x = cur();
  reg.x = x;
  if (rd(x, 0x42) === 0) {
    inc(x, 0x42);
    let y = rd(x, 0x44);
    let anim = seq(y);
    if (anim === 0x0063) {
      // end of the list: jump to the loop address
      y = seq(y + 2);
      wr(x, 0x44, y);
      anim = seq(y);
    }
    y = (y + 2) & 0xffff;
    wr(x, 0x44, y);
    reg.a = anim;
    reg.y = y;
    set_sprite_animation();
  }
  const flags = r16(0x06a5);
  reg.a = flags;
  if (flags & 0x0800) {
    reg.a = 0x0003;
    if (r16(0x0652) === 0x0003) {
      const step = flags & 0x0008 ? 3 : -3;
      const kong = r16(R.active_kong_sprite);
      const ky = (r16(kong + 0x0a) + step) & 0xffff;
      w16(kong + 0x0a, ky);
      w16(r16(R.inactive_kong_sprite) + 0x0a, ky);
      x = cur();
      reg.x = x;
      reg.a = (rd(x, 0x0a) + step) & 0xffff;
      wr(x, 0x0a, reg.a);
    }
  }
  process_sprite_animation();
  reg.db = db;
}

/** $BAC256 — animation callback of the Kong NPCs: `STZ $42,x` (go to the next animation). */
export function CODE_BAC256(): void {
  w16((reg.x + 0x42) & 0xffff, 0);
}

/**
 * A random offset 0..$1D (RNG modulo $1E, the remainder of the hardware divider). The RNG
 * rotates the incoming carry into its seed, so callers set reg.c like the original.
 */
function randomOffset(): number {
  CODE_B4C175();
  reg.y = 0x001e;
  divide_a_by_y();
  return ioR16(CPU.multiply_result);
}

/**
 * $BAB13B — every 8 frames spawn a sparkle near the sprite in $0674 (Klubba's kiosk): x in
 * [-$E, +$F], y in [-$15, +$8] around it. The sparkle keeps the parent's position in $42/$44
 * to follow it.
 */
export function sparkle_spawner_sprite_code(): void {
  const x = cur();
  reg.x = x;
  if (dec(x, 0x42) !== 0) return;
  wr(x, 0x42, 0x0008);
  reg.y = C.special_sprite_spawn_id_0190;
  spawn_no_gfx_special_sprite_index();
  const dx = randomOffset();
  const parent = r16(0x0674);
  reg.x = parent;
  let s = r16(R.alternate_sprite);
  let px = r16(parent + 0x06);
  w16(s + 0x42, px);
  const t = (px + 0x000f) & 0xffff;
  w16(s + 0x06, (t - dx) & 0xffff);
  reg.c = t >= dx; // carry of the SBC, fed into the next RNG call
  const dy = randomOffset();
  s = r16(R.alternate_sprite);
  reg.y = s;
  px = r16(parent + 0x0a);
  w16(s + 0x44, px);
  const u = (px + 0x0008) & 0xffff;
  reg.a = (u - dy) & 0xffff;
  reg.c = u >= dy;
  w16(s + 0x0a, reg.a);
}

/** $BAB18D — a sparkle: move by as much as the parent ($0674) moved since last frame, animate. */
export function sparkle_sprite_code(): void {
  const x = cur();
  reg.x = x;
  const p = r16(0x0674);
  reg.y = p;
  const px = r16(p + 0x06);
  const py = r16(p + 0x0a);
  wr(x, 0x06, px - rd(x, 0x42) + rd(x, 0x06));
  wr(x, 0x0a, py - rd(x, 0x44) + rd(x, 0x0a));
  wr(x, 0x42, px);
  wr(x, 0x44, py);
  reg.a = py;
  process_sprite_animation();
}

registerSprite({ kong_npc_sprite_code, sparkle_spawner_sprite_code, sparkle_sprite_code });
registerRtl({ CODE_BAC256 });
