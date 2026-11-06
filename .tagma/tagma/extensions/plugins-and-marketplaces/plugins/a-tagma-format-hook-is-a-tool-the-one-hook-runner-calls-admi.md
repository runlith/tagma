---
id: 01a1b2b9-4a52-7368-9f67-684b8b44fe8c
title: A Tagma-format hook is a tool the one hook runner calls admitted in its plugin's generation, indexed per project beside command hooks
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
The `hooks` point is held by `plugins` itself, and each entry becomes a `LoadedHook` beside the command hooks of the plugin's reading for a project, so the `plugin-hooks` rule, the matcher grammar, the answer (`PluginHookAnswer`) and `failedBlocking` serve every format once. The event a hook receives and the answer it gives are declared once: `HookCall` and `HookInput` in `@runlith/tagma/plugin/protocol`, the answer per point in `HookVerdicts`, which the SDK takes from its generated points. The hook calls its tool through the contribution's caller, the supervisor's, so `plugins` never imports `plugin-host` and each call is a demand that opens a sleeping process; the caller the process reads is `tagma {projectId, reason: 'hook'}`.

The call is admitted inside the process generation that runs it (`callAdmitted`): the contribution must still be the one the hook was built from and the plugin must still run in the project. A hook withdrawn while its call waited answers nothing, as if it had not matched, so a restart never runs a call under the old manifest.

Matching happens in the server, over the names of the tools Tagma's agent calls — its MCP and plugin tools included — with no dialect mapping: only a matching call leaves it. An answer is awaited the hook's `timeoutMs`, 10 s by default, a process start and a crash's backoff gate included; the call hands that limit to the MCP session, whose own request timeout would otherwise cut a longer hook. The answer is the tool's structured content decoded against its point's verdict, an unknown key refused. An error, a call that fails, a missing or undecodable answer, or the timeout is a failure the agent goes past, unless the hook declares `onFailure: 'block'`, which denies the call or blocks the message as a blocking command hook does.

`EnabledPlugins.hooks(projectId)` is the rule's index: per project and plugin it keeps the command hooks bound for the plugin's current reading until a settings pulse, and the tool hooks per contribution and project, so a republished manifest is a new contribution whose hooks are built again while the old ones go with the old contribution. `EnabledPlugins.of` answers the plugin's reading alone. Only Tagma's own loop runs the rule, so a CLI's own tools never reach a hook.
