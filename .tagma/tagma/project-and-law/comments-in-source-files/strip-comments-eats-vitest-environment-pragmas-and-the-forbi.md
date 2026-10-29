---
id: 01a0cacd-0838-7804-bfc0-2cb8d825c934
title: strip_comments eats // @vitest-environment pragmas and the forbid door drops their restore
ord: 8
tags: ["reflection"]
fields:
  {
    "actual": "`strip_comments` over `apps/tagma/app/src/lib/app` and `apps/tagma/app/src/lib/features/workspace` removed all five `// @vitest-environment jsdom` first-line pragmas; the app suite went from 850/855 to 847/855 with three suites failing `ReferenceError: window is not defined`. Worse, the pragma cannot be restored: five `edit` calls re-adding the exact lines were each answered \"Edit applied successfully. Dropped 1 prose comment line\" — the `writing.comments=forbid` door classifies the tool pragma as prose and strips it on landing, verified by re-reading all five files. Two components disagree about what a pragma is, and their intersection deletes load-bearing lines with no write path to put them back.",
    "command": "strip_comments over two app dirs, then edit to restore the stripped // @vitest-environment jsdom pragmas",
    "expected": "The strip keeps tool-read pragma lines (per its own \"never rewritten\" contract); a pragma re-added by edit lands verbatim"
  }
---
Filed from project `runlith`.

Cost so far: one landing (appgraph zone) blocked mid-unit with 17 stripped files held uncommitted; every remaining app zone carries `.svelte.test.ts` files with the same pragma, so all app strips are paused until a pragma-preserving route exists. Shared/desktop landings already made are safe (suites green post-strip: shared has no pragma-bearing test file stripped, desktop runs under Bun). Workaround needed: either `strip_comments` must keep tool pragmas (its own contract already promises "a pragma a tool reads is never rewritten") or the forbid door must let pragma lines land. The five files: `src/lib/app/graphScope.svelte.test.ts`, `overlays.svelte.test.ts`, `runtime.test.ts`, `src/lib/features/workspace/address.test.ts`, `workspace.svelte.test.ts`.