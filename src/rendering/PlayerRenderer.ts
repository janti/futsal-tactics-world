import {
  CircleGeometry,
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  RingGeometry,
  ShapeGeometry,
  Shape,
  type Texture,
} from 'three'
import { facingToThreeYaw } from '../core/coords'
import { lerp, lerpAngle } from '../core/math/scalar'
import type { MatchSnapshot } from '../simulation/MatchSnapshot'
import type { MatchState } from '../simulation/MatchState'
import { PlayerModel, type KitMaterials } from './PlayerModel'

/** Default visual scale (readability): visual size is independent of the physical collision radius. */
export const PLAYER_VISUAL_SCALE = 1.12

/** Player size options offered in the settings (1 = true size). */
export const PLAYER_SCALE_OPTIONS = [1, 1.06, 1.12] as const

const GK_KITS = [
  { shirt: 0xe9bb48, shorts: 0x1a1a1a, socks: 0xe9bb48 },
  { shirt: 0x2fbf71, shorts: 0x1a1a1a, socks: 0x2fbf71 },
]

function hex(n: number): string {
  return `#${n.toString(16).padStart(6, '0')}`
}

export class PlayerRenderer {
  readonly group = new Group()
  private readonly models: PlayerModel[] = []
  private readonly shadows: Mesh[] = []
  private readonly selection: Group
  private readonly materials: MeshStandardMaterial[] = []
  private lastX: number[] = []
  private lastY: number[] = []
  private readonly leftFooted: boolean[]
  private readonly aimPivot: Group
  private readonly aimLength: Group

  constructor(state: MatchState, blob: Texture) {
    const skinCache = new Map<number, MeshStandardMaterial>()
    const hairCache = new Map<number, MeshStandardMaterial>()
    const mat = (color: number, roughness = 0.75) => {
      const m = new MeshStandardMaterial({ color, roughness })
      this.materials.push(m)
      return m
    }
    const shoes = mat(0x111111, 0.5)
    const teamKits: KitMaterials[] = state.teams.map((t) => ({
      shirt: mat(t.primaryColor, 0.7),
      shorts: mat(t.secondaryColor, 0.75),
      socks: mat(t.primaryColor, 0.8),
      shoes,
    }))
    const gkKits: KitMaterials[] = GK_KITS.map((k) => ({
      shirt: mat(k.shirt, 0.7),
      shorts: mat(k.shorts),
      socks: mat(k.socks, 0.8),
      shoes,
    }))
    const shadowMat = new MeshBasicMaterial({ map: blob, transparent: true, depthWrite: false })
    const shadowGeo = new CircleGeometry(0.42, 16)
    shadowGeo.rotateX(-Math.PI / 2)

    for (const p of state.players) {
      const prof = p.profile
      const skin = skinCache.get(prof.skinTone) ?? mat(prof.skinTone, 0.65)
      skinCache.set(prof.skinTone, skin)
      const hair = hairCache.get(prof.hairColor) ?? mat(prof.hairColor, 0.9)
      hairCache.set(prof.hairColor, hair)
      const gk = p.role === 'GK'
      const team = state.teams[p.team]
      const model = new PlayerModel({
        heightCm: prof.heightCm,
        build: 0.95 + (prof.weightKg - (prof.heightCm - 104)) / 120,
        skin,
        hair,
        hairStyle: prof.hairStyle,
        kit: gk ? gkKits[p.team]! : teamKits[p.team]!,
        number: prof.shirtNumber,
        numberColor: gk ? '#101923' : hex(team.numberColor),
        goalkeeper: gk,
      })
      this.models.push(model)
      this.group.add(model.root)
      const sh = new Mesh(shadowGeo, shadowMat)
      sh.position.y = 0.004
      this.shadows.push(sh)
      this.group.add(sh)
    }
    this.setVisualScale(PLAYER_VISUAL_SCALE)
    this.leftFooted = state.players.map((p) => p.profile.preferredFoot === 'left')
    this.lastX = state.players.map((p) => p.pos.x)
    this.lastY = state.players.map((p) => p.pos.y)

    // Controlled-player indicator: amber ring + facing chevron on the floor.
    this.selection = new Group()
    const ringMat = new MeshBasicMaterial({
      color: new Color(0xe9bb48),
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
    })
    const ring = new Mesh(new RingGeometry(0.46, 0.56, 32), ringMat)
    ring.rotation.x = -Math.PI / 2
    this.selection.add(ring)
    const chev = new Shape()
    chev.moveTo(0, 0.85)
    chev.lineTo(0.16, 0.62)
    chev.lineTo(-0.16, 0.62)
    chev.closePath()
    const chevron = new Mesh(new ShapeGeometry(chev), ringMat)
    chevron.rotation.x = -Math.PI / 2
    // Flip within the plane first so the chevron points along +Z (model forward) once laid flat.
    chevron.rotation.z = Math.PI
    const chevPivot = new Group()
    chevPivot.add(chevron)
    chevPivot.name = 'chevron'
    this.selection.add(chevPivot)

    // Throw aim arrow (keeper with the ball in the hands): length grows with the charged power.
    const arrow = new Shape()
    arrow.moveTo(-0.09, 0)
    arrow.lineTo(0.09, 0)
    arrow.lineTo(0.09, 0.8)
    arrow.lineTo(0.24, 0.8)
    arrow.lineTo(0, 1)
    arrow.lineTo(-0.24, 0.8)
    arrow.lineTo(-0.09, 0.8)
    arrow.closePath()
    const arrowMat = new MeshBasicMaterial({
      color: new Color(0xe9bb48),
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
    })
    this.materials.push(arrowMat as unknown as MeshStandardMaterial)
    const arrowMesh = new Mesh(new ShapeGeometry(arrow), arrowMat)
    arrowMesh.rotation.x = -Math.PI / 2
    arrowMesh.rotation.z = Math.PI
    this.aimLength = new Group()
    this.aimLength.position.z = 0.6
    this.aimLength.add(arrowMesh)
    this.aimPivot = new Group()
    this.aimPivot.add(this.aimLength)
    this.aimPivot.visible = false
    this.selection.add(this.aimPivot)
    this.selection.position.y = 0.006
    this.group.add(this.selection)
  }

