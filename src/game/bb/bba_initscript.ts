/**
 * Bank $BB (part a) — sprite spawn scripts ("init scripts").
 *
 * A spawn script is a list of words, normally in bank $FF:
 * - a word below $8000 is a sprite field offset followed by a value word: the value is stored at
 *   that offset of the sprite in X. The original does this with `TCD` (direct page = offset) and
 *   `STA $00,x`, so the store lands at offset + X ("set_sprite_config").
 * - a word $8000+ is a command: its high byte - $80 indexes `initscript_commands`; most take one
 *   operand word. Command $80 ends the script successfully.
 * Scripts can nest (`init_command_load_subconfig`), set up palettes, graphics DMA for static
 * sprites, positions relative to the spawning sprite, and so on. The script returns carry clear
 * on success, carry set if a resource (palette / VRAM / DMA slot) could not be obtained.
 *
 * The original routines chain into each other with JMP and keep the caller's data bank on the
 * stack (PHB ... PLB/RTL); here the interpreter is a loop over a small state record and each
 * command is a function named after its label that returns true when the script ends.
 */
import { r16, w16, bus16, busW16, rom16 } from "../../core/mem";
import { reg, register } from "../../core/cpu";
import { L, R, C, sprite, sprite_table, level } from "../../core/sym";
import {
  set_alt_sprite_animation,
  request_palette_direct,
  request_sprite_palette,
  allocate_sprite_vram_slot,
  dereference_sprite_palette,
} from "../../gen/routines";
import { mergeBits } from "./bba_util";

const SPRITE_SIZE = 0x5e;
const SPRITE_DMA_SIZE = 8;
const COMMAND_TABLE = L("initscript_commands");

/** Interpreter state: the registers the original routines share. */
interface Script {
  /** data bank holding the script */
  db: number;
  /** offset of the current entry in the script */
  y: number;
  /** X register: the sprite being configured (alternate_sprite after any command) */
  x: number;
  /** direct page register (left at a field offset by set_sprite_config) */
  dp: number;
  /** carry on exit */
  c: boolean;
}

/** LDA.w DATA_FF0000+off,y: script word at Y+off in the script's bank. */
function operand(s: Script, off: number): number {
  return bus16(((s.db << 16) + off + s.y) & 0xffffff);
}

const alt = () => r16(R.alternate_sprite);

/** Run a script from s.y until a command ends it ($BB8489 parse_initscript_entry loop). */
function run(s: Script) {
  for (;;) {
    const w = operand(s, 0);
    if (!(w & 0x8000)) {
      set_sprite_config(s, w);
      continue;
    }
    const index = ((((w >> 8) & 0xff) - 0x80) << 1) & 0xffff;
    const target = 0xbb0000 | rom16(COMMAND_TABLE + index);
    const cmd = COMMANDS.get(target);
    if (!cmd) throw new Error(`init script: unknown command $${w.toString(16)} at $${s.db.toString(16)}:${s.y.toString(16)}`);
    s.x = index; // TAX for the JMP (initscript_commands,x)
    if (cmd(s)) return;
  }
}

/** Common exit: PLB (the caller's data bank comes back), A = 0, D = 0, RTL. */
function finish(s: Script, callerDb: number) {
  reg.db = callerDb;
  reg.a = 0;
  reg.x = s.x;
  reg.y = s.y;
  reg.c = s.c;
}

/** $BB8474 — Y = script in bank $FF, X = sprite. Carry set if the spawn failed. */
export function apply_spawn_script_to_slot() {
  const callerDb = reg.db;
  const s: Script = { db: 0xff, y: reg.y & 0xffff, x: reg.x & 0xffff, dp: 0, c: false };
  run(s);
  finish(s, callerDb);
}

/** $BB847C — Y = script in the current data bank, X = sprite. */
export function parse_initscript() {
  const callerDb = reg.db;
  const s: Script = { db: reg.db & 0xff, y: reg.y & 0xffff, x: reg.x & 0xffff, dp: 0, c: false };
  run(s);
  finish(s, callerDb);
}

/** $BB847F — word < $8000: store the next word at that offset of the sprite in X. */
function set_sprite_config(s: Script, offset: number) {
  s.dp = offset;
  busW16((s.dp + sprite.type + s.x) & 0xffff, operand(s, 2));
  initscript_next(s);
}

/** $BB8485 — skip an entry with one operand. */
function initscript_next(s: Script): boolean {
  s.y = (s.y + 2) & 0xffff;
  return initscript_next_no_operand(s);
}

/** $BB8487 — skip an entry without operand. */
function initscript_next_no_operand(s: Script): boolean {
  s.y = (s.y + 2) & 0xffff;
  return false;
}

/** $BB84B9 — the script failed (a resource could not be allocated). */
function CODE_BB84B9(s: Script): boolean {
  s.c = true;
  s.dp = 0;
  return true;
}

