# Tactics Design

## Implemented

- **3-1** templates in normalised team-relative coordinates (`ai/positioning/Formation.ts`):
  `attack`, `defend`, `kickoffOwn`, `kickoffOpp`. Roles: GK, Fixo, Ala (left/right), Pivot.
- Ball-oriented blending: the block slides along the length (attack 55 %, defend 50 % of the ball's
  depth offset) and towards the ball laterally (30 % / 40 %); defending shapes are narrower.
- Anchors are reference positions only; players move to them with acceleration-limited steering
  and never teleport.

## Milestone 6, stage 1: tactics model, formations, pressing height

- `simulation/Tactics.ts`: `TeamTactics { formation, pressing }` in the match state
  (`state.teams[i].tactics`), set from the match setup, the team's own style (`TeamDefinition.tactics`)
  or defaults (3-1, mid), and changed during a match with the `SetTactics` command.
- **Formations** (attacking shapes; the roles keep their names):
  - `3-1`: fixo, two alas, a pivot up front who roams (middle / ball-side wing / far side).
  - `4-0`: the fixo and the pivot are the central pair of a flat four, alas wide; nobody fixed up front.
  - `2-2`: back pair fixo + ALA_R, front pair ALA_L + pivot. Defends in a box instead of the diamond.
- **Pressing height** (`PRESSING` table): the distance from the own goal at which the carrier is
  engaged tightly (low 15 m, mid 22 m, high everywhere), the highest point of the block (team-relative
  depth 0.42 / 0.68 / 0.82), a low block standing off further and not following men out of the block,
  a high press marking tight and following men further.
- Quick Match: the human team chooses formation and pressing; computer teams play their style (e.g.
  Spain 4-0 high press, Kazakhstan 2-2 low block).
- Measured (team 0 with the tactic vs default, 6 x 3 min): attacking top gap 3-1 7.8 m, 4-0 2.1 m,
  2-2 2.9 m; defensive depth low 13.9 m, mid 16.4 m, high 20.8 m from the own goal; a high press
  produced 39 shots against 18.

## Milestone 6, stage 2: pressing triggers

- `ai/team/pressing.ts`: the defending team waits for a cue and then jumps for 1.6 s
  (`state.pressTrigger[team]`): the presser goes in tight wherever the ball is, a second man comes to
  trap the carrier (also beyond the own half), everybody else marks tight, the pressers sprint in.
- Cues: a back pass towards their own goal (to the keeper or the deepest man — the press goes to the
  receiver while the ball travels), a carrier who has just received facing his own goal, a ball that
  got away from an opponent (poor touch), the carrier by the touch line (the trap: the second man
  shuts the line and the pass along it, the first the way inside).
- The pressing height gates the cues: within 21 m of the own goal for a low block, 30 m for the
  mid-block, 45 m for a high press.
- Measured AI vs AI (mid, 6 x 3 min, both teams): back to goal 210 cues (ball won within 3 s 45 %),
  back pass 112 (27 %), touch line 23 (70 %); a high press reacts to more cues and wins more, a low
  block to fewer.

## Milestone 6, stage 3: rotations and combinations

A **rotation** is the continuous off-ball movement of a formation: the ball is passed to a side, a
player moves up into space following the pattern and the receiver looks for him (or the pivot); if
nothing is on, the ball goes to a side again, the next cycle starts and the players end up back in
the shape. A **combination** is a two- or three-man move where space opens. (The first version of
stage 3 called the combinations "rotations" and had no continuous rotation; corrected after review.)

- `ai/team/rotations.ts`: both use one slot per team (`state.rotation[team]`) with named
  participants, each with a job (`run` into space — possibly via a first point, `carry` the ball
  inside, `switch` it on at once, `cover` a space, `drop` short, `wall` for a 1-2, `post` in front of
  goal) and a target. A move ends **completed** when the ball reaches a runner (a rotation also on a
  pass into the pivot; the wall pass when the passer has it back), and is **cancelled** when the time
  runs out, the ball goes to somebody outside the move, possession is lost or the ball goes dead. A
  rotation cycle ends with the carrier's pass and that pass starts the next cycle at once; a
  combination is followed by a 2 s pause. Runners who did not get the ball go back to the shape (the
  dynamic roles fill it from where everybody is).
