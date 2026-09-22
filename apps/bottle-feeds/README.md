# Little Sips – Bottle Feed & Growth Tracker

A privacy-first Vue 3 + TypeScript application for recording bottle feeds and baby weights.
Deployed as a static GitHub Pages site.

## Privacy & local storage

**All data is local by default.**
Records are stored in the browser's IndexedDB (via [unstorage](https://unstorage.unjs.io/)
and atomic `idb-keyval` transactions).
Nothing is sent to any server unless you explicitly enable cloud sync.

> ⚠️ Clearing your browser's site data will erase all local records.
> Use *Export data* regularly as a backup, or enable cloud sync.

If a write fails, an unsaved-changes notice stays visible with a retry action.
Keep that page open until saving succeeds, then export a backup. A failed read
does not replace existing data with an empty dataset.

## Cloud sync (optional)

Cloud sync is powered by [Supabase](https://supabase.com/) and is completely
optional. If the `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`
environment variables are absent, the app operates in local-only mode and
makes **no Supabase requests**.

### Sign-in

Authentication uses **Google or Microsoft OAuth**. No application email delivery,
magic-link service, or custom SMTP service is required. Signing in is an explicit
opt-in: simply visiting the app does not construct a backend client or contact it.
The production Supabase adapter handles OAuth at the static app's base URL.

One family contains one baby's history and at most two parents. Each account can
belong to one family. The creator invites a partner using an expiring, single-use
link, shared manually. Both parents can edit individual records; only the creator
can remove a member or delete the entire shared family. The invited parent can leave.

### Identity isolation

- While unauthenticated, records are stored under the `guest` namespace.
- Family histories are isolated by backend instance, account, and family.
- When joining or creating a family with existing guest records, the app asks
  before merging them. Guest data is **never silently uploaded**.
- Signing out hides family history and retains pending changes for that same
  account. It never moves private family records into guest storage.
- In-flight sync and namespace loads are invalidated when the identity changes.
- Unsaved drafts stay isolated to their owning identity and reappear with a
  retry notice when that identity returns. They remain memory-only until saved,
  so keep the page open while a write failure is unresolved.

Legacy `user-*` stores are retained, not silently reassigned to a new backend.
Those older keys did not record project provenance, so matching account UUIDs
cannot prove ownership of a prior deployment. Export from the original app and
use the explicit recovery import path; do not copy old tokens or assume that
identical IDs in a replacement project authorize access.

### Sync behaviour

- Changes are saved to IndexedDB immediately (local-first).
- Atomic merges preserve changes made in another tab; open tabs refresh each
  other without sending record contents through the notification channel.
- Records, pending mutations, server versions, conflicts, and incremental
  cursors are persisted coherently. A network failure does not acknowledge work.
- Changes recorded while sync is running are retained and remain pending until
  a later sync includes them.
- Synchronization runs after local edits, on reconnection and foregrounding,
  periodically while visible, and through **Sync now**. Realtime notifications
  are an optional optimization, not a correctness requirement.
- Initial history is paginated. Later requests transfer deltas and changed
  records rather than uploading and downloading all history.
- Server-side conditional writes use base versions, not device clocks. Retried
  mutation IDs are idempotent. Conflicts preserve both alternatives for an
  explicit choice, including edit-versus-delete conflicts.
- Tombstones remain in history; no unsafe cleanup makes an old device resurrect
  deleted records. Family deletion or revoked membership stops uploads.
- Closed or suspended tabs do not synchronize. Expired authentication does not
  prevent editing previously downloaded data; reconnect and reauthenticate
  before sending pending work.

## Export, import, and reports

Use the *Export data* and *Import data* buttons in the toolbar to back up and
restore data as JSON. Exports are complete versioned recovery backups, including
tombstones, pending changes, and conflicts for the accessible history, without
credentials or hidden account histories. Importing never authorizes cloud access
or silently uploads a backup. Every record is validated before an import changes anything;
invalid timestamps, quantities, or duplicate IDs reject the entire import.
Older exports without update timestamps remain supported.

Use *Share report* to create a clinician-readable PDF in the browser for a
selected date range. Report generation stays local to the device and does not
upload data to a server.
Known conflicts block only reports whose selected dates, categories, or displayed
values are affected. PDFs are not recovery backups.

Rolling periods use the same interval for report totals and chart buckets.
Custom dates include complete local calendar days, including daylight-saving
time changes.

## Development

Requirements: Node.js ≥ 22.18 and pnpm.

```bash
# Install dependencies from the monorepo root
pnpm install

# Start the dev server
pnpm run --filter bottle-feeds dev

# Run unit tests
pnpm run --filter bottle-feeds test:unit

# Type-check
pnpm run --filter bottle-feeds type-check

# Lint
pnpm run --filter bottle-feeds lint

# Production build
pnpm run --filter bottle-feeds build
```

Sharing end-to-end tests substitute a test-only implementation of the backend
contract while exercising the actual app, browser contexts, and IndexedDB.
They do not require real accounts or credentials, and do not prove hosted OAuth
or database authorization. The SQL integration suite under `supabase/tests`
separately exercises PostgreSQL transactions and permissions.

## Setting up Supabase (optional)

1. Create a project at [supabase.com](https://supabase.com/).
2. Apply the SQL files in `supabase/migrations` in filename order. The initial
   schema is followed by family sharing migrations; deploying only `001_initial.sql`
   does not support this version of the app.
3. Copy `apps/bottle-feeds/.env.example` to `apps/bottle-feeds/.env.local`
   and fill in your project URL and publishable (anon) key:

   ```
   VITE_SUPABASE_URL=https://your-project.supabase.co
   VITE_SUPABASE_PUBLISHABLE_KEY=your-anon-key
   ```

   **Never put the service-role key here.** Only the publishable key is
   safe to expose in a browser bundle. RLS is the authorisation boundary.

4. In *Supabase → Authentication → URL Configuration*, add your allowed
   redirect URLs:
   - Local dev: `http://localhost:5173/`
   - GitHub Pages: `https://<user>.github.io/new-parents-tool/`

   Enable Google and Azure (Microsoft) in the Supabase authentication providers.
   Register their OAuth applications and configure the callback URL shown by
   Supabase in each provider console. Keep provider client secrets in Supabase,
   never in `VITE_*` variables. For Microsoft, select the intended account types
   (including personal Microsoft accounts if desired); the adapter requests the
   required email scope.

5. Set the same environment variables as GitHub Actions secrets
   (`VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`) for the
   deployment workflow.

## Offline behaviour

A first visit needs internet. In a production build, wait for **Ready to reopen
offline** before disconnecting: the service worker precaches the static app and
all lazy features, including first-use PDF generation, at the configured base path.
API responses, authentication responses, and invitation secrets are not cached.
Updates do not force a reload while a parent is entering records.

No `.env` file, Supabase project, account, or cloud service is needed to build,
deploy, or use the standalone app. Missing, blank, or incomplete backend settings
disable sharing rather than breaking startup.

Removing configuration retains the last accessible local history unless the user
explicitly signed out. Restoring configuration requires consent to resume uploads.
A different project is a different backend: old sessions, cursors, and queues must
not transfer automatically. Browser storage eviction and clearing site data can
remove records and offline access; regular exports remain necessary.

## Replacing Supabase

`src/backends/contracts.ts` is the app-owned boundary for authentication, families,
and incremental synchronization. `src/backends/index.ts` is composition/configuration;
`src/backends/supabase` alone owns the Supabase SDK and its transport types.
The local store, synchronization engine, reports, and UI use domain records and
normalized errors, not provider sessions or PostgREST responses.

A replacement backend implements `CloudBackend`, preserving pagination, conditional
writes, mutation idempotency, and membership authorization. Notifications are optional.
The PostgreSQL domain schema is separate from the Supabase identity/auth bridge.
Tests use a separate in-memory backend to exercise the same client contract.

Azure PostgreSQL by itself is not a browser API or identity provider. A future Azure
deployment needs an authenticated HTTPS API and a matching auth adapter, plus an
explicit account/data migration. Never expose database credentials to the browser.
Only the Supabase production adapter is included; no Azure resources are provisioned.

## Operating costs and limits

Supabase Free can be used without a separate email provider or custom backend.
Track database size (including indexes, tombstones, and mutation history), egress,
and authentication usage rather than treating the plan as unlimited capacity.
Foreground polling uses more requests as active families grow. Free projects can
pause and quotas can change; local recording remains available during outages.
Cloud replication is not a substitute for recovery backups.

## Deployment

GitHub Actions automatically builds and deploys to GitHub Pages on every push
to `main`. See `.github/workflows/deploy-pages.yml`.
