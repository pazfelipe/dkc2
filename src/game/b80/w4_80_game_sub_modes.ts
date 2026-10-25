/**
 * Bank $80 (package w4_80) — the game sub modes of the level types of worlds 3-7 and the Lost
 * World, and the per-frame level logic they run: the wind of the windy levels
 * (wind_force_handler), the moving floor of Castle Crush, the fireworks of the roller coaster
 * levels, the mist of Web Woods and the light palette of Ghostly Grove.
 *
 * A game sub mode is one gameplay frame: inputs and pause, sprites / camera / level scroll,
 * render the sprites into OAM, fade, then game_sub_mode_return ends the frame (`endFrame()`).
 */
import { r8, r16, w8, w16, rom8, rom16 } from "../../core/mem";
import { reg, register } from "../../core/cpu";
import { frameEnded, setRetMode, RET_RTS } from "../../core/hybrid";
import { adc16, sbc16, flags } from "../../core/ops";
import { L, R, C } from "../../core/sym";
import {
  input_and_pause_handler,
  paused_game_sub_mode,
  sprite_loader,
  sprite_handler,
  camera_handler,
  horizontal_level_scroll_handler,
  vertical_level_scroll_handler,
  square_level_scroll_handler,
  CODE_B5B77D,
  CODE_B5B317,
  CODE_BEC9C0,
  render_sprites,
  set_unused_oam_offscreen,
  fade_screen,
  game_sub_mode_return,
  handle_3d_bg_scroll,
  handle_water_scroll,
  handle_water_and_3D_bg_scroll,
  handle_water_velocities,
  handle_kong_water_splash,
  interpolate_y_velocity_global,
  spawn_special_sprite_index,
  set_alt_sprite_animation,
  get_random_number_2,
} from "../../gen/routines";

const W = 0x7e0000;
const WIND_RIGHT = L("wind_speeds_right");
const WIND_LEFT = L("wind_speeds_left");
const KONG_STATE_FLAGS = L("kong_state_flags_table");
const FIREWORK_X = L("fireworks_spawn_x_positions");
const SINE = L("DATA_B3F4D8");
const LIGHTS_SCROLL_OFFSETS = L("DATA_80F244");
const LIGHTS_PALETTE = L("DATA_80F300");

/** Run each step in order; stop as soon as one of them ended the frame. */
function steps(...fns: Array<() => void>): boolean {
  for (const f of fns) {
    f();
    if (frameEnded) return false;
  }
  return true;
}

/** input_and_pause_handler; false when the frame is over (paused: paused_game_sub_mode). */
function inputsUnpaused(): boolean {
  input_and_pause_handler();
  if (frameEnded) return false;
  if (!reg.z) {
    paused_game_sub_mode();
    return false;
  }
  return true;
}

/** The common tail: render the sprites into OAM, hide the rest, fade, end the frame. */
function finish(...extra: Array<() => void>) {
  if (!steps(render_sprites, ...extra, set_unused_oam_offscreen, fade_screen)) return;
  game_sub_mode_return();
}

/** Camera mode 5 (vertical-only) uses CODE_B5B317, all others the square scroll handler. */
function squareOrVerticalScroll() {
  if ((r16(0x0ab4) & 0x000f) === 0x0005) CODE_B5B317();
  else square_level_scroll_handler();
}

/** Camera mode 6 uses CODE_B5B77D (brambles), all others the square scroll handler. */
function bramblesScroll() {
  if (r16(0x0ab4) === 0x0006) CODE_B5B77D();
  else square_level_scroll_handler();
}

// ---------------------------------------------------------------------------------------------
// Game sub modes

/** $80D61B — 09 Roller Coaster (Rickety Race, Target Terror): fireworks. */
export function roller_coaster_game_sub_mode() {
  if (!inputsUnpaused()) return;
  if (!steps(sprite_loader, sprite_handler, camera_handler, handle_fireworks, horizontal_level_scroll_handler)) return;
  finish();
}

/** $80D665 — 0B: inputs and fade only. */
export function simple_game_sub_mode_0B() {
  if (!steps(input_and_pause_handler, fade_screen)) return;
  game_sub_mode_return();
}

