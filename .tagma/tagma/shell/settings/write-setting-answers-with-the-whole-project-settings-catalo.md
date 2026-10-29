---
id: 01a155cd-14d5-71af-ad03-e34163202d5b
title: write_setting answers with the whole project settings catalogue instead of the written key
ord: 9
tags: ["reflection"]
fields:
  {
    "actual": "The answer is the whole law-lab settings catalogue, every section from Writing to Browser, about 30 thousand characters, with the written key standing somewhere in the middle",
    "command": "write_setting(key=\"rules.global.enabled\", project=\"law-lab\", value=false)",
    "expected": "The answer names the key's new effective value and the project, as the operation's description promises"
  }
---
Filed from project `runlith`.

The `write_setting` description: "Returns its new effective value and the project written". In fact the answer prints the project's full `read_settings`, including the long `terminal.colorOverrides`, `threads.harnessProfile`, and `agent.models` schemas, eating the thread's context on every single-setting write.
