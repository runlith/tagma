---
id: 01a10580-f219-7513-ac30-074d83ba9562
title: "Claude Agent SDK: callbacks, hooks for Tagma law and delivery, MCP with env-grant, settings and skills — reading 2026-10-04"
ord: 2
tags: ["research"]
fields:
  {
    "source": {
      "name": "Claude Agent SDK permissions/hooks/MCP/features and package types",
      "ref": "@anthropic-ai/claude-agent-sdk 0.3.284 sdk.d.ts; https://code.claude.com/docs/en/agent-sdk/{permissions,hooks,mcp,claude-code-features}; https://code.claude.com/docs/en/hooks; 2026-10-04"
    }
  }
---
Reading of 2026-10-04: Agent SDK docs, `sdk.d.ts` of package 0.3.284, Tagma terminal-road hook points. Observations below are separated from conclusions about the future transport.

## canUseTool and permission modes

The SDK has modes `default|acceptEdits|bypassPermissions|plan|dontAsk|auto`. `canUseTool` returns allow (updatedInput, updatedPermissions) or deny (message, interrupt). This is NOT a universal interceptor: evaluation goes PreToolUse hooks → deny rules → ask rules → permission mode → allow rules/the tool's own permission → canUseTool. An auto-approved call never reaches the callback; dontAsk and permissionPrompts:none skip it. Deny hooks and rules act even under bypass; ask rules/tools with requiresUserInteraction still ask. Docs: "To gate every tool call regardless of mode and rules, use a PreToolUse hook instead."

PermissionResult updates rules (allow/deny/ask), directories and mode, with destination session/userSettings/projectSettings/localSettings/cliArg. `Query.setPermissionMode()` changes the mode in a live streaming process; `setModel()` and `applyFlagSettings()` change model/settings.

## Hooks and what Tagma can carry over

Types list PreToolUse, PostToolUse, PostToolUseFailure, PostToolBatch, Notification, UserPromptSubmit, UserPromptExpansion, SessionStart/End, Stop/StopFailure, SubagentStart/Stop, Pre/PostCompact, Pre/PostModelSwitch, PermissionRequest/Denied, Setup, TeammateIdle, TaskCreated/Completed, Elicitation/Result, ConfigChange, WorktreeCreate/Remove, InstructionsLoaded, CwdChanged, FileChanged, DirectoryAdded, MessageDisplay. The callback receives session_id, transcript_path, cwd, prompt_id, tool_use_id, agent_id and AbortSignal. SDK callbacks run in the app process; file shell hooks keep working alongside when settingSources allows.

| Tagma task | SDK capability | Guarantee boundary |
| --- | --- | --- |
| Law before recording | PreToolUse: permissionDecision deny/ask/allow/defer, reason, updatedInput, additionalContext | PreToolUse covers calls regardless of mode. Law verification stays owned by Tagma; the hook passes the call and returns its verdict. |
| Row authorship | PreToolUse/PostToolUse and PostToolUseFailure correlated by tool_use_id; PostToolUse carries tool_input + tool_response | The SDK gives no universal before/after diff. Pre-record snapshot and post-reading, plus the change record, are the Tagma owner's work, as now in `external-harnesses/hooks/dispatch.ts`. Arbitrary Bash needs command observation; in a shared checkout change observation alone does not prove authorship. |
| Word delivery and acknowledgement | Streaming SDKUserMessage with uuid, `replay-user-messages` echo, UserPromptSubmit before model processing; additionalContext | A stdin record does not equal processing. Acceptance is reconciled at hook/echo entry; several messages may merge. |
| End-of-turn delivery, report | Stop: last_assistant_message, background_tasks, session_crons; output decision block/reason or additionalContext continues the turn | Stop is NOT called on user interrupt, API errors → StopFailure. result is needed as the shared total. Docs: after 8 consecutive Stop continuations the next block is ignored (CLAUDE_CODE_STOP_HOOK_BLOCK_CAP); a Stop timeout counts as no decision. |
| Explanation after a tool | PostToolUse.additionalContext, updatedToolOutput; PostToolUseFailure.additionalContext; PostToolBatch — once per batch | This is real reverse delivery of context into the model loop, not just observing the result in the UI. |

