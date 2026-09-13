/**
 * Run against an EMPTY disposable PostgreSQL database named little_sips_test*.
 * Uses a locally available pg driver; no project dependency/framework additions.
 * See supabase/README.md. Never point this at a hosted or production database.
 */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'

const connectionString = process.env.LITTLE_SIPS_TEST_DATABASE_URL
assert(connectionString, 'Set LITTLE_SIPS_TEST_DATABASE_URL to an empty disposable database')
assert(new URL(connectionString).pathname.startsWith('/little_sips_test'), 'Disposable database name must start with little_sips_test')
const driver = await import(process.env.LITTLE_SIPS_PG_MODULE || 'pg')
const { Client } = driver.default ?? driver
const owner = new Client({ connectionString })
await owner.connect()
assert.equal((await owner.query("select count(*) from pg_tables where schemaname not in ('pg_catalog','information_schema')")).rows[0].count, '0', 'Database must be empty')
const files = ['tests/bootstrap.sql', 'migrations/001_initial.sql', 'tests/legacy-seed.sql', 'migrations/002_portable_family_core.sql', 'migrations/003_supabase_family_integration.sql']
for (const file of files) {
  await owner.query(await readFile(new URL(`../${file}`, import.meta.url), 'utf8'))
  console.log(`Applied ${file}`)
}

const clients = []
async function asUser(n, role = 'authenticated') {
  const client = new Client({ connectionString })
  await client.connect()
  clients.push(client)
  await client.query(`set role ${role}`)
  await client.query("select set_config('request.jwt.claim.sub', $1, false)", [n ? `10000000-0000-4000-8000-${String(n).padStart(12, '0')}` : ''])
  return client
}
async function rpc(client, name, args = []) {
  const result = await client.query(`select public.${name}(${args.map((_, i) => `$${i + 1}`).join(',')}) as result`, args)
  return result.rows[0].result
}
async function reject(operation, code) {
  await assert.rejects(operation, (error) => error.code === code)
}
const mutation = (id, extra = {}) => ({
  mutationId: randomUUID(), kind: 'feed', baseVersion: null,
  record: { id, amount: 120, comment: '', occurredAt: '2026-09-10T12:00:00Z', updatedAt: '2026-09-10T12:00:00Z' }, ...extra,
})
const push = (client, family, mutations) => rpc(client, 'ls_sync_push', [family, JSON.stringify(mutations)])
const pull = (client, family, cursor = null, page = null) => rpc(client, 'ls_sync_pull', [family, cursor, page])
async function completePull(client, family, cursor = null) {
  const first = await pull(client, family, cursor)
  const records = [...first.records]
  let page = first
  while (page.nextPage) {
    page = await pull(client, family, cursor, page.nextPage)
    assert.equal(page.cursor, first.cursor)
    records.push(...page.records)
  }
  return { records, cursor: page.cursor }
}
let checks = 0
async function check(name, operation) {
  await operation()
  checks++
  console.log(`PASS ${name}`)
}

