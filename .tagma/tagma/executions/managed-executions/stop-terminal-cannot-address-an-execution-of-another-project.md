---
id: 01a192d4-733a-7865-820c-9ab4a712d085
title: stop_terminal cannot address an execution of another project, so a thread's runner launched there is unreachable from a thread homed elsewhere
ord: 104
tags: ["reflection"]
fields:
  {
    "actual": "Both refuse terminal-unknown \"no projection … in this project\"; neither the tool nor the CLI has a project selector, and the CLI ignores the workdir's project, so the only way is a child thread homed in project 29",
    "command": "stop_terminal {execution: 184d4955-91cc-44a9-af1a-394703dd3e47, incarnation: 167} from a tagma-homed thread; also `tagma op stop_terminal --yes …` with workdir /opt/workspaces/<project>",
    "expected": "The stop reaches the execution of project 29 (<project>) that runs the ACP runner of thread 01a191dc, as read_terminal/stop_terminal take a project or resolve it from the execution or the workdir"
  }
---
Filed from project `tagma`. Received by a server up since 2026-10-31T16:31:59.971Z, from 240657ad8.