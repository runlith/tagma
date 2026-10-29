---
id: 01a12f52-1aee-7dbc-b423-fc6869953bae
title: "Registry: a failed adapter does not remove models, the run holds its version through compaction, a removed provider yields provider-not-installed, defaults with no vendor in the core"
ord: 11
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a12c24-69a2-7f74-a6cf-a29052b10a62
---
Gaps from spec-audit №7, №8, №9, №17, №18.
- №8: an adapter that failed on update drops out of the catalog (`adapters/judge.ts` yields `providers: []`, `registry.ts` builds the catalog from it) — models disappear from the menu.
- №9: compaction (`SummarizerRouter.ts`, `summaryStrategy.ts`) loses `runId`, and the run takes the new version after an adapter update; the pin is set lazily instead of at run start.
- №17: `native-harness/models/preference.ts` silently substitutes a fallback for a stored default on a removed provider instead of `provider-not-installed`.
- №18: vendor ids in the core: `packages/llm/src/llm/protocols/*`, `devin.ts`, `native-harness/store/preferences.ts`, `threads/store/kernel.ts`, `threads/store/directory.ts`, `HarnessMark.svelte`, test defaults `InMemoryAggregateStorage`, `ThreadRows`, `agentRoster`.

Done when each item is closed at its owner and proven by a contract test or grep (№18).
