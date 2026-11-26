import type { CameraOrientation } from '../camera/CameraSettings'
import type { MatchSnapshot } from '../simulation/MatchSnapshot'
import { COURT } from '../simulation/SimulationConfig'

export interface RadarView {
  /** The human team's attacking direction (sim y) as presented: up (vertical) or right (horizontal). */
  upSign: 1 | -1
  orientation: CameraOrientation
  /** Court length currently visible in the main view (sim y range). */
  visibleMinY: number
  visibleMaxY: number
  /** AI debug: team 0 pitch control per cell (row-major, 2 m cells) and the team phases. */
  pitchControl?: { cols: number; rows: number; cell: number; team0: Float32Array }
  phases?: [string, string]
}

const PAD = 6

/**
 * Radar / minimap: the whole court from above, players as team-coloured dots, the ball, your
 * controlled player ringed and the part of the court the camera currently shows. Drawn on its own 2D
 * canvas every frame; oriented like the main view (vertical: your attack up; horizontal: right).
 */
export class Radar {
  readonly canvas: HTMLCanvasElement
  private readonly ctx: CanvasRenderingContext2D
  private colors: [string, string] = ['#3b82f6', '#ef4444']
  private orientation: CameraOrientation = 'vertical'
  /** Longer side of the radar in CSS pixels. */
  private size = 150

  constructor(parent: HTMLElement) {
    this.canvas = document.createElement('canvas')
    this.canvas.className = 'radar'
    this.canvas.setAttribute('data-testid', 'radar')
    this.canvas.setAttribute('aria-hidden', 'true')
    parent.appendChild(this.canvas)
    this.ctx = this.canvas.getContext('2d')!
    this.layout('vertical')
  }

  setTeamColors(home: string, away: string): void {
    this.colors = [home, away]
  }

  setVisible(on: boolean): void {
    this.canvas.style.display = on ? '' : 'none'
  }

  private layout(orientation: CameraOrientation): void {
    this.orientation = orientation
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const long = this.size
    const short = Math.round((long - PAD * 2) * (COURT.width / COURT.length)) + PAD * 2
    const [w, h] = orientation === 'vertical' ? [short, long] : [long, short]
    this.canvas.width = Math.round(w * dpr)
    this.canvas.height = Math.round(h * dpr)
    this.canvas.style.width = `${w}px`
    this.canvas.style.height = `${h}px`
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }

  draw(s: MatchSnapshot, view: RadarView): void {
    if (this.canvas.style.display === 'none') return
    if (view.orientation !== this.orientation) this.layout(view.orientation)
    const ctx = this.ctx
    const w = this.canvas.width / Math.min(window.devicePixelRatio || 1, 2)
    const h = this.canvas.height / Math.min(window.devicePixelRatio || 1, 2)
    const scale = (Math.max(w, h) - PAD * 2) / COURT.length
    const vertical = view.orientation === 'vertical'
    const u = view.upSign
    // Sim (x, y) -> radar pixels, matching the main view. Vertical: attack up, screen right = sim -x*u.
    // Horizontal (camera on the touch line, looking across): attack right, far touch line (sim +x*u) up.
    const toPx = (x: number, y: number): [number, number] =>
      vertical
        ? [w / 2 - x * u * scale, h / 2 - y * u * scale]
        : [w / 2 + y * u * scale, h / 2 - x * u * scale]

    ctx.clearRect(0, 0, w, h)
    ctx.fillStyle = 'rgba(14, 22, 31, 0.78)'
    ctx.fillRect(0, 0, w, h)
    // Court outline, halfway line, centre circle, penalty areas (as boxes) and goals.
    ctx.strokeStyle = 'rgba(233, 238, 245, 0.55)'
    ctx.lineWidth = 1
    const [x0, y0] = toPx(-COURT.halfWidth, -COURT.halfLength)
    const [x1, y1] = toPx(COURT.halfWidth, COURT.halfLength)
    ctx.strokeRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0))
    const line = (ax: number, ay: number, bx: number, by: number) => {
      const [pa, qa] = toPx(ax, ay)
      const [pb, qb] = toPx(bx, by)
      ctx.beginPath()
      ctx.moveTo(pa, qa)
      ctx.lineTo(pb, qb)
      ctx.stroke()
    }
    line(-COURT.halfWidth, 0, COURT.halfWidth, 0)
    const [cx, cy] = toPx(0, 0)
    ctx.beginPath()
    ctx.arc(cx, cy, COURT.centerCircleRadius * scale, 0, Math.PI * 2)
    ctx.stroke()
    for (const end of [-1, 1]) {
      const gy = end * COURT.halfLength
      const d = end * -COURT.penaltyAreaRadius
      const ax = COURT.goalHalfWidth + COURT.penaltyAreaRadius * 0.75
      line(-ax, gy, -ax, gy + d)
      line(ax, gy, ax, gy + d)
      line(-ax, gy + d, ax, gy + d)
      ctx.save()
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)'
      ctx.lineWidth = 2.5
      line(-COURT.goalHalfWidth, gy, COURT.goalHalfWidth, gy)
      ctx.restore()
    }

    // AI debug: pitch control (who reaches each 2 m cell first), tinted with the team colours.
    const pc = view.pitchControl
    if (pc) {
      for (let row = 0; row < pc.rows; row++) {
        for (let col = 0; col < pc.cols; col++) {
          const v = pc.team0[row * pc.cols + col]!
          const x = -COURT.halfWidth + col * pc.cell
          const y = -COURT.halfLength + row * pc.cell
          const [ax, ay] = toPx(x, y)
          const [bx, by] = toPx(x + pc.cell, y + pc.cell)
          ctx.globalAlpha = Math.abs(v - 0.5) * 0.9
          ctx.fillStyle = v > 0.5 ? this.colors[0] : this.colors[1]
          ctx.fillRect(Math.min(ax, bx), Math.min(ay, by), Math.abs(bx - ax), Math.abs(by - ay))
        }
      }
      ctx.globalAlpha = 1
    }

    // Camera window: the part of the court the main view shows.
    const [vx0, vy0] = toPx(-COURT.halfWidth - 1, Math.max(view.visibleMinY, -COURT.halfLength - 2))
    const [vx1, vy1] = toPx(COURT.halfWidth + 1, Math.min(view.visibleMaxY, COURT.halfLength + 2))
    ctx.fillStyle = 'rgba(233, 187, 72, 0.10)'
    ctx.strokeStyle = 'rgba(233, 187, 72, 0.55)'
    const rx = Math.min(vx0, vx1)
    const ry = Math.min(vy0, vy1)
    ctx.fillRect(rx, ry, Math.abs(vx1 - vx0), Math.abs(vy1 - vy0))
    ctx.strokeRect(rx, ry, Math.abs(vx1 - vx0), Math.abs(vy1 - vy0))

    // Players and ball.
    for (const p of s.players) {
      const [px, py] = toPx(p.x, p.y)
      ctx.beginPath()
      ctx.arc(px, py, p.role === 'GK' ? 3.6 : 3.2, 0, Math.PI * 2)
      ctx.fillStyle = this.colors[p.team]
      ctx.fill()
      ctx.lineWidth = 1
      ctx.strokeStyle = p.role === 'GK' ? '#f5d76e' : 'rgba(0, 0, 0, 0.6)'
      ctx.stroke()
      if (p.id === s.controlledId) {
        ctx.beginPath()
        ctx.arc(px, py, 6, 0, Math.PI * 2)
        ctx.strokeStyle = '#e9bb48'
        ctx.lineWidth = 1.5
        ctx.stroke()
      }
    }
    if (view.phases) {
      ctx.font = '9px sans-serif'
      ctx.fillStyle = this.colors[0]
      ctx.fillText(view.phases[0], 3, h - 4)
      ctx.fillStyle = this.colors[1]
      ctx.fillText(view.phases[1], 3, 10)
    }
    const [bx, by] = toPx(s.ball.x, s.ball.y)
    ctx.beginPath()
    ctx.arc(bx, by, 2.4, 0, Math.PI * 2)
    ctx.fillStyle = '#ffffff'
    ctx.fill()
    ctx.strokeStyle = '#000000'
    ctx.lineWidth = 0.8
    ctx.stroke()
  }

  dispose(): void {
    this.canvas.remove()
  }
}
