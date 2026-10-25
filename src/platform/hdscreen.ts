/**
 * HD title screen (optional enhancement, not part of the original game).
 *
 * The title screen is one 256-color background (BG1 on the main screen) plus the chest twinkles,
 * which are sprites on the SUB screen added on top by color math (that is why they glow instead of
 * covering the art). The PPU glue gives us both pieces separately (hw_hd_split): the background
 * without sprites and the sprite pixels, each before brightness. The background is upscaled 4x
 * with xBRZ (only when it changes; on the title it is static) and the twinkles are drawn at the
 * original resolution with additive blending, exactly like the console mixes them.
 */
import { hw, r16 } from "../core/mem";
import { L } from "../core/sym";
import { HD_SCALE } from "./hdsprites";

interface SplitEx {
  hw_hd_split(on: number): void;
  hw_hd_bg(): number;
  hw_hd_obj(): number;
}
const ex = () => hw.ex as unknown as SplitEx;
const W = 256, H = 224;

const NMI_POINTER = 0x0020;
/** Screens whose background gets the HD treatment: static backgrounds only, since upscaling is costly. */
const HD_SCREENS = new Set(["run_title_screen", "run_file_select", "run_game_mode_select"].map((n) => L(n) & 0xffff));

export function hdScreenActive(): boolean {
  return HD_SCREENS.has(r16(NMI_POINTER));
}

/** Ask the PPU for the split output while rendering the coming frame. */
export function setSplit(on: boolean) {
  ex().hw_hd_split(on ? 1 : 0);
}

const c8 = (v: number) => (v << 3) | (v >> 2);
const rgba = (v: number) => (0xff << 24) | (c8((v >> 10) & 31) << 16) | (c8((v >> 5) & 31) << 8) | c8(v & 31);

function canvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

const opaque = canvas(W, H), additive = canvas(W, H);
const opaqueImg = new ImageData(W, H), addImg = new ImageData(W, H);

// upscaled backgrounds by content hash (menus flip between a few states: cursor, highlights)
const cache = new Map<number, ImageBitmap>();
const pending = new Set<number>();
let worker: Worker | null = null;
let nextId = 0;
const idHash = new Map<number, number>();

function request(hash: number, bg: Uint16Array) {
  if (pending.has(hash)) return;
  if (!worker) {
    worker = new Worker(new URL("./xbrz.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = async (e: MessageEvent<{ id: number; dst: Uint32Array }>) => {
      const h = idHash.get(e.data.id)!;
      idHash.delete(e.data.id);
      pending.delete(h);
      const img = new ImageData(new Uint8ClampedArray(e.data.dst.buffer as ArrayBuffer), W * HD_SCALE, H * HD_SCALE);
      cache.set(h, await createImageBitmap(img));
      if (cache.size > 16) {
        const [k, v] = cache.entries().next().value!;
        v.close();
        cache.delete(k);
      }
    };
  }
  const src = new Uint32Array(W * H);
  for (let i = 0; i < src.length; i++) src[i] = rgba(bg[i]) >>> 0;
  const id = nextId++;
  idHash.set(id, hash);
  pending.add(hash);
  worker.postMessage({ id, src, w: W, h: H, scale: HD_SCALE }, [src.buffer]);
}

/**
 * Draw the split frame onto a 4x context. Returns false when the upscaled background is not ready
 * yet (first time a screen state is seen); the caller then draws the normal frame.
 */
export function drawHdScreen(ctx: CanvasRenderingContext2D, brightness: number): boolean {
  const bg = new Uint16Array(hw.mem, ex().hw_hd_bg(), W * H);
  const obj = new Uint16Array(hw.mem, ex().hw_hd_obj(), W * H);
  let h = 2166136261;
  for (let i = 0; i < bg.length; i++) h = Math.imul(h ^ bg[i], 16777619);
  const bgImg = cache.get(h);
  if (!bgImg) {
    request(h, bg);
    return false;
  }
  cache.delete(h); // keep recently used entries at the end
  cache.set(h, bgImg);
  const o32 = new Uint32Array(opaqueImg.data.buffer), a32 = new Uint32Array(addImg.data.buffer);
  let anyO = false, anyA = false;
  for (let i = 0; i < obj.length; i++) {
    const v = obj[i];
    o32[i] = v & 0x8000 ? rgba(v) : 0;
    a32[i] = v & 0x4000 ? rgba(v) : 0;
    anyO ||= (v & 0x8000) !== 0;
    anyA ||= (v & 0x4000) !== 0;
  }
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  if (brightness < 15) ctx.filter = `brightness(${brightness / 15})`;
  ctx.drawImage(bgImg, 0, 0);
  if (anyO) {
    opaque.getContext("2d")!.putImageData(opaqueImg, 0, 0);
    ctx.drawImage(opaque, 0, 0, W * HD_SCALE, H * HD_SCALE);
  }
  if (anyA) {
    additive.getContext("2d")!.putImageData(addImg, 0, 0);
    ctx.globalCompositeOperation = "lighter";
    ctx.drawImage(additive, 0, 0, W * HD_SCALE, H * HD_SCALE);
  }
  ctx.restore();
  return true;
}
