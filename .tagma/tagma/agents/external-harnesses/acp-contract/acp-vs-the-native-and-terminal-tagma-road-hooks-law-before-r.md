---
id: 01a10510-f8b9-7fae-bd8a-7d7d9ff45955
title: "ACP vs the native and terminal Tagma road: hooks, law before recording, row authorship, permissions, identity — observations, read 2026-10-04"
ord: 6
tags: ["research"]
fields:
  {
    "source": {
      "name": "Tagma code: apps/tagma/server/src/external-harnesses (adapter/claudeFormat.ts, hooks/door.ts, contract/wire/hooks.ts), threads/contract/service/harness.ts; findings of the ACP readings under this module",
      "ref": "runlith HEAD 3cf7f9c654 on 2026-10-04; ACP part — per linked readings"
    }
  }
---
Reading of 2026-10-04. This is an observation, not a plan: what of what Tagma's terminal road rests on ACP gives, what it does not, and what it gives only to some agents. ACP facts come from readings [[ce4ad67e]], [[01013b02]], [[19b0dc5f]], [[378e9604]]; Tagma facts from `apps/tagma/server/src/external-harnesses` (`adapter/claudeFormat.ts`, `hooks/door.ts`, `contract/wire/hooks.ts`) and the `threads/contract/service/harness.ts` port. It was nowhere verified how Tagma would behave with ACP attached.

## What the Tagma terminal road gets from hooks

For Claude, Tagma listens to `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Stop`, `PermissionRequest`, `SessionEnd`, `PostToolUseFailure`, `StopFailure`, `Notification` (`CLAUDE_EVENTS`). Through `hooks/door.ts` they give: orientation at start and in the first prompt, law delivery on path touch (`touch_path`), judgement over the call (`judge_harness_call`) and outcome recording, recording of what was recorded into the change journal (`record_write`), following the turn stop (`stop_harness_turn`), session acceptance (`adopt_harness_session`). Each hook call proves its thread with a signed grant (`session-unproven` if unproven).

## What ACP covers

- Permissions as a decision: `session/request_permission` ↔ the `PermissionRequest` hook. A structural request, the reply from the agent's `options`, `cancelled` on cancel. Covers only what the agent itself asked about.
- Agent questions to the user: `elicitation/create` (v1 stable) ↔ question tools the terminal road parses from the screen (`asks/screen.ts`) and hooks; on the Claude adapter works when the client declares `elicitation.form`.
- Turn events and outcome: `session/update` and `stopReason` ↔ `PostToolUse`, `Stop`; plus `usage_update`, with support — `cost`.
- Resume: `session/load` / `session/resume` ↔ the terminal road's `--resume`; history is owned by the agent.
- An operator word into the running turn: on the terminal road — typing into the TUI (idea [[1254d311]] on its fragility); on ACP — `session/prompt`, but behaviour depends on the agent (Gemini cuts the running turn, Claude queues or inserts via `_session/steering`).

## What ACP does not cover, or covers not for all

1. **Hooks as a class.** ACP has no `PreToolUse`/`SessionStart`/`UserPromptSubmit` event channel from agent to client, and no "client inserts context before the call" channel. Start and first-prompt orientation would have to go into prompt content or an MCP tool. These events still happen inside the agent if the user configured their own hooks: the Claude adapter reads `settingSources: user, project, local`, and Tagma-installed hooks will run inside the ACP session too (from sources; not probed live). If the adapter process gets the thread grant in its environment, the same events arrive both from hooks and from `session/update`.
2. **Law before recording (`PreToolUse`) and law delivery on path touch.** The only refusal point in v1 is the permission request, and it arises from agent policy: on the Claude adapter in `bypassPermissions` mode there is none at all, in `acceptEdits` none for file edits; on Gemini the request has no `rawInput`. Blocking a record before disk via `fs/write_text_file` works only with an agent that uses it (Gemini when `fs` is declared); on the Claude adapter 0.85.1 and Codex adapter 2.1.1 I found no client-`fs` use by tools. In v2 `fs/*` and `terminal/*` are removed. ACP does not intercept law on read (`touch_path` on `Read`) at all.
3. **Row authorship.** The terminal road records the entry on `PostToolUse` with the file from `tool_input`. In ACP the file shows in `tool_call.locations` and in `content` of type `diff` (v1: `path`, `oldText`, `newText`; v2: structural `changes` and `patch`), but Gemini puts the diff only in the permission request; on the Claude adapter the file-change report ("agent file change report") is declared only for AIR clients (JetBrains) via `_meta` — a universal client is not offered it. The agent records to disk itself, so row authorship stays with filesystem observation or diff parsing.
4. **The "allow always" decision.** In ACP the client sees only `kind`; the agent records the rule at its side (Claude — into settings, Gemini — into policy). The Tagma judge does not keep this decision.
5. **Model choice and usage.** No uniform way (`configOptions` vs deprecated `models`/`session/set_model`); usage (`usage`, `cost`) is unstable and not everywhere (Claude and Gemini give it, others undetermined). For the `Harness.spent` port this is uneven.
6. **MCP call identity.** ACP does not hand the agent the signed grant as its own object. An agent MCP call carries no ACP `sessionId`, so the grant goes into `env` or `headers` of the MCP server itself that Tagma yields in `session/new`; one agent process serves many sessions, so the per-thread value lives only in `mcpServers` (and on the Claude adapter also in `_meta.claudeCode.options.env`). Details in [[19b0dc5f]].
7. **History replay.** After a restart, `session/load` yields a collapsed history (measured on the Claude adapter: no permission requests and no `in_progress`). The transcript Tagma owns itself (rollout) and agent replay are two sources that need not match.
8. **Stop and end.** v1 has no process-stop method; `session/close` is not everywhere (absent on Gemini, Cursor, Devin, Kimi as declared). Tagma ends the agent process itself.
9. **Agent side effects on the user environment**, found by reading: Gemini `authenticate` changes `~/.gemini/settings.json`; Devin on `initialize` raises all MCP servers from the user config; Gemini merges user MCP servers with the handed ones. The ACP process environment is not isolated from what the user configured in the CLI.
10. **Vendor policy.** Gemini CLI: entry with a personal Google account was rejected by the server on `session/new` ("This client is no longer supported…", 2026-10-04) — API key and Vertex are available.
11. **Protocol stability.** v2 cancels part of v1 (prompt reply is only an insertion acknowledgement, no `fs`/`terminal`/`set_mode`) and currently meets no agent in the matrix; v1 stays the main line, while part of what is needed lives in extensions (`_session/steering`, `_auth/status_update`, `cursor/*`, `_cognition.ai/*`, `_meta.claudeCode.*`), which are not part of the spec and are vendor-dependent.
