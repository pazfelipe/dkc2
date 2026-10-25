/**
 * Bank $BE (package BE2) — the sprite mains in the BE2 range that worlds 1-2 use:
 * camera unlock triggers, the chest spawner (Krow's/Kleever's style random Kremcoin chest) and
 * the Kremcoin cheat handler of Pirate Panic. They end with `JML [sprite_return_address]`.
 */
import { r8, r16, w8, w16, io16, io8, ioR16 } from "../../core/mem";
import { reg, register } from "../../core/cpu";
import { setRetMode, RET_SPRITE } from "../../core/hybrid";
import { L, R, C, CPU, sprite } from "../../core/sym";
import { CODE_BBBB99, get_random_number_2_global, spawn_special_sprite_address } from "../../gen/routines";
import { spriteConst, cur } from "./be2_util";

/** Camera lock table ($7E9128: one word per camera region, bit 7 = locked, low bits = state). */
const CAMERA_LOCKS = 0x7e9128;
/** Camera region trigger ids, 4 bytes per region at $7E8D28 + region*2 + $500/$600/$700. */
const CAMERA_TRIGGERS = 0x7e8d28;

/** `JMP sprite_return_handle_despawn_BE` = `JSL CODE_BBBB99 : JML [sprite_return_address]`. */
function returnHandleDespawn() {
  CODE_BBBB99();
}

/**
 * $BEEE38 — camera unlock trigger. State 0: while the Kong is inside the box around the
 * trigger ($45/$44 = left/right extent, $47/$46 = up/down) the camera region $42 is unlocked,
 * outside it is locked. Other states: clear this trigger's id from the region's trigger list
 * and update the region's lock counter, then delete the trigger.
 */
export function camera_unlock_trigger_sprite_code() {
  const x = cur();
  reg.x = x;
  if (r16(x + sprite.state) === 0) {
    const kong = r16(R.active_kong_sprite);
    reg.y = kong;
    const kx = r16(kong + sprite.x_position);
    const ky = r16(kong + sprite.y_position);
    const px = r16(x + sprite.x_position);
    const py = r16(x + sprite.y_position);
    const left = (px - r8(x + 0x45)) & 0xffff;
    const right = (r8(x + 0x44) + px) & 0xffff;
    const top = (py - r8(x + 0x47)) & 0xffff;
    const bottom = (r8(x + 0x46) + py) & 0xffff;
    const outside = left >= kx || right < kx || top >= ky || bottom < ky;
    reg.x = (r16(x + 0x42) << 1) & 0xffff;
    if (outside) {
      // .lock_camera
      reg.a = r16(CAMERA_LOCKS + reg.x) | 0x0080;
      w16(CAMERA_LOCKS + reg.x, reg.a);
      returnHandleDespawn();
      return;
    }
    reg.a = r16(CAMERA_LOCKS + reg.x) & 0xff7f;
    w16(CAMERA_LOCKS + reg.x, reg.a);
    return;
  }

  // .CODE_BEEE9D
  const y = x;
  reg.y = y;
  const region = (r16(y + 0x42) << 1) & 0xffff;
  w16(0x32, region);
  const id = r8(y + 0x44);
  /** .CODE_BEEF00: remove this trigger's id from one of the two slots of a list. */
  const clearId = (list: number) => {
    let i = (list + region) & 0xffff;
    if (r8(CAMERA_TRIGGERS + i) !== id) {
      i = (i + 1) & 0xffff;
      if (r8(CAMERA_TRIGGERS + i) !== id) {
        reg.x = i;
        return false;
      }
    }
    w8(CAMERA_TRIGGERS + i, 0);
    reg.x = i;
    return true;
  };
  if (!clearId(0x0500) && !clearId(0x0600)) {
    if (!clearId(0x0700)) {
      // .CODE_BEEEC9: 8-bit counter in steps of 4 in bits 2-3
      const xx = r16(0x32);
      reg.x = xx;
      const v = (r8(CAMERA_LOCKS + xx) - 4) & 0xff;
      w8(CAMERA_LOCKS + xx, v);
      if ((v & 0x0c) === 0) {
        w8(CAMERA_LOCKS + xx + 1, 0);
      } else if (((id - r8(CAMERA_LOCKS + xx + 1)) & 0xff) === 0) {
        // .CODE_BEEEE4
        w8(CAMERA_LOCKS + xx, (r8(CAMERA_LOCKS + xx) + 1) & 0xff);
      }
    } else {
      const xx = r16(0x32);
      reg.x = xx;
      w16(CAMERA_LOCKS + xx, (r16(CAMERA_LOCKS + xx) - 1) & 0xffff);
    }
  }
  // .delete_camera_unlock_sprite
  reg.x = cur();
  w16(reg.x + sprite.type, 0);
}

/**
 * $BEEF1F — chest spawner: on the first frame pick a random chest (1..count) to hold the
 * Kremcoin reward, then spawn all chests at the positions listed in the spawner constants
 * ($42 spawn script, $44 count, $46 normal reward, $48 Kremcoin reward, $4A the pick).
 */
