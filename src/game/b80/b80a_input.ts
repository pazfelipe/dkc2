/**
 * Bank $80 — controller input, pause and the demo (attract mode) input player.
 *
 * input_and_pause_handler runs once per gameplay frame. It reads both joypads (or plays back the
 * demo script), picks the inputs of the controller that drives the active Kong, applies the
 * "inverted controls" effect, and handles pausing. Its result tells the caller whether the game
 * is paused this frame (Z clear / A != 0 = paused).
 */
import { r16, w16, ioR8, ioR16, bus16 } from "../../core/mem";
import { reg, register } from "../../core/cpu";
import { frameEnded, setRetMode, RET_RTS } from "../../core/hybrid";
import { waitUntil } from "../../core/ops";
import { L, R, C, CPU, joypad } from "../../core/sym";
import { play_high_priority_sound } from "./b80a_util";
import {
  is_level_cleared,
  CODE_BBBDC4,
  disable_screen,
  set_game_mode_and_return,
  init_file_select,
} from "../../gen/routines";

const INVERTED_DPAD = L("DATA_808B90");
const CHEAT_BUTTONS = L("input_and_pause_handler_global_cheat_buttons");
const CHEAT_BUTTONS_NEXT = L("input_and_pause_handler_global_cheat_buttons_next");
const CODE_8086F6_PTR = L("CODE_8086F6") & 0xffff;

/** Index of the debug exit cheat sequence (Y+Right, A+Left, B+Up, X+Down, Start while paused). */
const DEBUG_CHEAT_INDEX = 0x19d6;
const SLOW_TIMER = 0x0927;
const SLOW_STEP = 0x0925;

const sound = (channel: number, effect: number) => (channel << 8) | effect;

/** $80897C — long wrapper (DB is preserved). */
export function input_and_pause_handler_global() {
  const db = reg.db;
  input_and_pause_handler();
  reg.db = db;
}

/** $808988 — read the inputs for this frame and handle pause. Returns Z set when not paused. */
export function input_and_pause_handler() {
  reg.db = 0x80;
  // wait for the auto-joypad read to finish
  waitUntil(() => (ioR8(CPU.ppu_status) & 0x01) === 0);
  if (r16(R.demo_status)) {
    // .demo_input_handler: the demo script plays player 1 (may end the demo and the frame)
    CODE_809025();
    if (frameEnded) return;
    reg.db = 0x80;
  } else if (!readControllers()) {
    // slowed down this frame: inputs are not refreshed and START is ignored
    return handleInvertedControlsAndPause();
  }
  selectActiveInputs();
  handleInvertedControlsAndPause();
}

/**
 * Read both joypads into held/pressed/released, unless the "slow" effect (RAM_0B02 bit 5)
 * skips this frame. Returns false when the frame was skipped.
 */
function readControllers(): boolean {
  if (r16(R.RAM_0B02) & 0x0020) {
    const t = r16(SLOW_TIMER);
    if (t & 0x8000) {
      w16(SLOW_TIMER, (t + 0x0100) & 0xffff);
      w16(R.RAM_0B02, r16(R.RAM_0B02) | 0x0002);
      w16(R.player_active_pressed, r16(R.player_active_pressed) & 0xefff);
      return false;
    }
    // .update_slow_timer_and_inputs
    w16(SLOW_TIMER, (t - r16(SLOW_STEP)) & 0xffff);
  }
  // .update_player_inputs
  updatePad(CPU.port_0_data_1, R.player_1_held, R.player_1_pressed, R.player_1_released);
  updatePad(CPU.port_1_data_1, R.player_2_held, R.player_2_pressed, R.player_2_released);
  CODE_808BB0();
  return true;
}

function updatePad(port: number, held: number, pressed: number, released: number) {
  const now = ioR16(port);
  const before = r16(held);
  w16(pressed, (now ^ before) & ioR16(port));
  w16(released, (now ^ before) & before);
  w16(held, now);
}

/** .CODE_808A00 — choose which controller drives the active Kong. */
function selectActiveInputs() {
  const mode = r16(R.current_game_mode);
  let x: number;
  if (mode === 0) x = 0; // 1 player
  else if (mode === 1) x = r16(R.active_controller_number) & 0x0002; // 2 player team: per Kong
  else x = (r16(R.active_controller) << 1) & 0xffff; // 2 player contest: whose turn it is
  w16(R.player_active_held, r16(R.player_1_held + x));
  w16(R.player_active_pressed, r16(R.player_1_pressed + x));
}

/** .handle_inverted_controls / .handle_paused */
function handleInvertedControlsAndPause() {
  if (r16(R.RAM_0B02) & 0x0010) {
    // inverted controls: remap the D-pad bits through DATA_808B90 (swaps left/right)
    w16(R.player_active_held, invertDpad(r16(R.player_active_held)));
    w16(R.player_active_pressed, invertDpad(r16(R.player_active_pressed)));
  }
  // .handle_paused
  if (!(r16(R.game_state_flags) & 0x0040)) {
    const f2 = r16(R.game_state_flags_2);
    w16(R.game_state_flags_2, f2 & ~0x0010);
    if (!(f2 & 0x0010)) {
      // not paused
      reg.a = 0;
      reg.z = true;
      return;
    }
    // .paused: a pause was requested this frame
    w16(R.game_state_flags, r16(R.game_state_flags) | 0x0040);
    playPauseSound();
    w16(R.last_spc_command_transfer_time, r16(R.active_frame_counter));
  }
  pausedFrame();
}

