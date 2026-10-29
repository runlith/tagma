---
id: 01a18919-94f6-740b-a54e-20e8fe6dbfb8
title: "Plugin agents are a floor of declared agents: `<plugin>-<agent>`, read from the enabled plugins at every catalog read, offered to the operator alone, born in the thread's own mode"
ord: 63
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
`makeDeclaredAgents` takes a list of `AgentPackages` floors; native-harness fills it with the apps' floor and the plugins' one, so the threads module knows neither. The plugins' floor reads `EnabledPlugins.of` each time the library is listed or a type resolved and holds nothing: disabling the plugin in the project withdraws its agents at the next read.

- An agent stands alone over the declared base with no capability list: its prompt is the plugin file's body, and the tools the format adapter mapped to Tagma names become its `tools` whitelist. A null list leaves every tool of the base; an empty list leaves none. Tools the adapter could not map are the plugin row's to list.
- A plugin author, not the operator, wrote it, so it is offered to the operator alone until `agent.offered` opens it to agents, like a project file or an app agent.
- Unlike an app agent it is born in the mode its creator or the project sets, not in `trust`: it carries no tools of its own that would make every turn ask.
- Its id wins over a `.agents` file of the same name, which goes to rejected naming the winner; the library shows it with `plugin` origin, uneditable.
- A prompt that cannot be read fails the listing with the plugin's reason instead of dropping the agent silently.