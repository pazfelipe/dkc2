/**
 * Bank $B9 — animation callbacks of enemies, bosses and objects ($B9E511-$B9EE4A).
 *
 * Called from enemy animation scripts: commands 81 (one-shot), 84 (per-frame routine, also
 * installed directly into `sprite.animation_routine`), 8F (carry = take the jump) and
 * 83 (wait: continue with `process_anim_script` or hold with `CODE_B9D12B`, DB = $F9).
 * The `turn_*_if_needed` routines start the enemy's turn animation (id in Y) when its target
 * speed points the other way.
 */
import { r8, w8, r16, w16, rom16, io8, io16, ioR16 } from "../../core/mem";
import { reg, register } from "../../core/cpu";
import { L, R, sprite, CPU, C } from "../../core/sym";
import { adc16, sbc16, flags } from "../../core/ops";
import {
  delete_sprite_handle_deallocation,
  get_current_sprite_clipping,
  CODE_BEBD8E,
  queue_sfx_if_on_screen_global,
  spawn_special_sprite_index,
  spawn_no_gfx_special_sprite_index,
  spawn_special_sprite_address,
  check_if_sprite_offscreen_global,
  set_player_interaction_global,
} from "../../gen/routines";
import { set_sprite_animation, set_anim_handle_animal, process_anim_script, CODE_B9D12B } from "./b9_anim_core";
import { CODE_B9E019 } from "./b9_kong_anim_callbacks";
import { abs16, negate, isNeg, facesLeft, spriteConstant, dbRead16, dbWrite16, pushDb, popDb, queue_sound_effect } from "./b9_anim_util";

const sound = (channel: number, id: number) => ((channel << 8) | id) & 0xffff;
const anim = (label: string) => L("animation_" + label) & 0xffff;

const KONG_STATE_FLAGS_TABLE = L("kong_state_flags_table");
const KROCKHEAD_BOUNCE_SCRIPTS = L("DATA_B9EBD7");
const SNAPJAW_CREDITS_SCRIPT = anim("DATA_F956E6");
const KLAMPON_SCRIPT_A = anim("DATA_F95798");
const KLAMPON_SCRIPT_B = anim("DATA_F957AA");
const SCRIPT_F9596D = anim("DATA_F9596D");
const KROOK_NO_HOOK_SCRIPT = anim("DATA_F95EF2");
const SCRIPT_F96266 = anim("DATA_F96266");
const SCRIPT_F962EC = anim("DATA_F962EC");
const SCRIPT_F96320 = anim("DATA_F96320");
const KLANK_SCRIPT_A = anim("DATA_F9654C");
const KLANK_SCRIPT_B = anim("DATA_F96504");
const TIRE_SCRIPT_SPLIT = anim("DATA_F96600");
const TIRE_SCRIPT_BACK = anim("DATA_F96609");
const TIRE_SCRIPT_FWD = anim("DATA_F965F4");

function setAnim(id: number) {
  reg.a = id;
  set_sprite_animation();
}
function towardsFacing(x: number, v: number): number {
  return facesLeft(r16(x + sprite.oam_property)) ? negate(v) : v & 0xffff;
}
/** `CMP #$8000 : ROR` — arithmetic shift right by one. */
const asr = (v: number) => ((v & 0xffff) >> 1) | (v & 0x8000);
function continueIf(go: boolean) {
  if (go) process_anim_script();
  else CODE_B9D12B();
}

/** $B9E511 */
export function anim_delete_sprite() {
  delete_sprite_handle_deallocation();
}

/** $B9E516 — count up the 8-bit counter $19AF. */
export function CODE_B9E516() {
  w8(0x19af, (r8(0x19af) + 1) & 0xff);
}

/** $B9E51E — (unless time is stopped) hit enemies touching the sprite's hitbox. */
export function CODE_B9E51E() {
  if (r16(R.time_stop_flags) & 0x0004) return;
  get_current_sprite_clipping();
  reg.a = 0x0100;
  reg.y = 0x0100;
  CODE_BEBD8E();
}

/** $B9E535 — next state (low byte only, clears sub_state). */
export function CODE_B9E535() {
  const x = reg.x;
  w16(x + sprite.state, ((r16(x + sprite.state) & 0xff) + 1) & 0xffff);
}

/** $B9E53E */
export function CODE_B9E53E() {
  w16(reg.x + sprite.sub_state, (r16(reg.x + sprite.sub_state) + 1) & 0xffff);
}

/** $B9E541 */
export function CODE_B9E541() {
  w16(reg.x + sprite.sub_state, (r16(reg.x + sprite.sub_state) - 1) & 0xffff);
}

/** $B9E544 */
export function CODE_B9E544() {
  w16(reg.x + sprite.state, (r16(reg.x + sprite.state) + 1) & 0xffff);
}

/** $B9E547 — (83, unreferenced) hold while rising. */
export function CODE_B9E547() {
  continueIf(!isNeg(r16(reg.x + sprite.y_speed)));
}

/** $B9E551 — (83) hold while rising faster than $200. */
export function CODE_B9E551() {
  const ys = r16(reg.x + sprite.y_speed);
  continueIf(!isNeg(ys) || ys >= 0xfe00);
}

/** $B9E55D — (83) hold while off the ground. */
export function CODE_B9E55D() {
  continueIf(r16(reg.x + sprite.ground_distance) === 0);
}

/** $B9E564 — Y = turn animation id: start it when the target speed points behind the sprite. */
export function turn_sprite_if_needed() {
  const x = reg.x;
  const max = r16(x + sprite.max_x_speed);
  if (!max) return;
  if (!(((max >> 1) ^ r16(x + sprite.oam_property)) & 0x4000)) return;
  setAnim(reg.y);
}

/** $B9E576 — carry clear when both Kongs are not in a state with flag 1 (game_state bit 14 clear). */
export function CODE_B9E576() {
  if (r16(R.game_state_flags) & 0x4000) {
    reg.c = true;
    return;
  }
  const kong = r16(R.active_kong_sprite);
  reg.y = kong;
  const index = (dbRead16(kong + sprite.state) << 2) & 0xffff;
  reg.x = index;
  reg.c = !(rom16(KONG_STATE_FLAGS_TABLE + index) & 0x0001);
}

/** $B9E594 — ship water splash sound (two variants), once. */
export function CODE_B9E594() {
  const variant = r16(reg.x + sprite.general_purpose_46) & 1;
  reg.a = sound(5, variant ? C.sound_splash_2 : C.sound_splash_1);
  queue_sound_effect();
  const x = r16(R.current_sprite);
  reg.x = x;
  w16(x + sprite.general_purpose_46, 0xffff);
}

/** $B9E5AB — Neek: squeak every 64 frames, turn when needed. */
export function CODE_B9E5AB() {
  if (!(r16(R.active_frame_counter) & 0x003f)) {
    reg.a = sound(5, C.sound_neek_squeak);
    queue_sfx_if_on_screen_global();
  }
  turn_neek_if_needed();
}

/** $B9E5B9 */
export function turn_neek_if_needed() {
  reg.y = 0x0170;
  turn_sprite_if_needed();
}

