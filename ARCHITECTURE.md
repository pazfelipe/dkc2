# How Donkey Kong Country 2 works

Notes from porting the game. Everything here was confirmed against the original code
(disassembly at `ref/dkc2dis`) or by running it. Addresses are SNES addresses (`$BB:B5C4`
style = bank:offset). Routine and variable names come from the community disassembly.

## 1. The machine

| Part | What it is | How the game uses it |
|---|---|---|
| CPU | 65816 at 3.58 MHz ("FastROM") | All game logic. 16-bit A/X/Y most of the time, 8-bit only for byte work. |
| WRAM | 128 KiB at `$7E0000-$7FFFFF` | All game state. `$0000-$1FFF` is mirrored in every code bank, so the code addresses its variables with short 16-bit addresses. |
| ROM | 4 MiB, HiROM, banks `$80-$FF` | Code in `$80-$BE`, data (graphics, levels, music) in `$C0-$FF`. |
| PPU | Video chip | 64 KiB VRAM (tiles + tilemaps), 512 B CGRAM (256 colors), 544 B OAM (128 sprites). Mode 1: two 16-color layers + one 4-color layer + sprites. |
| DMA/HDMA | 8 channels | DMA copies tiles/tilemaps/palettes/OAM into the PPU during VBlank. HDMA changes PPU registers per scanline (water, gradients, wave effects). |
| APU | SPC700 CPU + S-DSP, its own 64 KiB RAM | Runs Rare's sound driver. The main CPU uploads the driver, samples and songs, then just sends commands through 4 ports (`$2140-$2143`). |

The port keeps this split: the hardware (PPU, DMA, APU) is an emulated component
(`hw/`, LakeSnes), and the 65816 code is rewritten in TypeScript (`src/game/`) operating on the
same WRAM layout.

## 2. The frame: everything happens in the NMI

DKC2 has no "main loop" in the usual sense. After boot the CPU just waits (`WAI`) and the
whole game runs inside the VBlank interrupt (NMI), 60 times per second:

```
VBlank -> NMI_start ($80:F3BD)
            force blank, global_frame_counter++
            JMP (nmi_pointer)                    ; normally run_simple_game_mode
run_simple_game_mode
            nmi_pointer = run_incomplete_frame   ; in case we are still running at the next VBlank
            active_frame_counter++
            JMP (game_mode_pointer)              ; e.g. the level game mode
<game mode>                                      ; 1) DMA uploads prepared last frame (VBlank only!)
                                                 ; 2) game logic for this frame
                                                 ; 3) build OAM/DMA queues for the next VBlank
game_sub_mode_return -> CODE_808636
            nmi_pointer = run_simple_game_mode
            WAI                                  ; sleep until the next VBlank
```

If the logic is too slow and the next VBlank arrives before `WAI`, the NMI finds
`nmi_pointer = run_incomplete_frame`: it only restores brightness and returns into the
unfinished logic (a "lag frame"). In practice this happens during room transitions while new
samples are uploaded to the sound CPU.

Two pointers drive everything: `game_mode_pointer` ($24) selects the screen (logo, title,
file select, world map, level, ...) and inside levels `game_sub_mode` picks the per-tileset loop.
For a ship-deck level (Pirate Panic) the loop is `ship_deck_game_sub_mode`:

```
input_and_pause_handler   read pads, handle pause
sprite_loader             spawn level objects that came near the camera
sprite_handler            run every live sprite (Kongs, enemies, items...)
camera_handler            move the camera toward its target, apply limits
handle_ship_deck_rigging_scroll / ship_deck_rigging_scroll_handler   BG3 rigging layer
horizontal_level_scroll_handler   stream newly visible tile columns into VRAM
render_sprites            build the OAM table for the next VBlank
handle_ship_deck_water_sky_scroll  parallax for sky/sea (BG2)
fade_screen               brightness fades
```

## 3. Sprites: one table, 25 slots

