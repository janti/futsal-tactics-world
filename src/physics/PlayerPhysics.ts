import { angleDiff, attr, clamp, turnTowards } from '../core/math/scalar'
import { angleOf, clampLen, dot, len, sub, type Vec2 } from '../core/math/vec2'
import type { PlayerState } from '../simulation/MatchState'
import { COURT, PLAYER } from '../simulation/SimulationConfig'

/** Maximum speed the player is currently allowed, from attributes, sprint, ball and fatigue. */
export function maxSpeedFor(p: PlayerState, hasBall: boolean): number {
  const a = p.profile.attributes
  if (p.sole) return PLAYER.soleSpeed
  const fatigue = 0.85 + 0.15 * p.stamina
  const base = p.sprint
    ? attr(a.sprintSpeed, PLAYER.sprintSpeed[0], PLAYER.sprintSpeed[1])
    : attr(a.sprintSpeed, PLAYER.runSpeed[0], PLAYER.runSpeed[1])
  const withBall = hasBall ? PLAYER.withBallSpeedFactor + 0.06 * (a.dribbling / 100) : 1
  const tackleBurst = p.action === 'tackle' ? 1.25 : 1
  const v = base * withBall * fatigue * tackleBurst
  return p.role === 'GK' ? Math.min(v, PLAYER.goalkeeperMaxSpeed) : v
}

/**
 * Integrate one player for dt: acceleration-limited velocity change, direction-dependent speed,
 * limited turn rate and run-off area bounds. Responsive arcade feel within realistic limits.
 */
export function updatePlayerMovement(p: PlayerState, hasBall: boolean, dt: number): void {
  const a = p.profile.attributes
  const intent = clampLen(p.moveIntent, 1)
  const intentLen = len(intent)

  // Facing: towards explicit face target, else towards the intended movement direction.
  const turnRate = attr(a.agility, PLAYER.turnRate[0], PLAYER.turnRate[1]) * (hasBall ? 0.85 : 1)
  let desiredFacing = p.facing
  if (p.faceTarget) desiredFacing = angleOf(sub(p.faceTarget, p.pos))
  else if (intentLen > 0.15) desiredFacing = angleOf(intent)
  p.facing = turnTowards(p.facing, desiredFacing, turnRate * dt)

  // Moving away from the facing direction is slower (sidestep / backpedal).
  let maxSpeed = maxSpeedFor(p, hasBall)
  if (intentLen > 0.15) {
    const off = Math.abs(angleDiff(p.facing, angleOf(intent)))
    const t = (1 + Math.cos(off)) / 2
    const factor = p.role === 'GK' ? PLAYER.goalkeeperShuffleFactor : PLAYER.backpedalFactor
    maxSpeed *= factor + (1 - factor) * t
  }

  const desired: Vec2 = { x: intent.x * maxSpeed, y: intent.y * maxSpeed }
  const dv = sub(desired, p.vel)
  // Braking (reducing speed or reversing) is quicker than accelerating.
  const braking = dot(desired, p.vel) < dot(p.vel, p.vel) - 1e-6
  const accel = braking
    ? PLAYER.deceleration
    : attr(a.acceleration, PLAYER.acceleration[0], PLAYER.acceleration[1]) * (0.8 + 0.2 * p.stamina)
  const step = clampLen(dv, accel * dt)
  p.vel = { x: p.vel.x + step.x, y: p.vel.y + step.y }

  p.pos = { x: p.pos.x + p.vel.x * dt, y: p.pos.y + p.vel.y * dt }

  // Keep players inside the run-off area.
  const bx = COURT.halfWidth + COURT.runOff
  const by = COURT.halfLength + COURT.runOff
  if (Math.abs(p.pos.x) > bx) {
    p.pos.x = clamp(p.pos.x, -bx, bx)
    p.vel.x = 0
  }
  if (Math.abs(p.pos.y) > by) {
    p.pos.y = clamp(p.pos.y, -by, by)
    p.vel.y = 0
  }
}

export function playerRadius(p: PlayerState): number {
  return p.role === 'GK' ? PLAYER.goalkeeperRadius : PLAYER.radius
}

/**
 * Resolve overlaps between players. Stronger / heavier players are pushed less. Approaching velocity
 * is removed so players slide around each other instead of sticking.
 */
export function resolvePlayerCollisions(players: PlayerState[]): void {
  for (let i = 0; i < players.length; i++) {
    const a = players[i]!
    for (let j = i + 1; j < players.length; j++) {
      const b = players[j]!
      const dx = b.pos.x - a.pos.x
      const dy = b.pos.y - a.pos.y
      const minD = playerRadius(a) + playerRadius(b)
      const d2 = dx * dx + dy * dy
      if (d2 >= minD * minD) continue
      const d = Math.sqrt(d2)
      // Deterministic fallback normal for exactly overlapping players.
      const nx = d > 1e-6 ? dx / d : 1
      const ny = d > 1e-6 ? dy / d : 0
      const overlap = minD - d
      const ma = a.profile.weightKg * (0.6 + a.profile.attributes.strength / 250)
      const mb = b.profile.weightKg * (0.6 + b.profile.attributes.strength / 250)
      const wa = mb / (ma + mb)
      const wb = ma / (ma + mb)
      a.pos = { x: a.pos.x - nx * overlap * wa, y: a.pos.y - ny * overlap * wa }
      b.pos = { x: b.pos.x + nx * overlap * wb, y: b.pos.y + ny * overlap * wb }
      const rel = (b.vel.x - a.vel.x) * nx + (b.vel.y - a.vel.y) * ny
      if (rel < 0) {
        a.vel = { x: a.vel.x + nx * rel * wa, y: a.vel.y + ny * rel * wa }
        b.vel = { x: b.vel.x - nx * rel * wb, y: b.vel.y - ny * rel * wb }
      }
    }
  }
}

/**
 * Rough time for a player to reach a point (used for switching and loose-ball pursuit). The full
 * reusable time-to-reach / interception model arrives with the tactical AI milestone.
 */
export function estimateTimeToReach(p: PlayerState, target: Vec2): number {
  const a = p.profile.attributes
  const toT = sub(target, p.pos)
  const d = len(toT)
  if (d < 1e-3) return 0
  const vmax = attr(a.sprintSpeed, PLAYER.sprintSpeed[0], PLAYER.sprintSpeed[1])
  const acc = attr(a.acceleration, PLAYER.acceleration[0], PLAYER.acceleration[1])
  const vAlong = dot(p.vel, toT) / d
  const reaction = 0.15
  // Time to reach top speed from current along-speed, then cruise.
  const tAcc = Math.max(0, (vmax - vAlong) / acc)
  const dAcc = vAlong * tAcc + 0.5 * acc * tAcc * tAcc
  if (dAcc >= d) {
    // Solve d = vAlong t + 0.5 acc t^2
    const disc = vAlong * vAlong + 2 * acc * d
    return reaction + (-vAlong + Math.sqrt(Math.max(0, disc))) / acc
  }
  return reaction + tAcc + (d - dAcc) / vmax
}
