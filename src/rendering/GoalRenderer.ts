import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshStandardMaterial,
} from 'three'
import { BALL, COURT, POST_X, POST_Y } from '../simulation/SimulationConfig'

/** Net mesh spacing (metres). */
const MESH = 0.12
/** Net bulge: radius of the affected area and the largest push (metres). */
const BULGE_RADIUS = 1.05
const BULGE_MAX = 0.5
/** Spring that makes the net give and swing back after an impact. */
const SPRING_K = 70
const SPRING_DAMP = 7
/** The ball counts as touching a net panel within this distance of it (beyond its radius). */
const CONTACT = 0.16

interface Bulge {
  /** Contact point on the panel (Three.js coordinates). */
  x: number
  y: number
  z: number
  /** Outward normal of the panel that was hit. */
  nx: number
  ny: number
  nz: number
  amp: number
  vel: number
}

interface NetData {
  end: 1 | -1
  geometry: BufferGeometry
  base: Float32Array
  normals: Float32Array
  bulge: Bulge | null
  dirty: boolean
}

/**
 * Goals: 8 cm square white posts and crossbar on the goal line, a support frame and white nets drawn
 * as a line mesh (always visible at any distance). The nets bulge where the ball presses into them.
 * Geometry matches the physics goal (3 x 2 m mouth, 1 m deep).
 */
export class GoalRenderer {
  readonly group = new Group()
  private readonly nets: NetData[] = []

  constructor() {
    this.group.name = 'goals'
    const frameMat = new MeshStandardMaterial({ color: 0xf6f6f6, roughness: 0.35, metalness: 0.1 })
    const backMat = new MeshStandardMaterial({ color: 0xbfc6cc, roughness: 0.5 })
    const netMat = new LineBasicMaterial({ color: 0xf2f2f2, transparent: true, opacity: 0.85 })
    const ps = COURT.postSize
    const h = COURT.goalHeight
    const d = COURT.goalDepth
    for (const end of [-1, 1] as const) {
      const g = new Group()
      const z = end * POST_Y
      for (const sx of [-1, 1]) {
        const post = new Mesh(new BoxGeometry(ps, h + ps, ps), frameMat)
        post.position.set(sx * POST_X, (h + ps) / 2, z)
        post.castShadow = true
        g.add(post)
        const side = new Mesh(new BoxGeometry(0.04, 0.04, d), backMat)
        side.position.set(sx * POST_X, 0.02, z + (end * d) / 2)
        g.add(side)
        const rear = new Mesh(new BoxGeometry(0.04, h, 0.04), backMat)
        rear.position.set(sx * POST_X, h / 2, z + end * d)
        g.add(rear)
        const top = new Mesh(new BoxGeometry(0.04, 0.04, d), backMat)
        top.position.set(sx * POST_X, h, z + (end * d) / 2)
        g.add(top)
      }
      const bar = new Mesh(new BoxGeometry(POST_X * 2 + ps, ps, ps), frameMat)
      bar.position.set(0, h + ps / 2, z)
      bar.castShadow = true
      g.add(bar)
      const backBar = new Mesh(new BoxGeometry(POST_X * 2, 0.04, 0.04), backMat)
      backBar.position.set(0, 0.02, z + end * d)
      g.add(backBar)

      const net = buildNet(end)
      this.nets.push(net)
      g.add(new LineSegments(net.geometry, netMat))
      this.group.add(g)
    }
  }

  private lastBall: { x: number; y: number; z: number } | null = null
  /** How far the ball is carried by the net it is pressing into (Three.js offset), for the renderer. */
  readonly ballOffset = { x: 0, y: 0, z: 0 }

