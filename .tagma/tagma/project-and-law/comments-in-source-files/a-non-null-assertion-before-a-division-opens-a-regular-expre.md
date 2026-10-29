---
id: 01a0c88f-e828-7d99-a524-3abab7ecc70b
title: A non-null assertion before a division opens a regular expression in the JavaScript tokenizer, so the comment reader refuses the whole file
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0c943-a623-7a28-8565-9ad22033ae3f",
    "status": "done"
  }
sources:
  - kind: file
    ref: packages/performance/src/CpuProfile.ts
  - kind: file
    ref: packages/source-comments/src/languages/typescript.ts
---
`strip_comments` over `packages/performance` on 2026-09-22 read 42 files and dropped 1,779 prose lines, and named exactly one it could not lex:

```
"unlexable": [{ "path": "packages/performance/src/CpuProfile.ts", "reason": "unterminated regular expression" }]
```

The file is valid TypeScript — `packages/performance` typechecks clean with it in the build — so this is the reader refusing a file the compiler accepts. The reason string is the TypeScript adapter's own (`languages/typescript.ts:45`, `RegularExpressionLiteral`), so the tokenizer entered a regular-expression state on a `/` that is division. The file divides three times, each after a subscript or a non-null assertion: `profile.timeDeltas[index]! / 1_000` twice and `(sampleTime - profile.startTime) / span` once.

The trigger is isolated: running js-tokens over the file by hand answers `RegularExpressionLiteral` with value `"/ 1_000);"` opening at line 84 — `self.set(id, (self.get(id) ?? 0) + profile.timeDeltas[index]! / 1_000);`. The lexer decides `/` by what precedes it, and it does not know TypeScript's non-null assertion: after `]!` it is still in a position where a regular expression may open, so the division opens one that never closes. The other two divisions in the file are past that point and never reached. Line 169's `) / span` is preceded by `)` and would lex as division.

So the defect is the TypeScript adapter reading a TypeScript-only construct through a JavaScript tokenizer. Measured across every `.ts` file of `packages` and `apps` on 2026-09-22, this file is the only one carrying the shape — so the blast radius today is one file, and the reason to fix it is that nothing warns the next author who writes `x! / n`.

The cost is the one the strip exists to prevent: nine prose lines stand in that file with nothing to replace them, and the zone's `comments-standing` finding cannot clear while any file refuses to lex. A reader who trusts the sweep would believe the file was swept.

Done when `strip_comments` over `packages/performance/src/CpuProfile.ts` reads it, with a case over whatever construct was refusing.
