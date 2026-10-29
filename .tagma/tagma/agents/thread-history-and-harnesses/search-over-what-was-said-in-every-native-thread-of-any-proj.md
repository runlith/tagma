---
id: 01a14be4-2437-75af-92bd-b4285e569cc0
title: Search over what was said in every native thread of any project
ord: 11
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14bae-6720-7d62-897a-92876d791728
  - kind: relates
    to: 01a14be4-2437-75af-92bd-b427b7bf6486
sources:
  - kind: symbol
    ref: apps/tagma/server/src/threads/contract/wire/operations/search.ts
    symbol: SEARCH_OPERATIONS
---
**Value.** A decision, agreement, or found cause once spoken in a thread is found by words — with no memory of which thread it was in.

**How.** The `search_threads` operation.

**Behaviour.** Searches the operator's words, including words said into the running turn, and agents' answers, in all projects and in archived threads too; Russian and English words match their forms. A row is a thread with the last matching message and the address that opens it whole. A child's report is found in the child's thread.

**Limits.** Native threads only. Tool output, reasoning, system prompts, and keep-warm turns are not indexed; the agent's own thread is not in the results until named.
