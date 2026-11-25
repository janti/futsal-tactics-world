import { describe, expect, it } from 'vitest'
import { planPass } from '../../src/physics/PassingPhysics'
import { createInitialState } from '../../src/simulation/MatchSimulation'
import { SeededRandom } from '../../src/core/random/SeededRandom'
import { TEAM_LIBRARY } from '../../src/data/teams'
import { InputManager } from '../../src/input/InputManager'
import { basisForOrientation } from '../../src/camera/ScreenToWorld'
import type { MatchState } from '../../src/simulation/MatchState'

function state(): MatchState {
  const s = createInitialState({ seed: 5, home: TEAM_LIBRARY[0]!, away: TEAM_LIBRARY[1]!, humanTeam: 0 })
  s.players.forEach((p, i) => {
    p.pos = { x: -9 + i * 0.1, y: -19 }
    p.vel = { x: 0, y: 0 }
  })
  s.players[1]!.pos = { x: 0, y: 0 }
  return s
}

const angleDeg = (v: { x: number; y: number }) => (Math.atan2(v.y, v.x) * 180) / Math.PI

describe('passing assistance levels', () => {
  it('assisted snaps to a teammate 45 degrees off the input; semi does not', () => {
    const s = state()
    s.players[2]!.pos = { x: 6, y: 6 } // 45 degrees from straight up
    const passer = s.players[1]!
    const assisted = planPass(s, passer, { x: 0, y: 1 }, false, new SeededRandom(1), null, 'assisted')
    expect(assisted.receiverId).toBe(2)
    const semi = planPass(s, passer, { x: 0, y: 1 }, false, new SeededRandom(1), null, 'semi')
    expect(semi.receiverId).toBeNull()
    expect(Math.abs(angleDeg(semi.velocity) - 90)).toBeLessThan(6)
  })

  it('semi still picks a teammate close to the input direction', () => {
    const s = state()
    s.players[2]!.pos = { x: 2, y: 8 } // about 14 degrees off
    const semi = planPass(s, s.players[1]!, { x: 0, y: 1 }, false, new SeededRandom(1), null, 'semi')
    expect(semi.receiverId).toBe(2)
  })

  it('manual goes exactly along the input and power sets the pace', () => {
    const s = state()
    s.players[2]!.pos = { x: 6, y: 6 }
    s.players[3]!.pos = { x: 0.6, y: 9 } // on the line
    const passer = s.players[1]!
    const soft = planPass(s, passer, { x: 0, y: 1 }, false, new SeededRandom(1), null, 'manual', 0.2)
    const hard = planPass(s, passer, { x: 0, y: 1 }, false, new SeededRandom(1), null, 'manual', 1)
    expect(Math.abs(angleDeg(soft.velocity) - 90)).toBeLessThan(5)
    expect(hard.speed).toBeGreaterThan(soft.speed + 6)
    expect(soft.receiverId).toBe(3)
  })

  it('the setting reaches the simulation through a SetControlOptions command', async () => {
    const { MatchSimulation } = await import('../../src/simulation/MatchSimulation')
    const sim = new MatchSimulation({ seed: 2, home: TEAM_LIBRARY[0]!, away: TEAM_LIBRARY[1]!, humanTeam: 0 })
    sim.step([{ type: 'SetControlOptions', options: { passAssist: 'manual' } }])
    expect(sim.state.control.passAssist).toBe('manual')
  })
})

function key(target: EventTarget, type: 'keydown' | 'keyup', code: string) {
  target.dispatchEvent(Object.assign(new Event(type), { code, repeat: false }))
}

describe('input: manual pass charging', () => {
  const basis = basisForOrientation(1)
  it('holding the pass key charges, releasing passes with that power; a tap is a soft pass', () => {
    const target = new EventTarget()
    const input = new InputManager(target as unknown as Window)
    input.setPassCharge(true)
    key(target, 'keydown', 'KeyZ')
    for (let i = 0; i < 25; i++) expect(input.sample(basis).some((c) => c.type === 'Pass')).toBe(false)
    expect(input.shotCharge).toBeGreaterThan(0.5)
    key(target, 'keyup', 'KeyZ')
    const p = input.sample(basis).find((c) => c.type === 'Pass')
    expect(p?.type === 'Pass' && p.power).toBeGreaterThan(0.5)

    key(target, 'keydown', 'KeyZ')
    key(target, 'keyup', 'KeyZ')
    const tap = input.sample(basis).find((c) => c.type === 'Pass')
    expect(tap?.type === 'Pass' && tap.power).toBeCloseTo(0.3)
  })
})
