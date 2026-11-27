# Tasks

## Completed

### Milestone 0

- [x] Vite + React + strict TypeScript (TS 7) project, pinned dependencies with lockfile
- [x] Three.js, Zustand, Vitest, Playwright, Oxlint, Prettier; all npm scripts working
- [x] Seeded RNG, vector/scalar maths, single coordinate conversion module
- [x] Simulation types, commands, events, config; documentation set

### Milestone 1

- [x] 40 × 20 m court with procedural parquet and accurate markings; Finnish Classic Hall
- [x] Goals (posts, crossbar, frame, nets) matching physics geometry
- [x] Procedural articulated semi-realistic players (~1.6k tris) with procedural animation
- [x] Independent ball physics: gravity, rolling resistance, low bounce, spin curve, posts/crossbar/nets,
      substepped continuous collision
- [x] Vertical Smart 78° orthographic camera + Classic / Full Court / Close Action presets
- [x] Screen-relative keyboard input, gamepad basics, input buffering (one-touch)
- [x] Player movement physics and collisions; dribbling, sole control, first touch, steals, tackles
- [x] Assisted passing with lead prediction, through passes, charge shooting with seeded error
- [x] Goal detection, kick-off, kick-ins, corners, goal clearances
- [x] Basic team AI (anti-ball-chasing, support, cover, press, carrier decisions, goalkeepers)
- [x] Player switching: manual, after own passes, assisted when defending
- [x] HUD (score, effective clock, controlled player, shot power), pause menu, FI/EN localisation
- [x] 48 unit/integration tests, 2 Playwright browser tests

### Post-M1 changes

- [x] Defensive player selection setting: nearest (default) / assisted / manual; persisted, in the
      title and pause menus, applied to a running match via a `SetControlOptions` command
- [x] Kick-ins, corners and kick-offs must be kicked (no dribbling), no double touch, four-second
      rule for kick-ins and corners with HUD countdown; AI takers pass
- [x] Input: quick taps between two samples are latched (were lost at low frame rates)
- [x] 64 unit/integration tests, 3 Playwright browser tests
- [x] Kick-off positions (own half, defenders outside the circle), human player walked back
- [x] Goalkeeper: body block after failed save, closest-approach timing, reaction time from shot
      distance, reaction delay, speed cap, dive reach
- [x] Direct AI: forward pass to scoring chances, otherwise carry/circulate; shooting lane fix
- [x] Shorter player legs
- [x] 73 unit/integration/tactical tests, 3 Playwright browser tests
- [x] Goalkeeper hands vs. feet (back pass), no challenges on a held ball, holding pose
- [x] Ball out of play flies on to the boards/walls and bounces; camera frames the hall end
- [x] 81 unit/integration/tactical tests, 3 Playwright browser tests
- [x] Controllable keeper throw (aim + charged power, bowled vs overarm, aim arrow, 4 s limit)
- [x] 92 unit/integration/tactical tests, 3 Playwright browser tests

### Milestone 2

- [x] Quick Match setup screen (teams, half length, effective/running clock), remembered
- [x] Match clock, two halves, half-time break, ends switch, second-half kick-off by the other team
- [x] Presentation keeps the human team attacking up after half-time (setting)
- [x] Full time: result and statistics screen, rematch / new match / menu
- [x] Team statistics from the event stream
- [x] 98 unit/integration/tactical tests, 4 Playwright browser tests

### Milestone 3

- [x] Touch-based sprint dribbling, shielding (sole + turn the back), heavy first touch, AI reads and
      intercepts passes
- [x] Gamepad: Start pauses, menus navigable (D-pad/stick, A, B); rebindable keyboard controls
- [x] Passing assistance levels (assisted / semi-assisted / manual with charged power)
- [x] Difficulty levels (easy / normal / hard) wired into the opponent's decision quality
- [x] Goalkeeper four-second rule with an indirect free kick (area-line spot, indirect: no direct goal,
      four-second limit on the free kick itself)
- [x] 163 unit/integration/tactical tests, 6 Playwright browser tests

### Milestone 4

- [x] Horizontal camera presets (Horizontal Tactical, Horizontal Full Court); camera choice in settings
- [x] Camera Lab: custom camera tuned live while playing (key 6 / pause menu), persisted
- [x] Radar / minimap with the camera window, oriented like the main view; on/off setting
- [x] Graphics quality setting (low / medium / high; URL `?gfx=` still overrides)
- [x] Hall polish: stepped stands with team-coloured seat rows, aisles and rails, end stands behind
      the goals, substitutes and timekeepers' table, board slogans that fit
- [x] Fixed: Esc did not close the pause menu while a setting had the keyboard focus
- [x] 184 unit/integration/tactical tests, 7 Playwright browser tests

### Milestone 5

- [x] AI split into layers: `ai/team` (defending, attacking, phases, roles), `ai/player` (carrier,
      goalkeeper, off-ball), `ai/passing`, `ai/movement`, `ai/restarts`, `ai/spatial`, `ai/common`
      (behaviour fingerprint identical before and after the split)
- [x] Team phases (attack, counter-attack window, defence, transition to defence, set piece, dead)
- [x] Spatial grid: pitch control (2 m cells, cached), used for support positioning
- [x] Time-to-reach model with turning, shared by pressing, interceptions, keeper and pass safety
- [x] Dynamic role assignment in attack (players fill the shape from where they are)
- [x] Utility-scored carrier decisions (shot value vs a teammate's, bands for the futsal priorities)
- [x] Coverage made visible: AI overlay on the radar (key 7: pitch control and team phases)
- [x] 213 unit/integration/tactical tests, 7 Playwright browser tests

## Current / next (Milestone 6: advanced futsal tactics)

- [x] Stage 1: tactics model in the match state, formations 3-1 / 4-0 / 2-2, pressing height
      (low / mid / high), choice in Quick Match, team styles, SetTactics command
- [x] Stage 2: pressing triggers (back pass, back to goal, poor touch, touch line trap), gated by
      the pressing height
- [x] Stage 3: rotations as continuous off-ball movement (3-1 pohjakasi and its variation from the
      wing, 4-0 perhonen and the 4-player rotation) and combinations (wall pass, overlap, pivot switch,
      back post), with triggers, balance, completion and cancellation; on/off in the team tactics
- [x] Stage 4: Tactical Lab (scenario sandbox: twelve situations, watch / attack / defend, tactics,
      speed, outcomes counted) and the AI view over the main view (intentions, marking, rotations,
      pressing jumps)
- [ ] Stage 5: quick tactics changes during the match, acceptance criteria, docs

## Known bugs / issues

- Tactical Lab: in built-up situations the AI attackers lose the ball in 55–75 % of attempts; a carrier
  chased from behind (e.g. after a completed 1-2) passes back instead of driving on.
- The browser smoke test "quick match: move, pass, shoot…" is timing-sensitive (the bot has to win the
  ball) and fails now and then; it passes on a rerun.

- AI vs AI produces many goals for real futsal (arcade-level scoring); tune with the M5 utility AI.
- An idle human player near opponents loses the ball quickly (steal rate tuning pending playtests).
- Players are small at the spec default 27 m visible length on 16:9 (tunable in the M4 Camera Lab).
- Kick-ins and corners are rare in AI vs AI play (accurate passing, close-range shooting).
- HUD hint texts still name the default keys after rebinding.

## Technical debt

- About 400 draw calls (≈ 25 meshes per player); consider merged/skinned player meshes in M4.
- Bundle is one ~860 kB chunk (mostly Three.js); code-split menus later if needed.
- Club names are provisional; check for conflicts with real clubs before any public release.
