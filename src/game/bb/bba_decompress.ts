/**
 * Bank $BB (part a) — the "Big Data" decompressor used for level graphics, tilemaps and layouts.
 *
 * The compressed stream is a sequence of 4-bit commands. The decoder alternates between two
 * command sets depending on whether the next command nibble is the HIGH nibble of a fresh byte
 * (set 1) or the LOW nibble of the byte just consumed (set 2); each command exists in both
 * flavours (`*_1` / `*_2`) because its operands are nibble-aligned differently.
 *
 * Original mechanics, reproduced here:
 * - `build_decompression_lookup` builds two 256-byte TABLES (not code) in RAM:
 *   $7E2000+b = b >> 4 and $7E2100+b = (b & $0F) << 4. The decoder reads nibbles through
 *   long pointers $42 -> $7E2000 and $46 -> $7E2100 whose low byte it sets to the byte.
 * - Commands are dispatched through code-pointer tables at $BB8000 (set 1) and $BB8040 (set 2):
 *   the decoder builds "entry address - 1" in $4E / $4A, pushes it and RTSes into a JMP.
 * - Header (bytes 1-6): two fill bytes ($52/$53), two direct bytes ($56/$57), a direct word
 *   ($54); bytes 7-$26 are 16 words that `copy_future_word` can reference; commands start at $27.
 * - Output goes to bank $3A (the data bank during decoding) at offset X; back references read
 *   the output itself. Returns X = number of bytes written.
 */
import { r8, r16, w8, w16, bus8, busW8, rom8, rom16, io8, io16 } from "../../core/mem";
import { reg, register } from "../../core/cpu";
import { chargeOps } from "./bba_util";
import { L, DMA, PPU, CPU } from "../../core/sym";

// ---- decoder state (the direct page variables of the original) ----
let src = 0; // $34-$36: compressed data (long pointer)
let y = 0; // index into the compressed data
let x = 0; // output offset
let dstBank = 0x7f; // $3A, the data bank while decoding
let b42 = 0; // $42 low byte: last operand byte (its high nibble is read via $7E2000)
let b46 = 0; // $46 low byte: last command/operand byte (its low nibble is read via $7E2100)
let count = 0; // $3C
let off3E = 0; // $3E (8-bit)
let off40 = 0; // $40
let cmd4E = 0x01; // $4E low byte: last set 1 dispatch
let cmd4A = 0x40; // $4A low byte: last set 2 dispatch
/** Instructions the original would have executed (see chargeTime). */
let ops = 0;
let entered = false;
/** build_decompression_lookup: 4 + 256*7 + 2 + 256*9 + 2 instructions. */
const BUILD_LOOKUP_OPS = 4104;

const SET1 = 1;
const SET2 = 2; // next command = low nibble of $42
const SET2_WIDE = 3; // next command = low nibble of $46
const DONE = 0;

/** [$42]: high nibble of b, moved down (table at $7E2000). */
const hiNibble = (b: number) => r8(0x7e2000 + b);
/** [$46]: low nibble of b, moved up (table at $7E2100). */
const loNibbleUp = (b: number) => r8(0x7e2100 + b);

function next(): number {
  const v = bus8((src + y) & 0xffffff);
  y = (y + 1) & 0xffff;
  return v;
}
/** LDA [$34],y in 16-bit mode, at an explicit index. */
const srcWord = (i: number) => bus8((src + i) & 0xffffff) | (bus8((src + i + 1) & 0xffffff) << 8);
const outAddr = (o: number) => ((dstBank << 16) + o) & 0xffffff;
const put = (o: number, v: number) => busW8(outAddr(o), v & 0xff);
const get = (o: number) => bus8(outAddr(o));
function putWord(o: number, v: number) {
  put(o, v);
  put(o + 1, v >> 8);
}
const getWord = (o: number) => get(o) | (get(o + 1) << 8);

