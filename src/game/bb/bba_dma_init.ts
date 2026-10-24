/**
 * Bank $BB (part a) — level HDMA setup ("dma init" routines, selected by level[0].dma_init_number).
 *
 * Each routine builds HDMA tables in WRAM ($7E8012+, $7E80E2+, $7E8832+...), programs the HDMA
 * channels and stores the channel mask in `pending_dma_hdma_channels` (low byte: DMA channel 0
 * for OAM, high byte: HDMA channels enabled by the NMI). Some also spawn the level's effect
 * controller sprite (wind, water bubbles).
 */
import { w16, io8, io16 } from "../../core/mem";
import { reg, register } from "../../core/cpu";
import { L, R, C, level, HDMA } from "../../core/sym";
import { r16 } from "../../core/mem";
import {
  set_default_sprite_dma_buffer_size,
  spawn_BB83EF_special_sprite_index,
  spawn_no_gfx_special_sprite_address,
  init_level_water_height,
} from "../../gen/routines";

/** Program HDMA channel `ch` (8-bit A writes as in the original; indirect = null leaves $43x7 alone). */
function hdma(ch: number, settings: number, source: number, bank: number, indirect: number | null) {
  const base = ch * 0x10;
  io16(HDMA.settings + base, settings);
  io16(HDMA.source + base, source);
  io8(HDMA.source_bank + base, bank);
  if (indirect !== null) io8(HDMA.indirect_source_bank + base, indirect);
}
const lbl = (name: string) => L(name);
const enable = (mask: number) => {
  reg.a = mask;
  w16(R.pending_dma_hdma_channels, mask);
};
/** 16-bit store to bank $7E (the HDMA tables overlap: write order matters). */
const st = (addr: number, v: number) => w16(0x7e0000 | addr, v);

/** $BB9A93 */
export function dma_init_08() {
  w16(R.sprite_dma_buffer_limit, 0x0024);
  st(0x8012, 0x0060);
  st(0x8014, 0x0001);
  st(0x8016, 0x0000);
  hdma(2, 0x2600, 0x8012, 0x7e, 0);
  enable(0x0401);
}

/** $BB9ACA */
export function dma_init_03() {
  set_default_sprite_dma_buffer_size();
  reg.a = r16(R.level_number);
  if (reg.a === C.level_kudgels_kontest) w16(R.sprite_dma_buffer_limit, 0x001c);
  CODE_BB9AD9();
}

/** $BB9AD9 */
export function CODE_BB9AD9() {
  st(0x8012, 0x0040);
  st(0x8015, 0x0060);
  st(0x8016, 0x0060);
  st(0x8018, 0x0001);
  st(0x801b, 0x0000);
  hdma(1, 0x0e02, 0x8012, 0x7e, 0);
  enable(0x0201);
}

/** $BB9B18 — horizontal wind levels. */
export function dma_init_14() {
  set_default_sprite_dma_buffer_size();
  reg.x = 0;
  CODE_BB9B1E();
}

/** $BB9B1E — X = table offset: fill 3-byte entries ($10 lines, value 0) up to $66. */
export function CODE_BB9B1E() {
  let x = reg.x & 0xffff;
  do {
    st(0x8012 + x, 0x0010);
    st(0x8013 + x, 0x0000);
    x = (x + 3) & 0xffff;
  } while (x !== 0x0066);
  reg.x = x;
  hdma(1, 0x0d02, 0x8012, 0x7e, 0);
  enable(0x0201);
  reg.a = r16(level.type);
  if (reg.a === C.bonus_level_type) return CODE_BB9B62();
  reg.y = C.special_sprite_spawn_id_00D0;
  spawn_BB83EF_special_sprite_index(); // horizontal wind controller
}

/** $BB9B62 */
export function CODE_BB9B62() {
  reg.a = r16(R.level_number);
  if (reg.a === C.level_gusty_glade_bonus_2) return CODE_BB9B71();
  reg.y = C.special_sprite_spawn_id_007A;
  spawn_BB83EF_special_sprite_index();
}

/** $BB9B71 */
export function CODE_BB9B71() {
  reg.y = C.special_sprite_spawn_id_0136;
  spawn_BB83EF_special_sprite_index();
}

/** $BB9B79 — Red Hot Ride and lava levels: heat wave / color gradient tables. */
export function dma_init_09() {
  reg.a = 0x0002;
  reg.y = r16(R.level_number);
  if (reg.y !== C.level_red_hot_ride) reg.a = 0x0044;
  CODE_BB9B86();
}

