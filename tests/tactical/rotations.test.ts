import { describe, expect, it } from 'vitest'
import { TEAM_LIBRARY } from '../../src/data/teams'
import { MatchSimulation, createInitialState } from '../../src/simulation/MatchSimulation'
import { ROTATION, rotationMove, updateRotations, wallPassOption } from '../../src/ai/BasicAI'
import type { MatchState } from '../../src/simulation/MatchState'
import type { Formation } from '../../src/simulation/Tactics'

/**
 * Team 0 (ids 1 fixo, 2 ala L, 3 ala R, 4 pivot) attacks towards y = dir * 20. `at(x, d)` is the
 * point `d` metres from the goal team 0 attacks. Team 1's outfield players (6-9) start far away.
 */
function scene(formation: Formation = '3-1', rotations = true) {
  const s = createInitialState({
    seed: 4,
    home: TEAM_LIBRARY[0]!,
    away: TEAM_LIBRARY[1]!,
    humanTeam: null,
    tactics: [{ formation, rotations }, {}],
  })
  s.phase = 'play'
  s.restart = null
  s.possessionTeam = 0
  s.teamPhase = ['attack', 'defence']
  s.time = 10
  const dir = s.teams[0].attackDir
  const at = (x: number, d: number) => ({ x, y: dir * (20 - d) })
  for (const p of s.players) {
    p.vel = { x: 0, y: 0 }
    if (p.team === 1 && p.role !== 'GK') p.pos = { x: -8 + (p.id - 6) * 0.5, y: dir * (-18 + p.id) }
  }
  return { s, dir, at }
}

function giveBall(s: MatchState, id: number, holdFor = 1) {
  const p = s.players[id]!
  s.ball.ownerId = id
  s.ball.mode = 'controlled'
  s.ball.inHands = false
  s.ball.pos = { ...p.pos }
  s.ball.vel = { x: 0, y: 0 }
  s.ball.lastTouchTeam = 0
  s.ball.lastTouchId = id
  p.aiHoldTimer = holdFor
}

describe('overlap', () => {
  it('a wide carrier held up by his marker: the man behind him runs round the outside, cover drops in', () => {
    const { s, at } = scene()
    s.players[3]!.pos = at(7, 18) // ala R on the ball, wide
    s.players[1]!.pos = at(5, 23) // fixo behind him on that side (the deepest)
    s.players[2]!.pos = at(-4, 20)
    s.players[4]!.pos = at(0, 9)
    s.players[8]!.pos = at(7, 15.5) // his marker, in front
    giveBall(s, 3)
    updateRotations(s)
    const r = s.rotation[0]
    expect(r?.kind).toBe('overlap')
    const run = rotationMove(s, s.players[1]!)
    expect(run?.job).toBe('run')
    expect(run!.target.x).toBeGreaterThan(7.5) // outside the carrier
    // The overlapper was the last man: somebody else drops into his place.
    const cover = r!.moves.find((m) => m.job === 'cover')
    expect(cover?.id).toBe(2)
    // Possession lost: the rotation is cancelled at once.
    s.possessionTeam = 1
    updateRotations(s)
    expect(s.rotation[0]).toBeNull()
    expect(s.rotationStats[0].overlap).toEqual({ started: 1, completed: 0 })
  })

  it('not with an opponent in the way down the wing, nor when the team plays without rotations', () => {
    const { s, at } = scene()
    s.players[3]!.pos = at(7, 18)
    s.players[1]!.pos = at(5, 23)
    s.players[2]!.pos = at(-4, 24)
    s.players[4]!.pos = at(0, 9)
    s.players[8]!.pos = at(7, 15.5)
    s.players[7]!.pos = at(8.3, 13) // standing where the run goes
    giveBall(s, 3)
    updateRotations(s)
    expect(s.rotation[0]).toBeNull()
    const off = scene('3-1', false)
    off.s.players[3]!.pos = off.at(7, 18)
    off.s.players[1]!.pos = off.at(5, 23)
    off.s.players[8]!.pos = off.at(7, 15.5)
    giveBall(off.s, 3)
    updateRotations(off.s)
    expect(off.s.rotation[0]).toBeNull()
  })
})

