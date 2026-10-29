---
id: 01a12bda-cd95-76e2-8e3a-77f75f772ee6
title: The compaction menu's own-model row is judged by compression spend, not by provider callability
ord: 55
tags: ["task"]
fields:
  {
    "holder": "tagma:01a12bc6-637b-7864-b8b2-4bce8b619076",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a118db-5778-76bc-8936-4437b63f02e2
sources:
  - kind: file
    ref: apps/tagma/server/src/native-harness/compaction/choice.ts
  - kind: file
    ref: apps/tagma/server/src/native-harness/compaction/spend.ts
  - kind: file
    ref: apps/tagma/server/src/native-harness/context/actions.ts
---
The "own model" row of a thread on ACP arrived unspendable with reason `not-callable`: its verdict counted `spendability()`, which asks whether the server itself can call the model over a vendor API, and `claude-code` is declared `auth: 'cli'`. The menu, the "Compact with …" button in the run-end strip and the act in Peek gate on `own.spendable`, so the row was an allowed default and unavailable at once; named explicitly, the same model refused `unknown-summarizer`. With an empty chain or nothing to spend in it, compaction refused `no-summarizer`, and an ACP thread couldn't be compacted at all.

The question was wrong: retelling by its own model runs in the vendor session, our API isn't called and none of our accounts is spent.

Done: `compaction/spend.ts` — one owner of the fact "what pays for this summarizer on this thread": `foldOf` answers `session` for the thread's own model whose transport declares `compaction: 'session'`, else `core`; `summarizerSpend` gives the row verdict, `admitSummarizer` the named admission. The menu (`choice.ts`) and the gate (`context/actions.ts` through the new `CompactionChoices.admit` member) read its answer; core's `ownSummarizer` decides "is it its own model", not a repeat comparison. The menu row carries `folds`, and the own-row detail no longer promises we send the whole history.

On review findings, second commit: every row gets its verdict, `folds` and estimate by the road it would go if named, not by its role in the answer — otherwise a chain member matching the session thread's own model carried `folds: session` with a `not-callable` refusal. A session row carries no core estimate and names no payer: none of our requests, none of our bill. A model the catalog no longer serves is admitted on a session thread with the rung asked for: the vendor session folds it regardless of the catalog, and the old admission refused it `unknown-summarizer` — the same shape as the source bug.

What stays unproved: auto-pick still judged the chain by callability, so a chain of one own cli model ended `no-summarizer` while the menu row was spendable; that's core semantics (`summarizingOf` made the chain member `foreign`), and changing only the server would have kept the core out of API. That remainder closes the task [[053c04be|automatic chain]]. The full `compact_thread` path with an explicitly named own model down to the vendor session is checked by admission only (unit and system test); the retelling itself in the session under the named name is covered by no test.
