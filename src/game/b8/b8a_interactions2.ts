/**
 * Bank $B8 — player interactions (part 2): getting hurt, animal buddies (mounting, dismounting,
 * transforming), swapping Kongs, held sprites, and the barrel/entrance hand-off.
 */
import { r16, w16, rom16, bus16 } from "../../core/mem";
import { reg, register, callPtr } from "../../core/cpu";
import { RET_RTS } from "../../core/hybrid";
import { L, R, C, sprite, sprite_table, kong_control, level } from "../../core/sym";
import { spriteConst, kongStateFlags, cmpMinus, sound, queue_sound_effect, setReturnMode, transition_song, get_sprite_terrain_info_define_y, jslLabel } from "./b8a_common";
import {
  set_kongs_visible_if_not_in_barrel,
  work_on_active_kong,
  work_on_inactive_kong,
  set_death_bounce_gravity_and_speed,
  get_kong_state_flag_0020,
} from "./b8a_interactions";
import {
  set_anim_handle_dixie,
  set_anim_handle_animal_and_dixie,
  set_anim_handle_animal,
  set_riding_kong_anim_handle_dixie,
  set_player_normal_gravity,
  set_player_terminal_velocity,
  set_player_terminal_velocity_global,
  set_swimming_state,
  set_sprite_palette_global,
  CODE_B8A98A,
  enable_bullet_time,
  CODE_B5E43E,
  CODE_B39DB0,
  spawn_special_sprite_address,
  spawn_special_sprite_index,
  delete_sprite_handle_deallocation,
  set_level_end_fade,
  CODE_B8A186,
  CODE_BB8C19,
  CODE_BB8C2C,
  start_damaged_invincibility,
  CODE_B8D4AE,
  CODE_B8D8D5,
  swap_active_kong_global,
  CODE_B8CD97,
  CODE_B3F1EF,
} from "../../gen/routines";

const DATA_FF18CE = L("DATA_FF18CE");
const ANIMAL_HURT_SOUNDS = L("animal_hurt_sounds");
const ANIMAL_HURT_SOUNDS_2 = L("animal_hurt_sounds_2");
const ANIMAL_RELEASE_SPEEDS = L("DATA_B8914E");
const MOUNT_HANDLERS = L("DATA_B89462");
const DIXIE_ANIMAL_X = L("dixie_animal_x_pos_offsets");
const DIXIE_ANIMAL_Y = L("dixie_animal_y_pos_offsets");
const DIDDY_ANIMAL_X = L("diddy_animal_x_pos_offsets");
const DIDDY_ANIMAL_Y = L("diddy_animal_y_pos_offsets");
const SPRITE_SIZE = 0x5e;

/** Index of the current animal buddy: (animal_type - $190) >> 1 (SEC/SBC/LSR). */
const animalIndex = () => ((r16(R.animal_type) - C.animal_sprite_type_range_start) & 0xffff) >> 1;

/** `LDA animal_type / PHA / STZ animal_type / gravity+terminal velocity / PLA / STA animal_type` */
function kongGravityIgnoringAnimal() {
  const animal = r16(R.animal_type);
  w16(R.animal_type, 0);
  set_player_normal_gravity();
  set_player_terminal_velocity();
  w16(R.animal_type, animal);
  reg.a = animal;
}

/** Face away from the hit: bit 14 = NOT(bit 14 of A>>1), the classic EOR/AND/EOR merge. */
function faceAwayFrom(x: number, a: number) {
  const p = r16(x + sprite.oam_property);
  w16(x + sprite.oam_property, (((((a & 0xffff) >> 1) ^ p) ^ 0xffff) & 0x4000) ^ p);
}

/** Puts the following Kong in X back into the follow state ($22). */
function setFollowState(renderOrder: number | null, a: number, x: number) {
  const k = reg.x;
  w16(k + sprite.state, C.kong_state_22);
  if (renderOrder !== null) w16(k + sprite.render_order, renderOrder);
  reg.a = a;
  reg.x = x;
  reg.y = 0;
  CODE_B8D8D5();
}

// ---------------------------------------------------------------------------------------------
// Animal buddy transformation (No-Animal sign)
// ---------------------------------------------------------------------------------------------

/** $B88B15 — interaction $19: crossing a No-Animal sign: the buddy turns into an item. Carry set. */
export function player_interaction_19() {
  if (r16(R.current_player_mount)) {
    CODE_B88B80(); // CODE_B88B80
    return;
  }
  reg.a = r16(R.animal_type);
  if (!reg.a) return;
  // CODE_B88B1E: the Kong *is* the animal (Squitter/Rattly transformation)
  play_morph_from_animal_sound();
  work_on_active_kong();
  if (r16(R.animal_type) === C.sprite_enguarde) {
    // CODE_B88B74
    w16(reg.x + sprite.render_order, 0x00e4);
    w16(R.animal_type, 0);
    set_swimming_state();
  } else {
    find_and_delete_animal_icon();
    const x = r16(R.current_sprite);
    reg.x = x;
    w16(x + sprite.render_order, 0x00e4);
    w16(x + sprite.state, C.kong_state_06);
    reg.a = 0x0006;
    set_anim_handle_dixie();
    w16(R.animal_type, 0);
    w16(R.current_player_mount, 0);
    set_player_normal_gravity();
    set_player_terminal_velocity();
  }
  // CODE_B88B4B: back to the Kong's own palette
  reg.y = r16(R.active_kong_number);
  reg.a = reg.y ? C.dixie_active_sprite_palette : C.diddy_active_sprite_palette;
  reg.x = r16(R.active_kong_sprite);
  set_sprite_palette_global();
  work_on_active_kong();
  reg.a = r16(R.game_state_flags) & 0x4000;
  if (reg.a) {
    reg.a ^= r16(R.game_state_flags);
    w16(R.game_state_flags, reg.a);
    CODE_B8A98A();
  }
  CODE_B88BD9(); // CODE_B88B72 -> CODE_B88BD9
}

