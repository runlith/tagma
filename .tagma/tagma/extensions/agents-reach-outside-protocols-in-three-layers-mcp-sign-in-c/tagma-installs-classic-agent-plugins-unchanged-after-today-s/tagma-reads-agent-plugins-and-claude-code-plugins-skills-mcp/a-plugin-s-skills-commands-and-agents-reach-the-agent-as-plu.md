---
id: 01a18906-5946-7cc1-afe1-26acec807ad2
title: A plugin's skills, commands and agents reach the agent as `<plugin>-<name>` in the projects that enable it
ord: 3
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: implements
    to: 01a184c6-16dd-744f-b710-46e663966472
  - kind: waits-on
    to: 01a18906-5946-7cc1-afe1-26aa0308018b
---
A skill scope `plugin` beside `global`, `project` and `built-in`; commands read as skills of the plugin, `$ARGUMENTS` taking the invoking message; agents as a floor of declared agents.