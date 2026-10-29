---
id: 01a18925-face-7b90-b96c-2acc2f90e088
title: A plugin's components are offered as <plugin>-<name>; a collision inside one plugin refuses its install, one between plugins enabled together refuses the enabling
ord: 1
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/plugins/reader.ts
  - kind: file
    ref: apps/tagma/server/src/plugins/installs.ts
---
Skills and commands share one namespace, the `$` catalog, so a skill and a command of the same name collide; MCP servers and agents each have their own. A `.` in the plugin name is read as `-`, so `a.b` and `a-b` meet the same way, and a server whose composed name fails `MCP_SERVER_NAME_PATTERN` is listed as ignored rather than refusing the plugin. The refusal names both components, because a silently dropped or shadowed component would be invisible to the person who installed it. Between plugins the check runs when a plugin is enabled in a project, reading every other plugin enabled there: two plugins installed but never enabled together never conflict.