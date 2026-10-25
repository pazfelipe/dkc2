// Off-thread xBRZ upscaling, so a large image never stalls the game loop (or its audio).
// @ts-ignore no types shipped
import { xbrzScale, xbrzColorFormat, xbrzConfig } from "xbrz-js";
const cfg = xbrzConfig({});
self.onmessage = (e: MessageEvent<{ id: number; src: Uint32Array; w: number; h: number; scale: number }>) => {
  const { id, src, w, h, scale } = e.data;
  const dst = new Uint32Array(w * h * scale * scale);
  xbrzScale(scale, src, dst, w, h, xbrzColorFormat.argb, cfg);
  (self as unknown as Worker).postMessage({ id, dst }, [dst.buffer]);
};
