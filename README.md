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

## HD Diddy (optional enhancement)

`src/platform/hdsprites.ts` redraws Diddy at 4x. It reads the frame the game chose (the sprite's
`current_graphic`), decodes it straight from the ROM, colors it with the live palette, upscales it
with xBRZ and draws it on a 4x canvas; the game's own OAM chunks for Diddy are removed just
before the PPU draws the frame, so nothing else in the game changes. `npx tsx test/hd_align.ts
<state> <frames> <pad>` checks the overlay lands exactly where the game put the chunks.
Limitations: it is algorithmic upscaling (no new art), and the HD sprite is drawn above every
layer, so foreground objects that should pass in front of Diddy (ropes, some scenery) end up behind him.
