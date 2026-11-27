# FUTSAL TACTICS WORLD — Milestone 6 continued: rotation and off-ball movement library

Act as a professional futsal tactical analyst, futsal coach, senior game AI developer and TypeScript
architect. Extend the existing game. This is **not a new milestone**: it is a continuation of
Milestone 6 (advanced futsal tactics), done before or as part of the still-open **stage 5**. Do not
add a numbered milestone to ROADMAP.md, do not restart or replace working systems.

Read before coding: `ROADMAP.md`, `TASKS.md`, `CHANGELOG.md` (Unreleased + Milestone 6 sections),
`TACTICS_DESIGN.md` (stages 1–4 and Planned), `AI_DESIGN.md`, `ARCHITECTURE.md`, and the code in
`src/ai/team/rotations.ts`, `src/ai/team/attacking.ts`, `src/ai/team/roles.ts`,
`src/ai/player/offBall.ts`, `src/ai/player/carrier.ts`, `src/ai/passing.ts`, `src/ai/movement.ts`,
`src/simulation/Tactics.ts`, `src/lab/scenarios.ts`, `src/rendering/AIDebugOverlay.ts`,
`tests/tactical/rotations.test.ts`, `tests/tactical/tacticalLab.test.ts`.

---

## 1. Where the project is (do not contradict this)

Already implemented and working — **extend, never duplicate**:

- Layered AI (M5): `ai/team` (attacking, defending, phases, pressing, roles, rotations), `ai/player`
  (carrier, goalkeeper, offBall), `ai/passing`, `ai/movement`, `ai/spatial/PitchControl` (2 m cells,
  cached), time-to-reach with turning (`estimateTimeToReach`), lane openness / pressure /
  `passInterceptable`, utility-scored carrier decisions, dynamic role assignment in attack and
  defence. Player decisions at ~10 Hz (difficulty-dependent, staggered), steering every tick, 60 Hz
  fixed-step deterministic simulation with seeded RNG, headless.
- Tactics in the match state: `TeamTactics { formation: '3-1' | '4-0' | '2-2', pressing: 'low' |
  'mid' | 'high', rotations: boolean }`, `DEFAULT_TACTICS = { '3-1', 'mid', rotations: true }`,
  changed with the `SetTactics` command, chosen in Quick Match and in the Tactical Lab.
- `ai/team/rotations.ts`: one move slot per team (`state.rotation[team]`), `rotationReadyAt`,
  `rotationStats` (started / completed per kind).
  - Patterns (continuous off-ball movement): `baseEight` = **pohjakasi** (3-1), `baseEightWing` =
    pohjakasi from the wing (3-1), `butterfly` = **perhonen** (4-0 same-side eight), `fourCircle` =
    the **4-player rotation** (4-0).
  - Combinations: `wallPass` (seinäsyöttö), `overlap` (kiertävä nousu), `pivot` (pivot comes short,
    far ala takes his place = pivotin paikanvaihto), `backPost` (takatolppa + front of the area).
  - Jobs: `run`, `wall`, `cover`, `drop`, `post`, `carry`, `switch`; a runner may go `via` a point.
  - Balance rule: one outfield player stays level with the ball or behind it. Completion: the ball
    reaches a runner (pattern also on a pass into the pivot). Cancellation: time limit, ball to a
    non-participant, possession lost, ball dead. Cooldown 2 s after a combination; patterns flow
    cycle to cycle. Zone 12–36 m from the goal attacked.
- Related behaviour already in place: carrier through balls into a runner's path, back-post square
  ball and low shot across, pivot support runs down the wing, side players dropping to get free,
  "no forced passes", runner tracking and goal-side pressing in defence, diamond defence shutting the
  lane into the pivot, pressing triggers, 2 v 0 back-post finish.
