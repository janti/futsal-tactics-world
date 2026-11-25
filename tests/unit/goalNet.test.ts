import { describe, expect, it } from 'vitest'
import { GoalRenderer } from '../../src/rendering/GoalRenderer'
import { COURT, POST_Y } from '../../src/simulation/SimulationConfig'

/** Largest displacement of any net vertex from its rest position. */
function maxDisplacement(goals: GoalRenderer): number {
  let max = 0
  goals.group.traverse((o) => {
    const geo = (o as { geometry?: { getAttribute(n: string): { array: ArrayLike<number> } } }).geometry
    if (!geo || o.type !== 'LineSegments') return
    const arr = geo.getAttribute('position').array
    const net = (goals as unknown as { nets: { base: Float32Array; geometry: unknown }[] }).nets.find(
      (n) => n.geometry === geo,
    )!
    for (let i = 0; i < arr.length; i += 3) {
      const d = Math.hypot(
        arr[i]! - net.base[i]!,
        arr[i + 1]! - net.base[i + 1]!,
        arr[i + 2]! - net.base[i + 2]!,
      )
      max = Math.max(max, d)
    }
  })
  return max
}

describe('goal net bulge', () => {
  it('a hard shot visibly pushes the back net out, then it swings back to rest', () => {
    const goals = new GoalRenderer()
    const dt = 1 / 60
    const back = POST_Y + COURT.goalDepth
    // Ball flying into the +Z goal at ~18 m/s, stopping against the back net (as the physics does).
    let z = COURT.halfLength + 0.1
    let peak = 0
    for (let i = 0; i < 60; i++) {
      z = Math.min(back - 0.14, z + 18 * dt)
      goals.update(0.3, 0.8, z, dt)
      peak = Math.max(peak, maxDisplacement(goals))
    }
    expect(peak).toBeGreaterThan(0.25)
    // Ball taken away: the net settles back.
    for (let i = 0; i < 240; i++) goals.update(0, 0, 0, dt)
    expect(maxDisplacement(goals)).toBeLessThan(0.01)
  })

  it('a ball far from the goals leaves the nets untouched', () => {
    const goals = new GoalRenderer()
    for (let i = 0; i < 30; i++) goals.update(0, 0.1, 5, 1 / 60)
    expect(maxDisplacement(goals)).toBe(0)
  })
})
