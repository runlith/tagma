---
id: 01a145f2-e2aa-71d6-a1f2-baf92d575d9d
title: submit_work refuses a Claude Code session outside Tagma with no-record, and the commit goes by hand
ord: 1
tags: ["reflection"]
fields:
  {
    "actual": "refused no-record: \"this session wrote through another harness, so no record says which lines are its\"; the commit went by hand with `git commit -- <paths>`, and the commit gate then twice refused on its own (module law, swallowed-failures fingerprint) before it landed.",
    "command": "submit_work {project: \"runlith\", paths: [17 files of commit 3e76c0c49c], subject: \"fix: registry acts take the machine graph's floor…\"}",
    "expected": "One act lands the session's own files as a commit with the task id."
  }
---
Filed from outside every registered project.
