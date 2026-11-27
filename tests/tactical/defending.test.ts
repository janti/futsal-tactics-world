import { describe, expect, it } from 'vitest'
import { TEAM_LIBRARY } from '../../src/data/teams'
import { attackingRole } from '../../src/ai/team/roles'
import { MatchSimulation } from '../../src/simulation/MatchSimulation'
import {
  markingAssignment,
  pickHelper,
  setPieceRoutine,
  updateDefensiveTransitions,
} from '../../src/ai/BasicAI'
import { diamondAnchor } from '../../src/ai/positioning/Formation'
import { COURT, RESTART, TICK_RATE } from '../../src/simulation/SimulationConfig'
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
    // Three attackers stand between the ball (24 m out) and the goal; team 1 attacks -y.
    const men: Record<number, Vec2> = { 6: { x: -1, y: -6 }, 8: { x: 6, y: -3 }, 9: { x: -5.5, y: -2 } }
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const { sim, s } = openPlay(seed, { x: 3, y: 4 })
      hold(sim, { 7: { x: 3, y: 4 }, ...men }, 2.5)
      for (const id of Object.keys(men).map(Number)) {
        total++
        const o = sim.player(id)
        // Tight near the ball; a man on the far side is marked loosely from the middle (help side).
        const limit = d(o.pos, s.ball.pos) > 8 ? 5 : 3
        if (s.players.some((q) => q.team === 0 && q.role !== 'GK' && d(q.pos, o.pos) < limit)) marked++
      }
      for (const q of s.players) {
        if (q.team !== 0 || q.role === 'GK') continue
        depthSum += q.pos.y + COURT.halfLength
        depthN++
      }
    }
    expect(marked / total).toBeGreaterThanOrEqual(0.8)
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
  /** Team 1 (attacking -y) gets a kick-in on the right touch line in its attacking half. */
  function kickIn(seed: number) {
    const sim = new MatchSimulation({ seed, home: TEAM_LIBRARY[0]!, away: TEAM_LIBRARY[1]!, humanTeam: null })
    const s = sim.state
    for (let i = 0; i < 600 && !s.restart?.ready; i++) sim.step()
    for (let i = 0; i < 120 && s.phase !== 'play'; i++) sim.step()
    ;(sim as unknown as { beginRestart(t: string, team: number, spot: Vec2): void }).beginRestart(
      'kickIn',
      1,
      {
        x: COURT.halfWidth,
        y: -12,
      },
    )
    sim.drainEvents()
    return { sim, s }
  }

  it('runners come to show: the short man comes close behind the ball, the pivot comes out, the deep man comes up', () => {
    const { sim, s } = kickIn(1)
    const before = setPieceRoutine(s, 1)!
    expect(before.map((r) => r.role)).toEqual(['short', 'pivot', 'deep'])
    const byRole = (plan: typeof before, role: string) => plan.find((r) => r.role === role)!.spot
    expect(Math.abs(byRole(before, 'pivot').y - -20)).toBeLessThan(2) // starts at the back post
    expect(Math.abs(byRole(before, 'deep').y)).toBeLessThan(1.5) // starts at halfway
    for (let i = 0; i < TICK_RATE * 10 && !(s.restart?.ready && s.restart.readyTimer > 1.6); i++) sim.step()
    const after = setPieceRoutine(s, 1)!
    const spot = s.restart!.spot
    expect(after.map((r) => r.id)).toEqual(before.map((r) => r.id)) // roles stay with the same players
    expect(d(byRole(after, 'short'), spot)).toBeLessThan(3.6) // a few metres from the ball
    expect(byRole(after, 'short').y).toBeGreaterThan(spot.y) // behind the ball (further from goal)
    expect(Math.abs(byRole(after, 'pivot').y - -20)).toBeGreaterThan(4.5) // pivot came out
    expect(d(byRole(after, 'deep'), spot)).toBeLessThan(d(byRole(before, 'deep'), spot) - 4) // deep man came up
  })

  it('the taker plays one of the runners, and the short man or pivot strikes it first time', () => {
    let toRunner = 0
    let firstTime = 0
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const { sim, s } = kickIn(seed)
      const ids = setPieceRoutine(s, 1)!.map((r) => r.id)
      const shooters = setPieceRoutine(s, 1)!
        .filter((r) => r.role !== 'deep')
        .map((r) => r.id)
      let receiver: number | null = null
      for (let i = 0; i < TICK_RATE * 12; i++) {
        sim.step()
        for (const e of sim.drainEvents()) {
          if (e.type === 'PassStarted' && receiver === null && e.receiverId !== null) {
            receiver = e.receiverId
            if (ids.includes(receiver)) toRunner++
          }
          if (
            receiver !== null &&
            e.type === 'ShotTaken' &&
            e.playerId === receiver &&
            shooters.includes(receiver)
          )
            firstTime++
        }
        if (receiver !== null && s.ball.ownerId !== null && s.ball.ownerId !== receiver) break
      }
    }
    expect(toRunner).toBeGreaterThanOrEqual(5)
    // (A first-time strike only when the shot is on: markers go with the routine's runners.)
    expect(firstTime).toBeGreaterThanOrEqual(1)
  })

  it('opponents stand at least 4 m from the ball at kick-ins', () => {
    const { sim, s } = kickIn(3)
    for (let i = 0; i < TICK_RATE * 10 && !(s.restart?.ready && s.restart.readyTimer > 1); i++) sim.step()
    const spot = s.restart!.spot
    for (const o of s.players)
      if (o.team === 0) expect(d(o.pos, spot)).toBeGreaterThan(RESTART.opponentDistance - 0.3)
    expect(RESTART.opponentDistance).toBe(4)
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

describe('marking the pivot in front of goal', () => {
  it('the marker goes round the pivot and ends up goal-side, between him and the keeper', () => {
    for (const seed of [2, 4]) {
      const { sim, s } = openPlay(seed, { x: 7, y: -12 })
      const pivot = sim.player(9)
      for (let i = 0; i < TICK_RATE * 5; i++) {
        pivot.pos = { x: 0.5, y: -16.5 }
        pivot.vel = { x: 0, y: 0 }
        const c = sim.player(7)
        c.pos = { x: 7, y: -12 }
        c.vel = { x: 0, y: 0 }
        s.ball.ownerId = 7
        s.ball.mode = 'controlled'
        s.ball.pos = { x: 7, y: -12.4 }
        s.possessionTeam = 1
        sim.step()
      }
      const goal = { x: 0, y: -COURT.halfLength }
      const marker = s.players
        .filter((q) => q.team === 0 && q.role !== 'GK')
        .reduce((a, q) => (d(q.pos, pivot.pos) < d(a.pos, pivot.pos) ? q : a))
      expect(d(marker.pos, pivot.pos)).toBeLessThan(2.2)
      expect(d(marker.pos, goal)).toBeLessThan(d(pivot.pos, goal))
    }
  })
})

describe('attacking pivot', () => {
  it('does not stay in the middle: he also looks for space on the wings', () => {
    const sim = new MatchSimulation({
      seed: 7,
      home: TEAM_LIBRARY[0]!,
      away: TEAM_LIBRARY[1]!,
      humanTeam: null,
    })
    const s = sim.state
    let wide = 0
    let central = 0
    for (let i = 0; i < TICK_RATE * 120; i++) {
      sim.step()
      if (s.phase !== 'play') continue
      for (const p of s.players) {
        // Whoever is playing the pivot (roles are handed out dynamically in attack).
        if (s.possessionTeam !== p.team || s.ball.ownerId === p.id || attackingRole(s, p) !== 'PIVOT')
          continue
        if (Math.abs(p.pos.x) > 4.5) wide++
        else if (Math.abs(p.pos.x) < 2) central++
      }
    }
    expect(wide).toBeGreaterThan(TICK_RATE * 10)
    expect(central).toBeGreaterThan(TICK_RATE * 10)
  })
})

describe('help when the pivot is beaten', () => {
  it('an ala comes across, or the fixo if nobody is near him', () => {
    // (Near our goal: a second man helps only within 14 m of it.)
    const { sim, s } = openPlay(5, { x: 2, y: -8 })
    // Team 0 defends y = -20. Their pivot (4) pressed and is beaten (behind the carrier).
    sim.player(4).pos = { x: 2, y: -5 }
    sim.player(1).pos = { x: 0, y: -16 } // fixo
    sim.player(2).pos = { x: 6, y: -12 } // ala
    sim.player(3).pos = { x: -6, y: -12 } // ala
    // An attacker right next to the fixo: he stays, an ala helps.
    sim.player(9).pos = { x: 0.5, y: -17 }
    const h1 = pickHelper(s, 0, 4)
    expect(h1 === 2 || h1 === 3).toBe(true)
    // Nobody near the fixo and he is closest: the fixo steps up.
    sim.player(9).pos = { x: -9, y: -18 }
    sim.player(2).pos = { x: 9.5, y: -18 }
    sim.player(3).pos = { x: -9.5, y: -18 }
    sim.player(1).pos = { x: 1, y: -12 }
    expect(pickHelper(s, 0, 4)).toBe(1)
  })
})

describe('counter-attack defending', () => {
  it('a team caught upfield switches to counter mode; a back pass or a dead ball ends it', () => {
    const { sim, s } = openPlay(6, { x: 0, y: 6 })
    // Team 0 (defends y = -20) is caught upfield: all four outfield players beyond the ball.
    for (const id of [1, 2, 3, 4]) sim.player(id).pos = { x: (id - 2.5) * 3, y: 10 }
    s.aiPrevPossession = 0
    updateDefensiveTransitions(s)
    expect(s.defTransition[0]).toBe(true)
    // Attackers pass backwards (team 1 attacks -y, so backwards is +y): back in shape.
    s.ball.ownerId = null
    s.ball.mode = 'free'
    s.ball.intendedReceiverId = 6
    s.ball.vel = { x: 0, y: 6 }
    updateDefensiveTransitions(s)
    expect(s.defTransition[0]).toBe(false)
    // A dead ball also ends it.
    s.defTransition[0] = true
    s.phase = 'restart'
    updateDefensiveTransitions(s)
    expect(s.defTransition[0]).toBe(false)
  })

  it('in a counter the defenders sprint back and the team gets back goal-side of the ball', () => {
    const { sim, s } = openPlay(8, { x: 0, y: 4 })
    for (const id of [1, 2, 3, 4]) sim.player(id).pos = { x: (id - 2.5) * 3, y: 9 }
    s.aiPrevPossession = 0
    let sprinted = false
    const carrier = sim.player(7)
    for (let i = 0; i < TICK_RATE * 3; i++) {
      carrier.pos = { x: 0, y: 4 } // the carrier is held up (we measure the others recovering)
      carrier.vel = { x: 0, y: 0 }
      sim.step()
      s.ball.ownerId = 7
      s.ball.mode = 'controlled'
      s.possessionTeam = 1
      if (s.players.some((q) => q.team === 0 && q.aiState === 'cover' && q.sprint)) sprinted = true
    }
    expect(sprinted).toBe(true)
    const goal = { x: 0, y: -COURT.halfLength }
    const goalSide = s.players.filter(
      (q) => q.team === 0 && q.role !== 'GK' && d(q.pos, goal) < d(s.ball.pos, goal),
    ).length
    expect(goalSide).toBeGreaterThanOrEqual(2)
  })
})

/** Hold the given team-1 players in place and keep the ball with player 7 for `seconds`. */
function hold(sim: MatchSimulation, spots: Record<number, Vec2>, seconds: number, each?: () => void) {
  const s = sim.state
  for (let i = 0; i < TICK_RATE * seconds; i++) {
    for (const [id, pos] of Object.entries(spots)) {
      const q = sim.player(Number(id))
      q.pos = { ...pos }
      q.vel = { x: 0, y: 0 }
    }
    const c = sim.player(7)
    s.ball.ownerId = 7
    s.ball.mode = 'controlled'
    s.ball.pos = { x: c.pos.x, y: c.pos.y - 0.4 }
    s.possessionTeam = 1
    each?.()
    sim.step()
  }
}

describe('2 v 1 against the last defender', () => {
  /**
   * Team 1 (attacking -y) breaks 2 v 1 against team 0's fixo (id 1): carrier 7 at `carrier`, second
   * attacker 8 at `mate`; team 0's other outfield players are caught upfield. Returns the positions
   * after `seconds` (attackers held in place).
   */
  function twoV1(carrier: Vec2, mate: Vec2, seconds = 1.6) {
    const { sim, s } = openPlay(4, carrier)
    sim.player(1).pos = { x: 0, y: -15 }
    hold(
      sim,
      {
        7: carrier,
        8: mate,
        2: { x: -3, y: carrier.y + 8 },
        3: { x: 3, y: carrier.y + 8 },
        4: { x: 0, y: carrier.y + 9 },
      },
      seconds,
    )
    return { sim, s, def: sim.player(1), gk: sim.player(0) }
  }
  const distToSegment = (p: Vec2, a: Vec2, b: Vec2) => {
    const abx = b.x - a.x
    const aby = b.y - a.y
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / (abx * abx + aby * aby)))
    return d(p, { x: a.x + abx * t, y: a.y + aby * t })
  }

  it('far from goal he does not rush the carrier: he covers the passing lane to the second attacker', () => {
    const carrier = { x: 3, y: -4 } // 16 m out
    const mate = { x: -4, y: -7 }
    const { def, s } = twoV1(carrier, mate)
    expect(def.aiState).toBe('twoVone')
    expect(distToSegment(def.pos, carrier, mate)).toBeLessThan(1.6)
    expect(d(def.pos, carrier)).toBeGreaterThan(2)
    expect(s.phase).toBe('play')
  })

  it('the nearer they get, the closer he stands to the carrier (goal-side)', () => {
    const mate = { x: -4, y: -12 }
    const far = twoV1({ x: 3, y: -6 }, { x: -4, y: -9 })
    const near = twoV1({ x: 2.5, y: -10.5 }, mate) // about 3-4 m outside the arc
    expect(d(near.def.pos, near.sim.player(7).pos)).toBeLessThan(d(far.def.pos, far.sim.player(7).pos) - 0.8)
    expect(d(near.def.pos, { x: 0, y: -20 })).toBeLessThan(d(near.sim.player(7).pos, { x: 0, y: -20 }))
  })

  it('at the arc he takes the second attacker and the keeper comes out to block the shot', () => {
    const carrier = { x: 2, y: -13.2 } // about 7 m out (the arc)
    const mate = { x: -4, y: -14 }
    const { def, gk } = twoV1(carrier, mate, 2)
    expect(d(def.pos, mate)).toBeLessThan(1.6)
    expect(gk.pos.y - -20).toBeGreaterThan(3) // well off his line, towards the ball
  })
})

