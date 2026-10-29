---
id: 01a15930-26eb-7874-9b68-a972b1d6e8da
title: "The agent sees a child's wake-up cost at decision time: cache deadline in the report, child transitions between steps, the door's refusal on a cold large child"
ord: 66
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/threads/collaboration/signals.ts
  - kind: file
    ref: packages/agent/src/collaboration/collaborationVerbs.ts
  - kind: file
    ref: packages/agent/src/collaboration/CollaborationVoice.ts
  - kind: file
    ref: packages/agent/src/collaboration/reportTexts.ts
  - kind: file
    ref: packages/agent/src/thread/cache/ThreadCacheWarmth.ts
---
An orchestrator agent wakes cold children with large contexts for messages they do not need, and the user pays for rewriting their whole cache. One observed case: a "wait for the restart" message woke a thread with 655k of context, and it did nothing. This happens for three reasons:
- the prompt prices only work handover (`send_task`) and stays silent about messages;
- `send_message` only says "an idle agent starts a turn";
- the price is visible only in a separate `list_agents`, and the door reports it after waking with the word `woken`.

Goal — the price reaches the agent at decision time. The prompt grows by no more than a tenth, and default behaviour balances the user who does not count tokens against the user who saves every one.

## What stands now

- **Warmth.** Computed by `threadCacheWarmth` (`packages/agent/src/thread/cache/ThreadCacheWarmth.ts`).
  - States: `warm`, `likely`, `cold`, `unknown`. `likely` means "probably warm" (50–90%).
  - The `promise` basis gives an exact `expiresAt`. It comes from the read's `cache.ttlSeconds`, i.e. from the request's cache policy. Today only Anthropic adapters carry such a policy in the catalog: 300 s on console, 3600 s on subscription.
  - The `local` and `prior` bases are curve estimates. They yield any of the three states, and their accuracy is unverified: this spec does not touch them.
  - `invalidatedBy` (compaction, selection, account, reasoning) turns the thread `cold` with basis `none`. After compaction the read is marked stale and keeps the pre-compaction size.
- **Port.** In `packages/agent` warmth arrives through the `DeclaredCollaboration.warmth` port. The server fills it from `CacheWarmth`, and `ThreadDirectory` reads the same.
- **Whether-to-wake policies.** Several already exist:
  - `wakeUnlessCold` does not wake a cold thread for a command or call result (`threads/collaboration/signals.ts`);
  - `isWarm` in `compaction/choice.ts` counts `likely` as warm;
  - `promised` at recap.
- **Delivery.** A message to an idler goes with `ifIdle: 'wake'` (`RunScheduler.item`), a task wakes via `inputs.wakeItem`. An interrupt to an idler is only stored and does not wake. A signal with `ifActive: 'deliver', ifIdle: 'persist'` arrives on the next step and does not wake: parent-change notifications travel this way (`detachment.ts`). Their id is minted on the event, and a prior unread signal is retracted with `retractSignal`. The same id with different text is a conflict.
- **Who opened the run** is derived from `runCause.ts`: inbox links delivered at start, `turn` for operator words, `keep-warm`.
- **Who asked for compaction is recorded nowhere.** `thread_run` has no requester, `compact_agent` is keyed by `toolCallId`, the operator's `/compact` goes through the same `handle.compact`.
- **Keep-warm driver** (`native-harness/keepWarm/driver.ts`) judges only waiting threads (`standing.waits`: a running child exists) and sets a timer for `expiresAt − margin`. It does not judge an idle child with no running children. Only thread-frame subscription and raising to the parent may be shared with it.
- Signal type `AGENT_CHILD_UPDATE_SIGNAL_TYPE = 'child-agent-update'` is declared in `AgentSignal.ts` and used nowhere.
- **Six work-handover cases** stand in `handoffGuidance` (`packages/agent/src/collaboration/CollaborationVoice.ts`). The file is now being edited by the session of task [[3fbcd691]]: reconcile the text edit with it.

## What will be

Warmth facts are shown with exactly the confidence they carry. There is no new warmth estimate: everything reads the same `DeclaredCollaboration.warmth` port, and on the server the same `CacheWarmth`. Time comes from `Clock` (via `nextRequestWarmth`), not from `Date.now()` as in `cacheWarmthOf`.

Words for states:
- `warm until 12:47` and `cold` — only for the `promise` basis and for `invalidatedBy` selection/account/reasoning: this is certain cold;
- `likely warm` and `estimated cold` — for `local` and `prior`;
- nothing but the size — for `unknown`.

Size is `heldTokens`, i.e. what waking sends to the model. After compaction the old size is not printed.

### 1. Report tail