export function chest_spawner_sprite_code() {
  let x = cur();
  reg.x = x;
  w16(R.current_sprite_constants, r16(x + sprite.constants_address));
  if (r16(x + sprite.state) === 0) {
    get_random_number_2_global();
    io16(CPU.dividen, reg.a);
    x = cur();
    reg.x = x;
    io8(CPU.divisor, r8(x + 0x44));
    w16(x + sprite.state, (r16(x + sprite.state) + 1) & 0xffff);
    reg.a = (ioR16(CPU.multiply_result) + 1) & 0xffff; // remainder + 1
    w16(x + 0x4a, reg.a);
  }
  for (;;) {
    reg.y = r16(x + 0x42);
    spawn_special_sprite_address();
    if (reg.c) return;
    const chest = r16(R.alternate_sprite);
    reg.x = chest;
    w16(chest + sprite.x_position, spriteConst(0));
    reg.y = 0x0002;
    w16(chest + sprite.y_position, spriteConst(2));
    x = cur();
    reg.x = x;
    let reward = r16(x + 0x46);
    if (r16(x + 0x44) === r16(x + 0x4a)) reward = r16(x + 0x48);
    reg.a = reward;
    reg.y = chest;
    w16(chest + 0x42, reward);
    reg.a = (r16(x + sprite.constants_address) + 4) & 0xffff;
    w16(x + sprite.constants_address, reg.a);
    w16(R.current_sprite_constants, reg.a);
    const n = (r16(x + 0x44) - 1) & 0xffff;
    w16(x + 0x44, n);
    if (n === 0) {
      w16(x + sprite.type, 0);
      return;
    }
  }
}

/** 16-bit decimal-mode `SEC : SBC` for valid BCD operands. */
function sbcBcd16(a: number, b: number) {
  const dec = (v: number) => ((v >> 12) & 15) * 1000 + ((v >> 8) & 15) * 100 + ((v >> 4) & 15) * 10 + (v & 15);
  const d = (dec(a) - dec(b) + 10000) % 10000;
  return ((Math.floor(d / 1000) << 12) | (Math.floor(d / 100) % 10 << 8) | (Math.floor(d / 10) % 10 << 4) | d % 10) & 0xffff;
}

/**
 * $BEEF81 — the Kremcoin cheat of Pirate Panic: enter the cabin without collecting bananas,
 * collect the extra life there, grab the banana bunch outside, come back without collecting
 * anything else... each passed step advances token_cheat_step; any mistake deletes the handler.
 */
export function kremcoin_cheat_handler_sprite_code() {
  const del = () => {
    reg.x = cur();
    w16(reg.x + sprite.type, 0);
    w16(R.banana_count_before_token_cheat, 0);
  };
  const passed = () => {
    w8(R.banana_count_before_token_cheat, r16(R.banana_count) & 0xff);
    w16(R.token_cheat_step, (r16(R.token_cheat_step) + 1) & 0xffff);
    reg.x = cur();
    w16(reg.x + sprite.type, 0);
  };
  if (r16(R.cheated_token_count) !== 0) return del();
  const y = cur();
  reg.y = y;
  let state = r16(y + sprite.state);
  if (state === 0) {
    // .default_state: resume at the current cheat step
    state = ((r16(R.token_cheat_step) & 0x0007) + 1) & 0xffff;
    w16(y + sprite.state, state);
  }
  const level = r16(R.level_number);
  const before = r8(R.banana_count_before_token_cheat);
  switch (state) {
    case 1: // .wait_for_cabin_entry
      if (level !== C.level_pirate_panic_krools_cabin) return del();
      w8(R.banana_count_before_token_cheat, r16(R.banana_count) & 0xff);
      reg.x = y;
      w16(y + sprite.state, (r16(y + sprite.state) + 1) & 0xffff);
      w16(R.token_cheat_step, (r16(R.token_cheat_step) + 2) & 0xffff);
    // falls through
    case 2: // .fail_if_life_collected
      if (r16(R.lives_to_give_count) !== 0) return del();
      return;
    case 3:
    case 5: {
      // .wait_for_banana_bunch_collected
      if (level !== C.level_pirate_panic) return del();
      const d = sbcBcd16(before, r16(R.banana_count));
      if (d === 0) return;
      if ((d & 0xff) === 0x90) return passed(); // exactly 10 more bananas: the bunch
      return del();
    }
    case 4: // .wait_for_life_collected
      if (level !== C.level_pirate_panic_krools_cabin) return del();
      if (before !== r16(R.banana_count)) return del();
      if (r16(R.lives_to_give_count) !== 0) return passed();
      return;
    case 6: // .fail_if_bananas_collected
      if (before !== r16(R.banana_count)) return del();
      w16(0x0923, r16(0x0923) | 0x0001); // cheat earned
      return del();
  }
}

register({ camera_unlock_trigger_sprite_code, chest_spawner_sprite_code, kremcoin_cheat_handler_sprite_code });
for (const n of ["camera_unlock_trigger_sprite_code", "chest_spawner_sprite_code", "kremcoin_cheat_handler_sprite_code"])
  setRetMode(L(n), RET_SPRITE);
