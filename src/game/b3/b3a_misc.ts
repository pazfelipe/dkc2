/**
 * Bank $B3 — small effect sprites (shell/cannonball pieces, fireworks, explosions, the sun,
 * Squawks's egg, plain animated props) and the hook (Kong hangs from it, camera offset).
 */
import { r16, w16, rom16, bus16, r8 } from "../../core/mem";
import { reg } from "../../core/cpu";
import { L, R, C, sprite } from "../../core/sym";
import {
  apply_position_from_velocity_global,
  process_sprite_animation,
  delete_sprite_handle_deallocation,
  delete_sprite_no_deallocation,
  spawn_special_sprite_address,
  spawn_special_sprite_index,
  get_current_sprite_clipping,
  check_active_kong_collision,
  interpolate_x_velocity_global,
  queue_sound_effect,
  set_player_interaction_global,
  work_on_active_kong_global,
  work_on_inactive_kong_global,
  set_anim_handle_dixie,
  CODE_BEBD8E,
  CODE_BCFEC8,
  CODE_BCFEE0,
  CODE_B3A338,
  CODE_B3DF3C,
  CODE_B8A57C,
  CODE_B8D8D1,
} from "../../gen/routines";
import { registerRts, registerRtl, registerSprite, mergeBits, asr1, snd, mi, pl, neg, callSpriteCollisionRoutine } from "./b3a_common";
import { sprite_return_handle_despawn } from "./b3a_framework";
import { apply_x_acceleration, apply_sprite_gravity_2 } from "./b3a_barrels";

const cur = () => r16(R.current_sprite);
const abs16 = (v: number) => (v & 0x8000 ? -v & 0xffff : v & 0xffff);

const EXPLOSION_OFFSETS = L("unknown_sprite_00B8_main_DATA_B39289");
const KONG_STATE_FLAGS_TABLE = L("kong_state_flags_table");
const CODE_B3992E_ADDR = L("CODE_B3992E");
const CODE_B398D7_ADDR = L("CODE_B398D7");

// ---------------------------------------------------------------------------------------------
// Effect sprites
// ---------------------------------------------------------------------------------------------

/**
 * $B3919D — canball_pieces1/2, egg_shell_pieces: a falling debris piece, deleted once it is
 * falling and has dropped $E0 pixels below the top of the screen.
 */
export function egg_shell_pieces_main() {
  let x = cur();
  w16(R.current_sprite_constants, r16(x + sprite.constants_address));
  reg.x = x;
  apply_x_acceleration();
  apply_sprite_gravity_2();
  apply_position_from_velocity_global();
  process_sprite_animation();
  x = cur();
  reg.x = x;
  if (r16(x + sprite.y_speed) & 0x8000) return;
  const below = (r16(x + sprite.y_position) - r16(0x17c2)) & 0xffff;
  if (below & 0x8000) return;
  if (mi(below, 0x00e0)) return;
  delete_sprite_handle_deallocation();
}

/** $B391CE — a firework rocket: rises until it passes the height in $44, then slows down. */
export function fireworks_main() {
  const x = cur();
  reg.x = x;
  const ySpeed = r16(x + sprite.y_speed);
  const rising = (ySpeed & 0x8000) !== 0 && pl(r16(x + sprite.y_position), r16(x + 0x44));
  w16(x + sprite.y_speed, rising ? ySpeed - 0x000c : ySpeed + 0x000c);
  apply_position_from_velocity_global();
  process_sprite_animation();
}

/** $B391F5 — explosion_cloud, unknown_sprite_023C/0248: move and animate. */
export function unknown_sprite_0248_main() {
  apply_position_from_velocity_global();
  process_sprite_animation();
}

/**
 * $B39200 — explosion / unknown_sprite_00B8: a spawner of explosion pieces. Every $4A frames
 * (timer $42) it spawns the special sprite whose address is in its state word, $46 times,
 * cycling the piece through 8 offsets/flips. Bit 0 of the remaining count halves the piece's
 * y speed; its x speed is half the spawner's.
 */
