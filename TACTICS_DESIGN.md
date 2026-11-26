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

## Planned

- Formations: 4-0, 2-2, 1-2-1, 2-1-1, 5v4 flying-goalkeeper shapes (2-1-2, 3-2, 1-2-2), numerical
  disadvantage shapes.
- Separate templates for build-up, mid-court, final third, high press, mid-block, low block and
  transitions, blended by context.
- Rotations: position exchange, figure-eight, diagonal, third-player, wall pass, overlap, underlap,
  pivot rotation, back-post rotation, parallel run, overload-and-switch — each with preconditions,
  participants, triggers, timing, balance requirements, completion and cancellation.
- Pressing styles (low, mid, high, aggressive) with triggers; man-to-man, zonal and hybrid defending.
- Tactical editor (0–100 sliders), presets, individual instructions, quick commands, AI coach.
