import { expect, test, type Page } from '@playwright/test'

const userId = '11111111-1111-4111-8111-111111111111'
const cloudFeed = {
  id: '22222222-2222-4222-8222-222222222222',
  user_id: userId,
  amount: 120,
  occurred_at: '2026-09-10T10:00:00.000Z',
  updated_at: '2026-09-10T10:00:00.000Z',
  comment: 'Private account record',
  deleted_at: null,
}

async function addFeed(page: Page, comment: string, amount = '90') {
  await page.locator('.feed-card input[type=number]').fill(amount)
  await page.locator('.feed-card input[maxlength="160"]').fill(comment)
  await page.locator('.feed-card button[type=submit]').click()
}

async function authenticate(page: Page, active = true) {
  await page.evaluate(
    async ({ id, active }) => {
      const modulePath = performance
        .getEntriesByType('resource')
        .find((entry) => new URL(entry.name).pathname === '/src/auth.ts')?.name
      if (!modulePath) throw new Error('The app auth module was not loaded')
      const { session } = await import(modulePath)
      session.value = active
        ? {
            user: { id, email: 'parent@example.test' },
            access_token: 'test',
            refresh_token: 'test',
            token_type: 'bearer',
            expires_in: 3600,
          }
        : null
    },
    { id: userId, active },
  )
}

async function failNextDataWrite(page: Page) {
  await page.evaluate(() => {
    // Preserve the method for restoration; apply below supplies the real object store.
    // oxlint-disable-next-line typescript/unbound-method
    const originalPut = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function (...args) {
      if (typeof args[1] === 'string' && args[1].endsWith(':data')) {
        IDBObjectStore.prototype.put = originalPut
        throw new DOMException('Simulated quota failure', 'QuotaExceededError')
      }
      return originalPut.apply(this, args)
    }
  })
}

async function readFeeds(page: Page, namespace = 'guest') {
  return page.evaluate(async (ns) => {
    const modulePath = '/src/storage.ts'
    const { loadData } = await import(modulePath)
    const data = await loadData(ns)
    return data.feeds as { id: string; comment: string }[]
  }, namespace)
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('new-parents-tool:language', 'en'))
  await page.route('https://review-test.supabase.co/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  )
  await page.goto('/')
  await expect(page.locator('.feed-card')).toBeVisible()
})

test('late sync cannot reveal or persist account data after sign-out', async ({ page }) => {
  let release!: () => void
  let started!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const pushStarted = new Promise<void>((resolve) => {
    started = resolve
  })
  await page.route('**/rest/v1/feeds**', async (route) => {
    if (route.request().method() === 'POST') {
      started()
      await gate
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([cloudFeed]),
    })
  })
  await authenticate(page)
  await pushStarted
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await expect(page.locator('#auth-email')).toBeVisible()
  release()
  await expect(page.getByText('Private account record', { exact: true })).toHaveCount(0)
  await expect.poll(() => readFeeds(page)).toEqual([])
  await page.reload()
  await expect(page.locator('#auth-email')).toBeVisible()
  await expect(page.getByText('Private account record', { exact: true })).toHaveCount(0)
})

test('a bottle added during sync survives and remains pending', async ({ page }) => {
  let release!: () => void
  let started!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const pushStarted = new Promise<void>((resolve) => {
    started = resolve
  })
  await page.route('**/rest/v1/feeds**', async (route) => {
    if (route.request().method() === 'POST') {
      started()
      await gate
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([cloudFeed]),
    })
  })
  await authenticate(page)
  await pushStarted
  await addFeed(page, 'Added during sync')
  await expect(page.getByText('Bottle recorded', { exact: true })).toBeVisible()
  release()
  await expect(page.getByText('Changes pending sync', { exact: true })).toBeVisible()
  await expect
    .poll(async () => (await readFeeds(page, `user-${userId}`)).map((feed) => feed.comment).sort())
    .toEqual(['Added during sync', 'Private account record'])
})