- Tactical Lab (12 headless scenarios incl. `baseEight`, `baseEightWing`, `butterfly`, `fourCircle`,
  `backPost`, `wallPass`, `overlap`, `pivotRotation`, `buildUpPress`), watch / attack / defend,
  speed 0.25×–1×, R resets, outcomes counted; AI view (key 7) shows intentions, marking, rotations
  with each player's job and pressing jumps.
- Settings persist in `localStorage` via `src/ui/store.ts`. Localisation `src/localization/fi.ts` +
  `en.ts` with translation keys.

**Not implemented yet — do not build these as part of this work** (they belong to M7–M9): full
tactical editor with presets UI, stamina drain, fouls / cards / dismissals, substitutions, flying
goalkeeper, 1-2-1 and power-play formations, Coach / Spectator / Career modes, training and
tactical familiarity progression, a teammate-run (call-for-run) command. Where the reference
specification mentions them, implement the hook in the data model only if it is cheap and has a real
effect now; otherwise note it in TASKS.md under the relevant milestone.

Preserve: controls, camera presets and vertical camera, Camera Lab, visuals (Retro Realism Futsal),
rules, difficulty levels, assistance levels, existing defaults, the human player's input being
authoritative, and the measured AI vs AI baselines in CHANGELOG.md (do not make pass completion,
turnovers or goals per 36 min clearly worse without saying so and why).

## 2. Goal

Turn the current rotation module into a **context-sensitive rotation library**: every movement is a
tactical intention with a purpose (create / occupy space, displace a defender, open a lane, overload,
penetrate, keep balance), chosen by utility against a **"keep the current shape" candidate**, reacting
to how the defenders actually respond. Not scripted animations, not fixed passing sequences. A decoy
run that opens a lane for someone else counts as useful. The ball carrier always takes a better
immediate opportunity over finishing a rotation.

## 3. Architecture (adapt to the existing code)

- Keep `ai/team/rotations.ts` as the entry point. When it grows, split into `src/ai/team/rotations/`
  (e.g. `definitions.ts` — immutable registry, `selection.ts` — utility + hysteresis,
  `coordination.ts` — runtime instance / state / jobs, `reservations.ts`, `balance.ts`,
  `spaceCreation.ts`). Re-export from the old path so imports and tests keep working. No parallel
  "second tactical engine".
- **Definitions** (immutable): id (keep the existing ids; add new camelCase ids), translation keys
  for Finnish and English name + short description, compatible formations (a weighting, not a ban),
  phases, participant jobs, trigger, target-space rules, pass opportunities, defender-response
  branches, completion / cancellation, duration, cooldown, risk, coordination difficulty.
- **Runtime instance**: keep one active coordinated move per team (current `state.rotation[team]`),
  extended with an explicit state `candidate → preparing → committed → executing →
  opportunityCreated → completed | cancelled → recovering → cooldown`. Individual movements that need
  no coordination (V-cut, between-the-lines, opposite movement) live in `offBall.ts` as per-player
  intentions and must respect the team move's jobs and reservations. Patterns may hand over into a
  combination (as now) — validated against the current context, never a guaranteed chain.
- **Selection** at ~5 Hz per team (simulation time, not browser timers), only plausible kinds,
  normalised factors: space creation, penetration, lane value, defender displacement, player
  suitability (existing attributes: `tacticalIntelligence`, `anticipation`, `decisions`, `vision`,
  `teamwork`, `creativity`, `positioning`, `passing`, `firstTouch`, `acceleration`, `agility`,
  `pivotPlay`, `soleControl`, `dribbling`), tactical compatibility, support quality, numbers,
  scoring chance — minus interception risk, congestion, transition risk, repetition, coordination
  difficulty. Weights depend on formation, phase, score / time, pressing height of the opponent,
  ball zone, balance and the new team settings. Commitment threshold + hysteresis. Deterministic
  tie-breaks.
