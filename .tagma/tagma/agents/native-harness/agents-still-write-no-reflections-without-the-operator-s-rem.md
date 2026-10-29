---
id: 01a127d9-d50c-7f1a-bc46-2c4e59034e64
title: "Agents still write no reflections without the operator's reminder: the reflection prompt text has not changed since 2026-09-25"
ord: 60
tags: ["reflection"]
fields:
  {
    "actual": "3c841c4c 15 days unanswered; graphWriting.ts lines 24–27 — the same classification with no trigger, under the paragraph 'a graph write is authorized only by the act naming it'; refusals.ts on failure says 'tell the operator'; file_reflection is GRAPH_ACT: deferred behind tool_search with ASKS_IN_REVIEW; the code agent (no graph capability) has neither the tool nor the reflections text",
    "command": "thread 01a127d7-73d3-7b50-a5dc-44a49a382f02, 2026-10-10: the operator asks why agents almost never write reflections and he has to remind them",
    "expected": "After 3c841c4c the doctrine names the trigger and the duty: met Tagma friction — file file_reflection yourself, in the same turn, without asking; the tool is visible at once and asks no approval"
  }
---
New causes beyond the first record, read in code on 2026-10-10:

- `apps/tagma/server/src/threads/doctrine/refusals.ts`: the only guidance on a tool failure is "follow its stated recovery contract, or tell the operator what is missing". A failure leads to the operator, not to a reflection.
- `apps/tagma/server/src/graph/contract/wire/operations/reflections.ts`: `file_reflection` is built from `GRAPH_ACT` — `tool: GRAPH_AGENT` without `direct`, so in both native and MCP it sits in the deferred list among ~200 names and needs tool_search before the first call; `approval: ASKS_IN_REVIEW` — in review mode every filing stops the turn with the operator's question.
- `apps/tagma/server/src/native-harness/agents/code/agent.ts`: the `code` agent holds no `graph` capability, and `instructionAudience` gives it 'executor' — neither the tool nor the Writing the Graph section. A performer that meets submit_work or bash friction cannot file it and does not know it must.
- `graphReading.ts` line 23 names the single trigger — "a read no door offers".

Cost: the operator spends another turn on what the instructions should make a duty.