A child's state is a separate field of the report envelope. It is not in the text, so final-answer reconciliation by text (`finishAccepted`, `settleFinal`) does not change. The field renders as markup attributes: `<report from=… context="553k" warm-until="12:47">`.
- **Run-end report** (`completionReport`). Numbers come from the last read of the ended run, carried by `RunEnded`. Today `RunEnded` has no such field — it is added. Re-running the report stages (`EndingRunner.recover`) yields the same text.
- **Final answer** (`send_message final`). Numbers come from the read at send time. The child's run takes one more step, and the true cache deadline lands slightly later than shown — the error is to the safe side.

`warm-until` is written only on `promise`, and the time is UTC with an explicit `Z` (`12:47Z`): the agent sees each run's time in this zone (`<workspace at="…Z">`). There is no bare "warm" word without a deadline: a child that just answered is warm anyway.

Re-running stages after a restart rebuilds `RunEnded` from the run row; if the thread's read by then belongs to a newer run, the state field is omitted and the report text stays the same.

### 2. Child transitions between steps

A new driver in the threads module sends the parent a `child-agent-update` signal with `ifActive: 'deliver', ifIdle: 'persist'`: the parent sees it on its next step, and an idle parent is not woken by it. The signal is one line about the child when its state changed:
- `X cooled · 553k to rewrite` — the `promise` deadline expired while the child never started a run;
- `X compacted` — compaction of an idle child finished. If the compaction record knows the new context size, it is printed; otherwise not. Auto-compaction inside a run gets no separate line: the run-end line covers it;
- `X ran · context 600k · warm until 13:20Z` (on estimate — `likely warm` or `estimated cold`, with no estimate — size only) — a child's run ended with no report to the parent. This is a run on the operator's word, on another agent's task, on a grandchild's report, on a command result, or on the parent's plain `send_message`. If `runCause` names operator words, the line adds `for the operator`. `keep-warm` runs get no line.

A run that ended with a report to the parent gets no separate line: the state already stands in the report. The report is recognized by the envelope itself in the parent's inbox: a run-end report carries the run id, a final answer landed between the run's start and end. Warmth in a `ran` line counts at the run's last read, so retrying the same notification yields the same text; a retry arriving after the `promise` expired yields no line.

To keep no more lines than needed:
- **direct children only**, no archived ones;
- **last state, not history.** The signal id derives from the fact: child, transition kind, its key (`expiresAt`, run id, compaction id) and a digest of the line text — so a renamed child or a different read yields a new id, not a conflict. A new transition of the same child retracts its unread prior one via `retractSignal` — while the parent is working and the line awaits its next step. For an idle parent `ifIdle: 'persist'` appends the line straight into history and confirms it, so there is nothing left to retract: each transition arrives as its own line, no more than two or three per child run. The scheduler has no "until next run" queue for the idle signal; that is a separate task. The same fact after a server restart yields the same id and is not repeated;
- **after restart** the driver derives state from storage, not memory. It walks idle children with a parent once and sets timers on not-yet-reached `expiresAt` values with the `promise` basis. A child that cooled while the server was down gets no line.

The driver receives run ends as a `child updates` subscriber of run-end notification (`ThreadRunSettlements`, after the report stages, at-least-once), not from thread frames: by then the report to the parent is already delivered, and a repeated notification after a failure yields the same fact. The same subscriber reschedules the child's timer after each of its runs, keep-warm included. A run after which the child already started the next one gets no line: the next end will give it.

### 3. The door does not wake a cold large descendant

The check covers only what an agent sends **to its own descendant**: `send_message` without `final` and without `inReplyTo`, `send_task` and `send_task` with `compact`, `compact_agent`. Not checked:
- final answers, envelope replies, and anything going to an ancestor or a foreign team;
- `interrupt_agent`: it does not wake an idler;
- a running addressee: it will read the message on its next step.

The call refuses as a whole and sends nothing if at least one idle addressee is certainly cold (basis `promise` or `invalidatedBy` selection/account/reasoning) and its `heldTokens` is at or above the threshold. For `send_task` with `compact` and for `compact_agent` the check fires only when the child's own model compacts: when the operator's rule picks it (`summarizersOf`), a cold cache can be handed to another, cheaper model, and then the check does not fire. The check runs before `controlled(...)` in `fanOut`, so the call stays atomic.

Refusal:
- code `cold-wake`, declared where the core's other refusals live: the `ThreadSendRefused` union, `REFUSALS` in `collaborationVerbs.ts`, groups in `refusals.ts`;
- reason names each such addressee with its size: "seam is cold: waking it rewrites 655k";
- unblock:
  - drop the named addressees from `to` and send to the rest;
  - start a fresh agent with the cold one's last report;
  - `send_task` with `compact` if another model summarizes;
  - retry with `wake: true` — for all of the call's addressees — if this agent's history is worth the full price.

