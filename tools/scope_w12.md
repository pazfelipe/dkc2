# Scope for sprite/boss code: worlds 1 and 2

Port everything in your range EXCEPT sprite/boss code that only belongs to worlds 3-7, the
Lost World, the ending or the credits. When in doubt, port it. Ground truth: a routine that
appears in the call trace of worlds 1-2 play (`test/states/trace.json`, addresses in hex; check
with `python3 tools/coverage.py routines bank_XX.asm`) MUST be ported even if listed below.

Skip (not in worlds 1-2): crocodile_isle_props, kreepy_krow*, krocodile_kore*, kroc_kore*,
krool* (K. Rool), donkey_kongs_*, tied_up*, shot_donkey_kong, defeated_krool, spiked_canballs,
lilypad, king_zing*, chasing_king_zing, double_zingers, kudgel*, horizontal/vertical_wind_changer,
giant_tire, race_handler, racing_flag, web_shot, web_platform, squitter, rain_cloud, honey_splash,
skull_cart*, klank, kackle, haunted_hall*, gate_barrel, plus_and_minus_barrel, glimmer, kloak*,
thrown_kloak_projectile, screech, ghost_rope, cat_o9tails, krook*, credits_*.

Worlds 1-2 content (must work): Diddy/Dixie, Rambi, Enguarde, Rattly, Squawks, Squitter? (no),
barrels (DK, TNT, wooden, cannons, blast/auto barrels, checkpoint, bonus, warp), crates/chests,
hooks, ropes, balloons, coins (banana, DK, Kremkoin), KONG letters, level goal, Kong family NPCs
(Cranky, Funky, Swanky, Wrinkly), Klubba, enemies Neek, Click-Clack, Klomp, Klobber, Kruncha,
Kaboing, Klinger, Zinger, Flitter, Lockjaw, Flotsam, Shuri, Puftup, Kannon, Krockhead,
Mini-Necky, Snapjaw, Clapper, Klampon, Kutlass(check trace), Spiny(check trace), rideable hot-air
balloon, lava/water effects, bosses Krow and Kleever.