function invertDpad(v: number): number {
  const t = bus16(INVERTED_DPAD + (((v >> 8) & 0x0f) << 1));
  return ((t ^ v) & 0x0f00) ^ v;
}

function playPauseSound() {
  for (const ch of [7, 6, 5, 4]) {
    reg.a = sound(ch, C.sound_pause);
    play_high_priority_sound();
  }
}

/** .CODE_808AB4 — a frame while paused: START resumes, SELECT exits a cleared level. */
function pausedFrame() {
  if (r16(R.player_active_pressed) & C.input_start) return unpauseGame();
  // the gameplay frame counter does not run while paused (undo the increment)
  const lo = r16(R.gameplay_frame_counter);
  w16(R.gameplay_frame_counter, (lo - 1) & 0xffff);
  if (lo === 0) w16(R.gameplay_frame_counter_high, (r16(R.gameplay_frame_counter_high) - 1) & 0xffff);
  if (r16(R.player_active_pressed) & C.input_select) {
    reg.a = r16(R.parent_level_number);
    is_level_cleared();
    if (reg.c) {
      // SELECT on an already cleared level: leave it (ends the frame)
      w16(R.game_state_flags, r16(R.game_state_flags) & ~0x0040);
      CODE_BBBDC4();
      return;
    }
  }
  // .handle_debug_exit_cheat
  checkForDebugCheat();
  if (frameEnded) return;
  reg.a = 1;
  reg.z = false;
}

/** .unpause_game */
function unpauseGame() {
  playPauseSound();
  w16(R.used_sound_effect_channels, r16(R.used_sound_effect_channels) & ~0x00ff);
  w16(0x19b0, 0);
  w16(R.game_state_flags, r16(R.game_state_flags) & ~0x0040);
  // TRB of the pause flag, which was set: Z clear
  reg.a = 0x0040;
  reg.z = false;
}

/** .check_for_debug_cheat — Y+Right, A+Left, B+Up, X+Down, then START exits the level. */
function checkForDebugCheat() {
  let x = r16(DEBUG_CHEAT_INDEX);
  const held = r16(R.player_active_held);
  if (held === 0) return;
  const cur = bus16(CHEAT_BUTTONS + x);
  const next = bus16(CHEAT_BUTTONS_NEXT + x);
  if (held === cur) return;
  if (held !== next) {
    // any button outside the current/next combination resets the sequence
    if (~(cur | next) & held) w16(DEBUG_CHEAT_INDEX, 0);
    return;
  }
  // .activate_cheat
  x = (x + 4) & 0xffff;
  w16(DEBUG_CHEAT_INDEX, x);
  if (bus16(CHEAT_BUTTONS_NEXT + x) !== C.input_start) return;
  disable_screen();
  reg.a = sound(5, C.sound_swap_kongs);
  play_high_priority_sound();
  // .waste_cpu_time: 65536 calls of .stall_for_time (a CPU-time delay; ported logic takes no
  // emulated time, so it is a no-op here)
  w16(R.game_state_flags, r16(R.game_state_flags) & ~0x0040);
  CODE_BBBDC4();
}

/**
 * $808BB0 — controller presence checks after the auto-read. A pad whose signature bits are not
 * those of a standard controller is flushed (16 serial reads) and ignored; a port whose serial
 * data line reads 0 (nothing plugged in) is ignored too. $32 = 1 when player 2 was ignored.
 */
export function CODE_808BB0() {
  w16(0x32, 0);
  if (r16(R.player_1_held) & 0x0007) {
    reg.y = 0x10;
    return CODE_808BBF();
  }
  CODE_808BCF();
}

/** $808BBF — flush the serial data of port 0 (Y reads) and ignore player 1. */
export function CODE_808BBF() {
  do {
    ioR8(joypad.port_0);
    reg.y = (reg.y - 1) & 0xffff;
  } while (reg.y !== 0);
  w16(R.player_1_held, 0);
  w16(R.player_1_pressed, 0);
  CODE_808BE1();
}

/** $808BCF — ignore player 1 when nothing is plugged into port 0. */
export function CODE_808BCF() {
  const v = ioR8(joypad.port_0);
  reg.a = (reg.a & 0xff00) | v;
  if (!(v & 1)) {
    w16(R.player_1_held, 0);
    w16(R.player_1_pressed, 0);
  }
  CODE_808BE1();
}

/** $808BE1 — same checks for player 2. */
export function CODE_808BE1() {
  if (r16(R.player_2_held) & 0x0007) {
    reg.y = 0x10;
    return CODE_808BEE();
  }
  CODE_808BFE();
}

