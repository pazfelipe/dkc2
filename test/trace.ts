/**
 * Trace the ORIGINAL game's routine calls and record entry context per routine.
 *
 *   npx tsx test/trace.ts <state> <frames> [--input script] [--out file]
 *
 * Merges into test/states/trace.json: { "<addr hex>": { n, kinds:{}, db:{}, p:{}, dp:{} } }
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { makeMachine, STATES_DIR, labelAt } from "./lib/oracle.ts";
import { parseInput } from "./lib/input.ts";

const [stateName, framesStr, ...rest] = process.argv.slice(2);
const opt = (n: string, d?: string) => {
  const i = rest.indexOf(n);
  return i >= 0 ? rest[i + 1] : d;
};
const out = opt("--out", `${STATES_DIR}/trace.json`)!;
const { hw } = await makeMachine();
const ex = hw.ex as any;
hw.loadState(new Uint8Array(readFileSync(`${STATES_DIR}/${stateName}.state`)));
const input = parseInput(opt("--input", "")!);

type Ent = { n: number; kinds: Record<string, number>; db: Record<string, number>; p: Record<string, number>; dp: Record<string, number> };
const agg: Record<string, Ent> = existsSync(out) ? JSON.parse(readFileSync(out, "utf8")) : {};
const frames = parseInt(framesStr);
const invincible = rest.includes("--invincible");
for (let f = 0; f < frames; f++) {
  hw.setInput(0, input(f));
  if (invincible) {
    // keep both Kongs invincible (kong_control.invincible_timer) so a dumb bot can cross the level
    hw.wram[0x16b2 + 0x16] = 0xff; hw.wram[0x16b2 + 0x17] = 0x00;
    hw.wram[0x16d8 + 0x16] = 0xff; hw.wram[0x16d8 + 0x17] = 0x00;
  }
  ex.hw_trace_reset();
  ex.hw_emu_run_frame_traced();
  const n = ex.hw_trace_count();
  const buf = new Uint32Array(hw.ex.memory.buffer, ex.hw_trace_buf(), n * 2);
  for (let i = 0; i < n; i++) {
    const w0 = buf[i * 2];
    const w1 = buf[i * 2 + 1];
    const target = w0 & 0xffffff;
    const kind = ["jsr", "jsl", "jmp", "jml"][w0 >>> 24];
    const db = w1 & 0xff;
    const p = (w1 >> 8) & 0xff;
    const dp = w1 >>> 16;
    const key = target.toString(16).toUpperCase();
    const e = (agg[key] ??= { n: 0, kinds: {}, db: {}, p: {}, dp: {} });
    e.n++;
    e.kinds[kind] = (e.kinds[kind] ?? 0) + 1;
    e.db[db.toString(16)] = (e.db[db.toString(16)] ?? 0) + 1;
    const mx = ((p >> 5) & 1 ? "m8" : "m16") + "," + ((p >> 4) & 1 ? "x8" : "x16");
    e.p[mx] = (e.p[mx] ?? 0) + 1;
    e.dp[dp.toString(16)] = (e.dp[dp.toString(16)] ?? 0) + 1;
  }
}
writeFileSync(out, JSON.stringify(agg));
// merge coverage bitmap
const covPath = `${STATES_DIR}/coverage.bin`;
const cov = new Uint8Array(hw.ex.memory.buffer, ex.hw_cov_bits(), 0x80000);
if (existsSync(covPath)) {
  const old = readFileSync(covPath);
  for (let i = 0; i < cov.length; i++) cov[i] |= old[i];
}
writeFileSync(covPath, cov);
const named = Object.keys(agg).filter((k) => labelAt(parseInt(k, 16))).length;
console.log(`routines seen: ${Object.keys(agg).length} (${named} at labels)`);
