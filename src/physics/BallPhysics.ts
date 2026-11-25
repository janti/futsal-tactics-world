import type { BallState } from '../simulation/MatchState'
import { ARENA, BALL, COURT, CROSSBAR_Z, POST_RADIUS, POST_X, POST_Y } from '../simulation/SimulationConfig'

export interface BallStepHooks {
  /**
   * Called after every substep with the ball's new position. Return true if a player interaction
   * changed the ball (control, deflection, save); the ball step then stops for this tick.
   */
  onSubstep?: (ball: BallState) => boolean
  onPostHit?: (speed: number) => void
  /** Ball hit the advertising boards or a hall wall (only possible once it is out of play). */
  onWallHit?: (speed: number) => void
  onBounce?: (speed: number) => void
}

/**
 * Advance a free ball by dt. Uses distance-limited substeps so even 30 m/s shots move at most
 * BALL.maxSubstepDistance per collision check (an equivalent of swept collision for thin posts
 * and player bodies). There are no playable wall rebounds: the ball simply leaves the court.
 */
/** Note: `ball.z` is the height of the underside of the ball (0 = resting on the floor). */
export function stepBall(ball: BallState, dt: number, hooks: BallStepHooks = {}): void {
  const speed3 = Math.hypot(ball.vel.x, ball.vel.y, ball.vz)
  const n = Math.min(BALL.maxSubsteps, Math.max(1, Math.ceil((speed3 * dt) / BALL.maxSubstepDistance)))
  const h = dt / n
  for (let i = 0; i < n; i++) {
    const px = ball.pos.x
    const py = ball.pos.y
    integrate(ball, h, hooks)
    collideGoalFrames(ball, hooks)
    collideNets(ball, h)
    collideArena(ball, px, py, hooks)
    if (hooks.onSubstep && hooks.onSubstep(ball)) return
  }
}

function integrate(ball: BallState, h: number, hooks: BallStepHooks): void {
  const airborne = ball.z > 1e-4 || ball.vz > 1e-4
  let vx = ball.vel.x
  let vy = ball.vel.y
  const speed = Math.hypot(vx, vy)

  // Side spin: lateral acceleration perpendicular to travel.
  if (Math.abs(ball.spin) > 1e-3 && speed > 0.5) {
    const k = BALL.magnus * ball.spin * h
    const px = -vy / speed
    const py = vx / speed
    vx += px * k * speed
    vy += py * k * speed
    ball.spin *= Math.exp(-BALL.spinDecay * h)
  }

  if (airborne) {
    ball.vz -= BALL.gravity * h
    const s3 = Math.hypot(vx, vy, ball.vz)
    const drag = Math.max(0, 1 - BALL.airDrag * s3 * h)
    vx *= drag
    vy *= drag
    ball.vz *= drag
    ball.z += ball.vz * h
    if (ball.z <= 0) {
      ball.z = 0
      const impact = -ball.vz
      if (impact > BALL.minBounceSpeed) {
        ball.vz = impact * BALL.restitution
        vx *= BALL.bounceFriction
        vy *= BALL.bounceFriction
        hooks.onBounce?.(impact)
      } else {
        ball.vz = 0
      }
    }
  } else {
    ball.z = 0
    ball.vz = 0
    if (speed > 0) {
      const newSpeed = Math.max(0, speed - BALL.rollingDecel * h - BALL.rollingDrag * speed * h)
      const f = newSpeed / speed
      vx *= f
      vy *= f
    }
  }

  ball.vel = { x: vx, y: vy }
  ball.pos = { x: ball.pos.x + vx * h, y: ball.pos.y + vy * h }
}

