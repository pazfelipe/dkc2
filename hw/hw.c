/*
 * Hardware layer for the DKC2 remake.
 *
 * The game logic (ported to TypeScript) plays the role of the 65816 CPU. Everything
 * else that sits on the SNES bus is provided by LakeSnes (MIT): the PPU (video),
 * DMA/HDMA, the APU (SPC700 + S-DSP) and WRAM/SRAM/ROM mapping.
 *
 * Frame model (mirrors how DKC2 runs entirely inside its NMI handler):
 *   1. hw_run_to_vblank()  -> renders scanlines 1..224 (with HDMA) and stops at the start of VBlank
 *   2. TypeScript runs the NMI handler: DMA uploads + game logic, through hw_write8/hw_read8
 *   3. repeat
 */
#include <stdint.h>
#include <stdbool.h>
#include <stdlib.h>
#include "lakesnes/snes.h"
#include "lakesnes/ppu.h"
#include "lakesnes/dma.h"
#include "lakesnes/apu.h"
#include "lakesnes/dsp.h"
#include "lakesnes/cart.h"
#include "lakesnes/input.h"

#define EXPORT __attribute__((visibility("default")))

static Snes* snes;
static uint8_t frame_tmp[512 * 480 * 4];
static uint8_t frame_rgba[256 * 224 * 4];
static int16_t audio_buf[2048 * 2];

EXPORT void* hw_alloc(int n) { return malloc(n); }

EXPORT void hw_init(void) {
  snes = snes_init();
  snes_reset(snes, true);
  snes_setPixelFormat(snes, pixelFormatXRGB);
}

EXPORT int hw_load_rom(uint8_t* data, int len) {
  bool ok = snes_loadRom(snes, data, len);
  snes_reset(snes, true);
  return ok;
}

EXPORT uint8_t* hw_wram(void) { return snes->ram; }
EXPORT uint8_t* hw_sram(void) { return snes->cart->ram; }
EXPORT int hw_sram_size(void) { return snes->cart->ramSize; }
EXPORT uint16_t* hw_vram(void) { return snes->ppu->vram; }
EXPORT uint16_t* hw_cgram(void) { return snes->ppu->cgram; }
EXPORT uint16_t* hw_oam(void) { return snes->ppu->oam; }
EXPORT uint8_t* hw_high_oam(void) { return snes->ppu->highOam; }
extern int ppu_hd_split;
extern uint16_t ppu_hd_bg[];
extern uint16_t ppu_hd_obj[];
EXPORT void hw_hd_split(int on) { ppu_hd_split = on; }
EXPORT uint16_t* hw_hd_bg(void) { return ppu_hd_bg; }
EXPORT uint16_t* hw_hd_obj(void) { return ppu_hd_obj; }
extern uint16_t ppu_hd_add[];
EXPORT uint16_t* hw_hd_add(void) { return ppu_hd_add; }
extern int ppu_hd_occl_on;
extern uint8_t ppu_hd_occl[];
EXPORT void hw_hd_occl_on(int on) { ppu_hd_occl_on = on; }
EXPORT uint8_t* hw_hd_occl(void) { return ppu_hd_occl; }
EXPORT int hw_brightness(void) { return snes->ppu->forcedBlank ? 0 : snes->ppu->brightness; }
EXPORT uint8_t* hw_aram(void) { return snes->apu->ram; }
EXPORT int hw_vpos(void) { return snes->vPos; }
EXPORT int hw_hpos(void) { return snes->hPos; }
EXPORT int hw_in_vblank(void) { return snes->inVblank; }

static void run_pending_dma(void) {
  /* LakeSnes starts a DMA one CPU access after the $420B write; run it right away. */
  for (int i = 0; i < 2 && snes->dma->dmaState != 0; i++) dma_handleDma(snes->dma, 6);
}

EXPORT uint8_t hw_read8(uint32_t adr) { return snes_read(snes, adr); }

