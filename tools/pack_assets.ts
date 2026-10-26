/**
 * Pack assets/ into public/dkc2-data.pak, the single file the browser fetches at boot.
 *
 *   npx tsx tools/pack_assets.ts [--assets assets] [--out public/dkc2-data.pak]
 *
 * assets/ (one file per data block, see tools/extract_assets.ts) stays the source of truth: edit
 * a file there, re-run this, reload. The pack holds every block's decoded bytes and where they go
 * (format in src/platform/assetformats.ts), gzip-compressed (the browser inflates it with
 * DecompressionStream). It has no code bytes: the 65816 code is not in assets/.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { gzipSync } from "node:zlib";
import { packImage, unpackImage } from "../src/platform/assetformats.ts";
import { ASSETS_DIR, readManifest, readAssetFiles, imageBlocks, buildImage } from "./lib/assets.ts";

const args = process.argv.slice(2);
const opt = (n: string, d: string) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : d;
};
const dir = opt("--assets", ASSETS_DIR);
const out = opt("--out", new URL("../public/dkc2-data.pak", import.meta.url).pathname);

const manifest = readManifest(dir);
const blocks = imageBlocks(manifest, readAssetFiles(manifest, dir));
// merge blocks that touch, so the pack index stays small
const merged: { off: number; bytes: Uint8Array }[] = [];
for (const b of blocks.sort((a, b) => a.off - b.off)) {
  const last = merged[merged.length - 1];
  if (last && last.off + last.bytes.length === b.off) {
    const n = new Uint8Array(last.bytes.length + b.bytes.length);
    n.set(last.bytes);
    n.set(b.bytes, last.bytes.length);
    last.bytes = n;
  } else merged.push({ off: b.off, bytes: b.bytes });
}
const pak = packImage(manifest.rom.size, merged);
// the pack must rebuild exactly the image the asset files describe
const a = unpackImage(pak);
const { image } = buildImage(dir);
if (a.length !== image.length || a.some((v, i) => v !== image[i])) throw new Error("pack does not match assets/");
const gz = gzipSync(pak, { level: 9 });
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, gz);
console.log(`${out}: ${merged.length} ranges, ${pak.length} bytes (${gz.length} gzipped)`);
