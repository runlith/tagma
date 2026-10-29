---
id: 01a12b1f-d45b-7215-8ce5-73fe182866d8
title: submit_work refused git-unavailable with terminal-stale-authority, then landed unchanged on the next call
ord: 15
tags: ["reflection"]
fields:
  {
    "actual": "refused[git-unavailable]: git symbolic-ref console could not be read: terminal-stale-authority (\"authority or policy bound at preparation changed before admission\"); the identical call seconds later landed 878f59fe18. Cost: one extra call and a misleading 'git could not run' diagnosis.",
    "command": "submit_work {subject: \"Pin Bun 1.4.3 for the workspace and CI\", paths: [\"package.json\"]}",
    "expected": "The commit lands on the first call; nothing about the session's authority or policy was changed by the caller."
  }
---
Filed from project `runlith`.

Machine load average was 13–18 on 12 cores at the time (other agents' typechecks). The refusal names an internal admission race as git being unavailable; the unblock points at replacing the execution host, which was not needed.