All game objects ("sprites" in Rare's code, not hardware sprites) live in a table at
`$0D84`, 25 records of `$5E` bytes (`struct sprite` in `structs.asm`). Slot 0 is auxiliary,
slots 1 and 2 are always Diddy and Dixie. Important fields:

| Offset | Field | Meaning |
|---|---|---|
| `$00` | type | Index into `sprite_main_table` (0 = free slot). |
| `$06`/`$0A` | x/y position | World pixels; `$04`/`$08` are the sub-pixel fractions. |
| `$12` | oam_property | Palette, priority, flip bits for drawing. |
| `$1A` | current_graphic | Which compound graphic to draw (index into `sprite_graphic_table`). |
| `$20`/`$24` | x/y speed | 8.8 fixed point. |
| `$2E`/`$2F` | state/sub_state | The sprite's own state machine. |
| `$36..$40` | animation_* | Animation script pointer, timer, speed. |
| `$54` | constants_address | Per-type constants in bank `$FF` (gravity, speeds...). |
| `$56`/`$58` | placement number/parameter | Which level-placement record spawned it. |

`sprite_handler` walks the 25 slots and jumps to each type's *main* routine
(`JMP (sprite_main_table,x)`); every main ends by jumping back through
`sprite_return_address`. After all sprites ran it resolves player interactions, moving
platforms and how the follower Kong trails the leader.

Objects are spawned from **init scripts** in bank `$FF`: a list of `(field offset, value)`
pairs plus a few commands (set animation, palette, OAM bits, spawn a child relative to this
one, load a sub-script...). `set_sprite_config` writes each pair by pointing the direct page at
the sprite record (`TCD`) — a neat trick to store a word at "sprite + offset" in one instruction.

## 4. Graphics

**Level layer (BG1).** A level is built from 32×32-pixel blocks:
- tile graphics (4bpp, Rare "Big Data" compressed), e.g. `ship_deck_level_tiledata`;
- *block definitions* ("8x8 tilemap" in the disassembly): 16 tilemap entries per block;
- the *layout* ("32x32 tilemap"): one block index per 32×32 cell, stored column by column
  (16 blocks tall for ship decks), with bit 14/15 flipping the whole block;
- `level_dimensions_table` gives each level's slice of the tileset-wide layout
  (Pirate Panic is columns `$0020-$1C00` of the Ship Deck layout).
Only a 512-pixel-wide window is in VRAM: as the camera moves, the scroll handler decodes the
next column of blocks and DMAs it into the ring-buffer tilemap during VBlank.

**Sprites.** Characters are pre-rendered (SGI workstations), so each animation frame is its
own bitmap. A "compound graphic" has an 8-byte header — number of 16×16 chunks, two groups of
8×8 chunks with their first tile, and the sizes of two DMA transfers — followed by a position
byte pair per chunk and the raw 4bpp tiles. Each frame, `render_sprites` emits one OAM entry per
chunk, and if the graphic changed since last frame the tiles are queued for DMA into the
sprite's fixed VRAM slot (`dma_queued_sprite_graphics`). That is why Diddy always uses the same
VRAM tiles while his picture changes every frame: the frames stream from the cartridge.

## 5. Animation

Every sprite runs an animation *script* (bank `$F9`) interpreted by `process_anim_script`:
entries of "show graphic N for T frames" plus commands (`animation_command_80..94`) that loop,
call code (turn around, spawn dust, play a sound, wait until grounded...), or branch. Movement
code sets the animation with `set_sprite_animation`; the script does the rest.

## 6. The Kongs

`diddy_kong_main` / `dixie_kong_main` run `kong_state_handler`, which dispatches on the Kong's
state through `kong_state_table` (80 states: idle, walking, jumping, rolling, team-up, carried,
climbing, swimming, riding an animal, hurt, dying, celebrating...). Shared helpers apply
physics (`handle_player_physics`: gravity, max fall speed, acceleration from
`get_x_acceleration`, terrain collision), read the pad (`kong_control` fields record when Y/B
were pressed and released, which is how roll-jumps and helicopter spins are timed), and select
animations. The inactive Kong follows the leader by replaying a trail of waypoints
(`handle_kong_follow`).

## 7. Terrain collision

Each tileset has a collision map: for every block, a description of its solid surface (flat,
slopes of various angles, ceilings, walls). `get_sprite_terrain_info` turns a world position
into "ground height and slope here", and `process_terrain_interaction` uses it to land, slide
on slopes, or fall. Every sprite that walks on the ground (Kongs, Klomps, barrels) goes
through the same code.

## 8. Sound

At boot `upload_spc_engine` sends Rare's SPC700 driver to the sound CPU using the IPL boot
protocol (byte-by-byte handshakes on `$2140-$2143`). When a level starts, its samples and song
are uploaded the same way (this is what makes room transitions take a few frames). During play
the CPU only queues commands: "play sound N on channel C", "start song", "fade".

## 9. What the cartridge holds

Assembling the disassembly with asar gives, for every source line, the address of the bytes it
emitted. Sorting the 4 MiB by the kind of line that produced them (`tools/rom_layout.py`):

| Kind | Bytes | Share |
|---|---:|---:|
| 65816 code | 188,392 | 4.5% |
| data | 3,925,210 | 93.6% |
| padding (zero) | 80,702 | 1.9% |

The data, by what it is (`assets/` folders):

| Data | Bytes |
|---|---:|
| sprite graphics (`gfx/sprite`: pre-rendered animation frames, uncompressed 4bpp) | 1,920,444 |
| inline tables (`bank_XX/`: sprite constants and init scripts, animation scripts, level configs, pointer tables, text) | 342,392 |
| level tile graphics (`levels/graphics`, compressed) | 301,657 |
| world maps, title/menu screens, level backgrounds (graphics + tilemaps + palettes) | 779,045 |
| sound samples (BRR) | 222,124 |
| level layouts (32x32 block maps) and block definitions (8x8 tilemaps) | 245,100 |
| songs (SPC700 sequencer data) and sound effects | 97,017 |
| collision maps, level palettes, misc | 17,431 |

So the "program" is under 5% of the cartridge; the rest is content. Two things in the data look
like code but are not 65816 code: the sound driver (SPC700 machine code uploaded to the sound
CPU, `bank_EE-F2/spc_*_engine.bin`) and the song data, which the driver interprets.

The port keeps only the data. The cartridge it plugs into the emulated hardware is rebuilt from
`assets/` with zeros where the code was, so addresses stay those of the original: a sprite's
`constants_address`, an animation script pointer or a DMA source are the same numbers as on the
console. A few places in the original read their own code as data (anti-piracy checksums and
compares, instruction operands used as constants, a DMA whose fixed source byte is an operand);
those are listed in PORTING.md ("ROM-free check").

---
*This document grows as the port advances.*
