---
id: 01a10583-7dfd-734e-933e-e97884bfc57a
title: "Claude ACP adapter Zed 0.85.1: what it carries over from the SDK, vendor extensions, and choosing the direct SDK for Tagma control — reading and handshake 2026-10-04"
ord: 3
tags: ["research"]
fields:
  {
    "source": {
      "name": "Zed/ACP Claude Agent adapter: sources and a live initialize/session-new probe",
      "ref": "https://github.com/agentclientprotocol/claude-agent-acp.git; .external/claude-agent-acp a44c486019e98ad478c549c4902e7092f1418d0b (2026-10-02); package 0.85.1, Agent SDK 0.3.287, ACP SDK 1.7.0; CLI 2.1.289; 2026-10-04; probe/acp-frames.jsonl scratch research-claude"
    }
  }
---
Reading of 2026-10-04: `.external/claude-agent-acp`, origin `https://github.com/agentclientprotocol/claude-agent-acp.git`, commit `a44c486019e98ad478c549c4902e7092f1418d0b` (2026-10-02). The checkout already existed; fetch confirmed the same origin HEAD. Package `@agentclientprotocol/claude-agent-acp` 0.85.1, author Zed Industries, Apache-2.0; dependencies Agent SDK 0.3.287 and ACP SDK 1.7.0, Node>=22. This is the maintained Zed/ACP-community ACP adapter over the official Anthropic SDK, not a separate native ACP server inside Claude Code. The ACP registry lists Anthropic, Zed, JetBrains as authors, but the underlying SDK/binary license stays Anthropic.

## Measured without a second prompt

Package 0.85.1 installed into temp (`npm i --omit=optional`, installed CLI picked via CLAUDE_CODE_EXECUTABLE). initialize → session/new with external stdio MCP and a fake env-grant. Sent no prompt, since one allowed Claude prompt was already spent on the direct SDK.

initialize in 488 ms; new 1296 ms from start. protocolVersion=1; capabilities: image, embeddedContext, mcp http/sse, loadSession, list/resume/close/delete/fork/additionalDirectories/subagents, auth.logout, providers; `_meta.claudeCode.promptQueueing:true`, root `_meta.steering.supported:true`. AuthMethods empty because the client did not declare auth.terminal, not because the process lacks login support. On new: mode default, variants default/acceptEdits/plan/auto/bypassPermissions; config model (current opus), effort (default/low/medium/high/xhigh/max), fast on/off. User skills arrived as available_commands_update. MCP env arrived (`TAGMA_GRANT=acp-grant-456`), the server passed initialize and tools/list.

Frames `probe/acp-frames.jsonl` and script `probe/acp-probe.mjs` in scratch `~/.tagma/scratch/01a1050c-9341-77f4-9341-1ec526b94c3d/`; email in frames replaced with `<redacted>`.

## What the adapter carries over — sources

| SDK capability | ACP expression in 0.85.1 | What Tagma must know |
| --- | --- | --- |
| Text/thinking stream | agent_message_chunk / agent_thought_chunk from content_block_delta, remainder from complete assistant | API block details are normalized; signatures and the whole SDK event need not stay in standard form. |
| tool_use/tool_result | tool_call / tool_call_update, status, content, locations, diff; Claude/AIR metadata | The presentation is not before-execution interception. |
| Turn outcome | completion of the pending session/prompt with stopReason; errors in structured refusal/extensions | The adapter simultaneously runs its own Turn queues and autonomous/background cycles; full SDK semantics must be read through the vendor extension. |
| Usage/cost | usage_update, context used/size, cost; extra Claude/AIR fields | For exact accounting, full result.modelUsage is available through the raw SDK extension. |
| canUseTool | session/request_permission with once/always/reject choices, updatedInput and permission suggestions | Only calls, not Claude Code auto-approved. They cannot serve as the whole law gate. |
| AskUserQuestion/MCP elicitation | ACP elicitation, if the client declared form/url | Without form, AskUserQuestion lands in disallowedTools. |
| MCP | stdio env list→Record, http/sse, plus MCP from SDK options | `tagma mcp-serve` with a grant can be handed over via standard mcpServers; a user in-process SDK instance does not travel over JSON-RPC. |
| Model/effort/mode | configOptions + setSessionConfigOption; setSessionMode; underlying q.setModel/setPermissionMode/applyFlagSettings | The main-thread SDK `agent` is deliberately removed and is not part of the adapter contract. |
| Resume/load/list/fork/close/delete | session methods, replay history from local JSONL, forkSession with ACP messageId→UUID mapping | Resume and fork are not lost. When session-defining query options change, query is recreated; fingerprints govern this. |

