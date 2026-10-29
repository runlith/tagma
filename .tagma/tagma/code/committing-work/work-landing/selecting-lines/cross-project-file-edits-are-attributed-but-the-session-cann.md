---
id: 01a0e3fa-251b-7fd6-b7a7-4b9c5bd598f1
title: Cross-project file edits are attributed but the session cannot land them in their repository
ord: 6
tags: ["reflection"]
fields:
  {
    "actual": "foreign-project: a thread's calls act in its own project. read_changes in runlith attributes absolute paths of the other repository to this session, while submit_work is scoped to this tree. Delegation is disabled; no alternative delivery was attempted.",
    "command": "tagma op read_changes --project <other> --json '{\"limit\":5}' from the other repository's checkout in a runlith thread",
    "expected": "A supported way to land this session's operator-authorized edits in the other repository, or a recovery naming that handoff."
  }
---
Filed from project `runlith`.