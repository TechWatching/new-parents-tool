import { test, expect } from '@playwright/test'
import { seedDatabase } from './helpers/seed-db'
import { fullAppData, sampleWeights } from './fixtures/test-data'

test.describe('Weight recording', () => {
  test('records a new weight and shows it in the history', async ({ page }) => {
    await page.goto('/')

    const saveButton = page.locator('.weight-card').getByRole('button', { name: 'Save weight' })
    await expect(saveButton).toHaveCSS('background-color', 'rgb(114, 183, 160)')
    await expect(saveButton).toHaveCSS('color', 'rgb(52, 64, 60)')

    await page.locator('.weight-card input[type="number"]').fill('4.2')
    await page.locator('.weight-card input[type="date"]').fill('2026-07-15')
    await saveButton.click()

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

    await expect(page.locator('.measure-tree-entry').getByText('4.2 kg')).toBeVisible()

    // Older days are folded by default, so expand the oldest day to reveal it
    await page.locator('.measure-day-button').last().click()
    await expect(page.locator('.measure-tree-entry').getByText('3.8 kg')).toBeVisible()
  })

  test('edits an existing weight in the history', async ({ page }) => {
    await seedDatabase(page, { feeds: [], weights: [sampleWeights[0]!] })

    await page.getByRole('tab', { name: 'Weights' }).click()
    await expect(page.getByRole('tab', { name: 'Weights' })).toHaveAttribute('aria-selected', 'true')
    await page.locator('.measure-tree-entry').first().getByRole('button', { name: 'Edit' }).click()

    await page.locator('#edit-weight-kilograms').fill('4.5')
    await page.locator('.measure-tree-entry form').getByRole('button', { name: 'Save' }).click()

    await expect(page.locator('.measure-tree-entry').getByText('4.5 kg')).toBeVisible()
  })

  test('deletes a weight from the history', async ({ page }) => {
    await seedDatabase(page, { feeds: [], weights: [sampleWeights[0]!] })

    // Switch to the Weights tab and wait for it to become active
    await page.getByRole('tab', { name: 'Weights' }).click()
    await expect(page.getByRole('tab', { name: 'Weights' })).toHaveAttribute('aria-selected', 'true')

    await expect(page.locator('.measure-tree-entry')).toHaveCount(1)
    await page.getByRole('button', { name: 'Delete 4.2 kg' }).click()
    await expect(page.getByRole('dialog', { name: 'Delete this measure?' })).toBeVisible()
    await expect(page.locator('.measure-tree-entry')).toHaveCount(1)
    await page.getByRole('button', { name: 'Delete measure' }).click()

    await expect(page.locator('.measure-tree-entry')).toHaveCount(0)
    await expect(page.locator('.empty-state')).toBeVisible()
  })
})