  /**
   * Net dynamics. When the ball hits a net panel the net gives with a spring (bigger impact, bigger
   * bulge) and swings back; while the ball rests against the net it stays pushed out.
   * Ball centre in Three.js coordinates; `dt` in seconds.
   */
  update(bx: number, by: number, bz: number, dt: number): void {
    const prev = this.lastBall
    this.lastBall = { x: bx, y: by, z: bz }
    const vx = prev && dt > 0 ? (bx - prev.x) / dt : 0
    const vy = prev && dt > 0 ? (by - prev.y) / dt : 0
    const vz = prev && dt > 0 ? (bz - prev.z) / dt : 0
    const r = BALL.radius * 1.25
    const h = COURT.goalHeight
    const back = POST_Y + COURT.goalDepth
    this.ballOffset.x = 0
    this.ballOffset.y = 0
    this.ballOffset.z = 0

    for (const net of this.nets) {
      const e = net.end
      // Which panel (if any) is the ball touching? Only from inside the goal.
      let contact: {
        x: number
        y: number
        z: number
        nx: number
        ny: number
        nz: number
        gap: number
      } | null = null
      const insideDepth = e * bz > COURT.halfLength && e * bz < back + 0.3
      const insideWidth = Math.abs(bx) < POST_X + 0.3
      if (insideDepth && insideWidth && by < h + 0.3) {
        const candidates = [
          { gap: back - e * bz - r, x: bx, y: by, z: e * back, nx: 0, ny: 0, nz: e },
          { gap: h - by - r, x: bx, y: h, z: bz, nx: 0, ny: 1, nz: 0 },
          { gap: POST_X - bx - r, x: POST_X, y: by, z: bz, nx: 1, ny: 0, nz: 0 },
          { gap: POST_X + bx - r, x: -POST_X, y: by, z: bz, nx: -1, ny: 0, nz: 0 },
        ]
        for (const c of candidates) if (c.gap < CONTACT && (!contact || c.gap < contact.gap)) contact = c
      }

      if (contact) {
        const into = vx * contact.nx + vy * contact.ny + vz * contact.nz
        const b = net.bulge
        const samePanel = b && b.nx === contact.nx && b.ny === contact.ny && b.nz === contact.nz
        if (!b || !samePanel) {
          net.bulge = { ...contact, amp: 0, vel: 0 }
        } else {
          b.x = contact.x
          b.y = contact.y
          b.z = contact.z
        }
        const bulge = net.bulge!
        // Impact: kick the spring with the ball's speed into the net.
        if (into > 1) bulge.vel = Math.max(bulge.vel, Math.min(4.5, into * 0.32))
        // Resting against the net keeps it pushed out by the ball.
        bulge.amp = Math.max(bulge.amp, Math.min(BULGE_MAX, CONTACT - contact.gap))
      }

      const b = net.bulge
      if (b) {
        const acc = -SPRING_K * b.amp - SPRING_DAMP * b.vel
        b.vel += acc * dt
        b.amp = Math.max(-0.08, Math.min(BULGE_MAX, b.amp + b.vel * dt))
        if (Math.abs(b.amp) < 0.002 && Math.abs(b.vel) < 0.02 && !contact) net.bulge = null
        // The ball goes out with the net it is pressing into.
        if (contact && b.amp > 0) {
          this.ballOffset.x = b.nx * b.amp
          this.ballOffset.y = b.ny * b.amp
          this.ballOffset.z = b.nz * b.amp
        }
      }
      this.applyBulge(net)
    }
  }

  private applyBulge(net: NetData): void {
    const pos = net.geometry.getAttribute('position') as BufferAttribute
    const arr = pos.array as Float32Array
    const b = net.bulge
    if (!b) {
      if (net.dirty) {
        arr.set(net.base)
        pos.needsUpdate = true
        net.dirty = false
      }
      return
    }
    for (let i = 0; i < arr.length; i += 3) {
      const x = net.base[i]!
      const y = net.base[i + 1]!
      const z = net.base[i + 2]!
      let push = 0
      // Only nodes of the panel that was hit move, with a smooth fall-off around the contact point.
      if (net.normals[i] === b.nx && net.normals[i + 1] === b.ny && net.normals[i + 2] === b.nz) {
        const d = Math.hypot(x - b.x, y - b.y, z - b.z)
        if (d < BULGE_RADIUS) {
          const f = 1 - (d / BULGE_RADIUS) * (d / BULGE_RADIUS)
          push = b.amp * f * f
        }
      }
      arr[i] = x + b.nx * push
      arr[i + 1] = y + b.ny * push
      arr[i + 2] = z + b.nz * push
    }
    pos.needsUpdate = true
    net.dirty = true
  }
}

/** Build the line mesh for one goal: back, roof and both sides, with an outward normal per vertex. */
function buildNet(end: 1 | -1): NetData {
  const h = COURT.goalHeight
  const d = COURT.goalDepth
  const z0 = end * POST_Y
  const z1 = end * (POST_Y + d)
  const positions: number[] = []
  const normals: number[] = []
  const nx = Math.max(2, Math.round((POST_X * 2) / MESH))
  const ny = Math.max(2, Math.round(h / MESH))
  const nd = Math.max(2, Math.round(d / MESH))

  /** Add a grid of segments over a rectangular panel given by a point function p(u, v). */
  const panel = (
    nu: number,
    nv: number,
    p: (u: number, v: number) => [number, number, number],
    n: [number, number, number],
  ) => {
    const push = (u: number, v: number) => {
      positions.push(...p(u, v))
      normals.push(...n)
    }
    for (let i = 0; i <= nu; i++) {
      for (let j = 0; j < nv; j++) {
        push(i / nu, j / nv)
        push(i / nu, (j + 1) / nv)
      }
    }
    for (let j = 0; j <= nv; j++) {
      for (let i = 0; i < nu; i++) {
        push(i / nu, j / nv)
        push((i + 1) / nu, j / nv)
      }
    }
  }

  // Back net (vertical, at the goal depth).
  panel(nx, ny, (u, v) => [-POST_X + u * POST_X * 2, v * h, z1], [0, 0, end])
  // Roof.
  panel(nx, nd, (u, v) => [-POST_X + u * POST_X * 2, h, z0 + (z1 - z0) * v], [0, 1, 0])
  // Sides.
  for (const sx of [-1, 1]) panel(nd, ny, (u, v) => [sx * POST_X, v * h, z0 + (z1 - z0) * u], [sx, 0, 0])

  const geometry = new BufferGeometry()
  const base = new Float32Array(positions)
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(base), 3))
  return { end, geometry, base, normals: new Float32Array(normals), bulge: null, dirty: false }
}
