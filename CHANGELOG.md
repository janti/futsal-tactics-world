# Changelog

## Unreleased

### Milestone 5 — tactical AI foundation

- The AI is split into layers (team: defending, attacking, phases, roles; player: carrier, goalkeeper,
  off-ball; passing, movement, restarts, spatial). The split itself changed no behaviour (identical
  seeded fingerprint before and after).
- Team phases: attack, counter-attack window after winning the ball (runs in behind start at once with
  less cover), defence, transition to defence, set piece, dead ball.
- Pitch control: the court is divided into 2 m cells and each is owned by the team that reaches it
  first; supporting players move into space their team owns.
- Time-to-reach now includes turning (a player facing away is slower to get there); used by pressing,
  interceptions, the keeper and pass safety.
- Dynamic roles in attack: after runs and rotations players fill the shape from where they are instead
  of running back to their nominal positions.
- Utility decisions for the ball carrier: every option is scored; a teammate free in front of goal
  with a clearly better chance gets the square ball instead of a poor shot.
- Markers sprint after a man who gets away from them and follow a man between the ball and goal
  further out of their zone.
- AI overlay on the radar (key 7): pitch control tinted in the team colours and both teams' phases.
- Measured AI vs AI (12 x 3 min): 91 % pass completion, 91 shots, 9 goals.

- Goalkeeper narrows the angle: when an opponent has a free shooting chance inside 13 m (unpressed,
  nobody in the way) the keeper comes off his line — about 2 m from 8 m out, at most 2.8 m and never
  closer than 2.6 m to the shooter, walking rather than rushing. A keeper who had narrowed the angle
  when the shot was struck gets a modest save bonus. He is no wall: measured from 8 m with the keeper
  set, placed shots score about 60 % (was 77 %) and harder shots about 40 % (was 47 %).

- 2 v 1 defending: the last defender no longer rushes the carrier. Further out he covers the passing
  lane to the second attacker; from about 16 m in he moves closer to the carrier the nearer they get,
  goal-side of him about 3-4 m outside the arc. At the arc (or a couple of metres before it) he takes
  the second attacker and the goalkeeper comes out to the edge of the area to block the shot. A
  teammate chasing from behind may still press the carrier.

- Goalkeeper dive: the arms no longer look over-long. When the keeper caught the ball in a dive, the
  arms tried to reach a ball at standing height from the tipped body and stretched out fully; now the
  arms keep the dive pose (elbows bent, gloves just past the head) and the caught ball is drawn between
  the gloves until he gets up.

- National teams: men's (Finland, Spain, Portugal, Brazil, Argentina, Morocco, Iran, Kazakhstan) and
  women's (Finland, Spain, Portugal, Brazil, Argentina, Italy), grouped in the Quick Match team picker
  with clubs; picking a team from another group moves the opponent into the same group. Country names
  (Finnish names in the Finnish UI) and plain national colours only — no federation crests — and
  fictional players generated from per-nation name pools (women's squads with their own heights and
  mostly long hair).
- Local rosters for private play: JSON files in `src/data/local/` (git-ignored; only a fictional
  example is committed) can give any team real names, shirt numbers and positions. They are read by the
  dev server only, so a production build never contains them (unless `VITE_LOCAL_ROSTERS=1`). The
  setup screen notes when local rosters are loaded. See `src/data/local/README.md`.

- Shots from the side: the keeper now positions on the bisector of the angle (covering his near post
  on angled balls), and a shot from the side struck outside the penalty-area arc is saved almost
  always — except a ball into the near top corner. Measured from just outside the arc: low and mid
  near-post shots 2/60 goals (was 30/60), near top corner 9/30 goals.
- The AI no longer plays loose passes through the middle: before passing it checks whether an
  opponent can get to the ball's path first (circulation passes strictly, forward passes with a little
  more risk). Measured AI vs AI: 91 % of passes arrive (was 80 %), 7 % are intercepted (was 19 %).
  Fewer giveaways also mean fewer counter-attacks: about 39 shots and 5 goals per 18 minutes.

- Goal clearances: the alas start a metre deeper, giving the keeper an easier angle out to the wing.
- Faster transition to defence: when the ball is lost the whole team switches to defending at once
  (no waiting for the next decision) and sprints back into shape for 1.6 s. Measured AI vs AI: a team
  caught out of shape gets three players back between ball and goal in 1.65 s instead of 1.9 s.

