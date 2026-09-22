# Optional family backend

Little Sips works without this service. Do not configure a project just to run the
local app. Cloud construction happens only through `createBackend()` after the
application's explicit sharing consent; importing the composition module never
creates an SDK client. Missing, blank, partial, malformed, or secret-key
configuration disables sharing rather than blocking local startup.

## Deploying the Supabase adapter

1. Use a user-owned Supabase project and back up existing data first. Apply
   `migrations\001_initial.sql`, `002_portable_family_core.sql`, then
   `003_supabase_family_integration.sql` in order, as the database owner, or use the
   existing Supabase CLI migration workflow. **Do not reapply 001 to an existing
   database.** 002/003 are forward migrations, not edits to the deployed schema.
2. Enable Google and Azure (Microsoft) in Supabase Authentication. OAuth client
   secrets live only in the Supabase dashboard. Provider registrations use the
   Supabase callback `https://<project-ref>.supabase.co/auth/v1/callback`.
3. Allowlist the exact application return URLs in Supabase Auth, including the
   Pages base, for example `https://<owner>.github.io/new-parents-tool/`, and your
   local development origin/base. The app uses browser PKCE, persists the code
   verifier through the redirect, and lets the SDK finish the callback. There is
   no custom callback server. The adapter strips invitation/query/fragment
   secrets from the return URL while retaining its path.
