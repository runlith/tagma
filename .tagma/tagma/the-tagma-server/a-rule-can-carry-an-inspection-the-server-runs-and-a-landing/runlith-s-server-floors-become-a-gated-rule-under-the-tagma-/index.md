---
id: 01a0d4db-9d8b-7af7-9481-2eb115d47c9d
title: runlith's server floors become a gated rule under the Tagma server, with only `install/`'s crossings as owned debt, and `boundary.direction.ts` dies
ord: 4
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/boundary.direction.ts
  - kind: file
    ref: apps/tagma/server/src/boundary.test.ts
---
runlith's own server floors move from `apps/tagma/server/src/boundary.direction.ts` into a `#rule` under [[05042d40]], enforced at gate at landing with the builtin `direction`. The file dies, and the server's `boundary.test.ts` stops measuring direction.

## Before enforcing

At HEAD 6821abb7eb the table has exactly four crossings: `terminals/ → api/`, `terminals/ → http/` and `terminals/ → socket/`, all from `terminals/pageWorld.ts`, plus `harness/ → terminals/`. Three moves clear them:

1. **Move `terminals/pageWorld.ts` and `terminals/pageWorldServer.ts` into `socket/`.** It stands above `http/` and `api/`, and `pageWorld.ts` reads `socket/live.js`, so no crossing remains. `http/` would leave `http/ → socket/`.
   - The two server integration suites, the script, and the three app suites that spawn `pageWorldServer.ts` by a path string move with it: `apps/tagma/app/src/lib/features/terminals/{input,pane,stream}Composition.test.ts`. No typecheck sees those three.
2. **Put `terminals/` on a floor of its own directly below `harness/`.** `harness/ → terminals/` then runs downward. No shipped file of `terminals/` imports `harness/`; the sixteen test files that do are outside `files`.
3. **Place the new `enforcement/`** on the floor of `ai/`, `artifacts/`, `mcp/` and `skill/`, below `terminals/`. [[50467aad]] reaches the command road through a port that `terminals/` fills, never by importing it.

## `install/`

`install/` stands on no floor ([[92a549da]]). Measured with `readPackageBoundary` at 0564b36681, on a floor between `terminals/` and `harness/` it keeps three crossings: `install/ → cli/` ×7, `install/ → http/` ×2 and `workspaces/ → install/` ×1. The same measurement shows that `terminals/` below `harness/` leaves only `pageWorld.ts`'s three pairs, which move 1 clears. `install/`'s files belong on two floors:
- the closure and the machine world, low;
- build, try and beside, beside `cli/`.

This slice places `install/` between `terminals/` and `harness/` and records its three crossings as debt. Every entry is owned by one task, filed under [[c0f69bd1]] before the enforcement: split `install/` along what reads it, and remove the entries.

## Enforcing

A `#rule` under [[05042d40]] states the norm: a directory of the server imports only from floors below its own, and never from a sibling entry of its floor. It is enforced with one `enforce_rule` at gate at landing:

```
{ builtin: 'direction', params: {
    base: 'apps/tagma/server/src',
    floors: <today's table with the three moves and install/>,
    siblings: 'cross', reads: 'every',
    files: { extensions: ['.ts', '.tsx', '.svelte'], exclude: ['**/*.test.*', '**/*.itest.*', '**/*.stest.*', '**/*.spec.*', '**/*.bench.*'] } } }
```

The owners map names the `install/` task for each of its entries.

In the same change:
- `boundary.direction.ts` is deleted;
- `boundary.test.ts` passes `readPackageBoundary` no `direction`, and loses its direction assertion.

The law is never measured in two places.

## Docs

- [[1023b406]] is rewritten over the rule: floors rank the server, and their debt is named with its owner. Its present body is false on two counts: it says the edges run "both ways", and it says siblings are unmeasured.
- [[8779de7a]] keeps its subject — the graph's six directories share one entry — sourced on the rule node.
- [[92a549da]] is superseded by a claim that `install/` stands on a floor, with its crossings in debt under the split task. Its list of readers is corrected to what HEAD holds: `cli/`, `http/`, `http/main.ts`, `harness/`, `workspaces/`.

## Acceptance

- The rule stands under [[05042d40]], at gate at landing. Its debt holds exactly `install/ → cli/`, `install/ → http/` and `workspaces/ → install/`, each owned by the split task.
- `apps/tagma/server/src/boundary.direction.ts` does not exist; `git grep boundaryDirection apps/tagma/server` finds nothing.
- `bun --cwd apps/tagma/server test src/boundary.test.ts` passes.
- The three app suites and the two server suites that stand up the page world pass from its new place.

## Spec-list questions

This decision answers:
- 1: the rule and its first debt;
- 7: acceptance;
- 8: the three docs.

Rollback is `enforce_rule` at `off`, with the file restored from history; the rest are answered in [[be584b76]].
