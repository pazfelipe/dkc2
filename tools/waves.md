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
