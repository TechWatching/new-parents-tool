import { expect, test, type Page } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const base = process.env.PWA_BASE === '/' ? '/' : '/new-parents-tool/'
const configured = process.env.PWA_BACKEND === 'configured'

async function waitForOfflineReady(page: Page) {
  await expect(page.getByText('Ready to reopen offline', { exact: true })).toBeVisible()
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller?.state))
    .toBe('activated')
}

async function chooseLocalOnly(page: Page) {
  const sharing = page.locator('details').filter({
    has: page.locator('summary').filter({ hasText: 'Share with another parent' }),
  })
  if (configured) {
    await expect(sharing).toBeVisible()
    await sharing.locator('summary').click()
    await expect(sharing.getByRole('button', { name: 'Continue with Google' })).toBeEnabled()
    await expect(sharing.getByRole('button', { name: 'Continue with Microsoft' })).toBeEnabled()
    await expect(
      sharing.getByText('Sharing is optional. You can keep using this browser without an account.'),
    ).toBeVisible()
    // Deliberately decline sign-in and keep using local storage.
    await sharing.locator('summary').click()
    await expect(sharing.getByRole('button', { name: 'Continue with Google' })).toBeHidden()
  } else {
    await expect(sharing).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Continue with Google' })).toHaveCount(0)
  }
}

test('provides install metadata and icons within the deployment scope', async ({ page }) => {
  await page.goto('./')
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
    'href',
    `${base}manifest.webmanifest`,
  )
  const manifestUrl = new URL(`${base}manifest.webmanifest`, page.url())
  const response = await page.request.get(manifestUrl.href)
  expect(response.ok()).toBe(true)
  const manifest = await response.json()
  expect(manifest.name).toBe('Little Sips — Bottle feed tracker')
  expect(manifest.short_name).toBe('Little Sips')
  expect(manifest.display).toBe('standalone')
  expect(new URL(manifest.start_url, manifestUrl).pathname).toBe(base)
  expect(new URL(manifest.scope, manifestUrl).pathname).toBe(base)
  for (const size of [192, 512]) {
    const icon = manifest.icons.find(
      (entry: { sizes: string }) => entry.sizes === `${size}x${size}`,
    )
    expect(icon).toBeDefined()
    const iconUrl = new URL(icon.src, manifestUrl)
    expect(iconUrl.pathname).toBe(`${base}pwa-${size}x${size}.png`)
    expect((await page.request.get(iconUrl.href)).ok()).toBe(true)
    expect(
      await page.evaluate(async (src) => {
        const image = new Image()
        image.src = src
        await image.decode()
        return [image.naturalWidth, image.naturalHeight]
      }, iconUrl.href),
    ).toEqual([size, size])
  }
  const appleIcon = page.locator('link[rel="apple-touch-icon"]')
  await expect(appleIcon).toHaveAttribute('href', `${base}apple-touch-icon.png`)
  expect(
    (await page.request.get(new URL(`${base}apple-touch-icon.png`, page.url()).href)).ok(),
  ).toBe(true)
  await waitForOfflineReady(page)
})

test('renders the first offline save notification from local icons without warming an icon API', async ({
  page,
  context,
}, testInfo) => {
  const iconRequests: string[] = []
  context.on('request', (request) => {
    if (/api\.(iconify\.design|unisvg\.com|simplesvg\.com)/.test(request.url())) {
      iconRequests.push(request.url())
    }
  })
  await page.goto('./')
  await waitForOfflineReady(page)
  await chooseLocalOnly(page)
  await context.setOffline(true)
  await page.locator('.feed-card input[type="number"]').fill('125')
  await page.getByRole('button', { name: 'Save bottle', exact: true }).click()
  await expect(page.getByText('Bottle recorded', { exact: true })).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Close', exact: true }).locator('svg path').first(),
  ).toBeVisible()
  await testInfo.attach('first-offline-save-local-close-icon', {
    body: await page.screenshot({ fullPage: true }),
    contentType: 'image/png',
  })
  await page.getByRole('button', { name: 'Delete 125 ml', exact: true }).click()
  await expect(
    page.getByRole('dialog', { name: 'Delete this measure?', exact: true }),
  ).toBeVisible()
  expect(iconRequests).toEqual([])
})

