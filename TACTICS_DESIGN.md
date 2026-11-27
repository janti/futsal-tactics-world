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
- Measured AI vs AI (8 × 3 min per formation, both teams, started / completed):
  - 3-1: wall pass 74 / 22, overlap 208 / 82, pivot 57 / 26, back post 154 / 59; shots 225 → 214,
    goals 49 → 42 (within the noise between runs).
  - 4-0: wall pass 98 / 36, overlap 240 / 102, 4-0 rotation 177 / 64, back post 91 / 30; shots
    61 → 87, goals 10 → 16 — the flat four needed the movement most.
  - 2-2: wall pass 52 / 21, overlap 166 / 75, back post 214 / 91; shots 188 → 202, goals 43 → 42.
- Side effect fixed on the way: with players up the court after a rotation the keeper's arced throws
  were cut out more often. The keeper now counts the throw's time in the air (a receiver already on
  the spot has to wait for it; the human player arriving as it drops takes it) and, with the ball in
  his hands and every throw risky, waits up to 2.5 s for somebody to get free. AI passes taken by the
  test bot (12 matches): without rotations 11.9 % → 10.2 %, with rotations 15.0 % → 12.7 %.

## Planned

- Formations: 4-0, 2-2, 1-2-1, 2-1-1, 5v4 flying-goalkeeper shapes (2-1-2, 3-2, 1-2-2), numerical
  disadvantage shapes.
- Separate templates for build-up, mid-court, final third, high press, mid-block, low block and
  transitions, blended by context.
- More rotations on the same framework: position exchange, figure-eight, diagonal, third-player,
  underlap, parallel run, overload-and-switch.
- Pressing styles (low, mid, high, aggressive) with triggers; man-to-man, zonal and hybrid defending.
- Tactical editor (0–100 sliders), presets, individual instructions, quick commands, AI coach.
