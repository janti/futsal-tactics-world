import { useEffect, useRef } from 'react'
import { GameSession } from './GameSession'
import { GamepadMenu } from '../input/GamepadMenu'
import { KeyBindingsPanel } from '../ui/menus/KeyBindingsPanel'
import { CameraLab } from '../ui/menus/CameraLab'
import { TacticalLab } from '../ui/menus/TacticalLab'
import { PlayerScaleSelect } from '../ui/menus/PlayerScaleSelect'
import { CAMERA_PRESET_ORDER, type CameraPresetId } from '../camera/CameraSettings'
import { GRAPHICS_PRESET_ORDER, type GraphicsPreset } from '../rendering/ThreeRenderer'
import { Hud, ControlsPanel } from '../ui/hud/Hud'
import { MatchEnd } from '../ui/hud/MatchEnd'
import { QuickMatchSetupScreen } from '../ui/menus/QuickMatchSetup'
import { useUi } from '../ui/store'
import { useT } from '../ui/useT'
import {
  DEFENSIVE_SWITCH_MODES,
  PASS_ASSIST_MODES,
  type DefensiveSwitchMode,
  type PassAssistMode,
} from '../simulation/ControlOptions'
import type { TranslationKey } from '../localization/i18n'

export function App() {
  const screen = useUi((s) => s.screen)
  useEffect(() => new GamepadMenu().start(), [])
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
  const setKeepUp = useUi((s) => s.setKeepAttackingUp)
  const camera = useUi((s) => s.cameraPreset)
  const setCamera = useUi((s) => s.setCameraPreset)
  const showRadar = useUi((s) => s.showRadar)
  const setShowRadar = useUi((s) => s.setShowRadar)
  const graphics = useUi((s) => s.graphics)
  const setGraphics = useUi((s) => s.setGraphics)
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
      <label className="setting-row">
        <span>{t('settings.passAssist')}</span>
        <select
          data-testid="setting-pass-assist"
          value={controls.passAssist}
          onChange={(e) => setControls({ passAssist: e.target.value as PassAssistMode })}
        >
          {PASS_ASSIST_MODES.map((m) => (
            <option key={m} value={m}>
              {t(`settings.passAssist.${m}` as TranslationKey)}
            </option>
          ))}
        </select>
      </label>
      <p className="setting-help">{t(`settings.passAssist.${controls.passAssist}.help` as TranslationKey)}</p>
      <KeyBindingsPanel />
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
        <PlayerScaleSelect />
      </label>
      <label className="setting-row">
        <span>{t('settings.camera')}</span>
        <select
          data-testid="setting-camera"
          value={camera}
          onChange={(e) => setCamera(e.target.value as CameraPresetId)}
        >
          {CAMERA_PRESET_ORDER.map((c) => (
            <option key={c} value={c}>
              {t(`camera.${c}` as TranslationKey)}
            </option>
          ))}
        </select>
      </label>
      <label className="setup-check">
        <input
          type="checkbox"
          data-testid="setting-radar"
          checked={showRadar}
          onChange={(e) => setShowRadar(e.target.checked)}
        />
        <span>{t('settings.radar')}</span>
      </label>
      <label className="setting-row">
        <span>{t('settings.graphics')}</span>
        <select
          data-testid="setting-graphics"
          value={graphics}
          onChange={(e) => setGraphics(e.target.value as GraphicsPreset)}
        >
          {GRAPHICS_PRESET_ORDER.map((g) => (
            <option key={g} value={g}>
              {t(`settings.graphics.${g}` as TranslationKey)}
            </option>
          ))}
        </select>
      </label>
      <p className="setting-help">{t('settings.graphics.help')}</p>
    </div>
  )
}

function TitleScreen() {
  const t = useT()
  const openSetup = useUi((s) => s.openSetup)
  const openLab = useUi((s) => s.openLab)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Enter' && (e.target as HTMLElement | null)?.tagName !== 'BUTTON') openSetup()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [openSetup])
  return (
    <div className="title-screen">
      <div className="title-card" data-menu>
        <h1>{t('app.title')}</h1>
        <p className="subtitle">{t('app.subtitle')}</p>
        <button className="primary" data-testid="quick-match" autoFocus onClick={openSetup}>
          {t('menu.quickMatch')}
        </button>
        <button data-testid="tactical-lab-open" onClick={openLab}>
          {t('menu.tacticalLab')}
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
  const labOpen = useUi((s) => s.cameraLabOpen)
  const tacticalLab = useUi((s) => s.lab !== null)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const session = new GameSession(el, 20261124 + matchKey)
    return () => session.dispose()
  }, [matchKey])

  return (
    <div className={tacticalLab ? 'match-screen in-lab' : 'match-screen'}>
      <div className="viewport" ref={containerRef} />
      <Hud />
      {tacticalLab && !paused && <TacticalLab />}
      {labOpen && !result && !tacticalLab && <CameraLab />}
      {result ? <MatchEnd /> : paused && <PauseMenu />}
    </div>
  )
}

function PauseMenu() {
  const t = useT()
  const setPaused = useUi((s) => s.setPaused)
  const restartMatch = useUi((s) => s.restartMatch)
  const quit = useUi((s) => s.quitToTitle)
  const labOpen = useUi((s) => s.cameraLabOpen)
  const toggleLab = useUi((s) => s.toggleCameraLab)
  const inTacticalLab = useUi((s) => s.lab !== null)
  const openLab = () => {
    if (!labOpen) toggleLab()
  }
  return (
    <div className="pause-overlay" data-testid="pause-menu" data-menu>
      <div className="pause-card">
        <h2>{t('menu.paused')}</h2>
        <button className="primary" autoFocus onClick={() => setPaused(false)}>
          {t('menu.resume')}
        </button>
        {!inTacticalLab && <button onClick={restartMatch}>{t('menu.restart')}</button>}
        {!inTacticalLab && (
          <button
            data-testid="open-camera-lab"
            onClick={() => {
              openLab()
              setPaused(false)
            }}
          >
            {t('menu.cameraLab')}
          </button>
        )}
        <button data-testid="quit" onClick={quit}>
          {t(inTacticalLab ? 'menu.quitLab' : 'menu.quit')}
        </button>
        <LanguageSwitch />
        <SettingsPanel />
      </div>
    </div>
  )
}