function fill(v: number, n: number) {
  count = n;
  ops += 4 * n;
  do {
    put(x, v);
    x = (x + 1) & 0xffff;
    count = (count - 1) & 0xff;
  } while (count !== 0);
}
/** Copy `n` bytes from an earlier output offset, byte by byte (overlap repeats data). */
function backCopy(from: number, n: number) {
  count = n;
  ops += 6 * n;
  let s = from & 0xffff;
  do {
    put(x, get(s));
    s = (s + 1) & 0xffff;
    x = (x + 1) & 0xffff;
    count = (count - 1) & 0xff;
  } while (count !== 0);
}

// ---- command set 1 (operand nibble = low nibble of the command byte in $46) ----

/** $BB8E2A — 0n: copy n literal bytes; n = 0 ends the data. */
function copy_or_return_1(): number {
  const n = b46 & 0x0f;
  if (n === 0) {
    ops += 3;
    return DONE;
  }
  ops += 5 + 6 * n;
  count = n;
  do {
    put(x, next());
    x = (x + 1) & 0xffff;
    count = (count - 1) & 0xff;
  } while (count !== 0);
  return SET1;
}
/** $BB8E96 — 1n: one literal byte made of nibble n and the next nibble. */
function stream_byte_1(): number {
  ops += 10;
  off3E = loNibbleUp(b46);
  b42 = next();
  put(x, off3E | hiNibble(b42));
  x = (x + 1) & 0xffff;
  return SET2;
}
/** $BB8EB4 — 2n: two literal bytes, nibble-shifted. */
function stream_word_1(): number {
  ops += 20;
  off3E = loNibbleUp(b46);
  b42 = b46 = next();
  put(x, off3E | hiNibble(b42));
  x = (x + 1) & 0xffff;
  off3E = loNibbleUp(b46);
  b42 = next();
  put(x, off3E | hiNibble(b42));
  x = (x + 1) & 0xffff;
  return SET2;
}
/** $BB8EEB — 3n vv: n+3 copies of byte vv. */
function stream_byte_fill_1(): number {
  ops += 7;
  const n = (b46 & 0x0f) + 3;
  fill(next(), n);
  return SET1;
}
/** $BB8F26 — 4n: n+3 copies of fill byte 1. */
function direct_byte_1_fill_1(): number {
  ops += 6;
  fill(r8(0x52), (b46 & 0x0f) + 3);
  return SET1;
}
/** $BB8F53 — 5n: n+3 copies of fill byte 2. */
function direct_byte_2_fill_1(): number {
  ops += 6;
  fill(r8(0x53), (b46 & 0x0f) + 3);
  return SET1;
}
/** $BB8F80 — 6: the direct word. */
function direct_word_put_1(): number {
  ops += 7;
  putWord(x, r16(0x54));
  x = (x + 2) & 0xffff;
  return SET2_WIDE;
}
/** $BB8F9C — 7: direct byte 1. */
function direct_byte_1_put_1(): number {
  ops += 4;
  put(x, r8(0x56));
  x = (x + 1) & 0xffff;
  return SET2_WIDE;
}
/** $BB8FAE — 8: direct byte 2. */
function direct_byte_2_put_1(): number {
  ops += 4;
  put(x, r8(0x57));
  x = (x + 1) & 0xffff;
  return SET2_WIDE;
}
/** $BB8FC0 — 9n: repeat the word n+2 bytes back. */
function back_copy_word_1(): number {
  ops += 17;
  off3E = (b46 & 0x0f) + 2;
  putWord(x, getWord((x - off3E) & 0xffff));
  x = (x + 2) & 0xffff;
  return SET1;
}
/** $BB8FFF — An oo: copy n+3 bytes from oo bytes before the copy's start. */
function back_copy_1(): number {
  ops += 18;
  const n = (b46 & 0x0f) + 3;
  off3E = next();
  backCopy(x - n - off3E, n);
  return SET1;
}
/** $BB9062 — Bn ooo: copy n+3 bytes from ooo+$103 bytes back. */
function back_copy_far_1(): number {
  ops += 26;
  const n = (b46 & 0x0f) + 3;
  const hi = next();
  b46 = next();
  off40 = ((((hi << 8) | b46) >> 4) + 0x0103) & 0xffff;
  backCopy(x - off40, n);
  return SET2_WIDE;
}
/** $BB90C9 — Cn oooo: copy n+3 bytes from oooo (big endian) bytes back. */
function back_copy_arbitrary_1(): number {
  ops += 18;
  const n = (b46 & 0x0f) + 3;
  const w = srcWord(y);
  off40 = ((w << 8) | (w >> 8)) & 0xffff;
  y = (y + 2) & 0xffff;
  backCopy(x - off40, n);
  return SET1;
}
/** $BB9138 — D: repeat the last byte. */
function duplicate_byte_1(): number {
  ops += 6;
  x = (x - 1) & 0xffff;
  put(x + 1, get(x));
  x = (x + 2) & 0xffff;
  return SET2_WIDE;
}
/** $BB9150 — E: repeat the last word. */
function duplicate_word_1(): number {
  ops += 11;
  x = (x - 2) & 0xffff;
  putWord(x + 2, getWord(x));
  x = (x + 4) & 0xffff;
  return SET2_WIDE;
}
/** $BB9176 — Fn: header word n (bytes 7+2n). */
function copy_future_word_1(): number {
  ops += 14;
  putWord(x, srcWord(((b46 & 0x0f) << 1) + 7));
  x = (x + 2) & 0xffff;
  return SET1;
}

