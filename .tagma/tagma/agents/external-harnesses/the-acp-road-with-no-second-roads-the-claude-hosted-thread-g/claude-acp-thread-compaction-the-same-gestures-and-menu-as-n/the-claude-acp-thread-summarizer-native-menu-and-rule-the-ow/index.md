---
id: 01a118db-5778-76bc-8936-4437b63f02e2
title: "The Claude ACP thread summarizer — native menu and rule: the own model compacts in the vendor session, a foreign one retells the Tagma journal via ThreadCompaction, and the next turn opens a new session from the folded journal"
ord: 2
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/View.svelte.ts
  - kind: file
    ref: apps/tagma/server/src/native-harness/compaction/choice.ts
  - kind: file
    ref: apps/tagma/server/src/threads/contract/service/compaction.ts
---
## What the operator gets

`/compact` on a Claude `acp` thread opens the same menu as on a native thread. The first row is the thread's own model with cache warmth, then models the server calls, with cost and pass-count estimates. The same rule and the same project summarizer chain give the default choice. The Tagma threshold between turns picks the summarizer by the same rule.

## Why

Retelling with the own model in the vendor session is cheaper because it reads a warm cache. But that argues for one menu row, not for no menu: the native menu shows warmth and leaves the choice to the operator. Claude Code never lets a foreign model into its compaction. But the Tagma journal holds the thread model's full history — messages, hosted-tool calls and their results — and the runner can already open a Claude Code session from the journal (`read_hosted_history`, [[d0810682|runner note]]). Fork of the “last N turns”, turn deletion and restore travel the same road ([[e47bd3fc|driver step write]]).

## How

- **Menu.** `read_compaction_choices` answers an `acp` thread if its harness compacts (`HarnessRegistry`, `harness.compaction`). The own row is the thread's model (`asked` in the facet, [[076a4c60]]) in the vendor session, its warmth — from reading the thread context ([[c7d3d8a2]]). The remaining rows and estimates are native, computed over the thread's model history (`ThreadCompaction.estimate`). The `harness-contract` refusal stays with harnesses that never compact. The app reads the menu for an `acp` thread too: `watchChoices` in `View.svelte.ts` currently skips it on `harnessRow`.
- **Road.** The kernel decides (`Compactions` in `packages/agent`) with the same `ThreadCompactor.summarizing` as a native thread: a named model via `namedSummarizing`, otherwise via `ThreadSummarizerPort`. On a thread with `compaction: session`, `own` opens a run the transport executes (`_tagma/compact` in the vendor session, [[a9943509]]), `foreign` — a native kernel run.
- **The Tagma recap** is a native kernel compaction run (`ThreadCompactionRuns.work`): the same `ThreadCompaction.compact`, the same skips, spend and cost. Nothing is sent to the driver. Before the fold write, the finished recap drops the vendor session via `TransportHistory.restore` — the row loses `sessionKey`, `protocol_turn` is wiped, the process stops — and the next turn opens a new session, which the runner assembles from the folded journal. The cut goes before the fold, as in a restore rewind, so a failure between them costs only cache.
- **Where the recap lives.** No port needed: the compaction run and its summarizer already belong to the kernel, and the transport is needed only for the session cut, which `TransportHistory` already declares.
- **Outside the link lock.** The recap is a long model call. Esc interrupts it: the run ends `aborted`, the inbox barrier lifts, the vendor session stays as it was. A server restart mid-recap ends the run with failure and lifts the barrier; the session is untouched, no repeat model call.
- **When.** The Tagma recap runs between turns: idle — at once, otherwise after the turn. A `step` request with a foreign model answers `requested` with `at: end` ([[2dfc8bb6]]). Automatic mid-turn compaction runs with the own model ([[a9943509]]): window overflow never waits for the turn to end. Between turns automatic compaction picks the summarizer by the project rule.
- **Key.** A repeated `compact_thread` with the same key returns the same request, as now; the key and digest account for `summarizer`.

The same change rewrites [[92391518|the ACP compaction note]] and the `compact_thread` operation `grammar`.

## What proves it

The performer:

- a `read_compaction_choices` integration test on an `acp` thread next to `compactionSummarizer.itest.ts`: the own row, the remaining rows and the project-rule default choice.
- a driver system test on the scripted agent with a test model client: `compact_thread` with a foreign model idle writes a boundary with the Tagma recap and drops `sessionKey`; the next prompt opens `session/new`, and `read_hosted_history` serves the folded history; `_tagma/compact` never left for the agent; Esc mid-recap yields `aborted`, and the session stays as it was.
- live smoke: a Claude thread after foreign-model compaction answers from the recap — naming a fact from the conversation's start.

Operator: `/compact` on a Claude ACP thread shows the model menu; picking another model compacts after the turn, and the next turn runs.
