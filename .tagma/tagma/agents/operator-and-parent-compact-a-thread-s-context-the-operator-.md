---
id: 01a14b6d-b20b-7df8-967f-12f6ca207c5e
title: Operator and parent compact a thread's context; the operator decides who writes the summary and whose quota pays
ord: 16
---
A thread's long history is folded into a summary so the thread works on in a short window; the operator decides who writes the summary and whose quota pays.

**How.** Operator: `/compact` and the "Compact with" picker in the composer (a "Compact with <model>" button at the turn's end), the `compact_thread` operation — at once on a resting thread, on an accepted boundary on a running one (`step` — the next step, `end` — after the turn); `tagma compact` with `--keep`, `--at`, `--with provider:model`, `--reasoning`. A parent agent: `compact_agent` over a descendant (at once on an idler, `at: step|end` on a working one; `joined` — the answer of an already running compaction; `keep` — what the summary must keep) and `send_task` with `compact` — compact one descendant and stand an assignment right behind the compaction. `read_compaction_choices` shows in advance: the rule and the operator chain's verdict, each model with its cost, passes, and whose quota pays.

**Who writes the summary.** The summarizer chain and rule settings (`agent.compactionSummarizers`, `agent.compactionSummarizerRule`; `read_compaction_summarizers` reads the tier): the thread's own model, the chain's first spendable member, or nobody — then compaction refuses with `no-summarizer` instead of spending the thread's model. Claude on ACP compacts with its own model in its own vendor session; another model retells the Tagma journal between turns, and the next turn opens a new session.

**Limits and refusals.** A transport without compaction (terminal CLI) — `transport-cannot`. `send_task` with `compact` goes to one recipient (`compact-to-many`) and only to a descendant (`not-a-descendant` without the operator's consent); on a working agent the assignment opens even when compaction failed. The answer names the history "before → after", the summarizer, and the skipped ones with reasons.

Code: apps/tagma/server/src/native-harness/contract/wire/operations/compaction.ts#COMPACTION_OPERATIONS, apps/tagma/server/src/native-harness/contract/wire/operations/context.ts, packages/agent/src/collaboration/CollaborationTools.ts#collaborationTools, packages/agent/src/collaboration/collaborationVerbs.ts#COMPACT_OUTCOMES, apps/tagma/server/src/native-harness/contract/wire/compactionSettings.ts, apps/tagma/app/src/lib/features/threads/native/ModelPanel.svelte, apps/tagma/server/src/threads/cli/turnVerbs.ts
