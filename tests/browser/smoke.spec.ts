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
  test.setTimeout(330_000)
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
    const deadline = Date.now() + 120_000
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
  // Pass and shoot while our team has the ball after the kick-off; getBall defends and wins it back
  // only if possession was lost.
  const e0 = await events(page)
  await getBall()
  await press('KeyZ')
  await page.waitForFunction((n) => (window.__FTW__!.eventCounts.PassStarted ?? 0) > n, e0.PassStarted ?? 0)

  await getBall()
  const e1 = await events(page)
  await press('KeyX', 200)
  await page.waitForFunction((n) => (window.__FTW__!.eventCounts.ShotTaken ?? 0) > n, e1.ShotTaken ?? 0)

  // Movement: hold "up" (the human team attacks the top of the screen).
  const before = await state(page)
  const id = before.controlledId!
  await page.keyboard.down('ArrowUp')
  await page.waitForTimeout(600)
  await page.keyboard.up('ArrowUp')
  const after = await state(page)
  const moved = after.players[after.controlledId!]!.pos.y - before.players[id]!.pos.y
  expect(Math.abs(moved)).toBeGreaterThan(0.5)

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
  // Eight seconds of play; restarts of our own (a ball kicked out) are taken so the effective clock
  // does not stand still waiting for us.
  for (let i = 0; i < 16; i++) {
    await page.waitForTimeout(500)
    const ours = await page.evaluate(() => {
      const s = window.__FTW__!.getState()
      return s.restart?.ready === true && s.restart.team === 0 && s.controlledId === s.restart.takerId
    })
    if (ours) {
      await page.keyboard.down('KeyZ')
      await page.waitForTimeout(60)
      await page.keyboard.up('KeyZ')
    }
  }
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

/** A fake standard gamepad the test can press buttons on (window.__pad.buttons[i] = true/false). */
const FAKE_PAD = () => {
  const pad = { buttons: Array.from({ length: 17 }, () => false), axes: [0, 0, 0, 0] }
  ;(window as unknown as { __pad: typeof pad }).__pad = pad
  navigator.getGamepads = () =>
    [
      {
        id: 'fake',
        index: 0,
        connected: true,
        mapping: 'standard',
        timestamp: 0,
        axes: pad.axes,
        buttons: pad.buttons.map((p) => ({ pressed: p, touched: p, value: p ? 1 : 0 })),
        vibrationActuator: null,
        hapticActuators: [],
      },
    ] as unknown as (Gamepad | null)[]
}

async function padPress(page: Page, button: number) {
  await page.evaluate(
    (b) => ((window as unknown as { __pad: { buttons: boolean[] } }).__pad.buttons[b] = true),
    button,
  )
  await page.waitForTimeout(80)
  await page.evaluate(
    (b) => ((window as unknown as { __pad: { buttons: boolean[] } }).__pad.buttons[b] = false),
    button,
  )
  await page.waitForTimeout(80)
}

test('gamepad: Start pauses, B resumes; menus can be navigated and activated with the pad', async ({
  page,
}) => {
  await page.addInitScript(FAKE_PAD)
  await page.goto('/?gfx=low')
  // Title menu: A on the focused Quick Match button opens the setup screen; A again starts.
  await padPress(page, 0)
  await expect(page.getByTestId('setup-screen')).toBeVisible()
  await page.getByTestId('start-match').focus()
  await padPress(page, 0)
  await page.waitForFunction(() => window.__FTW__?.getState() !== undefined)
  await padPress(page, 9) // Start
  await expect(page.getByTestId('pause-menu')).toBeVisible()
  await padPress(page, 1) // B
  await expect(page.getByTestId('pause-menu')).toBeHidden()
})

test('settings: passing assistance, rebound keys and difficulty reach the match', async ({ page }) => {
  await page.goto('/?gfx=low')
  await page.getByTestId('setting-pass-assist').selectOption('manual')
  await page.getByTestId('keys-panel').locator('summary').click()
  await page.getByTestId('bind-pass').click()
  await page.keyboard.press('KeyQ')
  await expect(page.getByTestId('bind-pass')).toContainText('Q')
  await page.getByTestId('quick-match').click()
  await page.getByTestId('difficulty-hard').click()
  await page.getByTestId('start-match').click()
  await page.waitForFunction(() => window.__FTW__?.getState().restart?.ready === true, undefined, {
    timeout: 15_000,
  })
  const info = await page.evaluate(() => {
    const s = window.__FTW__!.getState()
    return { assist: s.control.passAssist, difficulty: s.difficulty }
  })
  expect(info).toEqual({ assist: 'manual', difficulty: 'hard' })
  // Kick off with the rebound key (manual passing: tap = soft pass).
  await page.keyboard.down('KeyQ')
  await page.waitForTimeout(60)
  await page.keyboard.up('KeyQ')
  await page.waitForFunction(() => window.__FTW__?.getState().phase === 'play', undefined, { timeout: 5_000 })
  await page.reload()
  await expect(page.getByTestId('setting-pass-assist')).toHaveValue('manual')
})

