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
  const stairMat = new MeshStandardMaterial({ color: 0x7c8794, roughness: 0.8 })
  const railMat = new MeshStandardMaterial({ color: 0xc9d1da, roughness: 0.35, metalness: 0.6 })
  const homeSeat = new MeshStandardMaterial({ color: 0x1f4f99, roughness: 0.6 })
  const awaySeat = new MeshStandardMaterial({ color: 0x9b2c25, roughness: 0.6 })
  const tierDepth = 0.9
  const tierRise = 0.45
  const people: Matrix4[] = []
  const colors: Color[] = []
  const palette = [0x1f5fbf, 0xd23a2f, 0xf2f5f8, 0x2b2b2b, 0xe9bb48, 0x6d7f91, 0x3a6b4f, 0x8a4f7d]
  /** Aisles every few metres: stairs, no spectators. */
  const isAisle = (u: number) => Math.abs(((u + 100) % 9) - 4.5) < 0.55

  /**
   * One stand block. `across` is the axis pointing away from the court (x for side stands, z for end
   * stands), `along` runs parallel to the court edge.
   */
  const stand = (side: 1 | -1, axis: 'x' | 'z', start: number, length: number, tiers: number) => {
    for (let t = 0; t < tiers; t++) {
      const off = side * (start + t * tierDepth + tierDepth / 2)
      const h = tierRise * (t + 1)
      const step = new Mesh(
        axis === 'x' ? new BoxGeometry(tierDepth, h, length) : new BoxGeometry(length, h, tierDepth),
        tierMat,
      )
      if (axis === 'x') step.position.set(off, h / 2, 0)
      else step.position.set(0, h / 2, off)
      step.receiveShadow = true
      root.add(step)
      // Seat strip along the front of each tier: home colours one half, away colours the other.
      for (const half of [-1, 1]) {
        const seatGeo =
          axis === 'x'
            ? new BoxGeometry(0.35, 0.12, length / 2 - 0.1)
            : new BoxGeometry(length / 2 - 0.1, 0.12, 0.35)
        const seat = new Mesh(seatGeo, half < 0 ? homeSeat : awaySeat)
        const along = half * (length / 4)
        const front = off + side * 0.18
        if (axis === 'x') seat.position.set(front, h + 0.06, along)
        else seat.position.set(along, h + 0.06, front)
        root.add(seat)
      }
      for (let u = -length / 2 + 0.4; u < length / 2 - 0.3; u += 0.55) {
        if (isAisle(u) || !rng.chance(0.62 * density)) continue
        const m = new Matrix4()
        const k = rng.range(0.9, 1.05)
        m.makeScale(1, k, 1)
        const a = off + rng.range(-0.1, 0.1)
        const b = u + rng.range(-0.08, 0.08)
        if (axis === 'x') m.setPosition(a, h + 0.42 * k, b)
        else m.setPosition(b, h + 0.42 * k, a)
        people.push(m)
        colors.push(new Color(rng.pick(palette)))
      }
    }
    // Stairs in the aisles and a rail along the front.
    for (let u = -length / 2; u <= length / 2; u += 9) {
      if (Math.abs(u) > length / 2 - 0.5) continue
      const depth = tiers * tierDepth
      const stairs = new Mesh(
        axis === 'x' ? new BoxGeometry(depth, 0.06, 1.0) : new BoxGeometry(1.0, 0.06, depth),
        stairMat,
      )
      const mid = side * (start + depth / 2)
      const y = (tiers * tierRise) / 2 + 0.03
      if (axis === 'x') {
        stairs.position.set(mid, y, u + 4.5 - (((u + 4.5 + 100) % 9) - 4.5))
        stairs.rotation.z = side * Math.atan2(tiers * tierRise, depth)
      } else {
        stairs.position.set(u + 4.5 - (((u + 4.5 + 100) % 9) - 4.5), y, mid)
        stairs.rotation.x = -side * Math.atan2(tiers * tierRise, depth)
      }
      root.add(stairs)
    }
    const rail = new Mesh(
      axis === 'x' ? new BoxGeometry(0.06, 0.06, length) : new BoxGeometry(length, 0.06, 0.06),
      railMat,
    )
    if (axis === 'x') rail.position.set(side * (start - 0.05), tierRise + 0.75, 0)
    else rail.position.set(0, tierRise + 0.75, side * (start - 0.05))
    root.add(rail)
  }

  const sideStart = COURT.halfWidth + 5
  const sideTiers = 5
  const endStart = COURT.halfLength + 4.6
  const endTiers = 3
  for (const s of [-1, 1] as const) {
    stand(s, 'x', sideStart, COURT.length + 4, sideTiers)
    stand(s, 'z', endStart, COURT.width + 4, endTiers)
  }

  // Back walls behind the stands.
  const wallMat = new MeshStandardMaterial({ color: 0x24303d, roughness: 0.9 })
  for (const s of [-1, 1]) {
    const wall = new Mesh(new BoxGeometry(0.3, 8, 70), wallMat)
    wall.position.set(s * (sideStart + sideTiers * tierDepth + 1), 4, 0)
    root.add(wall)
    const endWall = new Mesh(new BoxGeometry(60, 8, 0.3), wallMat)
    endWall.position.set(0, 4, s * (endStart + endTiers * tierDepth + 0.8))
    root.add(endWall)
  }
  if (people.length === 0) return
  const crowd = new InstancedMesh(
    new CapsuleGeometry(0.17, 0.45, 2, 6),
    new MeshStandardMaterial({ roughness: 0.8 }),
    people.length,
  )
  people.forEach((m, i) => {
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
  // Substitutes in bibs on each bench and the timekeepers' table at halfway.
  const subGeo = new CapsuleGeometry(0.2, 0.4, 2, 6)
  const bibs = [
    new MeshStandardMaterial({ color: 0xff7a1a, roughness: 0.7 }),
    new MeshStandardMaterial({ color: 0x9bd23a, roughness: 0.7 }),
  ]
  for (const [k, s] of ([-1, 1] as const).entries()) {
    for (let n = 0; n < 4; n++) {
      const sub = new Mesh(subGeo, bibs[k]!)
      sub.position.set(-(COURT.halfWidth + 2.45), 0.75, s * 7.5 + (n - 1.5) * 1.1)
      sub.castShadow = true
      root.add(sub)
    }
  }
  const table = new Mesh(
    new BoxGeometry(0.8, 0.75, 3.2),
    new MeshStandardMaterial({ color: 0x0f1822, roughness: 0.5 }),
  )
  table.position.set(-(COURT.halfWidth + 2.6), 0.375, 0)
  table.castShadow = true
  root.add(table)
  const officialMat = new MeshStandardMaterial({ color: 0x111111, roughness: 0.7 })
  for (const z of [-0.7, 0.7]) {
    const official = new Mesh(subGeo, officialMat)
    official.position.set(-(COURT.halfWidth + 3.2), 0.75, z)
    root.add(official)
  }
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
