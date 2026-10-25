/**
 * Bank $B3 — world 3+ sprites: the lilypad and horsetail of Krockhead Klamber / Bramble levels,
 * the Ghost Rope of Ghostly Grove, the unused sprite $00A8, Clapper (Lava Lagoon, Clapper's
 * Cavern) and the plus/minus barrels of Haunted Hall and Rickety Race.
 */
import { r16, w16 } from "../../core/mem";
import { reg } from "../../core/cpu";
import { L, R, C, sprite } from "../../core/sym";
import {
  delete_sprite_handle_deallocation,
  set_sprite_animation,
  process_sprite_animation,
  process_current_movement,
  spawn_no_gfx_special_sprite_index,
  get_current_sprite_clipping,
  CODE_BEBD8E,
  CODE_BEBE6D,
  CODE_BEBE8B,
  CODE_B396CE,
  queue_sound_effect,
} from "../../gen/routines";
import {
  cur, sr, sw, isNeg, sound, spriteStateHandler, returnHandleDespawn, registerSprite,
  CODE_B3D8FD, CODE_B3D916,
} from "./b3c_common";

// =============================================================================================
// Lilypad and horsetail / ghost rope

/** $B395F8 — the lilypad lives as long as the horsetail that spawned it still points at it. */
export function lilypad_main() {
  const x = cur();
  reg.x = x;
  const owner = sr(x, sprite.general_purpose_42);
  reg.y = owner;
  if (r16(owner + sprite.type) === C.sprite_horsetail && r16(owner + sprite.general_purpose_4C) === cur()) return;
  delete_sprite_handle_deallocation();
}

/**
 * $B39615 — Ghost Rope (Ghostly Grove: states 0-3, it fades in and out) and horsetail
 * (states 4-6, a plant the Kongs hang on). Both are ropes: CODE_B396CE grabs them.
 */
export function horsetail_main() {
  let x = cur();
  const state = sr(x, sprite.state);
  reg.x = (state << 1) & 0xffff;
  switch (state) {
    case 0: // ghost rope, starts hidden
      sw(x, sprite.state, 0x0002);
      reg.x = x;
      reg.a = C.ghost_rope_hidden_anim_id;
      set_sprite_animation();
      return;
    case 1: // ghost rope, starts visible
      sw(x, sprite.state, 0x0003);
      reg.x = x;
      reg.a = C.ghost_rope_idle_anim_id;
      set_sprite_animation();
      return;
    case 2: // fading in/out: it cannot be held
      if (cur() === r16(R.held_rope_sprite)) w16(R.held_rope_sprite, 0);
      process_sprite_animation();
      return returnHandleDespawn();
    case 3: // visible ghost rope
      CODE_B396CE();
      process_sprite_animation();
      return returnHandleDespawn();
    case 4: {
      // horsetail init: spawn its lilypad at the height in $4A
      sw(x, sprite.state, sr(x, sprite.state) + 1);
      reg.x = x;
      reg.y = C.special_sprite_spawn_id_0084;
      spawn_no_gfx_special_sprite_index();
      if (!reg.c) {
        x = cur();
        const pad = r16(R.alternate_sprite);
        reg.x = x;
        reg.y = pad;
        sw(pad, sprite.y_position, sr(x, sprite.general_purpose_4A));
        sw(pad, sprite.general_purpose_42, x);
        sw(x, sprite.general_purpose_4C, pad);
        reg.a = pad;
      }
      return returnHandleDespawn();
    }
    case 5: {
      // horsetail idle ($44 = frames before it can be grabbed again)
      x = cur();
      reg.x = x;
      if (sr(x, sprite.general_purpose_44) !== 0) {
        sw(x, sprite.general_purpose_44, sr(x, sprite.general_purpose_44) - 1);
        return returnHandleDespawn();
      }
      if (cur() === r16(R.held_rope_sprite)) {
        x = cur();
        reg.x = x;
        sw(x, sprite.state, sr(x, sprite.state) + 1);
        reg.a = C.bullrush_still_anim_id;
        set_sprite_animation();
        return;
      }
      CODE_B396CE();
      process_sprite_animation();
      return returnHandleDespawn();
    }
    case 6: {
      // horsetail held by a Kong
      const self = cur();
      if (self === r16(R.held_rope_sprite)) return;
      reg.x = self;
      sw(self, sprite.state, sr(self, sprite.state) - 1);
      sw(self, sprite.general_purpose_44, 0x000c);
      reg.a = C.bullrush_idle_anim_id;
      set_sprite_animation();
      return;
    }
    default:
      throw new Error(`horsetail_main: bad state ${state}`);
  }
}

// =============================================================================================
// Unused sprite $00A8

const UNKNOWN_00A8_TABLE = L("unknown_sprite_00A8_main") + 3;

