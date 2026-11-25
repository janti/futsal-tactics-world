import { describe, expect, it } from 'vitest'
import { chooseReceiver, planPass, predictPassTarget } from '../../src/physics/PassingPhysics'
import { planShot } from '../../src/physics/ShootingPhysics'
import { createInitialState } from '../../src/simulation/MatchSimulation'
import { SeededRandom } from '../../src/core/random/SeededRandom'
import { TEAM_LIBRARY } from '../../src/data/teams'
import type { MatchState } from '../../src/simulation/MatchState'

function state(): MatchState {
  const s = createInitialState({ seed: 5, home: TEAM_LIBRARY[0]!, away: TEAM_LIBRARY[1]!, humanTeam: 0 })
  // Clear the court: park everyone far away, then place the actors under test.
  s.players.forEach((p, i) => {
    p.pos = { x: -9 + i * 0.1, y: -19 }
    p.vel = { x: 0, y: 0 }
  })
  return s
}

describe('passing', () => {
  it('assisted passing picks the teammate in the input direction', () => {
    const s = state()
    const passer = s.players[1]!
    passer.pos = { x: 0, y: 0 }
    s.players[2]!.pos = { x: 6, y: 0 } // right
    s.players[3]!.pos = { x: -6, y: 0 } // left
    s.players[4]!.pos = { x: 0, y: 8 } // ahead
    expect(chooseReceiver(s, passer, { x: 1, y: 0 })?.id).toBe(2)
    expect(chooseReceiver(s, passer, { x: -1, y: 0.1 })?.id).toBe(3)
    expect(chooseReceiver(s, passer, { x: 0, y: 1 })?.id).toBe(4)
  })

  it('leads a moving receiver instead of passing to where he is now', () => {
    const s = state()
    const passer = s.players[1]!
    passer.pos = { x: 0, y: 0 }
    const r = s.players[4]!
    r.pos = { x: 0, y: 8 }
    r.vel = { x: 4, y: 0 }
    const target = predictPassTarget(passer, r, false, 1)
    expect(target.x).toBeGreaterThan(1.5)
  })

  it('through passes target space ahead in the attacking direction', () => {
    const s = state()
    const passer = s.players[1]!
    passer.pos = { x: 0, y: 0 }
    const r = s.players[4]!
    r.pos = { x: 3, y: 6 }
    expect(predictPassTarget(passer, r, true, 1).y).toBeGreaterThan(8)
    expect(predictPassTarget(passer, r, true, -1).y).toBeLessThan(4)
  })

  it('pass velocity points at the target within the error budget', () => {
    const s = state()
    const passer = s.players[1]!
    passer.pos = { x: 0, y: 0 }
    s.players[4]!.pos = { x: 0, y: 10 }
    const plan = planPass(s, passer, { x: 0, y: 1 }, false, new SeededRandom(1))
    expect(plan.receiverId).toBe(4)
    const angle = Math.atan2(plan.velocity.y, plan.velocity.x)
    expect(Math.abs(angle - Math.PI / 2)).toBeLessThan(0.2)
    expect(plan.speed).toBeGreaterThan(6)
  })
})

describe('shooting', () => {
  it('aims at the goal the shooter attacks, harder with more power', () => {
    const s = state()
    const shooter = s.players[4]!
    shooter.pos = { x: 0, y: 10 }
    const weak = planShot(s, shooter, { x: 0, y: 1 }, 0.2, new SeededRandom(2))
    const strong = planShot(s, shooter, { x: 0, y: 1 }, 1, new SeededRandom(2))
    expect(weak.velocity.y).toBeGreaterThan(0)
    expect(strong.speed).toBeGreaterThan(weak.speed)
    expect(Math.abs(strong.aim.y)).toBe(20)
  })

  it('lateral input chooses the corner on that side', () => {
    const s = state()
    const shooter = s.players[4]!
    shooter.pos = { x: 0, y: 12 }
    shooter.profile.attributes.finishing = 99
    shooter.profile.attributes.shotAccuracy = 99
    let right = 0
    let left = 0
    for (let i = 0; i < 50; i++) {
      if (planShot(s, shooter, { x: 1, y: 0.2 }, 0.3, new SeededRandom(i)).aim.x > 0) right++
      if (planShot(s, shooter, { x: -1, y: 0.2 }, 0.3, new SeededRandom(i)).aim.x < 0) left++
    }
    expect(right).toBeGreaterThan(40)
    expect(left).toBeGreaterThan(40)
  })

  it('better finishers are more accurate (seeded, averaged)', () => {
    const s = state()
    const shooter = s.players[4]!
    shooter.pos = { x: 0, y: 8 }
    const spread = (skill: number) => {
      shooter.profile.attributes.finishing = skill
      shooter.profile.attributes.shotAccuracy = skill
      let sum = 0
      for (let i = 0; i < 200; i++) {
        const p = planShot(s, shooter, { x: 1, y: 0 }, 0.5, new SeededRandom(i))
        sum += Math.abs(p.aim.x - 1.18)
      }
      return sum / 200
    }
    expect(spread(95)).toBeLessThan(spread(30))
  })
})
