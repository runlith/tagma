---
id: 01a0cabb-b119-7930-95ae-7c0ae0676b91
title: "`rename` is mounted with no presentation row"
ord: 32
tags: ["task"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/native-harness/tools/presentation.ts
---
`rename` rides the files capability's tool list (`FILE_TOOLS`, deferred), but neither the operations table nor the `PRESENTATION` record names it — so the feed renders it through the identifier fallback. The comment claiming every mounted tool is in the table was stripped in c6f42a3059; claim [[2643b203]] now documents the identifier fallback as the last resort of the chain without naming deferred tools. Audit: `rename` is the only mounted tool without a row — `delete`, the other deferred file tool, has one.

Done when `rename` reads from a real row — or a claim states the fallback as the design for deferred tools.