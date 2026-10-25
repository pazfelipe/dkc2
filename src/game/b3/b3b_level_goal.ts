/**
 * Bank $B3 — the level goal: the target the Kongs jump on at the end of a level, with its
 * props (barrel under the target, pole, and the cycling prize shown above it).
 *
 * The goal spawns three prop sprites; each prop keeps the goal's slot in $42 and deletes itself
 * as soon as that slot no longer holds the goal. When a Kong lands on the target, the goal
 * starts the barrel moving up (and, if the Kong fell from high enough, drops the prize, which
 * then turns into the reward item it was showing).
 */
import { r16, w16, rom16 } from "../../core/mem";
import { reg } from "../../core/cpu";
import { L, R, C, sprite } from "../../core/sym";
import {
  delete_sprite_handle_deallocation, set_sprite_palette_direct_global, apply_sprite_gravity,
  process_terrain_interaction_global, delete_sprite_if_offscreen, dereference_sprite_palette_global,
  apply_spawn_script_to_slot_global, apply_position_from_velocity_global,
  spawn_barrel_parts_and_smoke_global, CODE_B8D47C, spawn_special_sprite_index,
  get_current_sprite_clipping, check_active_kong_collision, set_sprite_animation,
  set_player_interaction_global, process_sprite_animation,
} from "../../gen/routines";
import { cur, rd, wr, inc, dec, spriteConst, despawnReturn, isNeg, cmpMi, registerRts, registerSprite } from "./b3b_common";

const ITEM_REWARD_FRAMES = L("item_reward_frames_table");
const ITEM_REWARD_PALETTES = L("item_reward_palettes_table");
const ITEM_REWARD_INIT_SCRIPTS = L("item_reward_init_scripts_table");
const DATA_FF0214 = L("DATA_FF0214") & 0xffff;

// Goal prize variables: $42 goal slot, $44 index into the reward sequence, $46 reward display
// timer, $48 index of the reward graphic, $4A timer until the prize drops.

/** $B3A0C8 — the prize above the goal target, cycling through the possible rewards. */
export function level_goal_prize_main(): void {
  level_goal_prop_check_parent();
  if (reg.c) {
    delete_sprite_handle_deallocation();
    return;
  }
  const x = cur();
  w16(R.current_sprite_constants, rd(x, sprite.constants_address));
  const state = rd(x, sprite.state);
  reg.a = reg.x = (state << 1) & 0xffff;
  switch (state) {
    case 0: return prizeInit();
    case 1: return prizeIdle();
    case 2: return prizeTriggered();
    case 3: return prizeWaitForDrop();
    case 4: return prizeDrop();
    case 5: return prizeSpawnReward();
  }
}

/** .init: start the reward sequence. */
function prizeInit(): void {
  const x = cur();
  inc(x, sprite.state);
  wr(x, 0x44, 0);
  wr(x, 0x46, 1);
  wr(x, 0x48, 0);
}

/** .idle: when the display timer runs out, show the next reward (graphic + palette). */
function prizeIdle(): void {
  prizeUpdateRewardDisplay();
  if (!reg.c) return;
  let x = cur();
  const rewardIndex = rd(x, 0x48);
  wr(x, sprite.current_graphic, rom16(ITEM_REWARD_FRAMES + rewardIndex * 2));
  wr(x, sprite.last_rendered_graphic, 0);
  reg.a = rom16(ITEM_REWARD_PALETTES + ((rd(x, 0x48) << 1) & 0xffff));
  reg.x = x;
  set_sprite_palette_direct_global();
}

/** .state_2 (set by the goal when a Kong hit it): wait 15 frames before dropping. */
function prizeTriggered(): void {
  const x = cur();
  inc(x, sprite.state);
  wr(x, 0x4a, 0x000f);
}

/** .wait_for_drop */
function prizeWaitForDrop(): void {
  const x = cur();
  if (isNeg(dec(x, 0x4a))) {
    inc(x, sprite.state);
    wr(x, sprite.x_speed, 0);
    wr(x, sprite.constants_address, DATA_FF0214);
  }
}

