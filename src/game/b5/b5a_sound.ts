/**
 * Bank $B5 (part A) — CPU side of the sound engine.
 *
 * The SNES CPU talks to the SPC700 sound CPU through the four APU ports $2140-$2143
 * (`APU.IO1`..`APU.IO4` in the disassembly's naming). DKC2 uses a simple handshake:
 *   - $2140 carries a transaction counter (`spc_transaction`, $00): the CPU writes the next
 *     counter value and the SPC echoes it back once it has consumed the data in $2141/$2142.
 *   - commands are 16-bit words: low byte = command id, high byte = argument
 *     ($FF = enter upload mode, $FE = start music, $FA = stereo setting, $FB = song transition,
 *     $FC/$FD = misc, anything else = sound effect on channel `high byte`).
 *   - uploads send (ARAM address, word count, data words...) through the same handshake; a
 *     zero word count makes the SPC jump to the given address instead.
 *
 * Every busy-wait on the sound CPU is a `waitUntil` so that emulated time passes and the real
 * SPC700 runs, and the port writes happen in exactly the original order.
 *
 * The bank starts with a table of `JMP` thunks (`queue_sound_effect` = $B58003, ...) whose
 * targets are sublabels of `upload_spc_engine`. Both the thunk labels (entered by original code)
 * and the sublabel bodies (the only stub names other ports can import) are registered.
 */
import { r8, w8, r16, w16, rom8, rom16, bus8, io8, io16, ioR8 } from "../../core/mem";
import { reg, register } from "../../core/cpu";
import { setRetMode, RET_RTL } from "../../core/hybrid";
import { waitUntil, xba } from "../../core/ops";
import { L, R, APU } from "../../core/sym";

const SPC_COMMAND_BUFFER = R.spc_command_buffer; // $0622: ring buffer of 8 queued sound words
const SOUND_EFFECT_BUFFER = R.sound_effect_buffer; // $0619: last effect id per channel
const INDEX_TO_BIT = L("upload_spc_engine_index_to_bit");
const SPC_BASE_ENGINE = L("spc_base_engine");
const SPC_SOUND_ENGINE = L("spc_sound_engine");
const GLOBAL_SFX_DATA = L("global_sfx_data");
const GLOBAL_SAMPLE_MAP = L("global_sample_map");
const SAMPLE_TABLE = L("sample_table"); // ROM: 3-byte pointers to the BRR samples
const SONG_DATA = L("song_data");
const SONG_SFX = L("DATA_EE117B");
const SONG_SAMPLE_MAPS = L("song_sample_maps");
const SAMPLE_DIRECTORY_BUFFER = 0x7e2200; // WRAM scratch used to build ARAM tables

// ARAM addresses / sizes are assembler constants of the SPC program (APU namespace) that are
// not in the symbol table; read them from the immediates of the original instructions.
const IMM_APU_RESET = L("upload_spc_engine_upload_spc_base_engine") + 0x0d; // LDA #APU_reset
const IMM_BASE_ENGINE_SIZE = L("upload_spc_engine_upload_spc_base_engine") + 0x32; // CPX.b #size
const IMM_DATA_0560 = L("upload_spc_engine_upload_spc_sound_engine") + 0x0d; // LDA #DATA_0560
const IMM_SOUND_ENGINE_WORDS = L("upload_spc_engine_upload_spc_sound_engine") + 0x12; // LDA.w #size/2
const IMM_SAMPLE_DIR = L("upload_spc_engine_upload_global_samples") + 0x0b; // LDA #sample_table
const IMM_SAMPLE_DATA = L("upload_spc_engine_upload_global_samples") + 0x12; // LDA #sample_data
const IMM_ENGINE_ENTRY = L("upload_spc_engine_execute_spc_sound_engine") + 0x01; // LDA #CODE_0672

/** 16-bit read through a 24-bit long pointer, as `LDA [dp]` does (second byte at addr+1). */
function long16(addr: number): number {
  addr &= 0xffffff;
  return bus8(addr) | (bus8((addr + 1) & 0xffffff) << 8);
}
/** The 24-bit pointer stored at a direct-page location (word + bank byte). */
const dpPtr = (dp: number) => r16(dp) | (r8(dp + 2) << 16);