/** CODE_B88B80 — riding a buddy: dismount and delete it. */
function CODE_B88B80() {
  play_morph_from_animal_sound();
  work_on_active_kong();
  if (r16(R.animal_type) === C.sprite_enguarde) {
    // CODE_B88BCA
    w16(reg.x + sprite.render_order, 0x00e4);
    w16(R.animal_type, 0);
    set_swimming_state();
    work_on_active_kong();
  } else {
    const x = r16(R.current_sprite);
    reg.x = x;
    w16(x + sprite.render_order, 0x00e4);
    w16(x + sprite.state, C.kong_state_06);
    reg.a = 0x0006;
    set_anim_handle_dixie();
    kongGravityIgnoringAnimal();
  }
  // CODE_B88BAE
  CODE_B895E5();
  const mount = r16(R.current_player_mount);
  reg.x = mount;
  w16(R.current_sprite, mount);
  CODE_B8957C();
  CODE_B8958F();
  if (!reg.c) CODE_B89609();
  // CODE_B88BC0
  delete_sprite_handle_deallocation();
  w16(R.animal_type, 0);
  w16(R.current_player_mount, 0);
  CODE_B88BD9();
}

/** CODE_B88BD9 — spawn the item the buddy turned into (unless $0A86 is negative) and the smoke. */
function CODE_B88BD9() {
  reg.a = 0x001c;
  reg.y = 0x0014;
  enable_bullet_time();
  CODE_B5E43E();
  work_on_active_kong();
  if (!(r16(R.interaction_RAM_0A86) & 0x8000)) {
    CODE_B39DB0();
    const item = reg.a & 0xffff;
    w16(R.interaction_RAM_0A86, item);
    reg.x = (item << 1) & 0xffff;
    reg.y = rom16((DATA_FF18CE + reg.x) & 0xffffff);
    spawn_special_sprite_address();
    const x = r16(R.alternate_sprite);
    reg.x = x;
    w16(x + sprite.general_purpose_42, r16(R.interaction_RAM_0A86));
    reg.y = r16(R.active_kong_sprite);
    const dir = r16(R.interaction_RAM_0A88);
    w16(x + sprite.general_purpose_4E, dir & 0x7fff);
    // CODE_B88C1C / CODE_B88C1F: thrown left or right
    const xs = dir & 0x8000 ? 0xfc80 : 0x0380;
    w16(x + sprite.x_speed, xs);
    w16(x + sprite.max_x_speed, xs);
  }
  // CODE_B88C23
  reg.y = C.special_sprite_spawn_id_0124;
  spawn_special_sprite_index();
  reg.y = C.special_sprite_spawn_id_0126;
  spawn_special_sprite_index();
  reg.c = true;
}

/** $B88C33 */
export function play_morph_from_animal_sound() {
  reg.a = sound(4, "morph_from_animal_a");
  queue_sound_effect();
  reg.a = sound(5, "morph_from_animal_b");
  queue_sound_effect();
  reg.a = sound(6, "morph_from_animal_c");
  queue_sound_effect();
  reg.a = sound(7, "morph_from_animal_d");
  queue_sound_effect();
}

/** $B88C50 — carry = flag $0100 of the active Kong's state (can't be hurt now). */
export function get_kong_state_flag_0100() {
  const state = r16(r16(R.active_kong_sprite) + sprite.state);
  reg.x = (state << 2) & 0xffff;
  reg.a = kongStateFlags(state) & 0x0100;
  reg.c = reg.a !== 0;
}

/** $B88C65 — delete the HUD icon of the animal buddy (if any). */
export function find_and_delete_animal_icon() {
  for (let x: number = sprite_table.slot_1; x !== sprite_table.end; x += SPRITE_SIZE) {
    reg.x = x;
    if (r16(x + sprite.type) !== C.sprite_animal_icon) continue;
    const saved = r16(R.current_sprite);
    w16(R.current_sprite, x);
    delete_sprite_handle_deallocation();
    w16(R.current_sprite, saved);
    reg.a = saved;
    return;
  }
  reg.a = sprite_table.end;
}

/** $B88C89 — hurt in a bonus level: the bonus is lost. */
export function CODE_B88C89() {
  reg.a = 0x0080;
  reg.y = 0x0100;
  enable_bullet_time();
  reg.a = 0x0002;
  transition_song();
  set_level_end_fade();
}

// ---------------------------------------------------------------------------------------------
// Getting hurt
// ---------------------------------------------------------------------------------------------

/** $B88C9D — interaction $22: hurt, and the extra Kong is lost too. */
export function player_interaction_22() {
  w16(R.game_state_flags, r16(R.game_state_flags) & ~0x4000);
  player_interaction_23();
}

/**
 * $B88CA3 — interaction $23: hurt by an enemy or obstacle. With an animal the animal is lost;
 * with two Kongs the active one is knocked out and the partner takes over; otherwise death.
 */