- Your player answers the stick faster: the human-controlled player turns 1.7x and accelerates 1.25x
  quicker than the AI players.
- No more strange sideways or backwards runs: AI players watch the ball only while positioning or near
  the play, and anyone running hard away from what he watches turns and runs. Measured AI vs AI: fast
  running more than 60 degrees off the facing fell from 49 % to 11 % of the time (short side-steps).
- Animation follows the direction of travel: backwards movement plays the stride in reverse
  (backpedal), sideways movement becomes side-steps instead of legs running on the spot.
- Goalkeeper saves: a standing save — knees bent, a short step and both hands pushing the ball wide,
  body upright. A dive only when the keeper was caught off-centre (at the near post or further out
  wide) when the shot was struck and it goes accurately to the far post; from the middle he never dives
  (about a fifth of saves in AI vs AI). The dive pose has natural proportions: the body tips about 55
  degrees, arms reach past the head with bent elbows, knees bent (no over-long stretched figure).
- Runs in behind: when a teammate holds the ball up (e.g. the pivot) and the wing ahead is empty, an
  ala sprints forward down the wing; the carrier plays a through ball into real space. One runner at a
  time, two players always stay behind the ball.
- Back post: with the ball on a wing near goal one attacker takes the far post; after a shot the best
  placed attacker follows up at the far post for a rebound or tap-in (struck first time).
- Supporting players look more for forward options.
- After a goal both teams hurry back to their kick-off positions; the kick-off is ready about 4 s after
  the goal (was up to 6 s while players strolled back from the other half).

### Milestone 4 — camera and visual identity

- Horizontal cameras: Horizontal Tactical (broadcast-style side view that follows the play) and
  Horizontal Full Court. Your team attacks to the right; controls stay screen-relative.
- Camera Lab: tune your own camera while playing (key 6 or the pause menu) — view orientation, fixed
  or tracking, elevation, visible length, look-ahead, attack bias, smoothing, dead zone, side margin.
  Remembered between sessions.
- Radar / minimap in the top right corner with the camera window; oriented like the main view.
  Can be switched off in the settings.
- Settings: camera choice, radar on/off and graphics quality (low / medium / high, applied when a
  match starts; the `?gfx=` URL parameter still overrides).
- Hall: stepped stands with home and away seat rows, aisles with stairs and front rails, stands
  behind both goals, substitutes in bibs on the benches, a timekeepers' table at halfway; the
  advertising board slogans no longer overlap.
- Fixed: Esc did not close the pause menu (and key 6 the Camera Lab) while a setting or slider had
  the keyboard focus.

- Dribbling: the ball stays closer to the feet (about 0.35–0.5 m at running pace; at a sprint it is
  touched 0.45–0.75 m ahead instead of up to about 1.2 m).
- 2 v 1 near our goal: the only outfield defender goal-side of the carrier (typically the fixo) steps
  out to the ball and leaves his man.
- Measured press: far from our goal (more than 22 m) the presser stands off about 3 m on the inside,
  closing the way through the middle, instead of diving in high up the court. The defensive pivot sits
  further off the ball and centrally.
- Markers stand on the inside (middle) shoulder of their man, goal-side.
- Measured AI vs AI (6 x 3 min): the middle between ball and goal is covered 87 % of the time (was
  81 %), 84 % pass completion, 85 shots, 7 goals (was 119 shots, 16 goals).

- Supporting players get free and offer passes: they look for a spot in rings round their shape
  position (and a run towards the ball) that is open for a pass, away from their marker, at a good
  passing distance and not crowding a teammate, and they sprint there. Measured AI vs AI: the carrier
  has on average 1.05 free options instead of 0.82 (none 34 % of the time instead of 44 %), 80 % pass
  completion.
- Kick-ins and corners: opponents keep 4 m from the ball (was 5 m).
- Kick-in and corner routine with movement: the short man starts a few metres off and comes towards
  the ball (behind it, to shoot first time), the pivot comes out from the back post to the front of
  the area, and the deep man leaves halfway to show for a pass back. The taker plays the most open of
  them (preferring the short man and the pivot, who strike it first time if in range).

- Fixed: in front of goal a defender could mark the pivot from the wrong side (pivot between him and
  the keeper). Markers now go round their man to get goal-side, a man within 9 m of goal is followed
  outside the zone, and the fixo does not leave a man in front of goal to press the ball.
