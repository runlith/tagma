---
id: 01a13fa4-6a45-78d1-b0c6-4b2d0f24bc03
title: The `unattributed by` label from a readonly command window causes needless coordination
ord: 10
tags: ["reflection"]
fields:
  {
    "actual": "The answer named nobody +18/−9 as “unattributed by 01a13f64-c076-7697-a126-c8ea82d299c8: overlap”. The parent demanded to find the overlap; read_changes and a question to a colleague were needed. refl-exec confirmed the file was untouched: it only ran typecheck and bun test.",
    "command": "read_changes({\"path\":\"packages/agent/src/thread/run/ThreadRunReaper.ts\",\"limit\":20})",
    "expected": "On overlap with a formatter, clearly separate the observation window from the alleged author: another thread's readonly check must not look like the source of the disputed edit."
  }
---
Filed from project `runlith`.

The current semantic diff matches my file-tool edits and the subsequent oxfmt. The dispute is not about the accuracy of the nobody verdict under an unproven formatter window, but about the wording that ties it to someone else's readonly thread.