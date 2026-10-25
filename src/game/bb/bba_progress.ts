/**
 * Bank $BB (part a) — save-file progress bookkeeping: Kremkoins, DK coins, cleared levels and the
 * completion percentage shown on the file select screen.
 *
 * Progress flags are bit arrays in WRAM bank $7E, one bit per level number: the level number's low
 * nibble selects the bit and the high nibble selects the 16-bit word.
 */
import { r8, r16, w16, rom16 } from "../../core/mem";
import { read16x } from "./bba_util";
import { reg, register } from "../../core/cpu";
import { L, R, level, C } from "../../core/sym";
import { CODE_BBAF0F, CODE_BBAF0C } from "../../gen/routines";

const LEVEL_INDEX_TO_BITS = L("get_complete_bit_for_level_level_index_to_bits_table");
const LEVEL_TABLE_FD0000 = L("DATA_FD0000");
const LEVEL_1 = level._base + 0x3e; // level[1]: the scratch level config used to inspect destinations

function setNZ(a: number) {
  reg.z = (a & 0xffff) === 0;
  reg.n = (a & 0x8000) !== 0;
}

/** $BB80B4 — A = level number. Counts the bonus levels reachable from that level (high byte of $B0)
 * and how many of their Kremkoins are still uncollected (low byte). Returns A ($B0) with Z set when 0. */
export function CODE_BB80B4() {
  let a = reg.a & 0xffff;
  // Animal Antics' Rambi area shares its bonus bookkeeping with the next area
  if (a === C.level_animal_antics_rambi_area) a = (a + 1) & 0xffff;
  reg.a = a;
  CODE_BB80BA();
}

/** $BB80BA */
export function CODE_BB80BA() {
  w16(0xb0, 0);
  w16(0xb2, 0);
  reg.x = level._base;
  CODE_BBAF0F(); // load the level's config into level[0]
  const type = r16(level.type);
  if (type === C.normal_level_type || type === C.sub_level_type) return CODE_BB80D4();
  CODE_BB8110();
}

/** $BB80D4 — scan the 8 destinations of level[0] (X = $0E down to 0). */
export function CODE_BB80D4() {
  reg.x = 0x000e;
  CODE_BB80D7();
}

/** $BB80D7 — destination loop body, X = destination word offset. */
export function CODE_BB80D7() {
  let x = reg.x & 0xffff;
  for (;;) {
    const dest = r16(level.destinations + x);
    if (dest) {
      reg.a = dest;
      reg.x = LEVEL_1;
      CODE_BBAF0F(); // load the destination's config into level[1]
      if (r16(LEVEL_1 + 0) === C.bonus_level_type && (r16(LEVEL_1 + 0x18) & 0xff) !== 0) {
        w16(0xb2, (r16(0xb2) + 1) & 0xffff);
        reg.a = r16(level.destinations + x);
        is_krem_coin_collected();
        if (!reg.c) w16(0xb0, (r16(0xb0) + 1) & 0xffff);
      }
    }
    // PLX / DEX / DEX / BPL
    x = (x - 2) & 0xffff;
    if (x & 0x8000) break;
  }
  reg.x = x;
  const a = (((r16(0xb2) << 8) | (r16(0xb2) >> 8)) & 0xffff) | r16(0xb0);
  w16(0xb0, a);
  reg.a = a;
  reg.z = a === 0;
  reg.n = (a & 0x8000) !== 0;
}

/** $BB8110 — not a level with bonus rooms: A = 0. */
export function CODE_BB8110() {
  reg.a = 0;
  reg.z = true;
  reg.n = false;
}

/** $BB8114 */
export function is_current_krem_coin_collected() {
  reg.a = r16(R.level_number);
  is_krem_coin_collected();
}

/** $BB8116 — A = level number. Carry set if that bonus level's Kremkoin was collected. */
export function is_krem_coin_collected() {
  get_complete_bit_for_level();
  const a = r16(R.collected_tokens_buffer + reg.x) & r16(0x60);
  reg.a = a;
  reg.c = a !== 0;
  setNZ(a); // some callers branch with BEQ on the AND result
}

/** $BB8125 */
export function set_this_level_krem_coin_collected() {
  reg.a = r16(R.level_number);
  get_complete_bit_for_level();
  const a = r16(R.collected_tokens_buffer + reg.x) | r16(0x60);
  w16(R.collected_tokens_buffer + reg.x, a);
  reg.a = a;
}

/** $BB8135 */
export function is_current_level_dk_coin_collected() {
  reg.a = r16(R.parent_level_number);
  is_level_dk_coin_collected();
}

/** $BB8138 — A = level number. Carry set if its DK coin was collected. */
export function is_level_dk_coin_collected() {
  get_complete_bit_for_level();
  const a = r16(R.collected_dk_coins_buffer + reg.x) & r16(0x60);
  reg.a = a;
  reg.c = a !== 0;
  setNZ(a); // some callers branch with BEQ on the AND result
}