/** .drop: fall until the prize lands. */
function prizeDrop(): void {
  apply_sprite_gravity();
  process_terrain_interaction_global();
  const x = cur();
  reg.x = x;
  if ((rd(x, sprite.terrain_interaction) & 0x0101) === 0x0101) {
    inc(x, sprite.state);
    return;
  }
  delete_sprite_if_offscreen();
}

/** .spawn_reward: the prize sprite turns itself into the reward item it shows. */
function prizeSpawnReward(): void {
  let x = cur();
  w16(R.alternate_sprite, x);
  reg.a = rd(x, sprite.oam_property);
  reg.x = x;
  dereference_sprite_palette_global();
  x = cur();
  reg.y = rom16(ITEM_REWARD_INIT_SCRIPTS + ((rd(x, 0x48) << 1) & 0xffff));
  reg.x = x;
  apply_spawn_script_to_slot_global();
  const alt = r16(R.alternate_sprite);
  reg.x = alt;
  wr(alt, sprite.unknown_2C, 0);
  wr(alt, sprite.placement_number, 0);
}

/** .update_reward_display: carry set when the next reward of the sequence was loaded. */
function prizeUpdateRewardDisplay(): void {
  const x = cur();
  reg.x = x;
  if (dec(x, 0x46) !== 0) {
    reg.c = false;
    return;
  }
  let y = (rd(x, 0x44) << 1) & 0xffff;
  wr(x, 0x46, spriteConst(y) & 0xff);
  y++;
  wr(x, 0x48, spriteConst(y) & 0xff);
  y++;
  inc(x, 0x44);
  reg.a = spriteConst(y) & 0xff;
  if (reg.a === 0) wr(x, 0x44, 0); // end of the sequence: start over
  reg.y = y;
  reg.c = true;
}

/** $B3A1B2 — the goal pole: only checks that its goal still exists. */
export function level_goal_pole_main(): void {
  level_goal_prop_check_parent();
  if (reg.c) delete_sprite_handle_deallocation();
}

/** $B3A1C1 — the barrel under the goal target; flies up and breaks when the goal is hit. */
export function level_goal_barrel_main(): void {
  level_goal_prop_check_parent();
  if (reg.c) {
    delete_sprite_handle_deallocation();
    return;
  }
  const state = rd(reg.x, sprite.state);
  reg.a = reg.x = (state << 1) & 0xffff;
  const x = cur();
  switch (state) {
    case 0: // .init_state: remember the resting height
      wr(x, 0x44, rd(x, sprite.y_position));
      inc(x, sprite.state);
      return;
    case 1: // .idle_state
      return;
    case 2: // .transitional_state (set by the goal)
      inc(x, sprite.state);
      return;
    case 3:
      return barrelMove();
  }
}

/** .move_state: accelerate (capped at $0800), never below the rest height, break $60 above it. */
function barrelMove(): void {
  const x = cur();
  reg.x = x;
  let speed = (0x0050 + rd(x, sprite.y_speed)) & 0xffff;
  if (!isNeg(speed) && speed >= 0x0800) speed = 0x0800;
  wr(x, sprite.y_speed, speed);
  apply_position_from_velocity_global();
  const home = rd(x, 0x44);
  if (cmpMi(home, rd(x, sprite.y_position))) wr(x, sprite.y_position, home);
  const height = (rd(x, 0x44) - rd(x, sprite.y_position)) & 0xffff;
  if (!cmpMi(height, 0x0060)) {
    spawn_barrel_parts_and_smoke_global();
    delete_sprite_handle_deallocation();
  }
}

/** $B3A227 — carry clear if the prop's parent ($42) is still the level goal. */
export function level_goal_prop_check_parent(): void {
  const x = cur();
  reg.x = x;
  reg.y = rd(x, 0x42);
  reg.a = r16(reg.y + sprite.type);
  if (reg.a !== C.sprite_level_goal) return CODE_B3A236();
  reg.c = false;
}

/** $B3A236 */
export function CODE_B3A236(): void {
  reg.c = true;
}

// Level goal variables: $42 barrel slot, $44 pole slot, $46 prize slot, $48 unclear,
// $4A goal Y position from CODE_B8D47C.

