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
- **Breakaway (through on goal)**: when no outfield defender is goal-side of the carrier near his
  line to goal, he runs the ball in (sprinting if chased), never passes, and finishes from about
  7–8.5 m (earlier if a chaser or the rushing keeper gets close) with a low shot into the far corner
  (60 %) or near corner; mostly a placed shot, sometimes a firmer one the keeper can hold. Measured:
  about 55–60 % goals, the rest saved or caught (`tests/tactical/breakaway.test.ts`).
- **1v1 challenge**: with one defender close in front and no cover behind him, the carrier (never
  the team's deepest outfield player, not deep in his own half) decides once per possession whether to
  take him on (chance by dribbling, 30–75 %). Wing: cut inside or down the line; middle: past the
  side away from the defender, sprinting. A pressing defender within 2.2 m tracks the ball every tick
  (speed by tackling/agility). Measured: 20/30 duels challenged, 17 beaten
  (`tests/tactical/challenge.test.ts`).
- **Play forward**: after a direct pass to a scoring position and a possible challenge, a pass to an
  outfield teammate at least 2.5 m ahead with an open lane and space is preferred once the carry
  stalls; only then is the ball circulated back or across.
- **Carrier (direct, then circulate)**:
  1. shoots inside an attribute-based range (9.5–12.5 m; rare long shots only up to 15 m) when the angle and a shooting lane to a corner allow
     (the lane ignores the goalkeeper);
  2. plays a forward pass at once if a teammate is free in a scoring position (open lane, ≥ 1.2 m
     space, clearly more dangerous than the carrier; through pass for runners with space);
  3. otherwise carries the ball forward while there is space ahead, and when blocked or after a
     short hold circulates it to the most open nearby teammate (sideways/back, keeper only under
     heavy pressure).
     Measured AI vs AI: ~85 % pass completion, ~60 % circulation passes, regular shots
     (`tests/tactical/directPlay.test.ts`).
- **Goalkeeper vs long shots**: shots from 10 m+ or tight angles are almost always saved (mostly
  caught) unless the keeper's line of sight is screened; screening (any player within 0.85 m of the
  ball–keeper line, weighted by closeness to the keeper) delays his reaction by up to 0.28 s and lowers
  the save chance towards 45 %.
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
