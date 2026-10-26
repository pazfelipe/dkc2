/**
 * Node-side access to assets/ (the extracted game data): read the manifest and build the
 * cartridge data image (code bytes zero) from the individual asset files.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { decodeAsset, type AssetManifest } from "../../src/platform/assetformats.ts";

export const ASSETS_DIR = process.env.DKC2_ASSETS ?? new URL("../../assets/", import.meta.url).pathname;

export function readManifest(dir = ASSETS_DIR): AssetManifest {
  return JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
}

/** Decoded contents of every asset file (path -> bytes). */
export function readAssetFiles(m: AssetManifest, dir = ASSETS_DIR): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  for (const [path, fmt] of Object.entries(m.files)) out.set(path, decodeAsset(fmt, new Uint8Array(readFileSync(join(dir, path)))));
  return out;
}

/** The blocks with their bytes, in ROM order. */
export function imageBlocks(m: AssetManifest, files: Map<string, Uint8Array>): { off: number; bytes: Uint8Array }[] {
  return m.blocks.map(([off, len, file, at]) => {
    const f = files.get(file);
    if (!f) throw new Error(`asset file missing: ${file}`);
    if (at + len > f.length) throw new Error(`asset file too short: ${file} (needs ${at + len} bytes, has ${f.length})`);
    return { off, bytes: f.subarray(at, at + len) };
  });
}

/** The 4 MiB data image: every data block at its cartridge offset, zero everywhere else. */
export function buildImage(dir = ASSETS_DIR): { image: Uint8Array; manifest: AssetManifest } {
  const manifest = readManifest(dir);
  const image = new Uint8Array(manifest.rom.size);
  for (const b of imageBlocks(manifest, readAssetFiles(manifest, dir))) image.set(b.bytes, b.off);
  return { image, manifest };
}

/** One byte per ROM byte: 1 where the original had code. */
export function codeMap(m: AssetManifest): Uint8Array {
  const map = new Uint8Array(m.rom.size);
  for (const [off, len] of m.code) map.fill(1, off, off + len);
  return map;
}
