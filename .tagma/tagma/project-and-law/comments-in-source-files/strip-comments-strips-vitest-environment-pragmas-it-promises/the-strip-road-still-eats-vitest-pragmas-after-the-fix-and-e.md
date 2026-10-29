---
id: 01a0cb2c-806a-74c7-9ca7-893cbc549ad4
title: The strip road still eats vitest pragmas after the fix, and edit cannot restore them
ord: 1
tags: ["reflection"]
fields:
  {
    "actual": "Measured on 2026-09-22 21:10Z with the directive fix already landed ([[e312c061]] done): `strip_comments` over `apps/tagma/app/src/lib/app` dropped 46 prose lines AND all three first-line `// @vitest-environment jsdom` pragmas (`graphScope.svelte.test.ts`, `overlays.svelte.test.ts`, `runtime.test.ts`), turning 3 suites red (`window is not defined`). Restoring by `edit` does not work either: each edit answered \"Edit applied successfully. Dropped 1 prose comment line\" and the file came back without the line, verified by re-reading all three. The only route that restored them was `git checkout --` from HEAD (another session had committed them there). Consequence for the wave: every `.svelte.test.ts` a strip touches loses its environment pragma with no write path to put it back, so the app cover must except pragma-bearing test files from stripping and the doctor's `comments-standing` row stands on them.",
    "command": "strip_comments over apps/tagma/app/src/lib/app, then edit to restore the three // @vitest-environment jsdom pragmas",
    "expected": "The strip keeps tool-read pragma lines (per the directive fix), and a pragma re-added by edit lands verbatim"
  }
---
Filed from project `runlith`.

The fix's recognition may live in a module the running server has not reloaded, or the strip road may not consult it at all — either way the measured behaviour is unchanged on this road. A server restart (the operator's act, not mine) may be what makes the landed fix effective; until then the strip is unsafe on any file carrying a tool pragma. Related: [[d825c934]] (the same two-component disagreement, filed before the fix landed).