- **Space reservations**: team, player, instance, purpose, region, ETA, duration, priority, expiry.
  They influence AI target choice only (not physical obstacles), are released on cancellation /
  possession loss, and are reassigned when a space closes, a teammate gets the ball, the human player
  moves into the region, or a higher-priority opportunity appears.
- **Balance**: reuse the existing balance rule; replace it with a scored evaluation (players goal-side
  of the ball, distance to own goal, opponent counter threats, central cover, recovery time). Riskier
  when losing late or with an aggressive setting; never a rigid stationary defender.
- **Defender reading** (observable state only, no hidden decisions): did the marker follow the runner,
  hold the space, hand over? Classify the opponent's defending as man-oriented / zonal / hybrid from
  observed behaviour over a rolling window. Defending AI stays independent; no rotation succeeds
  automatically.
- **Possession**: a pass in flight between teammates does not cancel a move; a real loss cancels at
  once, releases reservations and goes to the existing transition-to-defence behaviour.
- **Human player**: never moved by the rotation system. He can hold a role; his actual movement is
  authoritative; teammates re-plan when he dribbles, holds, passes elsewhere, shoots early, enters a
  reserved space or switches player. Rotations should simply produce recognisable pass options.
- Performance: no new per-rotation grids; reuse `PitchControl`, lane / interception helpers; cache per
  tick; avoid allocations in hot paths; same seed + commands = same result.

## 4. Team settings (minimal, functional, no full editor)

Extend `TeamTactics` (backward compatible, defaults reproduce today's behaviour as closely as
possible; `rotations: false` must still give a fully working basic AI):

- `rotationFrequency`, `rotationFreedom`, `positionalDiscipline`, `verticalPenetration`,
  `passingRisk`, `defensiveBalance`, `tacticalPatience` — 0–100 each, all with a real effect on
  selection / timing / risk (no decorative values; a test per setting showing a measurable change).
- Per-kind priority `off | low | normal | high` (sparse map, default normal).
- Six presets as data (Classic 3-1, Fluid 4-0, Direct, Spanish-inspired positional, Brazilian-inspired
  combination, Balanced compact — fictional styles, no real-team claims).
- UI: only a compact "Rotations" section in Quick Match setup and the Tactical Lab tactics panel
  (preset select + basic sliders behind an "advanced" toggle), persisted in `localStorage` like the
  other settings. The full tactical editor stays in M7.
- Familiarity: a per-team `familiarity` number (default sensible for Quick Match) that scales timing
  error / reaction delay — no training system.

## 5. Library — map to existing kinds, add the rest

Existing kinds are kept and upgraded to the new framework (behaviour tests must keep passing or be
updated with a stated reason). The 25 families:

