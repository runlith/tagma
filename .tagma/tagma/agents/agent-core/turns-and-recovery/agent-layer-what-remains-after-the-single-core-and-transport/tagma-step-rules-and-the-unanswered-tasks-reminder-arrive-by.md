---
id: 01a151df-e920-73d7-9b09-09dc1e1ef4cf
title: Tagma step rules and the unanswered-tasks reminder arrive by contribution registration
ord: 11
tags: ["task"]
fields:
  {
    "holder": "tagma:01a151fc-5640-7f4a-9526-239d66e50fc2",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a151df-e920-73d7-9b09-09d091976ebe
sources:
  - kind: file
    ref: apps/tagma/server/src/native-harness/agents/composeAgent.ts
  - kind: file
    ref: packages/agent/src/collaboration/ThreadObligations.ts
---
Tagma-step rules come by contributor contribution through a manifest: a shared `AgentRuleRegistry` holds sources, checks collisions and assembles them by priority. `composeAgent` reads that registry with no implementation list. The set, metadata and order of the earlier hooks are kept for the four built-in declarations.

The unanswered-tasks reminder became a `beforeClose` rule at the earlier point of successful text-only completion. It gives one reminder and one more step; the repeated end finishes the run. The reminder state lives in `AgentRunState`; restored markers and mutations count only for the same run. A rule failure gives a typed note. The `ThreadRunClosing` port, its silent layer and the `AgentClosing` callback are removed. `AgentRunner.host` still does not run the model loop and still does not call that hook: the earlier native-vs-hosted difference is kept.

Checked: AgentRunner 109/109; policy 23/23; ThreadObligations 6/6 with unchanged source assertion groups and two run-isolation checks; ruleSources 1/1; composeAgent 15/15; real-kernel requestObligation 4/4; grants 3/3. Final server typecheck green (5121 files), app typecheck green with the earlier a11y warning CastView.svelte:243. One read-only review by [[01a15262-d7a3-7af5-b257-000100eac817|the reviewer]]: no findings.

The delivery landed in `6452568c72738069195120e2d18f7a7a458ddd` together with [[48aef83b|the single run preparation]]: contracts are coupled both ways. The owner of the shared landing fixed the old library fixture after `30723a8992`, confirmed library and check_law with no violations. The earlier observed `TypeError ... yield* ctx.graph` failure is gone. The typecheck above checked the working tree before landing; the exact commit tree was not checked separately because parallel unfinished approvals edits blocked a full agent typecheck. This session holds no uncommitted paths.