/** $B9E5BF */
export function turn_click_clack_if_needed() {
  reg.y = 0x0165;
  turn_sprite_if_needed();
}

/** $B9E5C5 — bounce up with a contact flash above the sprite. */
export function CODE_B9E5C5() {
  const x = reg.x;
  w16(x + sprite.y_speed, 0xfb00);
  w16(R.contact_flash_x_position, r16(x + sprite.x_position));
  // SBC without SEC: the carry left by the command dispatcher is clear
  w16(R.contact_flash_y_position, sbc16(r16(x + sprite.y_position), 0x0008, reg.c));
  reg.y = C.special_sprite_spawn_id_0034;
  spawn_special_sprite_index();
}

/** $B9E5DF — Click-Clack footstep sound when on the ground. */
export function CODE_B9E5DF() {
  if (!(r16(reg.x + sprite.terrain_interaction) & 0x0001)) return;
  reg.a = sound(6, C.sound_click_clack_walk);
  queue_sfx_if_on_screen_global();
}

/** $B9E5EE — (8F) carry set when general_purpose_4E is 0. */
export function CODE_B9E5EE() {
  reg.a = 0;
  reg.c = r16(reg.x + sprite.general_purpose_4E) === 0;
}

/** $B9E5F4 — Klobber: hide when needed, else turn. */
export function CODE_B9E5F4() {
  CODE_B9E601();
  if (reg.c) return;
  reg.x = r16(R.current_sprite);
  reg.y = 0x01f6;
  turn_sprite_if_needed();
}

/** $B9E601 — Klobber: from state 3 on, play the hide animation (carry set). */
export function CODE_B9E601() {
  if ((r16(reg.x + sprite.state) & 0xff) < 0x0003) {
    reg.c = false;
    return;
  }
  setAnim(C.klobber_hide_anim_id);
  reg.c = true;
}

/** $B9E614 — Klobber: start charging. */
export function CODE_B9E614() {
  const x = reg.x;
  w16(x + sprite.max_x_speed, towardsFacing(x, spriteConstant(0x06)));
  w16(x + sprite.general_purpose_4A, 0x0200);
  w16(x + sprite.general_purpose_50, 0x0001);
}

/** $B9E62E */
export function CODE_B9E62E() {
  w16(reg.x + sprite.y_speed, 0xfc80);
}

/** $B9E634 — Klobber skidding: dust puffs, and a skid sound for the first one. */
export function CODE_B9E634() {
  let x = reg.x;
  if (r16(x + sprite.animation_speed) < C.default_animation_speed + 1) return;
  if (!(r16(x + sprite.terrain_interaction) & 0x0101)) return;
  if (!isNeg(r16(x + sprite.max_x_speed) ^ r16(x + sprite.x_speed))) {
    if (abs16(r16(x + sprite.x_speed)) >= 0x0200) return;
  }
  check_if_sprite_offscreen_global();
  if (reg.c) return;
  x = r16(R.current_sprite);
  reg.x = x;
  reg.y = facesLeft(r16(x + sprite.oam_property)) ? C.special_sprite_spawn_id_0050 : 0x004e;
  spawn_no_gfx_special_sprite_index();
  x = r16(R.current_sprite);
  reg.x = x;
  const left = (r16(x + sprite.general_purpose_50) - 1) & 0xffff;
  w16(x + sprite.general_purpose_50, left);
  if (left) return;
  reg.a = sound(7, C.sound_klobber_skid);
  queue_sound_effect();
}

/** $B9E679 — Klomp: quarter the walking speed (arithmetic shifts). */
export function delay_klomp_walk() {
  const x = reg.x;
  w16(x + sprite.x_speed, asr(asr(r16(x + sprite.x_speed))));
}

/** $B9E686 — speed up by half. */
export function CODE_B9E686() {
  const x = reg.x;
  const v = r16(x + sprite.x_speed);
  w16(x + sprite.x_speed, (asr(v) + v) & 0xffff);
}

/** $B9E692 */
export function turn_klomp_if_needed() {
  reg.y = 0x0161;
  turn_sprite_if_needed();
}

/** $B9E698 */
export function turn_kruncha_if_needed() {
  reg.y = 0x0173;
  turn_sprite_if_needed();
}

/** $B9E69E — (83) hold while falling at $40 or more. */
export function CODE_B9E69E() {
  const ys = r16(reg.x + sprite.y_speed);
  continueIf(isNeg(ys) || ys < 0x0040);
}

/** $B9E6AA — (83) hold until the target vertical speed is negative. */
export function CODE_B9E6AA() {
  continueIf(isNeg(r16(reg.x + sprite.max_y_speed)));
}

/** $B9E6B1 — (8F) carry = (Kong is right of the sprite) XOR (sprite faces left). */
export function CODE_B9E6B1() {
  const x = reg.x;
  const kong = r16(R.active_kong_sprite);
  reg.y = kong;
  const kx = dbRead16(kong + sprite.x_position);
  const c1 = kx >= r16(x + sprite.x_position);
  // ROR ROR: bit 15 = bit 0 of the Kong x, bit 14 = c1
  let v = (((kx & 0xffff) >> 1) | (c1 ? 0x8000 : 0)) & 0xffff;
  const b0 = (kx & 1) !== 0;
  v = ((v >> 1) | (b0 ? 0x8000 : 0)) & 0xffff;
  v ^= r16(x + sprite.oam_property);
  reg.c = (v & 0x4000) !== 0;
  reg.a = (v << 2) & 0xffff;
}

/** $B9E6C0 */
export function turn_klampon_if_needed() {
  reg.y = 0x01a0;
  turn_sprite_if_needed();
}

/** $B9E6C6 — (8F) carry set when time stop flag bit 2 is set. */
export function CODE_B9E6C6() {
  const v = r16(R.time_stop_flags) & 0x0004;
  reg.a = sbc16(v, 0x0004, true);
  reg.c = flags.c;
}

/** $B9E6D2 */
export function turn_spiny_if_needed() {
  reg.y = 0x01a4;
  turn_sprite_if_needed();
}

/** $B9E6D8 — credits: Snapjaw switches animation once it reached x = $160. */
export function set_credits_snapjaw_animation() {
  const x = reg.x;
  if (r16(x + sprite.x_position) < 0x0160) return;
  w16(x + sprite.animation_routine, 0);
  w16(x + sprite.animation_address, SNAPJAW_CREDITS_SCRIPT);
}

/** $B9E6E7 */
export function turn_lockjaw_if_needed() {
  reg.y = 0x0178;
  turn_sprite_if_needed();
}

/** $B9E6ED — (8F) carry set when the target speed points the way the sprite faces... (bit test). */
export function CODE_B9E6ED() {
  const x = reg.x;
  const v = ((r16(x + sprite.oam_property) << 1) ^ r16(x + sprite.max_x_speed)) & 0xffff;
  reg.c = (v & 0x8000) !== 0;
  reg.a = (v << 1) & 0xffff;
}

