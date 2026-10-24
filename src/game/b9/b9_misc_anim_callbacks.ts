/**
 * Bank $B9 — miscellaneous animation callbacks ($B9EE4B-$B9F084): DK barrel, animal crates,
 * Rattly/Clapper, and thin wrappers that let boss and level-object animation scripts call
 * routines of other banks (an RTS-terminated callback can only live in bank $B9).
 */
import { r16, w16, rom16 } from "../../core/mem";
import { reg, register } from "../../core/cpu";
import { L, R, sprite, C } from "../../core/sym";
import * as G from "../../gen/routines";
import { set_sprite_animation } from "./b9_anim_core";
import { anim_delete_sprite } from "./b9_enemy_anim_callbacks";
import { dbRead16, dbWrite16, cmpN, queue_sound_effect } from "./b9_anim_util";

const sound = (channel: number, id: number) => ((channel << 8) | id) & 0xffff;
const ANIMAL_CRATE_SPAWN_SCRIPTS = L("DATA_FF0D64");
const DK_BARREL_LETTERS_SPAWN = L("DATA_FF164E") & 0xffff;

/** $B9EE4B — "DK barrel" voice, only when the player has a single Kong. */
export function play_dk_barrel_sound_if_one_kong() {
  if (r16(R.game_state_flags) & 0x4000) return;
  reg.x = sound(5, C.sound_kong_dk_barrel);
  reg.y = sound(5, C.sound_kong_dk_barrel);
  G.play_kong_dependant_sound_global();
}

/** $B9EE5F — DK barrel: spawn its floating letters (once) and keep them in sync. */
export function CODE_B9EE5F() {
  if (r16(reg.x + sprite.display_mode) === 0xc000) return;
  const linked = r16(reg.x + sprite.general_purpose_48);
  reg.y = linked;
  if (dbRead16(linked + sprite.type) === C.sprite_dk_barrel_letters) return;
  CODE_B9EE72();
}

/** $B9EE72 */
export function CODE_B9EE72() {
  reg.y = DK_BARREL_LETTERS_SPAWN;
  G.spawn_special_sprite_address();
  if (reg.c) return;
  const letters = r16(R.alternate_sprite);
  const me = r16(R.current_sprite);
  dbWrite16(letters + sprite.general_purpose_42, me);
  reg.x = me;
  w16(me + sprite.general_purpose_48, letters);
  // the letters run before the barrel this frame when in an earlier slot: compensate
  if (cmpN(me, letters)) return;
  reg.y = letters;
  dbWrite16(letters + sprite.animation_timer, (dbRead16(letters + sprite.animation_timer) - 0x0100) & 0xffff);
}

/** $B9EE99 */
export function CODE_B9EE99() {
  w16(reg.x + sprite.state, 0x0002);
}

/** $B9EE9F */
export function spawn_animal_crate_smoke() {
  reg.y = C.special_sprite_spawn_id_0048;
  G.spawn_special_sprite_index();
}

/** $B9EEA7 — the animal crate breaks: delete it and release its animal buddy. */
export function spawn_animal_crate_animal() {
  G.delete_sprite_handle_deallocation();
  if (r16(R.animal_type)) return;
  const x = r16(R.current_sprite);
  reg.x = x;
  if (r16(x + sprite.state) === 0x0004) return;
  const index = (((r16(x + sprite.general_purpose_42) - C.animal_crate_anim_range_start) & 0xffff) << 1) & 0xffff;
  reg.x = index;
  reg.y = rom16(ANIMAL_CRATE_SPAWN_SCRIPTS + index);
  G.spawn_special_sprite_address();
}

/** $B9EECA — (unreferenced) RTL. */
export function CODE_B9EECA() {}

/** $B9EECB */
export function CODE_B9EECB() {
  const x = reg.x;
  w16(R.RAM_0B02, r16(R.RAM_0B02) | 0x0080);
  w16(x + sprite.x_speed, 0);
  w16(x + sprite.max_x_speed, 0);
  w16(x + sprite.state, 0x0001);
}

