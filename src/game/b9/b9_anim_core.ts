/**
 * Bank $B9 — sprite animation system: animation setters and the animation script interpreter.
 *
 * Every sprite has an animation script (ROM data in bank $F9, selected by animation id through
 * `animation_scripts_table`) and a position in it (`sprite.animation_address`). A script is a
 * byte stream of entries:
 *   - `dd gggg`  (dd < $80): show graphic gggg for dd frames (in units of 256 timer ticks),
 *   - `80..94 ...`: commands (jumps, subroutine calls, code callbacks, sounds, ...).
 * Each frame `process_sprite_animation` subtracts `animation_speed` from `animation_timer`; when
 * it runs out the script is advanced to the next graphic. `animation_routine` is an optional
 * callback (command 84) run after the script on every frame.
 *
 * Calling convention of the interpreter (kept from the original so callbacks can jump back in):
 * X = current sprite, Y = script pointer (pointing at the duration/command byte of the entry),
 * DB = $F9. Callbacks used by command 83 continue by calling `process_anim_script` (keep going
 * with Y) or `CODE_B9D12B` (stop here for this frame).
 */
import { r16, w16, rom16 } from "../../core/mem";
import { reg, register, callPtr } from "../../core/cpu";
import { L, R, sprite, kong_control, C } from "../../core/sym";
import { check_if_sprite_offscreen_global } from "../../gen/routines";
import { pushDb, popDb, dbRead16, dbWrite16, queue_sound_effect } from "./b9_anim_util";

const ANIMATION_SCRIPTS_TABLE = L("animation_scripts_table");
const ANIMATION_FLAGS_TABLE = L("animation_flags_table");
const SCRIPT_BANK = ANIMATION_SCRIPTS_TABLE >> 16;
const CODE_BANK = 0xb9;
/** `%pea_mirror_dbr()` in bank $B9 pushes $F980: DB=$80 after the first PLB, $F9 after the second. */
const MIRROR_DB_LOW = 0x80;
const MIRROR_DB_HIGH = (CODE_BANK | 0x40) & 0xff;

// ---------------------------------------------------------------------------------------------
// Animation setters
// ---------------------------------------------------------------------------------------------

/** $B9D000 — A = animation id: set an animation on the inactive (following) Kong, Dixie-aware. */
export function set_inactive_kong_anim_handle_dixie() {
  const id = reg.a;
  const savedControl = r16(R.current_kong_control_variables);
  const savedSprite = r16(R.current_sprite);
  w16(R.current_kong_control_variables, r16(R.inactive_kong_control_variables));
  w16(R.current_sprite, r16(R.inactive_kong_sprite));
  reg.a = id;
  set_anim_handle_dixie();
  w16(R.current_sprite, savedSprite);
  w16(R.current_kong_control_variables, savedControl);
  reg.a = savedControl;
}

/** $B9D01D — A = animation id: set an animation on the inactive Kong (no Dixie offset). */
export function set_inactive_kong_anim() {
  const id = reg.a;
  const savedControl = r16(R.current_kong_control_variables);
  const savedSprite = r16(R.current_sprite);
  w16(R.current_kong_control_variables, r16(R.inactive_kong_control_variables));
  w16(R.current_sprite, r16(R.inactive_kong_sprite));
  reg.a = id;
  set_sprite_animation();
  w16(R.current_sprite, savedSprite);
  w16(R.current_kong_control_variables, savedControl);
  reg.a = savedControl;
}

/** $B9D03A — A = base animation id: throwable sprites share animation tables, offset by type. */
export function set_anim_handle_throwable() {
  w16(0x26, reg.a);
  const x = r16(R.current_sprite);
  const typeIndex = ((r16(x + sprite.type) - C.throwable_sprite_range_start) & 0xffff) >> 2;
  reg.a = (typeIndex + reg.a) & 0xffff;
  set_sprite_animation();
}

/**
 * $B9D04B — A = base animation id: animate the animal buddy the active Kong rides. The animal
 * uses the Kong's control variables (so Dixie gets her own variant), but the Kong's own
 * `kong_control.animation_id` is preserved.
 */
