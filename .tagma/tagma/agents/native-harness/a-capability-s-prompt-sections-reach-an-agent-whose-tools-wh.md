---
id: 01a18451-0df5-72f7-971a-214828bd9a77
title: A capability's prompt sections reach an agent whose tools whitelist removed every tool of that capability
ord: 58
tags: ["task"]
fields:
  {
    "holder": "tagma:01a18452-6509-7b8c-b506-826b689c7f9a",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a18447-5a5c-755d-a1dc-42d84d9baba3
---
`agentPrompt` (native-harness/agents/effectiveAgent.ts) includes a held capability's sections whatever the overlay's `tools` whitelist keeps, while `resolveCatalog` drops the tools the whitelist omits. An agent file with `extends: tagma` and `tools: [bash]` is therefore told to call `open_page`, `start_terminal` and other tools it does not have; only `skills` already checks the whitelist (`canLoadSkills`). Make the prompt assembly drop a capability's sections when the whitelist keeps none of that capability's tools — its tool names, source names and the operations offered under it — so the instructions and the catalog agree for every capability, not per section. Found by the review of 4d9baba3.