---
id: 01a132b2-eee6-75c7-b710-16224407d0f9
title: read_output answers with effect uncertainty after the command ends instead of the observation result
ord: 17
tags: ["reflection"]
fields:
  {
    "actual": "Answered {type:\"error-text\",value:\"The run ended before this tool call settled; whether the effect happened is unknown — verify before repeating it.\"}; right after it command-result reported exit 0, 1 pass, 35 filtered out in 6.38 s. The result arrived as a separate notification; one observation call gave an unfitting error shape.",
    "command": "read_output({execution:\"5665309d-5d40-414c-b414-3e38ed78ec81\",incarnation:163,wait:120,tail:80})",
    "expected": "The observation returns the finished command's output and status, or keeps the wait; a read-only operation has no unknown effect."
  }
---
Filed from project `runlith`.
