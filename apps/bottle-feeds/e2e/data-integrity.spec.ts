import { expect, test as base, type Page } from '@playwright/test'
import { SharingFixture, addFeed, openSharing, readFamilyHistory, signIn } from './helpers/sharing-fixture'

const test = base.extend<{ sharing: SharingFixture }>({
  sharing: async ({ context }, use) => {
    const sharing = new SharingFixture()
    sharing.seedFamily('mother')
    await sharing.install(context, 'mother')
    await use(sharing)
  },
})

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

test.beforeEach(async ({ page, sharing }) => {
  expect(sharing.family?.ownerId).toBe('mother')
  await page.goto('/')
  await expect(page.locator('.feed-card')).toBeVisible()
})

async function signOut(page: Page) {
  await openSharing(page)
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await page.getByRole('button', { name: 'Confirm', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible()
}

test('late sync cannot reveal or persist account data after sign-out', async ({ page, sharing }) => {
  sharing.seedRecord({
    id: 'private-feed', amount: 120, occurredAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(), comment: 'Private account record',
  })
  await page.evaluate(() => localStorage.setItem('sharing-test:ignore-abort', 'true'))
  const gate = sharing.hold('sync/pull')
  await signIn(page)
  await gate.started
  await signOut(page)
  gate.release()
  await expect(page.getByText('Private account record', { exact: true })).toHaveCount(0)
  await expect.poll(() => readFeeds(page)).toEqual([])
  await page.reload()
  await openSharing(page)
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible()
  await expect(page.getByText('Private account record', { exact: true })).toHaveCount(0)
})

test('a bottle added during sync survives and remains pending', async ({ page, sharing, context }) => {
  await signIn(page)
  await expect(page.getByRole('button', { name: 'Sync now' })).toBeVisible()
  const first = sharing.hold('sync/push')
  await addFeed(page, 'First queued bottle')
  await first.started
  await addFeed(page, 'Added during sync')
  await expect(page.locator('.measure-tree-entry').getByText('Added during sync')).toBeVisible()
  // Disconnect before acknowledging the first snapshot: the later mutation must
  // stay on disk and must not be accidentally acknowledged by that response.
  await context.setOffline(true)
  first.release()
  await expect.poll(async () => (await readFamilyFeeds(page)).map((feed) => feed.comment).sort())
    .toEqual(['Added during sync', 'First queued bottle'])
  await expect.poll(async () => (await readFamilyHistory(page))[0]?.recovery.pending.some((mutation) =>
    'comment' in mutation.record && mutation.record.comment === 'Added during sync')).toBe(true)
  await expect(page.getByText(/Changes pending sync|change.*waiting to sync|pending/i).first()).toBeVisible()
  await context.setOffline(false)
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  await expect.poll(() => sharing.records.size).toBe(2)
})

async function familyNamespace(page: Page) {
  return page.evaluate(() => new Promise<string>((resolve, reject) => {
    const request = indexedDB.open('new-parents-tool')
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const db = request.result
      const keys = db.transaction('bottle-feeds').objectStore('bottle-feeds').getAllKeys()
      keys.onsuccess = () => {
        const key = keys.result.find((value) => typeof value === 'string' && value.endsWith(':data') && value !== 'guest:data')
        db.close()
        if (typeof key === 'string') resolve(key.slice(0, -5))
        else reject(new Error('No persisted family namespace found'))
      }
    }
  }))
}

async function readFamilyFeeds(page: Page) {
  return readFeeds(page, await familyNamespace(page))
}

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

test('importing measures preserves the authenticated session', async ({ page }) => {
  await signIn(page)
  await addFeed(page, 'Existing signed-in measure', '100')
  await expect(page.getByText('Existing signed-in measure', { exact: true })).toBeVisible()

  await page.locator('input[type=file]').setInputFiles({
    name: 'existing-measures.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({
      feeds: [{
        id: 'imported-measure', amount: 95, comment: 'Imported measure',
        occurredAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      }],
      weights: [],
    })),
  })

  await expect(page.getByText('Data imported successfully.', { exact: true })).toBeVisible()
  await expect(page.getByText('Existing signed-in measure', { exact: true })).toBeVisible()
  await expect(page.getByText('Imported measure', { exact: true })).toBeVisible()
  await openSharing(page)
  await expect(page.getByText('mother@example.test', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Resume sharing', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Continue with Google', exact: true })).toHaveCount(0)
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
  await signIn(page)
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible()
  await expect(page.getByText('Unsaved guest draft', { exact: true })).toHaveCount(0)
  await signOut(page)
  await expect(page.getByText('Unsaved guest draft', { exact: true })).toBeVisible()
  await expect(page.getByRole('alert')).toContainText('not saved yet')
  await page.getByRole('button', { name: 'Retry saving' }).click()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await page.reload()
  await expect(page.getByText('Unsaved guest draft', { exact: true })).toBeVisible()
})

test('a focus refresh cannot hide a bottle committed in the same turn', async ({ page }) => {
  await signIn(page)
  await expect(page.getByRole('button', { name: 'Sync now' })).toBeVisible()
  await page.locator('.feed-card input[type=number]').fill('90')
  await page.locator('.feed-card input[maxlength="160"]').fill('Saved while focusing')
  await page.locator('.feed-card').evaluate((form: HTMLFormElement) => {
    form.requestSubmit()
    window.dispatchEvent(new Event('focus'))
  })
  await expect(page.getByText('Bottle recorded', { exact: true })).toBeVisible()
  await expect(page.getByText('Saved while focusing', { exact: true })).toBeVisible()
  await expect.poll(async () => (await readFamilyFeeds(page)).length).toBe(1)
})

test('cloud deletion blocks edits and preserves records saved by another tab', async ({
  page,
  context,
  sharing,
}) => {
  const gate = sharing.hold('family/delete')
  await signIn(page)
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible()
  await addFeed(page, 'Original bottle', '100')
  await expect(page.getByText('Bottle recorded', { exact: true })).toBeVisible()
  await expect.poll(() => sharing.records.size).toBe(1)
  const namespace = await familyNamespace(page)
  const pushes = sharing.calls.filter((call) => call.operation === 'sync/push').length
  await page.getByRole('button', { name: 'Delete shared family', exact: true }).click()
  await page.getByRole('button', { name: 'Confirm', exact: true }).click()
  await gate.started
  await expect(page.locator('.feed-card input[type=number]')).toBeDisabled()
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  const second = await context.newPage()
  await second.goto('/')
  await expect(second.locator('.feed-card')).toBeVisible()
  await second.evaluate(async (namespace) => {
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
      namespace,
      true,
    )
  }, namespace)
  expect(sharing.calls.filter((call) => call.operation === 'sync/push')).toHaveLength(pushes)
  gate.release()
  await expect(page.locator('.feed-card input[type=number]')).toBeEnabled()
  await expect(page.getByText('Original bottle', { exact: true })).toBeVisible()
  await expect(page.getByText('Saved by another tab', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Resume sharing', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Delete shared family', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Leave shared family', exact: true })).toHaveCount(0)
  await expect.poll(() => sharing.family).toBeNull()
  await expect.poll(async () => (await readFeeds(page, namespace)).length).toBeGreaterThanOrEqual(2)
  await second.close()
})