/** $B9EEDB */
export function CODE_B9EEDB() {
  w16(R.RAM_0B02, r16(R.RAM_0B02) & ~0x0080);
}

/** $B9EEE2 */
export function CODE_B9EEE2() {
  w16(reg.x + sprite.state, 0x0003);
}

/** $B9EEE8 */
export function CODE_B9EEE8() {
  anim_delete_sprite();
}

/** $B9EEEB — spawn the rain cloud (loop). */
export function CODE_B9EEEB() {
  reg.y = C.special_sprite_spawn_id_001C;
  G.spawn_special_sprite_index();
}

/** $B9EEF3 */
export function anim_delete_sprite_2() {
  G.delete_sprite_handle_deallocation();
}

/** $B9EEF8 */
export function set_rattly_idle_no_player_animation() {
  reg.a = C.enguarde_no_player_idle_anim_id;
  set_sprite_animation();
}

/** $B9EF00 — Clapper's breath freezes the water: keep the longest freeze timer, spit sound. */
export function set_clapper_water_timer() {
  const t = r16(reg.x + sprite.general_purpose_44);
  if (t >= r16(0x0915)) w16(0x0915, t);
  reg.a = sound(6, C.sound_clapper_spit);
  queue_sound_effect();
}

/** $B9EF12 */
export function spawn_clapper_breath() {
  reg.y = C.special_sprite_spawn_id_00DE;
  G.spawn_no_gfx_special_sprite_index();
}

/** $B9EF1A */
export function set_clapper_idle_animation() {
  reg.a = C.clapper_idle_anim_id;
  set_sprite_animation();
}

/** $B9EF22 */
export function CODE_B9EF22() {
  w16(reg.x + sprite.x_speed, 0);
}

/** $B9EF25 */
export function set_hit_by_klubba_interaction() {
  reg.a = C.player_interaction_26;
  G.set_player_interaction_global();
}

/** $B9EF2D */
export function CODE_B9EF2D() {
  G.CODE_B68CC2();
}
/** $B9EF32 */
export function CODE_B9EF32() {
  G.CODE_B68CE1();
}
/** $B9EF37 */
export function CODE_B9EF37() {
  G.CODE_B68CB7();
}
/** $B9EF3C */
export function CODE_B9EF3C() {
  G.CODE_B69D96();
}

/** $B9EF41 */
export function CODE_B9EF41() {
  w16(reg.x + sprite.state, (r16(reg.x + sprite.state) + 1) & 0xffff);
}

/** $B9EF44 */
export function CODE_B9EF44() {
  w16(0x06a3, r16(0x06a3) | 0x4000);
}

/** $B9EF50 */
export function CODE_B9EF50() {
  G.CODE_B69043();
}
/** $B9EF55 */
export function CODE_B9EF55() {
  G.CODE_B6A838();
}

/** $B9EF5A — K. Rool's final hit: start the Kong cutscene (4, or $B in Krocodile Kore). */
export function CODE_B9EF5A() {
  const kong = r16(R.active_kong_sprite);
  reg.x = kong;
  if (r16(kong + sprite.state) === 0x0005) return;
  const scene = r16(R.level_number) === C.level_krocodile_kore ? 0x000b : 0x0004;
  reg.y = scene;
  reg.a = scene;
  G.kong_cutscene_handler();
}

/** $B9EF77 */
export function CODE_B9EF77() {
  G.CODE_B6A3F4();
}
/** $B9EF7C */
export function CODE_B9EF7C() {
  G.CODE_B6A40F();
}
/** $B9EF81 */
export function CODE_B9EF81() {
  G.CODE_B6A41C();
}
/** $B9EF86 */
export function CODE_B9EF86() {
  G.CODE_B6A421();
}
/** $B9EF8B */
export function CODE_B9EF8B() {
  G.CODE_B6A7E8();
}
/** $B9EF90 */
export function CODE_B9EF90() {
  G.CODE_B6AD8B();
}
/** $B9EF95 */
export function CODE_B9EF95() {
  G.CODE_B6AD93();
}

