# Tactics Design

## Implemented

- **3-1** templates in normalised team-relative coordinates (`ai/positioning/Formation.ts`):
  `attack`, `defend`, `kickoffOwn`, `kickoffOpp`. Roles: GK, Fixo, Ala (left/right), Pivot.
- Ball-oriented blending: the block slides along the length (attack 55 %, defend 50 % of the ball's
  depth offset) and towards the ball laterally (30 % / 40 %); defending shapes are narrower.
- Anchors are reference positions only; players move to them with acceleration-limited steering
  and never teleport.

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
