import { teamToWorld, worldToTeam, type TeamRelative } from '../../core/coords'
import { clamp } from '../../core/math/scalar'
import type { Vec2 } from '../../core/math/vec2'
import type { AttackDir, PlayerRole } from '../../simulation/MatchState'
import { COURT } from '../../simulation/SimulationConfig'

/**
 * 3-1 formation templates in normalised team-relative coordinates (lateral -1..1, depth 0..1).
 * Anchors are reference positions, blended with ball position; they are never teleport targets.
 * The full multi-formation / multi-template system arrives with the tactical milestones.
 */
export type ShapeMode = 'attack' | 'defend' | 'kickoffOwn' | 'kickoffOpp'

const TEMPLATES: Record<ShapeMode, Record<PlayerRole, TeamRelative>> = {
  attack: {
    GK: { lateral: 0, depth: 0.04 },
    FIXO: { lateral: 0, depth: 0.36 },
    ALA_L: { lateral: -0.72, depth: 0.55 },
    ALA_R: { lateral: 0.72, depth: 0.55 },
    PIVOT: { lateral: 0.05, depth: 0.82 },
  },
  defend: {
    GK: { lateral: 0, depth: 0.03 },
    FIXO: { lateral: 0, depth: 0.2 },
    ALA_L: { lateral: -0.42, depth: 0.32 },
    ALA_R: { lateral: 0.42, depth: 0.32 },
    PIVOT: { lateral: 0, depth: 0.46 },
  },
  kickoffOwn: {
    GK: { lateral: 0, depth: 0.03 },
    FIXO: { lateral: 0, depth: 0.27 },
    ALA_L: { lateral: -0.6, depth: 0.42 },
    ALA_R: { lateral: 0.6, depth: 0.42 },
    PIVOT: { lateral: 0, depth: 0.49 },
  },
  kickoffOpp: {
    GK: { lateral: 0, depth: 0.03 },
    FIXO: { lateral: 0, depth: 0.25 },
    ALA_L: { lateral: -0.55, depth: 0.38 },
    ALA_R: { lateral: 0.55, depth: 0.38 },
    PIVOT: { lateral: 0, depth: 0.41 },
  },
}

export function baseAnchor(role: PlayerRole, mode: ShapeMode, attackDir: AttackDir): Vec2 {
  return teamToWorld(TEMPLATES[mode][role], attackDir, COURT.halfWidth, COURT.halfLength)
}

/**
 * Defensive diamond that moves with the ball (team-relative): the pivot at the top just goal-side of
 * the ball, the alas either side a step deeper and the fixo at the bottom. The block is high and
 * compact (about 4.4 m between the lines) and slides across towards the ball side.
 */
export function diamondAnchor(role: PlayerRole, attackDir: AttackDir, ball: Vec2): Vec2 {
  if (role === 'GK') return baseAnchor('GK', 'defend', attackDir)
  const b = worldToTeam(ball, attackDir, COURT.halfWidth, COURT.halfLength)
  const step = 0.11
  // The pivot sits a little off the ball and in the middle (closing the central lane) rather than
  // chasing high up the court.
  const top = clamp(b.depth - 0.1, 0.2, 0.68)
  const lat = clamp(b.lateral * 0.55, -0.45, 0.45)
  let rel: TeamRelative
  if (role === 'PIVOT') rel = { lateral: lat * 0.5, depth: top }
  else if (role === 'FIXO') rel = { lateral: lat * 0.6, depth: Math.max(0.06, top - 2 * step) }
  else
    rel = {
      lateral: clamp(lat + (role === 'ALA_L' ? -0.48 : 0.48), -0.85, 0.85),
      depth: Math.max(0.12, top - step),
    }
  return teamToWorld(rel, attackDir, COURT.halfWidth, COURT.halfLength)
}

/**
 * Ball-oriented anchor: the block slides with the ball along the length and partly across the width.
 * Defending shapes shift less in depth and stay compact around the centre.
 */
export function dynamicAnchor(
  role: PlayerRole,
  mode: 'attack' | 'defend',
  attackDir: AttackDir,
  ball: Vec2,
): Vec2 {
  const base = TEMPLATES[mode][role]
  if (role === 'GK') return teamToWorld(base, attackDir, COURT.halfWidth, COURT.halfLength)
  const b = worldToTeam(ball, attackDir, COURT.halfWidth, COURT.halfLength)
  const depthShift = (b.depth - 0.5) * (mode === 'attack' ? 0.55 : 0.5)
  const lateralPull = mode === 'attack' ? 0.3 : 0.4
  const widthScale = mode === 'attack' ? 0.85 : 0.7
  const rel: TeamRelative = {
    lateral: clamp(base.lateral * widthScale + b.lateral * lateralPull, -0.9, 0.9),
    depth: clamp(base.depth + depthShift, mode === 'attack' ? 0.2 : 0.08, mode === 'attack' ? 0.93 : 0.7),
  }
  return teamToWorld(rel, attackDir, COURT.halfWidth, COURT.halfLength)
}