test('reopens a fresh page offline, persists logging and generates the first PDF offline', async ({
  page,
  context,
}, testInfo) => {
  const externalRequests: string[] = []
  const iconRequests: string[] = []
  context.on('request', (request) => {
    if (/api\.(iconify\.design|unisvg\.com|simplesvg\.com)/.test(request.url())) {
      iconRequests.push(request.url())
    }
    if (!request.url().startsWith('http://localhost:4181/') && /^https?:/.test(request.url())) {
      externalRequests.push(request.url())
    }
  })
  await page.goto('./')
  await waitForOfflineReady(page)
  await chooseLocalOnly(page)
  await page.locator('.feed-card input[type="number"]').fill('125')
  await page.locator('.feed-card input[maxlength="160"]').fill('Before offline reopening')
  await page.getByRole('button', { name: 'Save bottle', exact: true }).click()
  await expect(page.getByText('Bottle recorded', { exact: true })).toBeVisible()

  await context.setOffline(true)
  await page.close()
  const reopened = await context.newPage()
  await reopened.goto('./')
  await waitForOfflineReady(reopened)
  await chooseLocalOnly(reopened)
  await expect(reopened.locator('.measure-tree-entry').getByText('125 ml')).toBeVisible()

  await reopened.locator('.feed-card input[type="number"]').fill('90')
  await reopened.locator('.feed-card input[maxlength="160"]').fill('Saved without a connection')
  await reopened.getByRole('button', { name: 'Save bottle', exact: true }).click()
  await expect(reopened.getByText('Bottle recorded', { exact: true })).toBeVisible()
  await expect(
    reopened.getByRole('button', { name: 'Close', exact: true }).locator('svg').first(),
  ).toBeVisible()
  await reopened.locator('.weight-card input[type="number"]').fill('4.2')
  await reopened.getByRole('button', { name: 'Save weight', exact: true }).click()
  await expect(reopened.getByText('Weight recorded', { exact: true })).toBeVisible()
  await reopened.reload()
  await expect(reopened.locator('.measure-tree-entry').getByText('90 ml')).toBeVisible()
  await expect(reopened.getByText('4.2 kg', { exact: true }).first()).toBeVisible()

  await reopened.getByRole('button', { name: 'Share report', exact: true }).click()
  const pdfPromise = reopened.waitForEvent('download')
  await reopened.getByRole('button', { name: 'Share PDF', exact: true }).click()
  const pdf = await pdfPromise
  expect(pdf.suggestedFilename()).toMatch(/\.pdf$/)
  expect(await pdf.failure()).toBeNull()
  const backupPromise = reopened.waitForEvent('download')
  await reopened.getByRole('button', { name: 'Export data', exact: true }).click()
  const backup = await backupPromise
  expect(backup.suggestedFilename()).toMatch(/\.json$/)
  expect(await backup.failure()).toBeNull()
  expect(externalRequests).toEqual([])
  expect(iconRequests).toEqual([])
  await testInfo.attach('offline-reopened-first-pdf', {
    body: await reopened.screenshot({ fullPage: true }),
    contentType: 'image/png',
  })
})

test('caches public build assets only, never invitation/auth/API URLs or sibling apps', async ({
  page,
  context,
}) => {
  await page.goto('./?invite=private-invitation&code=private-oauth-code')
  await waitForOfflineReady(page)
  const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope)
  expect(new URL(scope).pathname).toBe(base)
  await page.evaluate(async () => {
    await fetch('./api/test?access_token=private-token')
  })
  const cachedUrls = await page.evaluate(async () => {
    const stores = await caches.keys()
    return (
      await Promise.all(
        stores.map(async (name) => (await (await caches.open(name)).keys()).map((r) => r.url)),
      )
    ).flat()
  })
  expect(cachedUrls.length).toBeGreaterThan(5)
  expect(cachedUrls.some((url) => /private-|invite=|code=|access_token=|\/api\//.test(url))).toBe(
    false,
  )
  expect(cachedUrls.every((url) => new URL(url).pathname.startsWith(base))).toBe(true)
  expect(cachedUrls.some((url) => /jspdf|pdf|purify/.test(url))).toBe(true)
  await context.setOffline(true)
  await page.goto('./?invite=another-private-invitation')
  await expect(page.locator('.feed-card')).toBeVisible()
  const sibling = await context.newPage()
  await expect(sibling.goto('http://localhost:4181/another-app/')).rejects.toThrow()
})