The `wake` flag joins `sendMessageInput`, `taskInput` and `compactingTaskInput`, shared with CLI-thread operations, and the `compact_agent` parameters: without it `compact_agent` would have no way out for the refusal to name. A `compact_agent` refusal is a flat `cold-wake` (`PLANE_REFUSALS`) with its own unblock: a fresh agent or `wake: true`. Which model will compact the child is asked of `ContextCompaction.summarizer` — the same `summarizing` the compactor will use. A `no-summarizer` refusal ("send without `compact`") on a cold large addressee leads to `cold-wake`. That is honest: there is no cheap path, and the way out names `wake: true`.

For estimated cold (`estimated cold`), for `likely warm` and for `unknown` the call goes through, and the delivery line carries the word and the size — the `cache` field of each delivery to an idle addressee (`warm until 12:47Z · 553k`, `estimated cold · 553k`, `cold · 655k rewritten`). The field is added to `RECEIPT_SAMPLE`, otherwise the `RECIPIENT_CEILING` cap stops guaranteeing the answer fits.

**Settings** are declared by the threads module, in its own section:
- `threads.coldWakeRefusal` — the refusal switch. On by default, off per machine or project. When off — the door wakes as now, and the delivery line carries `cold · 655k rewritten`.
- `threads.coldWakeTokens` — the threshold, 100k by default.

**Why 100k.** Waking costs the context size at the model's cache-write price, and on subscription that is quota, not money. A fresh agent costs its starting instructions with the brief and re-reading code the cold child already holds. Below 100k the refusal costs the caller an extra step and saves almost nothing. Above, the difference grows with every token. This is a starting target, not a derived number: it is tuned by measurement — the share of calls with `wake: true` after a refusal and the refusal count. If `wake: true` almost always follows a refusal, the threshold is set low.

On console Anthropic the cache lifetime is 5 minutes, so the refusal will fire often. That is right: cold rewriting there is real money. So the agent does not set `wake: true` out of habit, the prompt names when it is justified.

### 4. Prompt text

`handoffGuidance` is rewritten: the current block together with line 133 and "Who summarizes" takes 924 characters with `summarizerChoice`. The new block is no longer than about 1000 characters and keeps everything that stands now:
- adjacent work goes to the same child;
- a fresh agent — when independence matters;
- who compacts is the operator's call;
- the caveat about the compacting model.

Draft:

> Work adjacent to a child's zone goes to THAT child; a fresh agent when independence is the point — a review, a second hypothesis. Waking an idle agent resends its whole context, billed in full when its cache is cold: send it only what it must act on now. Reports end with the child's context and warm-until time; `<child-agent-update>` lines between steps say when a child cooled, was compacted or ran. First case that fits:
> 1. Context off the task: spawn fresh with its last report.
> 2. Warm, or small: `send_task`; add `compact` for a large task or near its compaction point, `keep` naming what it needs.
> 3. Cold and large (refused `cold-wake`): spawn fresh with its last report; `compact` if another model summarizes; `wake: true` if its history is worth the full price.
> 4. Returning after its warm time: `compact_agent` right after its report.
> Who summarizes is the operator's choice, never yours.

Without `summarizerChoice` the "`compact` if another model summarizes" and the last line go away.

"Large" in the text is unmeasured: the door measures it with its threshold. Not every agent has a direct channel to the operator, so the text says "send only what it must act on now", not "news go to the operator".

One phrase is added to each operation description:
- `send_message`: "an idle agent starts a turn" becomes "an idle agent starts a turn over its whole context — send it only what it must act on now";
- `send_task`: about `wake` and the `cold-wake` refusal.

### 5. Cleanup

Once the change lands, rule [[5bc2a638]] in global is deleted: it papered over the defect above the product.

## Acceptance

- **Door refusal**, public in-memory `ThreadEnvelopes` test:
  - a certainly cold child above the threshold → `cold-wake`, nothing delivered;
  - the same with `wake: true` → woken;
  - estimated cold → delivered with the word;
  - `threads.coldWakeRefusal` off → woken with no refusal, and the delivery line carries the price;
  - a child's final answer to a cold parent → delivered.
- **Transitions**, on test clocks:
  - an expired `promise` → one `cooled` line;
  - two transitions before a working parent reads → one line with the last state;
  - a run that ended with a report to the parent → no line;
  - an idle parent does not wake;
  - a driver restart does not repeat an already-sent fact's line.
- **Report tail**: `warm-until` on `promise`, size only on other bases; the final answer reconciles by text as before.
- **Prompt length**: the block is no longer than about 1000 characters with `summarizerChoice`, descriptions grew by one phrase each.

Not checked and not required: accuracy of the `local` and `prior` estimates, harnesses without warmth.