// Poll every 2 master cycles (the finest step of the hardware model): the reference CPU is
// overclocked, so the original reacts to an echo almost instantly; coarser polling adds latency
// to every word of a sample upload and shifts level loads by whole frames.
const waitEcho = (x: number) => waitUntil(() => ioR8(APU.IO1) === x, 2, 50_000_000);

// ---------------------------------------------------------------------------------------------
// Low-level SPC700 transfers
// ---------------------------------------------------------------------------------------------

/** $B581FB .write_spc_command — X = command word. Send one command through the handshake. */
function write_spc_command() {
  const command = reg.x & 0xffff;
  let t = r8(R.spc_transaction);
  waitEcho(t); // the SPC must have echoed the previous transaction
  io16(APU.IO2, command);
  t = (t + 1) & 0xff;
  io8(APU.IO1, t);
  w8(R.spc_transaction, t);
  reg.a = command;
  reg.x = t;
}

/**
 * $B5840D .upload_spc_block — upload $37 words from [$32] to ARAM address $35.
 * A zero word count only sends the address, which makes the SPC engine jump there.
 * Returns A = byte count ($39 * 2).
 */
function upload_spc_block() {
  let t = r8(R.spc_transaction);
  waitEcho(t);
  io16(APU.IO2, r16(0x35)); // ARAM destination
  t = (t + 1) & 0xff;
  io8(APU.IO1, t);
  w16(0x39, r16(0x37));
  waitEcho(t);
  io16(APU.IO2, r16(0x37)); // word count
  t = (t + 1) & 0xff;
  io8(APU.IO1, t);
  if (r16(0x37) !== 0) {
    let y = 0;
    for (;;) {
      const data = long16(dpPtr(0x32) + y);
      y = (y + 2) & 0xff;
      if (y === 0) {
        // .advance_pointer: the 8-bit index wrapped, move the pointer on by one page
        const mid = (r8(0x33) + 1) & 0xff;
        w8(0x33, mid);
        if (mid === 0) w8(0x34, (r8(0x34) + 1) & 0xff);
      }
      waitEcho(t);
      t = (t + 1) & 0xff;
      io16(APU.IO2, data);
      io8(APU.IO1, t);
      const left = (r16(0x37) - 1) & 0xffff;
      w16(0x37, left);
      if (left === 0) break;
    }
  }
  w8(R.spc_transaction, t);
  reg.a = (r16(0x39) << 1) & 0xffff;
  reg.x = t;
}

/** $B583FB .upload_inline_spc_block — [$32] points at (ARAM address, word count, data...). */
function upload_inline_spc_block() {
  w16(0x35, long16(dpPtr(0x32)));
  w16(0x32, (r16(0x32) + 2) & 0xffff);
  w16(0x37, long16(dpPtr(0x32)));
  w16(0x32, (r16(0x32) + 2) & 0xffff);
  upload_spc_block();
}

/** $B581AC .execute_spc_sound_engine — zero-length transfer = jump to the sound engine main loop. */
function execute_spc_sound_engine() {
  w16(0x35, rom16(IMM_ENGINE_ENTRY));
  w16(0x37, 0);
  upload_spc_block();
}

/** $B58213 .upload_spc_base_engine — boot the SPC700 through its IPL ROM and upload the core. */
function upload_spc_base_engine() {
  // the IPL signals readiness with $BBAA in $2140/$2141
  waitUntil(() => (ioR8(APU.IO1) | (ioR8(APU.IO2) << 8)) === 0xbbaa, 2, 50_000_000);
  io16(APU.IO3, rom16(IMM_APU_RESET)); // ARAM address of the transfer
  io16(APU.IO1, 0x01cc); // $CC = start transfer, $01 = non-zero (data follows)
  waitEcho(0xcc);
  const size = rom8(IMM_BASE_ENGINE_SIZE);
  let x = 0;
  do {
    io8(APU.IO2, rom8(SPC_BASE_ENGINE + x));
    io8(APU.IO1, x);
    waitEcho(x);
    x = (x + 1) & 0xff;
  } while (x !== size);
  // counter + 2 with $2141 = 0 ends the transfer and executes the uploaded code
  x = (x + 1) & 0xff;
  io16(APU.IO1, x);
  // the IPL echoes this kick only for a moment before jumping into the new code, which
  // overwrites $2140 almost at once
  waitEcho(x);
  w16(R.spc_transaction, 0);
  w16(R.stereo_select, 1); // mono by default
}

