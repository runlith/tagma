---
id: 01a0c8cb-0489-75c1-9523-3097105e821a
title: The failure scrub half-redacts a secret containing an escaped quote, and misses an unquoted JSON key entirely
ord: 46
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0c943-a623-7a28-8565-9ad22033ae3f",
    "status": "done"
  }
sources:
  - kind: symbol
    ref: packages/llm/src/redact.ts
    symbol: redactSecrets
---
Measured by executing the module: `{"token":"a\"b"}` redacts to `{"token":"<redacted>"b"}` — the structural pattern is `"[^"]*"`, so it stops at the escaped quote and leaves the tail standing. Separately, `{token:"x"}` with an unquoted key is matched by neither the JSON pattern (needs quotes) nor the query pattern (needs `=`).

Both are in the list that guards what a live call reports in a failure. The literal pass still catches either where the exact value was sent through a recognized name, so the exposure is a secret that was not sent that way.