---
id: 01a14f72-2ff8-7fe8-9dcf-44bcf1407326
title: "The \"Thinking summary\" switch on Claude over ACP: the same reasoningDisplay as native reaches Claude Code's thinking.display"
ord: 3
tags: ["task"]
fields:
  {
    "holder": "tagma:01a14cfa-01b6-73d1-ab67-0e20a204ca15",
    "status": "done"
  }
edges:
  - kind: relates
    to: 01a14cba-e095-7bcb-bb6f-60854010a731
  - kind: relates
    to: 01a14f72-057b-7960-a80c-4977af264e00
sources:
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/protocol/alignment.ts
  - kind: file
    ref: packages/adapter-anthropic/src/runner/lifecycle.ts
  - kind: file
    ref: packages/adapter-anthropic/src/models/anthropic.ts
---
The operator's decision: a setting the native thread has works on an ACP thread too; "Thinking summary" is on by default (`summarized`, as `REASONING_DISPLAY_SWITCH` already stands).

Now the switch is declared only on Anthropic models; `claude-code` provider models do not carry it, and the runner opens the Agent SDK query without `thinking`, so Claude Code sends only rare deliberation excerpts (in thread 01a14c6e — 37 deliberation records per ~2900 journal records).

To do:
- `claude-code` models that support adaptive thinking declare the same `REASONING_DISPLAY_SWITCH` (one declaration, not a copy);
- a thread's switch choice travels to ACP the same road as model and effort: core row → `ProtocolAlignment` (`configured`, a launch-time difference) → the runner session setting;
- the runner opens the query with `thinking: { type: 'adaptive', display }`, and applies a mid-session switch with `setMaxThinkingTokens(null, display)` through the `Channel` (`sdk.ts` — the single file touching `Query`), without restarting the process;
- terminal: the switch does not apply — a declared weakening where the CLI does not take it.

Proof: the runner contract on a fake SDK — the `thinking.display` option at opening and a mid-run switch without a new process; the parity scenario — a switch change on an ACP thread reaches the runner with no new process; a new ACP thread's default choice — `summarized`.
