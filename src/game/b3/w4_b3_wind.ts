/**
 * Bank $B3 — the wind changers (bank_B3_sprite_main_handler entries 2 and 4).
 *
 * The vertical wind changer (Windy Well) picks its wind zone from the Kong's height: a table
 * in its constants of (y limit, wind kind, strength) entries of 6 bytes. The horizontal one
 * (Gusty Glade, Animal Antics) picks a wind script by the Kong's x position (4-byte entries:
 * x limit, script address) and runs the script: (command, duration) pairs, command 2 loops.
 * The wind changer's x speed is the current wind force, read by the Kong code from $19BE.
 */
import { r8, r16, w8, w16, rom16, bus16 } from "../../core/mem";
import { reg } from "../../core/cpu";
import { L, R, C, sprite } from "../../core/sym";
import { set_player_interaction_global } from "../../gen/routines";
import { cur, sr, sw, neg, isNeg, registerSprite, registerRts } from "./b3c_common";

/** N flag of `CMP` (A - b). */
const cmpMi = (a: number, b: number) => ((a - b) & 0x8000) !== 0;
/** `LDA [current_sprite_constants],y` */
const constAt = (y: number) =>
  bus16((((r16(R.current_sprite_constants_bank) & 0xff) << 16) | ((r16(R.current_sprite_constants) + (y & 0xffff)) & 0xffff)) & 0xffffff);
/** `SEP #$20 : INC wind_loop_sound_enabler : REP #$20` */
const windSound = () => w8(R.wind_loop_sound_enabler, r8(R.wind_loop_sound_enabler) + 1);

const KONG_STATE_FLAGS = L("kong_state_flags_table");

// =============================================================================================
// Vertical wind changer

/** $B3D9CD */
export function vertical_wind_changer_code() {
  const x = cur();
  const state = sr(x, sprite.state);
  reg.x = (state << 1) & 0xffff;
  if (state === 0) return CODE_B3D9DA();
  if (state === 1) return CODE_B3D9EE();
  throw new Error(`vertical_wind_changer_code: bad state ${state}`);
}

/** $B3D9DA — init: register as the wind changer, pick the zone. */
export function CODE_B3D9DA() {
  const x = cur();
  reg.x = x;
  w16(0x19c4, x);
  sw(x, sprite.general_purpose_42, 0);
  sw(x, sprite.state, sr(x, sprite.state) + 1);
  sw(x, sprite.x_speed, 0);
  CODE_B3DA88();
  CODE_B3DAC1();
}

/**
 * $B3D9EE — each frame: update the zone; $44 bit 15 = the zone's wind only blows on one side
 * of x = $44 & $FFF (bit 14 = which side); $46 = strength (0 = calm), $48 = frames the
 * updraft lingers, $4A bit 0 = blowing.
 */
export function CODE_B3D9EE() {
  let x = cur();
  reg.x = x;
  sw(x, sprite.general_purpose_4A, sr(x, sprite.general_purpose_4A) & 0xfffe);
  CODE_B3DA88();
  if (!reg.z) CODE_B3DAC1();
  x = reg.x;
  const zone = sr(x, sprite.general_purpose_44);
  let calm = false;
  if (isNeg(zone)) {
    const kong = r16(R.active_kong_sprite);
    reg.y = kong;
    const d = ((zone & 0x0fff) - sr(kong, sprite.x_position)) & 0xffff;
    w16(0x32, d);
    if (!isNeg(((zone << 1) ^ d) & 0xffff)) {
      // on the calm side
      sw(x, sprite.general_purpose_46, 0);
      calm = true;
    } else {
      sw(x, sprite.general_purpose_46, sr(x, sprite.general_purpose_4C));
      sw(x, sprite.general_purpose_4A, sr(x, sprite.general_purpose_4C));
    }
  }
  if (!calm && sr(x, sprite.general_purpose_46) !== 0) {
    sw(x, sprite.general_purpose_48, 0x0008);
    return windBlowUp();
  }
  // CODE_B3DA50: no wind here
  const kong = r16(R.active_kong_sprite);
  reg.y = kong;
  if (sr(kong, sprite.terrain_interaction) & 0x1001) w16(0x0af2, 0);
  const t = (sr(x, sprite.general_purpose_48) - 1) & 0xffff;
  sw(x, sprite.general_purpose_48, t);
  if (!isNeg(t)) return windBlowUp(); // the updraft lingers a few frames
  sw(x, sprite.general_purpose_48, t + 1);
  sw(x, sprite.general_purpose_4A, 0);
  CODE_B3DA6C();
}

