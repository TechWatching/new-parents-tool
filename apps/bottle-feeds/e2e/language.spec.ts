import { test, expect, type Page } from '@playwright/test'

async function selectLanguage(page: Page, label: 'Language' | 'Langue', language: 'English' | 'Français') {
  await page.getByRole('button', { name: label }).click()
  await page.getByRole('option', { name: new RegExp(language) }).click()
}

test.describe('Language switching', () => {
  test('defaults to English', async ({ page }) => {
    await page.goto('/')

    await expect(page.getByRole('heading', { name: 'Record a bottle' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Record a weight' })).toBeVisible()
    await expect(page.getByText('Bottle and growth tracker')).toBeVisible()
  })

  test('switches to French when the language button is clicked', async ({ page }) => {
    await page.goto('/')

    await selectLanguage(page, 'Language', 'Français')

    await expect(page.getByRole('heading', { name: 'Noter un biberon' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Noter un poids' })).toBeVisible()
    await expect(page.getByText('Suivi des biberons et de la croissance')).toBeVisible()
  })

  test('switches back to English from French', async ({ page }) => {
    await page.goto('/')

    // Switch to French
    await selectLanguage(page, 'Language', 'Français')
    await expect(page.getByRole('heading', { name: 'Noter un biberon' })).toBeVisible()

    // Switch back to English
    await selectLanguage(page, 'Langue', 'English')
    await expect(page.getByRole('heading', { name: 'Record a bottle' })).toBeVisible()
  })

  test('remembers language preference across page reloads', async ({ page }) => {
    await page.goto('/')

    // Switch to French
    await selectLanguage(page, 'Language', 'Français')
    await expect(page.getByRole('heading', { name: 'Noter un biberon' })).toBeVisible()

    // Reload the page
    await page.reload()

    // Language should still be French
    await expect(page.getByRole('heading', { name: 'Noter un biberon' })).toBeVisible()
  })

  test('uses French labels in the feed form when French is active', async ({ page }) => {
    await page.goto('/')
    await selectLanguage(page, 'Language', 'Français')

    await expect(page.locator('.feed-card').getByText('Quantité (ml)')).toBeVisible()
    await expect(page.locator('.feed-card').getByRole('button', { name: 'Enregistrer' })).toBeVisible()
  })

  test('uses French labels in the weight form when French is active', async ({ page }) => {
    await page.goto('/')
    await selectLanguage(page, 'Language', 'Français')

    await expect(page.locator('.weight-card').getByText('Poids (kg)')).toBeVisible()
    await expect(
      page.locator('.weight-card').getByRole('button', { name: 'Enregistrer le poids' }),
    ).toBeVisible()
  })
})
