import { useEffect } from 'react'
import { TEAM_LIBRARY } from '../../data/teams'
import { HALF_LENGTH_OPTIONS } from '../../simulation/MatchRules'
import { DIFFICULTIES } from '../../simulation/Difficulty'
import { useUi } from '../store'
import { useT } from '../useT'

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

  const pickTeam = (side: 'homeIndex' | 'awayIndex', index: number) => {
    const other = side === 'homeIndex' ? 'awayIndex' : 'homeIndex'
    // The same club cannot play itself: swap if needed.
    if (q[other] === index) setQuickMatch({ [side]: index, [other]: q[side] })
    else setQuickMatch({ [side]: index })
  }

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
                  {TEAM_LIBRARY.map((tm, i) => (
                    <option key={tm.name} value={i}>
                      {tm.name}
                    </option>
                  ))}
                </select>
              </label>
            )
          })}
        </div>

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