/** $80D784 — 0D Forest (Lights, Ghostly Grove). */
export function forest_lights_game_sub_mode() {
  if (!inputsUnpaused()) return;
  if (!steps(sprite_loader, sprite_handler, camera_handler, horizontal_level_scroll_handler)) return;
  if (!steps(render_sprites, set_unused_oam_offscreen, handle_forest_lights_scroll, fade_screen)) return;
  game_sub_mode_return();
}

/** $80D7AB — 0E Forest (Windy, Gusty Glade): the wind pushes the Kong. */
export function forest_windy_game_sub_mode() {
  if (!inputsUnpaused()) return;
  if (!steps(sprite_loader, wind_force_handler, sprite_handler, camera_handler, horizontal_level_scroll_handler)) return;
  finish();
}

/**
 * $80D7E6 — wind ($19C0 = wind direction, 0 = calm): set the active Kong's horizontal push
 * ($2C) from the wind speed tables, by what the Kong does (bit 0 of $1E = on the ground) and
 * whether it moves with or against the wind ($26 = its x velocity). Leaves DB = $80.
 */
export function wind_force_handler() {
  reg.db = 0x80;
  const wind = r16(0x19c0);
  let table = WIND_RIGHT;
  reg.y = table & 0xffff;
  if (!wind) return;
  if (wind & 0x8000) table = WIND_LEFT;
  reg.y = table & 0xffff;
  const x = r16(R.active_kong_sprite);
  reg.x = x;
  const speed = r16((x + 0x26) & 0xffff);
  let off: number;
  if (!(r16((x + 0x1e) & 0xffff) & 1)) {
    // in the air: jumping with the wind, or any other jump
    off = speed && !((speed ^ wind) & 0x8000) ? 2 : 4;
  } else if (!speed) {
    off = 0; // standing still
  } else {
    off = (wind ^ speed) & 0x8000 ? 8 : 6; // walking against / with the wind
  }
  reg.a = rom16(table + off);
  w16((x + 0x2c) & 0xffff, reg.a);
}

/** $80D830 — 0F Swamp. */
export function swamp_game_sub_mode() {
  if (!inputsUnpaused()) return;
  if (!steps(sprite_loader, sprite_handler, camera_handler, horizontal_level_scroll_handler)) return;
  finish();
}

/** $80D854 — 10 Brambles. */
export function brambles_game_sub_mode() {
  if (!inputsUnpaused()) return;
  if (!steps(sprite_loader, sprite_handler, camera_handler, bramblesScroll)) return;
  finish();
}

/** $80D8DE — 13 Krocodile Kore. */
export function krocodile_kore_game_sub_mode() {
  if (!inputsUnpaused()) return;
  if (!steps(sprite_loader, sprite_handler, camera_handler, CODE_B5B317)) return;
  finish();
}

/**
 * $80D902 — 14 Castle (Crush): Castle Crush's rising floor. While the level is ending (bit 14
 * of game_state_flags) the inactive Kong is kept above the floor.
 */
export function castle_crush_game_sub_mode() {
  handle_3d_bg_scroll();
  if (frameEnded) return;
  if (!inputsUnpaused()) return;
  if (!steps(sprite_loader, handle_castle_crush_floor_movement, camera_handler, sprite_handler)) return;
  if (r16(R.game_state_flags) & 0x4000) {
    const k = r16(R.inactive_kong_sprite);
    reg.x = k;
    const floor = (r16(0x0d54) + 0x00c0) & 0xffff;
    if (floor < r16((k + 0x0a) & 0xffff)) w16((k + 0x0a) & 0xffff, floor);
  }
  if (!steps(CODE_B5B317)) return;
  finish();
}

/**
 * $80D941 — the floor of Castle Crush ($0D54 = floor y, $0D4D = its fraction; $0AFE mirrors
 * the floor). It moves with the water velocity system (target/current velocity, interpolated
 * on the dummy level sprite at $0D26). A current velocity with bit 15 set below $9000 is a
 * countdown instead: the floor shakes up by 1 px per frame for its last frames ($8078-$8097).
 * Kong states with the "floor push" flag ($40) push it by $40 sub-pixels.
 */
