---
id: 01a14bc0-7666-742a-8ab8-660175f9fb06
title: "A long tool answer is saved whole: the model sees part of it with an address and finishes it with read_tool_output or file tools"
ord: 5
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14bc0-7660-7057-8507-468f3ccccf91
  - kind: relates
    to: 01a14bc0-766c-7277-8b8e-47f50363c0ef
  - kind: relates
    to: 01a14bc0-7671-7bdb-92a9-e696a4e069a4
  - kind: relates
    to: 01a14bc0-767b-73c0-89c8-7ffb0a4dca9c
sources:
  - kind: file
    ref: apps/tagma/server/src/native-harness/resources/toolOutputs.ts
  - kind: file
    ref: apps/tagma/server/src/native-harness/tools/outputStore.ts
  - kind: file
    ref: packages/agent-tools/src/removal/report.ts
  - kind: file
    ref: packages/agent/src/agent/ToolOutput.ts
  - kind: symbol
    ref: packages/agent/src/agent/tool.ts
    symbol: ToolOutputSource
---
**Value.** A huge tool answer neither clogs the agent's context nor is lost: the model sees part of it with an address and reads the rest on through it.

**How.** By itself, on an answer over the output limit; the agent's `read_tool_output` tool (deferred) or ordinary file tools.

**Behaviour.** The model gets the head or tail of the answer — as the tool declared — with a marker: output id, full size, file path, and how to read on. `read_tool_output` gives a slice from a set offset; the file lies in the thread's folder, and `read`/`grep` work on it directly. A too-large JSON result also lands in a file, and the feed shows a preview.

A tool can accumulate a large answer straight into a file and hand it to the store without assembling all contents in memory. The copy lands in the thread's folder and reads through the same `read_tool_output`, including the result of a cancelled call. The producer frees the source file after writing the outcome only when the store confirmed its own copy; when saving fails the source file stays at the receipt's address.

**Limits.** The folder is a thread resource: deleting the thread or unloading it from the database erases the folder, and old addresses stop reading. A fork gets the same files.