test('camera and visuals: radar, horizontal camera, Camera Lab and graphics setting', async ({ page }) => {
  await page.goto('/?gfx=low')
  await expect(page.getByTestId('setting-radar')).toBeChecked()
  await page.getByTestId('setting-graphics').selectOption('medium')
  await page.getByTestId('quick-match').click()
  await page.getByTestId('start-match').click()
  await page.waitForFunction(() => window.__FTW__?.getState().restart?.ready === true, undefined, {
    timeout: 15_000,
  })
  await expect(page.getByTestId('radar')).toBeVisible()

  // Horizontal camera from the pause menu: the radar turns landscape.
  await page.keyboard.press('Escape')
  await page.getByTestId('pause-menu').getByTestId('setting-camera').selectOption('horizontalTactical')
  await page.getByTestId('pause-menu').getByTestId('setting-radar').uncheck()
  await page.keyboard.press('Escape') // closes the menu even with the checkbox focused
  await expect(page.getByTestId('pause-menu')).toBeHidden()
  await expect(page.getByTestId('radar')).toBeHidden()
  await page.keyboard.press('Escape')
  await page.getByTestId('pause-menu').getByTestId('setting-radar').check()
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)
  const box = await page.getByTestId('radar').boundingBox()
  expect(box!.width).toBeGreaterThan(box!.height)

  // Camera Lab with key 6: moving a slider switches to the custom camera and is remembered.
  await page.keyboard.press('Digit6')
  await expect(page.getByTestId('camera-lab')).toBeVisible()
  await page.getByTestId('lab-orientation-vertical').click()
  await page.getByTestId('lab-visibleLength').fill('35')
  // Player size is at hand in the lab too (the same remembered setting).
  await page.getByTestId('lab-player-scale').selectOption('1.06')
  await expect.poll(() => page.evaluate(() => localStorage.getItem('ftw.playerScale'))).toBe('1.06')
  await page.getByTestId('lab-player-scale').selectOption('1.12')
  await expect.poll(() => page.evaluate(() => localStorage.getItem('ftw.camera'))).toBe('custom')
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('ftw.customCamera') ?? '{}'))
  expect(stored.visibleLength).toBe(35)
  await page.keyboard.press('Digit6')
  await expect(page.getByTestId('camera-lab')).toBeHidden()
  expect(await page.evaluate(() => localStorage.getItem('ftw.graphics'))).toBe('medium')

  // Player size still applies after the Camera Lab: the drawn models follow the setting both ways.
  const playerScales = () =>
    page.evaluate(() => {
      type Obj = { type: string; children: Obj[]; scale: { y: number } }
      const scene = window.__FTW__!.scene as Obj
      const out: number[] = []
      const walk = (o: Obj) => {
        // Player roots: scaled groups (height / 178 x the visual size) with one child, the body.
        if (o.type === 'Group' && o.children.length === 1 && Math.abs(o.scale.y - 1) > 1e-3)
          out.push(o.scale.y)
        o.children.forEach(walk)
      }
      walk(scene)
      return out.reduce((a, b) => a + b, 0) / out.length
    })
  const big = await playerScales()
  await page.keyboard.press('Escape')
  await page.getByTestId('pause-menu').getByTestId('setting-player-scale').selectOption('1')
  await expect.poll(playerScales).toBeLessThan(big / 1.1)
  await page.getByTestId('pause-menu').getByTestId('setting-player-scale').selectOption('1.12')
  await expect.poll(playerScales).toBeCloseTo(big, 5)
})

test('Tactical Lab: scenario, modes, AI view, attempts counted', async ({ page }) => {
  test.setTimeout(120_000)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/?gfx=low')
  await page.getByTestId('tactical-lab-open').click()
  await expect(page.getByTestId('tactical-lab')).toBeVisible()
  // The breakaway: short attempts, started again automatically.
  await page.getByTestId('tlab-scenario').selectOption('breakaway')
  await expect.poll(() => page.evaluate(() => window.__FTW__!.getState().ball.ownerId)).not.toBeNull()
  await expect
    .poll(async () => Number(await page.getByTestId('tlab-attempts').textContent()), { timeout: 60_000 })
    .toBeGreaterThanOrEqual(1)
  // AI view on: the overlay canvas is shown.
  await page.getByTestId('tlab-ai-debug').check()
  await expect(page.getByTestId('ai-debug-overlay')).toBeVisible()
  // Defend: the match is rebuilt with you on the defending team (the opponents have the ball).
  await page.getByTestId('tlab-mode-defend').click()
  await expect
    .poll(() =>
      page.evaluate(() => {
        const s = window.__FTW__!.getState()
        return s.humanTeam === 0 && s.possessionTeam === 1 && s.players[s.controlledId!]!.team === 0
      }),
    )
    .toBe(true)
  // Leave the lab from the pause menu.
  await page.keyboard.press('Escape')
  await page.getByTestId('pause-menu').getByTestId('quit').click()
  await expect(page.getByTestId('tactical-lab-open')).toBeVisible()
  expect(errors).toEqual([])
})
