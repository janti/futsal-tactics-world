import { describe, expect, it } from 'vitest'
import { TEAM_LIBRARY } from '../../src/data/teams'
import { MatchSimulation, createInitialState } from '../../src/simulation/MatchSimulation'
import type { MatchState, TeamId } from '../../src/simulation/MatchState'
import type { Formation, TeamTactics } from '../../src/simulation/Tactics'
import { closestOnSegment, dist } from '../../src/core/math/vec2'
import { estimateTimeToReach } from '../../src/physics/PlayerPhysics'
import { laneOpenness } from '../../src/physics/PassingPhysics'
import { pisadaOption, rotationMove, startRotation, updateRotations } from '../../src/ai/team/rotations'
import {
  deliveryTime,
  planBackPost,
  planCrossRun,
  planDiagonalRun,
  planDoubleCut,
  planParalela,
  planPivot,
  planPivotLayoff,
  planSwitchPlay,
  planThreeCircle,
  planWideOverload,
  planWingClearance,
} from '../../src/ai/team/rotationPlanners'
import { familyAllowed, rankPlans, scorePlan, stayScore } from '../../src/ai/team/rotationSelect'
import { COMBINATION_PLANNERS } from '../../src/ai/team/rotationPlanners'
import {
  DEFAULT_STYLE,
  FAMILY_IDS,
  MOVEMENT_KINDS,
  PRESETS,
  sanitizeRotationSettings,
} from '../../src/ai/team/rotationLibrary'
import { balanceScore, requiredBalance } from '../../src/ai/team/rotationSupport'
import { individualTarget } from '../../src/ai/player/individual'
import { SCENARIOS, applyScenario, demoPriorities, type ScenarioId } from '../../src/lab/scenarios'
import { TICK_RATE } from '../../src/simulation/SimulationConfig'

/**
 * Team `team` (0: ids 1 fixo, 2 ala L, 3 ala R, 4 pivot; 1: ids 6-9) attacks. `at(x, d)` is the point
 * d metres from the goal it attacks, x to its right; `mirror` flips left and right.
 */
function scene(
  formation: Formation = '3-1',
  team: TeamId = 0,
  tactics: Partial<TeamTactics> = {},
  mirror = false,
) {
  const s = createInitialState({
    seed: 4,
    home: TEAM_LIBRARY[0]!,
    away: TEAM_LIBRARY[1]!,
    humanTeam: null,
    tactics: team === 0 ? [{ formation, ...tactics }, {}] : [{}, { formation, ...tactics }],
  })
  s.phase = 'play'
  s.restart = null
  s.possessionTeam = team
  s.teamPhase = team === 0 ? ['attack', 'defence'] : ['defence', 'attack']
  s.time = 10
  const dir = s.teams[team].attackDir
  const m = mirror ? -1 : 1
  // Team-relative: right of a player facing the goal he attacks is +x when he attacks +y.
  const at = (x: number, d: number) => ({ x: x * dir * m, y: dir * (20 - d) })
  const id = (n: number) => (team === 0 ? n : n + 5) // 1 fixo .. 4 pivot of the attacking team
  const opp = (n: number) => (team === 0 ? n + 5 : n) // 1..4 -> the defenders' outfield ids
  for (const p of s.players) {
    p.vel = { x: 0, y: 0 }
    if (p.team !== team && p.role !== 'GK') p.pos = at(-7.5 + (p.id % 5) * 0.4, 38) // far behind the attack
  }
  return { s, dir, at, id, opp, m }
}

function giveBall(s: MatchState, id: number, holdFor = 1) {
  const p = s.players[id]!
  s.ball.ownerId = id
  s.ball.mode = 'controlled'
  s.ball.inHands = false
  s.ball.pos = { ...p.pos }
  s.ball.vel = { x: 0, y: 0 }
  s.ball.lastTouchTeam = p.team
  s.ball.lastTouchId = id
  p.aiHoldTimer = holdFor
}

/** The wing-clearance scene: fixo on the ball, ala R wide ahead marked tight, ala L deeper. */
function wingScene() {
  const k = scene('3-1')
  const { s, at, id, opp } = k
  s.players[id(1)]!.pos = at(0, 22)
  s.players[id(3)]!.pos = at(7, 18)
  s.players[id(2)]!.pos = at(3, 24.5)
  s.players[id(4)]!.pos = at(-1, 10)
  s.players[opp(2)]!.pos = at(6.6, 16.6) // marks ala R
  giveBall(s, id(1))
  return k
}

