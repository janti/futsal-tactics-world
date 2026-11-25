/**
 * Original procedural semi-realistic low-poly futsal player.
 * Natural proportions (built for 1.78 m, scaled by height), slightly angular tapered geometry,
 * articulated hierarchy: root > pelvis > torso > neck > head, shoulders > upper arm > forearm > hand,
 * hips > thigh > shin > foot. Geometry is shared between all players; materials are shared per kit.
 * Roughly 1,600 triangles per player.
 */
import {
  BufferGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  LatheGeometry,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  SphereGeometry,
  Vector2,
  type Material,
  BoxGeometry,
} from 'three'
import { clamp, lerp } from '../core/math/scalar'
import { BALL, HANDS } from '../simulation/SimulationConfig'
import { BALL_VISUAL_SCALE } from './BallRenderer'
import { createNumberTexture } from './textures'

export interface KitMaterials {
  shirt: MeshStandardMaterial
  shorts: MeshStandardMaterial
  socks: MeshStandardMaterial
  shoes: MeshStandardMaterial
}

export interface Appearance {
  heightCm: number
  build: number // 0.9 slim .. 1.1 broad
  skin: MeshStandardMaterial
  hair: MeshStandardMaterial
  hairStyle: number
  kit: KitMaterials
  number: number
  numberColor: string
  goalkeeper: boolean
}

/**
 * Model proportions (metres) for a 1.78 m player at scale 1. Shared with tests so the model's real
 * size can be checked against the court and goals.
 */
export const MODEL_DIMENSIONS = {
  hip: 0.88,
  thigh: 0.42,
  shin: 0.39,
  footHeight: 0.07,
  torsoOffset: 0.04,
  neck: 0.6,
  headCentre: 0.16,
  headTop: 0.105 * 1.08,
} as const

/** Standing height of the model at scale 1 (floor to top of the head). */
export function modelStandingHeight(): number {
  const d = MODEL_DIMENSIONS
  return d.hip + d.torsoOffset + d.neck + d.headCentre + d.headTop
}

/** Height of the sole of the foot above the floor when standing (should be 0). */
export function modelFootClearance(): number {
  const d = MODEL_DIMENSIONS
  return d.hip - d.thigh - d.shin - d.footHeight
}

/**
 * Gait key poses for one leg over a stride (phase 0..1, 0 = foot contact): thigh pitch (negative =
 * forward), knee bend (positive = heel back) and foot pitch (positive = toes down). Interpolated with a
 * cyclic Catmull-Rom spline so the motion is smooth. Running adds a real flight phase: push-off, the
 * heel folding up behind and a knee drive forward, instead of a stiff leg sliding back and forth.
 */
export type Key = [phase: number, thigh: number, knee: number, foot: number]
export const WALK_KEYS: Key[] = [
  [0.0, -0.32, 0.05, -0.1],
  [0.25, 0.0, 0.15, 0.0],
  [0.5, 0.3, 0.2, 0.35],
  [0.65, 0.1, 0.7, 0.15],
  [0.85, -0.28, 0.35, -0.1],
]
export const RUN_KEYS: Key[] = [
  [0.0, -0.3, 0.3, -0.1],
  [0.15, -0.08, 0.32, 0.0],
  [0.3, 0.24, 0.36, 0.35],
  [0.47, 0.02, 1.12, 0.25],
  [0.68, -0.58, 1.08, -0.05],
  [0.86, -0.45, 0.55, -0.18],
]

function catmull(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t
  const t3 = t2 * t
  return (
    0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
  )
}

/** Sample a cyclic key table at `phase` (0..1). Returns [thigh, knee, foot]. */
export function sampleGait(keys: Key[], phase: number): [number, number, number] {
  const n = keys.length
  const ph = ((phase % 1) + 1) % 1
  let i = n - 1
  for (let k = 0; k < n; k++) if (keys[k]![0] <= ph) i = k
  const k1 = keys[i]!
  const k2 = keys[(i + 1) % n]!
  const k0 = keys[(i - 1 + n) % n]!
  const k3 = keys[(i + 2) % n]!
  const start = k1[0]
  const span = (k2[0] - start + 1) % 1 || 1
  const t = (((ph - start + 1) % 1) / span) as number
  return [
    catmull(k0[1], k1[1], k2[1], k3[1], t),
    catmull(k0[2], k1[2], k2[2], k3[2], t),
    catmull(k0[3], k1[3], k2[3], k3[3], t),
  ]
}

/** Shared geometries (created once). */
let G: ReturnType<typeof buildGeometries> | null = null