/** $BB8147 */
export function set_current_level_dk_coin_collected() {
  reg.a = r16(R.parent_level_number);
  get_complete_bit_for_level();
  const a = r16(R.collected_dk_coins_buffer + reg.x) | r16(0x60);
  w16(R.collected_dk_coins_buffer + reg.x, a);
  reg.a = a;
}

/** $BB8158 */
export function set_current_level_as_cleared() {
  reg.a = r16(R.parent_level_number);
  get_complete_bit_for_level();
  const a = r16(R.completed_levels_buffer + reg.x) | r16(0x60);
  w16(R.completed_levels_buffer + reg.x, a);
  reg.a = a;
}

/** $BB8169 — A = level number. Returns the word offset in X and the bit mask in $60. */
export function get_complete_bit_for_level() {
  const lvl = reg.a & 0xffff;
  w16(0x5e, lvl);
  const bit = rom16(LEVEL_INDEX_TO_BITS + (lvl & 0x0f) * 2);
  w16(0x60, bit);
  reg.x = ((lvl >> 4) << 1) & 0xffff;
  reg.a = reg.x;
}

/** $BB819F — recompute completion_percentage from the whole save file. */
export function calculate_completion_percentage() {
  w16(R.completion_percentage, 0);
  w16(0x72, 1);
  // one percent per level whose bonus Kremkoins are all collected
  do {
    const lvl = r16(0x72);
    if (lvl !== C.level_animal_antics_squitter_area) {
      reg.a = lvl;
      CODE_BB80B4();
      if (!reg.z && (reg.a & 0xff) === 0) w16(R.completion_percentage, (r16(R.completion_percentage) + 1) & 0xffff);
    }
    w16(0x72, (r16(0x72) + 1) & 0xffff);
  } while (rom16(LEVEL_TABLE_FD0000 + ((r16(0x72) << 1) & 0xffff)) !== 0);

  // one percent per cleared level (16 words of flags via the long pointer at $26)
  w16(0x26, R.completed_levels_buffer & 0xffff);
  w16(0x28, (R.completed_levels_buffer >> 16) & 0xff);
  let count = 0;
  w16(0x5e, 0x10);
  do {
    let flags = read16x((r8(0x28) << 16) | r16(0x26)); // LDA [$26]
    for (let i = 0; i < 16; i++) {
      if (flags & 1) count++;
      flags >>= 1;
    }
    w16(0x26, (r16(0x26) + 2) & 0xffff);
    w16(0x5e, (r16(0x5e) - 1) & 0xffff);
  } while (r16(0x5e) !== 0);
  w16(R.completion_percentage, (count + r16(R.completion_percentage)) & 0xffff);

  // bosses are worth extra
  const bosses: [number, number][] = [
    [C.level_krows_nest, 1],
    [C.level_kleevers_kiln, 1],
    [C.level_kreepy_krow, 1],
    [C.level_king_zing_sting, 1],
    [C.level_kudgels_kontest, 1],
    [C.level_krool_duel, 4],
    [C.level_krocodile_kore, 4],
  ];
  for (const [lvl, pct] of bosses) {
    reg.a = lvl;
    reg.y = pct;
    apply_percentage_if_boss_cleared();
  }
  // and one percent per Kong family member visited
  let visited = r16(R.visited_kong_family_members);
  for (let i = 0; i < 4; i++) {
    if (visited & 1) w16(R.completion_percentage, (r16(R.completion_percentage) + 1) & 0xffff);
    visited >>= 1;
  }
  reg.x = 0;
  // CODE_BB80B4 loaded other levels into level[0]: reload the current one
  reg.a = r16(R.level_number);
  CODE_BBAF0C();
}

/** $BB824B — A = boss level, Y = percentage it is worth. */
export function apply_percentage_if_boss_cleared() {
  const pct = reg.y;
  is_level_cleared();
  if (!reg.c) return;
  const a = (pct + r16(R.completion_percentage)) & 0xffff;
  w16(R.completion_percentage, a);
  reg.a = a;
}

/** $BB825C — A = level number. Carry set if the level was cleared. */
export function is_level_cleared() {
  get_complete_bit_for_level();
  const a = r16(R.completed_levels_buffer + reg.x) & r16(0x60);
  reg.a = a;
  reg.c = a !== 0;
  setNZ(a); // some callers branch with BEQ on the AND result
}

register({
  CODE_BB80B4,
  CODE_BB80BA,
  CODE_BB80D4,
  CODE_BB80D7,
  CODE_BB8110,
  is_current_krem_coin_collected,
  is_krem_coin_collected,
  set_this_level_krem_coin_collected,
  is_current_level_dk_coin_collected,
  is_level_dk_coin_collected,
  set_current_level_dk_coin_collected,
  set_current_level_as_cleared,
  get_complete_bit_for_level,
  calculate_completion_percentage,
  apply_percentage_if_boss_cleared,
  is_level_cleared,
});
