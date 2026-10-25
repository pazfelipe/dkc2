/**
 * HD sprites (optional enhancement, not part of the original game).
 *
 * The game draws Diddy as a "compound graphic": a header + chunk positions + 4bpp tiles in ROM,
 * selected by the sprite's current graphic id (see ARCHITECTURE.md §4). Here we decode that same
 * frame straight from the ROM, upscale it 4x with xBRZ, and draw it over a 4x-scaled screen,
 * after removing Diddy's original OAM chunks so the low-res version does not show through.
 *
 * Nothing is precomputed or shipped: frames are built from the user's ROM on first use and cached.
 */
// @ts-ignore no types shipped
import { xbrzScale, xbrzColorFormat, xbrzConfig } from "xbrz-js";
import { rom8, rom24, r16, hw } from "../core/mem";
import { L } from "../core/sym";

export const HD_SCALE = 4;

const SPRITE_GRAPHIC_TABLE = L("sprite_graphic_table");
const SPRITE_TABLE_START = 0x0d84;
const SPRITE_TABLE_END = 0x16b2;
const ACTIVE_KONG_NUMBER = 0x08a4; // 0 = Diddy leads
const ACTIVE_KONG_SPRITE = 0x0593;
const INACTIVE_KONG_SPRITE = 0x0597;

interface Frame {
  /** palette indices, w*h */
  idx: Uint8Array;
  w: number;
  h: number;
  /** offset of the image's top-left from the sprite origin (unflipped) */
  ox: number;
  oy: number;
  /** VRAM tile numbers (relative to the sprite's base) of every 8x8 the game puts in OAM */
  tiles: Set<number>;
  /** [relx, rely, size, tile] as laid out by render_sprites */
  chunks: [number, number, number, number][];
}

const frameCache = new Map<number, Frame | null>();

function decodeTile(addr: number, out: Uint8Array, ow: number, x0: number, y0: number) {
  for (let y = 0; y < 8; y++) {
    const p0 = rom8(addr + y * 2), p1 = rom8(addr + y * 2 + 1), p2 = rom8(addr + 16 + y * 2), p3 = rom8(addr + 17 + y * 2);
    for (let x = 0; x < 8; x++) {
      const s = 7 - x;
      const v = ((p0 >> s) & 1) | (((p1 >> s) & 1) << 1) | (((p2 >> s) & 1) << 2) | (((p3 >> s) & 1) << 3);
      if (v) out[(y0 + y) * ow + x0 + x] = v;
    }
  }
}

/** Decode a compound graphic exactly like render_sprites lays it out ($B5A22F). */
export function decodeFrame(gid: number): Frame | null {
  if (frameCache.has(gid)) return frameCache.get(gid)!;
  const a = rom24(SPRITE_GRAPHIC_TABLE + gid);
  if (!a) {
    frameCache.set(gid, null);
    return null;
  }
  const n16 = rom8(a), n8a = rom8(a + 1), sa = rom8(a + 2), n8b = rom8(a + 3), sb = rom8(a + 4);
  const d1n = rom8(a + 5), d2off = rom8(a + 6), d2n = rom8(a + 7) & 0x0f;
  const npos = n16 + n8a + n8b;
  const data = a + 8 + npos * 2;
  // VRAM-like tile slots: DMA 1 at slot 0, DMA 2 at slot d2off
  const tileAddr = (slot: number): number | null => {
    if (slot < d1n) return data + slot * 32;
    if (slot >= d2off && slot < d2off + d2n) return data + (d1n + slot - d2off) * 32;
    return null;
  };
  const chunks: [number, number, number, number][] = []; // relx, rely, size, tile
  let k = 0;
  let t = 0;
  for (let i = 0; i < n16; i++, k++) {
    chunks.push([rom8(a + 8 + k * 2) - 0x80, rom8(a + 9 + k * 2) - 0x80, 16, t]);
    t += 2;
    if (t & 0x10) t += 16;
  }
  for (let i = 0; i < n8a; i++, k++) chunks.push([rom8(a + 8 + k * 2) - 0x80, rom8(a + 9 + k * 2) - 0x80, 8, sa + i]);
  for (let i = 0; i < n8b; i++, k++) chunks.push([rom8(a + 8 + k * 2) - 0x80, rom8(a + 9 + k * 2) - 0x80, 8, sb + i]);
  if (!chunks.length) {
    frameCache.set(gid, null);
    return null;
  }
  let minx = 1e9, miny = 1e9, maxx = -1e9, maxy = -1e9;
  for (const [x, y, s] of chunks) {
    minx = Math.min(minx, x);
    miny = Math.min(miny, y);
    maxx = Math.max(maxx, x + s);
    maxy = Math.max(maxy, y + s);
  }
  // one pixel of transparent margin so the upscaler can smooth the outline
  const w = maxx - minx + 2, h = maxy - miny + 2;
  const idx = new Uint8Array(w * h);
  const tiles = new Set<number>();
  for (const [x, y, s, tile] of chunks) {
    tiles.add(tile);
    const parts = s === 16 ? [[0, 0, tile], [8, 0, tile + 1], [0, 8, tile + 16], [8, 8, tile + 17]] : [[0, 0, tile]];
    for (const [px, py, tt] of parts) {
      const ta = tileAddr(tt);
      if (ta !== null) decodeTile(ta, idx, w, x - minx + 1 + px, y - miny + 1 + py);
    }
  }
  const f = { idx, w, h, ox: minx - 1, oy: miny - 1, tiles, chunks };
  frameCache.set(gid, f);
  return f;
}

