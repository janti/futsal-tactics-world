import { useState } from 'react'
import {
  FAMILY_IDS,
  FAMILY_PRIORITIES,
  PRESETS,
  PRESET_IDS,
  STYLE_KEYS,
  presetSettings,
  type FamilyId,
  type FamilyPriority,
  type PresetId,
  type RotationSettings,
  type RotationStyle,
} from '../../ai/team/rotationLibrary'
import type { Formation } from '../../simulation/Tactics'
import type { TranslationKey } from '../../localization/i18n'
import { useT } from '../useT'

/** The basic view shows these; the rest of the sliders and the priorities are under "Advanced". */
const BASIC: readonly (keyof RotationStyle)[] = ['frequency', 'freedom', 'balance']

/**
 * Rotation settings of a team: a style preset, the main sliders and (advanced) every slider and a
 * priority per movement family. Every value is read by the AI (rotationSelect.ts and friends).
 */
export function RotationSettingsPanel(props: {
  value: RotationSettings
  onChange: (v: RotationSettings) => void
  /** A preset also brings its formation. */
  onFormation?: (f: Formation) => void
  testId: string
}) {
  const t = useT()
  const [advanced, setAdvanced] = useState(false)
  const v = props.value
  const tk = (k: string) => k as TranslationKey
  const setStyle = (key: keyof RotationStyle, n: number) =>
    props.onChange({ ...v, preset: null, style: { ...v.style, [key]: n } })
  const setPriority = (f: FamilyId, p: FamilyPriority) => {
    const priorities = { ...v.priorities }
    if (p === 'normal') delete priorities[f]
    else priorities[f] = p
    props.onChange({ ...v, preset: null, priorities })
  }
  const pickPreset = (id: string) => {
    if (!id) return props.onChange({ ...v, preset: null })
    const p = presetSettings(id as PresetId)
    props.onChange(p)
    props.onFormation?.(PRESETS[id as PresetId].formation)
  }
  const keys = advanced ? STYLE_KEYS : BASIC
  return (
    <div className="rotation-settings" data-testid={props.testId}>
      <div className="setup-row">
        <span className="setup-label">{t('rot.preset')}</span>
        <select
          data-testid={`${props.testId}-preset`}
          value={v.preset ?? ''}
          onChange={(e) => pickPreset(e.target.value)}
        >
          <option value="">{t('rot.custom')}</option>
          {PRESET_IDS.map((id) => (
            <option key={id} value={id}>
              {t(tk(`rot.preset.${id}`))}
            </option>
          ))}
        </select>
      </div>
      {keys.map((key) => (
        <label key={key} className="rotation-slider" title={t(tk(`rot.style.${key}.desc`))}>
          <span>{t(tk(`rot.style.${key}`))}</span>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            data-testid={`${props.testId}-${key}`}
            value={v.style[key]}
            onChange={(e) => setStyle(key, Number(e.target.value))}
          />
          <span className="rotation-value">{v.style[key]}</span>
        </label>
      ))}
      <label className="setup-check">
        <input
          type="checkbox"
          data-testid={`${props.testId}-advanced`}
          checked={advanced}
          onChange={(e) => setAdvanced(e.target.checked)}
        />
        <span>{t('rot.advanced')}</span>
      </label>
      {advanced && (
        <div className="rotation-priorities">
          <span className="setup-label">{t('rot.priorities')}</span>
          {FAMILY_IDS.map((f) => (
            <label key={f} className="rotation-priority" title={t(tk(`family.${f}.desc`))}>
              <span>{t(tk(`family.${f}`))}</span>
              <select
                data-testid={`${props.testId}-priority-${f}`}
                value={v.priorities[f] ?? 'normal'}
                onChange={(e) => setPriority(f, e.target.value as FamilyPriority)}
              >
                {FAMILY_PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {t(tk(`rot.priority.${p}`))}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      )}
    </div>
  )
}