export function set_riding_kong_anim_handle_dixie() {
  w16(0x32, reg.a);
  const control = r16(R.active_kong_control_variables);
  w16(R.current_kong_control_variables, control);
  const savedAnimId = r16(control + kong_control.animation_id);
  const savedSprite = r16(R.current_sprite);
  const mount = r16(R.current_player_mount);
  if (mount) {
    w16(R.current_sprite, mount);
    const typeIndex = ((r16(mount + sprite.type) - C.animal_sprite_type_range_start) & 0xffff) >> 2;
    reg.a = (typeIndex + r16(0x32)) & 0xffff;
    set_anim_handle_dixie();
  }
  w16(R.current_sprite, savedSprite);
  w16(control + kong_control.animation_id, savedAnimId);
  reg.a = savedAnimId;
  reg.x = savedSprite;
}

/** $B9D07B — A = base animation id, offset by the current sprite's animal type. */
export function set_anim_handle_animal() {
  w16(0x32, reg.a);
  const x = r16(R.current_sprite);
  const typeIndex = ((r16(x + sprite.type) - C.animal_sprite_type_range_start) & 0xffff) >> 2;
  reg.a = (typeIndex + reg.a) & 0xffff;
  set_sprite_animation();
}

/** $B9D08C — A = base animation id, offset by the animal the player is (animal_type), Dixie-aware. */
export function set_anim_handle_animal_and_dixie() {
  w16(0x26, reg.a);
  const typeIndex = ((r16(R.animal_type) - C.animal_sprite_type_range_start) & 0xffff) >> 2;
  reg.a = (typeIndex + reg.a) & 0xffff;
  set_anim_handle_dixie();
}

/** $B9D09B — A = animation id: set an animation on `alternate_sprite`. */
export function set_alt_sprite_animation() {
  const id = reg.a;
  const savedCurrent = r16(R.current_sprite);
  const alt = r16(R.alternate_sprite);
  w16(R.current_sprite, alt);
  reg.a = id;
  set_sprite_animation();
  w16(R.alternate_sprite, alt);
  w16(R.current_sprite, savedCurrent);
  reg.a = savedCurrent;
}

/** $B9D0B0 — like set_anim_handle_dixie, but does nothing if the Kong already has that animation. */
export function set_anim_once_handle_dixie() {
  const y = r16(R.current_kong_control_variables);
  reg.y = y;
  if ((reg.a & 0xffff) === dbRead16(y + kong_control.animation_id)) return;
  set_anim_handle_dixie();
}

/**
 * $B9D0B8 — A = Kong animation id (Diddy numbering). Remembers it in the Kong's control
 * variables and, for Dixie, switches to her copy of the animation.
 */
export function set_anim_handle_dixie() {
  const y = r16(R.current_kong_control_variables);
  reg.y = y;
  dbWrite16(y + kong_control.animation_id, reg.a);
  if (y !== R.diddy_control_variables) reg.a = (reg.a + C.dixie_animation_id_start) & 0xffff;
  set_sprite_animation();
}

/** $B9D0C6 — A = animation id: start that animation on the current sprite and run its first step. */
export function set_sprite_animation() {
  pushDb(SCRIPT_BANK);
  const x = r16(R.current_sprite);
  const id = reg.a & 0xffff;
  w16(x + sprite.animation_id, id);
  w16(x + sprite.animation_speed, C.default_animation_speed);
  w16(x + sprite.animation_timer, 0);
  w16(x + sprite.animation_routine, 0);
  const index = (id << 2) & 0xffff;
  const flags = rom16(ANIMATION_FLAGS_TABLE + index);
  w16(0x26, flags);
  const script = rom16(ANIMATION_SCRIPTS_TABLE + index);
  w16(x + sprite.animation_address, script);
  w16(x + sprite.animation_flags, flags);
  reg.a = flags;
  reg.x = x;
  reg.y = script;
  process_anim_script();
}

/** $B9D0F3 — process the current sprite's animation without letting callbacks change its state. */
export function process_anim_preserve_state() {
  const state = r16(r16(R.current_sprite) + sprite.state);
  process_sprite_animation();
  w16(reg.x + sprite.state, state);
  reg.a = state;
}

// ---------------------------------------------------------------------------------------------
// The interpreter
// ---------------------------------------------------------------------------------------------