export function unknown_sprite_00B8_main() {
  apply_position_from_velocity_global();
  reg.db = 0xb3;
  let x = cur();
  reg.x = x;
  const t48 = (r16(x + 0x48) - 1) & 0xffff;
  w16(x + 0x48, t48);
  if (t48 & 0x8000 && r16(x + 0x46)) CODE_B392A9();
  x = cur();
  reg.x = x;
  const t42 = (r16(x + 0x42) - 1) & 0xffff;
  w16(x + 0x42, t42);
  if (!(t42 & 0x8000)) return;

  const count = (r16(x + 0x46) - 1) & 0xffff;
  w16(x + 0x46, count);
  if (count & 0x8000) {
    delete_sprite_no_deallocation();
    return;
  }
  w16(x + 0x42, r16(x + 0x4a));
  reg.y = r16(x + sprite.state);
  spawn_special_sprite_address();
  if (reg.c) return;
  reg.db = 0xb3;
  const self = cur();
  const step = (r16(self + 0x44) + 1) & 0x0007;
  w16(self + 0x44, step);
  const dx = rom16(EXPLOSION_OFFSETS + step * 4);
  const dy = rom16(EXPLOSION_OFFSETS + step * 4 + 2);
  const p = r16(R.alternate_sprite);
  w16(p + sprite.x_position, r16(p + sprite.x_position) + dx);
  w16(p + sprite.oam_property, mergeBits(r16(p + sprite.oam_property), dx >>> 1, 0x4000));
  w16(p + sprite.y_position, r16(p + sprite.y_position) + dy);
  w16(p + sprite.oam_property, mergeBits(r16(p + sprite.oam_property), dy, 0x8000));
  if (r16(self + 0x46) & 1) w16(p + sprite.y_speed, asr1(r16(p + sprite.y_speed)));
  const xs = asr1(r16(self + sprite.x_speed));
  w16(p + sprite.x_speed, xs);
  reg.x = p;
  reg.y = self;
  reg.a = xs;
}

/** $B392A9 — empty. */
export function CODE_B392A9() {}

/**
 * $B392AA — the sun on the world map / sunset backgrounds: its position follows the value in
 * $0911 (y = v/128 + v/512 + $10, x = (v>>8)/2 + $70), x jittering by one pixel every frame.
 */
export function sun_main() {
  const x = cur();
  reg.x = x;
  const v = r16(0x0911);
  const t = v >>> 7;
  w16(x + sprite.y_position, (t >>> 2) + t + 0x0010);
  const jitter = r16(R.active_frame_counter) & 0x0001;
  w16(0x32, jitter);
  w16(x + sprite.x_position, ((v >>> 8) >>> 1) + 0x0070 + jitter);
}

/** $B392DE */
export function rock_main() {
  process_sprite_animation();
}

/**
 * $B392E5 — an egg spat by Squawks: flies (state 0) until it hits an enemy, then bounces up
 * and away (state 1) while its x speed slows down.
 */
export function squawks_egg_main() {
  const x = cur();
  w16(R.current_sprite_constants, r16(x + sprite.constants_address));
  const state = r16(x + sprite.state);
  reg.a = state;
  if (pl(state, 0x0002)) return; // no such state
  if (state === 0) {
    const kzs = r16(R.level_number) === C.level_king_zing_sting;
    // in King Zing Sting the egg may also hurt the stinger
    if (kzs) w16(x + sprite.interaction_flags, r16(x + sprite.interaction_flags) | 0x0200);
    get_current_sprite_clipping();
    reg.a = 0x0020;
    reg.y = 0x0008;
    CODE_BEBD8E();
    if (reg.c) {
      if (r16(R.level_number) === C.level_king_zing_sting) {
        reg.a = snd(6, "king_zing_egg_bounce");
        queue_sound_effect();
      }
      const e = cur();
      reg.x = e;
      w16(e + sprite.state, r16(e + sprite.state) + 1);
      w16(e + sprite.y_speed, 0xfc00);
      // hit from the side: bounce back the other way
      if (pl(r16(0xdb), r16(0xe3))) w16(e + sprite.x_speed, neg(r16(e + sprite.x_speed)));
      w16(e + sprite.max_x_speed, 0);
    }
    apply_x_acceleration();
  } else {
    reg.a = 0x0005;
    interpolate_x_velocity_global();
  }
  apply_sprite_gravity_2();
  apply_position_from_velocity_global();
  process_sprite_animation();
  sprite_return_handle_despawn();
}

/** $B39368 */
export function npc_hud_coin_main() {
  process_sprite_animation();
}

/** $B3936F */
export function honey_splash_main() {
  process_sprite_animation();
}

// ---------------------------------------------------------------------------------------------
// Horsetail / ghost rope grab check
// ---------------------------------------------------------------------------------------------

/**
 * $B396CE — can the active Kong grab this Horsetail / Ghost Rope? Constants +0/+2 give the
 * grabbable y range relative to the sprite; the Kong must be within 4 pixels horizontally
 * (12 when moving slower than $40). On success held_rope_sprite_temp = this sprite.
 */