EXPORT void hw_write8(uint32_t adr, uint8_t val) {
  snes_write(snes, adr, val);
  if (snes->dma->dmaState) run_pending_dma();
}

/* Let time pass, as a CPU busy loop would (keeps PPU/HDMA/APU in sync). */
EXPORT void hw_idle(int master_cycles) {
  while (master_cycles > 0) {
    dma_handleDma(snes->dma, 6);
    snes_runCycles(snes, 6);
    master_cycles -= 6;
  }
}

/* Run until the next VBlank starts (NMI point). */
EXPORT void hw_run_to_vblank(void) {
  while (snes->inVblank) hw_idle(6);
  uint32_t frame = snes->frames;
  while (!snes->inVblank && frame == snes->frames) hw_idle(6);
  /* bring the APU up to date */
  apu_runCycles(snes->apu, (int)snes->apuCatchupCycles);
  snes->apuCatchupCycles -= (int)snes->apuCatchupCycles;
}

EXPORT void hw_set_input(int player, int state) {
  Input* in = player ? snes->input2 : snes->input1;
  in->currentState = (uint16_t)state;
}

EXPORT uint8_t* hw_frame(void) {
  ppu_putPixels(snes->ppu, frame_tmp);
  for (int y = 0; y < 224; y++) {
    const uint8_t* src = frame_tmp + (y * 2 + 16) * 2048;
    uint8_t* dst = frame_rgba + y * 256 * 4;
    for (int x = 0; x < 256; x++) {
      dst[x * 4 + 0] = src[x * 8 + 4 + 2];
      dst[x * 4 + 1] = src[x * 8 + 4 + 1];
      dst[x * 4 + 2] = src[x * 8 + 4 + 0];
      dst[x * 4 + 3] = 255;
    }
  }
  return frame_rgba;
}

/* Fill stereo int16 samples (32040 Hz) for one frame. */
EXPORT int16_t* hw_audio(int samples) {
  dsp_getSamples(snes->apu->dsp, audio_buf, samples);
  return audio_buf;
}

/* Every sample the DSP produced since the last call (up to 4 s), in order. */
extern int16_t dsp_capture[];
extern uint32_t dsp_capture_w;
static uint32_t capture_r = 0;
static int16_t drain_buf[(1 << 17) * 2];
EXPORT int hw_audio_drain(void) {
  uint32_t n = dsp_capture_w - capture_r;
  if (n > (1u << 17)) { capture_r = dsp_capture_w - (1u << 17); n = 1u << 17; }
  for (uint32_t i = 0; i < n; i++) {
    uint32_t k = (capture_r + i) & ((1u << 17) - 1);
    drain_buf[i * 2] = dsp_capture[k * 2];
    drain_buf[i * 2 + 1] = dsp_capture[k * 2 + 1];
  }
  capture_r += n;
  return (int)n;
}
EXPORT int16_t* hw_audio_drain_buf(void) { return drain_buf; }

/* APU port helpers used by the CPU-side sound driver */
EXPORT uint8_t hw_apu_out(int port) {
  apu_runCycles(snes->apu, (int)snes->apuCatchupCycles);
  snes->apuCatchupCycles -= (int)snes->apuCatchupCycles;
  return snes->apu->outPorts[port & 3];
}

EXPORT int hw_save_state(uint8_t* out) { return snes_saveState(snes, out); }
EXPORT int hw_load_state(uint8_t* data, int size) { return snes_loadState(snes, data, size); }

/* ---- Reference mode: run the original game code on the emulated 65816 (test oracle) ---- */
EXPORT void hw_emu_run_frame(void) { snes_runFrame(snes); }
void snes_runToNextVblank(Snes* snes);
EXPORT void hw_emu_run_vblank(void) { snes_runToNextVblank(snes); }
EXPORT int hw_state_size(void) { return snes_saveState(snes, 0); }
EXPORT uint32_t hw_frames(void) { return snes->frames; }

