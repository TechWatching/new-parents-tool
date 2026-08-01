---
name: browser-verification
description: Use this skill whenever a change to an app in this repository can be observed in a browser — a bug fix, a UI or behavior change, a new feature, a regression report, or a review comment about something "not working". Reproduce the reported bug in a real browser with playwright-cli BEFORE writing any fix, verify the implemented behavior in the same browser afterwards, capture screenshot evidence, and publish that evidence on the pull request or issue. Applies even when the request never mentions Playwright, browsers, testing, or screenshots.
allowed-tools: Bash(playwright-cli:*) Bash(npx:*) Bash(pnpm:*) Bash(vp:*)
---

# Browser verification

Nothing that can be seen in a browser is "done" because the code looks right,
the unit tests pass, or a diff was reviewed. It is done when it was observed
working in a browser.

This skill defines *what must be proven and when*. The browser mechanics
(commands, refs, snapshots, sessions) live in the
[`playwright-cli` skill](../playwright-cli/SKILL.md) — read it for any command
detail instead of guessing.

## When this applies

Applies to any task touching `apps/**` behavior or appearance: bug reports,
features, UI tweaks, i18n strings, data handling visible in the app, and
follow-up review comments about app behavior.

Does not apply to documentation-only, tooling-only, workflow-only, or purely
internal refactors with no observable change. In that case say so in one line
instead of running the browser.

## Serve the app

The bottle feed tracker runs on <http://localhost:5173>:

```sh
vp run --filter bottle-feeds dev
```

Keep the dev server running in the background for the whole session, then drive
it with `playwright-cli`:

```sh
playwright-cli open http://localhost:5173
playwright-cli snapshot
```

When the global `playwright-cli` command is missing, use the version bundled
with the app instead — run `npx playwright cli <command>` from
`apps/bottle-feeds`, where `@playwright/test` is installed.

Records live in IndexedDB (`new-parents-tool` / `bottle-feeds`, key
`guest:data`). To start from realistic data instead of clicking everything in
by hand, mirror `apps/bottle-feeds/e2e/helpers/seed-db.ts` and seed the store
with `playwright-cli run-code` before reloading.

## Contract

Follow these steps in order. Do not reorder step 1 and step 2 for bugs — a fix
that was never seen failing is not a verified fix.

1. **Reproduce first (bugs only).** Before editing any source file, drive the
   current code in the browser until the reported symptom appears. Capture the
   failing state:

   ```sh
   playwright-cli screenshot --filename=.playwright-cli/before.png
   ```

   If the symptom cannot be reproduced, stop and report that — with the exact
   steps tried — instead of fixing a guess.

2. **Implement** the fix or the feature.

3. **Verify in the browser.** Reload and replay the exact same steps from step 1
   (or the acceptance path of the feature) and confirm the expected behavior.
   Capture the passing state:

   ```sh
   playwright-cli screenshot --filename=.playwright-cli/after.png
   ```

   Also check `playwright-cli console` for new errors before declaring success.

4. **Lock it in with a test.** Turn the reproduction path into an end-to-end
   spec under `apps/bottle-feeds/e2e/` and run it:

   ```sh
   vp run --filter bottle-feeds test:e2e
   ```

   A manual browser check proves the change works today; the spec keeps it
   working. Skip only when an equivalent spec already covers the path.

5. **Publish the evidence.** Attach the screenshots to the pull request or the
   issue, with a one-line caption each (`before` = the reproduced bug, `after` =
   the verified behavior). For a visual change, before/after images are
   expected; for a non-visual one, a single "after" image plus the steps
   replayed is enough. When image upload is not available in the current
   environment, state that explicitly and paste the evidence as text instead:
   URL, the steps replayed, the relevant snapshot excerpt, and the console
   output.

6. **Clean up.** Close the browser and stop the dev server:

   ```sh
   playwright-cli close
   ```

## Evidence rules

- Screenshots, snapshots, and console logs go to `.playwright-cli/`, which is
  git-ignored at any depth. Never commit verification
  screenshots to the repository; the only images tracked in git are the
  documentation screenshots under `docs/images/`, and those are updated only
  when the documented screen itself changed.
- Never present a screenshot of a state you did not actually reach, and never
  describe a verification you did not run.
- If verification fails, report the failure and the observed state. A red
  result that is reported is worth more than a green claim that is not true.