/** Tables shared by dma_init_09 and dma_init_0A (channels 1-4). */
function lavaTables(colorA: number, colorB: number) {
  st(0x8012, 0x0040);
  st(0x8022, 0x0040);
  st(0x8032, 0x0040);
  for (const a of [0x8017, 0x801c, 0x8027, 0x802c, 0x8035, 0x8038]) st(a, 0x0001);
  st(0x8033, 0x6779);
  st(0x8036, 0x6779);
  st(0x8039, 0x7967);
  for (const a of [0x8013, 0x8015, 0x8018, 0x801a, 0x801d, 0x801f, 0x8021, 0x8023, 0x8025, 0x8028, 0x802a, 0x802d, 0x802f, 0x8031, 0x803b]) {
    st(a, 0x0000);
  }
  st(0x803c, colorA);
  st(0x803e, colorA);
  st(0x8040, colorB);
  st(0x8042, 0x0000);
}

/** $BB9B86 — A = value for $0959. */
export function CODE_BB9B86() {
  w16(0x0959, reg.a);
  w16(R.sprite_dma_buffer_limit, 0x001c);
  lavaTables(0x4301, 0x4201);
  st(0x8043, 0x0040);
  st(0x8045, 0x0401);
  st(0x8047, 0x0000);
  hdma(1, 0x0d03, 0x8012, 0x7e, 0);
  hdma(2, 0x0f03, 0x8022, 0x7e, 0);
  hdma(3, 0x0701, 0x8032, 0x7e, 0);
  hdma(4, 0x3100, 0x803c, 0x7e, 0);
  hdma(5, 0x2d00, 0x8043, 0x7e, 0);
  const table = lbl("DATA_BB9CBC");
  hdma(6, 0x1142, table & 0xffff, (table >> 16) & 0xff, 0x7e);
  enable(0x7e01);
}

/** $BB9D1D */
export function dma_init_0A() {
  set_default_sprite_dma_buffer_size();
  lavaTables(0x8701, 0x8601);
  hdma(1, 0x0d03, 0x8012, 0x7e, 0);
  hdma(2, 0x0f03, 0x8022, 0x7e, 0);
  hdma(3, 0x0701, 0x8032, 0x7e, 0);
  hdma(4, 0x3100, 0x803c, 0x7e, 0);
  enable(0x1e01);
}

/** $BB9E0F — vertical wind levels. */
export function dma_init_18() {
  set_default_sprite_dma_buffer_size();
  reg.x = 0;
  reg.a = 0x0010;
  CODE_BB9E18();
}

/** $BB9E18 — X = offset, A = value: fill 3-byte entries up to $2D. */
export function CODE_BB9E18() {
  let x = reg.x & 0xffff;
  do {
    st(0x8012 + x, reg.a);
    x = (x + 3) & 0xffff;
  } while (x !== 0x002d);
  reg.x = x;
  hdma(1, 0x1102, 0x8012, 0x7e, 0);
  enable(0x0201);
  reg.a = r16(R.level_number);
  if (reg.a === C.level_windy_well_bonus_1) return CODE_BB9E51();
  reg.y = C.special_sprite_spawn_id_00DA;
  spawn_BB83EF_special_sprite_index(); // vertical wind changer
}

/** $BB9E51 */
export function CODE_BB9E51() {
  reg.y = C.special_sprite_spawn_id_0120;
  spawn_BB83EF_special_sprite_index();
}

/** $BB9E59 */
export function dma_init_07() {
  set_default_sprite_dma_buffer_size();
  st(0x8012, 0x0000);
  enable(0x0001);
}

/** $BB9E6A — no HDMA. */
export function dma_init_00() {
  set_default_sprite_dma_buffer_size();
  enable(0x0001);
}

/** $BB9E74 */
export function dma_init_0B() {
  w16(R.sprite_dma_buffer_limit, 0x0004);
  enable(0x0001);
}

/** Water level tables shared by dma_init_0E and dma_init_06 ($7E80E2 window, $7E886C/$7E8012 lines). */
function waterTables() {
  st(0x80e2, 0x007f);
  st(0x80e3, 0x0007);
  st(0x80e4, 0x0008);
  st(0x80e5, 0x0007);
  st(0x80e6, 0x0030);
  st(0x80e7, 0x0005);
  st(0x80e8, 0x0001);
  st(0x80e9, 0x0004);
  st(0x80ea, 0x0000);
  st(0x886c, 0x0040);
  st(0x886d, 0x00b6);
  st(0x886f, 0x0040);
  st(0x8870, 0x00b6);
  reg.x = 0;
  waterSurfaceLoop();
  st(0x8012, 0x0040);
  st(0x8013, 0x80d2);
  st(0x8015, 0x0040);
  st(0x8016, 0x80d2);
  reg.x = 0;
  waterLinesLoop();
}