describe('rotation library: definitions and settings', () => {
  it('25 movement families, every runtime kind belongs to one, Finnish and English names exist', async () => {
    expect(FAMILY_IDS.length).toBe(25)
    const { en } = await import('../../src/localization/en')
    const { fi } = await import('../../src/localization/fi')
    for (const f of FAMILY_IDS) {
      expect(en[`family.${f}` as keyof typeof en]).toBeTruthy()
      expect(fi[`family.${f}` as keyof typeof fi]).toBeTruthy()
    }
    for (const k of MOVEMENT_KINDS) expect(en[`debug.rotation.${k}` as keyof typeof en], k).toBeTruthy()
    expect(fi['family.baseEight']).toBe('Pohjakasi')
    expect(fi['family.wingClearance']).toBe('Laidan tyhjennys')
    expect(fi['rot.style.frequency']).toBe('Rotaatioiden määrä')
  })

  it('saved settings are sanitised; presets are complete', () => {
    const v = sanitizeRotationSettings({
      preset: 'nope',
      style: { frequency: 140, freedom: -3, x: 5 },
      priorities: { wallPass: 'high', foo: 'off', crossRun: 'normal' },
    })
    expect(v.preset).toBeNull()
    expect(v.style.frequency).toBe(100)
    expect(v.style.freedom).toBe(0)
    expect(v.style.balance).toBe(DEFAULT_STYLE.balance)
    expect(v.priorities).toEqual({ wallPass: 'high' })
    for (const p of Object.values(PRESETS))
      expect(Object.keys(p.style).sort()).toEqual(Object.keys(DEFAULT_STYLE).sort())
  })
})

