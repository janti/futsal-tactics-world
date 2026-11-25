# Changelog

## Unreleased

- Human keeper holding the ball: the direction keys now only aim (he turns on the spot towards the
  aim, like while charging a throw) instead of walking and turning sideways with the ball in his hands.
- Goal clearance: the keeper gathers the ball facing the court with the ball in his hands in front
  of him (he used to keep facing his own goal after walking back to the ball).

- Keeper with the ball at his feet (back pass): the nearest opponent now goes straight for the ball
  and can win it.
- Saves end in the hands: the keeper catches more shots, and the rebound of his own parry or a ball
  deflected off a teammate may be picked up with the hands; only a teammate's deliberate kick forbids
  them. He then distributes with a throw, which opponents cannot challenge.
- Fixed: a shot could reach the keeper's hands through an ordinary first touch, bypassing the save
  rules (so even placed shots were held); shots straight at the keeper now always get a save attempt.
- Fixed: players could get stuck walking into a goal net (a corner taker inside the goal stalled the
  match). Players now route out through the goal mouth or round the goal.
- Keeper throws: bigger arc (vertical launch 2.6–8.8 m/s).

- Restarts are aimed: at kick-offs, kick-ins and corners the taker always stands behind the ball
  along the aim direction, so the ball stays in front of him. Aiming with the direction keys walks him
  round the ball (it stays on the line or the centre spot) and he faces the aim. Kick-ins and corners
  can only be aimed into the court; the kick-off can go any way. AI takers line up towards their
  receiver and play the ball that way.

- Kick-ins and corners: the taker stands behind the ball, just outside the court, with the ball in
  front of him on the line, and faces into the court (diagonally at corners).
- Goals are solid for players: posts, side nets and the back net stop players and keepers from
  either side; the open goal mouth can still be entered from the court.

- Shooting reworked: a quick tap of the shoot button is a fast, low, placed shot into the near or far
  corner that the keeper cannot hold (at best he parries it). Holding the button adds speed and
  height; the heavy futsal ball rises slowly at first and a full charge (0.75 s) lifts it over the
  bar. The keeper leaves shots that are clearly going over or wide.
- Keeper throws: a short press bowls the ball along the floor, a longer press throws it overarm with a
  clearly higher arc than a shot. With the ball at his feet the keeper shoots and passes like an
  outfield player.

- The keeper comes to meet a teammate's pass (running to the earliest point on the ball's path he
  can reach, sprinting if an opponent could get there first, never past halfway) instead of freezing
  on his line.

- Long-range shots and screening ("maski"): shots from 10 m or more, or from a tight angle on the wing,
  are judged at the moment of the shot. With a clear view the keeper saves almost all of them and
  catches most (measured: 0/30 goals from 12 m and 11.5 m, 1/30 from the wing). A player standing in
  the keeper's line of sight hides the shot: the keeper reacts later and the save chance drops
  (measured: about 11/30 goals from the same spots). Close-range shots are unchanged.

- Goalkeeper saves: the keeper catches manageable shots in his area (then holds the ball in his
  hands) or steers the ball away: parries and body blocks now send it wide to the nearer side and
  away from goal (often out for a corner) instead of back into the danger zone. No catching outside
  the penalty area.
- After a catch the AI keeper uses the same controlled throw as for goal clearances (bowled when
  short, overarm when long, aimed at where the receiver will be).
- Back pass: the keeper plays it with his feet like an outfield player (the human controls him and
  passes normally), with the keeper rules: no hands from a teammate's pass, four seconds on the ball
  in the own half (hands or feet), and no second touch in the own half after releasing the ball until
  an opponent has touched it (teammates and assisted passing do not pass back to him meanwhile).

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
