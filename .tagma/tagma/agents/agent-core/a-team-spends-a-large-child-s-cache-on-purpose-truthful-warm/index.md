---
id: 01a0da9c-b613-74a3-844d-566d021c93b2
title: "A team spends a large child's cache on purpose: truthful warmth in list_agents, send_task with compact in one unit, prompt guidance by warmth and task size, and keep-warm for a thread waiting on its children"
ord: 177
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/threads/list/wire.ts
  - kind: file
    ref: packages/agent/src/collaboration/CollaborationTools.ts
  - kind: file
    ref: packages/agent/src/collaboration/CollaborationVoice.ts
  - kind: file
    ref: packages/agent/src/collaboration/ThreadDirectory.ts
  - kind: file
    ref: packages/agent/src/collaboration/ThreadSpawnTree.ts
  - kind: file
    ref: packages/agent/src/thread/inboxItems.ts
---
## 1. Outcome

A team spends Anthropic quota on a large child only when it has to, and the lead agent knows the price before it wakes one:

- **Truthful warmth.** `list_agents` reads a child's warmth against the request the child would actually send next: its selection, the account that request would sign with, and its rung. The row says how many tokens the next step reads from cache or rewrites.
- **Compaction and task in one call.** `send_task` takes an optional `compact`: the child's history is compacted, and then the task opens on the compacted context. A cold child is compacted by the operator's summarizer chain, never silently by its own cold model.
- **Prompt guidance.** The collaboration prompt tells the lead how to choose between sending as is, compacting first, compacting right after a report, and spawning fresh. It replaces the 60/85% context bands.
- **Keep-warm.** A thread waiting on its children is kept warm by the server with a bounded number of cache-refreshing requests, so a lead whose children work for two hours wakes warm.

## 2. Problem and evidence

- A lead holding 700k on Opus that waits more than an hour for its children wakes cold on their reports, and the wake rewrites the whole prefix. On this installation, a turn of this thread after a switch read 0 from cache and wrote 195k.
- `list_agents` warmth compares a resting reading with its own provider and model and passes `account: null`, so it reads warm after a model, account or rung change (`packages/agent/src/collaboration/ThreadDirectory.ts#heldPrefix`).
- The prompt's bands pick an act by context share alone (`CollaborationVoice.ts`). They send a small fix to a 60% child through a compaction it does not need. They spawn fresh past 85% even when the child's context is exactly what the next task needs.
- Compacting and then tasking takes two calls, and a third party's message can land between them.

## 3. What holds now

- `compact_agent` goes through `ThreadCompactionRuns.ask`, the same road as the operator's `/compact`. Rule and chain from 478a03df therefore already choose who summarizes a child (`ThreadSpawnTree.ts#compactChild`).
- An `end` compaction request is a barrier in the inbox. Work queued before it runs first, then the compaction, then what came after (`inboxItems.ts#beforeBarrier`, `compactionHead`).
- Warmth by account and by rung is judged on the server for the thread list and the thread page (`wire.ts#cacheWarmthOf`, claims 854e7ebf and 8f78ffaa). Only Anthropic's console paths promise a TTL and key their cache by rung (claims 2c02c2d4 and 10e77d5b).
- Reading a cached prefix refreshes its TTL on Anthropic. This is the vendor's documented behaviour and is not measured on this installation.
- A task a thread sent is owed a final answer until its child sends one (claim 8fc509d9), which is how a waiting lead is recognized.

## 4. Target model

### 4.1 Truthful warmth in the directory

- **One verdict.** The directory's warmth is the same verdict the server computes for the thread list: same reading, same next-request selection (provider, model, account resolved as a request signs, rung resolved as a request resolves). The host supplies what the kernel cannot resolve, through a port; the verdict is never recomputed differently.
- **Token counts.** The entry carries the held tokens with the verdict. `list_agents` prints them as "warm · 712k from cache · 38m" or "cold · 712k to rewrite · account changed".
- **Prices stay out of the entry.** Multipliers live in the prompt only (§4.3).

### 4.2 `send_task` with `compact`

`send_task` gains `compact?: { keep?: string }`. `keep` defaults to the task text.