export function player_interaction_23() {
  set_kongs_visible_if_not_in_barrel();
  get_kong_state_flag_0100();
  if (reg.c) return; // CODE_B88C9C
  work_on_active_kong();
  const floorY = r16(0x0d54);
  if (!(floorY & 0x8000)) CODE_B8A186();
  // CODE_B88CB6
  let x = r16(R.active_kong_sprite);
  reg.x = x;
  // in a level with a rising floor ($0D54), put the Kong back on top of it
  if (r16(x + sprite.terrain_attributes) & 0x0100 && !(r16(0x0d54) & 0x8000)) {
    w16(x + sprite.y_position, (r16(0x0d54) + 0x00c0) & 0xffff);
  }
  // CODE_B88CCB
  if (r16(level.type) === C.bonus_level_type) {
    CODE_B88C89();
    return;
  }
  w16(0x0aee, 0);
  w16(0x0af2, 0);
  w16(0x0919, r16(0x0919) & ~0x0003);
  if ((r16(0x091b) & 0x0300) === 0x0100) {
    w16(0x091b, r16(0x091b) ^ 0x0100);
    CODE_BB8C19();
  }
  // CODE_B88CF4 (X may have been changed by CODE_BB8C19)
  x = reg.x;
  w16(x + sprite.display_mode, 0);
  w16(x + sprite.general_purpose_50, 0);
  CODE_B5E43E();
  CODE_B88F39();
  if (reg.c) return;
  // CODE_B88D02
  if (r16(R.animal_type)) {
    damage_animal_player();
    return;
  }
  // CODE_B88D09
  if (r16(R.current_held_sprite) === r16(R.inactive_kong_sprite)) {
    work_on_inactive_kong();
    reg.a = 0x0029;
    set_anim_handle_dixie();
    work_on_active_kong();
  }
  // CODE_B88D1E
  w16(0x0d82, 0);
  drop_sprite_if_holding();
  x = r16(R.current_sprite);
  reg.x = x;
  const p = r16(x + sprite.oam_property);
  w16(x + sprite.oam_property, (((r16(x + sprite.unknown_34) ^ 0xffff) ^ p) & 0x4000) ^ p);
  reg.a = r16(R.game_state_flags) & 0x4000;
  if (!reg.a) {
    CODE_B88DCA();
    return;
  }
  // CODE_B88D45: remember the hurt Kong's motion for the swap animation
  if (r16(x + sprite.terrain_attributes) & 0x0100) w16(0x0d56, r16(0x0d56) | 0x0001);
  // CODE_B88D52
  w16(0x0d60, r16(x + sprite.x_speed));
  w16(0x0d62, r16(x + sprite.y_speed));
  w16(0x0d64, r16(x + sprite.state));
  w16(0x0d66, r16(x + sprite.x_sub_position));
  w16(0x0d68, r16(x + sprite.x_position));
  w16(0x0d6a, r16(x + sprite.y_sub_position));
  w16(0x0d6c, r16(x + sprite.y_position));
  w16(x + sprite.state, C.kong_state_24);
  w16(x + sprite.x_speed, 0);
  w16(x + sprite.max_x_speed, 0);
  w16(x + sprite.interaction_flags, 0);
  w16(x + sprite.general_purpose_42, 0);
  set_player_normal_gravity();
  set_player_terminal_velocity();
  x = r16(R.current_sprite);
  reg.x = x;
  reg.y = 0x002a;
  w16(x + sprite.y_speed, spriteConst(0x002a));
  w16(x + sprite.oam_property, r16(x + sprite.oam_property) & 0xbfff);
  reg.a = 0x0007;
  reg.y = 0x0100;
  enable_bullet_time();
  reg.a = 0x0029;
  set_anim_handle_dixie();
  work_on_inactive_kong();
  w16(reg.x + sprite.state, C.kong_state_26);
  w16(reg.x + sprite.general_purpose_42, 0x0024);
  w16(reg.x + sprite.interaction_flags, 0x0080);
  work_on_active_kong();
  w16(0x0d66, r16(reg.x + sprite.x_position));
  reg.a = r16(reg.x + sprite.y_position);
  w16(0x0d6a, reg.a);
}

/** $B88DCA — last Kong hurt: death bounce (state $05). */
export function CODE_B88DCA() {
  work_on_active_kong();
  set_death_bounce_gravity_and_speed();
  const x = r16(R.current_sprite);
  reg.x = x;
  const xs = r16(x + sprite.oam_property) & 0x4000 ? 0x0100 : 0xff00;
  w16(x + sprite.x_speed, xs);
  w16(x + sprite.max_x_speed, xs);
  w16(x + sprite.interaction_flags, 0x0080);
  w16(x + sprite.state, C.kong_state_05);
  set_player_terminal_velocity_global();
  reg.a = 0x000a;
  set_anim_handle_dixie();
}

/** $B88E15 — the Kong transformed into an animal (Squitter/Rattly...) is hurt: back to a Kong. */
export function damage_animal_player() {
  const idx = animalIndex();
  reg.x = idx;
  reg.a = rom16((ANIMAL_HURT_SOUNDS + idx) & 0xffffff);
  queue_sound_effect();
  const flags = r16(R.game_state_flags);
  w16(R.game_state_flags, flags & ~0x4000);
  if (flags & 0x4000) {
    // the extra Kong absorbs the hit
    work_on_active_kong();
    CODE_B890BC();
    reg.a = 0x0095;
    set_anim_handle_animal_and_dixie();
    reg.a = 0x001f;
    reg.y = 0x0014;
    enable_bullet_time();
    start_damaged_invincibility();
    return;
  }
  // .no_extra_kong: death bounce of the animal
  work_on_active_kong();
  let x = r16(R.current_sprite);
  reg.x = x;
  w16(x + sprite.terrain_interaction, 0);
  reg.a = 0x0095;
  set_anim_handle_animal_and_dixie();
  x = r16(R.current_sprite);
  reg.x = x;
  w16(x + sprite.animation_speed, 0);
  reg.a = 0x0006;
  reg.y = 0x0100;
  enable_bullet_time();
  const kc = r16(R.current_kong_control_variables);
  w16(kc + kong_control.gravity_force, spriteConst(0x0024));
  x = r16(R.current_sprite);
  reg.x = x;
  w16(x + sprite.y_speed, spriteConst(0x0026));
  w16(kc + kong_control.max_fall_speed, spriteConst(0x0002));
  reg.y = kc;
  const xs = r16(x + sprite.oam_property) & 0x4000 ? 0x0100 : 0xff00;
  w16(x + sprite.x_speed, xs);
  w16(x + sprite.max_x_speed, xs);
  w16(x + sprite.interaction_flags, 0);
  w16(x + sprite.state, C.kong_state_3A);
  reg.a = r16(x + sprite.oam_property) | 0x3000;
  w16(x + sprite.oam_property, reg.a);
}