- **Rotations** (between 12 and 36 m from the goal attacked; the carrier's "pass to a side" option is
  above plain circulation and below a forward pass, and a 1 v 1 there gives way to it):
  - **Pohjakasi** (`baseEight`, 3-1): the middle man of the back three passes to a wing and runs first
    up the middle and then out to that wing, ahead of the receiver. The wing carries the ball inside
    into the middle and looks for the pivot or the runner; if neither is on he passes to a side (the
    other wing, or back to the runner) and — now the middle man — makes the run himself.
  - **Pohjakasi from the wing** (`baseEightWing`, 3-1): a wing passes into the middle and runs
    diagonally up into the middle; the middle man switches the ball at once to the other wing and
    moves across into the wing the runner left. The far wing plays the runner (a 1-2), opens the play,
    or carries inside / passes on, and everybody is back in place.
  - **Perhonen** (`butterfly`, 4-0): a central player passes to his own wing, runs up through the
    centre and comes back out to that wing; the receiver carries inside into the central lane he left
    and passes to his neighbour or to a wing — next cycle, often on the other side (the two wings).
  - **4-player rotation** (`fourCircle`, 4-0, as described by futsal.tech): a pass from one central
    player to the other; the passer goes out to his wing to keep the width and the ala on his side
    moves in between the lines.
- **Combinations**:
  - **Wall pass (1-2)**, chosen by the carrier (more often by a creative player), also out of a
    rotation: a defender close in front, a free teammate 3.5–9 m away with a clear lane, space behind
    the defender and nobody beating the runner to it. He plays it in and runs past the defender on the
    wall's side; the wall returns it first time into his path.
  - **Overlap**: a wide carrier held up by his marker; the teammate 2–9 m behind on that side runs
    round the outside down the wing. In a 3-1 or 4-0 only from 22 m in (further back the rotation
    runs); in the 2-2 from 27 m.
  - **Pivot switch** (`pivot`, 3-1): the pivot marked tight comes short into the space in front of the
    ball (he gets it to feet when free); the far ala runs into the space he left and becomes the pivot.
  - **Back post**: the ball on a wing within 14 m of goal — one man attacks the back post (first-time
    finish), another the front of the area; after 1.5 s without the ball across they swap. It takes
    over from a rotation that reaches a wing near goal.
- **Balance**: one outfield player who is not a runner stays level with the ball or behind it (in
  the pohjakasi the far wing holds the base line; the pivot stays up).
- `TeamTactics.rotations` switches both families on or off (on by default). Started/completed counts
  per team and kind: `state.rotationStats`.
- Measured AI vs AI (8 × 3 min per formation, both teams; cycles or moves started / completed):
  - 3-1: pohjakasi 343 / 138, from the wing 158 / 54, wall pass 41 / 18, overlap 53 / 23, pivot
    switch 60 / 28, back post 179 / 52. Shots 225 → 209, goals 49 → 44 (about unchanged), turnovers
    578 → 648 (+12 %).
  - 4-0: perhonen 548 / 157, 4-player rotation 239 / 38, wall pass 64 / 27, overlap 87 / 29, back
    post 105 / 29. Shots 61 → 97, goals 10 → 21, turnovers 431 → 534 — the flat four needed the
    movement most.
  - 2-2 (combinations only): overlap 186 / 77, back post 203 / 75, wall pass 19 / 6; shots 188 → 209,
    goals 43 → 41.
- Side effect fixed on the way: with players up the court after a move the keeper's arced throws
  were cut out more often. The keeper now counts the throw's time in the air (a receiver already on
  the spot has to wait for it; the human player arriving as it drops takes it) and, with the ball in
  his hands and every throw risky, waits up to 2.5 s for somebody to get free.

### Passing: patient build-up, easy balls to a side

- The pass to a side keeps the rotation going and comes early (after 0.35 s on the ball, before the
  pressure arrives): to a man free by 2.5 m with a clear lane, safe from interception, about 8 m
  away. Plain circulation also comes sooner (after 1.1–1.6 s with space, not 1.6–2.4 s).
