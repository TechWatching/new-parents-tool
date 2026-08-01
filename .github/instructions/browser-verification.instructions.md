---
applyTo: '**'
description: Always verify browser-observable bugs and features with playwright-cli.
---

# Verify in a real browser

Any change whose effect can be observed in a browser — a bug fix, a feature, a
UI or behavior change in `apps/**` — must be verified with the
[`browser-verification` skill](../skills/browser-verification/SKILL.md), which
drives the app through `playwright-cli`.

Non-negotiable:

- A bug is reproduced in the browser **before** it is fixed, never after.
- The fix or feature is replayed in the browser afterwards and observed working.
- Screenshot evidence of both states is published on the pull request or issue.

Never report browser-observable work as done on the strength of the diff, of
unit tests, or of reasoning alone. Changes that are not observable in a browser
(docs, tooling, CI, internal refactors) are exempt — say so in one line instead.