try {
  const a = await asUser(1), b = await asUser(2), c = await asUser(3), d = await asUser(4), legacy = await asUser(5)
  const anon = await asUser(null, 'anon'), noIdentity = await asUser(null)
  const identityA = await rpc(a, 'ls_identity')
  const identityB = await rpc(b, 'ls_identity')
  let family, other, invitation
  await check('migration preserves legacy account lookup IDs without bypassing the identity bridge', async () => {
    assert.equal(identityA.id, '10000000-0000-4000-8000-000000000001')
    assert.deepEqual(await rpc(a, 'ls_identity'), identityA)
    assert.equal((await owner.query('select app_user_id from little_sips_supabase.identities where subject=$1', [identityA.id])).rows[0].app_user_id, identityA.id)
    await reject(() => rpc(noIdentity, 'ls_identity'), 'LS401')
    await reject(() => rpc(anon, 'ls_identity'), '42501')
  })
  await check('post-migration accounts resolve independently allocated stable app identities', async () => {
    const subject = '10000000-0000-4000-8000-000000000007'
    await owner.query("insert into auth.users(id,email) values ($1,'new@example.test')", [subject])
    const newlyRegistered = await asUser(7)
    const identity = await rpc(newlyRegistered, 'ls_identity')
    assert.notEqual(identity.id, subject)
    assert.deepEqual(await rpc(newlyRegistered, 'ls_identity'), identity)
    assert.equal((await owner.query('select app_user_id from little_sips_supabase.identities where subject=$1', [subject])).rows[0].app_user_id, identity.id)
    assert.equal(await rpc(newlyRegistered, 'ls_family_current'), null)
  })
  await check('legacy history/tombstones migrated; invalid originals remain archived', async () => {
    const f = await rpc(legacy, 'ls_family_current')
    const page = await pull(legacy, f.id)
    assert.equal(page.records.length, 2)
    assert(page.records.some((row) => row.record.deletedAt))
    assert.equal((await owner.query('select count(*) from little_sips_supabase.weights')).rows[0].count, '2')
    assert.equal((await owner.query('select count(*) from little_sips_supabase.legacy_import_errors')).rows[0].count, '1')
    await reject(() => legacy.query('select * from little_sips_supabase.weights'), '42501')
    assert.equal((await owner.query("select to_regclass('public.feeds') as t")).rows[0].t, null)
  })
  await check('one family per user and creator membership', async () => {
    assert.equal(await rpc(a, 'ls_family_current'), null)
    family = await rpc(a, 'ls_family_create')
    assert.equal(family.ownerId, identityA.id)
    assert.deepEqual(family.members.map((m) => m.userId), [identityA.id])
    await reject(() => rpc(a, 'ls_family_create'), 'LS400')
    other = await rpc(d, 'ls_family_create')
  })
  await check('internal tables/functions and actor spoofing are inaccessible', async () => {
    await reject(() => a.query('select * from little_sips.record_versions'), '42501')
    await reject(() => a.query('select little_sips.family_create($1)', [identityB.id]), '42501')
    await reject(() => a.query("select little_sips_supabase.map_identity($1, 'fake')", [identityB.id]), '42501')
    await reject(() => pull(d, family.id), 'LS403')
    await reject(() => push(d, family.id, []), 'LS403')
    const exposed = await owner.query(`select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname in ('little_sips','little_sips_supabase') and has_function_privilege('authenticated',p.oid,'EXECUTE')`)
    assert.deepEqual(exposed.rows, [])
  })
  await check('invites hash secrets, expire after 24h, and revoke atomically', async () => {
    invitation = await rpc(a, 'ls_family_invite', [family.id])
    assert.match(invitation.token, /^[0-9a-f]{64}$/)
    assert(Math.abs(Date.parse(invitation.expiresAt) - Date.now() - 86400000) < 5000)
    const row = (await owner.query('select * from little_sips.invitations where family_id=$1', [family.id])).rows[0]
    assert.notEqual(row.token_hash, invitation.token)
    await rpc(a, 'ls_family_revoke_invitation', [family.id])
    await reject(() => rpc(b, 'ls_family_join', [invitation.token]), 'LS403')
    invitation = await rpc(a, 'ls_family_invite', [family.id])
    await owner.query("update little_sips.invitations set expires_at=now()-interval '1 second' where family_id=$1", [family.id])
    await reject(() => rpc(b, 'ls_family_join', [invitation.token]), 'LS403')
    invitation = await rpc(a, 'ls_family_invite', [family.id])
  })
  await check('invitation acceptance is single-use with maximum two members', async () => {
    const joined = await rpc(b, 'ls_family_join', [invitation.token])
    assert.equal(joined.members.length, 2)
    await reject(() => rpc(c, 'ls_family_join', [invitation.token]), 'LS403')
    await reject(() => rpc(a, 'ls_family_invite', [family.id]), 'LS400')
    await reject(() => rpc(b, 'ls_family_invite', [family.id]), 'LS403')
    await reject(() => rpc(b, 'ls_family_delete', [family.id]), 'LS403')
    await reject(() => rpc(b, 'ls_family_remove_member', [family.id, identityA.id]), 'LS403')
    await reject(() => rpc(a, 'ls_family_leave', [family.id]), 'LS403')
  })
  let initial, accepted, latest
  await check('arbitrary string IDs, distinct record kinds, immutable retry receipts', async () => {
    initial = mutation('feed-1')
    accepted = await push(a, family.id, [initial])
    assert.equal(accepted[0].status, 'accepted')
    assert.deepEqual(await push(a, family.id, [initial]), accepted)
    await reject(() => push(a, family.id, [{ ...initial, record: { ...initial.record, amount: 130 } }]), 'LS400')
    await reject(() => push(a, family.id, [{ ...initial, baseVersion: accepted[0].current.version }]), 'LS400')
    await reject(() => push(b, family.id, [initial]), 'LS400')
    const weight = mutation('feed-1', { kind: 'weight', record: { id: 'feed-1', kilograms: 3.4, occurredAt: initial.record.occurredAt } })
    assert.equal((await push(b, family.id, [weight]))[0].status, 'accepted')
    assert.equal((await pull(a, family.id)).records.length, 2)
  })
  await check('CAS conflict and conflict retry preserve original result after later changes', async () => {
    const stale = mutation('feed-1')
    const conflict = await push(b, family.id, [stale])
    assert.equal(conflict[0].status, 'conflict')
    assert.deepEqual(conflict[0].current, accepted[0].current)
    latest = mutation('feed-1', { baseVersion: accepted[0].current.version })
    latest.record.amount = 150
    assert.equal((await push(a, family.id, [latest]))[0].status, 'accepted')
    assert.deepEqual(await push(b, family.id, [stale]), conflict)
    await reject(() => push(b, family.id, [{ ...stale, baseVersion: accepted[0].current.version }]), 'LS400')
    assert.deepEqual(await push(a, family.id, [initial]), accepted)
  })
  await check('record validation agrees with application boundaries and batches roll back', async () => {
    const invalids = [
      { ...mutation(''), record: { ...initial.record, id: ' \t' } },
      mutation('bad', { record: { ...initial.record, id: '\u00a0\ufeff' } }),
      mutation('bad', { record: { ...initial.record, amount: 0 } }),
      mutation('bad', { record: { ...initial.record, amount: 1.5 } }),
      mutation('bad', { record: { ...initial.record, amount: '120' } }),
      mutation('bad', { record: { ...initial.record, occurredAt: '2026-02-30T12:00:00Z' } }),
      mutation('bad', { record: { ...initial.record, updatedAt: null } }),
      mutation('bad', { record: { ...initial.record, deletedAt: '2026-01-01T24:00:00Z' } }),
      mutation('bad', { record: { ...initial.record, comment: '😀'.repeat(81) } }),
      mutation('bad', { kind: 'weight', record: { ...initial.record, kilograms: 0.01 } }),
      mutation('bad', { mutationId: 'not-a-uuid' }),
    ]
    for (const invalid of invalids) await reject(() => push(a, family.id, [invalid]), 'LS400')
    const before = await pull(a, family.id)
    await reject(() => push(a, family.id, [mutation('rolled-back'), invalids[1]]), 'LS400')
    assert.deepEqual(await pull(a, family.id), before)
    assert.equal((await push(a, family.id, [mutation('emoji', { record: { ...initial.record, id: 'emoji', comment: '😀'.repeat(80) } })]))[0].status, 'accepted')
  })
  await check('long arbitrary string IDs do not exceed index tuple limits', async () => {
    const long = mutation(Array.from({ length: 300 }, () => randomUUID()).join(''))
    const acceptedLong = await push(d, other.id, [long])
    assert.equal(acceptedLong[0].status, 'accepted')
    assert.equal((await pull(d, other.id)).records[0].record.id, long.record.id)
  })
  await check('bounded initial pages exceed 1000 rows and exclude inter-page writes', async () => {
    for (let start = 0; start < 1200; start += 400) {
      await push(a, family.id, Array.from({ length: 400 }, (_, i) => mutation(`history-${start + i}`)))
    }
    const first = await pull(a, family.id)
    assert.equal(first.records.length, 500)
    assert(first.nextPage)
    await push(b, family.id, [mutation('arrived-between-pages')])
    let continuation = first.nextPage
    const records = [...first.records]
    while (continuation) {
      const page = await pull(a, family.id, null, continuation)
      assert.equal(page.cursor, first.cursor)
      records.push(...page.records)
      continuation = page.nextPage
    }
    assert.equal(records.length, 1203)
    assert.equal(new Set(records.map((r) => `${r.kind}:${r.record.id}`)).size, 1203)
    assert(!records.some((r) => r.record.id === 'arrived-between-pages'))
    const delta = await pull(a, family.id, first.cursor)
    assert.equal(delta.records.length, 1)
    assert.equal(delta.records[0].record.id, 'arrived-between-pages')
  })
  await check('bounded deltas paginate and retain snapshot versions plus tombstones', async () => {
    const baseline = await completePull(a, family.id)
    const version = (await owner.query("select revision::text from little_sips.record_versions where family_id=$1 and kind='feed' and record_id='history-1199'", [family.id])).rows[0].revision
    for (let start = 0; start < 1100; start += 100) await push(b, family.id, Array.from({ length: 100 }, (_, i) => mutation(`delta-${start + i}`)))
    const first = await pull(a, family.id, baseline.cursor)
    assert.equal(first.records.length, 500)
    const unseen = mutation('history-1199', { baseVersion: version })
    unseen.record.deletedAt = '2026-09-11T12:00:00Z'
    await push(a, family.id, [unseen])
    let next = first.nextPage
    const rows = [...first.records]
    while (next) { const page = await pull(a, family.id, baseline.cursor, next); rows.push(...page.records); next = page.nextPage }
    assert.equal(rows.length, 1100)
    const deletion = await pull(a, family.id, first.cursor)
    assert.equal(deletion.records.length, 1)
    assert(deletion.records[0].record.deletedAt)
    assert.deepEqual((await pull(a, family.id, deletion.cursor)).records, [])
    await reject(() => pull(a, other.id, first.cursor), 'LS403')
    await reject(() => pull(d, other.id, first.cursor), 'LS400')
    await reject(() => pull(a, family.id, 'not-json'), 'LS400')
  })
  await check('unseen updated keys keep their bounded version; repeated pages recover identically', async () => {
    const old = (await owner.query("select revision::text from little_sips.record_versions where family_id=$1 and kind='feed' and record_id='delta-1099' order by revision desc limit 1", [family.id])).rows[0].revision
    const first = await pull(a, family.id)
    assert(first.nextPage)
    assert(!first.records.some((row) => row.record.id === 'delta-1099'))
    const beforeUpdate = await pull(a, family.id, null, first.nextPage)
    const edit = mutation('delta-1099', { baseVersion: old })
    edit.record.amount = 321
    await push(b, family.id, [edit])
    assert.deepEqual(await pull(a, family.id, null, first.nextPage), beforeUpdate)
    let next = first.nextPage
    const rows = [...first.records]
    while (next) {
      const page = await pull(a, family.id, null, next)
      assert.equal(page.cursor, first.cursor)
      assert.deepEqual(await pull(a, family.id, null, next), page)
      rows.push(...page.records)
      next = page.nextPage
    }
    assert.equal(rows.find((row) => row.record.id === 'delta-1099').record.amount, 120)
    const delta = await pull(a, family.id, first.cursor)
    assert.equal(delta.records.length, 1)
    assert.equal(delta.records[0].record.amount, 321)
  })
  await check('two concurrent CAS edits accept exactly one and retain the loser as conflict', async () => {
    const base = await push(a, family.id, [mutation('concurrent-record')])
    const m1 = mutation('concurrent-record', { baseVersion: base[0].current.version })
    const m2 = mutation('concurrent-record', { baseVersion: base[0].current.version })
    m1.record.amount = 100; m2.record.amount = 200
    const results = await Promise.all([push(a, family.id, [m1]), push(b, family.id, [m2])])
    assert.deepEqual(results.flat().map((r) => r.status).sort(), ['accepted', 'conflict'])
  })
  await check('pull cannot advance past an uncommitted writer; rollback leaves no cursor gap', async () => {
    const before = await completePull(b, family.id)
    await a.query('begin')
    await push(a, family.id, [mutation('uncommitted')])
    let completed = false
    const waiting = pull(b, family.id, before.cursor).then((r) => { completed = true; return r })
    await new Promise((resolve) => setTimeout(resolve, 100))
    assert.equal(completed, false)
    assert.equal((await owner.query('select wait_event_type from pg_stat_activity where pid=$1', [b.processID])).rows[0].wait_event_type, 'Lock')
    await a.query('rollback')
    assert.deepEqual((await waiting).records, [])
    await push(a, family.id, [mutation('after-rollback')])
    assert.equal((await pull(b, family.id, before.cursor)).records.length, 1)
  })
  await check('waiting pull includes committed writes without advancing past the committed frontier', async () => {
    const before = await completePull(b, family.id)
    await a.query('begin')
    const request = mutation('committed-frontier')
    const response = await push(a, family.id, [request])
    let completed = false
    const waiting = pull(b, family.id, before.cursor).then((result) => { completed = true; return result })
    await new Promise((resolve) => setTimeout(resolve, 100))
    assert.equal(completed, false)
    assert.equal((await owner.query('select wait_event_type from pg_stat_activity where pid=$1', [b.processID])).rows[0].wait_event_type, 'Lock')
    await a.query('commit')
    const committed = await waiting
    assert.equal(committed.records.length, 1)
    assert.equal(committed.records[0].record.id, 'committed-frontier')
    assert.equal(committed.nextPage, null)
    assert.deepEqual(await push(a, family.id, [request]), response)
    assert.deepEqual(await pull(b, family.id, before.cursor), committed)
    assert.deepEqual((await pull(b, family.id, committed.cursor)).records, [])
  })
  await check('removed membership rejects pull/push—including old successful receipts', async () => {
    const prior = mutation('member-receipt')
    await push(b, family.id, [prior])
    await rpc(a, 'ls_family_remove_member', [family.id, identityB.id])
    await reject(() => push(b, family.id, [prior]), 'LS403')
    await reject(() => pull(b, family.id), 'LS403')
    assert.equal(await rpc(b, 'ls_family_current'), null)
  })
  await check('two simultaneous invite recipients cannot create a third membership', async () => {
    const token = await rpc(a, 'ls_family_invite', [family.id])
    const results = await Promise.allSettled([rpc(b, 'ls_family_join', [token.token]), rpc(c, 'ls_family_join', [token.token])])
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1)
    assert.equal((await rpc(a, 'ls_family_current')).members.length, 2)
    const winner = results[0].status === 'fulfilled' ? b : c
    await rpc(winner, 'ls_family_leave', [family.id])
    await reject(() => pull(winner, family.id), 'LS403')
  })
  await check('simultaneous joins to different families still permit only one membership', async () => {
    const b2 = await asUser(2)
    const tokenA = await rpc(a, 'ls_family_invite', [family.id])
    const tokenD = await rpc(d, 'ls_family_invite', [other.id])
    const results = await Promise.allSettled([rpc(b, 'ls_family_join', [tokenA.token]), rpc(b2, 'ls_family_join', [tokenD.token])])
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1)
    const current = await rpc(b, 'ls_family_current')
    await rpc(b, 'ls_family_leave', [current.id])
  })
  await check('creator-only deletion removes cloud ledger/receipts and rejects stale requests', async () => {
    await reject(() => rpc(d, 'ls_family_delete', [family.id]), 'LS403')
    await rpc(a, 'ls_family_delete', [family.id])
    await reject(() => push(a, family.id, [initial]), 'LS403')
    await reject(() => pull(a, family.id), 'LS403')
    assert.equal((await owner.query('select count(*) from little_sips.record_versions where family_id=$1', [family.id])).rows[0].count, '0')
    assert.equal((await owner.query('select count(*) from little_sips.mutation_receipts where family_id=$1', [family.id])).rows[0].count, '0')
  })
  console.log(`${checks} SQL integration checks passed (including concurrent transactions).`)
} finally {
  await Promise.all(clients.map((client) => client.end()))
  await owner.end()
}
