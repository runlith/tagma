---
id: 01a1b19b-900d-77ee-a46b-0c7f37ab59fb
title: A plugin's actions and shortcuts are proposals listed machine-wide in installed order, and an action runs admitted inside its generation
ord: 9
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/views/actions.ts
  - kind: file
    ref: apps/tagma/server/src/plugins/installs.ts
---
`actions` and `shortcuts` give the window what it needs to bind a plugin's keys, and the server decides none of it: a chord is a proposal, never a claim, so `shortcuts` refuses only an unknown name and a chord listed twice in the plugin, and a proposal never refuses a whole plugin. `global` is a request; the person allows it, not the plugin.

`views.actions` is machine-wide and lists every plugin published in at least one project, from its manifest: a plugin whose process never ran is listed, and the feed wakes no process. Its `rank` is the plugin's index in `plugins.installed`, because among plugins the one installed earlier keeps a contested chord; that is why an update of an installed plugin writes it in place there and only a new install appends. A section or pane of the plugin is listed beside its actions as `section:<view>` or `pane:<view>`, with the view it opens and the chords proposed for it; the window opens it, and `run_plugin_action` refuses it as an unknown action. The window keys every plugin act as `plugin.<plugin>.<act>` and a launcher as `plugin.<plugin>.window:<view>`: an action's name holds no colon, so no two acts of one plugin share a window id.

A plugin's `commands` ride the same feed, in its set beside its actions, because a command is text or an action and the composer needs both from one place; `commands` belongs to `views` with `actions` because its check — an `action` naming an id of `actions` — reads that sibling point, which `plugins` below `views` could not import. The window shows a command only in threads of projects the set's `projects` names.

`run_plugin_action` is admitted inside the process generation that runs it, as `call_plugin_tool` is: the plugin must still run in the project and the action must still name the same tool, so a call that waited through a restart cannot run under the old manifest. The process receives the caller `operator {projectId, view: 'action:<id>'}` and the input `{threadId, args}` — the composer's thread and the words typed after the command, `null` and `''` from the palette or a key — and the handler's text becomes `said`; a handler that throws refuses `plugin-call-failed` with its reason, so a key never fails in silence.
