/**
 * Bank $B5 — world map pieces at the start of the b5c range ($B5DD45-$B5E0E0):
 * the end of the Crocodile Isle K. Rool cutscene animation (routine CODE_B5DCBB, which starts
 * before this range), the Crocodile Isle sky/sea colour and scroll effects, and the shared
 * world-map graphics setup that reads its parameters from the bytes following the JSR.
 */
import { r8, w8, r16, w16, rom8, rom16, io8 } from "../../core/mem";
import { reg, register } from "../../core/cpu";
import { setRetMode, RET_RTS } from "../../core/hybrid";
import { L, R, C, PPU, sprite } from "../../core/sym";
import {
  set_fade_global,
  apply_position_from_velocity_global,
  dma_palette,
  clear_vram_global,
  vram_payload_handler_global,
  set_ppu_registers_global,
  CODE_B5DCFF,
} from "../../gen/routines";
import { queue_sound_effect, play_high_priority_sound } from "./b5c_common";

const ISLE_PALETTE = L("crocodile_isle_map_palette");

const KROOL = 0x1364; // K. Rool on the map
const ISLE = 0x13c2; // the island (rising/sinking)
const sound = (channel: number, id: number) => (channel << 8) | id;

/** `LSR A; ROR $32` x5: returns [A >> 5, the 5 low bits moved to the top of $32]. */
function shr5(a: number): [number, number] {
  const lo = ((a & 0x1f) << 11) & 0xffff;
  return [(a & 0xffff) >> 5, lo];
}

/**
 * $B5DD45 — middle of the K. Rool cutscene (CODE_B5DCBB): fade out at frame $1A0, bob the
 * three Kremling boats, move them, then animate K. Rool falling/swimming and the island.
 */
export function CODE_B5DD45() {
  const frame = r16(R.active_frame_counter);
  if (frame === 0x01a0) {
    reg.a = 0x810f;
    set_fade_global();
  }
  // $B5DD53: three boats
  let x = 0x147e;
  for (let y = 3; y !== 0; y--) {
    if (((r16(x + 6) - 0x70) & 0xffff) < 0x38) {
      w16(x + 0x24, 0);
      let vx = r16(x + 0x20);
      if (vx !== 0) {
        // slow down
        vx = vx & 0x8000 ? vx + 0x20 : vx - 0x20;
        w16(x + 0x20, vx);
      } else {
        // $B5DD7D: drift -1/0/+1 every other frame
        let a = ((y << 1) + r16(R.active_frame_counter)) & 0xffff;
        if (!(a & 1)) {
          a = (a >> 1) & 3;
          if (a === 3) a = 1;
          w16(x + 6, a - 1 + r16(x + 6));
        }
      }
    }
    x += 0x5e;
  }
  for (const s of [0x147e, 0x14dc, 0x153a]) {
    w16(R.current_sprite, s);
    reg.x = s;
    apply_position_from_velocity_global();
  }
  if (r16(ISLE + 0x44) === 0) {
    // JMP CODE_B5DCFF (back to the start of this sequence)
    CODE_B5DCFF();
    return;
  }
  // $B5DDC7: K. Rool
  x = KROOL;
  let a = r16(R.active_frame_counter) & 0x001c;
  if (a & 0x0010) a ^= 0x001c;
  w16(x + sprite.current_graphic, a + C.isle_krool_fall_frame1);
  const step = r16(R.world_map_event_step_counter);
  if (step === 0) {
    // $B5DE70: falling
    if (r16(x + sprite.y_position) >= 0x00c0) {
      reg.a = sound(5, C.sound_krool_down);
      play_high_priority_sound();
      w16(R.world_map_event_step_counter, r16(R.world_map_event_step_counter) + 1);
      w16(x + 0x24, 0xff00);
      w16(x + 0x20, 0xff00);
    }
    fallStep(x);
  } else if (step === 1) {
    // $B5DE51
    if (r16(x + sprite.y_position) >= 0x0140) {
      reg.a = sound(5, C.sound_krool_down);
      play_high_priority_sound();
      w16(R.world_map_event_step_counter, r16(R.world_map_event_step_counter) + 1);
      w16(x + 0x24, 0xff00);
      w16(x + 0x20, 0x0100);
    }
    fallStep(x);
  } else if (step === 2) {
    // $B5DE28: hits the water
    if (r16(x + sprite.y_position) < 0x01d0) {
      fallStep(x);
    } else {
      reg.a = sound(5, C.sound_krool_splash_1);
      queue_sound_effect();
      reg.a = sound(6, C.sound_krool_splash_2);
      queue_sound_effect();
      w16(R.world_map_event_step_counter, r16(R.world_map_event_step_counter) + 1);
      w16(x + 0x24, 0);
      w16(x + 0x20, 0);
      w16(0x15b2, 0x34ac);
    }
  } else if (step === 3) {
    // $B5DDF7: splash animation, then swimming
    if (!(r16(R.active_frame_counter) & 0x0003) && r16(0x15b2) !== 0) {
      let g = (r16(0x15b2) + 4) & 0xffff;
      if (g === C.isle_krool_splash_frame8 + 4) g = 0;
      w16(0x15b2, g);
    }
    a = (r16(R.active_frame_counter) << 1) & 0x001c;
    if (a & 0x0010) a ^= 0x001c;
    w16(x + sprite.current_graphic, a + C.isle_krool_swim_frame1);
  }
  CODE_B5DE9D();
}