/* ---- Hybrid execution: run original routines on the 65816, with traps into TypeScript ----
 *
 * hw_cpu_call(target, kind, ...) runs an original routine until it returns.
 *   kind: 0 = JSR (RTS returns), 1 = JSL (RTL returns), 2 = interrupt (RTI returns).
 *   flags: bit0 = m (8-bit A), bit1 = x (8-bit index), bit2 = carry in.
 * Result: >= 0 opcodes executed (returned / stop address / WAI), -1 timeout,
 *         -2 trap: the CPU is about to enter a routine that has a TypeScript implementation.
 *            The host runs it, then calls hw_cpu_resume() to perform its return and continue.
 * Calls nest: a TypeScript routine may itself call hw_cpu_call; the suspended CPU context
 * is saved and restored around it.
 */
#include "lakesnes/cpu.h"
#define MAXDEPTH 64
typedef struct { uint32_t ret_full; Cpu saved; int ops; int max_ops; int has_saved; } CallFrame;
static CallFrame cframes[MAXDEPTH];
static int cdepth = 0;
static uint32_t stop_addrs[16];
static int n_stop = 0;
static int wai_hit = 0;
static uint8_t trap_bits[0x400000 / 8];
static int traps_enabled = 0;
static uint32_t trap_addr = 0;
static Cpu result;           /* registers at the last return/trap */
static bool saved_nmi, saved_h, saved_v;

EXPORT int hw_cpu_wai_hit(void) { return wai_hit; }
EXPORT void hw_cpu_clear_stops(void) { n_stop = 0; }
EXPORT void hw_cpu_add_stop(uint32_t a) { if (n_stop < 16) stop_addrs[n_stop++] = a; }
EXPORT void hw_trap_set(uint32_t a, int on) {
  uint32_t o = ((a >> 16) & 0x3f) << 16 | (a & 0xffff);
  if (on) trap_bits[o >> 3] |= 1 << (o & 7); else trap_bits[o >> 3] &= ~(1 << (o & 7));
}
EXPORT void hw_traps_enable(int on) { traps_enabled = on; }
EXPORT uint32_t hw_cpu_trap_addr(void) { return trap_addr; }
EXPORT int hw_cpu_depth(void) { return cdepth; }

static inline uint8_t cpu_flags(Cpu* c) {
  return (c->c) | (c->z << 1) | (c->i << 2) | (c->d << 3) | (c->xf << 4) | (c->mf << 5) | (c->v << 6) | (c->n << 7);
}

static uint32_t pc_ring[65536];
static uint32_t pc_ring_i = 0;
EXPORT uint32_t* hw_pc_ring(void) { return pc_ring; }
EXPORT uint32_t hw_pc_ring_pos(void) { return pc_ring_i; }
static int run_loop(void) {
  Cpu* c = snes->cpu;
  CallFrame* f = &cframes[cdepth - 1];
  for (;;) {
    uint32_t pc = ((uint32_t)c->k << 16) | c->pc;
    bool done = (f->ops > 0 && pc == f->ret_full);
    for (int i = 0; i < n_stop && !done; i++) if (f->ops > 0 && stop_addrs[i] == pc) done = true;
    if (done) break;
    if (traps_enabled && f->ops > 0 && c->k >= 0x80) {
      uint32_t o = ((c->k & 0x3f) << 16) | c->pc;
      if (trap_bits[o >> 3] & (1 << (o & 7))) {
        trap_addr = pc;
        result = *c;
        return -2;
      }
    }
    if (f->ops >= f->max_ops) { result = *c; cdepth--; if (f->has_saved) *c = f->saved; return -1; }
    { static uint32_t prev = 0; if (pc < prev || pc > prev + 4) { if (!((pc >> 16) == 0 && (pc & 0xffff) < 0x8000 && (prev >> 16) == 0 && (prev & 0xffff) < 0x8000)) if (pc_ring_i < 65536) pc_ring[pc_ring_i++] = pc; } prev = pc; }
    cpu_runOpcode(c);
    f->ops++;
    if (c->waiting) { wai_hit = 1; c->waiting = false; break; }
  }
  int ops = f->ops;
  result = *c;
  cdepth--;
  if (f->has_saved) { *c = f->saved; }
  if (cdepth == 0) {
    snes->nmiEnabled = saved_nmi; snes->hIrqEnabled = saved_h; snes->vIrqEnabled = saved_v;
    c->nmiWanted = false;
  }
  return ops;
}