- Not too quickly vertical: in the build-up (more than 17 m from goal) a rotating team plays a ball
  forward only when it is clearly safe (receiver free by 2.6 m, lane 1.3 m, no extra risk allowed),
  and below the pass to a side. The ball into the pivot's feet needs a 1.4 m lane, a marker right
  behind him (one beside him steps in front) and no extra risk — until then the rotation goes on.
  A through ball needs 3 m of space at its end.
- Pressed tight (an opponent within 1.6 m), a pass past the presser counts as unsafe and the ball
  goes away from him at once (the pass he cannot get to). The quick switch to the far wing only
  when it is short (under 13 m) and the far wing free by 3 m with a clear lane.
- Measured AI vs AI (6 × 3 min per formation, both teams; before → after this and the rotation
  change): 3-1 pass completion 86.3 % → 90.1 %, turnovers 428 → 359, shots 163 → 171, goals
  34 → 36; 4-0 90.4 % → 92.2 %, turnovers 345 → 331, shots 60 → 98, goals 12 → 26. Passes into the
  pivot: fewer (3-1: 170 → 95) but 86 % arrive (was 62 % right after the rotation change).
  Regression test: `tests/tactical/passCompletion.test.ts`.
- Side support (`supportPosition`): in the build-up a wide player beside the ball gets free for the
  easy pass — extra spots 1.5–4.5 m below his place (and a touch wider) and 2.5–3 m away from his
  marker; an open lane counts most (×1.4), then being free (up to 5 m), and he stays level with the
  ball or just below it (high up the wing he is marked and the lane goes through his marker).
  Measured (support players beside a central carrier, 4 matches): 3-1 3.35 → 3.57 m from the nearest
  opponent, free by 2.5 m 61 % → 66 %, lane 0.99 → 1.11 m; 4-0 3.71 → 4.04 m, 73 % → 78 %, the
  easy pass to a side on 52 % → 59 % of the time. Pass completion 3-1 90.1 → 90.2 %, 4-0 92.2 →
  93.9 %, turnovers 359 → 343 and 331 → 298. In the 3-1 the diamond's ala follows the wing down (the
  easy pass is on about 23 % of the time either way).

### No forced passes

- The middle man of a rotating team (3-1 / 4-0) in the build-up waits for a lane instead of driving
  into the block: with space in front he walks it up (30 % pace, ball on the sole with an opponent
  near) while the others rotate and get free; the pass goes when it is on.
- A pass is not forced: the "best pass" under pressure and the escape pass away from a tight presser
  are played only if nobody can step into them even reacting at once (no read delay, the presser
  included) and the receiver has 1.6 m of room. Otherwise he keeps it — shields, waits, and only when
  pinned for long knocks it out for a kick-in. The escape pass no longer goes to a keeper who may not
  touch the ball again (the futsal second-possession rule): those balls rolled past him.
- Measured AI vs AI (6 × 3 min, both teams; before → after): 3-1 pass completion 90.2 → 93.7 %,
  turnovers 343 → 286, escape passes 60 → 92 % completed; 4-0 93.9 → 94.5 %, turnovers 298 → 281.
  Fewer turnovers also mean fewer counter-attacks: shots 3-1 161 → 121, 4-0 82 → 67 (shots per
  possession about the same).
- Test: the pohjakasi middle man with every lane shut (markers held tight) keeps the ball and walks
  (`tests/tactical/passCompletion.test.ts`).

## Milestone 6, stage 4: Tactical Lab and the AI view

- **Tactical Lab** (title screen → Tactical Lab): set situations placed straight into a running match
  (`lab/scenarios.ts`, headless, so the tests use the same scenarios): breakaway (1 v 0), two on the
  keeper (2 v 0), counter-attack 3 v 2, overlap, wall pass, pivot rotation (3-1), 4-0 rotation, back
  post, build-up against a high press. Positions are written from the attackers' point of view and
  mirrored onto either team.
- The panel: the situation, you (watch / attack — you have the carrier / defend — you get the defender
  nearest the ball), the attacking formation, the defenders' pressing height, rotations on/off, speed
  (0.25× / 0.5× / 1×), start again (R) and automatically after each attempt. Every attempt ends as
  goal, saved, out, ball lost or time up (per scenario limit, 6–10 s); the outcomes and, for the
  rotation scenarios, how often the rotation started and was completed are counted.