/** Posts are vertical cylinders, crossbars horizontal cylinders along x. */
function collideGoalFrames(ball: BallState, hooks: BallStepHooks): void {
  const r = BALL.radius
  const reach = r + POST_RADIUS
  for (const gy of [POST_Y, -POST_Y]) {
    if (Math.abs(ball.pos.y - gy) > reach + 0.01) continue
    // Posts
    if (ball.z < CROSSBAR_Z + POST_RADIUS) {
      for (const gx of [POST_X, -POST_X]) {
        const dx = ball.pos.x - gx
        const dy = ball.pos.y - gy
        const d2 = dx * dx + dy * dy
        if (d2 < reach * reach) {
          const d = Math.sqrt(d2) || 1e-6
          const nx = dx / d
          const ny = dy / d
          reflect2D(ball, nx, ny, hooks)
          ball.pos = { x: gx + nx * reach, y: gy + ny * reach }
        }
      }
    }
    // Crossbar
    if (Math.abs(ball.pos.x) < POST_X) {
      const dy = ball.pos.y - gy
      const dz = ball.z + r - CROSSBAR_Z
      const d2 = dy * dy + dz * dz
      if (d2 < reach * reach) {
        const d = Math.sqrt(d2) || 1e-6
        const ny = dy / d
        const nz = dz / d
        const vn = ball.vel.y * ny + ball.vz * nz
        if (vn < 0) {
          hooks.onPostHit?.(Math.abs(vn))
          const k = (1 + BALL.postRestitution) * vn
          ball.vel = { x: ball.vel.x, y: ball.vel.y - k * ny }
          ball.vz -= k * nz
        }
        ball.pos = { x: ball.pos.x, y: gy + ny * reach }
        ball.z = Math.max(0, CROSSBAR_Z + nz * reach - r)
      }
    }
  }
}

function reflect2D(ball: BallState, nx: number, ny: number, hooks: BallStepHooks): void {
  const vn = ball.vel.x * nx + ball.vel.y * ny
  if (vn >= 0) return
  hooks.onPostHit?.(Math.abs(vn))
  const k = (1 + BALL.postRestitution) * vn
  ball.vel = { x: ball.vel.x - k * nx, y: ball.vel.y - k * ny }
}

/** Inside the goal the net absorbs the ball: back net, side nets and roof. */
function collideNets(ball: BallState, h: number): void {
  const ay = Math.abs(ball.pos.y)
  if (ay <= COURT.halfLength) return
  const r = BALL.radius
  const inMouth = Math.abs(ball.pos.x) < COURT.goalHalfWidth && ball.z + r < COURT.goalHeight
  if (!inMouth && ay < COURT.halfLength + COURT.goalDepth) return
  const sign = Math.sign(ball.pos.y)
  const back = COURT.halfLength + COURT.goalDepth - r
  if (inMouth || ay < back + r) {
    if (ay > back) {
      ball.pos = { x: ball.pos.x, y: sign * back }
      // The net gives and swallows the ball: almost no rebound back towards the court.
      if (ball.vel.y * sign > 0) ball.vel = { x: ball.vel.x * 0.3, y: -ball.vel.y * 0.02 }
      ball.vz *= 0.3
    }
    const side = COURT.goalHalfWidth - r
    if (Math.abs(ball.pos.x) > side && ay > COURT.halfLength + r) {
      const sx = Math.sign(ball.pos.x)
      ball.pos = { x: sx * side, y: ball.pos.y }
      if (ball.vel.x * sx > 0) ball.vel = { x: -ball.vel.x * 0.1, y: ball.vel.y * 0.5 }
    }
    if (ball.z + 2 * r > COURT.goalHeight && ay > COURT.halfLength + r) {
      ball.z = COURT.goalHeight - 2 * r
      if (ball.vz > 0) ball.vz = -ball.vz * 0.1
    }
    // Inside the goal the net drags on the ball, so it settles in the goal instead of rolling out.
    if (ay > COURT.halfLength + r) {
      const k = Math.exp(-5 * h)
      ball.vel = { x: ball.vel.x * k, y: ball.vel.y * k }
    }
  }
}

