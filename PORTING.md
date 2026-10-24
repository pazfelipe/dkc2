# Porting guide

This project ports the game logic of **Donkey Kong Country 2 (USA, Rev 1)** from 65816 assembly
to readable TypeScript, routine by routine, in the style of the zelda3 port. The source of truth is
the community disassembly at `/home/claude/ref/dkc2dis` (assembles byte-for-byte to the ROM).
Graphics, music and data are read from the user's ROM at runtime; nothing from the ROM is copied
into the repository.

## Architecture in one page

- `hw/` — the SNES hardware the game talks to (PPU video, DMA/HDMA, APU sound CPU, bus), from
  LakeSnes (MIT), compiled to `public/hw.wasm`. **Our TypeScript plays the role of the 65816 CPU.**
- `src/core/mem.ts` — WRAM/ROM/bus/MMIO access. WRAM has exactly the original layout, so every
  variable lives at its original address (`src/gen/ram.ts`).
- `src/gen/routines.ts` — one generated **stub** per routine label of the original game. Calling a
  stub runs our TS port if one is registered, otherwise the **original** routine on a reference
  65816 (hybrid mode). The reverse also works: when original code enters a ported routine it traps
  into TS. So every routine you port takes effect everywhere immediately.
- `src/game/**` — the port. One folder per original bank (`b80`, `b3`, `b5`, `b8`, `b9`, `bb`,
  `bc`, `be`, `b4`, `b6`, `ba`), files grouped by topic. Each file ends with `register({...})`.
- `test/` — the oracle: the same wasm also contains the reference CPU running the original game,
  so every ported routine is checked byte-for-byte against the original.

## Your job

Port the routines in your assigned line range of one `bank_XX.asm` file. Prioritise routines that
actually run (see "Coverage" below), then the rest of the range. Do not port routines outside your
range: call them through their stubs.

For each global label in your range that is code: write a TS function with **exactly the label's
name**, a JSDoc line with its original address (e.g. `/** $B8D5E5 — ... */`), and register it.
Sublabels (`.foo` inside `bar`) are flattened as `bar_foo` in the symbol table; only make them
separate exported/registered functions when other routines enter them directly (JSR/JMP/JSL/JML
to the sublabel, or a code-pointer table lists them). Otherwise they are just code inside the
parent function.

Write idiomatic, readable TypeScript: structured `if`/`for`/`switch`, meaningful local names,
short comments explaining *what and why* (game-design meaning when you can tell). Keep the
original routine boundaries and names; do not invent abstractions that change behaviour.

## Calling convention (important)

Routines take no parameters and return nothing; values pass through the same CPU registers the
original used, via the global `reg` from `src/core/cpu.ts`:

```ts
import { reg } from "../../core/cpu";
import { apply_position_from_velocity, get_sprite_terrain_info } from "../../gen/routines";

reg.x = r16(R.current_sprite);   // LDX current_sprite
apply_position_from_velocity();  // JSR apply_position_from_velocity
if (reg.c) { ... }               // BCS ...
```

- `reg.a`, `reg.x`, `reg.y`: 16-bit values (mask with `& 0xFF` where the original ran 8-bit).
- `reg.c`, `reg.z`, `reg.n`, `reg.v`: set them on exit **when callers branch on them** right after
  the call (look at the call sites in the disassembly). Carry results are very common.
- On exit, leave in `reg.a/x/y` what the original leaves there if any caller uses it.
- `reg.db`: the data bank. If the original routine changes DB (PHK/PLB, `%pea_*`) and does **not**
  restore it before returning (common in sprite mains), set `reg.db` to the bank it leaves.
- `reg.mx`: if the original returns with a different M/X width than it was entered with (e.g.
  ends with `SEP #$20` then `RTS`), set `reg.mx` (bit0 = 8-bit A, bit1 = 8-bit index). Rare.
- Values passed between routines in **direct-page temporaries** (`$32`, `$34`, ... `temp_*`) must
  be written to WRAM (`w16(0x32, v)`), because the callee may be original code. Purely local
  scratch can be a JS local variable.
