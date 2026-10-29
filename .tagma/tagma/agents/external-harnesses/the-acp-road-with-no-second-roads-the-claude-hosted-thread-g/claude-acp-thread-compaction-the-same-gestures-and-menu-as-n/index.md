---
id: 01a118db-5778-76bc-8936-44358cbd05a4
title: "Claude ACP thread compaction — the same gestures and menu as native: Enter compacts on a step inside the turn, Tab after the turn, the same chain picks the summarizer"
ord: 6
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: relates
    to: 01a118cf-b972-77e1-a649-dbd8332f3ece
sources:
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/protocol/prompts.ts
---
## Why

Compaction on a Claude `acp` thread is now poorer than native:

- `/compact` with Enter mid-turn runs after the turn: `ProtocolCompactions` records every request with `at: 'end'`;
- no summarizer choice: `read_compaction_choices` refuses with `harness-contract`, and the app places `/compact` with no menu (`View.svelte.ts`, `watchChoices`);
- mid-turn Claude Code itself compacts at its own threshold (167000 at a 200000 window), while the Tagma threshold fires only between turns.

That is a decision written in [[92391518|the ACP compaction note]], not a vendor limit. Probes [[332f3ece]] showed step compaction assembles from Claude Code and SDK public means, and the runner can already assemble a Claude Code session from the Tagma journal.

## Goal

Every compaction gesture gives an `acp` thread the same as a native one:

| Gesture | Native thread | Claude on ACP |
| --- | --- | --- |
| `/compact` + Enter mid-turn | at the nearest step boundary, the turn resumes | same, with the thread's own model ([[a9943509]]); a foreign model — after the turn ([[2dfc8bb6]]) |
| `/compact` + Tab mid-turn | after the turn | same |
| `/compact` idle | at once | same |
| model menu and default choice | own model, chain and project rule | same menu and rule ([[b63f02e2]]) |
| threshold | Tagma; mid-turn — on a step | Tagma; mid-turn — on a step, Claude Code itself never compacts ([[a9943509]]) |

One difference remains: a foreign model picked mid-turn compacts after the turn. A Claude Code session can only be replaced between its turns, and cutting a turn for it is unproven ([[2dfc8bb6]]).

## Coverage

- compaction moment, on-step gesture and automatic threshold — [[a9943509]];
- summarizer choice, app menu, Tagma recap by a foreign model and the new session from the folded journal — [[b63f02e2]];
- foreign model on a step — [[2dfc8bb6]].

out:
- Devin on ACP declares no compaction and keeps the `harness-contract` refusal, terminal threads — `external-context`: they have neither a session Tagma could assemble from the journal nor step compaction.
- No new UI: the menu, Enter and Tab gestures and the standing-request display are native.
- No new stored data: the compaction request in the inbox already carries `at` and `summarizer`.

## Order

[[a9943509]] → [[b63f02e2]]: both change `ProtocolCompactions.queued` and `ProtocolPrompts.compact`, the second builds on the first.
