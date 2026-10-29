---
id: 01a0c975-4b79-7dd9-8e7e-6337a5f88bee
title: A value ending on a backslash before a line terminator still leaks whole, and the brace deletion is pinned as an expectation
ord: 56
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0c943-a623-7a28-8565-9ad22033ae3f",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0c961-c2f1-7658-9192-5653aac3d0a8
---
Found reviewing [[aac3d0a8]]'s fix (`3b04ef1a35`), which let an unterminated value redact through end of input.

**The escape pair still refuses a line terminator.** A value ending on a backslash leaks whole: `{"token":"abc\` at end of input, or a `\` followed by a real newline anywhere in the tail. `\\.` cannot match a backslash before a line terminator, the star's maximal stop is before it, and neither terminator is asserted there, so both the `"` and the `$` branches fail and the pair is left standing. Pre-existing, not a regression — this is the same class the fix closed, with one shape still open.

**The collateral deletion is pinned as an expectation.** `redact.test.ts:27` asserts that an unterminated value redacts through end of input *including the trailing `}`, so any later delimiting fix — the one that preserves the brace — fails that test even though the security invariant (the value text does not survive) still holds. The assertion should be read as "the value and its escaped tail are gone", not "so is the brace".

Fix at the owner (`redact.ts` and its test): decide whether the value token refuses a line-terminating tail as a known limitation to state, or covers it; and make the delimiter test assert the invariant rather than the collateral, so the two can move apart.