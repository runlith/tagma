---
id: 01a10266-7c54-71a1-ab58-acbefa7142c3
title: Attributing 112 capture records delayed the bash answer by 11 minutes 54 seconds
ord: 2
tags: ["reflection"]
fields:
  {
    "actual": "bash reported that the read for attribution is not interrupted by the limit and finished after 11m 54s, exceeding the 5m rule. All 112 files are attributed. The next profile command ended at tool level with the error “The process died before this tool call settled; whether the effect happened is unknown”; the index write happened and is confirmed by read_changes, the result re-verified read-only.",
    "command": "bash: sequential cp of 112 verified JSON records, produces into two directories, timeout 60000",
    "expected": "Copying local records and accounting for changed lines complete without a multi-minute delay; lines stay attributed."
  }
---
Filed from project `runlith`.