/** $B5828F .upload_spc_sound_engine */
function upload_spc_sound_engine() {
  w16(0x32, SPC_SOUND_ENGINE & 0xffff);
  w16(0x34, SPC_SOUND_ENGINE >> 16);
  w16(0x35, rom16(IMM_DATA_0560));
  w16(0x37, rom16(IMM_SOUND_ENGINE_WORDS));
  upload_spc_block();
}

// ---------------------------------------------------------------------------------------------
// Samples
// ---------------------------------------------------------------------------------------------

/**
 * $B582D1 .sample_uploader — [$0E] = sample map ($FFFF-terminated list of sample numbers).
 * Builds the ARAM source directory (start/loop addresses) for the samples, uploads it, uploads the
 * sample-number -> source-number map (unless this is the global set itself), then the BRR data.
 * $02/$06/$0A track the next directory entry / sample data address / source number.
 */
function sample_uploader() {
  w16(0x0a, 0);
  let x = 0;
  w16(0x3a, r16(0x0a));
  w16(0x3e, r16(0x0e));
  w16(0x40, r16(0x10));
  w16(0x42, r16(0x02));
  w16(0x44, r16(0x06));
  // .parse_next_sample: directory entries into $7E2200
  for (;;) {
    const n = long16(dpPtr(0x3e));
    w16(0x3e, (r16(0x3e) + 2) & 0xffff);
    if (n === 0xffff) break;
    w16(0x3c, n);
    const t = (n * 3) & 0xffff;
    w16(0x32, rom16(SAMPLE_TABLE + t));
    w16(0x34, rom16(SAMPLE_TABLE + 2 + t));
    w16(SAMPLE_DIRECTORY_BUFFER + x, r16(0x06)); // sample start
    x += 2;
    w16(SAMPLE_DIRECTORY_BUFFER + x, (long16(dpPtr(0x32)) + r16(0x06)) & 0xffff); // loop point
    x += 2;
    w16(0x02, (r16(0x02) + 4) & 0xffff);
    w16(0x32, (r16(0x32) + 2) & 0xffff);
    w16(0x06, (long16(dpPtr(0x32)) + r16(0x06)) & 0xffff); // next free sample address
  }
  // .upload_sample_directory
  w16(0x32, 0x2200);
  w16(0x34, 0x007e);
  w16(0x35, r16(0x42));
  w16(0x37, (((rom16(IMM_SAMPLE_DATA) - r16(0x42) + 1) & 0xffff) >> 1));
  upload_spc_block();
  w16(0x3e, GLOBAL_SAMPLE_MAP & 0xffff);
  w16(0x40, GLOBAL_SAMPLE_MAP >> 16);
  const isGlobalSet = r16(0x0e) === r16(0x3e) && r16(0x10) === r16(0x40);
  if (!isGlobalSet) {
    // .map_global_sample then .map_set_specific_samples: number the samples in upload order
    const mapList = () => {
      for (;;) {
        const n = long16(dpPtr(0x3e));
        if (n === 0xffff) return;
        w16(0x3e, (r16(0x3e) + 2) & 0xffff);
        w8(SAMPLE_DIRECTORY_BUFFER + n, r8(0x0a));
        w16(0x0a, (r16(0x0a) + 1) & 0xffff);
      }
    };
    mapList();
    w16(0x3e, r16(0x0e));
    w16(0x40, r16(0x10));
    mapList();
    // .upload_source_number_map
    w16(0x32, 0x2200);
    w16(0x34, 0x007e);
    w16(0x35, rom16(IMM_DATA_0560));
    w16(0x37, 0x0080);
    upload_spc_block();
  }
  // .upload_samples
  w16(0x06, r16(0x44));
  for (;;) {
    const n = long16(dpPtr(0x0e));
    if (n === 0xffff) return;
    w16(0x0e, (r16(0x0e) + 2) & 0xffff);
    w16(0x3c, n);
    const t = (n * 3) & 0xffff;
    w16(0x32, rom16(SAMPLE_TABLE + t));
    w16(0x34, rom16(SAMPLE_TABLE + 2 + t));
    w16(0x32, (r16(0x32) + 2) & 0xffff); // skip the loop offset
    w16(0x35, r16(0x06));
    w16(0x37, long16(dpPtr(0x32))); // size in bytes
    w16(0x06, (r16(0x37) + r16(0x35)) & 0xffff);
    w16(0x37, ((r16(0x37) + 1) & 0xffff) >> 1); // bytes -> words
    w16(0x32, (r16(0x32) + 2) & 0xffff);
    upload_spc_block();
  }
}

