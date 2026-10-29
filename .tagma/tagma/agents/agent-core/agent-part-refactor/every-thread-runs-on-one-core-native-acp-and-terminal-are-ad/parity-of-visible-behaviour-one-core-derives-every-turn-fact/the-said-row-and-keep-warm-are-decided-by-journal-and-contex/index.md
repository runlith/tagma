---
id: 01a14cba-e095-7bcb-bb6f-60847ecd38ad
title: The said row and keep-warm are decided by journal and context-reading facts, with no harness branch
ord: 4
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: relates
    to: 01a12750-bbcf-74d4-8c6c-92ffdea260f6
  - kind: relates
    to: 01a14bae-6720-7d62-897a-92913ae88b52
sources:
  - kind: file
    ref: apps/tagma/server/src/native-harness/keepWarm/driver.ts
  - kind: file
    ref: apps/tagma/server/src/native-harness/models/spendability.ts
  - kind: file
    ref: apps/tagma/server/src/threads/list/select.ts
  - kind: file
    ref: apps/tagma/server/src/threads/list/summary.ts
  - kind: file
    ref: packages/agent/src/thread/cache/ThreadCacheWarmth.ts
  - kind: file
    ref: packages/agent/src/thread/run/lifecycle/closing.ts
  - kind: file
    ref: packages/agent/src/thread/run/scheduler/inputs.ts
---
Goal: the said row and keep-warm are decided by journal and context-reading facts, not by whether the thread is external.

## Now

- **Said row.** `threads/list/select.ts#summariesOf` answers `null` for any record with a `harness` (`when harness is not null then null`), and `summary.ts#summaryOf` sets `saidLine: harness === null ? … : null`. Yet the Claude journal on `acp` carries native assistant records, and the same fold counts `said_live` and `said_final` for it ([[dea260f6]]). The value exists; the list blanks it. Left with no row:
  - the list row (`rowReading.svelte.ts`);
  - Peek;
  - the "finished" event body in "Attention" (`list/attention.ts`);
  - the speech follower;
  - the plugin view.
- **Keep-warm.** `native-harness/keepWarm/driver.ts`: `external = summary.harness !== null`, and `keepWarmPlan` answers `rest('external')`. A parent on `acp` waiting for children gets no pings, although Claude Code on a subscription holds the cache for an hour and that time is measured in context reading ([[f3949b43]]).

## Solution

**Said row.**
- `said` in `summariesOf` picks the column by the run state on every thread, and `summaryOf` takes `saidLineOf(row.said)` with no condition.
- A terminal thread gets the row once it has a journal ([[a621fbb3]], [[f822dd50]]). Before cut 3 it has no run records, and the row is empty by fact.

**Keep-warm.**
- `KeepWarmSubject.external` and the `external` reason are removed.
- Pinging is allowed when the context reading carries a promised cache lifetime (`cache.ttlSeconds` in the context reading), the shared `threadCacheWarmth` counts warmth from it, the thread-choice `turnSpendability` lets the turn spend, and the thread waits. A catalog promise never substitutes a missing or explicitly unknown reading lifetime: an old native reading without that field gets `unknown` until a new measurement, or a curve estimate instead of a promise. Native records the catalog promise in the request measurement via `ThreadContextAnchor`, ACP the vendor-recorded lifetime via `Meter`. No transport gates needed:
  - on Claude on `acp` the reading carries the lifetime Claude Code recorded ([[c7d3d8a2]]);
  - on the terminal there is no reading with a lifetime ([[f822dd50]]), so no ping;
  - on Devin there is no reading.
- A ping is a core run of kind `keep-warm`. The scheduler passes its signal into the launch seed; a transport with a receipt holds the signal delivered until confirmed. Closing the run drops the signal even when the launch refuses: returning unread words never turns a refresh into a regular turn. On `acp` `launch` runs it with the `KEEP_WARM_TEXT` prompt. The hosted-agent prompt is native ([[8e0f35a1]]), so a one-word answer lands in the same doctrine section. `ThreadHosting` closes Tagma tool calls in such a run with `KEEP_WARM_REFUSAL`, as native closes them in one step. Tagma cannot close vendor web tools: an "ok" answer with no tools is model behaviour, not a guarantee.
- **Spend verdict.** `keepWarmSpending` today calls `spendability`, and it refuses any provider with `auth: cli` (`callable` → `not-callable`): Tagma cannot call such a provider's model itself. For those who call the model themselves — the compaction summarizer choice (`compaction/choice.ts`, `spend.ts`) — that verdict stands and does not change. Keep-warm asks a different question: can this thread's turn spend its own row. So `models/spendability.ts` gains `turnSpendability`:
  - for a `cli`-auth provider it judges only its own row's quota in `AccountQuota` — the windows `_tagma/quota` reports; an exhausted window answers with its `resetsAt`;
  - with no quota observation the turn is allowed: the CLI itself holds the input, and a failed ping ends as an ordinary launch refusal ([[2121a95f]]);
  - for other providers — `spendability`.
- The [[3ae88b52]] feature description is rewritten by the same change: promised cache lifetimes set the limits, not the provider.

## What is removed

- `when harness is not null then null` in `list/select.ts` and the `harness === null` condition in `list/summary.ts`;
- `external` in `KeepWarmSubject` and `keepWarmPlan`.

## Acceptance criteria

The implementer proves:
- by an integration list test (`listStore.itest.ts`): a thread on `acp` after a turn shows `saidLine` as the first line of the last answer, exactly as on native;
- by a `keepWarmPlan` test (unit): a subscriber with a warm reading and a cache lifetime is pinged regardless of transport, and a reading with no lifetime is refused on warmth;
- by a `turnSpendability` unit test: `claude-code` with an exhausted window answers with its reset, with no quota observation it is allowed, and a summarizer choice still refuses `claude-code`;
- by the parity suite: a parent on scripted `acp` waiting for a child, with a reading carrying a cache lifetime, gets a ping before expiry, as on native.