- Calls: always call other routines through the stubs imported from `../../gen/routines`
  (or your own module's functions directly). Never import another bank's module.

## Memory and data API (`src/core/mem.ts`, `src/core/sym.ts`)

- WRAM: `r8 r16 rs16 w8 w16` with 16-bit addresses (bank $7E implied) or full `$7E0000-$7FFFFF`.
  Names: `R.<ram_name>` (e.g. `R.active_kong_sprite`), struct field offsets `sprite.x_speed`,
  `kong_control.gravity_force`, `level.song`, `sprite_table.slot_1`, ... (all in `src/gen/ram.ts`).
  A sprite is addressed by its WRAM base, exactly like X held it: `r16(x + sprite.x_position)`.
- ROM: `rom8 rom16 rom24 romS16` with 24-bit addresses; labels via `L("DATA_B5BB6D")`.
  Resolve labels **once at module level** (`const T = L("...")`), not in hot loops.
- Long indirect pointers that can target RAM or ROM (`LDA [$32],y`): `bus8 bus16 bus24 busW8 busW16`.
- Hardware registers: `io8(PPU.screen, v)`, `io16(...)`, `ioR8(...)`; names in `PPU`, `CPU`, `DMA`,
  `HDMA`, `joypad`, `APU` groups (`src/gen/ram.ts`). Writing `CPU.enable_dma` ($420B) runs the DMA
  immediately. Use the exact register sequence of the original (it drives the real PPU/DMA).
- Constants: `C.<define_name>` from constants.asm (e.g. `C.level_pirate_panic`).
- 65816 helpers in `src/core/ops.ts`: `adc16/sbc16/adc8/sbc8` (+`flags.c/v`), `cmpC`, `neg16`,
  `xba`, `rol16/ror16`, and `waitUntil(cond)` for busy-waits on hardware ($4212, APU ports).

### Address resolution rules
- Absolute `$xxxx` < `$2000` is always WRAM. `$2100-$21FF`, `$4200-$43FF` are MMIO.
- Absolute `$8000+` reads ROM **in the current data bank** (DB). Check what DB is at that point
  (PHK/PLB = the code's bank; `%pea_shift_dbr(label)`/`%pea_engine_dbr()` macros in macros.asm).
- WRAM `$2000-$FFFF` is only reachable with DB=$7E/$7F or long addressing (`$7Exxxx`, `.l`).
- Direct page: DP is normally 0, so `$32` is WRAM `$0032`. After `TCD`, DP-relative operands are
  relative to the new base (DKC2 does this to point DP at a sprite record or a buffer).

### 8-bit vs 16-bit
Track `SEP #$20` / `REP #$20` (A width) and `#$10` (index width) carefully: 8-bit loads/stores
touch one byte, arithmetic wraps at $FF, and the hidden high byte of A (B) is preserved (it
matters after `XBA` or a later `REP #$20` + use of A). `INC`/`DEC` on memory follow the width.

### Control-flow idioms
- `JMP (table,x)` / `JSR (table,x)`: `callPtr(bank, rom16(TABLE + x))` (from `src/core/cpu.ts`).
  `JML [ptr]` / `JMP (ram_ptr)`: `callAddr(...)` / `callPtr(...)` with the RAM value.
- Sprite main routines end with `JML [sprite_return_address]`: in TS just `return`.
- Return-address tricks (`PLA`/`PHA` of return addresses, `%return(label)` pushes): restructure
  into ordinary calls/returns and explain in a comment.
- Code that ends the frame (falls into the `WAI` loop, e.g. `game_sub_mode_return` paths):
  call `endFrame()` from `src/core/hybrid.ts` and return.
- Shared tails (`BRA` into another routine's middle): call that code as a function (local helper
  or stub of a sublabel) — keep behaviour identical.

## Testing (mandatory)

Each worktree shares test states through `DKC2_STATES=/home/claude/dkc2-remake/test/states`
(set it in every command). Available states: `title`, `file_select`, `player_select`,
`world_map`, `pirate_start`, `pirate_walk`, `pirate_run`, `pirate_jump` (more may appear: `ls`).

1. Capture real call vectors from the original game (once per routine):
   `DKC2_STATES=... npx tsx test/routine.ts capture <label> --from pirate_walk --count 8 --skip 5 --frames 3000 --input "R*60,R+Y*40,B*10,_*20,L*30"`
   (`--input` loops; tokens: R L U D B Y A X S(start) SEL, `+` combines, `*n` frames, `_` idle).
2. Compare your port with the original on every vector:
   `DKC2_STATES=... npx tsx test/routine.ts test <label> [--jsr] [--ret a,x,y,c] [-v]`
   Use `--jsr` when the routine returns with RTS (`--jsl` default = RTL). `--ret` lists the
   registers your port must reproduce. WRAM outside the direct page, VRAM, CGRAM, OAM and SRAM
   must match exactly; direct-page differences are shown with `-v` (scratch is fine).
3. Whole-frame regression (must stay identical):
   `DKC2_STATES=... npx tsx test/frames.ts --from pirate_walk --frames 1500 --input "R*60,R+Y*40,B*10,_*20,R*30,R+B*20,R*40,Y*5,R*30,D*10,R+Y*60,B*15,_*30,L*40"`
4. `npx tsc --noEmit` must pass.

If a routine never runs in the available states, port it carefully anyway and mark it "untested"
in your report. You may create new states (see `test/make_states.ts`) under the shared dir with
names prefixed by your package id.

## Coverage

`python3 tools/coverage.py routines bank_XX.asm` lists every label with executed/total
instructions in the traced scenarios — port executed ones first.
`python3 tools/callgraph.py refs <label>` shows who calls a label and what it calls.

## Workspace rules

- You work in your own git worktree. Before running anything:
  `ln -sfn /home/claude/dkc2-remake/node_modules node_modules` and
  `python3 tools/gen_index.py` (regenerates `src/game/index.ts`; rerun after adding files).
- Only create/edit files under `src/game/<your bank folder>/` (new files only, named by topic,
  prefixed so they don't clash with other packages, e.g. `b8/kong_states_a.ts`). Do not edit
  `src/core`, `src/gen`, `hw`, `test` infrastructure, or other packages' files. If you believe
  infrastructure needs a change, describe it in your report instead.
- Commit your work in your worktree (`git add -A && git commit -m "..."`) as you go.

## Report

End with: files created; routines ported with test results (`label: N/N vectors` or
`untested`); routines in your range you did not port and why; anything surprising (stack
tricks, self-modifying code, timing dependencies, suspected disassembly mislabels).
