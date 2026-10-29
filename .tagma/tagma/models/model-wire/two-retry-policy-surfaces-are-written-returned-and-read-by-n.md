---
id: 01a0c8cb-04b8-7962-9cb7-11264de0afd3
title: Two retry-policy surfaces are written, returned and read by nothing
ord: 49
tags: ["task"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: packages/llm/src/llm/route/ModelRetryPolicy.ts
  - kind: symbol
    ref: packages/llm/src/llm/route/client.ts
    symbol: foldStream
---
`announce: false` is returned by `ClaudeCodeRetry` expecting the completion retry to go unannounced — its own test names the case "unannounced" — but the fold traces every `again: true` and never reads the flag. Separately, `stop`, `of`, `retryAfterMs` and `ceilingMs` are written by policies and read by nothing: a `delay-limit` stop fails with the original error and its figures go nowhere.

Both are stated as behaviour in [[37389012]]. Decide whether the surface is aspirational or dead.