const hdCache = new Map<string, HTMLCanvasElement | OffscreenCanvas>();
const cfg = xbrzConfig({});

function bgr555(v: number): number {
  const r = v & 31, g = (v >> 5) & 31, b = (v >> 10) & 31;
  // little-endian RGBA byte order in a Uint32: 0xAABBGGRR
  return (0xff << 24) | (((b << 3) | (b >> 2)) << 16) | (((g << 3) | (g >> 2)) << 8) | ((r << 3) | (r >> 2));
}

function hdImage(gid: number, cgram: Uint16Array, pal: number) {
  const f = decodeFrame(gid);
  if (!f) return null;
  const colors: number[] = [];
  for (let i = 0; i < 16; i++) colors.push(cgram[128 + pal * 16 + i]);
  const key = `${gid}:${colors.join(",")}`;
  let c = hdCache.get(key);
  if (c) return { canvas: c, f };
  const src = new Uint32Array(f.w * f.h);
  for (let i = 0; i < src.length; i++) src[i] = f.idx[i] ? bgr555(colors[f.idx[i]]) >>> 0 : 0;
  const S = HD_SCALE;
  const dst = new Uint32Array(f.w * S * f.h * S);
  xbrzScale(S, src, dst, f.w, f.h, xbrzColorFormat.argb, cfg);
  c = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(f.w * S, f.h * S) : Object.assign(document.createElement("canvas"), { width: f.w * S, height: f.h * S });
  const ctx = (c as OffscreenCanvas).getContext("2d") as OffscreenCanvasRenderingContext2D;
  ctx.putImageData(new ImageData(new Uint8ClampedArray(dst.buffer), f.w * S, f.h * S), 0, 0);
  if (hdCache.size > 2000) hdCache.clear();
  hdCache.set(key, c);
  return { canvas: c, f };
}

/** What Diddy looked like when the OAM now being displayed was built (taken before the NMI). */
export interface HdSnapshot {
  x: number;
  y: number;
  gid: number;
  prop: number;
  scrollX: number;
  scrollY: number;
}

function snapshotSlot(slot: number): HdSnapshot | null {
  if (slot < SPRITE_TABLE_START || slot >= SPRITE_TABLE_END || r16(slot) === 0) return null;
  return {
    x: r16(slot + 0x06),
    y: r16(slot + 0x0a),
    gid: r16(slot + 0x1a), // current_graphic: what render_sprites put in OAM
    prop: r16(slot + 0x12),
    scrollX: r16(0x17ba),
    scrollY: r16(0x17c0),
  };
}

/** Diddy only (kept for the alignment test). */
export function snapshotDiddy(): HdSnapshot | null {
  return snapshotSlot(r16(r16(ACTIVE_KONG_NUMBER) === 0 ? ACTIVE_KONG_SPRITE : INACTIVE_KONG_SPRITE));
}

/** Both Kongs (Diddy and Dixie), whichever is leading. */
export function snapshotKongs(): HdSnapshot[] {
  const out: HdSnapshot[] = [];
  for (const p of [ACTIVE_KONG_SPRITE, INACTIVE_KONG_SPRITE]) {
    const s = snapshotSlot(r16(p));
    if (s) out.push(s);
  }
  return out;
}

/**
 * Remove Diddy's chunks from the OAM the PPU is about to draw: entries with one of his frame's
 * tiles (relative to his VRAM base), his palette, and a position inside his frame's box.
 * Returns true if any were found (i.e. the game actually drew Diddy this frame).
 */
export function hideDiddyOam(s: HdSnapshot, dryRun = false): number {
  return hideKongOam(s, dryRun).prio;
}

/**
 * Same for any Kong. Returns his OBJ priority (-1 if he is not on screen) and his first OAM index
 * (lower index = drawn in front when two sprites overlap).
 */
