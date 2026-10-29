---
id: 01a0d980-451f-7376-b8a0-a342478a03df
title: A manual compaction may be summarized by another model than the thread's — resolved by the operator's rule and chain when taken — while the thread keeps its own selection
ord: 125
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/protocol/settings.ts
  - kind: file
    ref: apps/tagma/server/src/providers/quota/ledger.ts
  - kind: file
    ref: packages/agent/src/thread/cache/ThreadCacheWarmth.ts
  - kind: file
    ref: packages/agent/src/thread/compaction/summaryStrategy.ts
  - kind: file
    ref: packages/agent/src/thread/run/ThreadCompaction.ts
  - kind: file
    ref: packages/agent/src/thread/run/ThreadCompactionRuns.ts
---
UX page agreed with the operator: http://localhost:5634/a/84cca7c161ed (version 2). Where the page and this decision disagree, this decision holds: the page shows `/compact` and `/compact-with` as two commands, and the operator settled on one.

## 1. Outcome

The operator's `/compact` on an Opus thread holding 712k tokens behind a cold cache is summarized by a model the operator named, for example DeepSeek V4.1 Flash or Muse Spark 1.3, and costs that model's provider about 712k of input. It spends nothing on Anthropic until the thread's next turn. The thread keeps its own provider, model, account, reasoning and switches: the summarizer serves exactly one compaction. While the thread's cache is warm, the thread's own model still compacts, because reading its prefix from cache is the cheapest path.

## 2. Problem and evidence

- A manual compaction always runs on the thread's own selection. `ThreadCompactAsk` carries only `keep` and `at`, and every segment is built from the thread's provider, model and account (`packages/agent/src/thread/compaction/ThreadCompaction.ts`, `ThreadCompactionRuns.ts`).
- The generic `ThreadSummaryStrategy` already serializes the covered history into one user message with `cache: 'none'`, so it never depended on the thread's cache and can run on any model.
- Thread warmth (`threadCacheWarmth`) compares provider and model but not account. After an account switch a thread reads warm although the provider's cache is gone, and the rule in §4 reads warmth.

## 3. What holds now

- The step and idle compaction paths both take their identity from the thread (`ThreadCompactionTarget`, `ThreadCompactionInput`, `ThreadManualCompactionInput`).
- A deployment with its own compaction form is selected through `ThreadCompaction.profile`; every other deployment uses the host's strategy (claim 560ccc00).
- A compaction request is an inbox item whose body is `{ at, keep? }` (`threadInboxCompactionBodySchema`).
- A compaction entry records mode, status and a receipt, and does not record which model summarized.
- The allowance table (`AccountQuota`) keeps windows (`usedPercent`, `resetsAt`) and the last failure per stored account. Nothing answers the question "may this account be spent now, and if not, until when".
- Compaction settings are declared in `apps/tagma/server/src/protocol/settings.ts` at global and project scope. `compactionOverrides` shows that a list of model rows with a `model` field control already exists.

## 4. Target model

**Summarizer selection.** A compaction request may name a summarizer `{ provider, model, reasoning }`. Where the request names none, the host resolves one when the request is taken, never when it is asked, so warmth and quota are read at the moment of spending:

- rule `never`: the thread's own model;
- rule `when-cold` (shipped default): the thread's own model while its warmth reads `warm` or `likely`; otherwise the first spendable model of the chain;
- rule `always`: the first spendable model of the chain;
- an empty chain under any rule: the thread's own model, which is exactly today's behaviour;
- a non-empty chain with nothing spendable: the compaction refuses `no-summarizer`, naming each chain member and why it was skipped. It never falls back to the thread's own model silently.

A named summarizer, whether chosen by the operator or by an agent later, is used as named and skips the rule. The thread's own model is always a valid explicit choice, warm or cold.

**Spendable.** A model is spendable when its provider is connected, the provider's account that would be used exists, no window of that account in the allowance table stands at 100% with a reset still ahead, and no rate-limit failure with a Retry-After still running is recorded against it. An account whose deployment has no usage read (`unsupported`) counts as spendable, because nothing says otherwise. The answer carries the instant it stops being unspendable where the table knows one.

