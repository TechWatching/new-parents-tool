import { test, expect } from '@playwright/test'

test('shares the brand mark between the header and favicon across locales and viewport sizes', async ({ page }) => {
  await page.goto('/')

  const brand = page.getByRole('link', { name: 'Little Sips' })
  const mark = page.getByTestId('brand-mark')
  const favicon = page.locator('link[rel="icon"][type="image/svg+xml"]')

  await expect(brand).toBeVisible()
  await expect(mark).toBeVisible()
  await expect(mark).toHaveAttribute('alt', '')
  await expect(mark).toHaveJSProperty('naturalWidth', 64)
  await expect(page.getByText('Bottle and growth tracker')).toBeVisible()

  const markUrl = new URL(await mark.getAttribute('src') ?? '', page.url())
  const faviconUrl = new URL(await favicon.getAttribute('href') ?? '', page.url())
  expect(markUrl.href).toBe(faviconUrl.href)
  const response = await page.request.get(faviconUrl.href)
  expect(response.ok()).toBe(true)
  expect(await response.text()).toContain('fill="#72b7a0"')

  await page.getByRole('button', { name: 'Language' }).click()
  await page.getByRole('option', { name: /Français/ }).click()
  await expect(page.getByRole('link', { name: 'Petites Gorgées' })).toBeVisible()
  await expect(mark).toHaveAttribute('src', markUrl.pathname)

  await page.setViewportSize({ width: 390, height: 844 })
  await expect(mark).toBeVisible()
  await expect(page.getByRole('link', { name: 'Petites Gorgées' })).toBeVisible()
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(390)
})