/** $B3A238 — the level goal target. */
export function level_goal_main(): void {
  const x = cur();
  w16(R.current_sprite_constants, rd(x, sprite.constants_address));
  const state = rd(x, sprite.state);
  reg.a = reg.x = (state << 1) & 0xffff;
  switch (state) {
    case 0: return goalInit();
    case 1: return goalIdle();
    case 2: // .dummy_state
      process_sprite_animation();
      return;
  }
}

/** Spawn special sprite `id` and link it with the goal both ways. Returns the new slot. */
function spawnProp(id: number): number {
  reg.y = id;
  spawn_special_sprite_index();
  const y = r16(R.alternate_sprite);
  const x = cur();
  w16(y + 0x42, x);
  return y;
}

/** .init_state: remember the ground height and spawn barrel, prize and pole. */
function goalInit(): void {
  let x = cur();
  reg.x = x;
  CODE_B8D47C();
  x = cur();
  wr(x, 0x4a, reg.a);
  inc(x, sprite.state);
  wr(x, 0x48, 0);
  const barrel = spawnProp(C.special_sprite_spawn_id_0080);
  wr(x, 0x42, barrel);
  const prize = spawnProp(C.special_sprite_spawn_id_0082);
  w16(prize + sprite.constants_address, rd(x, sprite.constants_address));
  wr(x, 0x46, prize);
  const pole = spawnProp(C.special_sprite_spawn_id_007E);
  wr(x, 0x44, pole);
  reg.x = x;
  reg.y = pole;
  reg.a = pole;
}

/** .idle_state: wait for a falling Kong to land on the target. */
function goalIdle(): void {
  const kong = r16(R.active_kong_sprite);
  reg.x = kong;
  if (rd(kong, sprite.terrain_interaction) & 0x0101) return despawnReturn();
  if (isNeg(rd(kong, sprite.y_speed))) return despawnReturn();
  // (the original handles collision when a mount exists; probably meant BEQ)
  if (r16(R.current_player_mount) === 0 && r16(R.animal_type) !== 0) return despawnReturn();
  get_current_sprite_clipping();
  reg.a = 0x0008;
  check_active_kong_collision();
  if (!reg.c) return despawnReturn();

  const x = cur();
  inc(x, sprite.state);
  const barrel = rd(x, 0x42);
  w16(barrel + sprite.state, 2);
  w16(R.RAM_0B02, r16(R.RAM_0B02) & 0xfffb);
  goalCheckIfShouldDropPrize();
  w16(barrel + sprite.y_speed, reg.a);
  reg.y = barrel;
  if (!reg.c) {
    w16(R.RAM_0B02, r16(R.RAM_0B02) | 0x0004);
    reg.y = rd(x, 0x46);
    w16(reg.y + sprite.state, 2);
  }
  reg.x = x;
  reg.a = C.level_target_trigger_anim_id;
  set_sprite_animation();
  reg.a = C.player_interaction_2A;
  set_player_interaction_global();
  if (reg.c) return;
  const g = cur();
  reg.x = g;
  w16(R.interaction_RAM_0A86, (rd(g, sprite.x_position) + 0x0012) & 0xffff);
  w16(R.interaction_RAM_0A88, rd(g, 0x4a));
  reg.a = rd(g, 0x48);
  w16(R.interaction_RAM_0A8A, reg.a);
}

/** .check_if_should_drop_prize: a high fall ($68+ px) launches the barrel fast and drops the prize. */
function goalCheckIfShouldDropPrize(): void {
  const x = cur();
  reg.x = x;
  const fall = (rd(x, sprite.y_position) - r16(0x0935)) & 0xffff;
  if (cmpMi(fall, 0x0068)) {
    reg.a = 0xf900;
    reg.c = true;
  } else {
    reg.a = 0xf700;
    reg.c = false;
  }
}

/** $B3A331 — sprite $00C8: does nothing. */
export function unknown_sprite_00C8_main() {}

registerSprite({
  level_goal_prize_main, level_goal_pole_main, level_goal_barrel_main, level_goal_main,
  unknown_sprite_00C8_main,
});
registerRts({ level_goal_prop_check_parent, CODE_B3A236 });