// ---- command set 2 (the command was a low nibble: operands start at a high nibble) ----

/** $BB8E6F */
function copy_or_return_2(): number {
  b42 = b46 = next();
  const n = hiNibble(b42);
  if (n === 0) {
    ops += 6;
    return DONE;
  }
  ops += 8 + 12 * n;
  count = n;
  do {
    off3E = loNibbleUp(b46);
    b42 = b46 = next();
    put(x, off3E | hiNibble(b42));
    x = (x + 1) & 0xffff;
    count = (count - 1) & 0xff;
  } while (count !== 0);
  return SET2_WIDE;
}
/** $BB8EAA */
function stream_byte_2(): number {
  ops += 5;
  put(x, next());
  x = (x + 1) & 0xffff;
  return SET1;
}
/** $BB8EDB */
function stream_word_2(): number {
  ops += 9;
  putWord(x, srcWord(y));
  y = (y + 2) & 0xffff;
  x = (x + 2) & 0xffff;
  return SET1;
}
/** $BB8F01 */
function stream_byte_fill_2(): number {
  ops += 15;
  b42 = b46 = next();
  const n = hiNibble(b42) + 3;
  off3E = loNibbleUp(b46);
  b42 = next();
  fill(off3E | hiNibble(b42), n);
  return SET2;
}
/** $BB8F3B */
function direct_byte_1_fill_2(): number {
  ops += 8;
  b42 = next();
  fill(r8(0x52), hiNibble(b42) + 3);
  return SET2;
}
/** $BB8F68 */
function direct_byte_2_fill_2(): number {
  ops += 8;
  b42 = next();
  fill(r8(0x53), hiNibble(b42) + 3);
  return SET2;
}
/** $BB8F8E */
function direct_word_put_2(): number {
  ops += 7;
  putWord(x, r16(0x54));
  x = (x + 2) & 0xffff;
  return SET1;
}
/** $BB8FA5 */
function direct_byte_1_put_2(): number {
  ops += 4;
  put(x, r8(0x56));
  x = (x + 1) & 0xffff;
  return SET1;
}
/** $BB8FB7 */
function direct_byte_2_put_2(): number {
  ops += 4;
  put(x, r8(0x57));
  x = (x + 1) & 0xffff;
  return SET1;
}
/** $BB8FDE */
function back_copy_word_2(): number {
  ops += 19;
  b42 = next();
  off3E = hiNibble(b42) + 2;
  putWord(x, getWord((x - off3E) & 0xffff));
  x = (x + 2) & 0xffff;
  return SET2;
}
/** $BB9029 */
function back_copy_2(): number {
  ops += 26;
  b42 = b46 = next();
  const n = hiNibble(b42) + 3;
  off3E = loNibbleUp(b46);
  b42 = next();
  off3E = hiNibble(b42) | off3E;
  backCopy(x - n - off3E, n);
  return SET2;
}
/** $BB9097 */
function back_copy_far_2(): number {
  ops += 22;
  b42 = next();
  const n = hiNibble(b42) + 3;
  const lo = next();
  off40 = ((((b42 & 0x0f) << 8) | lo) + 0x0103) & 0xffff;
  backCopy(x - off40, n);
  return SET1;
}
/** $BB90F2 */
function back_copy_arbitrary_2(): number {
  ops += 34;
  b42 = next();
  const n = hiNibble(b42) + 3;
  const lo = next();
  off40 = (((b42 << 8) | lo) << 4) & 0xffff;
  b42 = next();
  off40 = off40 | (hiNibble(b42) & 0x0f);
  backCopy(x - off40, n);
  return SET2;
}
/** $BB9144 */
function duplicate_byte_2(): number {
  ops += 6;
  x = (x - 1) & 0xffff;
  put(x + 1, get(x));
  x = (x + 2) & 0xffff;
  return SET1;
}
/** $BB9163 */
function duplicate_word_2(): number {
  ops += 11;
  x = (x - 2) & 0xffff;
  putWord(x + 2, getWord(x));
  x = (x + 4) & 0xffff;
  return SET1;
}
/** $BB9190 */
function copy_future_word_2(): number {
  ops += 18;
  b46 = next();
  putWord(x, srcWord(((b46 & 0xf0) >> 3) + 7));
  x = (x + 2) & 0xffff;
  return SET2_WIDE;
}

