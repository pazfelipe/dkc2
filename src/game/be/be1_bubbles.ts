/**
 * Bank $BE — rising bubbles/embers of water and lava levels ($BEC9C0-$BECB9F).
 *
 * Up to 8 particles live in $7F9600 (16 bytes per field, 2 per particle):
 *   $7F9600 OAM tile/attributes (0 = free), $7F9610 x and $7F9620 y (world, 14.2 fixed point),
 *   $7F9630 wobble (low byte = frames left in this phase, high byte = phase index into
 *   DATA_BECA9F/DATA_BECAA0), $7F9640 rising speed.
 * New ones appear every 4 frames at a random x below the screen; they rise until they reach
 * the water/lava surface or leave the screen. Called by the water/lava game sub modes.
 */
import { r8, r16, w8, w16, rom8 } from "../../core/mem";
import { reg, register } from "../../core/cpu";
import { setRetMode, RET_RTS } from "../../core/hybrid";
import { L, R, level } from "../../core/sym";
import { get_random_number_2_global } from "../../gen/routines";
import { BANK_BE } from "./be1_util";
import { CODE_BEC995 } from "./be1_hud";

const TILE = 0x7f9600;
const XPOS = 0x7f9610;
const YPOS = 0x7f9620;
const WOBBLE = 0x7f9630;
const SPEED = 0x7f9640;
const WOBBLE_DX = L("DATA_BECA9F"); // x step of each phase (signed byte)
const WOBBLE_NEXT = L("DATA_BECAA0"); // length of the phase after each phase (0 = restart)
const OAM_END = 0x0400;

/** Sign-extend a byte. */
const sx8 = (v: number) => (v & 0x80 ? v | 0xff00 : v & 0x00ff);

/** $BEC9C0 — update and draw the particles (updates paused in sub mode $19 with $0915 set). */
export function CODE_BEC9C0(): void {
  if (!r16(0x0915) || r16(level.game_sub_mode) !== 0x0019) CODE_BEC9D4();
  CODE_BECB48();
}

/** $BEC9D4 — maybe spawn one, then move all of them. */
export function CODE_BEC9D4(): void {
  reg.db = BANK_BE;
  CODE_BECAB7();
  for (let x = 0; x < 0x10; x += 2) {
    reg.x = x;
    CODE_BEC9E7();
  }
  reg.x = 0x10;
}

/** $BEC9E7 — X = particle: rise and wobble; freed at the surface or off screen. */
export function CODE_BEC9E7(): void {
  const x = reg.x;
  if (!r16(TILE + x)) return;
  const y4 = (r16(YPOS + x) - r16(SPEED + x)) & 0xffff;
  w16(YPOS + x, y4);
  const y = y4 >> 2;
  if (y < r16(R.water_y_position)) return free(x);
  const sy = (y - r16(R.screen_scroll_y_position) + 0x0010) & 0xffff;
  if (sy >= 0x0100) return free(x);
  // CODE_BECA16
  const wx = r16(XPOS + x) >> 2;
  const scroll = r16(R.screen_scroll_x_position);
  let sx = (wx - scroll) & 0xffff;
  if (wx < scroll) {
    if (sx + 0x20 <= 0xffff) return free(x); // more than 32 px left of the screen
    sx = (sx + 0x20) & 0xffff;
  }
  if (sx >= 0x0120) return free(x);
  const wobble = r16(WOBBLE + x);
  if (wobble & 0x8000) {
    // drifting: the low byte is a signed step that decays to 0
    const d = sx8(wobble);
    if (d !== 0) {
      w16(XPOS + x, (r16(XPOS + x) + d) & 0xffff);
      w16(WOBBLE + x, (wobble + (d & 0x8000 ? 1 : -1)) & 0xffff);
      return;
    }
    w16(WOBBLE + x, 0);
  }
  // CODE_BECA5D
  const w = r16(WOBBLE + x);
  if (!w) {
    // start wobbling on a y multiple of 8
    if (sy & 0x0007) return;
    w16(WOBBLE + x, 0x0100);
    return;
  }
  // CODE_BECA71 (8-bit): count the phase down; when it ends, go to the next phase
  let count = (w - 1) & 0xff;
  let phase = w >> 8;
  if (count & 0x80) {
    const next = (phase + 2) & 0xff;
    const len = rom8(WOBBLE_NEXT + next);
    phase = len ? next : 0;
    w8(WOBBLE + x + 1, phase);
    count = len;
  }
  w8(WOBBLE + x, count);
  w16(XPOS + x, (sx8(rom8(WOBBLE_DX + phase)) + r16(XPOS + x)) & 0xffff);
}

