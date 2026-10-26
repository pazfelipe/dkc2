/**
 * Bank $B3 — level objects without enemy behaviour: the water level changer trigger
 * ($B3C271), sprite markers, bananas and banana bunches ($B3C345), life balloons ($B3C403) and
 * the air bubble generator ($B3C4BA).
 */
import { r16, w16, rom16 } from "../../core/mem";
import { reg } from "../../core/cpu";
import { L, R, sprite } from "../../core/sym";
import {
  process_sprite_animation,
  process_current_movement,
  get_current_sprite_clipping,
  CODE_BEBE6D,
  CODE_B5F94C,
  CODE_BEC689,
  CODE_BEC64C,
  CODE_BEC63E,
  CODE_B3A3EB,
  delete_sprite_handle_deallocation,
  delete_sprite_no_deallocation,
  queue_sound_effect,
  set_sprite_target_hud_position,
  move_sprite_to_target_hud_position,
} from "../../gen/routines";
import {
  cur, sr, sw, sr8, sinc, isNeg, sound, bcdAdc16, bcdSbc16,
  spriteStateHandler, returnHandleDespawn, registerSprite,
} from "./b3c_common";

// =============================================================================================
// Water level changer

/** `CMP m : ROR` — bit 15 = (a >= m), the rest = a >> 1. */
const cmpRor = (a: number, m: number) => ((a >= m ? 0x8000 : 0) | ((a & 0xffff) >> 1)) & 0xffff;

/**
 * $B3C271 — an invisible trigger line. State 0 is a vertical line (crossed horizontally), any
 * other state a horizontal one; $42 holds the half-lengths (low byte: after, high byte: before).
 * When the Kong crosses it, the water target ($0D52 / water_target_y_velocity) is set and the
 * trigger deletes itself. The trigger also checks the integrity of the anti-piracy routine.
 */
export function water_level_changer_main() {
  const x = cur();
  const kong = r16(R.active_kong_sprite);
  reg.x = x;
  reg.y = kong;
  const word = sr(x, sprite.state);
  const initialised = word >= 0x0100; // sub_state != 0
  const horizontal = (word & 0x00ff) !== 0;
  if (!horizontal) {
    if (!initialised) {
      initLine(x, sprite.x_position);
      return remember(x, kong);
    }
    // .CODE_B3C29D: did the Kong cross the line's y since last frame?
    rorTemp32(sr(kong, sprite.y_position) >= sr(x, sprite.y_position));
    const prev = cmpRor(sr(x, 0x48), sr(x, sprite.y_position));
    if (!isNeg(prev ^ r16(R.temp_32))) return remember(x, kong);
    return crossed(x, kong, sr(kong, sprite.x_position));
  }
  if (!initialised) {
    initLine(x, sprite.y_position);
    return remember(x, kong);
  }
  // .CODE_B3C2DC
  rorTemp32(sr(kong, sprite.x_position) >= sr(x, sprite.x_position));
  const prev = cmpRor(sr(x, 0x46), sr(x, sprite.x_position));
  if (!isNeg(prev ^ r16(R.temp_32))) return remember(x, kong);
  crossed(x, kong, sr(kong, sprite.y_position));
}

/** `ROR temp_32` with carry c (the side of the line the Kong is on now). */
const rorTemp32 = (c: boolean) => w16(R.temp_32, (c ? 0x8000 : 0) | (r16(R.temp_32) >> 1));

/** Init: $44 = pos + after, $42 = pos - before (the ends of the line). */
function initLine(x: number, posField: number) {
  const ext = sr(x, 0x42);
  const pos = sr(x, posField);
  sw(x, 0x44, (ext & 0xff) + pos);
  sw(x, 0x42, pos - ((ext >> 8) & 0xff));
  sinc(x, sprite.sub_state);
}

/** .CODE_B3C2B2 — remember the Kong position for the next frame. */
function remember(x: number, kong: number) {
  sw(x, 0x46, sr(kong, sprite.x_position));
  sw(x, 0x48, sr(kong, sprite.y_position));
  returnHandleDespawn();
}

