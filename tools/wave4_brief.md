# Wave 4 brief: port worlds 3–7, the Lost World, bosses and the ending

Goal of the project now: the WHOLE game runs without the original code (later also without the
ROM). Worlds 1–2 are done: in their test states no original routine runs. Your package ports the
rest of the game's code in your scope so that no original routine runs in any state of the game.

## Before you start
1. `git merge master` in your worktree (to get the latest tools and lessons).
2. Read `/home/claude/dkc2-remake/PORTING.md` completely, including "Lessons from wave 1" and
   "Lessons from wave 2" (carry/flags that outlive a routine, CPU-time charging with `cpuTime`,
   capture tricks, known-bad states). Follow its rules: new files only under the bank folders,
   prefix your files with your package id, mandatory vector tests (`test/routine.ts`), frames
   regressions (`test/frames.ts`), `npx tsc --noEmit`, commit as you go.
3. Reuse existing helpers (`src/game/**/..._common.ts`, `..._util.ts`, `b80a_util.ts`) and the
   capture scripts of earlier packages in
   `/tmp/claude-0/-home-claude/b7df779d-1463-5569-b3b2-4768ebee58d0/scratchpad/{be1,b3a,bbb,b4,final,fixnpc}/`
   (copy into your own `scratchpad/<package>/`).

## Test states for the whole game
`test/states/all_<level>.state` exists for 146 levels of every world (levels, bonus rooms, warp
rooms, bosses), made by `test/make_all_states.ts` (level injected from the world-1 map). Bonus
rooms entered this way are not a natural path: several hang in the SPC wait loop on the original
code too, or behave oddly at their exit; do not chase those. World maps of worlds 3–7, Kong family
screens of other worlds and the ending have no states yet: create them if your scope needs them
(prefix `<package>_`). States must be saved at the end of a frame (CPU idle at $808652/3, $808D1C or
$B5D447/8) to be valid starting points for `frames.ts`.

`/tmp/claude-0/fallback_all.jsonl` lists, per all_ state, the ORIGINAL routines entered in 300
frames of a simple bot (one JSON per line: st, names, err). `test/fallback_scan.ts <state-regex>
[frames] [part/parts]` re-runs that scan with your code. A deeper trace of the original over all
all_ states is being merged into `test/states/coverage.bin` while you work (re-run
`python3 tools/coverage.py routines bank_XX.asm` later to see more executed code).

## Done means
- Every routine in your scope that runs anywhere in the game is ported and vector-tested (or marked
  untested with a reason), and `test/fallback_scan.ts` over the states of your scope shows none of
  your scope's routines running as original code.
- `pirate_walk` 1500 frames (input `R*60,R+Y*40,B*10,_*20,R*30,R+B*20,R*40,Y*5,R*30,D*10,R+Y*60,B*15,_*30,L*40`)
  stays identical, plus 400–600 frame runs from states of your scope are identical (or the
  difference is shown to be a state/harness artifact).
- Everything committed on your branch; do NOT merge into master.

## Shared machine
2 cores shared by 5 agents and a background trace: keep runs short (300–600 frames while
iterating), never `pkill`/`kill` by pattern (kill only PIDs you started), DKC2_STATES=/home/claude/dkc2-remake/test/states.

## Final report (concise)
Routines ported with vector results, untested ones (why), not ported (why), fallback scan result for
your scope, frames regression results, anything surprising, commit hash.
