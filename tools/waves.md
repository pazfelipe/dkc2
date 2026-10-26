# Porting waves (orchestration notes)

Wave 1 (running): b8a, b8b, b8c, b9bc, b5a, b5c, bba, b80a.

Wave 2:
- b5b: bank_B5.asm lines 4063–8982 (CODE_B5B3A3 .. CODE_B5DD37): includes terrain collision
  routines per tileset (CODE_B5C2DB..CODE_B5C82C family, get_sprite_terrain_info*), level map
  loading (CODE_B5BCA8, level_dimensions_table users), tileset/level init, world map init.
- bbb: bank_BB.asm lines 4740–9329 (CODE_BBA477 .. CODE_BBC8C8): sprite_loader and placement
  spawning, level config parsing, level/bonus transitions, misc engine.
- be1: bank_BE.asm lines 1–4692: BE sprite main handler and sprite codes (coins, kong letters,
  ...), throwable collision, HUD targets. World-1 relevant only (skip haunted hall, skull cart,
  klank, kackle, race, screech, giant tire, chasing king zing).
- be2: bank_BE.asm lines 4705–9421: sprite movement routines (process_current_movement,
  sprite_movement_routines, pace/patrol/orbit/home-in, gravity), terrain helpers.
- b3a..b3d: bank_B3.asm in 4 ranges (1–4224, 4307–8133, 8196–12101, 12174–15922) with the
  keep/cut lists below.
Wave 3: b80b (bank_80 4724–9279), b80c (bank_80 9302–13532), b4a/b4b (world map, menus,
Kong family screens), b6ba (boss framework + Krow from banks B6/BA).

## Scope update (user, 2026-10-24): worlds 1 AND 2
World 2 (Crocodile Cauldron): Hot-Head Hop, Kannon's Klaim, Lava Lagoon, Red-Hot Ride,
Squawks's Shaft, Kleever's Kiln (boss), Klubba's Kiosk. Move out of the cut list:
kleever* (boss), kleever_falling_canball, lava_splash, rideable_balloon (Red-Hot Ride), clapper
(Lava Lagoon), snapjaw (Lava Lagoon), krockhead? (no: world 3), mini_necky (Kannon's Klaim),
cat_o9tails? (no: world 3), spiny? (check), klampon (Kannon's/Lava?), kutlass? (check placement).
Rule: decide by the object placements of the world-2 levels (test states lvl_* to be added).
Wave 3 boss package: Krow AND Kleever.

## B3 sprite mains: world 1 keep / cut
Cut (other worlds, bosses other than Krow, credits): crocodile_isle_props, kleever*,
kreepy_krow*, krocodile_kore*, kroc_kore*, krool*, lilypad, king_zing*, chasing_king_zing,
kudgel*, horizontal/vertical_wind_changer, giant_tire, race_handler, racing_flag, web_shot,
web_platform, squitter, rain_cloud, honey_splash, skull_cart*, klank, kackle, haunted_hall*,
gate_barrel, plus_and_minus_barrel, glimmer, kloak*, thrown_kloak_projectile, screech,
clapper, krockhead, krochead_switch_barrel, horsetail, mini_necky, snapjaw, cat_o9tails, spiny,
klampon, kutlass, krook*, ghost_rope, rideable_balloon, credits_*, donkey_kongs_*, tied_up*,
shot_donkey_kong, defeated_krool, lava_splash, spiked_canballs, kleever_falling_canball.
Keep everything else (Kongs, animals, items, barrels, cannons, hooks, ropes, bonus/warp,
Kong family NPCs, Klubba, world-1 enemies: Neek, Click-Clack, Klomp, Klobber, Kruncha, Kaboing,
Klinger, Zinger, Flitter, Lockjaw, Flotsam, Shuri, Puftup, Krow).

## RESUMED 2026-10-25 02:10: wave 2 agents restarted on their branches (same worktrees).

## PAUSED 2026-10-25 01:10 (user request)
Wave 2 packages are paused, work committed on branches pkg/b5b, pkg/bbb, pkg/be1, pkg/be2,
pkg/b3a, pkg/b3b, pkg/b3c, pkg/b3d (worktrees in /home/claude/wt/<pkg>). To resume: send the
agent a message to continue (agent ids in the conversation), or start a new agent on the same
worktree with the original package prompt plus "continue from the commits already on your
branch; read `git log master..HEAD` first". Merge into master when each reports done.
Open bug: src/game/b5/b5a_sound.ts (ported SPC upload) hangs the boot at real APU speed in the
browser; it is disabled in src/game/index.ts until fixed.

## STATUS 2026-10-25 14:00: code migration of worlds 1-2 complete
All waves merged (1, 2, 3, final, fixes). Across 99 valid test states no original routine runs; the
frame regressions listed in the final report are identical to the original. Not ported (never
reached in worlds 1-2): boss_command_code_01 (unused), _03, _17, _1D, _1E, _1F (other bosses),
world 3+ / credits content.

## STATUS 2026-10-25 21:30: code migration of the WHOLE game complete
Wave 4 (w4_80, w4_b3, w4_b6, w4_be, w4_b4) merged. Fallback scan over 445 states: no original
routine runs (except two known-bad states where the original crashes too). 39 errors are state
artifacts (37 bonus rooms injected from the map hang in the SPC wait on the original too, the
Haunted Hall exit STP and w4_b6_kr_hp2 jump into garbage on the original too). Next: ROM independence.

## BACKLOG (user, 2026-10-25): run 100% without the ROM — after the code migration is complete
Goal: the game runs with no ROM at all, so every piece (logic AND data) is readable/editable in
the repo. Learning purpose; the repo stays PRIVATE because extracted assets are Nintendo/Rare's.
Steps (to plan in detail when we get there):
1. Asset extraction tool (one-off, run against the user's ROM): graphics -> PNG tilesets/sprite
   frames, palettes -> JSON, level maps/objects/configs -> JSON, text -> JSON, tables -> TS/JSON.
2. Replace every ROM read in src/game (rom8/rom16/rom24, bus reads of banks $80+/$C0+) with reads
   from the extracted data, routine by routine, with the oracle still comparing against the ROM.
3. Sound: the music/sfx driver runs on the SPC700 and is itself ROM code. Options: keep the driver
   binary as an extracted asset (simplest), or reimplement the sequencer in TypeScript (study value).
4. Optionally replace the PPU emulation with a TS/WebGL renderer fed by the extracted data.
5. Remove the ROM loader; the oracle/test harness keeps using the ROM for verification only.

## STATUS 2026-10-26: ROM independence (branch pkg/norom)
The game runs in the browser without the ROM: data extracted once into assets/ (tools/extract_assets.ts,
classification in tools/rom_layout.json), packed into public/dkc2-data.pak; the cartridge image has
zero where the original code was. Guard scans (test/norom_scan.ts, test/ref_code_reads.ts) and
frames.ts --norom regressions: see PORTING.md "ROM-free check".
