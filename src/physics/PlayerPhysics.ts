import { angleDiff, attr, clamp, turnTowards } from '../core/math/scalar'
import { angleOf, clampLen, dot, len, sub, type Vec2 } from '../core/math/vec2'
import type { PlayerState } from '../simulation/MatchState'
import { COURT, PLAYER, POST_X, POST_Y } from '../simulation/SimulationConfig'

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
export function updatePlayerMovement(p: PlayerState, hasBall: boolean, dt: number, human = false): void {
  const a = p.profile.attributes
  const intent = clampLen(p.moveIntent, 1)
  const intentLen = len(intent)

  // Facing: towards explicit face target, else towards the intended movement direction.
  // The human-controlled player turns and accelerates faster so he answers the stick at once.
  const turnRate =
    attr(a.agility, PLAYER.turnRate[0], PLAYER.turnRate[1]) *
    (hasBall ? 0.85 : 1) *
    (human ? PLAYER.humanTurnBoost : 1)
  let desiredFacing = p.facing
  if (p.faceTarget) desiredFacing = angleOf(sub(p.faceTarget, p.pos))
  else if (intentLen > 0.15) desiredFacing = angleOf(intent)
  // Running hard away from what he is watching: turn and run (no long backwards/sideways sprints).
  // Keepers shuffle facing the ball; the human chooses his own facing.
  if (p.faceTarget && !human && p.role !== 'GK' && intentLen > 0.7) {
    if (Math.abs(angleDiff(desiredFacing, angleOf(intent))) > (100 * Math.PI) / 180)
      desiredFacing = angleOf(intent)
  }
  p.facing = turnTowards(p.facing, desiredFacing, turnRate * dt)

  // Moving away from the facing direction is slower (sidestep / backpedal). The human player turning
  // to where the stick points is not slowed down by the turn itself (only when he aims elsewhere).
  let maxSpeed = maxSpeedFor(p, hasBall)
  if (intentLen > 0.15) {
    const facingRef = human && !p.faceTarget ? desiredFacing : p.facing
    const off = Math.abs(angleDiff(facingRef, angleOf(intent)))
    const t = (1 + Math.cos(off)) / 2
    const factor = p.role === 'GK' ? PLAYER.goalkeeperShuffleFactor : PLAYER.backpedalFactor
    maxSpeed *= factor + (1 - factor) * t
  }

  // Human: bend the running direction towards the stick (a curve that keeps speed) instead of braking
  // and re-accelerating, so changes of direction feel immediate and smooth. Reversals still brake.
  if (human && intentLen > 0.15) {
    const v = len(p.vel)
    if (v > 0.5) {
      const diff = angleDiff(angleOf(p.vel), angleOf(intent))
      if (Math.abs(diff) < (115 * Math.PI) / 180) {
        const rate = Math.min(PLAYER.humanSteerRate, PLAYER.humanLateralAccel / v)
        const turn = clamp(diff, -rate * dt, rate * dt)
        const a0 = angleOf(p.vel) + turn
        p.vel = { x: Math.cos(a0) * v, y: Math.sin(a0) * v }
      }
    }
  }
  const desired: Vec2 = { x: intent.x * maxSpeed, y: intent.y * maxSpeed }
  const dv = sub(desired, p.vel)
  // Braking (reducing speed or reversing) is quicker than accelerating.
  const braking = dot(desired, p.vel) < dot(p.vel, p.vel) - 1e-6
  const accel = braking
    ? human
      ? PLAYER.humanDeceleration
      : PLAYER.deceleration
    : attr(a.acceleration, PLAYER.acceleration[0], PLAYER.acceleration[1]) *
      (0.8 + 0.2 * p.stamina) *
      (human ? PLAYER.humanAccelBoost : 1)
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
/**
 * Shared time-to-reach model (used for pressing, interceptions, receivers, the keeper and pass safety):
 * reaction, turning towards the target, acceleration from the current speed along the way, then top
 * speed.
 */
export function estimateTimeToReach(p: PlayerState, target: Vec2): number {
  const a = p.profile.attributes
  const toT = sub(target, p.pos)
  const d = len(toT)
  if (d < 1e-3) return 0
  const vmax = attr(a.sprintSpeed, PLAYER.sprintSpeed[0], PLAYER.sprintSpeed[1])
  const acc = attr(a.acceleration, PLAYER.acceleration[0], PLAYER.acceleration[1])
  const vAlong = dot(p.vel, toT) / d
  // Turning: a player facing (and moving) away needs time to turn round before running; part of the
  // turn overlaps with starting the run, so half the turn time is added.
  const turnRate = attr(a.agility, PLAYER.turnRate[0], PLAYER.turnRate[1])
  const off = Math.abs(angleDiff(p.facing, angleOf(toT)))
  const turn = off > 0.5 ? ((off - 0.5) / turnRate) * 0.5 : 0
  const reaction = 0.15 + turn
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

/**
 * Goals are solid for players: the posts, the side nets and the back net. A player can walk into the
 * goal through the open mouth but cannot run through the frame or the netting from either side.
 * Each net is a line segment on the floor plan; overlapping players are pushed out to the side they
 * came from and their velocity into the net is removed.
 */
export function resolveGoalCollisions(players: PlayerState[]): void {
  for (const end of [1, -1] as const) {
    const y0 = end * POST_Y
    const y1 = end * (POST_Y + COURT.goalDepth)
    const segments: [number, number, number, number][] = [
      [-POST_X, y0, -POST_X, y1], // side net (left)
      [POST_X, y0, POST_X, y1], // side net (right)
      [-POST_X, y1, POST_X, y1], // back net
    ]
    for (const p of players) {
      const r = playerRadius(p) * 0.85
      // Quick rejection: far from this goal.
      if (Math.abs(p.pos.y - (y0 + y1) / 2) > COURT.goalDepth + 1 || Math.abs(p.pos.x) > POST_X + 1) continue
      for (const [ax, ay, bx, by] of segments) {
        const sx = bx - ax
        const sy = by - ay
        const l2 = sx * sx + sy * sy
        const t = Math.max(0, Math.min(1, ((p.pos.x - ax) * sx + (p.pos.y - ay) * sy) / l2))
        const cx = ax + sx * t
        const cy = ay + sy * t
        const dx = p.pos.x - cx
        const dy = p.pos.y - cy
        const d = Math.hypot(dx, dy)
        if (d >= r) continue
        // Push out along the separation; if exactly on the line, use the segment normal towards the court.
        let nx: number
        let ny: number
        if (d > 1e-6) {
          nx = dx / d
          ny = dy / d
        } else {
          nx = -sy / Math.sqrt(l2)
          ny = sx / Math.sqrt(l2)
          if (nx * -p.vel.x + ny * -p.vel.y < 0) {
            nx = -nx
            ny = -ny
          }
        }
        p.pos = { x: cx + nx * r, y: cy + ny * r }
        const vn = p.vel.x * nx + p.vel.y * ny
        if (vn < 0) p.vel = { x: p.vel.x - vn * nx, y: p.vel.y - vn * ny }
      }
    }
  }
}

/** Is a point inside the footprint of either goal (between the goal line and the back net)? */
function inGoalBox(x: number, y: number, margin: number): 1 | -1 | 0 {
  if (Math.abs(x) > POST_X + margin) return 0
  const ay = Math.abs(y)
  if (ay < COURT.halfLength - margin * 0.2 || ay > POST_Y + COURT.goalDepth + margin) return 0
  return y > 0 ? 1 : -1
}

function segmentHitsGoal(ax: number, ay: number, bx: number, by: number, margin: number): boolean {
  const n = 24
  for (let i = 1; i < n; i++) {
    const t = i / n
    if (inGoalBox(ax + (bx - ax) * t, ay + (by - ay) * t, margin)) return true
  }
  return false
}

/**
 * Next point to walk towards so a player does not try to walk through a goal: from inside the goal he
 * leaves through the open mouth; otherwise, if the straight line crosses a goal, he goes round its
 * nearest corner. Returns the target itself when the way is clear.
 */
export function routeAroundGoals(from: Vec2, target: Vec2): Vec2 {
  const margin = 0.45
  const inside = inGoalBox(from.x, from.y, 0)
  if (inside && !inGoalBox(target.x, target.y, 0)) {
    // Out through the mouth (towards the court) first.
    const exitY = inside * (COURT.halfLength - 0.6)
    if (Math.abs(from.y) > COURT.halfLength - 0.3)
      return { x: Math.max(-POST_X + 0.4, Math.min(POST_X - 0.4, from.x)), y: exitY }
    return target
  }
  if (!segmentHitsGoal(from.x, from.y, target.x, target.y, 0.2)) return target
  const end =
    target.y > 0 || from.y > 0
      ? Math.abs(target.y) > Math.abs(from.y)
        ? Math.sign(target.y)
        : Math.sign(from.y)
      : -1
  const back = POST_Y + COURT.goalDepth
  const corners: Vec2[] = [
    { x: POST_X + margin + 0.3, y: end * (back + margin) },
    { x: -(POST_X + margin + 0.3), y: end * (back + margin) },
    { x: POST_X + margin + 0.3, y: end * (COURT.halfLength - margin) },
    { x: -(POST_X + margin + 0.3), y: end * (COURT.halfLength - margin) },
  ]
  let best = target
  let bestLen = Infinity
  for (const c of corners) {
    if (segmentHitsGoal(from.x, from.y, c.x, c.y, 0.2)) continue
    const l = Math.hypot(c.x - from.x, c.y - from.y) + Math.hypot(target.x - c.x, target.y - c.y)
    if (l < bestLen) {
      bestLen = l
      best = c
    }
  }
  return best
}
