# Changelog

## Unreleased

- Runs in behind are tracked: when a man makes a run at goal (fast towards it, or past his marker
  and still going) his marker goes with him, goal-side and tight, sprinting — his zone, the lane
  screen and keeping the middle no longer hold him back; a defender whose man is running never leaves
  him to help press the ball. Measured AI vs AI: runners in our half with nobody within 2.5 m 59 % ->
  44 % of the time (a quick runner still gets a step on his marker). The pressing height also sets
  how close behind the ball the top of the block sits (a high press closer), so the heights stay
  distinct now that everybody goes with runners.

- Defence keeps its shape: roles in defence are handed out from where the players are (like in
  attack) — after losing the ball the pivot caught on a wing and the ala in the middle swap roles
  instead of running across each other; the deepest player is always the fixo; roles are re-dealt
  at most once a second and only for a clearly better fit (a first version re-dealt them too often
  and the test bot dribbled through: 18 goals in 18 min instead of 8). Our pivot keeps the middle:
  he does not mark a man out wide (an ala or the fixo does), presses a carrier in the middle but not
  out wide, never goes to set a trap on a pressing trigger, and in their build-up stands in the line
  to their pivot as the screen. The fixo slides across to a man goal-side of the ball on the ball
  side. Measured AI vs AI: alas on the wrong side 8 % -> about 4 % of the defending time, the pivot
  pressing out wide 3.5 % -> 1 %.
- The keeper with the ball at his feet and every short pass one the presser can cut out dinks it over
  him; an arced throw goes only to a teammate who gets to where it comes down before an opponent.
- Statistics: saves and shots on target count only shots (a keeper stopping a pass or a chip used
  to count as a save).

- Attack tuned after the defensive changes (AI vs AI goals had fallen to about 4 in 36 min from
  some 75 shots): first-time strikes (lay-offs, back post, set pieces) only with a clear sight of
  goal from 12 m in, placed low close in (22 of them scored none, half were blocked); the normal shot
  needs a clear lane (a shot into a defender is wasted); a breakaway is taken in closer (7.5-6 m),
  placed when a chaser is on his shoulder, and dinked over a keeper who rushes out; shots under
  pressure scatter less (the pressure factor on the aim error 1.5 -> 1.3 at most, also for the human
  player). Measured AI vs AI: about 60 shots and 9-12 goals per 36 min (6-8 m shots: about half go
  in). Against the pressing test bot the AI still scores little.

### Milestone 6 — stage 2: pressing triggers

- The defending team waits for a cue and then jumps for about a second and a half: a back pass
  towards their goal (the press goes to the receiver while the ball travels), a carrier who has just
  received facing his own goal, a ball that got away from an opponent, or the carrier by the touch
  line, where two men trap him against it. In the jump the presser goes in tight anywhere, a second
  man comes to trap, the others mark tight. The pressing height decides how far up the court the
  team reacts (a low block only near its own goal, a high press almost anywhere).

- Diamond defence shuts the pass into the pivot while marking: the presser comes at the carrier from
  the side of their pivot (his body blocks the pass); their pivot's marker stays tight on him, a
  little on the ball side, and sprints to stay with him; the other defenders lean off their men into
  the line from the ball to the pivot (the defensive pivot most), but only so far that their man
  stays within reach — and a man ahead of the ball close to it is marked first. When the ball is
  moved across, the line has to be shut again, and then the pass into the pivot can open in the
  middle or out wide. Measured AI vs AI: the lane into a central pivot open 26 % -> 22 % of the
  build-up, into a wide pivot 31 % -> 36 %; fewer goals from the pivot (AI vs AI about 11 -> 5 per
  36 min with similar shot numbers).

- AI on the ball under pressure: two opponents closing in mean the ball goes at once (shielding
  from one left it open to the second); shielding turns the back on everybody close, not just the
  nearest; the deepest player releases it earlier; the keeper is a pass option in the own half under
  moderate pressure whenever the back pass is allowed.
- Defending a pivot with his back to goal: the defender stays about a metre goal-side of him,
  mirroring him, instead of stepping onto the ball (which let him spin off) — a plain turn now runs
  into the defender; a feint one way and a turn the other still often beats him. Measured: plain turn
  past the defender 12/20 -> 0-2/20, with a feint about 15/20.
