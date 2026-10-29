---
id: 01a12c2b-1a11-7860-acb2-2caad63511e6
title: "Claude Code: an MCP tool disclosed mid-turn reaches the model a step later if the call replies before the repeated tools/list; toolAliases executes the bare name — probe 2026-10-11"
ord: 3
tags: ["research"]
fields:
  {
    "source": {
      "name": "Live Agent SDK probes and reading of Claude Code transcripts and bundle: tools/list_changed mid-call, toolAliases, query opening cost",
      "ref": "@anthropic-ai/claude-agent-sdk 0.3.292, CLI 2.1.296, Bun 1.4, claude-haiku-4-5; 2026-10-11; scratch 01a12bcd…/probe.ts, alias.ts, open.ts, live.ts"
    }
  }
edges:
  - kind: discovered-from
    to: 01a12c17-6a44-7b9d-8339-97fdddaf4476
---
Live runs of 2026-10-11: SDK 0.3.292 under Bun, `claude` 2.1.296, Haiku 4.5. Options as the runner's: `tools: []`, `strictMcpConfig`, `settingSources: []`, own `systemPrompt`, `bypassPermissions`, in-process `tagma` MCP server (`type: 'sdk'`, the same `mcpToolServer` as `Bridge`). Scripts `probe.ts`, `alias.ts`, `open.ts`, `live.ts` lie in the 01a12bcd-fa98-7c9a-a083-30b5c1197afd thread scratch and leave with the thread. Additionally read: Claude Code transcripts of three real hosted threads and the 2.1.296 bundle (`rg -a` over the binary).

## When Claude Code learns of a new tool

Scenario: the `tool_search` call adds the `late_tool` tool to the server list (`count: integer`, `labels: string[]`, `strict: boolean`) and sends `notifications/tools/list_changed`; the model calls `late_tool` on the next step.

| Variant | Runs | Outcome |
|---|---|---|
| Reply right after the notification | 3 | 3 of 3 broken: two calls with string arguments (`"count":"3"`, `"labels":"[\"a\", \"b\"]"`), one by bare name `late_tool` with "No such tool available" refusal |
| Reply after the server got a repeated `tools/list` | 6, list of 3 tools | 6 of 6: arguments per schema |
| Same, list of 73 tools, 154 KB | 4 | 4 of 4: arguments per schema |
| Reply after `mcpServerStatus()` showed the new tool, list of 73 | 2 | 2 of 2: arguments per schema |

- A repeated `tools/list` arrives 2–8 ms after the notification, while `tools/call` is still open: Claude Code re-reads the list without waiting for the call end.
- `mcpServerStatus()` shows the new tool not right after the list request but on the second poll (11 ms from the notification, polling every 5 ms), with 3 and with 73 tools alike.
- The SDK message with the call result arrives 6–14 ms after the server reply.
- In transcripts of real hosted threads, the next request's attachments are recorded 3 ms after the `tool_search` result, and `deferred_tools_delta` with disclosed-tool definitions only after the next model message: threads 01a12bcb-df35-7d58-a66f-d1f149cdcd52 (both disclosures) and 01a12bcd-fa98-7c9a-a083-30b5c1197afd (first disclosure; the second arrived on time because a longer command ran in the same message).
- In the bundle, the `tools/list_changed` handler re-reads the list at once if the previous re-read ended; a notification arriving during re-reading waits for a delay that doubles on repeats.

## Bare name and `toolAliases`

- Without aliases, calls of `scribble` and `hidden` are refused: "No such tool available: scribble".
- With `toolAliases: { scribble: 'mcp__tagma__note', hidden: 'mcp__tagma__absent' }`, a `scribble` call reached the `note` handler of the in-process server; `hidden` refused "No such tool available: hidden" — the refusal carries the name the model wrote.
- A model shown the tool as `mcp__tagma__note` calls it by that name even when asked to "say `note`"; it writes the bare name when there is no definition or when asked directly.
- Query opening (`initializationResult`) took 1007 ms the first time and 596–629 ms the next three; a map of 260 aliases did not change the time.

## `CLAUDE_AGENT_SDK_MCP_NO_PREFIX`

The env variable exists in the 2.1.296 bundle and in `sdk.mjs` 0.3.292, absent from SDK types and descriptions. In the bundle it is read only for a `type: 'sdk'` server. Three `noprefix.ts` runs (one per variant), tools `read`, `bash`, `tool_search` and the disclosed `late_tool`:

- with `CLAUDE_AGENT_SDK_MCP_NO_PREFIX=1`, the `init` message names tools `bash`, `read`, `tool_search`; the model calls them by these names, calls reach handlers; the `late_tool` disclosed via `tools/list_changed` was called by bare name with arguments per schema;
- with vendor web tools (`tools: ['WebSearch', 'WebFetch']`) the list is `WebFetch`, `WebSearch`, `bash`, `read`, `tool_search`, all four calls passed;
- `mcpServerStatus()` under the variable answers the server with an empty tool list (without it — the four names);
- without the variable names are `mcp__tagma__*`.

Unverified: a session whose history records calls as `mcp__tagma__*`; parallel calls with `readOnlyHint`; joint work with `toolAliases`.

## Runner end-to-end run

Three `claudeAgent` runs with the real SDK and a scripted door after the fix: the disclosed `late_tool` was called on the next step with arguments per schema in all three; a call by bare `note` reached the door and is marked `tagma/executes: true`.

## Undetermined

- Other `claude` and SDK versions, other models; three–six runs per variant — a sample.
- Waiting for a repeated `tools/list` is waiting on the request, not on Claude Code state: that it covers a list of any size and a loaded machine is unproven. `mcpServerStatus()` polling sees the state itself, but whether it updates together with what the model request is built from is not traced through the bundle.
- The re-read backoff magnitudes in the bundle not read.
- How often the model writes the bare name with the definition in hand: in thread records, two Sonnet 5.5 calls in one thread (`bash`, `read`).