/** $B9D100 — advance the current sprite's animation by one frame. Returns X = current sprite. */
export function process_sprite_animation() {
  const x = r16(R.current_sprite);
  reg.x = x;
  const timer = (r16(x + sprite.animation_timer) - r16(x + sprite.animation_speed)) & 0xffff;
  w16(x + sprite.animation_timer, timer);
  if (timer !== 0 && !(timer & 0x8000)) {
    // the current graphic is still being shown
    CODE_B9D13E();
    return;
  }
  pushDb(SCRIPT_BANK);
  reg.y = r16(x + sprite.animation_address);
  process_anim_script();
}

/**
 * $B9D115 — interpret script entries from Y until a graphic is displayed (or a command stops).
 * Durations accumulate into the timer, so a slow sprite can skip several graphics at once.
 */
export function process_anim_script() {
  const x = reg.x;
  let y = reg.y & 0xffff;
  for (;;) {
    y = (y - 1) & 0xffff;
    const word = dbRead16(y);
    if (word & 0x8000) {
      reg.a = word;
      reg.y = y;
      animation_command_handler();
      return;
    }
    const timer = ((word & 0xff00) + r16(x + sprite.animation_timer)) & 0xffff;
    w16(x + sprite.animation_timer, timer);
    if (!(timer & 0x8000)) {
      reg.y = y;
      CODE_B9D131();
      return;
    }
    // this graphic's time is already used up: skip to the next entry
    y = (y + 4) & 0xffff;
  }
}

/** $B9D12B — stop interpreting for this frame (used by command 83 "wait until" callbacks). */
export function CODE_B9D12B() {
  const x = r16(R.current_sprite);
  reg.x = x;
  w16(x + sprite.animation_timer, 0);
  CODE_B9D13D();
}

/** $B9D131 — Y = entry - 1: display the entry's graphic and remember the next entry. */
export function CODE_B9D131() {
  const x = reg.x;
  let y = (reg.y + 2) & 0xffff;
  w16(x + sprite.current_graphic, dbRead16(y));
  y = (y + 2) & 0xffff;
  w16(x + sprite.animation_address, y);
  reg.y = y;
  reg.a = y;
  CODE_B9D13D();
}

/** $B9D13D — end of script processing: restore the caller's data bank, then the routine. */
export function CODE_B9D13D() {
  popDb();
  CODE_B9D13E();
}

/** $B9D13E — run the sprite's continuous animation routine (command 84), if any. */
export function CODE_B9D13E() {
  const routine = r16(reg.x + sprite.animation_routine);
  reg.a = routine;
  if (!routine) return;
  CODE_B9D143();
}

/** $B9D143 — A = animation routine: call it with DB = $B9, preserving X. */
export function CODE_B9D143() {
  const routine = reg.a & 0xffff;
  w16(0x26, routine);
  pushDb(CODE_BANK);
  const x = reg.x;
  callPtr(CODE_BANK, routine);
  reg.x = x;
  CODE_B9D14F();
}

/** $B9D14F — return point of the animation routine: restore the data bank. */
export function CODE_B9D14F() {
  popDb();
}

// ---------------------------------------------------------------------------------------------
// Commands. Entered with Y = address of the command byte, X clobbered.
// ---------------------------------------------------------------------------------------------

/** $B9D152 — A = word whose high byte is the command (80..94): dispatch it. */
export function animation_command_handler() {
  reg.y = (reg.y + 1) & 0xffff;
  const index = ((((reg.a & 0xff00) >> 8) - 0x80) << 1) & 0xffff;
  reg.a = index;
  reg.x = index;
  reg.c = false; // carry left by ASL A (callbacks reached through 81/83 see it)
  const handler = COMMANDS[index >> 1];
  if (handler && index < COMMANDS.length * 2) handler();
  else callPtr(CODE_BANK, rom16(L("animation_command_table") + index));
}

/** $B9D160 — commands 80/94: restart the current animation from its first entry (loop). */
export function animation_command_80_94() {
  const x = r16(R.current_sprite);
  const script = rom16(ANIMATION_SCRIPTS_TABLE + ((r16(x + sprite.animation_id) << 2) & 0xffff));
  w16(x + sprite.animation_address, script);
  reg.x = x;
  reg.y = script;
  process_anim_script();
}