/** $BB84C0 — command $80: end of script. */
function init_command_success(s: Script): boolean {
  s.c = false;
  s.dp = 0;
  return true;
}

/** $BB84C7 — command $81 <animation>: start an animation on alternate_sprite. */
function initcommand_set_animation(s: Script): boolean {
  s.dp = 0;
  reg.a = operand(s, 2);
  reg.x = s.x;
  reg.y = s.y;
  reg.db = s.db;
  set_alt_sprite_animation();
  s.x = alt();
  return initscript_next(s);
}

/** $BB84D8 — command $82: no-op with operand. */
function init_command_skip_operand(s: Script): boolean {
  return initscript_next(s);
}

/** $BB84DA — command $83 <script>: run another script (same bank) on alternate_sprite. */
function init_command_load_subconfig(s: Script): boolean {
  s.dp = 0;
  const sub: Script = { db: s.db, y: operand(s, 2), x: alt(), dp: 0, c: false };
  run(sub);
  s.x = alt();
  return initscript_next(s);
}

/** Set alternate_sprite's palette bits from A (result of a palette request). */
function applyPaletteBits(s: Script) {
  const x = alt();
  s.x = x;
  w16(x + sprite.oam_property, mergeBits(r16(x + sprite.oam_property), reg.a, 0x0e00));
}

/** $BB84EE — command $84 <palette address>. */
function init_command_set_palette(s: Script): boolean {
  s.dp = 0;
  reg.a = operand(s, 2);
  reg.x = s.x;
  reg.y = s.y;
  reg.db = 0xbb;
  request_palette_direct();
  reg.db = s.db;
  applyPaletteBits(s);
  return initscript_next(s);
}

/** $BB850C — command $85 <oam bits>: set the priority/flip bits (12-15) of the OAM property. */
function init_command_set_oam_properties(s: Script): boolean {
  s.dp = 0;
  const x = alt();
  s.x = x;
  w16(x + sprite.oam_property, mergeBits(r16(x + sprite.oam_property), operand(s, 2), 0xf000));
  return initscript_next(s);
}

/** $BB8521 — command $86 <dx> <dy>: position relative to current_sprite (mirrored with its flips). */
function init_command_spawn_relative(s: Script): boolean {
  s.dp = 0;
  const cur = r16(R.current_sprite);
  const curOam = r16(cur + sprite.oam_property);
  let dx = operand(s, 2);
  if (curOam & 0x4000) dx = (-dx) & 0xffff; // X flip
  const x = alt();
  w16(x + sprite.x_position, (dx + r16(cur + sprite.x_position)) & 0xffff);
  let dy = operand(s, 4);
  if (curOam & 0x8000) dy = (-dy) & 0xffff; // Y flip
  w16(x + sprite.y_position, (dy + r16(cur + sprite.y_position)) & 0xffff);
  // drawn just in front of the spawner, sharing its sub-pixel position and flips
  w16(x + sprite.render_order, (r16(cur + sprite.render_order) + 1) & 0xffff);
  if (r16(cur + sprite.display_mode) === 0xc000) w16(x + sprite.display_mode, 0xc000);
  w16(x + sprite.x_sub_position, r16(cur + sprite.x_sub_position));
  w16(x + sprite.y_sub_position, r16(cur + sprite.y_sub_position));
  w16(x + sprite.oam_property, mergeBits(r16(x + sprite.oam_property), r16(cur + sprite.oam_property), 0xf000));
  s.x = x;
  s.y = (s.y + 2) & 0xffff;
  return initscript_next(s);
}

/** $BB8582 — command $87 <field> <value>: store value (negated if current_sprite is X-flipped). */
function init_command_set_directional(s: Script): boolean {
  s.dp = 0;
  let v = operand(s, 4);
  if (r16(r16(R.current_sprite) + sprite.oam_property) & 0x4000) v = (-v) & 0xffff;
  return CODE_BB8593(s, v);
}

/** $BB8593 */
function CODE_BB8593(s: Script, v: number): boolean {
  s.x = alt();
  s.dp = operand(s, 2);
  busW16((s.dp + sprite.type + s.x) & 0xffff, v);
  s.y = (s.y + 2) & 0xffff;
  return initscript_next(s);
}

/** $BB85A2 — command $88: place at the last contact flash position. */
function init_command_set_position(s: Script): boolean {
  s.dp = 0;
  const x = alt();
  s.x = x;
  w16(x + sprite.x_position, r16(R.contact_flash_x_position));
  w16(x + sprite.y_position, r16(R.contact_flash_y_position));
  w16(x + sprite.render_order, 0x00f8);
  return initscript_next_no_operand(s);
}

