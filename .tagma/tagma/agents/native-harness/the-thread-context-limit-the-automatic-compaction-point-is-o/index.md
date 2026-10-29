---
id: 01a14102-d13a-7421-b8b7-dd74132e596c
title: The thread context limit — the automatic compaction point — is one figure everywhere context fullness is shown
ord: 12
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/native-harness/compaction/policy.ts
  - kind: file
    ref: apps/tagma/server/src/threads/list/wire.ts
  - kind: file
    ref: packages/agent/src/collaboration/agentRoster.ts
  - kind: file
    ref: packages/agent/src/thread/compaction/policy.ts
  - kind: file
    ref: packages/chat-ui/src/contextUsage.ts
---
## What the user gets

Every context-fullness figure — in the composer, the list row, Peek, on the phone, the context panel, `list_agents`, and `read_thread` — is computed from the **thread context limit**: the point where Tagma compacts it automatically, and where there is no automatic compaction, from the model window. 100% means "the next request compacts the context", the red ring (80%) means "compaction is near". The window stays the second figure.

- **Composer hint:** the title "Until compaction" instead of "Context window", "45% used (55% left)", "248.5K of 550K", the line "compacts at 55% of the 1M window".
- **Context panel:** part shares are computed from the limit; the "Compaction" card next to "Tool output share": "compacts at 550K · 55% of 1M", the threshold's origin ("your override for Opus 5.5" / "this model's default" / "your setting"), and a link to the setting.
- **Agents:** `list_agents` writes `context 248k of 550k before compaction (45%) · window 1M`; with no compaction — `context 248k/1M (25%)`. The `context:` line in `read_thread` reads the same. Collaboration prompt lines about "fits before automatic compaction" refer to this figure.
- **Immediate:** a change of the compaction setting, pair override, or thread model shows without a new request.

Compaction itself does not change: same moment, same settings.

## Why the limit, not the window

Before every model step `ThreadCompaction.prepare` compacts the history when the request forecast exceeds the threshold; on ACP the driver compares every measurement against the same threshold. A request past the threshold never leaves (except for one step's error), and the window with compaction on is never reached. The window is the provider's hard limit past the threshold; work can only be planned against the threshold.

## The fact and its owner

`ThreadContextLimit` is the thread's next-request limit: `{ window, compaction: { at, strategy, share, source } | null }`; `limitTokens = compaction?.at ?? window`. `compaction: null` means no automatic compaction: a transport with `compaction: 'none'` or an agent with `compaction: off`.

- **Arithmetic is the core** (`packages/agent/src/thread/compaction/`): `resolveCompactionTrigger` + `threadUsableTokens`, as now; `compactionThreshold` (`limit.ts`) assembles the compaction point from the same functions `ThreadCompaction.prepare` uses for its threshold.
- **Planned output** is one `@runlith/llm` function (`plannedOutputTokens`: profile budget ∧ `capacity.output`); `resolveModelCall` and the limit owner call it, so the display never builds a request.
- **The server owner** is `native-harness/compaction/limits.ts`, filling the threads module's `ContextLimits` port: per thread batch it reads policy once per project, the model from the `ProviderRegistry` (a harness provider through its `family`, like the ACP threshold), disabled compaction from the agent's strategy; an ACP thread's window is the agent-measured one (`contextReading.contextWindow`), like the threshold. The limit is computed at read time, like cache warmth; `publishLimitMoves` on a change of the three compaction keys reissues the state of open threads at rest in the project whose setting changed (a machine setting and a provider-catalog change — all projects), and rebuilds their lists. A running run takes the catalog pinned to it (`forRun`), as does its `prepare`. The numerator is the same everywhere — `occupiedTokens`: the last request's prompt (`inputTokens`, otherwise `totalTokens`).
- **The ACP threshold** (`CompactionPlanning.threshold`) goes through the owner's same function, so decision and display never diverge. An ACP thread counts as compactable by the `compaction: 'session'` capability, which a profile with `proves.compaction` gives.

## Who reads it

- **Thread wire** (`threads/list/wire.ts`): every wire shape gets one basis `{ warmth, limits }` assembled by one function; the list row is `contextShare = used / limitTokens`, `contextTokens = { used, limit }`; `WireState` carries `contextLimit` next to `contextReading`; the `read_thread` shape and composition carry the limit too.
- **Feeds** (`threads/list/feeds.ts`): each frame takes the basis at the moment it is cut, so reissued state carries the new limit.
- **Agent directory** (core): the `DeclaredCollaboration.limits` port modelled on `warmth`, `ThreadDirectoryEntry.context` carries the limit, `agentRoster` prints it.
- **Chat** (`@runlith/chat-ui`): `ChatState.contextLimit`; `chatContextSource` and metrics compute the share from the limit; the client fallback `declaredWindow` from the catalog is gone — the server knows the limit with no measurement, and the composer of an unborn thread shows no ring.
- **App**: the row ring and Peek read `contextShare`/`contextTokens`; the panel reads the limit from composition.

## What the performer proves

- For one thread with a pair override, the limit matches the threshold `prepare` compacts by and the ACP threshold (integration test through the owner's public operations).
- A change of a compaction key produces `changes`, and the list feed yields a row with the new limit.
- The share in the list row and chat metrics is computed from the limit; a thread with no compaction, from the window.
- Typecheck and the affected test sets are green.

The operator verifies live: a thread on Opus with a 55% override shows the until-compaction share everywhere, and changing the override moves the ring at once.
