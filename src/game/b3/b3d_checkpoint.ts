/**
 * Bank $B3 — checkpoint (star) barrel ($B3E4D9-$B3E65B) and the barrel icons shown on blast /
 * auto barrels ($B3E682-$B3E767).
 *
 * Checkpoint barrel variables: $42 entrance number it sets, $44 shake timer, $46/$48 saved
 * states of the active/inactive kong while they wait inside the barrel at a restart.
 *
 * Barrel icon variables: $42 barrel that spawned the icon, $44 swap flag, $48 initial graphic,
 * $4A alternate graphic, $4C countdown to the next swap, $4E swap times (low byte: initial
 * graphic, high byte: alternate graphic).
 */
import { r16, w16, rom16 } from "../../core/mem";
import { reg, callPtr } from "../../core/cpu";
import { L, R, C, sprite as S } from "../../core/sym";
import {
  get_current_sprite_clipping, CODE_BEBE6D, process_sprite_animation,
  delete_sprite_handle_deallocation, spawn_barrel_parts_and_smoke_global, queue_sound_effect,
} from "../../gen/routines";
import { CODE_B3ED5C } from "./b3d_barrel_cannon";
import { cur, sr, sw, mi, registerRts, registerSprite, spriteReturn, exitB3D916 } from "./b3d_common";

const CHECKPOINT_STATES = L("checkpoint_barrel_sprite_code_state_table");
const ICON_STATES = L("barrel_icons_sprite_code_state_table");

/** $B3E4D9 — checkpoint barrel main: dispatch on the state. */
export function checkpoint_barrel_sprite_code() {
  const y = cur();
  callPtr(0xb3, rom16(CHECKPOINT_STATES + ((sr(y, S.state) << 1) & 0xffff)));
}

/** $B3E4E9 .init — restarting from this barrel: hold the kongs inside it and shake. */
export function checkpoint_barrel_sprite_code_init() {
  const x = cur();
  if (sr(x, 0x42) === r16(R.level_entrance_number)) {
    sw(x, S.state, 2);
    sw(x, 0x44, 0x3c);
    moveKongToBarrel();
    return exitB3D916();
  }
  sw(x, S.state, sr(x, S.state) + 1);
  exitB3D916();
}

/** $B3E507 .idle — wait for the kong to touch it, then save the checkpoint and break. */
export function checkpoint_barrel_sprite_code_idle() {
  get_current_sprite_clipping();
  reg.a = 0;
  CODE_BEBE6D();
  if (!reg.c) {
    process_sprite_animation();
    return exitB3D916();
  }
  const x = cur();
  w16(R.level_entrance_number, sr(x, 0x42));
  w16(R.checkpoint_level_entrance_number, 1);
  w16(R.checkpoint_collected_kong_letters, r16(R.collected_kong_letters));
  w16(R.checkpoint_level_number, r16(R.level_number));
  w16(R.checkpoint_parent_level_number, r16(R.parent_level_number));
  w16(R.checkpoint_animal_type, 0);
  if (r16(R.current_player_mount) === 0) w16(R.checkpoint_animal_type, r16(R.animal_type));
  breakBarrel();
}

function breakBarrel() {
  const x = cur();
  reg.x = x;
  reg.a = sr(x, S.type);
  delete_sprite_handle_deallocation();
  spawn_barrel_parts_and_smoke_global();
  reg.a = (5 << 8) | C.sound_barrel_blast;
  queue_sound_effect();
  spriteReturn();
}

/** $B3E55B .shake — restart: shake, then release the kongs and break. */
export function checkpoint_barrel_sprite_code_shake() {
  let x = cur();
  reg.a = sr(x, S.unknown_5C);
  CODE_B3ED5C();
  x = cur();
  const t = (sr(x, 0x44) - 1) & 0xffff;
  sw(x, 0x44, t);
  if (!(t & 0x8000)) {
    reg.x = x;
    reg.a = t;
    CODE_B3E634();
    return spriteReturn();
  }
  w16(R.level_entrance_number, sr(x, 0x42));
  setKongState();
  breakBarrel();
}

/** .set_kong_state — give the kongs back the states saved by .move_kong_to_barrel. */
function setKongState() {
  const x = cur();
  sw(r16(R.active_kong_sprite), S.state, sr(x, 0x46));
  // .set_animal_state: an animal being ridden would get state 1 (never happens at a restart)
  const mount = r16(R.current_player_mount);
  if (mount) sw(mount, S.state, 1);
  if (r16(R.game_state_flags) & 0x4000) sw(r16(R.inactive_kong_sprite), S.state, sr(x, 0x48));
}

/** .move_kong_to_barrel — park the kongs (state $13, invisible) inside the barrel. */
function moveKongToBarrel() {
  const x = cur();
  const y = r16(R.active_kong_sprite);
  sw(y, S.x_position, sr(x, S.x_position));
  sw(y, S.y_position, sr(x, S.y_position) + 8);
  sw(y, S.x_speed, 0);
  sw(y, S.y_speed, 0);
  sw(y, S.current_graphic, 0);
  sw(y, S.last_rendered_graphic, 0);
  sw(y, S.animation_timer, 0);
  sw(x, 0x46, sr(y, S.state));
  sw(y, S.state, 0x13);
  // .check_animal
  const mount = r16(R.current_player_mount);
  if (mount) {
    sw(mount, S.current_graphic, 0);
    sw(mount, S.last_rendered_graphic, 0);
    sw(mount, S.animation_timer, 0);
    sw(mount, S.animation_speed, 0);
    sw(mount, S.state, 7);
  }
  if (r16(R.game_state_flags) & 0x4000) {
    const i = r16(R.inactive_kong_sprite);
    sw(x, 0x48, sr(i, S.state));
    sw(i, S.state, 0x13);
    sw(i, S.current_graphic, 0);
    sw(i, S.last_rendered_graphic, 0);
    sw(i, S.animation_timer, 0);
  }
}