/** $BB85BC — command $8A <13 words>: set a block of movement/animation fields at once. */
function init_command_bulk_set(s: Script): boolean {
  s.dp = 0;
  const x = alt();
  s.x = x;
  w16(x + sprite.unknown_5C, 0);
  const fields = [
    sprite.general_purpose_46,
    sprite.general_purpose_42,
    sprite.general_purpose_4C,
    sprite.general_purpose_4E,
    sprite.movement_state,
    sprite.unknown_28,
    sprite.unknown_22,
    sprite.unknown_2C,
    sprite.x_speed,
    sprite.y_speed,
    sprite.max_x_speed,
    sprite.animation_speed,
    sprite.animation_id,
  ];
  fields.forEach((f, i) => w16(x + f, operand(s, 2 + i * 2)));
  s.y = (s.y + 0x1c) & 0xffff;
  return false;
}

/** $BB860E — command $8B <oam bits>: like $85, but behind door occlusion layers the priority is raised. */
function init_command_set_oam_special(s: Script): boolean {
  s.dp = 0;
  const x = alt();
  s.x = x;
  const oam = mergeBits(r16(x + sprite.oam_property), operand(s, 2), 0xf000);
  w16(x + sprite.oam_property, oam);
  if (r16(level.effects) & C.door_occlusion_effect && (oam & 0x3000) !== 0x3000) return CODE_BB8636(s, oam & 0x3000);
  return CODE_BB8633(s);
}

/** $BB8633 */
function CODE_BB8633(s: Script): boolean {
  return initscript_next(s);
}

/** $BB8636 — A = current priority bits: raise the priority by one. */
function CODE_BB8636(s: Script, a: number): boolean {
  const x = s.x;
  a = (a + 0x1000) & 0xffff;
  w16(x + sprite.oam_property, mergeBits(r16(x + sprite.oam_property), a, 0x3000));
  return initscript_next(s);
}

/** $BB8646 — command $8C: same as $84. */
function init_command_set_palette_copy(s: Script): boolean {
  return init_command_set_palette(s);
}

/** $BB865C — (unused command body) X = 0 or $1E: palette address + X, $1E for the inactive Kong. */
function CODE_BB865C(s: Script): boolean {
  reg.a = (s.x + operand(s, 2)) & 0xffff;
  reg.y = s.y;
  reg.db = 0xbb;
  request_palette_direct();
  reg.db = s.db;
  applyPaletteBits(s);
  return initscript_next(s);
}

/** $BB8678 — command $8D <palette id>. */
function init_command_set_alt_palette(s: Script): boolean {
  s.dp = 0;
  reg.a = operand(s, 2);
  reg.x = s.x;
  reg.y = s.y;
  reg.db = 0xbb;
  request_sprite_palette();
  reg.db = s.db;
  applyPaletteBits(s);
  return initscript_next(s);
}

/**
 * $BB86D5 — command $89 <type> <palette address> <gfx source word> <gfx bank | size>:
 * a "static" sprite type whose graphics are shared by all sprites of that type. The first one
 * allocates a VRAM slot and queues the graphics DMA; later ones reuse the first one's tiles.
 */
function init_command_setup_static(s: Script): boolean {
  return setupStatic(s, false);
}

/** $BB879E — command $8E: like $89 with a palette id instead of an address. */
function init_command_setup_static_2(s: Script): boolean {
  return setupStatic(s, true);
}