/** $B88EB8 */
export function drop_sprite_if_holding_global() {
  drop_sprite_if_holding();
}

/** $B88EBC — drop whatever the Kong carries (a barrel is tossed gently, the partner follows). Carry clear. */
export function drop_sprite_if_holding() {
  const held = r16(R.current_held_sprite);
  reg.a = held;
  if (held === 0) {
    reg.c = false;
    return;
  }
  if (held === r16(R.inactive_kong_sprite)) {
    // .holding_kong
    w16(R.current_held_sprite, 0);
    reg.x = r16(R.inactive_kong_sprite);
    setFollowState(0x00d8, 0x001f, 0x001c);
    const x = r16(R.active_kong_sprite);
    reg.x = x;
    reg.a = 0x00e4;
    w16(x + sprite.render_order, 0x00e4);
    reg.c = false;
    return;
  }
  const x = held;
  reg.x = x;
  w16(x + sprite.carry_or_defeat_flags, 0x0005);
  const xs = r16(x + sprite.oam_property) & 0x4000 ? 0xff00 : 0x0100;
  w16(x + sprite.x_speed, xs);
  w16(x + sprite.max_x_speed, xs);
  w16(x + sprite.y_speed, 0x0400);
  reg.x = r16(R.current_held_sprite);
  CODE_B8D4AE();
  w16(R.current_held_sprite, 0);
  reg.c = false;
}

/** $B88F14 — play the hurt sound of the current animal buddy. */
export function CODE_B88F14() {
  const table = ANIMAL_HURT_SOUNDS_2 & 0xffff;
  w16(R.temp_32, table);
  const y = ((animalIndex() & 0x00fe) + table) & 0xffff;
  reg.y = y;
  // LDA $0000,y in the current data bank (bank $B8 here)
  reg.a = bus16((reg.db << 16) | y);
  queue_sound_effect();
}

/** $B88F39 — riding an animal buddy when hurt: lose the buddy instead. Carry = handled. */
export function CODE_B88F39() {
  if (!r16(R.current_player_mount)) {
    reg.c = false;
    return;
  }
  // CODE_B88F3F
  CODE_B88F14();
  const animal = r16(R.animal_type);
  if (animal === C.sprite_enguarde) return CODE_B88F82();
  if (animal === C.sprite_squawks) return CODE_B88FC3();
  // CODE_B88F51
  work_on_active_kong();
  start_damaged_invincibility();
  const x = r16(R.current_sprite);
  reg.x = x;
  w16(x + sprite.render_order, 0x00e4);
  w16(x + sprite.y_speed, 0xf800);
  w16(x + sprite.state, C.kong_state_06);
  reg.a = 0x0006;
  set_anim_handle_dixie();
  kongGravityIgnoringAnimal();
  CODE_B890E1();
  reg.c = true;
}

/** CODE_B88F82 — Enguarde runs away when the Kong is hit. */
function CODE_B88F82() {
  work_on_active_kong();
  start_damaged_invincibility();
  let x = r16(R.current_sprite);
  reg.x = x;
  w16(x + sprite.render_order, 0x00e4);
  w16(x + sprite.y_speed, 0xfe00);
  w16(R.animal_type, 0);
  set_swimming_state();
  x = r16(R.current_player_mount);
  reg.x = x;
  w16(R.current_sprite, x);
  w16(x + sprite.render_order, 0x00d0);
  w16(x + sprite.state, C.kong_state_06);
  w16(x + sprite.general_purpose_42, 0x003c);
  w16(x + sprite.x_speed, 0x0400);
  w16(x + sprite.max_x_speed, 0x0400);
  w16(x + sprite.oam_property, r16(x + sprite.oam_property) & 0xbfff);
  w16(x + sprite.y_speed, 0);
  w16(x + sprite.max_y_speed, 0);
  CODE_B89126();
}

/** CODE_B88FC3 — hit while carried by Squawks: fall. */
function CODE_B88FC3() {
  CODE_B890BC();
  const flags = r16(R.game_state_flags);
  w16(R.game_state_flags, flags & ~0x4000);
  if (flags & 0x4000) return CODE_B89035();
  work_on_active_kong();
  kongGravityIgnoringAnimal();
  squawksHitFall();
  set_death_bounce_gravity_and_speed();
  const mount = r16(R.current_player_mount);
  reg.x = mount;
  w16(R.current_sprite, mount);
  w16(mount + sprite.render_order, 0x00d0);
  w16(mount + sprite.state, 0);
  reg.a = 0x0147;
  set_anim_handle_animal();
  CODE_B895E5();
  CODE_B89609();
  w16(R.current_player_mount, 0);
  w16(R.animal_type, 0);
  reg.a = 0x0003;
  reg.y = 0x0100;
  enable_bullet_time();
  reg.c = true;
}

/** Shared part of CODE_B88FC3/CODE_B89035: the Kong tumbles down (state $59, facing kept by the A=0 merge). */
function squawksHitFall() {
  let x = reg.x;
  w16(x + sprite.interaction_flags, 0x0080);
  w16(x + sprite.state, C.kong_state_59);
  w16(x + sprite.terrain_interaction, 0);
  reg.a = 0x00a0;
  set_anim_handle_dixie();
  x = reg.x;
  w16(x + sprite.x_speed, 0);
  w16(x + sprite.max_x_speed, 0);
  faceAwayFrom(x, 0);
  w16(x + sprite.y_speed, 0xfb00);
}