  /** `aim`: throw charge (0..1) while the controlled keeper holds the ball, else null. */
  update(
    prev: MatchSnapshot,
    curr: MatchSnapshot,
    alpha: number,
    dt: number,
    aim: number | null = null,
  ): void {
    for (let i = 0; i < this.models.length; i++) {
      const a = prev.players[i]!
      const b = curr.players[i]!
      const m = this.models[i]!
      const x = lerp(a.x, b.x, alpha)
      const y = lerp(a.y, b.y, alpha)
      const facing = lerpAngle(a.facing, b.facing, alpha)
      m.root.position.set(x, 0, y)
      m.root.rotation.y = facingToThreeYaw(facing)
      // Ground speed from rendered displacement keeps stride in sync with what is shown.
      const dx = x - this.lastX[i]!
      const dy = y - this.lastY[i]!
      this.lastX[i] = x
      this.lastY[i] = y
      const shownSpeed = dt > 0 ? Math.hypot(dx, dy) / dt : 0
      const simSpeed = Math.hypot(b.vx, b.vy)
      const speed = shownSpeed > 20 ? simSpeed : shownSpeed * 0.5 + simSpeed * 0.5
      m.animate(dt, {
        speed,
        sprint: b.sprint,
        sole: b.sole && b.hasBall,
        action: b.action,
        actionTime: b.actionTime,
        leftFooted: this.leftFooted[i]!,
        saveSide: Math.sign(curr.ball.x - b.x),
        holding: b.hasBall && curr.ball.inHands,
      })
      this.shadows[i]!.position.set(x, 0.004, y)
    }
    const id = curr.controlledId
    this.selection.visible = id !== null
    if (id !== null) {
      const root = this.models[id]!.root
      this.selection.position.set(root.position.x, 0.006, root.position.z)
      this.selection.getObjectByName('chevron')!.rotation.y = root.rotation.y
      this.aimPivot.visible = aim !== null
      if (aim !== null) {
        this.aimPivot.rotation.y = root.rotation.y
        this.aimLength.scale.set(1, 1, 1.4 + 6 * aim)
      }
    }
  }

  setVisualScale(k: number): void {
    for (const m of this.models) m.setVisualScale(k)
  }

  dispose(): void {
    for (const m of this.models) m.dispose()
    for (const m of this.materials) m.dispose()
  }
}