/** $B582A9 .upload_global_samples — the samples every song can use; remembers where they end. */
function upload_global_samples() {
  w16(0x0e, GLOBAL_SAMPLE_MAP & 0xffff);
  w16(0x10, GLOBAL_SAMPLE_MAP >> 16);
  w16(0x02, rom16(IMM_SAMPLE_DIR));
  w16(0x0a, 0);
  w16(0x06, rom16(IMM_SAMPLE_DATA));
  w16(0x0a, 0);
  sample_uploader();
  w16(R.spc_sample_dir_destination_2, r16(0x02));
  w16(R.spc_sample_destination_2, r16(0x06));
  w16(0x0c, r16(0x0a));
}

/** Song number * 6 (`CLC : ROL : STA $32 : ROL : CLC : ADC $32`). */
function songIndex6(): number {
  const s = r16(R.current_song);
  const a2 = (s << 1) & 0xffff;
  w16(0x32, a2);
  const a4 = ((a2 << 1) | (s >> 15)) & 0xffff;
  return (a4 + a2) & 0xffff;
}

/** $B58469 .upload_song_sample_set — song specific samples, placed after the global ones. */
function upload_song_sample_set() {
  const x = songIndex6();
  w16(0x0e, rom16(SONG_SAMPLE_MAPS + x));
  w16(0x10, rom16(SONG_SAMPLE_MAPS + 2 + x));
  w16(0x02, r16(0x04));
  w16(0x06, r16(0x08));
  w16(0x0a, r16(0x0c));
  sample_uploader();
}

/** $B5825C .upload_song_data */
function upload_song_data() {
  const x = songIndex6();
  w16(0x32, rom16(SONG_DATA + x));
  w16(0x34, rom16(SONG_DATA + 2 + x));
  upload_inline_spc_block();
}

/** $B58277 .upload_song_sound_effects */
function upload_song_sound_effects() {
  const x = (r16(R.current_song) * 3) & 0xffff;
  w16(0x32, rom16(SONG_SFX + x));
  w16(0x34, rom16(SONG_SFX + 2 + x));
  upload_inline_spc_block();
}

/** $B58191 .upload_spc_engine — full sound engine + global samples + global sound effects. */
function upload_spc_engine_body() {
  upload_spc_base_engine();
  upload_spc_sound_engine();
  upload_global_samples();
  w16(0x32, GLOBAL_SFX_DATA & 0xffff);
  w16(0x34, GLOBAL_SFX_DATA >> 16);
  upload_inline_spc_block();
  execute_spc_sound_engine();
}

/** $B58000 / $B5818D — JSL entry: upload and start the SPC700 sound engine (once at boot). */
export function upload_spc_engine() {
  upload_spc_engine_body();
}

// ---------------------------------------------------------------------------------------------
// Sound effects
// ---------------------------------------------------------------------------------------------

