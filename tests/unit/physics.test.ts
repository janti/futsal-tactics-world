import { describe, expect, it } from 'vitest'
import { checkOutOfPlay, isGoal, rollingLaunchSpeed, stepBall } from '../../src/physics/BallPhysics'
import { resolvePlayerCollisions, updatePlayerMovement, maxSpeedFor } from '../../src/physics/PlayerPhysics'
import { createInitialState } from '../../src/simulation/MatchSimulation'
import { TEAM_LIBRARY } from '../../src/data/teams'
import type { BallState, PlayerState } from '../../src/simulation/MatchState'
import { ARENA, BALL, COURT, DT, PLAYER, POST_X, POST_Y } from '../../src/simulation/SimulationConfig'

function ball(partial: Partial<BallState> = {}): BallState {
  return {
    pos: { x: 0, y: 0 },
    z: 0,
    vel: { x: 0, y: 0 },
    vz: 0,
    spin: 0,
    mode: 'free',
    ownerId: null,
    lastTouchId: null,
    lastTouchTeam: null,
    intendedReceiverId: null,
    isShot: false,
    blockedTouchId: null,
    landing: null,
    kickPos: { x: 0, y: 0 },
    kickTime: 0,
    inHands: false,
    handsTimer: 0,
    keeperRetouchId: null,
    shotScreen: 0,
    shotLongRange: false,
    shotPlaced: false,
    lastKickerId: null,
    ...partial,
  }
}

function player(): PlayerState {
  const s = createInitialState({ seed: 3, home: TEAM_LIBRARY[0]!, away: TEAM_LIBRARY[1]!, humanTeam: 0 })
  const p = s.players[1]!
  p.pos = { x: 0, y: 0 }
  p.vel = { x: 0, y: 0 }
  return p
}

function simulateBall(b: BallState, seconds: number) {
  for (let i = 0; i < seconds * 60; i++) stepBall(b, DT)
}

describe('ball physics', () => {
  it('a rolling ball decelerates and stops', () => {
    const b = ball({ vel: { x: 0, y: 8 } })
    simulateBall(b, 10)
    expect(b.vel.y).toBe(0)
    expect(b.pos.y).toBeGreaterThan(10)
    expect(b.pos.y).toBeLessThan(25)
  })

  it('rollingLaunchSpeed delivers roughly the requested arrival speed', () => {
    const d = 10
    const v0 = rollingLaunchSpeed(d, 5)
    const b = ball({ vel: { x: v0, y: 0 } })
    let arrival = 0
    for (let i = 0; i < 600 && b.pos.x < d; i++) {
      stepBall(b, DT)
      arrival = b.vel.x
    }
    expect(b.pos.x).toBeGreaterThanOrEqual(d)
    expect(arrival).toBeGreaterThan(4)
    expect(arrival).toBeLessThan(6)
  })

  it('bounces lower each time (low-bounce futsal ball) and settles', () => {
    const b = ball({ z: 2, vel: { x: 1, y: 0 } })
    const peaks: number[] = []
    let rising = false
    let maxZ = 0
    for (let i = 0; i < 600; i++) {
      stepBall(b, DT)
      if (b.vz > 0) rising = true
      if (rising) maxZ = Math.max(maxZ, b.z)
      if (rising && b.vz <= 0) {
        peaks.push(maxZ)
        rising = false
        maxZ = 0
      }
    }
    expect(peaks.length).toBeGreaterThan(0)
    for (let i = 1; i < peaks.length; i++) expect(peaks[i]!).toBeLessThan(peaks[i - 1]!)
    expect(peaks[0]!).toBeLessThan(2 * BALL.restitution * BALL.restitution + 0.1)
    expect(b.z).toBe(0)
    expect(b.vz).toBe(0)
  })

  it('a 30 m/s shot at the post rebounds instead of tunnelling through it', () => {
    const b = ball({ pos: { x: POST_X, y: POST_Y - 5 }, vel: { x: 0, y: 30 }, z: 0.3 })
    let hits = 0
    simulateBallWithHooks(b, 0.4, () => hits++)
    expect(hits).toBeGreaterThan(0)
    expect(b.vel.y).toBeLessThan(0)
    expect(b.pos.y).toBeLessThan(POST_Y)
  })

  it('a fast shot under the bar between the posts is a goal and is caught by the net', () => {
    const b = ball({ pos: { x: 0.5, y: 14 }, vel: { x: 0, y: 28 }, z: 0.4 })
    let goal = 0
    for (let i = 0; i < 120; i++) {
      stepBall(b, DT)
      goal = goal || isGoal(b)
    }
    expect(goal).toBe(1)
    expect(b.pos.y).toBeLessThanOrEqual(COURT.halfLength + COURT.goalDepth)
  })

  it('a shot over the crossbar is not a goal', () => {
    const b = ball({ pos: { x: 0, y: 14 }, vel: { x: 0, y: 20 }, z: 2.3, vz: 1 })
    // Evaluate at the moment the ball wholly crosses the line (the simulation stops play there).
    for (let i = 0; i < 60 && Math.abs(b.pos.y) <= COURT.halfLength + BALL.radius; i++) stepBall(b, DT)
    expect(isGoal(b)).toBe(0)
    expect(checkOutOfPlay(b)?.line).toBe('goal')
  })

  it('detects the ball wholly over the touch line', () => {
    expect(checkOutOfPlay(ball({ pos: { x: 10.05, y: 0 } }))).toBeNull()
    expect(checkOutOfPlay(ball({ pos: { x: -10.11, y: 3 } }))?.line).toBe('side')
  })
})