/** $B5DE8D — gravity and movement for K. Rool. */
function fallStep(x: number) {
  w16(R.current_sprite, x);
  w16(x + 0x24, r16(x + 0x24) + 0x1c);
  reg.x = x;
  apply_position_from_velocity_global();
}

/** $B5DE9D — the island rises (wobbling) until in place; its shadow/graphic follow. */
export function CODE_B5DE9D() {
  const x = ISLE;
  let a: number;
  if (r16(x + 0x44) !== 0) {
    a = (r16(R.active_frame_counter) >> 5) & 0x0003;
    if (a === 3) a = 1;
    a += 0x91;
  } else {
    // $B5DEBC: ease towards Y = $90
    a = (r16(x + 6) - 0x90) & 0xffff;
    if (a < 3) {
      a = 1;
      w16(x + 0x44, a);
    }
    if (a >= 0x40) a = 0x40;
    w16(0x0032, 0);
    const [hi, lo] = shr5(a);
    w16(0x0032, lo);
    w16(0x0034, hi);
    const s = r16(x + 4) - lo;
    w16(x + 4, s);
    a = (r16(x + 6) - hi - (s < 0 ? 1 : 0)) & 0xffff;
  }
  // $B5DEF2
  w16(x + 6, a);
  a = (a - 6) & 0xffff;
  w16(x + 0x64, a);
  if (a < 0x00b0) {
    const g = r16(x + 0x78);
    if (g === 0) {
      w16(x + 0xa0, 0);
      w16(x + 0x78, 0x312c);
    } else if (g !== 0x3140) {
      w16(x + 0xa0, r16(x + 0xa0) + 1);
      if (r16(x + 0xa0) === 0x0005) {
        w16(x + 0xa0, 0);
        w16(x + 0x78, r16(x + 0x78) + 4);
      }
    }
  }
  // $B5DF22: ease X towards $2D
  a = (0x002d - r16(x + 0x0a)) & 0xffff;
  w16(0x0032, 0);
  const [hi, lo] = shr5(a);
  w16(0x0032, lo);
  w16(0x0034, hi);
  const s = r16(x + 8) + lo;
  w16(x + 8, s);
  a = (r16(x + 0x0a) + hi + (s > 0xffff ? 1 : 0)) & 0xffff;
  w16(x + 0x0a, a);
  w16(x + 0x68, a + 0x12);
}

