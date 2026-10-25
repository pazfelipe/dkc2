/**
 * Bank $BB (part b) — save management: SRAM file validation (signature + additive and XOR
 * checksums), building the save buffer from the game state and writing it to SRAM, loading a
 * player's part of a file back, and swapping the per-player RAM in 2-player games.
 *
 * A save file (sizeof $2A8, three of them in SRAM at $B06008/$B062B0/$B06558):
 *   +0 additive checksum, +2 XOR checksum (both over +6..+$2A1), +4 'R' | active player bit,
 *   +5 game mode, +6 player 1 data, +$154 player 2 data (2-player contest).
 */
import { r8, r16, w8, w16, rom16, bus8, busW8 } from "../../core/mem";
import { reg, register } from "../../core/cpu";
import { setRetMode, RET_RTS, RET_RTL } from "../../core/hybrid";
import { L, R, C } from "../../core/sym";
import { calculate_completion_percentage, set_default_new_file_status_global, set_active_kong_global } from "../../gen/routines";
import { chargeOps } from "./bba_util";

const SAVE_SIZE = 0x2a8;
const FILE_OFFSETS = L("validate_save_file_sram_file_offsets_low");
const FILE_ADDRESSES = L("save_file_addresses");
const BUFFER = R.sram_file_buffer & 0xffff;
const ptr26 = () => (r16(0x26) | (r8(0x28) << 16)) & 0xffffff;
const ptrD9 = () => (r16(0xd9) | (r8(0xdb) << 16)) & 0xffffff;
/** `[dp],y` long indirect indexed (24-bit add). */
const at = (base: number, y: number) => (base + y) & 0xffffff;
const rd16 = (a: number) => bus8(a) | (bus8((a + 1) & 0xffffff) << 8);
const wr16 = (a: number, v: number) => {
  busW8(a, v & 0xff);
  busW8((a + 1) & 0xffffff, (v >> 8) & 0xff);
};

/** $BBC53A — A = file number: carry set when the SRAM file is valid. */
export function validate_save_file() {
  const x = (reg.a << 2) & 0xffff;
  reg.x = x;
  w16(0x26, rom16(FILE_OFFSETS + x));
  w16(0x28, rom16(FILE_OFFSETS + 2 + x));
  const sig = rd16(at(ptr26(), 4)) & 0xfffe;
  reg.y = 4;
  reg.a = sig;
  const ok =
    sig === ((C.gamemode_1_player << 8) | 0x52) ||
    sig === ((C.gamemode_2_player_team << 8) | 0x52) ||
    sig === ((C.gamemode_2_player_contest << 8) | 0x52);
  if (!ok) return validate_save_file_invalid_file();
  calculate_checksum();
  reg.y = 0;
  reg.a = rd16(at(ptr26(), 0));
  if (reg.a !== r16(0x5e)) return validate_save_file_invalid_file();
  reg.y = 2;
  reg.a = rd16(at(ptr26(), 2));
  if (reg.a !== r16(0x60)) return validate_save_file_invalid_file();
  reg.c = true;
}

/** $BBC577 */
export function validate_save_file_invalid_file() {
  reg.c = false;
}

/** $BBC585 — checksums of [$26] + 6 .. +$2A1 into $5E (sum) and $60 (XOR). */
export function calculate_checksum() {
  const base = ptr26();
  let sum = 0;
  let xor = 0;
  for (let y = 6; y !== SAVE_SIZE - 6; y += 2) sum = (sum + rd16(at(base, y))) & 0xffff;
  for (let y = 6; y !== SAVE_SIZE - 6; y += 2) xor ^= rd16(at(base, y));
  w16(0x5e, sum);
  w16(0x60, xor);
  reg.a = xor;
  reg.y = SAVE_SIZE - 6;
  chargeOps(((SAVE_SIZE - 12) / 2) * 13 + 6);
}

/** $BBC5AB — save the game (both players' halves in a contest). */
export function CODE_BBC5AB() {
  const db = reg.db;
  if (r16(0x060d) === C.gamemode_2_player_contest) {
    CODE_BBC85B();
    update_save_buffer();
    copy_save_to_sram();
    CODE_BBC85B();
  }
  update_save_buffer();
  copy_save_to_sram();
  reg.db = db;
}

/** $BBC5CC — copy the save buffer ($7E56CA) to the selected SRAM file. */
export function copy_save_to_sram() {
  const sel = (r16(R.file_select_selection) << 1) & 0xffff;
  reg.x = sel;
  w16(0x32, rom16(FILE_ADDRESSES + sel));
  w16(0x34, (L("sram_base") >> 16) & 0xff);
  const dst = (r16(0x32) | (r8(0x34) << 16)) & 0xffffff;
  for (let y = SAVE_SIZE - 2; y >= 0; y -= 2) wr16(at(dst, y), r16(0x7e0000 | (BUFFER + y)));
  reg.y = 0xfffe;
  reg.db = 0xbb; // the pushed program bank of %pea_use_dbr
  chargeOps((SAVE_SIZE / 2) * 5 + 12);
}

