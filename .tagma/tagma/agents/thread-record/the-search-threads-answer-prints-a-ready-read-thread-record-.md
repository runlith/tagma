---
id: 01a12bd2-5058-7b65-ada2-783fcca3d3d8
title: The search_threads answer prints a ready read_thread_record call, but that tool is deferred and not revealed with search_threads
ord: 15
tags: ["reflection"]
fields:
  {
    "actual": "The model called read_thread_record as printed and got 'No such tool available: mcp__tagma__read_thread_record'; another step went to tool_search",
    "command": "search_threads {\"query\":\"синтетика\",\"projects\":\"all\",\"limit\":30} after tool_search select:search_threads,list_threads,read_thread",
    "expected": "A call the answer prints as the next step is executable: revealing search_threads also reveals the tool its answer hands the address to"
  }
---
Filed from project `runlith`.

Thread 01a12bcb-df35-7d58-a66f-d1f49cdcd52, records #23 (search_threads answer with the line `read_thread_record(threadId=…, at=[{ at: "…" }], conversation=true, around=3, project="5")`), #30 (refusal), #35 (tool_search select:read_thread_record).

The line printed by `apps/tagma/server/src/threads/voice/threadText.ts:78`; the search_threads description also names read_thread_record as the only way to open a find. The mechanism by which a tool's result reveals others already exists: `discoveredToolNames` in `packages/agent/src/agent/AgentDeferredTools.ts` reads the result's `toolReferences`, but fills it only for tool_search (`ModelRequests.callMessages`).

On the native road an unrevealed call gets `unrevealedCallNote` with an exit; on the Claude Code road Claude Code itself refuses, without an exit.
