# Architecture

## Layers

1. **Authoritative match simulation** — `src/simulation`, `src/physics`, `src/core`
2. **Tactical AI and rules** — `src/ai` (rules engine arrives in Milestone 7)
3. **Rendering, animation, camera** — `src/rendering`, `src/camera`
4. **UI and management** — `src/ui`, `src/app`, `src/localization`

The simulation never imports Three.js, React, the DOM, the camera or graphics settings. It runs
headless in Vitest (`tests/integration`). The only Three.js import in a test is the camera test.

## Data flow

```
Keyboard/Gamepad ──► InputManager.sample(cameraBasis) ──► Command[]  (once per 60 Hz tick)
                                                            │
                                                            ▼
                          MatchSimulation.step(commands)  ── MatchEvent[] ──► HUD / stats / audio
                                                            │
                                         writeSnapshot ─► prev/curr MatchSnapshot (preallocated)
                                                            │
                          ThreeRenderer.render(prev, curr, alpha)   (display rate, interpolated)
```

- `app/GameSession.ts` owns the fixed-timestep loop (accumulator, `MAX_FRAME_TIME = 0.25 s` cap
  against catch-up spirals, auto-pause when the tab is hidden).
- Input is converted to simulation directions using the **actual camera basis**
  (`camera/ScreenToWorld.ts`), so movement is always screen-relative.
- React only receives HUD values at ~10 Hz via a Zustand store (`ui/store.ts`). Positions never
  enter React state.

## Simulation tick order (`MatchSimulation.step`)

1. Rebuild the human player's intent from this tick's commands
2. Phase handling (restarts, goal celebration → kick-off)
3. AI decisions (10 Hz, staggered by player id) + steering every tick
4. Action timers (kick/tackle/save), input-buffer expiry
5. Player movement physics, player–player collisions
6. Ball control (dribble spring, steals, tackles)
7. Ball physics in distance-limited substeps with player/goalkeeper contacts, posts, crossbar, nets
8. Goal and out-of-play detection → restart
9. Possession tracking and player switching (inside the relevant actions)
10. Events are queued and drained by the session

## Determinism

- All authoritative randomness uses `core/random/SeededRandom` (mulberry32). `Math.random` is not
  used in simulation code.
- Shot power is charged in simulation ticks, so a recorded command stream reproduces a match
  exactly (`tests/integration/simulation.test.ts › determinism`).
- Simulation time (`state.time`, `state.playingTime`) is authoritative; wall-clock time is used only
  for presentation (HUD flashes).

## Coordinates

One conversion module, `core/coords.ts`: sim (x width, y length, z height) ↔ Three.js
(X = x, Y = z, Z = y). Team-relative normalised coordinates (`lateral -1..1`, `depth 0..1`) are used
for formations. See CAMERA_DESIGN.md for the screen mapping.

## Key decisions

| Decision                                 | Reason                                                                                                                          |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Custom physics, no physics engine        | Small, deterministic, tuned for arcade feel; substepping gives continuous collision for posts/players.                          |
| Oxlint instead of ESLint                 | The scaffold shipped with Oxlint; it is free, fast and covers the same role. Swap is cheap if ESLint-specific rules are needed. |
| Procedural models/textures               | Game must run without external assets; GLB pipeline is a later optional layer.                                                  |
| Ball dribble as a spring, not attachment | Ball stays an independent physical entity; control can be lost or stolen.                                                       |
| Relative Vite `base`                     | Static deployment to any sub-path without configuration.                                                                        |
| `?gfx=` URL preset                       | Lets low-end machines and headless CI pick a cheaper renderer before the settings UI exists.                                    |

## Module map

| Path                                         | Responsibility                                                                                                                                                                                                                                 |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `core/math`, `core/random`, `core/coords.ts` | Vectors, scalar helpers, seeded RNG, coordinate conversion                                                                                                                                                                                     |
| `simulation/`                                | State types, config, commands, events, snapshots, `MatchSimulation`                                                                                                                                                                            |
| `physics/`                                   | Player movement + collisions, ball physics, passing and shooting planning                                                                                                                                                                      |
| `ai/`                                        | Layered AI: `team/` (defending, attacking, phases, roles), `player/` (carrier, goalkeeper, off-ball), `passing`, `movement`, `restarts`, `spatial/` (pitch control), `positioning/` (formation anchors); `BasicAI.ts` runs the per-tick update |
| `camera/`                                    | Presets, framing maths, Vertical Smart controller, screen↔world basis                                                                                                                                                                          |
| `rendering/`                                 | Renderer, court/arena, goals, procedural player model + animation, ball, lighting, textures                                                                                                                                                    |
| `input/`                                     | Key/gamepad mapping, command sampling                                                                                                                                                                                                          |
| `ui/`, `app/`                                | React screens, HUD, store, game session loop                                                                                                                                                                                                   |
| `localization/`                              | Finnish and English dictionaries                                                                                                                                                                                                               |
| `data/`                                      | Fictional teams and seeded player generation                                                                                                                                                                                                   |
