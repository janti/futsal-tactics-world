# Changelog

## Unreleased

- Goal nets now visibly give: an impact kicks a damped spring (harder shot, bigger bulge, up to
  0.5 m over about 1 m), the net swings back, and the ball is carried out with the net. Previously
  the bulge was only about 1 cm because the ball stops just in front of the net.
- New run cycle: keyframed walk/run gait with smooth spline interpolation, foot contact, push-off,
  a short heel lift and a knee drive forward, a vertical bounce twice per stride, hip/shoulder
  counter-rotation and arms swinging with the opposite leg. The foot no longer trails far behind the
  hip seen from above (it read as skiing). Animation speed is filtered so the gait does not twitch.

- Goal nets rebuilt as a fine white line mesh (12 cm squares) on the back, roof and sides, visible at
  any camera distance; the net bulges where the ball presses into it. The net now swallows the ball:
  a hard shot no longer bounces back out of the goal onto the court.
- Proportions verified and tested: court 40 x 20 m, goals 3 x 2 m (1 m deep), player model 1.79 m
  with hip height at half the body height. New setting "Player size": 100 % (true size), 106 %,
  or 112 % (default, easier to read from the high camera).

- Running animation: the thigh swings further forward than back and the knee folds the lower leg up
  during the recovery swing, so legs no longer trail behind straight and look too long.
- Goalkeeper: the ball is held at chest height with both hands placed on either side of it (two-bone
  arm IK) after catches and when gathering for a goal clearance; throws use an arm-throw animation
  instead of a kick.

### Milestone 2 — complete basic arcade match

- Quick Match setup screen: your team and opponent, half length (2/3/5/10/20 min), effective or
  running clock; choices are remembered and Enter starts the match.
- Match clock counts down; effective time stops whenever the ball is dead. Two halves with a
  half-time break: teams switch ends and the team that did not kick off the first half kicks off the
  second. By default the view rotates at half-time so your team keeps attacking up the screen
  (setting: "Keep my team attacking up the screen after half-time").
- Full time: result screen with shots, shots on target, possession, passes, saves, corners and
  kick-ins; rematch, new quick match or main menu.
- Team statistics are derived from the simulation's event stream.

- Controllable goalkeeper throw: when your keeper holds the ball in the hands you control him. Aim
  with the direction keys and hold Z (or X/C) for power, release to throw: soft throws are bowled
  along the floor, hard ones are thrown overarm through the air. An aim arrow on the floor grows with
  the power, the HUD shows the power bar and a 4-second countdown (after that the AI throws). The
  teammate on the line of the throw becomes the receiver and you take control of them. With the ball
  at his feet (back pass) your keeper plays like an outfield player.
- Fixed: holding the shoot key after a full-power shot started charging another shot.

- Ball out of play is no longer teleported: it keeps its trajectory off the court, bounces off the
  advertising boards (or flies over them to the hall wall) and is placed on the restart spot once it
  has slowed down. On a goal clearance the keeper fetches the returning ball if it rolls back into the
  area. While the ball is out the camera follows it and frames the end of the hall.
- Goalkeeper hands: a ball gathered from the opponents in the own penalty area (saves included) is
  held in the hands and cannot be challenged; distribution releases it. A back pass from a teammate is
  played with the feet and can be won by a pressing opponent, like an outfield player. Outside the
  area the keeper never uses the hands. Nobody presses a keeper holding the ball.

- Kick-off: play starts only when every player is in their own half and the defending team is
  outside the centre circle; nobody can cross the halfway line while the kick-off is pending, and a
  human player left out of position is walked back.
- Goalkeepers: a failed save no longer lets the ball pass through the keeper's body; saves are timed
  at closest approach; long shots give the keeper more reaction time (no goals from the own half in
  tests); shot reaction delay, keeper speed cap and dive reach make close-range finishing fair.
- AI is more direct: a forward pass to a teammate free in a scoring position is played at once,
  otherwise the ball is carried into space or circulated to a safe teammate. The AI's shooting lane
  no longer counts the goalkeeper as a blocker (it rarely shot before).
- Player model: shorter legs (hip height 0.88 m) and a slightly longer torso.

- Defending: the controlled player now defaults to the outfield player nearest the ball. New
  setting "Player selection when defending" (nearest / assisted / manual), persisted locally.
- Kick-ins, corners and kick-offs can no longer be dribbled: the ball must be kicked; no double
  touch; four-second rule for kick-ins and corners.
- Fixed: very quick key taps could be lost between input samples.

## 0.1.0 — Milestone 0 + 1 (2026-11-24)

- Project foundation: Vite, React 19, strict TypeScript 7, Three.js, Zustand, Vitest, Playwright,
  Oxlint, Prettier, pinned dependencies.
- Deterministic 60 Hz match simulation with seeded RNG, typed commands/events and interpolated
  rendering snapshots.
- Ball physics with substepped collisions (posts, crossbar, nets, players), low-bounce futsal ball.
- Player movement physics, dribbling spring, sole control, first touch, steals and tackles.
- Assisted passing with lead prediction, through passes, tap/hold shooting with seeded error,
  one-touch input buffering.
- Basic AI with anti-ball-chasing, goalkeepers, restarts (kick-off, kick-in, corner, goal clearance).
- Vertical Smart 78° orthographic camera and three further vertical presets.
- Procedural semi-realistic players with procedural animation; procedural parquet court and
  Finnish Classic Hall.
- HUD, pause menu, Finnish/English localisation.
- 48 unit/integration tests and 2 browser smoke tests.