- The attacking pivot no longer stays in the middle: every few seconds he moves between the middle,
  the ball-side wing and the far post/wing.
- Help defence: when a carrier gets past the first defender (usually the pivot) anywhere in our half,
  an ala comes across, or the fixo if no opponent is near him.
- Counter-attacks: a team that loses the ball with at most one player goal-side of it sprints back to
  its men; a goal-side defender engages the carrier and the cover defender may step out anywhere. It
  returns to the normal diamond after a back pass, a dead ball or once three players are goal-side.
- Pressing roles no longer flicker between two players (the current presser keeps the job unless
  someone is clearly faster).
- Measured AI vs AI (6 x 3 min): 78 % pass completion, 85 shots, 12 goals.

- Defending reworked: the defending team plays a high, compact diamond (pivot on top just goal-side
  of the ball, alas either side, fixo at the bottom, about 4.4 m between the lines) that moves with
  the ball. Every defender outside the press marks one opponent (one-to-one, the opponent nearest his
  place in the diamond), goal-side and tighter near goal and near the ball; a man far from the ball is
  marked loosely from the middle (help side). The fixo leaves the middle least.
- Cover defender: when a carrier gets past his defender within 20 m of goal (or nobody is goal-side of
  him), the next defender comes across to close him down.
- Kick-in and corner routine: an easy pass back to a player behind the ball who shoots first time,
  one player attacks the back post and the fourth stays as cover at halfway. The routine pass is
  played firmly; the taker always kicks in time (no four-second violations). Defenders mark at kick-ins
  and corners.
- Shots hitting an outfield defender now rebound off him (block) instead of being controlled; only a
  weak shot can be stopped.
- Passes are crisper (arrive at 6.5 m/s instead of 5); attackers move away from their markers to get
  free. AI dribble challenges are a little rarer and harder (measured 12/18 beaten).
- Measured AI vs AI (3 x 3 min): 79 % pass completion, 39 shots, 8 goals.

### Milestone 3 — gameplay physics and controls

- Touch-based dribbling: at a sprint the ball is knocked ahead, rolls a little slower than the runner
  and is touched again when he catches it up; worse dribblers knock it further. A ball away from the
  feet is three times easier to win. Normal running keeps it close.
- Shielding: hold sole control (Space) without a direction and the player turns his back to the
  nearest opponent; a shielded ball is much harder to steal (stronger players shield better). AI
  carriers under close pressure shield too.
- First touch: fast balls are sometimes controlled with a heavy touch that bounces a few metres away.
- AI defenders read opponents' passes and step into the path when they can get there first.
- Passing assistance setting: assisted (default), semi-assisted (only a teammate close to your
  direction, slightly less accurate) and manual (exactly your direction; hold the pass button for
  power, tap = short pass).
- Difficulty (Quick Match): easy / normal / hard changes the computer opponent's attributes, how often
  it decides and how quickly it reads passes. AI vs AI is unaffected.
- Gamepad: Start opens and closes the pause menu; in menus the D-pad or stick moves the focus,
  left/right changes a setting, A selects, B goes back.
- Keyboard controls can be rebound in the settings (one key never does two things; reset to defaults).
- Goalkeeper four-second rule: holding the ball longer than 4 s in the own half now gives the
  opponents an indirect free kick (on the penalty-area line if inside the area) instead of the AI
  taking over. A goal straight from an indirect free kick does not count.
- A pressing defender close to the carrier steps in with a speed based on tackling and agility.

- AI takes defenders on 1v1 (wing: cut inside or down the line; middle: past the side away from the
  defender); the last man never does. Better dribblers try it more often.
- AI plays forward: a pass to a teammate clearly ahead with an open lane is preferred once the carry
  stalls; only otherwise is the ball circulated back or across.
- A pressing defender close to the carrier now tracks the ball every tick instead of a static spot.

- AI breakaways: a computer player through on goal with no defender between him and the keeper now
  takes the ball in close and finishes with a low shot into the far or near corner instead of
  shooting from distance or passing. Measured: 23/40 goals, the rest saved (5 caught).
- The AI shoots from closer in (9.5–12.5 m instead of 11–15 m) and long-range attempts are rare.
- Fixed: the extra difficulty of a placed corner shot for the keeper was applied after the save roll
  and had no effect; the further he has to stretch, the less likely the save.

- Human keeper holding the ball walks with it inside his penalty area again (after saves and at goal
  clearances); only while a throw is being charged do the direction keys just aim.
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
