import { describe, expect, it } from 'vitest'
import { TEAM_LIBRARY } from '../../src/data/teams'
import { MatchSimulation } from '../../src/simulation/MatchSimulation'
import { markingAssignment, pickHelper, setPieceRoutine } from '../../src/ai/BasicAI'
import { diamondAnchor } from '../../src/ai/positioning/Formation'
import { COURT, TICK_RATE } from '../../src/simulation/SimulationConfig'
import type { Vec2 } from '../../src/core/math/vec2'

const d = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y)

/** AI vs AI in open play: team 1 (attacking -y) has the ball with player 7 at `ball`. */
function openPlay(seed: number, ball: Vec2) {
  const sim = new MatchSimulation({ seed, home: TEAM_LIBRARY[0]!, away: TEAM_LIBRARY[1]!, humanTeam: null })
  const s = sim.state
  for (let i = 0; i < 600 && !s.restart?.ready; i++) sim.step()
  for (let i = 0; i < 120 && s.phase !== 'play'; i++) sim.step()
  s.phase = 'play'
  s.restart = null
  const c = sim.player(7)
  c.pos = { ...ball }
  s.ball.ownerId = 7
  s.ball.mode = 'controlled'
  s.ball.pos = { x: ball.x, y: ball.y - 0.4 }
  s.ball.vel = { x: 0, y: 0 }
  s.ball.z = 0
  s.ball.lastTouchTeam = 1
  s.ball.lastTouchId = 7
  s.possessionTeam = 1
  return { sim, s }
}

describe('defensive diamond and marking', () => {
  it('the diamond moves with the ball: pivot on top, alas either side, fixo at the bottom', () => {
    for (const by of [-12, 0, 8]) {
      const ball = { x: 3, y: by }
      // Team 0 attacks +y, so it defends y = -20 (higher = larger y).
      const pivot = diamondAnchor('PIVOT', 1, ball)
      const fixo = diamondAnchor('FIXO', 1, ball)
      const l = diamondAnchor('ALA_L', 1, ball)
      const r = diamondAnchor('ALA_R', 1, ball)
      expect(pivot.y).toBeGreaterThan(l.y)
      expect(l.y).toBeGreaterThan(fixo.y)
      expect(Math.abs(l.y - r.y)).toBeLessThan(1e-9)
      expect(pivot.y - fixo.y).toBeLessThan(9.5) // compact
      expect(pivot.y).toBeLessThan(by + 0.01) // goal-side of the ball
    }
    // Higher when the ball is higher.
    expect(diamondAnchor('FIXO', 1, { x: 0, y: 8 }).y).toBeGreaterThan(
      diamondAnchor('FIXO', 1, { x: 0, y: -8 }).y + 5,
    )
  })

  it('marking is one-to-one: every opponent outside the press has his own defender', () => {
    const { s } = openPlay(3, { x: 2, y: 2 })
    const m = markingAssignment(s, 0, [])
    const men = [...m.values()]
    expect(new Set(men).size).toBe(men.length)
    expect(men.length).toBe(3) // four outfield defenders, three opponents without the ball
    expect(men).not.toContain(7)
  })

  it('in open play the defending team stays high and picks up the opponents ahead of the ball', () => {
    let marked = 0
    let total = 0
    let depthSum = 0
    let depthN = 0
    for (const seed of [1, 2, 3, 4]) {
      const { sim, s } = openPlay(seed, { x: 3, y: 4 })
      for (let i = 0; i < TICK_RATE * 2.5; i++) {
        sim.step()
        s.ball.ownerId = 7 // keep the ball with the carrier
        s.ball.mode = 'controlled'
      }
      for (const o of s.players) {
        // Opponents between the ball and the goal (team 1 attacks -y) must be picked up; a man left
        // deep behind the ball is the pressing pivot's concern.
        if (o.team !== 1 || o.role === 'GK' || o.id === 7 || o.pos.y > s.ball.pos.y) continue
        total++
        const near = s.players.some((q) => q.team === 0 && q.role !== 'GK' && d(q.pos, o.pos) < 3.5)
        if (near) marked++
      }
      for (const q of s.players) {
        if (q.team !== 0 || q.role === 'GK') continue
        depthSum += q.pos.y + COURT.halfLength
        depthN++
      }
    }
    expect(marked / total).toBeGreaterThan(0.75)
    // Average distance of the outfield defenders from their own goal line (ball 24 m out).
    expect(depthSum / depthN).toBeGreaterThan(12)
  })
})