The adapter creates a long-lived SDK query with AsyncIterable input, includePartialMessages:true, replay-user-messages, set model/mode, default settingSources=user/project/local and the claude_code preset. Via `_meta.claudeCode.options` it hands many serializable SDK options: env, allowed/disallowedTools, settings, plugins, systemPrompt, strictMcpConfig, skills, checkpointing, etc. But pathToClaudeCodeExecutable is overridden by the CLAUDE_CODE_EXECUTABLE variable/its bundled binary; permissionMode/includePartialMessages/cwd/canUseTool/executable belong to the adapter. `hooks`, canUseTool, sessionStore, spawnClaudeCodeProcess, abortController are functions/live objects; they cannot cross JSON-RPC. The NewSessionMeta type declares options:Options and merges hooks for programmatic library use in the same process, but the ACP JSON wire does not carry HookCallback. `options.settings` may include serializable shell hooks, and settingSources keeps existing hooks on disk. This preserves terminal Tagma hooks but gives the ACP client no synchronous hook callback.

## Streaming input is not lost, but vendor-specific

`startTurn()` puts several prompts in the queue; promptQueueing advertised. `_session/steering` inserts SDKUserMessage.priority=now into the running turn without creating a new Turn; while waiting on permission/elicitation — later. Result `injected|startedNewTurn|promptRequired` (the last with opt-in idleBehavior). now interrupts generation or backgrounds the foreground tool; the adapter waits for the result answering the steer, not the first intermediate aborted-result (`acp-agent.ts:3683–3784`). This is not standard session/prompt control, but neither is it missing mid-turn input.

`cancel()` calls q.interrupt(); ends active/queued Turns, and if the SDK is wedged — a backstop after 30 s. This is extra adapter semantics, not measured by me. `session/close` ends the query.

## Raw events and extensions

`_meta.claudeCode.emitRawSDKMessages:true|filter[]` → `_claude/sdkMessage` notification alongside regular processing. So standard-ACP event losses can be reduced with a vendor-specific extension, but such a notification cannot bring back a synchronous PreToolUse/Stop callback. AIR extensions (diff, subagents, permission presentation, goals, failures) require bilateral negotiation; Tagma does not get them automatically from shared ACP support.

Links to verified places: `src/acp-agent.ts` 1300–1489 (SDK options and raw notification), 2530–2845 (initialize/session methods), 3319–3426 (prompt), 3683–3784 (steering), 6384+ (stream mapping), 8269+ (canUseTool), 9155–9567 (MCP and query options); `src/fork-session.ts`, `src/hide-claude-auth.ts`, README and package.json. Permanent links: https://github.com/agentclientprotocol/claude-agent-acp/blob/a44c486019e98ad478c549c4902e7092f1418d0b/src/acp-agent.ts and neighbouring files.

## Choice for Claude in Tagma

The research recommendation is the direct Agent SDK for a Claude-specific official transport behind the Harness contract, keeping the ACP adapter available via the shared ACP transport. Reasons: PreToolUse/PostToolUse/UserPromptSubmit/Stop callbacks match Tagma's current tasks and allow law before recording and post-tool context without external shell hooks; full SDK events/usage and session controls arrive directly; the external MCP bridge with grant stays. ACP suits one transport implementation for many vendors, but for Claude, restoring full control would need vendor-specific raw/steering metadata and file hooks — two sides instead of one SDK API.

This is an architecture conclusion, not an implementation decision. Two open risks of the direct SDK: [[07a7739c|SessionStart/End divergence from the live SDK probe]]. [[83ba9562|the hooks, MCP and settings reading]] grounds carrying Tagma control over. Also unverified: mid-turn/interrupt/resume/fork and tool recording.