describe('rotation library: movement families', () => {
  it('1. wing clearance: the marker follows the clearing run -> the filler attacks the wing left free', () => {
    const { s, id, opp } = wingScene()
    const plan = planWingClearance(s, 0)!
    expect(plan.kind).toBe('wingClearance')
    startRotation(s, 0, plan.kind, plan.carrierId, plan.moves)
    const clearer = s.players[id(3)]!
    // A second later the clearing man is inside and his marker went with him.
    s.time += 1.05
    clearer.pos = { x: clearer.pos.x * 0.4, y: clearer.pos.y }
    s.players[opp(2)]!.pos = { x: clearer.pos.x + 0.6, y: clearer.pos.y }
    updateRotations(s)
    const r = s.rotation[0]!
    expect(r.response).toBe('followed')
    expect(r.branch).toBe('attackVacated')
    const fill = rotationMove(s, s.players[id(2)]!)!
    expect(fill.job).toBe('run')
    expect(Math.abs(fill.target.x)).toBeGreaterThan(7)
    expect(s.rotationStats[0].wingClearance.displaced).toBe(1)
  })

  it('2. wing clearance: the marker stays in the wing -> the clearing man is the option, nobody runs into the marker', () => {
    const { s, id } = wingScene()
    const plan = planWingClearance(s, 0)!
    startRotation(s, 0, plan.kind, plan.carrierId, plan.moves)
    s.time += 1.05
    const clearer = s.players[id(3)]!
    clearer.pos = { x: clearer.pos.x * 0.4, y: clearer.pos.y } // the marker did not move
    updateRotations(s)
    const r = s.rotation[0]!
    expect(r.response).toBe('held')
    expect(r.branch).toBe('passToClearer')
    expect(rotationMove(s, s.players[id(2)]!)!.job).toBe('cover')
  })

  it('3. three-player rotation (pohjakasi family): the far wing fills the deep space behind the ball', () => {
    const { s, at, id, opp, dir } = scene('3-1')
    s.players[id(3)]!.pos = at(7, 23)
    s.players[id(1)]!.pos = at(0, 26)
    s.players[id(2)]!.pos = at(-7, 24)
    s.players[id(4)]!.pos = at(0, 12)
    s.players[opp(3)]!.pos = at(-6.6, 23.3) // the far wing marked: no quick switch
    // The wing has just passed back into the middle.
    const b = s.ball
    b.ownerId = null
    b.mode = 'free'
    b.pos = at(6.5, 23.2)
    b.lastTouchId = id(3)
    b.lastTouchTeam = 0
    b.intendedReceiverId = id(1)
    const plan = planThreeCircle(s, 0)!
    expect(plan.kind).toBe('threeCircle')
    const cover = plan.moves.find((m) => m.job === 'cover')!
    expect(cover.id).toBe(id(2))
    // Behind the ball (deeper than the middle man) and central.
    expect((cover.target.y - s.players[id(1)]!.pos.y) * dir).toBeLessThan(0)
    expect(Math.abs(cover.target.x)).toBeLessThan(4)
  })

  it('4-5. in play: the 3-1 keeps its pivot depth, the 4-0 keeps width and staggered depth while rotating', () => {
    let pivotDeep = 0
    let n31 = 0
    let wide = 0
    let staggered = 0
    let n40 = 0
    for (const formation of ['3-1', '4-0'] as const)
      for (const seed of [1, 2]) {
        const sim = new MatchSimulation({
          seed,
          home: TEAM_LIBRARY[0]!,
          away: TEAM_LIBRARY[1]!,
          humanTeam: null,
          tactics: [{ formation }, {}],
        })
        const s = sim.state
        for (let i = 0; i < TICK_RATE * 150; i++) {
          sim.step()
          const r = s.rotation[0]
          if (!r || i % 10 || s.possessionTeam !== 0) continue
          const dir = s.teams[0].attackDir
          const mine = s.players.filter((p) => p.team === 0 && p.role !== 'GK')
          const ys = mine.map((p) => p.pos.y * dir).sort((a, b) => b - a)
          const xs = mine.map((p) => p.pos.x)
          if (formation === '3-1') {
            n31++
            if (ys[0]! - s.ball.pos.y * dir > 4) pivotDeep++
          } else {
            n40++
            if (Math.max(...xs) - Math.min(...xs) > 8) wide++
            if (ys[0]! - ys[3]! > 3) staggered++
          }
        }
      }
    expect(pivotDeep / n31).toBeGreaterThan(0.6)
    expect(wide / n40).toBeGreaterThan(0.8)
    expect(staggered / n40).toBeGreaterThan(0.8)
  }, 60000)

  it('6. cross run: two different targets, the second run starts later, the runners never collide', () => {
    const sc = SCENARIOS.crossRun
    let checked = 0
    for (const seed of [1, 2, 3, 4]) {
      const sim = labSim(seed, 'crossRun', true)
      const s = sim.state
      const plan = planCrossRun(s, 0)
      if (plan) {
        const [a, b] = plan.moves
        expect(dist(a!.target, b!.target)).toBeGreaterThan(3)
        expect(plan.moves.some((m) => m.startAt !== undefined && m.startAt > s.time)).toBe(true)
      }
      let minGap = Infinity
      for (let i = 0; i < TICK_RATE * 3; i++) {
        sim.step()
        const r = s.rotation[0]
        if (r?.kind !== 'crossRun') continue
        const runners = r.moves.filter((m) => m.job === 'run').map((m) => s.players[m.id]!)
        if (runners.length === 2) minGap = Math.min(minGap, dist(runners[0]!.pos, runners[1]!.pos))
      }
      if (minGap < Infinity) {
        checked++
        expect(minGap).toBeGreaterThan(0.7)
      }
    }
    expect(checked).toBeGreaterThan(0)
    expect(sc.attackFormation).toBe('2-2')
  })

  it('7. paralela only when the runner gets there before the defender', () => {
    const { s, at, id, opp } = scene('3-1')
    s.players[id(3)]!.pos = at(7, 18)
    s.players[id(1)]!.pos = at(5, 20.5)
    s.players[id(2)]!.pos = at(-6, 20)
    s.players[id(4)]!.pos = at(-3, 9)
    s.players[opp(2)]!.pos = at(4.8, 13.5)
    giveBall(s, id(3))
    const plan = planParalela(s, 0)
    expect(plan?.kind).toBe('paralela')
    // A covering man standing near the end of the run: no paralela.
    s.players[opp(1)]!.pos = at(8, 12.5)
    expect(planParalela(s, 0)).toBeNull()
  })

  it('8. diagonal run: the target is in a gap with an open lane from the carrier', () => {
    const sim = labSim(1, 'diagonalRun', true)
    const s = sim.state
    const plan = planDiagonalRun(s, 0)!
    expect(plan.kind).toBe('diagonalRun')
    const c = s.players[plan.carrierId]!
    expect(laneOpenness(s, 0, c.pos, plan.moves[0]!.target)).toBeGreaterThan(1)
  })

  it('9. third man: C is already running before the ball reaches the link', () => {
    let anticipated = 0
    let cases = 0
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const sim = labSim(seed, 'thirdMan', true)
      const s = sim.state
      let runStart: number | null = null
      let linkTouch: number | null = null
      for (let i = 0; i < TICK_RATE * 4 && linkTouch === null; i++) {
        sim.step()
        const r = s.rotation[0]
        if (r?.kind !== 'thirdMan') continue
        const run = r.moves.find((m) => m.job === 'run')!
        const link = r.moves.find((m) => m.job === 'link')
        const runner = s.players[run.id]!
        const toward =
          (run.target.x - runner.pos.x) * runner.vel.x + (run.target.y - runner.pos.y) * runner.vel.y
        if (runStart === null && toward > 0 && Math.hypot(runner.vel.x, runner.vel.y) > 1.5) runStart = s.time
        if (link && s.ball.ownerId === link.id) linkTouch = s.time
      }
      if (linkTouch !== null && runStart !== null) {
        cases++
        if (runStart < linkTouch) anticipated++
      }
    }
    expect(cases).toBeGreaterThan(0)
    expect(anticipated).toBe(cases)
  })

  it('10. back post: the run is timed to arrive about when a ball across would', () => {
    const { s, at, id } = scene('3-1')
    s.players[id(3)]!.pos = at(6, 13) // wide, coming in
    s.players[id(3)]!.vel = { x: 0, y: s.teams[0].attackDir * 3 }
    s.players[id(2)]!.pos = at(-3, 6)
    s.players[id(4)]!.pos = at(1, 8)
    s.players[id(1)]!.pos = at(0, 22)
    giveBall(s, id(3))
    const plan = planBackPost(s, 0)!
    const post = plan.moves.find((m) => m.job === 'post')!
    const runner = s.players[post.id]!
    const arrive = (post.startAt ?? s.time) - s.time + estimateTimeToReach(runner, post.target)
    const delivery = deliveryTime(s, 0, s.players[id(3)]!, post.target)
    // Not long before the ball (he would stand marked waiting), never inside the goal.
    expect(arrive).toBeGreaterThan(delivery - 0.6)
    expect(Math.abs(post.target.y)).toBeLessThan(20)
  })

  it('11. pivot layoff: the nearest teammate comes to the lay-off spot behind the pivot', () => {
    const sim = labSim(1, 'pivotLayoff', true)
    const s = sim.state
    const plan = planPivotLayoff(s, 0)!
    expect(plan.kind).toBe('pivotLayoff')
    const drop = plan.moves.find((m) => m.job === 'drop')!
    const pivot = s.players[plan.carrierId]!
    const dir = s.teams[0].attackDir
    expect((drop.target.y - pivot.pos.y) * dir).toBeLessThan(-2)
    const others = s.players.filter((p) => p.team === 0 && p.role !== 'GK' && p.id !== pivot.id)
    const nearest = others.reduce((a, p) => (dist(p.pos, drop.target) < dist(a.pos, drop.target) ? p : a))
    expect(drop.id).toBe(nearest.id)
  })

  it('12. pivot exchange: in the 4-0 a temporary pivot replaces the depth the most advanced man leaves', () => {
    const { s, at, id, opp } = scene('4-0')
    s.players[id(2)]!.pos = at(-5, 21)
    s.players[id(1)]!.pos = at(1, 25)
    s.players[id(4)]!.pos = at(0, 9)
    s.players[opp(4)]!.pos = at(0, 7.8)
    s.players[id(3)]!.pos = at(6, 15)
    giveBall(s, id(2), 0.3)
    const plan = planPivot(s, 0)!
    expect(plan.trigger).toBe('temporaryPivot')
    const run = plan.moves.find((m) => m.job === 'run')!
    expect(Math.abs(run.target.y - s.players[id(4)]!.pos.y)).toBeLessThan(1.5)
  })

  it('13-14-15. wide overload keeps a weak-side man; the switch goes to the free side; the double cut keeps balance', () => {
    const wo = labSim(1, 'wideOverload', true).state
    const plan = planWideOverload(wo, 0)!
    const c = wo.players[plan.carrierId]!
    const weak = plan.moves.find((m) => m.job === 'cover')!
    expect(Math.sign(weak.target.x)).toBe(-Math.sign(c.pos.x))

    const sw = labSim(1, 'switchPlay', true).state
    const sp = planSwitchPlay(sw, 0)!
    const sc = sw.players[sp.carrierId]!
    expect(Math.sign(sp.moves[0]!.target.x)).toBe(-Math.sign(sc.pos.x))

    const dc = labSim(1, 'doubleCut', true).state
    const cut = planDoubleCut(dc, 0)!
    const dcc = dc.players[cut.carrierId]!
    expect(
      balanceScore(dc, 0, dcc.pos.y, [dcc.id, ...cut.moves.map((m) => m.id)], false),
    ).toBeGreaterThanOrEqual(0.6)
  })

  it('16. V-cut: steps away first; a marker who anticipates makes him check to the other side', () => {
    const { s, at, id, opp } = scene('3-1')
    const p = s.players[id(3)]!
    p.pos = at(5, 16)
    s.players[id(1)]!.pos = at(0, 23)
    giveBall(s, id(1))
    const marker = s.players[opp(2)]!
    marker.pos = at(5.5, 15)
    const spot = at(5, 19)
    const fake = individualTarget(s, p, spot)!
    expect(p.aiMove?.kind).toBe('vCut')
    expect(dist(fake, spot)).toBeGreaterThan(dist(p.pos, spot))
    // The marker read it and stands in the receiving line: he goes to the mirrored spot.
    marker.pos = at(5, 18.5)
    s.time += 0.5
    const burst = individualTarget(s, p, spot)!
    expect(p.aiState).toBe('run')
    expect(dist(burst, spot)).toBeGreaterThan(1)
  })

  it('17. pisada: the ball is rolled (a real pass), never handed over', () => {
    const { s, at, id, opp } = scene('3-1')
    const c = s.players[id(1)]!
    c.pos = at(0, 20)
    s.players[opp(4)]!.pos = at(0, 18.4) // the presser in front
    const mate = s.players[id(3)]!
    mate.pos = at(2.5, 21.5)
    mate.vel = { x: -4 * s.teams[0].attackDir * -1, y: 0 } // running across behind him
    mate.vel = { x: at(-1, 21.5).x - mate.pos.x > 0 ? 4 : -4, y: 0 }
    s.players[id(2)]!.pos = at(-6, 24)
    giveBall(s, id(1))
    const opt = pisadaOption(s, c)
    // When it is on, it is a normal pass; the simulation moves the ball.
    if (opt) {
      const sim = new MatchSimulation({
        seed: 4,
        home: TEAM_LIBRARY[0]!,
        away: TEAM_LIBRARY[1]!,
        humanTeam: null,
      })
      Object.assign(sim.state, s)
      sim.pass(
        sim.state.players[id(1)]!,
        { x: opt.point.x - c.pos.x, y: opt.point.y - c.pos.y },
        false,
        sim.state.players[opt.mate.id]!,
        undefined,
        3,
      )
      expect(sim.state.ball.ownerId).toBeNull()
      let last = { ...sim.state.ball.pos }
      for (let i = 0; i < 20; i++) {
        sim.step()
        expect(dist(sim.state.ball.pos, last)).toBeLessThan(0.6)
        last = { ...sim.state.ball.pos }
      }
    } else {
      // Not safe to leave it there: no pisada (a forced one would be the bug).
      expect(opt).toBeNull()
    }
  })

  it('18. between the lines: the pocket chosen is out of the cover shadows', () => {
    let tried = 0
    for (const seed of [1, 2, 3]) {
      const sim = new MatchSimulation({
        seed,
        home: TEAM_LIBRARY[0]!,
        away: TEAM_LIBRARY[1]!,
        humanTeam: null,
        tactics: [{ formation: '4-0' }, { pressing: 'low' }],
      })
      const s = sim.state
      for (let i = 0; i < TICK_RATE * 120; i++) {
        sim.step()
        for (const p of s.players) {
          const mv = p.aiMove
          if (!mv || mv.kind !== 'betweenLines' || s.time - (mv.until - 1.5) > 0.02) continue
          const owner = s.ball.ownerId !== null ? s.players[s.ball.ownerId]! : null
          if (!owner) continue
          tried++
          for (const o of s.players) {
            if (o.team === p.team || o.role === 'GK' || dist(o.pos, mv.spot) <= 1) continue
            // (Checked a tick after the choice: everybody has moved up to ~15 cm.)
            expect(dist(closestOnSegment(owner.pos, mv.spot, o.pos).point, o.pos)).toBeGreaterThanOrEqual(1.0)
          }
        }
      }
    }
    expect(tried).toBeGreaterThan(0)
  }, 60000)
})