**Execution.** When the summarizer is not the thread's own deployment, the deployment's own form is skipped and the host's summary strategy runs under the summarizer's selection: its provider, its provider's default account, its reasoning, its capacity for the budget, and no cache group of the thread. Where the covered history does not fit the summarizer's window, the history is folded in successive passes, each pass taking the previous summary as its prior. If a summarizer fails with a provider failure (quota, rate limit, unavailable, overflow after retreat), the next spendable chain member is tried. An explicitly named summarizer is not replaced. The thread's own model never enters this loop unless it was the resolution.

**Continuation.** Where the thread's deployment has its own compaction form and the summary came from another model, the checkpoint carries a continuation context built without a model call (mode, transcript location, keep, preserved count, previous message and request ids, deferred tool references). The thread's next request then presents the checkpoint in the deployment's own continued-session form, as after its own compaction.

**Record.** The compaction entry names the summarizer that wrote the summary, the chain members skipped with their reason, and the usage billed to the summarizer's provider. The thread's context reading goes stale as after any compaction.

**Warmth knows the account.** The context reading records the account its request actually went out on, which is the resolved one where the thread names none. Warmth reads cold with `invalidatedBy: 'account'` when the thread's next request would go out on another account.

**Settings.** Two keys at global scope with project override: `agent.compactionSummarizerRule` (`never` | `when-cold` | `always`, fallback `when-cold`) and `agent.compactionSummarizers`, an ordered list of `{ provider, model, reasoning? }` (fallback empty, merge `replace`, because order is meaning).

**Choice read.** One operation answers, for a thread: the resolved default with its reason, the chain with each member's spendability and until-when, the thread's own model, and every other text model of the catalog. Every row carries the estimated input tokens, the number of passes and whose quota pays. The UI, the CLI and later `compact_agent` read it. It and the resolver filling the port are one computation, so what the read promises is what a taken request does in the same state.

**Surface.** `/compact` stays one command. Its options are that read: the resolved default is the preselected first row, so typing `/compact` then Enter compacts exactly as today, and arrows pick another row. The command row's value names who will compact ("Gemini 3.8 Flash · cache cold · Muse has no quota until 18:40", or "no summarizer"). A cold, large thread's card offers "Compact · <resolved model>" and "Another model…". A compaction entry in the feed names the summarizer, its quota and skipped members. The settings section shows the rule and the ordered chain, each member with its live spendability.

## 5. Owners and boundaries

- `packages/agent`, compaction ([[8faf533f]]): the summarizer in the ask and inbox body, the host resolver port, execution under a foreign selection, passes, fall-through, the continuation context, the entry fields.
- `packages/agent`, cache ([[37580f83]]): account in the reading and the `account` invalidation.
- Tagma server, AI ([[80570fd0]]): the spendable answer over `AccountQuota` and provider accounts.
- Tagma server, harness and settings: the two keys, the resolver filling the port, the choice-read operation, and the `summarizer` input on the compact door (socket and CLI).
- Tagma surface, threads ([[a06a3fe8]]): the `/compact` options, the value line, the card buttons, the feed entry, the settings control.
- `packages/llm`: untouched unless the continuation context needs a presentation change there.

## 6. Rejected alternatives

- Switching the thread's model for the compaction and back: it writes two model changes into the record and invalidates warmth twice for nothing.
- A separate `/compact-with` command: the composer already opens a command's options when its full name is typed, so one command with the default preselected costs the same keystrokes and keeps the choice in one place.
- Silent fallback to the thread's own model when the chain is exhausted: it spends the expensive path without the operator seeing it, which is the problem being solved.
- Resolving the summarizer when the request is asked: a request queued "after this run" would carry a verdict made on stale warmth and quota.

## 7. Acceptance criteria

