# Art Direction — Vertical Retro Realism

Modernised late-90s/early-2000s football game look with current rendering: semi-realistic players,
natural proportions, slightly angular low-poly geometry, warm parquet, clean lighting. Retro feel
comes from design, geometry and interface — never from pixelation, CRT filters or blur.

## Players (`rendering/PlayerModel.ts`)

- Original procedural articulated model built for 1.78 m (tested) and scaled by player height × a visual
  scale (setting: 100 %, 106 % or the default 112 %); build (width) from weight. About 1,600 triangles.
- Hierarchy: root › pelvis › torso › neck › head; shoulders › upper arm › forearm › hand;
  hips › thigh › shin › foot. Tapered 8-sided limbs, lathe-turned torso and hips, angular shoes.
- Simplified face (nose), four hair styles, five skin tones, kit colours per team, shirt number on
  the back, distinct goalkeeper kits with gloves.
- Procedural animation: stride frequency from actual ground speed (reduces foot sliding), run/walk
  blend, arm swing, lean, idle/goalkeeper ready stance, kick (wind-up/strike/follow-through, preferred
  foot), sole control pose, tackle lunge, goalkeeper save reach, goalkeeper holding the ball in both hands at chest height (two-bone arm IK), goalkeeper arm throw. Run cycle: keyframed gait (contact, push-off, short heel lift, knee drive) with Catmull-Rom interpolation, pelvis bounce, hip/shoulder counter-rotation; the foot stays within about 0.4 m behind the hip seen from above. Animation never delays input.

## Court and arena (`rendering/CourtRenderer.ts`, `textures.ts`)

- Honey parquet generated on a canvas: 10 cm planks along the length, staggered joints, subtle grain,
  anisotropic filtering, roughness 0.48 (not shiny).
- Markings drawn to scale: boundary, halfway line, 3 m centre circle, D-shaped penalty areas
  (6 m quarter circles from the posts joined by a straight line), 6 m and 10 m marks, 5 m marks beside
  the second penalty mark, corner arcs, substitution-zone marks.
- Finnish Classic Hall: blue surround, advertising boards (fictional text only), five-tier stands with
  instanced spectators, benches, dark hall walls.

## Goals

White 8 cm posts and crossbar, grey support frame, and nets drawn as a white line mesh (12 cm
squares) on back, roof and sides; the net gives on impact like a damped spring (bigger for harder shots) and swings back.

## Lighting

Hemisphere fill + warm overhead key light with PCF soft shadow map + three soft overhead points;
ACES tone mapping, sRGB output. Blob contact shadows under players and ball (ball shadow shrinks with
height). No bloom, lens flare, motion blur or depth of field.

## Interface

Palette: background #101923, panels #1C2938, text #F2F5F8 / #9DAFC1, accent blue #4D8DD8,
highlight amber #E9BB48. Bold italic uppercase sports headings, compact rectangular panels, system
fonts only (no remote fonts). The centre of the screen stays clear.