function setupStatic(s: Script, byPaletteId: boolean): boolean {
  s.dp = 0;
  w16(0x32, operand(s, 2));
  w16(0x34, operand(s, 4));
  w16(0x36, operand(s, 6));
  w16(0x38, operand(s, 8));
  w16(0x3a, (s.db << 8) | s.db);
  reg.a = r16(0x34);
  reg.y = s.y;
  reg.db = 0xbb;
  if (byPaletteId) request_sprite_palette();
  else request_palette_direct();
  s.x = reg.x;
  if (reg.c) return CODE_BB84B9(s); // CODE_BB876C / CODE_BB8835
  applyPaletteBits(s);
  reg.db = s.db;

  const type = r16(0x32);
  for (let x: number = sprite_table.slot_3; x !== sprite_table.end; x += SPRITE_SIZE) {
    if (type !== r16(x + sprite.type)) continue;
    // CODE_BB8783 / CODE_BB884C: share the tiles of the existing sprite of that type
    const a = alt();
    w16(a + sprite.oam_property, r16(x + sprite.oam_property) & 0xffe0);
    w16(a + sprite.type, type);
    if (byPaletteId) {
      w16(a + sprite.last_rendered_graphic, 0);
      w16(a + sprite.display_mode, 0);
      w16(a + sprite.terrain_attributes, 0);
    }
    s.x = a;
    return staticDone(s);
  }

  // first sprite of its type: needs a VRAM slot and a sprite DMA buffer entry
  // CMP #$0018 / BPL: the sprite DMA buffer holds at most 3 entries
  let ok = ((r16(R.next_sprite_dma_buffer_slot) - 0x0018) & 0x8000) !== 0;
  if (ok) {
    reg.x = alt();
    allocate_sprite_vram_slot();
    reg.y = s.y;
    ok = !reg.c;
  }
  if (!ok) {
    // CODE_BB876F / CODE_BB8838: undo the palette request
    const a = alt();
    reg.a = r16(a + sprite.oam_property);
    dereference_sprite_palette();
    s.x = reg.x;
    // a freshly loaded palette also gives back its upload slot
    if (!reg.c) w16(R.current_palette_buffer_slot, (r16(R.current_palette_buffer_slot) - 1) & 0x000f);
    return CODE_BB84B9(s);
  }
  const d = r16(R.next_sprite_dma_buffer_slot);
  w16(0x1736 + d, r16(0x36)); // sprite_dma[].source_word
  w16(0x1738 + d, (r16(0x38) & 0x00ff) | 0x8000); // sprite_dma[].source_bank
  w16(0x1732 + d, (r16(0x38) & 0xff00) >> 3); // sprite_dma[].size
  w16(0x1734 + d, ((r16(alt() + sprite.oam_property) & 0x01ff) << 4) & 0xffff); // sprite_dma[].destination
  w16(R.next_sprite_dma_buffer_slot, (d + SPRITE_DMA_SIZE) & 0xffff);
  const a = alt();
  w16(a + sprite.type, type);
  s.x = a;
  return staticDone(s);
}

/** CODE_BB8790 / CODE_BB885F: restore the data bank, skip the 4 operands. */
function staticDone(s: Script): boolean {
  s.y = (s.y + 6) & 0xffff;
  return initscript_next(s);
}

const COMMANDS = new Map<number, (s: Script) => boolean>([
  [L("init_command_success"), init_command_success],
  [L("initcommand_set_animation"), initcommand_set_animation],
  [L("init_command_skip_operand"), init_command_skip_operand],
  [L("init_command_load_subconfig"), init_command_load_subconfig],
  [L("init_command_set_palette"), init_command_set_palette],
  [L("init_command_set_oam_properties"), init_command_set_oam_properties],
  [L("init_command_spawn_relative"), init_command_spawn_relative],
  [L("init_command_set_directional"), init_command_set_directional],
  [L("init_command_set_position"), init_command_set_position],
  [L("init_command_setup_static"), init_command_setup_static],
  [L("init_command_bulk_set"), init_command_bulk_set],
  [L("init_command_set_oam_special"), init_command_set_oam_special],
  [L("init_command_set_palette_copy"), init_command_set_palette_copy],
  [L("init_command_set_alt_palette"), init_command_set_alt_palette],
  [L("init_command_setup_static_2"), init_command_setup_static_2],
  [L("CODE_BB865C"), CODE_BB865C],
]);

// ---- dead code after init_command_set_alt_palette: midpoint of two hitboxes -> contact flash ----

/** $BB869E — A = left edge (max of $D9/$E1). */
export function CODE_BB869E() {
  w16(0x5e, reg.a);
  let a = r16(0xdd);
  if (!((a - r16(0xe5)) & 0x8000)) a = r16(0xe5);
  reg.a = a;
  CODE_BB86A8();
}

/** $BB86A8 — A = right edge: contact_flash_x = midpoint, then the same for Y. */
export function CODE_BB86A8() {
  const lo = r16(0x5e);
  let d = (reg.a - lo) & 0xffff;
  d = ((d >> 1) | (d & 0x8000)) & 0xffff; // CMP #$8000 / ROR: signed halving
  w16(R.contact_flash_x_position, (d + lo) & 0xffff);
  let a = r16(0xdf);
  if ((a - r16(0xe7)) & 0x8000) a = r16(0xe7);
  reg.a = a;
  CODE_BB86BD();
}

/** $BB86BD */
export function CODE_BB86BD() {
  w16(0x5e, reg.a);
  let a = r16(0xdb);
  if (!((a - r16(0xe3)) & 0x8000)) a = r16(0xe3);
  reg.a = a;
  CODE_BB86C7();
}

/** $BB86C7 */
export function CODE_BB86C7() {
  const lo = r16(0x5e);
  let d = (reg.a - lo) & 0xffff;
  d = ((d >> 1) | (d & 0x8000)) & 0xffff;
  reg.a = (d + lo) & 0xffff;
  w16(R.contact_flash_y_position, reg.a);
}

register({
  apply_spawn_script_to_slot,
  parse_initscript,
  CODE_BB869E,
  CODE_BB86A8,
  CODE_BB86BD,
  CODE_BB86C7,
});
