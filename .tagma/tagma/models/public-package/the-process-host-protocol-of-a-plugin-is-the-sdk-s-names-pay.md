---
id: 01a1ae0e-7534-7654-b29d-fd6cb99544e3
title: "The process ↔ host protocol of a plugin is the SDK's: names, payloads and handler tools stand in @runlith/tagma/plugin/protocol"
ord: 2
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/tagma/src/plugin/protocol.ts
  - kind: file
    ref: packages/tagma/src/plugin/serving.ts
  - kind: file
    ref: packages/tagma/src/plugin/process.ts
---
Spec 5067fa15 gives the SDK the protocol between a plugin's process and the host. The SDK is also the lower module, so the shared names stand in `@runlith/tagma/plugin/protocol`, and `plugin-host` and the point owners import them rather than declaring their own. The shared names are:
- the environment variables a process is started with;
- the `_meta` key carrying the projects where the plugin is enabled;
- the payloads of the calls Tagma makes: tick, ending, notification answer, build step;
- the build step's verdict.

The caller stays `@runlith/mcp`'s `McpCaller`, under `runlith/caller`, which Tagma's other MCP clients share.

**Handler tools.** Each handler a definition carries becomes a tool with audience `tagma`, under a name starting with `__`:
- `__schedule_<name>` for each schedule;
- `__build_<name>` for each build step;
- `__ended` for the thread-ending handler;
- `__notification` for the notification handler.

The points name these tools, and the host treats them like any other tool. An author's tool may not start with `__`, so the two never collide. A build step answers its verdict as JSON text. Every other handler answers nothing, and only `isError` tells the host to deliver again.

**What the runtime does that a hand-written process had to.**
- It answers every failure as `isError`, a thrown `Refusal` with its reason, so a handler's error never becomes a protocol fault.
- It sends `console.log` to stderr, so a stray log cannot corrupt stdout.
- It exits when stdin ends.
- It gives `ctx.data` per project, `projects/<id>` under `TAGMA_PLUGIN_DATA`, or `machine` for a call with no project. One process serves every project, and its data would otherwise mix them.