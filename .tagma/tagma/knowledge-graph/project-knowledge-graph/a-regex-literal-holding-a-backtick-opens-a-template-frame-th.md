---
id: 01a0de3d-3979-793b-9f9a-b9d73c34eb84
title: A regex literal holding a backtick opens a template frame the bracket scanner never closes
ord: 135
tags: ["task"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: discovered-from
    to: 01a0de28-cd31-7139-ab26-9cde9ff38dcd
sources:
  - kind: symbol
    ref: apps/tagma/server/src/graph/sources/readers/regions.ts
    symbol: bracketDelta
  - kind: symbol
    ref: apps/tagma/server/src/graph/sources/readers/regions.ts
    symbol: topDeclarations
---
`bracketDelta` does not know a regex literal from division, so a backtick inside one pushes a template frame that no later backtick pops. `regions.ts` does it to itself: `const FENCE = /^(`{3,}|~{3,})/;` at line 80 leaves the frame open, and from there every line of the file is scanned as template text — the running depth reaches −2 by the end, and the quote, comment and bracket rules are off for the whole tail.

Measured with a copy of `bracketDelta` carrying one `ScanState` down the file: the depth first goes negative at line 225 and never recovers. The frame does close later — a backtick inside a quoted string pops it, another opens it again — but by then a hundred lines of brackets have been swallowed as template text, and nothing puts the count back.

Two readers pay for it. `topDeclarations` mistakes nested bindings for top-level declarations: it answers `to` at `apps/tagma/server/src/files/TreeScan.ts:20` and `table` at `packages/markdown/src/render.test.ts:8`, both locals inside function bodies, and misses the real top-level `function table` at line 16. `construct` starts a fresh state at each site, so it is wrong only inside a region that contains such a line. `constructRegion` avoids the scanner entirely and ranks by indentation ([[f4f87e38]]).

Done when a backtick inside a regex literal leaves the scanner's frames alone, with a test over a file that carries one, and `topDeclarations` answers only genuine top-level declarations for the two files named above — or, if the fix cannot be had without a lexer, when that is stated where the scanner is read and [[1b865c6c]] decides what becomes of `topDeclarations`.