/** $B9E6F4 — Klampon: while stopped, play the idle sequence until it moves again. */
export function CODE_B9E6F4() {
  const x = reg.x;
  if (r16(x + sprite.max_x_speed)) return;
  w16(x + sprite.animation_address, KLAMPON_SCRIPT_A);
  w16(x + sprite.animation_routine, L("CODE_B9E705") & 0xffff);
  w16(x + sprite.animation_timer, 0);
}

/** $B9E705 — (routine) resume walking once the target speed is set. */
export function CODE_B9E705() {
  const x = reg.x;
  if (!r16(x + sprite.max_x_speed)) return;
  w16(x + sprite.animation_routine, 0);
  w16(x + sprite.animation_timer, 0);
  w16(x + sprite.animation_address, KLAMPON_SCRIPT_B);
}

/** $B9E713 — (83) hold unless state is $0402. */
export function CODE_B9E713() {
  continueIf(r16(reg.x + sprite.state) === 0x0402);
}

/** $B9E720 — move forward slowly ($80 in the facing direction). */
export function CODE_B9E720() {
  const x = reg.x;
  w16(x + sprite.max_x_speed, facesLeft(r16(x + sprite.oam_property)) ? 0x0080 : 0xff80);
  w16(x + sprite.max_y_speed, 0);
}

/** $B9E72F — (8F) carry from the facing vs target direction test; stops the sprite. */
export function CODE_B9E72F() {
  const x = reg.x;
  const v = ((r16(x + sprite.oam_property) << 1) ^ r16(x + sprite.max_x_speed) ^ 0x8000) & 0xffff;
  reg.c = (v & 0x8000) !== 0;
  reg.a = (v << 1) & 0xffff;
  w16(x + sprite.max_x_speed, 0);
}

/** $B9E73B — (8F) carry = bit 0 of display_mode. */
export function CODE_B9E73B() {
  const dm = r16(reg.x + sprite.display_mode);
  reg.c = (dm & 1) !== 0;
  reg.a = dm >> 1;
}

/** $B9E73F — (8F) Puftup-like: mark display bit 1, clamp the target speed. Carry always clear. */
export function CODE_B9E73F() {
  const x = reg.x;
  const dm = r16(x + sprite.display_mode) | 0x0002;
  w16(x + sprite.display_mode, dm);
  if (!(dm >> 1)) {
    // (never taken: bit 1 was just set)
    if (!r16(0x0915)) {
      CODE_B9E576();
      if (reg.c) {
        const kong = r16(R.active_kong_sprite);
        reg.x = kong;
        if (r16(kong + sprite.y_position) >= r16(R.water_y_position)) {
          reg.c = true;
          return;
        }
      }
    }
  }
  // CODE_B9E75F
  const y = reg.y;
  const gp = spriteConstant(0x10);
  reg.y = y;
  const sx = r16(R.current_sprite);
  reg.x = sx;
  w16(sx + sprite.general_purpose_4E, gp);
  const max = r16(sx + sprite.max_x_speed);
  if (0xfd00 >= max) {
    if (!isNeg(max) && max >= 0x0300) w16(sx + sprite.max_x_speed, 0x0300);
    else w16(sx + sprite.max_x_speed, max);
  }
  reg.c = false;
}

/** $B9E781 — (8F) carry set when the sprite faces away from the active Kong. */
export function CODE_B9E781() {
  const kong = r16(R.active_kong_sprite);
  const x = r16(R.current_sprite);
  reg.x = x;
  const dx = (r16(kong + sprite.x_position) - r16(x + sprite.x_position)) & 0xffff;
  const v = ((dx >> 1) ^ r16(x + sprite.oam_property) ^ 0x4000) & 0xffff;
  reg.c = (v & 0x4000) !== 0;
  reg.a = (v << 2) & 0xffff;
}

/**
 * $B9E794 — (83) wait for the Kong: continue when the Kong is behind the sprite or close, or
 * when above water; installs CODE_B9E7D9 (stop) when the Kong is behind.
 */
export function CODE_B9E794() {
  if (r16(0x0915)) return process_anim_script();
  const x = r16(R.current_sprite);
  reg.x = x;
  // SBC without SEC: the carry left by the command dispatcher is clear
  const dx = sbc16(r16(r16(R.active_kong_sprite) + sprite.x_position), r16(x + sprite.x_position), reg.c);
  const left = facesLeft(r16(x + sprite.oam_property));
  if (isNeg(dx)) {
    if (!left) return kongBehind(x);
    if (dx >= 0xfff0) return process_anim_script();
  } else {
    if (left) return kongBehind(x);
    if (dx < 0x0010) return process_anim_script();
  }
  // CODE_B9E7BC
  if (r16(x + sprite.display_mode) & 1) return process_anim_script();
  const kong = r16(R.active_kong_sprite);
  reg.x = kong;
  if (r16(kong + sprite.y_position) < r16(R.water_y_position)) return process_anim_script();
  CODE_B9D12B();
}

/** $B9E7D1 */
function kongBehind(x: number) {
  w16(x + sprite.animation_routine, L("CODE_B9E7D9") & 0xffff);
  process_anim_script();
}

/** $B9E7D9 — (routine) stop moving. */
export function CODE_B9E7D9() {
  w16(reg.x + sprite.max_x_speed, 0);
  w16(reg.x + sprite.max_y_speed, 0);
}

/** $B9E7DE */
export function turn_flotsam_if_needed() {
  reg.y = 0x01aa;
  turn_sprite_if_needed();
}

/** $B9E7E4 — speed = 1.5 x target speed; stop the routine. */
export function CODE_B9E7E4() {
  const x = reg.x;
  w16(x + sprite.animation_routine, 0);
  const max = r16(x + sprite.max_x_speed);
  w16(x + sprite.x_speed, (asr(max) + max) & 0xffff);
}

/** $B9E7F2 — turn around, shifting the sprite so its body stays in place. */
export function CODE_B9E7F2() {
  const x = reg.x;
  const oam = r16(x + sprite.oam_property) ^ 0x4000;
  w16(x + sprite.oam_property, oam);
  const nowLeft = (oam & 0x4000) >= 0x4000;
  // carry from the CMP feeds the ADC: +8 when now facing right, -6 when facing left
  w16(x + sprite.x_position, adc16(nowLeft ? 0xfff9 : 0x0008, r16(x + sprite.x_position), nowLeft));
}

/** $B9E80C — decay the animation speed towards the default. */
export function CODE_B9E80C() {
  const x = reg.x;
  const v = r16(x + sprite.animation_speed);
  if (v === C.default_animation_speed) return;
  w16(x + sprite.animation_speed, (v - 1) & 0xffff);
}

/** $B9E816 — once movement_state's high byte is clear, switch to script F9596D. */
export function CODE_B9E816() {
  const x = reg.x;
  if (r16(x + sprite.movement_state) & 0xff00) return;
  w16(x + sprite.animation_address, SCRIPT_F9596D);
  w16(x + sprite.animation_routine, 0);
}

/**
 * $B9E825 — bounce (knock sound): time the animation to the jump arc using the hardware divider:
 * speed = $3C00 / ((-2 * max_y_speed) / unknown_22).
 */
