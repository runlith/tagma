---
id: 01a0e2f3-cd94-7d80-9efb-7516c6fde3ee
title: "A cold child-thread compact taken by its own expensive model: send_task with compact named no summarizer, and the leader did not check it beforehand"
ord: 14
tags: ["reflection"]
fields:
  {
    "actual": "Compaction taken by the thread's own model — 'Compacting the context with Opus 5.5 · manual · thread's model · quota Anthropic' — i.e. 569k of cold context re-read by an expensive model on Anthropic quota. The leader did not call read_compaction_choices, though list_agents directly showed cold and 569k to rewrite. The send_task answer named only the compaction's requestId and runId: neither summarizer nor cost.",
    "command": "send_task(to: game-step2-core, compact: { keep }) — list_agents before it showed: claude-opus-5-5 xhigh · context 570k/1M (57%) · cold · 569k to rewrite · expired 341m ago",
    "expected": "A cold 569k thread compacts with a cheap model (e.g. muse-spark-1.3 max): that summarizer has no warm cache to protect, so the thread's expensive model gains nothing. Or the leader sees who will summarize before sending (read_compaction_choices) and chooses: compact with a cheap model or start a fresh agent with a short brief."
  }
---
Two causes. Mine (the leader's): no separate "who will summarize and at what cost" step before compact on a cold thread; I did not turn the `cold · N to rewrite` output into a decision. The tool's: with send_task/compact_agent the summarizer is the operator's choice, not the caller's; for a cold thread the default is `own` (or the operator's rule allowed own), and the door gives no warning that expensive reading of the cold cache by the thread's model is coming. Desired: with `cold` and a large context, send_task/compact_agent answer with the chosen summarizer and the input estimate, and the default policy for a cold thread prefers a cheap model from the chain (with `when-cold`), or the door refuses with an unblock "pick a summarizer / read_compaction_choices". The operator pointed this out after the fact.
