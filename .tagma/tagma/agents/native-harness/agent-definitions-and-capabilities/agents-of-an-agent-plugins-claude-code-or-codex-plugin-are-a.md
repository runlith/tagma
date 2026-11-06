---
id: 01a18919-94f6-740b-a54e-20e8fe6dbfb8
title: "Agents of an Agent Plugins, Claude Code or Codex plugin are a floor of declared agents: `<plugin>-<agent>`, read from the enabled plugins at every catalog read, offered to the operator alone, born in the thread's own mode"
ord: 2
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a12337-6301-77ae-ac03-d842871ec3c6
  - kind: relates
    to: 01a146c4-b3fa-70f5-8ced-fd1a25dba577
sources:
  - kind: file
    ref: apps/tagma/server/src/native-harness/agents/declared/plugins.ts
  - kind: file
    ref: apps/tagma/server/src/threads/library/declared.ts
---
`makeDeclaredAgents` takes a list of `AgentPackages` floors; native-harness fills it with the built-in floor, the floor of plugins in Tagma's format and this one, so the threads module knows none of them. This floor reads `EnabledPlugins.of` each time the library is listed or a type resolved and holds nothing: disabling the plugin in the project withdraws its agents at the next read.

- An agent stands alone over the declared base with no capability list: its prompt is the plugin file's body, and the tools the format adapter mapped to Tagma names become its `tools` whitelist. A null list leaves every tool of the base; an empty list leaves none. Tools the adapter could not map are the plugin row's to list. Mapped names no held capability offers are not refused: the allowlist check judges only definitions that list `capabilities`.
- A plugin author, not the operator, wrote it, so it is offered to the operator alone until `agent.offered` opens it to agents, like a project file or an agent of a plugin in Tagma's format.
- Unlike an agent of a plugin in Tagma's format it is born in the mode its creator or the project sets, not in `trust`: it carries no tools of its own that would make every turn ask.
- Its id wins over a `.agents` file of the same name, which goes to rejected naming the winner; the library shows it with `plugin` origin, uneditable.
- Floors are ordered built-in first, then plugins in Tagma's format, then this one, and the earlier floor wins an id both name, the same way in the library and at birth; the later file goes to rejected naming the winner.
- A prompt that cannot be read fails the listing with the plugin's reason instead of dropping the agent silently.