export function hideKongOam(s: HdSnapshot, dryRun = false): { prio: number; order: number } {
  const f = decodeFrame(s.gid);
  if (!f) return { prio: -1, order: 128 };
  const base = s.prop & 0x1ff;
  const pal = (s.prop >> 9) & 7;
  const box = placement(s, f);
  const oam = hw.oam(); // 128 entries x 2 words: [y<<8|x], [attr<<8|tile]
  const high = new Uint8Array(hw.mem, (hw.ex as unknown as { hw_high_oam(): number }).hw_high_oam(), 32);
  let prio = -1;
  let order = 128;
  for (let i = 0; i < 128; i++) {
    const w0 = oam[i * 2], w1 = oam[i * 2 + 1];
    if (((w1 >> 9) & 7) !== pal) continue;
    if (!f.tiles.has(((w1 & 0x1ff) - base) & 0x1ff)) continue;
    const xhi = (high[i >> 2] >> ((i & 3) * 2)) & 1;
    let x = (w0 & 0xff) | (xhi << 8);
    if (x >= 256) x -= 512;
    let y = w0 >> 8;
    if (y >= 0xe0) y -= 256;
    if (x < box.left - 8 || x > box.left + f.w + 8 || y < box.top - 8 || y > box.top + f.h + 8) continue;
    if (!dryRun) oam[i * 2] = (w0 & 0x00ff) | (0xf0 << 8);
    prio = (w1 >> 12) & 3;
    order = Math.min(order, i);
  }
  return { prio, order };
}

/**
 * Ask the PPU to record, while drawing the frame, where something in front of each OBJ priority
 * (foreground tiles, higher-priority sprites) is opaque.
 */
export function setOcclusion(on: boolean) {
  (hw.ex as unknown as { hw_hd_occl_on(v: number): void }).hw_hd_occl_on(on ? 1 : 0);
}

let occlImg: ImageData, occlCanvas: HTMLCanvasElement, layer: HTMLCanvasElement;
function ensureLayers() {
  if (layer) return;
  occlImg = new ImageData(256, 224);
  occlCanvas = Object.assign(document.createElement("canvas"), { width: 256, height: 224 });
  layer = Object.assign(document.createElement("canvas"), { width: 256 * HD_SCALE, height: 224 * HD_SCALE });
}

export function placement(s: HdSnapshot, f: Frame) {
  const hflip = (s.prop & 0x4000) !== 0, vflip = (s.prop & 0x8000) !== 0;
  const sx = ((s.x - s.scrollX) << 16) >> 16, sy = ((s.y - s.scrollY) << 16) >> 16;
  // flipping mirrors the graphic around the sprite origin (render_sprites' flipped paths)
  // (measured against the game's OAM: chunks land 1 pixel left of x - scroll, 2 when flipped)
  const left = hflip ? sx - (f.ox + f.w) - 1 : sx + f.ox - 1;
  const top = vflip ? sy - (f.oy + f.h) + 1 : sy + f.oy;
  return { left, top, hflip, vflip };
}

/** Draw the HD Diddy onto a context already holding the 4x-scaled frame. */
export function drawDiddyHd(ctx: CanvasRenderingContext2D, s: HdSnapshot, brightness: number, alpha = 1, prio = -1) {
  const pal = (s.prop >> 9) & 7;
  const img = hdImage(s.gid, hw.cgram(), pal);
  if (!img) return;
  const { canvas, f } = img;
  const S = HD_SCALE;
  const { left, top, hflip, vflip } = placement(s, f);
  ensureLayers();
  // draw him on a layer, cut out what the PPU reported as being in front of him, then composite
  const lc = layer.getContext("2d")!;
  lc.clearRect(0, 0, layer.width, layer.height);
  lc.save();
  lc.translate(left * S + (hflip ? f.w * S : 0), top * S + (vflip ? f.h * S : 0));
  lc.scale(hflip ? -1 : 1, vflip ? -1 : 1);
  lc.drawImage(canvas as CanvasImageSource, 0, 0);
  lc.restore();
  const occl = new Uint8Array(hw.mem, (hw.ex as unknown as { hw_hd_occl(): number }).hw_hd_occl(), 256 * 224);
  const m32 = new Uint32Array(occlImg.data.buffer);
  let any = false;
  const bit = prio >= 0 ? 1 << prio : 0;
  for (let i = 0; i < occl.length; i++) {
    const o = occl[i] & bit;
    m32[i] = o ? 0xff000000 : 0;
    any ||= o !== 0;
  }
  if (any) {
    occlCanvas.getContext("2d")!.putImageData(occlImg, 0, 0);
    lc.save();
    lc.imageSmoothingEnabled = false;
    lc.globalCompositeOperation = "destination-out";
    lc.drawImage(occlCanvas, 0, 0, layer.width, layer.height);
    lc.restore();
  }
  ctx.save();
  ctx.globalAlpha = alpha;
  if (brightness < 15) ctx.filter = `brightness(${brightness / 15})`;
  ctx.drawImage(layer, 0, 0);
  ctx.restore();
}
