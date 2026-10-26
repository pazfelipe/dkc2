/**
 * Extract the game's DATA from your ROM into assets/ (run once; the game then runs without a ROM).
 *
 *   npx tsx tools/extract_assets.ts [rom.sfc] [--out assets] [--check-dis /path/to/dkc2dis]
 *
 * Which bytes are data, and which file each block goes to, comes from tools/rom_layout.json
 * (made by tools/rom_layout.py from the disassembly: addresses and names only, no ROM bytes).
 * Code bytes are never written anywhere: the 65816 code is the TypeScript port in src/game/.
 *
 * Layout of assets/ (mirrors the disassembly):
 *   gfx/ levels/ backgrounds/ world_maps/ screens/ sound/   the files the disassembly includes
 *        (incbin) from its data/ tree, same names (palettes as readable JSON)
 *   sound/music/<song>_song_data.bin                         songs (assembled .asm in the disassembly)
 *   bank_XX/<label>.bin|.json                               tables written inline (db/dw/dl) in
 *        bank_XX.asm, one file per label (text as JSON); bank_EE-F2/spc_sound_engine.bin is the
 *        sound CPU's driver
 *   header/                                                 the cartridge header and vectors
 *   misc/<address>.bin                                      a few bytes all.asm places between banks
 *   manifest.json                                           where every block goes in the cartridge
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { encodeAsset, assetExt, type AssetFormat, type AssetManifest } from "../src/platform/assetformats.ts";
import { buildImage } from "./lib/assets.ts";

const args = process.argv.slice(2);
const opt = (n: string, d?: string) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : d;
};
const positional = args.filter((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--")));
const ROM = positional[0] ?? process.env.DKC2_ROM ?? "/home/claude/dkc2/Donkey Kong Country 2 - Diddy's Kong Quest (USA) (En,Fr) (Rev 1).sfc";
const OUT = opt("--out", new URL("../assets/", import.meta.url).pathname)!;
const DIS = opt("--check-dis", existsSync("/home/claude/ref/dkc2dis/data") ? "/home/claude/ref/dkc2dis" : undefined);

type Block = [number, number, "code" | "data" | "pad", string, string | null, number, "text" | "palette" | null];
const layout = JSON.parse(readFileSync(new URL("./rom_layout.json", import.meta.url), "utf8")) as { rom_size: number; sha256: string; blocks: Block[] };

let rom = new Uint8Array(readFileSync(ROM));
if (rom.length % 1024 === 512) rom = rom.subarray(512); // copier header
const sha = createHash("sha256").update(rom).digest("hex");
if (sha !== layout.sha256 || rom.length !== layout.rom_size) {
  console.error(`${ROM}: not Donkey Kong Country 2 (USA) Rev 1 (sha256 ${sha})`);
  process.exit(1);
}

/** Files under construction: bytes + which bytes were filled. */
interface FileBuf {
  bytes: Uint8Array;
  filled: Uint8Array;
  format: AssetFormat;
}
const files = new Map<string, FileBuf>();
function fileBuf(path: string, format: AssetFormat): FileBuf {
  let f = files.get(path);
  if (!f) files.set(path, (f = { bytes: new Uint8Array(0), filled: new Uint8Array(0), format }));
  return f;
}
function put(f: FileBuf, at: number, data: Uint8Array, where: string) {
  if (at + data.length > f.bytes.length) {
    const n = new Uint8Array(at + data.length);
    n.set(f.bytes);
    const m = new Uint8Array(at + data.length);
    m.set(f.filled);
    f.bytes = n;
    f.filled = m;
  }
  for (let i = 0; i < data.length; i++) {
    if (f.filled[at + i] && f.bytes[at + i] !== data[i]) throw new Error(`${where}: two ROM copies of the same file byte differ`);
    f.bytes[at + i] = data[i];
    f.filled[at + i] = 1;
  }
}
const safe = (name: string) => name.replace(/\+\$/g, "+").replace(/[^\w+-]/g, "_");
const stem = (src: string) => src.replace(/^data\//, "").replace(/\.asm$/, "");

const blocks: AssetManifest["blocks"] = [];
const code: AssetManifest["code"] = [];
let padNonZero = 0;
for (const [off, len, kind, name, src, srcOff, fmt] of layout.blocks) {
  const bytes = rom.subarray(off, off + len);
  if (kind === "code") {
    code.push([off, len]);
    continue;
  }
  if (kind === "pad" && bytes.every((b) => b === 0)) continue; // zero in the image anyway
  let path: string;
  let at: number;
  let format: AssetFormat = "bin";
  if (kind === "pad") {
    path = `pad/${safe(name)}.bin`;
    at = 0;
    padNonZero++;
  } else if (src && /\.(bin|brr)$/.test(src)) {
    // an incbin'd file of the disassembly: same path, rebuilt from the ROM
    path = stem(src);
    at = srcOff;
    if (/\/palettes\//.test(path)) format = "palette";
  } else if (src && src.startsWith("data/")) {
    // assembled data file (songs): one file, blocks appended in ROM order
    path = stem(src) + ".bin";
    at = files.get(path)?.bytes.length ?? 0;
  } else if (!src || src === "all.asm") {
    // the few bytes all.asm itself places between the banks: named by their address
    path = `misc/${(0xc00000 + off).toString(16).toUpperCase()}.bin`;
    at = 0;
  } else {
    path = `${stem(src)}/${safe(name)}.bin`;
    at = 0;
    if (fmt) format = fmt;
  }
  const f = fileBuf(path, format);
  put(f, at, bytes, `${name} -> ${path}`);
  blocks.push([off, len, path, at]);
}

// write files (readable formats when they round-trip exactly)
if (existsSync(join(OUT, "manifest.json"))) rmSync(OUT, { recursive: true }); // only a previous extraction
mkdirSync(OUT, { recursive: true });
const formats: Record<string, AssetFormat> = {};
const rename = new Map<string, string>();
let partial = 0;
for (const [path, f] of files) {
  if (f.filled.some((x) => !x)) partial++;
  let format = f.format;
  let content = format === "bin" ? f.bytes : encodeAsset(format, f.bytes);
  if (!content) (format = "bin"), (content = f.bytes);
  let out = path;
  if (format !== "bin") out = path.replace(/\.bin$/, "") + assetExt(format);
  rename.set(path, out);
  formats[out] = format;
  mkdirSync(dirname(join(OUT, out)), { recursive: true });
  writeFileSync(join(OUT, out), content);
}
for (const b of blocks) b[2] = rename.get(b[2])!;

const manifest: AssetManifest = {
  about:
    "Data of Donkey Kong Country 2 (USA, Rev 1), extracted by tools/extract_assets.ts. blocks: [cartridge offset, length, file, offset in file]. code: ranges of the original 65816 code (not extracted; zero in the data image).",
  rom: { title: "DIDDY'S KONG QUEST", sha256: sha, size: rom.length },
  files: formats,
  blocks,
  code,
};
// one block per line keeps the manifest diffable
const json = JSON.stringify(manifest, null, 1)
  .replace(/\[\n\s+(\d+),\n\s+(\d+),\n\s+("[^"]*"),\n\s+(\d+)\n\s+\]/g, "[$1, $2, $3, $4]")
  .replace(/\[\n\s+(\d+),\n\s+(\d+)\n\s+\]/g, "[$1, $2]");
writeFileSync(join(OUT, "manifest.json"), json);

// verify: the image rebuilt from the files equals the ROM on every data byte and is zero on code
const { image } = buildImage(OUT);
let dataBytes = 0;
const isCode = new Uint8Array(rom.length);
for (const [o, l] of code) isCode.fill(1, o, o + l);
for (let i = 0; i < rom.length; i++) {
  if (isCode[i]) {
    if (image[i] !== 0) throw new Error(`code byte $${i.toString(16)} present in the data image`);
  } else {
    if (image[i] !== rom[i]) throw new Error(`data byte $${i.toString(16)} differs after extraction`);
    dataBytes++;
  }
}
const codeBytes = code.reduce((s, [, l]) => s + l, 0);
console.log(`${files.size} files, ${blocks.length} blocks, ${dataBytes} data bytes (${codeBytes} code bytes left out)`);
console.log(`readable: ${Object.values(formats).filter((f) => f !== "bin").length} files (${Object.values(formats).filter((f) => f === "palette").length} palettes, ${Object.values(formats).filter((f) => f === "text").length} texts)`);
if (partial) console.log(`${partial} files only partly used by the game (unused bytes are zero)`);
if (padNonZero) console.log(`${padNonZero} padding blocks with nonzero bytes kept under pad/`);

// optional cross-check against the disassembly's own data files
if (DIS) {
  let same = 0;
  const diff: string[] = [];
  for (const [path, f] of files) {
    const p = join(DIS, "data", path);
    if (!/\.(bin|brr)$/.test(path) || !existsSync(p) || path.endsWith("_song_data.bin")) continue;
    const d = new Uint8Array(readFileSync(p));
    const n = Math.min(d.length, f.bytes.length);
    let ok = d.length === f.bytes.length;
    for (let i = 0; i < n && ok; i++) if (f.filled[i] && d[i] !== f.bytes[i]) ok = false;
    if (ok) same++;
    else diff.push(path);
  }
  console.log(`cross-check with ${DIS}/data: ${same} files identical, ${diff.length} differ${diff.length ? ": " + diff.slice(0, 5).join(" ") : ""}`);
}
