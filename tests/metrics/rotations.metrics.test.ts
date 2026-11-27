import { writeFileSync, mkdirSync } from 'node:fs'
import { it } from 'vitest'
import { measure } from './rotationMetrics'

// 6 seeds x 6 min = 36 min per configuration (team 0 under test vs the default 3-1).
// Results go to tests/metrics/results/<label>.json (METRIC_LABEL, default "latest").
const SEEDS = [1, 2, 3, 4, 5, 6]
const SECONDS = Number(process.env.METRIC_SECONDS ?? 360)

it('rotation metrics', () => {
  const rows = []
  for (const formation of ['3-1', '4-0', '2-2'] as const)
    for (const rotations of [true, false])
      rows.push(
        measure(`${formation} rot ${rotations ? 'on' : 'off'}`, { formation, rotations }, SEEDS, SECONDS),
      )
  mkdirSync('tests/metrics/results', { recursive: true })
  writeFileSync(
    `tests/metrics/results/${process.env.METRIC_LABEL ?? 'latest'}.json`,
    JSON.stringify(rows, null, 2),
  )
  console.table(rows)
}, 1_200_000)
