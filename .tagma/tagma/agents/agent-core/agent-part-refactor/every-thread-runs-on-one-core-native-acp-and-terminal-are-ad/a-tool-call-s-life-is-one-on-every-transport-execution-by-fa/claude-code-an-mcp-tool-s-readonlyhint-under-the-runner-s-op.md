---
id: 01a126bc-553e-7e90-b4f0-d69d00a81b23
title: "Claude Code: an MCP tool's readOnlyHint under the runner's options changes only call parallelism — 2026-10-10 probe"
ord: 5
tags: ["research"]
fields:
  {
    "source": {
      "name": "Live probes and reading the Claude Code bundle: `readOnlyHint` of an in-process MCP tool in bypassPermissions, default, and plan",
      "ref": "@anthropic-ai/claude-agent-sdk 0.3.292, CLI 2.1.296, Bun 1.4, claude-haiku-4-5; 2026-10-10; scratch 01a126a3…/probe.ts"
    }
  }
edges:
  - kind: discovered-from
    to: 01a126a2-f80a-7baf-84ad-c1ffde05c11e
---
Six live runs, 2026-10-10: SDK 0.3.292 under Bun, `claude` 2.1.296, Haiku 4.5. The runner's options: `tools: []`, `strictMcpConfig`, `settingSources: []`, its own `systemPrompt`, `autoMemoryEnabled: false`, `allowDangerouslySkipPermissions`, an in-process `tagma` MCP server (`type: 'sdk'`, the same `mcpToolServer` as the `Bridge`). Tools: `bash` sleeps 5 s, `read` answers immediately; `read` always has `readOnlyHint: true`, `bash` has `true` or `false`. The model was asked in one message to call `bash sleep 5` and three `read`s. The handler timestamped every call's entry and exit. The `probe.ts` script lives in the `01a126a3-dbf3-774c-8c3a-c64308e483d1` thread's scratch and leaves with the thread.

The `claude` 2.1.296 bundle was additionally read (`rg -a` over the binary): every place that reads a tool's `readOnlyHint` and `isReadOnly()`.

## Observations

| Mode | `readOnlyHint` on `bash` | What happened |
|---|---|---|
| `bypassPermissions` | `true` | `bash` started at 3.21 s; the reads started at 3.45, 3.70, and 3.90 s, each right after its own `tool_use` block, and finished before `bash` (8.21 s) |
| `bypassPermissions` | `false` | `bash` started at 16.26 s; the three `tool_use` reads arrived at 16.37–16.69 s, but the reads themselves started at 21.29 s — after `bash` ended |
| `default` | `true` and `false` | identical: every MCP call refused with "Claude requested permissions to use mcp__tagma__…, but you haven't granted it yet" |
| `plan` | `false` | `bash` refused with "Cannot call mcp__tagma__bash while in plan mode", reads refused for permission |
| `plan` | `true` | `bash` refused for permission, like the reads |

- A call with `readOnlyHint: true` starts executing while the model message is still being written: the first read's `tool_result` arrived before the second `tool_use` and before the message end.
- In the bundle, an MCP tool's `isConcurrencySafe()` is `readOnlyHint ?? false` (or an internal `mayOverlap` flag set only by the host's slot registry); `isReadOnly()` is `readOnlyHint ?? false`.
- Other `isReadOnly()` readers in the bundle: plan-mode permissions; the remote CCR worker (`CCRClient` puts the call gateway `mayWrite` only in a remote session) and the remote host's `ask_seat` check; the file-tool question header ("Read file" / "Edit file"), built-in only; annotations Claude Code gives the IDE about its MCP servers; telemetry fields.

## Second series: step-2 combination

Three runs with the same script, same day: `bash` and `edit` with `readOnlyHint: true` and `destructiveHint: true` — as the runner will declare them, keeping `destructiveHint` truthful. One message: `bash sleep 5`, `edit`, three `read`s.
- `bypassPermissions`: `edit` and all three reads started and finished while `bash` ran (`bash` start 5.75 s, end 11.17 s) — as with `destructiveHint: false`.
- `default`: every call refused for permission, as in the first series.
- `plan`: `bash` and `edit` refused for permission, like the reads — as in the first series with `readOnlyHint: true`.

`isDestructive()` readers in the bundle: auto-mode and remote sessions (`CLAUDE_CODE_REMOTE`, `tengu_*_auto_mode_include_*_mcp` flags), the org MCP-server policy, the tool list in the `/mcp` UI, IDE annotations. The runner's `destructiveHint` is truthful today, so step 2 does not change it.

## Conclusion

Under the runner's options (`bypassPermissions`, `settingSources: []`, no plan mode), `readOnlyHint` changes only one thing — also with `destructiveHint: true`: a call carrying it executes in parallel with the message's other calls, while without it calls run one at a time, and later calls wait. `readOnlyHint` grants no permissions: in `default` calls are refused identically. There is a difference in plan mode, where a call without it is refused outright and with it asks permission, but the runner does not enable plan mode and the session has no built-in transition into it.

## Not established

- Other `claude` and SDK versions, other models. One run per variant — one sample.
- Whether the CCR gateway is enabled anywhere locally: the bundle puts it only on the remote worker; not verified by a live probe.
- How many calls execute simultaneously: four in one message were checked.