/**
 * $B9D172 — command 81 pppp: call code pppp (RTS, DB=$B9), then continue the script unless the
 * code changed the animation (e.g. by starting a new one).
 */
export function animation_command_81() {
  const x = r16(R.current_sprite);
  let y = (reg.y + 1) & 0xffff;
  const code = dbRead16(y);
  w16(0x26, code);
  y = (y + 2) & 0xffff;
  const resume = y;
  w16(x + sprite.animation_address, y);
  pushDb(CODE_BANK);
  reg.a = y;
  reg.x = x;
  reg.y = y;
  callPtr(CODE_BANK, code);
  // .animation_code_return
  popDb();
  w16(0x52, resume);
  const sx = r16(R.current_sprite);
  const now = r16(sx + sprite.animation_address);
  reg.x = sx;
  reg.y = now;
  reg.a = now;
  if (now !== resume) {
    // .stop_processing_script
    popDb();
    return;
  }
  process_anim_script();
}

/** $B9D19B — command 82 pppp: jump to script address pppp. */
export function animation_command_82() {
  reg.x = r16(R.current_sprite);
  reg.y = dbRead16(reg.y + 1);
  process_anim_script();
}

/**
 * $B9D1A5 — command 83 pppp: jump to code pppp with DB still $F9. The animation address stays
 * on this command, so the code is re-run every frame until it lets the script continue.
 */
export function animation_command_83() {
  const x = r16(R.current_sprite);
  const y = reg.y & 0xffff;
  w16(x + sprite.animation_address, y);
  const code = dbRead16(y + 1);
  w16(0x26, code);
  reg.a = code;
  reg.x = x;
  reg.y = (y + 3) & 0xffff;
  callPtr(CODE_BANK, code);
}

/** $B9D1B5 — command 84 pppp: install pppp as the sprite's per-frame animation routine. */
export function animation_command_84() {
  const x = r16(R.current_sprite);
  w16(x + sprite.animation_routine, dbRead16(reg.y + 1));
  reg.x = x;
  reg.y = (reg.y + 3) & 0xffff;
  process_anim_script();
}

/** $B9D1C2 — command 8E ssss: queue sound effect ssss. */
export function animation_command_8E() {
  const y = reg.y & 0xffff;
  reg.x = r16(R.current_sprite);
  reg.a = dbRead16(y + 1);
  queue_sound_effect();
  reg.y = (y + 3) & 0xffff;
  reg.x = r16(R.current_sprite);
  process_anim_script();
}

/** $B9D1D5 — command 93 ssss: queue sound effect ssss if the sprite is on screen. */
export function animation_command_93() {
  const y = reg.y & 0xffff;
  const x = r16(R.current_sprite);
  const sound = dbRead16(y + 1);
  const saved = reg.db;
  reg.db = MIRROR_DB_LOW;
  reg.x = x;
  reg.a = sound;
  check_if_sprite_offscreen_global();
  if (!reg.c) {
    reg.a = sound;
    queue_sound_effect();
  }
  void saved;
  reg.db = MIRROR_DB_HIGH;
  reg.a = sound;
  reg.y = (y + 3) & 0xffff;
  reg.x = r16(R.current_sprite);
  process_anim_script();
}

/** $B9D1F5 — command 8F pppp jjjj: call condition pppp (carry); if set, jump to script jjjj. */
export function animation_command_8F() {
  const x = r16(R.current_sprite);
  let y = (reg.y + 1) & 0xffff;
  const code = dbRead16(y);
  w16(0x26, code);
  y = (y + 2) & 0xffff;
  w16(x + sprite.animation_address, y);
  pushDb(CODE_BANK);
  reg.a = y;
  reg.x = x;
  reg.y = y;
  callPtr(CODE_BANK, code);
  const taken = reg.c;
  popDb();
  const sx = r16(R.current_sprite);
  const at = r16(sx + sprite.animation_address);
  const target = dbRead16(at);
  reg.x = sx;
  reg.a = target;
  reg.y = taken ? target : (at + 2) & 0xffff;
  process_anim_script();
}