1. On a thread whose warmth reads cold, with chain `[deepseek-v4.1-flash]`, `/compact` produces a checkpoint whose summary request went to opencode-go, and the thread's provider, model, account and reasoning are unchanged. Its next request goes to Anthropic with the checkpoint in the continued-session form.
2. The same thread while warm compacts through its own form, as today.
3. An empty chain leaves every compaction behaving as today, under every rule.
4. With the first chain member's account at a 100% window whose reset is ahead, the second member compacts and the entry names the first as skipped for quota.
5. With every chain member unspendable, `/compact` refuses `no-summarizer` naming each member and its reason, and nothing was sent to the thread's own model.
6. A summarizer whose window is smaller than the covered history compacts in more than one pass, and the choice read announced that count.
7. Switching the provider's default account makes a thread with no account of its own read cold with `invalidatedBy: 'account'`.
8. The `/compact` command row names the resolved summarizer before Enter, and typing `/compact` then Enter compacts with it.
9. A request queued with `at: 'end'` resolves when taken: if the cache warmed or cooled in between, the resolution follows the state at the moment of taking.

## 8. Claims and tasks touched

- b264e59a (warmth verdict order) gains the account invalidation and is rewritten from the code.
- 560ccc00 (deployment form or host strategy) becomes conditional on the summarizer being the thread's own deployment.
- 08ceb000 (selected-form lineage) is joined by a claim for the synthesized continuation context.
- New claims: summarizer resolution and its rule; spendability; fall-through; passes; the entry naming its summarizer; the choice read as the only place the rule is computed.

## 9. Order of building

1. Warmth by account, independent.
2. Kernel and server backend together, because the port and its filling move as one: ask and body field, resolver port, foreign execution, passes, fall-through, continuation, entry fields, settings, spendable, choice read, door input.
3. Surface, once the choice read's shape has landed.

## 10. Contract

- `ThreadCompactAsk.summarizer?: { provider: string; model: string; reasoning?: string | null }`.
- The inbox compaction body gains the same optional field. Old bodies decode without it, which means resolve.
- The host port is `summarizers(thread) => Effect<{ kind: 'own' } | { kind: 'chain'; members: readonly ResolvedSummarizer[] } | { kind: 'none'; skipped: readonly Skipped[] }>`, where a member already carries the selection and account to call.
- `ThreadCompactionEntry.summarizer?: { provider, model, reasoning, skipped: readonly { provider, model, reason, until? }[] }`, optional, so old entries read as the thread's own.
- The warmth `invalidatedBy` union gains `'account'`. Readers that switch on it (the app's `warmthWords`, the collaboration directory, the thread projection) name it.

## 11. Stored data

Only JSON bodies gain optional fields (inbox body, transcript entry, context reading). No migration is needed: old rows read as "resolve", "own" and "account unknown". A reading with no account does not invalidate on account, because not knowing is not evidence of a switch. Rollback leaves the new fields unread.

## 12. Who may do what

The operator sets the rule and chain and may name any summarizer. Agents compact through the same resolution and gain no summarizer input in this step. Spendability is checked in the host resolver when a request is taken. A wrong "spendable" verdict costs one failed call before fall-through; a wrong "unspendable" verdict skips a member and names it in the entry.

## 13. Long-lived things

A queued request holds only the optional explicit summarizer and no verdict. Nothing new outlives a compaction run.

## 14. Bounded resources

Passes are bounded by the history over the summarizer's usable window. The choice read shows the count, and the fall-through is bounded by the chain's length.

## 15. Rollout

Running threads see nothing until a compaction runs. The shipped rule `when-cold` with an empty chain is today's behaviour, so nothing changes until the operator fills the chain.

## 16. Failures

A summarizer's provider failure falls through as in §4. A process restart during a compaction behaves as today: the request is redelivered and resolves again when taken. A thread-side conflict (moved prefix) writes nothing, as today.

## 17. Observability

The feed entry names who summarized, what was skipped and whose quota paid. The choice read shows the verdict before spending. The run's trace records the summary request under the summarizer's provider and model.

out: automatic compaction (trigger and overflow) keeps the thread's own model, because a compaction inside a run meets a warm cache by definition. out: `keep` in the surface is not asked for in this step. out: a per-project ban on sending transcripts to another vendor was not asked for; the operator's own chain is the consent. out: agents naming a summarizer through `compact_agent` belongs to the orchestration step that follows.
