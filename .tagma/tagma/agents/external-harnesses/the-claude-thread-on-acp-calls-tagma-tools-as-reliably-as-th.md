---
id: 01a12c17-6a44-7b9d-8339-97fdddaf4476
title: "The Claude thread on ACP calls Tagma tools as reliably as the native one: a disclosed tool arrives with its schema on the next step, a handoff answer discloses its tool, a bare name executes"
ord: 65
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a12bd2-5039-76ae-bc77-a7a1a9cac318
  - kind: discovered-from
    to: 01a12bd2-5048-72e0-bc6a-427cbf80f7c1
  - kind: discovered-from
    to: 01a12bd2-5058-7b65-ada2-783fcca3d3d8
---
Three defects of the Claude Code road that the native thread does not have; all three show in the first turn of thread 01a12bcb-df35-7d58-a66f-d1f149cdcd52 and are reproduced by a live probe (SDK 0.3.292, `claude` 2.1.296, Haiku 4.5).

- **Schema a step late.** `Bridge.called` sends `tools/list_changed` and replies at once. Claude Code gathers the next request's attachments ~3 ms after the result, before it re-read the list: the model calls the disclosed tool with no definition — arguments as strings or by bare name. Probe: without waiting 3 of 3 runs broken; with waiting for a repeated `tools/list` inside the call 6 of 6 clean, the list requested in 2–8 ms with `tools/call` open.
- **Handoff answer.** `search_threads` prints a ready `read_thread_record` call, but that call is deferred and is not disclosed along with it.
- **Bare name.** Prompts and answers name tools by bare names; in the Claude Code list they are `mcp__tagma__<name>`; the native road executes a bare name, Claude Code refuses. Probe: the documented SDK option `toolAliases` executes an in-process MCP tool's bare name.

Start with `runner/claude/bridge.ts`, `packages/agent/src/agent/AgentDeferredTools.ts` and `ThreadHosting`.

Done when: a call that moved the list answers after Claude Code has shown the new list in its state; a tool result that declared a handoff discloses it on both roads; query opens with the run catalog's aliases; the runner and hosting contract tests hold this.