/** $B9EF9A — INC $0A,x (16-bit). */
export function CODE_B9EF9A() {
  const a = (reg.x + 0x0a) & 0xffff;
  w16(a, (r16(a) + 1) & 0xffff);
}

/** $B9EF9D */
export function CODE_B9EF9D() {
  G.CODE_B6ACD8();
}
/** $B9EFA2 */
export function CODE_B9EFA2() {
  G.CODE_B6A3CE();
}
/** $B9EFA7 */
export function CODE_B9EFA7() {
  G.CODE_B6A8E0();
}
/** $B9EFAC */
export function CODE_B9EFAC() {
  G.CODE_B6ABCB();
}
/** $B9EFB1 */
export function CODE_B9EFB1() {
  G.CODE_B69493();
}
/** $B9EFB6 */
export function CODE_B9EFB6() {
  G.CODE_B69499();
}
/** $B9EFBB */
export function CODE_B9EFBB() {
  G.CODE_B6A892();
}
/** $B9EFC0 */
export function CODE_B9EFC0() {
  G.CODE_B6AD0D();
}
/** $B9EFC5 */
export function CODE_B9EFC5() {
  G.CODE_B6AA9B();
}
/** $B9EFCA */
export function CODE_B9EFCA() {
  G.CODE_B6AAA4();
}
/** $B9EFCF */
export function CODE_B9EFCF() {
  G.CODE_B6AA8B();
}
/** $B9EFD4 */
export function CODE_B9EFD4() {
  G.CODE_B6AA93();
}
/** $B9EFD9 */
export function CODE_B9EFD9() {
  G.CODE_B6AABE();
}
/** $B9EFDE */
export function CODE_B9EFDE() {
  G.CODE_B6AAAA();
}
/** $B9EFE3 */
export function CODE_B9EFE3() {
  G.CODE_B6AC99();
}
/** $B9EFE8 */
export function CODE_B9EFE8() {
  G.CODE_BA9751();
}
/** $B9EFED */
export function CODE_B9EFED() {
  G.CODE_BA943A();
}
/** $B9EFF2 */
export function CODE_B9EFF2() {
  G.CODE_BA9450();
}
/** $B9EFF7 */
export function CODE_B9EFF7() {
  G.CODE_B6DD63();
}
/** $B9EFFC */
export function CODE_B9EFFC() {
  G.CODE_B6DBF6();
}
/** $B9F001 */
export function CODE_B9F001() {
  G.CODE_B6DBBA();
}
/** $B9F006 */
export function CODE_B9F006() {
  G.CODE_B6DBD2();
}
/** $B9F00B */
export function CODE_B9F00B() {
  G.CODE_B6DB36();
}
/** $B9F010 */
export function CODE_B9F010() {
  G.CODE_B6DBE0();
}
/** $B9F015 */
export function CODE_B9F015() {
  G.CODE_B6DC2B();
}
/** $B9F01A */
export function CODE_B9F01A() {
  G.CODE_B6DC3F();
}
/** $B9F01F */
export function CODE_B9F01F() {
  G.CODE_B6CA9E();
}
/** $B9F024 */
export function CODE_B9F024() {
  G.CODE_B6CF91();
}
/** $B9F029 */
export function CODE_B9F029() {
  G.CODE_B6CF96();
}
/** $B9F02E */
export function CODE_B9F02E() {
  G.CODE_B6CF9B();
}
/** $B9F033 */
export function CODE_B9F033() {
  G.CODE_B6CFA0();
}
/** $B9F038 */
export function CODE_B9F038() {
  G.CODE_B6CFA5();
}
/** $B9F03D */
export function CODE_B9F03D() {
  G.CODE_B6CFAA();
}
/** $B9F042 */
export function CODE_B9F042() {
  G.CODE_B6CFCA();
}
/** $B9F047 */
export function CODE_B9F047() {
  G.CODE_B6CFD1();
}
/** $B9F04C */
export function CODE_B9F04C() {
  G.CODE_B6CFD8();
}
/** $B9F051 */
export function CODE_B9F051() {
  G.CODE_B6F753();
}
/** $B9F056 */
export function CODE_B9F056() {
  G.CODE_B6F71A();
}
/** $B9F05B */
export function CODE_B9F05B() {
  G.CODE_B6F725();
}
/** $B9F060 */
export function CODE_B9F060() {
  G.CODE_B6F72F();
}
/** $B9F065 */
export function CODE_B9F065() {
  G.CODE_B6F746();
}
/** $B9F06A */
export function CODE_B9F06A() {
  G.CODE_B6F904();
}