describe('cover defender', () => {
  it('when the carrier gets past his defender near goal, a second defender comes to help', () => {
    const { sim, s } = openPlay(5, { x: 1, y: -9 })
    // Team 0 defends y = -20: the first defender (id 2) is beaten, behind the carrier.
    sim.player(2).pos = { x: 1, y: -6 }
    const winner = 2
    const helper = pickHelper(s, 0, winner)
    expect(helper).not.toBeNull()
    expect(helper).not.toBe(winner)
    // With the first defender goal-side and close, nobody else is pulled out.
    sim.player(2).pos = { x: 1, y: -10.5 }
    expect(pickHelper(s, 0, winner)).toBeNull()
  })
})

describe('kick-in and corner routine', () => {
  it('a short man behind the ball, one at the back post, one safe at halfway; the short man shoots', () => {
    let routines = 0
    let shooterPasses = 0
    let firstTimeShots = 0
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const sim = new MatchSimulation({
        seed,
        home: TEAM_LIBRARY[0]!,
        away: TEAM_LIBRARY[1]!,
        humanTeam: null,
      })
      const s = sim.state
      for (let i = 0; i < 600 && !s.restart?.ready; i++) sim.step()
      for (let i = 0; i < 120 && s.phase !== 'play'; i++) sim.step()
      // Team 1 attacks -y: kick-in on the right touch line in their attacking half.
      ;(sim as unknown as { beginRestart(t: string, team: number, spot: Vec2): void }).beginRestart(
        'kickIn',
        1,
        {
          x: COURT.halfWidth,
          y: -12,
        },
      )
      const plan = setPieceRoutine(s, 1)!
      expect(plan.size).toBe(3)
      const [shooterSpot, backPost, safety] = [...plan.values()]
      expect(Math.abs(shooterSpot!.y - -20)).toBeGreaterThan(8 - 0.01) // behind the ball, shooting range
      expect(shooterSpot!.y).toBeGreaterThan(-12) // further from goal than the ball
      expect(backPost!.x).toBeLessThan(0) // far post
      expect(Math.abs(backPost!.y - -20)).toBeLessThan(2)
      expect(Math.abs(safety!.y)).toBeLessThan(1.5) // halfway
      routines++
      const shooterId = [...plan.keys()][0]!
      let passedToShooter = false
      for (let i = 0; i < TICK_RATE * 12; i++) {
        sim.step()
        for (const e of sim.drainEvents()) {
          if (e.type === 'PassStarted' && e.receiverId === shooterId && !passedToShooter) {
            passedToShooter = true
            shooterPasses++
          }
          if (passedToShooter && e.type === 'ShotTaken' && e.playerId === shooterId) firstTimeShots++
        }
        if (passedToShooter && s.ball.ownerId !== null && s.ball.ownerId !== shooterId) break
      }
    }
    expect(routines).toBe(6)
    expect(shooterPasses).toBeGreaterThan(3)
    expect(firstTimeShots).toBeGreaterThan(1)
  })
})

describe('shot blocks', () => {
  it('a hard shot hitting a defender rebounds off him instead of being controlled', () => {
    let owned = 0
    let deflected = 0
    for (let seed = 1; seed <= 20; seed++) {
      const { sim, s } = openPlay(seed, { x: 6, y: -6 })
      for (const p of s.players) if (p.role !== 'GK') p.pos = { x: p.id % 2 ? 9 : -9, y: 15 }
      const def = sim.player(2)
      def.pos = { x: 0.3, y: -12 }
      def.vel = { x: 0, y: 0 }
      def.touchCooldown = 0
      s.ball.ownerId = null
      s.ball.mode = 'free'
      s.ball.pos = { x: 0, y: -6 }
      s.ball.vel = { x: 0, y: -16 }
      s.ball.z = 0.1
      s.ball.isShot = true
      s.ball.lastTouchTeam = 1
      s.ball.lastTouchId = 7
      for (let i = 0; i < 40; i++) {
        def.pos = { x: 0.3, y: -12 } // he stands in the way (the AI would otherwise move him)
        def.vel = { x: 0, y: 0 }
        sim.step()
        if (s.ball.ownerId === 2) {
          owned++
          break
        }
        if (s.ball.lastTouchId === 2) {
          deflected++
          break
        }
      }
    }
    expect(owned).toBe(0)
    expect(deflected).toBeGreaterThan(15)
  })
})