/** CODE_B89035 — hit while carried by Squawks with two Kongs: the partner takes over. */
function CODE_B89035() {
  work_on_active_kong();
  kongGravityIgnoringAnimal();
  squawksHitFall();
  set_death_bounce_gravity_and_speed();
  CODE_B895E5();
  CODE_B89609();
  swap_active_kong_global();
  CODE_BB8C19();
  const x = r16(R.active_kong_sprite);
  reg.x = x;
  w16(x + sprite.x_speed, 0);
  w16(x + sprite.max_x_speed, 0);
  CODE_B893DF();
  work_on_active_kong();
  reg.a = 0x004f;
  set_riding_kong_anim_handle_dixie();
  start_damaged_invincibility();
  if (r16(R.current_game_mode) === C.gamemode_2_player_team) {
    // .2p_team
    const k = r16(R.active_kong_sprite);
    reg.x = k;
    w16(k + sprite.state, C.kong_state_6F);
    w16(k + sprite.general_purpose_4A, 0);
    reg.a = 0x0007;
    reg.y = 0x0000;
    enable_bullet_time();
  }
  reg.c = true;
}

/** $B890BC — rising-floor levels: lift the floor and the active Kong by 8px. */
export function CODE_B890BC() {
  const x = r16(R.active_kong_sprite);
  reg.x = x;
  reg.a = r16(x + sprite.terrain_attributes) & 0x0100;
  if (!reg.a) return;
  w16(0x0d56, r16(0x0d56) | 0x0001);
  w16(0x0d54, (r16(0x0d54) + 0x0008) & 0xffff);
  reg.a = (r16(x + sprite.y_position) + 0x0008) & 0xffff;
  w16(x + sprite.y_position, reg.a);
  w16(x + sprite.y_speed, 0);
}

/** $B890E1 — the buddy runs away after the Kong was knocked off. */
export function CODE_B890E1() {
  reg.db = 0xb8;
  const x = r16(R.current_player_mount);
  reg.x = x;
  w16(R.current_sprite, x);
  w16(x + sprite.oam_property, (r16(x + sprite.oam_property) & 0xcfff) | 0x2000);
  const k = r16(R.active_kong_sprite);
  reg.y = k;
  let state: number;
  if (r16(k + sprite.terrain_attributes) & 0x0100) {
    w16(0x0d56, r16(0x0d56) | 0x0001);
    state = 0x0009;
  } else {
    state = C.kong_state_02; // CODE_B89107
  }
  // CODE_B8910A
  w16(x + sprite.state, state);
  w16(x + sprite.render_order, 0x00d0);
  w16(x + sprite.general_purpose_42, 0x003c);
  const y = animalIndex() & 0x00fe;
  reg.y = y;
  w16(x + sprite.general_purpose_44, bus16((reg.db << 16) | ((ANIMAL_RELEASE_SPEEDS + y) & 0xffff)));
  CODE_B89126();
}

/** CODE_B89126 — released buddy: animation, swap back the positions, clear the mount. Carry set. */
export function CODE_B89126() {
  reg.a = 0x014c;
  set_anim_handle_animal();
  CODE_B895E5();
  CODE_B8957C();
  CODE_B8958F();
  if (!reg.c) CODE_B89609();
  // CODE_B8913B
  w16(R.animal_type, 0);
  w16(R.current_player_mount, 0);
  reg.a = 0x0080;
  reg.y = 0x000e;
  enable_bullet_time();
  CODE_B5E43E();
  reg.c = true;
}

/** $B89171 — song X for Diddy, song Y for Dixie. */
export function transition_kong_dependant_song() {
  reg.a = r16(R.active_kong_number) ? reg.y : reg.x;
  transition_song();
}

/** $B89182 */
export function play_kong_dependant_sound_global() {
  play_kong_dependant_sound();
}

/** $B89186 — sound X for Diddy, sound Y for Dixie. */
export function play_kong_dependant_sound() {
  reg.a = r16(R.active_kong_number) ? reg.y : reg.x;
  queue_sound_effect();
}

// ---------------------------------------------------------------------------------------------
// Swapping Kongs
// ---------------------------------------------------------------------------------------------

/** $B89197 — interaction $01: swapping Kongs under water (they swim past each other). */
export function player_interaction_01() {
  reg.a = 0x0002;
  if (r16(R.game_state_flags_2) & 0x0002) return;
  // CODE_B891A0
  w16(0x0d64, 0x0020);
  CODE_B89201();
  work_on_active_kong();
  let x = reg.x;
  w16(0x0d66, r16(x + sprite.x_sub_position));
  w16(0x0d68, r16(x + sprite.x_position));
  w16(0x0d6a, r16(x + sprite.y_sub_position));
  w16(0x0d6c, r16(x + sprite.y_position));
  w16(x + sprite.x_speed, -r16(0x0d60) & 0xffff);
  w16(x + sprite.y_speed, -r16(0x0d62) & 0xffff);
  w16(x + sprite.state, C.kong_state_77);
  reg.a = 0x0043;
  set_anim_handle_dixie();
  work_on_inactive_kong();
  x = reg.x;
  w16(x + sprite.x_speed, r16(0x0d60));
  w16(x + sprite.y_speed, r16(0x0d62));
  w16(x + sprite.state, C.kong_state_78);
  reg.a = 0x0043;
  set_anim_handle_dixie();
  reg.x = 0x0505;
  reg.y = 0x0505;
  play_kong_dependant_sound();
}

/** $B89201 — $0D60/$0D62 = 8 × (active - inactive) position: speeds for the water swap. */
export function CODE_B89201() {
  const x = r16(R.active_kong_sprite);
  const y = r16(R.inactive_kong_sprite);
  reg.x = x;
  reg.y = y;
  w16(0x0d60, ((r16(x + sprite.x_position) - r16(y + sprite.x_position)) << 3) & 0xffff);
  reg.a = ((r16(x + sprite.y_position) - r16(y + sprite.y_position)) << 3) & 0xffff;
  w16(0x0d62, reg.a);
}

