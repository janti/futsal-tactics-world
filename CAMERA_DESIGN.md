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
- Target clamped so the view never drifts more than 6 m past a goal line (the advertising boards 4 m behind the line stay visible, so balls going wide can be followed to the boards).

## Presets (F5 / 5 cycles; persisted in localStorage)

| Preset                | Elevation | Visible length | Tracking                  |
| --------------------- | --------- | -------------- | ------------------------- |
| Vertical Smart        | 78°       | 27 m           | predictive                |
| Vertical Classic      | 88°       | 26 m           | basic, no look-ahead/bias |
| Vertical Full Court   | 86°       | 44 m           | fixed                     |
| Vertical Close Action | 70°       | 22 m           | predictive                |

At half-time the teams switch ends. By default the presentation rotates 180° during the break so the
human team keeps attacking up the screen (`presentationUpSign`; input follows automatically because it
uses the camera basis). With the setting off the view stays fixed (traditional alternating
directions).

Horizontal Tactical, the radar and the playable Camera Lab are Milestone 4. Camera changes never affect simulation results (the simulation does not import the
camera).

## Coordinate conversion and screen mapping

Three.js `X = sim x`, `Y = height`, `Z = sim y` (`core/coords.ts`). This swaps two axes, so with the
camera behind the human team (looking +Z) **screen right is sim −x**. Input therefore uses the
camera's real basis (`basisFromCamera`), which a unit test checks against the analytic basis for
both ends and against `Vector3.project`.

## Known limitation

At 27 m visible length on a 16:9 screen the players are fairly small; the Camera Lab (M4) will make
this tunable live. Player visual scale is 112 % (collision size unchanged).
