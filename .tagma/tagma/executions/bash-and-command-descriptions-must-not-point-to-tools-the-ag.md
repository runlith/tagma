---
id: 01a14c37-8e06-77b9-9c6a-040c3872df44
title: Bash and command descriptions must not point to tools the agent does not have
ord: 31
tags: ["task"]
fields:
  {
    "status": "open"
  }
---
The `bash` description and the text about an ended life (`agent-tools/src/descriptions.ts`, `CommandWork.ts#lifeEnded`) point to `start_terminal`, while the `bash` answers about an unknown outcome and the `stop_command` description point to `read_terminal_operation`. Both are the terminals capability; an agent with only shell gets links to what is missing (rule d82432e6). Along the way remove the dead `command` settings-section declaration in `features/executions/settings.ts`: the server declares no such keys.
