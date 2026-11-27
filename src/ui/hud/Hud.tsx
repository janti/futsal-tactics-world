import { keyLabel, type InputAction } from '../../input/InputMapping'
import { useEffect, useState } from 'react'
import { useUi } from '../store'

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
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
  freeKick: 'hud.freeKick',
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

      {hud.fourSeconds && (
        <div className="four-seconds" data-testid="four-seconds">
          <span
            className="fs-chip"
            style={{ background: hud.fourSeconds.team === 0 ? hud.homeColor : hud.awayColor }}
          />
          <span className="fs-label">{t(`hud.fourSeconds.${hud.fourSeconds.kind}`)}</span>
          <span className="fs-dots">
            {[0, 1, 2, 3].map((i) => (
              <span
                key={i}
                className={
                  'fs-dot' + (hud.fourSeconds!.elapsed >= i + 1 ? ' on' : '') + (i === 3 ? ' last' : '')
                }
                style={{
                  ['--fill' as string]: `${Math.round(clamp01(hud.fourSeconds!.elapsed - i) * 100)}%`,
                }}
              />
            ))}
          </span>
          <span className="fs-time">{hud.fourSeconds.elapsed.toFixed(1)} s</span>
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

      {hud.opponentCarrier && (
        <div
          className="player-card opponent"
          data-testid="opponent-carrier"
          style={{ borderRightColor: hud.opponentCarrier.team === 0 ? hud.homeColor : hud.awayColor }}
        >
          <span className="pc-number">{hud.opponentCarrier.number}</span>
          <div className="pc-text">
            <span className="pc-label">{t('hud.opponentBall')}</span>
            <span className="pc-name">{hud.opponentCarrier.name}</span>
            <span className="pc-role">{t(`role.${hud.opponentCarrier.role}` as TranslationKey)}</span>
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
  const b = useUi((s) => s.keyBindings)
  const k = (a: InputAction) => b[a].map(keyLabel).join(' / ')
  const first = (a: InputAction) => keyLabel(b[a][0] ?? '')
  const rows: [string, TranslationKey][] = [
    [`${first('up')}${first('left')}${first('down')}${first('right')}`, 'controls.move'],
    [k('pass'), 'controls.pass'],
    [k('shoot'), 'controls.shoot'],
    [k('through'), 'controls.through'],
    [`${first('pass')} / ${first('shoot')}`, 'controls.throw'],
    [k('switch'), 'controls.switch'],
    [k('sprint'), 'controls.sprint'],
    [k('sole'), 'controls.sole'],
    ['F5 / 5', 'controls.camera'],
    ['Esc / P', 'controls.pause'],
    ['6', 'controls.cameraLab'],
    ['7', 'controls.aiDebug'],
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
