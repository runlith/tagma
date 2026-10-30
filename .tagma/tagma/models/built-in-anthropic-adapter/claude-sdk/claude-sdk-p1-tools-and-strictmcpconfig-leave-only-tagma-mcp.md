---
id: 01a108ea-e229-7928-8a57-7c64e23e83c7
title: "Claude SDK P1: tools [] and strictMcpConfig leave only Tagma MCP with env-grant, settingSources [] does not load hooks, CLAUDE.md and skills"
ord: 5
tags: ["research"]
fields:
  {
    "source": {
      "name": "Live Claude Agent SDK probe under Bun: tools, disallowedTools, strictMcpConfig, settingSources options with positive control",
      "ref": "@anthropic-ai/claude-agent-sdk 0.3.284, CLI 2.1.289, Bun 1.4.2, claude-haiku-4-5; 2026-10-04; ~/.tagma/scratch/01a10407-8719-764b-9fac-8b1d83b24de9/probes/claude/ (p1-main.mjs, p1-controls.mjs, mcp-echo.mjs, tagma-mcp.log)"
    }
  }
edges:
  - kind: relates
    to: 01a10838-8f2b-7e30-a2b0-7563adb9cd5b
---
Probe P1, 2026-10-04: SDK 0.3.284, `claude` 2.1.289, Bun 1.4.2, `claude-haiku-4-5`. Probe files — `~/.tagma/scratch/01a10407-8719-764b-9fac-8b1d83b24de9/probes/claude/` (`p1-main.mjs`, `p1-controls.mjs`, `mcp-echo.mjs`, `tagma-mcp.log`).

Temp project: `.claude/settings.json` with `SessionStart` and `UserPromptSubmit` hooks appending a row to a file; `CLAUDE.md` with the `CLAUDEMD-MARKER-7391` mark; a `probe-skill` skill; `.mcp.json` with a second stdio server `projmcp`. Own stdio MCP server (`node`, two tools: `whoami`, `slow`) received a fake `TAGMA_GRANT=fake-grant-xyz`.

## Only Tagma tools: `tools: []` + MCP

With `tools: []`, `strictMcpConfig: true`, `mcpServers: {tagma: …}`, `permissionMode: 'bypassPermissions'` (+ `allowDangerouslySkipPermissions`):

- `system/init.tools` — `["mcp__tagma__slow","mcp__tagma__whoami"]`; the API request's `tools` array — the same two. No Claude Code built-ins.
- The stdio server `env` arrived: server log `TAGMA_GRANT=fake-grant-xyz`, server cwd is the session cwd. The server launched once per query; request sequence: `server/discover`, `initialize`, `notifications/initialized`, `tools/list`, then `tools/call` with `_meta.claudecode/toolUseId` and `progressToken`. The server must answer the unexpected `server/discover` (mine answered with an empty result), otherwise behaviour unmeasured.
- An MCP call in `bypassPermissions` passed with no permission request; the model returned the tool output verbatim.
- `init.skills` and `slash_commands` still hold Claude Code built-ins (`deep-research`, `design`, `compact`…), and `init.plugins` — three builtin plugins; without the `Skill` tool the model does not call them, they did not enter the prompt.

**`disallowedTools` instead of `tools: []` is fragile.** With a list of 21 built-in tool names (`Task`, `Agent`, `Bash`, `Read`, `Edit`, `Write`, `WebFetch`, `Skill`, `ToolSearch`…) and default `tools`, `CronCreate/Delete/List`, `DesignSync`, `EnterWorktree`, `ExitWorktree`, `ListAgents`, `Monitor`, `PushNotification`, `RemoteTrigger`, `ReportFindings`, `ScheduleWakeup`, `SendMessage`, `TaskCreate/Get/List/Update`, `Workflow` remained; the turn cost 0.0478 USD vs 0.003–0.005 with `tools: []`. The built-in tool set grows across versions, so for the profile — only `tools: []`.

## `strictMcpConfig`

Fixed `settingSources: ['project']`:

- `strictMcpConfig: true` — only `tagma` raised; `projmcp` from `.mcp.json` did not start (no log created).
- `strictMcpConfig: false` — `projmcp` (source `project`) **and the account `claude.ai Claude Docs` connector** (source `claudeai`, 8 tools) raised. So `strictMcpConfig` cuts off even account claude.ai MCPs, not just file ones.

## `settingSources: []`

Positive control: `settingSources: ['project']` — both file hooks fired (`SessionStart` and `UserPromptSubmit` recorded rows), the model answered with the `CLAUDE.md` mark, `probe-skill` appeared in `init.skills`. With `settingSources: []` (main run): the hooks file empty, the model answered `NONE` to the `MARKER`-words question, the project skill not in `init.skills`, `projmcp` did not start, the user `~/.claude/CLAUDE.md` content not in the prompt, user skills (`ag-arch` etc.) not in `init.skills`. User hooks from `~/.claude/settings.json` (Tagma hooks stand there) not observed in this turn; no separate check that they did not fire, but the `user` source was not enabled.

Divergence from [[07a7739c]]: there the SDK-callback `SessionStart` did not fire; the **file** `SessionStart` under SDK fires (with `project` on). For the runner this does not matter: decision 2 does not rest on hooks.

Profile conclusion: `tools: []` + `strictMcpConfig: true` + `settingSources: []` + `mcpServers` with the grant in `env` give the agent only Tagma tools; the call passes with no permission request under `bypassPermissions`. Unverified on a real `tagma mcp-serve`: tool catalog completeness and attributing the call to the thread grant.
