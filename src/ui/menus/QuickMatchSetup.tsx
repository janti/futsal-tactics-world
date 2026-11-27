import { FORMATIONS, PRESSING_HEIGHTS } from '../../simulation/Tactics'
import { useEffect } from 'react'
import { TEAM_LIBRARY, teamDisplayName, type TeamCategory } from '../../data/teams'
import { hasLocalRosters } from '../../data/localRosters'
import { HALF_LENGTH_OPTIONS } from '../../simulation/MatchRules'
import { DIFFICULTIES } from '../../simulation/Difficulty'
import { useUi } from '../store'
import { useT } from '../useT'
import { RotationSettingsPanel } from './RotationSettingsPanel'

function hex(n: number): string {
  return `#${n.toString(16).padStart(6, '0')}`
}

/** Quick Match setup: teams, half length and clock mode. Defaults are remembered; Enter starts. */
export function QuickMatchSetupScreen() {
  const t = useT()
  const q = useUi((s) => s.quickMatch)
  const setQuickMatch = useUi((s) => s.setQuickMatch)
  const startMatch = useUi((s) => s.startMatch)
  const quit = useUi((s) => s.quitToTitle)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName
      if (e.code === 'Enter' && tag !== 'SELECT' && tag !== 'BUTTON') startMatch()
      if (e.code === 'Escape') quit()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [startMatch, quit])

  const lang = useUi((s) => s.lang)
  const pickTeam = (side: 'homeIndex' | 'awayIndex', index: number) => {
    const other = side === 'homeIndex' ? 'awayIndex' : 'homeIndex'
    const cat = TEAM_LIBRARY[index]!.category
    // The same team cannot play itself: swap if needed. Changing your team to another category (clubs,
    // men's or women's national teams) also moves the opponent into that category.
    if (q[other] === index) setQuickMatch({ [side]: index, [other]: q[side] })
    else if (side === 'homeIndex' && TEAM_LIBRARY[q[other]]!.category !== cat) {
      const opp = TEAM_LIBRARY.findIndex((t, i) => t.category === cat && i !== index)
      setQuickMatch({ [side]: index, [other]: opp >= 0 ? opp : q[other] })
    } else setQuickMatch({ [side]: index })
  }
  const groups: TeamCategory[] = ['club', 'men', 'women']

  return (
    <div className="title-screen">
      <div className="title-card setup-card" data-testid="setup-screen" data-menu>
        <h1>{t('menu.quickMatch')}</h1>
        <div className="setup-teams">
          {(['homeIndex', 'awayIndex'] as const).map((side) => {
            const team = TEAM_LIBRARY[q[side]]!
            return (
              <label key={side} className="setup-team">
                <span className="setup-label">
                  {t(side === 'homeIndex' ? 'setup.yourTeam' : 'setup.opponent')}
                </span>
                <span className="setup-kit" style={{ background: hex(team.primaryColor) }}>
                  <span style={{ background: hex(team.secondaryColor) }} />
                </span>
                <select
                  data-testid={side === 'homeIndex' ? 'setup-home' : 'setup-away'}
                  value={q[side]}
                  onChange={(e) => pickTeam(side, Number(e.target.value))}
                >
                  {groups.map((g) => (
                    <optgroup key={g} label={t(`setup.category.${g}`)}>
                      {TEAM_LIBRARY.map((tm, i) =>
                        tm.category === g ? (
                          <option key={tm.id} value={i}>
                            {teamDisplayName(tm, lang)}
                          </option>
                        ) : null,
                      )}
                    </optgroup>
                  ))}
                </select>
              </label>
            )
          })}
        </div>

        {hasLocalRosters() && (
          <p className="setting-help" data-testid="local-rosters-note">
            {t('setup.localRosters')}
          </p>
        )}

        <div className="setup-row">
          <span className="setup-label">{t('setup.halfLength')}</span>
          <div className="segmented" role="group" aria-label={t('setup.halfLength')}>
            {HALF_LENGTH_OPTIONS.map((m) => (
              <button
                key={m}
                data-testid={`half-${m}`}
                className={m === q.halfMinutes ? 'active' : ''}
                onClick={() => setQuickMatch({ halfMinutes: m })}
              >
                {t('setup.minutes', { n: m })}
              </button>
            ))}
          </div>
        </div>

        <div className="setup-row">
          <span className="setup-label">{t('setup.difficulty')}</span>
          <div className="segmented" role="group" aria-label={t('setup.difficulty')}>
            {DIFFICULTIES.map((d) => (
              <button
                key={d}
                data-testid={`difficulty-${d}`}
                className={d === q.difficulty ? 'active' : ''}
                onClick={() => setQuickMatch({ difficulty: d })}
              >
                {t(`setup.difficulty.${d}`)}
              </button>
            ))}
          </div>
        </div>

        <div className="setup-row">
          <span className="setup-label">{t('setup.formation')}</span>
          <div className="segmented" role="group" aria-label={t('setup.formation')}>
            {FORMATIONS.map((f) => (
              <button
                key={f}
                data-testid={`formation-${f}`}
                className={f === q.formation ? 'active' : ''}
                title={t(`setup.formation.${f}`)}
                onClick={() => setQuickMatch({ formation: f })}
              >
                {f}
              </button>
            ))}
          </div>
        </div>
        <p className="setup-hint">{t(`setup.formation.${q.formation}`)}</p>

        <div className="setup-row">
          <span className="setup-label">{t('setup.pressing')}</span>
          <div className="segmented" role="group" aria-label={t('setup.pressing')}>
            {PRESSING_HEIGHTS.map((h) => (
              <button
                key={h}
                data-testid={`pressing-${h}`}
                className={h === q.pressing ? 'active' : ''}
                onClick={() => setQuickMatch({ pressing: h })}
              >
                {t(`setup.pressing.${h}`)}
              </button>
            ))}
          </div>
        </div>

        <details className="setup-rotations">
          <summary>{t('rot.section')}</summary>
          <RotationSettingsPanel
            testId="setup-rot"
            value={q.rotation}
            onChange={(rotation) => setQuickMatch({ rotation })}
            onFormation={(formation) => setQuickMatch({ formation })}
          />
        </details>

        <label className="setup-check">
          <input
            type="checkbox"
            data-testid="setup-effective"
            checked={q.effectiveClock}
            onChange={(e) => setQuickMatch({ effectiveClock: e.target.checked })}
          />
          <span>{t('setup.effectiveClock')}</span>
        </label>

        <div className="setup-actions">
          <button onClick={quit}>{t('setup.back')}</button>
          <button className="primary" data-testid="start-match" autoFocus onClick={startMatch}>
            {t('setup.start')}
          </button>
        </div>
      </div>
    </div>
  )
}