- Supporting the pivot: with space down a wing, the nearest teammate carries his run on deep there
  (to the edge of the area) while the pivot has the ball, so the pivot can play him in. AI vs AI
  entries into the final third about 45 -> 82 per 18 min.
- The chip is a dink with the toe: slow and high, not much power — a tap just over a leg a couple of
  metres away, a full press up to about 5.5 m high and 11 m long, in the air about two seconds.

- Passing: hold the pass button for power — the pass is always along the floor, a tap soft, a long
  press firm; with two teammates in the same direction a long press picks the one further away.
  Passes are firmer in general (AI too). A teammate takes even a firm ground pass cleanly (up to
  12 m/s); a firm pass that strikes an opponent usually bounces off him instead of sticking.
- The through-pass button is now the chip (see the dink above for its final shape);
  the receiver runs to where it comes down. The charge bar shows the power.
- Keeper distribution in an arc: the AI keeper throws anything beyond a few metres (or a ball an
  opponent could cut out along the floor) as an arced throw over the opponents; the human keeper's
  overarm throws go higher.
- Defending: a second man goes to the ball only in the own half; the pivot follows a dangerous man
  between the ball and the goal out wide (he keeps the middle otherwise).

- Fixes after playtesting: the AI attacks and shoots again. Last round's "bend away from the human
  player from 4.5 m" made carriers turn away instead of going forward (shots against the test bot
  halved); they now bend round an opponent from 3 m and shield only right next to him.
- AI carriers no longer take the ball over the lines: near a touch line or goal line a heading out of
  the court (escaping a presser, a challenge down the line) is turned back along it, a shielding
  carrier faces along the line, and pinned against it he works his way back in. Pinned for two
  seconds he plays a pass away from the presser (or knocks it out for a kick-in) instead of
  shielding until the ball goes over — that used to end with the presser pushing him and the ball
  over his own goal line for a corner.
- The human player's sprint dribble keeps the ball closer: shorter knocks, a change of direction only
  turns the ball, and the ball goes between where he faces and where he runs.

### Milestone 6 — advanced futsal tactics (stage 1)

- Team tactics in the match state: formation (3-1, 4-0, 2-2) and pressing height (low block,
  mid-block, high press). Quick Match lets you choose both for your team (with a short description);
  computer teams play their own style; a `SetTactics` command changes them during a match.
- 4-0 attacks flat with no fixed pivot; 2-2 attacks with two pairs and defends in a box.
- A low block defends round its own area, stands off the carrier and does not follow men out; a high
  press engages everywhere and marks tight.

