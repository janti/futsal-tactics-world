import { Vector3, type Camera } from 'three'
import type { MatchState, TeamId } from '../simulation/MatchState'
import { pressTriggerActive } from '../ai/team/pressing'

/** Colour per AI state (the legend in the Lab panel uses the same table). */
export const AI_STATE_COLORS: Record<string, string> = {
  run: '#f59e0b',
  support: '#34d399',
  carry: '#ffffff',
  press: '#f87171',
  chase: '#facc15',
  cover: '#60a5fa',
  intercept: '#c084fc',
  twoVone: '#fb7185',
}

export interface DebugLabels {
  /** Translated label for an AI state, a rotation kind or job, a press cue or a team phase. */
  label(key: string): string
}

const tmp = new Vector3()

/**
 * AI debug overlay (key 7) drawn over the main 3D view: what every computer player intends — a line
 * to where he is going, coloured by his state, and the state (the carrier also his decision) above
 * his head — who marks whom, the rotation in progress (participants, jobs, targets, time left) and a
 * pressing jump (cue and target). A 2D canvas laid over the WebGL canvas; positions are projected
 * through the live camera. It only reads the state, so it never changes the simulation.
 */
export class AIDebugOverlay {
  readonly canvas: HTMLCanvasElement
  private readonly ctx: CanvasRenderingContext2D
  private visible = false
  private colors: [string, string] = ['#3b82f6', '#ef4444']

  constructor(parent: HTMLElement) {
    this.canvas = document.createElement('canvas')
    this.canvas.className = 'ai-debug-overlay'
    this.canvas.setAttribute('data-testid', 'ai-debug-overlay')
    this.canvas.setAttribute('aria-hidden', 'true')
    this.canvas.style.display = 'none'
    parent.appendChild(this.canvas)
    this.ctx = this.canvas.getContext('2d')!
  }

  setTeamColors(home: string, away: string): void {
    this.colors = [home, away]
  }

  setVisible(on: boolean): void {
    this.visible = on
    this.canvas.style.display = on ? '' : 'none'
  }

