---
id: 01a0f510-62aa-7e8f-bfda-094b6b39a0a9
title: Command-rule identifiers become broken block links in agent replies
ord: 22
tags: ["reflection"]
fields:
  {
    "actual": "The agent used block-reference markup for command rule 5004cc27; the block route shows No such block. read_command_rules confirms that rule exists with limitMs 60000.",
    "command": "write_command_rule(reach=\"project\", limitMs=60000), then open the agent's link http://127.0.0.1:5633/runlith/b/5004cc27",
    "expected": "The reply identifies the execution command rule in a form appropriate to its record type."
  }
---
Filed from project `runlith`.