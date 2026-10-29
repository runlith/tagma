---
id: 01a184ca-9e8e-7a5a-8db3-c3ca57526687
title: "Page console reads at DevTools level: object previews, format specifiers, message kinds and stack traces"
ord: 13
tags: ["task"]
fields:
  {
    "holder": "tagma:01a184ca-d673-7453-b21f-1efdee8cc838",
    "status": "done"
  }
edges:
  - kind: relates
    to: 01a14c08-1c3f-7bde-a2e3-046726716824
---
Seen 2026-10-29 on a Wikipedia page through `read_page_console`: `console.log('tagma: hello from the agent', { links: 382 })` is recorded as `tagma: hello from the agent Object`. The cause is `said` in `browser/engine/capture.ts`: an argument without a by-value `value` falls back to the RemoteObject's `description`, so objects, arrays, maps, DOM nodes and errors arrive as their class name. The same capture joins arguments with spaces without applying `%s`/`%d`/`%o`/`%c`, maps `table`, `trace`, `dir`, `group`, `assert`, `count` and `timeEnd` onto plain levels, and keeps only the top call frame of a console call.

The reference is chrome-devtools-mcp (`.external/chrome-devtools-mcp`: `src/formatters/ConsoleFormatter.ts`, `RemoteObjectFormatter.ts`, `src/tools/console.ts`), which renders arguments from their previews, applies format specifiers, lists message kinds and serves one message whole with its stack (`get_console_message`).

Done when an agent reading the console sees what a person sees in DevTools for these cases, within the buffer's byte bound and without parsing on the server event loop beyond the bounded event, and a shared engine scenario proves it on the managed host.