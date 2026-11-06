---
id: 01a1b2b9-4a52-7368-9f67-684b8b44fe8c
title: A Tagma-format hook is a tool the one hook runner calls through its plugin's caller, joined into each project's reading beside command hooks
ord: 12
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/plugins/enabled.ts
  - kind: file
    ref: apps/tagma/server/src/plugins/contract/wire/hooks.ts
  - kind: symbol
    ref: apps/tagma/server/src/plugins/contract/service/hooks.ts
    symbol: toolHook
---
The `hooks` point is held by `plugins` itself, and each entry becomes a `LoadedHook` beside the command hooks of the plugin's reading for a project, so the `plugin-hooks` rule, the matcher grammar, the answer (`PluginHookAnswer`) and `failedBlocking` serve every format once. The hook calls its tool through the contribution's caller, the supervisor's call, so `plugins` never imports `plugin-host` and each call is a demand that opens a sleeping process; the caller the process reads is `tagma {projectId, reason: 'hook'}`.

Matching happens in the server, over Tagma's own tool names with no dialect mapping: only a matching call leaves it. An answer is awaited the hook's `timeoutMs`, 10 s by default, a process start and a crash's backoff gate included; an error, a call that fails, an answer that is no hook answer, or the timeout is a failure the agent goes past, unless the hook declares `onFailure: 'block'`, which denies the call or blocks the message as a blocking command hook does.

The built hooks are kept per contribution and project: a republished manifest is a new contribution, so its hooks are built again and the old ones go with the old contribution. Only Tagma's own loop runs the rule, so a CLI's own tools never reach a hook.