EXPORT int hw_cpu_call(uint32_t target, int kind, int a, int x, int y, int db, int dp, int flags, int sp, int max_ops) {
  Cpu* c = snes->cpu;
  if (cdepth >= MAXDEPTH) return -1;
  CallFrame* f = &cframes[cdepth];
  f->has_saved = cdepth > 0;
  if (f->has_saved) {
    f->saved = *c;
    /* keep the suspended routine's stack frames: continue below its stack pointer */
    sp = c->sp - 8;
  }
  if (cdepth == 0) {
    saved_nmi = snes->nmiEnabled; saved_h = snes->hIrqEnabled; saved_v = snes->vIrqEnabled;
    snes->nmiEnabled = false; snes->hIrqEnabled = false; snes->vIrqEnabled = false;
  }
  c->nmiWanted = false; c->irqWanted = false; c->intWanted = false; c->waiting = false; c->stopped = false;
  /* A power-on/reset leaves resetWanted set until the CPU's first opcode. In hybrid mode the
   * TypeScript boot() already played RESET_start, so a pending reset must not fire here: it would
   * jump to the reset vector and run the whole RESET_start again inside this call (in bank $00,
   * where nothing traps), re-uploading the sound engine to an SPC700 that has left its IPL. */
  c->resetWanted = false;
  c->e = false;
  c->mf = flags & 1; c->xf = (flags >> 1) & 1; c->c = (flags >> 2) & 1; c->i = true; c->d = false;
  c->z = (flags >> 3) & 1; c->n = (flags >> 4) & 1; c->v = (flags >> 5) & 1;
  c->a = a; c->x = c->xf ? (x & 0xff) : x; c->y = c->xf ? (y & 0xff) : y;
  c->db = db; c->dp = dp; c->sp = sp;
  uint8_t bank = target >> 16;
  uint16_t ret = 0xFFF0;
  if (kind == 2) {
    snes_write(snes, c->sp--, 0x00);
    snes_write(snes, c->sp--, (uint8_t)(ret >> 8));
    snes_write(snes, c->sp--, (uint8_t)(ret & 0xff));
    snes_write(snes, c->sp--, cpu_flags(c));
    f->ret_full = ret;
  } else {
    if (kind == 1) snes_write(snes, c->sp--, 0x00);
    snes_write(snes, c->sp--, (uint8_t)((ret - 1) >> 8));
    snes_write(snes, c->sp--, (uint8_t)((ret - 1) & 0xff));
    f->ret_full = kind == 1 ? (uint32_t)ret : ((uint32_t)bank << 16) | ret;
  }
  c->k = bank; c->pc = target & 0xffff;
  f->ops = 0; f->max_ops = max_ops;
  wai_hit = 0;
  cdepth++;
  return run_loop();
}

/* After the host ran a trapped routine: set the registers it returned and leave the routine.
 * mode: 0 = RTS, 1 = RTL, 2 = jump to `target`, 3 = end of frame (stop as if WAI). */