/** The player's half of the save buffer: $D9 = buffer + 6 (player 1) or + $154 (contest player 2). */
function playerHalf() {
  const p2 = r16(0x060d) === C.gamemode_2_player_contest && (r16(R.active_controller) & 0x0001) !== 0;
  const off = p2 ? 0x0154 : 0x0006;
  const lo = off + r16(0x26);
  w16(0xd9, lo & 0xffff);
  w16(0xdb, (r16(0x28) + (lo > 0xffff ? 1 : 0)) & 0xffff);
}

/** 16 words of a WRAM buffer <-> the save data (Y = last word offset in the file). */
function copyWords(buf: number, yEnd: number, toFile: boolean) {
  const base = ptrD9();
  let y = yEnd;
  for (let x = 0x1e; x >= 0; x -= 2) {
    if (toFile) wr16(at(base, y), r16(buf + x));
    else w16(buf + x, rd16(at(base, y)));
    y -= 2;
  }
}

/** $BBC5F4 — build the save buffer from the current game state (with checksums). */
export function update_save_buffer() {
  calculate_completion_percentage();
  w16(0x26, BUFFER);
  w16(0x28, 0x007e);
  busW8(at(ptr26(), 5), r8(0x060d));
  busW8(at(ptr26(), 4), (r8(R.active_controller) & 0x01) | 0x52);
  playerHalf();
  const base = ptrD9();
  wr16(at(base, 0), r16(R.gameplay_frame_counter));
  wr16(at(base, 2), r16(R.gameplay_frame_counter_high));
  busW8(at(base, 4), r8(R.completion_percentage));
  busW8(at(base, 5), r8(R.token_count));
  busW8(at(base, 6), r8(R.dk_coin_count));
  busW8(at(base, 7), r8(R.competitor_dk_coin_count));
  busW8(at(base, 8), r8(R.level_number));
  busW8(at(base, 0xb3), r8(R.active_kong_number));
  for (let x = 0x2f, y = 0xe3; x >= 0; x--, y--) busW8(at(base, y), r8(R.completed_npc_dialogue + x));
  wr16(at(base, 0xad), r16(R.world_number));
  wr16(at(base, 0xaf), r16(R.map_node_number));
  wr16(at(base, 0xb1), r16(0x06a9));
  wr16(at(base, 0xe4), r16(R.cheat_enable_flags));
  const flags = r16(R.game_state_flags) | 0x0200; // "file has been saved"
  w16(R.game_state_flags, flags);
  wr16(at(base, 0x09), flags);
  wr16(at(base, 0x0b), r16(R.game_state_flags_2));
  copyWords(R.map_icon_unlocks_buffer, 0x2b, true);
  copyWords(R.map_path_unlocks_buffer, 0x4b, true);
  copyWords(R.collected_tokens_buffer, 0x6b, true);
  copyWords(R.collected_dk_coins_buffer, 0x8b, true);
  copyWords(R.completed_levels_buffer, 0xab, true);
  calculate_checksum();
  wr16(at(ptr26(), 0), r16(0x5e));
  reg.a = r16(0x60);
  wr16(at(ptr26(), 2), reg.a);
  reg.y = 2;
  chargeOps(400);
}

/** $BBC736 — load the current player's progress from the save buffer (if it was ever saved). */
export function CODE_BBC736() {
  set_default_new_file_status_global();
  w16(0x26, BUFFER);
  w16(0x28, 0x007e);
  playerHalf();
  CODE_BBC75C_();
}

/** $BBC759 — (branch target) player 1 half. */
export function CODE_BBC759() {
  reg.a = 0x0006;
  CODE_BBC75C();
}
/** $BBC75C — A = offset of the player's half in the buffer at [$26]. */
export function CODE_BBC75C() {
  const lo = reg.a + r16(0x26);
  w16(0xd9, lo & 0xffff);
  w16(0xdb, (r16(0x28) + (lo > 0xffff ? 1 : 0)) & 0xffff);
  CODE_BBC75C_();
}
function CODE_BBC75C_() {
  const base = ptrD9();
  reg.y = 9;
  reg.a = rd16(at(base, 9));
  w16(R.game_state_flags, reg.a);
  if (!(reg.a & 0x0200)) return;
  CODE_BBC776();
}

