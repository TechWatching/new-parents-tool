import { test, expect } from '@playwright/test'
import { seedDatabase } from './helpers/seed-db'
import { fullAppData, REFERENCE_DATE, sampleWeights } from './fixtures/test-data'

const MINT_500_RGB = 'rgb(114, 183, 160)'
const SAGE_800_RGB = 'rgb(52, 64, 60)'

test.describe('Weight recording', () => {
  test('records a new weight and shows it in the history', async ({ page }) => {
    await page.goto('/')

    const saveButton = page.locator('.weight-card').getByRole('button', { name: 'Save weight' })
    await expect(saveButton).toHaveCSS('background-color', MINT_500_RGB)
    await expect(saveButton).toHaveCSS('color', SAGE_800_RGB)

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

  test('aligns the theoretical quantity landmark with the intake chart scale', async ({ page }) => {
    await seedDatabase(
      page,
      {
        feeds: [
          {
            id: 'feed-700',
            amount: 700,
            occurredAt: REFERENCE_DATE,
            comment: '',
            updatedAt: REFERENCE_DATE,
          },
        ],
        weights: [sampleWeights[0]!],
      },
      new Date(REFERENCE_DATE),
    )

    const intakeChart = page.locator('.chart-plot').first()
    const guideLine = intakeChart.locator('.intake-guide-line')
    const maximumBar = intakeChart.locator('i').last()
    await intakeChart.scrollIntoViewIfNeeded()

    const [lineBox, barBox] = await Promise.all([guideLine.boundingBox(), maximumBar.boundingBox()])
    expect(lineBox).not.toBeNull()
    expect(barBox).not.toBeNull()

    const expectedLineTop = barBox!.y + barBox!.height * (1 - 620 / 700)
    const lineCenter = lineBox!.y + lineBox!.height / 2
    expect(Math.abs(lineCenter - expectedLineTop)).toBeLessThan(1)
  })

  test('keeps the maximum intake value visible above its bar', async ({ page }) => {
    const dailyAmounts = [500, 450, 480, 400, 500, 430, 670]
    const feeds = dailyAmounts.map((amount, index) => {
      const occurredAt = new Date('2026-07-09T12:00:00.000Z')
      occurredAt.setUTCDate(occurredAt.getUTCDate() + index)
      return {
        id: `feed-${amount}-${index}`,
        amount,
        occurredAt: occurredAt.toISOString(),
        comment: '',
        updatedAt: occurredAt.toISOString(),
      }
    })

    await seedDatabase(
      page,
      {
        feeds,
        weights: [
          {
            id: 'weight-guide-640',
            kilograms: 4.4,
            occurredAt: REFERENCE_DATE,
            updatedAt: REFERENCE_DATE,
          },
        ],
      },
      new Date(REFERENCE_DATE),
    )

    const intakeChart = page.locator('.chart-plot').first()
    const maximumValue = intakeChart.locator('.bar-value', { hasText: '670' })
    const guideLabel = intakeChart.locator('.intake-guide-line span')
    const [chartBox, valueBox, guideBox] = await Promise.all([
      intakeChart.boundingBox(),
      maximumValue.boundingBox(),
      guideLabel.boundingBox(),
    ])

    expect(chartBox).not.toBeNull()
    expect(valueBox).not.toBeNull()
    expect(guideBox).not.toBeNull()
    expect(chartBox!.height).toBe(220)
    expect(valueBox!.y).toBeGreaterThanOrEqual(chartBox!.y)
    expect(valueBox!.x).toBeGreaterThanOrEqual(chartBox!.x)
    expect(valueBox!.y + valueBox!.height).toBeLessThanOrEqual(chartBox!.y + chartBox!.height)
    expect(valueBox!.x + valueBox!.width).toBeLessThanOrEqual(chartBox!.x + chartBox!.width)
    const labelsOverlap =
      valueBox!.x < guideBox!.x + guideBox!.width &&
      valueBox!.x + valueBox!.width > guideBox!.x &&
      valueBox!.y < guideBox!.y + guideBox!.height &&
      valueBox!.y + valueBox!.height > guideBox!.y
    expect(labelsOverlap).toBe(false)
    await expect(maximumValue).toBeVisible()
    await expect(guideLabel).toContainText('640 ml')
  })

  test('keeps all-time chart labels readable and supports selecting a weight on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await seedDatabase(page, fullAppData, new Date(REFERENCE_DATE))
    await page.getByRole('button', { name: 'All time' }).click()

    const bottleChart = page.locator('.bottle-count-chart')
    await expect
      .poll(() => bottleChart.evaluate((chart) => chart.scrollWidth > chart.clientWidth))
      .toBe(true)
    await expect
      .poll(() => bottleChart.locator('small').first().evaluate((label) => getComputedStyle(label).whiteSpace))
      .toBe('nowrap')
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
      .toBe(true)

    const weightChart = page.locator('.chart-line').first()
    await weightChart.locator('.weight-chart-point').nth(1).click()
    await expect(weightChart.locator('.weight-chart-detail')).toHaveText('8 Jul 2026: 4 kg')
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