EXPORT int hw_cpu_resume(int mode, int a, int x, int y, int flags, uint32_t target, int db, int mx) {
  Cpu* c = snes->cpu;
  c->db = db;
  if (mx >= 0) { c->mf = mx & 1; c->xf = (mx >> 1) & 1; }
  if (c->mf) c->a = (c->a & 0xff00) | (a & 0xff); else c->a = a;
  c->x = c->xf ? (x & 0xff) : x;
  c->y = c->xf ? (y & 0xff) : y;
  c->c = flags & 1; c->z = (flags >> 1) & 1; c->n = (flags >> 2) & 1; c->v = (flags >> 3) & 1;
  if (mode == 3) {
    wai_hit = 1;
    CallFrame* f = &cframes[cdepth - 1];
    result = *c;
    cdepth--;
    if (f->has_saved) *c = f->saved;
    if (cdepth == 0) { snes->nmiEnabled = saved_nmi; snes->hIrqEnabled = saved_h; snes->vIrqEnabled = saved_v; c->nmiWanted = false; }
    return f->ops;
  }
  if (mode == 0) {
    uint8_t lo = snes_read(snes, ++c->sp); uint8_t hi = snes_read(snes, ++c->sp);
    c->pc = (uint16_t)(((hi << 8) | lo) + 1);
  } else if (mode == 1) {
    uint8_t lo = snes_read(snes, ++c->sp); uint8_t hi = snes_read(snes, ++c->sp); uint8_t bk = snes_read(snes, ++c->sp);
    c->pc = (uint16_t)(((hi << 8) | lo) + 1); c->k = bk;
  } else {
    c->k = target >> 16; c->pc = target & 0xffff;
  }
  cframes[cdepth - 1].ops++;
  return run_loop();
}

EXPORT int hw_cpu_reg(int which) {
  Cpu* c = &result;
  switch (which) {
    case 0: return c->a; case 1: return c->x; case 2: return c->y; case 3: return c->sp;
    case 4: return ((uint32_t)c->k << 16) | c->pc; case 5: return c->db; case 6: return c->dp;
    case 7: return (c->c) | (c->z << 1) | (c->n << 2) | (c->v << 3) | (c->mf << 4) | (c->xf << 5);
  }
  return 0;
}
EXPORT int hw_cpu_live_reg(int which) {
  Cpu* c = snes->cpu;
  switch (which) {
    case 0: return c->a; case 1: return c->x; case 2: return c->y; case 3: return c->sp;
    case 4: return ((uint32_t)c->k << 16) | c->pc; case 5: return c->db; case 6: return c->dp;
    case 7: return (c->c) | (c->z << 1) | (c->n << 2) | (c->v << 3) | (c->mf << 4) | (c->xf << 5);
  }
  return 0;
}

/* Run the original game until the CPU is about to execute `target` (returns 1),
 * or until max_frames frames have completed (returns 0). */
EXPORT int hw_emu_run_until(uint32_t target, int max_frames) {
  uint32_t start = snes->frames;
  for (;;) {
    uint32_t pc = ((uint32_t)snes->cpu->k << 16) | snes->cpu->pc;
    if (pc == target || ((pc ^ target) == 0x800000 && (pc & 0x8000))) return 1; // FastROM mirror
    if ((int)(snes->frames - start) >= max_frames && snes->inVblank) return 0;
    cpu_runOpcode(snes->cpu);
  }
}
EXPORT void hw_cpu_step(void) { cpu_runOpcode(snes->cpu); }

/* ---- Call tracing on the reference CPU: records every JSR/JSL/indirect JMP target with the
 * data bank and M/X flags at entry. Used to generate routine stubs with correct entry context. */
#define TRACE_MAX 65536
static uint32_t trace_buf[TRACE_MAX * 2];
static int trace_n = 0;
EXPORT uint32_t* hw_trace_buf(void) { return trace_buf; }
EXPORT int hw_trace_count(void) { return trace_n; }
EXPORT void hw_trace_reset(void) { trace_n = 0; }
/* Runs one frame like hw_emu_run_frame but logs calls.
 * entry word0 = target24 | kind<<24 (0=JSR,1=JSL,2=JMP ind,3=JML ind), word1 = db | p<<8 */
