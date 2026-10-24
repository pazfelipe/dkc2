/**
 * Input scripts for tests: "R*60,B+R*10,_*30" = hold Right 60 frames, B+Right 10 frames, nothing 30 frames.
 * The script loops when it ends.
 */
import { PAD } from "../../src/platform/hw.ts";

export function parseInput(script: string): (frame: number) => number {
  if (!script) return () => 0;
  const steps: [number, number][] = [];
  for (const part of script.split(",")) {
    const [btns, n] = part.split("*");
    let mask = 0;
    for (const b of btns.split("+")) {
      if (b === "_" || !b) continue;
      const key = ({ R: "RIGHT", L: "LEFT", U: "UP", D: "DOWN", S: "START", SEL: "SELECT" } as Record<string, string>)[b] ?? b;
      mask |= (PAD as Record<string, number>)[key];
    }
    steps.push([mask, parseInt(n ?? "1")]);
  }
  const total = steps.reduce((a, s) => a + s[1], 0);
  return (frame: number) => {
    let f = frame % total;
    for (const [m, n] of steps) {
      if (f < n) return m;
      f -= n;
    }
    return 0;
  };
}