/** $B3DA25 — the wind blows: lift the Kong (or push him if he is in a state that can float). */
function windBlowUp() {
  windSound();
  const kong = r16(R.active_kong_sprite);
  const i = (sr(kong, sprite.state) << 2) & 0xffff;
  reg.x = i;
  if (rom16(KONG_STATE_FLAGS + i) & 0x0004) {
    reg.a = 0x1000;
    w16(0x0af2, 0x1000);
  } else {
    reg.a = C.player_interaction_0C;
    set_player_interaction_global();
  }
  CODE_B3DA6C();
}

/** $B3DA6C — accelerate the wind force (x speed) towards $500 (wind) or -$80 (calm). */
export function CODE_B3DA6C() {
  const x = cur();
  reg.x = x;
  const target = sr(x, sprite.general_purpose_46) !== 0 ? 0x0500 : 0xff80;
  reg.y = target;
  sw(x, sprite.max_x_speed, target);
  reg.a = 0x0030;
  CODE_B3DBFA();
  const x2 = cur();
  reg.x = x2;
  reg.a = sr(x2, sprite.x_speed);
  w16(0x19be, reg.a);
}

/**
 * $B3DA88 — find the zone entry (offset in Y and A) whose y limit is just above the Kong,
 * starting from the current one ($42). Z set when it did not change.
 */
export function CODE_B3DA88() {
  const kong = r16(R.active_kong_sprite);
  reg.x = kong;
  const ky = sr(kong, sprite.y_position);
  w16(0x32, ky);
  const x = cur();
  reg.x = x;
  w16(R.current_sprite_constants, sr(x, sprite.constants_address));
  let y = sr(x, sprite.general_purpose_42);
  if (cmpMi(constAt(y), ky)) {
    do y = (y + 6) & 0xffff;
    while (cmpMi(constAt(y), ky));
  } else {
    do y = (y - 6) & 0xffff;
    while (!cmpMi(constAt(y), ky));
    y = (y + 6) & 0xffff;
  }
  reg.y = y;
  reg.a = y;
  const cur42 = sr(x, sprite.general_purpose_42);
  reg.z = y === cur42;
  reg.c = y >= cur42;
  reg.n = isNeg(y - cur42);
}

/** $B3DAC1 — switch to zone A/Y: $44 = its kind, $46/$4C = strength ($4A too when windy). */
export function CODE_B3DAC1() {
  const x = reg.x;
  let y = reg.y;
  sw(x, sprite.general_purpose_42, reg.a);
  y = (y + 2) & 0xffff;
  sw(x, sprite.general_purpose_44, constAt(y));
  y = (y + 2) & 0xffff;
  reg.y = y;
  const strength = constAt(y);
  reg.a = strength;
  sw(x, sprite.general_purpose_46, strength);
  sw(x, sprite.general_purpose_4C, strength);
  if (strength !== 0) sw(x, sprite.general_purpose_4A, strength);
}

// =============================================================================================
// Horizontal wind changer

/** $B3DAD6 */
export function horizontal_wind_changer_code() {
  const x = cur();
  const state = sr(x, sprite.state);
  reg.x = (state << 1) & 0xffff;
  if (state === 0) return horizontal_wind_changer_code_state_0();
  if (state === 1) return horizontal_wind_changer_code_state_1();
  throw new Error(`horizontal_wind_changer_code: bad state ${state}`);
}

/** $B3DAE3 — init: pick the script for the Kong's position. */
export function horizontal_wind_changer_code_state_0() {
  const x = cur();
  reg.x = x;
  sw(x, sprite.general_purpose_42, 0);
  sw(x, sprite.state, sr(x, sprite.state) + 1);
  sw(x, sprite.x_speed, 0);
  CODE_B3DB15();
  CODE_B3DB48();
  CODE_B3DB57();
}

/** $B3DAF7 — each frame: follow the zone, run the script, apply the wind command. */
export function horizontal_wind_changer_code_state_1() {
  CODE_B3DB15();
  if (!reg.z) CODE_B3DB48();
  CODE_B3DB57();
  CODE_B3DBA9();
  reg.a = 0x0080;
  CODE_B3DBFA();
  const x = cur();
  reg.x = x;
  reg.a = sr(x, sprite.x_speed);
  w16(0x19be, reg.a);
}

/** $B3DB15 — find the zone entry (4 bytes) for the Kong's x position. Z set if unchanged. */
export function CODE_B3DB15() {
  const kong = r16(R.active_kong_sprite);
  reg.x = kong;
  const kx = sr(kong, sprite.x_position);
  w16(0x32, kx);
  const x = cur();
  reg.x = x;
  w16(R.current_sprite_constants, sr(x, sprite.constants_address));
  let y = sr(x, sprite.general_purpose_42);
  if (cmpMi(constAt(y), kx)) {
    do y = (y + 4) & 0xffff;
    while (cmpMi(constAt(y), kx));
    y = (y - 4) & 0xffff;
  } else {
    do y = (y - 4) & 0xffff;
    while (!cmpMi(constAt(y), kx));
  }
  reg.y = y;
  reg.a = y;
  const cur42 = sr(x, sprite.general_purpose_42);
  reg.z = y === cur42;
  reg.c = y >= cur42;
  reg.n = isNeg(y - cur42);
}

