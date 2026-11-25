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

## Current / next (Milestone 3: gameplay physics and controls)

- [ ] Touch-based dribbling and shielding, better first touch and interceptions
- [ ] Gamepad completeness (pause, menus), configurable controls
- [ ] Passing assistance levels (assisted / semi-assisted / manual)
- [ ] Difficulty levels wired into AI decision quality
- [ ] Goalkeeper four-second rule with indirect free kick (needs free kicks)

## Known bugs / issues

- AI vs AI produces many goals for real futsal (arcade-level scoring); tune with the M5 utility AI.
- An idle human player near opponents loses the ball quickly (steal rate tuning pending playtests).
- Players are small at the spec default 27 m visible length on 16:9 (tunable in the M4 Camera Lab).
- Gamepad Start does not open the pause menu yet.

## Technical debt

- `BasicAI.ts` is a single module; split into team/player/movement layers in M5.
- `estimateTimeToReach` lacks turning delay; replace with the shared interception model.
- About 400 draw calls (≈ 25 meshes per player); consider merged/skinned player meshes in M4.
- Bundle is one ~860 kB chunk (mostly Three.js); code-split menus later if needed.
- Club names are provisional; check for conflicts with real clubs before any public release.
