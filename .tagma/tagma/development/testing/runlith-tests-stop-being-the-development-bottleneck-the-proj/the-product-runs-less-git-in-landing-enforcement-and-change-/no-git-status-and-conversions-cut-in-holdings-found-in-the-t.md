---
id: 01a17b1f-6c3b-71f8-95db-e890f58e536f
title: No git status and conversions cut in Holdings found in the tried variants
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a17b18-d115-7fc7-b10a-e03cd400dc55",
    "status": "closed"
  }
edges:
  - kind: discovered-from
    to: 01a17ad9-53ab-70cb-9a5f-ee5de872922e
---
A producer cut of git status and conversions (`check-attr` + `config --get core.autocrlf`) in the Holdings judgement, continuing [[e872922e]] after the first `2336030628` cut.

## Measurement (B3 on the post-`2336030628` code, three files: submitEqualLines, remeasure, threadAuthorship)

102 `Holdings.judge` batches: 43 — status + check-attr + config, 42 — status only, 15 — the same plus a cat-file session birth (rev-parse + cat-file), 2 — with check-ignore. Status 102 processes / 655 ms CPU, check-attr 60 / 305 ms, config 60 / 271 ms. Inside one batch conversions read once and pass into prepareAt, `wholeOf`, and blobContents. Other conversions reads stand under other holdings: `prepared.build` (8), `Retirer.history` → `introduced` (17), `headBlob` authorship reads (11).

## Why the tried variants gave no cut

- Stock git cannot do check-attr + config in one process: `check-attr` never prints config, and `ls-files --eol` shows `attr/` before `core.autocrlf` applies, without filter, ident, or working-tree-encoding.
- A trace2 `def_param` (`trace2.configParams=core.autocrlf` on the check-attr process) yields the value in the same process. But it reads through early config, which is not the same as `git config --get` (e.g. for `includeIf "onbranch:"`). The answer would also have to be parsed out of the stderr trace stream, where git writes errors too. Behavior would shift, so rejected.
- A live `check-attr --stdin` session reads index, `info/attributes`, and `core.attributesFile` once. `.gitattributes` of catalogs left on the stack between paths never reread. Fresh inputs are not proven, so rejected.
- Reading config only after check-attr, and only for paths where attributes never settle the answer, changes nothing in worlds without `.gitattributes`. But latency grows: two processes run back to back instead of in parallel. The gain exists only in repos with explicit `text`. No measurable use.
- Carrying the answer across judgement, build, and retirement batches is forbidden by freshness ([[09fbaa34]]). Status-only batches are answers to requests that must read after the request ([[42e8ab57]]).

## A candidate outside this scope

The product runs `git` by name (`packages/git/src/Git.ts`). On macOS without Homebrew that is the `/usr/bin/git` trampoline, costing 22.5 ms CPU against 10 ms for the real binary ([[5294065f]]). testbed bypasses the trampoline for tests only, so the test count never shows that gain.