describe('wall pass', () => {
  it('a defender in front and a free teammate beside him: play it in and run past behind the defender', () => {
    const { s, dir, at } = scene()
    s.players[1]!.pos = at(0, 20) // carrier
    s.players[3]!.pos = at(5, 19) // the wall
    s.players[2]!.pos = at(-5, 26) // cover behind the ball
    s.players[4]!.pos = at(-2, 8)
    s.players[6]!.pos = at(0.3, 17.5) // defender in front
    giveBall(s, 1)
    const wp = wallPassOption(s, s.players[1]!)
    expect(wp?.wall.id).toBe(3)
    // The run goes past the defender on the wall's side, into the space behind him.
    expect(wp!.run.x).toBeGreaterThan(s.players[6]!.pos.x)
    expect((wp!.run.y - s.players[6]!.pos.y) * dir).toBeGreaterThan(2)
  })

  it('needs somebody else behind the ball (balance)', () => {
    const { s, at } = scene()
    s.players[1]!.pos = at(0, 20)
    s.players[3]!.pos = at(5, 19)
    s.players[2]!.pos = at(-5, 14) // nobody behind the ball now
    s.players[4]!.pos = at(-2, 8)
    s.players[6]!.pos = at(0.3, 17.5)
    giveBall(s, 1)
    expect(wallPassOption(s, s.players[1]!)).toBeNull()
  })

  it('in play the 1-2 is played and completed now and then', () => {
    let started = 0
    let completed = 0
    // (Five matches: the ball goes round the rotation first, so the 1-2 is not an every-minute move.)
    for (const seed of [1, 2, 3, 4, 5]) {
      const sim = new MatchSimulation({
        seed,
        home: TEAM_LIBRARY[0]!,
        away: TEAM_LIBRARY[1]!,
        humanTeam: null,
      })
      for (let i = 0; i < 60 * 150; i++) sim.step()
      for (const t of [0, 1] as const) {
        started += sim.state.rotationStats[t].wallPass.started
        completed += sim.state.rotationStats[t].wallPass.completed
      }
    }
    expect(started).toBeGreaterThanOrEqual(3)
    expect(completed).toBeGreaterThan(0)
  })
})

describe('pivot rotation (3-1)', () => {
  it('the pivot marked tight comes short, the far ala runs into the space he left', () => {
    const { s, dir, at } = scene('3-1')
    s.players[2]!.pos = at(-5, 21) // ala L on the ball
    s.players[1]!.pos = at(1, 25) // fixo behind
    s.players[4]!.pos = at(0, 8) // pivot
    s.players[9]!.pos = at(0, 6.8) // his marker, goal-side
    s.players[3]!.pos = at(6, 15) // far ala
    giveBall(s, 2, 0.3) // just received, free (not held up: no overlap)
    updateRotations(s)
    const r = s.rotation[0]
    expect(r?.kind).toBe('pivot')
    const drop = rotationMove(s, s.players[4]!)
    const run = rotationMove(s, s.players[3]!)
    expect(drop?.job).toBe('drop')
    expect(run?.job).toBe('run')
    // He comes towards the ball; the ala goes up to about where the pivot was.
    expect((drop!.target.y - s.players[4]!.pos.y) * dir).toBeLessThan(-3)
    expect(Math.abs(run!.target.y - s.players[4]!.pos.y)).toBeLessThan(1.5)
  })

  it('only in the 3-1', () => {
    const { s, at } = scene('2-2')
    s.players[2]!.pos = at(-5, 21)
    s.players[1]!.pos = at(1, 25)
    s.players[4]!.pos = at(0, 8)
    s.players[9]!.pos = at(0, 6.8)
    s.players[3]!.pos = at(6, 15)
    giveBall(s, 2)
    updateRotations(s)
    expect(s.rotation[0]?.kind).not.toBe('pivot')
  })
})

/** Team 0's player `from` has just passed to `to` (the ball a few tenths of a metre on its way). */
function passed(s: MatchState, dir: number, from: number, to: number) {
  const a = s.players[from]!.pos
  const b = s.players[to]!.pos
  const l = Math.hypot(b.x - a.x, b.y - a.y)
  s.ball.ownerId = null
  s.ball.mode = 'free'
  s.ball.pos = { x: a.x + ((b.x - a.x) / l) * 0.4, y: a.y + ((b.y - a.y) / l) * 0.4 }
  s.ball.vel = { x: ((b.x - a.x) / l) * 9, y: ((b.y - a.y) / l) * 9 }
  s.ball.lastTouchTeam = 0
  s.ball.lastTouchId = from
  s.ball.intendedReceiverId = to
  void dir
}