/** $B89220 — interaction $02: swapping Kongs on land (the partner jumps onto the active Kong's spot). */
export function player_interaction_02() {
  reg.a = 0x0002;
  if (r16(R.game_state_flags_2) & 0x0002) return;
  // CODE_B89229
  let x = r16(R.active_kong_sprite);
  reg.x = x;
  w16(0x0072, r16(x + sprite.x_position));
  w16(0x0074, r16(x + sprite.y_position));
  let y = r16(R.inactive_kong_sprite);
  reg.y = y;
  const side = cmpMinus(r16(y + sprite.x_position), r16(x + sprite.x_position)) ? 0xffe4 : 0x001c;
  // CODE_B89246
  w16(0x007c, side);
  reg.a = side;
  CODE_B8CD97();
  if (reg.c) return; // CODE_B8924D
  // CODE_B8924E: only when both are about at the same height
  x = r16(R.active_kong_sprite);
  reg.x = x;
  let dy = (r16(x + sprite.y_position) - r16(0x0074)) & 0xffff;
  if (dy & 0x8000) dy = -dy & 0xffff;
  // CODE_B8925C
  if (!cmpMinus(dy, 0x0010)) return;
  w16(x + sprite.display_mode, 0);
  w16(r16(R.active_kong_control_variables) + kong_control.flash_timer, 0);
  x = r16(R.inactive_kong_sprite);
  reg.x = x;
  w16(x + sprite.display_mode, 0);
  w16(0x0d68, r16(0x0072));
  w16(x + sprite.x_position, r16(0x0072));
  w16(0x0d6c, r16(0x0074));
  w16(x + sprite.y_position, r16(0x0074));
  work_on_active_kong();
  w16(0x0d66, r16(reg.x + sprite.x_position));
  w16(0x0d6a, r16(reg.x + sprite.y_position));
  const invincible = r16(reg.y + kong_control.invincible_timer);
  swap_active_kong_global();
  reg.y = r16(R.active_kong_control_variables);
  w16(reg.y + kong_control.invincible_timer, invincible);
  x = r16(R.active_kong_sprite);
  y = r16(R.inactive_kong_sprite);
  reg.x = x;
  reg.y = y;
  // the new active Kong faces its partner
  const d = ((r16(y + sprite.x_position) - r16(x + sprite.x_position)) & 0xffff) >> 1;
  const p = r16(x + sprite.oam_property);
  w16(x + sprite.oam_property, ((d ^ p) & 0x4000) ^ p);
  let off = (r16(0x0d66) - r16(0x0d68)) & 0xffff;
  if (r16(x + sprite.oam_property) & 0x4000) off = -off & 0xffff;
  // CODE_B892BF
  w16(R.held_sprite_x_offset, off);
  w16(R.held_sprite_y_offset, (r16(0x0d6a) - r16(0x0d6c)) & 0xffff);
  w16(0x0d80, 0xffff);
  w16(R.current_held_sprite, r16(R.inactive_kong_sprite));
  work_on_inactive_kong();
  x = reg.x;
  w16(x + sprite.state, C.kong_state_4A);
  w16(x + sprite.x_speed, 0);
  w16(x + sprite.max_x_speed, 0);
  w16(x + sprite.y_speed, 0);
  reg.a = 0x0001;
  set_anim_handle_dixie();
  work_on_active_kong();
  x = reg.x;
  w16(x + sprite.state, C.kong_state_49);
  w16(x + sprite.x_speed, 0);
  w16(x + sprite.max_x_speed, 0);
  w16(x + sprite.y_speed, 0);
  reg.a = 0x0049;
  set_anim_handle_dixie();
  reg.a = 0x0007;
  reg.y = 0x0100;
  enable_bullet_time();
  CODE_BB8C19();
  reg.x = 0x0505;
  reg.y = 0x0505;
  play_kong_dependant_sound();
}

// ---------------------------------------------------------------------------------------------
// Cat-o-9-tails, barrels/entrances, animal buddies
// ---------------------------------------------------------------------------------------------

/** $B89319 — interaction $13: grabbed by a Cat-O-9-Tails. */
export function player_interaction_13() {
  set_kongs_visible_if_not_in_barrel();
  work_on_active_kong();
  w16(reg.x + sprite.state, C.kong_state_48);
  w16(reg.x + sprite.interaction_flags, r16(reg.x + sprite.interaction_flags) | 0x0080);
  reg.a = r16(R.game_state_flags) & 0x4000;
  if (reg.a) {
    work_on_inactive_kong();
    w16(reg.x + sprite.state, C.kong_state_2F);
    w16(reg.x + sprite.interaction_flags, r16(reg.x + sprite.interaction_flags) | 0x0080);
  }
  // .single_kong
  reg.a = 0x0047;
  set_anim_handle_dixie();
}

/** $B8934A — interaction $14: thrown by a Cat-O-9-Tails ($0A86..$0A8C = target and speeds). */
export function player_interaction_14() {
  work_on_active_kong();
  const x = reg.x;
  w16(x + sprite.general_purpose_42, r16(R.interaction_RAM_0A86));
  w16(x + sprite.general_purpose_44, r16(R.interaction_RAM_0A88));
  w16(x + sprite.x_speed, r16(R.interaction_RAM_0A8A));
  w16(x + sprite.y_speed, r16(R.interaction_RAM_0A8C));
  w16(x + sprite.terrain_interaction, 0);
  w16(x + sprite.general_purpose_48, 0);
  w16(x + sprite.general_purpose_4E, 0);
  w16(x + sprite.interaction_flags, r16(x + sprite.interaction_flags) & 0xff7f);
  reg.a = r16(R.game_state_flags) & 0x4000;
  if (reg.a) {
    const k = r16(R.inactive_kong_sprite);
    reg.x = k;
    w16(k + sprite.interaction_flags, r16(k + sprite.interaction_flags) & 0xff7f);
  }
  // .single_kong
  CODE_B3F1EF();
}

/** $B89385 — interactions $0D/$0F/$10/$2B: entering a barrel or an entrance. */
export function player_interaction_0D_0F_10_2B() {
  CODE_B8938A();
}

