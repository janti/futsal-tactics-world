/**
 * All textures are generated locally with Canvas 2D: no external assets are required to play.
 * Randomness here is presentation-only but still seeded so the hall looks identical every load.
 */
import { CanvasTexture, RepeatWrapping, SRGBColorSpace, type Texture } from 'three'
import { SeededRandom } from '../core/random/SeededRandom'
import { COURT, POST_X } from '../simulation/SimulationConfig'

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D not available')
  return [c, ctx]
}

function finish(c: HTMLCanvasElement, srgb = true): CanvasTexture {
  const t = new CanvasTexture(c)
  if (srgb) t.colorSpace = SRGBColorSpace
  t.needsUpdate = true
  return t
}

/** Warm honey parquet: planks run along the court length, staggered joints, subtle grain. Tiles 4 x 4 m. */
export function createParquetTexture(): Texture {
  const size = 1024
  const [c, ctx] = canvas(size, size)
  const rng = new SeededRandom(1234)
  const ppm = size / 4
  const plankW = 0.1 * ppm
  const cols = Math.round(size / plankW)
  const w = size / cols
  for (let i = 0; i < cols; i++) {
    let y = -rng.range(0, 1.5) * ppm
    while (y < size) {
      const len = rng.range(0.9, 1.8) * ppm
      const l = 58 + rng.range(-6, 6)
      const hue = 32 + rng.range(-3, 3)
      const sat = 52 + rng.range(-8, 6)
      ctx.fillStyle = `hsl(${hue} ${sat}% ${l}%)`
      ctx.fillRect(i * w, y, w, len)
      // Grain
      for (let g = 0; g < 7; g++) {
        ctx.strokeStyle = `hsla(${hue - 4} 45% ${l - rng.range(6, 14)}% / ${rng.range(0.08, 0.22)})`
        ctx.lineWidth = rng.range(0.5, 1.4)
        const gx = i * w + rng.range(1, w - 1)
        ctx.beginPath()
        ctx.moveTo(gx, y)
        ctx.bezierCurveTo(
          gx + rng.range(-2, 2),
          y + len * 0.33,
          gx + rng.range(-2, 2),
          y + len * 0.66,
          gx + rng.range(-1.5, 1.5),
          y + len,
        )
        ctx.stroke()
      }
      // Joint
      ctx.fillStyle = 'rgba(60, 35, 15, 0.35)'
      ctx.fillRect(i * w, y + len - 1, w, 1.2)
      y += len
    }
    ctx.fillStyle = 'rgba(60, 35, 15, 0.28)'
    ctx.fillRect(i * w, 0, 1, size)
  }
  const t = finish(c)
  t.wrapS = RepeatWrapping
  t.wrapT = RepeatWrapping
  t.repeat.set(COURT.width / 4, COURT.length / 4)
  return t
}

/**
 * Court markings for the 40 x 20 m court as a transparent overlay. The canvas maps onto a plane
 * rotated flat: canvas left = sim x -10, canvas top = sim y -20 (see CourtRenderer).
 */
export function createMarkingsTexture(): Texture {
  const ppm = 51.2
  const W = Math.round(COURT.width * ppm)
  const H = Math.round(COURT.length * ppm)
  const [c, ctx] = canvas(W, H)
  const X = (x: number) => (x + COURT.halfWidth) * ppm
  const Y = (y: number) => (y + COURT.halfLength) * ppm
  const lw = 0.08 * ppm
  ctx.strokeStyle = 'rgba(250, 250, 248, 0.95)'
  ctx.fillStyle = 'rgba(250, 250, 248, 0.95)'
  ctx.lineWidth = lw
  // Boundary (lines are part of the court: outer edge on the boundary)
  ctx.strokeRect(lw / 2, lw / 2, W - lw, H - lw)
  // Halfway line, centre circle and mark
  ctx.beginPath()
  ctx.moveTo(0, Y(0))
  ctx.lineTo(W, Y(0))
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(X(0), Y(0), COURT.centerCircleRadius * ppm, 0, Math.PI * 2)
  ctx.stroke()
  dot(ctx, X(0), Y(0), 0.1 * ppm)

  for (const end of [-1, 1] as const) {
    const gy = end * COURT.halfLength
    const s = -end // towards the centre
    // Penalty area: quarter circles centred on the outside of each post, joined by a straight line.
    const r = COURT.penaltyAreaRadius * ppm
    ctx.beginPath()
    if (end === -1) {
      ctx.arc(X(POST_X), Y(gy), r, 0, Math.PI / 2, false)
    } else {
      ctx.arc(X(POST_X), Y(gy), r, -Math.PI / 2, 0, false)
    }
    ctx.stroke()
    ctx.beginPath()
    if (end === -1) ctx.arc(X(-POST_X), Y(gy), r, Math.PI / 2, Math.PI, false)
    else ctx.arc(X(-POST_X), Y(gy), r, Math.PI, Math.PI * 1.5, false)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(X(-POST_X), Y(gy + s * COURT.penaltyAreaRadius))
    ctx.lineTo(X(POST_X), Y(gy + s * COURT.penaltyAreaRadius))
    ctx.stroke()
    // Penalty marks
    dot(ctx, X(0), Y(gy + s * COURT.penaltyMark), 0.06 * ppm)
    dot(ctx, X(0), Y(gy + s * COURT.secondPenaltyMark), 0.06 * ppm)
    // Marks 5 m either side of the second penalty mark
    for (const sx of [-5, 5]) {
      ctx.fillRect(X(sx) - lw / 2, Y(gy + s * COURT.secondPenaltyMark) - 0.04 * ppm, lw, 0.08 * ppm)
    }
    // Corner arcs
    for (const cx of [-1, 1]) {
      // Canvas angles: 0 = +x, PI/2 = +y (down = sim +y). Each arc opens into the court.
      ctx.beginPath()
      const start = end === -1 ? (cx === -1 ? 0 : Math.PI / 2) : cx === -1 ? -Math.PI / 2 : Math.PI
      ctx.arc(X(cx * COURT.halfWidth), Y(gy), COURT.cornerArcRadius * ppm, start, start + Math.PI / 2)
      ctx.stroke()
    }
  }
  // Substitution zone marks on the bench side (sim x = -10): 5 m and 10 m from the halfway line.
  for (const sy of [-10, -5, 5, 10]) {
    ctx.fillRect(0, Y(sy) - lw / 2, 0.4 * ppm, lw)
  }
  const t = finish(c)
  return t
}

