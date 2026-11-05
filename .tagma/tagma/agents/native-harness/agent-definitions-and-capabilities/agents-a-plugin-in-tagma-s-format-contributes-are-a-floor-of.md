---
id: 01a12337-6301-77ae-ac03-d842871ec3c6
title: "Agents a plugin in Tagma's format contributes are a floor of declared agents: `<plugin>.<agent>`, only in projects where the plugin is enabled, always with its `plugin:<id>` capability"
ord: 1
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/native-harness/agents/declared/contributed.ts
  - kind: file
    ref: apps/tagma/server/src/threads/library/declared.ts
---
The `agents` point is declared by native-harness, because it owns both the capability definitions and agent-file parsing; `makeDeclaredAgents` receives the floor through the `AgentPackages` port, beside the built-in floor and the floor of plugins in other formats, and knows nothing of plugins.

- Registration on every process generation: each agent's file is read and parsed like `.agents`, under the `<plugin>.<agent>` id; then the `plugin:<id>` capability and its tool source are registered (`own` from the thread project's `PluginTools.of`). An error in any file refuses the whole contribution, and the plugin's process row shows the reason.
- The file must list capabilities, and `plugin:<id>` is appended to them. It cannot be added through `extends` without a list: an overlay only narrows, so the agent would get the whole base and none of its own tools. An empty list yields an agent with no standard Tagma tools — only its own plugin's tools.
- A file in `.agents` cannot name `plugin:<id>`: such capabilities are not among the known at parse time. So `own` tools go only to the plugin's own agents.
- Visibility repeats the tool rule: the agents are offered and resolved where the plugin is enabled. They are not offered to an agent by default, as with a project file; to the operator and external callers they are. On an id clash the plugin's agent wins over a `.agents` file, which goes to rejected with the winner's path; the agent library shows it with `plugin` origin, uneditable — the same definition that runs.
- Its thread is born in `trust` mode and as a root, unless the creator named the mode itself, and as another thread's child instead of the parent's authority: otherwise every turn with a `mutates` tool would ask the operator.
