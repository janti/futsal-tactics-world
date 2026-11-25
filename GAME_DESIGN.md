# Game Design

## Vision

A spiritual successor to classic top-down arcade football, built specifically around **futsal**:
easy to learn, hard to master, genuinely fun. Immediate controls, short passing, fast transitions,
sole control, pivot play, rotations, back-post finishing and coordinated pressing — not outdoor
football on a small pitch.

## Core loop (current prototype)

- Control one player of a five-a-side team (GK + 4). Control follows the ball on your team.
- Move, sprint, use the sole to slow down and protect the ball, pass (assisted), through-pass,
  shoot with tap-or-hold power, tackle, switch player.
- Basic AI plays for teammates and opponents; goalkeepers position on the ball–goal line and save.
- Kick-off, kick-ins, corners and goal clearances restart play; goals restart with a kick-off.

## Mechanics (implemented)

| Mechanic       | Implementation                                                                                                                                                                                        |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Movement       | Acceleration-limited, attribute-scaled run/sprint speeds, braking, limited turn rate, slower sidestep/backpedal                                                                                       |
| Dribbling      | Ball is a free physical body pulled towards a point in front of the player (spring); can be lost beyond 1.3 m                                                                                         |
| Sole control   | Space: very slow movement, ball held close, much harder to steal                                                                                                                                      |
| First touch    | Clean control below 7 m/s relative speed; above, success probability falls with speed and `firstTouch`; otherwise deflection                                                                          |
| Passing        | Assisted receiver in a 65° cone, receiver lead prediction, rolling-speed solver, angle error from passing skill and pressure                                                                          |
| Through pass   | Targets space 3.5 m ahead of the receiver in the attacking direction                                                                                                                                  |
| Shooting       | Tap = quick shot, hold up to 0.6 s for power; lateral input picks the corner, otherwise the side away from the keeper; seeded error from finishing, accuracy, composure, distance, pressure and power |
| One-touch play | Pass/shoot pressed up to 130 ms before receiving is buffered                                                                                                                                          |
| Tackling       | Short lunge with cooldown (no spam); success from tackling vs. ball control/strength/balance; sole control resists                                                                                    |
| Switching      | Manual (V, direction-biased) and automatic on own passes. Defending mode is a setting: **nearest player** (default, hysteresis 1 m, 0.4 s cooldown, V overrides for 1.5 s), assisted, or manual       |

## Game modes

**Quick Match** is complete: choose teams, half length and clock mode; two halves with half-time,
full-time result and statistics. Planned next: Training, Tactical Training, Coach, Spectator, Tournament, Career (M8–M9).
Local multiplayer is optional and later; online multiplayer is not a priority.

## Progression

Career mode (fictional Finnish league of 12 clubs, transfers, training, development) is Milestone 9.
