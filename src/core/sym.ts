/**
 * Symbol access. Names are the labels of the DKC2 disassembly (H4v0c21/DKC2-disassembly),
 * resolved to addresses by assembling it against your own ROM (see tools/gen_symbols.py).
 *
 *   L("ship_deck_32x32_tilemap") -> 24-bit ROM address
 *   R.active_kong_sprite         -> WRAM address
 *   sprite.x_speed               -> field offset inside a sprite record
 *   C.level_pirate_panic         -> numeric constant (!define)
 */
import labels from "../gen/rom_labels.json";

const table = labels as Record<string, number>;

export function L(name: string): number {
  const v = table[name];
  if (v === undefined) throw new Error(`unknown ROM label: ${name}`);
  return v;
}
export function hasLabel(name: string): boolean {
  return table[name] !== undefined;
}

let reverse: Map<number, string> | null = null;
/** Address -> label (debugging). */
export function labelAt(addr: number): string | undefined {
  if (!reverse) {
    reverse = new Map();
    for (const [k, v] of Object.entries(table)) if (!reverse.has(v)) reverse.set(v, k);
  }
  return reverse.get(addr);
}

export * from "../gen/ram";
export { C } from "../gen/constants";