- **AI view** (key 7, also in the Lab panel) drawn over the main view: each computer player's state
  (run, support, press, to the ball, mark, intercept…) above his head — the carrier also his decision
  — and a dashed line to where he is going, a solid line from each defender to the man he marks, the
  rotation in progress (amber arrows with each participant's job), a ring round the target of a
  pressing jump, and a line per team with its phase, rotation (time left) and pressing cue. Pitch
  control stays on the radar.
- What the Lab showed, and fixed on the way: the pivot and 4-0 rotations hardly ever started because
  the run was "blocked" by the runner's own marker (or the pivot's) — markers now do not block the run
  they are being run away from; the wall pass was often played into a covering man who arrived at the
  end of the run with the ball — now the runner must not be beaten to the spot (the wall's own marker
  reacts 0.5 s late). Wall pass completion in play 30 % → 43 %.
- Lab results (20 attempts each, computer vs computer): breakaway 14 goals, 2 v 0 18 goals. The
  rotation scenarios start their rotation in every attempt and keep it going: pohjakasi 60 cycles
  (29 completed), from the wing 30 (8), perhonen 61 (13), 4-player rotation 64 (17); the combination
  scenarios start theirs in 14–20 attempts out of 20.
- Open finding: in the built-up situations (counter 3 v 2, rotations, build-up) the attackers lose the
  ball in 55–75 % of the attempts. One cause seen in the wall pass: the runner who has the ball back
  past his man passes it back under pursuit from behind instead of driving on (the chaser counts as
  pressure). To be worked on with the Lab.

## Milestone 6, continued: rotation and off-ball movement library

The rotations and combinations of stage 3 became a library of 25 movement families chosen by
utility against keeping the shape — full reference in **FUTSAL_ROTATIONS.md**.

- Existing kinds kept and upgraded: pohjakasi (and from the wing), perhonen (now the 4-0 oito: the
  other central player staggers his depth), the 4-player rotation (quatro), wall pass, overlap,
  pivot switch (now also a temporary pivot in 4-0 / 2-2), back post (now timed to the ball across).
- New: wing clearance (with branches on the marker's response), 3-player rotation, diagonal and
  parallel rotations, cross run (staggered), paralela, diagonal run, third man (runner starts before
  the link has the ball), underlap, pivot layoff, double cut, opposite movement, wide overload,
  switch of play, pisada (a rolled pass), isolation; individual V-cut and between-the-lines.
- Selection: normalised factors (space, penetration, lanes, defender displacement, suitability,
  support, numbers, scoring; minus interception, congestion, transition, stamina, repetition,
  coordination), weights from the settings, score and time and the opponent's observed defending
  (man-oriented vs zonal, block height), formation profiles, priorities; hysteresis.
- Space reservations, scored rest defence, defender-response reading, target reassignment, move
  states and statistics, rotation events, AI view details.
- Team settings (8 sliders, per-family priority, 6 presets) in Quick Match and the Lab; the Lab got
  13 new scenarios and a demonstration mode.
- Measured before/after (AI vs AI, 36 min per formation): see FUTSAL_ROTATIONS.md §7.
- Second round: keeper only as the last resort, carry before rotating, wait for the run, deeper
  runs, shots aimed from the ball, Lab drill defence (FUTSAL_ROTATIONS.md §8b).

## Planned

- Formations: 4-0, 2-2, 1-2-1, 2-1-1, 5v4 flying-goalkeeper shapes (2-1-2, 3-2, 1-2-2), numerical
  disadvantage shapes.
- Separate templates for build-up, mid-court, final third, high press, mid-block, low block and
  transitions, blended by context.
- More on the same framework: false pivot, the 3-player 4-0 rotation with a fixed fixo (the 3-1
  circular rotation, third-man runs, underlap and overload-and-switch are in the library now).
- Pressing styles (low, mid, high, aggressive) with triggers; man-to-man, zonal and hybrid defending.
- Tactical editor (the rotation sliders, priorities and presets exist; the full editor with individual
  instructions, quick commands and the AI coach is M7).