- **One unit.** The compaction barrier and the task are accepted together, the task directly behind the barrier. Nothing another sender writes can land between them.
- **Idle child.** The summarizer resolves at the door, as the idle road already does (delta 8478b619). Then the compaction runs and the task opens on the compacted context. A `no-summarizer` refusal refuses the whole send, queues nothing, and names its ways out:
  - send without `compact`;
  - spawn fresh with the child's last report as the brief.
- **Running child.** The barrier waits for the work queued ahead of it and resolves when taken. If it refuses `no-summarizer` then, the task still opens on the uncompacted context, and the compaction entry records the refusal. Holding work back costs more than one paid wake.
- **Summarizer.** The same resolution as `/compact`: rule and chain from the operator's settings. The agent cannot name a model.
- **Answer.** `send_task` answers that the task is queued behind a compaction.
- **`compact_agent` answer.** It names who summarized, whose quota paid, and what was skipped, from the entry 2e8b4bb6 already writes.

### 4.3 The collaboration prompt

The section "Handing work to a child you already have" keeps its first paragraph and replaces the three bands with this order:

1. The child's context is not about the next task: spawn fresh, with its report as the brief.
2. Cold and large: `send_task` with `compact`.
3. Warm, and a task of a few steps: `send_task` as is, whatever the fill, if the task fits before the automatic trigger.
4. Warm, a large task and a large context: `send_task` with `compact`, because every step re-reads the whole prefix.
5. Near the window: `send_task` with `compact`, `keep` naming what the next task needs, rather than letting the automatic trigger cut mid-task.
6. A large child you will return to later, not within the hour: `compact_agent` right after its report, while it is warm. Its own model compacts it from cache, and a later wake rewrites the summary instead of the whole history.

**One line on price.** A warm step reads about a tenth of the held tokens. A cold wake rewrites them at one to two times, which are Anthropic's API multipliers. A cold compaction runs on the operator's cheaper chain. The prompt says what `list_agents` shows, and names nothing that is not built.

### 4.4 Keep-warm for a waiting thread

**Settings.** `agent.keepWarm`: on or off, default on. `agent.keepWarmPings`: pings per wait, a positive integer, default 3. Both are global with a project override.

**Who is kept warm.** A thread at rest whose deployment promises a TTL, which today means the Anthropic console paths, and which is waiting:
- it holds an open request it sent to a child; or
- a descendant is running.

**When.** A ping is sent a margin before the reading's `expiresAt`. The margin is the builder's to choose and state, and it is short enough that the ping lands before expiry.

**What a ping is.** One request carrying the thread's exact next prefix: system, tools, history and switches, on the thread's own selection and account, behind a minimal trailing text, asking for the smallest output the deployment allows.
- It writes nothing into history.
- It records an entry in the thread's feed: "kept warm", with its usage and account.
- It refreshes the context reading's instant and cache figures, so warmth reads the renewed TTL.

**A wait.** A wait begins when a thread comes to rest while waiting and ends when it runs again. The pings of a wait are counted from the feed entries since the thread's last run, so a restart does not reset the count.

**Stop.** No ping is sent when:
- the thread is no longer waiting;
- the count is reached;
- the account is unspendable (`ai/spendable.ts`);
- a run holds the thread;
- keep-warm is off;
- the thread is archived.

## 5. Owners and boundaries

- `packages/agent`, collaboration ([[3ef6226b]]):
  - the directory's warmth port and entry;
  - `send_task` `compact` and the one-unit acceptance;
  - the `compact_agent` answer;
  - the prompt text.
- `packages/agent`, compaction and inbox ([[8faf533f]]): the barrier-plus-task acceptance, reusing the existing barrier.
- `packages/agent`, the thread: a prefix-only ping request that records an entry and no history.
- Tagma server, harness:
  - filling the warmth port from the thread list's computation;
  - the keep-warm driver and its settings.

## 6. Rejected alternatives

