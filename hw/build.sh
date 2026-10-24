#!/bin/sh
# Build the hardware layer (LakeSnes PPU/DMA/APU + glue) to WebAssembly.
set -e
cd "$(dirname "$0")"
SRC="hw.c libc/libc.c lakesnes/snes.c lakesnes/snes_other.c lakesnes/ppu.c lakesnes/dma.c lakesnes/apu.c lakesnes/spc.c lakesnes/dsp.c lakesnes/cart.c lakesnes/input.c lakesnes/statehandler.c lakesnes/cpu.c"
clang --target=wasm32 -O2 -nostdlib -ffreestanding -Ilibc -Ilakesnes \
  -Wno-incompatible-library-redeclaration -Wno-builtin-requires-header \
  -Wl,--no-entry -Wl,--export-dynamic -Wl,--export=__heap_base -Wl,--initial-memory=16777216 -Wl,--max-memory=268435456 -Wl,--growable-table \
  -o ../public/hw.wasm $SRC
ls -la ../public/hw.wasm
