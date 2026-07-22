import { test, expect } from '@playwright/test'
import { seedDatabase } from './helpers/seed-db'
import { fullAppData } from './fixtures/test-data'

/**
 * Reference timestamp used to freeze time for deterministic tests.
 * All seeded feeds fall between 2026-07-13 and 2026-07-15, so using
 * 2026-07-15T12:00Z as "now" places them within the 7-day and 24h windows.
 */
const FROZEN_NOW = new Date('2026-07-15T12:00:00.000Z')

test.describe('Summary metrics', () => {
  test('shows empty state metrics when no data exists', async ({ page }) => {
    await page.goto('/')

    const summary = page.locator('.summary-grid')
    await expect(summary.getByText('Last 24 hours')).toBeVisible()
    // No weight recorded yet — the weight card shows '—'
    const weightCard = summary.locator('.metric-card').filter({ hasText: 'Latest weight' })
    await expect(weightCard.locator('strong')).toContainText('—')
    // Guide hint when no weight is recorded
    await expect(page.getByText('Add a weight to see the guide')).toBeVisible()
  })

  test('shows correct 24-hour bottle count from seeded data', async ({ page }) => {
    // Freeze time so the 24h window is deterministic.
    // At 2026-07-15T12:00Z the 24h cutoff is 2026-07-14T12:00Z.
    // Seeded feeds within that window: feed-1 (10:30), feed-2 (07:00),
    // feed-3 (Jul 14 20:00), feed-4 (Jul 14 14:00) → 4 bottles.
    await seedDatabase(page, fullAppData, FROZEN_NOW)

    const bottleCountCard = page.locator('.metric-card').filter({ hasText: 'Last 24 hours' })
    await expect(bottleCountCard.locator('strong')).toContainText('4')
  })

  test('shows latest weight and daily guide in summary', async ({ page }) => {
    await seedDatabase(page, fullAppData)

    // Latest weight: 4.2 kg
    const weightCard = page.locator('.metric-card').filter({ hasText: 'Latest weight' })
    await expect(weightCard.locator('strong')).toContainText('4.2')

    // Daily guide: (4200 / 10) + 200 = 620 ml
    const guideCard = page.locator('.guide-card')
    await expect(guideCard.locator('strong')).toContainText('620')
    await expect(page.getByText('Estimated theoretical daily quantity')).toBeVisible()
  })
})

test.describe('Trends charts', () => {
  test('shows the trends section with seeded data', async ({ page }) => {
    await seedDatabase(page, fullAppData, FROZEN_NOW)

    await expect(page.getByRole('heading', { name: 'Trends' })).toBeVisible()
  })

  test('shows the rolling 24h intake chart', async ({ page }) => {
    // Freeze time so the seeded feeds fall within the 7-day window and the
    // rolling-intake chart renders (it requires at least one non-zero point).
    await seedDatabase(page, fullAppData, FROZEN_NOW)

    await expect(page.getByText('Quantity fed (rolling 24h)')).toBeVisible()
    await expect(page.locator('.rolling-intake-chart')).toBeVisible()
  })

  test('shows the bottles per day chart', async ({ page }) => {
    await seedDatabase(page, fullAppData, FROZEN_NOW)

    await expect(page.getByText('Bottles per day')).toBeVisible()
    await expect(page.locator('.bottle-count-chart')).toBeVisible()
  })

  test('switches between 7-day and 24-hour range', async ({ page }) => {
    await seedDatabase(page, fullAppData, FROZEN_NOW)

    // Default is 7 days (7 columns)
    await expect(page.locator('.rolling-intake-col')).toHaveCount(7)

    // Switch to 24-hour view (6 four-hour buckets)
    await page.getByRole('button', { name: '24 hours' }).click()
    await expect(page.locator('.rolling-intake-col')).toHaveCount(6)

    // Switch back to 7 days
    await page.getByRole('button', { name: '7 days' }).click()
    await expect(page.locator('.rolling-intake-col')).toHaveCount(7)
  })
})
