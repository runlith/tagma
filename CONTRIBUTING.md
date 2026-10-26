# Contributing

Issues and pull requests are welcome. For a change larger than a fix, open an issue first and say what you want to change and why, so the design can be agreed before the code.

## Setup

Follow [Run from source](README.md#run-from-source) up to `bun install`. Rust is needed for the execution host and the file watcher (`packages/execution-host`, `packages/watch`); integration tests boot the execution host, built by `bun run --cwd packages/execution-host build:native`.

## Before a pull request

- `bun run tagma:typecheck` passes. Types are checked only through this command (or a package's `bun run typecheck`), never by calling `tsc` directly.
- The tests of every package you touched pass: `bun run test` and `bun run test:integration` in that package. CI runs the whole suite on macOS for every pull request.
- A `*.test.ts` file touches no process, database, socket or disk; a test that needs one is an `*.itest.ts`. Test the public contract of the code you change, with the fewest cases that prove it; a fixed bug gets a test that fails before the fix.
- Formatting is `oxfmt` with the repository's `.oxfmtrc.json`.
- `bun.lock` is written only by `bun install`.
- Commit messages are in English: a short subject saying what the change does.

## Code

The repository's own law — module boundaries, Effect style, failure handling, UI tokens and the rest — is declared in `tagma.config.ts` and the checks under `checks/`. The skills under `.agents/skills` describe how the code is written: read `effect4` before touching Effect code, `frontend` and `tagma-design` before the app, `tests` before tests.
