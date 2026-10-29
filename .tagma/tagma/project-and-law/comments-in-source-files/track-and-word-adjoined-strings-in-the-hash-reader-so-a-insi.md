---
id: 01a0c713-cda8-7d7f-b56b-6138322f0f61
title: Track `$'…'` and word-adjoined strings in the hash reader so a `#` inside them never opens a comment
ord: 4
tags: ["task"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: packages/source-comments/src/languages/hash.ts
---
`hashComments` in `packages/source-comments/src/languages/hash.ts` opens a string only when the quote follows a character in `BEFORE_QUOTE` or a Python prefix. `stripProse('a.sh', "echo $'a # b'\n")` answers `echo $'a\n` and `echo x"a # b"` answers `echo x"a\n`: the strip cuts a valid string and the script no longer parses.

Fix at the owner: admit `$` before a quote and a quote joined to a word (shell concatenation) as string openers, or refuse the file when a quote stands where the reader cannot classify it. Done when both reproductions answer the text whole with no drop, the package tests cover them, and the limitation claim under this area is retired.