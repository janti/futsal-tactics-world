import {
  DirectionalLight,
  Group,
  HemisphereLight,
  PCFSoftShadowMap,
  PointLight,
  type WebGLRenderer,
} from 'three'
import { COURT } from '../simulation/SimulationConfig'

export type ShadowQuality = 'off' | 'low' | 'high'

/**
 * Warm indoor lighting: hemisphere fill, a soft overhead key light that casts the shadow map,
 * and a few low-intensity overhead points for subtle parquet highlights. No bloom, no flares.
 */
export function createLighting(renderer: WebGLRenderer, shadows: ShadowQuality): Group {
  const g = new Group()
  g.name = 'lighting'
  const hemi = new HemisphereLight(0xfff4e6, 0x3a3027, 1.35)
  g.add(hemi)

  const key = new DirectionalLight(0xfff1dc, 1.9)
  key.position.set(4, 30, -6)
  key.target.position.set(0, 0, 0)
  g.add(key)
  g.add(key.target)
  if (shadows !== 'off') {
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = PCFSoftShadowMap
    key.castShadow = true
    const size = shadows === 'high' ? 2048 : 1024
    key.shadow.mapSize.set(size, size)
    const cam = key.shadow.camera
    cam.left = -COURT.halfWidth - 3
    cam.right = COURT.halfWidth + 3
    cam.top = COURT.halfLength + 3
    cam.bottom = -COURT.halfLength - 3
    cam.near = 5
    cam.far = 60
    key.shadow.bias = -0.0004
    key.shadow.normalBias = 0.02
    key.shadow.radius = 3
  }
  for (const z of [-12, 0, 12]) {
    const p = new PointLight(0xffe2b8, 18, 30, 2)
    p.position.set(0, 9, z)
    g.add(p)
  }
  return g
}
