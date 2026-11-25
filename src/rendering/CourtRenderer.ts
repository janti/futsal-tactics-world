import {
  BoxGeometry,
  CapsuleGeometry,
  Color,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  type WebGLRenderer,
} from 'three'
import { SeededRandom } from '../core/random/SeededRandom'
import { ARENA, COURT } from '../simulation/SimulationConfig'
import { createAdTexture, createMarkingsTexture, createParquetTexture } from './textures'

/**
 * Finnish Classic Hall (first arena): honey parquet court, blue surround, advertising boards,
 * small stands with instanced spectators and team benches. Decorative objects sit well outside the
 * playing area and never affect the simulation.
 */
export function createCourt(renderer: WebGLRenderer, crowdDensity = 1): Group {
  const root = new Group()
  root.name = 'arena'
  const aniso = renderer.capabilities.getMaxAnisotropy()

  // Surrounding floor (run-off) in blue.
  const surround = new Mesh(
    new PlaneGeometry(COURT.width + 9, COURT.length + 10),
    new MeshStandardMaterial({ color: 0x2c5d8f, roughness: 0.75 }),
  )
  surround.rotation.x = -Math.PI / 2
  surround.position.y = -0.002
  surround.receiveShadow = true
  root.add(surround)

  // Parquet court.
  const parquet = createParquetTexture()
  parquet.anisotropy = aniso
  const court = new Mesh(
    new PlaneGeometry(COURT.width, COURT.length),
    new MeshStandardMaterial({ map: parquet, roughness: 0.48, metalness: 0.0 }),
  )
  court.rotation.x = -Math.PI / 2
  court.receiveShadow = true
  root.add(court)

  // Markings overlay.
  const markings = createMarkingsTexture()
  markings.anisotropy = aniso
  const lines = new Mesh(
    new PlaneGeometry(COURT.width, COURT.length),
    new MeshStandardMaterial({ map: markings, transparent: true, roughness: 0.5, depthWrite: false }),
  )
  lines.rotation.x = -Math.PI / 2
  lines.position.y = 0.002
  lines.receiveShadow = true
  root.add(lines)

  // Outer hall floor (beyond the surround).
  const hallFloor = new Mesh(
    new PlaneGeometry(90, 90),
    new MeshStandardMaterial({ color: 0x1a2531, roughness: 0.9 }),
  )
  hallFloor.rotation.x = -Math.PI / 2
  hallFloor.position.y = -0.01
  root.add(hallFloor)

  addBoards(root)
  addStands(root, crowdDensity)
  addBenches(root)
  return root
}

function addBoards(root: Group): void {
  const boardH = 0.85
  const ends = createAdTexture(['FUTSAL TACTICS WORLD', 'INDOOR LEAGUE', 'PLAY FAIR'], '#101923', '#e9bb48')
  const sides = createAdTexture(
    ['#FUTSAL', 'FUTSAL TACTICS WORLD', 'PARQUET', 'RESPECT'],
    '#1c2938',
    '#f2f5f8',
  )
  ends.repeat.set(1, 1)
  sides.repeat.set(2, 1)
  const endMat = new MeshStandardMaterial({
    map: ends,
    roughness: 0.6,
    emissive: new Color(0x222222),
    emissiveMap: ends,
  })
  const sideMat = new MeshStandardMaterial({
    map: sides,
    roughness: 0.6,
    emissive: new Color(0x222222),
    emissiveMap: sides,
  })
  // Same geometry the ball bounces off (simulation ARENA config).
  const endZ = ARENA.boardEndY + 0.06
  const sideX = ARENA.boardSideX + 0.06
  for (const s of [-1, 1]) {
    const b = new Mesh(new BoxGeometry(COURT.width + 7, boardH, 0.12), endMat)
    b.position.set(0, boardH / 2, s * endZ)
    b.rotation.y = s > 0 ? Math.PI : 0
    root.add(b)
    const sb = new Mesh(new BoxGeometry(COURT.length + 7, boardH, 0.12), sideMat)
    sb.position.set(s * sideX, boardH / 2, 0)
    sb.rotation.y = s > 0 ? -Math.PI / 2 : Math.PI / 2
    root.add(sb)
  }
}

function addStands(root: Group, density: number): void {
  const rng = new SeededRandom(77)
  const tierMat = new MeshStandardMaterial({ color: 0x4a5462, roughness: 0.85 })
  const tiers = 5
  const tierDepth = 0.9
  const tierRise = 0.45
  const startX = COURT.halfWidth + 5
  const length = COURT.length + 4
  const seats: Matrix4[] = []
  const colors: Color[] = []
  const palette = [0x1f5fbf, 0xd23a2f, 0xf2f5f8, 0x2b2b2b, 0xe9bb48, 0x6d7f91, 0x3a6b4f, 0x8a4f7d]
  for (const s of [-1, 1]) {
    for (let t = 0; t < tiers; t++) {
      const step = new Mesh(new BoxGeometry(tierDepth, tierRise * (t + 1), length), tierMat)
      step.position.set(s * (startX + t * tierDepth + tierDepth / 2), (tierRise * (t + 1)) / 2, 0)
      step.receiveShadow = true
      root.add(step)
      for (let z = -length / 2 + 0.4; z < length / 2 - 0.3; z += 0.55) {
        if (!rng.chance(0.55 * density)) continue
        const m = new Matrix4()
        const h = rng.range(0.9, 1.05)
        m.makeScale(1, h, 1)
        m.setPosition(
          s * (startX + t * tierDepth + tierDepth / 2 + rng.range(-0.1, 0.1)),
          tierRise * (t + 1) + 0.42 * h,
          z + rng.range(-0.08, 0.08),
        )
        seats.push(m)
        colors.push(new Color(rng.pick(palette)))
      }
    }
  }
  // Back walls
  const wallMat = new MeshStandardMaterial({ color: 0x24303d, roughness: 0.9 })
  for (const s of [-1, 1]) {
    const wall = new Mesh(new BoxGeometry(0.3, 8, 70), wallMat)
    wall.position.set(s * (startX + tiers * tierDepth + 1), 4, 0)
    root.add(wall)
    const endWall = new Mesh(new BoxGeometry(60, 8, 0.3), wallMat)
    endWall.position.set(0, 4, s * (COURT.halfLength + 8))
    root.add(endWall)
  }
  if (seats.length === 0) return
  const crowd = new InstancedMesh(
    new CapsuleGeometry(0.17, 0.45, 2, 6),
    new MeshStandardMaterial({ roughness: 0.8 }),
    seats.length,
  )
  seats.forEach((m, i) => {
    crowd.setMatrixAt(i, m)
    crowd.setColorAt(i, colors[i]!)
  })
  crowd.instanceMatrix.needsUpdate = true
  crowd.name = 'crowd'
  root.add(crowd)
}

function addBenches(root: Group): void {
  const benchMat = new MeshStandardMaterial({ color: 0x9aa7b4, roughness: 0.5 })
  const seatMat = new MeshStandardMaterial({ color: 0x1c2938, roughness: 0.6 })
  for (const s of [-1, 1]) {
    const back = new Mesh(new BoxGeometry(0.1, 1.0, 5), benchMat)
    back.position.set(-(COURT.halfWidth + 2.7), 0.5, s * 7.5)
    root.add(back)
    const seat = new Mesh(new BoxGeometry(0.5, 0.45, 5), seatMat)
    seat.position.set(-(COURT.halfWidth + 2.4), 0.225, s * 7.5)
    seat.castShadow = true
    root.add(seat)
  }
}
