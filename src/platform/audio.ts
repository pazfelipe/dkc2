/**
 * Audio output: the S-DSP produces stereo 16-bit samples at 32040 Hz. We hand them to an
 * AudioWorklet ring buffer running at the same rate (the browser resamples to the device).
 */
const WORKLET = `
class RingPlayer extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(32040 * 2);
    this.r = 0; this.w = 0; this.n = 0;
    this.port.onmessage = (e) => {
      const s = e.data;
      for (let i = 0; i < s.length; i++) {
        if (this.n >= this.buf.length) { this.r = (this.r + 1) % this.buf.length; this.n--; }
        this.buf[this.w] = s[i]; this.w = (this.w + 1) % this.buf.length; this.n++;
      }
    };
  }
  process(_in, outputs) {
    const l = outputs[0][0], r = outputs[0][1];
    for (let i = 0; i < l.length; i++) {
      if (this.n >= 2) {
        l[i] = this.buf[this.r]; r[i] = this.buf[(this.r + 1) % this.buf.length];
        this.r = (this.r + 2) % this.buf.length; this.n -= 2;
      } else { l[i] = 0; r[i] = 0; }
    }
    this.port.postMessage(this.n >> 1);
    return true;
  }
}
registerProcessor("ring-player", RingPlayer);
`;

export class AudioOut {
  ctx: AudioContext | null = null;
  node: AudioWorkletNode | null = null;
  /** frames buffered in the worklet (stereo sample pairs) */
  buffered = 0;

  async start() {
    if (this.ctx) return;
    let ctx: AudioContext;
    try {
      ctx = new AudioContext({ sampleRate: 32040 });
    } catch {
      ctx = new AudioContext();
    }
    const url = URL.createObjectURL(new Blob([WORKLET], { type: "application/javascript" }));
    await ctx.audioWorklet.addModule(url);
    const node = new AudioWorkletNode(ctx, "ring-player", { outputChannelCount: [2] });
    node.port.onmessage = (e) => (this.buffered = e.data);
    node.connect(ctx.destination);
    this.ctx = ctx;
    this.node = node;
  }

  /**
   * Samples in emulated-time order, waiting to be played. A frame that spans several VBlanks
   * (loading between screens) produces many frames' worth of sound at once; the queue plays it out
   * in real time while the following frames "pass" (see machine.ts lag frames).
   */
  private queue: Float32Array[] = [];
  private queued = 0;

  enqueue(samples: Int16Array) {
    if (!this.node || !samples.length) return;
    const f = new Float32Array(samples.length);
    for (let i = 0; i < samples.length; i++) f[i] = samples[i] / 32768;
    this.queue.push(f);
    this.queued += f.length >> 1;
    // never let the backlog exceed ~1 s (e.g. the tab was in the background)
    while (this.queued > 32040 && this.queue.length > 1) this.queued -= this.queue.shift()!.length >> 1;
  }

  /** Keep ~150 ms buffered in the worklet (covers the longest loading frames). */
  pump() {
    if (!this.node) return;
    let room = 4800 - this.buffered;
    while (room > 0 && this.queue.length) {
      const f = this.queue.shift()!;
      this.queued -= f.length >> 1;
      room -= f.length >> 1;
      this.buffered += f.length >> 1;
      this.node.port.postMessage(f, [f.buffer]);
    }
  }
}
