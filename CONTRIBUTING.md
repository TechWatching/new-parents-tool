# Contributing to New Parents Tool

Thank you for your interest in contributing.

## Getting started

1. Fork and clone the repository.
2. Create a branch using the `feat/`, `fix/`, or `docs/` prefix.
3. Install Node.js 22.18 or newer and pnpm.
4. Install dependencies:

   ```sh
   vp install
   ```

5. Start the bottle feed tracker:

   ```sh
   vp run --filter bottle-feeds dev
   ```

## Before submitting a pull request

Run the same checks used by CI:

```sh
vp run --recursive lint
vp run --filter bottle-feeds test:unit -- --run
vp run --filter bottle-feeds type-check
vp run --recursive build
```

Add or update tests and documentation when relevant. Reference the related
issue in the pull request description, for example `Closes #123`.

## Commit convention

Use [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` new feature
- `fix:` bug fix
- `docs:` documentation only
- `chore:` maintenance or dependencies
- `test:` adding or updating tests
- `refactor:` restructuring without a behavior change

## Reporting bugs and requesting features

Use the appropriate GitHub issue form and provide enough detail for someone
else to reproduce the problem or understand the proposed outcome.