describe('rotation library: runtime rules', () => {
  it('19 + 23. possession lost: the move is cancelled at once and its reserved spaces released', () => {
    const { s } = wingScene()
    const plan = planWingClearance(s, 0)!
    startRotation(s, 0, plan.kind, plan.carrierId, plan.moves)
    expect(s.rotationTeam[0].reservations.length).toBeGreaterThan(0)
    s.possessionTeam = 1
    updateRotations(s)
    expect(s.rotation[0]).toBeNull()
    expect(s.rotationTeam[0].reservations).toEqual([])
    expect(s.rotationStats[0].wingClearance.reasons.possessionLost).toBe(1)
  })

  it('a pass between teammates is not a loss of possession: the move goes on while the ball travels', () => {
    const { s, id } = wingScene()
    const plan = planWingClearance(s, 0)!
    startRotation(s, 0, plan.kind, plan.carrierId, plan.moves)
    const b = s.ball
    b.ownerId = null
    b.mode = 'free'
    b.lastTouchId = id(1)
    b.intendedReceiverId = id(3) // to the clearing man (in the move)
    updateRotations(s)
    expect(s.rotation[0]?.kind).toBe('wingClearance')
  })

  it('20-22. the human player is never given a job; a move round him survives his own choices; a run target he walks into moves away', () => {
    // A human team in play (he has the ball in a Lab situation): no rotation ever gives him a job.
    let rotTicks = 0
    for (const id of ['wingClearance', 'thirdMan', 'baseEight', 'switchPlay'] as const) {
      const sim = new MatchSimulation({
        seed: 3,
        home: TEAM_LIBRARY[0]!,
        away: TEAM_LIBRARY[1]!,
        humanTeam: 0,
        rules: { halfLength: 99 * 60 },
      })
      const s = sim.state
      s.teams[0].tactics.formation = SCENARIOS[id].attackFormation
      sim.step()
      applyScenario(s, SCENARIOS[id], 0)
      for (let i = 0; i < TICK_RATE * 6; i++) {
        // The human holds the ball and dribbles about (ignores every intended pass).
        sim.step([
          { type: 'Move', dir: { x: Math.sin(i / 50), y: Math.cos(i / 70) }, sprint: false, sole: false },
        ])
        const r = s.rotation[0]
        if (!r) continue
        rotTicks++
        expect(r.moves.some((m) => m.id === s.controlledId)).toBe(false)
      }
    }
    expect(rotTicks).toBeGreaterThan(0)

    // Walking into a teammate's reserved run target: the runner picks another spot.
    const k = wingScene()
    k.s.humanTeam = 0
    const plan = planWingClearance(k.s, 0)!
    startRotation(k.s, 0, plan.kind, plan.carrierId, plan.moves)
    const run = k.s.rotation[0]!.moves.find((m) => m.job === 'run')!
    k.s.time += 0.6 // the run has started
    k.s.controlledId = k.id(4)
    k.s.players[k.id(4)]!.pos = { ...run.target }
    updateRotations(k.s)
    expect(dist(run.target, k.s.players[k.id(4)]!.pos)).toBeGreaterThanOrEqual(2.9)
  })

  it('24. mirrored left/right: the same move with mirrored targets', () => {
    const a = wingScene()
    const pa = planWingClearance(a.s, 0)!
    const b = scene('3-1', 0, {}, true)
    b.s.players[b.id(1)]!.pos = b.at(0, 22)
    b.s.players[b.id(3)]!.pos = b.at(7, 18)
    b.s.players[b.id(2)]!.pos = b.at(3, 24.5)
    b.s.players[b.id(4)]!.pos = b.at(-1, 10)
    b.s.players[b.opp(2)]!.pos = b.at(6.6, 16.6)
    giveBall(b.s, b.id(1))
    const pb = planWingClearance(b.s, 0)!
    expect(pb.kind).toBe(pa.kind)
    for (let i = 0; i < pa.moves.length; i++) {
      expect(pb.moves[i]!.target.x).toBeCloseTo(-pa.moves[i]!.target.x, 5)
      expect(pb.moves[i]!.target.y).toBeCloseTo(pa.moves[i]!.target.y, 5)
    }
  })

  it('25. both attacking directions: team 1 attacking the other goal plans the same move, flipped', () => {
    const t1 = scene('3-1', 1)
    const { s, at, id, opp } = t1
    s.players[id(1)]!.pos = at(0, 22)
    s.players[id(3)]!.pos = at(7, 18)
    s.players[id(2)]!.pos = at(3, 24.5)
    s.players[id(4)]!.pos = at(-1, 10)
    s.players[opp(2)]!.pos = at(6.6, 16.6)
    giveBall(s, id(1))
    const p1 = planWingClearance(s, 1)!
    const p0 = planWingClearance(wingScene().s, 0)!
    expect(p1.kind).toBe('wingClearance')
    expect(p1.moves[0]!.target.x).toBeCloseTo(-p0.moves[0]!.target.x, 5)
    expect(p1.moves[0]!.target.y).toBeCloseTo(-p0.moves[0]!.target.y, 5)
  })

  it('27. short of players: risky moves are not allowed', () => {
    const { s, id } = wingScene()
    expect(familyAllowed(s, 0, 'doubleCut', s.rotationTeam[0])).toBe(true)
    // (A dismissal is not in the game yet: one outfield player taken out of the count.)
    s.players[id(4)]!.role = 'GK'
    expect(familyAllowed(s, 0, 'doubleCut', s.rotationTeam[0])).toBe(false)
    expect(familyAllowed(s, 0, 'baseEight', s.rotationTeam[0])).toBe(true)
  })

  it('28. cross run: marks handed over are read and noted', () => {
    const sim = labSim(2, 'crossRun', true)
    const s = sim.state
    const plan = planCrossRun(s, 0)!
    startRotation(s, 0, plan.kind, plan.carrierId, plan.moves)
    const r = s.rotation[0]!
    const first = r.markers[0]!
    const runner = s.players[first.runner]!
    // His marker stayed put, the other defender picked him up.
    s.time += 1.05
    const other = s.players.find((o) => o.team === 1 && o.role !== 'GK' && o.id !== first.marker)!
    runner.pos = { x: runner.pos.x + 4, y: runner.pos.y }
    other.pos = { x: runner.pos.x + 0.8, y: runner.pos.y }
    s.players[first.marker]!.pos = { ...first.from }
    updateRotations(s)
    expect(['handedOver', 'held']).toContain(s.rotation[0]?.response ?? r.response)
  })

  it('29. keeping the shape wins when no move is worth it (no rotation at the lowest frequency)', () => {
    const { s } = wingScene()
    s.teams[0].tactics.style = { ...DEFAULT_STYLE, frequency: 0 }
    const ranked = rankPlans(s, 0, COMBINATION_PLANNERS, s.rotationTeam[0])
    const stay = stayScore(s, 0)
    for (const r of ranked) if (r.score <= stay) expect(r.score).toBeLessThanOrEqual(stay)
    // Every candidate must beat keeping the shape; a weak one does not start.
    s.teams[0].tactics.style = { ...DEFAULT_STYLE, frequency: 0, penetration: 0 }
    s.teams[0].tactics.priorities = Object.fromEntries(FAMILY_IDS.map((f) => [f, 'low']))
    updateRotations(s)
    const r = s.rotation[0]
    if (r) expect(r.score).toBeGreaterThan(r.stay)
  })

  it('30. rotations off: the basic AI still plays football (passes arrive, shots happen, no rotation)', () => {
    let passes = 0
    let done = 0
    let shots = 0
    for (const seed of [1, 2]) {
      const sim = new MatchSimulation({
        seed,
        home: TEAM_LIBRARY[0]!,
        away: TEAM_LIBRARY[1]!,
        humanTeam: null,
        tactics: [{ rotations: false }, { rotations: false }],
      })
      for (let i = 0; i < TICK_RATE * 180; i++) {
        sim.step()
        for (const e of sim.drainEvents()) {
          if (e.type === 'PassStarted' && e.receiverId !== null) passes++
          if (e.type === 'PassCompleted') done++
          if (e.type === 'ShotTaken') shots++
          expect(e.type).not.toBe('RotationStarted')
        }
      }
      for (const k of MOVEMENT_KINDS) expect(sim.state.rotationStats[0][k].started).toBe(0)
    }
    expect(done / passes).toBeGreaterThan(0.8)
    expect(shots).toBeGreaterThan(3)
  }, 60000)
})