describe('rotations: pohjakasi (3-1)', () => {
  it('the middle man passes to a wing: he runs up the middle, then out to that wing; the wing carries inside', () => {
    const { s, dir, at } = scene('3-1')
    s.players[1]!.pos = at(0, 27) // middle man of the back three
    s.players[3]!.pos = at(7, 25) // right wing
    s.players[2]!.pos = at(-7, 25)
    s.players[4]!.pos = at(0, 12) // pivot
    passed(s, dir, 1, 3)
    updateRotations(s)
    expect(s.rotation[0]?.kind).toBe('baseEight')
    const run = rotationMove(s, s.players[1]!)!
    expect(run.job).toBe('run')
    // First up the middle...
    expect(Math.abs(run.via!.x)).toBeLessThan(1.5)
    expect((run.via!.y - s.players[1]!.pos.y) * dir).toBeGreaterThan(3)
    // ...then out to the wing he passed to, ahead of the receiver.
    expect(run.target.x * dir).toBeGreaterThan(7)
    expect((run.target.y - s.players[3]!.pos.y) * dir).toBeGreaterThan(1)
    const carry = rotationMove(s, s.players[3]!)!
    expect(carry.job).toBe('carry')
    expect(Math.abs(carry.target.x)).toBeLessThan(1.5)
    // The pivot and the far wing hold their places.
    expect(rotationMove(s, s.players[4]!)).toBeNull()
    expect(rotationMove(s, s.players[2]!)).toBeNull()
  })

  it('the cycle flows on: the carrier, now the middle man, passes to a side and the next run starts at once', () => {
    const { s, dir, at } = scene('3-1')
    s.players[1]!.pos = at(0, 27)
    s.players[3]!.pos = at(7, 25)
    s.players[2]!.pos = at(-7, 25)
    s.players[4]!.pos = at(0, 12)
    passed(s, dir, 1, 3)
    updateRotations(s)
    // He has carried it into the middle; the runner has gone; the ball goes to the other wing.
    s.players[3]!.pos = at(0.8, 23.5)
    giveBall(s, 3)
    updateRotations(s)
    expect(s.rotation[0]?.kind).toBe('baseEight')
    passed(s, dir, 3, 2)
    updateRotations(s)
    const r = s.rotation[0]
    expect(r?.kind).toBe('baseEight')
    expect(rotationMove(s, s.players[3]!)?.job).toBe('run') // he makes the run himself now
    expect(rotationMove(s, s.players[2]!)?.job).toBe('carry')
    expect(s.rotationStats[0].baseEight.started).toBe(2)
  })

  it('from the wing: a wing passes into the middle and runs up; the middle man switches it and moves across', () => {
    const { s, dir, at } = scene('3-1')
    s.players[3]!.pos = at(7, 24) // right wing on the ball
    s.players[1]!.pos = at(0, 27)
    s.players[2]!.pos = at(-7, 25)
    s.players[4]!.pos = at(0, 12)
    passed(s, dir, 3, 1)
    updateRotations(s)
    expect(s.rotation[0]?.kind).toBe('baseEightWing')
    const run = rotationMove(s, s.players[3]!)!
    expect(run.job).toBe('run')
    expect(Math.abs(run.target.x)).toBeLessThan(2) // diagonally up into the middle
    const sw = rotationMove(s, s.players[1]!)!
    expect(sw.job).toBe('switch')
    expect(sw.passTo).toBe(2)
    // The switch is played: he goes across into the wing the runner left; the far wing has it now.
    giveBall(s, 1)
    updateRotations(s)
    passed(s, dir, 1, 2)
    updateRotations(s)
    expect(s.rotation[0]?.kind).toBe('baseEightWing')
    expect(rotationMove(s, s.players[1]!)?.job).toBe('cover')
    expect(rotationMove(s, s.players[1]!)!.target.x * dir).toBeGreaterThan(6)
    expect(s.rotation[0]!.carrierId).toBe(2)
  })
})

describe('rotations: 4-0', () => {
  it('perhonen: a central player passes to his wing, runs up through the centre and back out to that wing', () => {
    const { s, dir, at } = scene('4-0')
    s.players[1]!.pos = at(1.5, 22) // central, right of centre
    s.players[4]!.pos = at(-2.5, 22)
    s.players[3]!.pos = at(7.5, 21) // his wing
    s.players[2]!.pos = at(-7.5, 21)
    passed(s, dir, 1, 3)
    updateRotations(s)
    expect(s.rotation[0]?.kind).toBe('butterfly')
    const run = rotationMove(s, s.players[1]!)!
    expect(Math.abs(run.via!.x)).toBeLessThan(1) // through the centre
    expect((run.via!.y - s.players[1]!.pos.y) * dir).toBeGreaterThan(2)
    expect(run.target.x * dir).toBeGreaterThan(7) // back out to the wing he passed to
    const carry = rotationMove(s, s.players[3]!)!
    expect(carry.job).toBe('carry')
    expect(Math.abs(carry.target.x)).toBeLessThan(3) // into the central lane he left
  })

  it('perhonen goes to his own wing, not across the court', () => {
    const { s, dir, at } = scene('4-0')
    s.players[1]!.pos = at(2, 22)
    s.players[4]!.pos = at(-2.5, 22)
    s.players[3]!.pos = at(7.5, 21)
    s.players[2]!.pos = at(-7.5, 21)
    passed(s, dir, 1, 2) // to the far wing
    updateRotations(s)
    expect(s.rotation[0]?.kind).not.toBe('butterfly')
  })

  it('the 4-player rotation: across the middle, the passer goes wide and the ala on his side moves inside', () => {
    const { s, dir, at } = scene('4-0')
    s.players[1]!.pos = at(1.5, 22)
    s.players[4]!.pos = at(-2.5, 22)
    s.players[3]!.pos = at(7.5, 21)
    s.players[2]!.pos = at(-7.5, 21)
    passed(s, dir, 1, 4)
    updateRotations(s)
    expect(s.rotation[0]?.kind).toBe('fourCircle')
    const wide = rotationMove(s, s.players[1]!)!
    expect(wide.target.x * dir).toBeGreaterThan(6.5)
    const inside = rotationMove(s, s.players[3]!)!
    expect(inside.job).toBe('run')
    expect(Math.abs(inside.target.x)).toBeLessThan(3)
    expect((inside.target.y - s.players[4]!.pos.y) * dir).toBeGreaterThan(2)
  })
})