function taper(rTop: number, rBottom: number, length: number, radial = 8): BufferGeometry {
  const g = new CylinderGeometry(rTop, rBottom, length, radial, 1)
  g.translate(0, -length / 2, 0) // pivot at the top joint
  return g
}

function buildGeometries() {
  const torsoProfile = [
    [0.0, 0.0],
    [0.15, 0.0],
    [0.142, 0.1],
    [0.155, 0.22],
    [0.185, 0.36],
    [0.19, 0.45],
    [0.165, 0.53],
    [0.07, 0.58],
  ].map(([r, y]) => new Vector2(r, y))
  const torso = new LatheGeometry(torsoProfile, 12)
  torso.scale(1, 1.08, 0.62)
  const hipsProfile = [
    [0.0, -0.12],
    [0.12, -0.13],
    [0.162, -0.06],
    [0.158, 0.04],
    [0.0, 0.05],
  ].map(([r, y]) => new Vector2(r, y))
  const hips = new LatheGeometry(hipsProfile, 12)
  hips.scale(1, 1, 0.68)

  const head = new SphereGeometry(0.105, 12, 9)
  head.scale(0.88, 1.08, 1.0)
  const hairShort = new SphereGeometry(0.112, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.42)
  hairShort.scale(0.9, 1.06, 1.02)
  const hairLong = new SphereGeometry(0.115, 12, 7, 0, Math.PI * 2, 0, Math.PI * 0.58)
  hairLong.scale(0.92, 1.08, 1.04)
  hairLong.translate(0, 0, -0.008)
  const nose = new ConeGeometry(0.017, 0.04, 4)
  nose.rotateX(Math.PI / 2)
  const neck = taper(0.048, 0.055, 0.1)
  const upperArm = taper(0.05, 0.041, 0.29)
  const sleeve = taper(0.064, 0.058, 0.14)
  const forearm = taper(0.04, 0.031, 0.25)
  const hand = new SphereGeometry(0.043, 6, 5)
  hand.scale(0.8, 1.15, 0.6)
  const glove = new SphereGeometry(0.058, 6, 5)
  glove.scale(0.8, 1.2, 0.6)
  const thigh = taper(0.088, 0.058, MODEL_DIMENSIONS.thigh)
  const shortsLeg = taper(0.104, 0.096, 0.2)
  const shin = taper(0.056, 0.038, MODEL_DIMENSIONS.shin)
  const foot = new BoxGeometry(0.095, 0.07, 0.26, 1, 1, 2)
  foot.translate(0, -0.035, 0.055)
  // Slightly tapered toe
  const pos = foot.attributes.position!
  for (let i = 0; i < pos.count; i++) {
    const z = pos.getZ(i)
    if (z > 0.1) {
      pos.setX(i, pos.getX(i) * 0.75)
      pos.setY(i, pos.getY(i) * 0.85 - 0.004)
    }
  }
  foot.computeVertexNormals()
  const numberPlane = new PlaneGeometry(0.17, 0.17)
  numberPlane.rotateY(Math.PI)
  return {
    torso,
    hips,
    head,
    hairShort,
    hairLong,
    nose,
    neck,
    upperArm,
    sleeve,
    forearm,
    hand,
    glove,
    thigh,
    shortsLeg,
    shin,
    foot,
    numberPlane,
  }
}

export interface Limb {
  upper: Group
  lower: Group
  end: Group
}

export class PlayerModel {
  readonly root = new Group()
  readonly pelvis = new Group()
  readonly torso = new Group()
  readonly head = new Group()
  readonly armL: Limb
  readonly armR: Limb
  readonly legL: Limb
  readonly legR: Limb
  private readonly numberMaterial: Material
  /** Animation state */
  stridePhase = 0
  private runBlend = 0
  private lean = 0
  private torsoTwist = 0
  private smoothSpeed = 0
  readonly goalkeeper: boolean
  private readonly baseScale: { x: number; y: number; z: number }