- A `cold-wake` refusal on `send_task`: guidance, visible price and keep-warm are expected to make it unnecessary. It is reconsidered if agents ignore the guidance.
- Compacting a cold lead before a child's report wakes it: the operator refused it, because the lead would lose its own working context.
- Pinning a warm thread to its old account on a default switch: the operator switches because a quota ran out, so pinning would fight the reason for the switch. The question stays open.
- A keep-warm limit in hours: on a five-minute TTL, three hours is 36 pings, about 3.6× the context and more than one cold wake. A ping count bounds the cost on every TTL.
- Agents naming a summarizer: the operator's settings alone decide what quota compaction spends.

## 7. Acceptance criteria

1. A child whose provider's default account moved, or whose rung changed, reads cold in `list_agents` with the reason. Warm and cold rows print their held tokens.
2. `send_task` with `compact` to an idle cold child holding a large context compacts it with the first spendable chain member, then opens the task. The child's first request after it holds the summary and the task, and nothing another sender wrote sits between them.
3. The same call with no spendable chain member refuses `no-summarizer`, queues nothing, and names its ways out.
4. To a running child, the compaction runs after its queued work and the task opens after the compaction. A `no-summarizer` at that point still opens the task, and the entry records the refusal.
5. `compact_agent`'s answer names the summarizer and whose quota paid.
6. The prompt section carries the order of §4.3, and no sentence of it names something that is not built.
7. With keep-warm on, a lead resting with an open request to a running child receives at most `agent.keepWarmPings` pings before each expiry. Its warmth reads warm through them, each ping shows in its feed with its usage, and its history is unchanged.
8. Pings stop when the child reports, when the count is reached, when the account is unspendable and when keep-warm is off. A restart keeps the count.

## 8. Claims and tasks touched

- **5be1b966** (a directory entry carries a resting prefix's warmth): rewritten to the next-request verdict.
- **Collaboration claims on `send_task`, the barrier and the directory:** rewritten where the one-unit acceptance changes them.
- **New claims:**
  - the directory's warmth is the list's verdict;
  - `send_task` `compact` is one unit;
  - who keep-warm pings and when it stops;
  - a ping writes no history;
  - the prompt claim for the team section.
- **Task 44157e29's open note that the warmth re-send is missing:** already answered by 0fac549b.

## 9. Order of building

Two tasks with disjoint code, built in parallel:
- A: §4.1–4.3;
- B: §4.4.

§4.3's prompt lands with A, because it describes A.

## 10. Contract

- `send_task` input gains `compact?: { keep?: string }`. Old callers are unchanged. The answer gains `compaction: { requestId } | null`.
- The directory entry's warmth keeps its shape. The entry gains `heldTokens`, or the warmth carries it as it already does.
- `ThreadCacheWarmth` is unchanged.
- The thread feed gains a `keep-warm` entry kind with `usage`, `account`, `expiresAt` and `ping`, the number of the ping within its wait.

## 11. Stored data

- No migration: new inbox rows and feed entries are new kinds or optional fields, and old rows decode as before.
- Rollback leaves `keep-warm` entries unread.

## 12. Who may do what

- **The operator** owns both keep-warm settings and the summarizer chain.
- **Agents** may ask for compaction but cannot choose its model, and cannot switch keep-warm.
- **The keep-warm driver** runs as the thread's owner and spends the thread's own account. A wrong "waiting" verdict costs at most the configured number of pings.

## 13. Long-lived things

- No timer outlives the process. The driver derives its schedule at boot and on every thread frame from:
  - the resting threads that wait;
  - their readings' `expiresAt`;
  - the count of their pings since the last run.
- A ping racing a run start is abandoned or harmless: it writes no history, and the run's own request refreshes the cache anyway.

## 14. Bounded resources

Per wait, at most `agent.keepWarmPings` requests of about a tenth of the held tokens each, on accounts judged spendable. Pings are serialized per thread.

## 15. Rollout

Keep-warm defaults on, so the first waiting leads after the upgrade are pinged. A thread whose reading predates the rung and account fields is judged as today.

## 16. Failures

- A failed ping is recorded with its failure and not retried within the same TTL window. The next window may try again within the count.
- A restart re-derives the schedule. A dropped connection during a ping costs that ping.

## 17. Observability

- Each ping is an entry in the thread's feed, with usage and account.
- `list_agents` and the thread page show warmth renewed by pings.
- The count per wait is readable from the feed.
