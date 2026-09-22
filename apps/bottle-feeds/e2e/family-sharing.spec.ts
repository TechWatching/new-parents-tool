import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { SharingFixture, addFeed, openSharing, readFamilyHistory, readStore, signIn } from './helpers/sharing-fixture'

// These tests exercise browser UI + the real app core/storage against a contract
// service. They do not claim to validate live Supabase OAuth or SQL authorization.
async function device(browser: Browser, service: SharingFixture, account: string) {
  const context = await browser.newContext({ baseURL: 'http://localhost:5173' })
  await service.install(context, account)
  const page = await context.newPage()
  await page.goto('/')
  await expect(page.locator('.feed-card')).toBeVisible()
  return { context, page }
}

async function sync(page: Page) {
  await openSharing(page)
  await page.getByRole('button', { name: 'Sync now', exact: true }).click()
}

async function signOut(page: Page) {
  await openSharing(page)
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await page.getByRole('button', { name: 'Confirm', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible()
}

async function editFeed(page: Page, comment: string, amount: string) {
  await page.locator('.measure-tree-entry').filter({ hasText: comment }).getByRole('button', { name: 'Edit', exact: true }).click()
  await page.locator('#edit-feed-amount').fill(amount)
  await page.locator('.measure-tree-entry form').getByRole('button', { name: 'Save', exact: true }).click()
}

async function reconnect(context: BrowserContext, page: Page) {
  await context.setOffline(false)
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
}

test.describe('Family sharing through a browser-only backend contract fake', () => {
  let service: SharingFixture
  const contexts: BrowserContext[] = []

  test.beforeEach(() => { service = new SharingFixture() })

  test.afterEach(async () => {
    await Promise.all(contexts.splice(0).map((context) => context.close()))
  })

  async function parent(browser: Browser, account: string) {
    const result = await device(browser, service, account)
    contexts.push(result.context)
    return result
  }

  test('two independent devices explicitly create/join and share feed and weight changes', async ({ browser }, testInfo) => {
    const mother = await parent(browser, 'mother')
    const father = await parent(browser, 'father')
    expect(service.calls).toEqual([])
    await signIn(mother.page)
    await mother.page.getByRole('button', { name: 'Create a family', exact: true }).click()
    await mother.page.getByRole('button', { name: 'Invite the other parent', exact: true }).click()
    const invitation = await mother.page.locator('#family-invitation').inputValue()
    await father.page.goto('about:blank')
    await father.page.goto(invitation)
    await expect(father.page.getByText('You have an invitation. Sign in to join the shared history.')).toBeVisible()
    expect(service.family?.members).toHaveLength(1)
    await signIn(father.page, 'Microsoft')
    await father.page.getByRole('button', { name: 'Accept invitation', exact: true }).click()
    await expect.poll(() => service.family?.members.length).toBe(2)
    await mother.page.bringToFront()
    await expect(mother.page.getByRole('button', { name: 'Cancel invitation', exact: true })).toHaveCount(0)
    await testInfo.attach('owner-invitation-after-join', { body: await mother.page.screenshot(), contentType: 'image/png' })
    await addFeed(mother.page, 'Shared breakfast', '120')
    await expect.poll(() => [...service.records.values()].some((entry) => 'comment' in entry.record && entry.record.comment === 'Shared breakfast')).toBe(true)
    await sync(father.page)
    await expect(father.page.locator('.measure-tree-entry').getByText('Shared breakfast')).toBeVisible()
    await father.page.locator('.weight-card input[type=number]').fill('4.5')
    await father.page.locator('.weight-card button[type=submit]').click()
    await expect.poll(() => [...service.records.values()].filter((entry) => entry.kind === 'weight').length).toBe(1)
    await sync(mother.page)
    await mother.page.getByRole('tab', { name: 'Weights', exact: true }).click()
    await expect(mother.page.locator('.measure-tree-entry').getByText('4.5 kg')).toBeVisible()
    await testInfo.attach('mother-shared-weight', { body: await mother.page.screenshot(), contentType: 'image/png' })
    await testInfo.attach('father-shared-bottle', { body: await father.page.screenshot(), contentType: 'image/png' })
    await expect(father.page.getByRole('button', { name: 'Delete shared family', exact: true })).toHaveCount(0)
    await expect(father.page.getByRole('button', { name: 'Leave family', exact: true })).toBeVisible()
    await editFeed(father.page, 'Shared breakfast', '135')
    await expect.poll(() => [...service.records.values()].some((entry) => entry.kind === 'feed' && entry.record.amount === 135)).toBe(true)
    await sync(mother.page)
    await mother.page.getByRole('tab', { name: 'Quantities', exact: true }).click()
    await expect(mother.page.locator('.measure-tree-entry').getByText('135 ml')).toBeVisible()
    await mother.page.locator('.measure-tree-entry').getByRole('button', { name: 'Delete 135 ml', exact: true }).click()
    await mother.page.getByRole('button', { name: 'Delete measure', exact: true }).click()
    await expect.poll(() => [...service.records.values()].some((entry) => entry.kind === 'feed' && !!entry.record.deletedAt)).toBe(true)
    await sync(father.page)
    await expect(father.page.locator('.measure-tree-entry').getByText('Shared breakfast')).toHaveCount(0)
  })

  test('offline family edits are durable across reload and reconcile on reconnect', async ({ browser }) => {
    service.seedFamily('mother', 'father')
    const mother = await parent(browser, 'mother')
    const father = await parent(browser, 'father')
    await signIn(mother.page)
    await signIn(father.page)
    await expect(father.page.getByRole('button', { name: 'Sync now' })).toBeVisible()
    await father.context.setOffline(true)
    await addFeed(father.page, 'Offline night bottle', '105')
    await expect(father.page.locator('.measure-tree-entry').getByText('Offline night bottle')).toBeVisible()
    await expect.poll(async () => JSON.stringify(await readStore(father.page))).toContain('Offline night bottle')
    await expect.poll(async () => (await readFamilyHistory(father.page))[0]?.recovery.pending.length).toBe(1)
    expect(service.records.size).toBe(0)
    // Dev-server navigation needs connectivity; this is data durability, not a
    // production service-worker reopen test (covered by the separate PWA suite).
    service.unavailableActors.add('father')
    await reconnect(father.context, father.page)
    await father.page.reload()
    await expect(father.page.locator('.measure-tree-entry').getByText('Offline night bottle')).toBeVisible()
    expect(service.records.size).toBe(0)
    await expect.poll(async () => (await readFamilyHistory(father.page))[0]?.recovery.pending.length).toBe(1)
    await expect.poll(async () => JSON.stringify(await readStore(father.page))).toContain('Offline night bottle')
    service.unavailableActors.delete('father')
    await sync(father.page)
    await expect.poll(() => service.records.size).toBe(1)
    await expect.poll(async () => (await readFamilyHistory(father.page))[0]?.recovery.pending.length).toBe(0)
    await sync(mother.page)
    await expect(mother.page.locator('.measure-tree-entry').getByText('Offline night bottle')).toBeVisible()
    await father.page.reload()
    await sync(father.page)
    expect(service.records.size).toBe(1)
  })

  for (const choice of ['local', 'remote'] as const) {
    test(`concurrent edits preserve both alternatives and resolve with ${choice} version`, async ({ browser }, testInfo) => {
      service.seedFamily('mother', 'father')
      service.seedRecord({ id: 'shared-feed', amount: 100, comment: 'Concurrent bottle', occurredAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
      const mother = await parent(browser, 'mother')
      const father = await parent(browser, 'father')
      await signIn(mother.page)
      await signIn(father.page)
      await expect(father.page.locator('.measure-tree-entry').getByText('Concurrent bottle')).toBeVisible()
      await father.context.setOffline(true)
      await editFeed(father.page, 'Concurrent bottle', '140')
      await editFeed(mother.page, 'Concurrent bottle', '160')
      await expect.poll(() => (service.records.get('feed:shared-feed')?.record as { amount: number } | undefined)?.amount).toBe(160)
      await reconnect(father.context, father.page)
      const conflicts = father.page.locator('section[aria-labelledby="conflicts-heading"]')
      await expect(conflicts).toBeVisible()
      await expect(conflicts).toContainText('140 ml')
      await expect(conflicts).toContainText('160 ml')
      await father.page.reload()
      await expect(conflicts).toContainText('140 ml')
      await expect(conflicts).toContainText('160 ml')
      await testInfo.attach('persisted-conflict-alternatives', { body: await father.page.screenshot(), contentType: 'image/png' })
      await conflicts.getByRole('button', { name: choice === 'local' ? 'Keep this device’s version' : 'Keep shared version', exact: true }).click()
      await expect(conflicts).toHaveCount(0)
      await expect.poll(() => (service.records.get('feed:shared-feed')?.record as { amount: number } | undefined)?.amount).toBe(choice === 'local' ? 140 : 160)
      await sync(mother.page)
      await expect(mother.page.locator('.measure-tree-entry').getByText(`${choice === 'local' ? 140 : 160} ml`)).toBeVisible()
      await testInfo.attach('resolved-shared-version', { body: await mother.page.screenshot(), contentType: 'image/png' })
    })
  }

  test('guest history stays local until consent and survives family sign-out', async ({ browser }) => {
    const mother = await parent(browser, 'mother')
    await addFeed(mother.page, 'Private guest bottle')
    await mother.page.reload()
    expect(service.calls).toEqual([])
    await signIn(mother.page)
    await mother.page.getByRole('button', { name: 'Create a family', exact: true }).click()
    await expect(mother.page.getByRole('button', { name: 'Sync now' })).toBeVisible()
    await sync(mother.page)
    expect(service.records.size).toBe(0)
    await expect.poll(async () => JSON.stringify((await readStore(mother.page))['guest:data'])).toContain('Private guest bottle')
    await signOut(mother.page)
    await expect(mother.page.locator('.measure-tree-entry').getByText('Private guest bottle')).toBeVisible()
    await mother.page.reload()
    await expect(mother.page.locator('.measure-tree-entry').getByText('Private guest bottle')).toBeVisible()
    expect(service.records.size).toBe(0)
  })

  test('mobile guest merge preserves shared and local records', async ({ browser }, testInfo) => {
    service.seedFamily('mother')
    service.seedRecord({
      id: 'shared-before-merge', amount: 90, comment: 'Existing shared bottle',
      occurredAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    })
    const mother = await parent(browser, 'mother')
    await mother.page.setViewportSize({ width: 390, height: 844 })
    await addFeed(mother.page, 'Consented guest bottle')
    await signIn(mother.page)
    const mergeButton = mother.page.getByRole('button', { name: 'Upload and merge', exact: true })
    await expect(mergeButton).toBeVisible()
    await testInfo.attach('mobile-merge-prompt', { body: await mother.page.screenshot(), contentType: 'image/png' })
    await expect.poll(async () => {
      const box = await mergeButton.boundingBox()
      return box ? box.y + box.height <= 844 : false
    }).toBe(true)
    await mergeButton.click()
    await expect.poll(() => service.records.size).toBe(2)
    await expect(mother.page.locator('.measure-tree-entry').getByText('Existing shared bottle')).toBeVisible()
    await expect(mother.page.locator('.measure-tree-entry').getByText('Consented guest bottle')).toBeVisible()
    await expect.poll(async () => JSON.stringify((await readStore(mother.page))['guest:data'])).toContain('Consented guest bottle')
    await testInfo.attach('mobile-shared-family-merge', { body: await mother.page.screenshot(), contentType: 'image/png' })
    await signOut(mother.page)
    await expect(mother.page.locator('.measure-tree-entry').getByText('Consented guest bottle')).toBeVisible()
  })

  test('lost mutation acknowledgement retries the same immutable request without duplicates', async ({ browser }) => {
    service.seedFamily('mother')
    const mother = await parent(browser, 'mother')
    await signIn(mother.page)
    await expect(mother.page.getByRole('button', { name: 'Sync now' })).toBeVisible()
    service.loseNextPushResponse.add('mother')
    await addFeed(mother.page, 'Receipt replay bottle')
    await expect.poll(() => service.records.size).toBe(1)
    await sync(mother.page)
    await expect.poll(() => service.calls.filter((call) => call.operation === 'sync/push').length).toBeGreaterThanOrEqual(2)
    const pushes = service.calls.filter((call) => call.operation === 'sync/push')
    expect(pushes[1]!.mutations).toEqual(pushes[0]!.mutations)
    expect(service.records.size).toBe(1)
    await mother.page.reload()
    await expect(mother.page.locator('.measure-tree-entry').filter({ hasText: 'Receipt replay bottle' })).toHaveCount(1)
    await expect(mother.page.locator('section[aria-labelledby="conflicts-heading"]')).toHaveCount(0)
  })

  test('sign-out hides pending family work and a different account cannot upload it', async ({ browser }) => {
    service.seedFamily('mother')
    const mother = await parent(browser, 'mother')
    await signIn(mother.page)
    await expect(mother.page.getByRole('button', { name: 'Sync now' })).toBeVisible()
    await mother.context.setOffline(true)
    await addFeed(mother.page, 'Only mother pending')
    await expect.poll(async () => JSON.stringify(await readStore(mother.page))).toContain('Only mother pending')
    await signOut(mother.page)
    await expect(mother.page.getByText('Only mother pending', { exact: true })).toHaveCount(0)
    await reconnect(mother.context, mother.page)
    await mother.page.evaluate(() => localStorage.setItem('sharing-test:account', 'stranger'))
    await mother.page.reload()
    await signIn(mother.page)
    await expect(mother.page.getByRole('button', { name: 'Create a family' })).toBeVisible()
    await expect(mother.page.getByText('Only mother pending', { exact: true })).toHaveCount(0)
    expect(service.records.size).toBe(0)
    await expect.poll(async () => JSON.stringify(await readStore(mother.page))).toContain('Only mother pending')
    await signOut(mother.page)
    await mother.page.evaluate(() => localStorage.setItem('sharing-test:account', 'mother'))
    await signIn(mother.page)
    await expect(mother.page.locator('.measure-tree-entry').getByText('Only mother pending')).toBeVisible()
    await expect.poll(() => service.records.size).toBe(1)
  })

  test('revoked parent cannot synchronize and retains recoverable offline changes', async ({ browser }) => {
    service.seedFamily('mother', 'father')
    const mother = await parent(browser, 'mother')
    const father = await parent(browser, 'father')
    await signIn(mother.page)
    await signIn(father.page)
    await expect(father.page.getByRole('button', { name: 'Sync now' })).toBeVisible()
    await father.context.setOffline(true)
    await addFeed(father.page, 'Recover after removal')
    await expect.poll(async () => JSON.stringify(await readStore(father.page))).toContain('Recover after removal')
    await expect.poll(async () => (await readFamilyHistory(father.page))[0]?.recovery.pending.length).toBe(1)
    await mother.page.getByRole('button', { name: 'Remove other parent' }).click()
    await mother.page.getByRole('button', { name: 'Confirm', exact: true }).click()
    await expect.poll(() => service.family?.members.length).toBe(1)
    await reconnect(father.context, father.page)
    await expect(father.page.getByRole('alert').filter({ hasText: /access|membership|removed|recover/i }).first()).toBeVisible()
    expect(service.records.size).toBe(0)
    await expect.poll(async () => JSON.stringify(await readStore(father.page))).toContain('Recover after removal')
    await expect(father.page.locator('.measure-tree-entry').getByText('Recover after removal')).toBeVisible()
  })
})
