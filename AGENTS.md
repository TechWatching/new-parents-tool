# Repository instructions

## Verify changes

- For browser-visible app behavior, follow `.github/skills/browser-verification/SKILL.md`.
- Before calling behavior untestable, search the Vitest, Playwright, and PostgreSQL test lanes. See `supabase/README.md`; its SQL suite requires an empty disposable database whose name starts with `little_sips_test`.

## Non-obvious invariants

- Cloud sharing is optional and consent-based. Keep Supabase client creation lazy behind `apps/bottle-feeds/src/backends/index.ts`.
- Keep the provider-neutral contract in `apps/bottle-feeds/src/backends/contracts.ts`; Supabase SDK and transport details stay in `apps/bottle-feeds/src/backends/supabase/`.
- Preserve per-identity local history, pending changes, and recovery behavior when changing `apps/bottle-feeds/src/storage.ts` or `apps/bottle-feeds/src/sharing/`.
- Identity changes must invalidate in-flight sync and namespace loads; cover cross-tab and sign-out transitions when changing sharing behavior.
- Add UI copy to all four locales (`en`, `fr`, `es`, `de`) in `apps/bottle-feeds/src/i18n.ts`; sharing and offline copy also lives in `apps/bottle-feeds/src/sharing-messages.ts`.
- Recent agent reviews found duplicate or brittle tests: cover the changed behavior in its actual test lane and prefer assertions based on rendered values or fixtures over positional or hard-coded assumptions.

## Add a cloud backend operation

1. Add its app-owned types and method to `apps/bottle-feeds/src/backends/contracts.ts`.
2. Implement it in `apps/bottle-feeds/src/backends/supabase/index.ts`; keep SDK creation and configuration behind `apps/bottle-feeds/src/backends/index.ts`.
3. Update adapter tests and the E2E backend fixture when applicable; for database behavior, add an ordered migration and coverage under `supabase/tests/`.

## Documentation and maintenance matrix

End-user workflows live in `docs/USER_GUIDE.md`; local/cloud setup, privacy, recovery, and backend portability live in `apps/bottle-feeds/README.md`. Update the relevant guide when those behaviors change.

| Change | Also update |
|---|---|
| Feed or weight fields, validation, or backup format | `apps/bottle-feeds/src/types.ts`, `apps/bottle-feeds/src/validation.ts`, `apps/bottle-feeds/src/backup.ts`, `apps/bottle-feeds/src/storage.ts`, `apps/bottle-feeds/src/__tests__/validation.spec.ts`, `apps/bottle-feeds/src/__tests__/storage.spec.ts`, and `supabase/migrations/` when cloud records are affected |
| Cloud identity, family, or sync behavior | `apps/bottle-feeds/src/backends/contracts.ts`, `apps/bottle-feeds/src/backends/supabase/index.ts`, `apps/bottle-feeds/src/sync.ts`, `apps/bottle-feeds/src/composables/useAppData.ts`, `apps/bottle-feeds/src/backends/supabase/__tests__/adapter.spec.ts`, `apps/bottle-feeds/src/__tests__/data-lifecycle.spec.ts`, `apps/bottle-feeds/e2e/`, and `supabase/migrations/` plus `supabase/tests/` for server changes |
| User-visible workflow or copy | `apps/bottle-feeds/src/components/`, all locales in `apps/bottle-feeds/src/i18n.ts`, `apps/bottle-feeds/src/sharing-messages.ts` when applicable, `apps/bottle-feeds/src/__tests__/`, `apps/bottle-feeds/e2e/`, and `docs/USER_GUIDE.md` |
| Offline, PWA, or deployment behavior | `apps/bottle-feeds/vite.config.ts`, `apps/bottle-feeds/service-worker/`, `apps/bottle-feeds/e2e/pwa/`, `.github/workflows/deploy-pages.yml`, and `apps/bottle-feeds/README.md` |

## Done means

- `vp run --recursive lint` passes.
- `vp run --filter bottle-feeds test:unit -- --run` passes.
- `vp run --filter bottle-feeds type-check` passes.
- `vp run --recursive build` passes.
- Every behavior change has a regression test in the lane that exercises it.

## Never merges without a human

A person has to have **read this diff** before it lands. Telling an agent "merge it when you're done" is approving a goal, not this change — so it does not count for anything on this list. Everywhere else it counts fine, which is the point of having a list.

- Anything under `supabase/migrations/` — migrations change real database schema, authorization, or retained records.
- Changes to `.github/workflows/deploy-pages.yml` — this workflow publishes the production site.
