/** Keyboard and gamepad mapping to the SNES pad bits. */
import { PAD } from "./hw";

const KEYS: Record<string, number> = {
  ArrowRight: PAD.RIGHT,
  ArrowLeft: PAD.LEFT,
  ArrowUp: PAD.UP,
  ArrowDown: PAD.DOWN,
  KeyZ: PAD.B, // jump
  KeyX: PAD.A, // team-up / animal special
  KeyA: PAD.Y, // run / roll / pick up
  KeyS: PAD.X,
  KeyQ: PAD.L,
  KeyW: PAD.R,
  Enter: PAD.START,
  ShiftRight: PAD.SELECT, // swap Kongs
  ShiftLeft: PAD.SELECT,
};

const held = new Set<string>();
export function attachKeyboard(target: Window) {
  target.addEventListener("keydown", (e) => {
    if (KEYS[e.code] !== undefined) {
      held.add(e.code);
      e.preventDefault();
    }
  });
  target.addEventListener("keyup", (e) => {
    held.delete(e.code);
  });
  target.addEventListener("blur", () => held.clear());
}

// Standard gamepad mapping (https://w3c.github.io/gamepad/#remapping)
const GP: [number, number][] = [
  [0, PAD.B],
  [1, PAD.A],
  [2, PAD.Y],
  [3, PAD.X],
  [4, PAD.L],
  [5, PAD.R],
  [8, PAD.SELECT],
  [9, PAD.START],
  [12, PAD.UP],
  [13, PAD.DOWN],
  [14, PAD.LEFT],
  [15, PAD.RIGHT],
];

export function readPad(): number {
  let m = 0;
  for (const k of held) m |= KEYS[k] ?? 0;
  const pads = navigator.getGamepads?.() ?? [];
  for (const gp of pads) {
    if (!gp) continue;
    for (const [i, bit] of GP) if (gp.buttons[i]?.pressed) m |= bit;
    const [ax, ay] = gp.axes;
    if (ax < -0.5) m |= PAD.LEFT;
    if (ax > 0.5) m |= PAD.RIGHT;
    if (ay < -0.5) m |= PAD.UP;
    if (ay > 0.5) m |= PAD.DOWN;
    break;
  }
  // a real pad cannot press opposite directions
  if ((m & PAD.LEFT) && (m & PAD.RIGHT)) m &= ~(PAD.LEFT | PAD.RIGHT);
  if ((m & PAD.UP) && (m & PAD.DOWN)) m &= ~(PAD.UP | PAD.DOWN);
  return m;
}