/** $BBC776 — $D9 = the player's save data: restore it. */
export function CODE_BBC776() {
  const base = ptrD9();
  w16(R.game_state_flags_2, rd16(at(base, 0x0b)));
  w16(R.gameplay_frame_counter, rd16(at(base, 0)));
  w16(R.gameplay_frame_counter_high, rd16(at(base, 2)));
  w8(R.completion_percentage, bus8(at(base, 4)));
  w8(R.token_count, bus8(at(base, 5)));
  w8(R.dk_coin_count, bus8(at(base, 6)));
  w8(R.competitor_dk_coin_count, bus8(at(base, 7)));
  w8(R.level_number, bus8(at(base, 8)));
  w8(R.active_kong_number, bus8(at(base, 0xb3)));
  for (let x = 0x2f, y = 0xe3; x >= 0; x--, y--) w8(R.completed_npc_dialogue + x, bus8(at(base, y)));
  w16(R.world_number, rd16(at(base, 0xad)));
  w16(R.map_node_number, rd16(at(base, 0xaf)));
  w16(0x06a9, rd16(at(base, 0xb1)));
  w16(R.cheat_enable_flags, rd16(at(base, 0xe4)) & 0xfffd);
  copyWords(R.map_icon_unlocks_buffer, 0x2b, false);
  copyWords(R.map_path_unlocks_buffer, 0x4b, false);
  copyWords(R.collected_tokens_buffer, 0x6b, false);
  copyWords(R.collected_dk_coins_buffer, 0x8b, false);
  copyWords(R.completed_levels_buffer, 0xab, false);
  w16(0x06a3, r16(0x06a3) | 0x0040);
  reg.a = r16(R.active_kong_number);
  chargeOps(400);
  set_active_kong_global();
}

/** $BBC85B — 2-player: store this player's RAM, switch controller, load the other's. */
export function CODE_BBC85B() {
  CODE_BBC86F();
  w16(R.active_controller, r16(R.active_controller) ^ 0x0001);
  CODE_BBC8B7();
  w16(R.animal_type, 0);
  w16(R.current_player_mount, 0);
}

const PLAYER_BUF = R.player_1_ram_buffer & 0xffff;
const PLAYER_SIZE = C.player_RAM_buffer_size;

/** Player RAM <-> buffer at [$26]: $D1-$D8, $064A-$0906, the map icon unlock buffers. */
function swapPlayer(toBuffer: boolean) {
  const base = ptr26();
  let y = 0;
  const xfer = (wram: number) => {
    if (toBuffer) busW8(at(base, y), r8(wram));
    else w8(wram, bus8(at(base, y)));
    y++;
  };
  for (let x = 0; x < 8; x++) xfer(0xd1 + x);
  for (let x = 0; x < 0x2bd; x++) xfer(0x064a + x);
  for (let x = 0; x < 0xa0; x++) xfer(R.map_icon_unlocks_buffer + x);
  reg.x = 0xa0;
  reg.y = y;
  chargeOps(y * 6 + 20);
}

/** $BBC86F — save the active controller's player RAM. */
export function CODE_BBC86F() {
  w16(0x28, (R.player_1_ram_buffer >> 16) & 0xff);
  reg.a = r16(R.active_controller) ? (PLAYER_BUF + PLAYER_SIZE) & 0xffff : PLAYER_BUF;
  CODE_BBC880();
}
/** $BBC880 — A = buffer address. */
export function CODE_BBC880() {
  w16(0x26, reg.a);
  swapPlayer(true);
}

/** $BBC8B7 — load the player RAM of the controller in $060F. */
export function CODE_BBC8B7() {
  w16(0x28, (R.player_1_ram_buffer >> 16) & 0xff);
  reg.a = r16(R.active_controller) ? (PLAYER_BUF + PLAYER_SIZE) & 0xffff : PLAYER_BUF;
  CODE_BBC8C8();
}
/** $BBC8C8 — A = buffer address. */
export function CODE_BBC8C8() {
  w16(0x26, reg.a);
  swapPlayer(false);
}



for (const n of ["calculate_checksum", "copy_save_to_sram", "CODE_BBC86F", "CODE_BBC880", "CODE_BBC8B7", "CODE_BBC8C8"]) setRetMode(L(n), RET_RTS);
for (const n of ["validate_save_file", "validate_save_file_invalid_file", "CODE_BBC5AB", "update_save_buffer", "CODE_BBC736", "CODE_BBC759", "CODE_BBC75C", "CODE_BBC776", "CODE_BBC85B"]) setRetMode(L(n), RET_RTL);

register({
  validate_save_file,
  validate_save_file_invalid_file,
  calculate_checksum,
  CODE_BBC5AB,
  copy_save_to_sram,
  update_save_buffer,
  CODE_BBC736,
  CODE_BBC759,
  CODE_BBC75C,
  CODE_BBC776,
  CODE_BBC85B,
  CODE_BBC86F,
  CODE_BBC880,
  CODE_BBC8B7,
  CODE_BBC8C8,
});