export function CODE_B9E825() {
  reg.a = sound(5, C.sound_knock);
  queue_sound_effect();
  const x = r16(R.current_sprite);
  reg.x = x;
  io16(CPU.dividen, (negate(r16(x + sprite.max_y_speed)) << 1) & 0xffff);
  io8(CPU.divisor, r16(x + sprite.unknown_22) & 0xff);
  w16(x + sprite.max_x_speed, r16(x + sprite.general_purpose_50));
  io16(CPU.dividen, 0x3c00);
  io16(CPU.divisor, ioR16(CPU.divide_result));
  w16(x + sprite.y_speed, r16(x + sprite.max_y_speed));
  w16(x + sprite.animation_speed, ioR16(CPU.divide_result));
  w16(x + sprite.sub_state, (r16(x + sprite.sub_state) + 1) & 0xffff);
}

/** $B9E860 — (8F) knock sound; carry set when general_purpose_50 points behind the sprite. */
export function CODE_B9E860() {
  reg.a = sound(5, C.sound_knock);
  queue_sound_effect();
  const x = r16(R.current_sprite);
  reg.x = x;
  w16(x + sprite.animation_speed, C.default_animation_speed);
  const v = r16(x + sprite.general_purpose_50);
  reg.c = v !== 0 && (((v >> 1) ^ r16(x + sprite.oam_property)) & 0x4000) !== 0;
}

/** $B9E87E — Zinger: turn when the circling direction changes. */
export function CODE_B9E87E() {
  reg.y = C.zinger_turn_anim_id;
  reg.a = 0x0007;
  CODE_B9E898();
}

/** $B9E887 — King Zing: turn when facing differs from unknown_22. */
export function CODE_B9E887() {
  const x = reg.x;
  if (!((r16(x + sprite.unknown_22) ^ r16(x + sprite.oam_property)) & 0x4000)) return;
  setAnim(C.king_zing_chase_turn_anim_id);
}

/**
 * $B9E898 — A = radius factor, Y = turn animation: for circling flyers (movement state $A/$B)
 * predict the next horizontal direction with the hardware multiplier; otherwise use the
 * target speed (turn_sprite_if_needed).
 */
export function CODE_B9E898() {
  io16(CPU.multiply_A, reg.a);
  const x = reg.x;
  const mstate = r16(x + sprite.movement_state) & 0xff;
  if (mstate < 0x000a || mstate >= 0x000c) return turn_sprite_if_needed();
  const max = r16(x + sprite.max_x_speed);
  const m = abs16(max);
  io16(CPU.multiply_B, (((m << 2) & 0xffff) >> 8 | ((m << 2) & 0xff) << 8) & 0xffff);
  const phase = (r16(x + sprite.general_purpose_46) + 0x4000) & 0xffff;
  w16(0x5e, phase);
  const product = ioR16(CPU.multiply_result);
  let v = ((product >> 8) | ((product & 0xff) << 8)) & 0xffff; // XBA
  v >>= 1;
  let carry = (v & 1) !== 0;
  v >>= 1;
  if (isNeg(max)) {
    v ^= 0xffff;
    carry = true;
  }
  v = adc16(v, phase, carry);
  v ^= max;
  v >>= 1;
  v ^= r16(x + sprite.oam_property);
  if (!(v & 0x4000)) return;
  setAnim(reg.y);
}

/** $B9E8E3 — Flitter: turn when the circling direction changes. */
export function CODE_B9E8E3() {
  reg.y = C.flitter_turn_anim_id;
  reg.a = 0x0008;
  CODE_B9E898();
}

/** $B9E8EC — (unreferenced) stop falling. */
export function CODE_B9E8EC() {
  if (isNeg(r16(reg.x + sprite.y_speed))) return;
  CODE_B9E8F1();
}

/** $B9E8F1 */
export function CODE_B9E8F1() {
  w16(reg.x + sprite.y_speed, 0);
}

/** $B9E8F4 — triple the vertical speed. */
export function CODE_B9E8F4() {
  const x = reg.x;
  const v = r16(x + sprite.y_speed);
  w16(x + sprite.y_speed, ((v << 1) + v) & 0xffff);
}

/** $B9E8FD — quadruple the vertical speed. */
export function CODE_B9E8FD() {
  const x = reg.x;
  w16(x + sprite.y_speed, (r16(x + sprite.y_speed) << 2) & 0xffff);
}

/** $B9E902 — (8F) carry set when the target vertical speed is not negative. */
export function CODE_B9E902() {
  const v = r16(reg.x + sprite.max_y_speed) ^ 0x8000;
  reg.c = (v & 0x8000) !== 0;
  reg.a = (v << 1) & 0xffff;
}

/** $B9E909 — (8F) carry set when the target vertical speed is negative (also sets the speed). */
export function CODE_B9E909() {
  const x = reg.x;
  const v = r16(x + sprite.max_y_speed);
  reg.c = (v & 0x8000) !== 0;
  reg.a = (v << 1) & 0xffff;
  if (!reg.c) return;
  reg.a = r16(x + sprite.general_purpose_4E);
  w16(x + sprite.animation_speed, reg.a);
}

/** $B9E913 — follow the target vertical speed; while rising emit bubbles every 8 frames. */
export function CODE_B9E913() {
  const x = reg.x;
  const maxY = r16(x + sprite.max_y_speed);
  if (!isNeg(maxY)) {
    w16(x + sprite.y_speed, (maxY << 2) & 0xffff);
    w16(x + sprite.y_sub_position, 0);
    return;
  }
  if (isNeg(r16(x + sprite.y_speed))) {
    w16(x + sprite.y_speed, 0xffff);
    return;
  }
  if (r16(R.active_frame_counter) & 0x0007) return;
  reg.y = C.special_sprite_spawn_id_0052;
  spawn_no_gfx_special_sprite_index();
}

/** $B9E937 — leap: forward speed $280 and half of it backwards as target. */
export function CODE_B9E937() {
  const x = reg.x;
  const v = facesLeft(r16(x + sprite.oam_property)) ? 0x0280 : 0xfd80;
  w16(x + sprite.x_speed, v);
  w16(x + sprite.max_x_speed, asr(negate(v)));
  w16(x + sprite.movement_sub_state, (r16(x + sprite.movement_sub_state) + 1) & 0xffff);
}

/** $B9E950 */
export function CODE_B9E950() {
  const x = reg.x;
  w16(x + sprite.y_speed, 0xfc80);
  w16(x + sprite.movement_sub_state, (r16(x + sprite.movement_sub_state) + 1) & 0xffff);
}

/** $B9E958 — (83) countdown in general_purpose_50; when done in sub-state 1, advance it. */
export function CODE_B9E958() {
  const x = reg.x;
  const left = (r16(x + sprite.general_purpose_50) - 1) & 0xffff;
  w16(x + sprite.general_purpose_50, left);
  if (!isNeg(left)) return CODE_B9D12B();
  if ((r16(x + sprite.sub_state) & 0xff) !== 0x0001) return CODE_B9D12B();
  w16(x + sprite.sub_state, (r16(x + sprite.sub_state) + 1) & 0xffff);
  process_anim_script();
}

