import { test, expect } from '@playwright/test'
import { seedDatabase } from './helpers/seed-db'
import { fullAppData, minimalAppData } from './fixtures/test-data'

test.describe('Bottle feed recording', () => {
  test('records a new bottle and shows it in the history', async ({ page }) => {
    await page.goto('/')

    // Fill in the feed form
    await page.locator('.feed-card input[type="number"]').fill('120')
    await page.locator('.feed-card input[type="date"]').fill('2026-07-15')
    await page.locator('.feed-card input[inputmode="numeric"]').fill('10:30')
    await page.locator('.feed-card input[maxlength="160"]').fill('Drank quickly')
    await page.locator('.feed-card').getByRole('button', { name: 'Save bottle' }).click()

    // Toast notification appears
    await expect(page.getByText('Bottle recorded', { exact: true })).toBeVisible()

    // Entry is visible in the measure history
    await expect(page.locator('.measure-tree-entry').getByText('120 ml')).toBeVisible()
    await expect(page.locator('.measure-tree-entry').getByText('Drank quickly')).toBeVisible()
  })

  test('records multiple bottles and shows total in summary', async ({ page }) => {
    await page.goto('/')

    // First bottle — leave the date as today's default so both land in the last 24h
    await page.locator('.feed-card input[type="number"]').fill('100')
    await page.locator('.feed-card input[inputmode="numeric"]').fill('08:00')
    await page.locator('.feed-card').getByRole('button', { name: 'Save bottle' }).click()
    // Wait for the first toast to appear, confirming the first save succeeded
    await expect(page.getByText('Bottle recorded', { exact: true }).first()).toBeVisible()

    // Second bottle
    await page.locator('.feed-card input[type="number"]').fill('80')
    await page.locator('.feed-card input[inputmode="numeric"]').fill('11:00')
    await page.locator('.feed-card').getByRole('button', { name: 'Save bottle' }).click()
    await expect(page.getByText('Bottle recorded', { exact: true }).first()).toBeVisible()

    // Summary section shows 2 bottles in the last 24h card
    const bottleCountCard = page.locator('.metric-card').filter({ hasText: 'Last 24 hours' })
    await expect(bottleCountCard.locator('strong')).toContainText('2')
  })

  test('shows time since last bottle after recording', async ({ page }) => {
    await seedDatabase(page, minimalAppData)

    const banner = page.locator('.last-bottle-banner')
    await expect(banner).toBeVisible()
    await expect(banner.locator('span')).toHaveCount(2)
    await expect(banner.locator('span').first()).toContainText('after the last bottle')
    await expect(banner.locator('span').last()).toContainText(/15 Jul.*120 mL/)
  })

  test('groups measures by day and labels the selected tab', async ({ page }) => {
    await seedDatabase(page, fullAppData)

    const measures = page.locator('.measure-card')
    await expect(measures.getByRole('heading', { name: 'Quantities' })).toBeVisible()
    await expect(measures.locator('.measure-day-button')).toHaveCount(3)

    await measures.getByRole('tab', { name: 'Weights' }).click()
    await expect(measures.getByRole('heading', { name: 'Weights' })).toBeVisible()
    await expect(measures.locator('.measure-day-button')).toHaveCount(3)
  })

  test('edits an existing bottle feed in the history', async ({ page }) => {
    await seedDatabase(page, fullAppData)

    // Click edit on the first item in the list
    await page.locator('.measure-tree-entry').first().getByRole('button', { name: 'Edit' }).click()

    const actions = page.locator('.measure-tree-entry form .measure-actions')
    await expect(actions.getByRole('button', { name: 'Save' })).toBeVisible()
    await expect(actions.getByRole('button', { name: 'Cancel' })).toBeVisible()

    await page.locator('#edit-feed-amount').fill('150')
    await actions.getByRole('button', { name: 'Save' }).click()

    await expect(page.locator('.measure-tree-entry').getByText('150 ml')).toBeVisible()
  })

  test('deletes a bottle feed from the history', async ({ page }) => {
    await seedDatabase(page, minimalAppData)

    const list = page.locator('.measure-tree-entry')
    await expect(list).toHaveCount(1)

    await list.getByRole('button', { name: 'Delete 120 ml' }).click()
    await expect(page.getByRole('dialog', { name: 'Delete this measure?' })).toBeVisible()
    await expect(page.getByText('This will remove 120 ml, recorded on')).toBeVisible()
    await expect(list).toHaveCount(1)

    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect(list).toHaveCount(1)

    await list.getByRole('button', { name: 'Delete 120 ml' }).click()
    await page.getByRole('button', { name: 'Delete measure' }).click()

    await expect(list).toHaveCount(0)
    await expect(page.locator('.empty-state')).toBeVisible()
  })
})