static uint8_t cov_bits[0x400000 / 8];
EXPORT uint8_t* hw_cov_bits(void) { return cov_bits; }
EXPORT void hw_emu_run_frame_traced(void) {
  Cpu* c = snes->cpu;
  int phase = 0;
  uint32_t frame = snes->frames;
  for (;;) {
    if (phase == 0) { if (!snes->inVblank) phase = 1; }
    else if (snes->inVblank || frame != snes->frames) break;
    uint32_t pc = ((uint32_t)c->k << 16) | c->pc;
    uint8_t op = (c->k >= 0x80 || c->k < 0x40) && c->pc >= 0x8000 ? snes->cart->rom[((c->k & 0x3f) << 16 | c->pc) & (snes->cart->romSize - 1)] : (c->k >= 0xc0 ? snes->cart->rom[((c->k & 0x3f) << 16 | c->pc) & (snes->cart->romSize - 1)] : 0);
    if (c->k >= 0x80) { uint32_t o = ((c->k & 0x3f) << 16) | c->pc; cov_bits[o >> 3] |= 1 << (o & 7); }
    int kind = -1;
    if (op == 0x20 || op == 0xFC) kind = 0;
    else if (op == 0x22) kind = 1;
    else if (op == 0x7C || op == 0x6C) kind = 2;
    else if (op == 0xDC || op == 0x5C) kind = 3;
    cpu_runOpcode(c);
    if (kind >= 0 && trace_n < TRACE_MAX) {
      uint32_t t = ((uint32_t)c->k << 16) | c->pc;
      uint8_t p = (c->c) | (c->z << 1) | (c->i << 2) | (c->d << 3) | (c->xf << 4) | (c->mf << 5) | (c->v << 6) | (c->n << 7);
      trace_buf[trace_n * 2] = t | ((uint32_t)kind << 24);
      trace_buf[trace_n * 2 + 1] = c->db | ((uint32_t)p << 8) | ((uint32_t)c->dp << 16);
      trace_n++;
    }
    (void)pc;
  }
}

extern int snes_cpu_overclock;
EXPORT void hw_set_overclock(int shift) { snes_cpu_overclock = shift; }

extern uint32_t snes_vblank_count;
EXPORT uint32_t hw_vblank_count(void) { return snes_vblank_count; }

extern uint32_t snes_watch_addr;
extern uint32_t snes_watch_hits[64];
extern int snes_watch_n;
EXPORT void hw_watch(uint32_t a) { snes_watch_addr = a; snes_watch_n = 0; }
EXPORT int hw_watch_n(void) { return snes_watch_n; }
EXPORT uint32_t* hw_watch_hits(void) { return snes_watch_hits; }
/* Re-latch the auto-joypad result as if a VBlank auto-read happened with this pad state. */
EXPORT void hw_force_autojoy(int p1, int p2) {
  snes->input1->currentState = (uint16_t)p1;
  snes->input2->currentState = (uint16_t)p2;
  uint16_t a = 0, b = 0, c2 = 0, d = 0;
  for (int i = 0; i < 16; i++) {
    a |= ((p1 >> i) & 1) << (15 - i);
    b |= ((p2 >> i) & 1) << (15 - i);
  }
  snes->portAutoRead[0] = a; snes->portAutoRead[1] = b; snes->portAutoRead[2] = c2; snes->portAutoRead[3] = d;
}

extern double snes_apu_speed;
/* Test helper: make the sound CPU run `factor` times faster than real time. */
EXPORT void hw_set_apu_speed(double factor) { snes_apu_speed = factor; }
EXPORT void hw_cpu_set_live_reg(int which, int v) {
  Cpu* c = snes->cpu;
  switch (which) { case 0: c->a = v; break; case 1: c->x = v; break; case 2: c->y = v; break; case 5: c->db = v; break; }
}
