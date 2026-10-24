// Produce base machine states by playing the ORIGINAL game on the reference emulator.
import { writeFileSync, mkdirSync } from "node:fs";
import { makeMachine, STATES_DIR } from "./lib/oracle.ts";
import { PAD } from "../src/platform/hw.ts";
import { savePng } from "./png.ts";
import { r16 } from "../src/core/mem.ts";

const { hw } = await makeMachine();
mkdirSync("out/states", { recursive: true });
let frame = 0;
function run(n: number, pad = 0) {
  for (let i = 0; i < n; i++) {
    hw.setInput(0, pad);
    hw.emuRunFrame();
    frame++;
  }
}
function save(name: string) {
  writeFileSync(`${STATES_DIR}/${name}.state`, hw.saveState());
  savePng(`out/states/${name}.png`, hw.frameRGBA(), 256, 224);
  console.log(name, "frame", frame, "level", r16(0xd3).toString(16), "mode", r16(0x24).toString(16));
}
function until(cond: () => boolean, pad: number, max = 3000) {
  for (let i = 0; i < max && !cond(); i++) run(1, i % 30 < 3 ? pad : 0);
}
run(720); save("title");
run(4, PAD.START); run(200); save("file_select");
run(4, PAD.START); run(200); save("player_select");
run(4, PAD.START); run(400); save("world_map");
// keep pressing START until Diddy (sprite type $00E4) exists in slot 1 and the screen is lit
until(() => r16(0x0de2) === 0xe4 && (r16(0x0de2 + 0x0a) > 0), PAD.START);
run(90); save("pirate_start");
run(120, PAD.RIGHT); save("pirate_walk");
run(60, PAD.RIGHT | PAD.Y); save("pirate_run");
run(20, PAD.RIGHT | PAD.B); run(40, PAD.RIGHT); save("pirate_jump");