/** $B5816D .clear_sound_buffers (Rev 1 indexes the command buffer one byte lower). */
function clear_sound_buffers() {
  for (let x = 7; x >= 0; x -= 2) {
    w16(SPC_COMMAND_BUFFER - 1 + x, 0);
    w16(SPC_COMMAND_BUFFER + 7 + x, 0);
    w16(SOUND_EFFECT_BUFFER + x, 0);
  }
  w16(R.next_sound_effect_slot, 0);
  w16(R.last_spc_command_transfer_time, 0);
  w16(R.current_sound_effect_slot, 2);
  w16(0x19b0, 0);
}

/** $B58003 / $B58030 — A = sound word (bit 15 = high priority). Add it to the ring buffer. */
export function queue_sound_effect() {
  const sound = reg.a & 0xffff;
  let x = r16(R.next_sound_effect_slot);
  const last = r16(SPC_COMMAND_BUFFER + x);
  // The carry of `CMP spc_command_buffer,x` survives to the RTL (nothing after it touches C),
  // and callers feed it to the RNG (CODE_B4C175 rotates C into its seed), e.g. Krow's egg rain.
  // N/Z come from the final PLB (the caller's data bank).
  reg.c = sound >= last;
  reg.z = (reg.db & 0xff) === 0;
  reg.n = (reg.db & 0x80) !== 0;
  // the same effect twice in a row is only queued once
  if (sound !== last) {
    x = (x + 2) & 0x000e;
    if (r16(SPC_COMMAND_BUFFER + x) === 0) {
      // otherwise the buffer is full and the effect is dropped
      w16(SPC_COMMAND_BUFFER + x, sound);
      w16(R.next_sound_effect_slot, x);
    }
  }
  reg.x = x;
}

/** $B58088 .play_low_priority_sound — A = (channel << 8) | id; skipped if channel and 4 are busy. */
function play_low_priority_sound(sound: number) {
  const id = sound & 0xff;
  let channel = (sound >> 8) & 0xff;
  const used = r8(R.used_sound_effect_channels);
  if (used & rom8(INDEX_TO_BIT + channel)) {
    // .test_sound_backup_channel
    channel = 4;
    if (used & rom8(INDEX_TO_BIT + channel)) return;
  }
  w8(SOUND_EFFECT_BUFFER + channel, id);
  reg.x = (channel << 8) | id;
  write_spc_command();
}

/** $B58021 / $B580A9 — A = (channel << 8) | id; plays now and reserves the channel (id 0 frees it). */
export function play_high_priority_sound() {
  const id = reg.a & 0xff;
  const channel = (reg.a >> 8) & 0x0f;
  w8(SOUND_EFFECT_BUFFER + channel, id);
  // `LDA .index_to_bit,x` is absolute: it reads the data bank, and this entry does not set DB.
  // Called directly (JSL) from bank $80 code it reads $80:80CD+x instead of the table (a
  // bug of the original that decides which channel bit actually gets set/cleared).
  const bit = bus8((((reg.db & 0xff) << 16) + (INDEX_TO_BIT & 0xffff) + channel) & 0xffffff);
  const used = r8(R.used_sound_effect_channels);
  w8(R.used_sound_effect_channels, id === 0 ? used & ~bit : used | bit);
  reg.x = (channel << 8) | r8(SOUND_EFFECT_BUFFER + channel);
  write_spc_command();
}

/** $B5801E / $B58053 — send at most one queued sound effect per frame (called every frame). */
export function play_queued_sound_effect() {
  if (r16(R.active_frame_counter) === r16(R.last_spc_command_transfer_time)) return;
  const x = r16(R.current_sound_effect_slot);
  const sound = r16(SPC_COMMAND_BUFFER + x);
  if (sound === 0) return;
  w16(SPC_COMMAND_BUFFER + x, 0);
  if (sound & 0x8000) {
    reg.a = sound & 0x7fff;
    const db = reg.db;
    reg.db = 0xb5; // PHK : PLB at the top of this routine
    play_high_priority_sound();
    reg.db = db;
  } else {
    play_low_priority_sound(sound);
  }
  w16(R.current_sound_effect_slot, (r16(R.current_sound_effect_slot) + 2) & 0x000e);
  w16(R.last_spc_command_transfer_time, r16(R.active_frame_counter));
}