/** .CODE_B3C2EF — the Kong crossed the line's axis at `along`: is it within the line? */
function crossed(x: number, kong: number, along: number) {
  if (along < sr(x, 0x42)) return remember(x, kong);
  if (((along - 1) & 0xffff) >= sr(x, 0x44)) return remember(x, kong);
  const id = sr(x, 0x4c);
  if (id !== 0 && id !== r16(0x0d52)) return deleteTrigger();
  // .CODE_B3C301: piracy check — the original adds up the code words at $80848B-$8084C2 and
  // deletes the trigger unless the sum is $20CB (a genuine cartridge). The port runs without
  // the original code, so the check passes. DB = $80 from here on.
  reg.db = 0x80;
  const t = cur();
  reg.x = t;
  w16(0x0d52, sr(t, 0x4e));
  w16(R.water_target_y_velocity, sr(t, sprite.y_speed));
  if (sr(t, sprite.movement_state) === 0) {
    const v = r16(0x0915);
    if (v !== 0 && v >= 0x001e) {
      w16(0x0915, 0);
      w16(0x0917, 0x003c);
    }
  }
  deleteTrigger();
}

/** .delete_water_level_changer_sprite */
function deleteTrigger() {
  delete_sprite_no_deallocation();
}

/** $B3C342 */
export function sprite_marker_main() {
  returnHandleDespawn();
}

// =============================================================================================
// Bananas

const BANANAS_TABLE = L("bananas_main") + 3;

/** $B3C345 */
export function bananas_main() {
  spriteStateHandler(BANANAS_TABLE);
}

/** $B3C350 — state 0: idle, collected on contact. */
export function CODE_B3C350() {
  process_sprite_animation();
  get_current_sprite_clipping();
  reg.a = 0x1529;
  CODE_BEBE6D();
  if (reg.c) return CODE_B3C3AC();
  returnHandleDespawn();
}

/** `AND #$C000 : EOR #$C000` — blink by toggling the display bits (other bits cleared). */
const blink = (x: number) => sw(x, sprite.display_mode, (sr(x, sprite.display_mode) & 0xc000) ^ 0xc000);

/** $B3C364 — state 1: collected; every 4 frames one banana is awarded (count in BCD). */
export function CODE_B3C364() {
  if (r16(R.active_frame_counter) & 0x0003) {
    process_sprite_animation();
    return;
  }
  reg.x = 0xf8f8;
  CODE_B5F94C();
  const x = cur();
  reg.x = x;
  blink(x);
  const left = bcdSbc16(sr(x, 0x4e), 0x0001, true);
  sw(x, 0x4e, left);
  if (left !== 0) {
    process_sprite_animation();
    return;
  }
  delete_sprite_handle_deallocation();
}

/** $B3C398 — state 2: thrown out by a Klobber; idle once the movement ends. */
export function CODE_B3C398() {
  process_current_movement();
  const x = reg.x;
  if ((sr(x, sprite.movement_state) & 0xff00) === 0) sinc(x, sprite.state);
  CODE_B3C3A5();
}

/** $B3C3A5 */
export function CODE_B3C3A5() {
  process_sprite_animation();
}

/** $B3C3AC — collect: add $4E (BCD) to the banana count. */
export function CODE_B3C3AC() {
  const x = reg.x;
  sw(x, sprite.state, 0x0001);
  w16(R.banana_count, bcdAdc16(sr(x, 0x4e), r16(R.banana_count), false));
  CODE_BEC689();
}

/** $B3C3C3 — state 3: dropped bunch; blinks faster and faster, then disappears. */
export function CODE_B3C3C3() {
  const x = reg.y;
  reg.x = x;
  const t = (sr(x, sprite.general_purpose_50) - 1) & 0xffff;
  sw(x, sprite.general_purpose_50, t);
  if (isNeg(t)) return CODE_B3C3FC();
  if (t >= 0x0078 || t & 0x0003) return CODE_B3C3E8();
  if (t >= 0x003c && t & 0x0007) return CODE_B3C3E8();
  CODE_B3C3DE();
}

/** $B3C3DE */
export function CODE_B3C3DE() {
  blink(reg.x);
  CODE_B3C3E8();
}

