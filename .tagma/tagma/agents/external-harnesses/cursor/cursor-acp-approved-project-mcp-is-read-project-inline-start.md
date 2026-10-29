---
id: 01a108e9-6003-7ee7-aec9-b4c87927c9e0
title: "Cursor ACP: approved project MCP is read, project + inline start the server twice; grant arrives via explicit env or project env references"
ord: 3
tags: ["research"]
fields:
  {
    "source": {
      "name": "cursor-agent 2026.09.15-d2fe57e, ACP v1 stdio, macOS arm64, Node 26.8.1; Free/Auto; live probe of 2026-10-04",
      "ref": "~/.tagma/scratch/01a10407-8719-764b-9fac-8b1d83b24de9/probes/cursor/ — client.mjs, mcp.mjs, p2-*.jsonl, mcp.jsonl, *-approval.txt, user-state"
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
Measured 2026-10-04 on `cursor-agent 2026.09.15-d2fe57e`, ACP v1 over stdio, macOS arm64, Node 26.8.1, saved user login, Free plan, Auto model. The project was a temporary `acp-cursor.qepD0B/mcp`; the `tagma` server was a custom stdio MCP echo server with no live Tagma grant issued to it. Scripts `client.mjs`, `mcp.mjs`, raw frames `p2-*.jsonl`, and the launch log `mcp.jsonl` are kept in the `source.ref` directory.

## Project declaration and approval

The project `.cursor/mcp.json` is read in ACP. `session/new {cwd,mcpServers:[]}` started the server and the model called `probe_echo`, returning `project-marker`, when the exact declaration had been pre-approved by `agent mcp enable tagma` from that project (`p2-preenabled.jsonl`, PID 70347 in `mcp.jsonl:11–15`). The server received `initialize`, `notifications/initialized`, `tools/list` before the prompt.

An unapproved project server does not start. The model could attempt to call a nonexistent tool but received `rawOutput.error: "MCP server does not exist: tagma"` (`p2-project.jsonl`). Approval is stored in `~/.cursor/projects/<project>/mcp-approvals.json` as an identifier with a config hash. Changing `env.PROBE_SOURCE` between approval and launch made the old approval insufficient: that is why the early `p2-approved` probe with `--approve-mcps --trust acp` also failed to start the server. Repeating approval after writing the final declaration fixed it; the missing server in the early probe does not prove ACP ignores the project config.

## Two declarations start two processes

With an approved project `tagma` and a same-named server in `session/new.mcpServers`, both started: project PID 72732 and inline PID 72810 (`p2-both-approved.jsonl`, `mcp.jsonl:16–24`). Both passed MCP initialize and tools/list; the real tools/call went to inline, and the model answered `inline-marker`. With an unapproved project only inline started in the early probe, which is no proof of deduplication. The profile must pick one server declaration, otherwise the server name does not protect against a double launch.

## Environment and call resolution

No plain inheritance of arbitrary ACP-process env by MCP children was observed: the stub `TAGMA_SESSION_GRANT`, `SESSION_TOKEN`, and `PROBE_INHERITED` set on the process were absent in project and inline children; the explicitly declared `PROBE_MCP_ENV` arrived. Inline `mcpServers[].env` with explicit stub grant/token delivered them (`p2-explicit`, PID 23655).

Project env references also work: `env: {"TAGMA_SESSION_GRANT":"${env:TAGMA_SESSION_GRANT}","SESSION_TOKEN":"${env:SESSION_TOKEN}","PROBE_INHERITED":"${env:PROBE_INHERITED}"}` in the approved `.cursor/mcp.json` delivered values from the ACP process environment (`p2-project-env`, PID 90179, `mcp.jsonl:25`). That check ended at session/new without a prompt. Consequence for the profile: an approved project `tagma` can be used with an empty mcpServers, but the needed variables should be declared as env references; the parent environment alone is not enough.

Every real `probe_echo` required `session/request_permission` even with `annotations.readOnlyHint:true`. Options: `allow-once` / `allow_once`, `allow-always` / `allow_always`, `reject-once` / `reject_once`. Only allow-once was picked. The MCP call has `kind:"other"`; the profile cannot treat that kind as non-mutating without knowing the tool. Its final `rawOutput` holds only `{success:true}`, while the echo answer is visible to the model and its message; the full MCP result is absent from the ACP update. Call and permission shapes are recorded separately.
