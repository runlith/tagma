---
id: 01a12337-6301-77ae-ac03-d842871ec3c6
title: "App agents are the third floor of declared agents: `<app>.<agent>`, only in projects where the app is enabled, always with its `app:<id>` capability"
ord: 6
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/native-harness/agents/declared/tagmaApps.ts
  - kind: file
    ref: apps/tagma/server/src/threads/library/declared.ts
---
The `agents` point is declared by native-harness, because it owns both the capability definitions and agent-file parsing; `declaredAgents` receives the floor through the `AgentPackages` port, beside the plugins' floor, and knows nothing of apps.

- Registration on every process generation: each agent's file is read and parsed like `.agents`, under the `<app>.<agent>` id; then the `app:<id>` capability and its tool source are registered (`own` from the thread project's `TagmaAppTools.of`). An error in any file refuses the whole contribution, and the app row shows the reason.
- An app agent file must list capabilities, and `app:<id>` is appended to them. It cannot be added through `extends` without a list: an overlay only narrows, so the agent would get the whole base and none of its own tools. An empty list yields an agent with no standard Tagma tools — only its own app's tools.
- A file in `.agents` cannot name `app:<id>`: such capabilities are not among the known at parse time. So `own` tools go only to the app's own agents.
- Visibility repeats the tool rule: agents are offered and resolved where the app is enabled (`apps.enabled`). They are not offered to an agent of that type by default, as with a project file; to the operator and external callers they are. On an id clash the app agent wins, and the file goes to rejected with the winner's path; the agent library shows the app agent with `app` origin, uneditable — the same definition that runs.
- An app-agent thread is born in `trust` mode (`ThreadTypeOffer.approvalMode`) and as a root, unless the creator named the mode itself, and as another thread's child instead of the parent's authority: otherwise every turn with a `mutates` tool would ask the operator.
