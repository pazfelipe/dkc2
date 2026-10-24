/**
 * Bank $B3 — the sprite handler: runs the "main" routine of every live sprite once per frame.
 *
 * DKC2 keeps up to 25 game sprites in a table at $0D84 (0x5E bytes each, see `sprite` fields).
 * Slot 0 is auxiliary, slots 1 and 2 are always Diddy and Dixie. A slot with type 0 is free.
 * The type is a byte offset into `sprite_main_table` (4 bytes per type: main pointer + flags).
 */
import { r8, w8, r16, w16, rom16 } from "../../core/mem";
import { register } from "../../core/cpu";
import { L, R, sprite, sprite_table } from "../../core/sym";
import { jumpToSpriteMain } from "../common/dispatch";
import {
  init_player_clipping,
  process_interactions_with_player,
  process_platform_sprites,
  handle_kong_follow,
  process_looping_sounds,
} from "../../gen/routines";

const SPRITE_SIZE = 0x5e;
const SPRITE_TIME_STOP_FLAGS_TABLE = L("sprite_time_stop_flags_table");

/** $B38007 */
export function sprite_handler() {
  w8(0x19b3, r8(0x19b2));
  w8(0x19b2, 0);
  // looping sound requests are rebuilt by the sprites every frame
  w8(R.zinger_loop_sound_enabler, 0);
  w8(R.flitter_loop_sound_enabler, 0);
  w8(R.invincible_loop_sound_enabler, 0);
  w8(R.wind_loop_sound_enabler, 0);
  w8(R.barrel_roll_loop_sound_enabler, 0);
  w16(R.sprite_return_bank, 0xb3);
  w16(R.current_sprite_constants_bank, 0xff);
  init_player_clipping();

  const timeStop = r16(R.time_stop_flags);
  if (timeStop & 0x0080) {
    // everything frozen: only player interactions and platforms run
    process_interactions_with_player();
    finishTimeStop();
    return;
  }
  if (timeStop) return timeStopSpriteHandler();

  w16(R.sprite_return_address, L("sprite_handler_sprite_return") & 0xffff);
  for (let x: number = sprite_table.slot_1; x !== sprite_table.end; x += SPRITE_SIZE) {
    const type = r16(x + sprite.type);
    if (!type) continue;
    w16(R.current_sprite, x);
    jumpToSpriteMain(type);
    x = r16(R.current_sprite); // .sprite_return: LDX current_sprite
  }
  process_interactions_with_player();
  process_platform_sprites();
  handle_kong_follow();
  process_looping_sounds();
}

/** $B38071 .finish_time_stop_handler — platforms and sounds still run, then the time stop counts down. */
function finishTimeStop() {
  process_platform_sprites();
  process_looping_sounds();
  const t = (r16(R.time_stop_timer) - 1) & 0xffff;
  w16(R.time_stop_timer, t);
  if (t === 0) w16(R.time_stop_flags, 0);
  else if (t & 0x8000) w16(R.time_stop_timer, 0);
}

/** $B38087 .time_stop_sprite_handler — like the normal loop, but stopped sprites are skipped. */
function timeStopSpriteHandler() {
  w16(R.sprite_return_address, L("sprite_handler_time_stop_sprite_handler_sprite_return") & 0xffff);
  for (let x: number = sprite_table.slot_1; x !== sprite_table.end; x += SPRITE_SIZE) {
    const type = r16(x + sprite.type);
    if (!type) continue;
    w16(R.current_sprite, x);
    if (runsDuringTimeStop(x, type)) jumpToSpriteMain(type);
    x = r16(R.current_sprite);
  }
  process_interactions_with_player();
  handle_kong_follow();
  finishTimeStop();
}

function runsDuringTimeStop(slot: number, type: number): boolean {
  const flags = r16(R.time_stop_flags);
  if (!(flags & 0x001c)) return true;
  if (slot < sprite_table.slot_3) {
    // a Kong
    if (slot === r16(R.inactive_kong_sprite)) return !(flags & 0x0010);
    return !(flags & 0x0008);
  }
  if (!(flags & 0x0004)) return true;
  return (rom16(SPRITE_TIME_STOP_FLAGS_TABLE + type) & 0x0001) !== 0;
}

register({ sprite_handler });
