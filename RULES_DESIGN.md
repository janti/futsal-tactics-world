# Rules Design

## Rules edition

**Not yet selected.** Before the rules engine (Milestone 7) the current edition of the official FIFA
Futsal Laws of the Game must be verified from the official source and recorded here, including the
exact penalty-area geometry, accumulated-foul thresholds, timeout and four-second rules.

## Implemented (prototype simplifications)

| Rule                                                                | Status                                                                                                                          |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Court 40 × 20 m, goals 3 × 2 m                                      | Implemented (geometry shared by physics and rendering)                                                                          |
| Five players per team incl. goalkeeper                              | Implemented                                                                                                                     |
| No offside                                                          | Implemented (there is none)                                                                                                     |
| Goal: ball wholly over the line between the posts and under the bar | Implemented                                                                                                                     |
| Ball out: wholly over touch line / goal line                        | Implemented, no wall rebounds                                                                                                   |
| Kick-off after a goal (conceding team)                              | Implemented; opponents stay in their half/outside the circle via AI                                                             |
| Kick-in to the team that did not touch last                         | Implemented; opponents kept 5 m away by AI                                                                                      |
| Corner / goal clearance by last touch on goal line                  | Implemented (goal clearance taken by the keeper from the area, as a ground pass)                                                |
| Clock                                                               | Two halves, countdown; effective time (default) or running clock; half-time ends switch; second-half kick-off by the other team |

### Goalkeeper hands

- Hands only inside the own penalty area and only for a ball last touched by an opponent (shots,
  saves, loose balls). Such a ball cannot be challenged. A back pass from a teammate must be played
  with the feet. A human keeper holding the ball gets a 4-second countdown, after which the AI throws (arcade
  simplification of the four-second rule; no indirect free kick yet).

### Ball out of play (presentation)

- The ball keeps flying after crossing a line and can hit the advertising boards / hall walls; the
  restart begins when it is placed on the spot (after 1–3.2 s). This is visual only: the ball is dead
  and no player can touch it.

### Kick-ins, corners and kick-offs

- Kick-off: every player must be in their own half and the defending team outside the centre
  circle before the kick-off can be taken; crossing the halfway line is blocked while it is pending.

- The ball must be **kicked**: once the taker reaches the ball they cannot move (only turn to aim),
  the ball stays on the spot and play (and the effective clock) restarts with the pass or shot.
- **No double touch**: the taker may not touch the ball again until another player has touched it.
- **Four-second rule** (kick-ins and corners): if the ready taker does not kick within 4 s, a kick-in
  goes to the opponents from the same spot; a late corner becomes a goal clearance for the defenders.
  The HUD shows the countdown. Kick-offs have no time limit in the prototype.
- Opponents stay 5 m away until the kick (kick-off: own half / outside the centre circle).

### Match length

- Official: 2 × 20 min effective time. Quick Match offers 2/3/5/10/20-minute halves and a running-clock
  option. A half ends the instant the clock reaches zero (a ball in flight does not count after the
  signal in this prototype). No extra time or penalties in Quick Match (draws stand).

### Known arcade simplifications

- Goalkeepers hold the ball at their feet; no hand-handling restrictions, four-second rule or
  return-pass restriction yet.
- No fouls, cards, accumulated fouls, timeouts, substitutions or penalties yet.
- Goal clearances and free kicks have no four-second limit yet (no free kicks exist yet).

All of the above are Milestone 2 (basic match) and Milestone 7 (full, versioned, configurable
official/arcade rules engine with automated edge-case tests).
