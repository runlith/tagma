---
id: 01a0debd-96dd-7130-a111-f8d146ce2dcd
title: A global twin-package rule obliges cross-project work, but a session can neither land the counterpart commit nor record its task in the other project
ord: 11
tags: ["reflection"]
fields:
  {
    "actual": "the commit is refused (\"/opt/workspaces/runlith is a checkout of project 5, and this call is served in project 7\"); create_block's `project` accepts only global or tagma, so no task can be written in project 5 either; the fix (2 files, red-then-green test, 122 tests green) sits uncommitted in runlith's working tree waiting for the operator",
    "command": "child fix-memory in another project ports a fix into /opt/workspaces/runlith (project 5) as rule 5c12013b requires, then `git -C /opt/workspaces/runlith commit …`; the lead then looks for a way to record the counterpart as an open task in project 5",
    "expected": "rule 5c12013b's own exits are reachable from the session it binds: land the counterpart commit in the twin's checkout, or record it as an open task in that project"
  }
---
The rule is global (binds every project) and names both exits; neither is available from a project-7 session. Cost: a finished, verified change left unlanded in another checkout, and an operator hand-off the rule meant to avoid.