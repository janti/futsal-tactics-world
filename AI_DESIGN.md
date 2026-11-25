# AI Design

## Current state (Milestone 1 groundwork) — `src/ai/BasicAI.ts`

This is intentionally a basic AI, not the final tactical system. It already follows the principles
the full system will be built on:

- **Anti-ball-chasing**: per team, exactly one _ball winner_ (loose-ball chaser or presser) chosen by
  estimated time to reach the ball. On the human team the AI only takes this role when the human
  player is clearly slower (> 0.7 s). Verified by `tests/integration/matchFlow.test.ts`.
- **Intended receiver** of a pass moves to the earliest reachable point on the ball's path.
- **Ball-oriented shape**: everyone else moves to 3-1 anchors that slide with the ball
  (`ai/positioning/Formation.ts`).
- **Support**: attackers sample small offsets around their anchor and pick the one with the most
  open passing lane to the ball while keeping ≥ 3 m spacing.
- **Cover**: defenders blend their anchor with a goal-side position against the nearest threat.
- **Pressing**: the presser approaches goal-side of the carrier and slows down when close (jockey).
- **Carrier (direct, then circulate)**:
  1. shoots inside an attribute-based range when the angle and a shooting lane to a corner allow
     (the lane ignores the goalkeeper);
  2. plays a forward pass at once if a teammate is free in a scoring position (open lane, ≥ 1.2 m
     space, clearly more dangerous than the carrier; through pass for runners with space);
  3. otherwise carries the ball forward while there is space ahead, and when blocked or after a
     short hold circulates it to the most open nearby teammate (sideways/back, keeper only under
     heavy pressure).
     Measured AI vs AI: ~85 % pass completion, ~60 % circulation passes, regular shots
     (`tests/tactical/directPlay.test.ts`).
- **Goalkeeper**: angle positioning on the ball–goal line (depth grows with distance), reacts to
  shots by moving to the predicted crossing point, claims loose balls in the area when first,
  distributes to the most open teammate.

Decisions run at 10 Hz staggered by player id; steering runs every tick. A role change of the ball
winner is applied immediately so two players never chase together.

## Target architecture (Milestones 5–6)

Three layers: team intelligence (5 Hz: phase, shape, pressing, role assignment, rotations), player
intelligence (10 Hz: utility-scored actions with commitment and switch penalties) and movement
execution (60 Hz steering). Supporting systems: perception snapshots with difficulty-scaled delay
and noise, a 0.5–1 m spatial evaluation grid, a shared time-to-reach / interception model, role
assignment by exhaustive search over the four outfield players, movement reservations, rotations
with preconditions/cancellation, pivot play and back-post intelligence. Difficulty will change
decision quality, never physical attributes. No external AI services are used.

The current `estimateTimeToReach` and `interceptPoint` are simple first versions of the shared
model and will be replaced by a reusable module with turning delay and reaction time.
