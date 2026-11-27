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

## Milestone 6, stage 3: rotations

- `ai/team/rotations.ts`: a rotation is a short team move with named participants, each with a job
  (`run` into space, `wall` for a 1-2, `cover` behind, `drop` short, `post` in front of goal) and a
  target (`state.rotation[team]`). Started by a trigger, it ends **completed** when the ball reaches
  a runner (the wall pass: when the passer has it back from the wall), and is **cancelled** when the
  time runs out (2.2–3.4 s), the ball goes to somebody outside the move, possession is lost or the
  ball goes dead. Then a 2 s pause before the next one; the runners who did not get the ball go back
  to the shape (the dynamic roles fill it from where everybody is).
- **Balance**: one outfield player who is not running always stays behind the ball. The deepest
  player is never a runner unless somebody is told to cover his place (overlap, 4-0 rotation).
- The rotations:
  - **Wall pass (1-2)**, chosen by the carrier (more often by a creative player): a defender close in
    front, a free teammate 3.5–9 m away with a clear lane and space behind the defender. He plays it
    in and runs past the defender on the wall's side; the wall returns it first time into his path.
  - **Overlap**: a wide carrier held up by his marker; the teammate 2–9 m behind on that side runs
    round the outside down the wing (the carrier's own marker is ignored — he is the one being gone
    round); the through ball finds him once he is past.
  - **Pivot rotation** (3-1): the pivot marked tight comes short into the space in front of the ball
    (he gets it to feet when free); the far ala runs into the space he left and becomes the pivot.
  - **4-0 rotation**: a pass from the middle out to the wing — the passer follows it on the inside past
    the receiver, the far man tucks in behind into his place.
  - **Back-post rotation**: the ball on a wing within 14 m of goal — one man attacks the back post
    (first-time finish), another the front of the area; after 1.5 s without the ball across they swap
    (the back-post man comes out to the top, the other goes across to the back post).
- `TeamTactics.rotations` switches them on or off (on by default; the stage 5 quick tactics will
  expose it). Started/completed counts per team and kind: `state.rotationStats`.
- Measured AI vs AI (8 × 3 min per formation, both teams, started / completed; after the stage 4
  fixes below):
  - 3-1: wall pass 35 / 15, overlap 192 / 72, pivot 105 / 47, back post 160 / 59; shots 219, goals
    50 (without rotations 225 / 49 — about unchanged).
  - 4-0: wall pass 28 / 7, overlap 185 / 88, 4-0 rotation 340 / 102, back post 80 / 25; shots 82,
    goals 16 (without rotations 61 / 10) — the flat four needed the movement most.
  - 2-2: wall pass 19 / 6, overlap 186 / 77, back post 203 / 75; shots 209, goals 41 (188 / 43).
- Side effect fixed on the way: with players up the court after a rotation the keeper's arced throws
  were cut out more often. The keeper now counts the throw's time in the air (a receiver already on
  the spot has to wait for it; the human player arriving as it drops takes it) and, with the ball in
  his hands and every throw risky, waits up to 2.5 s for somebody to get free. AI passes taken by the
  test bot (12 matches): without rotations 11.9 % → 10.2 %, with rotations 15.0 % → 12.7 %.

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
- Lab results (20 attempts each, computer vs computer): breakaway 14 goals, 2 v 0 18 goals; the
  rotation scenarios start their rotation in 14–20 attempts out of 20.
- Open finding: in the built-up situations (counter 3 v 2, rotations, build-up) the attackers lose the
  ball in 55–75 % of the attempts. One cause seen in the wall pass: the runner who has the ball back
  past his man passes it back under pursuit from behind instead of driving on (the chaser counts as
  pressure). To be worked on with the Lab.

## Planned

- Formations: 4-0, 2-2, 1-2-1, 2-1-1, 5v4 flying-goalkeeper shapes (2-1-2, 3-2, 1-2-2), numerical
  disadvantage shapes.
- Separate templates for build-up, mid-court, final third, high press, mid-block, low block and
  transitions, blended by context.
- More rotations on the same framework: position exchange, figure-eight, diagonal, third-player,
  underlap, parallel run, overload-and-switch.
- Pressing styles (low, mid, high, aggressive) with triggers; man-to-man, zonal and hybrid defending.
- Tactical editor (0–100 sliders), presets, individual instructions, quick commands, AI coach.