  constructor(a: Appearance) {
    G ??= buildGeometries()
    const g = G
    this.goalkeeper = a.goalkeeper
    const scale = a.heightCm / 178
    this.baseScale = { x: scale * a.build, y: scale, z: scale * a.build }
    this.root.scale.set(this.baseScale.x, this.baseScale.y, this.baseScale.z)

    const mesh = (geo: BufferGeometry, mat: Material) => {
      const m = new Mesh(geo, mat)
      m.castShadow = true
      return m
    }

    // Pelvis at hip height
    this.pelvis.position.y = MODEL_DIMENSIONS.hip
    this.root.add(this.pelvis)
    this.pelvis.add(mesh(g.hips, a.kit.shorts))

    // Torso
    this.torso.position.y = 0.04
    this.pelvis.add(this.torso)
    this.torso.add(mesh(g.torso, a.kit.shirt))
    const numTex = createNumberTexture(a.number, a.numberColor)
    this.numberMaterial = new MeshStandardMaterial({
      map: numTex,
      transparent: true,
      roughness: 0.7,
      depthWrite: false,
    })
    const num = new Mesh(g.numberPlane, this.numberMaterial)
    num.position.set(0, 0.36, -0.118)
    this.torso.add(num)

    // Neck + head
    const neck = new Group()
    neck.position.y = MODEL_DIMENSIONS.neck
    this.torso.add(neck)
    neck.add(mesh(g.neck, a.skin))
    this.head.position.y = MODEL_DIMENSIONS.headCentre
    neck.add(this.head)
    this.head.add(mesh(g.head, a.skin))
    const noseM = mesh(g.nose, a.skin)
    noseM.position.set(0, -0.005, 0.1)
    this.head.add(noseM)
    if (a.hairStyle !== 3) {
      const hair = mesh(a.hairStyle === 1 ? g.hairLong : g.hairShort, a.hair)
      hair.position.y = a.hairStyle === 2 ? 0.0 : 0.012
      if (a.hairStyle === 2) hair.scale.setScalar(0.97)
      this.head.add(hair)
    }

    // Arms
    const makeArm = (side: 1 | -1): Limb => {
      const upper = new Group()
      upper.position.set(side * 0.2, 0.53, 0)
      this.torso.add(upper)
      upper.add(mesh(g.upperArm, a.goalkeeper ? a.kit.shirt : a.skin))
      upper.add(mesh(g.sleeve, a.kit.shirt))
      const lower = new Group()
      lower.position.y = -0.29
      upper.add(lower)
      lower.add(mesh(g.forearm, a.goalkeeper ? a.kit.shirt : a.skin))
      const end = new Group()
      end.position.y = -0.27
      lower.add(end)
      end.add(mesh(a.goalkeeper ? g.glove : g.hand, a.goalkeeper ? a.kit.shoes : a.skin))
      upper.rotation.z = side * 0.12
      return { upper, lower, end }
    }
    this.armL = makeArm(1)
    this.armR = makeArm(-1)

    // Legs
    const makeLeg = (side: 1 | -1): Limb => {
      const upper = new Group()
      upper.position.set(side * 0.095, -0.04, 0)
      this.pelvis.add(upper)
      upper.add(mesh(g.thigh, a.skin))
      upper.add(mesh(g.shortsLeg, a.kit.shorts))
      const lower = new Group()
      lower.position.y = -MODEL_DIMENSIONS.thigh
      upper.add(lower)
      lower.add(mesh(g.shin, a.kit.socks))
      const end = new Group()
      end.position.y = -MODEL_DIMENSIONS.shin
      lower.add(end)
      end.add(mesh(g.foot, a.kit.shoes))
      return { upper, lower, end }
    }
    this.legL = makeLeg(1)
    this.legR = makeLeg(-1)
  }

