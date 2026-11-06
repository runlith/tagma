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
- the payloads of the calls Tagma makes: tick, ending, question, notification answer, build step, action, and a hook's event per point (`HookCall`, with the thread and place as `HookInput`);
- the reason each of those calls names in its caller (`TAGMA_REASONS`), which the host sends and an author's handler reads.

The build step's verdict and a hook's answer travel the other way, so the server owns them: each point's face names its answer schema, and the generator prints those beside the point types into `/plugin/points` — `BuildVerdict` from checkout-builds' `StepVerdict`, `HookVerdicts` from plugins' per-point verdicts, the schemas the server decodes them with.

The caller stays `@runlith/mcp`'s `McpCaller`, under `runlith/caller`, which Tagma's other MCP clients share.

**Handler tools.** Each handler a definition carries becomes a tool with audience `tagma`, under a name starting with `__`:
- `__schedule_<name>` for each schedule;
- `__build_<name>` for each build step;
- `__action_<name>` for each action;
- `__hook_<name>` for each hook;
- `__ended` for the thread-ending handler;
- `__asked` for the thread-question handler;
- `__notification` for the notification handler.

The points name these tools, and the host treats them like any other tool. An author's tool may not start with `__`, so the two never collide. A build step answers its verdict as JSON text. A hook answers its verdict as structured content, as the author returned it; an error, an answer that is not its point's verdict, or no answer within its timeout is a failure the runner passes over unless the hook blocks on failure. An action receives its words as `{args}` and the composer's thread in its caller, and answers nothing or text the person sees as a notice, or as the draft from a command; its `isError` makes `run_plugin_action` refuse `plugin-call-failed` with the handler's reason, and the action is not run again. The question handler answers nothing to take the question, or `ASKED_LEFT` (`leave()`) to hand it to the person; there `isError` also hands it to the person, for good, and is never delivered again. The schedule, ending and notification handlers answer nothing, and only `isError` tells the host to deliver again.

**An author's tool answers its value unambiguously.** `value.ts` (`@runlith/tagma/plugin/value`) holds the pair that encodes and decodes it, so the host, the view client and the tool card read what a tool returned the same way:
- a string is the answer's text alone, readable as it is to an agent;
- nothing is empty text with empty structured content;
- any other value is its JSON as text and the value itself as `structuredContent.value`.

The decoder takes the answer's text and structured content and gives back the authored value; it never parses the text, so a string such as `'123'`, `'false'` or `'[{"id":1}]'` stays a string. Handler tools do not use it: the host reads their answers, a hook's verdict and the question handler's `ASKED_LEFT` among them, as their own structured content. The thread record keeps a tool answer as its text, or `{text, structuredContent}` when structured content stands, so the card decodes the same two parts.

**What the runtime does that a hand-written process had to.**
- It answers every failure as `isError`, a thrown `Refusal` with its reason, so a handler's error never becomes a protocol fault.
- `stdio.ts`, the first module the process evaluates, sends `console.log` and writes to `process.stdout` to stderr and keeps the original stdout for the protocol alone. So nothing printed while the plugin's modules load reaches the stream; the build's entry imports the runtime before `plugin.ts` for this.
- It exits when stdin ends.
- It gives `ctx.data` per project, `projects/<id>` under `TAGMA_PLUGIN_DATA`, or `machine` for a call with no project. One process serves every project, and its data would otherwise mix them.