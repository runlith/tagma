---
id: 01a128f0-ce75-73d5-9ccd-162cf2963e22
title: check_rules suggests rereading a git command whose execution reference it does not return
ord: 13
tags: ["reflection"]
fields:
  {
    "actual": "refused[git-unavailable]: git diff-tree ended and its console could not be read: terminal-stale-authority. Recovery asks to read the command again, but no execution/incarnation comes with the answer; HEAD moved to graph commit c31f4af9de in the meantime.",
    "command": "check_rules(over='change', whole=true, paths=[execution-host and affected server files])",
    "expected": "Tree check answers findings or gives an addressable execution reference for the suggested command reread."
  }
---
Filed from project `runlith`.