/** $B3C3E8 */
export function CODE_B3C3E8() {
  process_sprite_animation();
  get_current_sprite_clipping();
  reg.a = 0x1529;
  CODE_BEBE6D();
  if (reg.c) CODE_B3C3AC();
}

/** $B3C3FC */
export function CODE_B3C3FC() {
  delete_sprite_handle_deallocation();
}

// =============================================================================================
// Life balloon

const BALLOON_TABLE = L("life_balloon_main") + 3;

/** $B3C403 */
export function life_balloon_main() {
  spriteStateHandler(BALLOON_TABLE);
}

/** $B3C40E .idle_state */
export function life_balloon_main_idle_state() {
  const flags = r16(R.time_stop_flags);
  reg.a = flags;
  if (flags & 0x0004) return; // frozen
  get_current_sprite_clipping();
  CODE_BEBE6D();
  if (reg.c) return balloonCollect();
  balloonFloat();
}

/** .handle_floating — float up once the start delay ($04 = $8000 while waiting) is over. */
function balloonFloat() {
  process_sprite_animation();
  if (sr(reg.x, 0x04) === 0x8000) return returnHandleDespawn();
  process_current_movement();
  if ((sr(reg.x, sprite.movement_state) & 0x00ff) === 0x000c) return;
  CODE_B3A3EB();
  if (reg.c) w16(0x19bc, r16(0x19bc) - 1); // .CODE_B3C49E: one balloon less on screen
}

/** .collect_balloon */
function balloonCollect() {
  reg.a = sound(7, "life_balloon");
  queue_sound_effect();
  reg.x = cur();
  reg.a = sr(reg.x, 0x42);
  CODE_BEC64C();
  sw(reg.x, sprite.state, 0x0002);
  reg.a = 0x28d4;
  set_sprite_target_hud_position();
  process_sprite_animation();
}

/** $B3C466 .idle_state_single_collection — the balloon in K. Rool's cabin, collected once. */
export function life_balloon_main_idle_state_single_collection() {
  reg.a = 0x0010;
  if (r16(R.collected_kong_letters) & 0x0010) {
    delete_sprite_handle_deallocation();
    return;
  }
  get_current_sprite_clipping();
  CODE_BEBE6D();
  if (!reg.c) return balloonFloat();
  w16(R.collected_kong_letters, r16(R.collected_kong_letters) | 0x0010);
  balloonCollect();
}

/** $B3C487 .move_to_hud_state — fly to the life counter, then give the lives. */
export function life_balloon_main_move_to_hud_state() {
  move_sprite_to_target_hud_position();
  if (!reg.n) {
    process_sprite_animation();
    return;
  }
  reg.a = sr(reg.x, 0x42);
  CODE_BEC63E();
  delete_sprite_handle_deallocation();
  w16(0x19bc, r16(0x19bc) - 1);
}

/** $B3C4A4 .spawned_by_klobber_state — thrown up; once falling it floats normally. */
export function life_balloon_main_spawned_by_klobber_state() {
  process_current_movement();
  const x = reg.x;
  if (!isNeg(sr(x, sprite.y_speed))) {
    sw(x, sprite.movement_state, 0x0f0c);
    sw(x, sprite.state, 0);
  }
  process_sprite_animation();
}

/** $B3C4BA — sets the air bubble OAM properties ($0921) and removes itself. */
export function air_bubble_generator_main() {
  const x = cur();
  reg.x = x;
  w16(0x0921, (sr(x, sprite.oam_property) & 0xcfff) | 0x1000);
  delete_sprite_no_deallocation();
}

void sr8;

registerSprite({
  water_level_changer_main, sprite_marker_main, bananas_main, CODE_B3C350, CODE_B3C364,
  CODE_B3C398, CODE_B3C3A5, CODE_B3C3AC, CODE_B3C3C3, CODE_B3C3DE, CODE_B3C3E8, CODE_B3C3FC,
  life_balloon_main, life_balloon_main_idle_state, life_balloon_main_idle_state_single_collection,
  life_balloon_main_move_to_hud_state, life_balloon_main_spawned_by_klobber_state,
  air_bubble_generator_main,
});