Per docs, a PreToolUse callback timeout (usually 600 s) forbids the call and gives the model a tool_result; a UserPromptSubmit callback timeout (30 s) blocks the prompt. A Stop timeout allows the stop (CLI 2.1.273+), a SessionStart timeout loses output and continues the start. This distinction matters for law and report: Stop guarantees cannot be derived from fail-closed PreToolUse.

Conclusion: the direct SDK can move Tagma's current shell-hook contract into callbacks with no `tagma hook` process per point, but the law/authorship/delivery mechanism must stay behind its Tagma contract. Enforcement cannot rest on canUseTool alone or on ACP tool_call observation alone. Details not probed live: tool recording and snapshot race, callback deadlock on a counter control request (the adapter moves such requests out of the callback), mid-turn UUID ack. The measured SessionStart/End divergence is in [[07a7739c|the SDK reading and probe]].

## MCP

`McpStdioServerConfig`: command, args, env (Record<string,string>), timeout, alwaysLoad; HTTP/SSE: URL, headers, headersHelper. This allows configuring an external `tagma mcp-serve` with the thread's signed grant in the env of a specific MCP process. In the probe the fake env reached the external process; no real grant was issued.

`createSdkMcpServer({name,tools})` + `tool(name,description,ZodSchema,handler)` creates an in-process server; through the CLI control channel the SDK routes MCP messages to the local instance. This potentially removes another bridge process, but alone does not make Tagma operations available: they must still enter through the existing contract with thread identity. The external `tagma mcp-serve` is the existing road, portable to ACP too.

`Query.mcpServerStatus`, setMcpServers, toggle, reconnect — live management. `strictMcpConfig:true` leaves only programmatically set servers/explicit agent definitions and excludes file/plugin/claude.ai sources. `mcpServers:{}` alone does not switch off user connectors.

## CLAUDE.md, settings, skills

Current docs and types: default settingSources = user/project/local (the old knowledge of SDK isolation-by-default is wrong here). [] switches these file sources off. user: ~/.claude/settings.json, CLAUDE.md, rules, skills/commands/agents; project: cwd/.claude/settings.json plus CLAUDE.md/rules up the parents, skills up to repo root and extra directories; local: settings.local.json and CLAUDE.local.md. Nested CLAUDE.md loads when the subtree is read. Skills are on per CLI defaults; `skills:'all'|string[]` filters available ones, [] switches off; there is no programmatic registration of skill texts — SKILL.md files are needed.

Managed policies, global ~/.claude.json, auto-memory and claude.ai MCP connectors do not obey settingSources:[]; for the latter there are strictMcpConfig/disableClaudeAiConnectors. In the measured init even with [] there were builtin plugins and agents, and the auto-memory path pointed at home. This is not full isolation.

`systemPrompt` takes a custom string/blocks or a claude_code preset + append. On current accounts default snapshot=true may record the prompt once and ignore a new append on resume until compaction (rollout, not on all providers); Tagma must explicitly decide when updated instructions apply. `verbatimPrompts/client_composed` prevents @path/slash expansion, but the current CLI skips the whole turn-start attachment pass — part of CLAUDE.md/skills/reminders arrives only after the first tool call (T).

Sources: [permissions](https://code.claude.com/docs/en/agent-sdk/permissions), [hooks](https://code.claude.com/docs/en/agent-sdk/hooks), [CLI hooks](https://code.claude.com/docs/en/hooks), [MCP](https://code.claude.com/docs/en/agent-sdk/mcp), [features](https://code.claude.com/docs/en/agent-sdk/claude-code-features), [authentication](https://code.claude.com/docs/en/authentication); sdk.d.ts 0.3.284 (Options 1514–2432, Query 2833–3238, Hook types 952–977 and 9437–9789); Tagma `external-harnesses/adapter/claudeFormat.ts`, `hooks/dispatch.ts`.