- Passes to feet go straight to the receiver: aimed from the ball (in front of the passer's feet)
  rather than from his body, and a moving receiver is led by at most a metre (a square pass no longer
  goes 20-30 degrees up the court in front of him).
- Receiving: no more back-pedalling before taking the ball. The meeting point allows for the reach of
  the foot (it used to lie behind him on the ball's path, so receivers ran backwards to it); a
  receiver steps on towards the ball instead of standing and waiting; coming to meet the ball does
  not make the first touch heavier, and a firm pass (up to 8 m/s) is controlled cleanly.
  Measured against the test bot: the human side's passes arriving 76 %, AI vs AI 92 %.

- Passing assistance: the receiver comes to meet a ball played to his feet, so passes are aimed at
  him with only a little lead (the old lead along his run sent passes past him, to an opponent or
  out); the controlled receiver meets the pass automatically even while the passing key is still
  held; the assist prefers an open teammate to one with an opponent on the line; the human player's
  passes are played firmer. Measured against a test bot: the human side's passes arriving 28 % -> 65 %.
- AI carrier against a close opponent (the human above all): bends round him early and shields the
  ball (sole, body between) instead of dribbling into him.
- Restarts: opponents — the human player as well — are walked out of the 4 m circle at kick-ins,
  corners and free kicks and out of the penalty area during the opponents' goal clearance (no more
  kicks blocked from next to the ball, no endless retaken clearances). Normal passes are no longer
  aimed right at the touchline. AI passes reaching the bot's side 46 -> 28 and failed kick-ins
  8/33 -> 0/12 per 24 min; AI vs AI completion 89 % -> 92 %.

- Human control: the controlled player turns and accelerates quicker, stops sooner when the keys are
  released and curves into a new direction keeping his pace (within a realistic sideways
  acceleration: a sprinter curves wider than a jogging player) instead of braking and re-accelerating;
  turning towards where he runs no longer slows him; sprint-dribbling, a change of direction takes the
  ball along at once. The AI's estimate of how quickly the human can cut out a pass was updated to
  match.
- Defending alas keep their side: they mark a man in their own zone and no longer swap men or run
  across the court after one (at most 2 m over the middle).
- AI attack: the vertical ball into the pivot is played whenever the lane to his feet is open (a
  marker behind him does not stop it); then the nearest teammate comes to a lay-off spot behind him on
  the inside and the next one attacks the far post; the pivot lays it off to a teammate with a better
  shot, who strikes it first time.
- Build-up: when the deepest player has the ball and turns to one side, the ala on that side drops
  level with him out wide, offering an easy square pass.
- Clearances from the own third are never kicked straight into the presser in front, and go to the
  wing the human player cannot reach.

- Defending: the pivot keeps the middle closed and stays with his man (he no longer runs from side
  to side after the ball); the alas press the carrier. Only a carrier with his back to the goal he
  attacks is pressed by the pivot, from the side he faces (closing the pass back). A second man goes
  to the ball only in the own end, also in a counter-attack.
- Goalkeeper: never turns his back to the court for a ball behind him (after conceding he faces the
  court); a placed shot straight at him is held instead of always pushed away; a more compact side
  dive (knees bent, arms bent, no stretched-out figure); keepers are generated about 3 cm shorter and
  get only half of the player size enlargement, so they no longer look too big for the 2 m goal.
- Kick-off: the human taker cannot walk away from the ball before the kick (the direction keys aim).
- Kick-ins and corners: the AI does not play a ball the human player (or another opponent) could cut
  out while there is time; the routine runners must also be safe. Late on the aim is frozen so the
  taker is lined up behind the ball.
- Four-second count on screen for both teams: kick-ins, corners, free kicks and a keeper with the
  ball in his own half (goal clearances); one dot fills per second.
- Alas start deeper in build-up: at kick-offs, at goal clearances (2.5 m deeper than the attacking
  shape) and when their keeper has the ball in open play (2 m for a human keeper's team).

- Goal clearances follow the rule: the keeper's throw must leave the penalty area before anybody
  touches it, otherwise the clearance is retaken (HUD message). Players not under human control —
  opponents and teammates alike — leave the area for the clearance and stay out until the ball is
  out of it; blocking the keeper's distribution inside the area is no longer possible.
- AI against a human player: the AI now rates the human-controlled player as quicker to react, turn
  and accelerate when judging whether he can cut out a pass; a last-resort pass he could intercept is
  no longer played (the carrier shields and carries instead); the carrier releases the ball while the
  safe option is still open when a presser is closing in; keeper throws only go to teammates who
  cannot be cut off. Measured against a pressing test bot: passes cut out 82 -> about 50 per 18 min.
- AI shooting: the shooting band starts closer (8-10.5 m by finishing; placed shots up to 8.5 m).
- AI attacking against a human: breakaways no longer finish from 10-11 m as soon as a chaser closes
  in; the carrier goes on to about 8 m, squares the ball to a teammate free closer in when the keeper
  rushes out, and strikes firmer from further out. Pass and move: after a forward or square pass the
  passer runs into space for the return. A blocked carrier turns away from the presser instead of
  into him; screened long shots are tried more often. In the own third under pressure the ball is
  cleared long up the wing, and the keeper no longer throws short to a teammate about to be pressed.
  Measured against the pressing test bot (6 x 3 min): AI goals 1 -> 3, bot goals 16 -> 4-6, AI
  entries into the final third 12 -> 23; AI vs AI goals rose as well.
- Pressing: close to the carrier the presser keeps pace with him (jockeying only while the carrier is
  nearly still) and sprints when he does.

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