/** CODE_BECA0E */
function free(x: number) {
  w16(TILE + x, 0);
}

/** $BECAAA — sign-extend the low byte of A. */
export function CODE_BECAAA(): void {
  reg.a = sx8(reg.a);
}

/** $BECAB7 — every 4 frames, a new particle at a random x just below the screen. */
export function CODE_BECAB7(): void {
  if (r16(R.active_frame_counter) & 0x0003) return;
  let x = 0;
  const water = r16(R.water_y_position);
  const scrollY = r16(R.screen_scroll_y_position);
  if (water >= scrollY) {
    const d = water - scrollY;
    if (d >= 0x0100) return; // surface below the screen: no room
    // the higher the surface is on screen, the fewer slots are used
    x = (((d << 3) >> 8) & 0x0007) << 1;
  }
  reg.x = x;
  CODE_BECB3A();
  if (!reg.z) return;
  x = reg.x;
  get_random_number_2_global();
  const rnd = reg.a & 0xffff;
  const r = rnd & 0x01ff;
  w16(0x32, r);
  w16(XPOS + x, (((((3 * r) >> 2) - 0x20 + r16(R.screen_scroll_x_position)) << 2) & 0xffff));
  w16(YPOS + x, ((0x00f0 + scrollY) << 2) & 0xffff);
  let kind = (rnd >> 8) & 0x0007;
  if (kind >= 6) kind = (r16(R.active_frame_counter) & 0x000c) >> 2;
  reg.a = kind;
  reg.x = x;
  reg.y = 0;
  CODE_BECB1F();
}

/** $BECB1F — X = slot, A = kind (0-5), Y = wobble: set up a new particle. */
export function CODE_BECB1F(): void {
  const x = reg.x;
  const kind = reg.a;
  w16(TILE + x, ((kind + r16(0x0921)) & 0xffff) | 0x3000);
  w16(SPEED + x, (kind + 6) & 0xffff);
  w16(WOBBLE + x, reg.y);
  reg.a = reg.y;
}

/**
 * $BECB3A — from slot X, find a free slot: Z set when found. (Slot $0E counts as free even
 * when used, because the loop's final compare also sets Z.)
 */
export function CODE_BECB3A(): void {
  let x = reg.x;
  for (;;) {
    if (!r16(TILE + x)) {
      reg.x = x;
      reg.z = true;
      return;
    }
    x = (x + 2) & 0xffff;
    if (x >= 0x000e) break;
  }
  reg.x = x;
  reg.z = x === 0x000e;
}

/** $BECB48 — draw the particles into the OAM buffer. */
export function CODE_BECB48(): void {
  reg.db = BANK_BE;
  let y = r16(R.next_oam_slot);
  for (let x = 0; y < OAM_END && x < 0x10; x += 2) {
    if (!r16(TILE + x)) continue;
    w16(y + 1, ((r16(YPOS + x) >> 2) - r16(R.screen_scroll_y_position)) & 0xffff);
    w16(y + 2, r16(TILE + x));
    const sx = ((r16(XPOS + x) >> 2) - r16(R.screen_scroll_x_position)) & 0xffff;
    w8(y, sx & 0xff);
    if (sx & 0xff00) {
      reg.y = y;
      CODE_BEC995(); // x beyond 255 (or negative): set the 9th x bit
    }
    y = (y + 4) & 0xffff;
  }
  w16(R.next_oam_slot, y);
  reg.y = y;
}

register({
  CODE_BEC9C0,
  CODE_BEC9D4,
  CODE_BEC9E7,
  CODE_BECAAA,
  CODE_BECAB7,
  CODE_BECB1F,
  CODE_BECB3A,
  CODE_BECB48,
});
for (const n of ["CODE_BEC9D4", "CODE_BEC9E7", "CODE_BECAAA", "CODE_BECAB7", "CODE_BECB1F", "CODE_BECB3A", "CODE_BECB48"]) setRetMode(L(n), RET_RTS);
void r8;