export function CODE_B396CE() {
  const s = cur();
  const consts = r16(s + sprite.constants_address);
  w16(0x5e, consts);
  w16(0x60, r16(R.current_sprite_constants_bank));
  const base = (r8(R.current_sprite_constants_bank) << 16) | consts;
  const top = bus16(base);
  const bottom = bus16((base + 2) & 0xffffff);
  w16(0x32, top);
  w16(0x34, bottom);
  w16(0x36, bus16((base + 4) & 0xffffff));
  w16(0x38, bus16((base + 6) & 0xffffff));
  const k = r16(R.active_kong_sprite);
  reg.x = k;
  reg.y = s;
  const reach = mi(abs16(r16(k + sprite.x_speed)), 0x0040) ? 0x000c : 0x0004;
  w16(0x5e, reach);
  const dx = abs16(r16(k + sprite.x_position) - r16(s + sprite.x_position));
  if (pl(dx, reach)) return;
  const ky = r16(k + sprite.y_position);
  const sy = r16(s + sprite.y_position);
  if (pl(sy + top, ky)) return;
  if (mi(sy + bottom, ky)) return;
  w16(R.held_rope_sprite_temp, s);
}

// ---------------------------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------------------------

/**
 * $B39857 — hook. State 0: waits for a Kong to grab it. State 1: a Kong hangs from it ($0D82 =
 * this hook); a non-zero $4E shifts the camera while hanging. When the Kong lets go the camera
 * offset is cleared and the hook stays inactive for $1E frames (state 2).
 */
export function hook_main() {
  const x = cur();
  reg.x = x;
  switch (r16(x + sprite.state)) {
    case 0:
      CODE_B39986();
      sprite_return_handle_despawn();
      return;
    case 1:
      if (r16(0x0d82) !== x) {
        w16(0x0aee, 0);
        w16(0x0af2, 0);
        w16(x + 0x42, 0x001e);
        w16(x + sprite.state, r16(x + sprite.state) + 1);
        return;
      }
      reg.a = r16(x + 0x4e);
      if (!reg.a) return;
      w16(0x0ab8, r16(0x0ab8) | 0xc000);
      reg.x = x;
      CODE_B398AB();
      return;
    default: {
      const t = (r16(x + 0x42) - 1) & 0xffff;
      w16(x + 0x42, t);
      if (!t) w16(x + sprite.state, 0);
      sprite_return_handle_despawn();
    }
  }
}

/** $B398A7 */
export function CODE_B398A7() {
  CODE_B398AB();
}

/** $B398AB — camera offsets from hook X's $4E (high byte: y, low byte: x). */
export function CODE_B398AB() {
  const x = reg.x;
  const off = r16(x + 0x4e);
  let half = r16(0x0af0) >>> 1;
  w16(0x32, half);
  w16(0x0af2, (off & 0xff00) + 0x3c00 - half);
  half = r16(0x0aea) >>> 1;
  w16(0x32, half);
  const v = ((off & 0x00ff) << 8) + 0x4000 - half;
  w16(0x0aee, v);
  reg.a = v & 0xffff;
}

/**
 * $B398D7 — interaction callback: the inactive (following) Kong grabbed the hook. Spawns the
 * contact flash, makes the inactive Kong hang from it (state $71) and returns to the active one.
 */
export function CODE_B398D7() {
  w16(R.contact_flash_x_position, r16(R.interaction_RAM_0A86));
  w16(R.contact_flash_y_position, r16(R.interaction_RAM_0A88));
  reg.y = C.special_sprite_spawn_id_0034;
  spawn_special_sprite_index();
  let x = cur();
  reg.x = x;
  w16(0x0d82, x);
  w16(x + sprite.oam_property, r16(x + sprite.oam_property) & 0xbfff);
  CODE_B3DF3C();
  work_on_inactive_kong_global();
  x = reg.x;
  w16(x + sprite.state, C.kong_state_71);
  w16(x + sprite.render_order, 0x00d8);
  w16(x + 0x42, r16(R.current_interacting_sprite));
  const hook = r16(0x0d82);
  reg.y = hook;
  w16(x + sprite.x_position, r16(hook + sprite.x_position));
  w16(x + sprite.y_position, r16(hook + sprite.y_position) + 0x0017);
  reg.a = 0x0042;
  set_anim_handle_dixie();
  work_on_active_kong_global();
  CODE_B8A57C();
}

