---
name: security-review
description: Security invariants for local child-health records, optional Supabase sharing, invitations, OAuth, and database authorization. Use when touching storage, backups, sharing, backend configuration, or SQL migrations.
---

# Security review

## Trust boundaries in this repo

- Feed, weight, and recovery history is stored in browser IndexedDB by `apps/bottle-feeds/src/storage.ts`; backup import/export is validated and sanitized in `apps/bottle-feeds/src/backup.ts`.
- Cloud sharing is opt-in. `apps/bottle-feeds/src/backends/index.ts` validates configuration and delays client creation until consent; `apps/bottle-feeds/src/backends/supabase/index.ts` is the only production Supabase adapter.
- Only `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` belong in the browser build. Service-role keys, database passwords, and OAuth provider secrets must remain outside `apps/bottle-feeds` and all `VITE_*` variables.
- Database authorization is enforced by RLS in `supabase/migrations/001_initial.sql` and the identity/RPC boundary in `supabase/migrations/003_supabase_family_integration.sql`. Public RPC wrappers derive the actor from `auth.uid()`; clients must not choose an actor ID.
- Invitation tokens pass through `apps/bottle-feeds/src/sharing/context.ts` and `apps/bottle-feeds/src/components/sharing/CloudSharingPanel.vue`. Keep them out of logs, telemetry, and backups; SQL stores only their hash.
- `supabase/migrations/002_portable_family_core.sql` contains internal domain transactions. Preserve its lack of API-role grants and the fixed search paths and narrow grants on the `003` RPC wrappers.

## Before merging a change to these paths

- For `apps/bottle-feeds/src/storage.ts`, `apps/bottle-feeds/src/backup.ts`, or `apps/bottle-feeds/src/sharing/`, verify local/account/recovery namespaces stay isolated and no history or pending work uploads without explicit consent.
- For `apps/bottle-feeds/src/backends/` or `supabase/migrations/`, verify actor derivation, membership authorization, invitation handling, RLS/grants, and token redaction still hold.
- Run the PostgreSQL suite from `supabase/README.md` only against an empty disposable database named with the `little_sips_test` prefix. Never point it at a hosted or production database.
- The PostgreSQL fixture tests database authorization and transactions, not Supabase gateway JWT validation or real Google/Microsoft OAuth. Do not claim hosted authentication was verified by those tests.
