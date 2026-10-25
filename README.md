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
F2/F4 save/load state, ` (backtick) debug panel, P pause.

The debug panel shows how many routines are ported and which original routines still run
(hybrid mode: any routine not yet ported runs the original code on an emulated 65816).

## Read
- ARCHITECTURE.md: how the game works inside (frame model, sprites, graphics, terrain, sound).
- PORTING.md: how the port is done and verified against the original.
- src/game/<bank>/: the ported code, one folder per original ROM bank, labels kept.
