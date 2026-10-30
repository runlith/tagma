---
id: 01a108e9-6003-7ee7-aec9-b4c958248ba9
title: "Cursor ACP: file edit runs without permission, shell and MCP require allow-once; project hooks never fired, CLI control run fired them"
ord: 4
tags: ["research"]
fields:
  {
    "source": {
      "name": "cursor-agent 2026.09.15-d2fe57e, ACP v1 stdio; Free/Auto; mode agent/ask/plan; CLI hooks control; 2026-10-04",
      "ref": "~/.tagma/scratch/01a10407-8719-764b-9fac-8b1d83b24de9/probes/cursor/ — tools-*.jsonl, p2-both-approved.jsonl, hooks.jsonl, hook.mjs, cli-hook-control-trusted.json, user-state/plan.md"
    }
  }
edges:
  - kind: discovered-from
    to: 01a108ce-ee39-7d2f-9573-86fc0db65596
  - kind: relates
    to: 01a1050f-fe45-7d5b-a4d9-cb5c3632e800
  - kind: relates
    to: 01a10838-8f2b-7e30-a2b0-7563adb9cd5b
---
Measured 2026-10-04 on `cursor-agent 2026.09.15-d2fe57e`, ACP v1, Auto, Free. The client declared `clientCapabilities:{}`: file/shell execution stayed with Cursor. Raw frames — `tools-agent.jsonl`, `tools-ask.jsonl`, `tools-plan.jsonl`, `p2-both-approved.jsonl`; working files — a temporary project outside the checkout.

## No measured mode judges every change

In `agent` mode the model read `fixture.txt`, replaced its contents with the built-in file tool, and ran `printf shell-ok > shell-proof.txt`. File read and edit ran without request_permission; shell required permission with the text `Not in allowlist: printf`. The diff and final files confirm a real edit, not a proposed one. The global allowlist before the probe held only `Shell(ls)`; no force/yolo/auto-review flags were passed.

In `ask` mode the model refused to change files or run commands and suggested switching to Agent; it called no tools. In `plan` mode it created a plan via `Create Plan`, `kind:"other"`, without request_permission instead of the requested edit: the file `~/.cursor/plans/Edit fixture proof-fa50af1a.plan.md` appeared. It left the target fixture/mode-proof files unchanged. ACP delivered a `session/update` notification with `sessionUpdate:"plan"`; `cursor/create_plan` was not called in this probe. The saved plan was deleted after measurement.

For the profile, `agent` is the working mode with partial permission judgement, not an approve-every-mutating-tool mode. `ask` and `plan` do not replace it for implementation. These modes do not provide a full law down to file edit; a project rule or a re-check of an already applied edit does not fix this vendor-harness gap.

## tool_call and tool_call_update shapes

`toolCallId` is a string; in the measured calls it contains a newline between `call-…` and `fc_…`, and it must not be trimmed or overridden. The start is `tool_call {toolCallId,title,kind,status:"pending",rawInput,…}`, then separate updates changing title/rawInput/locations and status `in_progress`/`completed`.

- Read: `kind:"read"`, `rawInput:{path}`, `locations:[{path}]`; completion `rawOutput:{content:"before\n"}`.
- File edit: starts `kind:"edit",title:"Edit File",rawInput:{}`; the next update adds `rawInput:{path}` and locations; completion carries `content:[{type:"diff",path,oldText:"before\n",newText:"after-file-tool\n"}]`. The new edit text arrives at completion, not in the initial rawInput.
- Shell: `kind:"execute"`, title with the command in backticks, `rawInput:{command}`; completion `rawOutput:{exitCode:0,stdout:"",stderr:""}`.
- MCP: starts `kind:"other",title:"MCP: tool",rawInput:{}`; the update gives `title:"tagma: probe_echo"` and `rawInput:{providerIdentifier:"tagma",toolName:"probe_echo",args:{text:"MCP_OK"}}`; completion `{success:true}` or `{error:"MCP server does not exist: tagma"}`. Even an MCP error was marked with status completed.

## Permission and hooks

Shell and MCP permissions arrived as JSON-RPC requests with numeric id `0`. The exact shared options: `{"optionId":"allow-once","kind":"allow_once"}`, `{"optionId":"allow-always","kind":"allow_always"}`, `{"optionId":"reject-once","kind":"reject_once"}`. Client answer: `{"outcome":{"outcome":"selected","optionId":"allow-once"}}`. The permission request's `toolCall` carries id/title/kind/status/content but no rawInput/locations. For shell, content is the allowlist-denial reason; for MCP it is the argument JSON in a text code block. For judgement, keep the already arrived rawInput of the same toolCallId, otherwise a lone permission shape does not give the full subject.

The project `.cursor/hooks.json` held a logger for sessionStart, beforeSubmitPrompt, preToolUse, postToolUse, postToolUseFailure, beforeShellExecution, beforeMCPExecution, afterShellExecution, afterFileEdit, afterAgentResponse, stop, sessionEnd. No ACP turn invoked the logger — not without a git root, not after git init, not with real file/shell/MCP tools. A control run via CLI `--trust --resume … --print --output-format json` with the same hooks.json really invoked preToolUse/postToolUse on Read and sessionEnd. `hooks.jsonl` holds only these CLI events with stub grant/token and a parent marker inherited from the CLI process. This confirms the fixture is fit; there is no way to measure hooks env delivery in ACP because the hooks never ran.

Consequence for this build's profile: hooks on ACP cannot be declared a source of touch_path and line authorship. File edit is available as a diff observation; path reads are not intercepted. A full hook loop in ACP mode is unproven.
