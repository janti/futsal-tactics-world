import { expect, test, type Page } from '@playwright/test'

/** Browser smoke test: loads, starts a quick match, moves, passes, shoots, switches camera, no console errors. */

type DebugState = {
  controlledId: number | null
  phase: string
  players: { pos: { x: number; y: number } }[]
  ball: { ownerId: number | null }
}

async function state(page: Page): Promise<DebugState> {
  return page.evaluate(() => {
    const s = window.__FTW__!.getState()
    return {
      controlledId: s.controlledId,
      phase: s.phase,
      players: s.players.map((p) => ({ pos: { ...p.pos } })),
      ball: { ownerId: s.ball.ownerId },
    }
  })
}

async function events(page: Page): Promise<Record<string, number>> {
  return page.evaluate(() => ({ ...window.__FTW__!.eventCounts }))
}

/** Kick-off cannot be dribbled: wait until the taker is at the ball, then pass (Z). */
async function takeKickOff(page: Page) {
  await page.waitForFunction(() => window.__FTW__?.getState().restart?.ready === true, undefined, {
    timeout: 15_000,
  })
  await page.keyboard.down('KeyZ')
  await page.waitForTimeout(60)
  await page.keyboard.up('KeyZ')
  await page.waitForFunction(() => window.__FTW__?.getState().phase === 'play', undefined, { timeout: 5_000 })
}

test('quick match: move, pass, shoot, camera, no console errors', async ({ page }) => {
  test.setTimeout(240_000)
  const errors: string[] = []
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  page.on('pageerror', (e) => errors.push(e.message))

  await page.goto('/?gfx=low')
  await page.getByTestId('quick-match').click()
  await page.getByTestId('start-match').click()
  await expect(page.getByTestId('game-canvas')).toBeVisible()
  await expect(page.getByTestId('scoreboard')).toBeVisible()
  // While waiting at the kick-off, movement input must not move the taker (no dribbling from restarts).
  await page.waitForFunction(() => window.__FTW__?.getState().restart?.ready === true, undefined, {
    timeout: 15_000,
  })
  const ballBefore = await page.evaluate(() => ({ ...window.__FTW__!.getState().ball.pos }))
  await page.keyboard.down('ArrowUp')
  await page.waitForTimeout(400)
  await page.keyboard.up('ArrowUp')
  const ballAfter = await page.evaluate(() => ({ ...window.__FTW__!.getState().ball.pos }))
  expect(ballAfter).toEqual(ballBefore)
  await takeKickOff(page)

  // Movement: hold "up" (the human team attacks the top of the screen).
  const before = await state(page)
  const id = before.controlledId!
  await page.keyboard.down('ArrowUp')
  await page.waitForTimeout(600)
  await page.keyboard.up('ArrowUp')
  const after = await state(page)
  const moved = after.players[after.controlledId!]!.pos.y - before.players[id]!.pos.y
  expect(Math.abs(moved)).toBeGreaterThan(0.5)

  // Passing and shooting: wait until we have the ball, then act.
  const press = async (key: string, ms = 60) => {
    await page.keyboard.down(key)
    await page.waitForTimeout(ms)
    await page.keyboard.up(key)
  }

  // Actively defend until the controlled player has the ball: steer towards it and tackle.
  // Screen mapping for the human team attacking the top: screen up = sim +y, screen right = sim -x.
  const getBall = async () => {
    const held = new Set<string>()
    const setKey = async (key: string, on: boolean) => {
      if (on && !held.has(key)) {
        await page.keyboard.down(key)
        held.add(key)
      } else if (!on && held.has(key)) {
        await page.keyboard.up(key)
        held.delete(key)
      }
    }
    let loops = 0
    const deadline = Date.now() + 90_000
    try {
      while (Date.now() < deadline) {
        const info = await page.evaluate(() => {
          const s = window.__FTW__!.getState()
          const c = s.controlledId !== null ? s.players[s.controlledId]! : null
          return {
            have:
              s.phase === 'play' &&
              s.ball.ownerId !== null &&
              s.ball.ownerId === s.controlledId &&
              s.players[s.controlledId]!.role !== 'GK', // keeper in hands throws instead
            keeperOnBall: c !== null && c.role === 'GK' && s.ball.ownerId === c.id,
            cx: c?.pos.x ?? 0,
            cy: c?.pos.y ?? 0,
            bx: s.ball.pos.x,
            by: s.ball.pos.y,
          }
        })
        if (info.have) return
        if (info.keeperOnBall) {
          // Our keeper has the ball: throw / pass it up the court (towards the top of the screen).
          for (const k of [...held]) await setKey(k, false)
          await page.keyboard.down('ArrowUp')
          await press('KeyZ', 300)
          await page.keyboard.up('ArrowUp')
          continue
        }
        const dx = info.bx - info.cx
        const dy = info.by - info.cy
        await setKey('ArrowRight', -dx > 0.3)
        await setKey('ArrowLeft', -dx < -0.3)
        await setKey('ArrowUp', dy > 0.3)
        await setKey('ArrowDown', dy < -0.3)
        await setKey('ShiftLeft', true)
        if (Math.hypot(dx, dy) < 1.2) await press('KeyZ', 40)
        else if (++loops % 15 === 0) await press('KeyV', 40)
        await page.waitForTimeout(60)
      }
      throw new Error('never won the ball')
    } finally {
      for (const k of [...held]) await page.keyboard.up(k)
    }
  }
  // Keep pressing switch while defending so a human player wins the ball back quickly.
  const e0 = await events(page)
  await getBall()
  await press('KeyZ')
  await page.waitForFunction((n) => (window.__FTW__!.eventCounts.PassStarted ?? 0) > n, e0.PassStarted ?? 0)

  await getBall()
  const e1 = await events(page)
  await press('KeyX', 200)
  await page.waitForFunction((n) => (window.__FTW__!.eventCounts.ShotTaken ?? 0) > n, e1.ShotTaken ?? 0)

  // Camera preset change via the browser-safe alternative key; must not touch the simulation.
  const camBefore = await page.evaluate(() => localStorage.getItem('ftw.camera') ?? 'verticalSmart')
  await press('Digit5')
  await expect.poll(() => page.evaluate(() => localStorage.getItem('ftw.camera'))).not.toBe(camBefore)

  // Pause menu
  await press('Escape')
  await expect(page.getByTestId('pause-menu')).toBeVisible()
  const t0 = await page.evaluate(() => window.__FTW__!.getState().tick)
  await page.waitForTimeout(300)
  expect(await page.evaluate(() => window.__FTW__!.getState().tick)).toBe(t0)

  expect(errors).toEqual([])
})