/** Ball has wholly crossed the goal line between the posts and under the crossbar. */
export function isGoal(ball: BallState): 1 | -1 | 0 {
  if (Math.abs(ball.pos.y) <= COURT.halfLength + BALL.radius) return 0
  if (Math.abs(ball.pos.x) >= COURT.goalHalfWidth || ball.z + BALL.radius >= COURT.goalHeight) return 0
  return ball.pos.y > 0 ? 1 : -1
}

export type OutOfPlay = { line: 'side'; x: number; y: number } | { line: 'goal'; x: number; y: number } | null

/** Ball wholly over a touch line or a goal line outside the goal. */
export function checkOutOfPlay(ball: BallState): OutOfPlay {
  const r = BALL.radius
  if (Math.abs(ball.pos.x) > COURT.halfWidth + r) return { line: 'side', x: ball.pos.x, y: ball.pos.y }
  if (Math.abs(ball.pos.y) > COURT.halfLength + r && isGoal(ball) === 0) {
    return { line: 'goal', x: ball.pos.x, y: ball.pos.y }
  }
  return null
}

/** Initial speed needed for a rolling ball to cover `distance` and still have `arrivalSpeed`. */
export function rollingLaunchSpeed(distance: number, arrivalSpeed: number): number {
  // Approximate the linear drag term as an extra constant deceleration at the mean speed.
  let v0 = Math.sqrt(arrivalSpeed * arrivalSpeed + 2 * BALL.rollingDecel * distance)
  for (let i = 0; i < 3; i++) {
    const mean = (v0 + arrivalSpeed) / 2
    const decel = BALL.rollingDecel + BALL.rollingDrag * mean
    v0 = Math.sqrt(arrivalSpeed * arrivalSpeed + 2 * decel * distance)
  }
  return v0
}

/** Time for a rolling ball launched at v0 to travel `distance` (Infinity if it stops first). */
export function rollingTravelTime(distance: number, v0: number): number {
  const mean = v0 * 0.75
  const decel = BALL.rollingDecel + BALL.rollingDrag * mean
  const disc = v0 * v0 - 2 * decel * distance
  if (disc < 0) return Infinity
  return (v0 - Math.sqrt(disc)) / decel
}

/**
 * Advertising boards and hall walls. A low ball crossing a board's inner face bounces off it; a ball
 * flying over the boards carries on to the hall wall. `px`/`py` is the position before this substep,
 * so a ball already behind a board is never snapped back in front of it.
 */
function collideArena(ball: BallState, px: number, py: number, hooks: BallStepHooks): void {
  const r = BALL.radius
  const low = ball.z < ARENA.boardHeight
  // Ends
  const ay = Math.abs(ball.pos.y)
  const boardY = ARENA.boardEndY - r
  const wallY = ARENA.endWallY - r
  const sy = Math.sign(ball.pos.y)
  let limitY = Infinity
  if (low && Math.abs(py) <= boardY && ay > boardY) limitY = boardY
  else if (ay > wallY) limitY = wallY
  if (limitY !== Infinity && ball.vel.y * sy > 0) {
    hooks.onWallHit?.(Math.abs(ball.vel.y))
    ball.pos = { x: ball.pos.x, y: sy * limitY }
    ball.vel = { x: ball.vel.x * ARENA.friction, y: -ball.vel.y * ARENA.restitution }
    ball.vz *= ARENA.friction
  }
  // Sides
  const ax = Math.abs(ball.pos.x)
  const boardX = ARENA.boardSideX - r
  const wallX = ARENA.sideWallX - r
  const sx = Math.sign(ball.pos.x)
  let limitX = Infinity
  if (low && Math.abs(px) <= boardX && ax > boardX) limitX = boardX
  else if (ax > wallX) limitX = wallX
  if (limitX !== Infinity && ball.vel.x * sx > 0) {
    hooks.onWallHit?.(Math.abs(ball.vel.x))
    ball.pos = { x: sx * limitX, y: ball.pos.y }
    ball.vel = { x: -ball.vel.x * ARENA.restitution, y: ball.vel.y * ARENA.friction }
    ball.vz *= ARENA.friction
  }
}