/** $B9D21E — command 90 pppp nnnn: call code pppp, then switch to animation id nnnn. */
export function animation_command_90() {
  const x = r16(R.current_sprite);
  let y = (reg.y + 1) & 0xffff;
  const code = dbRead16(y);
  w16(0x26, code);
  y = (y + 2) & 0xffff;
  w16(x + sprite.animation_address, y);
  pushDb(CODE_BANK);
  reg.a = y;
  reg.x = x;
  reg.y = y;
  callPtr(CODE_BANK, code);
  popDb();
  const sx = r16(R.current_sprite);
  const at = r16(sx + sprite.animation_address);
  reg.x = sx;
  reg.y = at;
  reg.a = dbRead16(at);
  popDb();
  set_sprite_animation();
}

/** $B9D240 — command 91 vv pppp: script subroutine call; return address saved in sprite field vv. */
export function animation_command_91() {
  const y = reg.y & 0xffff;
  const slot = ((dbRead16(y + 1) & 0xff) + r16(R.current_sprite)) & 0xffff;
  const target = dbRead16(y + 2);
  w16(slot, (y + 4) & 0xffff);
  reg.a = target;
  reg.y = target;
  reg.x = r16(R.current_sprite);
  process_anim_script();
}

/** $B9D259 — command 92 vv: return from a script subroutine (address in sprite field vv). */
export function animation_command_92() {
  const y = reg.y & 0xffff;
  const slot = ((dbRead16(y + 1) & 0xff) + r16(R.current_sprite)) & 0xffff;
  reg.a = slot;
  reg.y = r16(slot);
  reg.x = r16(R.current_sprite);
  process_anim_script();
}

/**
 * Shared head of the "draw" commands 85-8D: add the entry's duration to the timer.
 * Returns true when the graphic is to be displayed (timer not negative).
 */
function addDrawTime(x: number, y: number): boolean {
  const timer = ((dbRead16(y) & 0xff00) + r16(x + sprite.animation_timer)) & 0xffff;
  w16(x + sprite.animation_timer, timer);
  reg.a = timer;
  return !(timer & 0x8000);
}

/** The player is riding an animal and the current sprite is the active Kong. */
function activeKongOnMount(): boolean {
  if (!r16(R.current_player_mount)) return false;
  return r16(R.active_kong_sprite) === r16(R.current_sprite);
}

/** The player holds a sprite and the current sprite is the active Kong. */
function activeKongHolding(): boolean {
  if (!r16(R.current_held_sprite)) return false;
  return r16(R.active_kong_sprite) === r16(R.current_sprite);
}

/** Finish a draw command of `size` bytes: store the next entry and end processing. */
function finishDraw(y: number, size: number) {
  const x = r16(R.current_sprite);
  const next = (y + size) & 0xffff;
  w16(x + sprite.animation_address, next);
  reg.x = x;
  reg.a = next;
  CODE_B9D13D();
}

/** Skip a draw command of `size` bytes whose time is already used up. */
function skipDraw(y: number, size: number) {
  reg.y = (y + size) & 0xffff;
  process_anim_script();
}

/**
 * $B9D26B — command 85 dd aaaa bbbb: graphic aaaa on the sprite and bbbb on the ridden animal
 * (only used when Diddy mounts Enguarde; leftover from DKC1).
 */
export function animation_command_85() {
  const x = r16(R.current_sprite);
  const y = reg.y & 0xffff;
  reg.x = x;
  if (!addDrawTime(x, y)) return skipDraw(y, 6);
  w16(x + sprite.current_graphic, dbRead16(y + 2));
  if (activeKongOnMount()) {
    const mount = r16(R.current_player_mount);
    w16(mount + sprite.current_graphic, dbRead16(y + 4));
    w16(mount + sprite.animation_speed, 0);
  }
  finishDraw(y, 6);
}

/** Command 86/87/88 helper: ride offset of the Kong on its animal ($0D76/$0D78). */
function setRideOffset(dx: number, dy: number) {
  w16(0x0d76, (dx + r16(0x0d72)) & 0xffff);
  w16(0x0d78, (dy + r16(0x0d74)) & 0xffff);
}

