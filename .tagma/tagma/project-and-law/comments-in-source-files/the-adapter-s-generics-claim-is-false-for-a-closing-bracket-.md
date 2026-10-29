---
id: 01a0c993-87c6-7dbf-92b1-7bf871cf26c0
title: The adapter's generics claim is false for a closing bracket, an `if !/unterminated` flips refuse to lexed, and many divisions cost one full scan each
ord: 9
tags: ["task"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: discovered-from
    to: 01a0c88f-e828-7d99-a524-3abab7ecc70b
---
Found reviewing [[b7ecc70b]]'s fix (`64e7b3fdcf`), which taught the TypeScript adapter that a `/` after a postfix non-null assertion is division. The reviewer confirmed the central question — no silent corruption: after an erase the loop restarts the whole scan from index 0 on the masked source with fresh ranges, returns ranges only from a fully clean final pass, offsets are preserved, and js-tokens' comment openers and ends read no lexer state.

Three notes from that review, none blocking, all recorded rather than fixed:

**The child's own claim that generics are covered is false for `>`.** `f<T>! / 2` and `f<T> / 2` still refuse: `>` is not a member of the value-ending class (`typescript.ts:88-89`), while js-tokens puts `/` after `>` in expression position, so the sentence "the other TS-only tokens all end in tokens that already end value position" does not hold for a generic's closing bracket. Pre-existing false negative, not a regression; adding `>` would only buy a wasted pass, since the re-lex still regexes there.

**"Byte-identical verdicts" is false for `if !/unterminated`.** `if` is an IdentifierName outside `EXPRESSION_AFTER`, so the `!` erases, and then `/` after js-tokens' paren-keyword state lexes as division where it previously refused — refuse flips to lexed on a file `tsc` rejects. The same shape for `for`, `while`, `with`.

**The worst case is quadratic.** One `!` per pass is inherent (the loop breaks at the first unclosed token), so a valid file with N `x! / n` divisions costs N+1 full scans. Termination holds — each non-returning pass strictly decreases the `!` count and an erased position becomes a space that can never satisfy the match again — but the cost is O(N) scans over O(file).

Also worth keeping: the risky convergences are untested. The existing assertion over `const pattern = /unterminated` has `=` before the `/` and never reaches an erase decision, so nothing pins that `x = !!/unterminated` or `if (x) !/unterminated` still refuse. And no test feeds a `.js` input, though the adapter claims `.js`, `.mjs` and `.cjs`.