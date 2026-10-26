/**
 * The game's data as asset files (assets/, written by tools/extract_assets.ts).
 *
 * The original cartridge is 4 MiB: 65816 code (4.5%) and data (graphics, levels, music, tables...).
 * The port only needs the data. Every data block of the ROM is kept in its own file under
 * assets/, named after the disassembly's label or included file, and assets/manifest.json says
 * where each block lives in the cartridge address space. At startup the blocks are put back at
 * their addresses into a 4 MiB "data image" whose code bytes are all zero, so the ported code,
 * the DMA and the decompressor read the data exactly where the original did.
 *
 * Most files are raw bytes (.bin, .brr). Two kinds have a readable form that converts back to
 * the exact same bytes:
 *   palette  JSON list of [red, green, blue] colors, 0-31 each (SNES BGR555 words)
 *   text     JSON rows of strings (printable ASCII) and numbers (any other byte), one row per
 *            $00-terminated piece, so e.g. ["ISLAND MAP", 0]
 */

export type AssetFormat = "bin" | "palette" | "text";

/** assets/manifest.json */
export interface AssetManifest {
  about: string;
  rom: { title: string; sha256: string; size: number };
  /** file path (relative to assets/) -> format */
  files: Record<string, AssetFormat>;
  /**
   * Data blocks: [rom offset, length, file, offset inside the file].
   * Ranges that are not listed (code, padding) are zero in the data image.
   */
  blocks: [number, number, string, number][];
  /** Code ranges of the original ([rom offset, length]); only used by the ROM-free guard in tests. */
  code: [number, number][];
}

const te = new TextEncoder();
const td = new TextDecoder();

/** Asset file contents -> the bytes the cartridge had. */
export function decodeAsset(format: AssetFormat, content: Uint8Array): Uint8Array {
  if (format === "bin") return content;
  const doc = JSON.parse(td.decode(content));
  if (format === "palette") {
    const colors: [number, number, number][] = doc.colors;
    const out = new Uint8Array(colors.length * 2);
    colors.forEach(([r, g, b], i) => {
      const w = (r & 31) | ((g & 31) << 5) | ((b & 31) << 10);
      out[i * 2] = w & 0xff;
      out[i * 2 + 1] = w >> 8;
    });
    return out;
  }
  if (format === "text") {
    const bytes: number[] = [];
    for (const row of doc.text as (string | number)[][])
      for (const item of row) {
        if (typeof item === "number") bytes.push(item & 0xff);
        else for (let i = 0; i < item.length; i++) bytes.push(item.charCodeAt(i));
      }
    return Uint8Array.from(bytes);
  }
  throw new Error(`unknown asset format ${format}`);
}

/** Bytes -> readable asset contents, or null when this format cannot hold them losslessly. */
export function encodeAsset(format: AssetFormat, bytes: Uint8Array): Uint8Array | null {
  if (format === "bin") return bytes;
  if (format === "palette") {
    if (bytes.length % 2) return null;
    const rows: string[] = [];
    for (let i = 0; i < bytes.length; i += 2) {
      const w = bytes[i] | (bytes[i + 1] << 8);
      if (w & 0x8000) return null; // bit 15 is not part of a color: keep the raw file
      rows.push(`    [${w & 31}, ${(w >> 5) & 31}, ${(w >> 10) & 31}]`);
    }
    return te.encode(`{\n  "format": "SNES BGR555 colors as [red, green, blue], 0-31 each",\n  "colors": [\n${rows.join(",\n")}\n  ]\n}\n`);
  }
  if (format === "text") {
    const rows: (string | number)[][] = [];
    let row: (string | number)[] = [];
    let run = "";
    for (const b of bytes) {
      if (b >= 0x20 && b < 0x7f) {
        run += String.fromCharCode(b);
        continue;
      }
      if (run) row.push(run), (run = "");
      row.push(b);
      if (b === 0) rows.push(row), (row = []);
    }
    if (run) row.push(run);
    if (row.length) rows.push(row);
    const body = rows.map((r) => "    " + JSON.stringify(r)).join(",\n");
    return te.encode(`{\n  "format": "text rows: strings are ASCII bytes, numbers are other bytes",\n  "text": [\n${body}\n  ]\n}\n`);
  }
  return null;
}

/** File extension used for a format (raw files keep the disassembly's extension). */
export function assetExt(format: AssetFormat): string {
  return format === "bin" ? "" : ".json";
}

/**
 * Packed form for the browser (public/dkc2-data.pak, built by tools/pack_assets.ts from assets/):
 *   "DKC2PAK1", u32 image size, u32 block count, block count x [u32 offset, u32 length], bytes
 * Everything little-endian; the bytes are the blocks' decoded contents in order.
 */
export function unpackImage(pak: Uint8Array): Uint8Array {
  const magic = td.decode(pak.subarray(0, 8));
  if (magic !== "DKC2PAK1") throw new Error("not a DKC2 data pack");
  const dv = new DataView(pak.buffer, pak.byteOffset, pak.byteLength);
  const size = dv.getUint32(8, true);
  const n = dv.getUint32(12, true);
  const image = new Uint8Array(size);
  let p = 16 + n * 8;
  for (let i = 0; i < n; i++) {
    const off = dv.getUint32(16 + i * 8, true);
    const len = dv.getUint32(20 + i * 8, true);
    image.set(pak.subarray(p, p + len), off);
    p += len;
  }
  if (p !== pak.length) throw new Error("data pack is truncated or has extra bytes");
  return image;
}

export function packImage(size: number, blocks: { off: number; bytes: Uint8Array }[]): Uint8Array {
  const total = 16 + blocks.length * 8 + blocks.reduce((s, b) => s + b.bytes.length, 0);
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  out.set(te.encode("DKC2PAK1"), 0);
  dv.setUint32(8, size, true);
  dv.setUint32(12, blocks.length, true);
  let p = 16 + blocks.length * 8;
  blocks.forEach((b, i) => {
    dv.setUint32(16 + i * 8, b.off, true);
    dv.setUint32(20 + i * 8, b.bytes.length, true);
    out.set(b.bytes, p);
    p += b.bytes.length;
  });
  return out;
}
