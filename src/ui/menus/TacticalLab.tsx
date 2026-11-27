import { SCENARIOS, SCENARIO_ORDER, SCENARIO_OUTCOMES, type ScenarioId } from '../../lab/scenarios'
import { AI_STATE_COLORS } from '../../rendering/AIDebugOverlay'
import type { TranslationKey } from '../../localization/i18n'
import { FORMATIONS, PRESSING_HEIGHTS } from '../../simulation/Tactics'
import { useUi, type LabMode } from '../store'
import { useT } from '../useT'
import { RotationSettingsPanel } from './RotationSettingsPanel'

const MODES: LabMode[] = ['watch', 'attack', 'defend']
const SPEEDS = [0.25, 0.5, 1]
const LEGEND_STATES = ['run', 'support', 'press', 'chase', 'cover', 'intercept'] as const

/**
 * Tactical Lab panel (Milestone 6, stage 4): pick a situation, who you are in it (watch, attack,
 * defend), the tactics of both sides and the speed; the situation starts again after every attempt
 * and the outcomes are counted. The AI view (key 7) shows what every computer player intends.
 */
export function TacticalLab() {
  const t = useT()
  const lab = useUi((s) => s.lab)
  const setLab = useUi((s) => s.setLab)
  const reset = useUi((s) => s.resetLabScenario)
  const clear = useUi((s) => s.clearLabResults)
  const aiDebug = useUi((s) => s.aiDebug)
  const toggleAiDebug = useUi((s) => s.toggleAiDebug)
  if (!lab) return null
  const sc = SCENARIOS[lab.scenario]
  const r = lab.results
  const pct = (n: number) => (r.attempts ? `${Math.round((n / r.attempts) * 100)} %` : '—')

  return (
    <aside className="camera-lab tactical-lab" data-testid="tactical-lab" aria-label={t('tlab.title')}>
      <header>
        <h3>{t('tlab.title')}</h3>
      </header>
      <p className="setting-help">{t('tlab.help')}</p>

      <label className="lab-row">
        <span>{t('tlab.scenario')}</span>
        <select
          data-testid="tlab-scenario"
          value={lab.scenario}
          onChange={(e) => setLab({ scenario: e.target.value as ScenarioId })}
        >
          {SCENARIO_ORDER.map((id) => (
            <option key={id} value={id}>
              {t(`scenario.${id}` as TranslationKey)}
            </option>
          ))}
        </select>
      </label>
      <p className="setting-help">{t(`scenario.${lab.scenario}.desc` as TranslationKey)}</p>

      <div className="lab-row">
        <span>{t('tlab.mode')}</span>
        <div className="segmented">
          {MODES.map((m) => (
            <button
              key={m}
              data-testid={`tlab-mode-${m}`}
              className={lab.mode === m ? 'active' : ''}
              onClick={() => setLab({ mode: m })}
            >
              {t(`tlab.mode.${m}`)}
            </button>
          ))}
        </div>
      </div>

      <div className="lab-row">
        <span>{t('tlab.formation')}</span>
        <div className="segmented">
          {FORMATIONS.map((f) => (
            <button
              key={f}
              data-testid={`tlab-formation-${f}`}
              className={lab.formation === f ? 'active' : ''}
              onClick={() => setLab({ formation: f })}
            >
              {f}
            </button>
          ))}
        </div>
      </div>
      <div className="lab-row">
        <span>{t('tlab.pressing')}</span>
        <div className="segmented">
          {PRESSING_HEIGHTS.map((h) => (
            <button
              key={h}
              data-testid={`tlab-pressing-${h}`}
              className={lab.pressing === h ? 'active' : ''}
              onClick={() => setLab({ pressing: h })}
            >
              {t(`setup.pressing.${h}`)}
            </button>
          ))}
        </div>
      </div>
      <label className="setup-check">
        <input
          type="checkbox"
          data-testid="tlab-rotations"
          checked={lab.rotations}
          onChange={(e) => setLab({ rotations: e.target.checked })}
        />
        <span>{t('tlab.rotations')}</span>
      </label>
      <label className="setup-check" title={t('tlab.drill.desc')}>
        <input
          type="checkbox"
          data-testid="tlab-drill"
          checked={lab.drill}
          onChange={(e) => setLab({ drill: e.target.checked })}
        />
        <span>{t('tlab.drill')}</span>
      </label>
      {lab.rotations && SCENARIOS[lab.scenario].rotation && (
        <label className="setup-check" title={t('tlab.demo.desc')}>
          <input
            type="checkbox"
            data-testid="tlab-demo"
            checked={lab.demo}
            onChange={(e) => setLab({ demo: e.target.checked })}
          />
          <span>{t('tlab.demo')}</span>
        </label>
      )}
      {lab.rotations && (
        <details className="lab-rotations">
          <summary>{t('rot.section')}</summary>
          <RotationSettingsPanel
            testId="tlab-rot"
            value={lab.rotation}
            onChange={(rotation) => setLab({ rotation })}
            onFormation={(formation) => setLab({ formation })}
          />
        </details>
      )}

      <div className="lab-row">
        <span>{t('tlab.speed')}</span>
        <div className="segmented">
          {SPEEDS.map((v) => (
            <button
              key={v}
              data-testid={`tlab-speed-${v}`}
              className={lab.speed === v ? 'active' : ''}
              onClick={() => setLab({ speed: v })}
            >
              {v}×
            </button>
          ))}
        </div>
      </div>
      <label className="setup-check">
        <input
          type="checkbox"
          checked={lab.autoRepeat}
          onChange={(e) => setLab({ autoRepeat: e.target.checked })}
        />
        <span>{t('tlab.autoRepeat')}</span>
      </label>
      <label className="setup-check">
        <input type="checkbox" data-testid="tlab-ai-debug" checked={aiDebug} onChange={toggleAiDebug} />
        <span>{t('tlab.aiDebug')}</span>
      </label>
      <div className="lab-buttons">
        <button className="primary" data-testid="tlab-reset" onClick={reset}>
          {t('tlab.reset')}
        </button>
      </div>

      <h4>{t('tlab.results')}</h4>
      <table className="lab-results" data-testid="tlab-results">
        <tbody>
          <tr>
            <th>{t('tlab.attempts')}</th>
            <td data-testid="tlab-attempts">{r.attempts}</td>
          </tr>
          {SCENARIO_OUTCOMES.filter((o) => o !== 'conceded' || r.outcomes.conceded > 0).map((o) => (
            <tr key={o}>
              <th>{t(`outcome.${o}` as TranslationKey)}</th>
              <td>
                {r.outcomes[o]} <span className="lab-pct">{pct(r.outcomes[o])}</span>
              </td>
            </tr>
          ))}
          {sc.rotation && (
            <tr>
              <th>{t('tlab.rotationRate')}</th>
              <td>
                {r.rotationStarted} / {r.rotationCompleted}
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <button onClick={clear}>{t('tlab.clear')}</button>

      {aiDebug && (
        <>
          <h4>{t('tlab.legend')}</h4>
          <ul className="lab-legend">
            {LEGEND_STATES.map((k) => (
              <li key={k}>
                <span className="lab-swatch" style={{ background: AI_STATE_COLORS[k] }} />
                {t(`debug.state.${k}` as TranslationKey)}
              </li>
            ))}
            <li>{t('debug.legend.target')}</li>
            <li>{t('debug.legend.marking')}</li>
            <li>{t('debug.legend.rotation')}</li>
            <li>{t('debug.legend.reserved')}</li>
            <li>{t('debug.legend.vacated')}</li>
            <li>{t('debug.legend.pass')}</li>
          </ul>
        </>
      )}
    </aside>
  )
}