/** $B9D2AA — command 86 dd aaaa bbbb xxxx yyyy: like 85, plus the Kong's ride offset. */
export function animation_command_86() {
  const x = r16(R.current_sprite);
  const y = reg.y & 0xffff;
  reg.x = x;
  if (!addDrawTime(x, y)) return skipDraw(y, 10);
  w16(x + sprite.current_graphic, dbRead16(y + 2));
  if (activeKongOnMount()) {
    const mount = r16(R.current_player_mount);
    setRideOffset(dbRead16(y + 6), dbRead16(y + 8));
    w16(mount + sprite.current_graphic, dbRead16(y + 4));
    w16(mount + sprite.animation_speed, 0);
  }
  finishDraw(y, 10);
}

/** $B9D305 — command 87 dd aaaa xxxx yyyy: graphic aaaa, plus the Kong's ride offset. */
export function animation_command_87() {
  const x = r16(R.current_sprite);
  const y = reg.y & 0xffff;
  reg.x = x;
  if (!addDrawTime(x, y)) return skipDraw(y, 8);
  w16(x + sprite.current_graphic, dbRead16(y + 2));
  if (activeKongOnMount()) setRideOffset(dbRead16(y + 4), dbRead16(y + 6));
  finishDraw(y, 8);
}

/** $B9D356 — command 88 xxxx yyyy: set the Kong's ride offset only. */
export function animation_command_88() {
  const y = reg.y & 0xffff;
  if (activeKongOnMount()) setRideOffset(dbRead16(y + 1), dbRead16(y + 3));
  reg.x = r16(R.current_sprite);
  reg.y = (y + 5) & 0xffff;
  process_anim_script();
}

/** $B9D387 — command 89 dd aaaa bbbb: graphic aaaa on the sprite and bbbb on the held sprite. */
export function animation_command_89() {
  const x = r16(R.current_sprite);
  const y = reg.y & 0xffff;
  reg.x = x;
  if (!addDrawTime(x, y)) return skipDraw(y, 6);
  w16(x + sprite.current_graphic, dbRead16(y + 2));
  if (activeKongHolding()) {
    const held = r16(R.current_held_sprite);
    w16(held + sprite.current_graphic, dbRead16(y + 4));
    w16(held + sprite.animation_speed, 0);
  }
  finishDraw(y, 6);
}

/**
 * $B9D3CA — command 8A dd aaaa bbbb xxxx yyyy: like 89, plus the held sprite's offset
 * ($0D7C/$0D7E). In this version the graphics are applied even when the entry is skipped.
 */
export function animation_command_8A() {
  const x = r16(R.current_sprite);
  reg.x = x;
  if (addDrawTime(x, reg.y)) return CODE_B9D3DF();
  CODE_B9D3E7();
  process_anim_script();
}

/** $B9D3DF — command 8A: graphic shown, store the next entry and stop. */
export function CODE_B9D3DF() {
  CODE_B9D3E7();
  w16(reg.x + sprite.animation_address, reg.a);
  CODE_B9D13D();
}

/** $B9D3E7 — command 8A body: apply both graphics and offsets; returns A = Y = next entry. */
export function CODE_B9D3E7() {
  const y = reg.y & 0xffff;
  w16(reg.x + sprite.current_graphic, dbRead16(y + 2));
  if (activeKongHolding()) {
    const held = r16(R.current_held_sprite);
    w16(held + sprite.current_graphic, dbRead16(y + 4));
    w16(held + sprite.animation_speed, 0);
    w16(0x0d7c, dbRead16(y + 6));
    w16(0x0d7e, dbRead16(y + 8));
  }
  CODE_B9D414();
}

/** $B9D414 — X = current sprite, A = Y = Y + 10. */
export function CODE_B9D414() {
  reg.x = r16(R.current_sprite);
  reg.a = (reg.y + 10) & 0xffff;
  reg.y = reg.a;
}

/** $B9D41D — command 8B dd aaaa xxxx yyyy: graphic aaaa, plus the held sprite's offset. */
export function animation_command_8B() {
  const x = r16(R.current_sprite);
  const y = reg.y & 0xffff;
  reg.x = x;
  if (!addDrawTime(x, y)) return skipDraw(y, 8);
  CODE_B9D437();
}

