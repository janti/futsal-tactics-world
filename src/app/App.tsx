import { useEffect, useRef } from 'react'
import { GameSession } from './GameSession'
import { Hud, ControlsPanel } from '../ui/hud/Hud'
import { MatchEnd } from '../ui/hud/MatchEnd'
import { QuickMatchSetupScreen } from '../ui/menus/QuickMatchSetup'
import { useUi } from '../ui/store'
import { useT } from '../ui/useT'
import { DEFENSIVE_SWITCH_MODES, type DefensiveSwitchMode } from '../simulation/ControlOptions'
import type { TranslationKey } from '../localization/i18n'

export function App() {
  const screen = useUi((s) => s.screen)
  if (screen === 'title') return <TitleScreen />
  if (screen === 'setup') return <QuickMatchSetupScreen />
  return <MatchScreen />
}

function LanguageSwitch() {
  const lang = useUi((s) => s.lang)
  const setLang = useUi((s) => s.setLang)
  const t = useT()
  return (
    <div className="lang-switch" role="group" aria-label={t('menu.language')}>
      {(['fi', 'en'] as const).map((l) => (
        <button key={l} className={l === lang ? 'active' : ''} onClick={() => setLang(l)}>
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  )
}

/** Control settings. Changes apply to a running match immediately and are remembered. */
function SettingsPanel() {
  const t = useT()
  const controls = useUi((s) => s.controls)
  const setControls = useUi((s) => s.setControls)
  const keepUp = useUi((s) => s.keepAttackingUp)
  const playerScale = useUi((s) => s.playerScale)
  const setPlayerScale = useUi((s) => s.setPlayerScale)
  const setKeepUp = useUi((s) => s.setKeepAttackingUp)
  return (
    <div className="settings-panel">
      <h3>{t('settings.title')}</h3>
      <label className="setting-row">
        <span>{t('settings.defensiveSwitch')}</span>
        <select
          data-testid="setting-defensive-switch"
          value={controls.defensiveSwitch}
          onChange={(e) => setControls({ defensiveSwitch: e.target.value as DefensiveSwitchMode })}
        >
          {DEFENSIVE_SWITCH_MODES.map((m) => (
            <option key={m} value={m}>
              {t(`settings.defensiveSwitch.${m}` as TranslationKey)}
            </option>
          ))}
        </select>
      </label>
      <p className="setting-help">
        {t(`settings.defensiveSwitch.${controls.defensiveSwitch}.help` as TranslationKey)}
      </p>
      <label className="setup-check">
        <input
          type="checkbox"
          data-testid="setting-keep-up"
          checked={keepUp}
          onChange={(e) => setKeepUp(e.target.checked)}
        />
        <span>{t('settings.keepAttackingUp')}</span>
      </label>
      <label className="setting-row">
        <span>{t('settings.playerScale')}</span>
        <select
          data-testid="setting-player-scale"
          value={playerScale}
          onChange={(e) => setPlayerScale(Number(e.target.value))}
        >
          <option value={1}>{t('settings.playerScale.real')}</option>
          <option value={1.06}>106 %</option>
          <option value={1.12}>{t('settings.playerScale.default')}</option>
        </select>
      </label>
    </div>
  )
}

function TitleScreen() {
  const t = useT()
  const openSetup = useUi((s) => s.openSetup)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Enter' && (e.target as HTMLElement | null)?.tagName !== 'BUTTON') openSetup()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [openSetup])
  return (
    <div className="title-screen">
      <div className="title-card">
        <h1>{t('app.title')}</h1>
        <p className="subtitle">{t('app.subtitle')}</p>
        <button className="primary" data-testid="quick-match" autoFocus onClick={openSetup}>
          {t('menu.quickMatch')}
        </button>
        <p className="note">{t('menu.prototypeNote')}</p>
        <LanguageSwitch />
        <SettingsPanel />
        <ControlsPanel />
      </div>
    </div>
  )
}

function MatchScreen() {
  const containerRef = useRef<HTMLDivElement>(null)
  const matchKey = useUi((s) => s.matchKey)
  const paused = useUi((s) => s.paused)
  const result = useUi((s) => s.result)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const session = new GameSession(el, 20261124 + matchKey)
    return () => session.dispose()
  }, [matchKey])

  return (
    <div className="match-screen">
      <div className="viewport" ref={containerRef} />
      <Hud />
      {result ? <MatchEnd /> : paused && <PauseMenu />}
    </div>
  )
}

function PauseMenu() {
  const t = useT()
  const setPaused = useUi((s) => s.setPaused)
  const restartMatch = useUi((s) => s.restartMatch)
  const quit = useUi((s) => s.quitToTitle)
  return (
    <div className="pause-overlay" data-testid="pause-menu">
      <div className="pause-card">
        <h2>{t('menu.paused')}</h2>
        <button className="primary" autoFocus onClick={() => setPaused(false)}>
          {t('menu.resume')}
        </button>
        <button onClick={restartMatch}>{t('menu.restart')}</button>
        <button onClick={quit}>{t('menu.quit')}</button>
        <LanguageSwitch />
        <SettingsPanel />
      </div>
    </div>
  )
}
