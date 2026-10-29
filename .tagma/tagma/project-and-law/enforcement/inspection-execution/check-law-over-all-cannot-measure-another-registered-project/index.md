---
id: 01a157d1-9600-7704-a9e4-826b3574d045
title: "check_law over all cannot measure another registered project from a thread: the MCP door has no project, the CLI door's program run is refused terminal-foreign-project"
ord: 9
tags: ["reflection"]
fields:
  {
    "actual": "The MCP call measured runlith (project 5) at its HEAD and ignored the polygon checkout; the CLI call measured polygon but its program rule 56e875f1 failed: \"(host) checker money was not admitted: terminal-foreign-project: thread … works project 5; this call addresses project 33\"",
    "command": "check_law { over: \"all\", checkout: \"/opt/workspaces/polygon\" } from a thread homed in runlith; and `tagma op check_law --json '{\"over\":\"all\"}'` run with cwd /opt/workspaces/polygon from the same thread's bash",
    "expected": "One call measures polygon's enforced rules over its HEAD, as it does for the thread's home project"
  }
---
Filed from project `runlith`.

check_law's schema takes `checkout` only for `over: "change"` and has no `project`, so over all and staged reach only the call's project. The CLI resolves the project from cwd, but the program launch goes through ProgramRoad under the calling thread's identity, and the execution host refuses a project other than the thread's home. Met while proving the migration of polygon's rule to tagma.config.ts (task e6563db1); the comparison was done by running the old program directly instead.