/** Command routines by address, for dispatch through the ROM jump tables. */
const HANDLERS = new Map<number, () => number>();
function handlerFor(entry: number): () => number {
  // the RTS lands on a `JMP routine` in bank $BB
  if (rom8(entry) !== 0x4c) throw new Error(`decompressor: no JMP at $${entry.toString(16)}`);
  const target = 0xbb0000 | rom16(entry + 1);
  const h = HANDLERS.get(target);
  if (!h) throw new Error(`decompressor: unknown command routine $${target.toString(16)}`);
  return h;
}
let setTable1: (() => number)[] = [];
let setTable2: (() => number)[] = [];
function initTables() {
  const routines = [
    copy_or_return_1, stream_byte_1, stream_word_1, stream_byte_fill_1, direct_byte_1_fill_1,
    direct_byte_2_fill_1, direct_word_put_1, direct_byte_1_put_1, direct_byte_2_put_1,
    back_copy_word_1, back_copy_1, back_copy_far_1, back_copy_arbitrary_1, duplicate_byte_1,
    duplicate_word_1, copy_future_word_1,
    copy_or_return_2, stream_byte_2, stream_word_2, stream_byte_fill_2, direct_byte_1_fill_2,
    direct_byte_2_fill_2, direct_word_put_2, direct_byte_1_put_2, direct_byte_2_put_2,
    back_copy_word_2, back_copy_2, back_copy_far_2, back_copy_arbitrary_2, duplicate_byte_2,
    duplicate_word_2, copy_future_word_2,
  ];
  for (const r of routines) HANDLERS.set(L(r.name), r);
  // set 1: pushed $80(4n) -> RTS to $BB80(4n)+1; set 2: pushed $80(4n+$3F) -> $BB80(4n+$40)
  setTable1 = Array.from({ length: 16 }, (_, n) => handlerFor(0xbb8000 + 4 * n + 1));
  setTable2 = Array.from({ length: 16 }, (_, n) => handlerFor(0xbb8000 + 4 * n + 0x40));
}

/** $BB8D91 — X/Y = source address/bank, A = destination offset in bank $7F. */
export function decompress_data() {
  ops = 6;
  entered = true;
  w16(0x38, reg.a);
  w16(0x3a, 0x007f);
  w16(0x34, reg.x);
  w16(0x36, reg.y);
  start_decompression();
}

