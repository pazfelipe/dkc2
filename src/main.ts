/**
 * Browser entry point: loads the game's data (dkc2-data.pak, packed from assets/; no ROM),
 * boots the hardware layer, then runs the game at the SNES frame rate.
 */
import { Hardware } from "./platform/hw";
import { AudioOut } from "./platform/audio";
import { attachKeyboard, readPad } from "./platform/input";
import { loadBlob, storeBlob, deleteBlob } from "./platform/savestore";
import { loadDataImage } from "./platform/datapack";
import { bindMachine } from "./core/mem";
import { boot, frame, frameHooks } from "./game/machine";
import { hdScreenActive, setSplit, drawHdScreen, hdAll } from "./platform/hdscreen";
import { HD_SCALE, snapshotKongs, hideKongOam, drawDiddyHd, setOcclusion, type HdSnapshot } from "./platform/hdsprites";
import { fallbackStats, setFallbackEnabled } from "./core/hybrid";
import { portedNames } from "./core/cpu";
import { labelAt } from "./core/sym";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>("screen");
const ctx2d = canvas.getContext("2d")!;
// the SNES frame is composed at 256x224, then scaled 4x so HD sprites can be drawn on top
const base = Object.assign(document.createElement("canvas"), { width: 256, height: 224 });
const baseCtx = base.getContext("2d")!;
const image = baseCtx.createImageData(256, 224);
const audio = new AudioOut();
const NTSC_FPS = 60.0988;

async function start() {
  const url = import.meta.env.BASE_URL;
  const [wasm, cart] = await Promise.all([fetch(`${url}hw.wasm`).then((r) => r.arrayBuffer()), loadDataImage(`${url}dkc2-data.pak`)]);
  $("loading").hidden = true;
  $("game").hidden = false;
  // the cartridge holds only the game's data: the 65816 code is the TypeScript port
  const hw = await Hardware.create(wasm, cart);
  hw.saveState();
  hw.refreshViews();
  bindMachine(hw, cart);
  // there is no original code to fall back to
  setFallbackEnabled(false);
  deleteBlob("rom"); // a ROM stored by older versions of this page
  // battery-backed save RAM (the game saves at Kong Kollege)
  const sram = await loadBlob("sram");
  if (sram && sram.length === hw.sram().length) hw.sram().set(sram);
  let lastSram = hw.sram().slice();
  boot();
  if (import.meta.env.DEV) (window as any).__dkc2 = { hw, hd: (v: boolean) => (hdOnRef.v = v), ghost: (v: boolean) => (ghost.v = v), all: (v: boolean) => (hdAll.v = v) };
  attachKeyboard(window);
  // HD Kongs: remember what they looked like when the OAM being displayed was built, take their
  // original chunks out of that OAM, and draw the upscaled frames in their place
  const hdOnRef = { v: true };
  const ghost = { v: false }; // dev: keep the original sprite and draw HD half-transparent on top
  let pending: HdSnapshot[] = [];
  let shown: { s: HdSnapshot; prio: number; order: number }[] = [];
  frameHooks.preNmi = () => {
    pending = hdOnRef.v ? snapshotKongs() : [];
  };
  let screenHd = false;
  frameHooks.preRender = () => {
    screenHd = hdOnRef.v && hdScreenActive();
    setSplit(screenHd);
    shown = pending
      .map((s) => ({ s, ...hideKongOam(s, ghost.v) }))
      .filter((k) => k.prio >= 0)
      .sort((a, b) => b.order - a.order); // back to front, like the OAM order
    setOcclusion(shown.length > 0 && !ghost.v);
  };
  const toast = (msg: string) => {
    const t = $("toast");
    t.textContent = msg;
    t.hidden = false;
    clearTimeout((t as any)._h);
    (t as any)._h = setTimeout(() => (t.hidden = true), 1500);
  };
  window.addEventListener("gamepadconnected", (e) => toast(`Controller: ${(e as GamepadEvent).gamepad.id.slice(0, 40)}`));
  window.addEventListener("keydown", async (e) => {
    if (e.code === "F2") {
      e.preventDefault();
      await storeBlob("quicksave", hw.saveState());
      toast("State saved");
    }
    if (e.code === "F4") {
      e.preventDefault();
      const s = await loadBlob("quicksave");
      if (s) {
        hw.loadState(s);
        toast("State loaded");
      }
    }
  });
  setInterval(() => {
    const now = hw.sram();
    for (let i = 0; i < now.length; i++)
      if (now[i] !== lastSram[i]) {
        lastSram = now.slice();
        storeBlob("sram", lastSram);
        break;
      }
  }, 2000);

  let acc = 0;
  let last = performance.now();
  let paused = false;
  let frames = 0;
  let fpsT = last;
  let fps = 0;
  const debug = $("debug");
  window.addEventListener("keydown", (e) => {
    if (e.code === "Backquote") debug.hidden = !debug.hidden;
    if (e.code === "KeyP") paused = !paused;
    if (e.code === "KeyH") {
      hdOnRef.v = !hdOnRef.v;
      toast(hdOnRef.v ? "HD on" : "HD off (original graphics)");
    }
  });
  const unlock = () => audio.start();
  window.addEventListener("keydown", unlock, { once: true });
  window.addEventListener("pointerdown", unlock, { once: true });

  const present = () => {
    image.data.set(hw.frameRGBA());
    baseCtx.putImageData(image, 0, 0);
    ctx2d.imageSmoothingEnabled = false;
    if (!screenHd || !drawHdScreen(ctx2d, hw.ex.hw_brightness())) ctx2d.drawImage(base, 0, 0, 256 * HD_SCALE, 224 * HD_SCALE);
    for (const k of shown) drawDiddyHd(ctx2d, k.s, hw.ex.hw_brightness(), ghost.v ? 0.5 : 1, ghost.v ? -1 : k.prio);
  };
  if (import.meta.env.DEV)
    Object.assign((window as any).__dkc2, {
      pause: (v: boolean) => (paused = v),
      step: (n: number, pad = 0) => {
        for (let i = 0; i < n; i++) frame(pad);
        present();
      },
    });
  const tick = (now: number) => {
    acc += Math.min(now - last, 100);
    last = now;
    const step = 1000 / NTSC_FPS;
    let ran = 0;
    while (acc >= step && ran < 3) {
      acc -= step;
      if (!paused) {
        frame(readPad());
        audio.enqueue(hw.drainAudio());
        frames++;
      }
      ran++;
    }
    audio.pump();
    if (ran) present();
    if (now - fpsT > 1000) {
      fps = (frames * 1000) / (now - fpsT);
      frames = 0;
      fpsT = now;
      if (!debug.hidden) {
        const top = [...fallbackStats.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
        debug.textContent =
          `fps ${fps.toFixed(1)}\nported routines: ${portedNames().length}\n` +
          `original routines still running (calls/s):\n` +
          top.map(([a, n]) => `  ${labelAt(a) ?? a.toString(16)}: ${n}`).join("\n");
        fallbackStats.clear();
      }
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

start().catch((e) => {
  $("loading").textContent = `Could not start: ${(e as Error).message}. Build the game data with "npm run assets" (see README).`;
});
