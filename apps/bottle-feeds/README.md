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
Keep that page open until saving succeeds, or export a backup. A failed read
does not replace existing data with an empty dataset.

## Cloud sync (optional)

Cloud sync is powered by [Supabase](https://supabase.com/) and is completely
optional. If the `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`
environment variables are absent, the app operates in local-only mode and
makes **no Supabase requests**.

### Sign-in

Authentication uses Supabase's **email OTP / magic-link** flow — no password
required. A sign-in link is sent to your email and redirects back to the app.
This works with GitHub Pages because the redirect URL is just a page fragment
that the Supabase client handles client-side.

### Identity isolation

- While unauthenticated, records are stored under the `guest` namespace.
- After sign-in, records are stored under `user-<uid>`.
- When you first sign in with existing guest records, the app prompts you to
  upload and merge them into your account. Guest data is **never silently
  uploaded**.
- Signing out never moves account data into guest storage.
- In-flight sync and namespace loads are invalidated when the identity changes.
- Unsaved drafts stay isolated to their owning identity and reappear with a
  retry notice when that identity returns. They remain memory-only until saved,
  so keep the page open while a write failure is unresolved.

### Sync behaviour

- Changes are saved to IndexedDB immediately (local-first).
- Atomic merges preserve changes made in another tab; open tabs refresh each
  other without sending record contents through the notification channel.
- A dirty flag records pending sync state so a network failure does not lose
  changes.
- Changes recorded while sync is running are retained and remain pending until
  a later sync includes them.
- Sync retries automatically on sign-in, when the browser comes back online,
  and via the explicit *Retry* button.
- Conflict strategy: newest `updatedAt` wins. Tombstone deletions propagate
  so stale clients cannot resurrect deleted records.
- Signed-in users can permanently delete their cloud copy while keeping the
  records on the current device. The app signs out afterward so those records
  are not immediately uploaded again. Editing and new syncs in that tab pause during
  deletion; the latest saved account records are transferred to guest storage
  atomically, including records saved by another tab while deletion was pending.

## Export, import, and reports

Use the *Export data* and *Import data* buttons in the toolbar to back up and
restore data as JSON. Imports merge records by stable ID rather than replacing
all existing data. Every record is validated before an import changes anything;
invalid timestamps, quantities, or duplicate IDs reject the entire import.
Older exports without update timestamps remain supported.

Use *Generate report* to create a clinician-readable PDF in the browser for a
selected date range. Report generation stays local to the device and does not
upload data to a server.

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

End-to-end tests use a fake Supabase project URL and intercept cloud requests.
They do not require real accounts, credentials, or a live cloud database.

## Setting up Supabase (optional)

1. Create a project at [supabase.com](https://supabase.com/).
2. In the Supabase SQL editor, run `supabase/migrations/001_initial.sql` from
   this repository. This creates the `feeds` and `weights` tables with Row
   Level Security enabled.
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
   - Local dev: `http://localhost:5173`
   - GitHub Pages: `https://<user>.github.io/new-parents-tool`

5. Set the same environment variables as GitHub Actions secrets
   (`VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`) for the
   deployment workflow.

## Offline behaviour

The app is fully usable offline. Changes are written to IndexedDB instantly.
Sync is deferred until the next sign-in or `online` event.
The dirty flag in IndexedDB ensures pending changes survive page reloads.

## Deployment

GitHub Actions automatically builds and deploys to GitHub Pages on every push
to `main`. See `.github/workflows/deploy-pages.yml`.