/** $BB8D9E — X/Y = source address/bank; destination $7F0000. */
export function decompress_data_default() {
  ops = 8;
  entered = true;
  w16(0x34, reg.x);
  w16(0x36, reg.y);
  w16(0x38, 0x0000);
  w16(0x3a, 0x007f);
  start_decompression();
}

/** $BB8DAE — decompress [$34] to $3A:$38. Returns X = decompressed size (A = $FFFF). */
export function start_decompression() {
  if (!setTable1.length) initTables();
  if (!entered) ops = 0;
  entered = false;
  ops += 41 + BUILD_LOOKUP_OPS;
  const savedY = reg.y;
  w16(0x32, 0xffff); // never DMA the result to VRAM
  w16(0x46, 0x2100);
  w16(0x48, 0x007e);
  w16(0x44, 0x007e);
  w16(0x42, 0x2000);
  build_decompression_lookup();
  x = r16(0x38);
  src = r16(0x34) | (r8(0x36) << 16);
  dstBank = r8(0x3a);
  // header
  w8(0x52, bus8((src + 1) & 0xffffff));
  w8(0x53, bus8((src + 2) & 0xffffff));
  w8(0x56, bus8((src + 3) & 0xffffff));
  w8(0x57, bus8((src + 4) & 0xffffff));
  w16(0x54, srcWord(5));
  y = 0x0027;
  count = 0;
  off3E = 0;
  off40 = r16(0x40);
  b42 = 0x00;
  b46 = 0x00;
  cmd4E = 0x01;
  cmd4A = 0x40;
  w16(0x3c, 0);
  w16(0x3e, 0);

  let mode = SET1;
  while (mode !== DONE) {
    if (mode === SET1) {
      // execute_command_set_1: high nibble of a fresh byte
      b46 = next();
      cmd4E = (b46 & 0xf0) >> 2;
      ops += 9 + 1; // dispatch + the JMP of the entry (the RTS skips its NOP)
      mode = setTable1[b46 >> 4]();
    } else {
      // execute_command_set_2 / _wide: low nibble of $42 / $46
      const n = (mode === SET2 ? b42 : b46) & 0x0f;
      cmd4A = (n << 2) + 0x3f;
      ops += 8 + 1;
      mode = setTable2[n]();
    }
  }
  finalize_decompression(savedY);
}

/** $BB8E40 — leave the decoder: X = bytes written. */
function finalize_decompression(savedY: number) {
  ops += 10;
  chargeOps(ops);
  // the decoder's direct page as the original leaves it
  w8(0x42, b42);
  w8(0x46, b46);
  w8(0x3c, count);
  w8(0x3e, off3E);
  w16(0x40, off40);
  w8(0x4e, cmd4E);
  w8(0x4a, cmd4A);
  reg.y = savedY;
  reg.x = (x - r16(0x38)) & 0xffff;
  reg.a = r16(0x32);
  if (!(reg.a & 0x8000)) {
    // dead: $32 is always $FFFF
    io16(PPU.vram_address, r16(0x58));
    io16(DMA.source, r16(0x38));
    io8(DMA.source_bank, r8(0x3a));
    io16(DMA.size, reg.x);
    io16(DMA.settings, 0x1801);
    io8(CPU.enable_dma, 0x01);
    reg.a = 0x1801; // B = $18 from #$1801, then LDA #$01
  }
}

/** $BB91AF — build the two nibble lookup tables at $7E2000 and $7E2100. */
export function build_decompression_lookup() {
  for (let i = 0; i < 0x100; i++) w8(0x7e2100 + i, (i << 4) & 0xf0);
  for (let i = 0; i < 0x100; i++) w8(0x7e2000 + i, i >> 4);
  reg.a = 0x000f; // TDC (D = 0) then 8-bit TXA/LSR: B stays 0
  reg.x = 0x0100;
  reg.y = 0;
}

register({ decompress_data, decompress_data_default, start_decompression, build_decompression_lookup });