describe('rotation library: settings change the behaviour', () => {
  it('frequency, penetration, balance, patience and familiarity all have an effect', () => {
    const { s } = wingScene()
    const plan = planWingClearance(s, 0)!
    const rt = s.rotationTeam[0]
    const with_ = (style: Partial<typeof DEFAULT_STYLE>) => {
      s.teams[0].tactics.style = { ...DEFAULT_STYLE, ...style }
      return scorePlan(s, 0, plan, rt).score
    }
    s.teams[0].tactics.style = { ...DEFAULT_STYLE, frequency: 0 }
    const stayLow = stayScore(s, 0)
    s.teams[0].tactics.style = { ...DEFAULT_STYLE, frequency: 100 }
    expect(stayScore(s, 0)).toBeLessThan(stayLow)
    expect(with_({ penetration: 100 })).toBeGreaterThan(with_({ penetration: 0 }))
    expect(with_({ passingRisk: 100 })).toBeGreaterThan(with_({ passingRisk: 0 }))
    expect(with_({ patience: 0 })).toBeGreaterThan(with_({ patience: 100 })) // a combination
    s.teams[0].tactics.style = { ...DEFAULT_STYLE, balance: 100 }
    const high = requiredBalance(s, 0)
    s.teams[0].tactics.style = { ...DEFAULT_STYLE, balance: 0 }
    expect(requiredBalance(s, 0)).toBeLessThan(high)
    // Familiarity: an unfamiliar team's runs go later.
    const delay = (familiarity: number) => {
      const k = wingScene()
      k.s.teams[0].tactics.style = { ...DEFAULT_STYLE, familiarity }
      const p = planWingClearance(k.s, 0)!
      const r = startRotation(k.s, 0, p.kind, p.carrierId, p.moves)
      return (r.moves.find((m) => m.job === 'run')!.startAt ?? k.s.time) - k.s.time
    }
    expect(delay(0)).toBeGreaterThan(delay(100))
  })

  it('priorities: "off" removes a family, "high" raises it; discipline and freedom weigh the formation profile', () => {
    const { s } = wingScene()
    const plan = planWingClearance(s, 0)!
    const rt = s.rotationTeam[0]
    s.teams[0].tactics.priorities = { wingClearance: 'off' }
    expect(familyAllowed(s, 0, 'wingClearance', rt)).toBe(false)
    s.teams[0].tactics.priorities = { wingClearance: 'high' }
    const hi = scorePlan(s, 0, plan, rt).score
    s.teams[0].tactics.priorities = {}
    expect(hi).toBeGreaterThan(scorePlan(s, 0, plan, rt).score)
    // A 4-0 family (profile below 1 in the 3-1): freedom softens the penalty.
    const cross = { ...plan, kind: 'fourCircle' as const }
    s.teams[0].tactics.style = { ...DEFAULT_STYLE, freedom: 100 }
    const free = scorePlan(s, 0, cross, rt).score
    s.teams[0].tactics.style = { ...DEFAULT_STYLE, freedom: 0 }
    expect(free).toBeGreaterThan(scorePlan(s, 0, cross, rt).score)
  })

  it('freedom changes how often players make individual moves (AI vs AI)', () => {
    const count = (freedom: number) => {
      let n = 0
      for (const seed of [1, 2]) {
        const sim = new MatchSimulation({
          seed,
          home: TEAM_LIBRARY[0]!,
          away: TEAM_LIBRARY[1]!,
          humanTeam: null,
          tactics: [{ style: { ...DEFAULT_STYLE, freedom } }, {}],
        })
        for (let i = 0; i < TICK_RATE * 120; i++) sim.step()
        n += sim.state.rotationStats[0].vCut.started + sim.state.rotationStats[0].betweenLines.started
      }
      return n
    }
    expect(count(100)).toBeGreaterThan(count(0))
  }, 60000)

  it('the same seed gives the same rotations (deterministic); rotation events are in the match stream', () => {
    const run = () => {
      const sim = new MatchSimulation({
        seed: 9,
        home: TEAM_LIBRARY[0]!,
        away: TEAM_LIBRARY[1]!,
        humanTeam: null,
      })
      let events = 0
      for (let i = 0; i < TICK_RATE * 60; i++) {
        sim.step()
        for (const e of sim.drainEvents())
          if (e.type === 'RotationStarted' || e.type === 'RotationEnded') events++
      }
      return { stats: JSON.stringify(sim.state.rotationStats), events }
    }
    const a = run()
    const b = run()
    expect(a.stats).toBe(b.stats)
    expect(a.events).toBeGreaterThan(0)
  })
})

/** A Lab scenario placed for team 0 (demonstration priorities if `demo`). */
function labSim(seed: number, id: ScenarioId, demo: boolean) {
  const sc = SCENARIOS[id]
  const sim = new MatchSimulation({
    seed,
    home: TEAM_LIBRARY[0]!,
    away: TEAM_LIBRARY[1]!,
    humanTeam: null,
    rules: { halfLength: 99 * 60 },
  })
  sim.state.teams[0].tactics.formation = sc.attackFormation
  if (demo && sc.rotation) sim.state.teams[0].tactics.priorities = demoPriorities(sc.rotation)
  sim.step()
  applyScenario(sim.state, sc, 0)
  sim.drainEvents()
  return sim
}
