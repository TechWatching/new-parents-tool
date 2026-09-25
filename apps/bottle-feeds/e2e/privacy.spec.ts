import { expect, test } from '@playwright/test'

test('links to the public French and English privacy policy from the homepage', async ({ page }) => {
  await page.goto('/')

  const link = page.getByRole('link', { name: 'Privacy policy' })
  await expect(link).toBeVisible()
  await expect(link).toHaveAttribute('href', '/privacy.html#en')
  await link.click()

  await expect(page).toHaveURL(/\/privacy\.html#en$/)
  await expect(page.getByRole('heading', { name: 'Privacy policy', exact: true, level: 2 })).toBeVisible()
  await expect(page.locator('#en > p').first()).toContainText('Little Sips is a service offered by Alexandre Nédélec.')
  await expect(page.locator('#fr > p').first()).toContainText('Little Sips est un service proposé par Alexandre Nédélec.')
  await expect(page.locator('#fr')).toContainText('Supabase')
  await expect(page.locator('#en')).toContainText('Supabase')
  await page.getByRole('link', { name: 'Français' }).click()
  await expect(page).toHaveURL(/\/privacy\.html#fr$/)
  await expect(page.getByRole('heading', { name: 'Politique de confidentialité' })).toBeVisible()
})

test('loads the policy directly and localizes the French homepage link', async ({ page }) => {
  await page.goto('/privacy.html')
  await expect(page.getByRole('heading', { name: 'Privacy policy', exact: true, level: 2 })).toBeVisible()
  await page.goto('/')
  await page.getByRole('button', { name: 'Language' }).click()
  await page.getByRole('option', { name: /Français/ }).click()
  await expect(page.getByRole('link', { name: 'Politique de confidentialité' })).toHaveAttribute(
    'href',
    '/privacy.html#fr',
  )
})
