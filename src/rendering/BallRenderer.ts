import {
  CircleGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Quaternion,
  SphereGeometry,
  Vector3,
  type Texture,
} from 'three'
import { lerp } from '../core/math/scalar'
import type { MatchSnapshot } from '../simulation/MatchSnapshot'
import { BALL } from '../simulation/SimulationConfig'
import { createBallTexture } from './textures'

/** Visual ball scale (readability). The physical radius is unchanged. */
export const BALL_VISUAL_SCALE = 1.25

export class BallRenderer {
  readonly group = new Group()
  private readonly ball: Mesh
  private readonly shadow: Mesh
  private readonly last = new Vector3()
  private readonly q = new Quaternion()
  private readonly axis = new Vector3()
  private readonly up = new Vector3(0, 1, 0)
  private readonly delta = new Vector3()
  private readonly radius = BALL.radius * BALL_VISUAL_SCALE
  private initialised = false

  constructor(blob: Texture) {
    const tex = createBallTexture()
    this.ball = new Mesh(
      new SphereGeometry(this.radius, 20, 14),
      new MeshStandardMaterial({ map: tex, roughness: 0.45 }),
    )
    this.ball.castShadow = true
    this.group.add(this.ball)
    const sg = new CircleGeometry(this.radius * 1.6, 16)
    sg.rotateX(-Math.PI / 2)
    this.shadow = new Mesh(sg, new MeshBasicMaterial({ map: blob, transparent: true, depthWrite: false }))
    this.group.add(this.shadow)
  }

  /** Visual-only displacement (e.g. carried by a bulging net); reset by the next update. */
  offset(o: { x: number; y: number; z: number }): void {
    this.ball.position.x += o.x
    this.ball.position.y += o.y
    this.ball.position.z += o.z
  }

  /** Rendered ball centre (Three.js coordinates). */
  get center(): Vector3 {
    return this.ball.position
  }

  update(prev: MatchSnapshot, curr: MatchSnapshot, alpha: number): void {
    const x = lerp(prev.ball.x, curr.ball.x, alpha)
    const y = lerp(prev.ball.y, curr.ball.y, alpha)
    const z = lerp(prev.ball.z, curr.ball.z, alpha)
    // Three.js: X = sim x, Y = height (ball centre), Z = sim y.
    this.ball.position.set(x, z + this.radius, y)
    if (!this.initialised) {
      this.last.copy(this.ball.position)
      this.initialised = true
    }
    // Roll: rotate about the horizontal axis perpendicular to travel by distance / radius.
    this.delta.subVectors(this.ball.position, this.last)
    this.delta.y = 0
    const d = this.delta.length()
    if (d > 1e-5 && d < 3) {
      this.axis.crossVectors(this.up, this.delta).normalize()
      this.q.setFromAxisAngle(this.axis, d / this.radius)
      this.ball.quaternion.premultiply(this.q)
    }
    this.last.copy(this.ball.position)
    // Height readability: shadow shrinks and fades as the ball rises.
    const h = Math.max(0, z)
    const s = 1 / (1 + h * 0.6)
    this.shadow.position.set(x, 0.005, y)
    this.shadow.scale.setScalar(s)
    ;(this.shadow.material as MeshBasicMaterial).opacity = 0.35 + 0.65 * s
  }
}
