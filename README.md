# New Parents Tool

A pnpm monorepo for simple, privacy-first tools that help new parents track baby health.

## Preview

Open the bottle feed tracker directly: **https://techwatching.github.io/new-parents-tool/**. The repository's Pages source must be set to **GitHub Actions** for the first deployment.

## Bottle feed tracker

The Vue app in `apps/bottle-feeds` records bottle quantities, dates, optional comments, and baby weights. It provides English and French interfaces, 24-hour summaries, seven-day trends, and a weight-based daily intake estimate.

Records are stored locally in the browser by default. Optional cloud sync is enabled
when you sign in with an email link, allowing records to sync across devices.
Records that have not been synced will be erased if you clear the site's browser data.

The intake estimate uses the indicative Appert rule over 24 hours: `(weight in g ÷ 10) + 200 ml`.
It is very theoretical, for guidance only, and not medical advice.

## Development

Requires Node.js 22.18 or newer and pnpm.

```sh
vp install
vp run --filter bottle-feeds dev
```

From the repository root:

```sh
vp run --recursive lint
vp run --filter bottle-feeds test:unit -- --run
vp run --recursive build
```

## Agent primitives

Agent-facing primitives live in `.github`: always-attached rules in
`.github/instructions` and skills in `.github/skills`. The
`browser-verification` skill requires every browser-observable bug or feature
to be reproduced and verified with `playwright-cli`, with screenshot evidence
published on the pull request or issue.

They are designed with [genesis](https://github.com/danielmeppiel/genesis),
declared in `apm.yml` and installed with [apm](https://github.com/microsoft/apm):

```sh
apm install
```
