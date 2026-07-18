# Little Sips – Bottle Feed & Growth Tracker

A privacy-first Vue 3 + TypeScript application for recording bottle feeds and baby weights.
Deployed as a static GitHub Pages site.

## Privacy & local storage

**All data is local by default.**
Records are stored in the browser's IndexedDB (via [unstorage](https://unstorage.unjs.io/)).
Nothing is sent to any server unless you explicitly enable cloud sync.

> ⚠️ Clearing your browser's site data will erase all local records.
> Use *Export data* regularly as a backup, or enable cloud sync.

### Legacy migration

If you used the app before this version, your `localStorage` records are
automatically migrated to IndexedDB on first load. The old key is preserved
until the migration succeeds.

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

### Sync behaviour

- Changes are saved to IndexedDB immediately (local-first).
- A dirty flag records pending sync state so a network failure does not lose
  changes.
- Sync retries automatically on sign-in, when the browser comes back online,
  and via the explicit *Retry* button.
- Conflict strategy: newest `updatedAt` wins. Tombstone deletions propagate
  so stale clients cannot resurrect deleted records.

## Export & import

Use the *Export data* and *Import data* buttons in the toolbar to back up and
restore data as JSON. Imports merge records by stable ID rather than replacing
all existing data.

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