export function handle_castle_crush_floor_movement() {
  if (r16(R.time_stop_flags) & 0x0082) return;
  const kong = r16(R.active_kong_sprite);
  reg.y = kong;
  const st = (r16((kong + 0x2e) & 0xffff) << 2) & 0xffff;
  reg.x = st;
  if (rom16((KONG_STATE_FLAGS + st) & 0xffffff) & 0x0040) {
    moveFloor(0x0040);
    return;
  }
  const m = r16(0x0d56);
  w16(0x0d56, m & ~0x0001);
  if (m & 0x0001) {
    countdown(0x8098);
    return;
  }
  const gs = r16(R.game_state_flags);
  if (gs & 0x2000) {
    countdown(0x803c);
    return;
  }
  if (gs & 0x4000) {
    w16(0x0d56, r16(0x0d56) | 0x4000);
  } else if (r16(0x0d56) & 0x4000) {
    w16(0x0d56, r16(0x0d56) & ~0x4000);
    countdown(0x803c);
    return;
  }
  // .CODE_80D980: velocity driven movement
  reg.a = r16(R.water_target_y_velocity) | r16(R.water_current_y_velocity);
  if (!reg.a) return;
  const cur = r16(R.water_current_y_velocity);
  if (cur & 0x8000 && cur < 0x9000) {
    countDown(cur);
    return;
  }
  w16(R.current_sprite, R.dummy_level_sprite_table);
  reg.a = 0x0007;
  interpolate_y_velocity_global();
  moveFloor(r16(R.water_current_y_velocity));
  const d = (r16(0x0d52) - r16(0x0d54)) & 0xffff;
  if (d === 0 || (d ^ r16(R.water_current_y_velocity)) & 0x8000) {
    // .CODE_80D9E8: arrived
    w16(0x0d54, r16(0x0d52));
    w16(0x0afe, r16(0x0d52));
    w16(R.water_target_y_velocity, 0);
    w16(R.water_current_y_velocity, 0);
    w16(0x0d4c, 0);
  }
}

/** Keep a running countdown, or start a new one at `start`. */
function countdown(start: number) {
  const cur = r16(R.water_current_y_velocity);
  countDown(cur & 0x8000 && cur < 0x9000 ? cur : start);
}

/** .CODE_80D9D4 */
function countDown(v: number) {
  v = (v - 1) & 0xffff;
  if (!(v & 0x8000)) {
    w16(R.water_current_y_velocity, 0);
    return;
  }
  w16(R.water_current_y_velocity, v);
  if (v < 0x8078) return;
  moveFloor(0x0100);
}

/** .CODE_80D9FB — 24-bit add of the sign-extended velocity to the floor ($0D55:$0D54.$0D4D). */
function moveFloor(v: number) {
  const lo = r8(0x0d4d) + (v & 0xff);
  w8(0x0d4d, lo & 0xff);
  const hiV = (v >> 8) & 0xff;
  const mid = r8(0x0d54) + hiV + (lo > 0xff ? 1 : 0);
  w8(0x0d54, mid & 0xff);
  const sx = hiV & 0x80 ? 0xff : 0x00;
  w8(0x0d55, (r8(0x0d55) + sx + (mid > 0xff ? 1 : 0)) & 0xff);
  reg.x = sx ? 0xffff : 0;
  w16(0x0afe, r16(0x0d54));
}

/** $80DA21 — 15 Haunted. */
export function haunted_game_sub_mode() {
  if (!inputsUnpaused()) return;
  if (!steps(sprite_loader, sprite_handler, camera_handler, horizontal_level_scroll_handler)) return;
  finish();
}

/** $80DA45 — 16 Ship Mast (Water, Slime Climb): rising water. */
export function ship_mast_water_game_sub_mode() {
  handle_water_scroll_hop();
  if (frameEnded) return;
  if (!inputsUnpaused()) return;
  if (!steps(handle_water_velocities, sprite_loader, sprite_handler, camera_handler, vertical_level_scroll_handler)) return;
  if (!steps(render_sprites, CODE_BEC9C0, set_unused_oam_offscreen, handle_kong_water_splash, fade_screen)) return;
  game_sub_mode_return();
}

/** $80DA76 — 17 K. Rool Duel. */
export function krool_duel_game_sub_mode() {
  if (!inputsUnpaused()) return;
  if (!steps(sprite_loader, sprite_handler, camera_handler, CODE_B5B317)) return;
  finish();
}

/** $80DAC8 — shared pause exit of the ice sub modes. */
export function ice_game_sub_mode_paused() {
  paused_game_sub_mode();
}