/** $B3BC12 — sprite $00A8 (not placed in any level): follows the Kong's height. */
export function unknown_sprite_00A8_main() {
  spriteStateHandler(UNKNOWN_00A8_TABLE);
}

/** $B3BC19 — state 0: run the sub-state (A = sub_state * 2, Y = the sprite). */
export function unknown_sprite_00A8_main_handle_sub_state() {
  const y = reg.y;
  const sub = reg.a & 0xffff;
  reg.x = sub;
  let x = y;
  switch (sub >> 1) {
    case 1: {
      const kong = r16(R.active_kong_sprite);
      reg.x = kong;
      if (sr(kong, sprite.ground_distance) !== 0) return copyKongHeight();
      x = y;
      reg.x = x;
      w16(x + sprite.sub_state, r16(x + sprite.sub_state) + 1); // 16-bit INC
      return copyKongHeight();
    }
    case 0:
      reg.x = x;
      w16(x + sprite.sub_state, r16(x + sprite.sub_state) + 1);
      return copyKongHeight();
    case 2: {
      reg.x = x;
      const t = (sr(x, sprite.general_purpose_50) - 1) & 0xffff;
      sw(x, sprite.general_purpose_50, t);
      if (!isNeg(t)) return copyKongHeight();
      sw(x, sprite.y_position, 0);
      process_current_movement();
      for (;;) {
        x = cur();
        reg.x = x;
        if (sr(x, sprite.general_purpose_46) >= sr(x, sprite.x_position)) break;
        // JSR into the middle of an instruction: the original crashes here
        throw new Error("unknown_sprite_00A8_main: glitched JSR (crashes on the original too)");
      }
      w16(x + sprite.sub_state, r16(x + sprite.sub_state) + 1);
      return subState3();
    }
    case 3:
      return subState3();
    default:
      throw new Error(`unknown_sprite_00A8_main: bad sub-state ${sub}`);
  }
}

function subState3() {
  const x = cur();
  reg.x = x;
  sw(x, sprite.y_position, 0);
  w16(0x0ae8, x);
  process_current_movement();
  copyKongHeight();
}

function copyKongHeight() {
  const x = cur();
  const kong = r16(R.active_kong_sprite);
  reg.x = x;
  reg.y = kong;
  sw(x, sprite.y_position, sr(kong, sprite.y_position));
  reg.a = sr(kong, sprite.ground_distance);
  sw(x, sprite.ground_distance, reg.a);
}

/** $B3BC68 — state 1: nothing. */
export function unknown_sprite_00A8_main_return() {}

// =============================================================================================
// Clapper

/**
 * $B3D939 — Clapper the seal: state 0 cools lava into water (it bounces the Kong when stood on
 * underwater), state 1 freezes water into ice (it knocks the Kong back). Its animation spawns
 * the breath and sets the water timer.
 */
export function clapper_sprite_code() {
  const y = cur();
  reg.y = y;
  const state = r16(y + sprite.state);
  reg.x = (state << 1) & 0xffff;
  if (state === 0) {
    const top = (sr(y, sprite.y_position) - 0x0010) & 0xffff;
    if (top >= r16(R.water_y_position)) {
      // submerged
      sw(y, sprite.animation_speed, 0x00c0);
      if (sr(y, sprite.animation_id) === C.clapper_interact_anim_id) return clapperAnimate();
      get_current_sprite_clipping();
      CODE_BEBE6D();
      if (!reg.c) return clapperAnimate();
      sw(reg.y, sprite.y_speed, 0xfe00); // bounce the Kong
      return clapperClap();
    }
  } else if (state !== 1) throw new Error(`clapper_sprite_code: bad state ${state}`);
  sw(y, sprite.animation_speed, 0x0100);
  if (sr(y, sprite.animation_id) === C.clapper_interact_anim_id) return clapperAnimate();
  get_current_sprite_clipping();
  let x = cur();
  reg.x = x;
  sw(x, sprite.general_purpose_46, sr(x, sprite.oam_property)); // keep its facing
  reg.a = 0x0cdc;
  CODE_BEBE8B();
  w16(0x32, reg.a);
  if (!reg.c) return clapperAnimate();
  x = cur();
  reg.x = x;
  sw(x, sprite.oam_property, sr(x, sprite.general_purpose_46));
  if (r16(R.current_interaction) === C.player_interaction_1E) {
    // the Kong is knocked back: away from the Clapper
    let v = 0x0300;
    if (sr(x, sprite.general_purpose_42) & 0x4000) v = -v & 0xffff;
    w16(R.interaction_RAM_0A86, v);
  }
  clapperClap();
}

function clapperAnimate() {
  process_sprite_animation();
  CODE_B3D916();
}