/** $B9D437 — command 8B body. */
export function CODE_B9D437() {
  const y = reg.y & 0xffff;
  w16(reg.x + sprite.current_graphic, dbRead16(y + 2));
  if (activeKongHolding()) {
    w16(0x0d7c, dbRead16(y + 4));
    w16(0x0d7e, dbRead16(y + 6));
  }
  CODE_B9D458();
}

/** $B9D458 — command 8B tail: store the next entry and stop. */
export function CODE_B9D458() {
  finishDraw(reg.y, 8);
}

/** $B9D464 — command 8C xxxx yyyy: set the held sprite's offset only. */
export function animation_command_8C() {
  const y = reg.y & 0xffff;
  if (activeKongHolding()) {
    w16(0x0d7c, dbRead16(y + 1));
    w16(0x0d7e, dbRead16(y + 3));
  }
  CODE_B9D480();
}

/** $B9D480 — command 8C tail: continue after the 5-byte command. */
export function CODE_B9D480() {
  reg.x = r16(R.current_sprite);
  reg.y = (reg.y + 5) & 0xffff;
  process_anim_script();
}

/**
 * $B9D48B — command 8D dd aaaa bbbb vvvv: graphic aaaa, and graphic bbbb on the sprite linked in
 * general_purpose_42 (whose general_purpose_44 gets vvvv).
 */
export function animation_command_8D() {
  const x = r16(R.current_sprite);
  const y = reg.y & 0xffff;
  reg.x = x;
  if (!addDrawTime(x, y)) return skipDraw(y, 8);
  CODE_B9D4A5();
}

/** $B9D4A5 — command 8D body. */
export function CODE_B9D4A5() {
  const y = reg.y & 0xffff;
  const x = reg.x;
  w16(x + sprite.current_graphic, dbRead16(y + 2));
  const linked = r16(x + sprite.general_purpose_42);
  if (linked) {
    w16(linked + sprite.current_graphic, dbRead16(y + 4));
    w16(linked + sprite.general_purpose_44, dbRead16(y + 6));
    reg.x = r16(R.current_sprite);
  }
  CODE_B9D4BB();
}

/** $B9D4BB — command 8D tail (X = current sprite). */
export function CODE_B9D4BB() {
  const next = (reg.y + 8) & 0xffff;
  w16(reg.x + sprite.animation_address, next);
  reg.a = next;
  CODE_B9D13D();
}

const COMMANDS: (() => void)[] = [
  animation_command_80_94, // 80
  animation_command_81,
  animation_command_82,
  animation_command_83,
  animation_command_84,
  animation_command_85,
  animation_command_86,
  animation_command_87,
  animation_command_88,
  animation_command_89,
  animation_command_8A,
  animation_command_8B,
  animation_command_8C,
  animation_command_8D,
  animation_command_8E,
  animation_command_8F,
  animation_command_90,
  animation_command_91,
  animation_command_92,
  animation_command_93,
  animation_command_80_94, // 94
];

register({
  set_inactive_kong_anim_handle_dixie,
  set_inactive_kong_anim,
  set_anim_handle_throwable,
  set_riding_kong_anim_handle_dixie,
  set_anim_handle_animal,
  set_anim_handle_animal_and_dixie,
  set_alt_sprite_animation,
  set_anim_once_handle_dixie,
  set_anim_handle_dixie,
  set_sprite_animation,
  process_anim_preserve_state,
  process_sprite_animation,
  process_anim_script,
  CODE_B9D12B,
  CODE_B9D131,
  CODE_B9D13D,
  CODE_B9D13E,
  CODE_B9D143,
  CODE_B9D14F,
  animation_command_handler,
  animation_command_80_94,
  animation_command_81,
  animation_command_82,
  animation_command_83,
  animation_command_84,
  animation_command_8E,
  animation_command_93,
  animation_command_8F,
  animation_command_90,
  animation_command_91,
  animation_command_92,
  animation_command_85,
  animation_command_86,
  animation_command_87,
  animation_command_88,
  animation_command_89,
  animation_command_8A,
  CODE_B9D3DF,
  CODE_B9D3E7,
  CODE_B9D414,
  animation_command_8B,
  CODE_B9D437,
  CODE_B9D458,
  animation_command_8C,
  CODE_B9D480,
  animation_command_8D,
  CODE_B9D4A5,
  CODE_B9D4BB,
});
