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

describe('fast balls', () => {
  it('a quick ball up the court never leaves the frame, even behind a deep controlled player', () => {
    for (const preset of [
      'verticalSmart',
      'verticalCloseAction',
      'verticalClassic',
      'horizontalTactical',
    ] as const) {
      const c = new CameraController(preset)
      c.setAspect(16 / 9)
      c.snap({ ...focus(-12), controlledY: -14 })
      let y = -12
      const dt = 1 / 60
      for (let i = 0; i < 70; i++) {
        y += 24 * dt // a firm 24 m/s ball up the court, lofted
        const z = Math.max(0, 2.5 * Math.sin((i / 70) * Math.PI))
        c.update(
          { ballX: 0, ballY: y, ballVx: 0, ballVy: 24, ballZ: z, controlledY: -14, possessionDir: 0.4 },
          dt,
        )
        const r = c.visibleRange()
        expect(y).toBeLessThan(r.maxY - 1.4)
        expect(y).toBeGreaterThan(r.minY + 1.4)
      }
    }
  })
})

describe('horizontal cameras', () => {
  it('the side view shows the length across the screen and always fits the court width (foreshortened)', () => {
    for (const aspect of [21 / 9, 16 / 9, 4 / 3, 1]) {
      const f = computeFrustum(aspect, 30, 62, 1.4, 'horizontal')
      const s = Math.sin((62 * Math.PI) / 180)
      expect(f.height).toBeGreaterThanOrEqual((COURT.width + 2.8) * s - 1e-9)
      expect(f.width / f.height).toBeCloseTo(aspect)
      expect(f.visibleLength).toBeCloseTo(f.width)
      expect(f.visibleLength).toBeGreaterThanOrEqual(30 - 1e-9)
    }
  })

  it('your team attacks to the right: screen right is your attacking direction, screen up the far touch line', () => {
    for (const up of [1, -1] as const) {
      const cam = new CameraController('horizontalTactical')
      cam.upSign = up
      cam.snap(focus(0))
      const b = cam.getBasis()
      expect(b.right.x).toBeCloseTo(0, 5)
      expect(b.right.y).toBeCloseTo(up, 5)
      expect(b.up.x).toBeCloseTo(up, 5)
      // Input "right" moves the player towards the opponents' goal.
      const d = screenToSimDirection({ x: 1, y: 0 }, b)
      expect(d.y * up).toBeGreaterThan(0.99)
    }
  })

  it('tracks the ball along the length and the full-court side view stays fixed', () => {
    const cam = new CameraController('horizontalTactical')
    cam.snap(focus(10))
    expect(cam.camera.position.z).toBeGreaterThan(5)
    const fixed = new CameraController('horizontalFullCourt')
    fixed.snap(focus(10))
    expect(fixed.camera.position.z).toBeCloseTo(0, 5)
  })
})

describe('custom camera (Camera Lab)', () => {
  it('stored values are validated and clamped to the lab ranges', async () => {
    const { sanitizeCustomCamera, CAMERA_LAB_RANGES, CAMERA_PRESETS } =
      await import('../../src/camera/CameraSettings')
    const c = sanitizeCustomCamera({
      elevationDeg: 200,
      visibleLength: 'x',
      orientation: 'horizontal',
      fixed: true,
    })
    expect(c.elevationDeg).toBe(CAMERA_LAB_RANGES.elevationDeg[1])
    expect(c.visibleLength).toBe(CAMERA_PRESETS.custom.visibleLength)
    expect(c.orientation).toBe('horizontal')
    expect(c.fixed).toBe(true)
    expect(sanitizeCustomCamera(null)).toEqual(CAMERA_PRESETS.custom)
  })

  it('explicit settings drive the camera (orientation and length)', async () => {
    const { CAMERA_PRESETS } = await import('../../src/camera/CameraSettings')
    const cam = new CameraController('verticalSmart')
    cam.setSettings({ ...CAMERA_PRESETS.custom, orientation: 'horizontal', visibleLength: 40 })
    cam.snap(focus(0))
    expect(cam.getBasis().right.y).toBeCloseTo(1, 5)
    expect(cam.visibleRange().maxY - cam.visibleRange().minY).toBeGreaterThanOrEqual(40 - 1e-6)
  })
})
