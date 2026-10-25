/**
 * Hardware layer: LakeSnes PPU/DMA/APU compiled to WebAssembly (see hw/hw.c).
 *
 * The ported game logic acts as the CPU: it reads/writes WRAM through `wram` and talks to
 * the PPU/DMA/APU through memory-mapped registers with `w8`/`r8` (same addresses as the
 * original code: $2100-$21FF, $4200-$43FF).
 */
export interface HwExports {
  memory: WebAssembly.Memory;
  hw_init(): void;
  hw_alloc(n: number): number;
  hw_load_rom(ptr: number, len: number): number;
  hw_wram(): number;
  hw_sram(): number;
  hw_sram_size(): number;
  hw_vram(): number;
  hw_cgram(): number;
  hw_oam(): number;
  hw_high_oam(): number;
  hw_brightness(): number;
  hw_audio_drain(): number;
  hw_audio_drain_buf(): number;
  hw_aram(): number;
  hw_vpos(): number;
  hw_hpos(): number;
  hw_in_vblank(): number;
  hw_read8(adr: number): number;
  hw_write8(adr: number, val: number): void;
  hw_idle(cycles: number): void;
  hw_run_to_vblank(): void;
  hw_set_input(player: number, state: number): void;
  hw_frame(): number;
  hw_audio(samples: number): number;
  hw_apu_out(port: number): number;
  hw_save_state(ptr: number): number;
  hw_load_state(ptr: number, size: number): number;
  hw_emu_run_frame(): void;
  hw_state_size(): number;
  hw_frames(): number;
  hw_vblank_count(): number;
}

export class Hardware {
  ex: HwExports;
  wram!: Uint8Array;
  private stateBuf = 0;
  private stateSize = 0;

  private constructor(ex: HwExports) {
    this.ex = ex;
  }

  static async create(wasmBytes: ArrayBuffer | Uint8Array, rom: Uint8Array): Promise<Hardware> {
    const mod = await WebAssembly.compile(wasmBytes as BufferSource);
    const instance = await WebAssembly.instantiate(mod, {});
    const hw = new Hardware(instance.exports as unknown as HwExports);
    hw.ex.hw_init();
    const p = hw.ex.hw_alloc(rom.length);
    new Uint8Array(hw.ex.memory.buffer, p, rom.length).set(rom);
    if (!hw.ex.hw_load_rom(p, rom.length)) throw new Error("ROM rejected by hardware layer");
    hw.refreshViews();
    return hw;
  }

  /** Called whenever views are re-created (memory growth), so other modules can re-bind. */
  onViews: (() => void) | null = null;

  /** Re-create typed array views (the wasm memory buffer can be replaced when it grows). */
  refreshViews() {
    this.wram = new Uint8Array(this.ex.memory.buffer, this.ex.hw_wram(), 0x20000);
    this.onViews?.();
  }
  private checkViews() {
    if (this.wram.byteLength === 0) this.refreshViews();
  }

  get mem() {
    return this.ex.memory.buffer;
  }
  vram(): Uint16Array {
    return new Uint16Array(this.mem, this.ex.hw_vram(), 0x8000);
  }
  cgram(): Uint16Array {
    return new Uint16Array(this.mem, this.ex.hw_cgram(), 0x100);
  }
  oam(): Uint16Array {
    return new Uint16Array(this.mem, this.ex.hw_oam(), 0x100);
  }
  aram(): Uint8Array {
    return new Uint8Array(this.mem, this.ex.hw_aram(), 0x10000);
  }
  sram(): Uint8Array {
    return new Uint8Array(this.mem, this.ex.hw_sram(), this.ex.hw_sram_size());
  }

  /** Write a byte to a bus address (MMIO registers, WRAM, SRAM). Writing $420B starts DMA. */
  w8(adr: number, v: number) {
    this.ex.hw_write8(adr, v & 0xff);
  }
  /** 16-bit register write as the 65816 does it (low byte, then high byte). */
  w16(adr: number, v: number) {
    this.ex.hw_write8(adr, v & 0xff);
    this.ex.hw_write8(adr + 1, (v >> 8) & 0xff);
  }
  r8(adr: number): number {
    return this.ex.hw_read8(adr);
  }
  r16(adr: number): number {
    return this.ex.hw_read8(adr) | (this.ex.hw_read8(adr + 1) << 8);
  }

  runToVblank() {
    this.ex.hw_run_to_vblank();
  }
  idle(cycles: number) {
    this.ex.hw_idle(cycles);
  }
  setInput(player: number, buttons: number) {
    this.ex.hw_set_input(player, buttons);
  }
  /** Every sample produced since the last call (stereo, interleaved). */
  drainAudio(): Int16Array {
    const n = this.ex.hw_audio_drain();
    return new Int16Array(this.mem, this.ex.hw_audio_drain_buf(), n * 2).slice();
  }
  frameRGBA(): Uint8ClampedArray {
    return new Uint8ClampedArray(this.mem, this.ex.hw_frame(), 256 * 224 * 4);
  }
  audio(samples: number): Int16Array {
    return new Int16Array(this.mem, this.ex.hw_audio(samples), samples * 2);
  }

  /** Full machine snapshot (used by the differential tester). */
  saveState(): Uint8Array {
    const n = this.ex.hw_state_size();
    if (n > this.stateSize) {
      this.stateBuf = this.ex.hw_alloc(n);
      this.stateSize = n;
      this.refreshViews();
    }
    this.ex.hw_save_state(this.stateBuf);
    this.checkViews();
    return new Uint8Array(this.mem, this.stateBuf, n).slice();
  }
  loadState(s: Uint8Array) {
    if (s.length > this.stateSize) {
      this.stateBuf = this.ex.hw_alloc(s.length);
      this.stateSize = s.length;
      this.refreshViews();
    }
    new Uint8Array(this.mem, this.stateBuf, s.length).set(s);
    if (!this.ex.hw_load_state(this.stateBuf, s.length)) throw new Error("bad state");
    this.checkViews();
  }

  /** Reference mode: run one frame of the ORIGINAL game code on the emulated 65816. */
  emuRunFrame() {
    this.ex.hw_emu_run_frame();
  }
}

/** Joypad bit layout used by hw_set_input (serial order of the SNES pad). */
export const PAD = {
  B: 1 << 0,
  Y: 1 << 1,
  SELECT: 1 << 2,
  START: 1 << 3,
  UP: 1 << 4,
  DOWN: 1 << 5,
  LEFT: 1 << 6,
  RIGHT: 1 << 7,
  A: 1 << 8,
  X: 1 << 9,
  L: 1 << 10,
  R: 1 << 11,
} as const;