test('a storage failure shows unsaved changes and retry persists them', async ({ page }) => {
  await failNextDataWrite(page)
  await addFeed(page, 'Retained for retry')
  await expect(page.getByRole('alert')).toContainText('not saved yet')
  await expect(page.getByText('Bottle recorded', { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Retry saving' }).click()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await page.reload()
  await expect(page.getByText('Retained for retry', { exact: true })).toBeVisible()
})

test('invalid imported records are rejected without changing saved data', async ({ page }) => {
  await addFeed(page, 'Keep this record')
  await expect(page.getByText('Bottle recorded', { exact: true })).toBeVisible()
  await page.locator('input[type=file]').setInputFiles({
    name: 'invalid.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({
        feeds: [{ id: 'bad', amount: 100, occurredAt: 'not-a-date', comment: '' }],
        weights: [],
      }),
    ),
  })
  await expect(
    page.getByText('Could not import: invalid file format.', { exact: true }),
  ).toBeVisible()
  await expect(page.getByText('Keep this record', { exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByText('Keep this record', { exact: true })).toBeVisible()
  await expect.poll(async () => (await readFeeds(page)).length).toBe(1)
})

test('two tabs preserve each other’s new records', async ({ page, context }) => {
  const second = await context.newPage()
  await second.goto('/')
  await expect(second.locator('.feed-card')).toBeVisible()
  await addFeed(page, 'First tab', '100')
  await expect(page.getByText('Bottle recorded', { exact: true })).toBeVisible()
  await addFeed(second, 'Second tab')
  await expect(second.getByText('Bottle recorded', { exact: true })).toBeVisible()
  await expect
    .poll(async () => (await readFeeds(page)).map((feed) => feed.comment).sort())
    .toEqual(['First tab', 'Second tab'])
  await page.reload()
  await expect(page.getByText('First tab', { exact: true })).toBeVisible()
  await expect(page.getByText('Second tab', { exact: true })).toBeVisible()
  await second.close()
})

test('failed guest drafts are retained but hidden while another identity is active', async ({
  page,
}) => {
  await failNextDataWrite(page)
  await addFeed(page, 'Unsaved guest draft')
  await expect(page.getByRole('alert')).toContainText('not saved yet')
  await authenticate(page)
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible()
  await expect(page.getByText('Unsaved guest draft', { exact: true })).toHaveCount(0)
  await authenticate(page, false)
  await expect(page.locator('#auth-email')).toBeVisible()
  await expect(page.getByText('Unsaved guest draft', { exact: true })).toBeVisible()
  await expect(page.getByRole('alert')).toContainText('not saved yet')
  await page.getByRole('button', { name: 'Retry saving' }).click()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await page.reload()
  await expect(page.getByText('Unsaved guest draft', { exact: true })).toBeVisible()
})

test('a focus refresh cannot hide a bottle committed in the same turn', async ({ page }) => {
  await authenticate(page)
  await expect(page.getByText(/^Synced /)).toBeVisible()
  await page.locator('.feed-card input[type=number]').fill('90')
  await page.locator('.feed-card input[maxlength="160"]').fill('Saved while focusing')
  await page.locator('.feed-card').evaluate((form: HTMLFormElement) => {
    form.requestSubmit()
    window.dispatchEvent(new Event('focus'))
  })
  await expect(page.getByText('Bottle recorded', { exact: true })).toBeVisible()
  await expect(page.getByText('Saved while focusing', { exact: true })).toBeVisible()
  await expect.poll(async () => (await readFeeds(page, `user-${userId}`)).length).toBe(1)
})

test('cloud deletion blocks edits and preserves records saved by another tab', async ({
  page,
  context,
}) => {
  let release!: () => void
  let started!: () => void
  let pushes = 0
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const deleting = new Promise<void>((resolve) => {
    started = resolve
  })
  await page.route('**/rest/v1/**', async (route) => {
    if (route.request().method() === 'DELETE') {
      started()
      await gate
    }
    if (route.request().method() === 'POST') pushes++
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  })
  await authenticate(page)
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible()
  await addFeed(page, 'Original bottle', '100')
  await expect(page.getByText('Bottle recorded', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Delete cloud copy', exact: true }).click()
  await page.getByRole('button', { name: 'Permanently delete cloud copy', exact: true }).click()
  await deleting
  await expect(page.locator('.feed-card input[type=number]')).toBeDisabled()
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  const second = await context.newPage()
  await second.goto('/')
  await expect(second.locator('.feed-card')).toBeVisible()
  await second.evaluate(async (id) => {
    const path = '/src/storage.ts'
    const { mergeDataStrict } = await import(path)
    await mergeDataStrict(
      {
        feeds: [
          {
            id: 'other-tab',
            amount: 90,
            comment: 'Saved by another tab',
            occurredAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
        weights: [],
      },
      `user-${id}`,
      true,
    )
  }, userId)
  expect(pushes).toBe(0)
  release()
  await expect(page.locator('#auth-email')).toBeVisible()
  await expect(page.getByText('Original bottle', { exact: true })).toBeVisible()
  await expect(page.getByText('Saved by another tab', { exact: true })).toBeVisible()
  await expect.poll(async () => (await readFeeds(page, `user-${userId}`)).length).toBe(0)
  await second.close()
})
