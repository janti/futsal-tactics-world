# Futsal rotations and off-ball movement library

Technical reference for the rotation library (Milestone 6, continued). Code: `src/ai/team/rotation*.ts`,
`src/ai/player/individual.ts`; tests: `tests/tactical/rotationLibrary.test.ts`,
`tests/tactical/rotations.test.ts`, `tests/tactical/tacticalLab.test.ts`; measurements:
`npm run metrics` (`tests/metrics/`).

## 1. Principles and game decisions

**Futsal principles the library follows** (from the coaching literature listed in §9): rotations are
purposeful exchanges of responsibility, not choreography; a run can succeed without receiving the
ball (a decoy that opens a lane); width, depth, diagonal angles, ball-side support, a weak-side
threat and rest defence are kept; the ball carrier takes a better immediate chance over completing a
pattern; a static position can be the correct one.

**Game-specific decisions** (tunable, not coaching rules):

- Every move is a _plan_ (participants, jobs, targets) chosen by a utility score against a "keep the
  shape" candidate (§3). Targets are intentions; players reach them with the normal steering.
- One coordinated move per team at a time (`state.rotation[team]`). Individual movements (V-cut,
  between the lines) are per player and respect it.
- _Pohjakasi_ and _Laidan tyhjennys_ are this game's operational definitions; Finnish terminology is
  not standardised.
- The defenders are never told what the attack does: the runtime reads only observable positions
  (did the marker follow the runner?) and branches on it. The defensive AI is independent and is
  not changed by this library (§8).
- All timings are simulation time (60 Hz fixed step); same seed + commands = same result.

## 2. Architecture

| Module                        | Responsibility                                                                                                                                                                |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `team/rotationLibrary.ts`     | Immutable definitions: 25 families, runtime kinds, formation profiles, settings, presets, sanitising                                                                          |
| `team/rotationState.ts`       | Runtime types: the active move and its state, statistics, reservations, observed defending, individual moves                                                                  |
| `team/rotationSupport.ts`     | Shared geometry: space, paths, markers, depth, scored balance, required balance                                                                                               |
| `team/rotationPlanners.ts`    | One planner per coordinated kind: trigger and plan (participants, jobs, targets, staggered starts)                                                                            |
| `team/rotationSelect.ts`      | Utility selection: factors, weights, "keep the shape" score, family permission                                                                                                |
| `team/rotations.ts`           | Runtime: start, states, defender response, branches, reservations, completion / cancellation, statistics, events; carrier helpers (1-2, third man, switch, isolation, pisada) |
| `player/individual.ts`        | V-cut and between-the-lines movement                                                                                                                                          |
| `player/carrier.ts`           | Carrier options that execute moves (wall pass, link ball, switch, pisada, isolation challenge, link return)                                                                   |
| `player/offBall.ts`           | Executes jobs, waits for staggered starts, applies individual moves, keeps out of reserved spaces                                                                             |
| `rendering/AIDebugOverlay.ts` | AI view: moves, reserved spaces, vacated space, possible passes, score vs shape, response, end reason                                                                         |

Per tick (`updateAI`): phases → press triggers → **`updateRotations`** (outcome tracking, defence
reading at 1 Hz, active move: possession/time/human/tactics checks, preparing → executing, defender
response at +1 s, target reassignment, opportunity detection, advance; then selection) → player
decisions (~10 Hz) → steering (60 Hz). Team selection runs at about 5 Hz, and at once on a pass
(rotations of the formation are triggered by the pass to a side).

### Life of a move

`candidate → preparing → committed` happen in one selection step (plans scored; the best one beats
keeping the shape; balance checked; spaces reserved). The move then is `preparing` (runs wait
`(1 − familiarity) · 0.35 s + (1 − tacticalIntelligence) · 0.2 s`; a third of that for the passer of
a rotation), `executing`, `opportunity` (a runner within 3 m of his target, 2.3 m free, an open and
safe lane from the carrier), and ends **completed** (the ball reached a runner, the pivot or the
link chain; the 1-2 returned) or **cancelled** (time up, possession lost, ball dead, ball to someone
outside the move, no space, the human took over a participant, tactics changed). After a combination
the team is in `cooldown` (2 s × frequency factor × discipline factor); rotations of the formation
flow straight into the next cycle. A pass between teammates is not a loss of possession.

