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
// @ts-ignore no types shipped
import { xbrzScale, xbrzColorFormat, xbrzConfig } from "xbrz-js";
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

const RUN_TITLE_SCREEN = L("run_title_screen") & 0xffff;
const NMI_POINTER = 0x0020;

/** Screens whose background gets the HD treatment (static backgrounds only: upscaling is costly). */
export function hdScreenActive(): boolean {
  return r16(NMI_POINTER) === RUN_TITLE_SCREEN;
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

let bgHash = -1;
const bgCanvas = canvas(W * HD_SCALE, H * HD_SCALE);
const opaque = canvas(W, H), additive = canvas(W, H);
const opaqueImg = new ImageData(W, H), addImg = new ImageData(W, H);
const cfg = xbrzConfig({});

/** Draw the split frame onto a 4x context. */
export function drawHdScreen(ctx: CanvasRenderingContext2D, brightness: number) {
  const bg = new Uint16Array(hw.mem, ex().hw_hd_bg(), W * H);
  const obj = new Uint16Array(hw.mem, ex().hw_hd_obj(), W * H);
  let h = 2166136261;
  for (let i = 0; i < bg.length; i++) h = Math.imul(h ^ bg[i], 16777619);
  if (h !== bgHash) {
    bgHash = h;
    const src = new Uint32Array(W * H);
    for (let i = 0; i < src.length; i++) src[i] = rgba(bg[i]) >>> 0;
    const dst = new Uint32Array(W * H * HD_SCALE * HD_SCALE);
    xbrzScale(HD_SCALE, src, dst, W, H, xbrzColorFormat.argb, cfg);
    bgCanvas.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(dst.buffer), W * HD_SCALE, H * HD_SCALE), 0, 0);
  }
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
  ctx.drawImage(bgCanvas, 0, 0);
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
}
