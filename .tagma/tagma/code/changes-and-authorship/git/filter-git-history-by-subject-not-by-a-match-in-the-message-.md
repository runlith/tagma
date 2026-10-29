---
id: 01a16e50-3c93-75ed-bf4d-1eb8361face6
title: Filter git history by subject, not by a match in the message body
ord: 110
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16dec-fbf8-7898-a8a7-e83233ac9f35",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a16e3b-4666-7155-8a20-4d13e87e26b3
sources:
  - kind: file
    ref: packages/git/src/history.ts
---
`logAt.excludeSubject` and the `commitsAt` counter apply git `--grep` to the whole message: a commit with a plain subject and a `tagma: graph @ 7 (amber-fox)` line only in the body disappears from the work report. The shared BranchRefs conformance reproduces it through the real adapter. Fix filtering at the producer by subject before the limit, without re-walking skipped prefixes, a full history buffer, or PCRE dependence in the Git build; keep spans, refusal and cancel. The work passed to the existing Git owner by x-workspace decision.