/** $B9E96E */
export function CODE_B9E96E() {
  w16(0x19bc, (r16(0x19bc) + 1) & 0xffff);
}

/** $B9E972 */
export function turn_kutlass_if_needed() {
  reg.y = 0x016a;
  turn_sprite_if_needed();
}

/**
 * $B9E978 — Kutlass lunge: speed 1.5x general_purpose_48 while unknown_5C counts down, then
 * doubled; the walk animation position is resynchronised to the current graphic.
 */
export function CODE_B9E978() {
  const x = reg.x;
  const base = r16(x + sprite.general_purpose_48);
  const count = (r16(x + sprite.unknown_5C) - 1) & 0xffff;
  w16(x + sprite.unknown_5C, count);
  let v = isNeg(count) ? (base << 1) & 0xffff : (asr(base) + base) & 0xffff;
  v = abs16(v);
  v = towardsFacing(x, v);
  w16(x + sprite.max_x_speed, v);
  w16(x + sprite.x_speed, v);
  const frame = (r16(x + sprite.current_graphic) - C.kutlass_walk_frame1) & 0xffff;
  if (frame >= 0x0020) return;
  const half = frame >> 1;
  w16(0x32, half);
  const quarter = half >> 1;
  let a = adc16(quarter, half, (half & 1) !== 0);
  a = adc16(a, r16(x + sprite.animation_address), flags.c);
  w16(x + sprite.animation_address, a);
}

/** $B9E9B0 — (8F) count down general_purpose_4B (16-bit DEC); carry set when it was not 0. */
export function CODE_B9E9B0() {
  const x = reg.x;
  if ((r16(x + sprite.general_purpose_4B) & 0xff) < 0x0001) {
    reg.c = false;
    return;
  }
  w16(x + sprite.general_purpose_4B, (r16(x + sprite.general_purpose_4B) - 1) & 0xffff);
  reg.c = true;
}

/** $B9E9BD — (8F) count down Krook's timer in display_mode_high; carry set when it is 0. */
export function CODE_B9E9BD() {
  const x = reg.x;
  const v = ((r16(x + sprite.display_mode_high) & 0xff) - 1) & 0xffff;
  reg.a = v;
  if (v >= 0x8000) {
    reg.c = true;
    return;
  }
  w16(x + sprite.display_mode_high, (r16(x + sprite.display_mode_high) - 1) & 0xffff);
  reg.c = false;
}

/** $B9E9CB */
export function turn_krook_if_needed() {
  reg.y = 0x01ef;
  turn_sprite_if_needed();
}

/** $B9E9D1 — spawn Krook's hook and link it with Krook both ways. */
export function spawn_krooks_hook() {
  reg.y = C.special_sprite_spawn_id_000A;
  spawn_special_sprite_index();
  const hook = r16(R.alternate_sprite);
  const krook = r16(R.current_sprite);
  reg.y = hook;
  reg.x = krook;
  w16(krook + sprite.general_purpose_50, hook);
  w16((hook + sprite.general_purpose_50) & 0xffff, krook);
}

/** $B9E9E1 — Krook without hook: switch to the hookless script. */
export function CODE_B9E9E1() {
  const x = reg.x;
  if (r16(x + sprite.general_purpose_50)) return;
  w16(x + sprite.animation_address, KROOK_NO_HOOK_SCRIPT);
  w16(x + sprite.animation_timer, 0);
  w16(x + sprite.animation_routine, 0);
}

/** $B9E9EF — (8F) count down terrain_attributes (low byte); carry set while counting. */
export function CODE_B9E9EF() {
  const x = reg.x;
  if (!(r16(x + sprite.terrain_attributes) & 0xff)) {
    reg.c = false;
    return;
  }
  w16(x + sprite.terrain_attributes, (r16(x + sprite.terrain_attributes) - 1) & 0xffff);
  reg.c = true;
}

/** $B9E9FA — (8F) count down terrain_attributes_high; carry set while counting. */
export function CODE_B9E9FA() {
  const x = reg.x;
  if (!(r16(x + sprite.terrain_attributes_high) & 0xff)) {
    reg.c = false;
    return;
  }
  w16(x + sprite.terrain_attributes_high, (r16(x + sprite.terrain_attributes_high) - 1) & 0xffff);
  reg.c = true;
}

/** $B9EA07 — (routine) speed the animation up to $280, then slow it down again. */
export function CODE_B9EA07() {
  const x = reg.x;
  const v = r16(x + sprite.animation_speed);
  if (v >= 0x0280) {
    w16(x + sprite.animation_routine, L("CODE_B9EA1A") & 0xffff);
    return;
  }
  w16(x + sprite.animation_speed, (v + 0x0004) & 0xffff);
}

/** $B9EA1A — (routine) slow the animation down to $140, then stop. */
export function CODE_B9EA1A() {
  const x = reg.x;
  const v = r16(x + sprite.animation_speed);
  if (v < 0x0140) {
    w16(x + sprite.animation_routine, 0);
    return;
  }
  w16(x + sprite.animation_speed, (v - 0x0004) & 0xffff);
  CODE_B9EA29();
}

/** $B9EA29 — (8F) carry set while an animation routine is installed. */
export function CODE_B9EA29() {
  const v = r16(reg.x + sprite.animation_routine);
  reg.a = v;
  reg.c = v >= 0x0001;
}

/** $B9EA2F */
export function CODE_B9EA2F() {
  w16(reg.x + sprite.movement_state, 0);
}

/** $B9EA32 */
export function CODE_B9EA32() {
  w16(reg.x + sprite.movement_state, 0x018c);
}

/** $B9EA38 */
export function CODE_B9EA38() {
  w16(reg.x + sprite.movement_state, 0x018d);
}

/** $B9EA3E — Cat-O-9-Tails dizzy: spawn the stars and remember them. */
export function spawn_cat_o9_tails_dizzy_stars() {
  reg.y = C.special_sprite_spawn_id_0094;
  spawn_special_sprite_index();
  const x = r16(R.current_sprite);
  const failed = reg.c;
  reg.x = x;
  if (failed) return;
  w16(x + sprite.general_purpose_4E, r16(R.alternate_sprite));
}

/** $B9EA4E — tell the dizzy stars to go away. */
export function CODE_B9EA4E() {
  const x = reg.x;
  const stars = r16(x + sprite.general_purpose_4E);
  reg.y = stars;
  dbWrite16(stars + sprite.general_purpose_42, 1);
  w16(x + sprite.general_purpose_4E, 0);
}

/** $B9EA9E — (routine) spin up the animation to $C0, then next state and spin down. */
export function CODE_B9EA9E() {
  const x = reg.x;
  const v = (r16(x + sprite.animation_speed) + 1) & 0xffff;
  w16(x + sprite.animation_speed, v);
  if (v < 0x00c0) return;
  w16(x + sprite.state, (r16(x + sprite.state) + 1) & 0xffff);
  w16(x + sprite.animation_routine, L("CODE_B9EAAF") & 0xffff);
}

