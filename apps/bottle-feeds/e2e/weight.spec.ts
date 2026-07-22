import { test, expect } from '@playwright/test'
import { seedDatabase } from './helpers/seed-db'
import { fullAppData, sampleWeights } from './fixtures/test-data'

test.describe('Weight recording', () => {
  test('records a new weight and shows it in the history', async ({ page }) => {
    await page.goto('/')

    await page.locator('.weight-card input[type="number"]').fill('4.2')
    await page.locator('.weight-card input[type="date"]').fill('2026-07-15')
    await page.locator('.weight-card').getByRole('button', { name: 'Save weight' }).click()

    // Toast notification appears
    await expect(page.getByText('Weight recorded', { exact: true })).toBeVisible()
    await expect(page.getByText('4.2 kg', { exact: true }).first()).toBeVisible()
  })

  test('shows estimated daily quantity after recording a weight', async ({ page }) => {
    await page.goto('/')

    await page.locator('.weight-card input[type="number"]').fill('4.2')
    await page.locator('.weight-card input[type="date"]').fill('2026-07-15')
    await page.locator('.weight-card').getByRole('button', { name: 'Save weight' }).click()

    // Daily guide = (4200 / 10) + 200 = 620 ml
    const guideCard = page.locator('.guide-card')
    await expect(guideCard.locator('strong')).toContainText('620')
    await expect(page.getByText('Estimated theoretical daily quantity')).toBeVisible()
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

  test('displays weight history in the weights tab', async ({ page }) => {
    await seedDatabase(page, fullAppData)

    // Switch to the Weights tab and wait for it to become active
    await page.getByRole('tab', { name: 'Weights' }).click()
    await expect(page.getByRole('tab', { name: 'Weights' })).toHaveAttribute('aria-selected', 'true')

    await expect(page.locator('.measure-list').getByText('4.2 kg')).toBeVisible()
    await expect(page.locator('.measure-list').getByText('3.8 kg')).toBeVisible()
  })

  test('edits an existing weight in the history', async ({ page }) => {
    await seedDatabase(page, { feeds: [], weights: [sampleWeights[0]!] })

    await page.getByRole('tab', { name: 'Weights' }).click()
    await expect(page.getByRole('tab', { name: 'Weights' })).toHaveAttribute('aria-selected', 'true')
    await page.locator('.measure-list li').first().getByRole('button', { name: 'Edit' }).click()

    await page.locator('#edit-weight-kilograms').fill('4.5')
    await page.locator('.measure-list form').getByRole('button', { name: 'Save' }).click()

    await expect(page.locator('.measure-list').getByText('4.5 kg')).toBeVisible()
  })

  test('deletes a weight from the history', async ({ page }) => {
    await seedDatabase(page, { feeds: [], weights: [sampleWeights[0]!] })

    // Switch to the Weights tab and wait for it to become active
    await page.getByRole('tab', { name: 'Weights' }).click()
    await expect(page.getByRole('tab', { name: 'Weights' })).toHaveAttribute('aria-selected', 'true')

    await expect(page.locator('.measure-list li')).toHaveCount(1)
    await page.locator('.measure-list .delete-button').first().click()

    await expect(page.locator('.measure-list li')).toHaveCount(0)
    await expect(page.locator('.empty-state')).toBeVisible()
  })
})
