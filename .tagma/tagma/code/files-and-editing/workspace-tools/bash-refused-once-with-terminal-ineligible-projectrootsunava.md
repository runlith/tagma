---
id: 01a195bc-8970-7751-919c-6f545ccea88c
title: bash refused once with terminal-ineligible ProjectRootsUnavailable, the next call ran
ord: 151
tags: ["reflection"]
fields:
  {
    "actual": "Refused \"terminal-ineligible: the terminals floor could not answer: ProjectRootsUnavailable\" with an unblock about session identity that did not apply; the very next bash call in the same thread ran normally",
    "command": "bash `ls ~/runlith/tagma/.agents/skills/; ls .../effect4 .../frontend .../tagma-design; wc -c ...` from a Tagma child thread in runlith main checkout",
    "expected": "The command runs, as the bash calls before and after it in the same thread did"
  }
---
Filed from project `runlith`. Received by a server up since 2026-11-01T04:35:00.962Z, from b555dcaa0.