/** $80DACB — 19 Ice (Water): no splashes while the water is frozen (RAM_0915). */
export function ice_water_game_sub_mode() {
  handle_water_scroll_hop();
  if (frameEnded) return;
  if (!inputsUnpaused()) return;
  if (!steps(handle_water_velocities, sprite_loader, sprite_handler, camera_handler, squareOrVerticalScroll)) return;
  if (!steps(render_sprites, CODE_BEC9C0, set_unused_oam_offscreen)) return;
  if (!r16(0x0915)) {
    handle_kong_water_splash();
    if (frameEnded) return;
  }
  if (!steps(fade_screen)) return;
  game_sub_mode_return();
}

/** $80DB12 — 1A Jungle. */
export function jungle_game_sub_mode() {
  if (!inputsUnpaused()) return;
  if (!steps(sprite_loader, sprite_handler, camera_handler, horizontal_level_scroll_handler)) return;
  finish();
}

/** $80DB36 — 1B Ice (Transparent). */
export function ice_transparent_game_sub_mode() {
  if (!inputsUnpaused()) return;
  if (!steps(sprite_loader, sprite_handler, camera_handler, squareOrVerticalScroll)) return;
  finish();
}

/** $80DB6B — 1C Castle (Toxic, Toxic Tower): rising toxic water. */
export function castle_toxic_game_sub_mode() {
  handle_water_and_3D_bg_scroll();
  if (frameEnded) return;
  if (!inputsUnpaused()) return;
  if (!steps(handle_water_velocities, sprite_loader, sprite_handler, camera_handler, CODE_B5B317)) return;
  finish(CODE_BEC9C0);
}

/** $80DB99 — 1D Brambles (Windy). */
export function brambles_windy_game_sub_mode() {
  if (!inputsUnpaused()) return;
  if (!steps(sprite_loader, wind_force_handler, sprite_handler, camera_handler, bramblesScroll)) return;
  finish();
}

/** $80DBCE — 1E Mine (Windy, Windy Well). */
export function mine_windy_game_sub_mode() {
  if (!inputsUnpaused()) return;
  if (!steps(sprite_loader, sprite_handler, camera_handler, vertical_level_scroll_handler)) return;
  finish();
}

/** $80DD3C — 1F Forest (Misty, Web Woods). */
export function forest_misty_game_sub_mode() {
  if (!inputsUnpaused()) return;
  if (!steps(sprite_loader, sprite_handler, camera_handler, handle_forest_mist_scroll, horizontal_level_scroll_handler)) return;
  finish();
}

// ---------------------------------------------------------------------------------------------
// Web Woods mist

/** CMP #$8000 : ROR A, n times (arithmetic shift right). */
function asr(v: number, n: number): number {
  for (let i = 0; i < n; i++) v = ((v >> 1) | (v & 0x8000)) & 0xffff;
  return v;
}

/**
 * $80DBF2 — the two mist layers of Web Woods: wavy HDMA scroll tables, double buffered by
 * frame parity (near mist $7E80D2 / $7E8812, far mist $7E8552 / $7E8592) and the line counts
 * of the first band. Leaves DB = $80.
 */
export function handle_forest_mist_scroll() {
  const t = afcNow();
  const m = ((((scrollYNow() + t) & 0xffff) >> 2) + scrollYNow()) & 0xffff;
  w16(0x32, m);
  let p = ((t >> 1) - m) & 0xffff;
  w16(0x54, p);
  const n = ((p & 0x0003) + 1) & 0xff;
  w8(W + 0x8012, n);
  w8(W + 0x85d2, n);
  let x = (p >> 1) & 0x001e;
  p = (scrollXNow() + t) & 0xffff;
  w16(0x54, p);
  // near mist: 16 bands (sine / 64)
  const near = t & 1 ? 0x8812 : 0x80d2;
  for (let y = 0; y !== 0x0200; y += 0x20) {
    w16(W + near + x, (asr(rom16(SINE + y), 6) + p) & 0xffff);
    x = (x + 2) & 0x001e;
  }
  // far mist: 32 bands (sine / 128)
  const q = t >> 2;
  w16(0x54, q);
  x = (((((q >> 1) + q + m) & 0xffff) ^ 0xffff) << 1) & 0x003e;
  const far = t & 1 ? 0x8592 : 0x8552;
  for (let y = 0; y !== 0x0200; y += 0x10) {
    w16(W + far + x, (asr(rom16(SINE + y), 7) + m) & 0xffff);
    x = (x + 2) & 0x003e;
  }
  reg.x = x;
  reg.y = 0x0200;
  reg.db = 0x80;
}
const afcNow = () => r16(R.active_frame_counter);
const scrollXNow = () => r16(R.screen_scroll_x_position);
const scrollYNow = () => r16(R.screen_scroll_y_position);

