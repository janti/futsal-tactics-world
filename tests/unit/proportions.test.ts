import { describe, expect, it } from 'vitest'
import { COURT, POST_X } from '../../src/simulation/SimulationConfig'
import { MODEL_DIMENSIONS, modelFootClearance, modelStandingHeight } from '../../src/rendering/PlayerModel'
import { PLAYER_SCALE_OPTIONS, PLAYER_VISUAL_SCALE } from '../../src/rendering/PlayerRenderer'

describe('court, goal and player proportions', () => {
  it('the court is 40 x 20 m and the goals are 3 x 2 m (1 m deep)', () => {
    expect(COURT.length).toBe(40)
    expect(COURT.width).toBe(20)
    expect(COURT.halfLength * 2).toBe(COURT.length)
    expect(COURT.halfWidth * 2).toBe(COURT.width)
    expect(COURT.goalWidth).toBe(3)
    expect(COURT.goalHeight).toBe(2)
    expect(COURT.goalDepth).toBe(1)
    // Inner faces of the posts are 3 m apart.
    expect((POST_X - COURT.postSize / 2) * 2).toBeCloseTo(3)
  })

  it('the player model is built at true human size (1.78 m) with the feet on the floor', () => {
    expect(modelStandingHeight()).toBeGreaterThan(1.74)
    expect(modelStandingHeight()).toBeLessThan(1.82)
    expect(modelFootClearance()).toBeCloseTo(0, 5)
    // Legs (hip height) are about half the body height, as in real people.
    expect(MODEL_DIMENSIONS.hip / modelStandingHeight()).toBeGreaterThan(0.47)
    expect(MODEL_DIMENSIONS.hip / modelStandingHeight()).toBeLessThan(0.52)
  })

  it('the default readability scale stays within the 110–115 % design range, and true size is offered', () => {
    expect(PLAYER_VISUAL_SCALE).toBeGreaterThanOrEqual(1.1)
    expect(PLAYER_VISUAL_SCALE).toBeLessThanOrEqual(1.15)
    expect(PLAYER_SCALE_OPTIONS).toContain(1)
    // Even at the default scale an average player is not taller than the goal plus a margin.
    expect(modelStandingHeight() * PLAYER_VISUAL_SCALE).toBeLessThan(COURT.goalHeight + 0.05)
  })
})

describe('run cycle', () => {
  it('the gait curves are smooth and loop seamlessly (no jerks)', async () => {
    const { sampleGait, RUN_KEYS, WALK_KEYS } = await import('../../src/rendering/PlayerModel')
    for (const keys of [RUN_KEYS, WALK_KEYS]) {
      const n = 400
      let prev = sampleGait(keys, 0)
      let maxStep = 0
      for (let i = 1; i <= n; i++) {
        const cur = sampleGait(keys, i / n)
        for (let j = 0; j < 3; j++) maxStep = Math.max(maxStep, Math.abs(cur[j]! - prev[j]!))
        prev = cur
      }
      // 1/400 of a stride never changes a joint by more than ~3 degrees.
      expect(maxStep).toBeLessThan(0.05)
      const a = sampleGait(keys, 0)
      const b = sampleGait(keys, 0.99999)
      for (let j = 0; j < 3; j++) expect(Math.abs(a[j]! - b[j]!)).toBeLessThan(0.01)
    }
  })

  it('the foot never trails far behind the hip seen from above (no long gliding legs)', async () => {
    const { sampleGait, RUN_KEYS, MODEL_DIMENSIONS } = await import('../../src/rendering/PlayerModel')
    let back = 0
    let front = 0
    let maxKnee = 0
    for (let i = 0; i < 200; i++) {
      const [thigh, knee] = sampleGait(RUN_KEYS, i / 200)
      // Horizontal foot position relative to the hip (forward positive) as seen from the camera above.
      const x = -MODEL_DIMENSIONS.thigh * Math.sin(thigh) - MODEL_DIMENSIONS.shin * Math.sin(thigh + knee)
      back = Math.min(back, x)
      front = Math.max(front, x)
      maxKnee = Math.max(maxKnee, knee)
    }
    expect(back).toBeGreaterThan(-0.42)
    expect(front).toBeGreaterThan(0.08)
    // The knee still bends clearly (running, not walking stiff-legged).
    expect(maxKnee).toBeGreaterThan(1.0)
  })
})