describe('measured press and the middle', () => {
  it('far from our goal the presser stands off on the inside instead of diving in', () => {
    const { sim } = openPlay(2, { x: 6, y: 6 })
    // The carrier faces the goal he attacks (with his back to it the pivot would press him tight).
    const c = sim.player(7)
    hold(sim, { 7: { x: 6, y: 6 } }, 2, () => {
      c.facing = sim.state.teams[1].attackDir === 1 ? Math.PI / 2 : -Math.PI / 2
    })
    const presser = sim.state.players.find((q) => q.team === 0 && q.aiState === 'press')!
    expect(presser).toBeDefined()
    expect(d(presser.pos, sim.player(7).pos)).toBeGreaterThan(2)
    expect(Math.abs(presser.pos.x)).toBeLessThan(6) // inside the carrier, towards the middle
    expect(presser.pos.y).toBeLessThan(6) // goal-side
  })

  it('a marker covers the inside (middle) side of a wide man', () => {
    const { sim, s } = openPlay(3, { x: 3, y: -5 })
    // Team 1's ala (8) is wide on the right of the court (x = 8) ahead of the ball.
    // (Long enough for the press and the marking to settle after the switch from the kick-off shape.)
    hold(sim, { 7: { x: 3, y: -5 }, 8: { x: 8, y: -10 } }, 4)
    const marker = s.players
      .filter((q) => q.team === 0 && q.role !== 'GK' && q.aiState === 'cover')
      .reduce((a, q) => (d(q.pos, sim.player(8).pos) < d(a.pos, sim.player(8).pos) ? q : a))
    expect(d(marker.pos, sim.player(8).pos)).toBeLessThan(3)
    expect(marker.pos.x).toBeLessThan(8) // on the middle side
    expect(marker.pos.y).toBeLessThan(-10) // and goal-side
  })
})