  draw(state: MatchState, camera: Camera, labels: DebugLabels): void {
    if (!this.visible) return
    const parent = this.canvas.parentElement
    if (!parent) return
    const w = parent.clientWidth
    const h = parent.clientHeight
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) {
      this.canvas.width = Math.round(w * dpr)
      this.canvas.height = Math.round(h * dpr)
      this.canvas.style.width = `${w}px`
      this.canvas.style.height = `${h}px`
    }
    const ctx = this.ctx
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)
    // Sim (x, y, height) -> screen pixels through the live camera (Three.js: X = x, Y = height, Z = y).
    const px = (x: number, y: number, z = 0): [number, number] => {
      tmp.set(x, z, y).project(camera)
      return [((tmp.x + 1) / 2) * w, ((1 - tmp.y) / 2) * h]
    }

    // Marking: a thin line from each defender to the man he marks.
    for (const p of state.players) {
      if (p.aiMarkId === null || state.possessionTeam === p.team || p.aiState !== 'cover') continue
      const m = state.players[p.aiMarkId]
      if (!m) continue
      const [ax, ay] = px(p.pos.x, p.pos.y)
      const [bx, by] = px(m.pos.x, m.pos.y)
      ctx.strokeStyle = this.colors[p.team]
      ctx.globalAlpha = 0.75
      ctx.lineWidth = 1.5
      ctx.setLineDash([])
      ctx.beginPath()
      ctx.moveTo(ax, ay)
      ctx.lineTo(bx, by)
      ctx.stroke()
      ctx.globalAlpha = 1
    }

    // Rotations: participants' paths (thick, amber) with the job at the target.
    for (const team of [0, 1] as const) {
      const r = state.rotation[team]
      if (!r) continue
      for (const m of r.moves) {
        const p = state.players[m.id]!
        const [ax, ay] = px(p.pos.x, p.pos.y)
        const [bx, by] = px(m.target.x, m.target.y)
        ctx.strokeStyle = '#e9bb48'
        ctx.lineWidth = 3
        ctx.setLineDash([])
        arrow(ctx, ax, ay, bx, by)
        tag(ctx, bx, by + 12, labels.label(`job.${m.job}`), '#e9bb48')
      }
    }

    // Each computer player's intention: a dashed line to his target, his state above his head.
    for (const p of state.players) {
      const human = p.id === state.controlledId
      const owner = state.ball.ownerId === p.id
      const color = AI_STATE_COLORS[p.aiState] ?? '#cbd5e1'
      const [hx, hy] = px(p.pos.x, p.pos.y, 2.35)
      if (!human && !owner && p.role !== 'GK' && dist2(p.aiTarget, p.pos) > 0.25) {
        const [ax, ay] = px(p.pos.x, p.pos.y)
        const [bx, by] = px(p.aiTarget.x, p.aiTarget.y)
        ctx.strokeStyle = color
        ctx.lineWidth = 1.5
        ctx.setLineDash([5, 4])
        ctx.beginPath()
        ctx.moveTo(ax, ay)
        ctx.lineTo(bx, by)
        ctx.stroke()
        ctx.setLineDash([])
        ctx.fillStyle = color
        ctx.beginPath()
        ctx.arc(bx, by, 3, 0, Math.PI * 2)
        ctx.fill()
      }
      let text = human ? labels.label('state.human') : labels.label(`state.${p.aiState || 'idle'}`)
      if (owner && !human && p.aiDecision) text += ` · ${labels.label(`decision.${p.aiDecision}`)}`
      tag(ctx, hx, hy, text, human ? '#e9bb48' : color)
    }

    // Pressing jump: a ring round the player the press goes to.
    for (const team of [0, 1] as const) {
      const t = state.pressTrigger[team]
      if (!t || !pressTriggerActive(state, team)) continue
      const target = t.targetId !== null ? state.players[t.targetId] : null
      if (!target) continue
      const [cx, cy] = px(target.pos.x, target.pos.y)
      ctx.strokeStyle = this.colors[team]
      ctx.lineWidth = 2.5
      ctx.setLineDash([3, 3])
      ctx.beginPath()
      ctx.ellipse(cx, cy, 22, 12, 0, 0, Math.PI * 2)
      ctx.stroke()
      ctx.setLineDash([])
    }

    // Team summary (top left, below the scoreboard): phase, rotation, pressing jump.
    ctx.font = '600 12px system-ui, sans-serif'
    let y = 64
    for (const team of [0, 1] as const) {
      const line = teamLine(state, team, labels)
      const tw = ctx.measureText(line).width
      ctx.fillStyle = 'rgba(14, 22, 31, 0.82)'
      ctx.fillRect(10, y - 13, tw + 22, 19)
      ctx.fillStyle = this.colors[team]
      ctx.fillRect(10, y - 13, 4, 19)
      ctx.fillStyle = '#e9eef5'
      ctx.fillText(line, 20, y + 1)
      y += 23
    }
  }

  dispose(): void {
    this.canvas.remove()
  }
}

function teamLine(state: MatchState, team: TeamId, labels: DebugLabels): string {
  const parts = [`${state.teams[team].shortName}: ${labels.label(`phase.${state.teamPhase[team]}`)}`]
  const r = state.rotation[team]
  if (r) parts.push(`${labels.label(`rotation.${r.kind}`)} ${Math.max(0, r.until - state.time).toFixed(1)} s`)
  const t = state.pressTrigger[team]
  if (t && pressTriggerActive(state, team))
    parts.push(`${labels.label('press')}: ${labels.label(`cue.${t.kind}`)}`)
  return parts.join('  ·  ')
}

function dist2(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2
}

function tag(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, color: string): void {
  ctx.font = '600 11px system-ui, sans-serif'
  const tw = ctx.measureText(text).width
  ctx.fillStyle = 'rgba(14, 22, 31, 0.78)'
  ctx.fillRect(x - tw / 2 - 4, y - 12, tw + 8, 15)
  ctx.fillStyle = color
  ctx.fillText(text, x - tw / 2, y)
}

function arrow(ctx: CanvasRenderingContext2D, ax: number, ay: number, bx: number, by: number): void {
  ctx.beginPath()
  ctx.moveTo(ax, ay)
  ctx.lineTo(bx, by)
  ctx.stroke()
  const a = Math.atan2(by - ay, bx - ax)
  ctx.beginPath()
  ctx.moveTo(bx, by)
  ctx.lineTo(bx - Math.cos(a - 0.45) * 10, by - Math.sin(a - 0.45) * 10)
  ctx.moveTo(bx, by)
  ctx.lineTo(bx - Math.cos(a + 0.45) * 10, by - Math.sin(a + 0.45) * 10)
  ctx.stroke()
}
