---
id: 01a151df-e920-73d7-9b09-09d3053c04be
title: Claude auto-compaction on ACP takes its own model from the summarizer chain, as the menu does
ord: 3
tags: ["task"]
fields:
  {
    "holder": "tagma:01a151fb-a858-74a6-80bc-abc30183c034",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a151df-e920-73d7-9b09-09d091976ebe
sources:
  - kind: file
    ref: apps/tagma/server/src/native-harness/compaction/choice.ts
  - kind: file
    ref: packages/agent/src/thread/compaction/summarizer.ts
---
Claude auto-compaction on ACP takes its own model from the summarizer chain, as the menu does. The `read_compaction_choices` menu judges a Claude thread's own-model line on ACP by the squeeze road (`summarizerSpend`, `native-harness/compaction/spend.ts`): at `compaction: session` it squeezes inside the vendor session, our account unspent, and the line is available. The automatic chain judges the same models by shared `spendability` (`native-harness/compaction/choice.ts:51–63`), which answers `not-callable` to any provider with `auth: 'cli'` (`native-harness/models/spendability.ts:9–23`). The second divergence is in the core: `summarizingOf` makes any chain member `foreign` — a retell through the API (`packages/agent/src/agent/compaction/summarizer.ts:80–91`). A project chain where a Claude Code model stands skips it automatically, and a chain of it alone ends `no-summarizer`, although the menu shows the model available. The remainder is named in the [[5f772ee6]] ending.

To do: the thread's chain is judged by the same owner as the menu (`summarizerSpend` with the thread; `chainAt` without one as now), and a chain member that squeezes inside the vendor session for that thread is resolved by the core as `own`.

Done (b386c49cd73): `summarizerChain` with a thread judges members with `summarizerSpend`; `summarizingOf` receives the session thread's model from `Compactions` and resolves the first member matching it as `own`. On a review find, my own model standing in the chain not first is removed from another run's `not-callable`: the core never calls it, and it cannot be a fallback member. Test in `compactionSummarizer.stest.ts`: the file moved from the integration layer because even before this change it spent 14.9 s CPU at an 8 s budget. Unproven: a full run of my own model in the vendor session by automatic choice (the test checks the choice, not `_tagma/compact` itself); the old e2e of cold compaction in this file once failed on the 10 s `settledThread` timeout with six parallel agents and passed alone.

Proof: an integration test on an `acp` thread with a Claude Code-model chain and one API model: `summarizers` picks the Claude Code model by in-session squeeze, `read_compaction_choices` answers the same choice; a native thread's chain choice unchanged.