  /**
   * Procedural animation. `speed` is the actual ground speed so stride frequency matches movement
   * (reduces foot sliding). Actions override parts of the pose with short, responsive blends.
   */
  animate(dt: number, p: AnimationInput): void {
    // Smoothed speed: the rendered speed is noisy frame to frame; filtering it keeps the gait fluid.
    this.smoothSpeed = lerp(this.smoothSpeed, p.speed, 1 - Math.exp(-dt * 12))
    const speed = this.smoothSpeed
    const cycle = 1.15 + 0.22 * speed // metres per full stride cycle
    this.stridePhase = (this.stridePhase + (speed / cycle) * Math.PI * 2 * dt) % (Math.PI * 2)
    const targetRun = clamp(speed / 7, 0, 1)
    this.runBlend = lerp(this.runBlend, targetRun, 1 - Math.exp(-dt * 10))
    const moving = clamp(speed / 0.6, 0, 1)
    const rb = this.runBlend
    const ph = this.stridePhase

    // Locomotion: keyframed gait (walk -> run blend), smooth spline interpolation.
    const phase = ph / (Math.PI * 2)
    const idleKnee = this.goalkeeper ? 0.55 : 0.12
    const legPose = (legPhase: number): [number, number, number] => {
      const w = sampleGait(WALK_KEYS, legPhase)
      const r = sampleGait(RUN_KEYS, legPhase)
      const thigh = lerp(w[0], r[0], rb)
      const knee = lerp(w[1], r[1], rb)
      const foot = lerp(w[2], r[2], rb)
      // Blend towards the standing pose at low speed.
      return [lerp(-idleKnee * 0.6, thigh, moving), lerp(idleKnee, knee, moving), lerp(0, foot, moving)]
    }
    const [tl, kl, fl] = legPose(phase)
    const [tr, kr, fr] = legPose(phase + 0.5)
    this.legL.upper.rotation.set(tl, 0, 0)
    this.legL.lower.rotation.set(kl, 0, 0)
    this.legL.end.rotation.set(fl, 0, 0)
    this.legR.upper.rotation.set(tr, 0, 0)
    this.legR.lower.rotation.set(kr, 0, 0)
    this.legR.end.rotation.set(fr, 0, 0)

    // Arms swing with the opposite leg, elbows bent (more when running), no wide "pole" swings.
    const armScale = (0.55 + 0.35 * rb) * moving
    const armL = tr * armScale
    const armR = tl * armScale
    this.armL.upper.rotation.x = armL
    this.armR.upper.rotation.x = armR
    const elbowBase = -(0.35 + 1.0 * rb) * moving - (this.goalkeeper ? 0.9 : 0.15) * (1 - moving)
    this.armL.lower.rotation.x = elbowBase - 0.35 * Math.max(0, -armL)
    this.armR.lower.rotation.x = elbowBase - 0.35 * Math.max(0, -armR)
    const armOut = this.goalkeeper ? 0.55 * (1 - moving) + 0.15 : 0.1
    this.armL.upper.rotation.z = armOut
    this.armR.upper.rotation.z = -armOut

    const targetLean =
      (0.05 + 0.16 * rb * (p.sprint ? 1.2 : 1)) * moving + (this.goalkeeper ? 0.28 : 0.02) * (1 - moving)
    this.lean = lerp(this.lean, targetLean, 1 - Math.exp(-dt * 8))
    this.torso.rotation.x = this.lean
    // Hips and shoulders counter-rotate a little with each stride.
    const twist = Math.sin(ph) * (0.05 + 0.1 * rb) * moving
    this.pelvis.rotation.y = -twist
    this.torsoTwist = twist * 1.8
    this.torso.rotation.y = this.torsoTwist
    // Vertical bounce: lowest in mid-stance, highest in flight (twice per stride).
    const bounce = 0.5 + 0.5 * Math.cos(4 * Math.PI * (phase - 0.15))
    this.pelvis.position.y =
      MODEL_DIMENSIONS.hip -
      (0.012 + 0.035 * rb) * bounce * moving -
      0.02 * rb * moving -
      (1 - moving) * (this.goalkeeper ? 0.1 : 0.015)
    this.head.rotation.x = -this.lean * 0.6

    // Ball skills
    if (p.sole) {
      this.legR.upper.rotation.x = -0.45
      this.legR.lower.rotation.x = 0.35
      this.legR.end.rotation.x = -0.35
      this.legL.lower.rotation.x = Math.max(this.legL.lower.rotation.x, 0.25)
    }

    // Actions
    const t = p.actionTime
    switch (p.action) {
      case 'pass':
      case 'shot': {
        const power = p.action === 'shot' ? 1 : 0.6
        const dur = 0.35
        const k = clamp(t / dur, 0, 1)
        // Wind-up (0..0.25), strike (0.25..0.55), follow-through.
        const leg = p.leftFooted ? this.legL : this.legR
        const other = p.leftFooted ? this.legR : this.legL
        let thigh: number
        let knee: number
        if (k < 0.25) {
          const u = k / 0.25
          thigh = lerp(0, 0.7 * power, u)
          knee = lerp(0.2, 1.4, u)
        } else if (k < 0.55) {
          const u = (k - 0.25) / 0.3
          thigh = lerp(0.7 * power, -1.0 * power, u)
          knee = lerp(1.4, 0.05, u)
        } else {
          const u = (k - 0.55) / 0.45
          thigh = lerp(-1.0 * power, 0, u)
          knee = lerp(0.05, 0.2, u)
        }
        leg.upper.rotation.x = thigh
        leg.lower.rotation.x = knee
        other.lower.rotation.x = 0.3
        other.upper.rotation.x = 0.1
        this.torso.rotation.x = 0.12 + 0.12 * power * Math.sin(k * Math.PI)
        this.armL.upper.rotation.z = 0.5
        this.armR.upper.rotation.z = -0.5
        break
      }
      case 'throw': {
        // Goalkeeper throw: the throwing arm swings from behind the body over/through to the front.
        const k = clamp(t / 0.35, 0, 1)
        const arm = p.leftFooted ? this.armL : this.armR
        const other = p.leftFooted ? this.armR : this.armL
        const side = p.leftFooted ? 1 : -1
        arm.upper.rotation.x =
          k < 0.35 ? lerp(-0.6, 1.1, k / 0.35) : lerp(1.1, -2.1, Math.min(1, (k - 0.35) / 0.45))
        arm.upper.rotation.z = side * 0.25
        arm.lower.rotation.x = -0.35
        other.upper.rotation.x = -1.0
        other.lower.rotation.x = -0.4
        this.torso.rotation.y = side * 0.35 * Math.sin(k * Math.PI)
        this.torso.rotation.x = 0.1 + 0.15 * Math.sin(k * Math.PI)
        break
      }
      case 'tackle': {
        const k = clamp(t / 0.3, 0, 1)
        const w = Math.sin(k * Math.PI)
        this.legR.upper.rotation.x = -1.1 * w
        this.legR.lower.rotation.x = 0.1
        this.legL.lower.rotation.x = 0.9 * w
        this.pelvis.position.y -= 0.15 * w
        this.torso.rotation.x = 0.35 * w
        break
      }
      case 'save': {
        const k = clamp(t / 0.6, 0, 1)
        const w = Math.sin(Math.min(1, k * 1.5) * Math.PI * 0.5) * (1 - Math.max(0, k - 0.7) / 0.3)
        this.armL.upper.rotation.x = -2.6 * w
        this.armR.upper.rotation.x = -2.6 * w
        this.armL.upper.rotation.z = 0.4
        this.armR.upper.rotation.z = -0.4
        this.armL.lower.rotation.x = -0.2
        this.armR.lower.rotation.x = -0.2
        this.torso.rotation.z = p.saveSide * 0.6 * w
        this.pelvis.position.y += 0.1 * w
        break
      }
      default:
        this.torso.rotation.z = 0
    }
    if (p.action !== 'save') this.torso.rotation.z = 0
    if (p.action !== 'throw') this.torso.rotation.y = this.torsoTwist
    if (p.holding && p.action !== 'pass' && p.action !== 'shot' && p.action !== 'throw') {
      // Ball held in both hands: the hands are placed on either side of the ball (simple two-bone IK).
      this.torso.rotation.x = 0
      const sx = this.root.scale.x
      const sy = this.root.scale.y
      const sz = this.root.scale.z
      const ballR = BALL.radius * BALL_VISUAL_SCALE
      // Ball centre in root space (the simulation carries it at HANDS.forward / HANDS.height + radius).
      const by = (HANDS.height + ballR) / sy
      const bz = HANDS.forward / sz
      const torsoY = this.pelvis.position.y + this.torso.position.y
      const hx = (ballR + 0.035) / sx
      this.reachArm(this.armL, 1, hx, by - torsoY, bz)
      this.reachArm(this.armR, -1, -hx, by - torsoY, bz)
    }
  }