function dot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fill()
}

/** Equirectangular futsal ball texture: white base with high-contrast dark panels. */
export function createBallTexture(): Texture {
  const [c, ctx] = canvas(256, 128)
  ctx.fillStyle = '#f4f4f0'
  ctx.fillRect(0, 0, 256, 128)
  const panels: [number, number, number][] = [
    [0.0, 0.5, 20],
    [0.25, 0.5, 20],
    [0.5, 0.5, 20],
    [0.75, 0.5, 20],
    [0.125, 0.18, 16],
    [0.375, 0.18, 16],
    [0.625, 0.18, 16],
    [0.875, 0.18, 16],
    [0.125, 0.82, 16],
    [0.375, 0.82, 16],
    [0.625, 0.82, 16],
    [0.875, 0.82, 16],
  ]
  for (const [u, v, r] of panels) {
    for (const off of [0, 256, -256]) {
      ctx.fillStyle = '#1b2f5c'
      ctx.beginPath()
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2 - Math.PI / 2
        const px = u * 256 + off + Math.cos(a) * r * 1.15
        const py = v * 128 + Math.sin(a) * r * 0.9
        if (k === 0) ctx.moveTo(px, py)
        else ctx.lineTo(px, py)
      }
      ctx.closePath()
      ctx.fill()
    }
  }
  ctx.fillStyle = '#d63a2a'
  ctx.fillRect(0, 62, 256, 4)
  return finish(c)
}

export function createNumberTexture(n: number, color: string): Texture {
  const [c, ctx] = canvas(128, 128)
  ctx.clearRect(0, 0, 128, 128)
  ctx.fillStyle = color
  ctx.font = 'bold 96px "Arial Narrow", "Helvetica Neue", Arial, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(String(n), 64, 70)
  return finish(c)
}

/** Generic fictional advertising board strip. */
export function createAdTexture(lines: string[], bg: string, fg: string): Texture {
  const [c, ctx] = canvas(1024, 64)
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, 1024, 64)
  ctx.fillStyle = fg
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'center'
  const step = 1024 / lines.length
  lines.forEach((l, i) => {
    // Shrink long slogans to fit their slot (no overlapping text on the boards).
    let size = 40
    do {
      ctx.font = `bold ${size}px "Segoe UI", "Helvetica Neue", Arial, sans-serif`
      size -= 2
    } while (size > 14 && ctx.measureText(l).width > step * 0.86)
    ctx.fillText(l, step * (i + 0.5), 34)
    // Separator between slogans.
    if (i > 0) ctx.fillRect(step * i - 1, 14, 2, 36)
  })
  const t = finish(c)
  t.wrapS = RepeatWrapping
  return t
}

/** Soft radial blob used for cheap contact shadows. */
export function createBlobTexture(): Texture {
  const [c, ctx] = canvas(64, 64)
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32)
  g.addColorStop(0, 'rgba(0,0,0,0.55)')
  g.addColorStop(0.6, 'rgba(0,0,0,0.25)')
  g.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 64, 64)
  return finish(c, false)
}