### Shared primitives

| Primitive       | What it does                                                                  | Used by                                                                                |
| --------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `passTrigger`   | A pass just played to a side starts the next cycle                            | all rotations of the formation (pohjakasi, 3-player, oito, quatro, diagonal, parallel) |
| `runWithEta`    | A runner's target that he reaches before any defender (time-to-reach model)   | paralela, diagonal run, third man, cross run, back post, wall pass                     |
| `refillVacancy` | The nearest teammate fills the space a runner left (or the deep slot)         | overlap, underlap, paralela, diagonal rotation, 3-player rotation, oito                |
| `decoy`         | A marked mover pulls his man; value scaled by how man-oriented the defence is | wing clearance, cross run, double cut, opposite movement, isolation                    |
| `layoffSupport` | A teammate comes to the lay-off spot behind the ball                          | pivot layoff, wide overload                                                            |
| `laneCheck`     | Lane openness + interception prediction (`passInterceptable`)                 | every pass into a run; switch of play; between the lines                               |
| `delayedStart`  | A run waits for `startAt` (staggered, timed)                                  | cross run, double cut, back post, familiarity delay                                    |
| `firstTimeLink` | A link player plays the ball on at once                                       | wall pass, third man, switch via the deep man, pohjakasi from the wing                 |
| `carrierAction` | The carrier starts the move with his own action                               | wall pass, pisada, isolation, pivot layoff                                             |
| `individual`    | Per-player movement without a team slot                                       | V-cut, between the lines                                                               |

## 3. Selection

`score = (gains − costs) / 2.5 + formation profile + patience + opponent adjustments + priority`,
with normalised factors (0..1):

- gains: space at the run targets, penetration (metres gained / 8), best lane from the carrier
  (the carrier's own marker does not shut a run that goes round him), defender displacement (marked
  movers × observed man-orientation), player suitability (anticipation, tactical intelligence,
  acceleration, decisions), support (safe options left outside the runs), local numbers, scoring
  value at the targets;
- costs: interception risk, congestion (targets near teammates, each other or reserved spaces),
  transition risk (1 − rest-defence score), stamina, repetition (same family in 15 s), coordination
  (× 1 − familiarity).

Weights move with the settings (penetration, passing risk, balance, discipline), the score and time
(chasing late: more penetration, less transition weight; protecting a lead: more), and the observed
opponent: a high block favours third man, 1-2, switch, diagonal run and paralela; a low block
between the lines, overload, switch, double cut and back post; man-oriented defending wing clearance,
isolation, cross run, opposite movement and diagonal rotation; zonal overload, switch, third man,
between the lines. The formation profile adds `(profile − 1) × (0.25 + 0.35 × discipline)`
(freedom softens penalties for moves from other formations); `low`/`high` priority −/+0.12, `off`
never. Short of players (dismissals later), moves with risk ≥ 0.3 are not allowed.

**Keep the shape**: `0.16 + (0.5 − frequency) × 0.4 + safe options / 3 × 0.1 − 0.06 when chasing
late`. A combination must beat it; a rotation of the formation (its normal movement) starts unless
keeping still beats it by 0.15. A combination may take over a rotation in progress only by beating
it by 0.12 (hysteresis). Ties keep planner order (deterministic).

### Team settings (0-100, every one changes the AI)

| Setting (FI / EN)                         | Effect                                                                        |
| ----------------------------------------- | ----------------------------------------------------------------------------- |
| Rotaatioiden määrä / Rotation frequency   | "Keep the shape" score, pause after a combination, family cooldowns           |
| Rotaatioiden vapaus / Rotation freedom    | Individual movement rate and reach, penalty of moves from other formations    |
| Asemakuri / Positional discipline         | Formation-profile weight, congestion weight, longer reset after a combination |
| Syvyyssuuntainen eteneminen / Penetration | Weight of penetration and scoring value                                       |
| Syöttöriski / Passing risk                | Weight of interception risk; lane needed for the rotation pass                |
| Puolustustasapaino / Defensive balance    | Rest defence required behind the ball; transition-risk weight                 |
| Kärsivällisyys / Tactical patience        | Rotations of the formation over quick combinations                            |
| Taktinen tuttuus / Tactical familiarity   | Preparing delay of the runs, coordination penalty                             |

