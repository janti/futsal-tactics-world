# Futsal Tactics World

An original browser futsal game: immediate arcade controls, authentic futsal tactics, a vertical
78° orthographic camera and modern "retro realism" 3D graphics. Runs fully locally as a static site —
no backend, no paid services, no external assets.

> **Status: Milestone 2 (complete basic arcade match) done.** See [TASKS.md](TASKS.md) and
> [ROADMAP.md](ROADMAP.md) for what exists and what is next.

## Running locally

```bash
npm install
npm run dev        # http://localhost:5173
```

Production build and local preview:

```bash
npm run build
npm run preview
```

Optional URL parameter: `?gfx=low|medium|high` selects a graphics preset (default `high`).

## Scripts

| Script               | What it does                                           |
| -------------------- | ------------------------------------------------------ |
| `npm run dev`        | Vite dev server                                        |
| `npm run build`      | Type-check (`tsc -b`) and production build to `dist/`  |
| `npm run preview`    | Serve the production build                             |
| `npm run typecheck`  | TypeScript only                                        |
| `npm test`           | Unit + integration tests (Vitest, headless simulation) |
| `npm run test:watch` | Vitest watch mode                                      |
| `npm run test:e2e`   | Browser smoke tests (Playwright, Chromium)             |
| `npm run lint`       | Oxlint                                                 |
| `npm run format`     | Prettier                                               |

First-time e2e setup: `npx playwright install chromium`.

## Controls (keyboard)

| Key           | Action                                           |
| ------------- | ------------------------------------------------ |
| WASD / arrows | Move (always relative to the screen)             |
| Z             | Pass (with the ball) / standing tackle (without) |
| X             | Shoot — tap for a quick shot, hold to power up   |
| C             | Through pass                                     |
| V             | Switch player                                    |
| Shift         | Sprint                                           |
| Space         | Sole control (with ball) / jockey (without)      |
| F5 or 5       | Cycle camera preset                              |
| Esc or P      | Pause                                            |
| H             | Show controls                                    |

Alternative keys: J/K/L/I for pass/shoot/through/switch. A standard gamepad works for movement and
actions (left stick, A pass, B shoot, X through, Y switch, RT sprint, LT sole).

Pressing pass/shoot just before the ball reaches you buffers a one-touch pass or first-time shot.

**Goalkeeper throw:** when your keeper holds the ball in the hands you control him — aim with the
direction keys, hold Z (or X/C) for power and release to throw. Soft throws roll along the floor,
hard throws go through the air. You have four seconds before the keeper throws automatically.

When defending you control the player nearest the ball by default. Change this under **Settings**
(title screen or pause menu): nearest player, assisted or manual.

Kick-ins, corners and kick-offs must be kicked (pass or shoot) — the taker cannot dribble, and
kick-ins and corners must be taken within four seconds.

## Technology

TypeScript (strict) · Vite · Three.js (WebGL) · React · Zustand · Vitest · Playwright · Oxlint ·
Prettier. Custom deterministic physics at a fixed 60 Hz; rendering interpolates snapshots.

## Deployment

The build is a static site with a relative base path (`base: './'`), so `dist/` can be served from
any static host or sub-path, e.g. GitHub Pages:

1. `npm run build`
2. Publish the `dist/` folder (e.g. with a GitHub Actions Pages workflow or the `gh-pages` branch).

No server-side functionality is required. A service worker for offline play is planned for release
preparation (Milestone 10), deliberately not earlier.

## Documentation

[GAME_DESIGN](GAME_DESIGN.md) · [ARCHITECTURE](ARCHITECTURE.md) · [AI_DESIGN](AI_DESIGN.md) ·
[TACTICS_DESIGN](TACTICS_DESIGN.md) · [CAMERA_DESIGN](CAMERA_DESIGN.md) ·
[ART_DIRECTION](ART_DIRECTION.md) · [RULES_DESIGN](RULES_DESIGN.md) · [ROADMAP](ROADMAP.md) ·
[TASKS](TASKS.md) · [ASSET_LICENSES](ASSET_LICENSES.md) · [CHANGELOG](CHANGELOG.md)
