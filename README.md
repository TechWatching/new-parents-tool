# New Parents Tool

A pnpm monorepo for simple, privacy-first tools that help new parents track baby health.

## Bottle feed tracker

The Vue app in `apps/bottle-feeds` records bottle quantities, dates, optional comments, and baby weights. It provides English and French interfaces, 24-hour summaries, seven-day trends, and a weight-based daily intake estimate.

All records are stored in the browser's local storage. No data is sent to a server. Clearing browser data also clears the records.

The intake estimate uses 150 ml per kilogram over 24 hours as general guidance. It is not medical advice.

## Development

Requires Node.js 22.18 or newer and pnpm.

```sh
pnpm install
pnpm dev --filter bottle-feeds
```

From the repository root:

```sh
pnpm lint
pnpm test
pnpm build
```
