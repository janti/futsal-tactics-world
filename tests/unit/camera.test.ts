import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { CameraController } from '../../src/camera/CameraController'
import { CAMERA_END_MARGIN, clampTargetY, computeFrustum } from '../../src/camera/CameraFraming'
import { basisForOrientation, basisFromCamera, screenToSimDirection } from '../../src/camera/ScreenToWorld'
import { COURT } from '../../src/simulation/SimulationConfig'

const focus = (ballY: number) => ({
  ballX: 0,
  ballY,
  ballVx: 0,
  ballVy: 0,
  controlledY: ballY,
  possessionDir: 0,
})

describe('camera framing', () => {
  it('keeps the full court width plus margins visible for every aspect ratio', () => {
    for (const aspect of [21 / 9, 16 / 9, 16 / 10, 4 / 3, 1, 9 / 16, 9 / 19.5]) {
      const f = computeFrustum(aspect, 27, 78, 1.6)
      expect(f.width).toBeGreaterThanOrEqual(COURT.width + 3.2 - 1e-9)
      expect(f.width / f.height).toBeCloseTo(aspect)
    }
  })
  it('shows about 27 m of court length on widescreen, and more on portrait', () => {
    expect(computeFrustum(16 / 9, 27, 78, 1.6).visibleLength).toBeCloseTo(27)
    expect(computeFrustum(9 / 16, 27, 78, 1.6).visibleLength).toBeGreaterThan(27)
  })
  it('clamps the target near the goal lines', () => {
    expect(clampTargetY(30, 27)).toBeCloseTo(COURT.halfLength + CAMERA_END_MARGIN - 13.5)
    expect(clampTargetY(5, 60)).toBe(0)
  })
})

describe('camera controller', () => {
  it('uses a 78 degree orthographic view by default', () => {
    const c = new CameraController('verticalSmart')
    c.setAspect(16 / 9)
    c.snap(focus(0))
    const dir = new Vector3()
    c.camera.getWorldDirection(dir)
    const elevation = (Math.asin(-dir.y) * 180) / Math.PI
    expect(elevation).toBeCloseTo(78, 4)
    expect(c.camera.isOrthographicCamera).toBe(true)
  })

  it('basis derived from the real camera matches the analytic orientation basis (both ends)', () => {
    for (const up of [1, -1] as const) {
      const c = new CameraController('verticalSmart')
      c.upSign = up
      c.snap(focus(0))
      const fromCam = basisFromCamera(c.camera)
      const analytic = basisForOrientation(up)
      expect(fromCam.right.x).toBeCloseTo(analytic.right.x)
      expect(fromCam.right.y).toBeCloseTo(analytic.right.y)
      expect(fromCam.up.x).toBeCloseTo(analytic.up.x)
      expect(fromCam.up.y).toBeCloseTo(analytic.up.y)
    }
  })

  it('pressing "up" moves the human team towards the goal it attacks (top of the screen)', () => {
    const c = new CameraController('verticalSmart')
    c.upSign = 1
    c.snap(focus(0))
    const d = screenToSimDirection({ x: 0, y: 1 }, c.getBasis())
    expect(d.y).toBeCloseTo(1)
    // Screen right is a world direction that projects to the right side of the screen.
    const right = screenToSimDirection({ x: 1, y: 0 }, c.getBasis())
    const p = new Vector3(right.x * 5, 0, right.y * 5).project(c.camera)
    expect(p.x).toBeGreaterThan(0)
  })

  it('smoothly follows the ball and stays within bounds; camera moves never touch simulation', () => {
    const c = new CameraController('verticalSmart')
    c.setAspect(16 / 9)
    c.snap(focus(0))
    for (let i = 0; i < 300; i++) c.update(focus(15), 1 / 60)
    const r = c.visibleRange()
    expect(r.maxY).toBeLessThanOrEqual(COURT.halfLength + CAMERA_END_MARGIN + 1e-6)
    expect(r.minY).toBeLessThan(15)
    expect(r.maxY).toBeGreaterThan(15)
  })

  it('is frame-rate independent (30 vs 120 fps converge to the same place)', () => {
    const a = new CameraController('verticalSmart')
    const b = new CameraController('verticalSmart')
    a.snap(focus(0))
    b.snap(focus(0))
    for (let i = 0; i < 30; i++) a.update(focus(8), 1 / 30)
    for (let i = 0; i < 120; i++) b.update(focus(8), 1 / 120)
    expect(a.visibleRange().minY).toBeCloseTo(b.visibleRange().minY, 3)
  })
})
