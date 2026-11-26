# Roadmap

| #   | Milestone                                                                                                                       | Status  |
| --- | ------------------------------------------------------------------------------------------------------------------------------- | ------- |
| 0   | Project foundation (Vite, strict TS, Three.js, React, Zustand, Vitest, lint, docs, RNG, vectors)                                | ✅ Done |
| 1   | Playable 3D prototype (court, goals, procedural players, ball physics, 78° camera, keyboard, pass, shoot, goals, animations)    | ✅ Done |
| 2   | Complete basic arcade match (match clock + halves, full restarts, match end, Quick Match menu with team/length choice)          | ✅ Done |
| 3   | Gameplay physics and controls polish (touch-based dribbling, shielding, interceptions, gamepad completeness, assistance levels) | ✅ Done |
| 4   | Camera and visual identity (all presets incl. horizontal, Camera Lab, radar, graphics settings UI, polished hall)               | ✅ Done |
| 5   | Tactical AI foundation (utility AI, phases, spatial grid, time-to-reach model, role assignment, coverage)                       | Next    |
| 6   | Advanced futsal tactics (all formations, rotations, pivot play, back post, pressing triggers, Tactical Lab, AI debug overlay)   |         |
| 7   | Rules and tactical editor (versioned rules engine, fouls, cards, substitutions, stamina, timeouts, flying GK, AI coach)         |         |
| 8   | Presentation and analysis (arenas, audio, crowd, replays, statistics, analysis, coach/spectator/training modes)                 |         |
| 9   | Career mode (clubs, players, competitions, saves, transfers, training, finances, multi-season)                                  |         |
| 10  | Release preparation (performance, compatibility, accessibility, localisation review, offline, deployment)                       |         |

## Acceptance criteria used so far

- **M0**: dev server starts, type checking passes, tests run, production build succeeds — met.
- **M1**: user can move, pass, shoot and score in the browser; prototype feels responsive — met
  (automated: `tests/integration/simulation.test.ts`, `tests/browser/smoke.spec.ts`; manual check in
  Chromium).
- **M2**: a complete match can be played against AI — met: Quick Match setup (teams, half length,
  clock mode), two halves with half-time and ends switch, full time with a result and statistics
  screen, rematch (automated: `tests/integration/matchClock.test.ts`, browser test "quick match setup,
  half-time and the full-time result screen").

- **M3**: touch-based sprint dribbling, shielding, heavy first touches and AI pass interceptions;
  passing assistance levels (assisted / semi / manual with charged power); difficulty levels that
  change the computer opponent's decision and execution quality; gamepad Start/B and menu navigation;
  rebindable keyboard controls; keeper four-second rule with an indirect free kick — met (automated:
  `tests/unit/dribbling.test.ts`, `passAssist.test.ts`, `bindings.test.ts`,
  `tests/tactical/difficulty.test.ts`, `keeperThrow.test.ts`, browser tests "gamepad…" and
  "settings…").

- **M4**: horizontal camera presets (tactical side view and full court), the playable Camera Lab
  (custom camera tuned live while playing, persisted), radar/minimap oriented like the main view with
  the camera window, graphics quality and camera choice in the settings, a polished hall (stepped
  stands with seat rows and aisles, end stands, substitutes and timekeepers' table, readable boards)
  — met (automated: `tests/unit/camera.test.ts`, browser test "camera and visuals…").

## Dependencies between milestones

M2 builds on the M1 simulation loop; M5–M6 replace `ai/BasicAI.ts`; M7 needs the rules edition
decision (RULES_DESIGN.md); M9 needs the headless simulation (already headless) and IndexedDB saves.