/** CODE_BB9EE1 / CODE_BBA477 body: X = offset. */
function waterSurfaceLoop() {
  let x = reg.x & 0xffff;
  do {
    st(0x8872 + x, 0x0004);
    st(0x8873 + x, 0x00b6);
    st(0x8875 + x, 0x0004);
    st(0x8876 + x, 0x00ba);
    st(0x8878 + x, 0x0004);
    st(0x8879 + x, 0x00be);
    st(0x887b + x, 0x0004);
    st(0x887c + x, 0x00c2);
    x = (x + 0x0c) & 0xffff;
  } while (x !== 0x00a8);
  st(0x8872 + x, 0x0000);
  reg.x = x;
}

/** CODE_BB9F4A / CODE_BBA4E0 body: X = offset. */
function waterLinesLoop() {
  let x = reg.x & 0xffff;
  do {
    st(0x8018 + x, 0x0008);
    st(0x8019 + x, 0x80d2);
    st(0x801b + x, 0x0008);
    st(0x801c + x, 0x80d6);
    st(0x801e + x, 0x0008);
    st(0x801f + x, 0x80da);
    st(0x8021 + x, 0x0008);
    st(0x8022 + x, 0x80de);
    x = (x + 0x0c) & 0xffff;
  } while (x !== 0x00a8);
  st(0x8018 + x, 0x0000);
  reg.x = x;
}

function waterChannels() {
  hdma(6, 0x2c00, 0x80e2, 0x7e, 0x7e);
  hdma(2, 0x0d43, 0x886c, 0x7e, 0x7e);
  hdma(3, 0x0f43, 0x8012, 0x7e, 0x7e);
  hdma(4, 0x1142, 0x884b, 0x7e, 0x7e);
  hdma(7, 0x1202, 0x8832, 0x7e, 0);
}

/** $BB9E80 — water levels. */
export function dma_init_0E() {
  set_default_sprite_dma_buffer_size();
  waterTables();
  waterChannels();
  reg.y = lbl("DATA_FF0FD2") & 0xffff;
  spawn_no_gfx_special_sprite_address(); // water bubbles
  init_level_water_height();
  enable(0xdc01);
}

/** $BB9EE1 — (loop entry of dma_init_0E) X = offset; continues with the rest of dma_init_0E. */
export function CODE_BB9EE1() {
  waterSurfaceLoop();
  st(0x8012, 0x0040);
  st(0x8013, 0x80d2);
  st(0x8015, 0x0040);
  st(0x8016, 0x80d2);
  reg.x = 0;
  CODE_BB9F4A();
}

/** $BB9F4A — (loop entry of dma_init_0E) X = offset. */
export function CODE_BB9F4A() {
  waterLinesLoop();
  waterChannels();
  reg.y = lbl("DATA_FF0FD2") & 0xffff;
  spawn_no_gfx_special_sprite_address();
  init_level_water_height();
  enable(0xdc01);
}

/** $BBA00D */
export function dma_init_0D() {
  set_default_sprite_dma_buffer_size();
  const table = lbl("DATA_BBA07E");
  hdma(1, 0x1142, table & 0xffff, (table >> 16) & 0xff, 0x7e);
  enable(0x0201);
}

/** $BBA031 */
export function dma_init_0F() {
  set_default_sprite_dma_buffer_size();
  w16(R.sprite_dma_buffer_limit, 0x0024);
  reg.y = 0;
  reg.x = 0;
  CODE_BBA03D();
}

/** $BBA03D — X = table offset, Y = rotating line offset (0-$1E). */
export function CODE_BBA03D() {
  let x = reg.x & 0xffff;
  let y = reg.y & 0xffff;
  do {
    st(0x80f2 + x, 0x0002);
    y = (y + 2) & 0x001e;
    st(0x80f3 + x, (y + 0x80d2) & 0xffff);
    x = (x + 3) & 0xffff;
  } while (x !== 0x0150);
  reg.x = x;
  reg.y = y;
  hdma(1, 0x0e42, 0x80f2, 0x7e, 0x7e);
  enable(0x0201);
}

