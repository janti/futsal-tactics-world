# Camera Design

## Vertical Smart (default) — `camera/CameraController.ts`

- Orthographic, **78°** elevation, no roll, never rotates on possession changes.
- The human team attacks towards the top of the screen (`upSign` = human attack direction).
- Frustum from the real viewport aspect (`camera/CameraFraming.ts`): a ground length `L` occupies
  `L · sin(78°)` of view height. Target visible length 27 m; the full court width plus 1.6 m margins
  always fits — on narrow/portrait screens the view grows and shows more length instead.
- Target: ball position + 0.25 s velocity look-ahead + up to 3 m bias towards the attacking direction
  of the team in possession (reduced to 40 % when the ball is loose). The controlled player is kept
  on screen whenever possible without losing the ball.
- 1 m dead zone, exponential damping (`1 − e^(−dt/τ)`, τ = 0.18 s position, 0.5 s zoom) — frame-rate
  independent (tested at 30 vs 120 fps).
- Fast balls never leave the frame: the ball (drawn position, height included) is kept at least
  2.5 m inside the frame in the target and 1.5 m after damping, plus up to 6 m of its path ahead — a
  quick ball up the court pushes the view along with it, even ahead of a deep controlled player.
- Target clamped so the view never drifts more than 6 m past a goal line (the advertising boards 4 m behind the line stay visible, so balls going wide can be followed to the boards).

## Presets (F5 / 5 cycles; persisted in localStorage)

| Preset                | Elevation | Visible length | Tracking                  |
| --------------------- | --------- | -------------- | ------------------------- |
| Vertical Smart        | 78°       | 27 m           | predictive                |
| Vertical Classic      | 88°       | 26 m           | basic, no look-ahead/bias |
| Vertical Full Court   | 86°       | 44 m           | fixed                     |
| Vertical Close Action | 70°       | 22 m           | predictive                |
| Horizontal Tactical   | 62°       | 30 m (across)  | predictive                |
| Horizontal Full Court | 58°       | 44 m (across)  | fixed                     |
| Custom (Camera Lab)   | 45–90°    | 16–48 m        | as tuned                  |

### Horizontal views

The camera stands on a touch line and looks across the court: the length runs across the screen
(unforeshortened) and your team attacks to the right; the court width is seen in depth (foreshortened
by sin(elevation)) and always fits, otherwise the view grows. Input stays screen-relative through the
camera basis (screen right = your attacking direction).

### Camera Lab

Key 6 or the pause menu opens a panel beside the running match: orientation, fixed/tracking,
elevation, visible length, look-ahead, attack bias, smoothing, dead zone and side margin. Any change
switches to the custom camera; values are validated, clamped and stored in localStorage.

### Radar

A 2D canvas minimap (top right) shows the court, players, ball, your controlled player and the part of
the court the camera shows. It is oriented like the main view (portrait for vertical cameras,
landscape for horizontal ones) and can be switched off in the settings.

At half-time the teams switch ends. By default the presentation rotates 180° during the break so the
human team keeps attacking up the screen (`presentationUpSign`; input follows automatically because it
uses the camera basis). With the setting off the view stays fixed (traditional alternating
directions).

Camera changes never affect simulation results (the simulation does not import the camera).

## Coordinate conversion and screen mapping

Three.js `X = sim x`, `Y = height`, `Z = sim y` (`core/coords.ts`). This swaps two axes, so with the
camera behind the human team (looking +Z) **screen right is sim −x**. Input therefore uses the
camera's real basis (`basisFromCamera`), which a unit test checks against the analytic basis for
both ends and against `Vector3.project`.

## Known limitation

At 27 m visible length on a 16:9 screen the players are fairly small; the Camera Lab makes this
tunable live. Player visual scale is 112 % (collision size unchanged).
