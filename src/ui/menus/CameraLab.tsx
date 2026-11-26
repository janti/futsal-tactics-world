import {
  CAMERA_LAB_RANGES,
  CAMERA_PRESET_ORDER,
  CAMERA_PRESETS,
  type CameraPresetId,
  type CameraSettings,
} from '../../camera/CameraSettings'
import type { TranslationKey } from '../../localization/i18n'
import { useUi } from '../store'
import { useT } from '../useT'

const SLIDERS: (keyof typeof CAMERA_LAB_RANGES)[] = [
  'elevationDeg',
  'visibleLength',
  'lookAhead',
  'attackBias',
  'positionSmoothing',
  'deadZone',
  'sideMargin',
]

/**
 * Camera Lab: tune the custom camera live while the match keeps running. Any change switches the
 * view to the custom camera; values are remembered. A preset can be copied in as a starting point.
 */
export function CameraLab() {
  const t = useT()
  const cam = useUi((s) => s.customCamera)
  const setCustom = useUi((s) => s.setCustomCamera)
  const setPreset = useUi((s) => s.setCameraPreset)
  const close = useUi((s) => s.toggleCameraLab)

  const change = (patch: Partial<CameraSettings>) => {
    setCustom(patch)
    setPreset('custom')
  }
  const copyFrom = (id: CameraPresetId) => {
    const p = CAMERA_PRESETS[id]
    change({ ...p, name: 'custom', minVisibleLength: 16, maxVisibleLength: 48 })
  }

  return (
    <aside className="camera-lab" data-testid="camera-lab" aria-label={t('lab.title')}>
      <header>
        <h3>{t('lab.title')}</h3>
        <button onClick={close} aria-label={t('lab.close')}>
          ✕
        </button>
      </header>
      <p className="setting-help">{t('lab.help')}</p>
      <label className="lab-row">
        <span>{t('lab.copyFrom')}</span>
        <select data-testid="lab-copy" value="" onChange={(e) => copyFrom(e.target.value as CameraPresetId)}>
          <option value="" disabled>
            —
          </option>
          {CAMERA_PRESET_ORDER.filter((p) => p !== 'custom').map((p) => (
            <option key={p} value={p}>
              {t(`camera.${p}` as TranslationKey)}
            </option>
          ))}
        </select>
      </label>
      <div className="lab-row">
        <span>{t('lab.orientation')}</span>
        <div className="segmented">
          {(['vertical', 'horizontal'] as const).map((o) => (
            <button
              key={o}
              data-testid={`lab-orientation-${o}`}
              className={cam.orientation === o ? 'active' : ''}
              onClick={() => change({ orientation: o })}
            >
              {t(`lab.orientation.${o}`)}
            </button>
          ))}
        </div>
      </div>
      <label className="setup-check">
        <input type="checkbox" checked={cam.fixed} onChange={(e) => change({ fixed: e.target.checked })} />
        <span>{t('lab.fixed')}</span>
      </label>
      {SLIDERS.map((k) => {
        const [lo, hi, step] = CAMERA_LAB_RANGES[k]
        return (
          <label key={k} className="lab-slider">
            <span>
              {t(`lab.${k}` as TranslationKey)} <b>{cam[k].toFixed(step < 0.1 ? 2 : step < 1 ? 1 : 0)}</b>
            </span>
            <input
              type="range"
              data-testid={`lab-${k}`}
              min={lo}
              max={hi}
              step={step}
              value={cam[k]}
              onChange={(e) => change({ [k]: Number(e.target.value) })}
            />
          </label>
        )
      })}
      <button onClick={() => copyFrom('verticalSmart')}>{t('lab.reset')}</button>
    </aside>
  )
}