function simulateBallWithHooks(b: BallState, seconds: number, onPost: () => void) {
  for (let i = 0; i < seconds * 60; i++) stepBall(b, DT, { onPostHit: onPost })
}

describe('player movement', () => {
  it('accelerates with limited acceleration and never exceeds max speed', () => {
    const p = player()
    p.moveIntent = { x: 0, y: 1 }
    p.facing = Math.PI / 2
    updatePlayerMovement(p, false, DT)
    expect(Math.hypot(p.vel.x, p.vel.y)).toBeLessThanOrEqual(PLAYER.acceleration[1] * DT + 1e-9)
    for (let i = 0; i < 180; i++) updatePlayerMovement(p, false, DT)
    const vmax = maxSpeedFor(p, false)
    expect(Math.hypot(p.vel.x, p.vel.y)).toBeCloseTo(vmax, 3)
    expect(vmax).toBeGreaterThanOrEqual(PLAYER.runSpeed[0] * 0.85)
    expect(vmax).toBeLessThanOrEqual(PLAYER.runSpeed[1])
  })

  it('sprinting is faster and sole control is slow', () => {
    const p = player()
    const run = maxSpeedFor(p, false)
    p.sprint = true
    const sprint = maxSpeedFor(p, false)
    p.sole = true
    expect(sprint).toBeGreaterThan(run * 1.4)
    expect(maxSpeedFor(p, true)).toBe(PLAYER.soleSpeed)
  })

  it('turns at a limited rate', () => {
    const p = player()
    p.facing = 0
    p.moveIntent = { x: -1, y: 0 }
    updatePlayerMovement(p, false, DT)
    expect(Math.abs(p.facing)).toBeLessThanOrEqual(PLAYER.turnRate[1] * DT + 1e-9)
  })

  it('separates overlapping players', () => {
    const s = createInitialState({ seed: 3, home: TEAM_LIBRARY[0]!, away: TEAM_LIBRARY[1]!, humanTeam: 0 })
    const a = s.players[1]!
    const b = s.players[6]!
    a.pos = { x: 0, y: 0 }
    b.pos = { x: 0.1, y: 0 }
    resolvePlayerCollisions([a, b])
    expect(Math.hypot(b.pos.x - a.pos.x, b.pos.y - a.pos.y)).toBeCloseTo(PLAYER.radius * 2, 5)
  })
})

describe('arena boards and walls (ball out of play)', () => {
  it('a low ball going wide of the goal bounces off the boards behind the goal line', () => {
    const b = ball({ pos: { x: 4, y: 15 }, vel: { x: 0, y: 14 } })
    let hit = 0
    let maxY = 0
    for (let i = 0; i < 180; i++) {
      stepBall(b, DT, { onWallHit: () => hit++ })
      maxY = Math.max(maxY, b.pos.y)
    }
    expect(hit).toBeGreaterThan(0)
    expect(maxY).toBeLessThanOrEqual(ARENA.boardEndY)
    expect(b.vel.y).toBeLessThanOrEqual(0) // came back towards the court
  })

  it('a high ball flies over the boards and stops at the hall wall', () => {
    const b = ball({ pos: { x: 4, y: 18 }, vel: { x: 0, y: 20 }, z: 2.5, vz: 4 })
    let maxY = 0
    for (let i = 0; i < 240; i++) {
      stepBall(b, DT)
      maxY = Math.max(maxY, b.pos.y)
    }
    expect(maxY).toBeGreaterThan(ARENA.boardEndY)
    expect(maxY).toBeLessThanOrEqual(ARENA.endWallY)
  })

  it('a ball crossing the touch line bounces off the side boards', () => {
    const b = ball({ pos: { x: 8, y: 0 }, vel: { x: 12, y: 2 } })
    let maxX = 0
    for (let i = 0; i < 120; i++) {
      stepBall(b, DT)
      maxX = Math.max(maxX, b.pos.x)
    }
    expect(maxX).toBeLessThanOrEqual(ARENA.boardSideX)
    expect(maxX).toBeGreaterThan(COURT.halfWidth)
  })
})

describe('goal net', () => {
  it('a hard shot into the goal stays in the goal (the net swallows it)', () => {
    const b = ball({ pos: { x: 0.6, y: 17 }, vel: { x: 0, y: 20 }, z: 0.6, vz: 0.5 })
    for (let i = 0; i < 240; i++) stepBall(b, DT)
    expect(b.pos.y).toBeGreaterThan(COURT.halfLength + BALL.radius)
    expect(b.pos.y).toBeLessThanOrEqual(COURT.halfLength + COURT.goalDepth)
    expect(Math.hypot(b.vel.x, b.vel.y)).toBeLessThan(0.5)
  })
})
