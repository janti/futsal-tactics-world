import { useUi } from '../store'
import { useT } from '../useT'

/**
 * Player size setting (visual only; remembered). Shown in the settings and in the Camera Lab: how big
 * the players look depends on the camera too, so both are at hand where the camera is tuned.
 */
export function PlayerScaleSelect({ testId = 'setting-player-scale' }: { testId?: string }) {
  const t = useT()
  const playerScale = useUi((s) => s.playerScale)
  const setPlayerScale = useUi((s) => s.setPlayerScale)
  return (
    <select data-testid={testId} value={playerScale} onChange={(e) => setPlayerScale(Number(e.target.value))}>
      <option value={1}>{t('settings.playerScale.real')}</option>
      <option value={1.06}>106 %</option>
      <option value={1.12}>{t('settings.playerScale.default')}</option>
    </select>
  )
}
