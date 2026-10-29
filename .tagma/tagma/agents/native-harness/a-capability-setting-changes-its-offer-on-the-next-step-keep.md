---
id: 01a16477-6565-70f7-a2e4-f3faff94d8f9
title: A capability setting changes its offer on the next step, keeping it in the definition grant
ord: 27
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/cli/verbs/mcpServe.ts
  - kind: file
    ref: apps/tagma/server/src/native-harness/capabilities/availability.ts
  - kind: file
    ref: apps/tagma/server/src/native-harness/capabilities/operations.ts
  - kind: file
    ref: apps/tagma/server/src/platform/contract/wire/capability.ts
---
A disabled capability keeps its registration and its place in the grant: otherwise enabling it mid-run could not bring its tools back. Declaring a capability binds it to a boolean setting, and the capabilities owner reads the project and operator layers and changes the catalog revision only when the effective set changes. The native loop and the hosted door reassemble the catalog before a step regardless of whether a context change is allowed — including after a text answer the operator's new words continued — and tell the agent which tools appeared or vanished; an idle thread gets nothing until its next run. The MCP bridge holds its read of the shared capabilities state until a change, but the server holds it no longer than `CHANGE_WAIT_MS` (30 s) and answers the read as is; the bridge sends `tools/list_changed` only on a new revision. The limit exists because the Bun fetch drops a request silent past the idle timeout (5 minutes), and a bridge whose read failed exited together with the CLI MCP server. Server silence is a restart; the bridge waits out a broken connection like the hosted runner: it asks again every second and keeps serving; the first read at bridge start refuses at once. Both shapes of its catalog hide the disabled. Hiding never replaces an operation refusal: the capability owner refuses the race and a direct CLI call before its resource starts.