/** $B3992E — interaction callback: the active Kong grabbed the hook (Kong state $3C). */
export function CODE_B3992E() {
  let x = cur();
  reg.x = x;
  w16(0x0d82, x);
  w16(x + sprite.state, 0x0001);
  CODE_B3DF3C();
  x = reg.x;
  w16(x + sprite.oam_property, r16(x + sprite.oam_property) & 0xbfff);
  work_on_active_kong_global();
  x = reg.x;
  w16(x + sprite.state, C.kong_state_3C);
  const hook = r16(0x0d82);
  reg.y = hook;
  w16(x + sprite.x_position, r16(hook + sprite.x_position));
  w16(x + sprite.y_position, r16(hook + sprite.y_position) + 0x0017);
  reg.a = 0x0042;
  set_anim_handle_dixie();
  x = r16(R.inactive_kong_sprite);
  reg.x = x;
  reg.a = r16(x + sprite.state);
  if (reg.a === C.kong_state_71) CODE_B3996F();
}

/** $B3996F — the inactive Kong was hanging from the hook too: it lets go (state $22). */
export function CODE_B3996F() {
  w16(reg.x + sprite.state, C.kong_state_22);
  reg.a = 0x001f;
  reg.x = 0x0042;
  reg.y = 0x0000;
  CODE_B8D8D1();
}

/** $B39982 */
export function CODE_B39982() {
  CODE_B39986();
}

/**
 * $B39986 — hook grab check, skipped while carrying something or riding an animal. Carry set
 * when a grab interaction was started. While the inactive Kong already hangs (state $71)
 * only the active Kong is checked.
 */
export function CODE_B39986() {
  reg.a = r16(R.current_held_sprite) | r16(R.animal_type);
  if (reg.a) {
    reg.c = false;
    return;
  }
  const k = r16(R.inactive_kong_sprite);
  reg.x = k;
  if (r16(k + sprite.state) === C.kong_state_71) return CODE_B39A1C();
  CODE_B3999A();
}

/** Starts the grab interaction with callback `cb`; carry clear if refused. */
function startGrab(cb: number) {
  reg.a = C.player_interaction_0D;
  set_player_interaction_global();
  if (reg.c) {
    reg.c = false;
    return;
  }
  w16(R.interaction_RAM_0A8A, cb & 0xffff);
  w16(R.interaction_RAM_0A8C, cb >>> 16);
  CODE_BCFEC8();
  CODE_BCFEE0();
  CODE_B3A338();
  w16(R.interaction_RAM_0A86, r16(R.contact_flash_x_position));
  reg.a = r16(R.contact_flash_y_position);
  w16(R.interaction_RAM_0A88, reg.a);
  reg.c = true;
}

/** Bits $0406 of the collision result: touched the hook from a grabbing side. */
const grabContact = () => (r16(R.sprite_collision_result) & 0x0406) !== 0;

/** $B3999A — check either Kong (through the current collision routine). */
export function CODE_B3999A() {
  get_current_sprite_clipping();
  reg.a = 0x0008;
  callSpriteCollisionRoutine();
  // CODE_B399A8 (return point of the collision routine)
  if (!reg.c || !grabContact()) {
    reg.c = false;
    return;
  }
  if (r16(R.colliding_sprite) === r16(R.inactive_kong_sprite)) return CODE_B399EE();
  CODE_B39A5F();
  if (!reg.z) {
    reg.c = false;
    return;
  }
  startGrab(CODE_B3992E_ADDR);
}

/** $B399EE — the inactive Kong touched the hook. */
export function CODE_B399EE() {
  startGrab(CODE_B398D7_ADDR);
}

/** $B39A1C — only the active Kong may grab. */
export function CODE_B39A1C() {
  get_current_sprite_clipping();
  reg.a = 0x0008;
  check_active_kong_collision();
  if (!reg.c || !grabContact()) {
    reg.c = false;
    return;
  }
  startGrab(CODE_B3992E_ADDR);
}

/** $B39A5F — A = bit 7 of the active Kong's state flags (Z set when clear). */
export function CODE_B39A5F() {
  const k = r16(R.active_kong_sprite);
  const st = r16(k + sprite.state);
  reg.x = (st << 2) & 0xffff;
  reg.a = rom16(KONG_STATE_FLAGS_TABLE + reg.x) & 0x0080;
  reg.z = reg.a === 0;
}

registerSprite({
  egg_shell_pieces_main,
  fireworks_main,
  unknown_sprite_0248_main,
  unknown_sprite_00B8_main,
  sun_main,
  rock_main,
  squawks_egg_main,
  npc_hud_coin_main,
  honey_splash_main,
  hook_main,
});
registerRts({ CODE_B392A9, CODE_B396CE, CODE_B398AB, CODE_B39986, CODE_B3999A, CODE_B399EE, CODE_B39A1C, CODE_B39A5F });
registerRtl({ CODE_B398A7, CODE_B398D7, CODE_B3992E, CODE_B3996F, CODE_B39982 });