test('does not claim readiness after a cached lazy asset is evicted', async ({ page }) => {
  await page.goto('./')
  await waitForOfflineReady(page)
  await page.evaluate(async () => {
    for (const name of await caches.keys()) {
      const cache = await caches.open(name)
      const asset = (await cache.keys()).find((request) => /jspdf|purify/.test(request.url))
      if (asset) {
        await cache.delete(asset)
        break
      }
    }
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await expect(page.getByText('Ready to reopen offline', { exact: true })).toHaveCount(0)
  await expect(
    page.getByText('Offline access is not ready. Reconnect and reload to try again.'),
  ).toBeVisible()
})

test('preserves new drafts, history edits and submitted entries across an already-waiting update', async ({
  page,
  context,
}) => {
  const workerPath = fileURLToPath(new URL('../../.playwright-cli/pwa-dist/sw.js', import.meta.url))
  const original = await readFile(workerPath, 'utf8')
  const keeper = await context.newPage()
  try {
    await page.goto('./')
    await waitForOfflineReady(page)
    await keeper.goto('./')
    await waitForOfflineReady(keeper)
    await keeper.locator('.feed-card input[type="number"]').fill('75')
    await page.locator('.feed-card input[type="number"]').fill('115')
    const initialNavigation = await page.evaluate(() => performance.timeOrigin)
    await writeFile(workerPath, `${original}\n// PWA update lifecycle regression\n`)
    await page.evaluate(async () => (await navigator.serviceWorker.ready).update())
    await expect(page.getByRole('button', { name: 'Save and reload', exact: true })).toBeVisible()
    await expect(page.locator('.feed-card input[type="number"]')).toHaveValue('115')
    expect(await page.evaluate(() => performance.timeOrigin)).toBe(initialNavigation)
    await page.getByRole('button', { name: 'Save and reload', exact: true }).click()
    await expect(
      page.getByText('Finish or clear the bottle and weight forms before updating.', {
        exact: true,
      }),
    ).toBeVisible()
    await expect(page.locator('.feed-card input[type="number"]')).toHaveValue('115')
    expect(await page.evaluate(async () => !!(await navigator.serviceWorker.ready).waiting)).toBe(
      true,
    )
    await page.getByRole('button', { name: 'Save bottle', exact: true }).click()
    await expect(page.getByText('Bottle recorded', { exact: true })).toBeVisible()
    await page.locator('.feed-card input[type="number"]').fill('')
    // Another controlled tab keeps the update waiting across this explicit
    // reload, exercising registration.waiting on the next app startup.
    await page.reload()
    await waitForOfflineReady(page)
    await expect(page.getByRole('button', { name: 'Save and reload', exact: true })).toBeVisible()
    await expect(page.locator('.measure-tree-entry').getByText('115 ml')).toBeVisible()
    const reopenedNavigation = await page.evaluate(() => performance.timeOrigin)
    await page
      .locator('.measure-tree-entry')
      .first()
      .getByRole('button', { name: 'Edit', exact: true })
      .click()
    await page.locator('#edit-feed-amount').fill('130')
    await page.getByRole('button', { name: 'Save and reload', exact: true }).click()
    await expect(page.locator('#edit-feed-amount')).toHaveValue('130')
    expect(await page.evaluate(() => performance.timeOrigin)).toBe(reopenedNavigation)
    expect(await page.evaluate(async () => !!(await navigator.serviceWorker.ready).waiting)).toBe(
      true,
    )
    await page
      .locator('.measure-tree-entry form')
      .getByRole('button', { name: 'Save', exact: true })
      .click()
    await expect(page.locator('.measure-tree-entry').getByText('130 ml')).toBeVisible()
    await Promise.all([
      page.waitForEvent('domcontentloaded'),
      page.getByRole('button', { name: 'Save and reload', exact: true }).click(),
    ])
    await waitForOfflineReady(page)
    await expect(page.locator('.measure-tree-entry').getByText('130 ml')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Save and reload', exact: true })).toHaveCount(0)
    await expect(keeper.locator('.feed-card input[type="number"]')).toHaveValue('75')
  } finally {
    await keeper.close()
    await writeFile(workerPath, original)
  }
})