function clapperClap() {
  reg.a = C.clapper_interact_anim_id;
  set_sprite_animation();
}

// =============================================================================================
// Plus and minus barrels

const PLUS_MINUS_TABLE = L("plus_and_minus_barrel_main") + 3;

/** $B3D7F8 — +/- barrels: Haunted Hall timer barrels (state 0) and Rickety Race (states 1-2). */
export function plus_and_minus_barrel_main() {
  spriteStateHandler(PLUS_MINUS_TABLE);
}

/**
 * $B3D801 — Haunted Hall: breaking it adds ($42 > 0) or removes seconds of the ghost timer;
 * the Kackle passing the barrel also changes it.
 */
export function plus_and_minus_barrel_main_state_0() {
  get_current_sprite_clipping();
  reg.a = 0x1000;
  reg.y = 0x0010;
  CODE_BEBD8E();
  const x = cur();
  reg.x = x;
  if (reg.c) {
    let kackle = r16(0x0d5a);
    reg.y = kackle;
    const timer = r16(kackle + 0x1c);
    if (timer !== 0) {
      reg.y = timer;
      const amount = sr(x, sprite.general_purpose_42);
      if (isNeg(amount)) {
        w16(timer + 0x44, amount + r16(timer + 0x44));
        kackle = r16(0x0d5a);
        reg.y = kackle;
        w16(kackle + 0x36, r16(kackle + 0x36) - amount);
        reg.a = sound(4, "barrel_bad");
      } else {
        w16(timer + 0x42, amount + r16(timer + 0x42));
        reg.a = sound(4, "barrel_good");
      }
      queue_sound_effect();
    }
    return CODE_B3D8FD();
  }
  if (!isNeg(sr(x, sprite.general_purpose_42) | sr(x, sprite.state))) {
    const kackle = r16(0x0d5a);
    const target = r16(kackle + 2);
    reg.y = target;
    const edge = (sr(target, sprite.x_position) - 0x0020) & 0xffff;
    if (edge >= sr(x, sprite.x_position)) {
      sw(x, sprite.state, sr(x, sprite.state) | 0x8000);
      reg.y = kackle;
      w16(kackle + 0x36, sr(x, sprite.general_purpose_42) + r16(kackle + 0x36));
    }
  }
  process_sprite_animation();
  returnHandleDespawn();
}

/** $B3D881 — Rickety Race: the skull cart that breaks it changes its speed by $42. */
export function plus_and_minus_barrel_main_state_1() {
  get_current_sprite_clipping();
  CODE_BEBE6D();
  if (!reg.c) {
    process_sprite_animation();
    return returnHandleDespawn();
  }
  const x = cur();
  const cart = r16(R.ridden_skull_cart_sprite);
  reg.x = x;
  reg.y = cart;
  const amount = sr(x, sprite.general_purpose_42);
  sw(cart, sprite.max_y_speed, amount + sr(cart, sprite.max_y_speed));
  sw(cart, sprite.max_x_speed, sr(cart, sprite.max_x_speed) + amount);
  reg.a = sound(4, "barrel_bad");
  queue_sound_effect();
  CODE_B3D8FD();
}

/** $B3D8B3 — Rickety Race: sets the skull cart's speeds from $42/$44. */
export function plus_and_minus_barrel_main_state_2() {
  get_current_sprite_clipping();
  CODE_BEBE6D();
  if (!reg.c) {
    process_sprite_animation();
    return returnHandleDespawn();
  }
  const x = cur();
  const cart = r16(R.ridden_skull_cart_sprite);
  reg.x = x;
  reg.y = cart;
  if (sr(x, sprite.general_purpose_4E) !== 0) w16(0x0aec, -r16(0x0aec) & 0xffff);
  const a = sr(x, sprite.general_purpose_42);
  sw(cart, sprite.unknown_22, a);
  sw(cart, sprite.max_y_speed, a);
  const b = sr(x, sprite.general_purpose_44);
  sw(cart, sprite.unknown_28, b);
  if (b !== 0) sw(cart, sprite.max_y_speed, b);
  sw(cart, sprite.display_mode, sr(x, sprite.y_position));
  sw(cart, sprite.max_x_speed, 0);
  sw(cart, sprite.x_speed, 0);
  sw(cart, sprite.unknown_2C, 0);
  reg.a = 0;
  CODE_B3D8FD();
}

registerSprite({
  lilypad_main, horsetail_main, unknown_sprite_00A8_main, unknown_sprite_00A8_main_handle_sub_state,
  unknown_sprite_00A8_main_return, clapper_sprite_code, plus_and_minus_barrel_main,
  plus_and_minus_barrel_main_state_0, plus_and_minus_barrel_main_state_1, plus_and_minus_barrel_main_state_2,
});
