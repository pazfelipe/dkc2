# DKC2 study port

Donkey Kong Country 2 game logic ported to TypeScript, routine by routine, from the community
disassembly. SNES hardware (PPU, DMA, sound chip) runs as WebAssembly (LakeSnes, MIT).
The game runs **without the ROM**: its data (graphics, levels, music, tables, text) is extracted
once from your own ROM into `assets/`, readable files in the disassembly's folder layout, and
none of the original 65816 code is kept (the code is the TypeScript port).

## Run
Requirements: Node 20+, and once, your ROM: Donkey Kong Country 2 (USA) Rev 1, .sfc, headerless
or with a 512-byte header.

    npm install
    npm run extract -- "path/to/Donkey Kong Country 2 (USA) (Rev 1).sfc"   # writes assets/
    npm run dev

Open the URL Vite prints (http://localhost:5173). `npm run dev` / `npx vite build` pack
`assets/` into `public/dkc2-data.pak` (one gzip file the page fetches at boot); `npm run assets`
does it by hand. No ROM is loaded by the page.

## Game data (assets/)
`npm run extract` checks the ROM's SHA-256 and writes about 12,300 files (4.0 MB of data):

| Folder | What |
|---|---|
| `gfx/ levels/ backgrounds/ world_maps/ screens/ sound/samples/ sound/sound_effects/` | the files the disassembly includes from its `data/` tree, same paths and names: compressed tile graphics, tilemaps, collision maps, level objects, BRR samples... Palettes are JSON (`[red, green, blue]`, 0-31). |
| `sound/music/<song>_song_data.bin` | the songs (sequencer data for the SPC700) |
| `bank_XX/<label>.bin` / `.json` | tables written inline in `bank_XX.asm`, one file per label (pointer tables, sprite constants, animation scripts, ...); text as JSON |
| `bank_EE-F2/spc_base_engine.bin`, `spc_sound_engine.bin` | Rare's sound driver, uploaded to the SPC700 (it runs on the sound CPU) |
| `header/`, `misc/` | the cartridge header and vectors, a few bytes between banks |
| `manifest.json` | for every block: cartridge offset, length, file, offset in the file; and the code ranges that were left out |

`assets/` (and the generated `public/dkc2-data.pak`) are git-ignored for now: they are
Nintendo/Rare's data, 4.0 MB in 12,322 files. To keep them in this private repo, remove the two
lines from `.gitignore`.

Edit a file, restart the dev server (it re-packs at start) or run `npm run assets`, reload, and
the game uses it. At boot the blocks are
put back at their cartridge addresses into a 4 MiB data image whose code bytes are zero, so the
ported code, the DMA and the decompressor read the data where the original did
(`src/platform/assetformats.ts`).

How bytes are classified (`tools/rom_layout.py` -> `tools/rom_layout.json`, committed): asar's
address-to-line map of the assembled disassembly says which source line emitted every byte; lines
that are 65816 instructions are code (4.5% of the ROM), everything else is data. The tests prove the
port never reads a code byte (see "ROM-free check" in PORTING.md). To re-extract after changing
the layout: `npm run layout` (needs the disassembly and its symbol file), then `npm run extract`.

Controls: arrows move, Z jump, A run/roll/pick up, X team-up, Enter start, Shift swap Kongs,
F2/F4 save/load state, ` (backtick) debug panel, P pause, H toggles HD Diddy.

The debug panel shows how many routines are ported and which original routines still run
(hybrid mode: any routine not yet ported runs the original code on an emulated 65816).

## Read
- ARCHITECTURE.md: how the game works inside (frame model, sprites, graphics, terrain, sound).
- PORTING.md: how the port is done and verified against the original.
- src/game/<bank>/: the ported code, one folder per original ROM bank, labels kept.

## HD Kongs (optional enhancement)

`src/platform/hdsprites.ts` redraws Diddy and Dixie at 4x. It reads the frame the game chose (the sprite's
`current_graphic`), decodes it from the game data, colors it with the live palette, upscales it
with xBRZ and draws it on a 4x canvas; the game's own OAM chunks for Diddy are removed just
before the PPU draws the frame, so nothing else in the game changes. `npx tsx test/hd_align.ts
<state> <frames> <pad>` checks the overlay lands exactly where the game put the chunks.
Limitations: it is algorithmic upscaling (no new art), and the HD sprite is drawn above every
layer, so foreground objects that should pass in front of Diddy (ropes, some scenery) end up behind him.

## HD title screen

`src/platform/hdscreen.ts`. The title art is BG1 on the main screen; the chest twinkles are sprites
on the sub screen added by color math. The PPU glue (`hw_hd_split`, in `hw/lakesnes/ppu.c`) outputs
the background without sprites and the sprite pixels separately, before brightness. The background
is upscaled 4x with xBRZ once (it is static) and the twinkles are drawn at original resolution with
additive blending, so they sparkle exactly as on the console. H toggles all HD graphics.
The same split is used for the file select and game mode screens. Upscaling runs in a Web Worker
(`src/platform/xbrz.worker.ts`) and results are cached by content, so a new menu state shows the
original frame for a moment instead of stalling the game.

## Audio across screen transitions

Loading between screens (sound uploads, decompression) makes one game frame span many VBlanks.
The DSP's own buffer only keeps the last ~32 ms, so the sound of those frames used to be lost and the
same 17 ms chunk was replayed while the lag frames passed (the "stuck" music). The DSP now copies
every sample into a 4 s capture ring (`hw_audio_drain`), and `AudioOut` queues it and plays it out in
real time.

## Animated screens (world maps) on the GPU

`src/platform/xbrgl.ts` runs xBR level 2 (Hyllian) as a WebGL2 fragment shader on the background
every frame, so animated screens (water, lights, clouds) are upscaled live. Sprites come from the same
PPU split and are composited unscaled (additive ones with "lighter"). `test/hd_split_check.ts` checks
that bg + sprites recompose to exactly the PPU's frame.

## HD Diddy respects layers

With HD Diddy his OAM entries are removed, but the PPU is told his OBJ priority (`hw_hd_ghost`) and
records, per pixel, where anything in front of that priority is opaque (`hw_hd_occl`). That mask is cut
out of the HD sprite, so ropes, walls and foreground scenery pass in front of him like in the original.