Presets (fictional styles): Classic 3-1, Fluid 4-0, Direct futsal, Positional play
(Spanish-inspired), Combination play (Brazilian-inspired), Balanced compact. Quick Match and the
Tactical Lab have a compact panel (preset + three sliders; "Advanced": all sliders and a priority
per family), saved in `localStorage`. The full tactical editor is Milestone 7.

## 4. The 25 families

Formation weights are 3-1 / 4-0 / 2-2 (1 = native). Every family mirrors left/right and works in
both attacking directions (tests 24-25). "Balance" = the structural rest-defence requirement (one
outfield player not in the move level with the ball or behind it at the default setting).

| #   | Finnish / English                                | Kind(s)                      | Weights       | Trigger                                                                                                                                                                                                | Behaviour and branches                                                                                                                                                                                                    | Ends                                      |
| --- | ------------------------------------------------ | ---------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| 1   | Laidan tyhjennys / Wing clearance                | `wingClearance`              | 1.1/1/1       | wide man ahead of the ball marked within 2.3 m, a deeper teammate on that side, carrier with time, 10-30 m from goal                                                                                   | clearing man runs diagonally inside; at +1 s: marker followed → filler attacks the vacated wing; marker stayed → the clearing man is the option; marks handed over → whoever has more space; nothing → cancel (no space)  | ball to a runner / cancel                 |
| 2   | Pohjakasi / Base figure-eight                    | `baseEight`, `baseEightWing` | 1.2/0.8/0.6   | 3-1: middle man passes to a wing (runs up the middle and out to that wing; receiver carries inside) / a wing passes into the middle (runs up; middle man switches to the far wing if the switch is on) | cycle flows on with each pass to a side; interrupted by any better option of the carrier                                                                                                                                  | runner or pivot reached / next cycle      |
| 3   | Neljän pelaajan kasi / Oito                      | `butterfly` (perhonen)       | 0.7/1.25/0.7  | 4-0: central player passes to his wing                                                                                                                                                                 | runs up through the centre and back out wide, receiver carries inside; the other central player staggers his depth 1.5 m                                                                                                  | as 2                                      |
| 4   | Ristiinjuoksu / Cross run                        | `crossRun`                   | 0.9/1.2/1.15  | two attackers 2.5 m+ ahead on different sides, no defender right in front of the carrier, carrier pressure < 0.45                                                                                      | the two swap sides diagonally; the one with the shorter way starts 0.15-0.45 s later; carrier plays the runner with the best lane and most room; marks handed over are noted                                              | ball to a runner                          |
| 5   | Diagonaalikierto / Diagonal rotation             | `diagonalRotation`           | 0.9/1.15/0.9  | pass from the middle to a wing, passer marked (man-oriented defence), 3 m of space where he cuts                                                                                                       | passer cuts diagonally into the opposite half-space; the nearest teammate fills the deep central space                                                                                                                    | as 2                                      |
| 6   | Rinnakkaiskierto / Parallel rotation             | `parallelRotation`           | 0.85/1.15/1   | vertical pass up the same side to a teammate marked tight                                                                                                                                              | passer goes on up that channel; receiver comes inside and short; far side adjusts its depth                                                                                                                               | as 2                                      |
| 7   | Kolmen pelaajan rotaatio / Three-player rotation | `threeCircle`                | 1.2/0.6/0.5   | 3-1: a wing passes back into the middle and the far wing is marked (no quick switch)                                                                                                                   | wing goes up his wing; middle man carries towards it; far wing comes across behind the ball; the pivot keeps the depth                                                                                                    | as 2                                      |
| 8   | Neljän pelaajan rotaatio / Quatro                | `fourCircle`                 | 0.6/1.25/0.7  | 4-0: pass from one central player to the other                                                                                                                                                         | the ala on the passer's side moves between the lines; the passer goes wide                                                                                                                                                | as 2                                      |
| 9   | Paralela                                         | `paralela`                   | 1.1/1.1/1.15  | carrier on a wing with time (2.5 m free, nobody committed to him)                                                                                                                                      | a teammate behind/inside goes down the line; only if he reaches the spot before every defender                                                                                                                            | ball to the runner                        |
| 10  | Diagonaalijuoksu / Diagonal run                  | `diagonalRun`                | 1.1/1.1/1     | carrier pressure < 0.6, a teammate ahead with a reachable gap across the channels and an open lane                                                                                                     | individual diagonal run; the passer stays as balance                                                                                                                                                                      | ball to the runner                        |
| 11  | Seinäsyöttö / Wall pass                          | `wallPass`                   | 1/1/1.2       | carrier action: defender within 4 m in front, a wall 3.5-9 m away free by 2.4 m, space behind the defender, runner not beaten to it                                                                    | return only once the runner is past his man and the lane is safe; otherwise the wall plays on                                                                                                                             | returned / cancel                         |
| 12  | Kolmannen pelaajan liike / Third man             | `thirdMan`                   | 1.2/1.05/1    | 9-24 m from goal: a forward link B (2 m+ ahead, free, safe lane), C able to reach a free spot beyond B about when the ball could                                                                       | C starts at once (before the ball reaches B); A plays B; B plays C first time if the lane is open                                                                                                                         | ball to C                                 |
| 13  | Takatolppajuoksu / Back post                     | `backPost`                   | 1.1/1/1       | carrier wide within 14 m of goal                                                                                                                                                                       | back-post man starts so he arrives about with the predicted ball across (carry to ~10 m + 0.35 s + travel at 12 m/s); front man to the front of the area; swap after 1.5 s; target 2.8 m off the line (never in the goal) | ball to the post / runner                 |
| 14  | Kiertävä nousu / Overlap                         | `overlap`                    | 0.9/1/1.15    | wide carrier held up, his marker straight in front or inside                                                                                                                                           | run round the outside; the deepest is replaced                                                                                                                                                                            | ball to the runner                        |
| 15  | Sisäkautta nousu / Underlap                      | `underlap`                   | 0.9/1.1/1.1   | wide carrier whose marker stands outside him (closing the line)                                                                                                                                        | run through the inside channel; never into an occupied (pivot) space                                                                                                                                                      | ball to the runner                        |
| 16  | Pivotin pudotus / Pivot layoff                   | `pivotLayoff`                | 1.25/0.9/1.1  | most advanced man in the middle channel within 15 m, back to goal (or marked tight centrally)                                                                                                          | nearest teammate to the lay-off spot behind, another to the far post when balance allows; the pivot chooses (existing carrier options: shot when clearly better, lay-off, other pass)                                     | lay-off / runner reached                  |
| 17  | Pivotin paikanvaihto / Pivot exchange            | `pivot`                      | 1.2/1.05/1.1  | the most advanced man 6-7 m+ ahead, marked tight goal-side (3-1 pivot; temporary pivot in 4-0 / 2-2)                                                                                                   | he comes short; the far ala takes his depth                                                                                                                                                                               | ball to either                            |
| 18  | Kaksoisleikkaus / Double cut                     | `doubleCut`                  | 0.85/1.15/1.1 | carrier 8-19 m out with time                                                                                                                                                                           | near-post and far-post runs (second 0.2 s later); balance required                                                                                                                                                        | ball to a runner                          |
| 19  | V-liike / V-cut                                  | individual                   | —             | support player ahead of the ball, not the deepest, marked within 1.3-2.1 m (freedom), the carrier could find him at his spot                                                                           | step away 1.5 m (0.45 s), then burst into the spot; a marker who anticipated (closer to the spot) → check to the other side of him                                                                                        | received within the move                  |
| 20  | Vastaliike / Opposite movement                   | `oppositeMove`               | 1/1.05/1.2    | two attackers 3 m+ ahead, at least one marked                                                                                                                                                          | the nearer comes short towards the ball, the other goes in behind; targets 5 m+ apart                                                                                                                                     | ball to either                            |
| 21  | Laidan ylikuormitus / Wide overload              | `wideOverload`               | 1/1/1.15      | carrier wide 9-20 m out, the ball side short of men, not already winning locally                                                                                                                       | one short inside, one ahead on the ball side; the third keeps the weak side (switch + balance)                                                                                                                            | ball to any of them (a switch counts)     |
| 22  | Painopisteen vaihto / Switch of play             | `switchPlay`                 | 1/1.05/1      | the opponents' average shifted 1.5 m+ to the ball side, a far-side teammate 3.2 m free                                                                                                                 | straight across if safe (< 18 m, not interceptable), else through the deepest man who plays it on at once                                                                                                                 | ball to the far man                       |
| 23  | Jalkapohjajättö / Pisada                         | `pisada`                     | 1/1/1         | carrier action, carrier pressed (opponent within 2.6 m), a teammate 1.2-4 m away running past                                                                                                          | the ball is rolled (a real soft pass) into his stride, behind the carrier away from the presser, only if he gets there 0.3 s before anyone                                                                                | ball to the mate                          |
| 24  | Tilan tyhjennys 1v1-peliin / Isolation           | `isolation`                  | 1/1/1.05      | dribbling ≥ 62, wide or half-space 7-16 m out, one defender in front, nobody else within 4.5 m, not the last man                                                                                       | teammates near him clear 6 m away; the deepest stays; carrier takes the man on (forced challenge); valued by dribbling vs the defender's tackling                                                                         | beaten man / shot; cancel if help arrives |
| 25  | Linjojen väliin liikkuminen / Between the lines  | individual                   | —             | support player 3-12 m ahead of the ball, 5-22 m from goal, the defence not strongly man-oriented                                                                                                       | picks a pocket within 3 m: room, a lane from the carrier, defenders in front and behind; never a point in a defender's cover shadow or a reserved space                                                                   | received                                  |

