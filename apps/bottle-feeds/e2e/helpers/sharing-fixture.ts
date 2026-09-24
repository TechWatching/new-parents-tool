import type { BrowserContext, Page, Route } from '@playwright/test'
import type { CloudRecord, Family, Mutation, MutationResult } from '../../src/backends/contracts'
import type { AppData } from '../../src/types'
import type { HistoryState } from '../../src/sharing/state'

type Call = {
  operation: string
  actor: string | null
  familyId?: string
  token?: string
  userId?: string
  mutations?: Mutation[]
}
type Gate = { started: Promise<void>; release: () => void }

/** Shared simulated service; contexts still use the real UI, app core and IndexedDB. */
export class SharingFixture {
  family: Family | null = null
  records = new Map<string, CloudRecord>()
  calls: Call[] = []
  unavailableActors = new Set<string>()
  loseNextPushResponse = new Set<string>()
  private revision = 0
  private familySequence = 0
  private invitation: { token: string; expiresAt: string } | null = null
  private receipts = new Map<string, { payload: string; result: MutationResult }>()
  private gates = new Map<string, { started: () => void; wait: Promise<void> }>()

  hold(operation: string, actor = 'mother'): Gate {
    let started!: () => void
    let release!: () => void
    const began = new Promise<void>((resolve) => { started = resolve })
    const wait = new Promise<void>((resolve) => { release = resolve })
    this.gates.set(`${actor}:${operation}`, { started, wait })
    return { started: began, release }
  }

  seedFamily(...members: string[]) {
    this.family = {
      id: `family-${++this.familySequence}`,
      ownerId: members[0]!,
      members: members.map((userId) => ({ userId, name: `${userId}@example.test` })),
    }
  }

  seedRecord(record: CloudRecord['record'], kind: CloudRecord['kind'] = 'feed') {
    const current = { kind, record, version: `revision-${++this.revision}` } as CloudRecord
    this.records.set(`${kind}:${record.id}`, current)
    return current
  }

  async install(context: BrowserContext, account: string) {
    await context.addInitScript((id) => {
      localStorage.setItem('new-parents-tool:language', 'en')
      // Account selection is not authentication; restore remains null until sign-in.
      if (!localStorage.getItem('sharing-test:account')) localStorage.setItem('sharing-test:account', id)
    }, account)
    await context.route('**/src/backends/index.ts*', (route) => route.fulfill({
      contentType: 'application/javascript',
      body: 'export { backendConfig, createBackend } from "/e2e/helpers/browser-backend.ts"',
    }))
    await context.route('**/__sharing-test__/**', (route) => this.handle(route))
  }

  private async handle(route: Route) {
    const operation = new URL(route.request().url()).pathname.replace('/__sharing-test__/', '')
    const call = { ...route.request().postDataJSON(), operation } as Call
    this.calls.push(structuredClone(call))
    const gateKey = `${call.actor}:${operation}`
    const gate = this.gates.get(gateKey)
    if (gate) {
      this.gates.delete(gateKey)
      gate.started()
      await gate.wait
    }
    try {
      if (call.actor && this.unavailableActors.has(call.actor)) {
        await route.fulfill({ status: 503, json: { code: 'transient', message: 'Sharing service is unavailable' } })
        return
      }
      const result = this.execute(call)
      if (operation === 'sync/push' && call.actor && this.loseNextPushResponse.delete(call.actor)) {
        await route.abort('failed')
        return
      }
      await route.fulfill({ status: 200, json: result ?? null })
    } catch (error) {
      const failure = error as { code?: string; message: string }
      await route.fulfill({ status: failure.code === 'forbidden' ? 403 : 400, json: {
        code: failure.code ?? 'invalid', message: failure.message,
      } })
    }
  }