/** $80DD28 — X = (X + 2) & $1E (A preserved). */
export function CODE_80DD28() {
  reg.x = (reg.x + 2) & 0x001e;
}
/** $80DD32 — X = (X + 2) & $3E (A preserved). */
export function CODE_80DD32() {
  reg.x = (reg.x + 2) & 0x003e;
}

// ---------------------------------------------------------------------------------------------
// Fireworks (roller coaster levels)

/**
 * $80E472 — fireworks over the roller coaster: $19BE = time until the next volley, $19C0 =
 * fireworks left in the volley; one firework every 16 frames while fewer than $092D are on
 * screen ($092E). Each firework (special sprite $5E) rises from the next spawn x position and
 * explodes at a random height; RAM_0929 = its palette slot for the NMI palette cycling.
 */
export function handle_fireworks() {
  const timer = r16(0x19be);
  if (timer) {
    w16(0x19be, (timer - 1) & 0xffff);
    return;
  }
  if (r16(0x0923) & 0x8000) return;
  if (afcNow() & 0x000f) return;
  if (r8(0x092e) >= r8(0x092d)) return;
  const left = (r16(0x19c0) - 1) & 0xffff;
  w16(0x19c0, left);
  if (left & 0x8000) {
    // volley over: wait 180-307 frames, then 2-5 fireworks
    get_random_number_2();
    w16(0x19be, ((reg.a & 0x007f) + 0x00b4) & 0xffff);
    get_random_number_2();
    w16(0x19c0, ((reg.a & 0x0003) + 2) & 0xffff);
  }
  reg.y = C.special_sprite_spawn_id_005E;
  spawn_special_sprite_index();
  if (reg.c) return;
  w16(0x092e, (r16(0x092e) + 1) & 0xffff);
  reg.db = 0x80;
  const x = r16(R.alternate_sprite);
  reg.x = x;
  const slot = r16(0x092b);
  w16((x + 0x42) & 0xffff, slot);
  w16(0x092b, (slot + 1) & 0x000f);
  w16((x + 0x06) & 0xffff, rom8(FIREWORK_X + slot));
  get_random_number_2();
  const h = ((reg.a & 0x003f) + 0x0050) & 0xffff;
  w16((x + 0x44) & 0xffff, h);
  w16((x + 0x0a) & 0xffff, (h + 0x0020) & 0xffff);
  w16((x + 0x24) & 0xffff, 0xff00);
  const pal = (r16((x + 0x12) & 0xffff) & 0x0e00) >> 8;
  w16(0x0929, ((pal << 3) + 0x0080) & 0xffff);
  reg.x = x;
  get_random_number_2();
  reg.a = reg.a & 1 ? C.firework_2_anim_id : C.firework_1_anim_id;
  set_alt_sprite_animation();
}

/** $80E63D — the water surface tables of the mast / ice water levels (DB = $7E), DB = $80 after. */
export function handle_water_scroll_hop() {
  reg.db = 0x7e;
  handle_water_scroll();
  reg.db = 0x80;
}

// ---------------------------------------------------------------------------------------------
// Ghostly Grove lights

/**
 * $80F157 — Ghostly Grove: three light palettes fade with the horizontal distance to the
 * screen's light sources (CODE_80F264), and the HDMA table of the light ray layer
 * ($7E8012 / $7E81A2 by frame parity) slants with the camera.
 */
