import { useEffect, useState } from 'react'
import { useUi } from '../store'
import { useT } from '../useT'
import type { TranslationKey } from '../../localization/i18n'

function formatClock(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

const RESTART_KEYS: Record<string, TranslationKey> = {
  kickoff: 'hud.kickoff',
  kickIn: 'hud.kickIn',
  corner: 'hud.corner',
  goalClearance: 'hud.goalClearance',
}

export function Hud() {
  const hud = useUi((s) => s.hud)
  const flash = useUi((s) => s.flash)
  const showHelp = useUi((s) => s.showHelp)
  const t = useT()
  const [, force] = useState(0)

  // Expire flash messages.
  useEffect(() => {
    if (!flash) return
    const id = window.setTimeout(
      () => {
        if (useUi.getState().flash === flash) useUi.getState().showFlash(null)
        force((n) => n + 1)
      },
      Math.max(0, flash.until - performance.now()),
    )
    return () => window.clearTimeout(id)
  }, [flash])

  return (
    <div className="hud" aria-live="polite">
      <div className="scoreboard" data-testid="scoreboard">
        <div className="sb-team">
          <span className="sb-chip" style={{ background: hud.homeColor }} />
          <span className="sb-name">{hud.homeShort}</span>
        </div>
        <div className="sb-score" data-testid="score">
          {hud.score[0]} – {hud.score[1]}
        </div>
        <div className="sb-team">
          <span className="sb-name">{hud.awayShort}</span>
          <span className="sb-chip" style={{ background: hud.awayColor }} />
        </div>
        <div className="sb-half" data-testid="half">
          {hud.half}.
        </div>
        <div className="sb-clock" data-testid="clock">
          {formatClock(Math.ceil(hud.clock))}
        </div>
      </div>

      {hud.phase === 'restart' && hud.restartType && (
        <div className="restart-banner" data-testid="restart-banner">
          {t(RESTART_KEYS[hud.restartType]!)}
          {hud.restartCountdown !== null && (
            <span className="restart-countdown"> · {Math.ceil(hud.restartCountdown)} s</span>
          )}
        </div>
      )}

      {hud.keeperCountdown !== null && (
        <div className="restart-banner" data-testid="keeper-throw-banner">
          {t(hud.keeperHands ? 'hud.keeperThrow' : 'hud.keeperFeet')}
          <span className="restart-countdown"> · {Math.ceil(hud.keeperCountdown)} s</span>
        </div>
      )}

      {flash && <div className={flash.info ? 'toast' : 'flash'}>{t(flash.key, flash.vars)}</div>}

      {hud.controlledName && (
        <div className="player-card" data-testid="controlled-player">
          <span className="pc-number">{hud.controlledNumber}</span>
          <div className="pc-text">
            <span className="pc-label">{t('hud.controlled')}</span>
            <span className="pc-name">{hud.controlledName}</span>
            {hud.controlledRole && (
              <span className="pc-role">{t(`role.${hud.controlledRole}` as TranslationKey)}</span>
            )}
          </div>
          <div className="pc-power" aria-hidden>
            <div className="pc-power-fill" style={{ width: `${Math.round(hud.shotCharge * 100)}%` }} />
          </div>
        </div>
      )}

      <div className="help-hint">{t('hud.helpHint')}</div>
      {showHelp && <ControlsPanel />}
    </div>
  )
}

export function ControlsPanel() {
  const t = useT()
  const rows: [string, TranslationKey][] = [
    ['WASD / ←↑→↓', 'controls.move'],
    ['Z', 'controls.pass'],
    ['X', 'controls.shoot'],
    ['C', 'controls.through'],
    ['Z / X', 'controls.throw'],
    ['V', 'controls.switch'],
    ['Shift', 'controls.sprint'],
    ['Space', 'controls.sole'],
    ['F5 / 5', 'controls.camera'],
    ['Esc / P', 'controls.pause'],
  ]
  return (
    <div className="controls-panel">
      <h3>{t('controls.title')}</h3>
      <table>
        <tbody>
          {rows.map(([k, label]) => (
            <tr key={label}>
              <td className="key">{k}</td>
              <td>{t(label)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