/** $B9EAAF — (routine) spin down to $55, then state 4. */
export function CODE_B9EAAF() {
  const x = reg.x;
  const v = (r16(x + sprite.animation_speed) - 1) & 0xffff;
  w16(x + sprite.animation_speed, v);
  if (v >= 0x0055) return;
  w16(x + sprite.state, 0x0004);
}

/** $B9EABE — Kloak: throw when holding an object, else turn when needed. */
export function turn_kloak_if_needed() {
  if (r16(reg.x + sprite.terrain_attributes)) return setAnim(C.kloak_throw_anim_id);
  reg.y = C.kloak_turn_anim_id;
  turn_sprite_if_needed();
}

/** $B9EAD0 — switch to script F96266 when general_purpose_4E bit 0 is set. */
export function CODE_B9EAD0() {
  const x = reg.x;
  if (!(r16(x + sprite.general_purpose_4E) & 1)) return;
  w16(x + sprite.animation_address, SCRIPT_F96266);
  w16(x + sprite.animation_routine, 0);
}

/** $B9EADD — switch to script F962EC when general_purpose_4E bit 0 is clear. */
export function CODE_B9EADD() {
  const x = reg.x;
  if (r16(x + sprite.general_purpose_4E) & 1) return;
  w16(x + sprite.animation_address, SCRIPT_F962EC);
  w16(x + sprite.animation_routine, 0);
}

/** $B9EAEA — (8F) carry set when not rising and movement state differs from 4. */
export function CODE_B9EAEA() {
  const x = reg.x;
  if (isNeg(r16(x + sprite.y_speed))) {
    reg.c = false;
    return;
  }
  const v = ((r16(x + sprite.movement_state) & 0xff) - 0x0004) & 0xffff;
  reg.a = v;
  reg.c = v >= 0x0001;
}

/** $B9EAFC — switch to script F96320 once general_purpose_44 is set. */
export function CODE_B9EAFC() {
  const x = reg.x;
  if (!r16(x + sprite.general_purpose_44)) return;
  w16(x + sprite.animation_routine, 0);
  w16(x + sprite.animation_address, SCRIPT_F96320);
}

/** $B9EB08 — (8F) carry set when this sprite is the one in $0D58. */
export function CODE_B9EB08() {
  reg.c = reg.x === r16(0x0d58);
}

/** $B9EB0F — (8F) spawn the sprite whose script is in general_purpose_4E as a barrel. */
export function CODE_B9EB0F() {
  reg.y = r16(reg.x + sprite.general_purpose_4E);
  spawn_special_sprite_address();
  if (reg.c) return;
  const spawned = r16(R.alternate_sprite);
  reg.y = spawned;
  dbWrite16(spawned + sprite.current_graphic, C.barrel_frame1);
  const x = r16(R.current_sprite);
  reg.x = x;
  w16(x + sprite.general_purpose_48, spawned);
}

/** $B9EB24 */
export function set_krochead_bounce_interaction() {
  reg.a = C.player_interaction_09;
  set_player_interaction_global();
}

/** $B9EB2C — (83) continue when both low bits of general_purpose_4E are set. */
export function CODE_B9EB2C() {
  continueIf((r16(reg.x + sprite.general_purpose_4E) & 3) === 3);
}

/** $B9EB39 — (83) Krockhead (brown): when the Kong stands on it (state $55), bounce it up. */
export function CODE_B9EB39() {
  const kongState = r16(r16(R.active_kong_sprite) + sprite.state);
  reg.x = r16(R.current_sprite);
  if (kongState !== 0x0055) return process_anim_script();
  pushDb(0xb9);
  reg.a = C.player_interaction_0E;
  set_player_interaction_global();
  popDb();
  if (reg.c) return CODE_B9D12B();
  reg.a = sound(5, C.sound_krockhead_brown);
  queue_sound_effect();
  const x = r16(R.current_sprite);
  reg.x = x;
  w16(R.interaction_RAM_0A86, r16(x + sprite.general_purpose_46));
  w16(R.interaction_RAM_0A88, r16(x + sprite.general_purpose_48));
  process_anim_script();
}

/** $B9EB6C — read the next delay of a list (pointer in general_purpose_4A; negative = loop). */
export function CODE_B9EB6C() {
  const x = reg.x;
  for (;;) {
    const ptr = r16(x + sprite.general_purpose_4A);
    w16(x + sprite.general_purpose_4A, (ptr + 2) & 0xffff);
    w16(R.current_sprite_constants, ptr);
    const v = spriteConstant(0);
    if (!isNeg(v)) {
      w16(x + sprite.general_purpose_42, v);
      w16(R.current_sprite_constants, r16(x + sprite.constants_address));
      return;
    }
    reg.y = 0x0002;
    w16(x + sprite.general_purpose_4A, spriteConstant(2));
  }
}

/** $B9EB88 — (83) count down general_purpose_42 and continue when it reaches 0. */
export function CODE_B9EB88() {
  const x = reg.x;
  const v = r16(x + sprite.general_purpose_42);
  if (!v) return CODE_B9D12B();
  const left = (v - 1) & 0xffff;
  w16(x + sprite.general_purpose_42, left);
  continueIf(left === 0);
}

/** $B9EB96 — (83) continue while general_purpose_42 is set. */
export function CODE_B9EB96() {
  continueIf(r16(reg.x + sprite.general_purpose_42) !== 0);
}

/** $B9EB9D — (83) continue once general_purpose_42 is clear. */
export function CODE_B9EB9D() {
  continueIf(r16(reg.x + sprite.general_purpose_42) === 0);
}

/** $B9EBA4 — Krockhead (green): when stood on, play the bounce sequence for its current frame. */
export function CODE_B9EBA4() {
  let x = reg.x;
  if ((r16(x + sprite.general_purpose_4E) & 3) !== 3) return;
  reg.a = sound(6, C.sound_krockhead_green);
  queue_sound_effect();
  x = r16(R.current_sprite);
  reg.x = x;
  w16(x + sprite.unknown_2C, r16(x + sprite.animation_address));
  const g = r16(x + sprite.current_graphic);
  if (g < C.krockhead_frame5) return;
  let frame = (g - C.krockhead_frame5) & 0xffff;
  if (frame >= 0x000c) frame = 0x000c;
  const index = frame >> 1;
  reg.y = index;
  w16(x + sprite.animation_address, rom16(KROCKHEAD_BOUNCE_SCRIPTS + index));
  w16(x + sprite.animation_routine, 0);
  w16(x + sprite.animation_timer, 0);
}

/** $B9EC23 — (83) continue (and count) when general_purpose_46 is odd. */
export function CODE_B9EC23() {
  const x = reg.x;
  const v = r16(x + sprite.general_purpose_46);
  if (!(v & 1)) return CODE_B9D12B();
  w16(x + sprite.general_purpose_46, (v + 1) & 0xffff);
  process_anim_script();
}

/** $B9EC30 — (8F) carry set when general_purpose_4E is not 0. */
export function CODE_B9EC30() {
  const v = r16(reg.x + sprite.general_purpose_4E);
  reg.a = v;
  reg.c = v >= 0x0001;
}

