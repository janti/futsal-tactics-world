import type { TeamStats } from '../../simulation/MatchRules'
import type { TranslationKey } from '../../localization/i18n'
import { useUi } from '../store'
import { useT } from '../useT'

type Row = [TranslationKey, (s: TeamStats, o: TeamStats) => string]

function pct(a: number, b: number): string {
  return b > 0 ? `${Math.round((a / b) * 100)} %` : '–'
}

const ROWS: Row[] = [
  ['stats.shots', (s) => String(s.shots)],
  ['stats.shotsOnTarget', (s) => String(s.shotsOnTarget)],
  ['stats.possession', (s, o) => pct(s.possessionTicks, s.possessionTicks + o.possessionTicks)],
  ['stats.passes', (s) => `${s.passesCompleted} / ${s.passes}`],
  ['stats.saves', (s) => String(s.saves)],
  ['stats.corners', (s) => String(s.corners)],
  ['stats.kickIns', (s) => String(s.kickIns)],
]

/** Full-time screen: result and basic match statistics. */
export function MatchEnd() {
  const t = useT()
  const result = useUi((s) => s.result)
  const restartMatch = useUi((s) => s.restartMatch)
  const openSetup = useUi((s) => s.openSetup)
  const quit = useUi((s) => s.quitToTitle)
  if (!result) return null
  const [a, b] = result.stats
  return (
    <div className="pause-overlay" data-testid="match-end">
      <div className="pause-card end-card">
        <h2>{t('end.title')}</h2>
        <div className="end-score">
          <span className="end-team">
            <span className="sb-chip" style={{ background: result.colors[0] }} />
            {result.names[0]}
          </span>
          <span className="end-goals" data-testid="final-score">
            {result.score[0]} – {result.score[1]}
          </span>
          <span className="end-team">
            {result.names[1]}
            <span className="sb-chip" style={{ background: result.colors[1] }} />
          </span>
        </div>
        <table className="end-stats">
          <tbody>
            {ROWS.map(([key, f]) => (
              <tr key={key}>
                <td className="num">{f(a, b)}</td>
                <td className="label">{t(key)}</td>
                <td className="num">{f(b, a)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <button className="primary" autoFocus data-testid="rematch" onClick={restartMatch}>
          {t('end.rematch')}
        </button>
        <button onClick={openSetup}>{t('end.newMatch')}</button>
        <button onClick={quit}>{t('menu.quit')}</button>
      </div>
    </div>
  )
}