/** $BBA1FF */
export function dma_init_02() {
  w16(R.sprite_dma_buffer_limit, 0x0024);
  enable(0x0001);
}

/** $BBA20B */
export function dma_init_01() {
  w16(R.sprite_dma_buffer_limit, 0x0024);
  reg.x = 0;
  CODE_BBA213();
}

/** $BBA213 — X = table offset. */
export function CODE_BBA213() {
  let x = reg.x & 0xffff;
  do {
    st(0x8012 + x, 0x0010);
    st(0x8013 + x, 0x0000);
    x = (x + 3) & 0xffff;
  } while (x !== 0x0066);
  reg.x = x;
  hdma(1, 0x0f02, 0x8012, 0x7e, 0);
  enable(0x0201);
  reg.y = C.special_sprite_spawn_id_00DC;
  spawn_BB83EF_special_sprite_index();
}

/** $BBA24F */
export function dma_init_16() {
  set_default_sprite_dma_buffer_size();
  reg.x = 0;
  reg.y = 0;
  CODE_BBA256();
}

/** $BBA256 — X = table offset, Y = rotating line offset. */
export function CODE_BBA256() {
  let x = reg.x & 0xffff;
  let y = reg.y & 0xffff;
  do {
    st(0x8012 + x, 0x0004);
    st(0x85d2 + x, 0x0004);
    const a = (y + 0x80d2) & 0xffff;
    st(0x8013 + x, a);
    st(0x85d3 + x, (a + 0x0740) & 0xffff);
    y = (y + 2) & 0x001e;
    x = (x + 3) & 0xffff;
  } while (x !== 0x00c0);
  reg.y = y;
  reg.x = 0;
  CODE_BBA289();
}

/** $BBA289 — X = table offset. */
export function CODE_BBA289() {
  let x = reg.x & 0xffff;
  do {
    st(0x80f2 + x, 0x009f);
    st(0x810a + x, 0x009f);
    st(0x80f3 + x, 0x8552);
    st(0x810b + x, 0x8552 + 0x0040);
    x = (x + 3) & 0xffff;
  } while (x !== 0x0018);
  reg.x = x;
  hdma(1, 0x0e42, 0x80f2, 0x7e, 0x7e);
  hdma(2, 0x0d42, 0x8012, 0x7e, 0x7e);
  enable(0x0601);
}

/** $BBA2E2 */
export function dma_init_15() {
  set_default_sprite_dma_buffer_size();
  st(0x8332, 0x0001);
  st(0x8333, 0xff00);
  st(0x8335, 0x0001);
  st(0x8336, 0xff00);
  st(0x8338, 0x0001);
  st(0x8339, 0x00ff);
  st(0x833b, 0x0000);
  const t1 = lbl("DATA_BBA35F");
  hdma(1, 0x0e42, t1 & 0xffff, (t1 >> 16) & 0xff, 0);
  const t2 = lbl("DATA_BBA408");
  hdma(2, 0x0d42, t2 & 0xffff, (t2 >> 16) & 0xff, 0x7e);
  hdma(3, 0x2601, 0x8332, 0x7e, 0);
  enable(0x0e01);
}

/** $BBA416 — water levels (variant with a fixed water height). */
export function dma_init_06() {
  set_default_sprite_dma_buffer_size();
  waterTables();
  waterChannels();
  w16(R.water_y_position, 0x1680);
  init_level_water_height();
  reg.y = lbl("DATA_FF0FD2") & 0xffff;
  spawn_no_gfx_special_sprite_address(); // water bubbles
  enable(0xdc01);
}

register({
  dma_init_08,
  dma_init_03,
  CODE_BB9AD9,
  dma_init_14,
  CODE_BB9B1E,
  CODE_BB9B62,
  CODE_BB9B71,
  dma_init_09,
  CODE_BB9B86,
  dma_init_0A,
  dma_init_18,
  CODE_BB9E18,
  CODE_BB9E51,
  dma_init_07,
  dma_init_00,
  dma_init_0B,
  dma_init_0E,
  CODE_BB9EE1,
  CODE_BB9F4A,
  dma_init_0D,
  dma_init_0F,
  CODE_BBA03D,
  dma_init_02,
  dma_init_01,
  CODE_BBA213,
  dma_init_16,
  CODE_BBA256,
  CODE_BBA289,
  dma_init_15,
  dma_init_06,
});