/** $B9EC36 — Klank: lean sequence when status bit $80 is set, else slope graphic. */
export function CODE_B9EC36() {
  const x = reg.x;
  if (r16(x + sprite.general_purpose_4A) & 0x0080) {
    w16(x + sprite.animation_address, KLANK_SCRIPT_A);
    w16(x + sprite.animation_timer, 0);
    w16(x + sprite.animation_routine, L("CODE_B9EC4A") & 0xffff);
    return;
  }
  CODE_B9EC4A();
}

/** Klank's slope graphic: 4 * slope index + first frame. */
const klankSlope = (x: number) => (((r16(x + sprite.general_purpose_48) & 0xff) << 2) + C.klank_ride_cart_slope_frame1) & 0xffff;

/** $B9EC4A — (routine) Klank: back to the riding script once on a slope. */
export function CODE_B9EC4A() {
  const x = reg.x;
  if (r16(x + sprite.general_purpose_48) === 0x0009) return;
  w16(x + sprite.animation_address, KLANK_SCRIPT_B);
  w16(x + sprite.animation_routine, 0);
  w16(x + sprite.animation_timer, 0);
  w16(x + sprite.current_graphic, klankSlope(x));
}

/** $B9EC67 — (83) Klank riding: slope graphic, or continue into the jump/lean sequences. */
export function CODE_B9EC67() {
  const x = reg.x;
  w16(x + sprite.animation_routine, 0);
  if (r16(x + sprite.general_purpose_48) === 0x0009) {
    const cart = r16(x + sprite.general_purpose_42);
    if (r16(cart + sprite.ground_distance) === 0) {
      const status = r16(x + sprite.general_purpose_4A);
      if (status & 0x0100) {
        // CODE_B9ECDC
        w16(cart + sprite.animation_routine, r16(cart + sprite.animation_routine) & 0xfeff);
        w16(x + sprite.animation_timer, 0);
        return process_anim_script();
      }
      if (status & 0x0080) return klankChase(x);
    }
  }
  klankHold(x);
}

/** $B9EC88: show the slope graphic and hold. */
function klankHold(x: number) {
  w16(x + sprite.current_graphic, klankSlope(x));
  w16(x + sprite.animation_timer, C.default_animation_speed);
  CODE_B9D12B();
}

/** $B9EC9C: in range of the Kong: skip into the attack sequence (+3). */
function klankChase(x: number) {
  const cart = r16(x + sprite.general_purpose_42);
  if (r16(x + sprite.x_position) >= r16(x + sprite.x_sub_position)) {
    // CODE_B9ECCE
    w16(cart + sprite.animation_routine, r16(cart + sprite.animation_routine) & 0xff7f);
    reg.x = r16(R.current_sprite);
    return klankHold(reg.x);
  }
  const d = (r16(r16(R.active_kong_sprite) + sprite.x_position) - r16(x + sprite.x_position) + 0x0040) & 0xffff;
  if (d < 0xff00) return klankHold(x);
  w16(cart + sprite.animation_routine, r16(cart + sprite.animation_routine) & 0xff7f);
  const sx = r16(R.current_sprite);
  reg.x = sx;
  reg.y = (reg.y + 3) & 0xffff;
  w16(sx + sprite.animation_timer, 0);
  process_anim_script();
}

/** $B9ECED — when the linked cart leaves the ground, release it. */
export function CODE_B9ECED() {
  const cart = r16(reg.x + sprite.general_purpose_42);
  reg.y = cart;
  if (!dbRead16(cart + sprite.ground_distance)) return;
  CODE_B9ECF5();
}

/** $B9ECF5 — unlink the cart, clearing its general_purpose_48 (or _46). */
export function CODE_B9ECF5() {
  const x = reg.x;
  w16(x + sprite.animation_routine, 0);
  const cart = r16(x + sprite.general_purpose_42);
  reg.y = cart;
  w16(x + sprite.general_purpose_42, 0);
  if (r16(x + sprite.general_purpose_44)) dbWrite16(cart + sprite.general_purpose_48, 0);
  else dbWrite16(cart + sprite.general_purpose_46, 0);
}

/** $B9ED0A — Screech: turn towards unknown_22's direction, else follow its animation speed. */
export function turn_screech_if_needed() {
  const x = reg.x;
  if ((r16(x + sprite.unknown_22) ^ r16(x + sprite.oam_property)) & 0x4000) return setAnim(C.screech_turn_anim_id);
  w16(x + sprite.animation_speed, r16(x + sprite.unknown_28));
}

/** $B9ED20 — giant tire: roll animation speed and direction follow the movement. */
export function CODE_B9ED20() {
  const x = reg.x;
  let v = abs16((r16(x + sprite.x_speed) + r16(x + sprite.max_x_speed)) & 0xffff) >> 1;
  if (v < 0x0018) v = 0x0018;
  w16(x + sprite.animation_speed, v);
  const max = r16(x + sprite.max_x_speed);
  const addr = r16(x + sprite.animation_address);
  // ROR of the CMP carry into bit 15: which half of the script we are in vs. direction
  const half = addr >= TIRE_SCRIPT_SPLIT ? 0x8000 : 0;
  if (!isNeg(((addr >> 1) | half) ^ max)) return;
  const frame = (r16(x + sprite.current_graphic) - C.giant_tire_roll_frame1) & 0xffff;
  const h = frame >> 1;
  w16(0x5e, h);
  const offset = ((h >> 1) + h) & 0xffff;
  if (isNeg(max)) w16(x + sprite.animation_address, (TIRE_SCRIPT_BACK - offset) & 0xffff);
  else w16(x + sprite.animation_address, (offset + TIRE_SCRIPT_FWD) & 0xffff);
}

/** $B9ED6F — (8F) carry set when in state 1. */
export function CODE_B9ED6F() {
  reg.c = r16(reg.x + sprite.state) === 0x0001;
}

/** $B9ED78 — move forward at general_purpose_44 (x speed starts at double), drawn behind. */
export function CODE_B9ED78() {
  const x = reg.x;
  w16(x + sprite.render_order, 0x00d0);
  const v = towardsFacing(x, r16(x + sprite.general_purpose_44));
  w16(x + sprite.max_x_speed, v);
  w16(x + sprite.x_speed, (v << 1) & 0xffff);
}

/** $B9ED8D */
export function CODE_B9ED8D() {
  reg.a = 0x0147;
  set_anim_handle_animal();
}

/** $B9ED95 — hop when touching ground or wall. */
export function CODE_B9ED95() {
  const x = reg.x;
  if (r16(x + sprite.terrain_interaction) & 0x1001) w16(x + sprite.y_speed, 0xfd00);
}

/** $B9EDA2 — move forward at a quarter of general_purpose_44. */
export function CODE_B9EDA2() {
  const x = reg.x;
  w16(x + sprite.render_order, 0x00d0);
  const v = towardsFacing(x, r16(x + sprite.general_purpose_44) >> 2);
  w16(x + sprite.max_x_speed, v);
  w16(x + sprite.x_speed, (v << 1) & 0xffff);
}

