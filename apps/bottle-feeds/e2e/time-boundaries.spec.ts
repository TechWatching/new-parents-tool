import { expect, test } from '@playwright/test'
import { seedDatabase } from './helpers/seed-db'

test.use({ locale: 'en-GB', timezoneId: 'Europe/Paris' })

test('summary, intake, bottle count, and report preview age together without feed edits', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-09-10T12:00:00+02:00') })
  await seedDatabase(page, {
    feeds: [{
      id: 'aging',
      amount: 120,
      occurredAt: '2026-09-09T12:01:00+02:00',
      comment: '',
      updatedAt: '2026-09-09T12:01:00+02:00',
    }],
    weights: [],
  })
  await page.locator('.range-toggle button').first().click()
  await page.locator('[aria-controls="report-panel"]').click()

  const summary = page.locator('.summary-grid strong')
  const intake = page.getByRole('img', { name: 'Bottle quantity', exact: true })
  const bottles = page.locator('.bottle-count-chart')
  const previewCount = page.locator('#report-panel [aria-live="polite"] strong').first()
  await expect(summary.nth(0)).toHaveText('1')
  await expect(summary.nth(1)).toHaveText('120 ml')
  await expect(intake.locator('.bar-value')).toHaveText(['120'])
  await expect(bottles.locator('.bar-value')).toHaveText(['1'])
  await expect(previewCount).toHaveText('1')

  await page.clock.fastForward(120_000)

  await expect(summary.nth(0)).toHaveText('0')
  await expect(summary.nth(1)).toHaveText('0 ml')
  await expect(intake.locator('.bar-value')).toHaveCount(0)
  await expect(bottles.locator('.bar-value')).toHaveCount(0)
  await expect(page.locator('.rolling-intake-amount').last()).toHaveText('')
  await expect(previewCount).toHaveText('0')
})

test('seven-day charts drop the oldest calendar day after midnight without feed edits', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-09-10T23:59:00+02:00') })
  await seedDatabase(page, {
    feeds: [{
      id: 'oldest-day',
      amount: 120,
      occurredAt: '2026-09-04T12:00:00+02:00',
      comment: '',
      updatedAt: '2026-09-04T12:00:00+02:00',
    }],
    weights: [],
  })
  const intake = page.getByRole('img', { name: 'Bottle quantity', exact: true })
  await expect(intake.locator('.bar-value')).toHaveText(['120'])
  await expect(page.locator('.bottle-count-chart .bar-value')).toHaveText(['1'])

  await page.clock.fastForward(120_000)

  await expect(intake.locator('.bar-value')).toHaveCount(0)
  await expect(page.locator('.bottle-count-chart .bar-value')).toHaveCount(0)
})

test('report charts include the first partial day and match rolling-boundary summaries', async ({ page }) => {
  await page.goto('/')
  const result = await page.evaluate(async () => {
    const modulePath = '/src/report/logic.ts'
    const logic = await import(/* @vite-ignore */ modulePath) as typeof import('../src/report/logic')
    const now = new Date('2026-09-10T12:00:00+02:00')
    return (['24h', '7d'] as const).map((range) => {
      const start = now.getTime() - (range === '24h' ? 1 : 7) * 86_400_000
      const feeds = [start - 1, start, start + 6 * 3_600_000, now.getTime(), now.getTime() + 1]
        .map((time, index) => ({
          id: String(index), amount: 120, occurredAt: new Date(time).toISOString(), updatedAt: '', comment: '',
        }))
      const snapshot = logic.createReportSnapshot(feeds, [], { ...logic.createDefaultReportConfig(now), range }, now)
      const points = logic.createReportFeedChartPoints(snapshot, 'en-GB')
      return {
        range,
        summary: snapshot.feedSummary.totalAmount,
        chartTotal: points.reduce((sum, point) => sum + point.totalAmount, 0),
        chartCount: points.reduce((sum, point) => sum + point.bottleCount, 0),
        firstDayAmount: range === '7d' ? points[0]?.totalAmount : null,
      }
    })
  })

  expect(result).toEqual([
    { range: '24h', summary: 360, chartTotal: 360, chartCount: 3, firstDayAmount: null },
    { range: '7d', summary: 360, chartTotal: 360, chartCount: 3, firstDayAmount: 240 },
  ])
})

test('custom reports follow 23-hour and 25-hour Paris calendar days', async ({ page }) => {
  await page.goto('/')
  const result = await page.evaluate(async () => {
    const modulePath = '/src/report/logic.ts'
    const logic = await import(/* @vite-ignore */ modulePath) as typeof import('../src/report/logic')
    return ['2026-03-29', '2026-10-25'].map((date) => {
      const config = { ...logic.createDefaultReportConfig(), range: 'custom' as const, startDate: date, endDate: date }
      const midnight = new Date(`${date}T00:00:00`)
      midnight.setDate(midnight.getDate() + 1)
      const snapshot = logic.createReportSnapshot([
        { id: 'last', amount: 120, occurredAt: new Date(midnight.getTime() - 1).toISOString(), updatedAt: '', comment: '' },
        { id: 'next', amount: 90, occurredAt: midnight.toISOString(), updatedAt: '', comment: '' },
      ], [], config)
      const points = logic.createReportFeedChartPoints(snapshot, 'en-GB')
      return {
        date,
        durationHours: (snapshot.period.endAt!.getTime() + 1 - snapshot.period.startAt!.getTime()) / 3_600_000,
        ids: snapshot.feeds.map((feed) => feed.id),
        total: snapshot.feedSummary.totalAmount,
        points: points.length,
        chartTotal: points.reduce((sum, point) => sum + point.totalAmount, 0),
      }
    })
  })

  expect(result).toEqual([
    { date: '2026-03-29', durationHours: 23, ids: ['last'], total: 120, points: 1, chartTotal: 120 },
    { date: '2026-10-25', durationHours: 25, ids: ['last'], total: 120, points: 1, chartTotal: 120 },
  ])
})