/** $B9F06F — level goal: mark the level cleared and make the Kongs celebrate. */
export function set_celebrate_interaction_and_clear_level() {
  G.set_current_level_as_cleared();
  reg.a = C.player_interaction_27;
  G.set_player_interaction_global();
}

/** $B9F07B — (unreferenced) level end exit states and fadeout. */
export function CODE_B9F07B() {
  G.set_level_end_exit_state_global();
}

/** $B9F080 */
export function CODE_B9F080() {
  G.CODE_BAC256();
}

register({
  play_dk_barrel_sound_if_one_kong,
  CODE_B9EE5F,
  CODE_B9EE72,
  CODE_B9EE99,
  spawn_animal_crate_smoke,
  spawn_animal_crate_animal,
  CODE_B9EECA,
  CODE_B9EECB,
  CODE_B9EEDB,
  CODE_B9EEE2,
  CODE_B9EEE8,
  CODE_B9EEEB,
  anim_delete_sprite_2,
  set_rattly_idle_no_player_animation,
  set_clapper_water_timer,
  spawn_clapper_breath,
  set_clapper_idle_animation,
  CODE_B9EF22,
  set_hit_by_klubba_interaction,
  CODE_B9EF2D,
  CODE_B9EF32,
  CODE_B9EF37,
  CODE_B9EF3C,
  CODE_B9EF41,
  CODE_B9EF44,
  CODE_B9EF50,
  CODE_B9EF55,
  CODE_B9EF5A,
  CODE_B9EF77,
  CODE_B9EF7C,
  CODE_B9EF81,
  CODE_B9EF86,
  CODE_B9EF8B,
  CODE_B9EF90,
  CODE_B9EF95,
  CODE_B9EF9A,
  CODE_B9EF9D,
  CODE_B9EFA2,
  CODE_B9EFA7,
  CODE_B9EFAC,
  CODE_B9EFB1,
  CODE_B9EFB6,
  CODE_B9EFBB,
  CODE_B9EFC0,
  CODE_B9EFC5,
  CODE_B9EFCA,
  CODE_B9EFCF,
  CODE_B9EFD4,
  CODE_B9EFD9,
  CODE_B9EFDE,
  CODE_B9EFE3,
  CODE_B9EFE8,
  CODE_B9EFED,
  CODE_B9EFF2,
  CODE_B9EFF7,
  CODE_B9EFFC,
  CODE_B9F001,
  CODE_B9F006,
  CODE_B9F00B,
  CODE_B9F010,
  CODE_B9F015,
  CODE_B9F01A,
  CODE_B9F01F,
  CODE_B9F024,
  CODE_B9F029,
  CODE_B9F02E,
  CODE_B9F033,
  CODE_B9F038,
  CODE_B9F03D,
  CODE_B9F042,
  CODE_B9F047,
  CODE_B9F04C,
  CODE_B9F051,
  CODE_B9F056,
  CODE_B9F05B,
  CODE_B9F060,
  CODE_B9F065,
  CODE_B9F06A,
  set_celebrate_interaction_and_clear_level,
  CODE_B9F07B,
  CODE_B9F080,
});
