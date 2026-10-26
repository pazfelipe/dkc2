/**
 * Memory model shared by all ported game code.
 *
 * The original game keeps all of its state in WRAM (128 KiB at banks $7E/$7F, with $0000-$1FFF
 * mirrored into every system bank). The port keeps EXACTLY the same layout, so:
 *   - every variable lives at the same address as in the original (see src/gen/ram.ts),
 *   - sprite records are addressed by their WRAM base (e.g. $0DE2 = Diddy) like the X register was,
 *   - a frame of the port can be compared byte-for-byte with a frame of the original.
 *
 * Addresses passed to r8/r16/w8/w16 are either 16-bit (bank $7E implied) or full 24-bit
 * $7E0000-$7FFFFF addresses.
 */
import type { Hardware } from "../platform/hw";

export let hw!: Hardware;
export let wram!: Uint8Array;
export let rom!: Uint8Array;

export function bindMachine(h: Hardware, romBytes: Uint8Array) {
  hw = h;
  rom = romBytes;
  wram = h.wram;
  h.onViews = () => {
    wram = h.wram;
  };
}

function woff(a: number): number {
  return a >= 0x7e0000 ? (a - 0x7e0000) & 0x1ffff : a & 0xffff;
}

// ---- WRAM ----
export function r8(a: number): number {
  return wram[woff(a)];
}
export function r16(a: number): number {
  const o = woff(a);
  return wram[o] | (wram[(o + 1) & 0x1ffff] << 8);
}
export function w8(a: number, v: number) {
  wram[woff(a)] = v;
}
export function w16(a: number, v: number) {
  const o = woff(a);
  wram[o] = v;
  wram[(o + 1) & 0x1ffff] = v >> 8;
}
/** Signed 16-bit read. */
export function rs16(a: number): number {
  return (r16(a) << 16) >> 16;
}
/** Read-modify-write helpers. */
export function inc16(a: number, d = 1) {
  w16(a, (r16(a) + d) & 0xffff);
}
export function or16(a: number, m: number) {
  w16(a, r16(a) | m);
}
export function and16(a: number, m: number) {
  w16(a, r16(a) & m);
}
export function or8(a: number, m: number) {
  w8(a, r8(a) | m);
}
export function and8(a: number, m: number) {
  w8(a, r8(a) & m);
}

// ---- ROM (HiROM, banks $80-$FF / $C0-$FF) ----
export function romOff(a: number): number {
  return ((a >> 16) & 0x3f) << 16 | (a & 0xffff);
}
export function rom8(a: number): number {
  const o = romOff(a);
  if (guard !== null) guardCheck(o, 1);
  return rom[o];
}
export function rom16(a: number): number {
  const o = romOff(a);
  if (guard !== null) guardCheck(o, 2);
  return rom[o] | (rom[o + 1] << 8);
}
export function rom24(a: number): number {
  const o = romOff(a);
  if (guard !== null) guardCheck(o, 3);
  return rom[o] | (rom[o + 1] << 8) | (rom[o + 2] << 16);
}

// ---- ROM-free guard (tests) ----
// The port runs on a data-only image of the cartridge (code bytes zero, see
// src/platform/assetformats.ts). To prove that nothing depends on the original code, the tests
// install a map of the code bytes; every read of one is recorded with the first caller's stack.
let guard: Uint8Array | null = null;
export const guardHits = new Map<number, { count: number; stack: string }>();
export function setRomGuard(codeMap: Uint8Array | null) {
  guard = codeMap;
  guardHits.clear();
}
function guardCheck(o: number, n: number) {
  for (let i = 0; i < n; i++) {
    if (!guard![o + i]) continue;
    const h = guardHits.get(o + i);
    if (h) h.count++;
    else guardHits.set(o + i, { count: 1, stack: new Error().stack?.split("\n").slice(3, 9).join("\n") ?? "" });
  }
}
export function romS16(a: number): number {
  return (rom16(a) << 16) >> 16;
}

// ---- Full bus (long addressing: [$xx],y or LDA.l) ----
function isWramBus(a: number): boolean {
  const bank = a >> 16;
  if (bank === 0x7e || bank === 0x7f) return true;
  const lo = a & 0xffff;
  return (bank < 0x40 || (bank >= 0x80 && bank < 0xc0)) && lo < 0x2000;
}
function isRomBus(a: number): boolean {
  const bank = a >> 16;
  const lo = a & 0xffff;
  if (bank >= 0xc0 || (bank >= 0x40 && bank < 0x7e)) return true;
  return lo >= 0x8000;
}
export function bus8(a: number): number {
  a &= 0xffffff;
  if (isWramBus(a)) return wram[(a >> 16) === 0x7f ? 0x10000 | (a & 0xffff) : a & 0xffff];
  if (isRomBus(a)) {
    const o = romOff(a);
    if (guard !== null) guardCheck(o, 1);
    return rom[o];
  }
  return hw.r8(a);
}
export function bus16(a: number): number {
  return bus8(a) | (bus8((a & 0xff0000) | ((a + 1) & 0xffff)) << 8);
}
export function bus24(a: number): number {
  return bus16(a) | (bus8((a & 0xff0000) | ((a + 2) & 0xffff)) << 16);
}
export function busW8(a: number, v: number) {
  a &= 0xffffff;
  if (isWramBus(a)) {
    wram[(a >> 16) === 0x7f ? 0x10000 | (a & 0xffff) : a & 0xffff] = v;
    return;
  }
  hw.w8(a, v);
}
export function busW16(a: number, v: number) {
  busW8(a, v & 0xff);
  busW8((a & 0xff0000) | ((a + 1) & 0xffff), (v >> 8) & 0xff);
}

// ---- Hardware registers (MMIO) ----
export function io8(reg: number, v: number) {
  hw.w8(reg, v);
}
export function io16(reg: number, v: number) {
  hw.w16(reg, v);
}
export function ioR8(reg: number): number {
  return hw.r8(reg);
}
export function ioR16(reg: number): number {
  return hw.r16(reg);
}

// ---- Arithmetic helpers mirroring 65816 semantics ----
export const u16 = (v: number) => v & 0xffff;
export const u8 = (v: number) => v & 0xff;
export const s16 = (v: number) => ((v & 0xffff) << 16) >> 16;
export const s8 = (v: number) => ((v & 0xff) << 24) >> 24;
/** 65816 ASL/LSR on 16-bit values. */
export const asl16 = (v: number) => (v << 1) & 0xffff;
/** Arithmetic shift right of a signed 16-bit value kept in 16 bits (CMP #$8000 / ROR idiom). */
export const asr16 = (v: number) => (s16(v) >> 1) & 0xffff;