/** $B8938A — call the routine the interacting sprite left in $0A8A/$0A8C (`JML [$0032]`). */
export function CODE_B8938A() {
  const s = r16(R.current_interacting_sprite);
  reg.x = s;
  w16(R.current_sprite, s);
  w16(0x0032, r16(R.interaction_RAM_0A8A));
  reg.a = r16(R.interaction_RAM_0A8C);
  w16(0x0034, reg.a);
  const target = r16(0x0032) | ((r16(0x0034) & 0xff) << 16);
  jslLabel(target);
}

/** $B8939C */
export function CODE_B8939C() {
  w16(0x091b, r16(0x091b) & 0xff7f);
  CODE_BB8C2C();
}

/** $B893AA — interaction $17: mounting an animal buddy (sprite in current_interacting_sprite). */
export function player_interaction_17() {
  get_kong_state_flag_0020();
  if (reg.a) return;
  // CODE_B893B0
  CODE_B8939C();
  reg.x = 0x0540;
  reg.y = 0x0540;
  play_kong_dependant_sound();
  w16(0x0aee, 0);
  w16(0x0af2, 0);
  const x = r16(R.current_interacting_sprite);
  reg.x = x;
  w16(R.current_player_mount, x);
  w16(R.current_sprite, x);
  w16(R.animal_type, r16(x + sprite.type));
  w16(x + sprite.state, C.kong_state_01);
  reg.a = 0x004f;
  set_riding_kong_anim_handle_dixie();
  CODE_B893DF();
}

/** $B893DB */
export function CODE_B893DB() {
  CODE_B893DF();
}

/** $B893DF — sit the Kong on its buddy (per-Kong offsets) and enter the buddy's state. */
export function CODE_B893DF() {
  const mount = r16(R.current_player_mount);
  reg.x = mount;
  w16(mount + sprite.render_order, 0x00e6);
  work_on_active_kong();
  const off = (r16(R.animal_type) - C.animal_sprite_type_range_start) & 0x001c;
  reg.y = off;
  reg.x = off;
  if (r16(R.active_kong_number)) {
    w16(0x0d72, rom16(DIXIE_ANIMAL_X + off));
    w16(0x0d74, rom16(DIXIE_ANIMAL_Y + off));
  } else {
    // CODE_B89409
    w16(0x0d72, rom16(DIDDY_ANIMAL_X + off));
    w16(0x0d74, rom16(DIDDY_ANIMAL_Y + off));
  }
  // CODE_B89417
  const idx = off >> 1;
  reg.a = idx;
  reg.x = idx;
  callPtr(0xb8, rom16(MOUNT_HANDLERS + idx));
}

/** $B8941D — mounted (Squitter, Rattly, Rambi): state $09. */
export function CODE_B8941D() {
  const x = r16(R.current_sprite);
  reg.x = x;
  w16(x + sprite.state, C.kong_state_09);
  CODE_B89424();
}

/** CODE_B89424 */
function CODE_B89424() {
  reg.a = 0x0081;
  set_anim_handle_animal_and_dixie();
  CODE_B895E5();
  CODE_B89609();
  CODE_B5E43E();
}

/** $B89436 — mounted Enguarde: state $50. */
export function CODE_B89436() {
  const x = r16(R.current_sprite);
  reg.x = x;
  w16(x + sprite.y_speed, 0);
  w16(x + sprite.state, C.kong_state_50);
  CODE_B89424();
}

/** $B89441 — carried by Squawks. */
export function CODE_B89441() {
  set_squawks_idle_state();
  reg.a = 0x0081;
  set_anim_handle_animal_and_dixie();
  CODE_B895E5();
  CODE_B89609();
  reg.a = 0x0004;
  reg.x = 0x0060;
  reg.y = 0x0000;
  CODE_B8D8D5();
  CODE_B5E43E();
}

/** $B8949A — Squawks hovering (state $10); a "carrying" Squawks ($4A bit 0) falls slowly. */
export function set_squawks_idle_state() {
  let x = r16(R.current_sprite);
  w16(x + sprite.state, C.kong_state_10);
  w16(x + sprite.y_speed, 0x0100);
  x = r16(R.current_player_mount);
  reg.x = x;
  reg.a = r16(x + sprite.general_purpose_4A) & 0x0001;
  if (!reg.a) {
    set_player_normal_gravity();
    set_player_terminal_velocity();
    return;
  }
  // .CODE_B894B6
  set_player_normal_gravity();
  reg.a = 0x0100;
  reg.y = r16(R.current_kong_control_variables);
  w16(reg.y + kong_control.max_fall_speed, 0x0100);
}

/** $B894C2 — interaction $18: dismounting an animal buddy (the Kong jumps off, the buddy stays). */
export function player_interaction_18() {
  reg.y = r16(R.current_player_mount);
  if (!reg.y) return;
  // CODE_B894C7
  reg.x = 0x0502;
  reg.y = 0x0502;
  play_kong_dependant_sound();
  work_on_active_kong();
  let x = reg.x;
  w16(R.last_animal_dismount_state, r16(x + sprite.state));
  w16(x + sprite.render_order, 0x00e4);
  let jump = 0xf800;
  const animal = r16(R.animal_type);
  if (animal === C.sprite_enguarde) jump = 0xfe00;
  else if (animal === C.sprite_squawks) jump = 0xfa00; // CODE_B894F0
  w16(R.temp_32, jump);
  // CODE_B894FA
  w16(x + sprite.y_speed, jump);
  w16(x + sprite.state, C.kong_state_06);
  reg.a = 0x0006;
  set_anim_handle_dixie();
  kongGravityIgnoringAnimal();
  x = r16(R.current_player_mount);
  reg.x = x;
  w16(R.current_sprite, x);
  w16(x + sprite.display_mode, 0);
  w16(x + sprite.render_order, 0x00d0);
  let state: number;
  if (r16(R.last_animal_dismount_state) === C.kong_state_44) state = C.kong_state_0A;
  else if (r16(R.animal_type) === C.sprite_enguarde) state = C.kong_state_04; // CODE_B89532
  else state = 0; // CODE_B89540
  w16(x + sprite.state, state);
  // CODE_B89542
  w16(x + sprite.general_purpose_42, 0x003c);
  w16(x + sprite.x_speed, 0);
  w16(x + sprite.max_x_speed, 0);
  reg.a = 0x0147;
  set_anim_handle_animal();
  CODE_B895E5();
  CODE_B8957C();
  CODE_B8958F();
  if (!reg.c) CODE_B89609();
  // CODE_B89560
  if (r16(R.animal_type) === C.sprite_squawks) {
    reg.a = 0x0004;
    reg.x = 0x0006;
    reg.y = 0x0000;
    CODE_B8D8D5();
  }
  // CODE_B89573
  w16(R.animal_type, 0);
  w16(R.current_player_mount, 0);
  CODE_B5E43E();
}