**Compound moves** arise from the same selection: a rotation of the formation can be taken over by a
combination that clearly beats it (hysteresis); a combination's end lets the very next pass start a
rotation; the carrier may start a 1-2 or pisada over a combination built round him that has not yet
produced its opportunity. Nothing is chained as a guaranteed sequence.

## 5. Runtime details

- **Reservations** (radius 2.5 m, ETA, expiry with the move, priority 2 for runs): other players'
  support targets are pushed out of them and planners count them as congestion; they are released on
  any end. A runner whose target an opponent steps into (1.2 m) or the human walks into (2 m) picks
  the freest point on a ring round it (2.5 m, 3.5 m away from the human).
- **Human player**: never given a job; a plan with him as a mover is dropped; if control switches to
  a participant his job is removed (no run left → `humanControl`). He can be the carrier a move is
  built round; teammates re-plan on his choices.
- **Observed defending** (`rotationTeam[team].read`, once a second in possession): `follow`
  (EMA of markers staying within 3 m of an attacker who moved 2 m+) and `block` (their average depth).
- **Statistics** per kind: started, completed, cancelled (with reasons), opportunities, displaced
  (a runner's marker pulled 3 m+), shots and goals during or within 5 s after, turnovers during,
  opponent shots within 8 s of such a turnover. Completion is not success.
- **Events**: `RotationStarted`, `RotationOpportunity`, `RotationEnded` (in the match event stream,
  only on transitions — never per tick).

## 6. Tests (`tests/tactical/rotationLibrary.test.ts`, 30 tests)

Covered: 1-2 wing clearance branches (marker follows / stays); 3 pohjakasi family fills the deep
space; 4-5 pivot depth in 3-1 and width + staggered depth in 4-0 while rotating (AI vs AI); 6 cross
runs (different targets, staggered, never closer than 0.7 m); 7 paralela only when reachable first;
8 diagonal run lane; 9 third man starts before the link receives; 10 back-post timing; 11 pivot
layoff support; 12 temporary pivot in 4-0; 13-15 overload weak side, switch to the free side, double
cut balance; 16 V-cut reading the marker; 17 pisada is a real pass (no teleport); 18 between the
lines out of cover shadows; 19 + 23 cancel and release on possession loss; a pass in flight is not a
loss; 20-22 human never given a job, dribbling human, reserved target moves away from him; 24-25
mirror and both directions; 27 short of players; 28 marks handed over are read; 29 keeping the shape
wins at the lowest frequency; 30 rotations off still plays; every setting changes behaviour;
determinism and events. The Lab test runs every library scenario in demonstration mode.

Not covered (systems not in the game yet): 26 substitutions, fouls, dismissals (27 is tested by
taking a player out of the count).

## 7. Measurements (AI vs AI, `npm run metrics`; team 0 under test vs the default 3-1, 6 seeds × 6 min = 36 min; per 36 min)

| Formation, rotations | Pass completion | Turnovers | Shots | Goals | Conceded | Final-third entries | Pass options per carrier |
| -------------------- | --------------- | --------- | ----- | ----- | -------- | ------------------- | ------------------------ |
| 3-1 on — before      | 0.920           | 95        | 55    | 9     | 10       | 61                  | 0.57                     |
| 3-1 on — after       | 0.897           | 109       | 58    | 14    | 9        | 62                  | 0.56                     |
| 4-0 on — before      | 0.928           | 101       | 29    | 7     | 16       | 31                  | 1.08                     |
| 4-0 on — after       | 0.919           | 104       | 23    | 6     | 8        | 36                  | 0.95                     |
| 2-2 on — before      | 0.899           | 91        | 45    | 11    | 18       | 52                  | 0.73                     |
| 2-2 on — after       | 0.895           | 99        | 33    | 9     | 5        | 46                  | 0.68                     |

Noise: the same runs with rotations off for team 0 moved by up to ±10-20 % between the two code
versions (the opponent, which rotates, changed), so differences of that size are not significant.
Raw tables: `tests/metrics/results/baseline.json`, `final.json`. AI cost measured alone: about
0.27 s of CPU per simulated minute for both teams before and after (≈ 0.07 ms per tick); planners
take 0.1-2.6 µs each.

## 8. Known limitations

- The defending AI is unchanged: it already tracks runners, keeps men marked and shuts the pivot
  lane, but it does not read the attack's rotations as such (no explicit zonal/hybrid switching, no
  dedicated back-post tracker); goalkeeper behaviour for far-post threats is the existing one.
