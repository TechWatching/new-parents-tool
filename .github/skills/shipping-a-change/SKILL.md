---
name: shipping-a-change
description: What to update when you change something in this repo, and what "done" requires. Use before opening a pull request.
---

# Shipping a change

## Add a cloud backend operation

1. Add the app-owned types and method to `apps/bottle-feeds/src/backends/contracts.ts`.
2. Implement the operation in `apps/bottle-feeds/src/backends/supabase/index.ts`; keep SDK creation and configuration behind `apps/bottle-feeds/src/backends/index.ts`.
3. Add operation coverage to `apps/bottle-feeds/src/backends/supabase/__tests__/adapter.spec.ts`; update `apps/bottle-feeds/e2e/helpers/browser-backend.ts` when an E2E flow uses it.
4. For database behavior, add an ordered SQL migration under `supabase/migrations/` and extend `supabase/tests/`.
5. Run `vp run --filter bottle-feeds test:unit -- --run`.

## When you change this, also change that

| Change | Also update |
|---|---|
| Feed or weight fields, validation, or backup format | `apps/bottle-feeds/src/types.ts`, `apps/bottle-feeds/src/validation.ts`, `apps/bottle-feeds/src/backup.ts`, `apps/bottle-feeds/src/storage.ts`, `apps/bottle-feeds/src/__tests__/validation.spec.ts`, `apps/bottle-feeds/src/__tests__/storage.spec.ts`, and `supabase/migrations/` when cloud records are affected |
| Cloud identity, family, or sync behavior | `apps/bottle-feeds/src/backends/contracts.ts`, `apps/bottle-feeds/src/backends/supabase/index.ts`, `apps/bottle-feeds/src/sync.ts`, `apps/bottle-feeds/src/composables/useAppData.ts`, adapter/lifecycle/E2E tests, and `supabase/migrations/` plus `supabase/tests/` for server changes |
| User-visible workflow or copy | `apps/bottle-feeds/src/components/`, all locales in `apps/bottle-feeds/src/i18n.ts`, `apps/bottle-feeds/src/sharing-messages.ts` when applicable, related tests, and `docs/USER_GUIDE.md` |
| Offline, PWA, or deployment behavior | `apps/bottle-feeds/vite.config.ts`, `apps/bottle-feeds/service-worker/`, `apps/bottle-feeds/e2e/pwa/`, `.github/workflows/deploy-pages.yml`, and `apps/bottle-feeds/README.md` |

## Done

- `vp run --recursive lint` passes.
- `vp run --filter bottle-feeds test:unit -- --run` passes.
- `vp run --filter bottle-feeds type-check` passes.
- `vp run --recursive build` passes.
- Every behavior change has a regression test in the lane that exercises it.
