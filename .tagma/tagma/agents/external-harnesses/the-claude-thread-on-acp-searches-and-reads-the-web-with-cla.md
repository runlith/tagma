---
id: 01a121db-9c66-7ad3-8b11-032b368ca234
title: "The Claude thread on acp searches and reads the web with Claude Code tools: the vendor's WebSearch and WebFetch, WebFetch asks Tagma, Tagma's web is not given to this thread"
ord: 59
tags: ["task"]
fields:
  {
    "holder": "tagma:01a121db-e579-744c-9b3f-aa6e78642d93",
    "status": "done"
  }
edges:
  - kind: relates
    to: 01a113ff-0d62-74ec-ae7c-e91101dc1899
sources:
  - kind: dir
    ref: apps/tagma/server/src/external-harnesses/runner/claude-code
---
The Claude thread on `acp` searches and reads the web through Tagma's `websearch`/`webfetch`: these are the free MCP Parallel and Exa. The runner opens `query()` with `tools: []`, and Claude Code's built-in `WebSearch`/`WebFetch` are off. By [[01dc1899]], ACP carries the vendor's own tools, and the web is exactly such a tool: Anthropic search on subscription beats free endpoints, and it does not touch the tree.

## What to do

1. **Runner enables the vendor web.** In `runner/claude/lifecycle.ts`, `tools: ['WebSearch', 'WebFetch']` instead of `[]`. Other built-ins stay off.
2. **Tagma does not give this thread its web.** The bridge (`runner/claude/bridge.ts`) does not publish `websearch` and `webfetch` from `read_hosted_tools`. The vendor built-in list and the hidden Tagma tool list are one declaration in the runner, not two constants.
3. **`WebFetch` asks Tagma.** A `PreToolUse` hook with matcher `WebFetch` sends the ACP client `session/request_permission` via `Outlet.request`. In it, `toolCall` (`toolCallId` = `tool_use_id`, `kind: 'fetch'`, `rawInput` = call input, `title`) and options `allow_once`/`reject_once`. A selected `allow_once` yields `permissionDecision: 'allow'`, any other outcome — `deny` with a reason. The driver already judges such a question as a vendor question: `protocol/questions.ts` → `HarnessJudging.verdict`, where `fetch` → `webfetch`, and `webfetch` asks in review. So no server part is needed. `WebSearch` with no hook: Tagma's `websearch` never asks either (`ASKS_NEVER`).
4. **Feed.** In `translate.ts`, the `KINDS` table knows `WebSearch` and `WebFetch` as `fetch`. The `websearch`/`webfetch` keys go away: the runner no longer yields them.
5. **Note.** Note [[d0810682]] is rewritten in the same change: what the runner lets into the session, the `WebFetch` hook, hidden Tagma tools.

## How to prove

- `contract.test.ts` on fake SDK and Outlet: query opens with the vendor web tools; the `WebFetch` hook asks the client and gets `deny` on refusal; the bridge does not yield `websearch`/`webfetch`.
- Runner typecheck and tests.
- One live probe (haiku, one run): `WebSearch` works on an OAuth account through the SDK; record the result in the note as a measurement.

## What does not change

The native thread and the terminal transport. Terminal `claude` already works with its own tools.
