/**
 * Browser entry point: asks for the user's ROM (kept locally in IndexedDB), boots the
 * hardware layer, then runs the game at the SNES frame rate.
 */
import { Hardware } from "./platform/hw";
import { AudioOut } from "./platform/audio";
import { attachKeyboard, readPad } from "./platform/input";
import { loadStoredRom, storeRom, sha256, normalizeRom, EXPECTED_SHA256, loadBlob, storeBlob } from "./platform/romstore";
import { bindMachine } from "./core/mem";
import { boot, frame } from "./game/machine";
import { fallbackStats } from "./core/hybrid";
import { portedNames } from "./core/cpu";
import { labelAt } from "./core/sym";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>("screen");
const ctx2d = canvas.getContext("2d")!;
const image = ctx2d.createImageData(256, 224);
const audio = new AudioOut();
const NTSC_FPS = 60.0988;

async function start(rom: Uint8Array) {
  $("picker").hidden = true;
  $("game").hidden = false;
  const wasm = await (await fetch(`${import.meta.env.BASE_URL}hw.wasm`)).arrayBuffer();
  const hw = await Hardware.create(wasm, rom);
  hw.saveState();
  hw.refreshViews();
  bindMachine(hw, rom);
  // battery-backed save RAM (the game saves at Kong Kollege)
  const sram = await loadBlob("sram");
  if (sram && sram.length === hw.sram().length) hw.sram().set(sram);
  let lastSram = hw.sram().slice();
  boot();
  attachKeyboard(window);
  const toast = (msg: string) => {
    const t = $("toast");
    t.textContent = msg;
    t.hidden = false;
    clearTimeout((t as any)._h);
    (t as any)._h = setTimeout(() => (t.hidden = true), 1500);
  };
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
  });
  const unlock = () => audio.start();
  window.addEventListener("keydown", unlock, { once: true });
  window.addEventListener("pointerdown", unlock, { once: true });

  const tick = (now: number) => {
    acc += Math.min(now - last, 100);
    last = now;
    const step = 1000 / NTSC_FPS;
    let ran = 0;
    while (acc >= step && ran < 3) {
      acc -= step;
      if (!paused) {
        frame(readPad());
        if (audio.buffered < 4000) audio.push(hw.audio(534).slice());
        frames++;
      }
      ran++;
    }
    if (ran) {
      image.data.set(hw.frameRGBA());
      ctx2d.putImageData(image, 0, 0);
    }
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

async function acceptFile(file: File) {
  const rom = normalizeRom(new Uint8Array(await file.arrayBuffer()));
  const h = await sha256(rom);
  if (h !== EXPECTED_SHA256) {
    $("rom-msg").textContent =
      "This file is not Donkey Kong Country 2 (USA, Rev 1). The port reads data by address, so it needs that exact version.";
    return;
  }
  await storeRom(rom);
  start(rom);
}

async function init() {
  const input = $<HTMLInputElement>("rom-file");
  input.addEventListener("change", () => input.files?.[0] && acceptFile(input.files[0]));
  const drop = $("picker");
  drop.addEventListener("dragover", (e) => e.preventDefault());
  drop.addEventListener("drop", (e) => {
    e.preventDefault();
    const f = e.dataTransfer?.files?.[0];
    if (f) acceptFile(f);
  });
  const stored = await loadStoredRom();
  if (stored && (await sha256(stored)) === EXPECTED_SHA256) start(stored);
}

init();