/** $B3E634 — A = timer: shake sprite X horizontally (EOR of the x position), harder near the end. */
export function CODE_B3E634() {
  const t = reg.a & 0xffff;
  reg.y = t;
  if (r16(R.active_frame_counter) & 1) return CODE_B3E649();
  if (mi(t, 0x0006)) return CODE_B3E654();
  if (mi(t, 0x0012)) return CODE_B3E64F();
  if (mi(t, 0x0030)) return CODE_B3E64A();
  CODE_B3E649();
}
/** $B3E649 */
export function CODE_B3E649() {}
/** $B3E64A */
export function CODE_B3E64A() {
  reg.a = 1;
  CODE_B3E657();
}
/** $B3E64F */
export function CODE_B3E64F() {
  reg.a = 4;
  CODE_B3E657();
}
/** $B3E654 */
export function CODE_B3E654() {
  reg.a = 8;
  CODE_B3E657();
}
/** $B3E657 */
export function CODE_B3E657() {
  reg.a ^= sr(reg.x, S.x_position);
  sw(reg.x, S.x_position, reg.a);
}

// ---------------------------------------------------------------------------------------------
// Barrel icons

/** $B3E682 — barrel icon main: dispatch on the state. */
export function barrel_icons_sprite_code() {
  reg.db = 0xb3;
  callPtr(0xb3, rom16(ICON_STATES + ((sr(cur(), S.state) << 1) & 0xffff)));
}

/** $B3E691 .init_state */
export function barrel_icons_sprite_code_init_state() {
  if (snapToBarrel()) return deleteIcon();
  updateNumberGraphic();
  const x = cur();
  sw(x, S.state, sr(x, S.state) + 1);
  sw(x, 0x44, 0);
  sw(x, 0x4c, sr(x, 0x4e) & 0xff);
  graphicSwap();
  spriteReturn();
}
/** .delete_icon_sprite */
function deleteIcon() {
  delete_sprite_handle_deallocation();
  spriteReturn();
}
/** $B3E6B3 .idle_state */
export function barrel_icons_sprite_code_idle_state() {
  if (snapToBarrel()) return deleteIcon();
  updateNumberGraphic();
  swapTimer();
  graphicSwap();
  spriteReturn();
}

/** .handle_swap_timer — alternate between the two graphics with their own durations. */
function swapTimer() {
  const x = cur();
  if (sr(x, 0x2a) & 0x1000) return; // the kong is inside the barrel
  const t = sr(x, 0x4c);
  if (t) return sw(x, 0x4c, t - 1);
  const flag = sr(x, 0x44) ^ 1;
  sw(x, 0x44, flag);
  const times = sr(x, 0x4e);
  const next = (flag & 1 ? times >> 8 : times) & 0xff;
  if (next) sw(x, 0x4c, next);
}

/**
 * .handle_orphaned_icons_and_snap — follow the barrel (or the kong inside it). Returns true
 * (carry) when the barrel is gone or no longer owns this icon.
 */
function snapToBarrel(): boolean {
  const x = cur();
  let y = sr(x, 0x42);
  if (sr(y, S.type) !== C.sprite_barrel_cannon) return true;
  if (sr(y, 0x3c) !== r16(R.current_sprite)) return true;
  const f = sr(y, 0x2a);
  sw(x, 0x2a, f);
  if (f & 0x1000 && sr(r16(R.active_kong_sprite), S.state) === C.kong_state_11) y = r16(R.active_kong_sprite);
  sw(x, S.x_position, sr(y, S.x_position));
  sw(x, S.y_position, sr(y, S.y_position));
  return false;
}

/** .handle_graphic_swap */
function graphicSwap() {
  const x = cur();
  const barrel = sr(x, 0x42);
  let alt = false;
  if (sr(barrel, 0x44) !== 0) alt = (sr(x, 0x44) & 1) !== 0 || (sr(x, 0x2a) & 0x1000) !== 0;
  sw(x, S.current_graphic, sr(x, alt ? 0x4a : 0x48));
}

/** .update_number_graphic — numbered barrels: the digit of the barrel's countdown. */
function updateNumberGraphic() {
  const x = cur();
  const n = (sr(sr(x, 0x42), 0x44) >> 8) & 7;
  sw(x, 0x4a, n ? (n - 1) * 4 + C.barrel_timer_1_graphic : 0);
}

registerSprite({
  checkpoint_barrel_sprite_code, checkpoint_barrel_sprite_code_init, checkpoint_barrel_sprite_code_idle,
  checkpoint_barrel_sprite_code_shake, barrel_icons_sprite_code, barrel_icons_sprite_code_init_state,
  barrel_icons_sprite_code_idle_state,
});
registerRts({ CODE_B3E634, CODE_B3E649, CODE_B3E64A, CODE_B3E64F, CODE_B3E654, CODE_B3E657 });
