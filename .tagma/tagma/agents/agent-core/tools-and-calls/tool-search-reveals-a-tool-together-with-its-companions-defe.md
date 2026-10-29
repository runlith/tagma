---
id: 01a12c2b-848d-7009-9aee-1af51d85e344
title: tool_search reveals a tool together with its companions — deferred tools whose ready call its answers print
ord: 5
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a12c17-6a44-7b9d-8339-97fdddaf4476
sources:
  - kind: file
    ref: packages/agent/src/agent/AgentDeferredTools.ts
---
An answer handing the model a ready call of another tool (`search_threads` printing a `read_thread_record` call) is useless while that tool is deferred: the model executes the printed text with no definition and spends steps on a refusal and a search. So a tool declares such companions in `companions` (at a server operation — `tool.companions`), and `tool_search`, revealing a tool, names them in the same answer.

Only `tool_search` reveals: the answer of a tool itself reveals nothing, and `companions` on a direct (non-deferred) tool does nothing — a direct tool's companion must itself be direct. The cause is the native Anthropic road: a tool definition reaches the model as a `tool_reference` block inside a result, while the Claude Code form leaves only references in such an outcome (`ClaudeCodeTools.body`), so an ordinary tool's outcome cannot carry both its text and the reference. A name in `companions` that is not among the catalog's deferred tools is skipped.

One exception: `read_tool_output` is deferred, though the truncation marker in every direct tool's answer prints its call. The marker (`ToolOutput.ts`) itself says a deferred tool is revealed by `tool_search "select:read_tool_output"`, and next to it names the full-output file the file tools read. For an agent without file tools that costs one search step per truncation.