/** $B9EDB9 */
export function CODE_B9EDB9() {
  CODE_B9ED78();
}

/** $B9EDCE */
export function CODE_B9EDCE() {
  w16(reg.x + sprite.render_order, 0x00f0);
}

/** $B9EDD4 */
export function CODE_B9EDD4() {
  w16(R.firework_flicker_flag, r16(R.firework_flicker_flag) | 0x0001);
}

/** $B9EDDB — one less firework; the last one clears $0929. Deletes the sprite. */
export function CODE_B9EDDB() {
  const left = (r16(0x092e) - 1) & 0xffff;
  w16(0x092e, left);
  if (!(left & 0xff)) w16(0x0929, 0);
  anim_delete_sprite();
}

/** $B9EDEC — ghost rope: visible countdown, then disappear. */
export function CODE_B9EDEC() {
  const x = reg.x;
  const v = (r16(x + sprite.general_purpose_44) - 1) & 0xffff;
  w16(x + sprite.general_purpose_44, v);
  if (isNeg(v)) CODE_B9EDF1();
}

/** $B9EDF1 */
export function CODE_B9EDF1() {
  setAnim(C.ghost_rope_disappear_anim_id);
}

/** $B9EDF9 */
export function CODE_B9EDF9() {
  w16(reg.x + sprite.state, 0x0002);
}

/** $B9EDFF */
export function CODE_B9EDFF() {
  const x = reg.x;
  w16(x + sprite.general_purpose_44, r16(x + sprite.general_purpose_46));
  setAnim(C.ghost_rope_hidden_anim_id);
}

/** $B9EE0B — ghost rope: hidden countdown, then appear. */
export function CODE_B9EE0B() {
  const x = reg.x;
  const v = (r16(x + sprite.general_purpose_44) - 1) & 0xffff;
  w16(x + sprite.general_purpose_44, v);
  if (isNeg(v)) CODE_B9EE10();
}

/** $B9EE10 */
export function CODE_B9EE10() {
  setAnim(C.ghost_rope_appear_anim_id);
}

/** $B9EE18 */
export function CODE_B9EE18() {
  w16(reg.x + sprite.state, 0x0003);
}

/** $B9EE1E */
export function CODE_B9EE1E() {
  const x = reg.x;
  w16(x + sprite.general_purpose_44, r16(x + sprite.general_purpose_48));
  setAnim(C.ghost_rope_idle_anim_id);
}

/** $B9EE2A — Glimmer turns to face the same way as the active Kong. */
export function turn_glimmer_if_needed() {
  const kong = r16(R.active_kong_sprite);
  reg.y = kong;
  if (!((dbRead16(kong + sprite.oam_property) ^ r16(reg.x + sprite.oam_property)) & 0x4000)) return;
  setAnim(C.glimmer_turn_anim_id);
}

/** $B9EE40 */
export function CODE_B9EE40() {
  CODE_B9E019();
  setAnim(C.glimmer_idle_anim_id);
}


register({
  anim_delete_sprite,
  CODE_B9E516,
  CODE_B9E51E,
  CODE_B9E535,
  CODE_B9E53E,
  CODE_B9E541,
  CODE_B9E544,
  CODE_B9E547,
  CODE_B9E551,
  CODE_B9E55D,
  turn_sprite_if_needed,
  CODE_B9E576,
  CODE_B9E594,
  CODE_B9E5AB,
  turn_neek_if_needed,
  turn_click_clack_if_needed,
  CODE_B9E5C5,
  CODE_B9E5DF,
  CODE_B9E5EE,
  CODE_B9E5F4,
  CODE_B9E601,
  CODE_B9E614,
  CODE_B9E62E,
  CODE_B9E634,
  delay_klomp_walk,
  CODE_B9E686,
  turn_klomp_if_needed,
  turn_kruncha_if_needed,
  CODE_B9E69E,
  CODE_B9E6AA,
  CODE_B9E6B1,
  turn_klampon_if_needed,
  CODE_B9E6C6,
  turn_spiny_if_needed,
  set_credits_snapjaw_animation,
  turn_lockjaw_if_needed,
  CODE_B9E6ED,
  CODE_B9E6F4,
  CODE_B9E705,
  CODE_B9E713,
  CODE_B9E720,
  CODE_B9E72F,
  CODE_B9E73B,
  CODE_B9E73F,
  CODE_B9E781,
  CODE_B9E794,
  CODE_B9E7D9,
  turn_flotsam_if_needed,
  CODE_B9E7E4,
  CODE_B9E7F2,
  CODE_B9E80C,
  CODE_B9E816,
  CODE_B9E825,
  CODE_B9E860,
  CODE_B9E87E,
  CODE_B9E887,
  CODE_B9E898,
  CODE_B9E8E3,
  CODE_B9E8EC,
  CODE_B9E8F1,
  CODE_B9E8F4,
  CODE_B9E8FD,
  CODE_B9E902,
  CODE_B9E909,
  CODE_B9E913,
  CODE_B9E937,
  CODE_B9E950,
  CODE_B9E958,
  CODE_B9E96E,
  turn_kutlass_if_needed,
  CODE_B9E978,
  CODE_B9E9B0,
  CODE_B9E9BD,
  turn_krook_if_needed,
  spawn_krooks_hook,
  CODE_B9E9E1,
  CODE_B9E9EF,
  CODE_B9E9FA,
  CODE_B9EA07,
  CODE_B9EA1A,
  CODE_B9EA29,
  CODE_B9EA2F,
  CODE_B9EA32,
  CODE_B9EA38,
  spawn_cat_o9_tails_dizzy_stars,
  CODE_B9EA4E,
  CODE_B9EA9E,
  CODE_B9EAAF,
  turn_kloak_if_needed,
  CODE_B9EAD0,
  CODE_B9EADD,
  CODE_B9EAEA,
  CODE_B9EAFC,
  CODE_B9EB08,
  CODE_B9EB0F,
  set_krochead_bounce_interaction,
  CODE_B9EB2C,
  CODE_B9EB39,
  CODE_B9EB6C,
  CODE_B9EB88,
  CODE_B9EB96,
  CODE_B9EB9D,
  CODE_B9EBA4,
  CODE_B9EC23,
  CODE_B9EC30,
  CODE_B9EC36,
  CODE_B9EC4A,
  CODE_B9EC67,
  CODE_B9ECED,
  CODE_B9ECF5,
  turn_screech_if_needed,
  CODE_B9ED20,
  CODE_B9ED6F,
  CODE_B9ED78,
  CODE_B9ED8D,
  CODE_B9ED95,
  CODE_B9EDA2,
  CODE_B9EDB9,
  CODE_B9EDCE,
  CODE_B9EDD4,
  CODE_B9EDDB,
  CODE_B9EDEC,
  CODE_B9EDF1,
  CODE_B9EDF9,
  CODE_B9EDFF,
  CODE_B9EE0B,
  CODE_B9EE10,
  CODE_B9EE18,
  CODE_B9EE1E,
  turn_glimmer_if_needed,
  CODE_B9EE40,
});
