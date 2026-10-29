---
id: 01a12bd2-5039-76ae-bc77-a7a1a9cac318
title: On the Claude Code road a tool_search-revealed tool definition reaches the model a step later than the answer promises
ord: 163
tags: ["reflection"]
fields:
  {
    "actual": "The next request left without a schema: the call arrived with all arguments as strings and got body-shape; the schema arrived one step later. One lost step per reveal.",
    "command": "tool_search {query:select:read_thread_record} in the hosted claude-code thread (claude 2.1.296), read_thread_record on the next step.",
    "expected": "The next model request carries the revealed tool definition, as the answer note promises: callable from the next step; their definitions arrive with it."
  }
---
Filed from project `runlith`.

Thread 01a12bcb-df35-7d58-a66f-d1f149cdcd52 (claude-sonnet-5-5, first turn): record #35 — tool_search, #40 — read_thread_record with string arguments, `body-shape: Expected array at ["at"]` refusal, #45 — the same call with schema types, success. String arguments mark a request without a definition: the same shape as a call with an unknown name (#30 there, `read` with `"limit":"80"` in 01a12196-ee87-72ad-a4ce-d5c5e973e4cc #37).

Owner: `Bridge.called` in `apps/tagma/server/src/external-harnesses/runner/claude/bridge.ts`. After a call with `offered` it calls `refresh(false)`: it sends `sendToolListChanged()` and returns the tool answer at once, without waiting for `tools/list` to be re-read. Claude Code re-reads the list asynchronously while assembling the next model request — a race. The turn start (`refresh(true)`) waits up to 5 s for exactly this reason.

The race does not always lose: in 01a12bcd-fa8a-7c9a-a083-30c5c11efafd and in 01a12660-dbc3-70fa-b84c-b55e56cbec26 (about 25 reveals, Opus) the next step had the schema.

Note d0810682 explains the missing wait as "waiting inside a call is waiting on itself". No measurement in the graph shows Claude Code re-reading the list on an open `tools/call`.