// ---------------------------------------------------------------------------------------------
// Music
// ---------------------------------------------------------------------------------------------

/** Command $xxFA: mono/stereo setting (`LDA stereo_select : XBA : ORA #$00FA`). */
function send_stereo_setting() {
  reg.x = xba(r16(R.stereo_select)) | 0x00fa;
  write_spc_command();
}

/** Stop the engine, upload a song's samples, data and sound effects, restart the engine. */
function upload_song() {
  reg.x = 0x00ff; // upload mode
  write_spc_command();
  upload_song_sample_set();
  upload_song_data();
  upload_song_sound_effects();
}

/** $B58006 / $B580D5 — A = song. Upload it without starting it (see play_queued_song). */
export function queue_song() {
  w16(R.current_song, reg.a);
  upload_song();
  execute_spc_sound_engine();
}

/** $B58009 / $B580EE — start the song uploaded by queue_song. */
export function play_queued_song() {
  clear_sound_buffers();
  reg.x = 0x00fe; // start music
  write_spc_command();
  send_stereo_setting();
}

/** $B5800C / $B58106 — A = song. Upload and start a song. */
export function play_song() {
  w16(R.current_song, reg.a);
  upload_song();
  clear_sound_buffers();
  execute_spc_sound_engine();
  reg.x = 0x00fe;
  write_spc_command();
  send_stereo_setting();
}

/** $B5800F / $B58132 — A = (transition << 8) | song. Upload and start a song in a given state. */
export function play_song_with_transition() {
  const input = reg.a & 0xffff;
  w16(R.current_song, input & 0x00ff);
  upload_song();
  clear_sound_buffers();
  execute_spc_sound_engine();
  reg.x = (input & 0xff00) | 0x00fb;
  write_spc_command();
  reg.x = 0x00fe;
  write_spc_command();
  send_stereo_setting();
}

/** $B58018 / $B581DB — A = transition. Switch the playing song to another section/variant. */
export function transition_song() {
  reg.x = ((reg.a & 0xff) << 8) | 0x00fb;
  write_spc_command();
  reg.x = 0x00fe;
  write_spc_command();
  send_stereo_setting();
}

/** $B5801B / $B581C2 — A = argument of SPC command $FC. */
export function CODE_B5801B() {
  reg.x = ((reg.a & 0xff) << 8) | 0x00fc;
  write_spc_command();
}

/** $B58012 / $B581CE — A = argument of SPC command $FD. */
export function CODE_B58012() {
  reg.x = ((reg.a & 0xff) << 8) | 0x00fd;
  write_spc_command();
}

/** $B58015 / $B581DA — unused command slot, does nothing. */
export function null_spc_command() {}

const entries: Record<string, () => void> = {
  // JMP thunks at the start of the bank (entered by original code with JSL)
  upload_spc_engine,
  queue_sound_effect,
  queue_song,
  play_queued_song,
  play_song,
  play_song_with_transition,
  CODE_B58012,
  null_spc_command,
  transition_song,
  CODE_B5801B,
  play_queued_sound_effect,
  play_high_priority_sound,
  // the thunk targets (the stubs other ports can call)
  upload_spc_engine_upload_spc_engine_wrapper: upload_spc_engine,
  upload_spc_engine_queue_sound_effect: queue_sound_effect,
  upload_spc_engine_queue_song: queue_song,
  upload_spc_engine_play_queued_song: play_queued_song,
  upload_spc_engine_play_song: play_song,
  upload_spc_engine_play_song_with_transition: play_song_with_transition,
  upload_spc_engine_CODE_B581CE: CODE_B58012,
  upload_spc_engine_null_spc_command: null_spc_command,
  upload_spc_engine_transition_song: transition_song,
  upload_spc_engine_CODE_B581C2: CODE_B5801B,
  upload_spc_engine_play_queued_sound_effect: play_queued_sound_effect,
  upload_spc_engine_play_high_priority_sound: play_high_priority_sound,
};
register(entries);
// all of these return with RTL; the generated stubs guess RTS for some (thunks / sublabels)
for (const name of Object.keys(entries)) setRetMode(L(name), RET_RTL);