describe('back-post rotation', () => {
  it('ball on a wing near goal: back post and front of the area, then they swap', () => {
    const { s, dir, at } = scene()
    s.players[3]!.pos = at(6, 7) // carrier on the right, near goal
    s.players[2]!.pos = at(-4, 10)
    s.players[4]!.pos = at(1, 9)
    s.players[1]!.pos = at(0, 22) // deepest: stays out of it
    giveBall(s, 3)
    updateRotations(s)
    const r = s.rotation[0]
    expect(r?.kind).toBe('backPost')
    expect(r!.moves.some((m) => m.id === 1)).toBe(false)
    const post = r!.moves.find((m) => m.job === 'post')!
    expect(post.target.x).toBeLessThan(0) // far side
    expect(Math.abs(post.target.y - dir * 20)).toBeLessThan(3.5)
    const before = post.id
    s.time += ROTATION.backPostSwap + 0.1
    updateRotations(s)
    const after = s.rotation[0]!.moves.find((m) => m.job === 'post')!
    expect(after.id).not.toBe(before)
  })

  it('the ball reaching the man at the back post completes it', () => {
    const { s, at } = scene()
    s.players[3]!.pos = at(6, 7)
    s.players[2]!.pos = at(-4, 10)
    s.players[4]!.pos = at(1, 9)
    s.players[1]!.pos = at(0, 22)
    giveBall(s, 3)
    updateRotations(s)
    const post = s.rotation[0]!.moves.find((m) => m.job === 'post')!
    s.players[post.id]!.pos = { ...post.target }
    giveBall(s, post.id)
    updateRotations(s)
    expect(s.rotation[0]).toBeNull()
    expect(s.rotationStats[0].backPost.completed).toBe(1)
    // A short pause before the next one.
    expect(s.rotationReadyAt[0]).toBeGreaterThan(s.time)
  })
})

describe('rotations in play', () => {
  it('every kind happens in its formation, and one outfield player (not a runner) stays level with the ball or behind it', () => {
    const seen = new Set<string>()
    let ticks = 0
    let unbalanced = 0
    for (const [seed, formation] of [
      [1, '3-1'],
      [2, '4-0'],
    ] as const) {
      const sim = new MatchSimulation({
        seed,
        home: TEAM_LIBRARY[0]!,
        away: TEAM_LIBRARY[1]!,
        humanTeam: null,
        tactics: [{ formation }, { formation }],
      })
      const s = sim.state
      for (let i = 0; i < 60 * 180; i++) {
        sim.step()
        for (const t of [0, 1] as const) {
          const r = s.rotation[t]
          if (!r) continue
          seen.add(r.kind)
          ticks++
          const dir = s.teams[t].attackDir
          // The forward runners do not count; somebody else is level with the ball or behind it.
          const busy = new Set(r.moves.filter((m) => m.job === 'run' || m.job === 'post').map((m) => m.id))
          const behind = s.players.some(
            (p) => p.team === t && p.role !== 'GK' && !busy.has(p.id) && (p.pos.y - s.ball.pos.y) * dir < 1,
          )
          if (!behind) unbalanced++
        }
      }
    }
    expect([...seen].sort()).toEqual([
      'backPost',
      'baseEight',
      'baseEightWing',
      'butterfly',
      'fourCircle',
      'overlap',
      'pivot',
      'wallPass',
    ])
    expect(unbalanced / ticks).toBeLessThan(0.1)
  })
})
