---
id: 01a1941f-f2bb-77f3-9717-6554dace668c
title: Investigate the unanswered MCP page-list call
ord: 33
tags: ["task"]
fields:
  {
    "holder": "tagma:01a19422-9073-7aec-bf5e-95eb985ce871",
    "status": "done"
  }
edges:
  - kind: relates
    to: 01a13d5e-b581-7d0b-8ee4-81ef4db95c43
---
Investigate the unanswered `chrome-devtools` page-list request without launching a browser or changing third-party timeout policy. The historical failure remains unexplained; no production defect was established or producer changed.

Original evidence: thread `01a13d58-a2a4-7bde-adec-0d6e2ea8e490`, entry `357`, call `call_23a27915b7af4d9ebeac9cd9f93d21d4`, `mcp__chrome-devtools__list_pages({})`. Execution began at `2026-10-15T02:21:54.814Z`; `output-error` was recorded at `02:22:54.893Z`, 60.079 seconds later, with `MCP server chrome-devtools timed out during call list_pages after 60000 ms.` A later successful call is recorded in thread `01a140ec-6c7b-7790-9b4d-bc8e91bbd63e`, entry `611`; it proves only that the server answered later. The prior investigation in thread `01a1686f-1367-7de2-93c4-0341bae80779`, entry `265`, also left the cause unknown. The original peer's wire trace, logs, exact declaration and caller metadata were not recovered, so an external server failure cannot be distinguished from every possible client failure.

The current public chain is `mcpToolCatalog` tool execution → `McpServers.caller` in `serverPool.ts` → `McpPool.call` → `McpSession.call` → `sdk.ts:mcpCallTool` → SDK `Client.callTool`. SDK request timeouts become `McpTimedOut`; the observed message is that typed failure's rendering, not evidence that Chrome itself emitted it. The local hypothesis was that a stdio peer exit loses an already flushed result or leaves an unanswered request waiting until its deadline. A deterministic scripted peer through the public `McpPool.call('pages', 'list_pages', {})` refuted that hypothesis on unchanged production code: a complete result followed immediately by process exit remains the call result and the session leaves the palette; process exit before the result answers `McpCallFailed` and removes the session. The fixture changes only the peer lifetime, not arguments or client deadlines. It does not reproduce Chrome/CDP state, the historical process or transport, or external cause. The existing session-lifetime explanation was corrected to state this boundary.

Validation: `bun run typecheck` from `packages/mcp` exited 0. `../../node_modules/.bin/testbed bun test --no-isolate ./src/McpPool.itest.ts --randomize --seed=N` passed separately for N=1, 2, 3: 17 tests, 0 failures on each seed. The new scenario passed before any producer change; there is no red/green defect claim. No broad suite, browser, chrome-devtools call, network/provider request or product launch was run. The original reflection remains unanswered because its cause is still unknown.