/** $B8957C — empty (the following dead code would lift a Squitter by 32px). */
export function CODE_B8957C() {}

/**
 * $B8958F — after dismounting: is the buddy clear of the ground? Carry set = the buddy keeps
 * the Kong's position (Squitter/Squawks, or the Kong is well above the ground).
 */
export function CODE_B8958F() {
  const animal = r16(R.animal_type);
  reg.a = animal;
  if (animal === C.sprite_squitter || animal === C.sprite_squawks) return CODE_B895BF();
  const mount = r16(R.current_player_mount);
  reg.x = mount;
  w16(R.current_sprite, mount);
  reg.a = r16(mount + sprite.y_position);
  get_sprite_terrain_info_define_y();
  let a = reg.a & 0xffff;
  if (a & 0x8000) {
    reg.c = false; // CODE_B895BD
    return;
  }
  a = (((a ^ 0xffff) + 0x6301) & 0xffff) - r16(reg.x + sprite.y_position);
  a &= 0xffff;
  reg.a = a;
  if (a & 0x8000) return CODE_B895BF();
  reg.c = !cmpMinus(a, 0x0004);
}

/** CODE_B895BF — the buddy takes the Kong's position. Carry set. */
function CODE_B895BF() {
  const x = r16(R.current_player_mount);
  const y = r16(R.active_kong_sprite);
  reg.x = x;
  reg.y = y;
  w16(x + sprite.y_position, r16(y + sprite.y_position));
  w16(x + sprite.x_position, r16(y + sprite.x_position));
  w16(x + sprite.y_sub_position, r16(y + sprite.y_sub_position));
  w16(x + sprite.x_sub_position, r16(y + sprite.x_sub_position));
  const t = r16(y + sprite.terrain_interaction) & 0xefef;
  w16(y + sprite.terrain_interaction, t);
  w16(x + sprite.terrain_interaction, t);
  reg.a = t;
  reg.c = true;
}

/** $B895E5 — exchange the palette bits (OAM property bits 9-11) of the Kong and its buddy. */
export function CODE_B895E5() {
  const x = r16(R.active_kong_sprite);
  const y = r16(R.current_player_mount);
  reg.x = x;
  reg.y = y;
  const py = r16(y + sprite.oam_property);
  w16(R.temp_32, py);
  const px = r16(x + sprite.oam_property);
  w16(y + sprite.oam_property, ((px ^ py) & 0x0e00) ^ py);
  reg.a = ((py ^ px) & 0x0e00) ^ px;
  w16(x + sprite.oam_property, reg.a);
}

/** $B89609 — exchange position and terrain state between the Kong and its buddy. */
export function CODE_B89609() {
  const x = r16(R.active_kong_sprite);
  const y = r16(R.current_player_mount);
  reg.x = x;
  reg.y = y;
  const swap = (off: number) => {
    const t = r16(y + off);
    w16(R.temp_32, t);
    w16(y + off, r16(x + off));
    w16(x + off, t);
  };
  swap(sprite.x_position);
  const terrain = r16(y + sprite.terrain_interaction);
  w16(R.temp_32, terrain);
  w16(y + sprite.terrain_interaction, r16(x + sprite.terrain_interaction));
  w16(x + sprite.terrain_interaction, terrain & 0xcfcf);
  w16(y + sprite.ground_y_position, r16(x + sprite.ground_y_position));
  w16(y + sprite.ground_distance, r16(x + sprite.ground_distance));
  swap(sprite.x_sub_position);
  swap(sprite.y_position);
  swap(sprite.y_sub_position);
  // CODE_B8966C: a buddy that is on the ground gets a small downward speed
  reg.a = r16(y + sprite.terrain_interaction) & 0x1000 ? 0x0400 : 0;
  w16(y + sprite.y_speed, reg.a);
}

register({
  player_interaction_19,
  play_morph_from_animal_sound,
  get_kong_state_flag_0100,
  find_and_delete_animal_icon,
  CODE_B88C89,
  player_interaction_22,
  player_interaction_23,
  CODE_B88DCA,
  damage_animal_player,
  drop_sprite_if_holding_global,
  drop_sprite_if_holding,
  CODE_B88F14,
  CODE_B88F39,
  CODE_B890BC,
  CODE_B890E1,
  CODE_B89126,
  transition_kong_dependant_song,
  play_kong_dependant_sound_global,
  play_kong_dependant_sound,
  player_interaction_01,
  CODE_B89201,
  player_interaction_02,
  player_interaction_13,
  player_interaction_14,
  player_interaction_0D_0F_10_2B,
  CODE_B8938A,
  CODE_B8939C,
  player_interaction_17,
  CODE_B893DB,
  CODE_B893DF,
  CODE_B8941D,
  CODE_B89436,
  CODE_B89441,
  set_squawks_idle_state,
  player_interaction_18,
  CODE_B8957C,
  CODE_B8958F,
  CODE_B895E5,
  CODE_B89609,
});

// The generated stubs guess some return modes wrong; these matter when original code enters.
setReturnMode(RET_RTS, [
  "player_interaction_22",
  "player_interaction_23",
  "CODE_B88C89",
  "CODE_B89126",
  "CODE_B8941D",
  "CODE_B89436",
]);