- Rotations on: the 3-1 loses the ball more often than before (turnovers +15 %, pass completion
  −2.3 points) while shooting about as often; the 4-0 and 2-2 are close to before in passing. Goal
  counts (5-16 per 36 min) are too small to compare. Tuning continues with the Lab.
- In normal (context) selection four library scenarios usually pick another move than the one they
  were built for (wing clearance → cross run, paralela → pivot exchange, isolation → back post,
  3-player rotation 5/12); they show their own move in demonstration mode. Attackers in the built-up
  Lab situations still lose the ball often (wing clearance 8/12 attempts).
- Tactical familiarity is a team setting only (no training or career progression yet).
- No teammate-run command (no input for it yet), no 1-2-1 or flying-goalkeeper formations, no
  stamina drain, substitutions, fouls or dismissals (M7); Coach / Spectator / Career modes are later
  milestones.
- The match-end screen does not show rotation statistics yet (they are in the state and the Lab).

## 9. Research references

Used for principles only; no diagrams, images, videos or text are copied. Availability of the links
was not re-checked in this session.

- FIFA Futsal Coaching Manual (FIFA Training Centre) and FIFA Training Centre futsal sessions:
  4-0 creating space in behind; 3-1 role of the pivot; using width; unopposed build-up.
- UEFA Futsal Coaching Manual.
- DFB futsal training material (Futsal-Info 3).
- futsal.tech — positional attack 4-0 (quatro).
- Total Football Analysis — using principles to coach futsal rotations.
- taktiikkataulu.fi — Finnish futsal exercises.
