import { test, expect } from '@playwright/test'

test('keeps the ICO fallback transparent like the SVG favicon', async ({ page }) => {
  await page.goto('/')

  const icons = await page.evaluate(async () => {
    const colors = async (url: string) => {
      const image = new Image()
      image.src = url
      await image.decode()
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = 48
      const context = canvas.getContext('2d', { willReadFrequently: true })!
      context.drawImage(image, 0, 0, 48, 48)
      const pixel = (x: number, y: number) => Array.from(context.getImageData(x, y, 1, 1).data)
      return { corner: pixel(0, 0), background: pixel(8, 8) }
    }

    return { svg: await colors('/favicon.svg'), ico: await colors('/favicon.ico') }
  })

  expect(icons.svg.corner[3]).toBe(0)
  expect(icons.ico.corner[3]).toBe(0)
  expect(icons.ico.background).toEqual(icons.svg.background)
})

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