  private execute(call: Call): unknown {
    const fail = (code: string, message: string): never => { throw Object.assign(new Error(message), { code }) }
    const { actor, operation } = call
    if (!actor) return fail('auth', 'Sign in required')
    const member = this.family?.members.some((entry) => entry.userId === actor)
    const owner = this.family?.ownerId === actor
    if (operation === 'family/current') return member ? structuredClone(this.family) : null
    if (operation === 'family/create') {
      if (member || this.family) return fail('invalid', 'Family already exists')
      this.seedFamily(actor)
      return structuredClone(this.family)
    }
    if (operation === 'family/join') {
      if (member || !this.family || this.family.members.length >= 2 ||
          !this.invitation || call.token !== this.invitation.token ||
          Date.parse(this.invitation.expiresAt) <= Date.now()) {
        return fail('invalid', 'Invitation is invalid, expired, or family is full')
      }
      this.family.members.push({ userId: actor, name: `${actor}@example.test` })
      this.invitation = null
      return structuredClone(this.family)
    }
    if (!member || (call.familyId && call.familyId !== this.family?.id)) {
      return fail('forbidden', 'Family access was removed. Your local changes are recoverable.')
    }
    if (['family/invite', 'family/revoke', 'family/remove', 'family/delete'].includes(operation) && !owner) {
      return fail('forbidden', 'Only the family owner can do this')
    }
    switch (operation) {
      case 'family/invite':
        this.invitation = { token: `test-invitation-${++this.revision}`, expiresAt: new Date(Date.now() + 86_400_000).toISOString() }
        return this.invitation
      case 'family/revoke': this.invitation = null; return null
      case 'family/remove':
        this.family!.members = this.family!.members.filter((entry) => entry.userId !== call.userId || entry.userId === this.family!.ownerId)
        return null
      case 'family/leave':
        if (owner) return fail('invalid', 'Owner cannot leave')
        this.family!.members = this.family!.members.filter((entry) => entry.userId !== actor)
        return null
      case 'family/delete':
        this.family = null
        this.records.clear()
        this.receipts.clear()
        this.invitation = null
        return null
      case 'sync/pull':
        return { records: structuredClone([...this.records.values()]), cursor: `cursor-${this.revision}`, nextPage: null }
      case 'sync/push':
        return call.mutations!.map((mutation) => {
          const receiptKey = `${actor}:${mutation.mutationId}`
          const payload = JSON.stringify(mutation)
          const receipt = this.receipts.get(receiptKey)
          if (receipt) {
            if (receipt.payload !== payload) return fail('invalid', 'Mutation ID reused with a different payload')
            return structuredClone(receipt.result)
          }
          const key = `${mutation.kind}:${mutation.record.id}`
          const current = this.records.get(key) ?? null
          const result: MutationResult = (current?.version ?? null) !== mutation.baseVersion
            ? { mutationId: mutation.mutationId, status: 'conflict', current: structuredClone(current) }
            : { mutationId: mutation.mutationId, status: 'accepted', current: this.seedRecord(structuredClone(mutation.record), mutation.kind) }
          this.receipts.set(receiptKey, { payload, result: structuredClone(result) })
          return result
        })
      default: return fail('invalid', `Unknown fixture operation: ${operation}`)
    }
  }
}

export async function openSharing(page: Page) {
  const panel = page.locator('details').filter({ has: page.locator('summary', { hasText: /Share|family/i }) }).first()
  if (!(await panel.evaluate((element) => (element as HTMLDetailsElement).open))) await panel.locator('summary').click()
  return panel
}

export async function signIn(page: Page, provider: 'Google' | 'Microsoft' = 'Google') {
  await openSharing(page)
  await page.getByRole('button', { name: `Continue with ${provider}`, exact: true }).click()
}

export async function addFeed(page: Page, comment: string, amount = '90') {
  await page.locator('.feed-card input[type=number]').fill(amount)
  await page.locator('.feed-card input[maxlength="160"]').fill(comment)
  await page.locator('.feed-card button[type=submit]').click()
}

export async function readStore(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('new-parents-tool')
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const db = request.result
      const tx = db.transaction('bottle-feeds', 'readonly')
      const store = tx.objectStore('bottle-feeds')
      const values: Record<string, unknown> = {}
      const cursor = store.openCursor()
      cursor.onsuccess = () => {
        if (!cursor.result) return
        if (typeof cursor.result.key === 'string') values[cursor.result.key] = cursor.result.value
        cursor.result.continue()
      }
      tx.oncomplete = () => { db.close(); resolve(values) }
      tx.onerror = () => { db.close(); reject(tx.error) }
    }
  }))
}

export async function readFamilyHistory(page: Page) {
  const store = await readStore(page)
  return Object.entries(store)
    .filter(([key]) => key.startsWith('shared-') && key.endsWith(':data'))
    .map(([namespace, value]) => ({ namespace, ...value as AppData & { recovery: Omit<HistoryState, 'data'> } }))
}