test('AI opponents participate and the clock runs', async ({ page }) => {
  await page.goto('/?gfx=low')
  await page.getByTestId('quick-match').click()
  await page.getByTestId('start-match').click()
  await takeKickOff(page)
  await page.waitForTimeout(8000)
  const info = await page.evaluate(() => ({
    playing: window.__FTW__!.getState().playingTime,
    events: { ...window.__FTW__!.eventCounts },
  }))
  expect(info.playing).toBeGreaterThan(4)
  expect(info.events.PassStarted ?? 0).toBeGreaterThan(0)
})

test('defensive player selection setting persists and reaches the running match', async ({ page }) => {
  await page.goto('/?gfx=low')
  const select = page.getByTestId('setting-defensive-switch')
  await expect(select).toHaveValue('nearest')
  await page.getByTestId('quick-match').click()
  await page.getByTestId('start-match').click()
  await page.waitForFunction(() => window.__FTW__?.getState().restart?.ready === true)
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('pause-menu')).toBeVisible()
  await page.getByTestId('pause-menu').getByTestId('setting-defensive-switch').selectOption('manual')
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => window.__FTW__?.getState().control.defensiveSwitch === 'manual')
  await page.reload()
  await expect(page.getByTestId('setting-defensive-switch')).toHaveValue('manual')
})

test('quick match setup, half-time and the full-time result screen', async ({ page }) => {
  await page.goto('/?gfx=low')
  await page.getByTestId('quick-match').click()
  await expect(page.getByTestId('setup-screen')).toBeVisible()
  await page.getByTestId('setup-away').selectOption({ index: 2 })
  await page.getByTestId('half-2').click()
  await page.getByTestId('start-match').click()
  await expect(page.getByTestId('clock')).toHaveText('02:00')
  await expect(page.getByTestId('half')).toHaveText('1.')
  await takeKickOff(page)
  // Fast-forward the clock to the end of the first half.
  await page.evaluate(() => {
    window.__FTW__!.getState().clock = 0.2
  })
  await page.waitForFunction(() => window.__FTW__!.getState().phase === 'halftime')
  await page.waitForFunction(() => window.__FTW__!.getState().half === 2, undefined, { timeout: 15_000 })
  await expect(page.getByTestId('half')).toHaveText('2.')
  // ...and to full time.
  await page.evaluate(() => {
    window.__FTW__!.getState().clock = 0.1
  })
  await expect(page.getByTestId('match-end')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('final-score')).toBeVisible()
  // Rematch starts a fresh match with the same setup.
  await page.getByTestId('rematch').click()
  await expect(page.getByTestId('match-end')).toBeHidden()
  await expect(page.getByTestId('clock')).toHaveText('02:00')
})