4. For Microsoft, select organizational **and personal** Microsoft accounts and
   the common tenant (`https://login.microsoftonline.com/common`). The adapter
   maps the app's `microsoft` choice to Supabase `azure` and requests `email`.
   Configure Microsoft's optional `xms_edov` and `email` claims following the
   [Supabase Azure guide](https://supabase.com/docs/guides/auth/social-login/auth-azure),
   so Supabase can check verified email domains. Do not authorize family access
   using an email address. Track Microsoft secret expiration; work-account
   consent restrictions still need a real organizational-account test.
5. Supply only `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` to the
   frontend build. Modern publishable keys and legacy **anon** JWT keys are
   supported. Never use a service-role key, secret API key, provider client
   secret, or database password. An HTTPS project origin is required, except
   loopback HTTP for local Supabase. The stable backend ID is
   `supabase:<normalized project origin>` and is unchanged by public-key rotation.
6. Disable unused email/password sign-in in the deployed project's Auth settings.
   No SMTP provider, email-invitation service, paid resource, or realtime
   subscription is required by this implementation.

### Legacy data

003 locks the old feed/weight tables while copying their contents into one
single-parent family per existing data owner. It seeds an app-owned user and
identity bridge for **every existing Auth account**, including accounts without
cloud records. As a one-time migration choice, these app user IDs equal their
old Supabase UUIDs, preserving lookup of retained `user-<UUID>` browser stores
without exposing a second provider-specific identity through the app contract.
Newly registered accounts receive independently generated app user IDs; the
bridge remains the authority and can support arbitrary future mappings.
Valid records, existing IDs, timestamps, and tombstones
are preserved. The original tables are moved, **not dropped**, to
`little_sips_supabase.feeds` and `.weights`, inaccessible to API roles.

Some values accepted by 001 are invalid under the current app parser (for
example a weight below 0.1 kg or a comment exceeding 160 UTF-16 code units).
Those originals remain in the private archive; inspect
`little_sips_supabase.legacy_import_errors` as the database owner, correct/export
them deliberately, and recover them through a consented import. They are never
silently exposed as malformed cloud records. Keep the archive until migration
has been checked and an explicit retention decision made. This migration does
not merge guest or legacy browser histories into cloud records. Legacy browser
stores are never deleted or automatically selected/uploaded. Recovery must be
an explicit user-controlled import after authentication. Those old stores have
no backend provenance: matching UUIDs do **not** prove ownership in a different
deployment, and must never authorize cross-backend automatic reuse.

## Contract and transaction guarantees

`apps\bottle-feeds\src\backends\contracts.ts` is the app-owned interface. The only
production adapter is `src\backends\supabase`. SDK clients, provider identities,
Supabase-specific errors, and RPC names never cross that boundary.

- `auth.restore()` returns the identity bridge's **app user UUID**, never a
  client projection of `auth.users.id` (even when initially seeded equal during
  migration). `onChange` emits the same normalized identity. Its RPC is
  deferred outside Supabase's auth callback to avoid auth-lock deadlocks; stale
  account results are discarded. Transient identity lookup failures are not
  fabricated sign-outs. `restore()` surfaces failures for the caller's retry
  flow. Disposal removes listeners, stops refresh, and cancels pending RPCs.
- Every RPC derives its actor from the validated `auth.uid()` and an existing
  `auth.users` row. No public function accepts an actor ID. `p_member` is a
  removal **target**, never proof of authorization. Emails/names are display
  metadata only; the bridge does not link accounts by email.
- A user has at most one membership. A family has at most two parents,
  enforced with a unique user key plus a family-locking trigger. The creator
  alone can invite, revoke invitations, remove the other parent, or delete the
  family. The recipient can leave. The creator cannot leave/remove themselves;
  ownership transfer is not implemented.
- Invitations contain 244 random bits. Only their SHA-256 hash is stored, with
  a 24-hour expiration. Reissuing invalidates the old link. Join verifies expiry
  and consumes the secret while holding the family lock, in the same transaction
  as membership insertion. Concurrent/replayed acceptances cannot add a third
  member. The invite secret must not go into logs, telemetry, or backups.
- `sync.push` accepts up to **500 mutations per request**. The application
  batches larger queues. Record IDs are arbitrary nonempty strings (including
  legacy `feed-1`), with independent feed and weight key spaces. Mutation IDs
  must be UUIDs. The server validates the same quantities, calendar timestamps,
  tombstones, and 160-UTF-16-unit comments as `validation.ts`. Unknown record
  properties are not stored.
- Under the family lock, `baseVersion` must exactly match the current version.
  `null` means the key must never have existed; a tombstone is still an existing
  version. Each accepted write appends an immutable ledger version and increments
  the family revision in that transaction. Client timestamps never decide the
  winner.
- A mutation ID identifies the entire immutable request **and the original
  actor** within its family, including the base version. Retries return the
  original accepted **or conflict** receipt, even if the record has since
  changed. Reusing an ID for different content/actor is invalid. New conflict
  decisions require new IDs. Failed batches roll back entirely.
- Every push, including receipt replay and an empty batch, and every pull page
  reauthorizes membership while holding the family lock. Removed parents and
  deleted families cannot use stale receipts/cursors to regain access.
- `sync.pull(familyId, null, null)` starts a bounded snapshot of the latest
  version of every feed/weight, including tombstones. A nonnull cursor starts a
  bounded delta of keys changed since that cursor. Both return **at most 500**
  records per page, an opaque bounded `cursor`, and an opaque `nextPage`.
  Continue with the **original input cursor** and the returned `nextPage` until
  `nextPage` is null. Persist every page before committing the returned cursor.
- The bound comes from a row-locked, transactionally committed family revision,
  **not a global sequence or wall clock**. Later concurrent writes cannot leak
  into earlier pages or get skipped. Immutable ledger history retains the
  snapshot version even when another device changes that key between pages.
  Delta payloads contain only changed keys, not the full history. Empty deltas
  are successful only after authentication/membership checks.
- Cursor/version encodings are adapter-private. Clients do not parse, compare,
  or derive them from timestamps. Invalid/cross-family cursor input is rejected.
  Page tokens select bounds, not access: authorization is checked independently.
- Errors normalize to `BackendError` with `auth`, `forbidden`, `invalid`, or
  `transient`. CAS conflicts are typed results, not exceptions. Unavailable,
  cancelled, or malformed responses never become successful empty histories.
- Realtime is intentionally omitted. Foreground/reconnect/manual/visible-tab
  polling must provide correctness. No channel registration or publication is
  needed.

The immutable ledger and receipts intentionally have **no retention/compaction**
in this version. Removing them requires a future protocol for expiring cursors
and retry receipts; naïve cleanup breaks correctness. Monitor database size on
Supabase Free. Family deletion removes that family's entire ledger, receipts,
invitations, and memberships, but cannot erase previously downloaded local data.

## Database trust boundary and portability

002 contains ordinary PostgreSQL domain tables and internal transactions.
`little_sips` has no `auth` schema foreign keys, Supabase roles, SDK assumptions,
or managed extensions. Its internal functions take a trusted actor because they
are not API entry points. All internal tables enable RLS with no API policies;
all schema/table/function access is revoked from PUBLIC and API roles.

003 alone contains Supabase subject mapping, `auth.uid()`/`auth.users`, API role
grants, and public `ls_*` RPC wrappers. The wrappers are security definers with a
fixed `pg_catalog` search path and fully qualified domain objects. Only
`authenticated` gets EXECUTE; anonymous users cannot call them. Internal
functions are not security definers and are not directly callable by clients.
The migration owner must remain a trusted database owner; do not grant API
roles membership in it, internal schema usage, or arbitrary SQL execution.

A future Azure PostgreSQL adapter needs a trusted authenticated HTTPS API,
Google/Microsoft session validation and identity bridge, appropriately scoped
database execution, and these same CAS/pagination/family transactions.
PostgreSQL credentials must never enter a browser. Supabase wrappers, RLS role
integration, OAuth sessions, and optional notification infrastructure do not
automatically port. Evaluate any DAB API against these transaction requirements
rather than assuming generic CRUD can replace the protocol.

Moving an existing deployment additionally requires an authorized mapping of
app identities, memberships, records/tombstones and unresolved local work.
Matching emails/UUIDs alone are not authority. Never migrate provider tokens or
reuse old cursors/queues against a different backend ID. Portable backups remain
the supported user-controlled recovery path; Azure hosting and automated
cross-provider migrations are deliberately out of scope.

## Verification

Adapter/configuration tests use the existing Vite+ runner:

```powershell
Set-Location apps\bottle-feeds
.\node_modules\.bin\vp.cmd test run src\backends src\__tests__\backend-boundary.spec.ts
```

`tests\run-postgres.mjs` executes 001/002/003 and real PostgreSQL authorization,
legacy migration, validation, CAS, idempotency, >1,000-record bounded
initial/delta pagination, tombstones, rollback-frontier, and multi-connection
membership/write races. It also checks exact page replay after inter-page edits,
same-mutation-ID rejection when only the base version changes, and waiting pulls
against both committed and rolled-back writers (observing real lock waits).
It deliberately refuses nonempty databases or database
names not starting with `little_sips_test`. The connection must be a trusted
owner able to create fixture roles, in an **isolated disposable PostgreSQL
cluster**. Never use a production/hosted project.

With the `pg` driver already available, set:

```powershell
$env:LITTLE_SIPS_TEST_DATABASE_URL = 'postgres://postgres@127.0.0.1:55439/little_sips_test'
node supabase\tests\run-postgres.mjs
```

If `pg` is absent, install it into a disposable repository-local directory
(not the workspace package manifests), and set `LITTLE_SIPS_PG_MODULE` to the
file URL of its `pg\lib\index.js`. An isolated
`@embedded-postgres/windows-x64` binary distribution can run `initdb`/`postgres`
on loopback without Docker or installing/starting a global service. Stop that
specific instance and remove its files afterwards.

**Verified locally:** PostgreSQL 18.4 with real simultaneous transactions, and
mocked-SDK adapter tests. The fixture substitutes `auth.uid()` and `auth.users`;
this proves SQL grants/authorization/transactions, **not** Supabase gateway JWT
validation or actual OAuth. No hosted project/provider registrations/accounts
were supplied, so real Google/Microsoft redirects/callbacks, project deployment,
and hosted two-device sharing remain external verification blockers. Browser
offline/UI verification is handled separately by the application workstream.
