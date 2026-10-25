# DKC2 study port

Donkey Kong Country 2 game logic ported to TypeScript, routine by routine, from the community
disassembly. SNES hardware (PPU, DMA, sound chip) runs as WebAssembly (LakeSnes, MIT).
Graphics, music and data are read from your own ROM at runtime. No ROM data is included.

## Run
Requirements: Node 20+.

    npm install
    npm run dev

Open the URL Vite prints (http://localhost:5173), choose your ROM:
Donkey Kong Country 2 (USA) Rev 1, .sfc, headerless or with a 512-byte header.

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
`current_graphic`), decodes it straight from the ROM, colors it with the live palette, upscales it
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