/** $808BEE — flush the serial data of port 1 (Y reads) and ignore player 2. */
export function CODE_808BEE() {
  do {
    ioR8(joypad.port_1);
    reg.y = (reg.y - 1) & 0xffff;
  } while (reg.y !== 0);
  w16(R.player_2_held, 0);
  w16(R.player_2_pressed, 0);
  CODE_808C10();
}

/** $808BFE — ignore player 2 when nothing is plugged into port 1. */
export function CODE_808BFE() {
  const v = ioR8(joypad.port_1);
  reg.a = (reg.a & 0xff00) | v;
  if (v & 1) return CODE_808C12();
  w16(R.player_2_held, 0);
  w16(R.player_2_pressed, 0);
  CODE_808C10();
}

/** $808C10 — flag player 2 as absent. */
export function CODE_808C10() {
  w16(0x32, (r16(0x32) + 1) & 0xffff);
  CODE_808C12();
}

/** $808C12 */
export function CODE_808C12() {}

// ---------------------------------------------------------------------------------------------
// Demo (attract mode) input playback

/**
 * $809025 — demo input: player 1's real buttons only matter for START/SELECT/B... ($D000) to
 * abort the demo; otherwise the next entry of the demo script ($FE:demo_sequence_address,
 * [buttons, frames] pairs) is played as player 1's input.
 */
export function CODE_809025() {
  reg.db = 0x80;
  const savedHeld = r16(R.player_1_held);
  const savedPressed = r16(R.player_1_pressed);
  // read the real pad (only to look for an abort button)
  const now = ioR16(CPU.port_0_data_1);
  w16(R.player_1_pressed, (now ^ savedHeld) & ioR16(CPU.port_0_data_1));
  w16(R.player_1_released, (now ^ savedHeld) & savedHeld);
  w16(R.player_1_held, now);
  const real = r16(R.player_1_held);
  w16(R.player_1_pressed, savedPressed);
  w16(R.player_1_held, savedHeld);
  reg.x = real;
  reg.a = real;
  if (real & 0xd000) return CODE_8090AA();
  const idx = r16(R.demo_sequence_index);
  // BPL after CMP: signed comparison result of (index - size)
  if (!((idx - r16(R.demo_sequence_size)) & 0x8000)) return CODE_8090A0();
  w16(0x36, r16(R.demo_sequence_address));
  w16(0x38, 0x00fe);
  reg.y = idx;
  if (r16(R.demo_input_timer) === 0) {
    // next script entry: [buttons, duration]
    reg.y = (reg.y + 4) & 0xffff;
    w16(R.demo_sequence_index, reg.y);
    w16(R.demo_input_timer, bus16(scriptAddr(reg.y + 2)));
  }
  CODE_809088();
}

/** [$36],y with the 24-bit pointer at $36 (bank $FE) */
function scriptAddr(y: number): number {
  return ((((r16(0x38) & 0xff) << 16) | r16(0x36)) + (y & 0xffff)) & 0xffffff;
}

/** $809088 — play the current demo script entry (Y = index) as player 1's input. */
export function CODE_809088() {
  w16(R.demo_input_timer, (r16(R.demo_input_timer) - 1) & 0xffff);
  const buttons = bus16(scriptAddr(reg.y));
  w16(0x32, buttons);
  reg.x = buttons;
  w16(R.player_1_pressed, (buttons ^ r16(R.player_1_held)) & buttons);
  w16(R.player_1_held, buttons);
  reg.a = buttons;
  // PLB restores the caller's bank pushed after PHK: still $80
  reg.db = 0x80;
}

/** $8090A0 — the demo script ran out: restart the attract sequence (ends the frame). */
export function CODE_8090A0() {
  CODE_8090B1();
  reg.a = CODE_8086F6_PTR;
  set_game_mode_and_return();
}

/** $8090AA — the player pressed a button during the demo: go to the file select screen. */
export function CODE_8090AA() {
  CODE_8090B1();
  init_file_select();
}

/** $8090B1 — leave demo mode. */
export function CODE_8090B1() {
  w16(R.game_state_flags_2, r16(R.game_state_flags_2) & ~0x8000);
  w16(R.demo_status, 0);
  reg.a = 0x8000;
}

/** $8090CD — single player, controller 1. */
export function reset_controller_state() {
  w16(R.active_controller, 0);
  w16(R.current_game_mode, 0);
  w16(R.active_controller_number, 1);
  reg.a = 1;
}

// input_and_pause_handler has no stub of its own (it is the JSR entry inside the _global
// wrapper): make original callers that trap into it return with RTS.
setRetMode(L("input_and_pause_handler"), RET_RTS);

register({
  input_and_pause_handler_global,
  input_and_pause_handler,
  CODE_808BB0,
  CODE_808BBF,
  CODE_808BCF,
  CODE_808BE1,
  CODE_808BEE,
  CODE_808BFE,
  CODE_808C10,
  CODE_808C12,
  CODE_809025,
  CODE_809088,
  CODE_8090A0,
  CODE_8090AA,
  CODE_8090B1,
  reset_controller_state,
});