export function handle_forest_lights_scroll() {
  reg.y = 0x0002; reg.x = 0x000a; reg.a = 0x0000; CODE_80F264();
  reg.y = 0x000c; reg.x = 0x0000; reg.a = 0x0002; CODE_80F264();
  reg.y = 0x0016; reg.x = 0x0014; reg.a = 0x0004; CODE_80F264();
  const p = scrollXNow() & 0x00ff;
  w16(0x54, p);
  const s = (p << 8) >> 1;
  w16(0x32, s);
  const start = adc16((((s >> 3) + s) & 0xffff) >> 8 | ((((s >> 3) + s) & 0xff) << 8), 0x01c0, false);
  w16(0x56, start);
  // the slope per line, 2 lines per entry
  w16(0x32, p);
  w16(0x34, p >> 2);
  let a = adc16((p >> 4), p, false);
  a = adc16(a, p >> 2, flags.c);
  a >>= 1;
  a = sbc16(a, 0x0060, true) & 0xfffe;
  let c = flags.c;
  const base = afcNow() & 1 ? 0x81a2 : 0x8012;
  let v = ((start >> 8) | ((start & 0xff) << 8)) & 0xffff;
  if (a & 0x8000) {
    const slope = ((a ^ 0xffff) + 1) & 0xffff;
    w16(0x34, slope);
    for (let x = 0; x !== 0x0190; x += 2) {
      w16(W + base + x, v);
      v = sbc16(v, slope, c);
      v = sbc16(v, 0xffff, flags.c);
      c = flags.c;
    }
  } else {
    w16(0x34, a);
    for (let x = 0; x !== 0x0190; x += 2) {
      w16(W + base + x, v);
      v = adc16(v, a, false);
      v = adc16(v, 0, flags.c);
    }
  }
  reg.a = v;
  reg.x = 0x0190;
}

/**
 * $80F264 — A = palette offset index, X = colour index in the palette buffer, Y = source
 * colour index: fade 5 colours of DATA_80F300 by the distance between the camera and the
 * light of the current screen (DATA_80F244), into the palette buffer.
 */
export function CODE_80F264() {
  w16(0x38, reg.x);
  w16(0x34, reg.a);
  const i = ((((r16(R.screen_scroll_x_screen) & 0x0003) << 3) + r16(0x34)) & 0xffff);
  let a = ((scrollXNow() & 0x00ff) + rom16(LIGHTS_SCROLL_OFFSETS + i)) & 0xffff;
  if (a & 0x8000) a ^= 0xffff;
  a = ((a >> 1) - 0x0010) & 0xffff;
  if (a & 0x8000) a = 0;
  if (a >= 0x0019) a = 0x0019;
  a += 2;
  w16(0x32, a);
  const t = (a << 2) & 0xffff;
  w16(0x36, ((t >> 8) | ((t & 0xff) << 8)) & 0xffff);
  w16(0x34, (t << 3) & 0xffff);
  let x = r16(0x38);
  let y = reg.y;
  for (let k = 0; k < 5; k++) {
    const col = rom16(LIGHTS_PALETTE + y);
    w16(0x38, clamp0((col & 0x001f) - r16(0x32)));
    w16(0x38, r16(0x38) | clamp0((col & 0x03e0) - r16(0x34)));
    const out = clamp0((col & 0x7c00) - r16(0x36)) | r16(0x38);
    w16((R.primary_palette + x) & 0xffffff, out);
    y = (y + 2) & 0xffff;
    x = (x + 2) & 0xffff;
  }
  reg.x = x;
  reg.y = y;
}
const clamp0 = (v: number) => (v & 0x8000 ? 0 : v & 0xffff);

for (const t of [
  "wind_force_handler",
  "handle_castle_crush_floor_movement",
  "handle_forest_mist_scroll",
  "CODE_80DD28",
  "CODE_80DD32",
  "handle_fireworks",
  "handle_water_scroll_hop",
  "handle_forest_lights_scroll",
  "CODE_80F264",
])
  setRetMode(L(t), RET_RTS);

register({
  roller_coaster_game_sub_mode,
  simple_game_sub_mode_0B,
  forest_lights_game_sub_mode,
  forest_windy_game_sub_mode,
  wind_force_handler,
  swamp_game_sub_mode,
  brambles_game_sub_mode,
  krocodile_kore_game_sub_mode,
  castle_crush_game_sub_mode,
  handle_castle_crush_floor_movement,
  haunted_game_sub_mode,
  ship_mast_water_game_sub_mode,
  krool_duel_game_sub_mode,
  ice_game_sub_mode_paused,
  ice_water_game_sub_mode,
  jungle_game_sub_mode,
  ice_transparent_game_sub_mode,
  castle_toxic_game_sub_mode,
  brambles_windy_game_sub_mode,
  mine_windy_game_sub_mode,
  forest_misty_game_sub_mode,
  handle_forest_mist_scroll,
  CODE_80DD28,
  CODE_80DD32,
  handle_fireworks,
  handle_water_scroll_hop,
  handle_forest_lights_scroll,
  CODE_80F264,
});
