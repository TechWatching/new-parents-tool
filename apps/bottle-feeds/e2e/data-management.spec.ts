import { test, expect } from '@playwright/test'
import { seedDatabase } from './helpers/seed-db'
import { fullAppData } from './fixtures/test-data'
import type { AppData } from '../../src/types'
import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'

test.describe('Data export', () => {
  test('exports data as a JSON file', async ({ page }) => {
    await seedDatabase(page, fullAppData)

    // Start waiting for the download before clicking the button
    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Export data' }).click()
    const download = await downloadPromise

    expect(download.suggestedFilename()).toMatch(/^little-sips-export-\d{4}-\d{2}-\d{2}\.json$/)
  })
})

test.describe('Data import', () => {
  test('imports a valid JSON file and shows success feedback', async ({ page }) => {
    await page.goto('/')

    const importData: AppData = {
      feeds: [
        {
          id: 'imported-feed-1',
          amount: 95,
          occurredAt: '2026-07-10T09:00:00.000Z',
          comment: 'Imported bottle',
          updatedAt: '2026-07-10T09:00:00.000Z',
        },
      ],
      weights: [
        {
          id: 'imported-weight-1',
          kilograms: 3.9,
          occurredAt: '2026-07-10T00:00:00.000Z',
          updatedAt: '2026-07-10T00:00:00.000Z',
        },
      ],
    }

    // Write the import file to a temp location
    const tmpFile = path.join(os.tmpdir(), 'little-sips-import-test.json')
    fs.writeFileSync(tmpFile, JSON.stringify(importData, null, 2))

    // Trigger the hidden file input
    const fileInput = page.locator('input[type="file"][accept]')
    await fileInput.setInputFiles(tmpFile)

    await expect(page.locator('.import-feedback--ok')).toBeVisible()
    await expect(page.getByText('Data imported successfully.')).toBeVisible()

    // Imported feed appears in the history
    await expect(page.locator('.measure-tree-entry').getByText('95 ml')).toBeVisible()

    fs.unlinkSync(tmpFile)
  })

  test('shows an error message for an invalid import file', async ({ page }) => {
    await page.goto('/')

    const tmpFile = path.join(os.tmpdir(), 'little-sips-invalid.json')
    fs.writeFileSync(tmpFile, JSON.stringify({ not: 'valid app data' }))

    const fileInput = page.locator('input[type="file"][accept]')
    await fileInput.setInputFiles(tmpFile)

    await expect(page.locator('.import-feedback--err')).toBeVisible()
    await expect(page.getByText('Could not import: invalid file format.')).toBeVisible()

    fs.unlinkSync(tmpFile)
  })
})

test.describe('PDF report generation', () => {
  test('opens the report options panel', async ({ page }) => {
    await seedDatabase(page, fullAppData)

    await page.getByRole('button', { name: 'Generate report' }).click()

    await expect(page.getByText('Report options')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Download PDF' })).toBeVisible()
  })

  test('shows validation errors when no categories are selected', async ({ page }) => {
    await page.goto('/')

    await page.getByRole('button', { name: 'Generate report' }).click()

    // Uncheck both categories
    const checkboxes = page.locator('.report-fieldset input[type="checkbox"]')
    await checkboxes.nth(0).uncheck()
    await checkboxes.nth(1).uncheck()

    await page.getByRole('button', { name: 'Download PDF' }).click()

    await expect(
      page.getByText('Select bottle feeds or weight measurements to include.'),
    ).toBeVisible()
  })

  test('shows a date order validation error when end is before start', async ({ page }) => {
    await page.goto('/')

    await page.getByRole('button', { name: 'Generate report' }).click()

    // Select custom date range
    await page.locator('input[value="custom"]').check()

    const dateInputs = page.locator('.report-custom-range input[type="date"]')
    await dateInputs.nth(0).fill('2026-07-20')
    await dateInputs.nth(1).fill('2026-07-19')

    await page.getByRole('button', { name: 'Download PDF' }).click()

    await expect(
      page.getByText('The start date must be on or before the end date.'),
    ).toBeVisible()
  })
})