  /**
   * Point an arm so its hand reaches a target given in torso space. Two-bone IK in the arm's pitch
   * plane: the elbow bends downwards/outwards, as when holding a ball.
   */
  private reachArm(limb: Limb, side: 1 | -1, tx: number, ty: number, tz: number): void {
    const a = 0.29 // upper arm
    const b = 0.27 // forearm to the centre of the hand
    const dx = tx - side * 0.2
    const dy = ty - 0.53
    const dz = tz
    const L = clamp(Math.hypot(dx, dy, dz), 0.08, a + b - 0.001)
    const ux = dx / L
    const uy = dy / L
    const uz = dz / L
    const elbow = Math.PI - Math.acos(clamp((a * a + b * b - L * L) / (2 * a * b), -1, 1))
    const alpha = Math.acos(clamp((a * a + L * L - b * b) / (2 * a * L), -1, 1))
    const roll = Math.asin(clamp(ux, -1, 1))
    const pitch = Math.atan2(-uz, -uy)
    limb.upper.rotation.set(pitch + alpha, 0, roll)
    limb.lower.rotation.set(-elbow, 0, 0)
    limb.end.rotation.set(0, 0, 0)
  }

  /** Visual size multiplier on top of the player's real height (1 = true size). */
  setVisualScale(k: number): void {
    this.root.scale.set(this.baseScale.x * k, this.baseScale.y * k, this.baseScale.z * k)
  }

  dispose(): void {
    this.numberMaterial.dispose()
    const m = this.numberMaterial as MeshStandardMaterial
    m.map?.dispose()
  }
}

export interface AnimationInput {
  speed: number
  sprint: boolean
  sole: boolean
  action: string
  actionTime: number
  leftFooted: boolean
  saveSide: number
  /** Goalkeeper holding the ball in the hands. */
  holding: boolean
}