/** $B3DB48 — start the zone's wind script (A = entry offset, Y = entry). */
export function CODE_B3DB48() {
  const x = reg.x;
  sw(x, sprite.general_purpose_42, reg.a);
  const y = (reg.y + 2) & 0xffff;
  reg.y = y;
  const script = constAt(y);
  reg.a = script;
  w16(R.current_sprite_constants, script);
  sw(x, sprite.general_purpose_44, script);
  sw(x, sprite.general_purpose_46, 0);
  sw(x, sprite.general_purpose_48, 0);
}

/** $B3DB57 — wind script: when the timer ($48) runs out, read the next (command, time). */
export function CODE_B3DB57() {
  const x = cur();
  reg.x = x;
  const t = (sr(x, sprite.general_purpose_48) - 1) & 0xffff;
  sw(x, sprite.general_purpose_48, t);
  if (!isNeg(t)) return;
  w16(R.current_sprite_constants, sr(x, sprite.general_purpose_44));
  let y = sr(x, sprite.general_purpose_46);
  sw(x, sprite.general_purpose_4A, constAt(y));
  y = (y + 2) & 0xffff;
  sw(x, sprite.general_purpose_48, constAt(y));
  y = (y + 2) & 0xffff;
  reg.a = constAt(y);
  if (reg.a === 0x0002) y = 0; // loop
  reg.y = y;
  sw(x, sprite.general_purpose_46, y);
}

/** $B3DB9C — unused (table DATA_B3DB7C is never read). */
export function CODE_B3DB9C() {}
/** $B3DB9D — unused. */
export function CODE_B3DB9D() {
  reg.a = (reg.a - 0x0012 - (reg.c ? 0 : 1)) & 0xffff;
}
/** $B3DBA1 — unused. */
export function CODE_B3DBA1() {
  reg.a = (reg.a - 0x0012 - (reg.c ? 0 : 1)) & 0xffff;
}
/** $B3DBA5 — unused. */
export function CODE_B3DBA5() {
  reg.a = (reg.a - 0x0024 - (reg.c ? 0 : 1)) & 0xffff;
}

/**
 * $B3DBA9 — apply the wind command $4A: bit 0 = blow, bit 14 = direction (left/right).
 * $19C0 = wind direction for the Kong code (-1 / 1, 0 once calm).
 */
export function CODE_B3DBA9() {
  const x = cur();
  reg.x = x;
  const cmd = sr(x, sprite.general_purpose_4A);
  if (cmd & 1) {
    if ((cmd >> 1) & 0x2000) {
      sw(x, sprite.max_x_speed, 0x0900);
      w16(0x19c0, 0xffff);
    } else {
      sw(x, sprite.max_x_speed, 0xf700);
      w16(0x19c0, 0x0001);
    }
    windSound();
    return;
  }
  // calm: the force decays to 0
  reg.a = 0;
  sw(x, sprite.max_x_speed, 0);
  if (sr(x, sprite.x_speed) === 0) w16(0x19c0, 0);
}

/** $B3DBFA — move the x speed towards max_x_speed by at most A. */
export function CODE_B3DBFA() {
  const x = cur();
  reg.x = x;
  const step = reg.a & 0xffff;
  w16(0x32, step);
  let d = (sr(x, sprite.max_x_speed) - sr(x, sprite.x_speed)) & 0xffff;
  if (isNeg(d)) {
    d = neg(d);
    if (!cmpMi(d, step)) d = step;
    d = neg(d);
  } else if (!cmpMi(d, step)) d = step;
  reg.a = (d + sr(x, sprite.x_speed)) & 0xffff;
  sw(x, sprite.x_speed, reg.a);
}

registerSprite({
  vertical_wind_changer_code, CODE_B3D9DA, CODE_B3D9EE, horizontal_wind_changer_code,
  horizontal_wind_changer_code_state_0, horizontal_wind_changer_code_state_1,
});
registerRts({
  CODE_B3DA6C, CODE_B3DA88, CODE_B3DAC1, CODE_B3DB15, CODE_B3DB48, CODE_B3DB57, CODE_B3DB9C,
  CODE_B3DB9D, CODE_B3DBA1, CODE_B3DBA5, CODE_B3DBA9, CODE_B3DBFA,
});
