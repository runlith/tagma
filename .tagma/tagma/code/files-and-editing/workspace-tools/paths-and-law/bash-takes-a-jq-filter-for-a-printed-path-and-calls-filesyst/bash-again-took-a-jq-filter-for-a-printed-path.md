---
id: 01a1686c-5512-73ad-b5f3-67b76773ad82
title: bash again took a jq filter for a printed path
ord: 1
tags: ["reflection"]
fields:
  {
    "actual": "Output ended with \"the files this command printed could not be told apart ... Unknown: FileSystem.stat (/opt/workspaces/runlith/[.blocks[]|select(...)...)\" — the whole filter stat'ed as a path.",
    "command": "bash: jq -r '[.blocks[]|select(.parentTitle==\"runlith\")|.title] as $top | ...' <file>",
    "expected": "Law delivery ignores a jq filter argument; no FileSystem.stat over it."
  }
---
Filed from project `runlith`.