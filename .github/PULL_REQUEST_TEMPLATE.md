## Summary

<!-- What problem does this change solve? -->

## Changes

<!-- List the meaningful changes. -->

## How to test

- [ ] `vp run --recursive lint`
- [ ] `vp run --filter bottle-feeds test:unit -- --run`
- [ ] `vp run --filter bottle-feeds type-check`
- [ ] `vp run --recursive build`
- [ ] Other checks (describe below), if applicable

## Review checklist

- [ ] Added or updated tests in the lane that exercises the changed behavior.
- [ ] Updated translations and the relevant user or setup documentation.
- [ ] For browser-visible changes, followed `.github/skills/browser-verification/SKILL.md`, added/updated an E2E spec, and attached the required evidence.
- [ ] For database changes, updated the ordered migrations and SQL integration coverage.
- [ ] Removed real health data, invitation links, tokens, and credentials from this PR.