| #  | Finnish                          | English                        | Status / implementation                                   |
| -- | -------------------------------- | ------------------------------ | --------------------------------------------------------- |
| 1  | Laidan tyhjennys                 | Wing clearance                 | new pattern; branches A–D (marker follows / stays / hands over / nothing → recycle) |
| 2  | Pohjakasi                        | Three-player base eight        | `baseEight` + `baseEightWing`; add inside / outside run, cross-court vs same-side, early penetration, safe recycle variants |
| 3  | Neljän pelaajan kasi (Oito)      | Four-player figure-eight       | extend `butterfly` (perhonen) into the 4-0 eight: two pairs, continuous cross-court, staggered depth — do not add a duplicate kind |
| 4  | Ristiinjuoksu                    | Cross run                      | new; staggered timing, no collisions, pass to the better runner, marking-exchange reaction |
| 5  | Diagonaalikierto                 | Diagonal rotation              | new pattern (wide pass + diagonal cut, refill)            |
| 6  | Rinnakkaiskierto                 | Parallel rotation              | new pattern (same-side exchange)                          |
| 7  | Kolmen pelaajan rotaatio         | Three-player rotation (3-1)    | umbrella profile over 2 + `pivot`, pivot keeps depth      |
| 8  | Neljän pelaajan rotaatio         | Four-player rotation (Quatro)  | `fourCircle`; add 2/3/4-player sub-rotations, triangle + 1, reform after failed penetration |
| 9  | Paralela                         | Parallel run and pass          | new combination using the existing through-ball-into-path logic; pass only if runner arrives first |
| 10 | Diagonaalijuoksu                 | Diagonal run and pass          | new combination (individual, distinct from #5)            |
| 11 | Seinäsyöttö                      | Wall pass                      | `wallPass`; wall may return, shoot, find a third man, hold, recycle |
| 12 | Kolmannen pelaajan liike         | Third-player combination       | new; C starts before the A→B pass when anticipation allows |
| 13 | Takatolppajuoksu                 | Back-post run                  | `backPost`; ETA-timed to the predicted delivery, not inside the goal |
| 14 | Kiertävä nousu                   | Overlap                        | `overlap`                                                  |
| 15 | Sisäkautta nousu                 | Underlap                       | new; never into an occupied pivot space                   |
| 16 | Pivotin pudotus                  | Pivot layoff                   | upgrade the existing pivot carrier logic: turn / shoot / layoff / other pass by attributes and pressure |
| 17 | Pivotin paikanvaihto             | Pivot exchange / temporary pivot | `pivot` + temporary pivot in 4-0 and 2-2               |
| 18 | Kaksoisleikkaus                  | Double cut                     | new, higher risk, needs balance                           |
| 19 | V-liike                          | V-cut                          | individual (offBall), reacts to whether the marker bit    |
| 20 | Vastaliike                       | Opposite movement              | individual pair rule, never the same receiving zone       |
| 21 | Laidan ylikuormitus              | Wide overload                  | new; keeps a weak-side option and a balance player        |
| 22 | Painopisteen vaihto              | Switch of play                 | new; direct / via deep man / via pivot / two-pass         |
| 23 | Jalkapohjajättö (pisada)         | Sole layoff                    | new carrier action using existing sole control; ball stays physical, interceptable |
| 24 | Tilan tyhjennys 1v1-peliin       | Isolation for 1v1              | new; uses `dribbling`, abandons if defenders don't follow |
| 25 | Linjojen väliin liikkuminen      | Between the lines              | individual; avoid cover shadows                           |

Share primitives (runner-with-ETA, refill-the-vacancy, layoff support, lane check, decoy) instead of
one bespoke AI per family; document which family uses which primitive. Formation profiles (3-1, 4-0,
2-2) weight selection; nothing is banned just because it comes from another formation.

Goalkeeper: weigh far-post runners and cross-goal balls without abandoning the near post. Defence:
follow runners, exchange marks on cross runs, protect lanes instead of chasing decoys, track back-post
runs, close a temporary pivot — on top of the existing runner tracking and diamond defence.

## 6. Debug, Lab, statistics

- AI view (key 7): active move name (localised), id, state, trigger, participants and jobs, planned
  paths (solid), possible passes (dashed), vacated space, reservations (amber, hatched for colour-blind),
  utility score + top rejected alternatives, balance score, ETAs, end reason. Off by default; aligned
  with every camera preset.
- Tactical Lab: a seeded scenario per new family (and keep the existing ones), opponent defending
  style (man / zonal / hybrid if the defending AI can be steered that way, otherwise the pressing
  heights), single-step and pause in addition to the existing speed control, a "demonstration" flag
  that may force the pattern — normal matches always select by context.
- Statistics per team per kind: attempts, completed, cancelled (+reason), space created, passes into
  created space, line-breaking passes, shots / goals within N s after a move, turnovers during a
  move, counter-attack shots conceded after a move. Completion ≠ success. Show a short summary in the
  match-end statistics only if it fits the current screen without clutter.
- Events: add typed events only for start / opportunity / complete / cancel; debug telemetry
  aggregated, never per tick.

## 7. Work order (commit after each stage, keep the game working between stages)

1. **Baseline**: run the existing AI vs AI measurements (pass completion, turnovers, shots, goals per
   36 min, final-third entries, spacing / congestion, useful pass options per carrier) for 3-1, 4-0,
   2-2 with rotations on and off, several seeds. Record them in TACTICS_DESIGN.md.
2. **Framework**: definitions registry, state machine, utility selection with the no-rotation
   candidate, reservations, scored balance, defender reading, team settings + presets, stats.
   Existing kinds ported with unchanged behaviour fingerprint where possible.
3. **Fundamentals**: 1, 2 (variants), 7, 9, 10, 11, 12, 13, 16.
4. **Advanced**: 3, 4, 5, 6, 8, 17, 18.
5. **Rest**: 14 (port), 15, 19–25, compound hand-overs, opponent-specific weighting, goalkeeper and
   defensive countermeasures, UI section, Lab scenarios, overlay, localisation.
6. **Measure again** with the same seeds, tune, fix the known Lab issue if the new framework touches
   it ("AI attackers lose the ball in 55–75 % of built-up Lab attempts; a carrier chased from behind
   passes back instead of driving on"), then stage 5's remaining items.

If the work cannot all be finished, stop at a stage boundary, keep everything green and list exactly
what is left in TASKS.md. Never mark a family done if it is only a scripted path or a Lab demo.

## 8. Tests (Vitest, `tests/tactical/`, seeded, measurable assertions)

Cover the reference scenarios where the feature exists now, e.g.: wing clearance with a following vs
a stationary marker; pohjakasi refills the deep slot; 3-player rotation keeps pivot depth; 4-0 keeps
width and staggered depth; cross runs never collide nor share a target; paralela only when the runner
arrives first; diagonal finds a valid lane; third man starts early; back-post ETA within a tolerance
of the delivery; pivot layoff picks a sensible support; pivot exchange refills depth; overload keeps a
weak-side option; switch exploits the far side; double cut keeps balance; V-cut adapts; pisada uses
ball physics; between-the-lines avoids cover shadows; loss of possession cancels and releases
reservations; human input never overridden and a human ignoring the intended pass is handled; mirrored
left/right and both attacking directions (both halves); "stay in shape" chosen when better;
`rotations: false` still plays; every setting changes behaviour measurably. Skip (and list in TASKS.md)
the ones that need unimplemented systems: substitution, dismissal, numerical disadvantage, fouls.
Run `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, `npm run test:e2e` (the smoke
test "quick match: move, pass, shoot…" is known to be flaky — rerun once before treating it as a
failure). Do not invent results.

## 9. Documentation

Update `TACTICS_DESIGN.md`, `AI_DESIGN.md`, `TASKS.md` (M6 stage list + known issues + items moved to
M7–M9), `CHANGELOG.md` (Unreleased, in the existing style with measured before → after numbers),
`GAME_DESIGN.md` if player-facing, `ROADMAP.md` only to reflect M6 scope (no new milestone). Create
`FUTSAL_ROTATIONS.md`: every family (FI/EN names, purpose, formations, triggers, behaviour, branches,
balance, cancellation, primitives used, tests, limitations), research references (FIFA Futsal
Coaching Manual and FIFA Training Centre futsal sessions, UEFA Futsal Coaching Manual, DFB futsal
material, futsal.tech, Total Football Analysis, taktiikkataulu.fi — verify availability, no copied
diagrams or text). Note that *Pohjakasi* and *Laidan tyhjennys* are this game's operational
definitions, not universally standard terms, and separate documented futsal principles from game
decisions.

## 10. Report at the end

Files created / modified, existing systems reused, families implemented (and which are partial),
baseline vs after measurements, test / build / e2e results, performance (tick time of the AI with the
library vs before, headless), remaining limitations, suggested tuning.

Begin with the reading and the baseline, then implement. Do not just produce another plan.
