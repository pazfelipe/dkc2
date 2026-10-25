// Check that the HD overlay lines up with the OAM chunks the game actually drew for Diddy.
import { readFileSync } from "node:fs";
import { makeMachine, STATES_DIR } from "./lib/oracle.ts";
import { bindMachine } from "../src/core/mem.ts";
import { boot, frame, frameHooks } from "../src/game/machine.ts";
import { snapshotDiddy, decodeFrame, placement, type HdSnapshot } from "../src/platform/hdsprites.ts";
const [st = "lvl_pirate", n = "120", pad = "256"] = process.argv.slice(2);
const { hw } = await makeMachine();
hw.loadState(new Uint8Array(readFileSync(`${STATES_DIR}/${st}.state`)));
let pending: HdSnapshot | null = null;
let bad = 0, ok = 0, miss = 0;
frameHooks.preNmi = () => (pending = snapshotDiddy());
frameHooks.preRender = () => {
  if (!pending) return;
  const f = decodeFrame(pending.gid)!;
  const p = placement(pending, f);
  const base = pending.prop & 0x1ff, pal = (pending.prop >> 9) & 7;
  const oam = hw.oam();
  const high = hw.mem && new Uint8Array(hw.mem, (hw.ex as any).hw_high_oam(), 32);
  const got: string[] = [];
  for (let i = 0; i < 128; i++) {
    const w0 = oam[i * 2], w1 = oam[i * 2 + 1];
    if (((w1 >> 9) & 7) !== pal) continue;
    const rel = ((w1 & 0x1ff) - base) & 0x1ff;
    if (rel >= 0x40) continue;
    let x = (w0 & 0xff) | (((high[i >> 2] >> ((i & 3) * 2)) & 1) << 8);
    if (x >= 256) x -= 512;
    let y = w0 >> 8;
    if (y >= 0xe0) y -= 256;
    got.push(`${rel.toString(16)}@${x},${y}`);
  }
  // expected chunk screen positions
  const sx = ((pending.x - pending.scrollX) << 16) >> 16, sy = ((pending.y - pending.scrollY) << 16) >> 16;
  const exp = f.chunks.map(([rx, ry, s, t]) => `${t.toString(16)}@${p.hflip ? sx - rx - s - 1 : sx + rx - 1},${p.vflip ? sy - ry - s + 1 : sy + ry}`);
  const match = exp.every((e) => got.includes(e)) && p.left === (p.hflip ? sx - (f.ox + f.w) - 1 : sx + f.ox - 1);
  if (!got.length) miss++;
  else if (match) ok++;
  else {
    bad++;
    if (bad <= 6) console.log(`gid=${pending.gid.toString(16)} flip=${+p.hflip}${+p.vflip}\n  exp ${exp.join(" ")}\n  got ${got.join(" ")}`);
  }
};
for (let i = 0; i < +n; i++) frame(i % 90 < 60 ? +pad : 0x80 | +pad);
console.log(`${st}: aligned ${ok}, misaligned ${bad}, not drawn ${miss}`);
