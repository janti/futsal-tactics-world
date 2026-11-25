import { describe, expect, it } from 'vitest'
import { angleDiff, clamp, dampFactor, turnTowards, wrapAngle } from '../../src/core/math/scalar'
import { add, closestOnSegment, dist, len, normalize, rotate, sub } from '../../src/core/math/vec2'
import { SeededRandom, deriveSeed } from '../../src/core/random/SeededRandom'
import { facingToThreeYaw, simToThree, teamToWorld, threeToSim, worldToTeam } from '../../src/core/coords'

describe('vector math', () => {
  it('adds, subtracts and measures', () => {
    expect(add({ x: 1, y: 2 }, { x: 3, y: 4 })).toEqual({ x: 4, y: 6 })
    expect(sub({ x: 1, y: 2 }, { x: 3, y: 4 })).toEqual({ x: -2, y: -2 })
    expect(len({ x: 3, y: 4 })).toBe(5)
    expect(dist({ x: 0, y: 0 }, { x: 0, y: -2 })).toBe(2)
  })
  it('normalizes safely', () => {
    expect(len(normalize({ x: 10, y: -3 }))).toBeCloseTo(1)
    expect(normalize({ x: 0, y: 0 })).toEqual({ x: 0, y: 0 })
  })
  it('rotates and finds closest point on segment', () => {
    const r = rotate({ x: 1, y: 0 }, Math.PI / 2)
    expect(r.x).toBeCloseTo(0)
    expect(r.y).toBeCloseTo(1)
    const c = closestOnSegment({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 4, y: 3 })
    expect(c.point).toEqual({ x: 4, y: 0 })
    expect(c.t).toBeCloseTo(0.4)
  })
})

describe('scalar math', () => {
  it('wraps and diffs angles', () => {
    expect(wrapAngle(3 * Math.PI)).toBeCloseTo(Math.PI)
    expect(angleDiff(Math.PI - 0.1, -Math.PI + 0.1)).toBeCloseTo(0.2)
    expect(turnTowards(0, 1, 0.25)).toBeCloseTo(0.25)
    expect(clamp(5, 0, 3)).toBe(3)
  })
  it('damping is frame-rate independent', () => {
    // Two half steps equal one full step.
    const one = dampFactor(0.18, 1 / 30)
    const half = dampFactor(0.18, 1 / 60)
    expect(1 - (1 - half) * (1 - half)).toBeCloseTo(one, 10)
  })
})

describe('seeded random', () => {
  it('is deterministic for a seed and restorable from its state', () => {
    const a = new SeededRandom(42)
    const b = new SeededRandom(42)
    const seqA = Array.from({ length: 20 }, () => a.next())
    const seqB = Array.from({ length: 20 }, () => b.next())
    expect(seqA).toEqual(seqB)
    const saved = a.state
    const x = a.next()
    a.state = saved
    expect(a.next()).toBe(x)
  })
  it('produces values in range with a sane distribution', () => {
    const r = new SeededRandom(1)
    let sum = 0
    for (let i = 0; i < 10000; i++) {
      const v = r.next()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
      sum += v
    }
    expect(sum / 10000).toBeGreaterThan(0.47)
    expect(sum / 10000).toBeLessThan(0.53)
    for (let i = 0; i < 1000; i++) {
      const n = r.int(2, 5)
      expect(n).toBeGreaterThanOrEqual(2)
      expect(n).toBeLessThanOrEqual(5)
    }
  })
  it('derives different seeds per label', () => {
    expect(deriveSeed(1, 'match')).not.toBe(deriveSeed(1, 'squads'))
  })
})

describe('coordinate conversion', () => {
  it('maps sim (x, y, z) to Three (X=x, Y=z, Z=y) and back', () => {
    const t = simToThree(3, -7, 1.2, { x: 0, y: 0, z: 0 })
    expect(t).toEqual({ x: 3, y: 1.2, z: -7 })
    expect(threeToSim(t)).toEqual({ x: 3, y: -7, z: 1.2 })
  })
  it('converts facing to a yaw that points the model along the facing vector', () => {
    for (const facing of [0, 0.7, Math.PI / 2, -2]) {
      const yaw = facingToThreeYaw(facing)
      // Model forward +Z rotated by yaw -> (sin yaw, cos yaw) in (X, Z) = sim (x, y)
      expect(Math.sin(yaw)).toBeCloseTo(Math.cos(facing))
      expect(Math.cos(yaw)).toBeCloseTo(Math.sin(facing))
    }
  })
  it('team-relative coordinates mirror correctly for both attack directions', () => {
    for (const dir of [1, -1] as const) {
      const own = teamToWorld({ lateral: 0, depth: 0 }, dir, 10, 20)
      expect(own.y).toBe(-dir * 20)
      const p = teamToWorld({ lateral: 0.5, depth: 0.75 }, dir, 10, 20)
      const back = worldToTeam(p, dir, 10, 20)
      expect(back.lateral).toBeCloseTo(0.5)
      expect(back.depth).toBeCloseTo(0.75)
    }
    // Same team-relative spot for opposite teams is a 180 degree rotation.
    const a = teamToWorld({ lateral: 0.3, depth: 0.6 }, 1, 10, 20)
    const b = teamToWorld({ lateral: 0.3, depth: 0.6 }, -1, 10, 20)
    expect(b.x).toBeCloseTo(-a.x)
    expect(b.y).toBeCloseTo(-a.y)
  })
})
