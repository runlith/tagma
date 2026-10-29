---
id: 01a0d4db-9d5e-79cd-95d5-c098982f1bca
title: The import-direction inspection reads git trees, takes every convention as a parameter, and shares one floor law with `package-boundary`
ord: 1
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/measure/measure.worker.ts
---
The first builtin inspection, `direction`, applies a floor table to the relative imports of the files it selects, read from git trees rather than from a disk. Its implementation is shared with `package-boundary`. Every convention it applies is a parameter, so the engine carries no project's opinion.

## Where the code goes

The placement follows [[ae56a980]].

**`@runlith/code-facts`** (new kit, `packages/code-facts`) takes over the import reading from `package-boundary/src/imports.ts`, and adds:
- `parseImports(text, reads, path)`;
- `resolveRelative(specifier, from, tree)`: resolves against a tree's listing, trying the candidates `resolveLocal` tries today, in the same order;
- the tree port;
- `floorCrossings(edges, floors, siblings)`: answers every import edge that crosses a floor table as `{ from, to, file, line, specifier }`, relative to the table's base, before any debt.

`floorCrossings` is a query over import facts, with no rule, debt or product in it. That is why it lives in the kit: a kit in `packages/` never imports a package of Tagma's tree.

**`@tagma/inspection`** (new package, `apps/tagma/inspection`) holds the `direction` builtin — its parameters, fingerprint, `unjudged` and the words of its refusal — and the judgement.

**`package-boundary`** reads imports through `code-facts`. Its `floorViolations` becomes `floorCrossings` followed by its own debt filter, so it is one implementation, until its direction driver dies with [[15d47c9d]] and the migration of the other packages. `readPackageBoundary` keeps its report. Its tests and every package's `boundary.test.ts` stay green unchanged.

## The builtin

`@tagma/inspection`'s vocabulary door declares the builtin: id `direction`, reach `local`, fingerprint unit "directory crossing", and this parameter schema, with every field required. The server's `protocol/` reads that door.

- `base`: the directory the floor entries are relative to.
- `floors`: string lists, bottom floor first.
- `siblings`: `cross` or `allow`. Says whether an import between two entries of one floor is a crossing. Today's law is `cross` ([[f52e4a92]]).
- `reads`: `from`, `runtime` or `every`. Which import spellings count. Today's law is `every` ([[3f69f7f8]]).
- `files`: `{ extensions, exclude }`. Which files are read. `exclude` takes path patterns; runlith excludes its test and bench names.

A changed file outside `files` is neither read nor failed. So a landing that touches a `.json` file or a `Dockerfile` under the base is judged on its other files.

Resolution covers relative specifiers within the TypeScript family only. Package specifiers, `paths` from tsconfig and a package's `imports` field are not resolved. A relative specifier that resolves to no path of the tree is not judged, and is named in the verdict's `unjudged`, never skipped silently. `read_inspections` states this limitation beside the schema.

A violation carries the fingerprint `"<from entry> -> <to entry>"`. Its line and specifier are what the refusal prints. The refusal's `unblock` words come from the builtin, not from the gate: move the import onto a floor below, or through a door that stands below. Another import along a crossing already in debt is not new ([[c4a60ae4]]).

## Workers

The inspection runs in the enforcement workers ([[be584b76]] §13). Each worker is its own closure entry, and neither has an inline fallback, so TypeScript never loads on the server's event loop.

A worker receives:
- the selected files' texts, at the built tree and at the base;
- both trees' listings under `base`;
- the parameters.

It answers the crossings of each side.

## Acceptance

- With `files` excluding tests and `siblings: cross, reads: every`, `floorCrossings` over runlith's server at HEAD answers exactly the four debt pairs of today's table. Including tests, it answers the test-born pairs both reviews measured.
- For every non-test source of `apps/tagma/server/src` at a commit, crossings computed from the git tree equal crossings computed by `readPackageBoundary` from a clean checkout of that commit. The comparison is of crossings, not of resolutions, so a case-insensitive disk does not matter.
- `bun --cwd packages/package-boundary test` and every package's `boundary.test.ts` pass unchanged.
- No non-test server file imports `typescript`, `@runlith/code-facts` or `@tagma/inspection`'s implementation door as a value outside the worker entries. A claim over the worker entries says so at close.
- `code-facts` and `@tagma/inspection` each carry a `boundary.test.ts`, until their direction moves into rules. `@tagma/inspection`'s vocabulary door is walked as browser-safe.

## Spec-list questions

This decision answers:
- 1: the builtin, the shared functions;
- 4: the target model;
- 5: the owners;
- 7: acceptance;
- 10: its contract — the new package exports are additive, and `readPackageBoundary` keeps its signature;
- 14: its bounds — only selected files, memoised by blob id.

The rest are answered in [[be584b76]].
