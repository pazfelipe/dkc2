/**
 * Loads the game's data for the browser: public/dkc2-data.pak (packed from assets/ by
 * tools/pack_assets.ts, gzip) -> the 4 MiB cartridge data image (code bytes zero).
 */
import { unpackImage } from "./assetformats";

export async function loadDataImage(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`${url}: ${res.status} ${res.statusText}`);
  const inflated = res.body.pipeThrough(new DecompressionStream("gzip"));
  return unpackImage(new Uint8Array(await new Response(inflated).arrayBuffer()));
}