/** $B5DF4F — Crocodile Isle map: palette cycling, lightning flashes, sky colours and HDMA tables. */
export function CODE_B5DF4F() {
  const f = r16(R.active_frame_counter);
  w16(0x7e8136, f >> 2);
  w16(0x7e8139, 0);
  reg.a = ((ISLE_PALETTE & 0xffff) + (r16(R.screen_scroll_y_position) < 0x0080 ? 0x01a0 : 0x0140)) & 0xffff;
  reg.x = 0x0004;
  reg.y = 0x00a0;
  dma_palette();
  // lightning: colour $4C flashes white on some frames
  let flash = 0;
  if (f & 0x0080) {
    if (f & 0x004a) flash = 0x0380;
  } else if (!(f & 0x0052)) flash = 0x0380;
  io8(PPU.cgram_address, 0x4c);
  io8(PPU.cgram_write, flash & 0xff);
  io8(PPU.cgram_write, flash >> 8);
  // three cycling colours
  for (const off of [0, 0x15, 0x2b]) {
    reg.a = (r16(R.active_frame_counter) + off) & 0xffff;
    CODE_B5E054();
  }
  io8(PPU.cgram_address, 0x31);
  for (let i = 0; i < 0x10; i++) io8(PPU.cgram_write, rom8(ISLE_PALETTE + 0x62 + i));
  const sy = r8(R.screen_scroll_y_position);
  io8(PPU.layer_1_scroll_y, sy);
  io8(PPU.layer_1_scroll_y, 0);
  io8(PPU.layer_3_scroll_y, sy);
  io8(PPU.layer_3_scroll_y, 0);
  w8(0x7e804e, (((r8(R.active_frame_counter) >> 2) & 0x07) + 0x40) & 0xff);
  w16(0x7e8016, 0x1413);
  let a = ((r16(R.screen_scroll_y_position) ^ 0x00ff) + 0x0019) & 0xffff;
  w16(0x0032, a);
  if (a >= 0x007f) {
    if (a >= 0x00c0) w16(0x7e8016, 0x0413);
    w16(0x7e8139, r16(0x7e8136));
    a = 0x007f;
  }
  // $B5E01F
  w8(0x7e8012, a & 0xff);
  w8(0x7e801c, (a & 0xff) === 0x7f ? 0 : a & 0xff);
  w16(0x0032, r16(0x0032) - 0x18);
  a = (((r16(R.active_frame_counter) >> 2) & 0x0007) + r16(0x0032)) & 0xffff;
  if (a >= 0x007f) a = 0x007f;
  w8(0x7e804e, a & 0xff);
}

/** $B5E054 — A = phase: write one BGR555 colour whose components follow three phases. */
export function CODE_B5E054() {
  w16(0x0032, reg.a);
  reg.a = r16(0x0032);
  CODE_B5E085();
  w16(0x0034, reg.a);
  reg.a = (r16(0x0032) + 0x15) & 0xffff;
  CODE_B5E085();
  w16(0x0034, r16(0x0034) | ((reg.a << 5) & 0xffff));
  reg.a = (r16(0x0032) + 0x2b) & 0xffff;
  CODE_B5E085();
  let v = (reg.a << 2) & 0xffff;
  v = ((v >> 8) | (v << 8)) & 0xffff;
  v |= r16(0x0034);
  io8(PPU.cgram_write, v & 0xff);
  io8(PPU.cgram_write, v >> 8);
  reg.a = ((v >> 8) | (v << 8)) & 0xffff;
}

/** $B5E085 — A = phase: triangle wave 0..$1F (0 for the first $10 steps of every $40). */
export function CODE_B5E085() {
  let a = (reg.a & 0x003f) - 0x10;
  if (a < 0) {
    reg.a = 0;
    return;
  }
  w16(0x0036, a);
  a = (a >> 1) + r16(0x0036);
  if (a & 0x0020) a ^= 0x003f;
  reg.a = a;
}

/**
 * $B5E0A1 — world map graphics setup. The original is called as `JSR CODE_B5E0A1` followed by
 * 6 bytes of parameters (VRAM payload id, PPU config id, palette address, NMI and game sub-modes);
 * it pops its return address to read them and then returns to its caller's caller. That cannot
 * be expressed as a trap entry (the data address lives on the 65816 stack), so this is not
 * registered: a ported caller passes the address of the parameter bytes (in bank $B5).
 */
export function CODE_B5E0A1(data: number) {
  let x = data & 0xffff;
  const at = (o: number) => 0xb50000 | ((x + o) & 0xffff);
  reg.db = 0xb5;
  clear_vram_global();
  reg.a = rom8(at(0));
  vram_payload_handler_global();
  x++;
  reg.a = rom8(at(0));
  set_ppu_registers_global();
  x++;
  reg.a = rom16(at(0));
  reg.y = 0x0000;
  reg.x = 0x0040;
  dma_palette();
  x += 2;
  const modes = rom16(at(0));
  w8(R.nmi_sub_mode, modes & 0xff);
  w8(R.game_sub_mode, modes >> 8);
  reg.db = 0xb5; // PHK/PLB without restore
  reg.x = x;
}

register({ CODE_B5DD45, CODE_B5DE9D, CODE_B5DF4F, CODE_B5E054, CODE_B5E085 });
// these return with RTS (CODE_B5DD45 is the second half of CODE_B5DCBB, entered by falling through)
setRetMode(L("CODE_B5DD45"), RET_RTS);
